const EPHRATA = { lat: 40.1798, lon: -76.1788, name: "Ephrata, PA", timezone: "America/New_York", countryCode: "US" };
const GOOGLE_POLLEN_KEY = "AIzaSyBAjoVkrRrLPzv9MSrlWaWTFELT8KpJ41E";
const MAPBOX_TOKEN = "pk.eyJ1IjoiZ3RnMDExNiIsImEiOiJjbWxsODV6NXAwNThmM2ZwdWlkYm0xNjFlIn0.vI186twXYzY45nnuV5FucQ";
const NOAA_RADAR_WMS = "https://nowcoast.noaa.gov/geoserver/observations/weather_radar/ows";
const RADAR_FRAME_MS = 700;
// Fill these after deploying the alert worker described in NOTIFICATIONS.md.
const PUSH_PUBLIC_KEY = "BAHwhEIc4YhZIWcWJVcPiDWzAPijunUm93TaX7x8dHi_T9Q5CJTap4ewTV7ri5GYzRgFRRRnFTDuziH0_yK6Gi0";
const PUSH_SUBSCRIBE_ENDPOINT = "https://weather-alert-worker.gtg0116scratch.workers.dev/subscribe";
const PUSH_UNSUBSCRIBE_ENDPOINT = "https://weather-alert-worker.gtg0116scratch.workers.dev/unsubscribe";
const WORKER_PROXY = "https://weather-alert-worker.gtg0116scratch.workers.dev/proxy?url=";
// Tempest (WeatherFlow) personal weather station serving the Ephrata, PA area.
// Current conditions for these towns are sourced from this station instead of NWS.
const TEMPEST_STATION_ID = 168579;
const TEMPEST_TOKEN = "7924050f-deed-4373-9755-fb0c8c8668b9";
const TEMPEST_TOWNS = ["ephrata", "akron", "brownstown", "rothsville"];
// SPC Categorical + probabilistic outlooks, Days 1-2 (used by the point text forecast).
const SPC_URLS = {
  cat:  ["https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson",
         "https://www.spc.noaa.gov/products/outlook/day2otlk_cat.nolyr.geojson"],
  torn: ["https://www.spc.noaa.gov/products/outlook/day1otlk_torn.nolyr.geojson",
         "https://www.spc.noaa.gov/products/outlook/day2otlk_torn.nolyr.geojson"],
  wind: ["https://www.spc.noaa.gov/products/outlook/day1otlk_wind.nolyr.geojson",
         "https://www.spc.noaa.gov/products/outlook/day2otlk_wind.nolyr.geojson"],
  hail: ["https://www.spc.noaa.gov/products/outlook/day1otlk_hail.nolyr.geojson",
         "https://www.spc.noaa.gov/products/outlook/day2otlk_hail.nolyr.geojson"],
};

const SPC_CAT_RANK = { TSTM: 1, MRGL: 2, SLGT: 3, ENH: 4, MDT: 5, HIGH: 6 };

// SPC probability fill color scales. Tornado runs 2–60%, wind/hail run 5–90% (hail tops
// out at 60%). Day 3 overall-severe probability reuses the hail scale; experimental
// Days 4-8 carry only 15%/30% severe probabilities (yellow / orange).
const SPC_PROB_COLORS = {
  torn: [[2, "#008b00"], [5, "#8b4726"], [10, "#ffc800"], [15, "#ff0000"], [30, "#ff00ff"], [45, "#912cee"], [60, "#104e8b"]],
  wind: [[5, "#8b4726"], [15, "#ffc800"], [30, "#ff0000"], [45, "#ff00ff"], [60, "#912cee"], [75, "#104e8b"], [90, "#00ffff"]],
  hail: [[5, "#8b4726"], [15, "#ffc800"], [30, "#ff0000"], [45, "#ff00ff"], [60, "#912cee"]],
  d48:  [[15, "#ffc800"], [30, "#ff8c00"]],
};

// SPC outlook GeoJSON URL for a given day (1-8) and type. Days 1-2 offer the full hazard
// set; Day 3 offers categorical + overall-severe probability; Days 4-8 are probability only.
function spcUrlFor(day, type) {
  if (day <= 2) return `https://www.spc.noaa.gov/products/outlook/day${day}otlk_${type}.nolyr.geojson`;
  if (day === 3) {
    if (type === "cat")  return "https://www.spc.noaa.gov/products/outlook/day3otlk_cat.nolyr.geojson";
    if (type === "prob") return "https://www.spc.noaa.gov/products/outlook/day3otlk_prob.nolyr.geojson";
    return null;
  }
  if (type === "prob") return `https://www.spc.noaa.gov/products/exper/day4-8/day${day}prob.nolyr.geojson`;
  return null;
}

// Outlook types available for a given SPC day.
function spcTypesForDay(day) {
  if (day <= 2) return ["cat", "torn", "wind", "hail"];
  if (day === 3) return ["cat", "prob"];
  return ["prob"];
}

// Probability color stops ([percent, color] pairs) for the active day/type.
function spcProbStops(day, type) {
  if (day >= 4) return SPC_PROB_COLORS.d48;
  if (day === 3) return SPC_PROB_COLORS.hail; // overall severe = hail scale
  return SPC_PROB_COLORS[type] || SPC_PROB_COLORS.hail;
}

// NWS vector MapServer for SPC fire weather outlook (Day 1 layer 0, Day 2 layer 1)
const FIRE_WX_MAPSERVER_BASE = "https://mapservices.weather.noaa.gov/vector/rest/services/fire_weather/SPC_firewx/MapServer";

// WPC Excessive Rainfall Outlook (ERO) GeoJSON — Days 1-5
const WPC_ERO_URLS = [
  "https://www.wpc.ncep.noaa.gov/exper/eromap/geojson/Day1_Latest.geojson",
  "https://www.wpc.ncep.noaa.gov/exper/eromap/geojson/Day2_Latest.geojson",
  "https://www.wpc.ncep.noaa.gov/exper/eromap/geojson/Day3_Latest.geojson",
  "https://www.wpc.ncep.noaa.gov/exper/eromap/geojson/Day4_Latest.geojson",
  "https://www.wpc.ncep.noaa.gov/exper/eromap/geojson/Day5_Latest.geojson",
];

// IEM storm-based warning polygons for map
const IEM_SBW_URL = "https://mesonet.agron.iastate.edu/geojson/sbw.geojson";

// IEM Local Storm Reports
const LSR_URL = "https://mesonet.agron.iastate.edu/geojson/lsr.php?hours=24";

// NOAA nowCOAST WMS endpoints
const WPC_QPF_WMS  = "https://nowcoast.noaa.gov/geoserver/forecasts/qpf/ows";
const SURFACE_WMS  = "https://nowcoast.noaa.gov/arcgis/services/nowcoast/analysis_meteohydro_sfc_fronts_time/MapServer/WMSServer";
// ─── Satellite imagery (GitHub-generated frame buffers) ───────────────────────
// Each source repo publishes a rolling buffer of frames to site/data/ on `main`.
// Files are named <band>_NN.png where NN = 00 (newest) … 09 (oldest).
// extent is [west_lon, east_lon, south_lat, north_lat] and MUST match the
// EXTENT used by that repo's process_data.py.
//
// `proj` is the projection the repo's PNGs are actually rendered in and decides
// how each frame is placed on the (Mercator) Mapbox map:
//   "platecarree" — repo renders ccrs.PlateCarree() (latitude-linear). A Mapbox
//                   image source stretches the bitmap linearly in Mercator Y, so
//                   these frames are pre-warped (see warpEquirectToMercator) to
//                   compensate; placement uses the plain lon/lat corners.
//   "mercator"    — repo renders ccrs.Mercator(central_longitude=nadir) directly,
//                   i.e. the PNG is ALREADY Web Mercator. Re-warping it would
//                   double-project and throw it badly off, so these frames are
//                   used raw. The central-longitude offset is a pure translation
//                   at the same scale as EPSG:3857, so mapping the bitmap edges to
//                   the lon/lat corners reproduces the projection exactly.
const SATELLITE_RAW = "https://raw.githubusercontent.com/GTG0116";
const SATELLITE_MAX_FRAMES = 10;
const SATELLITE_SOURCES = [
  { id: "goes19fd",    label: "GOES-19 Full Disk", note: "Atlantic / Americas",   repo: "goes19fulldisk",    extent: [-156,    6, -81, 81], sectorScheme: "goes",     proj: "platecarree" },
  { id: "goes19conus", label: "GOES-19 CONUS",     note: "Continental U.S.",      repo: "Satellite",         extent: [-135,  -60,  20, 55], sectorScheme: "goes",     proj: "platecarree" },
  { id: "goes18",      label: "GOES-18 Full Disk", note: "Pacific / NHC E-Pac",   repo: "Goes18satellite",   extent: [-220,  -55, -80, 80], sectorScheme: "goes18",   proj: "mercator"    },
  { id: "himawari",    label: "Himawari",          note: "W. Pacific / Typhoons", repo: "Himawari_Satellite",extent: [  80,  200, -60, 60], sectorScheme: "himawari", proj: "mercator"    },
];
const SATELLITE_BANDS = [
  { id: "geocolor",   label: "GeoColor",    file: "geocolor"    },
  { id: "infrared",   label: "Infrared",    file: "infrared"    },
  { id: "watervapor", label: "Water Vapor", file: "water_vapor" },
  { id: "visible",    label: "Visible",     file: "visible"     },
];

// ─── Tropical cyclones overlay (JTWC + NHC, GitHub-generated) ──────────────────
const CYCLONE_BASE = "https://gtg0116.github.io/JTWCTyphoonData/data";
const CYCLONE_FEEDS = ["storms.json", "nhc_atlantic.json", "nhc_pacific.json"];

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

// ─── MRMS Radar (EphrataWeather/MRMS on GitHub) ───────────────────────────────
const MRMS_BASE = "https://raw.githubusercontent.com/EphrataWeather/MRMS/main/public/data/";
const MRMS_FRAMES = 15; // frames 0-14, index 0 = latest
const MRMS_PRODUCTS = {
  rate:      { label: "Precip Type",     getImg: i => i === 0 ? "master.png" : `master_${i}.png`,  getMeta: i => `metadata_${i}.json`,          hasVal: false },
  refl:      { label: "Reflectivity",    getImg: i => `refl_${i}.png`,                              getMeta: i => `metadata_refl_${i}.json`,      hasVal: true,  getVal: i => `refl_val_${i}.png`,      valMax: 80.0, valUnit: "dBZ" },
  mesh:      { label: "Hail (MESH)",     getImg: i => `mesh_${i}.png`,                              getMeta: i => `metadata_mesh_${i}.json`,      hasVal: true,  getVal: i => `mesh_val_${i}.png`,      valMax: 8.0,  valUnit: "in" },
  qpe6h:     { label: "6-Hr Precip",     getImg: i => `qpe6h_${i}.png`,                             getMeta: i => `metadata_qpe6h_${i}.json`,     hasVal: true,  getVal: i => `qpe6h_val_${i}.png`,     valMax: 40.0, valUnit: "in" },
  qpe24h:    { label: "24-Hr Precip",    getImg: i => `qpe24h_${i}.png`,                            getMeta: i => `metadata_qpe24h_${i}.json`,    hasVal: true,  getVal: i => `qpe24h_val_${i}.png`,    valMax: 80.0, valUnit: "in" },
  lightning: { label: "Lightning Prob",  getImg: i => `lightning_${i}.png`,                         getMeta: i => `metadata_lightning_${i}.json`, hasVal: true,  getVal: i => `lightning_val_${i}.png`, valMax: 100,  valUnit: "%" },
  rotation:  { label: "Azimuthal Shear", getImg: i => `rotation_${i}.png`,                          getMeta: i => `metadata_rotation_${i}.json`,  hasVal: true,  getVal: i => `rotation_val_${i}.png`,  valMax: 1.0,  valUnit: "s⁻¹" },
};
const MRMS_LEGENDS = {
  rate: {
    title: "PRECIP TYPE",
    sections: [
      {
        label: "RAIN (IN/HR)",
        gradient: "linear-gradient(90deg, #00ff9d 0%, #00d85f 28%, #1e8c00 43%, #ffff00 62%, #ff9b00 78%, #ff0000 100%)",
        ticks: ["0.02\"", "0.12\"", "0.50\"", "2.0\"", "5.0\""],
      },
      {
        label: "ICE PELLETS (IN/HR)",
        gradient: "linear-gradient(90deg, #ff4dff 0%, #e000df 45%, #b000aa 72%, #7a0078 100%)",
        ticks: ["Light", "Heavy"],
      },
      {
        label: "SNOW (IN/HR)",
        gradient: "linear-gradient(90deg, #00ffff 0%, #78f2ff 42%, #b6d5ff 72%, #d8d1ff 100%)",
        ticks: ["0.004\"", "0.04\"", "0.24\""],
      },
    ],
  },
  refl: {
    title: "REFLECTIVITY",
    sections: [
      {
        label: "REFLECTIVITY (DBZ)",
        gradient: "linear-gradient(90deg, #9ca3af 0%, #9ca3af 8%, #60a5fa 19%, #00b050 34%, #fff200 55%, #ff8a00 67%, #ff0000 80%, #e040fb 100%)",
        ticks: ["0", "35", "55", "75"],
      },
    ],
  },
  mesh: {
    title: "MAX HAIL SIZE (MESH)",
    sections: [
      {
        label: "HAIL DIAMETER (IN)",
        gradient: "linear-gradient(90deg, #bfff00 0%, #fff200 36%, #ff9800 58%, #ff3b00 78%, #c00000 100%)",
        ticks: [
          { value: "0.25\"", note: "Pea" },
          "0.75\"",
          { value: "1.75\"", note: "Golf" },
          { value: "3.0\"", note: "Baseball+" },
        ],
      },
    ],
  },
  qpe6h: {
    title: "6-HR PRECIP ESTIMATE",
    sections: [
      {
        label: "6-HR ACCUMULATION (IN)",
        gradient: "linear-gradient(90deg, #00ff9d 0%, #00d85f 31%, #c6e600 48%, #ffff00 58%, #ff9800 75%, #ff0000 100%)",
        ticks: ["0.05\"", "0.50\"", "2.0\"", "4.0\"", "8.0\""],
      },
    ],
  },
  qpe24h: {
    title: "24-HR PRECIP ESTIMATE",
    sections: [
      {
        label: "24-HR ACCUMULATION (IN)",
        gradient: "linear-gradient(90deg, #00ff9d 0%, #00d85f 28%, #42a500 42%, #ffff00 59%, #ff9800 76%, #ff0000 100%)",
        ticks: ["0.25\"", "1.0\"", "3.0\"", "8.0\"", "16\""],
      },
    ],
  },
  lightning: {
    title: "CG LIGHTNING PROBABILITY",
    sections: [
      {
        label: "1-HR CG LIGHTNING PROB (%)",
        gradient: "linear-gradient(90deg, #ffff9d 0%, #ffd447 28%, #ff9a00 49%, #ff2a00 72%, #8f0018 100%)",
        ticks: ["5%", "30%", "60%", "90%"],
      },
    ],
  },
  rotation: {
    title: "AZIMUTH SHEAR/ROTATION",
    sections: [
      {
        label: "AZ SHEAR (S⁻¹)",
        gradient: "linear-gradient(90deg, #00ff00 0%, #a8ff00 26%, #ffff00 42%, #ff8c00 59%, #ff0000 72%, #ff00ff 87%, #9b00c8 100%)",
        ticks: ["0.003", "0.012", "0.030", "0.050"],
      },
    ],
  },
};

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
    { min: 83, label: "Excellent",     color: "#4CAF50", bg: "rgba(76,175,80,0.18)",   sentence: "Conditions are excellent for outdoor activities." },
    { min: 65, label: "Good",          color: "#8BC34A", bg: "rgba(139,195,74,0.15)",  sentence: "Conditions are generally favorable for outdoor activities." },
    { min: 45, label: "OK",            color: "#FFC107", bg: "rgba(255,193,7,0.18)",   sentence: "Conditions are marginal; outdoor activities are not recommended." },
    { min: 25, label: "Poor",          color: "#FF7043", bg: "rgba(255,112,67,0.2)",   sentence: "Conditions are poor; outdoor activities are strongly discouraged." },
    { min:  0, label: "Extremely Poor",color: "#EF5350", bg: "rgba(239,83,80,0.22)",   sentence: "Conditions are very poor; outdoor activities should be avoided." },
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
  pollenForecast: [],
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

// Keep the <meta name="theme-color"> in step with the top color of the active
// animated gradient. On iOS standalone web apps the system can paint the
// status-bar buffer itself from theme-color; matching the gradient keeps that
// strip blended with the scene instead of reading as a flat dark band.
// Also mirror the palette onto the root element's --sky-* custom properties:
// the html background gradient (see styles.css) is what iOS paints in the
// safe-area bands where fixed-position elements get clipped.
function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  const palette = themePalettes[activeTheme] || themePalettes.sunny;
  if (meta && palette.gradient?.length) meta.setAttribute("content", palette.gradient[0]);
  palette.gradient.forEach((color, i) =>
    document.documentElement.style.setProperty(`--sky-${i}`, color));
}
syncThemeColor();
let radarActive = true;
let activeOverlays = new Set();
let radarSlot = 0; // 0="a" or 1="b" for double-buffer animation
let radarFrameTransitionTimer = null;
let activeSpcType = "cat";   // cat | torn | wind | hail | prob
let activeSpcDay  = 1;       // 1-8
let activeWpcDay  = 1;       // 1-5
let activeFireDay = 1;       // 1 or 2
let activeBasemap = (() => {
  const saved = localStorage.getItem("weatherBasemap");
  return BASEMAP_STYLES.some(s => s.id === saved) ? saved : "dark-v11";
})();
let activeSatelliteType = "geocolor";
let activeSatelliteSource = (() => {
  const saved = localStorage.getItem("satelliteSource");
  return SATELLITE_SOURCES.some(s => s.id === saved) ? saved : "goes19fd";
})();
let satelliteActive = false;
let satFrames = [];               // e.g. [9,8,…,1,0]; value = file index, 0 = newest
let satFrameIndex = 0;            // pointer into satFrames; latest = last element
const satFrameCountCache = {};    // cacheKey → detected frame count
let activeSatelliteSector = null; // null = full disk, else a TC sector id
const satSectorCache = {};        // sourceId → array of normalized sector objects
const satWarpCache = new Map();   // frameKey → equirect→Mercator warped data URL
let cycloneData = null;           // cached {storms:[…]} across all feeds
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
let fireWeatherDataCache = {};  // keyed by day (1|2)
let wpcRainDataCache = {};      // keyed by day (1-5)
let lsrData = null;
let alertPolygonData = null;
let nwsAlertPolygonData = null;
let alertFetchBox = null;           // {west,south,east,north} the alert overlay was last fetched for
let alertPanRefreshInFlight = false;
let activeAlertFilter = (() => {
  const saved = localStorage.getItem("alertKindFilter");
  return ["all", "warning", "watch", "advisory"].includes(saved) ? saved : "all";
})();
let spcPopupWired = false;
let droughtPopupWired = false;
let radarAnimationTimer;
let radarFrameIndex = 0;
let radarFrames = [];
let radarOpacity = 0.78;
let locationSuggestionTimer;
let serviceWorkerRegistration = null;
let suppressNextAlertNotifications = true;
let locationSuggestionResults = [];
let histCalYear = null;
let histCalMonth = null;
let histSelectedDate = null;
let userLocationMarker = null;
let liveLocationWatchId = null;
let currentSunrise = null;   // actual Date object
let currentSunset  = null;   // actual Date object
let currentSunTimesByDate = new Map(); // local YYYY-MM-DD → { sunriseDate, sunsetDate }
let metarStationOverride = null; // user-specified METAR station ID
let popupWiredLayers = new Set(); // track which layers have popup handlers
let alertPopupRegistry = new Map(); // popupId → alert features array (for _viewAlertFromMapFeature)
let activeUnifiedPopup = null;
let activeUnifiedPopupNav = null;
let alertPopupCounter = 0;
let activeMrmsProduct = (() => { const s = localStorage.getItem("mrmsProduct"); return MRMS_PRODUCTS[s] ? s : "rate"; })();
let mrmsImageBounds = null;  // {west, east, north, south}
let mrmsTimeCache = {};      // `${product}_${frameIdx}` → time string
let mrmsCanvasCache = {};    // `${product}_${frameIdx}` → {imgData, width, height}

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

// ─── Unit system (imperial / metric) ─────────────────────────────────────────
// Payloads normalise everything to imperial; these helpers convert at display
// time so a single toggle re-skins the whole UI without refetching. unitSystem
// is null until the user picks one — then units follow the location's country
// (imperial for the US, metric for Canada and everywhere else).
let unitSystem = (() => {
  const saved = localStorage.getItem("unitSystem");
  return saved === "metric" || saved === "imperial" ? saved : null;
})();

// Canadian IANA timezones — a reliable signal when a saved location predates
// country-code capture.
const CANADIAN_TIMEZONES = new Set([
  "America/Toronto", "America/Montreal", "America/Vancouver", "America/Edmonton",
  "America/Winnipeg", "America/Halifax", "America/St_Johns", "America/Regina",
  "America/Whitehorse", "America/Moncton", "America/Glace_Bay", "America/Goose_Bay",
  "America/Iqaluit", "America/Yellowknife", "America/Dawson", "America/Dawson_Creek",
  "America/Rankin_Inlet", "America/Resolute", "America/Swift_Current", "America/Inuvik",
  "America/Cambridge_Bay", "America/Atikokan", "America/Thunder_Bay", "America/Rainy_River",
  "America/Fort_Nelson", "America/Blanc-Sablon", "America/Pangnirtung", "America/Nipigon",
]);

function autoMetric() {
  const cc = (selectedLocation?.countryCode || "").toUpperCase();
  if (cc) return cc !== "US";
  // No stored country code: Canadian/international results carry a country
  // suffix, and Canadian points sit in a Canadian timezone; bare US
  // "City, State" stays imperial.
  const name = selectedLocation?.name || "";
  if (/\bcanada\b/i.test(name) || /,\s*CA$/i.test(name)) return true;
  return CANADIAN_TIMEZONES.has(selectedLocation?.timezone || "");
}

function isMetric() {
  return unitSystem ? unitSystem === "metric" : autoMetric();
}

// Convert a stored imperial value into the active display system.
function uTemp(valueF)      { return valueF == null ? null : (isMetric() ? (valueF - 32) * 5 / 9 : valueF); }
function uWind(valueMph)    { return valueMph == null ? null : (isMetric() ? valueMph * 1.609344 : valueMph); }
function uVis(valueMi)      { return valueMi == null ? null : (isMetric() ? valueMi * 1.609344 : valueMi); }
function uPrecip(valueIn)   { return valueIn == null ? null : (isMetric() ? valueIn * 25.4 : valueIn); }
function uPressure(valInHg) { return valInHg == null ? null : (isMetric() ? valInHg * 33.8639 : valInHg); }

function tempUnit()   { return isMetric() ? "°C" : "°F"; }
function windUnit()   { return isMetric() ? "km/h" : "mph"; }
function visUnit()    { return isMetric() ? "km" : "mi"; }
function precipUnit() { return isMetric() ? "mm" : "in"; }
function pressUnit()  { return isMetric() ? "hPa" : "inHg"; }

// Display formatters: converted, rounded, with optional unit suffix.
function uTempNum(valueF) { const v = uTemp(valueF); return v == null ? "--" : String(Math.round(v)); }
function fmtTemp(valueF)  { const v = uTemp(valueF); return v == null ? `--${tempUnit()}` : `${Math.round(v)}${tempUnit()}`; }
function fmtWind(valueMph){ const v = uWind(valueMph); return v == null ? "--" : `${Math.round(v)} ${windUnit()}`; }
function fmtVis(valueMi)  { const v = uVis(valueMi); return v == null ? "--" : `${v.toFixed(1)} ${visUnit()}`; }
function fmtPressure(valInHg) {
  const v = uPressure(valInHg);
  if (v == null) return "--";
  return isMetric() ? `${Math.round(v)} ${pressUnit()}` : `${v.toFixed(2)} ${pressUnit()}`;
}
function fmtPrecip(valueIn, digits) {
  const v = uPrecip(valueIn);
  if (v == null) return "--";
  const d = digits != null ? digits : (isMetric() ? 1 : 2);
  return `${v.toFixed(d)} ${precipUnit()}`;
}
function fmtSnow(valueIn, digits = 1) {
  if (valueIn == null) return "--";
  return isMetric() ? `${(valueIn * 2.54).toFixed(digits)} cm` : `${valueIn.toFixed(digits)} in`;
}

function updateUnitToggleLabel() {
  const metric = isMetric();
  document.querySelectorAll("#unitToggle .unit-opt").forEach(el => {
    el.classList.toggle("active", (el.dataset.system === "metric") === metric);
  });
  const btn = document.querySelector("#unitToggle");
  if (btn) btn.setAttribute("aria-label", `Units: ${metric ? "metric (°C)" : "imperial (°F)"}. Tap to switch.`);
}

// Re-skin every units-bearing view in place (no network refetch).
function rerenderUnits() {
  updateUnitToggleLabel();
  if (weatherState) {
    renderCurrent();
    renderDaily();
    renderMapSidebar();
    renderMetar(weatherState.aviation || null);
  }
  if (histSelectedDate) renderClimate(histSelectedDate);
}

function propertyValue(feature, key) {
  return feature?.properties?.[key]?.value ?? null;
}

function point() {
  return selectedLocation;
}

// True when the selected location is one of the towns served by the local Tempest station.
function usesTempestStation(location = selectedLocation) {
  const name = (location?.name || "").toLowerCase();
  const town = name.split(",")[0].trim();
  const inPennsylvania = /\b(pa|pennsylvania)\b/.test(name);
  return inPennsylvania && TEMPEST_TOWNS.includes(town);
}

