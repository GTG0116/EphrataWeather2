const EPHRATA = { lat: 40.1798, lon: -76.1788, name: "Ephrata, PA", timezone: "America/New_York" };
const GOOGLE_POLLEN_KEY = "AIzaSyBAjoVkrRrLPzv9MSrlWaWTFELT8KpJ41E";
const MAPBOX_TOKEN = "pk.eyJ1IjoiZ3RnMDExNiIsImEiOiJjbWxsODV6NXAwNThmM2ZwdWlkYm0xNjFlIn0.vI186twXYzY45nnuV5FucQ";
const NOAA_RADAR_WMS = "https://nowcoast.noaa.gov/geoserver/observations/weather_radar/ows";
const RADAR_FRAME_MS = 700;
// Fill these after deploying the alert worker described in NOTIFICATIONS.md.
const PUSH_PUBLIC_KEY = "BAHwhEIc4YhZIWcWJVcPiDWzAPijunUm93TaX7x8dHi_T9Q5CJTap4ewTV7ri5GYzRgFRRRnFTDuziH0_yK6Gi0";
const PUSH_SUBSCRIBE_ENDPOINT = "https://weather-alert-worker.gtg0116scratch.workers.dev/subscribe";
// SPC Categorical + probabilistic outlooks, Days 1-3
const SPC_URLS = {
  cat:  ["https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson",
         "https://www.spc.noaa.gov/products/outlook/day2otlk_cat.nolyr.geojson",
         "https://www.spc.noaa.gov/products/outlook/day3otlk_cat.nolyr.geojson"],
  torn: ["https://www.spc.noaa.gov/products/outlook/day1otlk_torn.nolyr.geojson",
         "https://www.spc.noaa.gov/products/outlook/day2otlk_torn.nolyr.geojson",
         "https://www.spc.noaa.gov/products/outlook/day3otlk_torn.nolyr.geojson"],
  wind: ["https://www.spc.noaa.gov/products/outlook/day1otlk_wind.nolyr.geojson",
         "https://www.spc.noaa.gov/products/outlook/day2otlk_wind.nolyr.geojson",
         "https://www.spc.noaa.gov/products/outlook/day3otlk_wind.nolyr.geojson"],
  hail: ["https://www.spc.noaa.gov/products/outlook/day1otlk_hail.nolyr.geojson",
         "https://www.spc.noaa.gov/products/outlook/day2otlk_hail.nolyr.geojson",
         "https://www.spc.noaa.gov/products/outlook/day3otlk_hail.nolyr.geojson"],
};

// SPC Fire Weather outlook GeoJSON
const FIRE_WX_URLS = [
  "https://www.spc.noaa.gov/products/fire_wx/day1otlk_fire.nolyr.geojson",
  "https://www.spc.noaa.gov/products/fire_wx/day2otlk_fire.nolyr.geojson",
];

// IEM storm-based warning polygons for map
const IEM_SBW_URL = "https://mesonet.agron.iastate.edu/geojson/sbw.geojson";

// IEM Local Storm Reports
const LSR_URL = "https://mesonet.agron.iastate.edu/geojson/lsr.php?hours=24";

// NOAA nowCOAST WMS endpoints
const WPC_QPF_WMS  = "https://nowcoast.noaa.gov/geoserver/forecasts/qpf/ows";
const SURFACE_WMS  = "https://nowcoast.noaa.gov/geoserver/observations/surface_analysis/ows";

// Basemap styles
const BASEMAP_STYLES = [
  { id: "dark-v11",    label: "Dark"      },
  { id: "light-v11",   label: "Light"     },
  { id: "streets-v12", label: "Streets"   },
  { id: "outdoors-v12",label: "Outdoors"  },
];
const DROUGHT_URLS = [
  "https://www.ncei.noaa.gov/pub/data/nidis/geojson/us/usdm/USDM-current.geojson",
  "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Drought_Monitor/FeatureServer/0/query?where=1=1&outFields=DM&outSR=4326&f=geojson",
  "https://idpgis.ncep.noaa.gov/arcgis/rest/services/NWS_Climate_Outlooks/cpc_usdm/MapServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson",
];

const WMO_CODES = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Freezing fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Dense drizzle",
  56: "Light freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain",
  66: "Light freezing rain", 67: "Heavy freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Light showers", 81: "Rain showers", 82: "Heavy showers",
  85: "Light snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail",
};

const HIST_MIN_YEAR = 1940;
const HIST_ARCHIVE_DELAY = 5;
const SEASONAL_CENTER = [45, 48, 55, 63, 70, 76, 82, 80, 72, 62, 51, 45];

// ─── Fair Weather Index ────────────────────────────────────────────────────
// Rates conditions on a 0–100 scale based on temperature (seasonally adjusted),
// humidity, wind, cloud cover, and precipitation probability.
const FWI = (() => {
  const COMFORT_WINDOW = 8;
  const RATINGS = [
    { min: 83, label: "Excellent",     color: "#4CAF50", bg: "rgba(76,175,80,0.18)"   },
    { min: 65, label: "Good",          color: "#8BC34A", bg: "rgba(139,195,74,0.15)" },
    { min: 45, label: "OK",            color: "#FFC107", bg: "rgba(255,193,7,0.18)"   },
    { min: 25, label: "Poor",          color: "#FF7043", bg: "rgba(255,112,67,0.2)"   },
    { min:  0, label: "Extremely Poor",color: "#EF5350", bg: "rgba(239,83,80,0.22)"   },
  ];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function scoreTemp(feelsLike, month) {
    if (feelsLike == null) return { pts: SEASONAL_CENTER[month] * 0.6, max: 35 };
    const center = SEASONAL_CENTER[month];
    const delta = feelsLike - center;
    const isCool = month <= 3 || month >= 9;
    const diff = isCool
      ? (delta > 0 ? Math.max(0, delta - 18) : Math.abs(delta))
      : (delta < 0 ? Math.max(0, Math.abs(delta) - 5) : delta);
    let pts;
    if      (diff <= COMFORT_WINDOW)           pts = 35;
    else if (diff <= COMFORT_WINDOW + 7)       pts = 35 - ((diff - COMFORT_WINDOW) / 7) * 14;
    else if (diff <= COMFORT_WINDOW + 17)      pts = 21 - ((diff - COMFORT_WINDOW - 7) / 10) * 17;
    else                                       pts = Math.max(0, 4 - (diff - COMFORT_WINDOW - 17) * 0.4);
    return { pts: clamp(pts, 0, 35), max: 35 };
  }

  function scoreHumidity(rh) {
    if (rh == null) return { pts: 6, max: 10 };
    let pts;
    if      (rh >= 35 && rh <= 60) pts = 10;
    else if (rh >= 25 && rh <= 70) pts = 7;
    else if (rh >= 15 && rh <= 80) pts = 4;
    else if (rh >=  5 && rh <= 90) pts = 1;
    else                           pts = 0;
    return { pts, max: 10 };
  }

  function scoreWind(windSpeed, windGust) {
    if (windSpeed == null) return { pts: 12, max: 20 };
    let pts;
    if      (windSpeed <= 13) pts = 20;
    else if (windSpeed <= 22) pts = 20 - ((windSpeed - 13) /  9) * 7;
    else if (windSpeed <= 32) pts = 13 - ((windSpeed - 22) / 10) * 8;
    else if (windSpeed <= 42) pts =  5 - ((windSpeed - 32) / 10) * 5;
    else                      pts = 0;
    if (windGust != null && windGust > windSpeed + 12)
      pts = Math.max(0, pts - Math.min(5, (windGust - windSpeed - 12) * 0.35));
    return { pts: clamp(pts, 0, 20), max: 20 };
  }

  function scoreCloud(cloud) {
    if (cloud == null) return { pts: 6, max: 10 };
    let pts;
    if      (cloud <= 20) pts = 10;
    else if (cloud <= 40) pts = 8;
    else if (cloud <= 60) pts = 6;
    else if (cloud <= 80) pts = 3;
    else                  pts = 1;
    return { pts, max: 10 };
  }

  function scorePrecip(chance) {
    if (chance == null) return { pts: 15, max: 25 };
    let pts;
    if      (chance <=  0) pts = 25;
    else if (chance <= 10) pts = 20;
    else if (chance <= 20) pts = 14;
    else if (chance <= 35) pts =  8;
    else if (chance <= 55) pts =  3;
    else                   pts =  0;
    return { pts: clamp(pts, 0, 25), max: 25 };
  }

  function calculate({ temp, humidity, wind, gust, cloudCover, precipChance, month }) {
    const m = month ?? new Date().getMonth();
    const t = scoreTemp(temp, m);
    const h = scoreHumidity(humidity);
    const w = scoreWind(wind, gust);
    const c = scoreCloud(cloudCover);
    const p = scorePrecip(precipChance);
    const total = t.pts + h.pts + w.pts + c.pts + p.pts;
    const max   = t.max + h.max + w.max + c.max + p.max;
    const score100 = clamp(Math.round((total / max) * 100), 0, 100);
    const rating = RATINGS.find(r => score100 >= r.min) ?? RATINGS[RATINGS.length - 1];
    return { score100, ...rating, breakdown: { temp: t, humidity: h, wind: w, cloud: c, precip: p } };
  }

  return { calculate, RATINGS };
})();

const fallbackWeather = {
  current: {
    temp: 72,
    condition: "Weather data unavailable",
    headline: "Live weather source is temporarily unavailable.",
    summary: "The interface is running, but the upstream weather provider did not return fresh conditions.",
    humidity: 50,
    dewPoint: 52,
    wind: 8,
    gust: 12,
    uv: 4,
    pollen: null,
    pollenDetail: null,
    airQuality: "Unavailable",
    airQualityDetail: "Open-Meteo air quality unavailable",
    visibility: 10,
    pressure: 30.0,
    updated: new Date().toISOString(),
  },
  hourly: [],
  daily: [],
  alerts: [],
  sources: [],
};

const themePalettes = {
  sunny: {
    gradient: ["#075985", "#1d4ed8", "#0f172a"],
    status: "NWS live forecast",
  },
  sunset: {
    gradient: ["#4c1d95", "#be185d", "#f59e0b"],
    status: "Evening conditions",
  },
  storm: {
    gradient: ["#020617", "#312e81", "#581c87"],
    status: "Storm-aware mode",
  },
  midnight: {
    gradient: ["#020617", "#0f172a", "#134e4a"],
    status: "Night conditions",
  },
};

const tabs = document.querySelectorAll(".tab");
const screens = document.querySelectorAll(".screen");
const refreshButton = document.querySelector("#refreshButton");
const notifyButton = document.querySelector("#notifyButton");
const notifyButtonText = document.querySelector("#notifyButtonText");
const locationForm = document.querySelector("#locationForm");
const locationInput = document.querySelector("#locationInput");
const locationSuggestions = document.querySelector("#locationSuggestions");
const locationName = document.querySelector("#locationName");
const metricGrid = document.querySelector("#metricGrid");
const hourlyStrip = document.querySelector("#hourlyStrip");
const dailyGrid = document.querySelector("#dailyGrid");
const alertsPanel = document.querySelector("#alertsPanel");
const detailModal = document.querySelector("#detailModal");
const modalEyebrow = document.querySelector("#modalEyebrow");
const modalTitle = document.querySelector("#modalTitle");
const modalBody = document.querySelector("#modalBody");
const canvas = document.querySelector("#atmosphereCanvas");
const ctx = canvas.getContext("2d");

let activeTheme = "sunny";
let activeLayer = "Radar";
let activeSpcType = "cat";   // cat | torn | wind | hail
let activeSpcDay  = 1;       // 1, 2, or 3
let activeBasemap = "dark-v11";
let hourlyChartMetric = "temperature";
let frame = 0;
let weatherState = fallbackWeather;
let mapState = {};
let selectedLocation = (() => {
  try {
    const saved = localStorage.getItem("weatherLastLocation");
    if (saved) return JSON.parse(saved);
  } catch {}
  return { ...EPHRATA };
})();
if (locationInput) locationInput.value = selectedLocation.name;
let radarMap;
let mapMarker;
let mapLoaded = false;
let spcLayerData = {};       // key: "day_type" e.g. "1_cat"
let droughtLayerData = null;
let fireWeatherData = null;
let lsrData = null;
let alertPolygonData = null;
let spcPopupWired = false;
let droughtPopupWired = false;
let radarAnimationTimer;
let radarFrameIndex = 0;
let radarFrames = [];
let radarOpacity = 0.78;
let locationSuggestionTimer;
let serviceWorkerRegistration = null;
let locationSuggestionResults = [];
let histCalYear = null;
let histCalMonth = null;
let histSelectedDate = null;
let userLocationMarker = null;
let liveLocationWatchId = null;
let currentSunrise = null;   // actual Date object
let currentSunset  = null;   // actual Date object
let popupWiredLayers = new Set(); // track which layers have popup handlers

