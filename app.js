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
// The generator now publishes each frame as smoothed filled contour bands in
// GeoJSON rather than a pixel raster. Every feature is one band polygon whose
// properties carry the band's fill colour ('c') and its value range ('v0' low,
// 'v1' high, null on the open-ended top band). Drawing them as real vector
// fills keeps the radar sharp at any zoom — the old PNGs broke up into blocky
// pixels past the source resolution — and lets a click read the exact band
// straight out of the rendered feature instead of decoding an image pixel.
const MRMS_BASE = "https://raw.githubusercontent.com/EphrataWeather/MRMS/main/public/data/";
const MRMS_FRAMES = 15; // frames 0-14, index 0 = latest
const MRMS_PRODUCTS = {
  rate:      { label: "Precip Type",     getGeo: i => i === 0 ? "master.geojson" : `master_${i}.geojson`, getMeta: i => `metadata_${i}.json`,           unit: "in/hr", dec: 2, typed: true },
  refl:      { label: "Reflectivity",    getGeo: i => `refl_${i}.geojson`,                                getMeta: i => `metadata_refl_${i}.json`,      unit: "dBZ",   dec: 0 },
  mesh:      { label: "Hail (MESH)",     getGeo: i => `mesh_${i}.geojson`,                                getMeta: i => `metadata_mesh_${i}.json`,      unit: "in",    dec: 2 },
  qpe6h:     { label: "6-Hr Precip",     getGeo: i => `qpe6h_${i}.geojson`,                               getMeta: i => `metadata_qpe6h_${i}.json`,     unit: "in",    dec: 2 },
  qpe24h:    { label: "24-Hr Precip",    getGeo: i => `qpe24h_${i}.geojson`,                              getMeta: i => `metadata_qpe24h_${i}.json`,    unit: "in",    dec: 2 },
  lightning: { label: "Lightning Prob",  getGeo: i => `lightning_${i}.geojson`,                           getMeta: i => `metadata_lightning_${i}.json`, unit: "%",     dec: 0 },
  rotation:  { label: "Azimuthal Shear", getGeo: i => `rotation_${i}.geojson`,                            getMeta: i => `metadata_rotation_${i}.json`,  unit: "s⁻¹",   dec: 3 },
};

// The "rate" product contours rain, snow and ice against three separate colour
// tables and merges them into one file, so a band's fill colour is the only
// thing that says which precipitation type it came from. Colours mirror
// RAIN/SNOW/ICE_COLORS in the generator's process_mrms.py.
const MRMS_RATE_TYPE_BY_COLOR = (() => {
  const map = {};
  const add = (colors, type) => colors.forEach(c => { map[c.toLowerCase()] = type; });
  add(["#00fb90", "#00cc00", "#009900", "#006600", "#ffff00", "#ffcc00", "#ff9100", "#ff5500", "#ff0000", "#cc0000"], "Rain");
  add(["#00ffff", "#80ffff", "#ffffff", "#adc5ff", "#5a82ff"], "Snow");
  add(["#ff00ff", "#d100d1", "#910091", "#4b0082", "#2d004b"], "Ice / Sleet");
  return map;
})();
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

// Nine-bucket sky gradients for the animated canvas background — one clean
// linear-gradient (top to bottom) per real condition bucket, independent of
// the coarser 4-way accent theme above.
const SKY = {
  clearDay: ["#0a5fae", "#2f8fd4", "#7fc2e8", "#bfe2f2"],
  clearNight: ["#03060f", "#071229", "#0d1e3d", "#16304f"],
  partly: ["#0d63aa", "#3b90cd", "#84bfdd", "#c3ddea"],
  overcast: ["#3b4551", "#556270", "#75818d", "#939da8"],
  rain: ["#1a2530", "#2b3946", "#3d4c5a", "#4d5c6a"],
  storm: ["#0b1119", "#161f2b", "#232f3d", "#2c3a49"],
  snow: ["#4a5764", "#66727f", "#8c96a1", "#b4bcc4"],
  fog: ["#5d6670", "#7c848d", "#9aa1a8", "#b6bcc1"],
  sunset: ["#2a1a4a", "#8b3d63", "#e0713f", "#f8b064"],
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
let skyBucket = "clearDay";
let skyT = 0; // seconds, drives the animated canvas sky

// Keep the <meta name="theme-color"> in step with the top color of the active
// animated sky gradient. On iOS standalone web apps the system can paint the
// status-bar buffer itself from theme-color; matching the gradient keeps that
// strip blended with the scene instead of reading as a flat dark band.
// Also mirror the palette onto the root element's --sky-* custom properties:
// the body::before fallback gradient (see styles.css) is what iOS paints in
// the safe-area bands when the canvas's compositing layer drops out of them.
function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  const stops = SKY[skyBucket] || SKY.clearDay;
  if (meta && stops.length) meta.setAttribute("content", stops[0]);
  stops.forEach((color, i) =>
    document.documentElement.style.setProperty(`--sky-${i}`, color));
}
syncThemeColor();

// Determine which of the nine animated-sky buckets a real observation maps
// to: precipitation/fog/storm text wins outright, otherwise clear/cloudy
// conditions are split further by day, night, or near-sunset/sunrise light.
function computeSkyBucket(current) {
  const text = `${current.condition || ""}`.toLowerCase();
  if (text.includes("thunder") || text.includes("storm")) return "storm";
  if (text.includes("snow") || text.includes("sleet") || text.includes("ice") || text.includes("wintry")) return "snow";
  if (text.includes("fog") || text.includes("mist") || text.includes("haze")) return "fog";
  if (text.includes("rain") || text.includes("shower") || text.includes("drizzle")) return "rain";

  const now = new Date();
  let night = false, sunset = false;
  if (currentSunrise && currentSunset) {
    const nowMs = now.getTime(), riseMs = currentSunrise.getTime(), setMs = currentSunset.getTime();
    night = nowMs < riseMs || nowMs > setMs;
    sunset = !night && (nowMs > setMs - 60 * 60 * 1000 || nowMs < riseMs + 30 * 60 * 1000);
  } else {
    const hour = localHour(now);
    night = hour >= 20 || hour <= 5;
    sunset = !night && hour >= 17;
  }

  if (text.includes("overcast") || (text.includes("cloud") && !text.includes("partly"))) return "overcast";
  if (sunset) return "sunset";
  if (night) return "clearNight";
  if (text.includes("partly") || text.includes("mostly clear") || text.includes("mostly sunny")) return "partly";
  return "clearDay";
}

// Per-bucket particle/scene state for the animated sky canvas — rebuilt only
// when the bucket changes (not every frame).
let skyScene = { drops: [], flakes: [], stars: [], clouds: [], fogBanks: [], flash: { next: 0, on: 0, x: 0.5 } };
function skyRnd(a, b) { return a + Math.random() * (b - a); }
function buildSkyScene(bucket) {
  const heavy = bucket === "storm";
  const rainN = bucket === "rain" ? 380 : heavy ? 560 : bucket === "fog" ? 40 : 0;
  const drops = Array.from({ length: rainN }, () => ({
    x: Math.random(), y: Math.random(), l: skyRnd(0.03, 0.085), s: skyRnd(0.55, 1.05),
    w: skyRnd(0.7, 1.7), a: skyRnd(0.22, 0.6),
  }));
  const flakes = bucket === "snow" ? Array.from({ length: 280 }, () => ({
    x: Math.random(), y: Math.random(), r: skyRnd(0.9, 3.1), s: skyRnd(0.03, 0.09),
    ph: Math.random() * 9, sw: skyRnd(0.004, 0.016), a: skyRnd(0.35, 0.95),
  })) : [];
  const stars = bucket === "clearNight" ? Array.from({ length: 240 }, () => ({
    x: Math.random(), y: Math.random() * 0.82, r: skyRnd(0.4, 1.5), ph: Math.random() * 9, a: skyRnd(0.3, 1),
  })) : [];
  const n = { clearDay: 3, partly: 7, overcast: 11, rain: 9, storm: 10, snow: 8, fog: 5, sunset: 6, clearNight: 3 }[bucket] || 0;
  const lowDeck = bucket === "overcast" || bucket === "storm" || bucket === "rain";
  const clouds = Array.from({ length: n }, () => ({
    x: Math.random(), y: skyRnd(0.05, lowDeck ? 0.5 : 0.42), w: skyRnd(0.28, 0.72), h: skyRnd(0.07, 0.19),
    s: skyRnd(0.004, 0.016) * (bucket === "storm" ? 2.2 : 1), a: skyRnd(0.1, 0.34),
  }));
  const fogBanks = (bucket === "fog" || bucket === "snow" || bucket === "overcast")
    ? Array.from({ length: bucket === "fog" ? 7 : 3 }, () => ({
        y: skyRnd(0.3, 1), h: skyRnd(0.14, 0.4), s: skyRnd(0.006, 0.022), a: skyRnd(0.1, 0.3), x: Math.random(),
      }))
    : [];
  skyScene = { drops, flakes, stars, clouds, fogBanks, flash: { next: skyT + skyRnd(1.5, 5), on: 0, x: 0.5 } };
}
buildSkyScene(skyBucket);
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
let lsrMarkers = [];
let activeLsrTypes = (() => {
  try {
    // "lsrCategoryFilter" stores readable category ids (tornado, wind, hail…);
    // the old "lsrTypeFilter" key held raw IEM type codes and is ignored.
    const saved = JSON.parse(localStorage.getItem("lsrCategoryFilter") || "[]");
    return Array.isArray(saved) ? new Set(saved.map(String)) : new Set();
  } catch {
    return new Set();
  }
})();
let alertPolygonData = null;
let nwsAlertPolygonData = null;
let alertFetchBox = null;           // {west,south,east,north} the alert overlay was last fetched for
let alertPanRefreshInFlight = false;
let activeAlertFilter = (() => {
  const saved = localStorage.getItem("alertKindFilter");
  return ["priority", "all", "warning", "watch", "advisory"].includes(saved) ? saved : "priority";
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
let mrmsTimeCache = {};        // `${product}_${frameIdx}` → time string
let mrmsGeoCache = {};         // `${product}_${frameIdx}` → parsed FeatureCollection
let mrmsFrameCountCache = {};  // product → number of frames published in the rolling buffer

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

// Wave, swell and tide heights are carried in feet internally: NOAA CO-OPS and
// the NWS surf products both publish feet, so metres are converted on arrival.
function uHeight(valueFt)  { return valueFt == null ? null : (isMetric() ? valueFt * 0.3048 : valueFt); }
function heightUnit()      { return isMetric() ? "m" : "ft"; }
function fmtHeight(valueFt, digits = 1) {
  const v = uHeight(valueFt);
  return v == null ? "--" : `${v.toFixed(digits)} ${heightUnit()}`;
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
  if (coastalState) renderCoastal();
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

// Pin the modal overlay to the *visual* viewport. position:fixed anchors to
// the layout viewport, so after a pinch or accessibility zoom on iOS the
// overlay could sit half off-screen — the top of the popup unreachable while
// touches landed on the page behind it. While the modal is open, mirror the
// visual viewport's size and offset onto the overlay so the card always
// centers in what the user can actually see.
function syncModalToVisualViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  // Only take over sizing while a zoom/pan is actually in effect. At rest the
  // CSS inset:0 box is already correct — and in iOS standalone web apps the
  // visual viewport spans the full screen while fixed elements are confined
  // to the safe area, so forcing vv dimensions at scale 1 pushed the overlay
  // partly behind the clipped status-bar/home-indicator bands.
  const zoomed = vv.scale > 1.02 || vv.offsetLeft > 1 || vv.offsetTop > 1;
  if (detailModal.hidden || !zoomed) {
    detailModal.style.transform = "";
    detailModal.style.width = "";
    detailModal.style.height = "";
    return;
  }
  detailModal.style.transform = `translate(${vv.offsetLeft}px, ${vv.offsetTop}px)`;
  detailModal.style.width = `${vv.width}px`;
  detailModal.style.height = `${vv.height}px`;
}
window.visualViewport?.addEventListener("resize", syncModalToVisualViewport);
window.visualViewport?.addEventListener("scroll", syncModalToVisualViewport);

// Opening used to freeze the page by switching the body to position:fixed with
// a negative top equal to the scroll offset. That reflowed the whole document
// the instant the popup appeared: the card rendered centred, then jumped
// upward by roughly the scroll distance as the fixed body settled — so tapping
// a day far down the 7-day list threw the popup way above where it belonged.
// The page is now held still without moving it: overflow:hidden on the scroll
// container, overscroll-behavior on the overlay to stop scroll chaining, and
// touch-action:none on the backdrop so drags outside the card don't pan iOS.
// Nothing about the document's position changes, so there is nothing to jump.
function showDetailModal() {
  if (!detailModal.hidden) {
    syncModalToVisualViewport();
    return;
  }
  document.documentElement.classList.add("modal-open");
  document.body.classList.add("modal-open");
  detailModal.hidden = false;
  syncModalToVisualViewport();
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
  showDetailModal();
}

function closeDetails() {
  if (detailModal.hidden) return;
  detailModal.hidden = true;
  document.documentElement.classList.remove("modal-open");
  document.body.classList.remove("modal-open");
  syncModalToVisualViewport();
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
    cloudCover: hourCloudCover(hour),
    precipChance: hour.probabilityOfPrecipitation?.value,
    month: hour.startTime ? new Date(hour.startTime).getMonth() : new Date().getMonth(),
  });
}

// Forecast-day humidity for a given daily index. NWS forecast periods don't
// carry per-day relative humidity, so we pull the Open-Meteo daily mean for
// that day (stored in dailyExtras). The current observation is only used as a
// last resort — it describes right now, not a forecast 3–4 days out, so it must
// never be the primary source for future days.
function dailyHumidity(extras, index) {
  const forecast = extras?.relative_humidity_2m_mean?.[index];
  if (forecast != null) return Math.round(forecast);
  return weatherState.current?.humidity ?? null;
}

// Forecast-day peak wind gust, again preferring Open-Meteo's daily forecast
// over anything tied to the current observation.
function dailyGust(extras, index) {
  const forecast = extras?.wind_gusts_10m_max?.[index];
  return forecast != null ? Math.round(forecast) : null;
}