// Fetch latest current conditions from the local Tempest station (imperial units).
async function tempestCurrent() {
  const url = `https://swd.weatherflow.com/swd/rest/better_forecast?station_id=${TEMPEST_STATION_ID}` +
    `&token=${TEMPEST_TOKEN}&units_temp=f&units_wind=mph&units_pressure=inhg&units_distance=mi&units_other=imperial`;
  let data;
  try {
    data = await getJson(url);
  } catch {
    data = await getJson(`${WORKER_PROXY}${encodeURIComponent(url)}`);
  }
  const cc = data?.current_conditions;
  if (!cc) throw new Error("Tempest station returned no current conditions");
  return cc;
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
      ${rows.map(([term, desc, icon]) => `<div><dt>${icon ? uiIcon(icon) : ""}<span>${safeText(term)}</span></dt><dd>${safeText(desc)}</dd></div>`).join("")}
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
  const data = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=8&language=en&format=json`);
  return (data.results || []).map(item => ({
    lat: item.latitude,
    lon: item.longitude,
    name: [
      item.name,
      item.admin1,
      item.country_code && item.country_code !== "US" ? item.country_code : null,
    ].filter(Boolean).join(", "),
    timezone: item.timezone || "America/New_York",
    countryCode: item.country_code || null,
  }));
}

async function reverseGeocode(lat, lon) {
  try {
    const params = new URLSearchParams({ lat, lon, format: "json", addressdetails: "1", "accept-language": "en" });
    const data = await getJson(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: { "User-Agent": "WeatherPortal/1.0" },
    });
    const addr = data.address || {};
    const countryCode = (addr.country_code || "").toUpperCase() || null;
    const city = addr.city || addr.town || addr.village || addr.hamlet || "";
    const state = addr.state || "";
    let name;
    if (city && state) name = `${city}, ${state}`;
    else if (city) name = city;
    else name = data.display_name?.split(",").slice(0, 2).join(",").trim() || null;
    return { name, countryCode };
  } catch {
    return { name: null, countryCode: null };
  }
}

async function locateMe() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const geo = await reverseGeocode(lat, lon);
        const name = geo.name || `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`;
        resolve({ lat, lon, name, timezone: "auto", countryCode: geo.countryCode });
      },
      () => resolve(null),
      { timeout: 8000, maximumAge: 60000 }
    );
  });
}

function buildLocationPopup(name, extra = "") {
  const cur = weatherState.current || fallbackWeather.current;
  const temp = cur.temp != null ? fmtTemp(cur.temp) : "--";
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
  nwsAlertPolygonData = null;
  suppressNextAlertNotifications = true;
  setLocationBrand();
  locationInput.value = selectedLocation.name;
  hideLocationSuggestions();
  if (radarMap) {
    radarMap.flyTo({ center: [selectedLocation.lon, selectedLocation.lat], zoom: Math.max(radarMap.getZoom(), 8), duration: 900 });
    mapMarker?.setLngLat([selectedLocation.lon, selectedLocation.lat]);
  }
  await refreshLiveData();
  try { localStorage.setItem("weatherLastLocation", JSON.stringify(selectedLocation)); } catch {}
  if (notificationsEnabled()) {
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
  "TO.W": "Tornado Warning",     "TO.A": "Tornado Watch",
  "SV.W": "Severe Thunderstorm Warning", "SV.A": "Severe Thunderstorm Watch",
  "FF.W": "Flash Flood Warning", "FF.A": "Flash Flood Watch",
  "FA.W": "Flood Warning",       "FA.Y": "Flood Advisory",       "FA.A": "Flood Watch",
  "SQ.W": "Snow Squall Warning",
  "MA.W": "Special Marine Warning", "MA.A": "Special Marine Watch",
  "WS.W": "Winter Storm Warning", "WS.A": "Winter Storm Watch",   "WW.Y": "Winter Weather Advisory",
  "BZ.W": "Blizzard Warning",    "IS.W": "Ice Storm Warning",
  "ZR.Y": "Freezing Rain Advisory", "ZF.Y": "Freezing Fog Advisory",
  "LE.W": "Lake Effect Snow Warning", "LW.Y": "Lake Wind Advisory",
  "HT.Y": "Heat Advisory",       "EC.W": "Extreme Cold Warning",
  "WI.Y": "Wind Advisory",       "HW.W": "High Wind Warning",    "HW.A": "High Wind Watch",
  "EW.W": "Extreme Wind Warning",
  "DS.W": "Dust Storm Warning",  "DU.Y": "Blowing Dust Advisory",
  "SM.Y": "Dense Smoke Advisory", "FG.Y": "Dense Fog Advisory",
  "HZ.W": "Hard Freeze Warning", "FZ.W": "Freeze Warning",       "FZ.A": "Freeze Watch",
  "FR.Y": "Frost Advisory",
  "CF.W": "Coastal Flood Warning","CF.A": "Coastal Flood Watch",  "CF.Y": "Coastal Flood Advisory",
  "LS.W": "Lakeshore Flood Warning","LS.A": "Lakeshore Flood Watch","LS.Y": "Lakeshore Flood Advisory",
  "RP.S": "Rip Current Statement","SU.W": "High Surf Warning",    "SU.Y": "High Surf Advisory",
  "SC.Y": "Small Craft Advisory", "SW.Y": "Small Craft Advisory for Hazardous Seas",
  "GL.W": "Gale Warning",        "GL.A": "Gale Watch",
  "SR.W": "Storm Warning",       "SR.A": "Storm Watch",
  "SE.W": "Hazardous Seas Warning",
  "HU.W": "Hurricane Warning",   "HU.A": "Hurricane Watch",
  "TR.W": "Tropical Storm Warning","TR.A": "Tropical Storm Watch",
  "TS.W": "Tsunami Warning",     "TS.A": "Tsunami Watch",
  "AF.W": "Ashfall Warning",     "AF.Y": "Ashfall Advisory",
  "VO.W": "Volcano Warning",
  "UP.W": "Ice Accretion Warning","UP.Y": "Ice Accretion Advisory",
  "MH.W": "Mud/Landslide Warning","MH.Y": "Mud/Landslide Advisory",
};

const ALERT_PHENOMENA_COLORS = {
  TO: { fill: "#dc2626", line: "#ef4444" },
  SV: { fill: "#f97316", line: "#fb923c" },
  FF: { fill: "#10b981", line: "#34d399" },
  SQ: { fill: "#a78bfa", line: "#c4b5fd" },
  MA: { fill: "#38bdf8", line: "#7dd3fc" },
  // FA (Flood Advisory) intentionally excluded — not severe enough for map display
};

const NWS_ALERT_EVENT_COLORS = [
  [/tornado watch/i, { fill: "#a855f7", line: "#c084fc" }],
  [/severe thunderstorm watch/i, { fill: "#f59e0b", line: "#fbbf24" }],
  [/winter storm warning|ice storm warning|blizzard warning|lake effect snow warning/i, { fill: "#ec4899", line: "#f472b6" }],
  [/winter storm watch/i, { fill: "#3b82f6", line: "#60a5fa" }],
  [/winter weather advisory/i, { fill: "#38bdf8", line: "#7dd3fc" }],
  [/flood watch/i, { fill: "#14b8a6", line: "#2dd4bf" }],
  [/flood warning/i, { fill: "#22c55e", line: "#4ade80" }],
  [/flood advisory/i, { fill: "#10b981", line: "#34d399" }],
  [/(excessive|extreme) heat/i, { fill: "#c026d3", line: "#d946ef" }],
  [/heat advisory/i, { fill: "#f97316", line: "#fb923c" }],
  [/high wind warning/i, { fill: "#eab308", line: "#facc15" }],
  [/wind advisory/i, { fill: "#d97706", line: "#f59e0b" }],
  [/extreme cold|wind chill|cold weather advisory/i, { fill: "#06b6d4", line: "#22d3ee" }],
  [/frost advisory|freeze warning|freeze watch/i, { fill: "#67e8f9", line: "#a5f3fc" }],
  [/dense fog advisory/i, { fill: "#94a3b8", line: "#cbd5e1" }],
  [/red flag warning|fire weather watch/i, { fill: "#db2777", line: "#f472b6" }],
  [/air quality/i, { fill: "#9ca3af", line: "#d1d5db" }],
];

// Severity fallback so county/zone alerts without a dedicated event color
// still render on the alert overlay instead of being dropped.
const NWS_ALERT_SEVERITY_COLORS = {
  extreme: { fill: "#dc2626", line: "#ef4444" },
  severe: { fill: "#f97316", line: "#fb923c" },
  moderate: { fill: "#f59e0b", line: "#fbbf24" },
  minor: { fill: "#64748b", line: "#94a3b8" },
};

function nwsAlertColor(event = "", severity = "") {
  return NWS_ALERT_EVENT_COLORS.find(([pattern]) => pattern.test(event))?.[1]
    || NWS_ALERT_SEVERITY_COLORS[String(severity).toLowerCase()]
    || NWS_ALERT_SEVERITY_COLORS.minor;
}

// Color lookup shared by US and Canadian alerts. The storm-based warning types
// keep their IEM layer colors (ALERT_PHENOMENA_COLORS); everything else goes
// through the NWS event/severity tables. Routing every alert through one
// function keeps ECCC polygons on the same palette as their US counterparts.
const STORM_BASED_EVENT_CODES = [
  [/tornado warning/i, "TO"],
  [/severe thunderstorm warning/i, "SV"],
  [/flash flood warning/i, "FF"],
  [/snow squall warning/i, "SQ"],
  [/special marine warning/i, "MA"],
];

function alertEventColor(event = "", severity = "") {
  const code = STORM_BASED_EVENT_CODES.find(([pattern]) => pattern.test(event))?.[1];
  return (code && ALERT_PHENOMENA_COLORS[code]) || nwsAlertColor(event, severity);
}

// Coarse alert class used by the map overlay filter. ECCC supplies an explicit
// alert_type; NWS events classify by name (statements, outlooks, and
// advisories all land in the "advisory" bucket).
function alertKindFor(event = "", alertType = "") {
  const type = String(alertType).toLowerCase();
  if (type === "warning") return "warning";
  if (type === "watch") return "watch";
  if (type) return "advisory";
  if (/\bwarning\b/i.test(event)) return "warning";
  if (/\bwatch\b/i.test(event)) return "watch";
  return "advisory";
}

function isWarningEvent(event = "") {
  return /\bwarning\b/i.test(event);
}

// Warning types the IEM storm-based-warning feed carries (and that the map's
// IEM layer already draws). Other warnings — winter storm, high wind, flood,
// heat, etc. — are county/zone based and only exist in the NWS feed, so they
// must not be filtered out with a blanket "warning" test.
function isStormBasedWarning(event = "") {
  return /\b(tornado|severe thunderstorm|flash flood|snow squall|special marine)\s+warning\b/i.test(event);
}

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

// Normalizes wind tag values from any source ("60", "60 MPH", "60 mph") to a
// consistent lowercase "60 mph" so the same threat never renders twice in
// mismatched casing.
function formatWindTag(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const number = text.match(/\d+(\.\d+)?/);
  return number ? `${number[0]} mph` : text.toLowerCase();
}

// Same normalization for hail sizes ("1.75", '1.75"', "1.75 IN") → "1.75 in".
function formatHailTag(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const number = text.match(/\d+(\.\d+)?/);
  return number ? `${number[0]} in` : text.toLowerCase();
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

function isDetectionTag(value) {
  return /observed|radar indicated/i.test(String(value || ""));
}

// Watches indicate a supportive environment — nothing severe is actually
// occurring yet — so they never rank or style as Extreme even when a feed
// labels them that way. Warnings keep whatever severity the feed assigns.
function clampWatchSeverity(event = "", severity = "") {
  if (/\bwatch\b/i.test(event) && /^extreme$/i.test(severity)) return "Severe";
  return severity;
}

function normalizeAlertTag(value) {
  const text = String(value || "").replace(/_/g, " ").trim();
  if (!text) return "";
  if (/observed/i.test(text)) return "Observed";
  if (/radar indicated/i.test(text)) return "Radar indicated";
  if (/^considerable$/i.test(text)) return "Considerable threat";
  if (/^destructive$/i.test(text)) return "Destructive";
  if (/^catastrophic$/i.test(text)) return "Emergency";
  return text;
}

function normalizeNwsAlert(feature) {
  const p = feature.properties || {};
  return {
    id: feature.id || p.id,
    event: p.event || "Weather Alert",
    headline: p.headline || p.event || "Weather Alert",
    severity: clampWatchSeverity(p.event, p.severity || "Unknown"),
    urgency: p.urgency || "Unknown",
    effective: p.effective,
    expires: p.expires,
    description: p.description || "",
    instruction: p.instruction || "",
    parameters: p.parameters || {},
    areaDesc: p.areaDesc || "",
    source: "NWS",
    affectedZones: p.affectedZones || [],
  };
}

function alertDedupeKey(alert) {
  return [
    String(alert.id || "").replace(/\/actual$/i, ""),
    alert.event || "",
    alert.expires || "",
    alert.areaDesc || "",
  ].join("|").toLowerCase();
}

function mergeAlerts(...groups) {
  const seen = new Set();
  return groups.flat().filter(alert => {
    const key = alertDedupeKey(alert);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tagsForAlert(alert) {
  const p = alert.parameters || {};
  const detectionTag = severeDetectionTag(alert);
  // IEM storm-based warnings are enriched with the matching NWS alert's CAP
  // parameters (see alertsPayload), so both sources can describe the same
  // hazard. Read each hazard from one source with the other as fallback —
  // listing both produced duplicate Wind/Hail/Damage chips in mixed casing.
  const windTag   = p.maxWindGust?.[0] ?? alert.iem_windtag;
  const hailTag   = p.maxHailSize?.[0] ?? alert.iem_hailtag;
  const damageTag = p.thunderstormDamageThreat?.[0] ?? alert.iem_damagetag;
  const floodTag  = p.flashFloodDamageThreat?.[0] ?? alert.iem_floodtag;
  const tornadoTag = p.tornadoDetection?.[0] ?? alert.iem_tornadotag;
  // The CAP severity ("Extreme"/"Severe"/"Moderate"...) is intentionally NOT
  // shown as a chip — it only drives alert ranking and card styling.
  const raw = [
    tornadoTag && (isDetectionTag(tornadoTag) ? tornadoTag : `Tornado ${String(tornadoTag).toLowerCase()}`),
    damageTag,
    p.flashFloodDetection?.[0],
    floodTag,
    windTag && `Wind ${formatWindTag(windTag)}`,
    hailTag && `Hail ${formatHailTag(hailTag)}`,
    detectionTag,
    alert.iem_is_pds && "PDS",
    alert.iem_is_emergency && "Emergency",
  ].filter(Boolean);
  const seen = new Set();
  return raw.map(normalizeAlertTag).filter(item => {
    const key = item.toLowerCase();
    if (!item || seen.has(key) || key === "immediate") return false;
    seen.add(key);
    return true;
  });
}

function iemEventSeverity(eventName) {
  const e = (eventName || "").toLowerCase();
  if (/tornado warning/.test(e)) return "Extreme";
  if (/warning/.test(e)) return "Severe";
  if (/watch/.test(e)) return "Moderate";
  return "Minor";
}

function normalizeIemFeature(feature) {
  const p = feature.properties || {};
  const key = `${p.phenomena}.${p.significance}`;
  const text = [p.product_text, p.producttext, p.product_narrative, p.narrative].filter(Boolean).join("\n\n");
  const eventName = iemPhenomenaMap[key] || key;
  return {
    id: p.uri || p.id || `${key}-${p.issue}`,
    event: eventName,
    headline: eventName || p.product_id || "Storm-Based Warning",
    severity: iemEventSeverity(eventName),
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

// ─── ECCC (Environment and Climate Change Canada) weather alerts ──────────────
const ECCC_ALERTS_URL = "https://api.weather.gc.ca/collections/weather-alerts/items";

// Rough Canada bounding box — used only to decide when ECCC is worth querying,
// so overlap with northern US states is harmless (the bbox query simply returns
// nothing for points outside Canadian alert polygons).
function isInCanada(lat, lon) {
  return lat >= 41.5 && lat <= 84 && lon >= -141.1 && lon <= -52.0;
}

// Accurate Canada check used to route forecasts/current conditions to
// Environment Canada. isInCanada()'s bbox deliberately overlaps the northern US
// (harmless for alert queries) so it must NOT pick a forecast provider. Prefer
// the country code captured during geocoding/reverse-geocoding, falling back to
// the ", CA" suffix the location search appends to Canadian results.
function isCanadianLocation(location = selectedLocation) {
  const cc = (location?.countryCode || "").toUpperCase();
  if (cc) return cc === "CA";
  const name = location?.name || "";
  return /,\s*CA$/i.test(name) || /\bcanada\b/i.test(name);
}

// Longitude-based IANA timezone fallback for Canadian points whose stored
// timezone is missing or "auto" (e.g. GPS-located points).
function canadianTimezone(lon) {
  if (lon == null) return "America/Toronto";
  if (lon >= -60) return "America/St_Johns";
  if (lon >= -68) return "America/Halifax";
  if (lon >= -90) return "America/Toronto";
  if (lon >= -102) return "America/Winnipeg";
  if (lon >= -114) return "America/Edmonton";
  return "America/Vancouver";
}

function alertAgencyLabel(location = selectedLocation) {
  return isInCanada(location?.lat, location?.lon) ? "ECCC" : "NWS";
}

function titleCaseAlertName(name = "") {
  return String(name).replace(/\w\S*/g, word => word.charAt(0).toUpperCase() + word.slice(1));
}

function ecccSeverity(p) {
  const colour = String(p.risk_colour_en || "").toLowerCase();
  if (colour === "red") return "Extreme";
  if (colour === "orange") return "Severe";
  const type = String(p.alert_type || "").toLowerCase();
  if (type === "warning") return "Severe";
  if (type === "watch" || colour === "yellow") return "Moderate";
  return "Minor";
}

// The feed's id field embeds the publication batch, so the same alert gets a
// brand-new id every time ECCC republishes the collection — which re-fired
// foreground notifications for unchanged alerts. Build an id from fields that
// only change when the alert itself is reissued.
function ecccStableAlertId(p = {}) {
  return ["eccc", p.alert_code || p.alert_name_en || "alert",
    p.feature_name_en || "", p.validity_datetime || p.publication_datetime || ""].join("|");
}

// Canadian alert text shares one free-form format across event types, so no
// hazard tags are derived for ECCC alerts (unlike NWS/IEM parameters).
function normalizeEcccAlert(feature) {
  const p = feature.properties || {};
  const event = titleCaseAlertName(p.alert_name_en || "Weather Alert");
  return {
    id: ecccStableAlertId(p),
    event,
    headline: p.feature_name_en ? `${event} for ${p.feature_name_en}` : event,
    severity: clampWatchSeverity(event, ecccSeverity(p)),
    urgency: String(p.alert_type || "").toLowerCase() === "warning" ? "Immediate" : "Expected",
    effective: p.validity_datetime || p.publication_datetime,
    expires: p.expiration_datetime || p.event_end_datetime,
    description: p.alert_text_en || "",
    instruction: "",
    parameters: {},
    areaDesc: [p.feature_name_en, p.province].filter(Boolean).join(", "),
    source: "ECCC",
    affectedZones: [],
  };
}

// The weather-alerts collection keeps alerts around after they end (status_en
// "ended", or an expiration already in the past), so filter to the ones ECCC
// still shows as in effect.
function isActiveEcccAlert(p = {}) {
  if (String(p.status_en || "").toLowerCase() === "ended") return false;
  const expires = p.expiration_datetime || p.event_end_datetime;
  return !expires || new Date(expires).getTime() > Date.now();
}

async function ecccAlertsPayload(lat, lon) {
  if (!isInCanada(lat, lon)) return [];
  const d = 0.05;
  const bbox = `${lon - d},${lat - d},${lon + d},${lat + d}`;
  const data = await getJson(`${ECCC_ALERTS_URL}?f=json&lang=en&bbox=${bbox}&limit=100`);
  return (data.features || [])
    .filter(feature => isActiveEcccAlert(feature.properties) && pointInGeometry(lon, lat, feature.geometry))
    .map(normalizeEcccAlert);
}

async function alertsPayload(lat, lon) {
  const [iemResult, nwsResult, ecccResult] = await Promise.allSettled([
    getJson("https://mesonet.agron.iastate.edu/geojson/sbw.geojson"),
    getJson(`https://api.weather.gov/alerts/active?point=${lat},${lon}`),
    ecccAlertsPayload(lat, lon),
  ]);
  const allNwsFeatures = nwsResult.status === "fulfilled" ? (nwsResult.value.features || []) : [];
  const nwsWarningsByEvent = new Map();
  allNwsFeatures
    .map(normalizeNwsAlert)
    .filter(alert => isWarningEvent(alert.event) && alert.description)
    .forEach(alert => { if (!nwsWarningsByEvent.has(alert.event)) nwsWarningsByEvent.set(alert.event, alert); });
  const iemAlerts = iemResult.status === "fulfilled"
    ? (iemResult.value.features || [])
      .filter(feature => pointInGeometry(lon, lat, feature.geometry))
      .map(normalizeIemFeature)
      .map(alert => {
        const nwsMatch = nwsWarningsByEvent.get(alert.event);
        if (nwsMatch) {
          return {
            ...alert,
            description: nwsMatch.description || alert.description,
            parameters: nwsMatch.parameters || {},
          };
        }
        return alert;
      })
    : [];
  // Keep county/zone warnings (winter storm, high wind, flood...) that the
  // storm-based feed doesn't carry; drop only warnings IEM already supplies.
  const iemEvents = new Set(iemAlerts.map(alert => String(alert.event || "").toLowerCase()));
  const nwsAlerts = allNwsFeatures
    .map(normalizeNwsAlert)
    .filter(alert => !isStormBasedWarning(alert.event) &&
      !(isWarningEvent(alert.event) && iemEvents.has(String(alert.event).toLowerCase())));
  const ecccAlerts = ecccResult.status === "fulfilled" ? ecccResult.value : [];
  const alerts = mergeAlerts(iemAlerts, nwsAlerts, ecccAlerts).map(alert => ({
    ...alert,
    tags: alert.source === "ECCC" ? [] : tagsForAlert(alert),
  }));
  const sources = [
    iemResult.status === "fulfilled" && "IEM storm-based warnings",
    nwsResult.status === "fulfilled" && "NWS watches/advisories",
    isInCanada(lat, lon) && ecccResult.status === "fulfilled" && "ECCC alerts",
  ].filter(Boolean);
  return {
    alerts,
    source: sources.join(" + ") || "Alerts unavailable",
  };
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
  const today = localDateISO(new Date(), tz);
  const tomorrow = localDateISO(new Date(Date.now() + 24 * 60 * 60 * 1000), tz);
  const dates = [...new Set([today, tomorrow])];
  const entries = await Promise.all(dates.map(async date => {
    const data = await getJson(`https://api.sunrise-sunset.org/json?lat=${loc.lat}&lng=${loc.lon}&date=${date}&formatted=0`);
    return [date, {
      sunriseDate: new Date(data.results.sunrise),
      sunsetDate: new Date(data.results.sunset),
    }];
  }));
  currentSunTimesByDate = new Map(entries);
  const todayTimes = currentSunTimesByDate.get(today) || entries[0]?.[1];
  // Store today's actual Date objects for theme logic.
  currentSunrise = todayTimes?.sunriseDate || null;
  currentSunset  = todayTimes?.sunsetDate || null;
  return {
    sunrise: currentSunrise ? currentSunrise.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }) : "--",
    sunset:  currentSunset ? currentSunset.toLocaleTimeString("en-US",  { timeZone: tz, hour: "numeric", minute: "2-digit" }) : "--",
    sunriseDate: currentSunrise,
    sunsetDate: currentSunset,
    sunTimesByDate: Object.fromEntries(currentSunTimesByDate),
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
    days: "5",
  });
  const data = await getJson(`https://pollen.googleapis.com/v1/forecast:lookup?${params}`);
  return (data.dailyInfo || []).map(day => {
    const types = (day.pollenTypeInfo || [])
      .filter(t => t.indexInfo)
      .sort((a, b) => (b.indexInfo?.value || 0) - (a.indexInfo?.value || 0));
    const top = types[0];
    if (!top) return null;
    return {
      label: `${top.displayName || top.code} ${top.indexInfo?.category || ""}`.trim(),
      detail: types.slice(0, 3).map(t => `${t.displayName || t.code}: ${t.indexInfo?.category || "n/a"}`).join(" | "),
      value: top.indexInfo?.value ?? 0,
      category: top.indexInfo?.category || "Unknown",
    };
  }).filter(Boolean);
}

async function weatherPayload() {
  const loc = point();
  const gridPoint = await getJson(`https://api.weather.gov/points/${loc.lat},${loc.lon}`);
  const props = gridPoint.properties;
  selectedLocation.timezone = props.timeZone || loc.timezone || "America/New_York";
  const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=uv_index&daily=uv_index_max,apparent_temperature_max,apparent_temperature_min&temperature_unit=fahrenheit&timezone=${encodeURIComponent(selectedLocation.timezone)}`;
  const [forecast, hourly, stations, alertsData, openMeteo, airQuality, pollen, astronomy, tempest] = await Promise.all([
    getJson(props.forecast),
    getJson(props.forecastHourly),
    getJson(props.observationStations),
    alertsPayload(loc.lat, loc.lon).catch(() => ({ alerts: [], source: "Unavailable" })),
    getJson(openMeteoUrl).catch(() => null),
    airQualityPayload().catch(error => ({ label: "Unavailable", detail: `Open-Meteo air quality ${error.message}` })),
    pollenPayload().catch(() => null),
    astronomyPayload().catch(() => null),
    usesTempestStation(loc) ? tempestCurrent().catch(() => null) : Promise.resolve(null),
  ]);
  const station = stations.features?.[0];
  const stationId = station?.properties?.stationIdentifier;
  if (!stationId) throw new Error("No NWS observation station found nearby");
  const observation = await getJson(`https://api.weather.gov/stations/${stationId}/observations/latest`);
  const p = observation.properties || {};
  const firstHour = hourly.properties?.periods?.[0] || {};
  const firstDay = forecast.properties?.periods?.[0] || {};
  let temp = fahrenheit(propertyValue(observation, "temperature")) ?? firstHour.temperature;
  let dewPoint = fahrenheit(propertyValue(observation, "dewpoint"));
  let wind = mph(propertyValue(observation, "windSpeed")) ?? parseInt(firstHour.windSpeed, 10);
  let gust = mph(propertyValue(observation, "windGust")) ?? wind;
  let pressure = paToInHg(propertyValue(observation, "barometricPressure"));
  const visibility = metersToMiles(propertyValue(observation, "visibility"));
  let humidity = propertyValue(observation, "relativeHumidity");
  let condition = p.textDescription || firstHour.shortForecast || firstDay.shortForecast;
  let uv = openMeteo?.current?.uv_index ?? null;
  let updated = p.timestamp;
  let currentSource = "NWS";

  // For Ephrata-area towns, override current conditions with the local Tempest station readings.
  if (tempest) {
    if (Number.isFinite(tempest.air_temperature)) temp = Math.round(tempest.air_temperature);
    if (Number.isFinite(tempest.dew_point)) dewPoint = Math.round(tempest.dew_point);
    if (Number.isFinite(tempest.relative_humidity)) humidity = tempest.relative_humidity;
    if (Number.isFinite(tempest.wind_avg)) wind = Math.round(tempest.wind_avg);
    if (Number.isFinite(tempest.wind_gust)) gust = Math.round(tempest.wind_gust);
    const tempestPressure = tempest.sea_level_pressure ?? tempest.station_pressure;
    if (Number.isFinite(tempestPressure)) pressure = tempestPressure;
    if (Number.isFinite(tempest.uv)) uv = tempest.uv;
    if (tempest.conditions) condition = tempest.conditions;
    if (Number.isFinite(tempest.time)) updated = new Date(tempest.time * 1000).toISOString();
    currentSource = "Tempest station";
  }

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
      uv,
      pollen: Array.isArray(pollen) ? pollen[0]?.label || null : pollen?.label || null,
      pollenDetail: Array.isArray(pollen) ? pollen[0]?.detail || null : pollen?.detail || null,
      airQuality: airQuality?.label || "Unavailable",
      airQualityDetail: airQuality?.detail || "Open-Meteo air quality unavailable",
      visibility: visibility == null ? null : Number(visibility.toFixed(1)),
      pressure,
      updated,
      source: currentSource,
    },
    hourly: hourly.properties?.periods || [],
    daily: forecast.properties?.periods || [],
    dailyExtras: openMeteo?.daily || {},
    alerts: alertsData.alerts || [],
    alertSource: alertsData.source || "NWS",
    pollenForecast: Array.isArray(pollen) ? pollen : [],
    astronomy,
    sources: tempest
      ? ["Tempest station " + TEMPEST_STATION_ID, "api.weather.gov", "api.open-meteo.com", "pollen.googleapis.com"]
      : ["api.weather.gov", "api.open-meteo.com", "pollen.googleapis.com"],
  };
}