async function getJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/geo+json, application/json, text/csv, */*",
      ...options.headers,
    },
    ...options,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

function f(value, digits = 0) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "--";
}

function fahrenheit(valueC) {
  return valueC == null ? null : Math.round((valueC * 9) / 5 + 32);
}

function mph(valueKph) {
  return valueKph == null ? null : Math.round(valueKph * 0.621371);
}

function knots(valueKph) {
  return valueKph == null ? null : Math.round(valueKph * 0.539957);
}

function paToInHg(value) {
  return value == null ? null : value * 0.0002953;
}

function metersToMiles(value) {
  return value == null ? null : value / 1609.344;
}

function propertyValue(feature, key) {
  return feature?.properties?.[key]?.value ?? null;
}

function point() {
  return selectedLocation;
}

function townName(location = selectedLocation) {
  return (location.name || "Local").split(",")[0].trim();
}

function wmoDescription(code) {
  return WMO_CODES[code] || "Unknown";
}

function windDirLabel(deg) {
  if (deg == null) return "--";
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

function uvRiskLabel(uv) {
  if (uv == null) return "--";
  if (uv <= 2) return "Low";
  if (uv <= 5) return "Moderate";
  if (uv <= 7) return "High";
  if (uv <= 10) return "Very High";
  return "Extreme";
}

function cloudCoverLabel(pct) {
  if (pct == null) return "--";
  if (pct < 10) return "Clear";
  if (pct < 30) return "Mostly Clear";
  if (pct < 60) return "Partly Cloudy";
  if (pct < 85) return "Mostly Cloudy";
  return "Overcast";
}

function sunshineHours(seconds) {
  if (seconds == null) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function histMaxDate() {
  const d = new Date();
  d.setDate(d.getDate() - HIST_ARCHIVE_DELAY);
  return d;
}

function setLocationBrand() {
  const name = townName();
  const appTitle = document.querySelector("#appTitle");
  if (appTitle) appTitle.textContent = name;
  document.title = `${name} Weather`;
}

function nwsValue(item, key) {
  return item?.[key]?.value ?? item?.[key] ?? null;
}

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}

function openDetails(eyebrow, title, rows, summary = "") {
  modalEyebrow.textContent = eyebrow;
  modalTitle.textContent = title;
  modalBody.innerHTML = `
    ${summary ? `<p class="modal-summary">${safeText(summary)}</p>` : ""}
    <dl class="detail-list">
      ${rows.map(([term, desc]) => `<div><dt>${safeText(term)}</dt><dd>${safeText(desc)}</dd></div>`).join("")}
    </dl>
  `;
  detailModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeDetails() {
  detailModal.hidden = true;
  document.body.classList.remove("modal-open");
}

function apparentTemperature(tempF, humidity = 50, windMph = 0) {
  const temp = Number(tempF);
  if (!Number.isFinite(temp)) return null;
  const rh = Number(humidity);
  const wind = Number(windMph);
  if (temp >= 80 && Number.isFinite(rh)) {
    return Math.round(
      -42.379 + 2.04901523 * temp + 10.14333127 * rh - 0.22475541 * temp * rh -
      0.00683783 * temp * temp - 0.05481717 * rh * rh +
      0.00122874 * temp * temp * rh + 0.00085282 * temp * rh * rh -
      0.00000199 * temp * temp * rh * rh
    );
  }
  if (temp <= 50 && wind > 3) {
    return Math.round(35.74 + 0.6215 * temp - 35.75 * wind ** 0.16 + 0.4275 * temp * wind ** 0.16);
  }
  return Math.round(temp);
}

function numericWind(value) {
  if (value == null) return null;
  const match = String(value).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function hourFwi(hour) {
  const humidity = nwsValue(hour, "relativeHumidity") ?? weatherState.current?.humidity;
  const feels = apparentTemperature(hour.temperature, humidity, numericWind(hour.windSpeed));
  return FWI.calculate({
    temp: feels ?? hour.temperature,
    humidity,
    wind: numericWind(hour.windSpeed),
    gust: numericWind(hour.windGust),
    cloudCover: null,
    precipChance: hour.probabilityOfPrecipitation?.value,
    month: hour.startTime ? new Date(hour.startTime).getMonth() : new Date().getMonth(),
  });
}

async function searchLocations(query) {
  const data = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=8&language=en&format=json&countryCode=US`);
  return (data.results || []).map(item => ({
    lat: item.latitude,
    lon: item.longitude,
    name: [item.name, item.admin1].filter(Boolean).join(", "),
    timezone: item.timezone || "America/New_York",
  }));
}

async function reverseGeocode(lat, lon) {
  try {
    const params = new URLSearchParams({ lat, lon, format: "json", addressdetails: "1", "accept-language": "en" });
    const data = await getJson(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: { "User-Agent": "WeatherPortal/1.0" },
    });
    const addr = data.address || {};
    const city = addr.city || addr.town || addr.village || addr.hamlet || "";
    const state = addr.state || "";
    if (city && state) return `${city}, ${state}`;
    if (city) return city;
    return data.display_name?.split(",").slice(0, 2).join(",").trim() || null;
  } catch {
    return null;
  }
}

async function locateMe() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const name = await reverseGeocode(lat, lon) || `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`;
        resolve({ lat, lon, name, timezone: "auto" });
      },
      () => resolve(null),
      { timeout: 8000, maximumAge: 60000 }
    );
  });
}

function buildLocationPopup(name, extra = "") {
  const cur = weatherState.current || fallbackWeather.current;
  const temp = cur.temp != null ? `${f(cur.temp)}°F` : "--";
  const cond = cur.condition || "Weather conditions";
  return `
    <div class="popup-header">
      <div class="popup-icon" style="background:rgba(59,130,246,0.18);border:1px solid rgba(59,130,246,0.35);">📍</div>
      <div>
        <div class="popup-title">${safeText(name)}</div>
        <div class="popup-subtitle">${safeText(cond)}</div>
      </div>
    </div>
    <div class="popup-stat"><span class="popup-key">Temperature</span><span class="popup-val">${temp}</span></div>
    ${extra ? `<div class="popup-note">${safeText(extra)}</div>` : ""}
  `;
}

function updateUserLocationMarker(lat, lon) {
  if (!radarMap || !mapLoaded) return;
  if (userLocationMarker) {
    userLocationMarker.setLngLat([lon, lat]);
  } else {
    const el = document.createElement("div");
    el.className = "user-location-dot";
    const popup = new mapboxgl.Popup({ offset: 12 }).setHTML(`
      <div class="popup-header">
        <div class="popup-icon" style="background:rgba(56,189,248,0.18);border:1px solid rgba(56,189,248,0.35);">🎯</div>
        <div>
          <div class="popup-title">Your GPS Location</div>
          <div class="popup-subtitle">${lat.toFixed(4)}°, ${lon.toFixed(4)}°</div>
        </div>
      </div>
    `);
    userLocationMarker = new mapboxgl.Marker({ element: el, anchor: "center" })
      .setLngLat([lon, lat])
      .setPopup(popup)
      .addTo(radarMap);
  }
}

async function locateOnMap() {
  const btn = document.querySelector("#mapLocateBtn");
  if (btn) { btn.disabled = true; btn.textContent = "..."; }
  try {
    const loc = await locateMe();
    if (loc) {
      updateUserLocationMarker(loc.lat, loc.lon);
      if (radarMap) radarMap.flyTo({ center: [loc.lon, loc.lat], zoom: Math.max(radarMap.getZoom(), 9), duration: 900 });
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Find Me"; }
  }
}

function renderLocationSuggestions(results) {
  locationSuggestionResults = results;
  if (!results.length) {
    locationSuggestions.hidden = true;
    locationSuggestions.innerHTML = "";
    return;
  }
  locationSuggestions.innerHTML = results.map((item, index) => `
    <button type="button" role="option" data-suggestion-index="${index}">
      <strong>${safeText(townName(item))}</strong>
      <span>${safeText(item.name.replace(`${townName(item)}, `, ""))}</span>
    </button>
  `).join("");
  locationSuggestions.hidden = false;
}

function hideLocationSuggestions() {
  locationSuggestions.hidden = true;
}

async function chooseLocation(location) {
  selectedLocation = { ...location };
  setLocationBrand();
  locationInput.value = selectedLocation.name;
  hideLocationSuggestions();
  if (radarMap) {
    radarMap.flyTo({ center: [selectedLocation.lon, selectedLocation.lat], zoom: Math.max(radarMap.getZoom(), 8), duration: 900 });
    mapMarker?.setLngLat([selectedLocation.lon, selectedLocation.lat]);
  }
  await refreshLiveData();
  try { localStorage.setItem("weatherLastLocation", JSON.stringify(selectedLocation)); } catch {}
  if (Notification.permission === "granted") {
    registerPushSubscription().catch(e => console.warn("Push location update failed", e));
  }
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) && (lon < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInGeometry(lon, lat, geometry) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") return pointInRing(lon, lat, geometry.coordinates[0] || []);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.some(poly => pointInRing(lon, lat, poly[0] || []));
  return false;
}

const iemPhenomenaMap = {
  "TO.W": "Tornado Warning",
  "SV.W": "Severe Thunderstorm Warning",
  "FF.W": "Flash Flood Warning",
  "FA.Y": "Flood Advisory",
  "SQ.W": "Snow Squall Warning",
  "MA.W": "Special Marine Warning",
};

const ALERT_PHENOMENA_COLORS = {
  TO: { fill: "#dc2626", line: "#ef4444" },
  SV: { fill: "#f97316", line: "#fb923c" },
  FF: { fill: "#10b981", line: "#34d399" },
  FA: { fill: "#22d3ee", line: "#67e8f9" },
  SQ: { fill: "#a78bfa", line: "#c4b5fd" },
  MA: { fill: "#38bdf8", line: "#7dd3fc" },
};

function warningHasMapColor(feature) {
  const phenomenon = String(feature?.properties?.phenomena || "").toUpperCase();
  return !!ALERT_PHENOMENA_COLORS[phenomenon];
}

function filterMapColoredWarnings(data) {
  return {
    ...(data || {}),
    type: data?.type || "FeatureCollection",
    features: (data?.features || []).filter(warningHasMapColor),
  };
}

function formatWindTag(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/mph/i.test(text)) return text;
  const number = text.match(/\d+(\.\d+)?/);
  return number ? `${number[0]} mph` : text;
}

function formatHailTag(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/\bin\b|"/i.test(text)) return text.replace(/"/g, " in");
  const number = text.match(/\d+(\.\d+)?/);
  return number ? `${number[0]} in` : text;
}

function severeDetectionTag(alert) {
  if (!/severe thunderstorm warning/i.test(alert.event || "")) return null;
  const detections = [alert.iem_windthreat, alert.iem_hailthreat, alert.iem_windtag, alert.iem_hailtag]
    .filter(Boolean)
    .map(item => String(item).toUpperCase());
  if (!detections.length) return null;
  if (detections.some(item => item.includes("OBSERVED"))) return "Observed";
  if (detections.some(item => item.includes("RADAR"))) return "Radar indicated";
  return null;
}

function normalizeNwsAlert(feature) {
  const p = feature.properties || {};
  return {
    id: feature.id || p.id,
    event: p.event || "Weather Alert",
    headline: p.headline || p.event || "Weather Alert",
    severity: p.severity || "Unknown",
    urgency: p.urgency || "Unknown",
    effective: p.effective,
    expires: p.expires,
    description: p.description || "",
    instruction: p.instruction || "",
    parameters: p.parameters || {},
    areaDesc: p.areaDesc || "",
    source: "NWS",
  };
}

function tagsForAlert(alert) {
  const p = alert.parameters || {};
  const raw = [
    alert.severity,
    p.tornadoDetection?.[0],
    p.thunderstormDamageThreat?.[0],
    p.flashFloodDetection?.[0],
    p.maxWindGust?.[0] && `Wind ${formatWindTag(p.maxWindGust[0])}`,
    p.maxHailSize?.[0] && `Hail ${formatHailTag(p.maxHailSize[0])}`,
    severeDetectionTag(alert),
    alert.iem_tornadotag && `Tornado ${alert.iem_tornadotag}`,
    alert.iem_damagetag && `Damage ${alert.iem_damagetag}`,
    alert.iem_windtag && `Wind ${formatWindTag(alert.iem_windtag)}`,
    alert.iem_hailtag && `Hail ${formatHailTag(alert.iem_hailtag)}`,
    alert.iem_floodtag && `Flood ${alert.iem_floodtag}`,
    alert.iem_is_pds && "PDS",
    alert.iem_is_emergency && "Emergency",
  ].filter(Boolean);
  return [...new Set(raw.map(item => String(item).replace(/_/g, " ").trim()))]
    .filter(item => !/^immediate$/i.test(item));
}

function normalizeIemFeature(feature) {
  const p = feature.properties || {};
  const key = `${p.phenomena}.${p.significance}`;
  const text = [p.product_text, p.producttext, p.product_narrative, p.narrative].filter(Boolean).join("\n\n");
  return {
    id: p.uri || p.id || `${key}-${p.issue}`,
    event: iemPhenomenaMap[key] || key,
    headline: iemPhenomenaMap[key] || p.product_id || "Storm-Based Warning",
    severity: p.damagetag || p.windthreat || p.hailthreat || "Warning",
    urgency: p.urgency || "",
    effective: p.issue,
    expires: p.expire,
    description: text,
    instruction: "",
    parameters: {},
    source: "IEM",
    areaDesc: p.counties || p.geography || p.wfo || "",
    iem_windtag: p.windtag || null,
    iem_hailtag: p.hailtag || null,
    iem_tornadotag: p.tornadotag || null,
    iem_damagetag: p.damagetag || null,
    iem_windthreat: p.windthreat || null,
    iem_hailthreat: p.hailthreat || null,
    iem_squalltag: p.squalltag || null,
    iem_floodtag: p.floodtag_damage || null,
    iem_is_pds: !!p.is_pds,
    iem_is_emergency: !!p.is_emergency,
  };
}

async function alertsPayload(lat, lon) {
  const [iemResult, nwsResult] = await Promise.allSettled([
    getJson("https://mesonet.agron.iastate.edu/geojson/sbw.geojson"),
    getJson(`https://api.weather.gov/alerts/active?point=${lat},${lon}`),
  ]);
  const nwsAlerts = nwsResult.status === "fulfilled" ? (nwsResult.value.features || []).map(normalizeNwsAlert) : [];
  const iemAlerts = iemResult.status === "fulfilled"
    ? (iemResult.value.features || [])
      .filter(feature => pointInGeometry(lon, lat, feature.geometry))
      .map(normalizeIemFeature)
    : [];
  if (iemResult.status === "fulfilled") {
    return { alerts: iemAlerts, source: "IEM storm-based warnings" };
  }
  return { alerts: nwsAlerts.map(alert => ({ ...alert, source: "NWS Backup" })), source: "NWS backup (IEM unavailable)" };
}

function headlineFor(condition, forecast) {
  const text = condition || forecast?.shortForecast || "Live weather";
  const name = townName();
  if (/thunder|storm/i.test(text)) return `Storm signals are active around ${name}.`;
  if (/rain|shower/i.test(text)) return "Showers are shaping the next few hours.";
  if (/clear|sun|fair/i.test(text)) return "Clean visibility and brighter breaks are leading the local pattern.";
  if (/cloud|overcast/i.test(text)) return `Layered clouds are muting the sky over ${name}.`;
  return `${text} conditions are driving the current forecast.`;
}

async function astronomyPayload() {
  const loc = point();
  const tz = loc.timezone || "America/New_York";
  const localDate = localDateISO(new Date(), tz);
  const data = await getJson(`https://api.sunrise-sunset.org/json?lat=${loc.lat}&lng=${loc.lon}&date=${localDate}&formatted=0`);
  const sunriseDate = new Date(data.results.sunrise);
  const sunsetDate  = new Date(data.results.sunset);
  // Store actual Date objects for theme logic
  currentSunrise = sunriseDate;
  currentSunset  = sunsetDate;
  return {
    sunrise: sunriseDate.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }),
    sunset:  sunsetDate.toLocaleTimeString("en-US",  { timeZone: tz, hour: "numeric", minute: "2-digit" }),
    sunriseDate,
    sunsetDate,
  };
}

async function airQualityPayload() {
  const loc = point();
  const data = await getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${loc.lat}&longitude=${loc.lon}&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide&timezone=${encodeURIComponent(loc.timezone || "America/New_York")}`);
  const current = data.current || {};
  return {
    label: current.us_aqi == null ? "Unavailable" : `${Math.round(current.us_aqi)} AQI`,
    detail: current.pm2_5 == null ? "Open-Meteo air quality" : `PM2.5 ${f(current.pm2_5, 1)} ug/m3, O3 ${f(current.ozone, 1)} ug/m3`,
    raw: current,
  };
}

function summarizePollen(data) {
  const day = data.dailyInfo?.[0];
  const types = day?.pollenTypeInfo || [];
  if (!types.length) return null;
  const ranked = types
    .filter(type => type.indexInfo)
    .sort((a, b) => (b.indexInfo?.value || 0) - (a.indexInfo?.value || 0));
  const top = ranked[0];
  if (!top) return null;
  const readableName = top?.displayName || top?.code?.toLowerCase() || "Pollen";
  const category = top?.indexInfo?.category || "reported";
  const detail = ranked
    .slice(0, 3)
    .map(type => `${type.displayName || type.code}: ${type.indexInfo?.category || "n/a"}`)
    .join(" | ");
  return {
    label: `${readableName} ${category}`,
    detail: detail || "Google Pollen API forecast",
  };
}

async function pollenPayload() {
  const loc = point();
  const params = new URLSearchParams({
    key: GOOGLE_POLLEN_KEY,
    "location.longitude": loc.lon,
    "location.latitude": loc.lat,
    days: "1",
  });
  return summarizePollen(await getJson(`https://pollen.googleapis.com/v1/forecast:lookup?${params}`));
}

async function weatherPayload() {
  const loc = point();
  const gridPoint = await getJson(`https://api.weather.gov/points/${loc.lat},${loc.lon}`);
  const props = gridPoint.properties;
  selectedLocation.timezone = props.timeZone || loc.timezone || "America/New_York";
  const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=uv_index&daily=uv_index_max,apparent_temperature_max,apparent_temperature_min&temperature_unit=fahrenheit&timezone=${encodeURIComponent(selectedLocation.timezone)}`;
  const [forecast, hourly, stations, alertsData, openMeteo, airQuality, pollen, astronomy] = await Promise.all([
    getJson(props.forecast),
    getJson(props.forecastHourly),
    getJson(props.observationStations),
    alertsPayload(loc.lat, loc.lon).catch(() => ({ alerts: [], source: "Unavailable" })),
    getJson(openMeteoUrl).catch(() => null),
    airQualityPayload().catch(error => ({ label: "Unavailable", detail: `Open-Meteo air quality ${error.message}` })),
    pollenPayload().catch(() => null),
    astronomyPayload().catch(() => null),
  ]);
  const station = stations.features?.[0];
  const stationId = station?.properties?.stationIdentifier;
  if (!stationId) throw new Error("No NWS observation station found nearby");
  const observation = await getJson(`https://api.weather.gov/stations/${stationId}/observations/latest`);
  const p = observation.properties || {};
  const firstHour = hourly.properties?.periods?.[0] || {};
  const firstDay = forecast.properties?.periods?.[0] || {};
  const temp = fahrenheit(propertyValue(observation, "temperature")) ?? firstHour.temperature;
  const dewPoint = fahrenheit(propertyValue(observation, "dewpoint"));
  const wind = mph(propertyValue(observation, "windSpeed")) ?? parseInt(firstHour.windSpeed, 10);
  const gust = mph(propertyValue(observation, "windGust")) ?? wind;
  const pressure = paToInHg(propertyValue(observation, "barometricPressure"));
  const visibility = metersToMiles(propertyValue(observation, "visibility"));
  const humidity = propertyValue(observation, "relativeHumidity");
  const condition = p.textDescription || firstHour.shortForecast || firstDay.shortForecast;

  return {
    current: {
      temp,
      condition,
      headline: headlineFor(condition, firstDay),
      summary: firstDay.detailedForecast || firstHour.shortForecast || condition,
      humidity: humidity == null ? null : Math.round(humidity),
      dewPoint,
      wind,
      gust,
      uv: openMeteo?.current?.uv_index ?? null,
      pollen: pollen?.label || null,
      pollenDetail: pollen?.detail || null,
      airQuality: airQuality?.label || "Unavailable",
      airQualityDetail: airQuality?.detail || "Open-Meteo air quality unavailable",
      visibility: visibility == null ? null : Number(visibility.toFixed(1)),
      pressure,
      updated: p.timestamp,
    },
    hourly: hourly.properties?.periods || [],
    daily: forecast.properties?.periods || [],
    dailyExtras: openMeteo?.daily || {},
    alerts: (alertsData.alerts || []).map(alert => ({ ...alert, tags: tagsForAlert(alert) })),
    alertSource: alertsData.source || "NWS",
    astronomy,
    sources: ["api.weather.gov", "api.open-meteo.com", "pollen.googleapis.com"],
  };
}

async function aviationPayload() {
  const loc = point();
  const gridPoint = await getJson(`https://api.weather.gov/points/${loc.lat},${loc.lon}`);
  const stations = await getJson(gridPoint.properties.observationStations);
  const station = stations.features?.[0];
  const stationId = station?.properties?.stationIdentifier;
  if (!stationId) throw new Error("No NWS aviation station found nearby");
  const stationName = station?.properties?.name || stationId;
  const data = await getJson(`https://api.weather.gov/stations/${stationId}/observations/latest`);
  const p = data.properties || {};
  const temp = fahrenheit(p.temperature?.value);
  const dewPoint = fahrenheit(p.dewpoint?.value);
  const windMph = mph(p.windSpeed?.value);
  const windKt = knots(p.windSpeed?.value);
  const gustKt = knots(p.windGust?.value);
  const visibility = metersToMiles(p.visibility?.value);
  const ceiling = (p.cloudLayers || [])
    .map(layer => layer.base?.value)
    .filter(Number.isFinite)
    .map(value => Math.round(value * 3.28084))
    .sort((a, b) => a - b)[0] ?? null;
  const flightRule = visibility == null ? "UNK" :
    visibility < 1 || (ceiling != null && ceiling < 500) ? "LIFR" :
    visibility < 3 || (ceiling != null && ceiling < 1000) ? "IFR" :
    visibility <= 5 || (ceiling != null && ceiling < 3000) ? "MVFR" : "VFR";

  return {
    source: "NWS api.weather.gov",
    station: `${stationId}, ${stationName}`,
    reportTime: p.timestamp,
    flightRule,
    textDescription: p.textDescription,
    temp,
    dewPoint,
    windDirection: p.windDirection?.value,
    windMph,
    windKt,
    gustKt,
    visibility,
    ceiling,
    pressure: paToInHg(p.barometricPressure?.value),
    sky: (p.cloudLayers || []).map(layer => {
      const base = layer.base?.value == null ? "" : ` ${Math.round(layer.base.value * 3.28084)} ft`;
      return `${layer.amount || "Cloud"}${base}`;
    }),
  };
}

async function spacePayload() {
  const [kpRows, plasmaRows, magRows] = await Promise.all([
    getJson("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"),
    getJson("https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json"),
    getJson("https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json"),
  ]);
  const latestKp = Array.isArray(kpRows) ? kpRows.slice().reverse().find(row => row.Kp != null || row[1] != null) || {} : {};
  const latestPlasma = plasmaRows.slice(1).reverse().find(row => row[2]) || [];
  const latestMag = magRows.slice(1).reverse().find(row => row[3]) || [];
  const kp = Number(latestKp.Kp ?? latestKp[1]);
  return {
    kp: Number.isFinite(kp) ? kp.toFixed(1) : null,
    gScale: kp >= 5 ? `G${Math.min(5, Math.floor(kp - 4))}` : "G0",
    solarWind: latestPlasma[2] ? Math.round(Number(latestPlasma[2])) : null,
    bz: latestMag[3] ? Number(latestMag[3]).toFixed(1) : null,
  };
}

async function climatePayload(date) {
  const loc = point();
  const maxD = histMaxDate();
  const targetDate = new Date(`${date}T12:00:00`);
  if (targetDate > maxD) {
    throw new Error(`Archive data is only available through ${maxD.toLocaleDateString()}. ERA5 reanalysis has a ${HIST_ARCHIVE_DELAY}-day delay.`);
  }
  const daily = [
    "weather_code",
    "temperature_2m_max","temperature_2m_min",
    "apparent_temperature_max","apparent_temperature_min",
    "precipitation_sum","rain_sum","snowfall_sum",
    "wind_speed_10m_max","wind_gusts_10m_max","wind_direction_10m_dominant",
    "cloud_cover_mean","pressure_msl_mean","relative_humidity_2m_mean",
    "dew_point_2m_mean","sunshine_duration","uv_index_max",
    "sunrise","sunset",
  ].join(",");
  const hourly = [
    "temperature_2m","precipitation","weather_code",
    "wind_speed_10m","wind_direction_10m",
  ].join(",");
  const tz = encodeURIComponent(loc.timezone || "America/New_York");
  const data = await getJson(
    `https://archive-api.open-meteo.com/v1/archive?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&start_date=${date}&end_date=${date}&daily=${daily}&hourly=${hourly}` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=${tz}`
  );
  if (!data.daily?.time?.length) throw new Error("No archive data returned for this date.");
  return { date, d: data.daily, h: data.hourly };
}

async function mapsPayload() {
  const loc = point();
  const [catResult, tornResult, windResult, hailResult, droughtResult] = await Promise.allSettled([
    fetchOutlookGeoJson(SPC_URLS.cat),
    fetchOutlookGeoJson(SPC_URLS.torn),
    fetchOutlookGeoJson(SPC_URLS.wind),
    fetchOutlookGeoJson(SPC_URLS.hail),
    fetchDroughtGeoJson(),
  ]);
  const getSpcRisk = result => {
    if (result.status !== "fulfilled") return null;
    return (normalizeSpcData(result.value).features || [])
      .find(feature => pointInGeometry(loc.lon, loc.lat, feature.geometry)) || null;
  };
  const spcCat = getSpcRisk(catResult);
  const spcTorn = getSpcRisk(tornResult);
  const spcWind = getSpcRisk(windResult);
  const spcHail = getSpcRisk(hailResult);
  const droughtFeature = droughtResult.status === "fulfilled"
    ? (normalizeDroughtData(droughtResult.value).features || [])
      .find(feature => pointInGeometry(loc.lon, loc.lat, feature.geometry))
    : null;
  return {
    spcRisk: spcCat ? spcLabel(spcCat.properties?.LABEL) : "No Day 1 categorical risk",
    spcTorn: spcTorn ? spcPopupLabel(spcTorn.properties || {}) : "0%",
    spcWind: spcWind ? spcPopupLabel(spcWind.properties || {}) : "0%",
    spcHail: spcHail ? spcPopupLabel(spcHail.properties || {}) : "0%",
    drought: droughtFeature ? droughtLabel(droughtFeature.properties?.CATEGORY) : "No active USDM drought category",
    radar: {
      time: "Manual timeline controls",
      source: "NOAA nowCOAST MRMS base reflectivity",
      service: NOAA_RADAR_WMS,
    },
  };
}

async function fetchOutlookGeoJson(url) {
  try {
    return await getJson(url, { cache: "no-store" });
  } catch (error) {
    const proxy = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    return getJson(proxy, { cache: "no-store" });
  }
}

async function fetchDroughtGeoJson() {
  let lastError;
  for (const url of DROUGHT_URLS) {
    try {
      const data = await fetchOutlookGeoJson(url);
      const normalized = normalizeDroughtData(data);
      if ((normalized.features || []).some(feature => feature.properties?.CATEGORY)) return normalized;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("No drought feed returned usable data");
}

function normalizeSpcData(data) {
  if (!data?.features) return data || { features: [] };
  return {
    ...data,
    features: data.features.map(feature => {
      const props = feature.properties || {};
      const label = String(props.LABEL ?? props.label ?? "").toUpperCase();
      const raw = Number.parseFloat(label.replace("%", ""));
      const riskNum = Number.isFinite(raw) ? (raw > 0 && raw < 1 ? raw * 100 : raw) : null;
      return { ...feature, properties: { ...props, LABEL: label, RISK_NUM: riskNum } };
    }),
  };
}

function normalizeDroughtData(data) {
  if (!data?.features) return data || { features: [] };
  function category(props = {}) {
    const candidates = [
      props.DM, props.dm, props.CATEGORY, props.category, props.LABEL, props.label,
      props.DROUGHT, props.DROUGHT_LVL, props.DROUGHT_LEVEL, props.USDM, props.USDM_CLASS,
      props.CLASS, props.gridcode, props.GRIDCODE, props.VALUE, props.value, props.DN, props.dn,
    ];
    for (const candidate of candidates) {
      if (candidate == null) continue;
      const text = String(candidate).trim().toUpperCase();
      if (/^D[0-4]$/.test(text)) return text;
      if (/^\d+$/.test(text)) {
        const n = Number.parseInt(text, 10);
        if (n >= 0 && n <= 4) return `D${n}`;
        if (n >= 1 && n <= 5) return `D${n - 1}`;
      }
      const match = text.match(/D\s*([0-4])/);
      if (match) return `D${match[1]}`;
      if (text.includes("ABNORM")) return "D0";
      if (text.includes("MODERATE")) return "D1";
      if (text.includes("SEVERE")) return "D2";
      if (text.includes("EXTREME")) return "D3";
      if (text.includes("EXCEPTIONAL")) return "D4";
    }
    return "";
  }
  return {
    ...data,
    features: data.features.map(feature => ({
      ...feature,
      properties: { ...(feature.properties || {}), CATEGORY: category(feature.properties) },
    })),
  };
}

function spcLabel(label = "") {
  const labels = {
    TSTM: "General thunderstorm",
    MRGL: "Marginal risk",
    SLGT: "Slight risk",
    ENH: "Enhanced risk",
    MDT: "Moderate risk",
    HIGH: "High risk",
  };
  return labels[String(label).toUpperCase()] || String(label || "No risk");
}

function spcPopupLabel(properties = {}) {
  const label = String(properties.LABEL || "");
  if (Number.isFinite(Number(properties.RISK_NUM))) return `${properties.RISK_NUM}% probability`;
  return spcLabel(label);
}

function droughtLabel(category = "") {
  const labels = {
    D0: "D0 Abnormally Dry",
    D1: "D1 Moderate Drought",
    D2: "D2 Severe Drought",
    D3: "D3 Extreme Drought",
    D4: "D4 Exceptional Drought",
  };
  return labels[category] || category || "No active drought category";
}

function spcStyle(feature) {
  const label = String(feature.properties?.LABEL || "").toUpperCase();
  const styles = {
    TSTM: ["#c0e8c0", "#96d896"],
    MRGL: ["#66cc66", "#44bb44"],
    SLGT: ["#ffe066", "#ddbb00"],
    ENH: ["#ffa040", "#cc7700"],
    MDT: ["#ff6060", "#cc2222"],
    HIGH: ["#ff40ff", "#cc00cc"],
  };
  const [fillColor, color] = styles[label] || ["transparent", "transparent"];
  return { color, fillColor, fillOpacity: 0.42, opacity: 0.9, weight: 1.4 };
}

function droughtStyle(feature) {
  const styles = {
    D0: ["#fcd37f", "#e9a137"],
    D1: ["#ffaa00", "#cc8800"],
    D2: ["#e36e00", "#b85400"],
    D3: ["#c00000", "#8f0000"],
    D4: ["#730000", "#540000"],
  };
  const [fillColor, color] = styles[feature.properties?.CATEGORY] || ["transparent", "transparent"];
  return { color, fillColor, fillOpacity: 0.5, opacity: 0.9, weight: 1.2 };
}

function fwiNote(score) {
  if (score >= 83) return "Excellent conditions — ideal for any outdoor activity.";
  if (score >= 65) return "Good conditions for most outdoor plans.";
  if (score >= 45) return "Workable outside, though weather awareness is advised.";
  if (score >= 25) return "Challenging conditions — limit prolonged outdoor exposure.";
  return "Unpleasant outdoor conditions — take precautions.";
}

function comfortIndex(weather) {
  const month = new Date().getMonth();
  const center = SEASONAL_CENTER[month];
  const temp = weather.temp ?? 72;
  const delta = temp - center;
  const isCoolSeason = month <= 3 || month >= 9;
  let tempDiff;
  if (isCoolSeason) {
    tempDiff = delta > 0 ? Math.max(0, delta - 15) : Math.abs(delta);
  } else {
    tempDiff = delta < 0 ? Math.max(0, Math.abs(delta) - 5) : delta;
  }
  const tempPenalty = tempDiff * 1.15;
  const humidity = weather.humidity ?? 50;
  const humidityPenalty = humidity < 35 ? (35 - humidity) * 0.45 : Math.max(0, humidity - 55) * 0.72;
  const wind = weather.wind ?? 0;
  const gust = weather.gust ?? wind;
  let windPenalty = Math.max(0, wind - 18) * 0.9;
  if (gust > wind + 12) windPenalty += Math.min(5, (gust - wind - 12) * 0.35);
  const uvPenalty = Math.max(0, (weather.uv ?? 0) - 5) * 3.2;
  return Math.max(0, Math.round(100 - tempPenalty - humidityPenalty - windPenalty - uvPenalty));
}

function comfortLabel(score) {
  if (score >= 86) return ["Excellent", "Ideal for running, golfing, gardening, and evening patio time."];
  if (score >= 70) return ["Good", "Pleasant for most outdoor plans with a few weather-aware tweaks."];
  if (score >= 52) return ["Fair", "Workable outside, though exposure and pacing matter."];
  return ["Poor", "Limit strenuous outdoor activity and watch changing conditions."];
}

function localHour(date = new Date(), timezone = selectedLocation.timezone || "America/New_York") {
  const hourText = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  }).format(date);
  return Number(hourText.replace(/^24$/, "0"));
}

function localDateISO(date = new Date(), timezone = selectedLocation.timezone || "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function chooseTheme(current) {
  const text = `${current.condition || ""}`.toLowerCase();
  if (text.includes("thunder") || text.includes("storm") || text.includes("heavy rain")) return "storm";
  if (text.includes("rain") || text.includes("drizzle") || text.includes("shower")) return "sunny";
  if (text.includes("fog") || text.includes("mist") || text.includes("haze")) return "sunny";

  const now = new Date();

  // Use actual sunrise/sunset data when available
  if (currentSunrise && currentSunset) {
    const nowMs = now.getTime();
    const riseMs = currentSunrise.getTime();
    const setMs  = currentSunset.getTime();
    if (nowMs < riseMs || nowMs > setMs) return "midnight";           // night
    if (nowMs > setMs - 60 * 60 * 1000) return "sunset";             // within 1h of sunset
    if (nowMs < riseMs + 30 * 60 * 1000) return "sunset";            // within 30m of sunrise
    return "sunny";
  }

  // Fallback to hour-based
  const hour = localHour(now);
  if (hour >= 20 || hour <= 5) return "midnight";
  if (hour >= 17) return "sunset";
  return "sunny";
}

function conditionClass(current) {
  const text = `${current.condition || ""}`.toLowerCase();
  if (text.includes("thunder") || text.includes("storm")) return "storm";
  if (text.includes("drizzle")) return "drizzle";
  if (text.includes("rain") || text.includes("shower")) return "rain";
  if (text.includes("fog") || text.includes("mist") || text.includes("haze")) return "fog";
  if (text.includes("partly") || text.includes("mostly sunny") || text.includes("mostly clear")) return "partly";
  if (text.includes("cloud") || text.includes("overcast")) return "cloudy";
  if (text.includes("snow") || text.includes("sleet") || text.includes("ice")) return "winter";
  return "clear";
}

function weatherIcon(type) {
  return `<span class="weather-icon" aria-hidden="true">${WeatherIcons.fromText(type, isNightPeriod(type))}</span>`;
}

function uiIcon(name) {
  // All icons use a 24×24 viewBox with stroke-width 2, matching the SVG css rules.
  const icons = {
    air:      `<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>`,
    pollen:   `<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3m-2.6-7.4-2.1 2.1M9.7 14.3l-2.1 2.1m9.8 0-2.1-2.1M9.7 9.7 7.6 7.6"/>`,
    uv:       `<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2m-3.5-6.5-1.5 1.5M5 5l1.5 1.5M19 19l-1.5-1.5M5 19l1.5-1.5"/>`,
    dew:      `<path d="M12 2.69 17.66 8.35a8 8 0 1 1-11.32 0z"/>`,
    humidity: `<path d="M12 2.69 17.66 8.35a8 8 0 1 1-11.32 0z"/><path d="M8 16c1.5 2 4 2.5 6 1"/>`,
    wind:     `<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>`,
    pressure: `<circle cx="12" cy="12" r="9"/><path d="m12 12 4-3.5"/><path d="M7 16h10"/>`,
  };
  return `<span class="ui-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${icons[name] || icons.pressure}</svg></span>`;
}

function iconForCondition(text = "") {
  return text || "Partly Cloudy";
}

function isNightPeriod(text = "") {
  return activeTheme === "midnight" || /\bnight|overnight|after midnight\b/i.test(text);
}

function renderCurrent() {
  const current = weatherState.current || fallbackWeather.current;
  // Fair Weather Index using actual current conditions
  const month = new Date().getMonth();
  const fwi = FWI.calculate({
    temp:        current.temp,
    humidity:    current.humidity,
    wind:        current.wind,
    gust:        current.gust,
    cloudCover:  null,
    precipChance: null,
    month,
  });
  const alertCount = weatherState.alerts?.length || 0;

  activeTheme = chooseTheme(current);
  setLocationBrand();
  document.body.dataset.theme = activeTheme;
  document.body.dataset.condition = conditionClass(current);
  locationName.textContent = selectedLocation.name;
  document.querySelector("#current-title").textContent = current.headline;
  document.querySelector("#weatherSummary").textContent = current.summary;
  document.querySelector("#currentIcon").innerHTML = WeatherIcons.fromText(current.condition || current.summary || "Partly Cloudy", activeTheme === "midnight");
  document.querySelector("#currentTemp").textContent = f(current.temp);
  document.querySelector("#currentCondition").textContent = current.condition || "Observed conditions";
  document.querySelector("#statusBadge").textContent = alertCount ? `${alertCount} active NWS alert${alertCount > 1 ? "s" : ""}` : themePalettes[activeTheme].status;
  document.querySelector("#comfortScore").textContent = fwi.score100;
  document.querySelector(".comfort-ring").style.setProperty("--score", fwi.score100);
  document.querySelector(".comfort-ring").style.setProperty("--ring-color", fwi.color);
  document.querySelector("#comfortLabel").textContent = fwi.label;
  const comfortCondition = document.querySelector("#comfortCondition");
  if (comfortCondition) {
    comfortCondition.textContent = `${fwi.label} conditions`;
    comfortCondition.style.setProperty("--fwi-color", fwi.color);
    comfortCondition.style.setProperty("--fwi-bg", fwi.bg);
  }

  const metrics = [
    ["air", "Air Quality", current.airQuality || "Not reported", current.airQualityDetail || "Open-Meteo air quality"],
    current.pollen ? ["pollen", "Pollen", current.pollen, current.pollenDetail || "Google Pollen API"] : null,
    ["uv", "UV Index", f(current.uv), current.uv >= 6 ? "High exposure" : "Estimated daylight exposure"],
    ["dew", "Dew Point", `${f(current.dewPoint)}°`, "NWS observation"],
    ["humidity", "Relative Humidity", `${f(current.humidity)}%`, "Relative humidity"],
    ["wind", "Wind", `${f(current.wind)} mph`, `Gusts ${f(current.gust)} mph`],
  ].filter(Boolean);

  metricGrid.innerHTML = metrics.map(([icon, name, value, detail]) => `
    <article class="tile metric">
      <div class="metric-head">
        ${uiIcon(icon)}
        <p class="eyebrow">${name}</p>
      </div>
      <span>${value}</span>
      <small>${detail}</small>
    </article>
  `).join("");

  const updated = current.updated ? new Date(current.updated) : new Date();
  const updatedEl = document.querySelector("#updatedAt");
  if (updatedEl) updatedEl.textContent = `Updated ${updated.toLocaleTimeString([], { timeZone: selectedLocation.timezone || "America/New_York", hour: "numeric", minute: "2-digit" })} from NWS`;

  hourlyStrip.innerHTML = (weatherState.hourly || []).slice(0, 24).map((hour, index) => {
    const time = new Date(hour.startTime);
    const dewPoint = fahrenheit(nwsValue(hour, "dewpoint"));
    const humidity = nwsValue(hour, "relativeHumidity");
    const feels = apparentTemperature(hour.temperature, humidity, parseInt(hour.windSpeed, 10));
    const precip = hour.probabilityOfPrecipitation?.value;
    const fwi = hourFwi(hour);
    return `
      <button class="hour-card" type="button" data-hour-index="${index}">
        <strong>${index === 0 ? "Now" : time.toLocaleTimeString([], { hour: "numeric" })}</strong>
        ${weatherIcon(iconForCondition(hour.shortForecast))}
        <div class="hour-temp">${f(hour.temperature)}°</div>
        <span class="hour-fwi" style="--fwi-color:${fwi.color};--fwi-bg:${fwi.bg}">FWI ${fwi.score100} ${fwi.label}</span>
        <small>${f(precip)}% precip · feels ${f(feels)}°</small>
        <span class="mini-line">${f(dewPoint)}° dew · ${f(humidity)}% RH</span>
      </button>
    `;
  }).join("") || `<article class="hour-card"><strong>No hourly data</strong><small>NWS hourly endpoint is unavailable.</small></article>`;
}

function renderHourlyChart() {
  const wrap = document.querySelector("#hourlyChartWrap");
  if (!wrap) return;
  const hourly = (weatherState.hourly || []).slice(0, 24);
  if (!hourly.length) { wrap.innerHTML = ""; return; }

  const METRICS = {
    temperature: { unit: "°",   color: "#f97316", getValue: h => h.temperature ?? null,                         label: "°F" },
    wind:        { unit: " mph",color: "#38bdf8", getValue: h => parseInt(h.windSpeed, 10) || 0,                 label: "mph" },
    humidity:    { unit: "%",   color: "#a78bfa", getValue: h => h.relativeHumidity?.value ?? null,              label: "%" },
    precip:      { unit: "%",   color: "#60a5fa", getValue: h => h.probabilityOfPrecipitation?.value ?? null,    label: "%" },
    fwi:         { unit: "",    color: "#facc15", getValue: h => hourFwi(h).score100,                           label: "score",
                   formatValue: (v, h) => `${v} ${hourFwi(h).label}` },
  };

  const cfg  = METRICS[hourlyChartMetric] || METRICS.temperature;
  const vals = hourly.map(h => { const v = cfg.getValue(h); return v != null ? Number(v) : 0; });

  const W = 960, H = 148;
  const padL = 28, padR = 28, padT = 36, padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const rng  = maxV - minV || 1;

  const xFor = i => padL + (i / (vals.length - 1)) * plotW;
  const yFor = v => padT + plotH - ((v - minV) / rng) * plotH;

  const pts = vals.map((v, i) => [xFor(i), yFor(v)]);

  // Smooth bezier line
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const mx = (px + cx) / 2;
    d += ` C${mx.toFixed(1)},${py.toFixed(1)} ${mx.toFixed(1)},${cy.toFixed(1)} ${cx.toFixed(1)},${cy.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  const area = `${d} L${last[0].toFixed(1)},${(padT + plotH).toFixed(1)} L${pts[0][0].toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

  const gId  = `hcg_${hourlyChartMetric}`;
  const col  = cfg.color;

  // Dots + value labels (every 3rd)
  const dotsSvg = pts.map(([x, y], i) => {
    const show = hourlyChartMetric === "fwi" ? (i % 4 === 0 || i === pts.length - 1) : (i % 3 === 0 || i === pts.length - 1);
    const vStr = cfg.formatValue ? cfg.formatValue(vals[i], hourly[i]) : `${vals[i]}${cfg.unit}`;
    return `
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${show ? 4 : 2.5}"
        fill="${col}" stroke="rgba(2,6,23,0.85)" stroke-width="${show ? 2 : 1.5}"
        opacity="${show ? 1 : 0.55}" style="cursor:pointer"
        data-hour-index="${i}"><title>${safeText(vStr)}</title></circle>
      ${show ? `<text x="${x.toFixed(1)}" y="${(y - 10).toFixed(1)}" text-anchor="middle"
        fill="${col}" font-size="${hourlyChartMetric === "fwi" ? "9" : "10.5"}" font-weight="800"
        font-family="Inter,system-ui,sans-serif">${vStr}</text>` : ""}
    `;
  }).join("");

  // Time labels on x-axis (every 3rd)
  const timeSvg = hourly.map((h, i) => {
    if (i % 3 !== 0 && i !== hourly.length - 1) return "";
    const t = new Date(h.startTime);
    const lbl = i === 0 ? "Now" : t.toLocaleTimeString([], { hour: "numeric" });
    return `<text x="${xFor(i).toFixed(1)}" y="${(H - 4).toFixed(1)}" text-anchor="middle"
      fill="rgba(232,240,255,0.48)" font-size="9.5" font-weight="600"
      font-family="Inter,system-ui,sans-serif">${lbl}</text>`;
  }).join("");

  wrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" class="hourly-chart-svg">
      <defs>
        <linearGradient id="${gId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="${col}" stop-opacity="0.38"/>
          <stop offset="100%" stop-color="${col}" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#${gId})"/>
      <path d="${d}" fill="none" stroke="${col}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
      ${dotsSvg}
      ${timeSvg}
    </svg>
  `;

  // Make dots clickable to open hour detail
  wrap.querySelectorAll("circle[data-hour-index]").forEach(dot => {
    dot.addEventListener("click", () => showHourDetails(Number(dot.dataset.hourIndex)));
  });
}

function alertPriority(alert) {
  const event = (alert.event || "").toLowerCase();
  const severity = (alert.severity || "").toLowerCase();
  const tags = (alert.tags || []).join(" ").toLowerCase();
  if (event.includes("tornado warning") && tags.includes("emergency")) return 1000;
  if (event.includes("tornado warning") && (tags.includes("pds") || tags.includes("observed"))) return 900;
  if (event.includes("tornado warning")) return 800;
  if (event.includes("flash flood warning") && tags.includes("emergency")) return 760;
  if (event.includes("severe thunderstorm warning") && /destructive|extreme|emergency/.test(tags)) return 740;
  if (event.includes("severe thunderstorm warning")) return 700;
  if (event.includes("flash flood warning")) return 680;
  if (event.includes("snow squall warning")) return 650;
  if (event.includes("warning")) return 560;
  if (event.includes("watch")) return 430;
  if (severity === "extreme") return 400;
  if (severity === "severe") return 320;
  if (event.includes("advisory")) return 200;
  return 100;
}

function renderAlerts() {
  const alerts = [...(weatherState.alerts || [])].sort((a, b) => alertPriority(b) - alertPriority(a));
  weatherState.alerts = alerts;
  if (!alerts.length) {
    alertsPanel.hidden = true;
    alertsPanel.innerHTML = "";
    return;
  }
  alertsPanel.hidden = false;
  alertsPanel.innerHTML = `
    <div class="section-head alert-head">
      <div>
        <p class="eyebrow">Weather Alerts</p>
        <h3>${alerts.length} active alert${alerts.length > 1 ? "s" : ""} for ${safeText(selectedLocation.name)}</h3>
      </div>
      <span>${safeText(weatherState.alertSource || "IEM storm-based warnings")}</span>
    </div>
    <div class="alert-list">
      ${alerts.map((alert, index) => `
        <button class="tile alert-card severity-${safeText((alert.severity || "unknown").toLowerCase())}" type="button" data-alert-index="${index}">
          <div>
            <p class="eyebrow">${safeText(alert.source || "Alert")}</p>
            <h3>${safeText(alert.event)}</h3>
            <p>${safeText(alert.headline || alert.description || "Weather alert")}</p>
            ${alert.areaDesc ? `<small class="alert-area">Areas: ${safeText(alert.areaDesc)}</small>` : ""}
            <div class="alert-tags">${(alert.tags || []).slice(0, 8).map(tag => `<span>${safeText(tag)}</span>`).join("")}</div>
          </div>
          <small>Expires ${alert.expires ? new Date(alert.expires).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "--"}</small>
        </button>
      `).join("")}
    </div>
  `;
}

function alertNotificationId(alert) {
  return String(alert.id || [alert.event, alert.effective, alert.expires, alert.headline].filter(Boolean).join("|"));
}

function notificationSupported() {
  return "Notification" in window && "serviceWorker" in navigator;
}

function setNotifyButtonState() {
  if (!notifyButton || !notifyButtonText) return;
  if (!notificationSupported()) {
    notifyButton.disabled = true;
    notifyButtonText.textContent = "No Alerts";
    return;
  }
  notifyButtonText.textContent = Notification.permission === "granted" ? "Alerts On" : "Alerts";
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

async function registerPushSubscription() {
  if (!PUSH_PUBLIC_KEY || !PUSH_SUBSCRIBE_ENDPOINT) return false;
  const registration = serviceWorkerRegistration || await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(PUSH_PUBLIC_KEY),
  });
  await fetch(PUSH_SUBSCRIBE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription,
      location: selectedLocation,
    }),
  });
  return true;
}

function rememberCurrentAlerts() {
  const ids = (weatherState.alerts || []).map(alertNotificationId).filter(Boolean);
  localStorage.setItem("weatherSeenAlertIds", JSON.stringify(ids));
}

async function showAlertNotification(alert) {
  if (!notificationSupported() || Notification.permission !== "granted") return;
  const title = alert.event || "Weather Alert";
  const body = alert.headline || alert.description || `New alert for ${selectedLocation.name}`;
  const options = {
    body,
    tag: alertNotificationId(alert),
    renotify: true,
    badge: "icon.svg",
    icon: "icon.svg",
    data: { url: location.href },
  };
  const registration = serviceWorkerRegistration || await navigator.serviceWorker.ready.catch(() => null);
  if (registration?.showNotification) registration.showNotification(title, options);
  else new Notification(title, options);
}

function notifyNewWeatherAlerts() {
  if (!notificationSupported() || Notification.permission !== "granted") return;
  const alerts = weatherState.alerts || [];
  const oldIds = new Set(JSON.parse(localStorage.getItem("weatherSeenAlertIds") || "[]"));
  const currentIds = alerts.map(alertNotificationId).filter(Boolean);
  const newAlerts = alerts.filter(alert => !oldIds.has(alertNotificationId(alert)));
  localStorage.setItem("weatherSeenAlertIds", JSON.stringify(currentIds));
  newAlerts.slice(0, 3).forEach(showAlertNotification);
}

async function enableNotifications() {
  if (!notificationSupported()) {
    document.querySelector("#statusBadge").textContent = "Notifications unavailable in this browser";
    return;
  }
  const permission = await Notification.requestPermission();
  setNotifyButtonState();
  if (permission === "granted") {
    rememberCurrentAlerts();
    const pushReady = await registerPushSubscription().catch(error => {
      console.warn("Push subscription unavailable", error);
      return false;
    });
    document.querySelector("#statusBadge").textContent = pushReady
      ? "Alert push notifications enabled"
      : "Alert notifications enabled";
  } else {
    document.querySelector("#statusBadge").textContent = "Alert notifications not enabled";
  }
}

async function registerAppWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    serviceWorkerRegistration = await navigator.serviceWorker.register("sw.js");
  } catch (error) {
    console.warn("Service worker unavailable", error);
  } finally {
    setNotifyButtonState();
  }
}

function renderDaily() {
  const periods = (weatherState.daily || []).slice(0, 14);
  const days = [];
  for (let i = 0; i < periods.length; i += 2) {
    days.push({ day: periods[i], night: periods[i + 1] });
  }

  const extras = weatherState.dailyExtras || {};
  dailyGrid.innerHTML = days.slice(0, 7).map(({ day, night }, index) => {
    const precip  = day.probabilityOfPrecipitation?.value ?? night?.probabilityOfPrecipitation?.value;
    const feelsHigh = extras.apparent_temperature_max?.[index] ?? apparentTemperature(day.temperature, weatherState.current?.humidity, parseInt(day.windSpeed, 10));
    const feelsLow  = extras.apparent_temperature_min?.[index] ?? (night ? apparentTemperature(night.temperature, weatherState.current?.humidity, parseInt(night.windSpeed, 10)) : null);
    const uv = extras.uv_index_max?.[index] ?? weatherState.current?.uv;

    // Derive the month from the period name or fall back to current month
    const periodDate = day.startTime ? new Date(day.startTime) : new Date();
    const dayMonth   = periodDate.getMonth();
    const windSpeed  = parseInt(day.windSpeed, 10) || null;
    const fwi = FWI.calculate({
      temp:        day.temperature,
      humidity:    weatherState.current?.humidity,
      wind:        windSpeed,
      gust:        null,
      precipChance: precip,
      month:       dayMonth,
    });

    return `
    <button class="daily-card" type="button" data-day-index="${index}">
      <p class="eyebrow">
        ${day.name}
        <span class="fwi-badge" style="background:${fwi.bg};color:${fwi.color};border:1px solid ${fwi.color}44">${fwi.label}</span>
      </p>
      ${weatherIcon(iconForCondition(day.shortForecast))}
      <div class="daily-range">${f(day.temperature)}° / ${night ? f(night.temperature) : "--"}°</div>
      <p class="daily-summary">${day.shortForecast || "Forecast details"}</p>
      <div class="daily-chip-row">
        <span>${f(precip)}% precip</span>
        <span>Feels ${f(feelsHigh)}° / ${f(feelsLow)}°</span>
        <span>UV ${f(uv, 1)}</span>
      </div>
    </button>
  `;
  }).join("");
}

function showHourDetails(index) {
  const hour = weatherState.hourly?.[index];
  if (!hour) return;
  const time = new Date(hour.startTime);
  const dewPoint = fahrenheit(nwsValue(hour, "dewpoint"));
  const humidity = nwsValue(hour, "relativeHumidity");
  const wind = hour.windSpeed || "Not reported";
  const gust = hour.windGust || "Not reported";
  const feels = apparentTemperature(hour.temperature, humidity, parseInt(hour.windSpeed, 10));
  const fwi = hourFwi(hour);
  openDetails("Hourly Forecast", time.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }), [
    ["Condition", hour.shortForecast || "Not reported"],
    ["Fair Weather Index", `${fwi.score100} (${fwi.label})`],
    ["Temperature", `${f(hour.temperature)}°F, feels like ${f(feels)}°F`],
    ["Dew Point", `${f(dewPoint)}°F`],
    ["Humidity", `${f(humidity)}%`],
    ["Wind", `${hour.windDirection || ""} ${wind}`.trim()],
    ["Gusts", gust],
    ["Precipitation Chance", `${f(hour.probabilityOfPrecipitation?.value)}%`],
  ], hour.detailedForecast || "");
}

function showDailyDetails(index) {
  const periods = (weatherState.daily || []).slice(0, 14);
  const day = periods[index * 2];
  const night = periods[index * 2 + 1];
  if (!day) return;
  const extras = weatherState.dailyExtras || {};
  const precip = day.probabilityOfPrecipitation?.value ?? night?.probabilityOfPrecipitation?.value;
  const feelsHigh = extras.apparent_temperature_max?.[index] ?? apparentTemperature(day.temperature, weatherState.current?.humidity, parseInt(day.windSpeed, 10));
  const feelsLow = extras.apparent_temperature_min?.[index] ?? (night ? apparentTemperature(night.temperature, weatherState.current?.humidity, parseInt(night.windSpeed, 10)) : null);
  const uv = extras.uv_index_max?.[index] ?? weatherState.current?.uv;
  openDetails("Daily Forecast", day.name || "Forecast", [
    ["High / Low", `${f(day.temperature)}°F / ${night ? f(night.temperature) : "--"}°F`],
    ["Feels Like", `${f(feelsHigh)}°F / ${f(feelsLow)}°F`],
    ["Precipitation Chance", `${f(precip)}%`],
    ["UV Index", f(uv, 1)],
    ["Day Wind", `${day.windDirection || ""} ${day.windSpeed || "not reported"}`.trim()],
    ["Night Wind", night ? `${night.windDirection || ""} ${night.windSpeed || "not reported"}`.trim() : "Not reported"],
    ["Night", night?.shortForecast || "Not reported"],
    ["Sunrise", weatherState.astronomy?.sunrise || "--"],
    ["Sunset", weatherState.astronomy?.sunset || "--"],
  ], day.detailedForecast || day.shortForecast || "");
}

function parseAlertSections(text = "") {
  const sections = {};
  const lines = String(text || "").split(/\r?\n/);
  let current = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const header = line.match(/^\*\s*(WHAT|WHERE|WHEN|IMPACTS|ADDITIONAL DETAILS|PRECAUTIONARY\/PREPAREDNESS ACTIONS)\s*\.\.\.(.*)$/i);
    if (header) {
      current = header[1].toUpperCase();
      sections[current] = header[2]?.trim() || "";
      continue;
    }
    if (current && line) sections[current] = `${sections[current]} ${line}`.trim();
  }
  if (!sections.WHAT) {
    const meaningful = lines.map(line => line.trim()).filter(line => line && !/^\.\.\.[A-Z]/.test(line)).slice(0, 3);
    if (meaningful.length) sections.WHAT = meaningful.join(" ").replace(/\s{2,}/g, " ");
  }
  return sections;
}

function alertAdvice(alert) {
  const event = (alert.event || "").toLowerCase();
  if (event.includes("tornado warning")) return "Take shelter now in a lowest-floor interior room, away from windows.";
  if (event.includes("severe thunderstorm warning")) return "Move indoors to a sturdy building and stay away from windows.";
  if (event.includes("flash flood warning")) return "Move to higher ground and never drive through flooded roads.";
  if (event.includes("snow squall warning")) return "Delay travel if possible; visibility can collapse within seconds.";
  if (event.includes("warning")) return "Read the full alert and be ready to act quickly.";
  if (event.includes("watch")) return "Review your shelter plan and monitor updates closely.";
  return "Stay weather-aware and follow local emergency guidance.";
}

function showAlertDetails(index) {
  const alert = weatherState.alerts?.[index];
  if (!alert) return;
  const sections = parseAlertSections(alert.description);
  const hazardRows = [
    severeDetectionTag(alert) && ["Detection", severeDetectionTag(alert)],
    alert.iem_windtag && ["Max Wind", formatWindTag(alert.iem_windtag)],
    alert.iem_hailtag && ["Max Hail", formatHailTag(alert.iem_hailtag)],
    alert.iem_damagetag && ["Damage Threat", alert.iem_damagetag],
    alert.iem_tornadotag && ["Tornado Tag", alert.iem_tornadotag],
    alert.iem_floodtag && ["Flood Tag", alert.iem_floodtag],
  ].filter(Boolean);
  const sectionRows = Object.entries(sections).map(([key, value]) => [key.replace("ADDITIONAL DETAILS", "Details"), value]);
  openDetails("Weather Alert", alert.event || "Alert", [
    ["Headline", alert.headline || "Not reported"],
    ["Source", alert.source || weatherState.alertSource || "NWS"],
    ["Severity", alert.severity || "Unknown"],
    ["Areas", alert.areaDesc || selectedLocation.name],
    ["Effective", alert.effective ? new Date(alert.effective).toLocaleString() : "--"],
    ["Expires", alert.expires ? new Date(alert.expires).toLocaleString() : "--"],
    ["Tags", (alert.tags || []).join(", ") || "None"],
    ...hazardRows,
    ...sectionRows,
    ["What To Do", alert.instruction || alertAdvice(alert)],
  ], sections.WHAT || alert.headline || "");
}

function renderMetar(aviation) {
  const current = weatherState.current || fallbackWeather.current;
  const summary = aviation
    ? `${aviation.textDescription || current.condition || "Observed conditions"} from the nearest NWS station.`
    : "Nearest aviation observation unavailable from NWS.";
  document.querySelector(".metar-card .eyebrow").textContent = aviation?.station || "Nearest NWS Aviation Weather";
  document.querySelector("#flightRule").textContent = aviation?.flightRule || "UNK";
  document.querySelector("#metarRaw").textContent = summary;
  const decoded = [
    ["Station", aviation?.station || "Nearest NWS aviation station"],
    ["Observation", aviation?.reportTime || current.updated || "--"],
    ["Wind", `${f(aviation?.windDirection)}° at ${f(aviation?.windKt)} kt / ${f(aviation?.windMph)} mph${aviation?.gustKt ? `, gusting ${aviation.gustKt} kt` : ""}`],
    ["Visibility", aviation?.visibility == null ? "--" : `${f(aviation.visibility, 1)} statute miles`],
    ["Ceiling", aviation?.ceiling == null ? "No ceiling reported" : `${f(aviation.ceiling)} ft`],
    ["Temperature", `${f(aviation?.temp)}° / dew point ${f(aviation?.dewPoint)}°`],
    ["Sky", aviation?.sky?.join(", ") || "Not reported"],
    ["Altimeter", `${f(aviation?.pressure ?? current.pressure, 2)} inHg`],
    ["Source", "NWS api.weather.gov station observation"],
  ];
  document.querySelector("#metarDecoded").innerHTML = decoded.map(([term, desc]) => `<div><dt>${term}</dt><dd>${desc}</dd></div>`).join("");
}

function renderSpace(space) {
  const values = [
    ["Kp Index", space?.kp ?? "--"],
    ["NOAA G-Scale", space?.gScale || "G0"],
    ["Solar Wind", space?.solarWind ? `${space.solarWind} km/s` : "--"],
    ["Bz Field", space?.bz ? `${space.bz} nT` : "--"],
  ];
  document.querySelector("#spaceReadouts").innerHTML = values.map(([label, value]) => `
    <div class="space-item">
      <p class="eyebrow">${label}</p>
      <span class="space-value">${value}</span>
    </div>
  `).join("");
  const kp = Number(space?.kp || 0);
  document.querySelector(".aurora-bar span").style.width = `${Math.min(100, Math.max(8, kp * 12))}%`;
}

async function renderClimate(date) {
  if (!date) return;
  histSelectedDate = date;
  renderHistCalendar();
  const result = document.querySelector("#climateResult");
  if (!result) return;
  result.innerHTML = `<div class="climate-message climate-loading"><p class="eyebrow">Loading</p><strong>Open-Meteo ERA5 archive...</strong></div>`;
  try {
    const { d, h } = await climatePayload(date);
    const i = 0;
    const highTemp = d.temperature_2m_max?.[i];
    const lowTemp = d.temperature_2m_min?.[i];
    const feelsHigh = d.apparent_temperature_max?.[i];
    const feelsLow = d.apparent_temperature_min?.[i];
    const precip = d.precipitation_sum?.[i];
    const rain = d.rain_sum?.[i];
    const snow = d.snowfall_sum?.[i];
    const windMax = d.wind_speed_10m_max?.[i];
    const windGust = d.wind_gusts_10m_max?.[i];
    const windDir = d.wind_direction_10m_dominant?.[i];
    const cloud = d.cloud_cover_mean?.[i];
    const pressure = d.pressure_msl_mean?.[i];
    const humidity = d.relative_humidity_2m_mean?.[i];
    const dew = d.dew_point_2m_mean?.[i];
    const sunshine = d.sunshine_duration?.[i];
    const uv = d.uv_index_max?.[i];
    const sunriseStr = d.sunrise?.[i];
    const sunsetStr = d.sunset?.[i];
    const condition = wmoDescription(d.weather_code?.[i]);
    const average = highTemp != null && lowTemp != null ? Math.round((highTemp + lowTemp) / 2) : null;
    const fmtTime = iso => {
      if (!iso) return "--";
      try { return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
      catch { return "--"; }
    };
    const precipDetail = (() => {
      const parts = [];
      if (rain != null && rain > 0) parts.push(`Rain: ${rain.toFixed(2)}"`);
      if (snow != null && snow > 0) parts.push(`Snow: ${snow.toFixed(1)}"`);
      return parts.length ? parts.join(" · ") : "No precipitation";
    })();
    let hourlyHtml = "";
    if (h?.time) {
      h.time.forEach((t, idx) => {
        if (!t.startsWith(date)) return;
        const hr = parseInt(t.slice(11, 13), 10);
        const label = hr === 0 ? "12 AM" : hr < 12 ? `${hr} AM` : hr === 12 ? "12 PM" : `${hr - 12} PM`;
        const temp = h.temperature_2m?.[idx];
        const pr = h.precipitation?.[idx];
        const ws = h.wind_speed_10m?.[idx];
        const cond = wmoDescription(h.weather_code?.[idx]);
        hourlyHtml += `
          <div class="hist-hourly-item">
            <div class="hist-hourly-time">${label}</div>
            <div class="hist-hourly-temp">${temp != null ? Math.round(temp) + "°" : "--"}</div>
            <div class="hist-hourly-cond">${safeText(cond)}</div>
            <div class="hist-hourly-wind">${ws != null ? Math.round(ws) + " mph" : "--"}</div>
            ${pr != null && pr > 0 ? `<div class="hist-hourly-precip">${pr.toFixed(2)}"</div>` : ""}
          </div>`;
      });
    }
    const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    const stats = [
      ["Peak Wind", windMax != null ? `${Math.round(windMax)} mph` : "--", windGust != null ? `${Math.round(windGust)} mph gusts · ${windDirLabel(windDir)}` : "--"],
      ["Avg Humidity", humidity != null ? `${Math.round(humidity)}%` : "--", `Dew point: ${dew != null ? Math.round(dew) + "°F" : "--"}`],
      ["Peak UV", uv != null ? uv.toFixed(1) : "--", uvRiskLabel(uv)],
      ["Avg Pressure", pressure != null ? (pressure * 0.02953).toFixed(2) + " inHg" : "--", pressure != null ? Math.round(pressure) + " hPa" : "--"],
      ["Cloud Cover", cloud != null ? `${Math.round(cloud)}%` : "--", cloudCoverLabel(cloud)],
      ["Precipitation", precip != null ? precip.toFixed(2) + '"' : '0.00"', precipDetail],
      ...(snow != null && snow > 0 ? [["Snowfall", snow.toFixed(1) + '"', "Snow total"]] : []),
      ["Sunshine", sunshineHours(sunshine), "Duration of sunshine"],
      ["Sun Times", fmtTime(sunriseStr), `Sunrise · Sunset ${fmtTime(sunsetStr)}`],
      ["Degree Days", average != null ? `HDD ${Math.max(0, 65 - average)}` : "--", average != null ? `CDD ${Math.max(0, average - 65)}` : "--"],
    ];
    result.innerHTML = `
      <div class="hist-hero tile">
        <div class="hist-hero-left">
          <p class="eyebrow">${safeText(dateLabel)}</p>
          <div class="hist-temp-range">
            <span class="hist-temp-hi">${highTemp != null ? Math.round(highTemp) + "°" : "--"}</span>
            <span class="hist-temp-sep"> / </span>
            <span class="hist-temp-lo">${lowTemp != null ? Math.round(lowTemp) + "°" : "--"}</span>
            <sup>°F</sup>
          </div>
          <p>${safeText(condition)}</p>
          <p class="hist-feels">Feels like ${feelsHigh != null ? Math.round(feelsHigh) + "°" : "--"} high / ${feelsLow != null ? Math.round(feelsLow) + "°" : "--"} low</p>
        </div>
      </div>
      ${hourlyHtml ? `
      <div class="tile hist-hourly-panel">
        <div class="section-head"><p class="eyebrow">Hourly Breakdown</p></div>
        <div class="hist-hourly-strip">${hourlyHtml}</div>
      </div>` : ""}
      <div class="hist-stats-grid">
        ${stats.map(([label, value, detail]) => `
          <div class="hist-stat-card tile">
            <p class="eyebrow">${safeText(label)}</p>
            <strong>${safeText(value)}</strong>
            <small>${safeText(detail)}</small>
          </div>
        `).join("")}
      </div>
    `;
  } catch (error) {
    result.innerHTML = `<div class="climate-message" style="color:#f87171;">${safeText(error.message)}</div>`;
  }
}

function renderHistCalendar() {
  const container = document.querySelector("#hist-calendar");
  if (!container) return;
  const maxD = histMaxDate();
  const maxYear = maxD.getFullYear();
  const maxMonth = maxD.getMonth();
  if (histCalYear === null) { histCalYear = maxYear; histCalMonth = maxMonth; }
  if (histCalYear < HIST_MIN_YEAR) { histCalYear = HIST_MIN_YEAR; histCalMonth = 0; }
  if (histCalYear > maxYear || (histCalYear === maxYear && histCalMonth > maxMonth)) {
    histCalYear = maxYear; histCalMonth = maxMonth;
  }
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const prevDisabled = histCalYear === HIST_MIN_YEAR && histCalMonth === 0;
  const nextDisabled = histCalYear === maxYear && histCalMonth === maxMonth;
  const firstDay = new Date(histCalYear, histCalMonth, 1).getDay();
  const daysInMonth = new Date(histCalYear, histCalMonth + 1, 0).getDate();
  let yearOpts = "";
  for (let y = maxYear; y >= HIST_MIN_YEAR; y--) {
    yearOpts += `<option value="${y}"${y === histCalYear ? " selected" : ""}>${y}</option>`;
  }
  const monthOpts = MONTHS.map((n, idx) =>
    `<option value="${idx}"${idx === histCalMonth ? " selected" : ""}>${n}</option>`).join("");
  let daysHtml = ["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => `<div class="hist-dow">${d}</div>`).join("");
  for (let i = 0; i < firstDay; i++) daysHtml += `<div class="hist-day"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${histCalYear}-${String(histCalMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isDisabled = new Date(histCalYear, histCalMonth, d) > maxD;
    const isSelected = ds === histSelectedDate;
    if (isDisabled) {
      daysHtml += `<div class="hist-day disabled">${d}</div>`;
    } else {
      daysHtml += `<button type="button" class="hist-day${isSelected ? " selected" : ""}" data-hist-date="${ds}">${d}</button>`;
    }
  }
  container.innerHTML = `
    <div class="hist-cal-nav">
      <button type="button" class="hist-cal-btn" id="histPrevMonth"${prevDisabled ? " disabled" : ""}>&#8249;</button>
      <div class="hist-cal-title">
        <select class="hist-select" id="histMonthSelect">${monthOpts}</select>
        <select class="hist-select" id="histYearSelect">${yearOpts}</select>
      </div>
      <button type="button" class="hist-cal-btn" id="histNextMonth"${nextDisabled ? " disabled" : ""}>&#8250;</button>
    </div>
    <div class="hist-cal-grid">${daysHtml}</div>
    <p class="hist-cal-note">Archive data: ${HIST_MIN_YEAR} – ${MONTHS[maxD.getMonth()]} ${maxD.getDate()}, ${maxD.getFullYear()}</p>
  `;
  container.querySelector("#histPrevMonth")?.addEventListener("click", () => {
    if (histCalMonth === 0) { histCalYear--; histCalMonth = 11; } else histCalMonth--;
    renderHistCalendar();
  });
  container.querySelector("#histNextMonth")?.addEventListener("click", () => {
    const mx = histMaxDate();
    if (histCalYear === mx.getFullYear() && histCalMonth === mx.getMonth()) return;
    if (histCalMonth === 11) { histCalYear++; histCalMonth = 0; } else histCalMonth++;
    renderHistCalendar();
  });
  container.querySelector("#histMonthSelect")?.addEventListener("change", e => {
    histCalMonth = Number(e.target.value);
    const mx = histMaxDate();
    if (histCalYear === mx.getFullYear() && histCalMonth > mx.getMonth()) histCalMonth = mx.getMonth();
    renderHistCalendar();
  });
  container.querySelector("#histYearSelect")?.addEventListener("change", e => {
    histCalYear = Number(e.target.value);
    const mx = histMaxDate();
    if (histCalYear === mx.getFullYear() && histCalMonth > mx.getMonth()) histCalMonth = mx.getMonth();
    renderHistCalendar();
  });
  container.querySelectorAll(".hist-day[data-hist-date]").forEach(btn => {
    btn.addEventListener("click", () => renderClimate(btn.dataset.histDate));
  });
}

function initHistoricalCalendar() {
  const maxD = histMaxDate();
  histCalYear = maxD.getFullYear();
  histCalMonth = maxD.getMonth();
  histSelectedDate = null;
  const result = document.querySelector("#climateResult");
  if (result) result.innerHTML = `<div class="climate-message">Select a date on the calendar to view historical weather observations.</div>`;
  const nameEl = document.querySelector("#hist-location-name");
  if (nameEl) nameEl.textContent = selectedLocation.name;
  renderHistCalendar();
}

function drawAtmosphere() {
  const palette = themePalettes[activeTheme] || themePalettes.sunny;
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const grad = ctx.createLinearGradient(0, 0, width, height);
  palette.gradient.forEach((color, index) => grad.addColorStop(index / (palette.gradient.length - 1), color));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i < 58; i++) {
    const x = (Math.sin(frame * 0.004 + i * 12.7) * 0.5 + 0.5) * width;
    const y = (Math.cos(frame * 0.003 + i * 5.4) * 0.5 + 0.5) * height;
    const radius = 1.2 + (i % 6);
    ctx.beginPath();
    ctx.fillStyle = i % 3 ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.38)";
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const condition = document.body.dataset.condition || "clear";
  if (condition === "rain" || condition === "drizzle" || activeTheme === "storm") {
    ctx.strokeStyle = condition === "drizzle" ? "rgba(191, 219, 254, 0.22)" : "rgba(125, 211, 252, 0.34)";
    ctx.lineWidth = condition === "drizzle" ? 1 : 1.6;
    for (let i = 0; i < 72; i++) {
      const x = ((i * 73 + frame * 5.2) % (width + 120)) - 60;
      const y = (i * 47 + frame * 8.5) % (height + 120);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 18, y + 42);
      ctx.stroke();
    }
  }

  if (condition === "cloudy" || condition === "fog" || condition === "partly") {
    for (let i = 0; i < 7; i++) {
      const x = ((frame * (0.22 + i * 0.03) + i * width * 0.21) % (width + 260)) - 130;
      const y = height * (0.18 + (i % 4) * 0.12);
      const radius = 90 + (i % 3) * 35;
      const cloud = ctx.createRadialGradient(x, y, 0, x, y, radius);
      cloud.addColorStop(0, condition === "fog" ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.12)");
      cloud.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = cloud;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (activeTheme === "storm" && frame % 180 < 18) {
    ctx.strokeStyle = "rgba(125, 249, 255, 0.8)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(width * 0.72, 0);
    ctx.lineTo(width * 0.66, height * 0.26);
    ctx.lineTo(width * 0.71, height * 0.26);
    ctx.lineTo(width * 0.59, height * 0.58);
    ctx.stroke();
  }
  frame += 1;
  requestAnimationFrame(drawAtmosphere);
}

function radarLayerForLocation(location = selectedLocation) {
  const { lat, lon } = location;
  if (lat >= 49 && lon <= -126) return "alaska_base_reflectivity_mosaic";
  if (lat >= 14 && lat <= 27 && lon >= -165 && lon <= -150) return "hawaii_base_reflectivity_mosaic";
  if (lat >= 8 && lat <= 26 && lon >= -91 && lon <= -58) return "caribbean_base_reflectivity_mosaic";
  if (lat >= 8 && lat <= 19 && lon >= 139 && lon <= 151) return "guam_base_reflectivity_mosaic";
  return "conus_base_reflectivity_mosaic";
}

function radarFrameTimes() {
  const now = Date.now();
  const rounded = now - (now % (4 * 60 * 1000));
  radarFrames = Array.from({ length: 9 }, (_, i) => new Date(rounded - (8 - i) * 4 * 60 * 1000));
  return radarFrames;
}


function stopRadarAnimation() {
  if (radarAnimationTimer) clearInterval(radarAnimationTimer);
  radarAnimationTimer = null;
  const btn = document.querySelector("#radarPlayButton");
  if (btn) { document.querySelector("#playLabel").textContent = "Play"; }
}

function renderMapSidebar() {
  const sidebar = document.querySelector("#mapSidebar");
  if (!sidebar) return;
  const current = weatherState.current || fallbackWeather.current;
  const fwi = FWI.calculate({
    temp: current.temp, humidity: current.humidity,
    wind: current.wind, gust: current.gust,
    month: new Date().getMonth(),
  });
  const astronomy = weatherState.astronomy;
  const alerts = weatherState.alerts || [];

  sidebar.innerHTML = `
    <div class="sidebar-tile">
      <p class="eyebrow">📍 ${safeText(selectedLocation.name)}</p>
      <h3>${f(current.temp)}°F — ${safeText(current.condition || "Conditions")}</h3>
      <div class="sidebar-chip-row">
        <div class="sidebar-chip">
          <span class="sidebar-chip-label">Feels</span>
          <span class="sidebar-chip-val">${f(current.temp)}°</span>
        </div>
        <div class="sidebar-chip">
          <span class="sidebar-chip-label">Wind</span>
          <span class="sidebar-chip-val">${f(current.wind)} mph</span>
        </div>
        <div class="sidebar-chip">
          <span class="sidebar-chip-label">Humidity</span>
          <span class="sidebar-chip-val">${f(current.humidity)}%</span>
        </div>
      </div>
    </div>

    <div class="sidebar-tile">
      <p class="eyebrow">⚡ SPC Day 1 Outlook</p>
      <h3>${safeText(mapState.spcRisk || "No categorical risk")}</h3>
      <div class="sidebar-chip-row">
        <div class="sidebar-chip spc-torn">
          <span class="sidebar-chip-label">Tornado</span>
          <span class="sidebar-chip-val" style="color:#f87171">${safeText(mapState.spcTorn || "0%")}</span>
        </div>
        <div class="sidebar-chip spc-wind">
          <span class="sidebar-chip-label">Wind</span>
          <span class="sidebar-chip-val" style="color:#fb923c">${safeText(mapState.spcWind || "0%")}</span>
        </div>
        <div class="sidebar-chip spc-hail">
          <span class="sidebar-chip-label">Hail</span>
          <span class="sidebar-chip-val" style="color:#4ade80">${safeText(mapState.spcHail || "0%")}</span>
        </div>
      </div>
    </div>

    <div class="sidebar-tile">
      <p class="eyebrow">🌤 Fair Weather Index</p>
      <h3 style="color:${fwi.color}">${fwi.label} (${fwi.score100}/100)</h3>
      <p>${fwiNote(fwi.score100)}</p>
    </div>

    ${alerts.length ? `
    <div class="sidebar-tile">
      <p class="eyebrow">⚠️ ${alerts.length} Active Alert${alerts.length > 1 ? "s" : ""}</p>
      ${alerts.slice(0, 2).map(a => `<h3 style="margin-bottom:4px;font-size:0.9rem;">${safeText(a.event)}</h3>`).join("")}
      ${alerts.length > 2 ? `<small style="color:var(--muted)">+${alerts.length - 2} more alerts</small>` : ""}
    </div>` : ""}

    <div class="sidebar-tile">
      <p class="eyebrow">🌡 Observation</p>
      <h3>${f(current.temp)}° / Dew ${f(current.dewPoint)}°</h3>
      <p style="font-size:0.8rem;color:var(--muted)">
        ${astronomy ? `☀️ ${astronomy.sunrise} — 🌙 ${astronomy.sunset}` : "Sun times loading…"}
      </p>
    </div>

    <div class="sidebar-tile">
      <p class="eyebrow">🏜 Drought Monitor</p>
      <h3>${safeText(mapState.drought || "No active drought")}</h3>
      <p>USDM classification for this area.</p>
    </div>
  `;
}

function radarTileUrl(time) {
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    FORMAT: "image/png",
    TRANSPARENT: "true",
    CRS: "EPSG:3857",
    WIDTH: "256",
    HEIGHT: "256",
    STYLES: "weather_radar_base_reflectivity",
    LAYERS: radarLayerForLocation(),
    TIME: time.toISOString(),
  });
  return `${NOAA_RADAR_WMS}?${params.toString()}&BBOX={bbox-epsg-3857}`;
}

function updateRadarLabel() {
  const labelEl = document.querySelector("#radarTimeLabel");
  if (!labelEl) return;
  const frame = radarFrames[radarFrameIndex];
  labelEl.textContent = frame instanceof Date
    ? frame.toLocaleTimeString("en-US", { timeZone: selectedLocation.timezone || "America/New_York", hour: "numeric", minute: "2-digit" })
    : "Latest";
  const slider = document.querySelector("#radarTimeline");
  if (slider) slider.value = String(radarFrameIndex);
}

function setRadarFrame(index) {
  radarFrameIndex = Math.max(0, Math.min(radarFrames.length - 1, Number(index)));
  if (radarMap && mapLoaded && ["Radar", "Alerts", "LSR"].includes(activeLayer)) {
    removeMapLayer("radar-layer");
    removeMapSource("radar-source");
    addRadarLayer();
  }
  updateRadarLabel();
}

function setRainfallOpacity(pct) {
  radarOpacity = pct / 100;
  if (radarMap && mapLoaded) {
    if (radarMap.getLayer("radar-layer"))    radarMap.setPaintProperty("radar-layer",    "raster-opacity", radarOpacity);
  }
  const label = document.querySelector("#radarOpacityLabel");
  if (label) label.textContent = `${pct}%`;
}

function removeMapLayer(id) {
  if (radarMap?.getLayer(id)) radarMap.removeLayer(id);
}

function removeMapSource(id) {
  if (radarMap?.getSource(id)) radarMap.removeSource(id);
}

function clearWeatherLayers() {
  stopRadarAnimation();
  // Remove all overlay layers
  ["radar-layer",
   "spc-fill", "spc-line",
   "drought-fill", "drought-line",
   "alerts-fill", "alerts-line",
   "fire-fill", "fire-line",
   "wpc-rain-layer",
   "surface-layer",
  ].forEach(removeMapLayer);
  // Remove all overlay sources
  ["radar-source",
   "spc-source",
   "drought-source",
   "alerts-source",
   "fire-source",
   "wpc-rain-source",
   "surface-source",
  ].forEach(removeMapSource);
  // Remove LSR markers
  document.querySelectorAll(".lsr-marker-wrap").forEach(el => el.remove());
  // Hide SPC legend when clearing
  const leg = document.querySelector("#spcLegendBox");
  if (leg) leg.hidden = true;
}

function renderBasemapButtons() {
  const container = document.querySelector("#basemapBtns");
  if (!container) return;
  container.innerHTML = BASEMAP_STYLES.map(s =>
    `<button type="button" data-basemap="${s.id}" class="${s.id === activeBasemap ? "active" : ""}">${s.label}</button>`
  ).join("");
  container.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      activeBasemap = btn.dataset.basemap;
      container.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
      if (radarMap) {
        radarMap.setStyle(`mapbox://styles/mapbox/${activeBasemap}`);
        radarMap.once("style.load", () => {
          mapLoaded = true;
          drawRadar();
        });
      }
    });
  });
}

function initMap() {
  if (radarMap || !window.mapboxgl) return;
  mapboxgl.accessToken = MAPBOX_TOKEN;
  radarMap = new mapboxgl.Map({
    container: "radarMap",
    style: `mapbox://styles/mapbox/${activeBasemap}`,
    center: [selectedLocation.lon, selectedLocation.lat],
    zoom: 8,
  });
  radarMap.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");
  radarMap.addControl(new mapboxgl.ScaleControl({ unit: "imperial" }), "bottom-right");
  // Blue circle for selected location (like a standard "you are here" dot)
  const markerEl = document.createElement("div");
  markerEl.className = "location-blue-dot";
  mapMarker = new mapboxgl.Marker({ element: markerEl, anchor: "center" })
    .setLngLat([selectedLocation.lon, selectedLocation.lat])
    .setPopup(new mapboxgl.Popup({ offset: 14 }).setHTML(buildLocationPopup(selectedLocation.name)))
    .addTo(radarMap);
  radarMap.on("load", () => {
    mapLoaded = true;
    drawRadar();
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        updateUserLocationMarker(pos.coords.latitude, pos.coords.longitude);
      }, () => {}, { timeout: 5000, maximumAge: 120000 });
    }
  });
  updateRadarLabel();
  document.querySelector("#mapLocateBtn")?.addEventListener("click", locateOnMap);
}

function addRadarLayer() {
  radarFrames = radarFrameTimes();
  radarFrameIndex = Math.min(radarFrameIndex, radarFrames.length - 1);
  const slider = document.querySelector("#radarTimeline");
  if (slider) { slider.max = radarFrames.length - 1; slider.value = radarFrameIndex; }

  radarMap.addSource("radar-source", {
    type: "raster",
    tiles: [radarTileUrl(radarFrames[radarFrameIndex])],
    tileSize: 256,
    attribution: "NOAA nowCOAST / NWS MRMS",
  });
  radarMap.addLayer({
    id: "radar-layer", type: "raster", source: "radar-source",
    paint: { "raster-opacity": radarOpacity, "raster-fade-duration": 220 },
  });
  updateRadarLabel();
}

async function addSpcLayer() {
  if (activeLayer !== "SPC" || !radarMap || !mapLoaded) return;
  const type = activeSpcType; // cat | torn | wind | hail
  const day  = activeSpcDay;  // 1 | 2 | 3
  const cacheKey = `${day}_${type}`;
  const urlList  = SPC_URLS[type];
  if (!urlList || !urlList[day - 1]) return;

  if (!spcLayerData[cacheKey]) {
    spcLayerData[cacheKey] = normalizeSpcData(await fetchOutlookGeoJson(urlList[day - 1]));
  }
  const data = spcLayerData[cacheKey];

  radarMap.addSource("spc-source", { type: "geojson", data });
  const isCat = type === "cat";

  radarMap.addLayer({
    id: "spc-fill",
    type: "fill",
    source: "spc-source",
    paint: {
      "fill-color": isCat
        ? ["match", ["upcase", ["coalesce", ["get", "LABEL"], ""]],
          "TSTM", "#c0e8c0", "MRGL", "#66cc66", "SLGT", "#ffe066", "ENH", "#ffa040", "MDT", "#ff6060", "HIGH", "#ff40ff", "rgba(0,0,0,0)"]
        : ["step", ["coalesce", ["get", "RISK_NUM"], 0],
          "rgba(0,0,0,0)", 2, "#50b450", 5, "#64c83c", 10, "#ffdc00", 15, "#ff8c00", 30, "#dc1e1e", 45, "#a000c8", 60, "#6400b4"],
      "fill-opacity": 0.46,
    },
  });
  radarMap.addLayer({
    id: "spc-line",
    type: "line",
    source: "spc-source",
    paint: {
      "line-color": isCat
        ? ["match", ["upcase", ["coalesce", ["get", "LABEL"], ""]],
          "TSTM", "#96d896", "MRGL", "#44bb44", "SLGT", "#ddbb00", "ENH", "#cc7700", "MDT", "#cc2222", "HIGH", "#cc00cc", "rgba(0,0,0,0)"]
        : ["step", ["coalesce", ["get", "RISK_NUM"], 0],
          "rgba(0,0,0,0)", 2, "#339933", 5, "#55aa00", 10, "#ccaa00", 15, "#cc7000", 30, "#bb1111", 45, "#8800aa", 60, "#6600bb"],
      "line-width": 1.4,
    },
  });

  if (!popupWiredLayers.has("spc")) {
    radarMap.on("click", "spc-fill", ev => {
      const f = ev.features?.[0];
      if (!f) return;
      const typeLabel = activeSpcType === "cat" ? "Categorical" : activeSpcType.charAt(0).toUpperCase() + activeSpcType.slice(1);
      const risk = spcPopupLabel(f.properties || {});
      new mapboxgl.Popup({ offset: 8 })
        .setLngLat(ev.lngLat)
        .setHTML(`
          <div class="popup-header">
            <div class="popup-icon popup-spc" style="background:rgba(250,204,21,0.15);border:1px solid rgba(250,204,21,0.35);">⚡</div>
            <div>
              <div class="popup-title">SPC Day ${activeSpcDay} Outlook</div>
              <div class="popup-subtitle">${safeText(typeLabel)}</div>
            </div>
          </div>
          <div class="popup-stat">
            <span class="popup-key">Risk Level</span>
            <span class="popup-val">${safeText(risk)}</span>
          </div>
          <div class="popup-note">Storm Prediction Center — NOAA</div>
        `)
        .addTo(radarMap);
    });
    radarMap.on("mouseenter", "spc-fill", () => { radarMap.getCanvas().style.cursor = "pointer"; });
    radarMap.on("mouseleave", "spc-fill", () => { radarMap.getCanvas().style.cursor = ""; });
    popupWiredLayers.add("spc");
  }

  renderSpcLegend();
}

async function addFireWeatherLayer() {
  if (activeLayer !== "Fire Wx" || !radarMap || !mapLoaded) return;
  if (!fireWeatherData) {
    fireWeatherData = normalizeSpcData(await fetchOutlookGeoJson(FIRE_WX_URLS[0]));
  }
  radarMap.addSource("fire-source", { type: "geojson", data: fireWeatherData });
  radarMap.addLayer({
    id: "fire-fill", type: "fill", source: "fire-source",
    paint: {
      "fill-color": ["match", ["upcase", ["coalesce", ["get", "LABEL"], ""]],
        "ELEVATED", "#fbbf24", "CRITICAL", "#f97316", "EXTREME CRITICAL", "#ef4444", "rgba(0,0,0,0)"],
      "fill-opacity": 0.44,
    },
  });
  radarMap.addLayer({
    id: "fire-line", type: "line", source: "fire-source",
    paint: {
      "line-color": ["match", ["upcase", ["coalesce", ["get", "LABEL"], ""]],
        "ELEVATED", "#d97706", "CRITICAL", "#ea580c", "EXTREME CRITICAL", "#b91c1c", "rgba(0,0,0,0)"],
      "line-width": 1.5,
    },
  });

  if (!popupWiredLayers.has("fire")) {
    radarMap.on("click", "fire-fill", ev => {
      const f = ev.features?.[0];
      if (!f) return;
      const label = f.properties?.LABEL || "Fire Weather Area";
      new mapboxgl.Popup({ offset: 8 })
        .setLngLat(ev.lngLat)
        .setHTML(`
          <div class="popup-header">
            <div class="popup-icon popup-fire" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.35);">🔥</div>
            <div>
              <div class="popup-title">SPC Fire Weather Outlook</div>
              <div class="popup-subtitle">Day 1 Forecast</div>
            </div>
          </div>
          <div class="popup-stat"><span class="popup-key">Risk Level</span><span class="popup-val">${safeText(label)}</span></div>
          <div class="popup-note">Elevated fire weather conditions. Monitor local alerts and fire restrictions.</div>
        `)
        .addTo(radarMap);
    });
    radarMap.on("mouseenter", "fire-fill", () => { radarMap.getCanvas().style.cursor = "pointer"; });
    radarMap.on("mouseleave", "fire-fill", () => { radarMap.getCanvas().style.cursor = ""; });
    popupWiredLayers.add("fire");
  }
}

async function addWpcRainfallLayer() {
  if (activeLayer !== "WPC Rain" || !radarMap || !mapLoaded) return;
  // WPC Day 1 QPF as a WMS raster overlay from NOAA nowCOAST
  const params = [
    "SERVICE=WMS", "VERSION=1.3.0", "REQUEST=GetMap",
    "FORMAT=image%2Fpng", "TRANSPARENT=true",
    "LAYERS=day1_qpf_amount",
    "CRS=EPSG%3A3857", "WIDTH=256", "HEIGHT=256",
    "STYLES=",
  ].join("&");

  radarMap.addSource("wpc-rain-source", {
    type: "raster",
    tiles: [`${WPC_QPF_WMS}?${params}&BBOX={bbox-epsg-3857}`],
    tileSize: 256,
    attribution: "NOAA WPC QPF Day 1",
  });
  radarMap.addLayer({
    id: "wpc-rain-layer", type: "raster", source: "wpc-rain-source",
    paint: { "raster-opacity": 0.78 },
  });
}

async function addSurfaceAnalysisLayer() {
  if (activeLayer !== "Surface" || !radarMap || !mapLoaded) return;
  // NOAA nowCOAST surface analysis fronts and pressure centers as WMS
  const params = [
    "SERVICE=WMS", "VERSION=1.3.0", "REQUEST=GetMap",
    "FORMAT=image%2Fpng", "TRANSPARENT=true",
    "LAYERS=surface_analysis_fronts",
    "CRS=EPSG%3A3857", "WIDTH=256", "HEIGHT=256",
    "STYLES=",
  ].join("&");

  radarMap.addSource("surface-source", {
    type: "raster",
    tiles: [`${SURFACE_WMS}?${params}&BBOX={bbox-epsg-3857}`],
    tileSize: 256,
    attribution: "NOAA WPC Surface Analysis",
  });
  radarMap.addLayer({
    id: "surface-layer", type: "raster", source: "surface-source",
    paint: { "raster-opacity": 0.85 },
  });
}

async function addLsrLayer() {
  if (activeLayer !== "LSR" || !radarMap || !mapLoaded) return;
  if (!lsrData) {
    lsrData = await fetchOutlookGeoJson(LSR_URL);
  }
  const features = lsrData?.features || [];
  if (!features.length) return;

  // LSR markers as custom HTML elements
  const LSR_ICONS = {
    "T": { icon: "🌪️", color: "#ef4444", label: "Tornado" },
    "H": { icon: "⚙️",  color: "#f97316", label: "Hail" },
    "W": { icon: "💨",  color: "#38bdf8", label: "Wind" },
    "F": { icon: "🌊",  color: "#10b981", label: "Flood" },
    "R": { icon: "☔",  color: "#60a5fa", label: "Rain" },
    "S": { icon: "❄️",  color: "#a5f3fc", label: "Snow" },
    "Z": { icon: "🧊",  color: "#bfdbfe", label: "Ice" },
    "M": { icon: "☁️",  color: "#94a3b8", label: "TSTM" },
  };

  features.forEach((feat, idx) => {
    const p = feat.properties || {};
    const coords = feat.geometry?.coordinates;
    if (!coords) return;
    const typeKey = (p.type || "").toUpperCase().charAt(0);
    const cfg = LSR_ICONS[typeKey] || { icon: "📍", color: "#94a3b8", label: p.type || "LSR" };

    const wrap = document.createElement("div");
    wrap.className = "lsr-marker-wrap";
    const dot = document.createElement("div");
    dot.className = "lsr-marker";
    dot.style.background = cfg.color;
    dot.textContent = cfg.icon;
    wrap.appendChild(dot);

    const marker = new mapboxgl.Marker({ element: wrap, anchor: "center" })
      .setLngLat([coords[0], coords[1]])
      .setPopup(new mapboxgl.Popup({ offset: 12 }).setHTML(`
        <div class="popup-header">
          <div class="popup-icon" style="background:${cfg.color}22;border:1px solid ${cfg.color}66;">${cfg.icon}</div>
          <div>
            <div class="popup-title">${safeText(p.remark || cfg.label)}</div>
            <div class="popup-subtitle">${safeText(cfg.label)} — Local Storm Report</div>
          </div>
        </div>
        <div class="popup-stat"><span class="popup-key">Location</span><span class="popup-val">${safeText(p.city || p.county || "--")}</span></div>
        ${p.magnitude ? `<div class="popup-stat"><span class="popup-key">Magnitude</span><span class="popup-val">${safeText(String(p.magnitude))} ${safeText(p.magUnit || "")}</span></div>` : ""}
        <div class="popup-stat"><span class="popup-key">Source</span><span class="popup-val">${safeText(p.source || "Public")}</span></div>
        ${p.valid ? `<div class="popup-stat"><span class="popup-key">Time</span><span class="popup-val">${new Date(p.valid).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}</span></div>` : ""}
      `))
      .addTo(radarMap);
  });
}

async function addAlertsLayer() {
  if (activeLayer !== "Alerts" || !radarMap || !mapLoaded) return;
  if (!alertPolygonData) {
    alertPolygonData = filterMapColoredWarnings(await fetchOutlookGeoJson(IEM_SBW_URL));
  }
  const data = alertPolygonData;
  if (!data?.features?.length) return;

  // Color by phenomena type
  radarMap.addSource("alerts-source", { type: "geojson", data });
  radarMap.addLayer({
    id: "alerts-fill",
    type: "fill",
    source: "alerts-source",
    paint: {
      "fill-color": ["match", ["get", "phenomena"],
        "TO", "#dc2626", "SV", "#f97316", "FF", "#10b981",
        "FA", "#22d3ee", "SQ", "#a78bfa", "MA", "#38bdf8",
        "rgba(0,0,0,0)"],
      "fill-opacity": 0.3,
    },
  });
  radarMap.addLayer({
    id: "alerts-line",
    type: "line",
    source: "alerts-source",
    paint: {
      "line-color": ["match", ["get", "phenomena"],
        "TO", "#ef4444", "SV", "#fb923c", "FF", "#34d399",
        "FA", "#67e8f9", "SQ", "#c4b5fd", "MA", "#7dd3fc",
        "rgba(0,0,0,0)"],
      "line-width": 2,
    },
  });

  if (!popupWiredLayers.has("alerts")) {
    radarMap.on("click", "alerts-fill", ev => {
      const f = ev.features?.[0];
      if (!f) return;
      const p = f.properties || {};
      const key = `${p.phenomena}.${p.significance}`;
      const eventName = iemPhenomenaMap[key] || key;
      const expires = p.expire ? new Date(p.expire).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "--";
      new mapboxgl.Popup({ offset: 8 })
        .setLngLat(ev.lngLat)
        .setHTML(`
          <div class="popup-header">
            <div class="popup-icon popup-alert" style="background:rgba(251,146,60,0.18);border:1px solid rgba(251,146,60,0.35);">⚠️</div>
            <div>
              <div class="popup-title">${safeText(eventName)}</div>
              <div class="popup-subtitle">IEM Storm-Based Warning</div>
            </div>
          </div>
          <div class="popup-stat"><span class="popup-key">Phenomena</span><span class="popup-val">${safeText(key)}</span></div>
          <div class="popup-stat"><span class="popup-key">WFO</span><span class="popup-val">${safeText(p.wfo || "--")}</span></div>
          <div class="popup-stat"><span class="popup-key">Expires</span><span class="popup-val">${expires}</span></div>
          ${p.windtag ? `<div class="popup-stat"><span class="popup-key">Wind</span><span class="popup-val">${safeText(p.windtag)} mph</span></div>` : ""}
          ${p.hailtag ? `<div class="popup-stat"><span class="popup-key">Hail</span><span class="popup-val">${safeText(p.hailtag)}"</span></div>` : ""}
          ${p.tornadotag ? `<div class="popup-stat"><span class="popup-key">Tornado</span><span class="popup-val">${safeText(p.tornadotag)}</span></div>` : ""}
          <div class="popup-note">Click the alert panel for full details and instructions.</div>
        `)
        .addTo(radarMap);
    });
    radarMap.on("mouseenter", "alerts-fill", () => { radarMap.getCanvas().style.cursor = "pointer"; });
    radarMap.on("mouseleave", "alerts-fill", () => { radarMap.getCanvas().style.cursor = ""; });
    popupWiredLayers.add("alerts");
  }
}

async function addDroughtLayer() {
  droughtLayerData = droughtLayerData || normalizeDroughtData(await fetchDroughtGeoJson());
  if (activeLayer !== "Drought" || !radarMap || !mapLoaded) return;
  radarMap.addSource("drought-source", { type: "geojson", data: droughtLayerData });
  radarMap.addLayer({
    id: "drought-fill",
    type: "fill",
    source: "drought-source",
    filter: ["has", "CATEGORY"],
    paint: {
      "fill-color": ["match", ["get", "CATEGORY"],
        "D0", "#fcd37f", "D1", "#ffaa00", "D2", "#e36e00", "D3", "#c00000", "D4", "#730000", "rgba(0,0,0,0)"],
      "fill-opacity": 0.5,
    },
  });
  radarMap.addLayer({
    id: "drought-line",
    type: "line",
    source: "drought-source",
    paint: {
      "line-color": ["match", ["get", "CATEGORY"],
        "D0", "#e9a137", "D1", "#cc8800", "D2", "#b85400", "D3", "#8f0000", "D4", "#540000", "rgba(0,0,0,0)"],
      "line-width": 1.3,
    },
  });
  if (!droughtPopupWired) {
    radarMap.on("click", "drought-fill", ev => {
      const f = ev.features?.[0];
      if (!f) return;
      const cat = f.properties?.CATEGORY || "";
      new mapboxgl.Popup({ offset: 8 })
        .setLngLat(ev.lngLat)
        .setHTML(`
          <div class="popup-header">
            <div class="popup-icon" style="background:rgba(234,179,8,0.15);border:1px solid rgba(234,179,8,0.35);">🌵</div>
            <div>
              <div class="popup-title">U.S. Drought Monitor</div>
              <div class="popup-subtitle">USDA / NOAA / UNL</div>
            </div>
          </div>
          <div class="popup-stat">
            <span class="popup-key">Classification</span>
            <span class="popup-val">${safeText(droughtLabel(cat))}</span>
          </div>
          <div class="popup-note">Updated weekly every Thursday. Data: drought.gov</div>
        `)
        .addTo(radarMap);
    });
    radarMap.on("mouseenter", "drought-fill", () => { radarMap.getCanvas().style.cursor = "pointer"; });
    radarMap.on("mouseleave", "drought-fill", () => { radarMap.getCanvas().style.cursor = ""; });
    droughtPopupWired = true;
  }
}

function drawRadar() {
  if (!document.querySelector("#maps")?.classList.contains("active")) return;
  initMap();
  if (!radarMap || !mapLoaded) return;
  clearWeatherLayers();

  switch (activeLayer) {
    case "Radar":      addRadarLayer(); break;
    case "SPC":        addSpcLayer().catch(e => console.warn("SPC unavailable", e)); break;
    case "Drought":    addDroughtLayer().catch(e => console.warn("Drought unavailable", e)); break;
    case "Alerts":     addRadarLayer(); addAlertsLayer().catch(e => console.warn("Alerts unavailable", e)); break;
    case "Fire Wx":    addFireWeatherLayer().catch(e => console.warn("Fire Wx unavailable", e)); break;
    case "WPC Rain":   addWpcRainfallLayer().catch(e => console.warn("WPC Rain unavailable", e)); break;
    case "Surface":    addSurfaceAnalysisLayer().catch(e => console.warn("Surface unavailable", e)); break;
    case "LSR":        addRadarLayer(); addLsrLayer().catch(e => console.warn("LSR unavailable", e)); break;
  }

  mapMarker?.setLngLat([selectedLocation.lon, selectedLocation.lat]);
  mapMarker?.setPopup(new mapboxgl.Popup({ offset: 14 }).setHTML(buildLocationPopup(selectedLocation.name)));
  radarMap.resize();
  radarMap.flyTo({ center: [selectedLocation.lon, selectedLocation.lat], zoom: Math.max(radarMap.getZoom(), 8), duration: 700 });
}

function animateRadarLayer() {
  stopRadarAnimation();
  if (!["Radar", "Alerts", "LSR"].includes(activeLayer) || !radarFrames.length) return;
  const lbl = document.querySelector("#playLabel");
  if (lbl) lbl.textContent = "Pause";
  radarAnimationTimer = setInterval(() => {
    setRadarFrame((radarFrameIndex + 1) % radarFrames.length);
  }, RADAR_FRAME_MS);
}

function renderLayers() {
  // Base layers row
  const baseEl = document.querySelector("#baseLayerPills");
  // Overlay layers row
  const overlayEl = document.querySelector("#overlayLayerPills");
  if (!baseEl || !overlayEl) return;

  const BASE_LAYERS = ["Radar"];
  const OVERLAY_LAYERS = ["SPC", "Alerts", "Fire Wx", "WPC Rain", "Surface", "LSR", "Drought"];

  baseEl.innerHTML = BASE_LAYERS.map(l =>
    `<button type="button" data-layer="${l}" class="${l === activeLayer ? "active" : ""}">${l}</button>`
  ).join("");

  overlayEl.innerHTML = OVERLAY_LAYERS.map(l =>
    `<button type="button" data-layer="${l}" class="${l === activeLayer ? "active" : ""}">${l}</button>`
  ).join("");

  // Unified click handler for all layer buttons
  [baseEl, overlayEl].forEach(container => {
    container.querySelectorAll("button[data-layer]").forEach(btn => {
      btn.addEventListener("click", () => {
        activeLayer = btn.dataset.layer;
        renderLayers();
        drawRadar();
      });
    });
  });

  // Show/hide SPC sub-controls
  const spcCtrl = document.querySelector("#spcSubControls");
  if (spcCtrl) {
    spcCtrl.hidden = activeLayer !== "SPC";
    if (activeLayer === "SPC") renderSpcSubControls();
  }

  // Show/hide radar timeline controls
  const radCtrl = document.querySelector("#radarSubControls");
  if (radCtrl) {
    radCtrl.hidden = !["Radar", "Alerts", "LSR"].includes(activeLayer);
  }
}

function renderSpcSubControls() {
  const dayEl  = document.querySelector("#spcDayBtns");
  const typeEl = document.querySelector("#spcTypeBtns");
  if (!dayEl || !typeEl) return;

  const days  = [1, 2, 3];
  const types = [
    { id: "cat",  label: "Categorical" },
    { id: "torn", label: "Tornado"     },
    { id: "wind", label: "Wind"        },
    { id: "hail", label: "Hail"        },
  ];

  dayEl.innerHTML = days.map(d =>
    `<button type="button" data-spc-day="${d}" class="${d === activeSpcDay ? "active" : ""}">Day ${d}</button>`
  ).join("");

  typeEl.innerHTML = types.map(t =>
    `<button type="button" data-spc-type="${t.id}" class="${t.id === activeSpcType ? "active" : ""}">${t.label}</button>`
  ).join("");

  dayEl.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      activeSpcDay = Number(btn.dataset.spcDay);
      // Day 3 only has categorical; days 1-2 have all types
      if (activeSpcDay === 3 && activeSpcType !== "cat") activeSpcType = "cat";
      renderSpcSubControls();
      drawRadar();
    });
  });

  typeEl.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      activeSpcType = btn.dataset.spcType;
      renderSpcSubControls();
      drawRadar();
    });
  });

  // Update SPC legend
  renderSpcLegend();
}

function renderSpcLegend() {
  const box = document.querySelector("#spcLegendBox");
  if (!box) return;
  if (activeLayer !== "SPC") { box.hidden = true; return; }
  box.hidden = false;

  const isCat = activeSpcType === "cat";
  const entries = isCat
    ? [
        { color: "#c0e8c0", label: "TSTM — General Thunderstorm" },
        { color: "#66cc66", label: "MRGL — Marginal" },
        { color: "#ffe066", label: "SLGT — Slight" },
        { color: "#ffa040", label: "ENH — Enhanced" },
        { color: "#ff6060", label: "MDT — Moderate" },
        { color: "#ff40ff", label: "HIGH — High" },
      ]
    : [
        { color: "#50b450", label: "2%" },
        { color: "#64c83c", label: "5%" },
        { color: "#ffdc00", label: "10%" },
        { color: "#ff8c00", label: "15%" },
        { color: "#dc1e1e", label: "30%" },
        { color: "#a000c8", label: "45%" },
        { color: "#6400b4", label: "60%+" },
      ];

  box.innerHTML = `
    <div class="legend-title">SPC Day ${activeSpcDay} ${activeSpcType.toUpperCase()}</div>
    ${entries.map(e => `
      <div class="legend-row">
        <span class="legend-swatch" style="background:${e.color}"></span>
        ${safeText(e.label)}
      </div>
    `).join("")}
  `;
}

async function refreshLiveData() {
  refreshButton.disabled = true;
  refreshButton.textContent = "Refreshing";
  document.querySelector("#statusBadge").textContent = "Updating live sources";

  const [weather, aviation, space, maps] = await Promise.allSettled([
    weatherPayload(),
    aviationPayload(),
    spacePayload(),
    mapsPayload(),
  ]);

  if (weather.status === "fulfilled") {
    weatherState = weather.value;
  } else {
    weatherState = fallbackWeather;
    document.querySelector("#statusBadge").textContent = "NWS unavailable";
  }
  mapState = maps.status === "fulfilled" ? maps.value : {};

  renderCurrent();
  renderHourlyChart();
  renderAlerts();
  notifyNewWeatherAlerts();
  renderDaily();
  renderMetar(aviation.status === "fulfilled" ? aviation.value : null);
  renderSpace(space.status === "fulfilled" ? space.value : null);
  renderMapSidebar();
  drawRadar();

  refreshButton.disabled = false;
  refreshButton.textContent = "Refresh";
}

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(item => item.classList.toggle("active", item === tab));
    screens.forEach(screen => screen.classList.toggle("active", screen.id === tab.dataset.tab));
    if (tab.dataset.tab === "maps") setTimeout(drawRadar, 0);
  });
});

// Hourly metric switcher
document.querySelector("#hourlyMetricSwitcher")?.addEventListener("click", event => {
  const btn = event.target.closest("[data-metric]");
  if (!btn) return;
  hourlyChartMetric = btn.dataset.metric;
  document.querySelectorAll("#hourlyMetricSwitcher button").forEach(b => b.classList.toggle("active", b === btn));
  renderHourlyChart();
});

refreshButton.addEventListener("click", refreshLiveData);
notifyButton?.addEventListener("click", enableNotifications);
locationForm.addEventListener("submit", async event => {
  event.preventDefault();
  const query = locationInput.value.trim();
  if (!query) return;
  refreshButton.disabled = true;
  document.querySelector("#statusBadge").textContent = "Finding location";
  try {
    const exactSuggestion = locationSuggestionResults.find(item => item.name.toLowerCase() === query.toLowerCase());
    const results = exactSuggestion ? [exactSuggestion] : await searchLocations(query);
    if (!results.length) throw new Error("No US town found");
    await chooseLocation(results[0]);
  } catch (error) {
    document.querySelector("#statusBadge").textContent = error.message;
    refreshButton.disabled = false;
  }
});

locationInput.addEventListener("input", () => {
  const query = locationInput.value.trim();
  clearTimeout(locationSuggestionTimer);
  if (query.length < 2) {
    renderLocationSuggestions([]);
    return;
  }
  locationSuggestionTimer = setTimeout(async () => {
    try {
      renderLocationSuggestions(await searchLocations(query));
    } catch {
      renderLocationSuggestions([]);
    }
  }, 180);
});

locationInput.addEventListener("focus", () => {
  if (locationSuggestionResults.length) locationSuggestions.hidden = false;
});

locationSuggestions.addEventListener("click", event => {
  const button = event.target.closest("[data-suggestion-index]");
  if (!button) return;
  const suggestion = locationSuggestionResults[Number(button.dataset.suggestionIndex)];
  if (suggestion) chooseLocation(suggestion);
});

document.addEventListener("click", event => {
  if (!event.target.closest(".location-search")) hideLocationSuggestions();
});
hourlyStrip.addEventListener("click", event => {
  const card = event.target.closest("[data-hour-index]");
  if (card) showHourDetails(Number(card.dataset.hourIndex));
});
dailyGrid.addEventListener("click", event => {
  const card = event.target.closest("[data-day-index]");
  if (card) showDailyDetails(Number(card.dataset.dayIndex));
});
alertsPanel.addEventListener("click", event => {
  const card = event.target.closest("[data-alert-index]");
  if (card) showAlertDetails(Number(card.dataset.alertIndex));
});
detailModal.addEventListener("click", event => {
  if (event.target.closest("[data-close-modal]")) closeDetails();
});
window.addEventListener("keydown", event => {
  if (event.key === "Escape" && !detailModal.hidden) closeDetails();
});
// climateForm removed — using calendar date picker
document.querySelector("#locateMeBtn")?.addEventListener("click", async () => {
  const btn = document.querySelector("#locateMeBtn");
  const label = document.querySelector("#locateMeBtnText");
  if (btn) btn.disabled = true;
  if (label) label.textContent = "Locating...";
  try {
    const loc = await locateMe();
    if (loc) await chooseLocation(loc);
    else if (label) label.textContent = "Unavailable";
  } finally {
    if (btn) btn.disabled = false;
    if (label) label.textContent = "Locate Me";
  }
});
document.querySelector("#radarTimeline")?.addEventListener("input", event => {
  stopRadarAnimation();
  setRadarFrame(event.target.value);
});
document.querySelector("#radarPlayButton")?.addEventListener("click", () => {
  if (radarAnimationTimer) stopRadarAnimation();
  else animateRadarLayer();
});
document.querySelector("#radarOpacitySlider")?.addEventListener("input", event => {
  setRainfallOpacity(Number(event.target.value));
});

window.addEventListener("resize", drawRadar);

renderLayers();
registerAppWorker();
initHistoricalCalendar();
renderBasemapButtons();
tabs.forEach(tab => {
  if (tab.dataset.tab === "climate") {
    tab.addEventListener("click", () => {
      const nameEl = document.querySelector("#hist-location-name");
      if (nameEl) nameEl.textContent = selectedLocation.name;
    }, { capture: true });
  }
});
refreshLiveData();
drawAtmosphere();
