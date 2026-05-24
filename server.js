const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const LAT = 40.1798;
const LON = -76.1788;
const USER_AGENT = "EphrataWeatherPortal/1.0 (local weather dashboard)";
const NOAA_RADAR_WMS = "https://nowcoast.noaa.gov/geoserver/observations/weather_radar/ows";
const cache = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function getJson(url, ttlSeconds = 300, headers = {}) {
  const now = Date.now();
  const cached = cache.get(url);
  if (cached && cached.expires > now) return cached.data;

  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/geo+json, application/json, text/csv, */*",
      ...headers,
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}`);
  }
  const text = await response.text();
  const data = JSON.parse(text);
  cache.set(url, { data, expires: now + ttlSeconds * 1000 });
  return data;
}

function propertyValue(feature, key) {
  return feature?.properties?.[key]?.value ?? null;
}

function cToF(value) {
  return value == null ? null : Math.round((value * 9) / 5 + 32);
}

function paToInHg(value) {
  return value == null ? null : value * 0.0002953;
}

function mToMiles(value) {
  return value == null ? null : value / 1609.344;
}

function kphToMph(value) {
  return value == null ? null : Math.round(value * 0.621371);
}

function headlineFor(current, forecast) {
  const condition = current.condition || forecast?.shortForecast || "Live weather";
  if (/thunder|storm/i.test(condition)) return "Storm signals are active around the local area.";
  if (/rain|shower/i.test(condition)) return "Showers are shaping the next few hours nearby.";
  if (/clear|sun|fair/i.test(condition)) return "Clean visibility and brighter breaks are leading the local pattern.";
  if (/cloud|overcast/i.test(condition)) return "Layered clouds are muting the local sky.";
  return `${condition} conditions are driving the current forecast.`;
}

async function weatherPayload() {
  const point = await getJson(`https://api.weather.gov/points/${LAT},${LON}`, 3600);
  const props = point.properties;
  const [forecast, hourly, stations, alerts, uv] = await Promise.all([
    getJson(props.forecast, 300),
    getJson(props.forecastHourly, 300),
    getJson(props.observationStations, 3600),
    getJson(`https://api.weather.gov/alerts/active?point=${LAT},${LON}`, 120),
    getJson(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=uv_index&timezone=America%2FNew_York`, 900).catch(() => null),
  ]);
  const station = stations.features?.[0];
  const stationId = station?.properties?.stationIdentifier;
  if (!stationId) throw new Error("No NWS station found nearby");
  const observation = await getJson(`https://api.weather.gov/stations/${stationId}/observations/latest`, 180);
  const p = observation.properties;
  const firstHour = hourly.properties.periods?.[0] || {};
  const firstDay = forecast.properties.periods?.[0] || {};
  const temp = cToF(propertyValue(observation, "temperature")) ?? firstHour.temperature;
  const dewPoint = cToF(propertyValue(observation, "dewpoint"));
  const wind = kphToMph(propertyValue(observation, "windSpeed")) ?? parseInt(firstHour.windSpeed, 10);
  const gust = kphToMph(propertyValue(observation, "windGust")) ?? wind;
  const pressure = paToInHg(propertyValue(observation, "barometricPressure"));
  const visibility = mToMiles(propertyValue(observation, "visibility"));
  const humidity = propertyValue(observation, "relativeHumidity");
  const condition = p.textDescription || firstHour.shortForecast || firstDay.shortForecast;

  return {
    current: {
      temp,
      condition,
      headline: headlineFor({ condition }, firstDay),
      summary: firstDay.detailedForecast || firstHour.shortForecast || condition,
      humidity: humidity == null ? null : Math.round(humidity),
      dewPoint,
      wind,
      gust,
      uv: uv?.current?.uv_index ?? null,
      pollen: "EPA pollen feed not available without a regional provider",
      visibility: visibility == null ? null : Number(visibility.toFixed(1)),
      pressure,
      updated: p.timestamp,
    },
    hourly: hourly.properties.periods || [],
    daily: forecast.properties.periods || [],
    alerts: alerts.features || [],
    astronomy: await astronomyPayload(),
    sources: ["api.weather.gov", "api.open-meteo.com"],
  };
}

async function aviationPayload() {
  return null;
}

async function spacePayload() {
  const [kpRows, plasmaRows, magRows] = await Promise.all([
    getJson("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json", 300),
    getJson("https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json", 300),
    getJson("https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json", 300),
  ]);
  const latestKp = Array.isArray(kpRows)
    ? kpRows.slice().reverse().find(row => row.Kp != null || row[1] != null) || {}
    : {};
  const latestPlasma = plasmaRows.slice(1).reverse().find(row => row[2]) || [];
  const latestMag = magRows.slice(1).reverse().find(row => row[3]) || [];
  const kp = Number(latestKp.Kp ?? latestKp[1]);
  return {
    kp: Number.isFinite(kp) ? kp.toFixed(1) : null,
    gScale: kp >= 5 ? `G${Math.min(5, Math.floor(kp - 4))}` : "G0",
    solarWind: latestPlasma[2] ? Math.round(Number(latestPlasma[2])) : null,
    bz: latestMag[3] ? Number(latestMag[3]).toFixed(1) : null,
    source: "NOAA SWPC",
  };
}

async function astronomyPayload() {
  const data = await getJson(`https://api.sunrise-sunset.org/json?lat=${LAT}&lng=${LON}&formatted=0`, 21600);
  const sunrise = new Date(data.results.sunrise);
  const sunset = new Date(data.results.sunset);
  return {
    sunrise: sunrise.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }),
    sunset: sunset.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }),
    source: "sunrise-sunset.org",
  };
}

async function climatePayload(url) {
  const date = url.searchParams.get("date") || "2012-06-29";
  const data = await getJson(`https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}&start_date=${date}&end_date=${date}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America%2FNew_York`, 86400);
  return {
    date,
    high: data.daily?.temperature_2m_max?.[0] ?? null,
    low: data.daily?.temperature_2m_min?.[0] ?? null,
    precip: data.daily?.precipitation_sum?.[0] ?? null,
    windMax: data.daily?.wind_speed_10m_max?.[0] ?? null,
    source: "Open-Meteo Historical Weather API",
  };
}

async function mapsPayload() {
  return {
    spcRisk: "SPC Day 1 source linked",
    drought: "U.S. Drought Monitor source linked",
    radar: {
      time: "Auto-updating every few minutes",
      source: "NOAA nowCOAST MRMS base reflectivity",
      service: NOAA_RADAR_WMS,
    },
    links: {
      radar: NOAA_RADAR_WMS,
      spc: "https://www.spc.noaa.gov/products/outlook/day1otlk.html",
      drought: "https://droughtmonitor.unl.edu/",
    },
  };
}

function serveStatic(req, res) {
  const safePath = req.url === "/" ? "/index.html" : decodeURIComponent(req.url.split("?")[0]);
  const filePath = path.join(__dirname, safePath);
  if (!filePath.startsWith(__dirname)) {
    send(res, 403, "Forbidden", "text/plain; charset=utf-8");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      send(res, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  });
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === "/api/weather") return send(res, 200, await weatherPayload());
    if (url.pathname === "/api/aviation") return send(res, 200, await aviationPayload());
    if (url.pathname === "/api/space") return send(res, 200, await spacePayload());
    if (url.pathname === "/api/climate") return send(res, 200, await climatePayload(url));
    if (url.pathname === "/api/maps") return send(res, 200, await mapsPayload());
    return serveStatic(req, res);
  } catch (error) {
    send(res, 502, { error: error.message });
  }
}

http.createServer(route).listen(PORT, () => {
  console.log(`Ephrata Weather Portal running at http://localhost:${PORT}`);
});