// Full forecast payload from Open-Meteo, shaped like the NWS payload so every
// renderer works unchanged. Used for international locations and whenever the
// NWS pipeline fails.
async function openMeteoWeatherPayload() {
  const loc = point();
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,dew_point_2m,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index` +
    `&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,visibility` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant,uv_index_max,apparent_temperature_max,apparent_temperature_min` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=8&timeformat=unixtime&timezone=auto`;
  const data = await getJson(url);
  selectedLocation.timezone = data.timezone || loc.timezone || "America/New_York";
  const tz = selectedLocation.timezone;

  const [alertsData, airQuality, pollen, astronomy] = await Promise.all([
    alertsPayload(loc.lat, loc.lon).catch(() => ({ alerts: [], source: "Unavailable" })),
    airQualityPayload().catch(error => ({ label: "Unavailable", detail: `Open-Meteo air quality ${error.message}` })),
    pollenPayload().catch(() => null),
    astronomyPayload().catch(() => null),
  ]);

  const hi = data.hourly || {};
  const nowSec = Date.now() / 1000;
  let startIdx = (hi.time || []).findIndex(t => t >= nowSec - 3600);
  if (startIdx < 0) startIdx = 0;
  const hourly = (hi.time || []).slice(startIdx, startIdx + 48).map((t, k) => {
    const i = startIdx + k;
    return {
      startTime: new Date(t * 1000).toISOString(),
      temperature: hi.temperature_2m?.[i] != null ? Math.round(hi.temperature_2m[i]) : null,
      shortForecast: wmoDescription(hi.weather_code?.[i]),
      windSpeed: hi.wind_speed_10m?.[i] != null ? `${Math.round(hi.wind_speed_10m[i])} mph` : null,
      windGust: hi.wind_gusts_10m?.[i] != null ? `${Math.round(hi.wind_gusts_10m[i])} mph` : null,
      windDirection: windDirLabel(hi.wind_direction_10m?.[i]),
      probabilityOfPrecipitation: { value: hi.precipitation_probability?.[i] ?? null },
      relativeHumidity: { value: hi.relative_humidity_2m?.[i] ?? null },
      // Renderers expect NWS-style dewpoint in Celsius
      dewpoint: { value: hi.dew_point_2m?.[i] != null ? (hi.dew_point_2m[i] - 32) * 5 / 9 : null },
      isDaytime: true,
    };
  });

  const di = data.daily || {};
  const daily = [];
  (di.time || []).slice(0, 7).forEach((t, i) => {
    const startTime = new Date(t * 1000).toISOString();
    const weekday = new Date(t * 1000).toLocaleDateString("en-US", { weekday: "long", timeZone: tz });
    const base = {
      startTime,
      windSpeed: di.wind_speed_10m_max?.[i] != null ? `${Math.round(di.wind_speed_10m_max[i])} mph` : null,
      windDirection: windDirLabel(di.wind_direction_10m_dominant?.[i]),
      shortForecast: wmoDescription(di.weather_code?.[i]),
      detailedForecast: "",
      probabilityOfPrecipitation: { value: di.precipitation_probability_max?.[i] ?? null },
    };
    daily.push({ ...base, name: i === 0 ? "Today" : weekday, isDaytime: true,
      temperature: di.temperature_2m_max?.[i] != null ? Math.round(di.temperature_2m_max[i]) : null });
    daily.push({ ...base, name: i === 0 ? "Tonight" : `${weekday} Night`, isDaytime: false,
      temperature: di.temperature_2m_min?.[i] != null ? Math.round(di.temperature_2m_min[i]) : null });
  });

  const cur = data.current || {};
  const condition = wmoDescription(cur.weather_code);
  const firstDay = daily[0] || {};
  const visibilityMeters = hi.visibility?.[startIdx];
  const visibility = metersToMiles(visibilityMeters);

  return {
    current: {
      temp: cur.temperature_2m != null ? Math.round(cur.temperature_2m) : null,
      condition,
      headline: headlineFor(condition, firstDay),
      summary: firstDay.shortForecast || condition,
      humidity: cur.relative_humidity_2m == null ? null : Math.round(cur.relative_humidity_2m),
      dewPoint: cur.dew_point_2m != null ? Math.round(cur.dew_point_2m) : null,
      wind: cur.wind_speed_10m != null ? Math.round(cur.wind_speed_10m) : null,
      gust: cur.wind_gusts_10m != null ? Math.round(cur.wind_gusts_10m) : null,
      uv: cur.uv_index ?? null,
      pollen: Array.isArray(pollen) ? pollen[0]?.label || null : pollen?.label || null,
      pollenDetail: Array.isArray(pollen) ? pollen[0]?.detail || null : pollen?.detail || null,
      airQuality: airQuality?.label || "Unavailable",
      airQualityDetail: airQuality?.detail || "Open-Meteo air quality unavailable",
      visibility: visibility == null ? null : Number(visibility.toFixed(1)),
      pressure: cur.pressure_msl != null ? cur.pressure_msl * 0.02953 : null,
      updated: cur.time != null ? new Date(cur.time * 1000).toISOString() : new Date().toISOString(),
      source: "Open-Meteo",
    },
    hourly,
    daily,
    dailyExtras: {
      apparent_temperature_max: di.apparent_temperature_max || [],
      apparent_temperature_min: di.apparent_temperature_min || [],
      uv_index_max: di.uv_index_max || [],
    },
    alerts: alertsData.alerts || [],
    alertSource: alertsData.source || "Unavailable",
    pollenForecast: Array.isArray(pollen) ? pollen : [],
    astronomy,
    sources: ["api.open-meteo.com", "pollen.googleapis.com"],
  };
}

// ─── Environment Canada (api.weather.gc.ca) forecasts & current conditions ────
// The citypageweather feed holds one feature per Canadian city. We pick the city
// nearest the selected point and reshape it into the NWS-style payload so every
// renderer works unchanged. Used for Canadian locations, where Open-Meteo has
// proven unreliable.
const CITYPAGE_URL = "https://api.weather.gc.ca/collections/citypageweather-realtime/items";

// ECCC wraps measurements as { value: { en, fr } } and text as { en, fr }.
function gcVal(node) { return node?.value?.en ?? null; }
function gcEn(node)  { return node?.en ?? null; }

function nearestCityFeature(features, lat, lon) {
  let best = null, bestDist = Infinity;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (const feature of features) {
    const c = feature.geometry?.coordinates;
    if (!Array.isArray(c) || c.length < 2) continue;
    const dLat = c[1] - lat;
    const dLon = (c[0] - lon) * cosLat;
    const dist = dLat * dLat + dLon * dLon;
    if (dist < bestDist) { bestDist = dist; best = feature; }
  }
  return best;
}

async function canadaWeatherPayload() {
  const loc = point();
  const d = 2.5;
  const bbox = `${loc.lon - d},${loc.lat - d},${loc.lon + d},${loc.lat + d}`;
  const data = await getJson(`${CITYPAGE_URL}?lang=en&f=json&bbox=${bbox}&limit=200`);
  const feature = nearestCityFeature(data.features || [], loc.lat, loc.lon);
  if (!feature) throw new Error("No Environment Canada city forecast found nearby");
  const props = feature.properties || {};
  const cc = props.currentConditions || {};

  selectedLocation.timezone = (loc.timezone && loc.timezone !== "auto")
    ? loc.timezone : canadianTimezone(loc.lon);

  const [alertsData, airQuality, pollen, astronomy] = await Promise.all([
    alertsPayload(loc.lat, loc.lon).catch(() => ({ alerts: [], source: "Unavailable" })),
    airQualityPayload().catch(error => ({ label: "Unavailable", detail: `Open-Meteo air quality ${error.message}` })),
    pollenPayload().catch(() => null),
    astronomyPayload().catch(() => null),
  ]);

  // Daily forecast — ECCC already alternates day/night periods, matching the NWS
  // period layout the renderers expect.
  const daily = (props.forecastGroup?.forecasts || []).map(fc => {
    const tempObj = fc.temperatures?.temperature?.[0];
    const name = gcEn(fc.period?.textForecastName) || "";
    const isDaytime = tempObj?.class?.en
      ? tempObj.class.en === "high"
      : !/night/i.test(name);
    const windPeriod = fc.winds?.periods?.[0];
    return {
      startTime: null,
      name,
      isDaytime,
      temperature: fahrenheit(gcVal(tempObj)),
      windSpeed: gcVal(windPeriod?.speed) != null ? `${mph(gcVal(windPeriod.speed))} mph` : null,
      windDirection: windPeriod?.direction?.en || "--",
      shortForecast: gcEn(fc.abbreviatedForecast?.textSummary) || "",
      detailedForecast: gcEn(fc.textSummary) || "",
      probabilityOfPrecipitation: { value: null },
    };
  });

  // Hourly forecast (~24 hours). ECCC omits hourly humidity/dewpoint.
  const hourly = (props.hourlyForecastGroup?.hourlyForecasts || []).map(h => ({
    startTime: h.timestamp || null,
    temperature: fahrenheit(gcVal(h.temperature)),
    shortForecast: gcEn(h.condition) || "",
    windSpeed: gcVal(h.wind?.speed) != null ? `${mph(gcVal(h.wind.speed))} mph` : null,
    windGust: gcVal(h.wind?.gust) != null ? `${mph(gcVal(h.wind.gust))} mph` : null,
    windDirection: gcEn(h.wind?.direction) || "--",
    probabilityOfPrecipitation: { value: gcVal(h.lop) },
    relativeHumidity: { value: null },
    dewpoint: { value: null },
    isDaytime: true,
  }));

  const condition = gcEn(cc.condition) || daily[0]?.shortForecast || "Live weather";
  const firstDay = daily[0] || {};
  const pressureKpa = gcVal(cc.pressure);
  // Current conditions carry no UV; borrow it from the nearest forecast hour,
  // then today's daily forecast (where the index is a plain text node).
  const hourlyUv = gcVal(props.hourlyForecastGroup?.hourlyForecasts?.[0]?.uv?.index);
  const dailyUvRaw = gcEn(props.forecastGroup?.forecasts?.[0]?.uv?.index);
  const dailyUv = dailyUvRaw != null && Number.isFinite(Number(dailyUvRaw)) ? Number(dailyUvRaw) : null;
  const uv = hourlyUv ?? dailyUv;

  return {
    current: {
      temp: fahrenheit(gcVal(cc.temperature)),
      condition,
      headline: headlineFor(condition, firstDay),
      summary: firstDay.detailedForecast || firstDay.shortForecast || condition,
      humidity: gcVal(cc.relativeHumidity) == null ? null : Math.round(gcVal(cc.relativeHumidity)),
      dewPoint: fahrenheit(gcVal(cc.dewpoint)),
      wind: mph(gcVal(cc.wind?.speed)),
      gust: mph(gcVal(cc.wind?.gust)),
      uv,
      pollen: Array.isArray(pollen) ? pollen[0]?.label || null : pollen?.label || null,
      pollenDetail: Array.isArray(pollen) ? pollen[0]?.detail || null : pollen?.detail || null,
      airQuality: airQuality?.label || "Unavailable",
      airQualityDetail: airQuality?.detail || "Open-Meteo air quality unavailable",
      visibility: null,
      pressure: pressureKpa == null ? null : pressureKpa * 0.2953,
      updated: gcEn(cc.timestamp) || new Date().toISOString(),
      source: "Environment Canada",
    },
    hourly,
    daily,
    dailyExtras: {},
    alerts: alertsData.alerts || [],
    alertSource: alertsData.source || "ECCC",
    pollenForecast: Array.isArray(pollen) ? pollen : [],
    astronomy,
    sources: ["api.weather.gc.ca", "pollen.googleapis.com"],
  };
}

// Choose the best forecast provider for the selected location: Environment
// Canada for Canada, NWS for the US, with Open-Meteo as the universal fallback.
async function primaryWeatherPayload() {
  if (isCanadianLocation()) {
    try {
      return await canadaWeatherPayload();
    } catch (error) {
      console.warn("Environment Canada forecast unavailable, falling back to Open-Meteo", error);
      return openMeteoWeatherPayload();
    }
  }
  try {
    return await weatherPayload();
  } catch (error) {
    console.warn("NWS forecast unavailable, falling back to Open-Meteo", error);
    return openMeteoWeatherPayload();
  }
}

async function aviationPayload() {
  let stationId, stationName;
  if (metarStationOverride) {
    stationId = metarStationOverride.toUpperCase();
    stationName = stationId;
  } else {
    const loc = point();
    const gridPoint = await getJson(`https://api.weather.gov/points/${loc.lat},${loc.lon}`);
    const stations = await getJson(gridPoint.properties.observationStations);
    const station = stations.features?.[0];
    stationId = station?.properties?.stationIdentifier;
    if (!stationId) throw new Error("No NWS aviation station found nearby");
    stationName = station?.properties?.name || stationId;
  }
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
    "cloud_cover_mean","pressure_msl_mean",
    "sunshine_duration","uv_index_max",
    "sunrise","sunset",
  ].join(",");
  const hourly = [
    "temperature_2m","precipitation","weather_code",
    "wind_speed_10m","wind_direction_10m",
    "relative_humidity_2m","dew_point_2m",
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
    fetchOutlookGeoJson(SPC_URLS.cat[0]),
    fetchOutlookGeoJson(SPC_URLS.torn[0]),
    fetchOutlookGeoJson(SPC_URLS.wind[0]),
    fetchOutlookGeoJson(SPC_URLS.hail[0]),
    fetchDroughtGeoJson(),
  ]);
  const getHighestCatFeature = result => {
    if (result.status !== "fulfilled") return null;
    const matches = (normalizeSpcData(result.value).features || [])
      .filter(f => pointInGeometry(loc.lon, loc.lat, f.geometry));
    if (!matches.length) return null;
    return matches.reduce((best, f) =>
      (SPC_CAT_RANK[f.properties?.LABEL] || 0) > (SPC_CAT_RANK[best.properties?.LABEL] || 0) ? f : best
    );
  };
  const getHighestProbFeature = result => {
    if (result.status !== "fulfilled") return null;
    const matches = (normalizeSpcData(result.value).features || [])
      .filter(f => pointInGeometry(loc.lon, loc.lat, f.geometry))
      .filter(f => f.properties?.RISK_NUM != null);
    if (!matches.length) return null;
    return matches.reduce((best, f) =>
      f.properties.RISK_NUM > best.properties.RISK_NUM ? f : best
    );
  };
  const spcCat = getHighestCatFeature(catResult);
  const spcTorn = getHighestProbFeature(tornResult);
  const spcWind = getHighestProbFeature(windResult);
  const spcHail = getHighestProbFeature(hailResult);
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

async function spcForecastPayload() {
  const loc = point();

  const parseCigNum = (label) => {
    const m = String(label || "").toUpperCase().match(/^CIG([123])$/);
    return m ? parseInt(m[1], 10) : null;
  };

  // Returns { risk, cig } for a hazard-type GeoJSON — a single file can contain
  // both probability polygons (numeric LABEL) and CIG polygons (label "CIG1"–"CIG3"),
  // and each has its own independent coverage at a given location.
  const extractHazard = (raw) => {
    if (!raw) return { risk: null, cig: null };
    const allProps = (normalizeSpcData(raw).features || [])
      .filter(f => pointInGeometry(loc.lon, loc.lat, f.geometry))
      .map(f => f.properties);
    const riskProps = allProps
      .filter(p => p.RISK_NUM != null)
      .reduce((best, p) => p.RISK_NUM > (best?.RISK_NUM ?? -Infinity) ? p : best, null);
    const cigProps  = allProps.find(p => parseCigNum(p.LABEL) != null);
    return {
      risk: riskProps?.RISK_NUM ?? null,
      cig:  cigProps ? parseCigNum(cigProps.LABEL) : null,
    };
  };

  const findCatLabel = (raw) => {
    if (!raw) return null;
    const matches = (normalizeSpcData(raw).features || [])
      .filter(f => pointInGeometry(loc.lon, loc.lat, f.geometry));
    if (!matches.length) return null;
    return matches.reduce((best, f) =>
      (SPC_CAT_RANK[f.properties?.LABEL] || 0) > (SPC_CAT_RANK[best.properties?.LABEL] || 0) ? f : best
    ).properties?.LABEL || null;
  };

  const [cat1, cat2, torn1, wind1, hail1, torn2, wind2, hail2] = await Promise.all([
    fetchOutlookGeoJson(SPC_URLS.cat[0]).catch(() => null),
    fetchOutlookGeoJson(SPC_URLS.cat[1]).catch(() => null),
    fetchOutlookGeoJson(SPC_URLS.torn[0]).catch(() => null),
    fetchOutlookGeoJson(SPC_URLS.wind[0]).catch(() => null),
    fetchOutlookGeoJson(SPC_URLS.hail[0]).catch(() => null),
    fetchOutlookGeoJson(SPC_URLS.torn[1]).catch(() => null),
    fetchOutlookGeoJson(SPC_URLS.wind[1]).catch(() => null),
    fetchOutlookGeoJson(SPC_URLS.hail[1]).catch(() => null),
  ]);

  const t1 = extractHazard(torn1), w1 = extractHazard(wind1), h1 = extractHazard(hail1);
  const t2 = extractHazard(torn2), w2 = extractHazard(wind2), h2 = extractHazard(hail2);

  return [
    {
      catLabel: findCatLabel(cat1),
      tornado: t1.risk, tornCig: t1.cig,
      wind:    w1.risk, windCig: w1.cig,
      hail:    h1.risk, hailCig: h1.cig,
    },
    {
      catLabel: findCatLabel(cat2),
      tornado: t2.risk, tornCig: t2.cig,
      wind:    w2.risk, windCig: w2.cig,
      hail:    h2.risk, hailCig: h2.cig,
    },
  ];
}

async function wpcForecastPayload() {
  const loc = point();
  const WPC_ERO_RANK = { MRGL: 1, SLGT: 2, MDT: 3, HIGH: 4 };

  const findWpcLabel = (raw) => {
    if (!raw) return null;
    const normalized = normalizeWpcEroData(raw);
    const matches = (normalized.features || [])
      .filter(f => pointInGeometry(loc.lon, loc.lat, f.geometry));
    if (!matches.length) return null;
    return matches.reduce((best, f) =>
      (WPC_ERO_RANK[f.properties?.LABEL] || 0) > (WPC_ERO_RANK[best?.properties?.LABEL] || 0) ? f : best
    ).properties?.LABEL || null;
  };

  const results = await Promise.allSettled(
    WPC_ERO_URLS.map(url => fetchOutlookGeoJson(url).catch(() => null))
  );

  return results.map(r => ({
    label: r.status === "fulfilled" ? findWpcLabel(r.value) : null,
  }));
}

async function fetchOutlookGeoJson(url) {
  try {
    return await getJson(url, { cache: "no-store" });
  } catch {
    const proxy = `${WORKER_PROXY}${encodeURIComponent(url)}`;
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

// WPC ERO features use an OUTLOOK text field and a dn numeric field instead of LABEL short codes.
function normalizeWpcEroData(data) {
  if (!data?.features) return data || { features: [] };
  const outlookMap = { marginal: "MRGL", slight: "SLGT", moderate: "MDT", high: "HIGH" };
  const dnMap      = { 1: "MRGL", 2: "SLGT", 3: "MDT", 4: "HIGH" };
  return {
    ...data,
    features: data.features.map(feature => {
      const props = feature.properties || {};
      let label = String(props.LABEL ?? props.label ?? "").toUpperCase();
      if (!label) {
        const outlook = String(props.OUTLOOK ?? props.outlook ?? "").toLowerCase();
        for (const [key, val] of Object.entries(outlookMap)) {
          if (outlook.startsWith(key)) { label = val; break; }
        }
      }
      if (!label && props.dn != null) label = dnMap[props.dn] || "";
      return { ...feature, properties: { ...props, LABEL: label } };
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
  const cig = label.toUpperCase().match(/^CIG([123])$/);
  if (cig) return `Significant severe — Conditional Intensity Group ${cig[1]}`;
  if (Number.isFinite(Number(properties.RISK_NUM))) return `${properties.RISK_NUM}% probability`;
  return spcLabel(label);
}

function spcRiskColor(catLabel) {
  const colors = {
    TSTM: "#c0e8c0", MRGL: "#66cc66", SLGT: "#ffe066",
    ENH: "#ffa040", MDT: "#ff6060", HIGH: "#ff40ff",
  };
  return colors[String(catLabel || "").toUpperCase()] ?? null;
}

function spcThreatText(type, cig) {
  if (!cig || !type) return null;
  if (type === "tornado") {
    if (cig === 1) return "Strong tornadoes (EF2+) possible";
    if (cig === 2) return "Intense tornadoes (EF3+) possible";
    if (cig === 3) return "Violent tornadoes (EF4+) possible";
  }
  if (type === "wind") {
    if (cig === 1) return "Damaging winds up to 75 mph possible";
    if (cig === 2) return "Derecho with destructive winds up to 80 mph possible";
    if (cig === 3) return "Derecho likely with 80+ mph winds";
  }
  if (type === "hail" && cig < 3) {
    if (cig === 1) return "Hail up to 2\" in diameter possible";
    if (cig === 2) return "Hail up to 3.5\" in diameter possible";
  }
  return null;
}

// SPC-style categorical summary sentences, matching the wording of the
// published SPC risk-category table.
const SPC_CAT_SUMMARY = {
  TSTM: "Thunderstorms are possible, but no severe storms are expected.",
  MRGL: "Isolated severe storms are possible.",
  SLGT: "Isolated to scattered severe storms are expected.",
  ENH:  "Scattered to numerous severe storms are expected.",
  MDT:  "Scattered to numerous severe storms are expected.",
  HIGH: "Numerous severe storms are expected.",
};

const SPC_COVERAGE_WORDS = {
  MRGL: "isolated",
  SLGT: "isolated to scattered",
  ENH:  "scattered to numerous",
  MDT:  "scattered to numerous",
  HIGH: "numerous",
};

// Maps a hazard probability to its categorical level using the <CIG1 column
// of the SPC probability-to-category matrices. Tornado probabilities have
// their own breakpoints; wind and hail share theirs.
function spcProbCategory(type, prob) {
  const p = Number(prob);
  if (!Number.isFinite(p)) return null;
  if (type === "tornado") {
    if (p >= 15) return "ENH";
    if (p >= 5)  return "SLGT";
    if (p >= 2)  return "MRGL";
    return null;
  }
  if (p >= 45) return "ENH";
  if (p >= 15) return "SLGT";
  if (p >= 5)  return "MRGL";
  return null;
}

// Conditional Intensity Group add-on for a hazard phrase: CIG1/2/3 escalate
// the potential significance of that hazard.
function spcCigClause(type, cig) {
  if (type === "tornado") {
    if (cig === 1) return "with some potentially strong (EF2+)";
    if (cig === 2) return "with some potentially intense (EF3+)";
    if (cig === 3) return "with some potentially violent (EF4+)";
  }
  if (type === "wind") {
    if (cig === 1) return "with gusts of 65+ mph possible";
    if (cig === 2) return "with destructive gusts of 85+ mph possible";
    if (cig === 3) return "with widespread destructive gusts of 95+ mph possible";
  }
  if (type === "hail") {
    if (cig === 1) return "up to 2 inches in diameter";
    if (cig === 2) return "up to 3.5 inches in diameter";
    if (cig === 3) return "with giant hail possible";
  }
  return null;
}

// Builds the hazards clause from the day's tornado/wind/hail probabilities and
// CIG levels, e.g. "Hazards include scattered to numerous instances of
// damaging winds, isolated severe hail, and isolated to scattered tornadoes,
// with some potentially strong (EF2+)."
function spcHazardSentence(spcDay = {}) {
  const phrases = [];
  const addHazard = (type, prob, cig, noun) => {
    const cat = spcProbCategory(type, prob);
    if (!cat) return;
    const clause = spcCigClause(type, cig);
    phrases.push(`${SPC_COVERAGE_WORDS[cat]} ${noun}${clause ? `, ${clause}` : ""}`);
  };
  addHazard("wind",    spcDay.wind,    spcDay.windCig, "instances of damaging winds");
  addHazard("hail",    spcDay.hail,    spcDay.hailCig, "severe hail");
  addHazard("tornado", spcDay.tornado, spcDay.tornCig, "tornadoes");
  if (!phrases.length) return "";
  const list = phrases.length > 1
    ? `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`
    : phrases[0];
  return `Hazards include ${list}.`;
}

// Full SPC-style outlook summary for one forecast day: the categorical
// sentence followed by the hazards breakdown.
function spcDaySummary(spcDay = {}) {
  const cat = String(spcDay.catLabel || "").toUpperCase();
  const lead = SPC_CAT_SUMMARY[cat];
  if (!lead) return "";
  const hazards = cat === "TSTM" ? "" : spcHazardSentence(spcDay);
  return hazards ? `${lead} ${hazards}` : lead;
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

function weatherIcon(type, forceDay = false) {
  return `<span class="weather-icon" aria-hidden="true">${WeatherIcons.fromText(type, forceDay ? false : isNightPeriod(type))}</span>`;
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
    temp:     `<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>`,
    cloud:    `<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/>`,
    precip:   `<path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/>`,
    snow:     `<line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>`,
    sunshine: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2m-3.5-6.5-1.5 1.5M5 5l1.5 1.5M19 19l-1.5-1.5M5 19l1.5-1.5"/>`,
    sunrise:  `<path d="M12 2v8m-8.07.93 1.41 1.41M2 18h2m16 0h2m-4.34-5.66 1.41-1.41M22 22H2m14-4a4 4 0 0 0-8 0"/><path d="m8 6 4-4 4 4"/>`,
    sunset:   `<path d="M12 10V2m-8.07 8.93 1.41 1.41M2 18h2m16 0h2m-4.34-5.66 1.41-1.41M22 22H2m14-4a4 4 0 0 0-8 0"/><path d="m16 6-4 4-4-4"/>`,
    degree:   `<rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/>`,
    severe:   `<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><path d="M12 9v4"/><path d="M12 17h.01"/>`,
    fwi:      `<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>`,
  };
  return `<span class="ui-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${icons[name] || icons.pressure}</svg></span>`;
}

function iconForCondition(text = "") {
  if (!text) return "Partly Cloudy";
  // For "X then Y" patterns (e.g. "Areas of Fog then Sunny"), use the later condition for the icon
  const thenMatch = text.match(/\bthen\s+(.+)/i);
  if (thenMatch) return thenMatch[1].trim() || text;
  return text;
}

function isNightPeriod(text = "") {
  return activeTheme === "midnight" || /\bnight|overnight|after midnight\b/i.test(text);
}

function isNightAt(date, sunriseDate, sunsetDate) {
  const time = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(time.getTime())) return false;
  if (sunriseDate && sunsetDate) {
    const ms = time.getTime();
    return ms < sunriseDate.getTime() || ms > sunsetDate.getTime();
  }
  const h = localHour(time);
  return h >= 20 || h < 6;
}

function forecastSunTimesFor(date) {
  const tz = selectedLocation.timezone || "America/New_York";
  const key = localDateISO(date, tz);
  return currentSunTimesByDate.get(key) || null;
}

function historicalSunTimesFor(date, sunriseIso, sunsetIso) {
  const sunriseDate = sunriseIso ? new Date(sunriseIso) : null;
  const sunsetDate = sunsetIso ? new Date(sunsetIso) : null;
  if (sunriseDate && sunsetDate && !Number.isNaN(sunriseDate.getTime()) && !Number.isNaN(sunsetDate.getTime())) {
    return { sunriseDate, sunsetDate };
  }
  return forecastSunTimesFor(date);
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
  syncThemeColor();
  document.body.dataset.condition = conditionClass(current);
  locationName.textContent = selectedLocation.name;
  document.querySelector("#current-title").textContent = current.headline;
  document.querySelector("#weatherSummary").textContent = current.summary;
  document.querySelector("#currentIcon").innerHTML = WeatherIcons.fromText(current.condition || current.summary || "Partly Cloudy", activeTheme === "midnight");
  document.querySelector("#currentTemp").textContent = uTempNum(current.temp);
  updateUnitToggleLabel();
  document.querySelector("#currentCondition").textContent = current.condition || "Observed conditions";
  document.querySelector("#statusBadge").textContent = alertCount ? `${alertCount} active ${alertAgencyLabel()} alert${alertCount > 1 ? "s" : ""}` : themePalettes[activeTheme].status;
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
    ["dew", "Dew Point", `${uTempNum(current.dewPoint)}°`, `${current.source || "NWS"} observation`],
    ["humidity", "Relative Humidity", `${f(current.humidity)}%`, "Relative humidity"],
    ["wind", "Wind", fmtWind(current.wind), `Gusts ${fmtWind(current.gust)}`],
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
  if (updatedEl) updatedEl.textContent = `Updated ${updated.toLocaleTimeString([], { timeZone: selectedLocation.timezone || "America/New_York", hour: "numeric", minute: "2-digit" })} from ${current.source || "NWS"}`;

  hourlyStrip.innerHTML = (weatherState.hourly || []).slice(0, 24).map((hour, index) => {
    const time = new Date(hour.startTime);
    const precip = hour.probabilityOfPrecipitation?.value;
    const sunTimes = forecastSunTimesFor(time);
    const isHourNight = isNightAt(time, sunTimes?.sunriseDate, sunTimes?.sunsetDate);
    const iconHtml = `<span class="weather-icon" aria-hidden="true">${WeatherIcons.fromText(iconForCondition(hour.shortForecast), isHourNight)}</span>`;
    return `
      <button class="hour-card compact" type="button" data-hour-index="${index}">
        <strong>${index === 0 ? "Now" : time.toLocaleTimeString([], { hour: "numeric" })}</strong>
        ${iconHtml}
        <div class="hour-temp">${uTempNum(hour.temperature)}°</div>
        <small>${f(precip)}%</small>
      </button>
    `;
  }).join("") || `<article class="hour-card"><strong>No hourly data</strong></article>`;
  renderHourlyChart();
}

function renderHourlyChart() {
  const wrap = document.querySelector("#hourlyChartWrap");
  if (!wrap) return;
  const hourly = (weatherState.hourly || []).slice(0, 24);
  if (!hourly.length) { wrap.innerHTML = ""; return; }

  if (!wrap.offsetWidth) {
    requestAnimationFrame(() => renderHourlyChart());
    return;
  }
  if (!wrap._chartResizeObserver) {
    wrap._chartResizeObserver = new ResizeObserver(() => {
      if (weatherState.hourly?.length) renderHourlyChart();
    });
    wrap._chartResizeObserver.observe(wrap);
  }

  const METRICS = {
    temperature: { unit: "°",          color: "#f97316", getValue: h => h.temperature == null ? null : Math.round(uTemp(h.temperature)), label: tempUnit() },
    wind:        { unit: ` ${windUnit()}`, color: "#38bdf8", getValue: h => { const n = numericWind(h.windSpeed); return n == null ? 0 : Math.round(uWind(n)); }, label: windUnit() },
    humidity:    { unit: "%",   color: "#a78bfa", getValue: h => h.relativeHumidity?.value ?? null,           label: "%" },
    precip:      { unit: "%",   color: "#60a5fa", getValue: h => h.probabilityOfPrecipitation?.value ?? null, label: "%" },
    fwi:         { unit: "",    color: "#facc15", getValue: h => hourFwi(h).score100, label: "score",
                   formatValue: (v, h) => `${v} ${hourFwi(h).label}` },
  };

  const cfg  = METRICS[hourlyChartMetric] || METRICS.temperature;
  const vals = hourly.map(h => { const v = cfg.getValue(h); return v != null ? Number(v) : 0; });

  // Use actual pixel dimensions so text/dots render correctly at all screen sizes
  const W = Math.max(300, wrap.offsetWidth || 600);
  const H = Math.max(130, wrap.offsetHeight || 175);
  const padL = 10, padR = 10, padT = 30, padB = 26;
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
  const fs   = Math.max(10, Math.min(13, W / 68));  // value label size
  const tfs  = Math.max(9,  Math.min(11, W / 92));  // time label size
  const step = W < 450 ? 4 : 3;                     // label every Nth hour

  const dotsSvg = pts.map(([x, y], i) => {
    const show = (i % step === 0 || i === pts.length - 1);
    const vStr = cfg.formatValue ? cfg.formatValue(vals[i], hourly[i]) : `${vals[i]}${cfg.unit}`;
    return `
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${show ? 3.5 : 2}"
        fill="${col}" stroke="rgba(2,6,23,0.85)" stroke-width="${show ? 1.8 : 1.2}"
        opacity="${show ? 1 : 0.5}" data-hour-index="${i}"/>
      ${show ? `<text x="${x.toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle"
        fill="${col}" font-size="${fs}" font-weight="800"
        font-family="Inter,system-ui,sans-serif">${safeText(vStr)}</text>` : ""}`;
  }).join("");

  const timeSvg = hourly.map((h, i) => {
    if (i % step !== 0 && i !== hourly.length - 1) return "";
    const t = new Date(h.startTime);
    const lbl = i === 0 ? "Now" : t.toLocaleTimeString([], { hour: "numeric" });
    return `<text x="${xFor(i).toFixed(1)}" y="${(H - 5).toFixed(1)}" text-anchor="middle"
      fill="rgba(232,240,255,0.45)" font-size="${tfs}" font-weight="600"
      font-family="Inter,system-ui,sans-serif">${lbl}</text>`;
  }).join("");

  const tipW = Math.min(94, Math.max(72, W * 0.18));
  const tipH = 40;

  wrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" class="hourly-chart-svg">
      <defs>
        <linearGradient id="${gId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stop-color="${col}" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="${col}" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#${gId})"/>
      <path d="${d}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      ${dotsSvg}
      ${timeSvg}
      <line class="chart-cursor" x1="0" y1="${padT - 6}" x2="0" y2="${padT + plotH}"
        stroke="rgba(255,255,255,0.22)" stroke-width="1.5" stroke-dasharray="4,3" visibility="hidden"/>
      <circle class="chart-hover-dot" cx="0" cy="0" r="6"
        fill="${col}" stroke="rgba(2,6,23,0.9)" stroke-width="2.5" visibility="hidden"/>
      <g class="chart-tooltip" visibility="hidden">
        <rect width="${tipW}" height="${tipH}" rx="7"
          fill="rgba(8,16,36,0.93)" stroke="${col}" stroke-width="1.2" stroke-opacity="0.65"/>
        <text class="tip-val" x="${tipW / 2}" y="16" text-anchor="middle"
          fill="${col}" font-size="${fs + 1}" font-weight="800" font-family="Inter,system-ui,sans-serif"/>
        <text class="tip-time" x="${tipW / 2}" y="30" text-anchor="middle"
          fill="rgba(232,240,255,0.56)" font-size="${tfs}" font-weight="600" font-family="Inter,system-ui,sans-serif"/>
      </g>
      <rect class="chart-hit" x="${padL}" y="0" width="${plotW}" height="${H}"
        fill="transparent" style="cursor:crosshair"/>
    </svg>
  `;

  const svg     = wrap.querySelector(".hourly-chart-svg");
  const cursor  = svg.querySelector(".chart-cursor");
  const hdot    = svg.querySelector(".chart-hover-dot");
  const tipG    = svg.querySelector(".chart-tooltip");
  const tipVal  = svg.querySelector(".tip-val");
  const tipTime = svg.querySelector(".tip-time");
  let hideTimer;

  function closestIdx(clientX) {
    const rect = svg.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * W;
    let best = 0, bestDist = Infinity;
    pts.forEach(([px], i) => { const dist = Math.abs(px - svgX); if (dist < bestDist) { bestDist = dist; best = i; } });
    return best;
  }

  function showTip(clientX, fromTouch = false) {
    clearTimeout(hideTimer);
    const idx = closestIdx(clientX);
    const [cx, cy] = pts[idx];
    const vStr = cfg.formatValue ? cfg.formatValue(vals[idx], hourly[idx]) : `${vals[idx]}${cfg.unit}`;
    const t = new Date(hourly[idx].startTime);
    const lbl = idx === 0 ? "Now" : t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    cursor.setAttribute("x1", cx); cursor.setAttribute("x2", cx); cursor.setAttribute("visibility", "visible");
    hdot.setAttribute("cx", cx); hdot.setAttribute("cy", cy); hdot.setAttribute("visibility", "visible");
    tipVal.textContent = vStr; tipTime.textContent = lbl;
    let tx = Math.max(padL, Math.min(W - padR - tipW, cx - tipW / 2));
    const ty = Math.max(2, cy - tipH - 12);
    tipG.setAttribute("transform", `translate(${tx},${ty})`); tipG.setAttribute("visibility", "visible");
    if (fromTouch) hideTimer = setTimeout(hideTip, 2800);
  }

  function hideTip() {
    cursor.setAttribute("visibility", "hidden");
    hdot.setAttribute("visibility", "hidden");
    tipG.setAttribute("visibility", "hidden");
  }

  const hit = svg.querySelector(".chart-hit");
  hit.addEventListener("mousemove",  e => showTip(e.clientX));
  hit.addEventListener("mouseleave", hideTip);
  hit.addEventListener("touchstart", e => { e.preventDefault(); showTip(e.touches[0].clientX, true); }, { passive: false });
  hit.addEventListener("touchmove",  e => { e.preventDefault(); showTip(e.touches[0].clientX, true); }, { passive: false });
  hit.addEventListener("click",      e => showHourDetails(closestIdx(e.clientX)));
}

function alertPriority(alert) {
  const event = (alert.event || "").toLowerCase();
  const severity = (alert.severity || "").toLowerCase();
  const tags = (alert.tags || []).join(" ").toLowerCase();
  if (event.includes("tornado warning") && tags.includes("emergency")) return 1000;
  if (event.includes("tornado warning") && (tags.includes("pds") || tags.includes("observed"))) return 900;
  if (event.includes("tornado warning")) return 800;
  if (event.includes("flash flood warning") && tags.includes("emergency")) return 760;
  if (event.includes("flash flood warning") && tags.includes("considerable")) return 720;
  if (event.includes("severe thunderstorm warning") && /destructive|extreme|emergency/.test(tags)) return 740;
  if (event.includes("severe thunderstorm warning")) return 700;
  if (event.includes("flash flood warning")) return 680;
  if (event.includes("snow squall warning")) return 650;
  if (event.includes("warning")) return 560;
  // All watches rank below every warning: a watch only means the environment
  // is supportive, while a warning means severe weather is occurring.
  if (event.includes("tornado watch")) return 480;
  if (event.includes("severe thunderstorm watch")) return 460;
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
            <h3>${safeText(alertDisplayEvent(alert))}</h3>
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

// Browsers can't revoke Notification.permission from script, so "off" is a
// local opt-out flag: it silences in-app notifications and removes the push
// subscription while leaving the browser permission granted for re-enabling.
function notificationsOptedOut() {
  return localStorage.getItem("alertNotificationsOff") === "1";
}

function notificationsEnabled() {
  return notificationSupported() && Notification.permission === "granted" && !notificationsOptedOut();
}

function pushSupported() {
  return notificationSupported() && "PushManager" in window;
}

function isIOSDevice() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandaloneMode() {
  return !!navigator.standalone ||
    window.matchMedia("(display-mode: standalone)").matches;
}

function setNotifyButtonState() {
  if (!notifyButton || !notifyButtonText) return;
  if (!notificationSupported()) {
    notifyButton.disabled = true;
    notifyButtonText.textContent = "No Alerts";
    return;
  }
  if (isIOSDevice() && !isStandaloneMode()) {
    notifyButton.disabled = false;
    notifyButton.classList.remove("subscribed");
    notifyButtonText.textContent = "Alerts";
    return;
  }
  const on = notificationsEnabled();
  notifyButton.classList.toggle("subscribed", on);
  notifyButtonText.textContent = on ? "Alerts On" : "Alerts";
  const hint = on ? "Notifications enabled — click to turn off" : "Enable weather alert notifications";
  notifyButton.title = hint;
  notifyButton.setAttribute("aria-label", hint);
  notifyButton.setAttribute("aria-pressed", on ? "true" : "false");
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
}

function buffersEqual(a, b) {
  if (!a || !b || a.byteLength !== b.byteLength) return false;
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  return aa.every((value, index) => value === bb[index]);
}

async function registerPushSubscription() {
  if (!PUSH_PUBLIC_KEY || !PUSH_SUBSCRIBE_ENDPOINT || !pushSupported()) return false;
  const registration = await navigator.serviceWorker.ready;
  if (!registration?.pushManager) return false;

  const applicationServerKey = urlBase64ToUint8Array(PUSH_PUBLIC_KEY);
  let subscription = await registration.pushManager.getSubscription();

  // iOS Home Screen apps can keep an old APNs-backed subscription after a
  // deployment or key rotation. Sending that stale endpoint succeeds locally but
  // never reaches the device, so force a clean subscription when the key differs.
  const existingKey = subscription?.options?.applicationServerKey;
  if (subscription && existingKey && !buffersEqual(existingKey, applicationServerKey)) {
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  }

  // Fetch NWS forecast zone + county zone codes so the worker can use the
  // more reliable ?zone= endpoint instead of ?point= for county-level alerts.
  let nwsZones = [];
  try {
    const gp = await getJson(`https://api.weather.gov/points/${selectedLocation.lat},${selectedLocation.lon}`);
    nwsZones = [gp.properties?.forecastZone, gp.properties?.county, gp.properties?.fireWeatherZone]
      .filter(Boolean)
      .map(url => url.split("/").pop())
      .filter(Boolean);
  } catch {}

  // Skip the round-trip when this device already registered the identical
  // subscription + location recently — every stored subscribe costs the
  // worker a Workers KV write (only 1,000/day on the free plan), and the app
  // re-subscribes on every launch.
  const fingerprint = JSON.stringify({
    endpoint: subscription.endpoint,
    lat: selectedLocation.lat,
    lon: selectedLocation.lon,
    zones: nwsZones,
  });
  try {
    const last = JSON.parse(localStorage.getItem("pushSubscribeState") || "null");
    if (last?.fingerprint === fingerprint && Date.now() - last.at < 24 * 3600 * 1000) return true;
  } catch {}

  const response = await fetch(PUSH_SUBSCRIBE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription,
      location: { ...selectedLocation, nwsZones },
    }),
  });
  if (!response.ok) throw new Error(`Push subscribe failed: ${response.status}`);
  try { localStorage.setItem("pushSubscribeState", JSON.stringify({ fingerprint, at: Date.now() })); } catch {}
  return true;
}