function forecastCloudCover(extras, index) {
  const forecast = extras?.cloud_cover_mean?.[index] ?? extras?.cloud_cover?.[index];
  return forecast != null ? Math.round(forecast) : null;
}

function hourCloudCover(hour) {
  const cloud = nwsValue(hour, "cloudCover") ?? hour?.cloudCover ?? hour?.cloud_cover;
  return cloud != null ? Math.round(Number(cloud)) : null;
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

const DEFAULT_MAP_ALERT_EVENTS = new Set([
  "tornado warning", "tornado watch",
  "severe thunderstorm warning", "severe thunderstorm watch",
  "flash flood warning",
  "winter storm watch", "winter storm warning",
  "blizzard warning", "snow squall warning",
  "storm surge warning", "storm surge watch",
  "tropical storm warning", "tropical storm watch",
  "hurricane warning", "hurricane watch",
  "typhoon warning", "typhoon watch",
  "extreme wind warning",
  "special weather statement",
]);
const DEFAULT_IEM_ALERT_PHENOMENA = new Set(["TO", "SV", "FF", "SQ"]);

function normalizeAlertEventName(event = "") {
  return String(event || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isDefaultMapAlertEvent(event = "") {
  const normalized = normalizeAlertEventName(event);
  if (DEFAULT_MAP_ALERT_EVENTS.has(normalized)) return true;
  // NWS occasionally prefixes marine/coastal variants but the core event name
  // still matches one of the intentionally prominent map-alert categories.
  return [...DEFAULT_MAP_ALERT_EVENTS].some(name => normalized.endsWith(name));
}

function filterAlertCollectionForMap(data, source = "nws") {
  const features = data?.features || [];
  let filtered = features;
  if (activeAlertFilter === "priority") {
    filtered = source === "iem"
      ? features.filter(feature => DEFAULT_IEM_ALERT_PHENOMENA.has(String(feature?.properties?.phenomena || "").toUpperCase()))
      : features.filter(feature => isDefaultMapAlertEvent(feature?.properties?.event || feature?.properties?.prod_type || feature?.properties?.alert_name_en || ""));
  } else if (source === "iem") {
    filtered = activeAlertFilter === "all" || activeAlertFilter === "warning" ? features : [];
  } else if (activeAlertFilter !== "all") {
    filtered = features.filter(feature => alertKindFor(feature?.properties?.event || "", feature?.properties?.alert_type || "") === activeAlertFilter);
  }
  return { ...(data || {}), type: data?.type || "FeatureCollection", features: filtered };
}

// Normalizes wind tag values from any source ("60", "60 MPH", "60 mph") to a
// consistent lowercase "60 mph" so the same threat never renders twice in
// mismatched casing.
function formatWindTag(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const number = text.match(/\d*\.?\d+/);
  return number ? `${parseFloat(number[0])} mph` : text.toLowerCase();
}

// Same normalization for hail sizes ("1.75", '1.75"', "1.75 IN") → "1.75 in".
// NWS maxHailSize values can lead with a bare decimal point ("Up to .75"),
// which a digit-first match misread as 75 — parseFloat keeps it 0.75.
function formatHailTag(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const number = text.match(/\d*\.?\d+/);
  return number ? `${parseFloat(number[0])} in` : text.toLowerCase();
}

function severeDetectionTag(alert) {
  if (!/severe thunderstorm warning/i.test(alert.event || "")) return null;
  const p = alert.parameters || {};
  const detections = [
    p.windThreat?.[0], p.hailThreat?.[0],
    alert.iem_windthreat, alert.iem_hailthreat, alert.iem_windtag, alert.iem_hailtag,
  ]
    .filter(Boolean)
    .map(item => String(item).toUpperCase());
  if (!detections.length) return null;
  if (detections.some(item => item.includes("OBSERVED"))) return "Observed";
  if (detections.some(item => item.includes("RADAR"))) return "Radar indicated";
  return null;
}

// PDS ("Particularly Dangerous Situation") and emergency wording are only
// printed in the product text for watches and tornado warnings — there is no
// CAP parameter for them — so detect them from the headline/description.
// When neither appears, the alert simply carries no tag and renders as a
// regular watch/warning.
function alertTextFlags(alert) {
  const text = `${alert.headline || ""} ${alert.description || ""}`;
  return {
    pds: !!alert.iem_is_pds || /particularly dangerous situation/i.test(text),
    emergency: !!alert.iem_is_emergency ||
      /\b(tornado|flash flood) emergency\b/i.test(text),
  };
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
  // NWS alerts carry the hazard tags from the bottom of the raw product as
  // CAP parameters (maxWindGust, maxHailSize, tornadoDetection…). The iem_*
  // fields remain as fallbacks for map-popup alerts built from IEM features.
  const windTag   = p.maxWindGust?.[0] ?? alert.iem_windtag;
  const hailTag   = p.maxHailSize?.[0] ?? alert.iem_hailtag;
  const damageTag = p.thunderstormDamageThreat?.[0] ?? alert.iem_damagetag;
  const floodTag  = p.flashFloodDamageThreat?.[0] ?? alert.iem_floodtag;
  const tornadoTag = p.tornadoDetection?.[0] ?? alert.iem_tornadotag;
  const flags = alertTextFlags(alert);
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
    flags.pds && "PDS",
    flags.emergency && "Emergency",
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

// The NWS API is the single US alert source: every alert (storm-based
// warnings included) arrives with the full CAP text plus the hazard tag
// parameters (maxWindGust, maxHailSize, tornadoDetection, damage threats…)
// printed at the bottom of the raw product, so no IEM merge/enrichment pass
// is needed. The IEM storm-based feed is now only used for map polygons.
async function alertsPayload(lat, lon) {
  const [nwsResult, ecccResult] = await Promise.allSettled([
    getJson(`https://api.weather.gov/alerts/active?point=${lat},${lon}`),
    ecccAlertsPayload(lat, lon),
  ]);
  const nwsAlerts = nwsResult.status === "fulfilled"
    ? (nwsResult.value.features || []).map(normalizeNwsAlert)
    : [];
  const ecccAlerts = ecccResult.status === "fulfilled" ? ecccResult.value : [];
  const alerts = mergeAlerts(nwsAlerts, ecccAlerts).map(alert => ({
    ...alert,
    tags: alert.source === "ECCC" ? [] : tagsForAlert(alert),
  }));
  const sources = [
    nwsResult.status === "fulfilled" && "NWS api.weather.gov alerts",
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
  const openMeteoUrl = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current=uv_index,cloud_cover&daily=uv_index_max,apparent_temperature_max,apparent_temperature_min,relative_humidity_2m_mean,wind_gusts_10m_max,cloud_cover_mean&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=${encodeURIComponent(selectedLocation.timezone)}`;
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
      cloudCover: openMeteo?.current?.cloud_cover ?? null,
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
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,dew_point_2m,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,cloud_cover` +
    `&hourly=temperature_2m,relative_humidity_2m,dew_point_2m,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,visibility,cloud_cover` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,uv_index_max,apparent_temperature_max,apparent_temperature_min,relative_humidity_2m_mean,cloud_cover_mean` +
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
      cloudCover: hi.cloud_cover?.[i] ?? null,
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
      cloudCover: cur.cloud_cover ?? null,
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
      relative_humidity_2m_mean: di.relative_humidity_2m_mean || [],
      wind_gusts_10m_max: di.wind_gusts_10m_max || [],
      cloud_cover_mean: di.cloud_cover_mean || [],
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
      cloudCover: null,
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

/* ============================================================================
   COASTAL: rip currents, tides, waves
   ----------------------------------------------------------------------------
   Three independent sources, each of which may be missing for a given beach:
     • Open-Meteo Marine  — global wave/swell/sea-surface-temperature forecast
     • NOAA CO-OPS        — US tide predictions and live gauge observations
     • NWS text products  — SRF (surf zone forecast, carries the official rip
                            current risk) and CWF (coastal waters forecast)
   ========================================================================== */

const MARINE_API = "https://marine-api.open-meteo.com/v1/marine";
const COOPS_DATA = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
const COOPS_STATIONS = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels";
const COOPS_APP = "EphrataWeatherPortal";
const TIDE_STATION_MAX_MI = 45;   // beyond this a gauge no longer describes the local tide
const M_TO_FT = 3.28084;

function milesBetween(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// The CO-OPS gauge list is ~300 stations that never move, so it is cached for a
// month rather than refetched on every location change.
let coopsStationCache = null;
const COOPS_STATION_TTL = 30 * 24 * 60 * 60 * 1000;
async function coopsStations() {
  if (coopsStationCache) return coopsStationCache;
  try {
    const saved = JSON.parse(localStorage.getItem("coopsStations") || "null");
    if (saved?.stations?.length && Date.now() - saved.time < COOPS_STATION_TTL) {
      coopsStationCache = saved.stations;
      return coopsStationCache;
    }
  } catch { /* fall through to a network fetch */ }
  const data = await getJson(COOPS_STATIONS);
  coopsStationCache = (data.stations || [])
    .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng) && s.id)
    .map(s => ({ id: String(s.id), name: s.name, state: s.state || "", lat: s.lat, lon: s.lng }));
  try {
    localStorage.setItem("coopsStations", JSON.stringify({ time: Date.now(), stations: coopsStationCache }));
  } catch { /* private mode or quota — the in-memory cache still holds */ }
  return coopsStationCache;
}

async function nearestTideStation(lat, lon) {
  const stations = await coopsStations();
  let best = null;
  for (const station of stations) {
    const distance = milesBetween(lat, lon, station.lat, station.lon);
    if (!best || distance < best.distance) best = { ...station, distance };
  }
  return best && best.distance <= TIDE_STATION_MAX_MI ? best : null;
}

function coopsDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function coopsUrl(params) {
  const query = new URLSearchParams({ application: COOPS_APP, time_zone: "lst_ldt", units: "english", format: "json", ...params });
  return `${COOPS_DATA}?${query}`;
}

// CO-OPS stamps rows as "YYYY-MM-DD HH:mm" in the station's own local time with
// no offset, so it is parsed as a wall-clock time and only ever formatted back
// as one — never converted through the browser's zone.
function parseCoopsTime(value = "") {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  return {
    iso: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`,
    day: `${m[1]}-${m[2]}-${m[3]}`,
    minutes: Number(m[4]) * 60 + Number(m[5]),
    label: new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
  };
}

async function tidePayload(lat, lon) {
  const station = await nearestTideStation(lat, lon);
  if (!station) return null;

  const today = new Date();
  const end = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);
  const begin = coopsDate(today);
  const [highLow, curve, level, water] = await Promise.allSettled([
    getJson(coopsUrl({ product: "predictions", datum: "MLLW", interval: "hilo", begin_date: begin, end_date: coopsDate(end), station: station.id })),
    getJson(coopsUrl({ product: "predictions", datum: "MLLW", interval: "30", begin_date: begin, end_date: coopsDate(new Date(today.getTime() + 24 * 60 * 60 * 1000)), station: station.id })),
    getJson(coopsUrl({ product: "water_level", datum: "MLLW", date: "latest", station: station.id })),
    getJson(coopsUrl({ product: "water_temperature", date: "latest", station: station.id })),
  ]);

  // Great Lakes gauges have no tidal signal, so they return no predictions —
  // the station is still kept for its live water level and temperature.
  const events = (highLow.status === "fulfilled" ? highLow.value.predictions || [] : []).map(row => ({
    ...parseCoopsTime(row.t),
    heightFt: Number(row.v),
    type: row.type === "H" ? "High" : "Low",
  })).filter(row => row.iso);

  const curvePoints = (curve.status === "fulfilled" ? curve.value.predictions || [] : []).map(row => ({
    ...parseCoopsTime(row.t),
    heightFt: Number(row.v),
  })).filter(row => row.iso);

  const observedRow = level.status === "fulfilled" ? level.value.data?.[0] : null;
  const tempRow = water.status === "fulfilled" ? water.value.data?.[0] : null;

  return {
    station,
    datum: "MLLW",
    hasTides: events.length > 0,
    events,
    curve: curvePoints,
    observed: observedRow ? { ...parseCoopsTime(observedRow.t), heightFt: Number(observedRow.v) } : null,
    waterTempF: tempRow && Number.isFinite(Number(tempRow.v)) ? Number(tempRow.v) : null,
    waterTempAt: tempRow ? parseCoopsTime(tempRow.t) : null,
  };
}

async function marinePayload(lat, lon) {
  const query = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: "wave_height,wave_direction,wave_period,wind_wave_height,wind_wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature,ocean_current_velocity,ocean_current_direction",
    hourly: "wave_height,wave_period,swell_wave_height,wind_wave_height,sea_surface_temperature",
    daily: "wave_height_max,wave_direction_dominant,wave_period_max,swell_wave_height_max",
    forecast_days: "7",
    timezone: selectedLocation.timezone || "auto",
    cell_selection: "sea",
  });
  const data = await getJson(`${MARINE_API}?${query}`);
  const c = data.current || {};
  const ft = value => (Number.isFinite(value) ? value * M_TO_FT : null);

  const hourly = (data.hourly?.time || []).map((time, i) => ({
    time,
    waveFt: ft(data.hourly.wave_height?.[i]),
    swellFt: ft(data.hourly.swell_wave_height?.[i]),
    windWaveFt: ft(data.hourly.wind_wave_height?.[i]),
    periodS: data.hourly.wave_period?.[i] ?? null,
    sstF: data.hourly.sea_surface_temperature?.[i] == null ? null : fahrenheit(data.hourly.sea_surface_temperature[i]),
  }));

  const daily = (data.daily?.time || []).map((date, i) => ({
    date,
    waveMaxFt: ft(data.daily.wave_height_max?.[i]),
    swellMaxFt: ft(data.daily.swell_wave_height_max?.[i]),
    periodMaxS: data.daily.wave_period_max?.[i] ?? null,
    direction: data.daily.wave_direction_dominant?.[i] ?? null,
  }));

  return {
    hasWaves: Number.isFinite(c.wave_height),
    updated: c.time || null,
    current: {
      waveFt: ft(c.wave_height),
      waveDir: c.wave_direction ?? null,
      periodS: c.wave_period ?? null,
      windWaveFt: ft(c.wind_wave_height),
      windWavePeriodS: c.wind_wave_period ?? null,
      swellFt: ft(c.swell_wave_height),
      swellDir: c.swell_wave_direction ?? null,
      swellPeriodS: c.swell_wave_period ?? null,
      sstF: c.sea_surface_temperature == null ? null : fahrenheit(c.sea_surface_temperature),
      currentKt: Number.isFinite(c.ocean_current_velocity) ? c.ocean_current_velocity * 1.94384 : null,
      currentDir: c.ocean_current_direction ?? null,
    },
    hourly,
    daily,
  };
}

/* ---------------------------------------------------------------------------
   NWS text-product parsing (SRF / CWF)
   Both products are a header followed by UGC-coded segments terminated by "$$".
   ------------------------------------------------------------------------- */

const UGC_LINE = /^[A-Z]{2}[ZC]\d{3}(?:[->](?:[A-Z]{2}[ZC])?\d{3})*-(?:\d{6}-)?$/;
const NWS_TIME_LINE = /^\d{3,4}\s+(?:AM|PM)\s+\w{2,4}\s+\w{3}\s+\w{3}\s+\d{1,2}\s+\d{4}$/;

// "VAZ099-100-272015-" → ["VAZ099","VAZ100"];  "FLZ141>148-" expands the range.
function expandUgcBlock(block = "") {
  const zones = [];
  let prefix = "";
  for (const raw of block.replace(/\d{6}-?\s*$/, "").split("-")) {
    const part = raw.trim();
    if (!part) continue;
    const [startRaw, endRaw] = part.split(">");
    let start = startRaw;
    if (/^[A-Z]{2}[ZC]\d{3}$/.test(start)) prefix = start.slice(0, 3);
    else if (/^\d{3}$/.test(start) && prefix) start = prefix + start;
    else continue;
    if (endRaw == null) { zones.push(start); continue; }
    const end = Number(/^\d{3}$/.test(endRaw) ? endRaw : endRaw.slice(3));
    for (let n = Number(start.slice(3)); n <= end && n - Number(start.slice(3)) < 200; n += 1) {
      zones.push(prefix + String(n).padStart(3, "0"));
    }
  }
  return zones;
}

function parseNwsProductSegments(text = "") {
  const segments = [];
  for (const chunk of text.split(/^\$\$\s*$/m)) {
    const lines = chunk.split(/\r?\n/);
    const start = lines.findIndex(line => UGC_LINE.test(line.trim()));
    if (start === -1) continue;

    let i = start;
    let ugc = "";
    while (i < lines.length && UGC_LINE.test(lines[i].trim())) { ugc += lines[i].trim(); i += 1; }
    const zones = expandUgcBlock(ugc);

    // Zone titles are the following lines that end in "-", before the issuance
    // time. The synopsis segment has no title at all.
    const titleParts = [];
    while (i < lines.length && /-\s*$/.test(lines[i]) && !NWS_TIME_LINE.test(lines[i].trim())) {
      titleParts.push(lines[i].trim().replace(/-\s*$/, ""));
      i += 1;
    }
    const detailParts = [];
    while (i < lines.length && lines[i].trim() && !NWS_TIME_LINE.test(lines[i].trim()) && !lines[i].trim().startsWith(".")) {
      detailParts.push(lines[i].trim());
      i += 1;
    }
    if (i < lines.length && NWS_TIME_LINE.test(lines[i].trim())) i += 1;

    // Everything past "&&" is the product's static legend, not forecast text.
    const body = lines.slice(i).join("\n").split(/^&&\s*$/m)[0];
    segments.push({
      zones,
      name: titleParts.join(" ").trim(),
      detail: detailParts.join(" ").trim(),
      periods: parseNwsPeriods(body),
    });
  }
  return segments;
}

// Splits a segment body on ".TODAY...", ".TUE NIGHT...", ".Synopsis for …" heads.
function parseNwsPeriods(body = "") {
  const periods = [];
  // A head may wrap across lines (".Synopsis for … out 60\nnautical miles…"),
  // so newlines are allowed inside the name but literal dots are not.
  const re = /^\.([A-Za-z][^.]*?)\.{3}/gm;
  const heads = [];
  let match;
  while ((match = re.exec(body)) !== null) heads.push({ name: match[1].replace(/\s+/g, " ").trim(), start: match.index, bodyStart: re.lastIndex });
  heads.forEach((head, idx) => {
    const end = idx + 1 < heads.length ? heads[idx + 1].start : body.length;
    periods.push({ name: head.name, rows: parseNwsPeriodRows(body.slice(head.bodyStart, end)) });
  });
  return periods;
}

// SRF periods are "Label......Value." rows; CWF periods are free prose, which
// falls through as a single unlabelled row.
function parseNwsPeriodRows(block = "") {
  const rows = [];
  for (const raw of block.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const labelled = !/^\s/.test(raw) && raw.match(/^(\S.*?)\.{2,}\s*(.*)$/);
    if (labelled) {
      rows.push({ label: labelled[1].replace(/\*+$/, "").trim(), value: labelled[2].trim() });
    } else if (rows.length) {
      rows[rows.length - 1].value = `${rows[rows.length - 1].value} ${raw.trim().replace(/\.{2,}\s*/, ": ")}`.trim();
    } else {
      rows.push({ label: "", value: raw.trim() });
    }
  }
  return rows.map(row => ({ ...row, value: row.value.replace(/\s+/g, " ").trim() }));
}

async function latestNwsProduct(type, office) {
  const list = await getJson(`https://api.weather.gov/products/types/${type}/locations/${office}`);
  const latest = list["@graph"]?.[0];
  if (!latest) return null;
  const product = await getJson(latest["@id"]);
  return { issued: product.issuanceTime, text: product.productText || "" };
}

async function surfZonePayload(office) {
  const product = await latestNwsProduct("SRF", office);
  if (!product) return null;
  const segments = parseNwsProductSegments(product.text).filter(seg => seg.periods.length);
  return segments.length ? { office, issued: product.issued, segments } : null;
}

async function coastalWatersPayload(office) {
  const product = await latestNwsProduct("CWF", office);
  if (!product) return null;
  const all = parseNwsProductSegments(product.text);
  const synopsis = all.find(seg => seg.periods.some(p => /synopsis/i.test(p.name)));
  const zones = all.filter(seg => seg !== synopsis && seg.periods.length);
  return zones.length || synopsis ? { office, issued: product.issued, synopsis, zones } : null;
}

const RIP_LEVELS = {
  low:      { key: "low",      label: "Low",      score: 1, color: "#4ade80", advice: "Dangerous currents are unlikely, but rip currents still form near jetties, groins, piers and reefs. Swim near a lifeguard." },
  moderate: { key: "moderate", label: "Moderate", score: 2, color: "#fbbf24", advice: "Life-threatening currents are possible in the surf zone. Only enter the water near a lifeguard, and stay in waist-deep water if you are not a strong swimmer." },
  high:     { key: "high",     label: "High",     score: 3, color: "#f87171", advice: "Life-threatening currents are likely. Stay out of the surf — even experienced swimmers are at risk. If caught, swim parallel to shore to escape the current." },
};

// Ocean offices publish "Rip Current Risk"; the Great Lakes offices publish the
// equivalent "Swim Risk" on the same Low/Moderate/High scale.
const RIP_ROW_RE = /rip current risk|swim risk/i;
const SURF_HEIGHT_RE = /surf height|wave height/i;

function ripLevelFromText(value = "") {
  const text = value.toLowerCase();
  if (/\bhigh\b/.test(text)) return RIP_LEVELS.high;
  if (/\bmoderate\b/.test(text)) return RIP_LEVELS.moderate;
  if (/\blow\b/.test(text)) return RIP_LEVELS.low;
  return null;
}

function surfRowValue(period, matcher) {
  return period?.rows?.find(row => matcher.test(row.label))?.value || null;
}

// Fallback for beaches with no NWS surf zone forecast (most of the world, and a
// few US offices). Breaking-wave energy scales with height² × period, which is
// what actually drives the rip; the result is always labelled an estimate.
function estimateRipRisk(marineCurrent = {}, windMph = null) {
  const waveFt = marineCurrent.waveFt;
  if (!Number.isFinite(waveFt)) return null;
  const periodS = Number.isFinite(marineCurrent.periodS) ? marineCurrent.periodS : 7;
  let score = waveFt * waveFt * periodS * 0.045;
  if (Number.isFinite(windMph) && windMph >= 18) score += 0.6;
  const level = score >= 4 ? RIP_LEVELS.high : score >= 1.8 ? RIP_LEVELS.moderate : RIP_LEVELS.low;
  return { ...level, estimated: true, basis: `${fmtHeight(waveFt)} seas at ${Math.round(periodS)} s` };
}

async function coastalPayload() {
  const loc = point();
  const [marineResult, tideResult] = await Promise.allSettled([
    marinePayload(loc.lat, loc.lon),
    tidePayload(loc.lat, loc.lon),
  ]);
  const marine = marineResult.status === "fulfilled" ? marineResult.value : null;
  const tides = tideResult.status === "fulfilled" ? tideResult.value : null;

  if (!marine?.hasWaves && !tides?.station) {
    return { isCoastal: false, marine: null, tides: null, surf: null, waters: null };
  }

  // The surf and coastal-waters text products are published per WFO, so they
  // only exist for US locations inside a coastal forecast office.
  let surf = null;
  let waters = null;
  let zoneId = null;
  if (!isCanadianLocation() && (selectedLocation.countryCode || "US") === "US") {
    try {
      const gridPoint = await getJson(`https://api.weather.gov/points/${loc.lat},${loc.lon}`);
      const office = gridPoint.properties?.cwa;
      zoneId = (gridPoint.properties?.forecastZone || "").split("/").pop() || null;
      if (office) {
        const [surfResult, watersResult] = await Promise.allSettled([
          surfZonePayload(office),
          coastalWatersPayload(office),
        ]);
        surf = surfResult.status === "fulfilled" ? surfResult.value : null;
        waters = watersResult.status === "fulfilled" ? watersResult.value : null;
      }
    } catch { /* no NWS coverage here — Open-Meteo and CO-OPS still stand */ }
  }

  return { isCoastal: true, marine, tides, surf, waters, zoneId };
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
  // Chip values stay compact ("15%") — the longer "15% probability" phrasing
  // overflowed the narrow sidebar chips.
  const chipPct = feature => {
    const num = Number(feature?.properties?.RISK_NUM);
    return Number.isFinite(num) ? `${num}%` : "0%";
  };
  return {
    spcRisk: spcCat ? spcLabel(spcCat.properties?.LABEL) : "No Day 1 categorical risk",
    spcTorn: chipPct(spcTorn),
    spcWind: chipPct(spcWind),
    spcHail: chipPct(spcHail),
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

// WPC Excessive Rainfall Outlook summary sentences. The WPC categorical scale
// mirrors the SPC scale (minus Enhanced), so each level reuses the SPC
// coverage wording for the same-named level, with flash flooding as the hazard.
const WPC_CAT_SUMMARY = {
  MRGL: "Isolated instances of excessive rainfall leading to flash flooding are possible.",
  SLGT: "Isolated to scattered instances of excessive rainfall leading to flash flooding are expected.",
  MDT:  "Scattered to numerous instances of excessive rainfall leading to flash flooding are expected.",
  HIGH: "Numerous instances of excessive rainfall leading to flash flooding are expected.",
};

function wpcDaySummary(label = "") {
  return WPC_CAT_SUMMARY[String(label).toUpperCase()] || "";
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

// Plain-English, threshold-based one-liners for the Today metric cards —
// generated from the live value rather than a canned string per condition,
// so they stay accurate no matter what the real reading is.
function uvNote(uv) {
  if (uv == null || Number.isNaN(uv)) return "Estimated daylight exposure.";
  if (uv < 3) return "Low. No real precaution needed.";
  if (uv < 6) return "Moderate. Sunscreen if you're out for a while.";
  if (uv < 8) return "High. Sunscreen if you're out past noon.";
  if (uv < 11) return "Very high. Limit midday sun and cover up.";
  return "Extreme. Avoid direct sun between 10 and 4.";
}

function humidityNote(rh) {
  if (rh == null || Number.isNaN(rh)) return "Relative humidity.";
  if (rh < 30) return "Quite dry — you may notice static or dry skin.";
  if (rh < 45) return "Comfortably dry — barely noticeable.";
  if (rh < 60) return "Middle of the road — feels natural.";
  if (rh < 75) return "A bit muggy — the air feels heavier than it is.";
  return "Very humid — expect that sticky, heavy feeling.";
}

function windNote(windMph, gustMph) {
  if (windMph == null || Number.isNaN(windMph)) return "Estimated surface wind.";
  const gusty = gustMph != null && gustMph - windMph > 10;
  if (windMph < 5) return "Calm — barely enough to notice.";
  if (windMph < 12) return gusty ? "Light, with gustier moments." : "A light, steady breeze.";
  if (windMph < 20) return gusty ? "Breezy, gusting higher at times." : "Breezy — loose items may shift.";
  if (windMph < 30) return "Windy — secure anything lightweight outside.";
  return "Strong wind — exercise caution outdoors.";
}

function airQualityNote(label) {
  const t = `${label || ""}`.toLowerCase();
  if (!t || t.includes("not reported")) return "Open-Meteo air quality.";
  if (t.includes("hazardous")) return "Hazardous — stay indoors if possible.";
  if (t.includes("very unhealthy")) return "Very unhealthy — avoid outdoor exertion.";
  if (t.includes("unhealthy for sensitive")) return "Unhealthy for sensitive groups — they should limit exertion.";
  if (t.includes("unhealthy")) return "Unhealthy — everyone should reduce time outdoors.";
  if (t.includes("moderate")) return "Moderate — sensitive groups may notice.";
  return "Good — fine for everyone, including runners.";
}

function dewPointNote(dewF) {
  if (dewF == null || Number.isNaN(dewF)) return "Observation.";
  if (dewF < 50) return "Crisp and dry — comfortable all day.";
  if (dewF < 60) return "Comfortable, with a little moisture in the air.";
  if (dewF < 65) return "A little sticky by afternoon.";
  if (dewF < 70) return "Muggy — expect that heavy, humid feel.";
  return "Oppressive — as humid as it gets.";
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
    wave:     `<path d="M2 8c2-2 3.4-2 5 0s3 2 5 0 3.4-2 5 0 3 2 5 0"/><path d="M2 14c2-2 3.4-2 5 0s3 2 5 0 3.4-2 5 0 3 2 5 0"/><path d="M2 20c2-2 3.4-2 5 0s3 2 5 0 3.4-2 5 0 3 2 5 0"/>`,
    swell:    `<path d="M2 16c3.5 0 4-9 8-9s4.5 9 8 9 4-4 4-4"/><path d="M2 20h20"/>`,
    tide:     `<path d="M2 17c2-2 3.4-2 5 0s3 2 5 0 3.4-2 5 0 3 2 5 0"/><path d="M12 3v9"/><path d="m8.5 8.5 3.5 3.5 3.5-3.5"/>`,
    period:   `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 1.9"/>`,
    seaTemp:  `<path d="M13 14.3V4.5a2.5 2.5 0 0 0-5 0v9.8a4.5 4.5 0 1 0 5 0z"/><path d="M16 8h5"/><path d="M16 12h3"/>`,
    ripCurrent: `<path d="M4 20c1.7-1.7 3.3-1.7 5 0s3.3 1.7 5 0 3.3-1.7 5 0"/><path d="M12 16V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/>`,
    seaCurrent: `<path d="M3 12h13"/><path d="m12 7 5 5-5 5"/><path d="M3 6h8"/><path d="M3 18h8"/>`,
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
    cloudCover:  current.cloudCover,
    precipChance: null,
    month,
  });
  const alertCount = weatherState.alerts?.length || 0;

  activeTheme = chooseTheme(current);
  setLocationBrand();
  document.body.dataset.theme = activeTheme;
  document.body.dataset.condition = conditionClass(current);

  const nextSkyBucket = computeSkyBucket(current);
  if (nextSkyBucket !== skyBucket) {
    skyBucket = nextSkyBucket;
    buildSkyScene(skyBucket);
  }
  syncThemeColor();

  locationName.textContent = selectedLocation.name;
  document.querySelector("#current-title").textContent = current.headline;
  document.querySelector("#weatherSummary").textContent = current.summary;
  document.querySelector("#currentIcon").innerHTML = WeatherIcons.fromText(current.condition || current.summary || "Partly Cloudy", activeTheme === "midnight", { animated: true, sunset: skyBucket === "sunset" });
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
    ["air", "Air Quality", current.airQuality || "Not reported", current.airQualityDetail || airQualityNote(current.airQuality)],
    current.pollen ? ["pollen", "Pollen", current.pollen, current.pollenDetail || "Google Pollen API"] : null,
    ["uv", "UV Index", f(current.uv), uvNote(current.uv)],
    ["dew", "Dew Point", `${uTempNum(current.dewPoint)}°`, dewPointNote(current.dewPoint)],
    ["humidity", "Relative Humidity", `${f(current.humidity)}%`, humidityNote(current.humidity)],
    ["wind", "Wind", fmtWind(current.wind), windNote(current.wind, current.gust)],
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
      <span>${safeText(weatherState.alertSource || "NWS api.weather.gov alerts")}</span>
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
    const dayHumidity = dailyHumidity(extras, index);
    const feelsHigh = extras.apparent_temperature_max?.[index] ?? apparentTemperature(day.temperature, dayHumidity, numericWind(day.windSpeed));
    const feelsLow  = extras.apparent_temperature_min?.[index] ?? (night ? apparentTemperature(night.temperature, dayHumidity, numericWind(night.windSpeed)) : null);
    const uv = extras.uv_index_max?.[index] ?? weatherState.current?.uv;

    // Derive the month from the period name or fall back to current month
    const periodDate = day.startTime ? new Date(day.startTime) : new Date();
    const dayMonth   = periodDate.getMonth();
    const windSpeed  = numericWind(day.windSpeed) || null;
    const dayCloud   = forecastCloudCover(extras, index);
    const fwi = FWI.calculate({
      temp:        day.temperature,
      humidity:    dayHumidity,
      wind:        windSpeed,
      gust:        dailyGust(extras, index),
      cloudCover:  dayCloud,
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
  const dayHumidity = dailyHumidity(extras, index);
  const dayGust = dailyGust(extras, index);
  const feelsHigh = extras.apparent_temperature_max?.[index] ?? apparentTemperature(day.temperature, dayHumidity, numericWind(day.windSpeed));
  const feelsLow = extras.apparent_temperature_min?.[index] ?? (night ? apparentTemperature(night.temperature, dayHumidity, numericWind(night.windSpeed)) : null);
  const uv = extras.uv_index_max?.[index] ?? weatherState.current?.uv;
  const windDay = numericWind(day.windSpeed);
  const windNight = night ? numericWind(night.windSpeed) : null;
  const dayCloud = forecastCloudCover(extras, index);

  const periodDate = day.startTime ? new Date(day.startTime) : new Date();
  const fwi = FWI.calculate({
    temp: day.temperature,
    humidity: dayHumidity,
    wind: windDay,
    gust: dayGust,
    cloudCover: dayCloud,
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
      const wpcSummary = wpcDaySummary(wpcDay.label);
      risks.push({ color: spcRiskColor(wpcDay.label) || "#60a5fa", icon: "precip",
        title: `${wpcNames[wpcDay.label] || wpcDay.label} risk of excessive rainfall`,
        sub: `${wpcSummary ? `${wpcSummary} — ` : ""}WPC Day ${index + 1} excessive rainfall outlook` });
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
          wind: windDay != null ? `${fmtWind(windDay)}${dayGust != null ? `, gusts ${fmtWind(dayGust)}` : ""}` : null,
          humidity: dayHumidity != null
            ? `~${f(dayHumidity)}%${extras.relative_humidity_2m_mean?.[index] != null ? " forecast" : " (current)"}`
            : null,
          cloud: dayCloud != null ? `${f(dayCloud)}% ${cloudCoverLabel(dayCloud).toLowerCase()}` : null,
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
  showDetailModal();
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

  // Hazard tags — read from the NWS CAP parameters with the IEM fields as
  // fallback for alerts built from map features.
  const params = alert.parameters || {};
  const windHazard    = params.maxWindGust?.[0] ?? alert.iem_windtag;
  const hailHazard    = params.maxHailSize?.[0] ?? alert.iem_hailtag;
  const damageHazard  = params.thunderstormDamageThreat?.[0] ?? alert.iem_damagetag;
  const tornadoHazard = params.tornadoDetection?.[0] ?? alert.iem_tornadotag;
  const floodHazard   = params.flashFloodDamageThreat?.[0] ?? alert.iem_floodtag;
  const hazardItems = [
    severeDetectionTag(alert) && `Detection: ${severeDetectionTag(alert)}`,
    windHazard    && `Wind: ${formatWindTag(windHazard)}`,
    hailHazard    && `Hail: ${formatHailTag(hailHazard)}`,
    damageHazard  && `Damage: ${normalizeAlertTag(damageHazard)}`,
    tornadoHazard && `Tornado: ${normalizeAlertTag(tornadoHazard)}`,
    floodHazard   && `Flood tag: ${normalizeAlertTag(floodHazard)}`,
  ].filter(Boolean);
  const hazardHtml = hazardItems.length ? `<div class="alert-hazard-tags">${hazardItems.map(h => `<span class="alert-hazard-tag">${safeText(h)}</span>`).join("")}</div>` : "";

  // Level categories table. Watches use their own ladder ("WATCH"/"PDS
  // WATCH"); when no PDS tag is found the regular WATCH row highlights —
  // previously the fallback returned "WARNING", which matches no watch row,
  // so watches never highlighted a level at all.
  const categories = ALERT_LEVEL_CATEGORIES[event] || null;
  const activeLevel = categories ? (() => {
    if (/\bwatch\b/i.test(event)) {
      if (currentTagsLower.some(t => t.includes("pds") || t.includes("particularly dangerous"))) return "PDS WATCH";
      return "WATCH";
    }
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

  // Full alert text — the complete product text was previously never shown
  // when the description parsed into WHAT/WHERE/WHEN sections. Always offer
  // it in a collapsible block so nothing from the original alert is lost.
  const fullText = [rawDesc, (alert.instruction || "").trim()].filter(Boolean).join("\n\n");
  const fullTextHtml = fullText ? `
    <details class="alert-full-text">
      <summary>Full Alert Text</summary>
      <pre>${safeText(fullText)}</pre>
    </details>` : "";

  modalBody.innerHTML = tagsHtml + metaHtml + hazardHtml + whatHtml + impactsHtml + whereHtml + whenHtml + rawDescHtml + categoriesHtml + tipsHtml + fullTextHtml + srcHtml;
  showDetailModal();
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

/* ============================================================================
   COASTAL SCREEN
   ========================================================================== */

let coastalState = null;          // null while loading; {isCoastal:…} once resolved
let coastalError = null;
let coastalSegmentIndex = 0;      // which SRF beach segment is on screen
let coastalWatersIndex = 0;       // which CWF marine zone is on screen
let coastalWaveMode = "hourly";   // hourly | daily

const COASTAL_PRESETS = [
  { name: "Ocean City, MD",     lat: 38.3365, lon: -75.0849, timezone: "America/New_York", countryCode: "US" },
  { name: "Virginia Beach, VA", lat: 36.8529, lon: -75.9780, timezone: "America/New_York", countryCode: "US" },
  { name: "Miami Beach, FL",    lat: 25.7907, lon: -80.1300, timezone: "America/New_York", countryCode: "US" },
  { name: "Cape Hatteras, NC",  lat: 35.2510, lon: -75.5288, timezone: "America/New_York", countryCode: "US" },
  { name: "Santa Monica, CA",   lat: 34.0195, lon: -118.4912, timezone: "America/Los_Angeles", countryCode: "US" },
  { name: "Cannon Beach, OR",   lat: 45.8918, lon: -123.9615, timezone: "America/Los_Angeles", countryCode: "US" },
];

// Minutes past midnight where the selected location currently is, used to place
// the "now" marker on the tide curve without leaving wall-clock time.
function localMinutesNow(timezone = selectedLocation.timezone || "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date())
    .reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
  return (Number(parts.hour) % 24) * 60 + Number(parts.minute);
}

// A sortable wall-clock key (days since epoch × 1440 + minutes).
function tideKey(row) {
  if (!row?.day) return null;
  return Math.round(Date.parse(`${row.day}T00:00:00Z`) / 86400000) * 1440 + row.minutes;
}

function tideNowKey() {
  const day = localDateISO();
  return Math.round(Date.parse(`${day}T00:00:00Z`) / 86400000) * 1440 + localMinutesNow();
}

function activeSurfSegment() {
  const segments = coastalState?.surf?.segments;
  if (!segments?.length) return null;
  return segments[Math.min(coastalSegmentIndex, segments.length - 1)];
}

function surfPeriodsWithRip(segment) {
  return (segment?.periods || []).filter(period => period.rows.some(row => RIP_ROW_RE.test(row.label)));
}

// The official NWS risk when the beach has a surf zone forecast, otherwise the
// wave-energy estimate, which renders with an "estimated" badge.
function currentRipRisk() {
  const segment = activeSurfSegment();
  const today = surfPeriodsWithRip(segment)[0];
  const row = today?.rows.find(item => RIP_ROW_RE.test(item.label));
  const fromSrf = row && ripLevelFromText(row.value);
  if (fromSrf) return { ...fromSrf, estimated: false, periodName: today.name, title: row.label };
  return estimateRipRisk(coastalState?.marine?.current || {}, weatherState?.current?.wind ?? null);
}

function compassLabel(deg) {
  return deg == null ? "--" : `${windDirLabel(deg)} (${Math.round(deg)}°)`;
}

function coastalSourceLine() {
  const parts = ["Open-Meteo marine model"];
  if (coastalState?.tides) parts.push(coastalState.tides.hasTides ? "NOAA CO-OPS tides" : "NOAA CO-OPS gauge");
  if (coastalState?.surf) parts.push(`NWS ${coastalState.surf.office} surf zone forecast`);
  return parts.join(" · ");
}

function renderCoastal() {
  const body = document.querySelector("#coastalBody");
  const status = document.querySelector("#coastalStatus");
  if (!body) return;

  if (coastalError) {
    if (status) status.textContent = "Marine data unavailable";
    body.innerHTML = `<article class="tile coastal-empty"><h3>Coastal data unavailable</h3><p>${safeText(coastalError)}</p></article>`;
    return;
  }
  if (!coastalState) {
    if (status) status.textContent = "Checking for marine data…";
    body.innerHTML = `<article class="tile coastal-empty"><h3>Loading coastal conditions…</h3><p>Checking wave models, tide gauges and NWS surf zone forecasts for ${safeText(selectedLocation.name)}.</p></article>`;
    return;
  }
  if (!coastalState.isCoastal) {
    if (status) status.textContent = "No marine coverage here";
    body.innerHTML = renderCoastalEmpty();
    return;
  }

  if (status) status.textContent = coastalSourceLine();
  body.innerHTML = [
    renderBeachPicker(),
    renderRipAndSea(),
    renderCoastalMetrics(),
    renderTidePanel(),
    renderWavePanel(),
    renderSurfForecastPanel(),
    renderCoastalWatersPanel(),
  ].filter(Boolean).join("");
}

function renderCoastalEmpty() {
  const shortcuts = COASTAL_PRESETS.map((preset, index) =>
    `<button type="button" class="coastal-preset" data-coastal-preset="${index}">${safeText(preset.name)}</button>`
  ).join("");
  return `
    <article class="tile coastal-empty">
      <span class="coastal-empty-icon" aria-hidden="true">${uiIcon("wave")}</span>
      <h3>${safeText(townName())} is inland</h3>
      <p>No wave model, tide gauge or NWS surf zone forecast covers this location. Pick a coastline below — or search any coastal town — to see rip current risk, tides and wave heights.</p>
      <div class="coastal-presets">${shortcuts}</div>
    </article>
  `;
}

function renderBeachPicker() {
  const segments = coastalState?.surf?.segments || [];
  if (segments.length < 2) return "";
  const options = segments.map((segment, index) =>
    `<option value="${index}"${index === coastalSegmentIndex ? " selected" : ""}>${safeText(segment.name || segment.zones.join(", "))}</option>`
  ).join("");
  return `
    <div class="beach-picker">
      <span class="ctrl-label">Beach forecast area</span>
      <select id="coastalBeachSelect" class="mrms-select" aria-label="Beach forecast area">${options}</select>
    </div>
  `;
}

function renderRipAndSea() {
  const risk = currentRipRisk();
  const segment = activeSurfSegment();
  const today = surfPeriodsWithRip(segment)[0];
  const marine = coastalState.marine?.current || {};

  const outlook = surfPeriodsWithRip(segment).slice(0, 4).map(period => {
    const level = ripLevelFromText(surfRowValue(period, RIP_ROW_RE) || "") || RIP_LEVELS.low;
    return `
      <div class="rip-day" style="--rip-color:${level.color}">
        <strong>${safeText(period.name)}</strong>
        <span>${level.label}</span>
      </div>`;
  }).join("");

  const ripCard = risk ? `
    <article class="tile rip-tile" style="--rip-color:${risk.color}">
      <div class="tile-heading">
        <p class="eyebrow">${safeText(risk.title || "Rip Current Risk")}</p>
        ${risk.estimated ? `<span class="rip-badge">Estimated</span>` : `<strong>${safeText(coastalState.surf?.office || "NWS")}</strong>`}
      </div>
      <div class="rip-dial" data-level="${risk.key}">
        <span class="rip-level">${risk.label}</span>
        <small>${safeText(risk.periodName || "Now")}</small>
      </div>
      <p class="rip-advice">${safeText(risk.advice)}</p>
      ${risk.estimated
        ? `<p class="rip-note">No NWS surf zone forecast covers this beach. Estimated from ${safeText(risk.basis)} of modelled sea state — not an official NWS rip current risk.</p>`
        : ""}
      ${outlook ? `<div class="rip-outlook">${outlook}</div>` : ""}
    </article>` : "";

  const surfHeight = surfRowValue(today, SURF_HEIGHT_RE);
  const waterTemp = coastalState.tides?.waterTempF ?? marine.sstF;
  const seaRows = [
    ["Surf height", surfHeight ? safeText(surfHeight) : fmtHeight(marine.waveFt)],
    ["Significant wave height", fmtHeight(marine.waveFt)],
    ["Dominant period", marine.periodS == null ? "--" : `${marine.periodS.toFixed(1)} s`],
    ["Swell", `${fmtHeight(marine.swellFt)} from ${compassLabel(marine.swellDir)}`],
    ["Wind waves", fmtHeight(marine.windWaveFt)],
    ["Water temperature", waterTemp == null ? "--" : fmtTemp(waterTemp)],
    ["Sea surface (model)", marine.sstF == null ? "--" : fmtTemp(marine.sstF)],
    ["Wave direction", compassLabel(marine.waveDir)],
  ];

  return `
    <div class="coastal-hero">
      ${ripCard}
      <article class="tile sea-tile">
        <div class="tile-heading">
          <p class="eyebrow">Sea State Now</p>
          <strong>${safeText(townName())}</strong>
        </div>
        <dl class="sea-rows">
          ${seaRows.map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join("")}
        </dl>
      </article>
    </div>
  `;
}

function renderCoastalMetrics() {
  const marine = coastalState.marine?.current || {};
  const tides = coastalState.tides;
  const nextTide = tides?.events?.find(event => tideKey(event) >= tideNowKey());
  const waterTemp = tides?.waterTempF ?? marine.sstF;

  const metrics = [
    ["wave", "Wave Height", fmtHeight(marine.waveFt), marine.periodS == null ? "Significant height" : `Dominant period ${marine.periodS.toFixed(1)} s`],
    ["swell", "Swell", fmtHeight(marine.swellFt), marine.swellDir == null ? "Long-period energy" : `From ${compassLabel(marine.swellDir)}`],
    ["seaTemp", "Water Temp", waterTemp == null ? "--" : fmtTemp(waterTemp), tides?.waterTempF != null ? `Gauge at ${safeText(tides.station.name)}` : "Modelled sea surface"],
    tides?.hasTides ? ["tide", nextTide ? `Next ${nextTide.type} Tide` : "Next Tide", nextTide ? nextTide.label : "--", nextTide ? `${fmtHeight(nextTide.heightFt, 1)} above ${tides.datum}` : `${safeText(tides.station.name)}`] : null,
    tides?.observed ? ["tide", "Water Level", fmtHeight(tides.observed.heightFt, 1), `${safeText(tides.station.name)} gauge, ${tides.observed.label}`] : null,
    marine.currentKt == null ? null : ["seaCurrent", "Ocean Current", `${marine.currentKt.toFixed(1)} kt`, `Setting toward ${compassLabel(marine.currentDir)}`],
  ].filter(Boolean);

  return `<div class="metric-grid">${metrics.map(([icon, name, value, detail]) => `
    <article class="tile metric">
      <div class="metric-head">${uiIcon(icon)}<p class="eyebrow">${name}</p></div>
      <span>${value}</span>
      <small>${detail}</small>
    </article>`).join("")}</div>`;
}

function renderTidePanel() {
  const tides = coastalState.tides;
  if (!tides?.hasTides) return "";
  const nowKey = tideNowKey();
  const upcoming = tides.events.filter(event => tideKey(event) >= nowKey).slice(0, 5);
  const chips = upcoming.map(event => {
    const hours = (tideKey(event) - nowKey) / 60;
    const away = hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min` : `${hours.toFixed(1)} h`;
    return `
      <div class="tide-chip ${event.type.toLowerCase()}">
        <span class="tide-chip-type">${event.type}</span>
        <strong>${safeText(event.label)}</strong>
        <small>${fmtHeight(event.heightFt, 1)} · in ${away}</small>
      </div>`;
  }).join("");

  return `
    <section class="tile coastal-panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">NOAA CO-OPS · ${safeText(tides.station.name)}${tides.station.state ? `, ${safeText(tides.station.state)}` : ""}</p>
          <h3>Tides</h3>
        </div>
        <span>Station ${safeText(tides.station.id)} · ${tides.station.distance.toFixed(0)} mi away · heights above ${tides.datum}</span>
      </div>
      <div class="tide-chips">${chips || "<p>No further tide predictions in the next three days.</p>"}</div>
      ${tideCurveSvg(tides)}
      ${tides.observed ? `<p class="coastal-footnote">Gauge reading ${fmtHeight(tides.observed.heightFt, 1)} at ${safeText(tides.observed.label)}${tides.waterTempF == null ? "" : ` · water ${fmtTemp(tides.waterTempF)}`}. Predictions are astronomical only — wind and surge shift the real water level.</p>` : ""}
    </section>
  `;
}

// 24-hour tide trace (6 h behind, 18 h ahead) with high/low callouts.
function tideCurveSvg(tides) {
  const nowKey = tideNowKey();
  const points = tides.curve
    .map(row => ({ ...row, key: tideKey(row) }))
    .filter(row => row.key >= nowKey - 360 && row.key <= nowKey + 1080);
  if (points.length < 4) return "";

  // Narrow screens get a smaller viewBox so the SVG's fixed-size labels are not
  // scaled down into illegibility.
  const narrow = window.innerWidth < 760;
  const W = narrow ? 380 : 720, H = narrow ? 200 : 190;
  const padL = 12, padR = 12, padT = 26, padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const values = points.map(p => p.heightFt);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const xFor = key => padL + ((key - points[0].key) / (points[points.length - 1].key - points[0].key)) * plotW;
  const yFor = v => padT + plotH - ((v - minV) / range) * plotH;

  const line = points.map((p, i) => `${i ? "L" : "M"}${xFor(p.key).toFixed(1)},${yFor(p.heightFt).toFixed(1)}`).join(" ");
  const area = `${line} L${xFor(points[points.length - 1].key).toFixed(1)},${(padT + plotH).toFixed(1)} L${xFor(points[0].key).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

  const marks = tides.events
    .map(event => ({ ...event, key: tideKey(event) }))
    .filter(event => event.key >= points[0].key && event.key <= points[points.length - 1].key)
    .map(event => {
      const x = xFor(event.key);
      const y = yFor(event.heightFt);
      const anchor = x < 60 ? "start" : x > W - 60 ? "end" : "middle";
      return `
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#8fd3ff" stroke="rgba(2,6,23,0.85)" stroke-width="1.6"/>
        <text x="${x.toFixed(1)}" y="${(event.type === "High" ? y - 10 : y + 18).toFixed(1)}" text-anchor="${anchor}"
          fill="#8fd3ff" font-size="11" font-weight="800" font-family="Inter,system-ui,sans-serif">${event.type === "High" ? "H" : "L"} ${safeText(event.label)}</text>`;
    }).join("");

  const nowX = xFor(nowKey);
  return `
    <div class="coastal-chart" style="aspect-ratio:${W} / ${H}">
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" role="img" aria-label="Tide curve for the next 18 hours">
        <defs>
          <linearGradient id="tideFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.42"/>
            <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.02"/>
          </linearGradient>
        </defs>
        <path d="${area}" fill="url(#tideFill)"/>
        <path d="${line}" fill="none" stroke="#38bdf8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="${nowX.toFixed(1)}" y1="${padT - 12}" x2="${nowX.toFixed(1)}" y2="${padT + plotH}" stroke="var(--accent)" stroke-width="1.6" stroke-dasharray="4,3"/>
        <text x="${nowX.toFixed(1)}" y="${padT - 16}" text-anchor="middle" fill="var(--accent)" font-size="11" font-weight="800" font-family="Inter,system-ui,sans-serif">Now</text>
        ${marks}
      </svg>
    </div>
  `;
}

function renderWavePanel() {
  const marine = coastalState.marine;
  if (!marine?.hourly?.length) return "";
  return `
    <section class="tile coastal-panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">Open-Meteo wave model</p>
          <h3>Wave Height Forecast</h3>
        </div>
        <div class="wave-mode-switch" id="coastalWaveSwitch">
          <button type="button" data-wave-mode="hourly" class="${coastalWaveMode === "hourly" ? "active" : ""}">Next 48 h</button>
          <button type="button" data-wave-mode="daily" class="${coastalWaveMode === "daily" ? "active" : ""}">7 days</button>
        </div>
      </div>
      ${coastalWaveMode === "daily" ? waveDailySvg(marine.daily) : waveHourlySvg(marine.hourly)}
    </section>
  `;
}

function waveHourlySvg(hourly) {
  const now = Date.now();
  let start = hourly.findIndex(row => Date.parse(row.time) >= now - 60 * 60 * 1000);
  if (start < 0) start = 0;
  const rows = hourly.slice(start, start + 48).filter(row => row.waveFt != null);
  if (rows.length < 3) return `<p class="coastal-footnote">No wave model data for this point.</p>`;

  const narrow = window.innerWidth < 760;
  const W = narrow ? 380 : 720, H = narrow ? 220 : 210;
  const padL = 12, padR = 12, padT = 28, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxV = Math.max(...rows.map(r => Math.max(r.waveFt, r.swellFt ?? 0))) || 1;
  const xFor = i => padL + (i / (rows.length - 1)) * plotW;
  const yFor = v => padT + plotH - (v / maxV) * plotH;

  const path = key => rows.map((row, i) => `${i ? "L" : "M"}${xFor(i).toFixed(1)},${yFor(row[key] ?? 0).toFixed(1)}`).join(" ");
  const waveLine = path("waveFt");
  const area = `${waveLine} L${xFor(rows.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)} L${padL},${(padT + plotH).toFixed(1)} Z`;

  const step = narrow ? 12 : 6;
  const labels = rows.map((row, i) => {
    if (i % step !== 0) return "";
    const t = new Date(row.time);
    return `
      <text x="${xFor(i).toFixed(1)}" y="${(H - 8).toFixed(1)}" text-anchor="middle" fill="rgba(232,240,255,0.5)"
        font-size="11" font-weight="600" font-family="Inter,system-ui,sans-serif">${i === 0 ? "Now" : t.toLocaleTimeString([], { hour: "numeric" })}</text>
      <text x="${xFor(i).toFixed(1)}" y="${(yFor(row.waveFt) - 9).toFixed(1)}" text-anchor="middle" fill="#7dd3fc"
        font-size="11" font-weight="800" font-family="Inter,system-ui,sans-serif">${fmtHeight(row.waveFt)}</text>`;
  }).join("");

  return `
    <div class="coastal-chart tall" style="aspect-ratio:${W} / ${H}">
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" role="img" aria-label="Hourly wave height forecast">
        <defs>
          <linearGradient id="waveFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#7dd3fc" stop-opacity="0.38"/>
            <stop offset="100%" stop-color="#7dd3fc" stop-opacity="0.02"/>
          </linearGradient>
        </defs>
        <path d="${area}" fill="url(#waveFill)"/>
        <path d="${waveLine}" fill="none" stroke="#7dd3fc" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="${path("swellFt")}" fill="none" stroke="#c4b5fd" stroke-width="1.8" stroke-dasharray="5,4" stroke-linecap="round"/>
        ${labels}
      </svg>
    </div>
    <p class="coastal-legend"><span class="swatch" style="--c:#7dd3fc"></span>Significant wave height<span class="swatch dashed" style="--c:#c4b5fd"></span>Swell component</p>
  `;
}

function waveDailySvg(daily) {
  const rows = (daily || []).filter(row => row.waveMaxFt != null);
  if (!rows.length) return `<p class="coastal-footnote">No daily wave model data for this point.</p>`;
  const maxV = Math.max(...rows.map(r => r.waveMaxFt)) || 1;
  return `
    <div class="wave-days">
      ${rows.map((row, index) => {
        const date = new Date(`${row.date}T12:00:00`);
        return `
          <div class="wave-day">
            <strong>${index === 0 ? "Today" : date.toLocaleDateString([], { weekday: "short" })}</strong>
            <div class="wave-bar"><span style="height:${Math.max(6, (row.waveMaxFt / maxV) * 100)}%"></span></div>
            <span class="wave-day-value">${fmtHeight(row.waveMaxFt)}</span>
            <small>${row.periodMaxS == null ? "" : `${Math.round(row.periodMaxS)} s`} ${row.direction == null ? "" : windDirLabel(row.direction)}</small>
          </div>`;
      }).join("")}
    </div>
  `;
}

function renderSurfForecastPanel() {
  const segment = activeSurfSegment();
  const periods = (segment?.periods || []).filter(period => period.rows.length);
  if (!periods.length) return "";
  const issued = coastalState.surf?.issued ? new Date(coastalState.surf.issued).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";

  return `
    <section class="tile coastal-panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">NWS ${safeText(coastalState.surf.office)} surf zone forecast</p>
          <h3>${safeText(segment.name || "Beach Forecast")}</h3>
        </div>
        <span>${[segment.detail, issued && `issued ${issued}`].filter(Boolean).map(safeText).join(" · ")}</span>
      </div>
      <div class="surf-periods">
        ${periods.map(period => `
          <article class="surf-period">
            <h4>${safeText(period.name)}</h4>
            <dl>
              ${period.rows.map(row => row.label
                ? `<div><dt>${safeText(row.label)}</dt><dd>${safeText(row.value)}</dd></div>`
                : `<div class="surf-prose"><dd>${safeText(row.value)}</dd></div>`).join("")}
            </dl>
          </article>`).join("")}
      </div>
    </section>
  `;
}

function renderCoastalWatersPanel() {
  const waters = coastalState.waters;
  if (!waters?.zones?.length && !waters?.synopsis) return "";
  const zones = waters.zones || [];
  const zone = zones[Math.min(coastalWatersIndex, Math.max(0, zones.length - 1))];
  const synopsisText = waters.synopsis?.periods?.[0]?.rows?.map(row => row.value).join(" ") || "";

  const picker = zones.length > 1 ? `
    <select id="coastalWatersSelect" class="mrms-select" aria-label="Coastal waters zone">
      ${zones.map((item, index) => `<option value="${index}"${index === coastalWatersIndex ? " selected" : ""}>${safeText(item.name || item.zones.join(", "))}</option>`).join("")}
    </select>` : "";

  return `
    <section class="tile coastal-panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">NWS ${safeText(waters.office)} coastal waters forecast</p>
          <h3>Offshore Outlook</h3>
        </div>
        ${picker || `<span>${safeText(zone?.name || "")}</span>`}
      </div>
      ${synopsisText ? `<p class="waters-synopsis">${safeText(synopsisText)}</p>` : ""}
      ${zone ? `<div class="waters-periods">
        ${zone.periods.map(period => `
          <article class="waters-period">
            <h4>${safeText(period.name)}</h4>
            <p>${safeText(period.rows.map(row => row.value).join(" "))}</p>
          </article>`).join("")}
      </div>` : ""}
    </section>
  `;
}

function refreshCoastal() {
  coastalState = null;
  coastalError = null;
  coastalSegmentIndex = 0;
  coastalWatersIndex = 0;
  renderCoastal();
  return coastalPayload().then(data => {
    coastalState = data;
    const segments = data.surf?.segments || [];
    const matched = segments.findIndex(segment => segment.zones.includes(data.zoneId));
    coastalSegmentIndex = matched === -1 ? 0 : matched;
    renderCoastal();
  }).catch(error => {
    coastalError = error.message;
    renderCoastal();
  });
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

// Same color with alpha 0, for canvas gradients: fading to "transparent"
// (transparent black) instead would darken the blend midway because canvas
// gradients interpolate without premultiplying alpha.
function hexToTransparent(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!match) return "rgba(7, 89, 133, 0)";
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0)`;
}

// The sky is the app: a live per-frame canvas painter keyed off the current
// bucket (see computeSkyBucket / SKY above) — rotating sun haze, drifting
// cloud banks, slanted rain, lightning flashes, swaying snow, drifting fog,
// warm sunset bands, or twinkling stars, depending on real conditions.
function drawAtmosphere(ts) {
  skyT = (ts || 0) / 1000;
  const stops = SKY[skyBucket] || SKY.clearDay;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Measure the canvas's actual rendered size so its buffer matches the CSS
  // overshoot. iOS standalone can still clip fixed elements out of safe-area
  // bands, so the body::before gradient mirrors this palette as the reliable fallback.
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  const bufferW = Math.round(w * dpr);
  const bufferH = Math.round(h * dpr);
  if (canvas.width !== bufferW || canvas.height !== bufferH) {
    canvas.width = bufferW;
    canvas.height = bufferH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const t = skyT;
  ctx.clearRect(0, 0, w, h);

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  stops.forEach((color, i) => grad.addColorStop(i / (stops.length - 1), color));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  if (skyBucket === "clearNight") {
    skyScene.stars.forEach((s) => {
      ctx.globalAlpha = s.a * (0.55 + 0.45 * Math.sin(t * 1.7 + s.ph));
      ctx.fillStyle = "#eaf3ff";
      ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.r, 0, 6.284); ctx.fill();
    });
    ctx.globalAlpha = 1;
    const mx = w * 0.82, my = h * 0.17;
    const mg = ctx.createRadialGradient(mx, my, 0, mx, my, h * 0.45);
    mg.addColorStop(0, "rgba(226,238,255,.45)"); mg.addColorStop(0.12, "rgba(190,214,255,.14)"); mg.addColorStop(1, "rgba(190,214,255,0)");
    ctx.fillStyle = mg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(238,245,255,.92)";
    ctx.beginPath(); ctx.arc(mx, my, Math.max(16, h * 0.034), 0, 6.284); ctx.fill();
  }

  if (skyBucket === "clearDay" || skyBucket === "partly") {
    const sx = w * 0.82, sy = h * (skyBucket === "clearDay" ? 0.14 : 0.18), pulse = 0.9 + 0.1 * Math.sin(t * 0.8);
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, h * 0.85 * pulse);
    sg.addColorStop(0, "rgba(255,247,214,.95)"); sg.addColorStop(0.055, "rgba(255,240,190,.5)");
    sg.addColorStop(0.26, "rgba(255,232,170,.15)"); sg.addColorStop(1, "rgba(255,232,170,0)");
    ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(t * 0.05); ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      const len = h * (0.55 + 0.06 * Math.sin(t * 1.1 + i));
      const rg = ctx.createLinearGradient(0, 0, 0, -len);
      rg.addColorStop(0, "rgba(255,246,208,.14)"); rg.addColorStop(1, "rgba(255,246,208,0)");
      ctx.fillStyle = rg;
      ctx.beginPath(); ctx.moveTo(-h * 0.022, 0); ctx.lineTo(0, -len); ctx.lineTo(h * 0.022, 0); ctx.fill();
    }
    ctx.restore();
  }

  if (skyBucket === "sunset") {
    const sx = w * 0.68, sy = h * 0.72;
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, h * 0.95);
    sg.addColorStop(0, "rgba(255,236,190,.95)"); sg.addColorStop(0.045, "rgba(255,197,120,.58)");
    sg.addColorStop(0.28, "rgba(255,140,90,.19)"); sg.addColorStop(1, "rgba(255,120,80,0)");
    ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 5; i++) {
      const y = sy - h * (0.06 + i * 0.07) + Math.sin(t * 0.25 + i) * h * 0.01;
      const bg = ctx.createLinearGradient(0, y, w, y + h * 0.04);
      bg.addColorStop(0, "rgba(255,180,120,0)"); bg.addColorStop(0.5, `rgba(255,190,130,${0.09 - i * 0.012})`); bg.addColorStop(1, "rgba(255,180,120,0)");
      ctx.fillStyle = bg; ctx.fillRect(0, y, w, h * 0.035);
    }
    ctx.restore();
  }

  const tint = { overcast: "245,248,252", storm: "150,165,182", rain: "180,195,210", snow: "235,242,250", fog: "240,244,248", sunset: "255,205,170", clearNight: "160,185,220" }[skyBucket] || "255,255,255";
  skyScene.clouds.forEach((cl) => {
    const x = ((cl.x + t * cl.s) % 1.4 - 0.2) * w, y = cl.y * h, cw = cl.w * w, ch = cl.h * h;
    const cg = ctx.createRadialGradient(x, y, 0, x, y, cw * 0.5);
    cg.addColorStop(0, `rgba(${tint},${cl.a})`); cg.addColorStop(0.55, `rgba(${tint},${cl.a * 0.45})`); cg.addColorStop(1, `rgba(${tint},0)`);
    ctx.fillStyle = cg;
    ctx.save(); ctx.translate(x, y); ctx.scale(1, ch / (cw * 0.5));
    ctx.beginPath(); ctx.arc(0, 0, cw * 0.5, 0, 6.284); ctx.fill(); ctx.restore();
  });

  skyScene.fogBanks.forEach((f) => {
    const y = f.y * h + Math.sin(t * 0.2 + f.x * 6) * h * 0.015;
    const fg = ctx.createLinearGradient(0, y - f.h * h * 0.5, 0, y + f.h * h * 0.5);
    fg.addColorStop(0, "rgba(226,232,238,0)"); fg.addColorStop(0.5, `rgba(226,232,238,${f.a})`); fg.addColorStop(1, "rgba(226,232,238,0)");
    ctx.fillStyle = fg;
    const off = ((f.x + t * f.s) % 1.4 - 0.2) * w;
    ctx.fillRect(off - w, y - f.h * h * 0.5, w * 2.4, f.h * h);
  });

  if (skyScene.drops.length) {
    const slant = skyBucket === "storm" ? 0.34 : 0.18;
    ctx.lineCap = "round";
    skyScene.drops.forEach((d) => {
      const y = ((d.y + t * d.s) % 1.15) * h - h * 0.08;
      const x = ((d.x + (y / h) * slant) % 1) * w, len = d.l * h;
      ctx.strokeStyle = `rgba(214,236,255,${d.a})`; ctx.lineWidth = d.w;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - len * slant, y + len); ctx.stroke();
    });
  }

  if (skyScene.flakes.length) {
    skyScene.flakes.forEach((f) => {
      const y = ((f.y + t * f.s) % 1.12) * h - h * 0.06;
      const x = (f.x + Math.sin(t * 0.8 + f.ph) * f.sw) * w;
      ctx.globalAlpha = f.a; ctx.fillStyle = "#f7fbff";
      ctx.beginPath(); ctx.arc(x, y, f.r, 0, 6.284); ctx.fill();
    });
    ctx.globalAlpha = 1;
    const ag = ctx.createLinearGradient(0, h * 0.84, 0, h);
    ag.addColorStop(0, "rgba(232,240,250,0)"); ag.addColorStop(1, "rgba(236,244,252,.26)");
    ctx.fillStyle = ag; ctx.fillRect(0, h * 0.84, w, h * 0.16);
  }

  if (skyBucket === "storm") {
    const flash = skyScene.flash;
    if (t > flash.next) { flash.on = 1; flash.next = t + skyRnd(2.2, 6.5); flash.x = skyRnd(0.15, 0.85); }
    if (flash.on > 0) {
      flash.on = Math.max(0, flash.on - 0.055);
      const e = flash.on * flash.on, fx = flash.x * w;
      const fg = ctx.createRadialGradient(fx, h * 0.1, 0, fx, h * 0.1, h * 1.1);
      fg.addColorStop(0, `rgba(226,238,255,${0.5 * e})`); fg.addColorStop(0.4, `rgba(190,214,255,${0.16 * e})`); fg.addColorStop(1, "rgba(190,214,255,0)");
      ctx.fillStyle = fg; ctx.fillRect(0, 0, w, h);
      if (flash.on > 0.72) {
        ctx.strokeStyle = `rgba(238,246,255,${0.85 * e})`; ctx.lineWidth = 1.8; ctx.beginPath();
        let bx = fx, by = h * 0.05; ctx.moveTo(bx, by);
        for (let i = 0; i < 7; i++) { bx += (Math.random() - 0.5) * w * 0.04; by += h * 0.07; ctx.lineTo(bx, by); }
        ctx.stroke();
      }
    }
  }

  if (skyBucket === "fog") {
    const vg = ctx.createRadialGradient(w * 0.5, h * 0.5, h * 0.1, w * 0.5, h * 0.5, h * 0.95);
    vg.addColorStop(0, "rgba(190,197,204,0)"); vg.addColorStop(1, "rgba(174,182,190,.4)");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  }

  // iOS standalone web apps clip every fixed-position layer out of the
  // status-bar safe-area band, which only ever paints the flat html
  // background-color (--sky-0 = stops[0]). The scene varies across that
  // line, so the band met the scene with a visible seam just below the
  // Dynamic Island. Painting the top of the finished scene (220px offscreen
  // bleed + the safe-area strip) back to that same flat color — over the
  // stars/rain too, hence drawn last — makes the band and the scene meet
  // seamlessly; body::before and the body::after mask mirror this same
  // blend geometry in CSS.
  const blendEnd = 600;
  const topBlend = ctx.createLinearGradient(0, 0, 0, blendEnd);
  topBlend.addColorStop(0, stops[0]);
  topBlend.addColorStop(340 / blendEnd, stops[0]);
  topBlend.addColorStop(1, hexToTransparent(stops[0]));
  ctx.fillStyle = topBlend;
  ctx.fillRect(0, 0, w, blendEnd);

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

function mrmsFrameArray(count = MRMS_FRAMES) {
  // Returns [count-1, ..., 1, 0] so slider 0=oldest, slider max=latest(mrmsIdx=0)
  return Array.from({ length: count }, (_, i) => count - 1 - i);
}

// How many frames of the active product the generator has actually published.
// The rolling buffer is contiguous (frame 0 is always the newest), so walking
// up from 1 until the first 404 finds the end in a couple of requests instead
// of probing all MRMS_FRAMES slots.
async function detectMrmsFrameCount(product = activeMrmsProduct) {
  if (mrmsFrameCountCache[product]) return mrmsFrameCountCache[product];
  const cfg = MRMS_PRODUCTS[product];
  let count = 1; // frame 0 is assumed to exist
  for (let i = 1; i < MRMS_FRAMES; i++) {
    let res;
    try {
      res = await fetch(MRMS_BASE + cfg.getGeo(i), { method: "HEAD", cache: "no-store" });
    } catch {
      break; // network/CORS hiccup — keep whatever we have confirmed so far
    }
    if (!res.ok) break; // genuine 404 → end of the rolling buffer
    count = i + 1;
  }
  mrmsFrameCountCache[product] = count;
  return count;
}


function stopRadarAnimation() {
  if (radarAnimationTimer) clearInterval(radarAnimationTimer);
  radarAnimationTimer = null;
  const lbl = document.querySelector("#playLabel");
  if (lbl) lbl.textContent = "Play";
}

// The layer controls and the conditions sidebar float over the map, so each one
// is a panel the user can dismiss to get the full view back.
function toggleMapPanel(panelId, buttonId, show) {
  const panel = document.querySelector(panelId);
  const button = document.querySelector(buttonId);
  if (!panel || !button) return;
  const open = show ?? panel.hidden;
  panel.hidden = !open;
  button.classList.toggle("active", open);
  button.setAttribute("aria-expanded", String(open));
}

function renderMapSidebar() {
  const sidebar = document.querySelector("#mapSidebar");
  if (!sidebar) return;
  const current = weatherState.current || fallbackWeather.current;
  const fwi = FWI.calculate({
    temp: current.temp, humidity: current.humidity,
    wind: current.wind, gust: current.gust,
    cloudCover: current.cloudCover,
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

function mrmsGeoUrl(mrmsIdx, product = activeMrmsProduct) {
  return MRMS_BASE + MRMS_PRODUCTS[product].getGeo(mrmsIdx);
}

// Fetch (and memoise) one frame's contour bands. Frames are handed to Mapbox as
// parsed objects rather than URLs so scrubbing the timeline re-shows a cached
// frame instantly instead of re-downloading and blanking the map.
async function loadMrmsFrame(mrmsIdx, product = activeMrmsProduct) {
  const key = `${product}_${mrmsIdx}`;
  if (mrmsGeoCache[key]) return mrmsGeoCache[key];
  const data = await getJson(mrmsGeoUrl(mrmsIdx, product));
  mrmsGeoCache[key] = data;
  return data;
}

// Warm the rest of the buffer in the background so pressing Play animates
// smoothly instead of stuttering on each frame's download.
function prewarmMrmsFrames() {
  const product = activeMrmsProduct;
  (async () => {
    for (const idx of radarFrames) {
      if (product !== activeMrmsProduct) return; // product switched mid-prefetch
      await loadMrmsFrame(idx, product).catch(() => {});
    }
  })();
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
  // Placeholder until the frame's metadata arrives with its real valid time.
  // Frames are not published on a fixed cadence, so don't guess minutes.
  labelEl.textContent = `−${mrmsIdx} frame${mrmsIdx > 1 ? "s" : ""}`;
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
      const product = activeMrmsProduct;
      // Load the bands first and only then swap them in, so a slow frame leaves
      // the previous one on screen instead of flashing an empty map.
      loadMrmsFrame(mrmsIdx, product)
        .then(data => {
          if (product !== activeMrmsProduct) return;          // product switched mid-load
          if (radarFrames[radarFrameIndex] !== mrmsIdx) return; // scrubbed past this frame
          radarMap.getSource("mrms-source")?.setData(data);
        })
        .catch(() => {});
    }
  }
  updateRadarLabel();
}

function setRainfallOpacity(pct) {
  radarOpacity = pct / 100;
  if (radarMap && mapLoaded) {
    if (radarMap.getLayer("mrms-layer"))
      radarMap.setPaintProperty("mrms-layer", "fill-opacity", radarOpacity);
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
  lsrMarkers.forEach(marker => marker.remove());
  lsrMarkers = [];
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
  const product = activeMrmsProduct;
  const count = await detectMrmsFrameCount(product);
  if (!radarMap || !radarMap.getStyle() || !radarActive) return; // bailed mid-await
  if (product !== activeMrmsProduct) return;                     // product switched mid-await

  radarFrames = mrmsFrameArray(count);
  radarFrameIndex = radarFrames.length - 1; // latest = mrmsIdx 0
  const slider = document.querySelector("#radarTimeline");
  if (slider) {
    slider.max = Math.max(1, radarFrames.length - 1);
    slider.value = radarFrameIndex;
    // A single-frame buffer has nothing to scrub through; the row stays visible
    // so the timestamp readout still shows, but the control goes inert.
    slider.disabled = radarFrames.length < 2;
  }
  const playBtn = document.querySelector("#radarPlayButton");
  if (playBtn) playBtn.disabled = radarFrames.length < 2;

  const mrmsIdx = radarFrames[radarFrameIndex]; // 0 = latest
  const data = await loadMrmsFrame(mrmsIdx, product).catch(() => null);
  if (!data) return;
  if (!radarMap || !radarMap.getStyle() || !radarActive) return;
  if (product !== activeMrmsProduct) return;
  if (radarMap.getSource("mrms-source")) return; // already mounted

  radarMap.addSource("mrms-source", { type: "geojson", data });
  addWeatherLayer({
    id: "mrms-layer",
    type: "fill",
    source: "mrms-source",
    paint: {
      // Each band carries its own colour, so the fill is driven straight from
      // the feature instead of a step expression that would have to duplicate
      // the generator's colour tables here.
      "fill-color": ["coalesce", ["get", "c"], "rgba(0,0,0,0)"],
      "fill-opacity": radarOpacity,
      // Bands butt directly against one another; outlining every polygon would
      // draw a seam between neighbouring colours.
      "fill-antialias": true,
    },
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
    if (slider) {
      slider.max = satFrames.length - 1;
      slider.value = satFrameIndex;
      slider.disabled = satFrames.length < 2;
    }
    const playBtn = document.querySelector("#radarPlayButton");
    if (playBtn) playBtn.disabled = satFrames.length < 2;
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
  "tornado": { svg: `<path d="M12 3c-1 3-4 5-4 9h3l-2 9 9-12h-5z" fill="currentColor"/><path d="M10 21c0 0 1-2 3-2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`, color: "#ef4444", label: "Tornado" },
  "hail": { svg: `<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><line x1="12" y1="5" x2="12" y2="7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="17" x2="12" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="5" y1="12" x2="7" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="17" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`, color: "#f97316", label: "Hail" },
  "wind": { svg: `<path d="M5 8h10.5a2.5 2.5 0 1 0-2.5-2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M3 12h14.5a2.5 2.5 0 1 0-2.5-2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M5 16h8.5a2.5 2.5 0 1 0-2.5-2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`, color: "#38bdf8", label: "Wind" },
  "flood": { svg: `<path d="M7 10c0-3 5-7 5-7s5 4 5 7a5 5 0 0 1-10 0z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M2 19c2-3 5-3 7-1.5s5 1.5 7-1.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`, color: "#10b981", label: "Flood" },
  "rain": { svg: `<path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="8" y1="19" x2="8" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="17" x2="12" y2="19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="16" y1="19" x2="16" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`, color: "#60a5fa", label: "Rain" },
  "winter": { svg: `<line x1="2" x2="22" y1="12" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" x2="12" y1="2" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="m20 16-4-4 4-4m-16 8 4-4-4-4m12-4-4 4-4-4m0 16 4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`, color: "#a5f3fc", label: "Snow" },
  "lightning": { svg: `<path d="M13 2L4 14h8l-1 8 9-12h-8l1-8z" fill="currentColor"/>`, color: "#facc15", label: "Lightning" },
};

// Plain-language LSR groupings. Reports are bucketed by their typetext — the
// raw IEM single-letter type codes used to drive the filter buttons, which
// read as meaningless letters ("T", "G", "M"…). First matching category wins;
// "other" is the catch-all.
const LSR_CATEGORIES = [
  { id: "tornado",   label: "Tornado",    match: /TORNADO|FUNNEL|WATERSPOUT|WALL CLOUD|LANDSPOUT/ },
  { id: "wind",      label: "Wind",       match: /WIND|\bWND\b|DOWNBURST|MICROBURST|GUSTNADO|DUST/ },
  { id: "hail",      label: "Hail",       match: /HAIL/ },
  { id: "flood",     label: "Flooding",   match: /FLOOD|HIGH WATER|DEBRIS FLOW|MUDSLIDE/ },
  { id: "rain",      label: "Rain",       match: /RAIN/ },
  { id: "winter",    label: "Snow & Ice", match: /SNOW|BLIZZARD|SLEET|FREEZING|\bICE\b|GRAUPEL|WINTER/ },
  { id: "lightning", label: "Lightning",  match: /LIGHTNING/ },
  { id: "other",     label: "Other",      match: /./ },
];

function lsrCategory(properties = {}) {
  const text = String(properties.typetext || properties.type || "").toUpperCase();
  return LSR_CATEGORIES.find(cat => cat.match.test(text)) || LSR_CATEGORIES[LSR_CATEGORIES.length - 1];
}

function lsrIconConfig(properties = {}) {
  const category = lsrCategory(properties);
  const defaultSvg = `<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
  const icon = LSR_ICONS[category.id] || { svg: defaultSvg, color: "#94a3b8" };
  // Use the report's own typetext ("TSTM WND GST" → "Tstm Wnd Gst") for the
  // popup label; the category label is the fallback.
  const typetext = String(properties.typetext || "").trim();
  return { ...icon, label: typetext ? titleCaseAlertName(typetext.toLowerCase()) : category.label };
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

function lsrTypeKey(properties = {}) {
  return lsrCategory(properties).id;
}

function lsrFilteredFeatures() {
  const features = lsrData?.features || [];
  if (!activeLsrTypes.size) return features;
  return features.filter(feature => activeLsrTypes.has(lsrTypeKey(feature.properties || {})));
}

function lsrFilteredCollection() {
  return { ...(lsrData || {}), type: "FeatureCollection", features: lsrFilteredFeatures() };
}

function updateLsrLayerData() {
  if (!radarMap || !mapLoaded) return;
  const data = lsrFilteredCollection();
  const source = radarMap.getSource("lsr-source");
  if (source) source.setData(data);

  lsrMarkers.forEach(marker => marker.remove());
  lsrMarkers = [];
  data.features.forEach(feat => {
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

    const marker = new mapboxgl.Marker({ element: wrap, anchor: "center" })
      .setLngLat([coords[0], coords[1]])
      .addTo(radarMap);
    lsrMarkers.push(marker);
  });
}

async function addLsrLayer() {
  if (!radarMap || !mapLoaded) return;
  if (!lsrData) {
    lsrData = await fetchOutlookGeoJson(LSR_URL);
  }
  renderLsrSubControls();
  const features = lsrFilteredFeatures();
  if (!features.length && !(lsrData?.features || []).length) return;

  radarMap.addSource("lsr-source", { type: "geojson", data: lsrFilteredCollection() });
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

  updateLsrLayerData();
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

// Compact map-click alert popup: one header line (event + source · expiry)
// and a single wrapping row of hazard chips. The old multi-row stat list grew
// taller than the visible map on phones, forcing a scroll just to reach the
// details button — full information lives behind "View Alert Details".
function buildAlertBodyHtml(feature, alertIdx, popupId) {
  const p = feature.properties || {};
  const isIem = p.phenomena != null;
  let title, subtitle, chips, iconStyle;
  const expiresChip = expires => expires
    ? `Expires ${new Date(expires).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : null;

  if (isIem) {
    const tempAlert = normalizeIemFeature(feature);
    tempAlert.tags = tagsForAlert(tempAlert);
    title = safeText(alertDisplayEvent(tempAlert));
    subtitle = `Storm-Based Warning${p.wfo ? ` · ${safeText(p.wfo)}` : ""}`;
    iconStyle = "background:rgba(251,146,60,0.18);border:1px solid rgba(251,146,60,0.35);";
    chips = [
      expiresChip(p.expire),
      p.windtag && `Wind ${numericWind(p.windtag) != null ? fmtWind(numericWind(p.windtag)) : `${p.windtag} mph`}`,
      p.hailtag && `Hail ${isMetric() && Number.isFinite(Number(p.hailtag)) ? `${(Number(p.hailtag) * 2.54).toFixed(1)} cm` : `${p.hailtag}"`}`,
      p.tornadotag && `Tornado ${String(p.tornadotag).toLowerCase()}`,
    ];
  } else {
    const evtLower = (p.event || "").toLowerCase();
    const matchedAlert = (weatherState.alerts || []).find(a => a.event?.toLowerCase() === evtLower);
    title = safeText(matchedAlert ? alertDisplayEvent(matchedAlert) : (p.event || "Weather Alert"));
    subtitle = p.ecccAlert ? "ECCC Alert" : "NWS Alert";
    iconStyle = `background:${safeText(p.fillColor || "#f59e0b")}22;border:1px solid ${safeText(p.lineColor || "#fbbf24")}66;`;
    chips = [
      expiresChip(p.expires),
      p.severity,
      p.zoneName || p.areaDesc,
    ];
  }

  const chipsHtml = chips.filter(Boolean)
    .map(chip => `<span class="popup-chip">${safeText(String(chip))}</span>`)
    .join("");

  return `
    <div class="popup-compact">
      <div class="popup-header">
        <div class="popup-icon popup-alert" style="${iconStyle}">⚠️</div>
        <div>
          <div class="popup-title">${title}</div>
          <div class="popup-subtitle">${subtitle}</div>
        </div>
      </div>
      [NAV_SLOT]
      ${chipsHtml ? `<div class="popup-chip-row">${chipsHtml}</div>` : ""}
      <button class="popup-alert-details-btn" onclick="window._viewAlertFromMapFeature(${popupId},${alertIdx})">View Alert Details</button>
    </div>`;
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
  // clear when panning into a quiet region. Empty sources are still mounted so
  // switching from Priority to All can reveal already-fetched alerts instantly.
  const emptyCollection = { type: "FeatureCollection", features: [] };

  const iemData = filterAlertCollectionForMap(alertPolygonData || emptyCollection, "iem");
  const iemSource = radarMap.getSource("alerts-source");
  if (iemSource) {
    iemSource.setData(iemData);
  } else {
    // maxzoom 10: past z10 Mapbox overzooms existing tiles instead of
    // re-tiling the polygons for every zoom level, which made the alert
    // fills blink out for a moment on each zoom step (the source geometry
    // is only ~110m precision, so nothing visible is lost).
    radarMap.addSource("alerts-source", { type: "geojson", data: iemData, maxzoom: 10 });
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

  const nwsData = filterAlertCollectionForMap(nwsAlertPolygonData || emptyCollection, "nws");
  const nwsSource = radarMap.getSource("nws-alerts-source");
  if (nwsSource) {
    nwsSource.setData(nwsData);
  } else {
    // maxzoom 10 for the same zoom-blink reason as alerts-source above.
    radarMap.addSource("nws-alerts-source", { type: "geojson", data: nwsData, maxzoom: 10 });
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

  // The data fed above is already filtered for the active alert kind, so only
  // sync layer visibility here. Calling applyAlertKindFilter() would setData
  // the same collections a second time, and every setData drops the source's
  // tiles until the worker re-cuts them — a visible blink of the alert
  // polygons after each zoom/pan refetch.
  ensureAlertLayersVisible();

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
function refreshAlertSourcesForFilter() {
  if (!radarMap || !mapLoaded) return;
  const emptyCollection = { type: "FeatureCollection", features: [] };
  const iemSource = radarMap.getSource("alerts-source");
  if (iemSource) iemSource.setData(filterAlertCollectionForMap(alertPolygonData || emptyCollection, "iem"));
  const nwsSource = radarMap.getSource("nws-alerts-source");
  if (nwsSource) nwsSource.setData(filterAlertCollectionForMap(nwsAlertPolygonData || emptyCollection, "nws"));
}

function ensureAlertLayersVisible() {
  if (!radarMap || !mapLoaded) return;
  ["nws-alerts-fill", "nws-alerts-line", "alerts-fill", "alerts-line"].forEach(id => {
    if (radarMap.getLayer(id)) radarMap.setFilter(id, null);
    if (radarMap.getLayer(id)) radarMap.setLayoutProperty(id, "visibility", "visible");
  });
}

function applyAlertKindFilter() {
  if (!radarMap || !mapLoaded) return;
  refreshAlertSourcesForFilter();
  ensureAlertLayersVisible();
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

// The map stage fills everything from the bottom of the tab bar to the bottom
// of the viewport. That offset can't be a constant — the header wraps at narrow
// widths and iOS adds a safe-area inset — so measure it and hand it to CSS.
function sizeMapStage() {
  const stage = document.querySelector("#mapStage");
  if (!stage || !document.querySelector("#maps")?.classList.contains("active")) return;
  const top = stage.getBoundingClientRect().top + (window.scrollY || document.documentElement.scrollTop || 0);
  document.documentElement.style.setProperty("--map-stage-top", `${Math.max(0, Math.round(top))}px`);
}

// Fullscreen lifts the map over the header and tab bar so it covers the entire
// screen. It is a CSS state rather than the Fullscreen API because iOS Safari
// doesn't support requestFullscreen outside of video.
function setMapFullscreen(on) {
  const btn = document.querySelector("#mapFullscreenBtn");
  const labels = document.querySelectorAll("#mapFullscreenLabel, #mapFullscreenLabelShort");
  const active = on ?? !document.body.classList.contains("map-fullscreen");
  document.body.classList.toggle("map-fullscreen", active);
  btn?.classList.toggle("active", active);
  btn?.setAttribute("aria-pressed", String(active));
  // Wide and narrow variants of the label are swapped by a media query.
  labels.forEach(el => {
    el.textContent = active ? "Exit" : (el.id === "mapFullscreenLabelShort" ? "Full" : "Fullscreen");
  });
  // The stage changed size; Mapbox only re-reads its container on demand.
  requestAnimationFrame(() => radarMap?.resize());
}

// On a phone the layer panel covers most of the map, so the first visit to the
// radar tab opens on the map itself; there is room for it on a wide screen.
let mapPanelsInitialised = false;
function initMapPanelDefaults() {
  if (mapPanelsInitialised) return;
  mapPanelsInitialised = true;
  if (window.innerWidth <= 720) toggleMapPanel("#mapControlsPanel", "#mapLayersToggle", false);
}

function drawRadar(relocate = false) {
  if (!document.querySelector("#maps")?.classList.contains("active")) return;
  sizeMapStage();
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
  // Contour frames are a couple of MB each, so they are only bulk-downloaded
  // once the user asks for animation rather than on every visit to the tab.
  if (!sat) prewarmMrmsFrames();
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

  const lsrCtrl = document.querySelector("#lsrSubControls");
  if (lsrCtrl) {
    lsrCtrl.hidden = !activeOverlays.has("LSR");
    if (activeOverlays.has("LSR")) renderLsrSubControls();
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

function renderLsrSubControls() {
  const el = document.querySelector("#lsrTypeBtns");
  if (!el) return;
  const counts = new Map();
  (lsrData?.features || []).forEach(feature => {
    const key = lsrTypeKey(feature.properties || {});
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  // Buttons follow the fixed category order (most severe hazards first) and
  // only appear for categories that actually have reports right now. Each
  // shows a color dot matching its map markers plus a live report count.
  const allActive = !activeLsrTypes.size;
  const categoryBtn = cat => {
    const icon = LSR_ICONS[cat.id];
    const dot = icon ? `<span class="lsr-cat-dot" style="background:${icon.color}"></span>` : "";
    return `<button type="button" data-lsr-type="${cat.id}" class="${activeLsrTypes.has(cat.id) ? "active" : ""}" title="Show only ${safeText(cat.label.toLowerCase())} reports">${dot}${safeText(cat.label)} <small>${counts.get(cat.id)}</small></button>`;
  };
  el.innerHTML = [
    `<button type="button" data-lsr-type="__all" class="${allActive ? "active" : ""}" title="Show every storm report">All reports</button>`,
    ...LSR_CATEGORIES.filter(cat => counts.has(cat.id)).map(categoryBtn),
  ].join("");
  el.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.lsrType;
      if (type === "__all") activeLsrTypes.clear();
      else {
        if (activeLsrTypes.has(type)) activeLsrTypes.delete(type);
        else activeLsrTypes.add(type);
      }
      localStorage.setItem("lsrCategoryFilter", JSON.stringify([...activeLsrTypes]));
      renderLsrSubControls();
      updateLsrLayerData();
    });
  });
}

function renderAlertSubControls() {
  const el = document.querySelector("#alertFilterBtns");
  if (!el) return;
  const kinds = [["priority", "Priority"], ["all", "All"], ["warning", "Warnings"], ["watch", "Watches"], ["advisory", "Advisories"]];
  el.innerHTML = kinds.map(([id, label]) =>
    `<button type="button" data-alert-kind="${id}" class="${id === activeAlertFilter ? "active" : ""}">${label}</button>`
  ).join("");
  el.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => {
      activeAlertFilter = btn.dataset.alertKind;
      localStorage.setItem("alertKindFilter", activeAlertFilter);
      renderAlertSubControls();
      // Swap filtered source data in place — no refetch or redraw needed.
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

// ─── Contour band sampling ───────────────────────────────────────────────────

async function loadImgCors(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image load failed: ${url}`));
    img.src = url;
  });
}

// Read the radar value under a click. The frames are vector contour bands, so
// the band the user tapped is already on the map with its value range attached
// — asking Mapbox which feature is under the point is exact and instant, where
// the old raster path had to download a companion value PNG and decode a pixel.
function sampleMrmsValue(point) {
  if (!radarMap?.getLayer("mrms-layer")) return null;
  const hits = radarMap.queryRenderedFeatures(point, { layers: ["mrms-layer"] });
  if (!hits.length) return { noData: true };

  const cfg = MRMS_PRODUCTS[activeMrmsProduct];
  // Mapbox returns the topmost rendered feature first. Bands are emitted low
  // value → high value (and, for the precip-type product, rain then snow then
  // ice), so the first hit is the one actually visible at this point.
  const props = hits[0].properties || {};
  const color = String(props.c || "").toLowerCase();
  const low   = Number(props.v0);
  const high  = props.v1 === null || props.v1 === undefined || props.v1 === "" ? null : Number(props.v1);

  return {
    product: cfg.label,
    unit: cfg.unit,
    color: /^#[0-9a-f]{6}$/.test(color) ? color : null,
    low: Number.isFinite(low) ? low : null,
    high: Number.isFinite(high) ? high : null,
    dec: cfg.dec,
    // Only the precip-rate product mixes several colour tables into one file.
    precipType: cfg.typed ? MRMS_RATE_TYPE_BY_COLOR[color] || null : null,
  };
}

// "0.20 – 0.50 in/hr" for a closed band, "3.00+ in/hr" for the open-ended top.
function mrmsBandLabel(data) {
  const fmt = v => v.toFixed(data.dec);
  if (data.low === null) return `Detected${data.unit ? ` (${data.unit})` : ""}`;
  if (data.high === null) return `${fmt(data.low)}+ ${data.unit}`;
  return `${fmt(data.low)} – ${fmt(data.high)} ${data.unit}`;
}

function buildRadarPixelHtml(data) {
  const swatch = data.color || "#38bdf8";
  const iconBg = `background:${swatch}33;border:1px solid ${swatch}88`;
  const typeRow = data.precipType
    ? `<div class="popup-stat"><span class="popup-key">Type</span><span class="popup-val">${safeText(data.precipType)}</span></div>`
    : "";
  return `
    <div class="popup-header">
      <div class="popup-icon popup-mrms" style="${iconBg}">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9"/><polyline points="16 16 12 20 8 16"/><line x1="12" y1="12" x2="12" y2="20"/></svg>
      </div>
      <div>
        <div class="popup-title">MRMS ${safeText(data.product)}</div>
        <div class="popup-subtitle">Contour Band</div>
      </div>
    </div>
    [NAV_SLOT]
    ${typeRow}
    <div class="popup-stat"><span class="popup-key">Value</span><span class="popup-val">${safeText(mrmsBandLabel(data))}</span></div>
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

  // Collect the radar contour band under the click (put first so it's the
  // default view for map clicks)
  if (radarActive && !preferredLsrFeature) {
    try {
      const band = sampleMrmsValue(point);
      if (band && !band.noData) items.unshift({ type: "radar", data: band });
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
  // Coastal sources are slow and only matter on one tab, so they resolve on
  // their own rather than holding up the rest of the refresh.
  refreshCoastal();

  refreshButton.disabled = false;
  refreshButton.textContent = "Refresh";
}

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(item => item.classList.toggle("active", item === tab));
    screens.forEach(screen => screen.classList.toggle("active", screen.id === tab.dataset.tab));
    document.body.classList.toggle("map-mode", tab.dataset.tab === "maps");
    if (tab.dataset.tab !== "maps") setMapFullscreen(false);
    if (tab.dataset.tab === "maps") {
      // The map screen exactly fills the viewport below the tabs, so drop any
      // scroll carried over from the tab the user came from before measuring.
      window.scrollTo(0, 0);
      initMapPanelDefaults();
      setTimeout(() => drawRadar(true), 0);
    }
  });
});

document.querySelector("#mapLayersToggle")?.addEventListener("click", () => {
  toggleMapPanel("#mapControlsPanel", "#mapLayersToggle");
});
document.querySelector("#mapInfoToggle")?.addEventListener("click", () => {
  toggleMapPanel("#mapSidebar", "#mapInfoToggle");
});
document.querySelector("#mapFullscreenBtn")?.addEventListener("click", () => setMapFullscreen());

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
  if (event.key !== "Escape") return;
  if (!detailModal.hidden) closeDetails();
  else if (document.body.classList.contains("map-fullscreen")) setMapFullscreen(false);
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
  mrmsGeoCache = {};        // Drop the previous product's contour frames
  mrmsTimeCache = {};       // Frame timestamps are per product too
  drawRadar(false);
});

const coastalBody = document.querySelector("#coastalBody");
coastalBody?.addEventListener("click", event => {
  const preset = event.target.closest("[data-coastal-preset]");
  if (preset) {
    chooseLocation(COASTAL_PRESETS[Number(preset.dataset.coastalPreset)]);
    return;
  }
  const modeBtn = event.target.closest("[data-wave-mode]");
  if (modeBtn) {
    coastalWaveMode = modeBtn.dataset.waveMode;
    renderCoastal();
  }
});
coastalBody?.addEventListener("change", event => {
  if (event.target.id === "coastalBeachSelect") {
    coastalSegmentIndex = Number(event.target.value);
    renderCoastal();
  } else if (event.target.id === "coastalWatersSelect") {
    coastalWatersIndex = Number(event.target.value);
    renderCoastal();
  }
});

document.querySelector("#hourlyMetricSwitcher")?.addEventListener("click", event => {
  const btn = event.target.closest("[data-metric]");
  if (!btn) return;
  hourlyChartMetric = btn.dataset.metric;
  document.querySelectorAll("#hourlyMetricSwitcher button").forEach(b => b.classList.toggle("active", b === btn));
  renderHourlyChart();
});

let coastalResizeTimer;
window.addEventListener("resize", () => {
  sizeMapStage();
  drawRadar();
  // The coastal charts pick their viewBox from the viewport width.
  clearTimeout(coastalResizeTimer);
  coastalResizeTimer = setTimeout(() => { if (coastalState?.isCoastal) renderCoastal(); }, 180);
});

renderLayers();
renderCoastal();   // placeholder until the first refresh resolves the marine sources
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