function rememberCurrentAlerts() {
  const ids = (weatherState.alerts || []).map(alertNotificationId).filter(Boolean);
  localStorage.setItem("weatherSeenAlertIds", JSON.stringify(ids));
}

async function showAlertNotification(alert) {
  if (!notificationsEnabled()) return;
  const title = alertDisplayEvent(alert);
  const body = alert.headline || alert.description || `New alert for ${selectedLocation.name}`;
  const options = {
    body,
    tag: alertNotificationId(alert),
    renotify: true,
    badge: "./icon-192.png",
    icon: "./icon-192.png",
    data: { url: location.href },
  };
  const registration = serviceWorkerRegistration || await navigator.serviceWorker.ready.catch(() => null);
  if (registration?.showNotification) registration.showNotification(title, options);
  else new Notification(title, options);
}

async function syncPushShownAlerts() {
  try {
    const cache = await caches.open("push-shown-alerts-v1");
    const response = await cache.match("ids");
    if (!response) return;
    const pushIds = await response.json();
    if (!pushIds?.length) return;
    const existing = new Set(JSON.parse(localStorage.getItem("weatherSeenAlertIds") || "[]"));
    pushIds.forEach(id => existing.add(id));
    localStorage.setItem("weatherSeenAlertIds", JSON.stringify([...existing]));
  } catch {}
}

function notifyNewWeatherAlerts() {
  if (!notificationsEnabled()) return;
  const alerts = weatherState.alerts || [];
  const storedIds = localStorage.getItem("weatherSeenAlertIds");
  const currentIds = alerts.map(alertNotificationId).filter(Boolean);
  if (suppressNextAlertNotifications || storedIds == null) {
    localStorage.setItem("weatherSeenAlertIds", JSON.stringify(currentIds));
    suppressNextAlertNotifications = false;
    return;
  }
  const oldIds = new Set(JSON.parse(storedIds || "[]"));
  const newAlerts = alerts.filter(alert => !oldIds.has(alertNotificationId(alert)));
  localStorage.setItem("weatherSeenAlertIds", JSON.stringify(currentIds));
  newAlerts.slice(0, 3).forEach(showAlertNotification);
}

function checkMorningOutlookNotification() {
  if (!notificationsEnabled()) return;

  const tz = selectedLocation.timezone || "America/New_York";
  const now = new Date();
  // Get the local hour in the user's timezone
  const localHourStr = now.toLocaleString("en-US", { timeZone: tz, hour: "numeric", hour12: false });
  const localHour = parseInt(localHourStr, 10);

  // Only trigger between 6:00am and 9:00am local time
  if (localHour < 6 || localHour >= 9) return;

  // One notification per calendar day per location
  const todayKey = now.toLocaleDateString("en-US", { timeZone: tz });
  const storageKey = `morningOutlookSentDate_${selectedLocation.lat}_${selectedLocation.lon}`;
  if (localStorage.getItem(storageKey) === todayKey) return;

  const spcDay1 = weatherState.spcDays?.[0];
  const catLabel = spcDay1?.catLabel || null;

  const wpcDay1 = weatherState.wpcDays?.[0];
  const wpcLabel = wpcDay1?.label || null;

  // SPC severe weather text (per screenshot legend)
  const spcMessages = {
    MRGL: "Isolated severe storms are possible in your area today.",
    SLGT: "Isolated to scattered severe storms are expected in your area today.",
    ENH:  "Scattered to numerous severe storms are expected in your area today.",
    MDT:  "Scattered to numerous severe storms are expected in your area today.",
    HIGH: "Numerous severe storms are expected in your area today.",
  };

  // WPC excessive rainfall text (parallel phrasing, no enhanced level, uses flooding)
  const wpcMessages = {
    MRGL: "Isolated flooding instances are possible in your area today.",
    SLGT: "Isolated to scattered flooding instances are expected in your area today.",
    MDT:  "Scattered to numerous flooding instances are expected in your area today.",
    HIGH: "Numerous flooding instances are expected in your area today.",
  };

  const toSend = [];
  if (catLabel && spcMessages[catLabel]) {
    toSend.push({ title: "Severe Weather Outlook", body: spcMessages[catLabel], tag: `spc-morning-${todayKey}` });
  }
  if (wpcLabel && wpcMessages[wpcLabel]) {
    toSend.push({ title: "Excessive Rainfall Outlook", body: wpcMessages[wpcLabel], tag: `wpc-morning-${todayKey}` });
  }

  if (!toSend.length) return;

  localStorage.setItem(storageKey, todayKey);
  toSend.forEach(async ({ title, body, tag }) => {
    const options = { body, tag, renotify: false, badge: "./icon-192.png", icon: "./icon-192.png", data: { url: location.href } };
    const reg = serviceWorkerRegistration || await navigator.serviceWorker.ready.catch(() => null);
    if (reg?.showNotification) reg.showNotification(title, options);
    else new Notification(title, options);
  });
}

function scheduleMorningNotificationCheck() {
  const tz = selectedLocation.timezone || "America/New_York";
  const now = new Date();
  // Determine local clock time
  const localParts = now.toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "numeric", hour12: false }).split(":");
  const localHour = parseInt(localParts[0], 10);
  const localMin  = parseInt(localParts[1], 10);

  // Calculate ms until next 7:00am local
  let minutesUntil7am;
  if (localHour < 7 || (localHour === 7 && localMin === 0)) {
    minutesUntil7am = (7 - localHour) * 60 - localMin;
  } else {
    minutesUntil7am = (24 - localHour + 7) * 60 - localMin;
  }

  setTimeout(async () => {
    try {
      await refreshLiveData();
    } catch {}
    scheduleMorningNotificationCheck();
  }, minutesUntil7am * 60 * 1000);
}

async function disableNotifications() {
  localStorage.setItem("alertNotificationsOff", "1");
  localStorage.removeItem("pushSubscribeState");
  setNotifyButtonState();
  document.querySelector("#statusBadge").textContent = "Alert notifications turned off";
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration?.pushManager?.getSubscription();
    if (subscription) {
      // Tell the worker to drop the stored record so background pushes stop,
      // then release the browser-side subscription.
      fetch(PUSH_UNSUBSCRIBE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }).catch(() => {});
      await subscription.unsubscribe().catch(() => false);
    }
  } catch (error) {
    console.warn("Push unsubscribe failed", error);
  }
}

async function toggleNotifications() {
  if (notificationsEnabled()) return disableNotifications();
  return enableNotifications();
}

async function enableNotifications() {
  if (!notificationSupported()) {
    document.querySelector("#statusBadge").textContent = "Notifications unavailable in this browser";
    return;
  }
  if (isIOSDevice() && !isStandaloneMode()) {
    document.querySelector("#statusBadge").textContent =
      "To enable alerts on iPhone/iPad, tap Share → Add to Home Screen, then open the app from your home screen";
    return;
  }
  let permission = Notification.permission;
  if (permission !== "granted") {
    permission = await Notification.requestPermission();
  }
  if (permission === "granted") localStorage.removeItem("alertNotificationsOff");
  setNotifyButtonState();
  if (permission === "granted") {
    rememberCurrentAlerts();
    const pushReady = await registerPushSubscription().catch(error => {
      console.warn("Push subscription unavailable", error);
      return false;
    });
    // Be honest when the background-push registration failed: "enabled"
    // previously masked /subscribe errors, so users believed closed-app
    // notifications were active when the server never stored the subscription.
    document.querySelector("#statusBadge").textContent = pushReady
      ? "Alert push notifications enabled"
      : "Alerts on while the app is open — background push setup failed, will retry on next launch";
  } else {
    document.querySelector("#statusBadge").textContent = "Alert notifications not enabled";
  }
}

async function registerAppWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    serviceWorkerRegistration = await navigator.serviceWorker.register("sw.js");
    navigator.serviceWorker.addEventListener("message", event => {
      if (event.data?.type === "push-alert-shown") {
        const existing = new Set(JSON.parse(localStorage.getItem("weatherSeenAlertIds") || "[]"));
        existing.add(event.data.id);
        localStorage.setItem("weatherSeenAlertIds", JSON.stringify([...existing]));
      }
      if (event.data?.type === "notification-click") {
        refreshLiveData().then(() => {
          if (!alertsPanel.hidden) alertsPanel.scrollIntoView({ behavior: "smooth" });
        });
      }
    });
    if (notificationsEnabled()) {
      registerPushSubscription().catch(e => console.warn("Startup push re-subscribe failed", e));
    }
  } catch (error) {
    console.warn("Service worker unavailable", error);
  } finally {
    setNotifyButtonState();
  }
}

function getDailyPairs(all = []) {
  // NWS periods start with "Tonight" when the app loads in the evening.
  // Skip any leading night-only period so day/night pairs are always aligned.
  let start = 0;
  if (all[0]?.isDaytime === false) start = 1;
  const pairs = [];
  for (let i = start; i < all.length && pairs.length < 7; i += 2) {
    pairs.push({ day: all[i], night: all[i + 1] || null });
  }
  return pairs;
}

function generateDailySummary(day, precip) {
  const detailed = (day.detailedForecast || "").trim();
  const short = day.shortForecast || "";

  if (!detailed) {
    // Humanize NWS shortForecast jargon into readable text
    return short
      .replace(/\bSlight Chance\b/gi, "Slight chance of")
      .replace(/\bChance\b/gi, "Chance of")
      .replace(/\bLikely\b/gi, "Likely")
      .replace(/T-storms/gi, "thunderstorms")
      .replace(/TSTM/gi, "thunderstorms") || "Forecast details unavailable.";
  }

  // Extract first 1–2 sentences, skipping pure precipitation-chance/amount lines
  const sentences = detailed
    .split(/\.(?:\s|$)/)
    .map(s => s.trim())
    .filter(s => s &&
      !/^chance of precipitation is/i.test(s) &&
      !/^new (rainfall|snow)/i.test(s) &&
      !/^total (snow|rainfall)/i.test(s));

  const parts = [];
  for (const s of sentences) {
    parts.push(s);
    if (parts.join(". ").length >= 90 || parts.length >= 2) break;
  }

  return (parts.join(". ") + (parts.length ? "." : "")).trim() || short;
}

function renderDaily() {
  const days = getDailyPairs(weatherState.daily || []);

  const extras = weatherState.dailyExtras || {};
  const pollenForecast = weatherState.pollenForecast || [];
  dailyGrid.innerHTML = days.map(({ day, night }, index) => {
    const precip  = day.probabilityOfPrecipitation?.value ?? night?.probabilityOfPrecipitation?.value;
    const feelsHigh = extras.apparent_temperature_max?.[index] ?? apparentTemperature(day.temperature, weatherState.current?.humidity, numericWind(day.windSpeed));
    const feelsLow  = extras.apparent_temperature_min?.[index] ?? (night ? apparentTemperature(night.temperature, weatherState.current?.humidity, numericWind(night.windSpeed)) : null);
    const uv = extras.uv_index_max?.[index] ?? weatherState.current?.uv;

    // Derive the month from the period name or fall back to current month
    const periodDate = day.startTime ? new Date(day.startTime) : new Date();
    const dayMonth   = periodDate.getMonth();
    const windSpeed  = numericWind(day.windSpeed) || null;
    const fwi = FWI.calculate({
      temp:        day.temperature,
      humidity:    weatherState.current?.humidity,
      wind:        windSpeed,
      gust:        null,
      precipChance: precip,
      month:       dayMonth,
    });

    const spcDay = index < 2 ? (weatherState.spcDays?.[index] || null) : null;
    const spcCat = spcDay?.catLabel || null;
    const spcColor = spcRiskColor(spcCat);
    const spcBadge = (spcColor && spcCat !== "TSTM")
      ? `<span class="spc-risk-badge" style="background:${spcColor}22;color:${spcColor};border:1px solid ${spcColor}88" title="SPC Day ${index + 1} ${spcLabel(spcCat)} risk"><svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" style="vertical-align:-1px" aria-hidden="true"><path d="M12 2L2 22h20L12 2zm0 14.5a.75.75 0 110 1.5.75.75 0 010-1.5zm-.75-5.5h1.5v5h-1.5V11z"/></svg> ${safeText(spcCat)}</span>`
      : "";

    const wpcDay = index < 5 ? (weatherState.wpcDays?.[index] || null) : null;
    const wpcCat = wpcDay?.label || null;
    const wpcColor = spcRiskColor(wpcCat);
    const wpcBadge = (wpcColor && wpcCat)
      ? `<span class="spc-risk-badge wpc-risk-badge" style="background:${wpcColor}22;color:${wpcColor};border:1px solid ${wpcColor}88" title="WPC Day ${index + 1} Excessive Rainfall — ${wpcCat}"><svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="vertical-align:-1px" aria-hidden="true"><path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9"/><line x1="8" y1="19" x2="8" y2="21"/><line x1="12" y1="17" x2="12" y2="19"/><line x1="16" y1="19" x2="16" y2="21"/></svg> ${safeText(wpcCat)}</span>`
      : "";

    return `
    <button class="daily-card" type="button" data-day-index="${index}">
      <div class="daily-card-head">
        <p class="eyebrow">${day.name}</p>
        ${weatherIcon(iconForCondition(day.shortForecast), true)}
      </div>
      <div class="daily-badge-row">
        <span class="fwi-badge" style="background:${fwi.bg};color:${fwi.color};border:1px solid ${fwi.color}44">${fwi.label}</span>${spcBadge}${wpcBadge}
      </div>
      <div class="daily-range">${uTempNum(day.temperature)}°<span class="daily-range-low"> / ${night ? uTempNum(night.temperature) : "--"}°</span></div>
      <p class="daily-summary">${safeText(generateDailySummary(day, precip))} <span style="color:${fwi.color};opacity:0.9">${safeText(fwi.sentence)}</span></p>
      <div class="daily-chip-row">
        <span class="chip-precip">${uiIcon("precip")}${f(precip)}%</span>
        <span>${uiIcon("temp")}Feels ${uTempNum(feelsHigh)}°/${uTempNum(feelsLow)}°</span>
        ${windSpeed != null ? `<span>${uiIcon("wind")}${safeText(`${day.windDirection || ""} ${fmtWind(windSpeed)}`.trim())}</span>` : ""}
        <span class="chip-uv">${uiIcon("uv")}UV ${f(uv, 1)}</span>
        ${pollenForecast[index] ? `<span class="pollen-chip" title="${safeText(pollenForecast[index].detail || '')}">${uiIcon("pollen")}${safeText(pollenForecast[index].label)}</span>` : ""}
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
  const windNum = numericWind(hour.windSpeed);
  const wind = windNum != null ? fmtWind(windNum) : "Not reported";
  const gustNum = numericWind(hour.windGust);
  const gust = gustNum != null ? fmtWind(gustNum) : "Not reported";
  const feels = apparentTemperature(hour.temperature, humidity, numericWind(hour.windSpeed));
  const fwi = hourFwi(hour);
  openDetails("Hourly Forecast", time.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }), [
    ["Condition", hour.shortForecast || "Not reported", "cloud"],
    ["Fair Weather Index", `${fwi.score100} (${fwi.label})`, "fwi"],
    ["Temperature", `${fmtTemp(hour.temperature)}, feels like ${fmtTemp(feels)}`, "temp"],
    ["Dew Point", fmtTemp(dewPoint), "dew"],
    ["Humidity", `${f(humidity)}%`, "humidity"],
    ["Wind", `${hour.windDirection || ""} ${wind}`.trim(), "wind"],
    ["Gusts", gust, "wind"],
    ["Precipitation Chance", `${f(hour.probabilityOfPrecipitation?.value)}%`, "precip"],
  ], hour.detailedForecast || "");
}

// Expandable Fair Weather Index breakdown: one row per scoring component with
// the points earned, a tier-colored bar, and a short reason for the score.
function fwiBreakdownHtml(fwi, inputs = {}) {
  const TIER_COLORS = { good: "#4CAF50", fair: "#FFC107", poor: "#EF5350" };
  const NOTES = {
    temp: {
      good: "Feels-like temperatures sit close to the comfortable range for this time of year.",
      fair: "Temperatures run somewhat outside the seasonal comfort range.",
      poor: "Temperatures are well outside the comfortable range for this time of year.",
    },
    precip: {
      good: "Little to no precipitation expected.",
      fair: "A chance of precipitation could interrupt outdoor plans.",
      poor: "Precipitation is likely.",
    },
    wind: {
      good: "Light winds.",
      fair: "Breezy at times.",
      poor: "Strong winds will be disruptive outdoors.",
    },
    humidity: {
      good: "Comfortable humidity levels.",
      fair: "Humidity is a bit outside the comfortable range.",
      poor: "Uncomfortably dry or muggy air.",
    },
    cloud: {
      good: "Mostly sunny skies expected.",
      fair: "A mix of sun and clouds.",
      poor: "Mostly cloudy skies.",
    },
  };
  const ROWS = [
    ["temp", "Temperature", inputs.temp],
    ["precip", "Precipitation", inputs.precip],
    ["wind", "Wind", inputs.wind],
    ["humidity", "Humidity", inputs.humidity],
    ["cloud", "Cloud cover", inputs.cloud],
  ];
  return ROWS.map(([key, label, inputText]) => {
    const part = fwi.breakdown?.[key];
    if (!part) return "";
    const ratio = part.max ? part.pts / part.max : 0;
    const tier = ratio >= 0.8 ? "good" : ratio >= 0.45 ? "fair" : "poor";
    const note = inputText == null
      ? "No forecast data available — a neutral score was used."
      : NOTES[key][tier];
    return `
      <div class="fwi-break-row">
        <div class="fwi-break-head">
          <span class="fwi-break-label">${safeText(label)}${inputText ? ` <small>${safeText(inputText)}</small>` : ""}</span>
          <span class="fwi-break-pts" style="color:${TIER_COLORS[tier]}">${Math.round(part.pts)}/${part.max} pts</span>
        </div>
        <div class="fwi-break-bar"><span style="width:${Math.round(ratio * 100)}%;background:${TIER_COLORS[tier]}"></span></div>
        <p class="fwi-break-note">${safeText(note)}</p>
      </div>`;
  }).join("");
}

function showDailyDetails(index) {
  const pairs = getDailyPairs(weatherState.daily || []);
  const { day, night } = pairs[index] || {};
  if (!day) return;
  const extras = weatherState.dailyExtras || {};
  const precipDay = day.probabilityOfPrecipitation?.value;
  const precipNight = night?.probabilityOfPrecipitation?.value;
  const precip = precipDay ?? precipNight;
  const feelsHigh = extras.apparent_temperature_max?.[index] ?? apparentTemperature(day.temperature, weatherState.current?.humidity, numericWind(day.windSpeed));
  const feelsLow = extras.apparent_temperature_min?.[index] ?? (night ? apparentTemperature(night.temperature, weatherState.current?.humidity, numericWind(night.windSpeed)) : null);
  const uv = extras.uv_index_max?.[index] ?? weatherState.current?.uv;
  const windDay = numericWind(day.windSpeed);
  const windNight = night ? numericWind(night.windSpeed) : null;

  const periodDate = day.startTime ? new Date(day.startTime) : new Date();
  const fwi = FWI.calculate({
    temp: day.temperature,
    humidity: weatherState.current?.humidity,
    wind: windDay,
    gust: null,
    precipChance: precip,
    month: periodDate.getMonth(),
  });

  const periodCard = (label, icon, period, wind, precipPct) => `
    <div class="dn-card">
      <div class="dn-head"><span class="dn-label">${safeText(label)}</span>${icon}</div>
      <p class="dn-cond">${safeText(period.shortForecast || "Not reported")}</p>
      <div class="dn-rows">
        <span>${uiIcon("wind")} ${safeText(`${period.windDirection || ""} ${wind != null ? fmtWind(wind) : "Calm"}`.trim())}</span>
        <span>${uiIcon("precip")} ${f(precipPct ?? 0)}% precip</span>
      </div>
    </div>`;

  const statChip = (icon, label, value) => `
    <div class="day-modal-stat">${uiIcon(icon)}<div><small>${safeText(label)}</small><strong>${value}</strong></div></div>`;

  // Hazard outlook callouts (SPC severe / WPC excessive rain) for nearby days.
  const risks = [];
  if (index < 3) {
    const spcDay = weatherState.spcDays?.[index];
    const catLabel = spcDay?.catLabel || null;
    if (catLabel) {
      risks.push({ color: spcRiskColor(catLabel) || "#fbbf24", icon: "severe",
        title: catLabel === "TSTM" ? "General thunderstorms possible" : `${spcLabel(catLabel)} of severe storms`,
        sub: `${spcDaySummary(spcDay)} — SPC Day ${index + 1} convective outlook`.trim() });
    }
  }
  if (index < 5) {
    const wpcDay = weatherState.wpcDays?.[index];
    if (wpcDay?.label) {
      const wpcNames = { MRGL: "Marginal", SLGT: "Slight", MDT: "Moderate", HIGH: "High" };
      risks.push({ color: spcRiskColor(wpcDay.label) || "#60a5fa", icon: "precip",
        title: `${wpcNames[wpcDay.label] || wpcDay.label} risk of excessive rainfall`,
        sub: `WPC Day ${index + 1} excessive rainfall outlook` });
    }
  }
  const riskHtml = risks.length ? `<div class="day-modal-risks">${risks.map(risk => `
    <div class="day-modal-risk" style="border-color:${risk.color}55;background:${risk.color}14">
      <span class="day-modal-risk-icon" style="color:${risk.color}">${uiIcon(risk.icon)}</span>
      <div><strong style="color:${risk.color}">${safeText(risk.title)}</strong><small>${safeText(risk.sub)}</small></div>
    </div>`).join("")}</div>` : "";

  const discussion = [day.detailedForecast, night?.detailedForecast ? `Night: ${night.detailedForecast}` : ""]
    .filter(Boolean);

  modalEyebrow.textContent = "Daily Forecast";
  modalTitle.innerHTML = `${weatherIcon(iconForCondition(day.shortForecast), true)}<span>${safeText(day.name || "Forecast")}</span>`;
  modalBody.innerHTML = `
    <div class="day-modal-hero">
      <div class="day-modal-temps">
        <span class="day-modal-high">${uTempNum(day.temperature)}°</span>
        <span class="day-modal-low">/ ${night ? `${uTempNum(night.temperature)}°` : "--"}</span>
      </div>
      <div class="day-modal-hero-meta">
        <p>${safeText(day.shortForecast || "")}</p>
      </div>
    </div>
    <div class="day-night-split">
      ${periodCard("Day", weatherIcon(iconForCondition(day.shortForecast), true), day, windDay, precipDay)}
      ${night ? periodCard("Night",
        `<span class="weather-icon" aria-hidden="true">${WeatherIcons.fromText(iconForCondition(night.shortForecast), true)}</span>`,
        night, windNight, precipNight) : ""}
    </div>
    <div class="day-modal-stats">
      ${statChip("temp", "Feels like", `${uTempNum(feelsHigh)}° / ${feelsLow != null ? `${uTempNum(feelsLow)}°` : "--"}`)}
      ${statChip("uv", "UV index", f(uv, 1))}
      ${statChip("sunrise", "Sunrise", safeText(weatherState.astronomy?.sunrise || "--"))}
      ${statChip("sunset", "Sunset", safeText(weatherState.astronomy?.sunset || "--"))}
    </div>
    <details class="day-modal-fwi">
      <summary>
        <span class="fwi-badge" style="background:${fwi.bg};color:${fwi.color};border:1px solid ${fwi.color}44">${fwi.label}</span>
        <span class="day-modal-fwi-sum">
          <strong>Fair Weather Index — ${fwi.score100}/100</strong>
          <small>${safeText(fwi.sentence || "")} Tap to see what scored well and what didn't.</small>
        </span>
        <svg class="day-modal-fwi-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </summary>
      <div class="fwi-breakdown">
        ${fwiBreakdownHtml(fwi, {
          temp: day.temperature != null ? `high near ${uTempNum(day.temperature)}°` : null,
          precip: precip != null ? `${f(precip)}% chance` : null,
          wind: windDay != null ? fmtWind(windDay) : null,
          humidity: weatherState.current?.humidity != null ? `~${f(weatherState.current.humidity)}% (current)` : null,
          cloud: null,
        })}
      </div>
    </details>
    ${riskHtml}
    ${discussion.length ? `
      <div class="day-modal-text">
        <span class="dn-label">Forecast Discussion</span>
        ${discussion.map(text => `<p>${safeText(text)}</p>`).join("")}
      </div>` : ""}
  `;
  detailModal.hidden = false;
  document.body.classList.add("modal-open");
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

function alertDisplayEvent(alert) {
  const event = alert.event || "Weather Alert";
  const tags = (alert.tags || []).map(t => t.toLowerCase());
  if (event.toLowerCase() === "flash flood warning" &&
      (tags.some(t => t.includes("emergency")) || tags.some(t => t.includes("catastrophic")))) {
    return "Flash Flood Emergency";
  }
  return event;
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

// Per-alert-type level tables shown in the alert modal
const ALERT_LEVEL_CATEGORIES = {
  "Flash Flood Warning": [
    { label: "WARNING",      color: "#10b981", desc: "Flash flooding is occurring or imminent. Move to higher ground immediately. Never drive through flooded roads." },
    { label: "OBSERVED",     color: "#22d3ee", desc: "Flash flooding confirmed by a trained spotter or emergency manager. Life-threatening conditions are ongoing." },
    { label: "CONSIDERABLE", color: "#f97316", desc: "Particularly dangerous flash flooding — life-threatening conditions are occurring or imminent. Move to higher ground immediately and stay out of all flood-prone areas." },
    { label: "EMERGENCY",    color: "#dc2626", desc: "Catastrophic, life-threatening flooding is in progress. This is an exceptionally rare and extreme event — move to safety immediately." },
  ],
  "Tornado Warning": [
    { label: "WARNING",   color: "#dc2626", desc: "A tornado is imminent or occurring. Take shelter immediately in a lowest-floor interior room away from windows." },
    { label: "PDS",       color: "#a855f7", desc: "Particularly Dangerous Situation — a long-track, violent tornado is likely. Extreme caution and immediate shelter required." },
    { label: "EMERGENCY", color: "#7c3aed", desc: "Tornado Emergency — a confirmed, extremely dangerous tornado is causing catastrophic damage. Act immediately." },
  ],
  "Severe Thunderstorm Warning": [
    { label: "WARNING",     color: "#f97316", desc: "Damaging winds and/or large hail from severe thunderstorms. Move indoors and away from windows." },
    { label: "CONSIDERABLE",color: "#ef4444", desc: "Particularly dangerous storm with winds 70–80+ mph or hail 1.75\"+ diameter. Seek sturdy shelter immediately." },
    { label: "DESTRUCTIVE", color: "#991b1b", desc: "Extremely dangerous storm with wind damage threat 80+ mph and/or hail 2.75\"+ diameter. Catastrophic damage likely." },
  ],
  "Tornado Watch": [
    { label: "WATCH",     color: "#a855f7", desc: "Conditions are favorable for tornadoes in the watch area. Review your shelter plan and stay alert." },
    { label: "PDS WATCH", color: "#7c3aed", desc: "Particularly Dangerous Situation Watch — significant, long-track tornadoes are possible. Take action now." },
  ],
  "Severe Thunderstorm Watch": [
    { label: "WATCH", color: "#f59e0b", desc: "Conditions are favorable for severe thunderstorms (large hail and/or damaging winds) in and near the watch area." },
  ],
  "Flash Flood Watch": [
    { label: "WATCH", color: "#14b8a6", desc: "Conditions are favorable for flash flooding. Be ready to move to higher ground on short notice." },
  ],
  "Winter Storm Warning": [
    { label: "WARNING",  color: "#38bdf8", desc: "Heavy snow (6\"+ or 4\"+ with wind) or significant ice accretion expected. Travel will be dangerous or impossible." },
    { label: "BLIZZARD", color: "#7dd3fc", desc: "Snow and sustained winds 35+ mph causing whiteout conditions. Do not travel. Potentially life-threatening." },
  ],
};

// Custom safety tips per alert type. If not defined, precautionary actions from alert text are shown.
const ALERT_CUSTOM_TIPS = {
  "Flash Flood Warning": [
    "Move away from streams, rivers, and low-lying areas immediately",
    "Never walk, swim, or drive through flood waters — Turn Around, Don't Drown",
    "Just 6 inches of fast-moving water can knock you down; 12 inches can carry a vehicle",
    "Evacuate immediately if directed by local officials",
  ],
  "Tornado Warning": [
    "Go immediately to a basement or interior room on the lowest floor of a sturdy building",
    "Stay away from windows, doors, and outside walls — cover your head",
    "Mobile homes are NOT safe even if tied down — go to a sturdy building",
    "If caught outside, find the nearest substantial building or ditch and lie flat",
    "Do not try to outrun a tornado in a vehicle — abandon the car if a building is nearby",
  ],
  "Severe Thunderstorm Warning": [
    "Move indoors to a sturdy building immediately and stay away from windows",
    "Unplug electronics and avoid contact with plumbing during lightning",
    "If outdoors, avoid tall trees, open fields, and metal objects — seek a low depression",
    "Large hail can shatter glass — stay away from skylights and windows",
    "Be prepared for sudden power outages",
  ],
  "Tornado Watch": [
    "Know the location of your nearest shelter and have it ready",
    "Monitor local weather alerts and have a way to receive warnings (phone, radio)",
    "Watches can become Warnings with little notice — act quickly when upgraded",
    "Charge your devices and prepare an emergency kit",
  ],
  "Severe Thunderstorm Watch": [
    "Stay weather-aware and check for warnings frequently",
    "Secure outdoor furniture and loose objects that can become projectiles",
    "Plan where you'll shelter if a warning is issued",
    "Avoid outdoor activities until the threat has passed",
  ],
  "Winter Storm Warning": [
    "Avoid travel if possible — road conditions may be life-threatening",
    "If you must travel, carry an emergency kit with blankets, food, water, and a flashlight",
    "Keep extra food, water, and medication at home for extended outages",
    "Never run a generator, grill, or kerosene heater indoors",
    "Check on elderly neighbors and those without adequate heat",
  ],
  "Flash Flood Watch": [
    "Identify the lowest floor of your building as your rally point if flooding occurs",
    "Avoid camping or parking along streams and rivers",
    "Never drive through standing water or road closures — water depth is deceptive",
  ],
};

const ALERT_TIPS_TITLES = {
  "Flash Flood Warning":   "Move to Higher Ground Now",
  "Tornado Warning":       "Take Shelter Immediately",
  "Severe Thunderstorm Warning": "Seek Shelter Now",
  "Tornado Watch":         "Be Prepared",
  "Severe Thunderstorm Watch": "Stay Alert",
  "Winter Storm Warning":  "Stay Safe Indoors",
  "Flash Flood Watch":     "Prepare Now",
};

function showAlertDetails(indexOrAlert) {
  const alert = typeof indexOrAlert === "number"
    ? weatherState.alerts?.[indexOrAlert]
    : indexOrAlert;
  if (!alert) return;
  const sections = parseAlertSections(alert.description);
  const event = alert.event || "Weather Alert";
  const displayEvent = alertDisplayEvent(alert);
  const severity = alert.severity || "";
  const tags = alert.tags || [];
  const currentTagsLower = tags.map(t => t.toLowerCase());

  modalEyebrow.textContent = "Weather Alert";
  modalTitle.textContent = displayEvent;

  // Severity badge colors
  const sevBg = { Extreme: "#dc262622", Severe: "#f9731622", Moderate: "#f59e0b22", Minor: "#22d3ee22" };
  const sevColor = { Extreme: "#ef4444", Severe: "#fb923c", Moderate: "#fbbf24", Minor: "#67e8f9" };
  const bg = sevBg[severity] || "rgba(148,163,184,0.15)";
  const col = sevColor[severity] || "#94a3b8";

  // Tags row
  const tagsHtml = `<div class="alert-modal-tags">
    ${severity ? `<span class="alert-modal-tag" style="background:${bg};color:${col};border:1px solid ${col}55">${safeText(severity)}</span>` : ""}
    ${tags.map(t => `<span class="alert-modal-tag">${safeText(t)}</span>`).join("")}
  </div>`;

  // Meta
  const expires = alert.expires ? new Date(alert.expires).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "--";
  const areas = alert.areaDesc || selectedLocation.name;
  const metaHtml = `<div class="alert-modal-meta">
    <span>Expires: ${safeText(expires)}</span>
    <span class="alert-modal-area">${safeText(areas)}</span>
  </div>`;

  // Main sections — WHAT and IMPACTS most prominent
  const makeSec = (label, text) => text ? `<div class="alert-section">
    <div class="alert-section-label">${label}</div>
    <p>${safeText(text)}</p>
  </div>` : "";

  // Fall back to headline when description has no parseable sections (common for IEM-only alerts)
  const noSections = !sections.WHAT && !sections.WHERE && !sections.WHEN && !sections.IMPACTS;
  const rawDesc = (alert.description || "").trim();
  // When no structured sections, show raw description if available; otherwise use headline
  const whatFallback = noSections
    ? (rawDesc ? null : (alert.headline || null))
    : null;
  const whatHtml    = makeSec("WHAT",    sections.WHAT || whatFallback);
  const impactsHtml = makeSec("IMPACTS", sections.IMPACTS);
  const whereHtml   = makeSec("WHERE",   sections.WHERE);
  const whenHtml    = makeSec("WHEN",    sections.WHEN);
  // Show raw description text when sections couldn't be parsed (e.g. IEM alerts without structured NWS text)
  const rawDescHtml = (noSections && rawDesc)
    ? `<div class="alert-section"><div class="alert-section-label">Details</div><p class="alert-raw-desc">${safeText(rawDesc)}</p></div>`
    : "";

  // Hazard tags
  const hazardItems = [
    severeDetectionTag(alert) && `Detection: ${severeDetectionTag(alert)}`,
    alert.iem_windtag    && `Wind: ${formatWindTag(alert.iem_windtag)}`,
    alert.iem_hailtag    && `Hail: ${formatHailTag(alert.iem_hailtag)}`,
    alert.iem_damagetag  && `Damage: ${alert.iem_damagetag}`,
    alert.iem_tornadotag && `Tornado: ${alert.iem_tornadotag}`,
    alert.iem_floodtag   && `Flood tag: ${alert.iem_floodtag}`,
  ].filter(Boolean);
  const hazardHtml = hazardItems.length ? `<div class="alert-hazard-tags">${hazardItems.map(h => `<span class="alert-hazard-tag">${safeText(h)}</span>`).join("")}</div>` : "";

  // Level categories table
  const categories = ALERT_LEVEL_CATEGORIES[event] || null;
  const activeLevel = categories ? (() => {
    if (currentTagsLower.some(t => t.includes("emergency"))) return "EMERGENCY";
    if (currentTagsLower.some(t => t.includes("pds") || t.includes("particularly dangerous"))) return "PDS";
    if (currentTagsLower.some(t => t.includes("destructive"))) return "DESTRUCTIVE";
    if (currentTagsLower.some(t => t.includes("considerable"))) return "CONSIDERABLE";
    if (currentTagsLower.some(t => t.includes("observed"))) return "OBSERVED";
    return "WARNING";
  })() : null;
  const categoriesHtml = categories ? `<div class="alert-level-table">
    <div class="alert-level-title">${safeText(displayEvent.toUpperCase())} LEVELS</div>
    ${categories.map(cat => `<div class="alert-level-row${cat.label === activeLevel ? " active-level" : ""}">
      <span class="alert-level-label" style="color:${cat.color}">${safeText(cat.label)}</span>
      <span class="alert-level-desc">${safeText(cat.desc)}</span>
    </div>`).join("")}
  </div>` : "";

  // Safety tips: custom > PRECAUTIONARY/PREPAREDNESS ACTIONS > instruction
  const customTips = ALERT_CUSTOM_TIPS[event];
  const prepActions = sections["PRECAUTIONARY/PREPAREDNESS ACTIONS"];
  let tipsHtml = "";
  const tipsTitle = ALERT_TIPS_TITLES[event] || "What You Should Do";
  if (customTips) {
    tipsHtml = `<div class="alert-tips">
      <div class="alert-tips-title">${safeText(tipsTitle)}</div>
      <ul>${customTips.map(tip => `<li>${safeText(tip)}</li>`).join("")}</ul>
    </div>`;
  } else if (prepActions) {
    tipsHtml = `<div class="alert-tips">
      <div class="alert-tips-title">Precautionary Actions</div>
      <p>${safeText(prepActions)}</p>
    </div>`;
  } else if (alert.instruction) {
    tipsHtml = `<div class="alert-tips">
      <div class="alert-tips-title">${safeText(tipsTitle)}</div>
      <p>${safeText(alert.instruction)}</p>
    </div>`;
  } else {
    tipsHtml = `<div class="alert-tips">
      <div class="alert-tips-title">${safeText(tipsTitle)}</div>
      <p>${safeText(alertAdvice(alert))}</p>
    </div>`;
  }

  const srcLabel = alert.source === "IEM" ? "IEM storm-based warning"
    : alert.source === "ECCC" ? "ECCC weather.gc.ca"
    : `NWS API (${alert.source || "NWS"})`;
  const srcHtml = `<p class="alert-modal-source">Source: ${safeText(srcLabel)}</p>`;

  modalBody.innerHTML = tagsHtml + metaHtml + hazardHtml + whatHtml + impactsHtml + whereHtml + whenHtml + rawDescHtml + categoriesHtml + tipsHtml + srcHtml;
  detailModal.hidden = false;
  document.body.classList.add("modal-open");
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
    ["Wind", `${f(aviation?.windDirection)}° at ${f(aviation?.windKt)} kt / ${fmtWind(aviation?.windMph)}${aviation?.gustKt ? `, gusting ${aviation.gustKt} kt` : ""}`],
    ["Visibility", aviation?.visibility == null ? "--" : fmtVis(aviation.visibility)],
    ["Ceiling", aviation?.ceiling == null ? "No ceiling reported" : `${f(aviation.ceiling)} ft`],
    ["Temperature", `${fmtTemp(aviation?.temp)} / dew point ${fmtTemp(aviation?.dewPoint)}`],
    ["Sky", aviation?.sky?.join(", ") || "Not reported"],
    ["Altimeter", fmtPressure(aviation?.pressure ?? current.pressure)],
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
  if (window.innerWidth < 1120) {
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  }
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
      if (rain != null && rain > 0) parts.push(`Rain: ${fmtPrecip(rain)}`);
      if (snow != null && snow > 0) parts.push(`Snow: ${fmtSnow(snow)}`);
      return parts.length ? parts.join(" · ") : "No precipitation";
    })();
    // Compute mean humidity and dew point from hourly data (not available as daily archive fields)
    let humSum = 0, humCnt = 0, dewSum = 0, dewCnt = 0;
    let hourlyHtml = "";
    if (h?.time) {
      h.time.forEach((t, idx) => {
        if (!t.startsWith(date)) return;
        const hum = h.relative_humidity_2m?.[idx];
        const dp = h.dew_point_2m?.[idx];
        if (hum != null) { humSum += hum; humCnt++; }
        if (dp != null) { dewSum += dp; dewCnt++; }
        const hr = parseInt(t.slice(11, 13), 10);
        const label = hr === 0 ? "12 AM" : hr < 12 ? `${hr} AM` : hr === 12 ? "12 PM" : `${hr - 12} PM`;
        const temp = h.temperature_2m?.[idx];
        const pr = h.precipitation?.[idx];
        const ws = h.wind_speed_10m?.[idx];
        const cond = wmoDescription(h.weather_code?.[idx]);
        const hourDate = new Date(t);
        const sunTimes = historicalSunTimesFor(hourDate, sunriseStr, sunsetStr);
        const isNight = isNightAt(hourDate, sunTimes?.sunriseDate, sunTimes?.sunsetDate);
        hourlyHtml += `
          <div class="hist-hourly-item">
            <div class="hist-hourly-time">${label}</div>
            <div class="hist-hourly-icon"><span class="weather-icon" aria-hidden="true">${WeatherIcons.fromText(cond, isNight)}</span></div>
            <div class="hist-hourly-temp">${temp != null ? uTempNum(temp) + "°" : "--"}</div>
            <div class="hist-hourly-wind">${ws != null ? fmtWind(ws) : "--"}</div>
            ${pr != null && pr > 0 ? `<div class="hist-hourly-precip">${fmtPrecip(pr)}</div>` : ""}
          </div>`;
      });
    }
    const humidity = humCnt > 0 ? humSum / humCnt : null;
    const dew = dewCnt > 0 ? dewSum / dewCnt : null;
    const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    const stats = [
      ["Peak Wind", windMax != null ? fmtWind(windMax) : "--", windGust != null ? `${fmtWind(windGust)} gusts · ${windDirLabel(windDir)}` : "--", "wind"],
      ["Avg Humidity", humidity != null ? `${Math.round(humidity)}%` : "--", `Dew point: ${dew != null ? fmtTemp(dew) : "--"}`, "humidity"],
      ["Avg Pressure", pressure == null ? "--" : (isMetric() ? `${Math.round(pressure)} hPa` : (pressure * 0.02953).toFixed(2) + " inHg"), pressure == null ? "--" : (isMetric() ? (pressure * 0.02953).toFixed(2) + " inHg" : Math.round(pressure) + " hPa"), "pressure"],
      ["Cloud Cover", cloud != null ? `${Math.round(cloud)}%` : "--", cloudCoverLabel(cloud), "cloud"],
      ["Precipitation", precip != null ? fmtPrecip(precip) : fmtPrecip(0), precipDetail, "precip"],
      ...(snow != null && snow > 0 ? [["Snowfall", fmtSnow(snow), "Snow total", "snow"]] : []),
      ["Sunshine", sunshineHours(sunshine), "Duration of sunshine", "sunshine"],
      ["Sun Times", fmtTime(sunriseStr), `Sunrise · Sunset ${fmtTime(sunsetStr)}`, "sunrise"],
    ];
    result.innerHTML = `
      <div class="hist-hero tile">
        <div class="hist-hero-left">
          <p class="eyebrow">${safeText(dateLabel)}</p>
          <div class="hist-temp-range">
            <span class="hist-temp-hi">${highTemp != null ? uTempNum(highTemp) + "°" : "--"}</span>
            <span class="hist-temp-sep"> / </span>
            <span class="hist-temp-lo">${lowTemp != null ? uTempNum(lowTemp) + "°" : "--"}</span>
            <sup>${tempUnit()}</sup>
          </div>
          <p>${safeText(condition)}</p>
          <p class="hist-feels">Feels like ${feelsHigh != null ? uTempNum(feelsHigh) + "°" : "--"} high / ${feelsLow != null ? uTempNum(feelsLow) + "°" : "--"} low</p>
        </div>
        <div class="hist-hero-icon"><span class="weather-icon" aria-hidden="true">${WeatherIcons.fromText(condition, false)}</span></div>
      </div>
      ${hourlyHtml ? `
      <div class="tile hist-hourly-panel">
        <div class="section-head"><p class="eyebrow">Hourly Breakdown</p></div>
        <div class="hist-hourly-strip">${hourlyHtml}</div>
      </div>` : ""}
      <div class="hist-stats-grid">
        ${stats.map(([label, value, detail, icon]) => `
          <div class="hist-stat-card tile">
            <div class="hist-stat-head">
              ${icon ? uiIcon(icon) : ""}
              <p class="eyebrow">${safeText(label)}</p>
            </div>
            <strong>${safeText(value)}</strong>
            <small>${safeText(detail)}</small>
          </div>
        `).join("")}
      </div>
    `;
  } catch (error) {
    result.innerHTML = `<div class="climate-message" style="color:#f87171;">${safeText(error.message)}</div>`;
  }
  if (window.innerWidth < 1120) {
    result.scrollIntoView({ behavior: "smooth", block: "start" });
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
  // Measure the canvas's actual rendered size so its buffer matches the CSS
  // overshoot. iOS standalone can still clip fixed elements out of safe-area
  // bands, so the root html gradient mirrors this palette as the reliable fallback.
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  const bufferW = Math.round(width * dpr);
  const bufferH = Math.round(height * dpr);
  if (canvas.width !== bufferW || canvas.height !== bufferH) {
    canvas.width = bufferW;
    canvas.height = bufferH;
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

function mrmsFrameArray() {
  // Returns [MRMS_FRAMES-1, ..., 1, 0] so slider 0=oldest, slider max=latest(mrmsIdx=0)
  return Array.from({ length: MRMS_FRAMES }, (_, i) => MRMS_FRAMES - 1 - i);
}


function stopRadarAnimation() {
  if (radarAnimationTimer) clearInterval(radarAnimationTimer);
  radarAnimationTimer = null;
  const lbl = document.querySelector("#playLabel");
  if (lbl) lbl.textContent = "Play";
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
      <p class="eyebrow"><span class="sidebar-icon"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></span> ${safeText(selectedLocation.name)}</p>
      <h3>${fmtTemp(current.temp)} — ${safeText(current.condition || "Conditions")}</h3>
      <div class="sidebar-chip-row">
        <div class="sidebar-chip">
          <span class="sidebar-chip-label">Feels</span>
          <span class="sidebar-chip-val">${uTempNum(current.temp)}°</span>
        </div>
        <div class="sidebar-chip">
          <span class="sidebar-chip-label">Wind</span>
          <span class="sidebar-chip-val">${fmtWind(current.wind)}</span>
        </div>
        <div class="sidebar-chip">
          <span class="sidebar-chip-label">Humidity</span>
          <span class="sidebar-chip-val">${f(current.humidity)}%</span>
        </div>
      </div>
    </div>

    <div class="sidebar-tile">
      <p class="eyebrow"><span class="sidebar-icon"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span> SPC Day 1 Outlook</p>
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
      <p class="eyebrow"><span class="sidebar-icon"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg></span> Fair Weather Index</p>
      <h3 style="color:${fwi.color}">${fwi.label} (${fwi.score100}/100)</h3>
      <p>${fwiNote(fwi.score100)}</p>
    </div>

    ${alerts.length ? `
    <div class="sidebar-tile">
      <p class="eyebrow"><span class="sidebar-icon"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span> ${alerts.length} Active Alert${alerts.length > 1 ? "s" : ""}</p>
      ${alerts.slice(0, 2).map(a => `<h3 style="margin-bottom:4px;font-size:0.9rem;">${safeText(a.event)}</h3>`).join("")}
      ${alerts.length > 2 ? `<small style="color:var(--muted)">+${alerts.length - 2} more alerts</small>` : ""}
    </div>` : ""}

    <div class="sidebar-tile">
      <p class="eyebrow"><span class="sidebar-icon"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg></span> Observation</p>
      <h3>${uTempNum(current.temp)}° / Dew ${uTempNum(current.dewPoint)}°</h3>
      <p style="font-size:0.8rem;color:var(--muted)">
        ${astronomy ? `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="display:inline;vertical-align:middle;margin-right:2px"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2"/></svg>${astronomy.sunrise} — <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" style="display:inline;vertical-align:middle;margin-right:2px"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>${astronomy.sunset}` : "Sun times loading…"}
      </p>
    </div>

    <div class="sidebar-tile">
      <p class="eyebrow"><span class="sidebar-icon"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 22V8M5 12H2m20 0h-3m-4-7V3m0 18v-2M8.5 8.5L6 6m12 12-2.5-2.5M15.5 8.5 18 6M6 18l2.5-2.5"/></svg></span> Drought Monitor</p>
      <h3>${safeText(mapState.drought || "No active drought")}</h3>
      <p>USDM classification for this area.</p>
    </div>
  `;
}

function mrmsImgUrl(mrmsIdx) {
  return MRMS_BASE + MRMS_PRODUCTS[activeMrmsProduct].getImg(mrmsIdx);
}

function updateRadarLabel() {
  const labelEl = document.querySelector("#radarTimeLabel");
  if (!labelEl) return;
  const slider = document.querySelector("#radarTimeline");

  // Satellite owns the timeline whenever it is active.
  if (satelliteActive) {
    if (slider) slider.value = String(satFrameIndex);
    const frame = satFrames.length ? satFrames[satFrameIndex] : 0;
    labelEl.textContent = frame === 0 ? "Latest" : `−${frame} frame${frame > 1 ? "s" : ""}`;
    return;
  }

  if (slider) slider.value = String(radarFrameIndex);
  const mrmsIdx = Array.isArray(radarFrames) && radarFrames.length ? radarFrames[radarFrameIndex] : 0;
  if (mrmsIdx === 0) { labelEl.textContent = "Latest"; return; }
  const key = `${activeMrmsProduct}_${mrmsIdx}`;
  if (mrmsTimeCache[key]) { labelEl.textContent = mrmsTimeCache[key]; return; }
  labelEl.textContent = `−${mrmsIdx * 10}min`;
  // Lazily fetch time from metadata
  const cfg = MRMS_PRODUCTS[activeMrmsProduct];
  const capturedIdx = mrmsIdx;
  fetch(`${MRMS_BASE}${cfg.getMeta(capturedIdx)}`)
    .then(r => r.json())
    .then(meta => {
      if (meta.time) {
        mrmsTimeCache[key] = meta.time;
        if (radarFrames[radarFrameIndex] === capturedIdx) labelEl.textContent = meta.time;
      }
    })
    .catch(() => {});
}

function setRadarFrame(index) {
  radarFrameIndex = Math.max(0, Math.min(radarFrames.length - 1, Number(index)));
  if (radarMap && mapLoaded && radarActive) {
    const src = radarMap.getSource("mrms-source");
    if (src) {
      const mrmsIdx = radarFrames[radarFrameIndex];
      const url = mrmsImgUrl(mrmsIdx);
      // Preload to avoid blank flash, then update
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => src.updateImage({ url });
      img.src = url;
    }
  }
  updateRadarLabel();
}

function setRainfallOpacity(pct) {
  radarOpacity = pct / 100;
  if (radarMap && mapLoaded) {
    if (radarMap.getLayer("mrms-layer"))
      radarMap.setPaintProperty("mrms-layer", "raster-opacity", radarOpacity);
    if (radarMap.getLayer("satellite-layer"))
      radarMap.setPaintProperty("satellite-layer", "raster-opacity", radarOpacity);
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
  clearTimeout(radarFrameTransitionTimer);
  ["mrms-layer",
   "radar-layer-a", "radar-layer-b",
   "spc-fill", "spc-line", "spc-cig-fill", "spc-cig-line",
   "drought-fill", "drought-line",
   "alerts-fill", "alerts-line", "nws-alerts-fill", "nws-alerts-line",
   "fire-fill", "fire-line",
   "wpc-rain-fill", "wpc-rain-line",
   "lsr-hit",
   "surface-layer",
   "satellite-layer",
   "cyclones-radii-fill", "cyclones-radii-line", "cyclones-track",
   "cyclones-points", "cyclones-labels",
  ].forEach(removeMapLayer);
  ["mrms-source",
   "radar-source-a", "radar-source-b",
   "spc-source",
   "drought-source",
   "alerts-source", "nws-alerts-source",
   "fire-source",
   "wpc-rain-source",
   "lsr-source",
   "surface-source",
   "satellite-source",
   "cyclones-radii-source", "cyclones-track-source", "cyclones-points-source",
  ].forEach(removeMapSource);
  document.querySelectorAll(".lsr-marker-wrap").forEach(el => el.remove());
  const leg = document.querySelector("#spcLegendBox");
  if (leg) leg.hidden = true;
  const mrmsLeg = document.querySelector("#mrmsLegendBox");
  if (mrmsLeg) mrmsLeg.hidden = true;
  radarSlot = 0;
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
      localStorage.setItem("weatherBasemap", activeBasemap);
      container.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
      if (radarMap) {
        radarMap.setStyle(`mapbox://styles/mapbox/${activeBasemap}`);
        radarMap.once("style.load", () => {
          mapLoaded = true;
          radarMap.setProjection("mercator"); // keep flat projection across basemap swaps
          // Clear per-layer wiring flags so cursor handlers are re-added
          popupWiredLayers.delete("spc"); popupWiredLayers.delete("fire");
          popupWiredLayers.delete("wpc-rain"); popupWiredLayers.delete("all-alerts");
          droughtPopupWired = false;
          drawRadar(false);
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
    // Mapbox GL v3 defaults to the globe projection, which mis-places lat/lon
    // image overlays (satellite frames) and can't handle antimeridian-crossing
    // extents. Flat Mercator matches the source repos' Leaflet viewers exactly.
    projection: "mercator",
  });
  radarMap.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");
  radarMap.addControl(new mapboxgl.ScaleControl({ unit: "imperial" }), "bottom-right");
  radarMap.on("load", () => {
    mapLoaded = true;
    drawRadar(true);
    wireUnifiedClickHandler();
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        updateUserLocationMarker(pos.coords.latitude, pos.coords.longitude);
      }, () => {}, { timeout: 5000, maximumAge: 120000 });
    }
  });
  updateRadarLabel();
  document.querySelector("#mapLocateBtn")?.addEventListener("click", locateOnMap);
}

async function addRadarLayer() {
  // Fetch bounds once (all MRMS products share the same CONUS extent)
  if (!mrmsImageBounds) {
    try {
      const meta = await fetch(`${MRMS_BASE}metadata_0.json?t=${Date.now()}`).then(r => r.json());
      if (meta.bounds) {
        const [[south, west], [north, east]] = meta.bounds;
        mrmsImageBounds = { south, west, north, east };
      }
    } catch {}
    // Fallback matches the live MRMS source extent, which now reaches 55°N to
    // cover populated Canada (only used if the metadata fetch above fails).
    if (!mrmsImageBounds) mrmsImageBounds = { south: 20, west: -130, north: 55, east: -60 };
  }

  radarFrames = mrmsFrameArray();
  radarFrameIndex = radarFrames.length - 1; // latest = mrmsIdx 0
  const slider = document.querySelector("#radarTimeline");
  if (slider) { slider.max = radarFrames.length - 1; slider.value = radarFrameIndex; }

  const mrmsIdx = radarFrames[radarFrameIndex]; // 0 = latest
  const { west, east, north, south } = mrmsImageBounds;
  const coords = [[west, north], [east, north], [east, south], [west, south]];

  radarMap.addSource("mrms-source", {
    type: "image",
    url: mrmsImgUrl(mrmsIdx),
    coordinates: coords,
  });
  addWeatherLayer({
    id: "mrms-layer",
    type: "raster",
    source: "mrms-source",
    paint: { "raster-opacity": radarOpacity, "raster-fade-duration": 400, "raster-resampling": "nearest" },
  });
  updateRadarLabel();
  renderMrmsLegend();

  // Update the product select to reflect current product
  const sel = document.querySelector("#mrmsProductSelect");
  if (sel) sel.value = activeMrmsProduct;
}

async function addSpcLayer() {
  if (!radarMap || !mapLoaded) return;
  const type = activeSpcType; // cat | torn | wind | hail | prob
  const day  = activeSpcDay;  // 1-8
  const cacheKey = `${day}_${type}`;
  const url = spcUrlFor(day, type);
  if (!url) return;

  if (!spcLayerData[cacheKey]) {
    spcLayerData[cacheKey] = normalizeSpcData(await fetchOutlookGeoJson(url));
  }
  const data = spcLayerData[cacheKey];

  radarMap.addSource("spc-source", { type: "geojson", data });
  const isCat = type === "cat";

  // Build the probability fill/line step expressions from the active day/type color scale.
  const probFill = ["step", ["coalesce", ["get", "RISK_NUM"], 0], "rgba(0,0,0,0)"];
  const probLine = ["step", ["coalesce", ["get", "RISK_NUM"], 0], "rgba(0,0,0,0)"];
  spcProbStops(day, type).forEach(([p, c]) => { probFill.push(p, c); probLine.push(p, c); });

  addWeatherLayer({
    id: "spc-fill",
    type: "fill",
    source: "spc-source",
    paint: {
      "fill-color": isCat
        ? ["match", ["upcase", ["coalesce", ["get", "LABEL"], ""]],
          "TSTM", "#c0e8c0", "MRGL", "#66cc66", "SLGT", "#ffe066", "ENH", "#ffa040", "MDT", "#ff6060", "HIGH", "#ff40ff", "rgba(0,0,0,0)"]
        : probFill,
      "fill-opacity": 0.46,
    },
  });
  addWeatherLayer({
    id: "spc-line",
    type: "line",
    source: "spc-source",
    paint: {
      "line-color": isCat
        ? ["match", ["upcase", ["coalesce", ["get", "LABEL"], ""]],
          "TSTM", "#96d896", "MRGL", "#44bb44", "SLGT", "#ddbb00", "ENH", "#cc7700", "MDT", "#cc2222", "HIGH", "#cc00cc", "rgba(0,0,0,0)"]
        : probLine,
      "line-width": 1.4,
    },
  });

  // Conditional Intensity Group (CIG) significant-severe areas overlay the probability
  // fill with a heavy black outline and a hatch pattern keyed to intensity:
  //   CIG1 → dashed single lines, CIG2 → solid single lines, CIG3 → cross-hatch.
  ensureCigHatchImages();
  const cigFilter = ["in", ["upcase", ["coalesce", ["get", "LABEL"], ""]], ["literal", ["CIG1", "CIG2", "CIG3"]]];
  addWeatherLayer({
    id: "spc-cig-fill",
    type: "fill",
    source: "spc-source",
    filter: cigFilter,
    paint: {
      "fill-pattern": ["match", ["upcase", ["coalesce", ["get", "LABEL"], ""]],
        "CIG1", "cig-hatch-1", "CIG2", "cig-hatch-2", "CIG3", "cig-hatch-3", "cig-hatch-2"],
      "fill-opacity": 0.95,
    },
  });
  addWeatherLayer({
    id: "spc-cig-line",
    type: "line",
    source: "spc-source",
    filter: cigFilter,
    paint: { "line-color": "#000000", "line-width": 2.2 },
  });

  if (!popupWiredLayers.has("spc")) {
    radarMap.on("mouseenter", "spc-fill", () => { radarMap.getCanvas().style.cursor = "pointer"; });
    radarMap.on("mouseleave", "spc-fill", () => { radarMap.getCanvas().style.cursor = ""; });
    popupWiredLayers.add("spc");
  }

  renderSpcLegend();
}

// Registers the three CIG hatch patterns as map images, once per map instance.
function ensureCigHatchImages() {
  for (const level of [1, 2, 3]) {
    const id = `cig-hatch-${level}`;
    if (!radarMap.hasImage(id)) radarMap.addImage(id, makeCigHatch(level));
  }
}

// Builds a tileable black hatch pattern over a transparent background:
//   level 1 → dashed "/" lines, level 2 → solid "/" lines, level 3 → "/" + "\" cross-hatch.
function makeCigHatch(level) {
  const size = 16, spacing = 8, thick = 2;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d1 = (x + y) % spacing;                 // "/" diagonal family
      const d2 = ((x - y) % spacing + spacing) % spacing; // "\" diagonal family
      let draw;
      if (level === 3)      draw = d1 < thick || d2 < thick;
      else if (level === 2) draw = d1 < thick;
      else                  draw = d1 < thick && (((x - y) % 8 + 8) % 8) < 5; // dashed
      if (draw) {
        const i = (y * size + x) * 4;
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
      }
    }
  }
  return { width: size, height: size, data };
}

// MapServer layer IDs: Day1 Outlook=1, Day2 Outlook=4
const FIRE_WX_LAYERS = { 1: 1, 2: 4 };
// MapServer dn values: 5=Elevated, 8=Critical, 10=Extreme
const FIRE_WX_DN_LABELS = { 5: "ELEVATED", 8: "CRITICAL", 10: "EXTREME" };

async function addFireWeatherLayer() {
  if (!radarMap || !mapLoaded) return;
  const day = activeFireDay;
  if (!fireWeatherDataCache[day]) {
    const layer = FIRE_WX_LAYERS[day];
    const queryUrl = `${FIRE_WX_MAPSERVER_BASE}/${layer}/query?where=1%3D1&outFields=*&f=geojson&outSR=4326`;
    const raw = await fetchOutlookGeoJson(queryUrl);
    fireWeatherDataCache[day] = {
      ...raw,
      features: (raw?.features || []).map(feat => {
        const p = feat.properties || {};
        const label = FIRE_WX_DN_LABELS[p.dn]
          ?? String(p.label ?? p.Label ?? p.LABEL ?? p.risk ?? p.Risk ?? p.RISK ?? "").toUpperCase();
        return { ...feat, properties: { ...p, LABEL: label } };
      }),
    };
  }
  radarMap.addSource("fire-source", { type: "geojson", data: fireWeatherDataCache[day] });
  addWeatherLayer({
    id: "fire-fill", type: "fill", source: "fire-source",
    paint: {
      "fill-color": ["match", ["upcase", ["coalesce", ["get", "LABEL"], ""]],
        "ELEVATED", "#fbbf24", "CRITICAL", "#f97316", "EXTREME", "#ef4444",
        "rgba(0,0,0,0)"],
      "fill-opacity": 0.44,
    },
  });
  addWeatherLayer({
    id: "fire-line", type: "line", source: "fire-source",
    paint: {
      "line-color": ["match", ["upcase", ["coalesce", ["get", "LABEL"], ""]],
        "ELEVATED", "#d97706", "CRITICAL", "#ea580c", "EXTREME", "#b91c1c",
        "rgba(0,0,0,0)"],
      "line-width": 1.5,
    },
  });
  if (!popupWiredLayers.has("fire")) {
    radarMap.on("mouseenter", "fire-fill", () => { radarMap.getCanvas().style.cursor = "pointer"; });
    radarMap.on("mouseleave", "fire-fill", () => { radarMap.getCanvas().style.cursor = ""; });
    popupWiredLayers.add("fire");
  }
}

async function addWpcRainfallLayer() {
  if (!radarMap || !mapLoaded) return;
  const day = activeWpcDay;
  if (!wpcRainDataCache[day]) {
    wpcRainDataCache[day] = normalizeWpcEroData(await fetchOutlookGeoJson(WPC_ERO_URLS[day - 1]));
  }
  radarMap.addSource("wpc-rain-source", { type: "geojson", data: wpcRainDataCache[day] });
  addWeatherLayer({
    id: "wpc-rain-fill", type: "fill", source: "wpc-rain-source",
    paint: {
      "fill-color": ["match", ["upcase", ["coalesce", ["get", "LABEL"], ""]],
        "MRGL", "#66cc66", "SLGT", "#ffe066", "MDT", "#ff6060", "HIGH", "#ff40ff",
        "rgba(0,0,0,0)"],
      "fill-opacity": 0.46,
    },
  });
  addWeatherLayer({
    id: "wpc-rain-line", type: "line", source: "wpc-rain-source",
    paint: {
      "line-color": ["match", ["upcase", ["coalesce", ["get", "LABEL"], ""]],
        "MRGL", "#44bb44", "SLGT", "#ddbb00", "MDT", "#cc2222", "HIGH", "#cc00cc",
        "rgba(0,0,0,0)"],
      "line-width": 1.4,
    },
  });
  if (!popupWiredLayers.has("wpc-rain")) {
    radarMap.on("mouseenter", "wpc-rain-fill", () => { radarMap.getCanvas().style.cursor = "pointer"; });
    radarMap.on("mouseleave", "wpc-rain-fill", () => { radarMap.getCanvas().style.cursor = ""; });
    popupWiredLayers.add("wpc-rain");
  }
}

async function addSurfaceAnalysisLayer() {
  if (!radarMap || !mapLoaded) return;
  // Route through worker proxy — NOAA nowCOAST ArcGIS WMS lacks CORS headers.
  // TIME parameter is required for this time-aware service.
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    FORMAT: "image/png",
    TRANSPARENT: "true",
    LAYERS: "0",
    CRS: "EPSG:3857",
    WIDTH: "256",
    HEIGHT: "256",
    STYLES: "",
    TIME: now,
  });
  const wmsBase = `${SURFACE_WMS}?${params.toString()}&BBOX=`;
  const tileUrl = `${WORKER_PROXY}${encodeURIComponent(wmsBase)}{bbox-epsg-3857}`;
  radarMap.addSource("surface-source", {
    type: "raster",
    tiles: [tileUrl],
    tileSize: 256,
    attribution: "NOAA WPC Surface Analysis",
  });
  addWeatherLayer({
    id: "surface-layer", type: "raster", source: "surface-source",
    paint: { "raster-opacity": 0.85 },
  });
}

function satSource() {
  return SATELLITE_SOURCES.find(s => s.id === activeSatelliteSource) || SATELLITE_SOURCES[0];
}
function satBand() {
  return SATELLITE_BANDS.find(b => b.id === activeSatelliteType) || SATELLITE_BANDS[0];
}

// The active TC sector object (or null for the standard full-disk/region view).
function currentSatSector() {
  if (!activeSatelliteSector) return null;
  return (satSectorCache[activeSatelliteSource] || []).find(s => s.id === activeSatelliteSector) || null;
}
function currentSatExtent() {
  const sector = currentSatSector();
  return sector ? sector.extent : satSource().extent;
}

function satDataUrl(repo, file) {
  return `${SATELLITE_RAW}/${repo}/main/site/data/${file}`;
}
// Raw PNG url for a given frame (full-disk or sector), honouring repo naming.
function satFrameRawUrl(frame) {
  const source = satSource(), band = satBand(), sector = currentSatSector();
  const fr = String(frame).padStart(2, "0");
  if (sector) return satDataUrl(source.repo, sector.fileFor(band.file, fr));
  return satDataUrl(source.repo, `${band.file}_${fr}.png`);
}
// Stable cache key for a frame's warped image.
function satFrameKey(frame) {
  const sectorPart = activeSatelliteSector ? `sec:${activeSatelliteSector}` : "full";
  return `${activeSatelliteSource}|${sectorPart}|${activeSatelliteType}|${frame}`;
}

// ─── Equirectangular → Web Mercator warp ──────────────────────────────────────
// The PlateCarrée source repos render latitude-linear PNGs, but a Mapbox image
// source stretches the bitmap linearly in Mercator space. Feeding the raw PNG
// therefore shifts imagery toward the poles (~2° at CONUS latitudes — "Delaware
// where PA should be"). We pre-warp each such frame to a Mercator-spaced canvas so
// the linear Mercator placement becomes geographically correct. (Sources whose
// repos already render in Mercator skip this — see warpedFrameUrl / `proj`.)
function mercatorY(latDeg) {
  const lat = Math.max(-85, Math.min(85, latDeg));
  return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
}
function inverseMercatorY(y) {
  return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
}
const SAT_WARP_MAX = 1536; // cap output dimension to bound warp/encode cost
function warpEquirectToMercator(img, extent) {
  const [, , south, north] = extent;
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  const scale = Math.min(1, SAT_WARP_MAX / Math.max(srcW, srcH));
  const outW = Math.max(1, Math.round(srcW * scale));
  const outH = Math.max(2, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = outW; canvas.height = outH;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const yN = mercatorY(north), yS = mercatorY(south);
  const latSpan = north - south || 1e-6;
  // Each output row pulls the source latitude that belongs at that Mercator Y.
  for (let yo = 0; yo < outH; yo++) {
    const mercY = yN + (yo / (outH - 1)) * (yS - yN);
    const lat = inverseMercatorY(mercY);
    let ysrc = Math.round(((north - lat) / latSpan) * (srcH - 1));
    if (ysrc < 0) ysrc = 0; else if (ysrc > srcH - 1) ysrc = srcH - 1;
    ctx.drawImage(img, 0, ysrc, srcW, 1, 0, yo, outW, 1);
  }
  return canvas;
}
async function warpedFrameUrl(frame) {
  // Mercator-rendered sources (e.g. GOES-18, Himawari) already ship Web Mercator
  // PNGs — warping them again would double-project. Use the raw frame as-is.
  if (satSource().proj === "mercator") return satFrameRawUrl(frame);
  const key = satFrameKey(frame);
  if (satWarpCache.has(key)) return satWarpCache.get(key);
  const img = await loadImgCors(satFrameRawUrl(frame));
  const dataUrl = warpEquirectToMercator(img, currentSatExtent()).toDataURL("image/png");
  satWarpCache.set(key, dataUrl);
  // Keep the cache bounded so band/source/sector churn can't grow unbounded.
  if (satWarpCache.size > 60) satWarpCache.delete(satWarpCache.keys().next().value);
  return dataUrl;
}

// Probe how many frames the active view currently publishes (rolling buffers can
// be partially filled). Cached per source/sector/band view key.
async function detectSatFrameCount() {
  const key = satFrameKey("count"); // distinct per view; band rarely changes count
  if (satFrameCountCache[key]) return satFrameCountCache[key];
  let count = 1; // frame 00 is assumed to exist
  for (let i = 1; i < SATELLITE_MAX_FRAMES; i++) {
    let res;
    try {
      res = await fetch(satFrameRawUrl(i), { method: "HEAD", cache: "no-store" });
    } catch {
      count = SATELLITE_MAX_FRAMES; // network/CORS hiccup → assume a full buffer
      break;
    }
    if (!res.ok) break; // genuine 404 → end of the rolling buffer
    count = i + 1;
  }
  satFrameCountCache[key] = count;
  return count;
}

// Bottom→top stacking order for every custom weather layer. Alert fills sit
// beneath the radar so precipitation stays readable through tinted polygons,
// while the alert outlines ride above the radar so warned areas stay crisply
// delineated. The whole stack is inserted beneath the basemap's boundary and
// label layers (see basemapLabelAnchorId), keeping borders and town names
// legible above all weather data.
const WEATHER_LAYER_ORDER = [
  "satellite-layer",
  "drought-fill", "drought-line",
  "fire-fill", "fire-line",
  "wpc-rain-fill", "wpc-rain-line",
  "spc-fill", "spc-line", "spc-cig-fill", "spc-cig-line",
  "surface-layer",
  "alerts-fill", "nws-alerts-fill",
  "mrms-layer",
  "alerts-line", "nws-alerts-line",
  "lsr-hit",
  "cyclones-radii-fill", "cyclones-radii-line", "cyclones-track", "cyclones-points",
];

// First basemap boundary or label layer. Weather layers insert beneath it so
// admin borders and place names always render on top of the weather stack.
function basemapLabelAnchorId() {
  const layers = radarMap.getStyle()?.layers || [];
  const anchor = layers.find(layer =>
    layer.type === "symbol" || (layer.type === "line" && /admin|boundary/.test(layer.id)));
  return anchor?.id;
}

// Adds a weather layer at its WEATHER_LAYER_ORDER slot: before the next
// already-mounted layer in the order, or before the basemap labels/borders
// when it is currently the topmost weather layer.
function addWeatherLayer(layerDef) {
  let beforeId;
  const idx = WEATHER_LAYER_ORDER.indexOf(layerDef.id);
  if (idx !== -1) {
    for (let i = idx + 1; i < WEATHER_LAYER_ORDER.length && !beforeId; i++) {
      if (radarMap.getLayer(WEATHER_LAYER_ORDER[i])) beforeId = WEATHER_LAYER_ORDER[i];
    }
  }
  radarMap.addLayer(layerDef, beforeId || basemapLabelAnchorId());
}

async function addSatelliteLayer() {
  if (!radarMap || !mapLoaded) return;

  const count = await detectSatFrameCount();
  if (!radarMap || !radarMap.getStyle() || !satelliteActive) return; // bailed mid-await
  satFrames = Array.from({ length: count }, (_, i) => count - 1 - i); // [count-1 … 0]
  satFrameIndex = satFrames.length - 1;                                // newest

  const [west, east, south, north] = currentSatExtent();
  const coords = [[west, north], [east, north], [east, south], [west, south]];

  const url = await warpedFrameUrl(satFrames[satFrameIndex]).catch(() => null);
  if (!url || !radarMap.getStyle() || !satelliteActive) return;
  if (radarMap.getSource("satellite-source")) return; // already present

  radarMap.addSource("satellite-source", { type: "image", url, coordinates: coords });
  addWeatherLayer({
    id: "satellite-layer", type: "raster", source: "satellite-source",
    paint: {
      "raster-opacity": radarOpacity,
      "raster-fade-duration": 300,
      "raster-resampling": "nearest", // no bilinear smoothing of source frames
    },
  });

  // Reflect satellite frames on the shared timeline when it owns the controls.
  if (satelliteActive) {
    const slider = document.querySelector("#radarTimeline");
    if (slider) { slider.max = satFrames.length - 1; slider.value = satFrameIndex; }
    updateRadarLabel();
  }
  prewarmSatFrames(); // warp the rest in the background for smooth animation
}

// Warp remaining frames ahead of time so scrubbing/animation doesn't stutter.
function prewarmSatFrames() {
  satFrames.forEach(frame => { warpedFrameUrl(frame).catch(() => {}); });
}

function setSatelliteFrame(index) {
  if (!satFrames.length) return;
  satFrameIndex = Math.max(0, Math.min(satFrames.length - 1, Number(index)));
  const frame = satFrames[satFrameIndex];
  warpedFrameUrl(frame).then(url => {
    const src = radarMap?.getSource("satellite-source");
    if (url && src && satelliteActive) { try { src.updateImage({ url }); } catch {} }
  }).catch(() => {});
  updateRadarLabel();
}

// ─── Satellite TC sectors ─────────────────────────────────────────────────────
// Each satellite repo also renders zoomed, native-resolution crops around active
// tropical cyclones, with its own metadata file and naming convention.
function sectorMetaUrl(source) {
  const file = source.sectorScheme === "himawari" ? "sectors_meta.json" : "cyclones.json";
  return satDataUrl(source.repo, file);
}
function parseSatSectors(source, json) {
  if (!json) return [];
  if (source.sectorScheme === "himawari") {
    // sectors_meta.json: bounds already [west,east,south,north]; files
    // <band>_sector_<safe_id>_NN.png
    return (json.sectors || []).flatMap(s => {
      const id = s.safe_id || s.id;
      if (!id || !Array.isArray(s.bounds) || s.bounds.length !== 4) return [];
      return [{
        id,
        name: s.name || id,
        label: `${s.name || id}${s.classification ? ` (${s.classification})` : ""}`,
        extent: s.bounds.map(Number),
        fileFor: (bandFile, fr) => `${bandFile}_sector_${id}_${fr}.png`,
      }];
    });
  }
  if (source.sectorScheme === "goes18") {
    // GOES-18 cyclones.json: storms carry only id/name/lat/lon (no bounds); the
    // crop is a ±sector_deg square (top-level "sector_deg", default 6°) and files
    // are <band>_tc_<id>_NN.png. The id token matches the manifest verbatim, so
    // it is used as-is (the repo already lowercases it upstream).
    const deg = Number(json.sector_deg) || 6;
    return (json.storms || []).flatMap(s => {
      const lat = Number(s.lat), lon = Number(s.lon);
      if (!s.id || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
      const id = String(s.id);
      return [{
        id,
        name: s.name || id,
        label: s.name || id,
        extent: [lon - deg, lon + deg, lat - deg, lat + deg], // [west,east,south,north]
        fileFor: (bandFile, fr) => `${bandFile}_tc_${id}_${fr}.png`,
      }];
    });
  }
  // GOES-19 cyclones.json: bounds in Leaflet [[south,west],[north,east]]; files
  // cyclone_<id>_<band>_NN.png  (id is lowercased in the repo)
  return (json.storms || []).flatMap(s => {
    const b = s.bounds;
    if (!s.id || !Array.isArray(b) || b.length !== 2) return [];
    const extent = [b[0][1], b[1][1], b[0][0], b[1][0]]; // → [west,east,south,north]
    const id = String(s.id).toLowerCase();
    return [{
      id,
      name: s.name || s.id,
      label: s.name || s.id,
      extent,
      fileFor: (bandFile, fr) => `cyclone_${id}_${bandFile}_${fr}.png`,
    }];
  });
}
async function ensureSatSectors(sourceId) {
  if (satSectorCache[sourceId]) return satSectorCache[sourceId];
  const source = SATELLITE_SOURCES.find(s => s.id === sourceId);
  let sectors = [];
  try {
    const json = await fetch(`${sectorMetaUrl(source)}?_=${Date.now()}`)
      .then(r => (r.ok ? r.json() : null));
    sectors = parseSatSectors(source, json);
  } catch {}
  satSectorCache[sourceId] = sectors;
  if (satelliteActive && activeSatelliteSource === sourceId) renderSatelliteSubControls();
  return sectors;
}

// ─── Tropical cyclones overlay ────────────────────────────────────────────────

async function fetchCyclones() {
  const results = await Promise.allSettled(
    CYCLONE_FEEDS.map(f => fetch(`${CYCLONE_BASE}/${f}?_=${Date.now()}`).then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }))
  );
  const storms = [];
  for (const r of results) {
    if (r.status === "fulfilled" && Array.isArray(r.value?.storms)) storms.push(...r.value.storms);
  }
  return { storms };
}

// Approximate geographic circle (nautical-mile radius) as a GeoJSON ring.
function cycloneCircleRing(lon, lat, radiusNm, steps = 64) {
  const km = radiusNm * 1.852;
  const dLat = km / 110.574;
  const dLon = km / (111.320 * Math.cos(lat * Math.PI / 180) || 1e-6);
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return ring;
}

function buildCycloneFeatures(data) {
  const radii = [], tracks = [], points = [];
  const RADII = [
    { thr: "034", color: "#ffd700", op: 0.10 },
    { thr: "050", color: "#ff8c00", op: 0.12 },
    { thr: "064", color: "#ff3a3a", op: 0.14 },
  ];

  for (const storm of (data.storms || [])) {
    const fc = Array.isArray(storm.forecast) ? storm.forecast : [];
    const cur = storm.current || fc.find(p => p.tau === 0) || fc[0];
    const trackColor = (cur && cur.intensity_color) || "#38bdf8";

    if (fc.length > 1) {
      tracks.push({
        type: "Feature",
        properties: { color: trackColor, name: storm.name || storm.id },
        geometry: { type: "LineString", coordinates: fc.map(p => [p.lon, p.lat]) },
      });
    }

    fc.forEach(p => {
      points.push({
        type: "Feature",
        properties: {
          color: p.intensity_color || trackColor,
          isCurrent: p.tau === 0,
          tau: p.tau,
          name: storm.name || storm.id,
          id: storm.id,
          basin: storm.basin_name || storm.basin || "",
          classification: p.classification_label || "",
          wind_kt: p.wind_kt, wind_mph: p.wind_mph, wind_kmh: p.wind_kmh,
          pressure_mb: p.pressure_mb, datetime: p.datetime,
          lat: p.lat, lon: p.lon,
          isFinal: storm.is_final_warning ? 1 : 0,
        },
        geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      });
    });

    if (cur && cur.wind_radii_nm) {
      for (const { thr, color, op } of RADII) {
        const q = cur.wind_radii_nm[thr];
        if (!q) continue;
        const maxNm = Math.max(q.NE || 0, q.SE || 0, q.SW || 0, q.NW || 0);
        if (maxNm <= 0) continue;
        radii.push({
          type: "Feature",
          properties: { color, op },
          geometry: { type: "Polygon", coordinates: [cycloneCircleRing(cur.lon, cur.lat, maxNm)] },
        });
      }
    }
  }
  return { radii, tracks, points };
}

async function addCyclonesLayer() {
  if (!radarMap || !mapLoaded) return;
  if (!cycloneData) cycloneData = await fetchCyclones();
  if (!radarMap.getStyle() || !activeOverlays.has("Cyclones")) return; // bailed mid-await
  const { radii, tracks, points } = buildCycloneFeatures(cycloneData);

  if (!radarMap.getSource("cyclones-radii-source")) {
    radarMap.addSource("cyclones-radii-source", { type: "geojson", data: { type: "FeatureCollection", features: radii } });
  }
  if (!radarMap.getSource("cyclones-track-source")) {
    radarMap.addSource("cyclones-track-source", { type: "geojson", data: { type: "FeatureCollection", features: tracks } });
  }
  if (!radarMap.getSource("cyclones-points-source")) {
    radarMap.addSource("cyclones-points-source", { type: "geojson", data: { type: "FeatureCollection", features: points } });
  }

  if (!radarMap.getLayer("cyclones-radii-fill")) {
    addWeatherLayer({
      id: "cyclones-radii-fill", type: "fill", source: "cyclones-radii-source",
      paint: { "fill-color": ["get", "color"], "fill-opacity": ["get", "op"] },
    });
  }
  if (!radarMap.getLayer("cyclones-radii-line")) {
    addWeatherLayer({
      id: "cyclones-radii-line", type: "line", source: "cyclones-radii-source",
      paint: { "line-color": ["get", "color"], "line-width": 1, "line-opacity": 0.45 },
    });
  }
  if (!radarMap.getLayer("cyclones-track")) {
    addWeatherLayer({
      id: "cyclones-track", type: "line", source: "cyclones-track-source",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-opacity": 0.9, "line-dasharray": [2, 2] },
    });
  }
  if (!radarMap.getLayer("cyclones-points")) {
    addWeatherLayer({
      id: "cyclones-points", type: "circle", source: "cyclones-points-source",
      paint: {
        "circle-radius": ["case", ["get", "isCurrent"], 8, 4],
        "circle-color": ["get", "color"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": ["case", ["get", "isCurrent"], 2.5, 1],
      },
    });
  }

  wireCyclonePopups();
}

function wireCyclonePopups() {
  if (popupWiredLayers.has("cyclones")) return;
  popupWiredLayers.add("cyclones");
  radarMap.on("mouseenter", "cyclones-points", () => { radarMap.getCanvas().style.cursor = "pointer"; });
  radarMap.on("mouseleave", "cyclones-points", () => { radarMap.getCanvas().style.cursor = ""; });
  radarMap.on("click", "cyclones-points", e => {
    const p = e.features?.[0]?.properties;
    if (!p) return;
    new mapboxgl.Popup({ offset: 12, maxWidth: "320px" })
      .setLngLat([Number(p.lon), Number(p.lat)])
      .setHTML(buildCyclonePopup(p))
      .addTo(radarMap);
  });
}

function buildCyclonePopup(p) {
  const color = p.color || "#38bdf8";
  const isCur = p.isCurrent === true || p.isCurrent === "true";
  const tau = Number(p.tau);
  const tag = isCur
    ? `<span style="background:${color}22;color:${color};border:1px solid ${color}66;padding:1px 7px;border-radius:999px;font-size:0.7rem;font-weight:800">Current</span>`
    : `<span style="background:rgba(148,163,184,0.18);color:#cbd5e1;border:1px solid rgba(148,163,184,0.4);padding:1px 7px;border-radius:999px;font-size:0.7rem;font-weight:800">+${tau}h Forecast</span>`;
  const finalTag = (Number(p.isFinal) === 1 && isCur)
    ? ` <span style="background:rgba(239,68,68,0.18);color:#fca5a5;border:1px solid rgba(239,68,68,0.5);padding:1px 7px;border-radius:999px;font-size:0.7rem;font-weight:800">Final Warning</span>` : "";
  const lat = Number(p.lat), lon = Number(p.lon);
  const pos = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
  const when = p.datetime ? new Date(p.datetime).toUTCString().replace(/:00 GMT$/, " UTC") : "—";
  const press = Number(p.pressure_mb) > 0 ? `${p.pressure_mb} mb` : "—";
  return `
    <div style="min-width:200px">
      <div style="border-left:4px solid ${color};padding-left:8px;margin-bottom:6px">
        <div style="font-weight:800;font-size:0.95rem">${safeText(p.name)} <small style="color:var(--muted)">${safeText(p.id || "")}</small></div>
        <div style="font-size:0.74rem;color:var(--muted)">${safeText(p.basin || "")}</div>
      </div>
      <div style="margin-bottom:6px;display:flex;flex-wrap:wrap;gap:4px">${tag}${finalTag}</div>
      <div style="font-size:0.78rem;color:${color};font-weight:700;margin-bottom:4px">${safeText(p.classification || "")}</div>
      <table style="font-size:0.78rem;width:100%;border-collapse:collapse">
        <tr><td style="color:var(--muted);padding:1px 0">Time</td><td style="text-align:right">${safeText(when)}</td></tr>
        <tr><td style="color:var(--muted);padding:1px 0">Position</td><td style="text-align:right">${pos}</td></tr>
        <tr><td style="color:var(--muted);padding:1px 0">Max Wind</td><td style="text-align:right"><strong style="color:${color}">${safeText(p.wind_kt)} kt</strong> <span style="color:var(--muted)">${numericWind(p.wind_mph) != null ? safeText(fmtWind(numericWind(p.wind_mph))) : safeText(p.wind_mph) + " mph"}</span></td></tr>
        <tr><td style="color:var(--muted);padding:1px 0">Pressure</td><td style="text-align:right">${press}</td></tr>
      </table>
    </div>`;
}

function fitCyclonesInView() {
  if (!radarMap || !cycloneData?.storms?.length) return;
  let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90, any = false;
  for (const storm of cycloneData.storms) {
    for (const p of (storm.forecast || [])) {
      if (typeof p.lon !== "number" || typeof p.lat !== "number") continue;
      any = true;
      minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
      minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    }
  }
  if (!any) return;
  radarMap.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 60, maxZoom: 6, duration: 800 });
}

const LSR_ICONS = {
  "T": { svg: `<path d="M12 3c-1 3-4 5-4 9h3l-2 9 9-12h-5z" fill="currentColor"/><path d="M10 21c0 0 1-2 3-2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`, color: "#ef4444", label: "Tornado" },
  "H": { svg: `<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><line x1="12" y1="5" x2="12" y2="7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="17" x2="12" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="5" y1="12" x2="7" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="17" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`, color: "#f97316", label: "Hail" },
  "W": { svg: `<path d="M5 8h10.5a2.5 2.5 0 1 0-2.5-2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M3 12h14.5a2.5 2.5 0 1 0-2.5-2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M5 16h8.5a2.5 2.5 0 1 0-2.5-2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`, color: "#38bdf8", label: "Wind" },
  "F": { svg: `<path d="M7 10c0-3 5-7 5-7s5 4 5 7a5 5 0 0 1-10 0z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 19c2-3 5-3 7-1.5s5 1.5 7-1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`, color: "#10b981", label: "Flood" },
  "R": { svg: `<path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="19" x2="8" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="17" x2="12" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="16" y1="19" x2="16" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`, color: "#60a5fa", label: "Rain" },
  "S": { svg: `<line x1="2" x2="22" y1="12" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" x2="12" y1="2" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="m20 16-4-4 4-4m-16 8 4-4-4-4m12-4-4 4-4-4m0 16 4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`, color: "#a5f3fc", label: "Snow" },
  "Z": { svg: `<polygon points="12,2 14.5,8.5 22,8.5 16.5,13 18.5,20 12,16 5.5,20 7.5,13 2,8.5 9.5,8.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`, color: "#bfdbfe", label: "Ice" },
  "M": { svg: `<path d="M13 2L4 14h8l-1 8 9-12h-8l1-8z" fill="currentColor"/>`, color: "#94a3b8", label: "TSTM" },
};

function lsrIconConfig(properties = {}) {
  const typeKey = (properties.type || "").toUpperCase().charAt(0);
  const defaultSvg = `<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
  return LSR_ICONS[typeKey] || { svg: defaultSvg, color: "#94a3b8", label: properties.type || "LSR" };
}

function buildLsrItemHtml(feature) {
  const p = feature.properties || {};
  const cfg = lsrIconConfig(p);
  return `
    <div class="popup-header">
      <div class="popup-icon" style="background:${cfg.color}22;border:1px solid ${cfg.color}66;color:${cfg.color}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${cfg.svg}</svg></div>
      <div>
        <div class="popup-title">${safeText(p.remark || cfg.label)}</div>
        <div class="popup-subtitle">${safeText(cfg.label)} — Local Storm Report</div>
      </div>
    </div>
    [NAV_SLOT]
    <div class="popup-stat"><span class="popup-key">Location</span><span class="popup-val">${safeText(p.city || p.county || "--")}</span></div>
    ${p.magnitude ? `<div class="popup-stat"><span class="popup-key">Magnitude</span><span class="popup-val">${safeText(String(p.magnitude))} ${safeText(p.magUnit || "")}</span></div>` : ""}
    <div class="popup-stat"><span class="popup-key">Source</span><span class="popup-val">${safeText(p.source || "Public")}</span></div>
    ${p.valid ? `<div class="popup-stat"><span class="popup-key">Time</span><span class="popup-val">${new Date(p.valid).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}</span></div>` : ""}`;
}

async function addLsrLayer() {
  if (!radarMap || !mapLoaded) return;
  if (!lsrData) {
    lsrData = await fetchOutlookGeoJson(LSR_URL);
  }
  const features = lsrData?.features || [];
  if (!features.length) return;

  radarMap.addSource("lsr-source", { type: "geojson", data: lsrData });
  addWeatherLayer({
    id: "lsr-hit",
    type: "circle",
    source: "lsr-source",
    paint: {
      "circle-radius": 18,
      "circle-opacity": 0,
      "circle-stroke-opacity": 0,
    },
  });

  features.forEach(feat => {
    const p = feat.properties || {};
    const coords = feat.geometry?.coordinates;
    if (!coords) return;
    const cfg = lsrIconConfig(p);

    const wrap = document.createElement("div");
    wrap.className = "lsr-marker-wrap";
    const dot = document.createElement("div");
    dot.className = "lsr-marker";
    dot.style.background = cfg.color;
    dot.style.color = "#fff";
    dot.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">${cfg.svg}</svg>`;
    wrap.appendChild(dot);
    wrap.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      showUnifiedMapPopup({ lng: coords[0], lat: coords[1] }, radarMap.project([coords[0], coords[1]]), feat);
    });

    new mapboxgl.Marker({ element: wrap, anchor: "center" })
      .setLngLat([coords[0], coords[1]])
      .addTo(radarMap);
  });
}

// Translate ECCC alert names to their nearest NWS event so Canadian polygons
// pick up the exact same colors as their US counterparts via alertEventColor.
const ECCC_TO_NWS_EVENT = [
  [/tornado warning/i, "Tornado Warning"],
  [/tornado watch/i, "Tornado Watch"],
  [/severe thunderstorm warning/i, "Severe Thunderstorm Warning"],
  [/severe thunderstorm watch/i, "Severe Thunderstorm Watch"],
  [/snow squall/i, "Snow Squall Warning"],
  [/waterspout/i, "Special Marine Warning"],
  [/(rainfall|flood) warning/i, "Flood Warning"],
  [/(rainfall|flood) watch/i, "Flood Watch"],
  [/(coastal flood|storm surge)/i, "Coastal Flood Warning"],
  [/(blizzard|winter storm|ice storm|freezing rain) warning/i, "Winter Storm Warning"],
  [/winter storm watch/i, "Winter Storm Watch"],
  [/(snowfall|blowing snow|winter weather|freezing drizzle|freezing fog)/i, "Winter Weather Advisory"],
  [/(extreme cold|arctic outflow|flash freeze)/i, "Extreme Cold Warning"],
  [/frost/i, "Frost Advisory"],
  [/heat warning/i, "Extreme Heat Warning"],
  [/heat/i, "Heat Advisory"],
  [/wind warning/i, "High Wind Warning"],
  [/(fog|smog)/i, "Dense Fog Advisory"],
  [/air quality/i, "Air Quality Alert"],
  [/red flag|fire/i, "Red Flag Warning"],
];

function ecccAlertMapColor(p = {}) {
  const name = String(p.alert_name_en || "");
  const equivalent = ECCC_TO_NWS_EVENT.find(([pattern]) => pattern.test(name))?.[1] || name;
  // ecccSeverity maps warnings/watches/statements onto the same severity rungs
  // the US fallback colors use, so untranslated events also match US styling.
  return alertEventColor(equivalent, ecccSeverity(p));
}

// ECCC alert polygons for the map, shaped like the NWS zone alert features so
// the shared map layer and popups can render them. Fetched whenever the query
// box reaches Canada (not just for Canadian locations) so US users panning
// north of the border still see Canadian alerts.
const ECCC_MAP_PROPERTIES = [
  "id", "feature_id", "alert_code", "alert_type", "alert_name_en", "status_en",
  "publication_datetime", "validity_datetime", "expiration_datetime",
  "event_end_datetime", "feature_name_en", "province", "risk_colour_en",
  "alert_text_en",
].join(",");

async function ecccAlertMapFeatures(box) {
  const reachesCanada = box.north >= 41.5 && box.south <= 84 && box.east >= -141.1 && box.west <= -52.0;
  if (!reachesCanada) return [];
  const bbox = `${box.west},${box.south},${box.east},${box.north}`;
  const data = await getJson(
    `${ECCC_ALERTS_URL}?f=json&lang=en&bbox=${bbox}&limit=500&properties=${ECCC_MAP_PROPERTIES}`,
    { cache: "no-store" },
  );
  return (data.features || []).map(feature => {
    if (!feature.geometry || !isActiveEcccAlert(feature.properties)) return null;
    const alert = normalizeEcccAlert(feature);
    const color = ecccAlertMapColor(feature.properties);
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        event: alert.event,
        headline: alert.headline,
        severity: alert.severity,
        expires: alert.expires,
        description: alert.description,
        areaDesc: alert.areaDesc,
        zoneName: feature.properties?.feature_name_en || "",
        kind: alertKindFor(alert.event, feature.properties?.alert_type),
        fillColor: color.fill,
        lineColor: color.line,
        ecccAlert: true,
      },
    };
  }).filter(Boolean);
}

// Regional NWS watch/warning/advisory polygons from the NOAA WWA map service.
// The api.weather.gov point query only returns alerts at the selected location,
// so zone-based alerts elsewhere in view (flood watches especially) never drew
// on the Alerts overlay. This service returns ready-made polygons for every
// active alert in one bbox request, matching the official NWS alert map.
const NWS_WWA_QUERY_URL = "https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query";
const WWA_SIG_SEVERITY = { W: "Severe", A: "Moderate", Y: "Minor", S: "Minor" };

async function nwsRegionalAlertFeatures(box) {
  const params = new URLSearchParams({
    where: "1=1",
    geometry: `${box.west},${box.south},${box.east},${box.north}`,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "prod_type,sig,expiration,url",
    geometryPrecision: "3",
    f: "geojson",
  });
  const data = await getJson(`${NWS_WWA_QUERY_URL}?${params}`, { cache: "no-store" });
  return (data.features || []).map(feature => {
    const p = feature.properties || {};
    const event = p.prod_type || "";
    // Storm-based warnings stay with the IEM layer; everything else renders here.
    if (!feature.geometry || !event || isStormBasedWarning(event)) return null;
    const severity = WWA_SIG_SEVERITY[String(p.sig || "").toUpperCase()] || "Moderate";
    const color = alertEventColor(event, severity);
    return {
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        event,
        severity,
        expires: p.expiration || null,
        headline: event,
        kind: alertKindFor(event),
        // CAP id (urn:oid:…) parsed from the alert URL, for deduping against
        // the richer point-query features covering the selected location.
        capId: String(p.url || "").split("/alerts/")[1] || "",
        fillColor: color.fill,
        lineColor: color.line,
      },
    };
  }).filter(Boolean);
}

// Box covering the current viewport (plus margin) for the regional alert
// queries. Spans are clamped so continent-wide zooms don't request
// multi-megabyte payloads; the moveend handler refetches once the view
// leaves the fetched box.
function desiredAlertFetchBox() {
  if (!radarMap || !mapLoaded) {
    return {
      west: selectedLocation.lon - 6, south: selectedLocation.lat - 6,
      east: selectedLocation.lon + 6, north: selectedLocation.lat + 6,
    };
  }
  const bounds = radarMap.getBounds();
  const margin = 2, maxSpan = 24;
  let west = bounds.getWest() - margin, east = bounds.getEast() + margin;
  let south = bounds.getSouth() - margin, north = bounds.getNorth() + margin;
  if (east - west > maxSpan) {
    const center = (west + east) / 2;
    west = center - maxSpan / 2;
    east = center + maxSpan / 2;
  }
  if (north - south > maxSpan) {
    const center = (south + north) / 2;
    south = center - maxSpan / 2;
    north = center + maxSpan / 2;
  }
  return { west, south: Math.max(south, -85), east, north: Math.min(north, 85) };
}

function boxContains(outer, inner) {
  return !!outer && inner.west >= outer.west && inner.east <= outer.east &&
    inner.south >= outer.south && inner.north <= outer.north;
}

async function nwsAlertFeatureCollection() {
  const loc = selectedLocation;
  // Fetch the regional queries for what the map is actually showing (plus
  // margin) so panning anywhere on the continent surfaces alerts; the
  // moveend handler in addAlertsLayer refetches once the view leaves the box.
  const box = desiredAlertFetchBox();
  alertFetchBox = box;
  const [nwsResult, ecccResult, wwaResult] = await Promise.allSettled([
    getJson(`https://api.weather.gov/alerts/active?point=${loc.lat},${loc.lon}`, { cache: "no-store" }),
    ecccAlertMapFeatures(box),
    nwsRegionalAlertFeatures(box),
  ]);
  const data = nwsResult.status === "fulfilled" ? nwsResult.value : { features: [] };
  const features = ecccResult.status === "fulfilled" ? [...ecccResult.value] : [];
  const localAlertIds = new Set((data.features || []).map(feature => feature.properties?.id).filter(Boolean));
  if (wwaResult.status === "fulfilled") {
    // Skip regional copies of alerts the point query already supplies with
    // fuller properties (zone names, descriptions) for the selected location.
    features.push(...wwaResult.value.filter(feature => !localAlertIds.has(feature.properties.capId)));
  }
  for (const feature of data.features || []) {
    const p = feature.properties || {};
    // Skip only the storm-based warnings the IEM layer already draws; other
    // county/zone warnings, watches, and advisories all render here.
    if (isStormBasedWarning(p.event || "")) continue;
    const color = nwsAlertColor(p.event || "", p.severity || "");
    const kind = alertKindFor(p.event || "");
    if (feature.geometry) {
      features.push({
        type: "Feature",
        geometry: feature.geometry,
        properties: { ...p, kind, fillColor: color.fill, lineColor: color.line },
      });
      continue;
    }

    const zones = (p.affectedZones || []).slice(0, 80);
    const zoneResults = await Promise.allSettled(zones.map(zone => getJson(zone, { cache: "force-cache" })));
    zoneResults.forEach(result => {
      const geometry = result.status === "fulfilled" ? result.value?.geometry : null;
      if (!geometry) return;
      features.push({
        type: "Feature",
        geometry,
        properties: {
          ...p,
          kind,
          fillColor: color.fill,
          lineColor: color.line,
          zoneName: result.value?.properties?.name || "",
        },
      });
    });
  }
  return { type: "FeatureCollection", features };
}

function buildPopupNavHtml(idx, total) {
  if (total <= 1) return "";
  return `
    <div class="popup-alert-nav">
      <button class="popup-nav-btn" onclick="window._alertNav(-1)" ${idx === 0 ? "disabled" : ""}>&#8249;</button>
      <span class="popup-nav-counter">${idx + 1} / ${total}</span>
      <button class="popup-nav-btn" onclick="window._alertNav(1)" ${idx === total - 1 ? "disabled" : ""}>&#8250;</button>
    </div>`;
}

function buildAlertBodyHtml(feature, alertIdx, popupId) {
  const p = feature.properties || {};
  const isIem = p.phenomena != null;
  let title, subtitle, detailHtml, iconStyle;

  if (isIem) {
    const rawKey = `${p.phenomena}.${p.significance}`;
    const key = rawKey.toUpperCase();
    const eventName = iemPhenomenaMap[key] || iemPhenomenaMap[rawKey] || rawKey;
    const expires = p.expire ? new Date(p.expire).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "--";
    const tempAlert = normalizeIemFeature(feature);
    tempAlert.tags = tagsForAlert(tempAlert);
    title = safeText(alertDisplayEvent(tempAlert));
    subtitle = "IEM Storm-Based Warning";
    iconStyle = "background:rgba(251,146,60,0.18);border:1px solid rgba(251,146,60,0.35);";
    detailHtml = `
      <div class="popup-stat"><span class="popup-key">WFO</span><span class="popup-val">${safeText(p.wfo || "--")}</span></div>
      <div class="popup-stat"><span class="popup-key">Expires</span><span class="popup-val">${expires}</span></div>
      ${p.windtag ? `<div class="popup-stat"><span class="popup-key">Wind</span><span class="popup-val">${numericWind(p.windtag) != null ? safeText(fmtWind(numericWind(p.windtag))) : safeText(p.windtag) + " mph"}</span></div>` : ""}
      ${p.hailtag ? `<div class="popup-stat"><span class="popup-key">Hail</span><span class="popup-val">${isMetric() && Number.isFinite(Number(p.hailtag)) ? (Number(p.hailtag) * 2.54).toFixed(1) + " cm" : safeText(p.hailtag) + "\""}</span></div>` : ""}
      ${p.tornadotag ? `<div class="popup-stat"><span class="popup-key">Tornado</span><span class="popup-val">${safeText(p.tornadotag)}</span></div>` : ""}`;
  } else {
    const expires = p.expires ? new Date(p.expires).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "--";
    const evtLower = (p.event || "").toLowerCase();
    const matchedAlert = (weatherState.alerts || []).find(a => a.event?.toLowerCase() === evtLower);
    title = safeText(matchedAlert ? alertDisplayEvent(matchedAlert) : (p.event || "Weather Alert"));
    subtitle = p.ecccAlert ? "ECCC Alert" : "NWS County/Zone Alert";
    iconStyle = `background:${safeText(p.fillColor || "#f59e0b")}22;border:1px solid ${safeText(p.lineColor || "#fbbf24")}66;`;
    detailHtml = `
      <div class="popup-stat"><span class="popup-key">Area</span><span class="popup-val">${safeText(p.zoneName || p.areaDesc || "--")}</span></div>
      <div class="popup-stat"><span class="popup-key">Severity</span><span class="popup-val">${safeText(p.severity || "--")}</span></div>
      <div class="popup-stat"><span class="popup-key">Expires</span><span class="popup-val">${expires}</span></div>`;
  }

  return `
    <div class="popup-header">
      <div class="popup-icon popup-alert" style="${iconStyle}">⚠️</div>
      <div>
        <div class="popup-title">${title}</div>
        <div class="popup-subtitle">${safeText(subtitle)}</div>
      </div>
    </div>
    [NAV_SLOT]
    ${detailHtml}
    <button class="popup-alert-details-btn" onclick="window._viewAlertFromMapFeature(${popupId},${alertIdx})">View Alert Details</button>`;
}

function buildAlertFeatureHtml(feature, idx, total, popupId) {
  return buildAlertBodyHtml(feature, idx, popupId).replace("[NAV_SLOT]", buildPopupNavHtml(idx, total));
}

async function addAlertsLayer() {
  if (!radarMap || !mapLoaded) return;
  // Fetch the IEM storm-based warnings (US only) and the NWS/ECCC alert
  // polygons independently. The IEM endpoint is US-only and often slow, so
  // awaiting it first would block — or, on failure, skip entirely — the ECCC
  // alerts that are the sole map source over Canada. Settling each on its own
  // keeps one source's hiccup from hiding the other.
  const [iemResult, nwsResult] = await Promise.allSettled([
    alertPolygonData
      ? Promise.resolve(alertPolygonData)
      : fetchOutlookGeoJson(IEM_SBW_URL).then(filterMapColoredWarnings),
    nwsAlertPolygonData
      ? Promise.resolve(nwsAlertPolygonData)
      : nwsAlertFeatureCollection(),
  ]);
  if (iemResult.status === "fulfilled") alertPolygonData = iemResult.value;
  if (nwsResult.status === "fulfilled") nwsAlertPolygonData = nwsResult.value;
  if (!radarMap || !mapLoaded) return; // map may have been torn down mid-fetch

  // Update sources in place when they already exist: setData swaps the
  // features without unmounting the layer, so pan refetches never blink.
  // Always feed existing sources — even an empty set — so stale polygons
  // clear when panning into a quiet region. Sources are only created once
  // there is something to draw.
  const emptyCollection = { type: "FeatureCollection", features: [] };

  const iemData = alertPolygonData || emptyCollection;
  const iemSource = radarMap.getSource("alerts-source");
  if (iemSource) {
    iemSource.setData(iemData);
  } else if (iemData.features?.length) {
    radarMap.addSource("alerts-source", { type: "geojson", data: iemData });
    addWeatherLayer({
      id: "alerts-fill",
      type: "fill",
      source: "alerts-source",
      paint: {
        "fill-color": ["match", ["get", "phenomena"],
          "TO", "#dc2626", "SV", "#f97316", "FF", "#10b981",
          "SQ", "#a78bfa", "MA", "#38bdf8",
          "rgba(0,0,0,0)"],
        "fill-opacity": 0.3,
      },
    });
    addWeatherLayer({
      id: "alerts-line",
      type: "line",
      source: "alerts-source",
      paint: {
        "line-color": ["match", ["get", "phenomena"],
          "TO", "#ef4444", "SV", "#fb923c", "FF", "#34d399",
          "SQ", "#c4b5fd", "MA", "#7dd3fc",
          "rgba(0,0,0,0)"],
        "line-width": 2,
      },
    });
  }

  const nwsData = nwsAlertPolygonData || emptyCollection;
  const nwsSource = radarMap.getSource("nws-alerts-source");
  if (nwsSource) {
    nwsSource.setData(nwsData);
  } else if (nwsData.features?.length) {
    radarMap.addSource("nws-alerts-source", { type: "geojson", data: nwsData });
    addWeatherLayer({
      id: "nws-alerts-fill",
      type: "fill",
      source: "nws-alerts-source",
      paint: {
        "fill-color": ["get", "fillColor"],
        "fill-opacity": 0.22,
      },
    });
    addWeatherLayer({
      id: "nws-alerts-line",
      type: "line",
      source: "nws-alerts-source",
      paint: {
        "line-color": ["get", "lineColor"],
        "line-width": 2.2,
      },
    });
  }

  applyAlertKindFilter();

  // Cursor changes only — clicks handled by wireUnifiedClickHandler().
  // Mapbox delegates layer events by id, so wiring before a layer exists is
  // safe and survives layer re-creation across redraws.
  if (!popupWiredLayers.has("all-alerts")) {
    ["alerts-fill", "nws-alerts-fill"].forEach(layer => {
      radarMap.on("mouseenter", layer, () => { radarMap.getCanvas().style.cursor = "pointer"; });
      radarMap.on("mouseleave", layer, () => { radarMap.getCanvas().style.cursor = ""; });
    });
    popupWiredLayers.add("all-alerts");
  }

  // Refetch the zone/ECCC alert polygons once the camera leaves the box they
  // were fetched for, so panning across the continent (or over the Canadian
  // border) keeps the overlay populated. The layers stay mounted while the
  // new data loads — setData above swaps it in without a visible gap.
  if (!popupWiredLayers.has("alerts-pan-refresh")) {
    radarMap.on("moveend", async () => {
      if (!activeOverlays.has("Alerts") || alertPanRefreshInFlight) return;
      if (!radarMap || !mapLoaded || !alertFetchBox) return;
      if (boxContains(alertFetchBox, desiredAlertFetchBox())) return;
      alertPanRefreshInFlight = true;
      try {
        nwsAlertPolygonData = null;
        await addAlertsLayer();
      } catch (e) {
        console.warn("Alert overlay refresh failed", e);
      } finally {
        alertPanRefreshInFlight = false;
      }
    });
    popupWiredLayers.add("alerts-pan-refresh");
  }
}

// Apply the active warning/watch/advisory filter to the alert layers without
// refetching. The IEM storm-based polygons are warnings by definition, so
// they simply hide unless warnings are visible.
function applyAlertKindFilter() {
  if (!radarMap || !mapLoaded) return;
  const kindFilter = activeAlertFilter === "all" ? null : ["==", ["get", "kind"], activeAlertFilter];
  ["nws-alerts-fill", "nws-alerts-line"].forEach(id => {
    if (radarMap.getLayer(id)) radarMap.setFilter(id, kindFilter);
  });
  const iemVisible = activeAlertFilter === "all" || activeAlertFilter === "warning";
  ["alerts-fill", "alerts-line"].forEach(id => {
    if (radarMap.getLayer(id)) radarMap.setLayoutProperty(id, "visibility", iemVisible ? "visible" : "none");
  });
}

async function addDroughtLayer() {
  droughtLayerData = droughtLayerData || normalizeDroughtData(await fetchDroughtGeoJson());
  if (!radarMap || !mapLoaded) return;
  radarMap.addSource("drought-source", { type: "geojson", data: droughtLayerData });
  addWeatherLayer({
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
  addWeatherLayer({
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
    radarMap.on("mouseenter", "drought-fill", () => { radarMap.getCanvas().style.cursor = "pointer"; });
    radarMap.on("mouseleave", "drought-fill", () => { radarMap.getCanvas().style.cursor = ""; });
    droughtPopupWired = true;
  }
}

function drawRadar(relocate = false) {
  if (!document.querySelector("#maps")?.classList.contains("active")) return;
  initMap();
  if (!radarMap || !mapLoaded) return;
  clearWeatherLayers();

  if (radarActive)                        addRadarLayer().catch(e => console.warn("Radar unavailable", e));
  if (activeOverlays.has("SPC"))          addSpcLayer().catch(e => console.warn("SPC unavailable", e));
  if (activeOverlays.has("Drought"))      addDroughtLayer().catch(e => console.warn("Drought unavailable", e));
  if (activeOverlays.has("Alerts"))       addAlertsLayer().catch(e => console.warn("Alerts unavailable", e));
  if (activeOverlays.has("Fire Wx"))      addFireWeatherLayer().catch(e => console.warn("Fire Wx unavailable", e));
  if (activeOverlays.has("WPC Rain"))     addWpcRainfallLayer().catch(e => console.warn("WPC Rain unavailable", e));
  if (activeOverlays.has("LSR"))          addLsrLayer().catch(e => console.warn("LSR unavailable", e));
  if (activeOverlays.has("Cyclones"))     addCyclonesLayer().catch(e => console.warn("Cyclones unavailable", e));
  if (satelliteActive)                    addSatelliteLayer().catch(e => console.warn("Satellite unavailable", e));

  mapMarker?.setLngLat([selectedLocation.lon, selectedLocation.lat]);
  mapMarker?.setPopup(new mapboxgl.Popup({ offset: 14 }).setHTML(buildLocationPopup(selectedLocation.name)));
  radarMap.resize();
  if (relocate) {
    radarMap.flyTo({ center: [selectedLocation.lon, selectedLocation.lat], zoom: Math.max(radarMap.getZoom(), 8), duration: 700 });
  }
}

function animateRadarLayer() {
  stopRadarAnimation();
  // Satellite owns the timeline whenever it is active; otherwise animate radar.
  const sat = satelliteActive;
  const frames = sat ? satFrames : radarFrames;
  if ((sat ? !satelliteActive : !radarActive) || !frames.length) return;
  const lbl = document.querySelector("#playLabel");
  if (lbl) lbl.textContent = "Pause";
  radarAnimationTimer = setInterval(() => {
    // Animate oldest→newest, wrapping back to the oldest after the latest frame.
    if (sat) setSatelliteFrame((satFrameIndex + 1) % satFrames.length);
    else     setRadarFrame((radarFrameIndex + 1) % radarFrames.length);
  }, RADAR_FRAME_MS);
}

function renderLayers() {
  const baseEl = document.querySelector("#baseLayerPills");
  const overlayEl = document.querySelector("#overlayLayerPills");
  if (!baseEl || !overlayEl) return;

  const BASE_LAYERS = [
    { id: "Radar",     isActive: () => radarActive,     toggle: () => { radarActive = !radarActive; } },
    { id: "Satellite", isActive: () => satelliteActive, toggle: () => { satelliteActive = !satelliteActive; } },
  ];
  const OVERLAY_LAYERS = ["SPC", "Alerts", "Fire Wx", "WPC Rain", "LSR", "Drought", "Cyclones"];

  baseEl.innerHTML = BASE_LAYERS.map(l =>
    `<button type="button" data-layer="${l.id}" class="${l.isActive() ? "active" : ""}">${l.id}</button>`
  ).join("");

  overlayEl.innerHTML = OVERLAY_LAYERS.map(l =>
    `<button type="button" data-layer="${l}" class="${activeOverlays.has(l) ? "active" : ""}">${l}</button>`
  ).join("");

  baseEl.querySelectorAll("button[data-layer]").forEach(btn => {
    btn.addEventListener("click", () => {
      const layer = BASE_LAYERS.find(l => l.id === btn.dataset.layer);
      if (layer) layer.toggle();
      renderLayers();
      drawRadar(false);
    });
  });

  overlayEl.querySelectorAll("button[data-layer]").forEach(btn => {
    btn.addEventListener("click", () => {
      const layer = btn.dataset.layer;
      if (activeOverlays.has(layer)) activeOverlays.delete(layer);
      else activeOverlays.add(layer);
      renderLayers();
      drawRadar(false);
      // When cyclones are switched on, pan/zoom to wherever the storms are.
      if (layer === "Cyclones" && activeOverlays.has("Cyclones")) {
        (async () => {
          if (!cycloneData) cycloneData = await fetchCyclones();
          fitCyclonesInView();
        })();
      }
    });
  });

  const spcCtrl = document.querySelector("#spcSubControls");
  if (spcCtrl) {
    spcCtrl.hidden = !activeOverlays.has("SPC");
    if (activeOverlays.has("SPC")) renderSpcSubControls();
  }

  const wpcCtrl = document.querySelector("#wpcSubControls");
  if (wpcCtrl) {
    wpcCtrl.hidden = !activeOverlays.has("WPC Rain");
    if (activeOverlays.has("WPC Rain")) renderWpcSubControls();
  }

  const fireCtrl = document.querySelector("#fireWxSubControls");
  if (fireCtrl) {
    fireCtrl.hidden = !activeOverlays.has("Fire Wx");
    if (activeOverlays.has("Fire Wx")) renderFireWxSubControls();
  }

  const alertCtrl = document.querySelector("#alertSubControls");
  if (alertCtrl) {
    alertCtrl.hidden = !activeOverlays.has("Alerts");
    if (activeOverlays.has("Alerts")) renderAlertSubControls();
  }

  const satCtrl = document.querySelector("#satelliteSubControls");
  if (satCtrl) {
    satCtrl.hidden = !satelliteActive;
    if (satelliteActive) renderSatelliteSubControls();
  }

  // Timeline controls are shared: shown for radar and/or satellite. The MRMS
  // product picker is radar-only and hidden when only satellite is animating.
  const radCtrl = document.querySelector("#radarSubControls");
  if (radCtrl) {
    radCtrl.hidden = !(radarActive || satelliteActive);
    const prodRow = document.querySelector("#mrmsProductRow");
    if (prodRow) prodRow.hidden = !radarActive;
    if (radarActive) renderRadarSubControls();
  }
}

function renderSpcSubControls() {
  const dayEl  = document.querySelector("#spcDayBtns");
  const typeEl = document.querySelector("#spcTypeBtns");
  if (!dayEl || !typeEl) return;

  const days = [1, 2, 3, 4, 5, 6, 7, 8];
  const typeLabels = { cat: "Categorical", torn: "Tornado", wind: "Wind", hail: "Hail", prob: "Probability" };
  const types = spcTypesForDay(activeSpcDay);
  // Keep the active type valid for the selected day (e.g. Days 4-8 only offer probability).
  if (!types.includes(activeSpcType)) activeSpcType = types[0];

  dayEl.innerHTML = days.map(d =>
    `<button type="button" data-spc-day="${d}" class="${d === activeSpcDay ? "active" : ""}">Day ${d}</button>`
  ).join("");

  typeEl.hidden = false;
  typeEl.innerHTML = types.map(t =>
    `<button type="button" data-spc-type="${t}" class="${t === activeSpcType ? "active" : ""}">${typeLabels[t]}</button>`
  ).join("");

  dayEl.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      activeSpcDay = Number(btn.dataset.spcDay);
      const valid = spcTypesForDay(activeSpcDay);
      if (!valid.includes(activeSpcType)) activeSpcType = valid[0];
      renderSpcSubControls();
      drawRadar(false);
    });
  });

  typeEl.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      activeSpcType = btn.dataset.spcType;
      renderSpcSubControls();
      drawRadar(false);
    });
  });

  // Update SPC legend
  renderSpcLegend();
}

function renderAlertSubControls() {
  const el = document.querySelector("#alertFilterBtns");
  if (!el) return;
  const kinds = [["all", "All"], ["warning", "Warnings"], ["watch", "Watches"], ["advisory", "Advisories"]];
  el.innerHTML = kinds.map(([id, label]) =>
    `<button type="button" data-alert-kind="${id}" class="${id === activeAlertFilter ? "active" : ""}">${label}</button>`
  ).join("");
  el.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      activeAlertFilter = btn.dataset.alertKind;
      localStorage.setItem("alertKindFilter", activeAlertFilter);
      renderAlertSubControls();
      // Layer filter only — no refetch or redraw needed.
      applyAlertKindFilter();
    });
  });
}

function renderWpcSubControls() {
  const dayEl = document.querySelector("#wpcDayBtns");
  if (!dayEl) return;
  dayEl.innerHTML = [1, 2, 3, 4, 5].map(d =>
    `<button type="button" data-wpc-day="${d}" class="${d === activeWpcDay ? "active" : ""}">Day ${d}</button>`
  ).join("");
  dayEl.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      activeWpcDay = Number(btn.dataset.wpcDay);
      renderWpcSubControls();
      drawRadar(false);
    });
  });
}

function renderFireWxSubControls() {
  const dayEl = document.querySelector("#fireWxDayBtns");
  if (!dayEl) return;
  dayEl.innerHTML = [1, 2].map(d =>
    `<button type="button" data-fire-day="${d}" class="${d === activeFireDay ? "active" : ""}">Day ${d}</button>`
  ).join("");
  dayEl.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      activeFireDay = Number(btn.dataset.fireDay);
      renderFireWxSubControls();
      drawRadar(false);
    });
  });
}

function fitSatelliteExtent(extent, padding = 30) {
  if (!radarMap || !extent) return;
  const [west, east, south, north] = extent;
  radarMap.fitBounds(
    [[Math.max(-180, west), Math.max(-85, south)], [Math.min(180, east), Math.min(85, north)]],
    { padding, duration: 700 }
  );
}

function renderSatelliteSubControls() {
  const sourceEl = document.querySelector("#satelliteSourceBtns");
  const typeEl   = document.querySelector("#satelliteTypeBtns");
  const sectorEl = document.querySelector("#satelliteSectorBtns");
  const sectorRow = document.querySelector("#satelliteSectorRow");

  if (sourceEl) {
    sourceEl.innerHTML = SATELLITE_SOURCES.map(s =>
      `<button type="button" data-sat-source="${s.id}" title="${safeText(s.note)}" class="${s.id === activeSatelliteSource ? "active" : ""}">${safeText(s.label)}</button>`
    ).join("");
    sourceEl.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => {
        if (btn.dataset.satSource === activeSatelliteSource) return;
        activeSatelliteSource = btn.dataset.satSource;
        activeSatelliteSector = null; // sectors are per-source
        localStorage.setItem("satelliteSource", activeSatelliteSource);
        renderSatelliteSubControls();
        drawRadar(false);
        fitSatelliteExtent(satSource().extent); // frame the newly selected region
      });
    });
  }

  if (typeEl) {
    typeEl.innerHTML = SATELLITE_BANDS.map(b =>
      `<button type="button" data-sat-type="${b.id}" class="${b.id === activeSatelliteType ? "active" : ""}">${safeText(b.label)}</button>`
    ).join("");
    typeEl.querySelectorAll("button").forEach(btn => {
      btn.addEventListener("click", () => {
        activeSatelliteType = btn.dataset.satType;
        renderSatelliteSubControls();
        drawRadar(false);
      });
    });
  }

  // Storm-sector row: surfaces TC crops the active satellite feed is publishing.
  if (sectorEl && sectorRow) {
    const sectors = satSectorCache[activeSatelliteSource];
    if (sectors === undefined) {
      sectorRow.hidden = true;
      ensureSatSectors(activeSatelliteSource); // async; re-renders when ready
    } else if (!sectors.length) {
      sectorRow.hidden = true; // no active storms in this feed
    } else {
      sectorRow.hidden = false;
      const btns = [{ id: null, label: "Full Disk" }, ...sectors]
        .map(s => `<button type="button" data-sat-sector="${s.id ?? ""}" class="${(s.id ?? null) === activeSatelliteSector ? "active" : ""}">${safeText(s.label)}</button>`)
        .join("");
      sectorEl.innerHTML = btns;
      sectorEl.querySelectorAll("button").forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.satSector || null;
          if (id === activeSatelliteSector) return;
          activeSatelliteSector = id;
          renderSatelliteSubControls();
          drawRadar(false);
          fitSatelliteExtent(currentSatExtent(), id ? 60 : 30);
        });
      });
    }
  }
}

function renderSpcLegend() {
  const box = document.querySelector("#spcLegendBox");
  if (!box) return;
  if (!activeOverlays.has("SPC")) { box.hidden = true; return; }
  box.hidden = false;

  const day = activeSpcDay, type = activeSpcType;
  const isCat = type === "cat";
  const entries = isCat
    ? [
        { color: "#c0e8c0", label: "TSTM — General Thunderstorm" },
        { color: "#66cc66", label: "MRGL — Marginal" },
        { color: "#ffe066", label: "SLGT — Slight" },
        { color: "#ffa040", label: "ENH — Enhanced" },
        { color: "#ff6060", label: "MDT — Moderate" },
        { color: "#ff40ff", label: "HIGH — High" },
      ]
    : spcProbStops(day, type).map(([p, c]) => ({ color: c, label: `${p}%` }));

  const titleType = { cat: "Categorical", torn: "Tornado", wind: "Wind", hail: "Hail",
    prob: day === 3 ? "Severe Prob" : "Severe" }[type] || type;

  // The CIG significant-severe hatch key only applies to Day 1-2 hazard outlooks.
  const showCig = day <= 2 && (type === "torn" || type === "wind" || type === "hail");
  const cigBase = "border:1px solid #000;background-color:#fff;background-image:";
  const cigRows = showCig ? `
    <div class="legend-subtitle" style="margin-top:6px;">Significant severe (CIG)</div>
    <div class="legend-row"><span class="legend-swatch" style="${cigBase}repeating-linear-gradient(45deg,#000 0 1px,transparent 1px 5px);"></span>CIG1 · dashed</div>
    <div class="legend-row"><span class="legend-swatch" style="${cigBase}repeating-linear-gradient(45deg,#000 0 2px,transparent 2px 6px);"></span>CIG2 · solid</div>
    <div class="legend-row"><span class="legend-swatch" style="${cigBase}repeating-linear-gradient(45deg,#000 0 2px,transparent 2px 6px),repeating-linear-gradient(-45deg,#000 0 2px,transparent 2px 6px);"></span>CIG3 · cross-hatch</div>
  ` : "";

  box.innerHTML = `
    <div class="legend-title">SPC Day ${day} ${safeText(titleType)}</div>
    ${entries.map(e => `
      <div class="legend-row">
        <span class="legend-swatch" style="background:${e.color}"></span>
        ${safeText(e.label)}
      </div>
    `).join("")}
    ${cigRows}
  `;
}

function renderRadarSubControls() {
  const sel = document.querySelector("#mrmsProductSelect");
  if (!sel) return;
  sel.value = activeMrmsProduct;
}

function renderMrmsLegend() {
  const box = document.querySelector("#mrmsLegendBox");
  if (!box) return;
  if (!radarActive) { box.hidden = true; return; }
  box.hidden = false;
  const legend = MRMS_LEGENDS[activeMrmsProduct];
  if (!legend) { box.innerHTML = ""; return; }
  box.innerHTML = `
    <div class="legend-title">${safeText(legend.title)}</div>
    ${legend.sections.map(section => `
      <div class="mrms-legend-section">
        <div class="legend-subtitle">${safeText(section.label)}</div>
        <div class="legend-gradient" style="background:${section.gradient}"></div>
        <div class="legend-ticks" style="--tick-count:${section.ticks.length}">
          ${section.ticks.map(tick => {
            const value = typeof tick === "string" ? tick : tick.value;
            const note = typeof tick === "string" ? "" : tick.note;
            return `<span class="legend-tick"><span>${safeText(value)}</span>${note ? `<small>${safeText(note)}</small>` : ""}</span>`;
          }).join("")}
        </div>
      </div>
    `).join("")}
  `;
}

// ─── Pixel value sampling ────────────────────────────────────────────────────

async function loadImgCors(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image load failed: ${url}`));
    img.src = url;
  });
}

async function sampleMrmsValue(lng, lat) {
  if (!mrmsImageBounds) return null;
  const { west, east, north, south } = mrmsImageBounds;
  const xFrac = (lng - west) / (east - west);
  // MRMS images are generated on a Web Mercator-spaced latitude grid in the
  // source radar repository, so vertical sampling must use Mercator Y instead
  // of a linear latitude fraction.
  const merc = latitude => Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI / 180) / 2));
  const yFrac = (merc(north) - merc(lat)) / (merc(north) - merc(south));
  if (xFrac < 0 || xFrac > 1 || yFrac < 0 || yFrac > 1) return null;

  const mrmsIdx = Array.isArray(radarFrames) && radarFrames.length ? radarFrames[radarFrameIndex] : 0;
  const cfg = MRMS_PRODUCTS[activeMrmsProduct];

  // Try val image first (16-bit precision)
  if (cfg.hasVal && cfg.getVal) {
    const valKey = `${activeMrmsProduct}_val_${mrmsIdx}`;
    let ve = mrmsCanvasCache[valKey];
    if (!ve) {
      try {
        const img = await loadImgCors(MRMS_BASE + cfg.getVal(mrmsIdx));
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const cx = c.getContext("2d", { willReadFrequently: true });
        cx.imageSmoothingEnabled = false;
        cx.drawImage(img, 0, 0);
        ve = { imgData: cx.getImageData(0, 0, c.width, c.height), width: c.width, height: c.height };
        mrmsCanvasCache[valKey] = ve;
      } catch {}
    }
    if (ve) {
      const x = Math.min(ve.width - 1, Math.max(0, Math.floor(xFrac * ve.width)));
      const y = Math.min(ve.height - 1, Math.max(0, Math.floor(yFrac * ve.height)));
      const i = (y * ve.width + x) * 4;
      const [r, g, b, a] = [ve.imgData.data[i], ve.imgData.data[i+1], ve.imgData.data[i+2], ve.imgData.data[i+3]];
      if (a < 20) return { noData: true };
      const val = (((r << 8) | g) / 65535) * cfg.valMax;
      return { hasVal: true, value: val, unit: cfg.valUnit, product: cfg.label };
    }
  }

  // Fall back: sample main image for color-based label
  const mainKey = `${activeMrmsProduct}_${mrmsIdx}`;
  let me = mrmsCanvasCache[mainKey];
  if (!me) {
    try {
      const img = await loadImgCors(MRMS_BASE + cfg.getImg(mrmsIdx));
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const cx = c.getContext("2d", { willReadFrequently: true });
      cx.imageSmoothingEnabled = false;
      cx.drawImage(img, 0, 0);
      me = { imgData: cx.getImageData(0, 0, c.width, c.height), width: c.width, height: c.height };
      mrmsCanvasCache[mainKey] = me;
    } catch { return null; }
  }
  const x = Math.min(me.width - 1, Math.max(0, Math.floor(xFrac * me.width)));
  const y = Math.min(me.height - 1, Math.max(0, Math.floor(yFrac * me.height)));
  const i = (y * me.width + x) * 4;
  const [r, g, b, a] = [me.imgData.data[i], me.imgData.data[i+1], me.imgData.data[i+2], me.imgData.data[i+3]];
  if (a < 20) return { noData: true };
  return { hasVal: false, r, g, b, product: cfg.label, label: interpretMrmsColor(r, g, b) };
}

function interpretMrmsColor(r, g, b) {
  const prod = activeMrmsProduct;
  if (prod === "rate") {
    if (r > 220 && g > 220 && b > 220) return "Heavy Snow";
    if (b > 180 && b > r + 30 && b > g - 40) return "Snow";
    if (r > 150 && b > 90 && g < 70) return "Freezing/Ice Mix";
    if (g > 180 && g > r + 40 && g > b + 20) {
      if (r > 160) return "Heavy Rain";
      if (r > 80) return "Moderate Rain";
      return "Light Rain";
    }
    if (r > 150 && g < 60 && b < 60) return "Heavy Rain";
    return "Precipitation";
  }
  if (prod === "refl") {
    if (r < 120 && g < 120 && b < 120) return "~5-10 dBZ";
    if (b > 200 && g > 200 && r < 30) return "~15-20 dBZ";
    if (b > 200 && r < 30) return "~25-30 dBZ";
    if (g > 200 && r < 50 && b < 50) return "~35 dBZ";
    if (g > 200 && r > 150 && b < 50) return "~40-45 dBZ";
    if (r > 200 && g > 150 && b < 50) return "~50 dBZ";
    if (r > 200 && g > 50 && g < 120 && b < 50) return "~55 dBZ";
    if (r > 200 && g < 50 && b < 50) return "~60 dBZ";
    if (r > 150 && b > 120 && g < 50) return "~65-70 dBZ";
    return "Radar return";
  }
  return "Data detected";
}

function buildRadarPixelHtml(data) {
  let valueStr, iconBg;
  if (data.hasVal) {
    const dec = data.unit === "%" ? 0 : data.unit === "s⁻¹" ? 3 : 2;
    valueStr = `${data.value.toFixed(dec)} ${data.unit}`;
    iconBg = "background:rgba(56,189,248,0.15);border:1px solid rgba(56,189,248,0.4)";
  } else {
    valueStr = data.label || "Precipitation detected";
    const hexR = data.r?.toString(16).padStart(2, "0") ?? "88";
    const hexG = data.g?.toString(16).padStart(2, "0") ?? "cc";
    const hexB = data.b?.toString(16).padStart(2, "0") ?? "ff";
    iconBg = `background:#${hexR}${hexG}${hexB}22;border:1px solid #${hexR}${hexG}${hexB}66`;
  }
  return `
    <div class="popup-header">
      <div class="popup-icon popup-mrms" style="${iconBg}">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9"/><polyline points="16 16 12 20 8 16"/><line x1="12" y1="12" x2="12" y2="20"/></svg>
      </div>
      <div>
        <div class="popup-title">MRMS ${safeText(data.product)}</div>
        <div class="popup-subtitle">Pixel Value</div>
      </div>
    </div>
    [NAV_SLOT]
    <div class="popup-stat"><span class="popup-key">Value</span><span class="popup-val">${safeText(valueStr)}</span></div>
    <div class="popup-note">NOAA/MRMS — EphrataWeather</div>`;
}

// ─── Overlay popup content builders ──────────────────────────────────────────

function buildOverlayItemHtml(feature) {
  const f = feature.properties || {};
  const lid = feature.layer?.id || "";
  if (lid === "spc-fill") {
    const typeLabel = activeSpcType === "cat" ? "Categorical" : activeSpcType.charAt(0).toUpperCase() + activeSpcType.slice(1);
    const risk = spcPopupLabel(f);
    return `<div class="popup-header">
        <div class="popup-icon popup-spc" style="background:rgba(250,204,21,0.15);border:1px solid rgba(250,204,21,0.35);">⚡</div>
        <div><div class="popup-title">SPC Day ${activeSpcDay} Outlook</div><div class="popup-subtitle">${safeText(typeLabel)}</div></div>
      </div>
      [NAV_SLOT]
      <div class="popup-stat"><span class="popup-key">Risk Level</span><span class="popup-val">${safeText(risk)}</span></div>
      <div class="popup-note">Storm Prediction Center — NOAA</div>`;
  }
  if (lid === "drought-fill") {
    const cat = f.CATEGORY || "";
    return `<div class="popup-header">
        <div class="popup-icon" style="background:rgba(234,179,8,0.15);border:1px solid rgba(234,179,8,0.35);">🌵</div>
        <div><div class="popup-title">U.S. Drought Monitor</div><div class="popup-subtitle">USDA / NOAA / UNL</div></div>
      </div>
      [NAV_SLOT]
      <div class="popup-stat"><span class="popup-key">Classification</span><span class="popup-val">${safeText(droughtLabel(cat))}</span></div>
      <div class="popup-note">Updated weekly. Data: drought.gov</div>`;
  }
  if (lid === "fire-fill") {
    const label = f.LABEL || "Fire Weather Area";
    const labelNice = { ELEVATED: "Elevated", CRITICAL: "Critical", EXTREME: "Extreme" }[label] ?? (label.charAt(0) + label.slice(1).toLowerCase());
    return `<div class="popup-header">
        <div class="popup-icon popup-fire" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.35);">🔥</div>
        <div><div class="popup-title">SPC Fire Weather Outlook</div><div class="popup-subtitle">Day ${activeFireDay} Forecast</div></div>
      </div>
      [NAV_SLOT]
      <div class="popup-stat"><span class="popup-key">Risk Level</span><span class="popup-val">${safeText(labelNice)}</span></div>
      <div class="popup-note">Monitor local alerts and fire restrictions.</div>`;
  }
  if (lid === "wpc-rain-fill") {
    const label = f.LABEL || "Unknown";
    const labelNames = { MRGL: "Marginal", SLGT: "Slight", MDT: "Moderate", HIGH: "High" };
    return `<div class="popup-header">
        <div class="popup-icon" style="background:rgba(102,212,255,0.15);border:1px solid rgba(102,212,255,0.35);">🌧️</div>
        <div><div class="popup-title">WPC Excessive Rainfall</div><div class="popup-subtitle">Day ${activeWpcDay} Outlook</div></div>
      </div>
      [NAV_SLOT]
      <div class="popup-stat"><span class="popup-key">Risk Level</span><span class="popup-val">${safeText(labelNames[label] || label)}</span></div>
      <div class="popup-note">WPC Day ${activeWpcDay} Excessive Rainfall Outlook — NOAA</div>`;
  }
  return `<div class="popup-header"><div><div class="popup-title">Map Feature</div></div></div>[NAV_SLOT]`;
}

// ─── Unified click handler ────────────────────────────────────────────────────

async function collectPopupItems(lngLat, point, preferredLsrFeature = null) {
  const items = [];

  if (preferredLsrFeature) items.push({ type: "lsr", feature: preferredLsrFeature });

  // Collect point-based LSRs before polygon overlays so storm reports clicked on
  // marker DOM elements still participate in the shared popup navigator.
  if (radarMap.getLayer("lsr-hit")) {
    radarMap.queryRenderedFeatures(point, { layers: ["lsr-hit"] })
      .forEach(f => {
        const sameAsPreferred = preferredLsrFeature &&
          f.geometry?.coordinates?.[0] === preferredLsrFeature.geometry?.coordinates?.[0] &&
          f.geometry?.coordinates?.[1] === preferredLsrFeature.geometry?.coordinates?.[1] &&
          f.properties?.valid === preferredLsrFeature.properties?.valid &&
          f.properties?.type === preferredLsrFeature.properties?.type;
        if (!sameAsPreferred) items.push({ type: "lsr", feature: f });
      });
  }

  // Collect overlay features (SPC, drought, fire, WPC rain)
  const overlayLayerIds = ["spc-fill", "drought-fill", "fire-fill", "wpc-rain-fill"].filter(l => radarMap.getLayer(l));
  if (overlayLayerIds.length) {
    radarMap.queryRenderedFeatures(point, { layers: overlayLayerIds })
      .forEach(f => items.push({ type: "overlay", feature: f }));
  }

  // Collect alert features
  const alertLayerIds = ["alerts-fill", "nws-alerts-fill"].filter(l => radarMap.getLayer(l));
  if (alertLayerIds.length) {
    radarMap.queryRenderedFeatures(point, { layers: alertLayerIds })
      .forEach(f => items.push({ type: "alert", feature: f }));
  }

  // Collect radar pixel value (put first so it's the default view for map clicks)
  if (radarActive && mrmsImageBounds && !preferredLsrFeature) {
    try {
      const px = await sampleMrmsValue(lngLat.lng, lngLat.lat);
      if (px && !px.noData) items.unshift({ type: "radar", data: px });
    } catch {}
  }

  return items;
}

function showPopupItems(lngLat, items) {
  if (!items.length) return;
  activeUnifiedPopup?.remove();

  let currentIdx = 0;
  const popupId = ++alertPopupCounter;
  const alertFeatures = items.filter(x => x.type === "alert").map(x => x.feature);
  alertPopupRegistry.set(popupId, alertFeatures);

  const popup = new mapboxgl.Popup({ offset: 8 }).setLngLat(lngLat).addTo(radarMap);
  activeUnifiedPopup = popup;
  popup.on("close", () => {
    alertPopupRegistry.delete(popupId);
    if (activeUnifiedPopup === popup) activeUnifiedPopup = null;
    if (activeUnifiedPopupNav?.popup === popup) activeUnifiedPopupNav = null;
  });

  const buildItem = (item, idx, total) => {
    const nav = buildPopupNavHtml(idx, total);
    if (item.type === "radar") return buildRadarPixelHtml(item.data).replace("[NAV_SLOT]", nav);
    if (item.type === "lsr") return buildLsrItemHtml(item.feature).replace("[NAV_SLOT]", nav);
    if (item.type === "overlay") return buildOverlayItemHtml(item.feature).replace("[NAV_SLOT]", nav);
    const alertIdx = alertFeatures.indexOf(item.feature);
    return buildAlertBodyHtml(item.feature, alertIdx, popupId).replace("[NAV_SLOT]", nav);
  };

  activeUnifiedPopupNav = {
    popup,
    move(delta) {
      currentIdx = Math.max(0, Math.min(items.length - 1, currentIdx + delta));
      popup.setHTML(buildItem(items[currentIdx], currentIdx, items.length));
    },
  };

  popup.setHTML(buildItem(items[0], 0, items.length));
}

async function showUnifiedMapPopup(lngLat, point, preferredLsrFeature = null) {
  const items = await collectPopupItems(lngLat, point, preferredLsrFeature);
  showPopupItems(lngLat, items);
}

function wireUnifiedClickHandler() {
  if (popupWiredLayers.has("unified-click")) return;

  radarMap.on("click", ev => {
    showUnifiedMapPopup(ev.lngLat, ev.point);
  });

  popupWiredLayers.add("unified-click");
}

window._alertNav = delta => {
  activeUnifiedPopupNav?.move(Number(delta) || 0);
};

async function refreshLiveData() {
  refreshButton.disabled = true;
  refreshButton.textContent = "Refreshing";
  document.querySelector("#statusBadge").textContent = "Updating live sources";
  alertPolygonData = null;
  nwsAlertPolygonData = null;

  const [weather, aviation, space, maps, spcForecast, wpcForecast] = await Promise.allSettled([
    // NWS for the US, Environment Canada for Canada, Open-Meteo everywhere else
    // (and as a fallback whenever the primary provider fails).
    primaryWeatherPayload(),
    aviationPayload(),
    spacePayload(),
    mapsPayload(),
    spcForecastPayload(),
    wpcForecastPayload(),
  ]);

  if (weather.status === "fulfilled") {
    weatherState = weather.value;
  } else {
    weatherState = fallbackWeather;
    document.querySelector("#statusBadge").textContent = "Weather sources unavailable";
  }
  mapState = maps.status === "fulfilled" ? maps.value : {};
  if (spcForecast.status === "fulfilled") {
    weatherState.spcDays = spcForecast.value;
  }
  if (wpcForecast.status === "fulfilled") {
    weatherState.wpcDays = wpcForecast.value;
  }

  renderCurrent();
  renderAlerts();
  await syncPushShownAlerts();
  notifyNewWeatherAlerts();
  checkMorningOutlookNotification();
  renderDaily();
  weatherState.aviation = aviation.status === "fulfilled" ? aviation.value : null;
  renderMetar(weatherState.aviation);
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
    if (tab.dataset.tab === "maps") setTimeout(() => drawRadar(true), 0);
  });
});

refreshButton.addEventListener("click", refreshLiveData);
notifyButton?.addEventListener("click", toggleNotifications);
document.querySelector("#unitToggle")?.addEventListener("click", event => {
  // Clicking a specific side picks that system; clicking elsewhere just flips.
  const opt = event.target.closest(".unit-opt");
  unitSystem = opt ? opt.dataset.system : (isMetric() ? "imperial" : "metric");
  localStorage.setItem("unitSystem", unitSystem);
  rerenderUnits();
});
locationForm.addEventListener("submit", async event => {
  event.preventDefault();
  const query = locationInput.value.trim();
  if (!query) return;
  refreshButton.disabled = true;
  document.querySelector("#statusBadge").textContent = "Finding location";
  try {
    const exactSuggestion = locationSuggestionResults.find(item => item.name.toLowerCase() === query.toLowerCase());
    const results = exactSuggestion ? [exactSuggestion] : await searchLocations(query);
    if (!results.length) throw new Error("No matching town found");
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
document.querySelector("#metarSearchForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  const input = document.querySelector("#metarStationInput");
  const clearBtn = document.querySelector("#metarClearBtn");
  const val = input?.value?.trim().toUpperCase();
  if (!val) return;
  metarStationOverride = val;
  if (clearBtn) clearBtn.hidden = false;
  document.querySelector(".metar-card .eyebrow").textContent = `Loading ${val}…`;
  document.querySelector("#flightRule").textContent = "…";
  document.querySelector("#metarRaw").textContent = "";
  document.querySelector("#metarDecoded").innerHTML = "";
  try {
    const aviation = await aviationPayload();
    weatherState.aviation = aviation;
    renderMetar(aviation);
  } catch (err) {
    document.querySelector(".metar-card .eyebrow").textContent = val;
    document.querySelector("#metarRaw").textContent = `Station not found: ${err.message}`;
    document.querySelector("#flightRule").textContent = "UNK";
  }
});
document.querySelector("#metarClearBtn")?.addEventListener("click", async () => {
  metarStationOverride = null;
  const input = document.querySelector("#metarStationInput");
  const clearBtn = document.querySelector("#metarClearBtn");
  if (input) input.value = "";
  if (clearBtn) clearBtn.hidden = true;
  document.querySelector(".metar-card .eyebrow").textContent = "Loading…";
  try {
    const aviation = await aviationPayload();
    weatherState.aviation = aviation;
    renderMetar(aviation);
  } catch (err) {
    weatherState.aviation = null;
    renderMetar(null);
  }
});
document.querySelector("#radarTimeline")?.addEventListener("input", event => {
  stopRadarAnimation();
  if (satelliteActive) setSatelliteFrame(event.target.value);
  else                 setRadarFrame(event.target.value);
});
document.querySelector("#radarPlayButton")?.addEventListener("click", () => {
  if (radarAnimationTimer) stopRadarAnimation();
  else animateRadarLayer();
});
document.querySelector("#radarOpacitySlider")?.addEventListener("input", event => {
  setRainfallOpacity(Number(event.target.value));
});
document.querySelector("#mrmsProductSelect")?.addEventListener("change", event => {
  activeMrmsProduct = event.target.value;
  localStorage.setItem("mrmsProduct", activeMrmsProduct);
  mrmsCanvasCache = {}; // Clear pixel cache on product switch
  mrmsImageBounds = null; // Re-fetch bounds for new product
  drawRadar(false);
});

document.querySelector("#hourlyMetricSwitcher")?.addEventListener("click", event => {
  const btn = event.target.closest("[data-metric]");
  if (!btn) return;
  hourlyChartMetric = btn.dataset.metric;
  document.querySelectorAll("#hourlyMetricSwitcher button").forEach(b => b.classList.toggle("active", b === btn));
  renderHourlyChart();
});

window.addEventListener("resize", drawRadar);

renderLayers();
registerAppWorker();
initHistoricalCalendar();
scheduleMorningNotificationCheck();
renderBasemapButtons();
tabs.forEach(tab => {
  if (tab.dataset.tab === "climate") {
    tab.addEventListener("click", () => {
      const nameEl = document.querySelector("#hist-location-name");
      if (nameEl) nameEl.textContent = selectedLocation.name;
    }, { capture: true });
  }
});
// Reflect the saved location's default unit system before data arrives.
updateUnitToggleLabel();
refreshLiveData().then(() => {
  if (new URLSearchParams(location.search).get("from") === "notification") {
    history.replaceState(null, "", location.pathname);
    if (!alertsPanel.hidden) alertsPanel.scrollIntoView({ behavior: "smooth" });
  }
});
drawAtmosphere();

// Auto-refresh alerts every 3 minutes so new alerts are caught without a manual refresh
setInterval(async () => {
  try {
    const { alerts, source } = await alertsPayload(selectedLocation.lat, selectedLocation.lon);
    weatherState.alerts = alerts;
    weatherState.alertSource = source;
    renderAlerts();
    notifyNewWeatherAlerts();
    // Refresh alert polygons on the map
    alertPolygonData = null;
    nwsAlertPolygonData = null;
    if (activeOverlays.has("Alerts")) drawRadar(false);
  } catch (e) {
    console.warn("Alert auto-refresh failed", e);
  }
}, 3 * 60 * 1000);

// Show alert details from a map popup click. Uses per-popup registry so multiple
// open popups don't interfere with each other.
window._viewAlertFromMapFeature = function(popupId, featureIdx) {
  const features = alertPopupRegistry.get(popupId) ?? window._alertMapFeatures;
  const feature = features?.[featureIdx];
  if (!feature) return;
  const p = feature.properties || {};
  const alerts = weatherState.alerts || [];

  if (p.phenomena != null) {
    // IEM storm-based warning — try matching by event name first
    const rawKey = `${p.phenomena}.${p.significance}`;
    const eventName = iemPhenomenaMap[rawKey.toUpperCase()] || iemPhenomenaMap[rawKey] || rawKey;
    const alertIdx = alerts.findIndex(a =>
      a.event === eventName ||
      a.event?.toLowerCase() === eventName.toLowerCase()
    );
    if (alertIdx !== -1) {
      showAlertDetails(alertIdx);
    } else {
      // Warning polygon is outside the user's location — normalize and show directly
      const normalizedFeature = normalizeIemFeature(feature);
      showAlertDetails({ ...normalizedFeature, tags: tagsForAlert(normalizedFeature) });
    }
  } else {
    // NWS zone/county or ECCC alert — try matching by event type first
    const evtLower = (p.event || "").toLowerCase();
    const alertIdx = alerts.findIndex(a => a.event?.toLowerCase() === evtLower);
    if (alertIdx !== -1) {
      showAlertDetails(alertIdx);
    } else {
      // Show directly from feature properties
      showAlertDetails({
        event: p.event || "Weather Alert",
        severity: p.severity || "Moderate",
        tags: [],
        description: p.description || "",
        instruction: p.instruction || "",
        expires: p.expires,
        areaDesc: p.zoneName || p.areaDesc || "",
        source: p.ecccAlert ? "ECCC" : "NWS",
        headline: p.headline || p.event || "Weather Alert",
      });
    }
  }
};
