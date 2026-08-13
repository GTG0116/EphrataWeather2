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
// `base` overrides the default raw.githubusercontent path when a repo publishes
// its rendered frames through GitHub Pages instead.
const SATELLITE_SOURCES = [
  { id: "goes19fd",    label: "GOES-19 Full Disk", note: "Atlantic / Americas",   repo: "goes19fulldisk",    base: "https://gtg0116.github.io/goes19fulldisk/site/data",
                                                                                                             extent: [-156,    6, -81, 81], sectorScheme: "goes",     proj: "platecarree" },
  { id: "goes19conus", label: "GOES-19 CONUS",     note: "Continental U.S.",      repo: "Satellite",         extent: [-135,  -60,  20, 55], sectorScheme: "goes",     proj: "platecarree" },
  { id: "goes19meso1", label: "GOES-19 Meso 1",    note: "Rapid-scan mesoscale sector 1", rawOnly: true,       extent: [-140,  -50,  10, 65], sectorScheme: null,       proj: "geostationary" },
  { id: "goes19meso2", label: "GOES-19 Meso 2",    note: "Rapid-scan mesoscale sector 2", rawOnly: true,       extent: [-140,  -50,  10, 65], sectorScheme: null,       proj: "geostationary" },
  { id: "goes18",      label: "GOES-18 Full Disk", note: "Pacific / NHC E-Pac",   repo: "Goes18satellite",   extent: [-220,  -55, -80, 80], sectorScheme: "goes18",   proj: "mercator"    },
  { id: "goes18meso1", label: "GOES-18 Meso 1",    note: "Rapid-scan mesoscale sector 1", rawOnly: true,       extent: [-180,  -90,  10, 65], sectorScheme: null,       proj: "geostationary" },
  { id: "goes18meso2", label: "GOES-18 Meso 2",    note: "Rapid-scan mesoscale sector 2", rawOnly: true,       extent: [-180,  -90,  10, 65], sectorScheme: null,       proj: "geostationary" },
  { id: "himawari",    label: "Himawari",          note: "W. Pacific / Typhoons", repo: "Himawari_Satellite",extent: [  80,  200, -60, 60], sectorScheme: "himawari", proj: "mercator"    },
  { id: "himawaritarget", label: "Himawari Target", note: "Rapid-scan steerable target sector", rawOnly: true, extent: [  90,  180, -50, 50], sectorScheme: null,       proj: "geostationary" },
];
// `sources` (when present) restricts a band to the feeds that publish it.
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

// Basemap labels are rendered inside Mapbox's WebGL canvas, so they do not
// inherit the page's CSS fonts. Manrope is the app's primary family and is a
// Mapbox-hosted glyph family; Arial Unicode keeps place names legible when
// Manrope does not include a character in the active map language.
const MAP_LABEL_FONT_STACKS = {
  regular: ["Manrope Regular", "Arial Unicode MS Regular"],
  medium:  ["Manrope Medium", "Arial Unicode MS Regular"],
  bold:    ["Manrope Bold", "Arial Unicode MS Bold"],
};
const DROUGHT_URLS = [
  "https://www.ncei.noaa.gov/pub/data/nidis/geojson/us/usdm/USDM-current.geojson",
  "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_Drought_Monitor/FeatureServer/0/query?where=1=1&outFields=DM&outSR=4326&f=geojson",
  "https://idpgis.ncep.noaa.gov/arcgis/rest/services/NWS_Climate_Outlooks/cpc_usdm/MapServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson",
];

// ─── MRMS Radar ───────────────────────────────────────────────────────────────
// Every product here is decoded in the browser from the NOAA MRMS bucket (see
// js/mrms.js); this table is only what the page has to say about each one —
// its name, the unit its readout prints, and how many decimals.
const MRMS_PRODUCTS = {
  rate:      { label: "Precip Type",     unit: "in/hr", dec: 2 },
  // Reflectivity's timeline runs past now: the on-device decoder appends
  // extrapolated frames after the observed ones, so the future radar lives
  // inside this product instead of being a separate thing to switch to.
  refl:      { label: "Reflectivity",    unit: "dBZ",   dec: 0, nowcast: true },
  mesh:      { label: "Hail (MESH)",     unit: "in",    dec: 2 },
  qpe6h:     { label: "6-Hr Precip",     unit: "in",    dec: 2 },
  qpe24h:    { label: "24-Hr Precip",    unit: "in",    dec: 2 },
  lightning: { label: "Lightning Prob",  unit: "%",     dec: 0 },
  rotation:  { label: "Azimuthal Shear", unit: "s⁻¹",   dec: 3 },
};

const MRMS_LEGENDS = {
  // Three ramps, one per precipitation type — the colours and the rates they
  // span mirror PRECIP_TYPE_BANDS in js/mrms.js, which is what actually paints
  // the map. Snow and ice rates are liquid equivalent, as MRMS reports them.
  rate: {
    title: "PRECIP TYPE",
    sections: [
      {
        label: "RAIN (IN/HR)",
        gradient: "linear-gradient(90deg, #00ff9d 0%, #00d85f 20%, #1e8c00 40%, #ffff00 60%, #ff9b00 80%, #ff0000 100%)",
        ticks: ["0.01\"", "0.06\"", "0.41\"", "2.95\""],
      },
      {
        label: "FREEZING RAIN / SLEET (IN/HR)",
        gradient: "linear-gradient(90deg, #ff4dff 0%, #e000df 33%, #b000aa 67%, #7a0078 100%)",
        ticks: ["0.004\"", "0.05\"", "0.59\""],
      },
      {
        label: "SNOW (LIQUID IN/HR)",
        gradient: "linear-gradient(90deg, #00ffff 0%, #78f2ff 33%, #b6d5ff 67%, #d8d1ff 100%)",
        ticks: ["0.002\"", "0.025\"", "0.31\""],
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

// Open-Meteo occasionally carries a frozen-precipitation code through a warm
// frontal transition.  A code for freezing rain on an 80° afternoon is not
// useful forecast wording, so only retain the frozen type when the forecast
// air temperature is cold enough for it to be physically plausible.
const FREEZING_PRECIP_MAX_TEMP_F = 38;
const WARM_WEATHER_EQUIVALENTS = {
  48: 45, // freezing fog -> fog
  56: 51, // light freezing drizzle -> light drizzle
  57: 53, // freezing drizzle -> drizzle
  66: 61, // light freezing rain -> light rain
  67: 65, // heavy freezing rain -> heavy rain
};

function normalizeWmoWeatherCode(code, temperatureF = null) {
  if (code == null) return code;
  const numericCode = Number(code);
  if (!Number.isFinite(numericCode)) return code;
  const temp = Number(temperatureF);
  if (Number.isFinite(temp) && temp > FREEZING_PRECIP_MAX_TEMP_F) {
    return WARM_WEATHER_EQUIVALENTS[numericCode] ?? numericCode;
  }
  return numericCode;
}

const HIST_MIN_YEAR = 1940;
const HIST_ARCHIVE_DELAY = 5;
const SEASONAL_CENTER = [45, 48, 55, 63, 70, 76, 82, 80, 72, 62, 51, 45];

// ─── Fair Weather Index ────────────────────────────────────────────────────
// Rates conditions on a 0–100 scale based on temperature (seasonally adjusted),
// humidity, wind, cloud cover, and precipitation probability.
const FWI = (() => {
  const COMFORT_WINDOW = 8;
  // Each band carries several readings of the same verdict. The daily cards
  // print this sentence directly after the day's blurb, so a settled week of
  // identical scores used to end every card with the same five words. The
  // caller passes `variant` (the card's index) to walk the list — see
  // pickPhrase; a missing variant just takes the first, which is the wording
  // these bands have always used.
  const RATINGS = [
    { min: 83, label: "Excellent",     color: "#4CAF50", bg: "rgba(76,175,80,0.18)",
      sentences: ["A great day to be outside.", "Hard to ask for better weather than this.", "Take the long way home — it's lovely out.", "About as good as the outdoors gets.",
                  "Weather worth rearranging your day for.", "Nothing here to keep you indoors.", "A day that rewards being outside."] },
    { min: 65, label: "Good",          color: "#8BC34A", bg: "rgba(139,195,74,0.15)",
      sentences: ["Pleasant enough for most outdoor plans.", "Good weather for anything you had in mind.", "Comfortable out, with nothing to work around.", "An easy day to spend outside.",
                  "Agreeable weather, whatever you're up to.", "Solid conditions for being out and about.", "Outdoors holds up nicely today."] },
    { min: 45, label: "OK",            color: "#FFC107", bg: "rgba(255,193,7,0.18)",
      sentences: ["Workable outside, but you'll notice it.", "Fine out, with a few compromises.", "Passable weather — not the day you'd pick.", "Outdoor plans hold up, just barely.",
                  "Serviceable, if unremarkable.", "You can work with this, within reason.", "Middling out — nothing you can't manage."] },
    { min: 25, label: "Poor",          color: "#FF7043", bg: "rgba(255,112,67,0.2)",
      sentences: ["Rough going outside — plan around it.", "An unpleasant one to be out in for long.", "Outdoor plans are fighting the weather today.", "Not a day the outdoors is doing you any favours.",
                  "Hard work to be out in this.", "The weather is working against you today.", "Grim enough to shorten any outdoor plans."] },
    { min:  0, label: "Extremely Poor",color: "#EF5350", bg: "rgba(239,83,80,0.22)",
      sentences: ["Best day to stay indoors.", "Give this one a miss if you can.", "Nothing out there worth going out for.", "A day to let pass from behind a window.",
                  "Stay in — this one isn't worth it.", "There is no good reason to be outside today.", "Write this one off and stay put."] },
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
    if (cloud == null) return { pts: 9, max: 10 };
    const cover = clamp(Number(cloud), 0, 100);
    let pts;
    // Cloudiness alone should barely dent an otherwise pleasant day. Only a
    // nearly solid deck — where there is little or no usable sun — takes more
    // than two points. The steeper final segment still distinguishes truly
    // gloomy overcast from an ordinary mix of sun and clouds.
    if      (cover <= 60) pts = 10;
    else if (cover <= 80) pts = 10 - ((cover - 60) / 20);
    else if (cover <= 90) pts =  9 - ((cover - 80) / 10);
    else if (cover <= 97) pts =  8 - ((cover - 90) /  7) * 4;
    else                  pts =  4 - ((cover - 97) /  3) * 2;
    return { pts: clamp(pts, 0, 10), max: 10 };
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

  // The band label alone made for sentences that argued with the forecast next
  // to them — a 95°F afternoon can still score "Excellent" on the numbers, and
  // "a great day to be outside" is not what anyone wants to read under
  // "dangerously hot". So the sentence names whichever factor is actually
  // dragging the score down, and only falls back to the band when nothing in
  // particular stands out.
  // Three severities per factor — gentle, pointed, blunt — and several
  // phrasings of each, so a week-long heat wave doesn't caption every card
  // with the identical warning.
  const CAVEATS = {
    heat: [
      ["Warm out, but nothing a shady spot won't fix.", "Hot, though a bit of shade sorts it out.", "The warmth is the only real catch.", "Toasty, but perfectly manageable."],
      ["The heat is the catch — pace yourself and find shade.", "Hot enough to plan around; go early or late.", "The heat will set the pace of your day.", "Keep water handy and the heat is workable."],
      ["Too hot to be out in for long.", "Dangerous heat — keep outdoor time short.", "The heat alone is reason to stay in.", "Punishing heat; limit what you do outside."],
    ],
    cold: [
      ["Pleasant, as long as you dress for the cold.", "Fine out with the right layers on.", "Nice enough, once you're dressed for it.", "Good out, provided you're not underdressed."],
      ["Bundle up properly and it's fine out.", "Cold enough that layers aren't optional.", "The cold is the thing to plan around.", "Dress seriously and the cold is survivable."],
      ["Cold enough that outside is a chore.", "Bitter out — keep it brief.", "The cold makes anything outdoors hard work.", "Brutally cold; there's no dressing around it."],
    ],
    precip: [
      ["Mostly fine, though rain could interrupt.", "Decent out, with rain the one question mark.", "Fine apart from the chance of getting rained on.", "Good out, if you don't mind a shower."],
      ["Worth having a rain backup for outdoor plans.", "Rain is likely enough to need a plan B.", "Keep something indoors in reserve.", "Rain is likely — carry a jacket at minimum."],
      ["Wet enough to move plans indoors.", "The rain wins this one — head inside.", "Too wet to be worth the trouble.", "Soaking weather; save it for another day."],
    ],
    snow: [
      ["Fine out, though there's snow to deal with.", "Workable, snow aside.", "Not bad out — the snow is the catch.", "Decent enough, once you account for the snow."],
      ["Snow will complicate anything outdoors.", "The snow is what you'll be working around.", "Expect the snow to slow everything down.", "Allow extra time; the snow will cost you some."],
      ["Snow is reason enough to stay in.", "Let the snow pass before heading out.", "The snow makes this one a write-off.", "Heavy enough snow to stay off the roads."],
    ],
    wind: [
      ["Nice out, just breezy.", "Pleasant, if a touch windy.", "Good out — bring something windproof.", "Lovely, with a bit of a breeze on it."],
      ["The wind is the nuisance here.", "Windy enough to be annoying.", "The wind is what you'll notice.", "Expect the wind to be the story of the day."],
      ["The wind will make outside unpleasant.", "Wind strong enough to keep you in.", "Too windy to enjoy being out.", "The wind alone makes this one rough."],
    ],
    cloud: [
      ["Comfortable, if a little grey.", "Pleasant enough under the cloud.", "Fine out, just short on sun.", "Agreeable, sunshine aside."],
      ["Grey, but otherwise fine out.", "Overcast, though nothing worse than that.", "Dull overhead and nothing more.", "Flat grey skies, and little else to report."],
      ["Grey and gloomy all day.", "Relentlessly overcast.", "No sign of the sun today.", "Solid cloud, start to finish."],
    ],
    humidity: [
      ["Comfortable, though the air is heavy.", "Pleasant, if a bit close.", "Fine out — the air just sits on you.", "Nice enough, with a bit of weight to the air."],
      ["Muggy enough to slow you down.", "The humidity is what you'll feel first.", "Sticky enough to be work.", "The mugginess takes the edge off an otherwise fine day."],
      ["Oppressively muggy — take it easy.", "The air is thick; go easy out there.", "Humidity heavy enough to stay in for.", "Swampy out; don't push it."],
    ],
  };

  // Ranked by points lost outright, not by share of each factor's own maximum:
  // humidity can only ever cost 10 points, so a merely muggy day would
  // otherwise out-rank a genuinely dangerous 95°F one that cost 14. A factor
  // has to cost real points before it's worth naming; below that the band's own
  // sentence describes the day better.
  // Each factor's own bar, set where the summary beside it would start
  // mentioning the same thing — the precipitation bar sits at 15 because that's
  // a >20% chance, the point where the day's blurb starts naming rain. Without
  // that alignment the card could read "Sunny and hot" next to "rain could
  // interrupt".
  const CAVEAT_MIN_POINTS = { temp: 8, precip: 15, wind: 8, cloud: 7, humidity: 6 };
  // Tiebreak order for equal point losses — cloud and humidity can each cost at
  // most 10, so they tie often, and "a little grey" belongs on a cloudy day
  // ahead of "the air is heavy".
  const CAVEAT_PRIORITY = ["precip", "temp", "wind", "cloud", "humidity"];

  // `wet` is null, "precip" or "snow" — see wetKindOf.
  function caveatFor(breakdown, feelsLike, month, wet) {
    // A period whose own weather code says rain or storms gets the rain caveat
    // regardless of the probability — Open-Meteo can report scattered
    // convection with a low areal chance, and "a little grey" under
    // "Thunderstorms from 3 PM to 6 PM" reads as a contradiction.
    if (wet) return { lines: CAVEATS[wet] || CAVEATS.precip, floor: 0 };
    const ranked = Object.keys(breakdown)
      .map(key => ({ key, lost: breakdown[key].max - breakdown[key].pts }))
      .filter(f => f.lost >= CAVEAT_MIN_POINTS[f.key])
      .sort((a, b) => (b.lost - a.lost) || (CAVEAT_PRIORITY.indexOf(a.key) - CAVEAT_PRIORITY.indexOf(b.key)));

    for (const factor of ranked) {
      if (factor.key !== "temp") {
        return CAVEATS[factor.key] ? { lines: CAVEATS[factor.key], floor: 0 } : null;
      }
      // The temperature score is seasonal, so a 65°F July day in Fairbanks
      // scores as far below normal — true, but "dress for the cold" next to
      // "mild" is not. Talking about heat or cold requires actual heat or cold;
      // otherwise the next factor gets its turn.
      if (feelsLike == null) continue;
      const hot = feelsLike >= SEASONAL_CENTER[month];
      // `floor` keeps the wording honest when the rest of the day is lovely:
      // 94°F scores well enough to earn the gentlest line, but "warm out" is
      // not what 94°F deserves.
      if (hot && feelsLike >= 85) {
        return { lines: CAVEATS.heat, floor: feelsLike >= 100 ? 2 : feelsLike >= 92 ? 1 : 0 };
      }
      if (!hot && feelsLike <= 45) {
        return { lines: CAVEATS.cold, floor: feelsLike <= 15 ? 2 : feelsLike <= 32 ? 1 : 0 };
      }
    }
    return null;
  }

  function calculate({ temp, humidity, wind, gust, cloudCover, precipChance, month, weatherCode, condition, variant = 0 }) {
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
    const breakdown = { temp: t, humidity: h, wind: w, cloud: c, precip: p };

    const caveat = caveatFor(breakdown, temp, m, wetKindOf(weatherCode, condition));
    // Pick the caveat's severity from the score, so the same limiting factor
    // reads gently at 80 and bluntly at 30 — but never softer than the factor
    // itself demands.
    const sentence = caveat
      ? pickPhrase(caveat.lines[Math.max(caveat.floor, score100 >= 65 ? 0 : score100 >= 40 ? 1 : 2)], "fwiCaveat", variant)
      : pickPhrase(rating.sentences, "fwiBand", variant);

    return { score100, ...rating, sentence, breakdown };
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
    status: "Live forecast",
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

// Sky gradients for the animated canvas background — one clean linear-gradient
// (top to bottom) per real condition bucket, independent of the coarser 4-way
// accent theme above.
//
// Every cloud-bearing bucket also gets a "…Night" twin. Rain at 2 a.m. is not
// the same scene as rain at 2 p.m., and painting the daytime overcast grey
// after dark left the whole app looking washed out and lit-from-nowhere while
// the icons had already switched to their night glyphs. The night twins keep
// the same hue relationship as their daytime siblings — just carried down into
// near-black — so the scene stays recognisably "rain" or "fog" while reading
// unambiguously as night.
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
  overcastNight: ["#05080e", "#0c111a", "#151c27", "#1e2734"],
  rainNight: ["#04070d", "#0a1018", "#111a24", "#18232f"],
  stormNight: ["#02040a", "#070b13", "#0d131d", "#131b26"],
  snowNight: ["#080d16", "#111927", "#1c2637", "#2a3549"],
  fogNight: ["#080b10", "#12161d", "#1c222a", "#272e38"],
};

// "rainNight" → "rain". Particle counts, cloud tints and every per-bucket
// special case reason about the weather; only the palette knows about the hour.
const SKY_NIGHT_BUCKETS = ["overcast", "rain", "storm", "snow", "fog"];
function baseSky(bucket) {
  return bucket === "clearNight" ? bucket : String(bucket || "").replace(/Night$/, "");
}
function isNightSky(bucket) {
  return bucket === "clearNight" || /Night$/.test(String(bucket || ""));
}

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

// Is it currently night / near-twilight where the selected location is?
// Both the sky bucket and the accent theme need the answer, and they used to
// work it out separately — which is how the app ended up in "sunny" mode at
// midnight whenever it happened to be raining.
function skyDaylight() {
  const now = new Date();
  if (currentSunrise && currentSunset) {
    const nowMs = now.getTime(), riseMs = currentSunrise.getTime(), setMs = currentSunset.getTime();
    const night = nowMs < riseMs || nowMs > setMs;
    return { night, sunset: !night && (nowMs > setMs - 60 * 60 * 1000 || nowMs < riseMs + 30 * 60 * 1000) };
  }
  const hour = localHour(now);
  const night = hour >= 20 || hour <= 5;
  return { night, sunset: !night && hour >= 17 };
}

// Determine which animated-sky bucket a real observation maps to:
// precipitation/fog/storm text wins outright, otherwise clear/cloudy
// conditions are split further by day, night, or near-sunset/sunrise light.
function computeSkyBucket(current) {
  const text = `${current.condition || ""}`.toLowerCase();
  const { night, sunset } = skyDaylight();
  // Weather buckets keep their identity after dark and pick up the night
  // palette instead of being replaced by a generic dark sky.
  const shade = bucket => (night && SKY_NIGHT_BUCKETS.includes(bucket)) ? `${bucket}Night` : bucket;

  if (text.includes("thunder") || text.includes("storm")) return shade("storm");
  if (text.includes("snow") || text.includes("sleet") || text.includes("ice") || text.includes("wintry")) return shade("snow");
  if (text.includes("fog") || text.includes("mist") || text.includes("haze")) return shade("fog");
  if (text.includes("rain") || text.includes("shower") || text.includes("drizzle")) return shade("rain");
  if (text.includes("overcast") || (text.includes("cloud") && !text.includes("partly"))) return shade("overcast");
  if (sunset) return "sunset";
  if (night) return "clearNight";
  if (text.includes("partly") || text.includes("mostly clear") || text.includes("mostly sunny")) return "partly";
  return "clearDay";
}

// Per-bucket particle/scene state for the animated sky canvas — rebuilt only
// when the bucket changes (not every frame).
let skyScene = { drops: [], flakes: [], stars: [], clouds: [], fogBanks: [], flash: { next: 0, on: 0, x: 0.5 } };
function skyRnd(a, b) { return a + Math.random() * (b - a); }
function buildSkyScene(rawBucket) {
  const bucket = baseSky(rawBucket);
  const night = isNightSky(rawBucket);
  const heavy = bucket === "storm";
  // Fewer, depth-varied particles read as weather rather than a screen-space
  // texture and keep the canvas calm behind text-heavy cards.
  const rainN = bucket === "rain" ? 250 : heavy ? 380 : bucket === "fog" ? 24 : 0;
  const drops = Array.from({ length: rainN }, () => ({
    x: Math.random(), y: Math.random(), l: skyRnd(0.03, 0.085), s: skyRnd(0.55, 1.05),
    w: skyRnd(0.65, 1.45), a: skyRnd(0.16, 0.48), depth: skyRnd(0.72, 1.18),
  }));
  const flakes = bucket === "snow" ? Array.from({ length: 190 }, () => ({
    x: Math.random(), y: Math.random(), r: skyRnd(0.9, 3.1), s: skyRnd(0.03, 0.09),
    ph: Math.random() * 9, sw: skyRnd(0.004, 0.016), a: skyRnd(0.35, 0.95),
  })) : [];
  // A clear night is all stars; a broken/foggy night gets a sparse, dim field
  // that the cloud and fog layers largely cover, which keeps the scene dark
  // without looking like the sky was simply switched off.
  const starN = bucket === "clearNight" ? 240 : (night && (bucket === "rain" || bucket === "snow" || bucket === "fog") ? 70 : 0);
  const starDim = bucket === "clearNight" ? 1 : 0.45;
  const stars = Array.from({ length: starN }, () => ({
    x: Math.random(), y: Math.random() * 0.82, r: skyRnd(0.4, 1.5), ph: Math.random() * 9,
    a: skyRnd(0.3, 1) * starDim, twinkle: skyRnd(0.45, 1.05),
  }));
  const n = { clearDay: 3, partly: 7, overcast: 11, rain: 9, storm: 10, snow: 8, fog: 5, sunset: 6, clearNight: 3 }[bucket] || 0;
  const lowDeck = bucket === "overcast" || bucket === "storm" || bucket === "rain";
  const clouds = Array.from({ length: n }, () => ({
    x: Math.random(), y: skyRnd(0.05, lowDeck ? 0.5 : 0.42), w: skyRnd(0.28, 0.72), h: skyRnd(0.07, 0.19),
    s: skyRnd(0.004, 0.016) * (bucket === "storm" ? 2.2 : 1), a: skyRnd(0.1, 0.3), shape: skyRnd(0, Math.PI * 2),
  }));
  const fogBanks = (bucket === "fog" || bucket === "snow" || bucket === "overcast")
    ? Array.from({ length: bucket === "fog" ? 7 : 3 }, () => ({
        y: skyRnd(0.3, 1), h: skyRnd(0.14, 0.4), s: skyRnd(0.006, 0.022), a: skyRnd(0.1, 0.3), x: Math.random(),
      }))
    : [];
  skyScene = { drops, flakes, stars, clouds, fogBanks, flash: { next: skyT + skyRnd(1.5, 5), on: 0, x: 0.5, bolt: [] } };
}
buildSkyScene(skyBucket);
let radarActive = true;
let radarLatestResetKey = null;
// MRMS is the only radar source exposed by the app. Keeping this explicit also
// migrates browsers that previously saved the removed single-site mode.
let activeRadarMode = "mrms";
let selectedRadarSite = (localStorage.getItem("radarSite") || "").toUpperCase();
let radarSiteMarkers = [];
let activeOverlays = new Set();
let radarSlot = 0; // 0="a" or 1="b" for double-buffer animation
let radarFrameTransitionTimer = null;
let futureRadarPanTimer = null;
let activeSpcType = "cat";   // cat | torn | wind | hail | prob
let activeSpcDay  = 1;       // 1-8
let activeWpcDay  = 1;       // 1-5
let activeFireDay = 1;       // 1 or 2
let activeBasemap = (() => {
  const saved = localStorage.getItem("weatherBasemap");
  return BASEMAP_STYLES.some(s => s.id === saved) ? saved : "dark-v11";
})();

// ─── Map customization ───────────────────────────────────────────────────────
// Everything the Settings panel can change about how the map itself draws.
// Values are validated on load so an old or hand-edited localStorage entry
// can't put the map into a state the UI has no control for.
const MAP_SETTING_SPECS = {
  coastlines:        { type: "toggle", default: true,     label: "Coastlines",        note: "Outline the land/water edge so offshore storms are unmistakable" },
  countyBorders:     { type: "toggle", default: true,     label: "County borders",    note: "The lines warnings and zone forecasts are drawn on" },
  stateBorders:      { type: "toggle", default: true,     label: "State borders",     note: "" },
  countryBorders:    { type: "toggle", default: true,     label: "Country borders",   note: "" },
  placeLabels:       { type: "toggle", default: true,     label: "Place names",       note: "" },
  legend:            { type: "toggle", default: true,     label: "Show legend",       note: "" },
  scrubber:          { type: "toggle", default: true,     label: "Bottom time slider",note: "" },
  alertBorders:      { type: "choice", default: "normal", label: "Alert border weight",
                       options: [["normal", "Normal"], ["bold", "Bold"], ["max", "Maximum"]] },
  animationSpeed:    { type: "choice", default: "normal", label: "Animation speed",
                       options: [["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"]] },
  reduceAnimations:  { type: "toggle", default: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true,
                       label: "Reduce animations", note: "Minimize interface, weather-scene, and map motion" },
};

// Alert outlines used to default to "Bold". Every saved settings object carries
// a value for every key, so a browser that had ever changed any map setting kept
// the old default forever — this drops that one stored value once, so the new
// default reaches people who never chose bold deliberately. Picking Bold again
// sticks: the flag is written whether or not anything was changed.
const ALERT_BORDER_DEFAULT_MIGRATION = "mapSettingsAlertBorderNormalDefault";
let mapSettings = (() => {
  const resolved = {};
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("mapSettings") || "{}") || {}; } catch {}
  try {
    if (!localStorage.getItem(ALERT_BORDER_DEFAULT_MIGRATION)) {
      localStorage.setItem(ALERT_BORDER_DEFAULT_MIGRATION, "1");
      if (saved.alertBorders === "bold") delete saved.alertBorders;
    }
  } catch {}
  for (const [key, spec] of Object.entries(MAP_SETTING_SPECS)) {
    const value = saved[key];
    if (spec.type === "toggle") resolved[key] = typeof value === "boolean" ? value : spec.default;
    else resolved[key] = spec.options.some(([id]) => id === value) ? value : spec.default;
  }
  return resolved;
})();

document.documentElement.classList.toggle("reduce-motion", mapSettings.reduceAnimations);

function saveMapSettings() {
  try { localStorage.setItem("mapSettings", JSON.stringify(mapSettings)); } catch {}
}

// Alert outlines are already deliberately heavy; this scales the whole
// halo/casing/line stack together so "Normal" is still readable.
const ALERT_BORDER_SCALE = { normal: 0.62, bold: 1, max: 1.45 };

// Playback interval for the frame animation.
const ANIMATION_SPEED_MS = { slow: 1100, normal: RADAR_FRAME_MS, fast: 380 };
function radarFrameDelay() {
  return ANIMATION_SPEED_MS[mapSettings.animationSpeed] ?? RADAR_FRAME_MS;
}
function mapMotionMs(duration) {
  return mapSettings.reduceAnimations ? 0 : duration;
}
let activeSatelliteType = "geocolor";
let activeSatelliteSource = (() => {
  const saved = localStorage.getItem("satelliteSource");
  return SATELLITE_SOURCES.some(s => s.id === saved) ? saved : "goes19conus";
})();
let satelliteActive = false;
let satFrames = [];               // e.g. [9,8,…,1,0]; value = file index, 0 = newest
let satFrameIndex = 0;            // pointer into satFrames; latest = last element
const satFrameCountCache = {};    // cacheKey → detected frame count
let activeSatelliteSector = null; // null = full disk, else a TC sector id
const satSectorCache = {};        // sourceId → array of normalized sector objects
const satWarpCache = new Map();   // frameKey → equirect→Mercator warped data URL
let cycloneData = null;           // cached {storms:[…]} across all feeds
let renderedSatelliteSequence = 0;
let hourlyChartMetric = "temperature";
let frame = 0;
let weatherState = fallbackWeather;
let mapState = {};
let currentMetricGuide = [];
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
let glmLayerData = null;
let glmFetchedAt = 0;
let glmLoadSequence = 0;
let glmRefreshTimer = null;
let glmAbortController = null;
let glmLoaderPromise = null;
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
let alertPanRefreshQueued = false;  // camera moved again while a refresh was resolving
let alertLoadSequence = 0;          // invalidates stale async alert loads after redraws/toggles
let activeAlertFilter = (() => {
  const saved = localStorage.getItem("alertKindFilter");
  return ["priority", "all", "warning", "watch", "advisory"].includes(saved) ? saved : "priority";
})();
let spcPopupWired = false;
let droughtPopupWired = false;
let radarAnimationTimer;
let radarFrameIndex = 0;
let radarFrames = [];
const WEATHER_LAYER_OPACITY_KEY = "weatherLayerOpacity";

function loadWeatherLayerOpacity() {
  try {
    const saved = Number(localStorage.getItem(WEATHER_LAYER_OPACITY_KEY));
    if (Number.isFinite(saved) && saved >= 10 && saved <= 100) return saved / 100;
  } catch {}
  return 0.78;
}

let radarOpacity = loadWeatherLayerOpacity();
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
// Mapbox writes this straight onto the popup element, so it is what actually
// bounds a popup's width. Phones get the viewport minus a margin instead of a
// fixed pixel box that used to run off the side of a narrow screen.
const POPUP_MAX_WIDTH = "min(330px, calc(100vw - 28px))";
let alertPopupRegistry = new Map(); // popupId → alert features array (for _viewAlertFromMapFeature)
let activeUnifiedPopup = null;
let activeUnifiedPopupNav = null;
let alertPopupCounter = 0;
const ON_DEVICE_RADAR_PRODUCTS = {
  nexrad_ref: { label: "Reflectivity", unit: "dBZ", dec: 0 },
  nexrad_vel: { label: "Velocity", unit: "kt", dec: 0 },
  nexrad_sw:  { label: "Spectrum Width", unit: "mph", dec: 0 },
  nexrad_rho: { label: "Correlation Coeff.", unit: "ρHV", dec: 2 },
  nexrad_zdr: { label: "Differential Reflectivity", unit: "dB", dec: 1 },
  nexrad_phi: { label: "Differential Phase", unit: "°", dec: 0 },
  nexrad_kdp: { label: "Specific Differential Phase", unit: "°/km", dec: 1 },
};
const ON_DEVICE_RADAR_LEGENDS = {
  nexrad_ref: { title: "NEXRAD REFLECTIVITY", gradient: "linear-gradient(90deg,#a6b698,#30431f,#ffff0a,#ff8200,#ff0800,#be0000,#fccef0,#984be2,#3a1a00)", ticks: ["5", "25", "45", "65", "85 dBZ"] },
  nexrad_vel: { title: "NEXRAD VELOCITY", gradient: "linear-gradient(90deg,#ff40ff,#5400ce,#0076ec,#00ec46,#949894,#bc0000,#ff7ebe,#ff9e26,#801c00)", ticks: ["−120", "−60", "0", "60", "120 kt"] },
  nexrad_sw:  { title: "SPECTRUM WIDTH", gradient: "linear-gradient(90deg,#00003c,#0078ff,#00dc78,#e6e600,#ff7800,#ff0000)", ticks: ["0", "10", "20", "35", "45 mph"] },
  nexrad_rho: { title: "CORRELATION COEFFICIENT", gradient: "linear-gradient(90deg,#323232,#969696,#4646d7,#00c8c8,#3cdc50,#f0f000,#ff6400,#ff0000,#ff91e1)", ticks: ["0.2", "0.5", "0.8", "0.95", "1.0"] },
  nexrad_zdr: { title: "DIFFERENTIAL REFLECTIVITY", gradient: "linear-gradient(90deg,#3c3c3c,#0000b4,#00a0a0,#00c800,#e6e600,#ff7800,#ff0000,#ff00ff)", ticks: ["−4", "0", "2", "4", "8 dB"] },
  nexrad_phi: { title: "DIFFERENTIAL PHASE", gradient: "linear-gradient(90deg,#14143c,#0078dc,#00c878,#e6dc00,#ff7800,#ff0000)", ticks: ["0°", "90°", "180°", "270°", "360°"] },
  nexrad_kdp: { title: "SPECIFIC DIFFERENTIAL PHASE", gradient: "linear-gradient(90deg,#484848,#5c3473,#7a001c,#be3e80,#1c497e,#00dc28,#e9e600,#dc3700,#822d00)", ticks: ["−2", "0", "2", "4", "7 °/km"] },
};
let activeMrmsProduct = (() => {
  const saved = localStorage.getItem("mrmsProduct");
  return MRMS_PRODUCTS[saved] ? saved : "rate";
})();
let onDeviceWeatherApi = null;
let onDeviceWeatherPromise = null;
let onDeviceRadarFrameInfo = [];
let onDeviceSatelliteFrameInfo = [];
let onDeviceRadarSite = null;
let lastAutoFittedSatelliteFrame = null;

// Precipitation type is a banded field — three colour ramps, one per type —
// rather than one ramp over one range, so it gets its own legend and takes no
// user colour table.
function isPrecipTypeProduct(product = activeMrmsProduct) {
  return activeRadarMode === "mrms" && product === "rate";
}

// Which MRMS product extends its own timeline into the future.
function mrmsProductHasNowcast(product = activeMrmsProduct) {
  return activeRadarMode === "mrms" && Boolean(MRMS_PRODUCTS[product]?.nowcast);
}

function getOnDeviceWeather() {
  if (!onDeviceWeatherPromise) {
    onDeviceWeatherPromise = import("./js/on-device-weather.js")
      .then(api => {
        onDeviceWeatherApi = api;
        api.setOpacity(radarOpacity);
        restoreRadarPalettes(api);
        return api;
      });
  }
  return onDeviceWeatherPromise;
}

function decodedFrameLabel(frame, site = "") {
  const raw = frame?.time;
  const date = raw instanceof Date ? raw : raw ? new Date(raw) : null;
  const time = date && Number.isFinite(date.getTime())
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : frame?.label || "Latest";
  // Storm motion and confidence live in the legend, so the scrubber label stays
  // short enough to read at a glance: how far ahead, and when that is.
  if (frame?.forecast) return `+${Number(frame.leadMinutes) || 0} min · ${time}`;
  return site ? `${site} · ${time}` : time;
}

function handleOnDeviceStatus(status) {
  if (status.kind === "radar" && (satelliteActive || !radarActive)) return;
  if (status.kind === "satellite" && !satelliteActive) return;
  if (status.phase === "ready") return;
  const pct = Number.isFinite(status.progress) ? ` ${Math.round(status.progress * 100)}%` : "";
  setFrameTimeLabel(`${status.detail || status.phase}${pct}`);
}

function handleOnDeviceFrame(event) {
  if (event.kind === "radar" && (
    satelliteActive ||
    !radarActive ||
    (event.mode && event.mode !== activeRadarMode) ||
    (event.productKey && event.productKey !== activeMrmsProduct)
  )) return;
  if (event.kind === "satellite" && !satelliteActive) return;
  if (event.kind === "radar") {
    onDeviceRadarFrameInfo = event.frames || [];
    onDeviceRadarSite = event.site || null;
    if (activeRadarMode === "single" && onDeviceRadarSite?.id) {
      selectedRadarSite = onDeviceRadarSite.id;
      localStorage.setItem("radarSite", selectedRadarSite);
      updateRadarSiteMarkerSelection();
    }
    radarFrames = onDeviceRadarFrameInfo.map((_, index) => index);
    radarFrameIndex = event.index;
    // Satellite owns the shared timeline while it is visible. A slower radar
    // decode must not overwrite the satellite's max/value after it has loaded.
    if (!satelliteActive) {
      syncFrameSliders({
        max: Math.max(0, radarFrames.length - 1),
        value: radarFrameIndex,
        disabled: radarFrames.length < 2,
      });
      setPlayButtonsEnabled(radarFrames.length >= 2);
    }
  } else {
    onDeviceSatelliteFrameInfo = event.frames || [];
    const mapElement = document.querySelector("#radarMap");
    if (mapElement && event.frame) {
      mapElement.dataset.satelliteFrame = JSON.stringify(event.frame);
    }
    if (
      event.frame?.key &&
      event.frame.key !== lastAutoFittedSatelliteFrame &&
      (activeSatelliteSource.includes("meso") || activeSatelliteSource === "himawaritarget") &&
      Array.isArray(event.frame.bbox) &&
      event.frame.bbox.length === 4
    ) {
      lastAutoFittedSatelliteFrame = event.frame.key;
      const [west, south, east, north] = event.frame.bbox.map(Number);
      if ([west, south, east, north].every(Number.isFinite)) {
        requestAnimationFrame(() => fitSatelliteExtent([west, east, south, north], 54));
      }
    }
    satFrames = onDeviceSatelliteFrameInfo.map((_, index) => index);
    satFrameIndex = event.index;
    if (satelliteActive) {
      syncFrameSliders({
        max: Math.max(0, satFrames.length - 1),
        value: satFrameIndex,
        disabled: satFrames.length < 2,
      });
      setPlayButtonsEnabled(satFrames.length >= 2);
    }
  }
  updateRadarLabel();
  // A different frame means a different number under the sight.
  refreshInspectReadout();
  // The radar legend reports the extrapolation's state (building, movement,
  // confidence), which changes as frames are appended and as the user scrubs
  // between observed and forecast frames.
  if (event.kind === "radar" && !satelliteActive) renderMrmsLegend();
}

function clearRadarSiteMarkers() {
  radarSiteMarkers.forEach(({ marker }) => marker.remove());
  radarSiteMarkers = [];
}

function updateRadarSiteMarkerSelection() {
  radarSiteMarkers.forEach(({ id, element }) => {
    const active = id === selectedRadarSite;
    element.classList.toggle("active", active);
    element.setAttribute("aria-pressed", String(active));
  });
}

async function syncRadarSiteMarkers() {
  if (!radarMap || !mapLoaded || activeRadarMode !== "single" || !radarActive) {
    clearRadarSiteMarkers();
    return;
  }
  const api = await getOnDeviceWeather();
  if (activeRadarMode !== "single" || !radarMap || !mapLoaded) return;
  if (radarSiteMarkers.length) {
    updateRadarSiteMarkerSelection();
    return;
  }
  radarSiteMarkers = api.radarSites().map(site => {
    // Mapbox owns the wrapper's transform. Keeping hover/active styling on a
    // child prevents CSS from replacing Mapbox's translate while the camera is
    // moving, which previously made the pills drift and then snap back.
    const markerElement = document.createElement("div");
    markerElement.className = "radar-site-marker";
    const element = document.createElement("button");
    element.type = "button";
    element.className = "radar-site-pill";
    element.textContent = site.id;
    element.title = `${site.id} · ${site.name}`;
    element.setAttribute("aria-label", `Use radar ${site.id}, ${site.name}`);
    element.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      selectedRadarSite = site.id;
      localStorage.setItem("radarSite", selectedRadarSite);
      updateRadarSiteMarkerSelection();
      drawRadar(false);
    });
    markerElement.appendChild(element);
    const marker = new mapboxgl.Marker({ element: markerElement, anchor: "center" })
      .setLngLat([site.lon, site.lat])
      .addTo(radarMap);
    return { id: site.id, element, marker };
  });
  updateRadarSiteMarkerSelection();
}

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

// ─── Per-quantity unit overrides ─────────────────────────────────────────────
// The system toggle sets everything at once; Settings can then pin an
// individual quantity ("metric, but keep wind in knots"). "auto" means follow
// the system toggle, which itself follows the location when unset.
const UNIT_KINDS = {
  temp:     { label: "Temperature",  imperial: "f",    metric: "c",    options: [["f", "°F"], ["c", "°C"]] },
  wind:     { label: "Wind speed",   imperial: "mph",  metric: "kmh",  options: [["mph", "mph"], ["kmh", "km/h"], ["kt", "kt"], ["ms", "m/s"]] },
  precip:   { label: "Precipitation",imperial: "in",   metric: "mm",   options: [["in", "in"], ["mm", "mm"]] },
  pressure: { label: "Pressure",     imperial: "inhg", metric: "hpa",  options: [["inhg", "inHg"], ["hpa", "hPa"]] },
  distance: { label: "Distance",     imperial: "mi",   metric: "km",   options: [["mi", "mi"], ["km", "km"]] },
  height:   { label: "Wave & tide",  imperial: "ft",   metric: "m",    options: [["ft", "ft"], ["m", "m"]] },
};

let unitPrefs = (() => {
  const defaults = Object.fromEntries(Object.keys(UNIT_KINDS).map(kind => [kind, "auto"]));
  try {
    const saved = JSON.parse(localStorage.getItem("unitPrefs") || "{}");
    for (const kind of Object.keys(UNIT_KINDS)) {
      const value = saved?.[kind];
      if (value && UNIT_KINDS[kind].options.some(([id]) => id === value)) defaults[kind] = value;
    }
  } catch {}
  return defaults;
})();

function saveUnitPrefs() {
  try { localStorage.setItem("unitPrefs", JSON.stringify(unitPrefs)); } catch {}
}

// The unit actually in force for a quantity, resolving "auto" through the
// system toggle.
function unitChoice(kind) {
  const pref = unitPrefs[kind];
  const spec = UNIT_KINDS[kind];
  if (pref && pref !== "auto") return pref;
  return isMetric() ? spec.metric : spec.imperial;
}

// Convert a stored imperial value into the active display unit.
function uTemp(valueF)      { return valueF == null ? null : (unitChoice("temp") === "c" ? (valueF - 32) * 5 / 9 : valueF); }
function uVis(valueMi)      { return valueMi == null ? null : (unitChoice("distance") === "km" ? valueMi * 1.609344 : valueMi); }
function uPrecip(valueIn)   { return valueIn == null ? null : (unitChoice("precip") === "mm" ? valueIn * 25.4 : valueIn); }
function uPressure(valInHg) { return valInHg == null ? null : (unitChoice("pressure") === "hpa" ? valInHg * 33.8639 : valInHg); }

const WIND_FACTORS = { mph: 1, kmh: 1.609344, kt: 0.868976, ms: 0.44704 };
function uWind(valueMph) {
  return valueMph == null ? null : valueMph * (WIND_FACTORS[unitChoice("wind")] ?? 1);
}

function tempUnit()   { return unitChoice("temp") === "c" ? "°C" : "°F"; }
function windUnit()   { return { mph: "mph", kmh: "km/h", kt: "kt", ms: "m/s" }[unitChoice("wind")]; }
function visUnit()    { return unitChoice("distance") === "km" ? "km" : "mi"; }
function precipUnit() { return unitChoice("precip") === "mm" ? "mm" : "in"; }
function pressUnit()  { return unitChoice("pressure") === "hpa" ? "hPa" : "inHg"; }

// Display formatters: converted, rounded, with optional unit suffix.
function uTempNum(valueF) { const v = uTemp(valueF); return v == null ? "--" : String(Math.round(v)); }
function fmtTemp(valueF)  { const v = uTemp(valueF); return v == null ? `--${tempUnit()}` : `${Math.round(v)}${tempUnit()}`; }
function fmtWind(valueMph){
  const v = uWind(valueMph);
  if (v == null) return "--";
  // Whole units read fine everywhere except m/s, where 1 unit is a big step.
  return `${unitChoice("wind") === "ms" ? v.toFixed(1) : Math.round(v)} ${windUnit()}`;
}
function fmtVis(valueMi)  { const v = uVis(valueMi); return v == null ? "--" : `${v.toFixed(1)} ${visUnit()}`; }
function fmtPressure(valInHg) {
  const v = uPressure(valInHg);
  if (v == null) return "--";
  return unitChoice("pressure") === "hpa" ? `${Math.round(v)} ${pressUnit()}` : `${v.toFixed(2)} ${pressUnit()}`;
}
function fmtPrecip(valueIn, digits) {
  const v = uPrecip(valueIn);
  if (v == null) return "--";
  const d = digits != null ? digits : (unitChoice("precip") === "mm" ? 1 : 2);
  return `${v.toFixed(d)} ${precipUnit()}`;
}
function fmtSnow(valueIn, digits = 1) {
  if (valueIn == null) return "--";
  return unitChoice("precip") === "mm"
    ? `${(valueIn * 2.54).toFixed(digits)} cm`
    : `${valueIn.toFixed(digits)} in`;
}

// Wave, swell and tide heights are carried in feet internally: NOAA CO-OPS and
// the NWS surf products both publish feet, so metres are converted on arrival.
function uHeight(valueFt)  { return valueFt == null ? null : (unitChoice("height") === "m" ? valueFt * 0.3048 : valueFt); }
function heightUnit()      { return unitChoice("height") === "m" ? "m" : "ft"; }
function fmtHeight(valueFt, digits = 1) {
  const v = uHeight(valueFt);
  return v == null ? "--" : `${v.toFixed(digits)} ${heightUnit()}`;
}

function updateUnitToggleLabel() {
  // The toggle's two halves are literally °F and °C, so it tracks the
  // temperature unit actually in force rather than the system flag — a
  // Settings override on temperature has to show here too.
  const celsius = unitChoice("temp") === "c";
  document.querySelectorAll("#unitToggle .unit-opt").forEach(el => {
    el.classList.toggle("active", (el.dataset.system === "metric") === celsius);
  });
  const btn = document.querySelector("#unitToggle");
  if (btn) btn.setAttribute("aria-label", `Units: ${celsius ? "metric (°C)" : "imperial (°F)"}. Tap to switch.`);
}

// Re-skin every units-bearing view in place (no network refetch).
function rerenderUnits() {
  updateUnitToggleLabel();
  syncScaleControlUnit();
  if (weatherState) {
    renderCurrent();
    renderDaily();
    renderMapSidebar();
    renderMetar(weatherState.aviation || null);
  }
  if (coastalState) renderCoastal();
  if (histSelectedDate) renderClimate(histSelectedDate);
}

/* ============================================================================
   SETTINGS PANEL
   One dialog for the two things a user actually wants to pin down: which units
   every reading is shown in, and how the map draws itself. Both write straight
   to localStorage and re-render in place — nothing here refetches data.
============================================================================ */
const settingsModal = document.querySelector("#settingsModal");
const settingsBody = document.querySelector("#settingsBody");

function settingsChoiceRow({ label, note, name, value, options }) {
  return `
    <div class="settings-row">
      <div class="settings-row-text">
        <span class="settings-row-label">${safeText(label)}</span>
        ${note ? `<span class="settings-row-note">${safeText(note)}</span>` : ""}
      </div>
      <div class="settings-choice" role="group" aria-label="${safeText(label)}">
        ${options.map(([id, optionLabel]) => `
          <button type="button" class="${id === value ? "active" : ""}"
            data-setting="${safeText(name)}" data-value="${safeText(id)}"
            aria-pressed="${id === value}">${safeText(optionLabel)}</button>
        `).join("")}
      </div>
    </div>`;
}

function settingsToggleRow({ label, note, name, on }) {
  return `
    <div class="settings-row">
      <div class="settings-row-text">
        <span class="settings-row-label">${safeText(label)}</span>
        ${note ? `<span class="settings-row-note">${safeText(note)}</span>` : ""}
      </div>
      <button type="button" class="settings-switch${on ? " on" : ""}"
        data-map-toggle="${safeText(name)}" role="switch" aria-checked="${on}"
        aria-label="${safeText(label)}"><span class="settings-switch-knob"></span></button>
    </div>`;
}

function renderSettingsPanel() {
  if (!settingsBody) return;
  const unitRows = Object.entries(UNIT_KINDS).map(([kind, spec]) => settingsChoiceRow({
    label: spec.label,
    // "Auto" is the interesting case, so spell out what it currently resolves to.
    note: unitPrefs[kind] === "auto"
      ? `Following ${isMetric() ? "metric" : "imperial"} (${spec.options.find(([id]) => id === unitChoice(kind))?.[1] || ""})`
      : "",
    name: `unit:${kind}`,
    value: unitPrefs[kind],
    options: [["auto", "Auto"], ...spec.options],
  })).join("");

  const mapRows = Object.entries(MAP_SETTING_SPECS).map(([key, spec]) => (
    spec.type === "toggle"
      ? settingsToggleRow({ label: spec.label, note: spec.note, name: key, on: mapSettings[key] })
      : settingsChoiceRow({ label: spec.label, note: spec.note || "", name: `map:${key}`, value: mapSettings[key], options: spec.options })
  )).join("");

  const favoriteRows = favoriteLocations.length
    ? `<div class="settings-favorites">
        ${favoriteLocations.map((item, index) => `
          <div class="settings-favorite">
            <span>${safeText(item.name)}</span>
            <button type="button" data-remove-favorite="${index}" aria-label="Remove ${safeText(item.name)} from favorites">Remove</button>
          </div>`).join("")}
      </div>`
    : `<p class="settings-empty">No favorites yet — tap the star beside a town in the search box to save it.</p>`;

  settingsBody.innerHTML = `
    <section class="settings-section">
      <h3>Measurement units</h3>
      <p class="settings-section-note">
        The system switch in the header sets everything at once. Pin an individual
        quantity here to override it.
      </p>
      ${settingsChoiceRow({
        label: "Unit system",
        note: unitSystem ? "" : "Auto follows the selected location's country",
        name: "unitSystem",
        value: unitSystem || "auto",
        options: [["auto", "Auto"], ["imperial", "Imperial"], ["metric", "Metric"]],
      })}
      ${unitRows}
    </section>
    <section class="settings-section">
      <h3>Map</h3>
      <div class="settings-row settings-row-stack">
        <div class="settings-row-text">
          <span class="settings-row-label">Basemap style</span>
        </div>
        <div class="settings-choice settings-choice-wrap" role="group" aria-label="Basemap style">
          ${BASEMAP_STYLES.map(style => `
            <button type="button" class="${style.id === activeBasemap ? "active" : ""}"
              data-setting="basemap" data-value="${safeText(style.id)}"
              aria-pressed="${style.id === activeBasemap}">${safeText(style.label)}</button>
          `).join("")}
        </div>
      </div>
      ${mapRows}
    </section>
    <section class="settings-section">
      <h3>Favorite locations</h3>
      ${favoriteRows}
    </section>
  `;
}

function openSettings() {
  if (!settingsModal) return;
  renderSettingsPanel();
  settingsModal.hidden = false;
  document.documentElement.classList.add("modal-open");
  document.body.classList.add("modal-open");
}

function closeSettings() {
  if (!settingsModal || settingsModal.hidden) return;
  settingsModal.hidden = true;
  // The detail modal uses the same page lock, so only release it when nothing
  // else is open.
  if (detailModal?.hidden !== false) {
    document.documentElement.classList.remove("modal-open");
    document.body.classList.remove("modal-open");
  }
}

// A single delegated handler covers every control in the panel.
function handleSettingsClick(event) {
  const removeFavorite = event.target.closest("[data-remove-favorite]");
  if (removeFavorite) {
    favoriteLocations.splice(Number(removeFavorite.dataset.removeFavorite), 1);
    saveFavoriteLocations();
    renderSettingsPanel();
    return;
  }

  const toggle = event.target.closest("[data-map-toggle]");
  if (toggle) {
    const key = toggle.dataset.mapToggle;
    mapSettings[key] = !mapSettings[key];
    saveMapSettings();
    renderSettingsPanel();
    applyMapSettings();
    return;
  }

  const choice = event.target.closest("[data-setting]");
  if (!choice) return;
  const { setting, value } = choice.dataset;

  if (setting === "unitSystem") {
    unitSystem = value === "auto" ? null : value;
    if (unitSystem) localStorage.setItem("unitSystem", unitSystem);
    else localStorage.removeItem("unitSystem");
    renderSettingsPanel();
    rerenderUnits();
    return;
  }

  if (setting.startsWith("unit:")) {
    unitPrefs[setting.slice(5)] = value;
    saveUnitPrefs();
    renderSettingsPanel();
    rerenderUnits();
    return;
  }

  if (setting.startsWith("map:")) {
    mapSettings[setting.slice(4)] = value;
    saveMapSettings();
    renderSettingsPanel();
    applyMapSettings();
    // A speed change should take effect on a loop that is already running.
    if (setting === "map:animationSpeed" && radarAnimationTimer) animateRadarLayer();
    return;
  }

  if (setting === "basemap") {
    setBasemap(value);
    renderSettingsPanel();
  }
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

function wmoDescription(code, temperatureF = null) {
  return WMO_CODES[normalizeWmoWeatherCode(code, temperatureF)] || "Unknown";
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

const PRODUCT_GUIDES = {
  "forecast-tags": {
    eyebrow: "Forecast Card Guide",
    title: "Forecast tags, products, and risk levels",
    summary: "The icon tells you which outlook product the tag belongs to. The abbreviation tells you the risk level. These outlooks describe potential; they are not active warnings.",
    rows: [
      ["Triangle icon · Severe storms", "The Storm Prediction Center (SPC) Convective Outlook maps the chance of organized severe thunderstorms, including damaging wind, large hail, and tornadoes.", "A triangle beside a risk abbreviation means the tag is about severe thunderstorms—not flooding.", "severe"],
      ["Rain-cloud icon · Flooding", "The Weather Prediction Center (WPC) Excessive Rainfall Outlook maps the chance that rainfall will exceed local flash-flood guidance.", "A rain cloud beside a risk abbreviation means the tag is about excessive rain and flash flooding—not the SPC severe-storm risk.", "flood"],
      ["FWI", "The Fair Weather Index is this app's 0–100 outdoor-comfort score, calculated from temperature, humidity, wind, clouds, and precipitation.", "Higher scores generally mean more comfortable weather for ordinary outdoor plans. It is not an official NWS hazard product.", "fwi"],
      ["TSTM · SPC only", "TSTM is the SPC general-thunderstorm category and has no matching WPC rainfall level.", "Thunderstorms are possible, but SPC has not assigned an organized severe-weather risk at this location.", "severe"],
      ["MRGL · Marginal", "MRGL is the lowest risk level used by both the SPC severe-storm outlook and WPC excessive-rainfall outlook.", "Triangle: isolated severe storms are possible. Rain cloud: isolated flash flooding is possible.", "both"],
      ["SLGT · Slight", "SLGT is the second risk level used by both SPC and WPC.", "Triangle: scattered severe storms are possible. Rain cloud: scattered flash flooding is possible, generally with a better-defined heavy-rain threat.", "both"],
      ["ENH · Enhanced · SPC only", "ENH is an SPC severe-weather category; WPC does not use an Enhanced level in its excessive-rainfall outlook.", "Numerous severe storms are possible, and the threat is more concentrated or substantial than a Slight risk.", "severe"],
      ["MDT · Moderate", "MDT is a high-end risk level used by both SPC and WPC.", "Triangle: widespread severe storms are likely. Rain cloud: numerous flash floods are likely, with some potentially significant.", "both"],
      ["HIGH", "HIGH is the highest risk level used by both SPC and WPC and is issued only for exceptional situations.", "Triangle: a major severe-weather outbreak is expected. Rain cloud: widespread, potentially catastrophic flash flooding is expected.", "both"],
    ],
  },
  "coastal-guide": {
    eyebrow: "Coastal Product Guide",
    title: "How to read the coastal section",
    summary: "The views separate what is happening now from tides, wave guidance, and official NWS text products.",
    rows: [
      ["Rip Current Risk", "An NWS surf-zone product that assesses the chance of dangerous currents pulling swimmers away from shore; where unavailable, the app displays a clearly labeled model estimate.", "Low does not mean no risk. Moderate or High means swimmers should use guarded beaches and follow local beach guidance."],
      ["Sea State", "A snapshot combining current or near-current wave height, period, swell, water temperature, and modeled ocean current near the selected point.", "It describes how rough and energetic the water is now; higher waves or longer-period swell can make surf more powerful."],
      ["Tides", "NOAA CO-OPS astronomical tide predictions plus a live water-level gauge when one is available.", "Predictions show expected high and low tides. Actual water can run above or below them because of wind, pressure, and storm surge."],
      ["Wave Forecast", "Open-Meteo marine-model guidance for significant wave height, swell, direction, and period.", "It shows the expected sea trend, but it is model guidance rather than a direct buoy observation."],
      ["NWS Outlooks", "Official NWS surf-zone and coastal-waters text forecasts from the local forecast office.", "These provide local hazards and context that a single wave number cannot capture."],
    ],
  },
  "aviation-guide": {
    eyebrow: "Aviation Product Guide",
    title: "How to read the flying section",
    summary: "Each view serves a different planning question. None replaces an official flight briefing, NOTAM review, or pilot judgment.",
    rows: [
      ["Current Flight", "A decoded NWS/FAA surface observation from the nearest suitable aviation station.", "It describes observed ceiling, visibility, wind, temperature, sky cover, and pressure at that station—not necessarily conditions along an entire route."],
      ["Forecast", "An 18-hour aviation screen derived from the selected location's official NWS hourly forecast for U.S. locations.", "It highlights hours when ceiling, visibility, or wind may move conditions from VFR toward IFR."],
      ["Drone", "A weather-only small-UAS planning screen using wind, gust, visibility, precipitation, and thunderstorms.", "Favorable, Caution, or Poor summarizes weather limitations only; it is not a legal flight authorization or aircraft-specific go/no-go decision."],
      ["Space Weather", "NOAA SWPC measurements and outlooks for solar and geomagnetic activity.", "Elevated activity can affect radio and satellite navigation and can make aurora visible farther from the poles."],
    ],
  },
  metar: {
    eyebrow: "Aviation Observation",
    title: "METAR and flight rules",
    summary: "A METAR is a standardized airport weather observation, usually issued hourly and updated during significant changes.",
    rows: [
      ["METAR", "A standardized airport surface-weather observation, usually issued hourly and updated when conditions change significantly.", "It reports what was observed at one station; it is not a forecast."],
      ["VFR", "The Visual Flight Rules category based on observed ceiling and visibility.", "Ceiling is above 3,000 ft and visibility is greater than 5 statute miles."],
      ["MVFR", "The Marginal VFR category based on observed ceiling or visibility.", "Ceiling is 1,000–3,000 ft and/or visibility is 3–5 miles."],
      ["IFR", "The Instrument Flight Rules category based on observed ceiling or visibility.", "Ceiling is 500–999 ft and/or visibility is 1 to less than 3 miles."],
      ["LIFR", "The Low IFR category for the lowest ceiling or visibility conditions.", "Ceiling is below 500 ft and/or visibility is below 1 mile."],
    ],
  },
  "flight-categories": {
    eyebrow: "Forecast Guidance",
    title: "Forecast flight categories",
    summary: "Categories are calculated from NWS forecast ceiling and visibility when published. An “est.” tag means the category was inferred from forecast wording.",
    rows: [
      ["Flight category", "A compact aviation classification calculated from forecast ceiling and visibility; “est.” means it was inferred from forecast wording.", "VFR is least restrictive, followed by MVFR, IFR, and LIFR as ceiling or visibility worsens."],
      ["Ceiling", "The forecast height of the lowest broken or overcast cloud layer, not simply any cloud in the sky.", "A lower ceiling can change the displayed flight category and limit visual flight."],
      ["Visibility", "The forecast horizontal surface visibility at the selected location.", "Lower visibility can change the flight category even when the ceiling is high."],
      ["Wind", "The NWS forecast for sustained wind and gusts at the selected point.", "Local terrain and runway exposure can produce conditions different from the point forecast."],
    ],
  },
  "drone-guidance": {
    eyebrow: "Small UAS Guidance",
    title: "Drone weather suitability",
    summary: "This screen summarizes weather only. It does not know your aircraft limits, airspace authorization, nearby obstacles, or operational rules.",
    rows: [
      ["Drone suitability", "An app-generated weather screen based on forecast wind, gusts, visibility, ceiling, precipitation, and thunderstorms.", "It evaluates weather only and does not account for airspace, aircraft limits, obstacles, or regulations."],
      ["Favorable", "The lowest concern level in the app's drone-weather screen.", "No major weather threshold is evident in the available forecast fields."],
      ["Caution", "The middle concern level in the app's drone-weather screen.", "One or more conditions may challenge a small aircraft, such as stronger wind, lower visibility, or precipitation."],
      ["Poor", "The highest concern level in the app's drone-weather screen.", "The forecast contains weather that commonly makes small-UAS operations unsafe, including strong gusts or thunderstorms."],
    ],
  },
  "space-weather": {
    eyebrow: "NOAA SWPC",
    title: "Space weather products",
    summary: "Space weather describes solar and geomagnetic activity above Earth's atmosphere.",
    rows: [
      ["Kp Index", "A NOAA-reported 0–9 index of global geomagnetic disturbance.", "Higher values indicate a more disturbed magnetic field and can move aurora farther from the poles."],
      ["Solar Wind", "Measurements of charged particles flowing from the Sun near Earth.", "Higher speed and a favorable magnetic orientation can intensify geomagnetic activity."],
      ["Radio / Navigation", "NOAA space-weather scales and observations relevant to communications and satellite systems.", "Strong events can disrupt high-frequency radio and degrade satellite-navigation accuracy."],
    ],
  },
};

function showProductGuide(key) {
  const guide = PRODUCT_GUIDES[key];
  if (!guide) return;
  const guideIcon = type => {
    const severe = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2L2 22h20L12 2zm0 14.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-.75-5.5h1.5v5h-1.5V11z"/></svg>`;
    const flood = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9"/><path d="M8 18.5v2M12 17v2M16 18.5v2"/></svg>`;
    if (type === "severe") return `<span class="product-guide-icon severe">${severe}</span>`;
    if (type === "flood") return `<span class="product-guide-icon flood">${flood}</span>`;
    if (type === "both") return `<span class="product-guide-icons"><span class="product-guide-icon severe">${severe}</span><span class="product-guide-icon flood">${flood}</span></span>`;
    return "";
  };
  modalEyebrow.textContent = guide.eyebrow;
  modalTitle.textContent = guide.title;
  modalBody.innerHTML = `
    ${guide.summary ? `<p class="modal-summary">${safeText(guide.summary)}</p>` : ""}
    <div class="product-guide-list">
      ${guide.rows.map(([term, whatItIs, whatItMeans, symbol]) => `
        <article class="product-guide-item">
          <h3>${guideIcon(symbol)}<span>${safeText(term)}</span></h3>
          <div class="product-guide-explanations">
            <section class="product-guide-explanation product-guide-definition">
              <div class="product-guide-label"><span aria-hidden="true">i</span><strong>What it is</strong></div>
              <p>${safeText(whatItIs)}</p>
            </section>
            <section class="product-guide-explanation product-guide-meaning">
              <div class="product-guide-label"><span aria-hidden="true">→</span><strong>What it means</strong></div>
              <p>${safeText(whatItMeans || whatItIs)}</p>
            </section>
          </div>
        </article>`).join("")}
    </div>`;
  showDetailModal();
}

const CURRENT_METRIC_DEFINITIONS = {
  air: "Air quality summarizes common outdoor pollutants using the reported air-quality index and, when available, pollutant concentrations from Open-Meteo.",
  pollen: "Pollen is the predicted airborne concentration of major plant allergens near the selected location, supplied by Google Pollen.",
  uv: "The UV Index is a 0-and-up scale for the strength of sunburn-producing ultraviolet radiation at the surface.",
  dew: "Dew point is the temperature at which the air would become saturated. It is a direct measure of how much moisture is in the air.",
  humidity: "Relative humidity is how full the air is with water vapor compared with the maximum it could hold at the current temperature.",
  wind: "Wind is the sustained surface speed; gusts are brief increases above that sustained value. Local terrain and buildings can make either vary nearby.",
};

function showCurrentMetricGuide(index) {
  const [icon, name, value, whatItMeans] = currentMetricGuide[Number(index)] || [];
  if (!name) return;
  const whatItIs = CURRENT_METRIC_DEFINITIONS[icon] || `${name} is a current weather reading for the selected location.`;
  modalEyebrow.textContent = "Current Conditions Guide";
  modalTitle.textContent = name;
  modalBody.innerHTML = `
    <p class="modal-summary">Current value: <strong>${safeText(value)}</strong></p>
    <div class="product-guide-list">
      <article class="product-guide-item">
        <h3>${uiIcon(icon)}<span>${safeText(name)}</span></h3>
        <div class="product-guide-explanations">
          <section class="product-guide-explanation product-guide-definition">
            <div class="product-guide-label"><span aria-hidden="true">i</span><strong>What it is</strong></div>
            <p>${safeText(whatItIs)}</p>
          </section>
          <section class="product-guide-explanation product-guide-meaning">
            <div class="product-guide-label"><span aria-hidden="true">→</span><strong>What it means</strong></div>
            <p>${safeText(whatItMeans || "No interpretation is available for this reading.")}</p>
          </section>
        </div>
      </article>
    </div>`;
  showDetailModal();
}

function closeDetails() {
  if (detailModal.hidden) return;
  detailModal.hidden = true;
  document.documentElement.classList.remove("modal-open");
  document.body.classList.remove("modal-open");
  syncModalToVisualViewport();
}

// Magnus formula, for sources that report temperature and humidity but no dew
// point (NOAA CO-OPS shore stations).
function dewPointFrom(tempF, humidity) {
  const tempC = (tempF - 32) * 5 / 9;
  const gamma = Math.log(Math.max(1, Math.min(100, humidity)) / 100) + (17.625 * tempC) / (243.04 + tempC);
  return ((243.04 * gamma) / (17.625 - gamma)) * 9 / 5 + 32;
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
    weatherCode: hour.weatherCode,
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

// Forecast-day peak wind gust, preferring the selected provider's forecast
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

// The geocoder is asked for more results than the dropdown shows so a favorite
// that ranks anywhere in the top of the response can still be hoisted to the
// front — see mergeFavoritesIntoResults.
const LOCATION_SEARCH_COUNT = 10;
const LOCATION_SUGGESTION_LIMIT = 8;

async function searchLocations(query, count = LOCATION_SEARCH_COUNT) {
  const data = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=${count}&language=en&format=json`);
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

/* ============================================================================
   FAVORITE LOCATIONS
   Starred towns live in localStorage and drive the search dropdown two ways:
   an empty box lists them straight away, and a favorite that turns up anywhere
   in a search response is pulled to the top of the results.
============================================================================ */
const FAVORITE_LOCATIONS_KEY = "weatherFavoriteLocations";
const MAX_FAVORITE_LOCATIONS = 24;

// Coordinates come back from the geocoder at full precision but a town saved
// today and the same town returned tomorrow can differ in the last decimals, so
// identity is "same name, within ~1 km".
function favoriteKey(location) {
  if (!location) return "";
  const lat = Number(location.lat), lon = Number(location.lon);
  const rounded = Number.isFinite(lat) && Number.isFinite(lon)
    ? `${lat.toFixed(2)},${lon.toFixed(2)}`
    : "";
  return `${String(location.name || "").trim().toLowerCase()}|${rounded}`;
}

let favoriteLocations = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(FAVORITE_LOCATIONS_KEY) || "[]");
    return Array.isArray(saved)
      ? saved.filter(item => item && item.name && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)))
      : [];
  } catch {
    return [];
  }
})();

function saveFavoriteLocations() {
  try {
    localStorage.setItem(FAVORITE_LOCATIONS_KEY, JSON.stringify(favoriteLocations));
  } catch {}
}

function isFavoriteLocation(location) {
  const key = favoriteKey(location);
  return Boolean(key) && favoriteLocations.some(item => favoriteKey(item) === key);
}

// Returns the new starred state so the caller can update its button in place.
function toggleFavoriteLocation(location) {
  const key = favoriteKey(location);
  if (!key) return false;
  const index = favoriteLocations.findIndex(item => favoriteKey(item) === key);
  if (index >= 0) {
    favoriteLocations.splice(index, 1);
    saveFavoriteLocations();
    return false;
  }
  favoriteLocations.unshift({
    lat: Number(location.lat),
    lon: Number(location.lon),
    name: location.name,
    timezone: location.timezone || "auto",
    countryCode: location.countryCode || null,
  });
  favoriteLocations = favoriteLocations.slice(0, MAX_FAVORITE_LOCATIONS);
  saveFavoriteLocations();
  return true;
}

// Hoist any favorite that the geocoder returned to the front of the list,
// keeping the saved copy (it carries the timezone/country the user picked with)
// and preserving the order the favorites were starred in.
function mergeFavoritesIntoResults(results) {
  if (!favoriteLocations.length) return results.slice(0, LOCATION_SUGGESTION_LIMIT);
  const matchedKeys = new Set();
  const hoisted = [];
  for (const favorite of favoriteLocations) {
    const key = favoriteKey(favorite);
    if (results.some(result => favoriteKey(result) === key)) {
      matchedKeys.add(key);
      hoisted.push(favorite);
    }
  }
  const rest = results.filter(result => !matchedKeys.has(favoriteKey(result)));
  return hoisted.concat(rest).slice(0, LOCATION_SUGGESTION_LIMIT);
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
    const popup = new mapboxgl.Popup({ offset: 12, maxWidth: POPUP_MAX_WIDTH }).setHTML(`
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
      if (radarMap) radarMap.flyTo({ center: [loc.lon, loc.lat], zoom: Math.max(radarMap.getZoom(), 9), duration: mapMotionMs(900) });
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Find Me"; }
  }
}

const FAVORITE_STAR_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><polygon points="12 3 14.9 9.1 21.5 10 16.7 14.7 17.9 21.3 12 18.2 6.1 21.3 7.3 14.7 2.5 10 9.1 9.1"/></svg>`;

// `heading` labels the list when it is showing saved favorites rather than
// geocoder results, so an empty search box doesn't look like a stale response.
function renderLocationSuggestions(results, { heading = "" } = {}) {
  locationSuggestionResults = results;
  if (!results.length) {
    locationSuggestions.hidden = true;
    locationSuggestions.innerHTML = "";
    return;
  }
  const rows = results.map((item, index) => {
    const starred = isFavoriteLocation(item);
    return `
    <div class="location-suggestion${starred ? " is-favorite" : ""}">
      <button type="button" role="option" class="location-suggestion-pick" data-suggestion-index="${index}">
        <strong>${safeText(townName(item))}</strong>
        <span>${safeText(item.name.replace(`${townName(item)}, `, ""))}</span>
      </button>
      <button type="button" class="location-favorite-btn${starred ? " active" : ""}"
        data-favorite-index="${index}"
        aria-pressed="${starred}"
        title="${starred ? "Remove from favorites" : "Save as favorite"}"
        aria-label="${starred ? `Remove ${safeText(townName(item))} from favorites` : `Save ${safeText(townName(item))} as a favorite`}">
        ${FAVORITE_STAR_SVG}
      </button>
    </div>`;
  }).join("");
  locationSuggestions.innerHTML =
    (heading ? `<p class="location-suggestion-heading">${safeText(heading)}</p>` : "") + rows;
  locationSuggestions.hidden = false;
}

// Favorites list shown when the search box is empty. With nothing starred yet
// this renders an empty list, which hides the dropdown.
function showFavoriteSuggestions() {
  renderLocationSuggestions(
    favoriteLocations.slice(0, LOCATION_SUGGESTION_LIMIT),
    { heading: "Favorites" },
  );
}

function hideLocationSuggestions() {
  locationSuggestions.hidden = true;
}

async function chooseLocation(location) {
  selectedLocation = { ...location };
  nwsAlertPolygonData = null;
  alertFetchBox = null;
  suppressNextAlertNotifications = true;
  setLocationBrand();
  locationInput.value = selectedLocation.name;
  hideLocationSuggestions();
  if (radarMap) {
    radarMap.flyTo({ center: [selectedLocation.lon, selectedLocation.lat], zoom: Math.max(radarMap.getZoom(), 8), duration: mapMotionMs(900) });
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

// ─── Alert colors ────────────────────────────────────────────────────────────
// Two tables feed every alert swatch, popup chip and map polygon:
//
//   PRIORITY_ALERT_FILLS — the handful of headline events the map promotes by
//     default. These are deliberately chosen, high-contrast hues that read at a
//     glance against dark radar, so they are NOT replaced by the official
//     palette (weather.gov paints several of them in near-identical pinks).
//   NWS_GOV_ALERT_FILLS — the official weather.gov watch/warning/advisory
//     colors (https://www.weather.gov/help-map), used for every other event so
//     an alert on this map matches the one on the NWS map.
//
// Anything the tables miss still falls back to a severity color rather than
// disappearing from the overlay.

function hexToRgb(hex) {
  const value = String(hex).replace("#", "");
  const full = value.length === 3 ? value.split("").map(c => c + c).join("") : value;
  const int = parseInt(full, 16);
  return Number.isFinite(int) ? [(int >> 16) & 255, (int >> 8) & 255, int & 255] : [148, 163, 184];
}

function rgbToHex(r, g, b) {
  const clampByte = v => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[r, g, b].map(v => clampByte(v).toString(16).padStart(2, "0")).join("")}`;
}

function hexLuminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Outline color for a fill. Several official colors are already very light
// (moccasin, pale goldenrod), so brightening them uniformly would erase the
// border — the outline moves *away* from the fill's own lightness instead.
function alertOutlineFor(fill) {
  const [r, g, b] = hexToRgb(fill);
  const target = hexLuminance(fill) > 0.6 ? 0 : 255;
  const mix = channel => channel + (target - channel) * 0.38;
  return rgbToHex(mix(r), mix(g), mix(b));
}

function alertColorPair(fill) {
  return { fill, line: alertOutlineFor(fill) };
}

// The priority events (DEFAULT_MAP_ALERT_EVENTS, what the map's "Priority"
// filter shows) that already had a deliberately chosen color keep it. Every
// other priority event had no color of its own — it fell through to a generic
// severity shade — so it picks up its official one along with everything else.
// Special Weather Statement is the one that deliberately changes: it is a
// priority event, and it moves onto weather.gov's moccasin.
const PRIORITY_ALERT_FILLS = {
  "tornado warning": "#dc2626",
  "tornado watch": "#a855f7",
  "severe thunderstorm warning": "#f97316",
  "severe thunderstorm watch": "#f59e0b",
  "flash flood warning": "#10b981",
  "snow squall warning": "#a78bfa",
  "winter storm warning": "#ec4899",
  "winter storm watch": "#3b82f6",
  "blizzard warning": "#ec4899",
};

// Official NWS alert colors, keyed by the exact product name NWS publishes.
const NWS_GOV_ALERT_FILLS = {
  "tsunami warning": "#fd6347",
  "tornado warning": "#ff0000",
  "extreme wind warning": "#ff8c00",
  "severe thunderstorm warning": "#ffa500",
  "flash flood warning": "#8b0000",
  "flash flood statement": "#8b0000",
  "severe weather statement": "#00ffff",
  "shelter in place warning": "#fa8072",
  "evacuation immediate": "#7fff00",
  "civil danger warning": "#ffb6c1",
  "nuclear power plant warning": "#4b0082",
  "radiological hazard warning": "#4b0082",
  "hazardous materials warning": "#4b0082",
  "fire warning": "#a0522d",
  "civil emergency message": "#ffb6c1",
  "law enforcement warning": "#c0c0c0",
  "storm surge warning": "#b524f7",
  "hurricane force wind warning": "#cd5c5c",
  "hurricane warning": "#dc143c",
  "typhoon warning": "#dc143c",
  "special marine warning": "#ffa500",
  "blizzard warning": "#ff4500",
  "snow squall warning": "#c71585",
  "ice storm warning": "#8b008b",
  "winter storm warning": "#ff69b4",
  "high wind warning": "#daa520",
  "tropical storm warning": "#b22222",
  "storm warning": "#9400d3",
  "tsunami advisory": "#d2691e",
  "tsunami watch": "#ff00ff",
  "avalanche warning": "#1e90ff",
  "earthquake warning": "#8b4513",
  "volcano warning": "#2f4f4f",
  "ashfall warning": "#a9a9a9",
  "coastal flood warning": "#228b22",
  "lakeshore flood warning": "#228b22",
  "flood warning": "#00ff00",
  "high surf warning": "#228b22",
  "dust storm warning": "#ffe4c4",
  "blowing dust warning": "#ffe4c4",
  "lake effect snow warning": "#008b8b",
  "excessive heat warning": "#c71585",
  "extreme heat warning": "#c71585",
  "tornado watch": "#ffff00",
  "severe thunderstorm watch": "#db7093",
  "flash flood watch": "#2e8b57",
  "gale warning": "#dda0dd",
  "flood statement": "#00ff00",
  "extreme cold warning": "#b0c4de",
  "wind chill warning": "#b0c4de",
  "freeze warning": "#483d8b",
  "red flag warning": "#ff1493",
  "storm surge watch": "#db7ff7",
  "hurricane watch": "#ff00ff",
  "hurricane force wind watch": "#9932cc",
  "typhoon watch": "#ff00ff",
  "tropical storm watch": "#f08080",
  "storm watch": "#ffe4b5",
  "hurricane local statement": "#ffe4b5",
  "typhoon local statement": "#ffe4b5",
  "tropical storm local statement": "#ffe4b5",
  "tropical depression local statement": "#ffe4b5",
  "avalanche advisory": "#cd853f",
  "winter weather advisory": "#7b68ee",
  "wind chill advisory": "#afeeee",
  "cold weather advisory": "#afeeee",
  "extreme cold watch": "#5f9ea0",
  "wind chill watch": "#5f9ea0",
  "heat advisory": "#ff7f50",
  "excessive heat watch": "#800000",
  "extreme heat watch": "#800000",
  "urban and small stream flood advisory": "#00ff7f",
  "small stream flood advisory": "#00ff7f",
  "arroyo and small stream flood advisory": "#00ff7f",
  "flood advisory": "#00ff7f",
  "hydrologic advisory": "#00ff7f",
  "lakeshore flood advisory": "#7cfc00",
  "coastal flood advisory": "#7cfc00",
  "high surf advisory": "#ba55d3",
  "heavy freezing spray warning": "#00bfff",
  "dense fog advisory": "#708090",
  "dense smoke advisory": "#f0e68c",
  "small craft advisory": "#d8bfd8",
  "small craft advisory for hazardous seas": "#d8bfd8",
  "small craft advisory for winds": "#d8bfd8",
  "small craft advisory for rough bar": "#d8bfd8",
  "brisk wind advisory": "#d8bfd8",
  "hazardous seas warning": "#d8bfd8",
  "dust advisory": "#bdb76b",
  "blowing dust advisory": "#bdb76b",
  "lake wind advisory": "#d2b48c",
  "wind advisory": "#d2b48c",
  "frost advisory": "#6495ed",
  "ashfall advisory": "#696969",
  "freezing fog advisory": "#008080",
  "freezing spray advisory": "#00bfff",
  "freezing rain advisory": "#7b68ee",
  "ice accretion advisory": "#7b68ee",
  "low water advisory": "#a52a2a",
  "local area emergency": "#c0c0c0",
  "avalanche watch": "#f4a460",
  "blizzard watch": "#adff2f",
  "rip current statement": "#40e0d0",
  "beach hazards statement": "#40e0d0",
  "gale watch": "#ffc0cb",
  "winter storm watch": "#4682b4",
  "hazardous seas watch": "#483d8b",
  "heavy freezing spray watch": "#bc8f8f",
  "coastal flood watch": "#66cdaa",
  "lakeshore flood watch": "#66cdaa",
  "flood watch": "#2e8b57",
  "high wind watch": "#b8860b",
  "freeze watch": "#00ffff",
  "fire weather watch": "#ffdead",
  "extreme fire danger": "#e9967a",
  "911 telephone outage": "#c0c0c0",
  "coastal flood statement": "#6b8e23",
  "lakeshore flood statement": "#6b8e23",
  "special weather statement": "#ffe4b5",
  "marine weather statement": "#ffdab9",
  "air quality alert": "#808080",
  "air stagnation advisory": "#808080",
  "hazardous weather outlook": "#eee8aa",
  "hydrologic outlook": "#90ee90",
  "short term forecast": "#98fb98",
  "administrative message": "#c0c0c0",
  "test": "#f0ffff",
  "child abduction emergency": "#ffffff",
  "blue alert": "#ffffff",
  "hard freeze warning": "#9400d3",
  "hard freeze watch": "#4169e1",
  "mud and debris flow warning": "#8b4513",
  "mud/landslide warning": "#8b4513",
  "mud/landslide advisory": "#a0522d",
  "ice accretion warning": "#8b008b",
};

// IEM storm-based warning polygons are keyed by phenomenon code rather than a
// product name. Resolving each code through its event name keeps that layer on
// exactly the same palette as everything else.
const IEM_PHENOMENON_EVENTS = {
  TO: "Tornado Warning",
  SV: "Severe Thunderstorm Warning",
  FF: "Flash Flood Warning",
  SQ: "Snow Squall Warning",
  MA: "Special Marine Warning",
  // FA (Flood Advisory) intentionally excluded — not severe enough for map display
};

// Severity fallback so county/zone alerts without a dedicated event color
// still render on the alert overlay instead of being dropped.
const NWS_ALERT_SEVERITY_COLORS = {
  extreme: alertColorPair("#dc2626"),
  severe: alertColorPair("#f97316"),
  moderate: alertColorPair("#f59e0b"),
  minor: alertColorPair("#64748b"),
};

// Event names arrive from four feeds with different conventions (api.weather.gov
// "event", the WWA service's "prod_type", IEM's phenomenon expansion, and ECCC
// names translated to their NWS equivalent). Normalize before every lookup.
const alertColorCache = new Map();

function alertColorKey(event = "") {
  return String(event)
    .replace(/\s+/g, " ")
    .replace(/[.]/g, "")
    .trim()
    .toLowerCase();
}

// Exact match first, then longest suffix match so regional variants
// ("Small Craft Advisory for Winds", "Lake Wind Advisory") still land on the
// right product color instead of dropping to the severity fallback.
function alertFillFor(key, table) {
  if (table[key]) return table[key];
  let best = null;
  for (const name of Object.keys(table)) {
    if (!key.endsWith(name) && !key.startsWith(name)) continue;
    if (!best || name.length > best.length) best = name;
  }
  return best ? table[best] : null;
}

function nwsAlertColor(event = "", severity = "") {
  const key = alertColorKey(event);
  const cached = alertColorCache.get(key);
  if (cached) return cached;
  const fill = alertFillFor(key, PRIORITY_ALERT_FILLS) || alertFillFor(key, NWS_GOV_ALERT_FILLS);
  if (!fill) return NWS_ALERT_SEVERITY_COLORS[String(severity).toLowerCase()] || NWS_ALERT_SEVERITY_COLORS.minor;
  const pair = alertColorPair(fill);
  alertColorCache.set(key, pair);
  return pair;
}

// Single color lookup shared by US and Canadian alerts, the alert list, the
// detail modal and every map layer, so an event is the same color everywhere.
function alertEventColor(event = "", severity = "") {
  return nwsAlertColor(event, severity);
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
  return !!IEM_PHENOMENON_EVENTS[phenomenon];
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
    references: Array.isArray(p.references) ? p.references : [],
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
  if (alert.source === "ECCC") return ecccWarningTags(alert.event, alert.riskColor);
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

// Country codes are captured by every current search/GPS path. The state-name
// fallback keeps locations saved by older releases on the US provider without
// accidentally sending legacy international favorites to api.weather.gov.
const US_STATE_NAMES = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
  "connecticut", "delaware", "district of columbia", "florida", "georgia",
  "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky",
  "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota",
  "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire",
  "new jersey", "new mexico", "new york", "north carolina", "north dakota",
  "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island",
  "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont",
  "virginia", "washington", "west virginia", "wisconsin", "wyoming",
  "puerto rico", "guam", "american samoa", "u.s. virgin islands",
  "northern mariana islands",
]);
const US_STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI",
  "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN",
  "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
  "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY", "PR", "GU", "AS", "VI", "MP",
]);

function isUsLocation(location = selectedLocation) {
  const cc = String(location?.countryCode || "").toUpperCase();
  if (cc) return cc === "US";
  const parts = String(location?.name || "").split(",").map(part => part.trim()).filter(Boolean);
  const region = parts.at(-1) || "";
  return US_STATE_CODES.has(region.toUpperCase()) || US_STATE_NAMES.has(region.toLowerCase()) ||
    /\b(united states|usa)\b/i.test(location?.name || "");
}

function forecastProviderFor(location = selectedLocation) {
  if (isCanadianLocation(location)) return "ECCC";
  if (isUsLocation(location)) return "NWS";
  return "Open-Meteo";
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
  return isCanadianLocation(location) ? "ECCC" : "NWS";
}

function titleCaseAlertName(name = "") {
  return String(name).replace(/\w\S*/g, word => word.charAt(0).toUpperCase() + word.slice(1));
}

function ecccSeverity(p) {
  const colour = String(p.risk_colour_en || "").toLowerCase();
  if (colour === "red") return "Extreme";
  if (colour === "orange") return "Severe";
  if (colour === "yellow") return "Moderate";
  const type = String(p.alert_type || "").toLowerCase();
  if (type === "warning") return "Severe";
  if (type === "watch") return "Moderate";
  return "Minor";
}

const ECCC_WARNING_DAMAGE_LEVELS = {
  yellow: "Moderate",
  orange: "High",
  red: "Extreme",
};

function ecccRiskColor(value = "") {
  const color = String(value).trim().toLowerCase();
  return ECCC_WARNING_DAMAGE_LEVELS[color] ? color : "";
}

function isColorTieredEcccWarning(event = "") {
  return /\b(tornado|severe thunderstorm) warning\b/i.test(event);
}

function ecccWarningTags(event = "", riskColor = "") {
  const color = ecccRiskColor(riskColor);
  if (!color || !isColorTieredEcccWarning(event)) return [];
  return [titleCaseAlertName(color), `${ECCC_WARNING_DAMAGE_LEVELS[color]} damage`];
}

// The feed's id field embeds the publication batch, so the same alert gets a
// brand-new id every time ECCC republishes the collection — which re-fired
// foreground notifications for unchanged alerts. Build an id from fields that
// only change when the alert itself is reissued.
function ecccStableAlertId(p = {}) {
  return ["eccc", p.alert_code || p.alert_name_en || "alert",
    p.feature_name_en || "", p.validity_datetime || p.publication_datetime || ""].join("|");
}

// ECCC tornado and severe-thunderstorm warnings use color tiers in place of
// the NWS damage-threat wording. Preserve that tier so cards, notifications,
// map popups, and the details modal can all describe the same alert level.
function normalizeEcccAlert(feature) {
  const p = feature.properties || {};
  const event = titleCaseAlertName(p.alert_name_en || "Weather Alert");
  const riskColor = ecccRiskColor(p.risk_colour_en);
  const alert = {
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
    riskColor,
    damageThreat: isColorTieredEcccWarning(event) ? ECCC_WARNING_DAMAGE_LEVELS[riskColor] || "" : "",
    affectedZones: [],
  };
  const displayEvent = alertDisplayEvent(alert);
  alert.headline = p.feature_name_en ? `${displayEvent} for ${p.feature_name_en}` : displayEvent;
  alert.tags = tagsForAlert(alert);
  return alert;
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
async function alertsPayload(lat, lon, location = selectedLocation) {
  const canadian = isCanadianLocation(location);
  const [nwsResult, ecccResult] = await Promise.allSettled([
    canadian
      ? Promise.resolve({ features: [] })
      : getJson(`https://api.weather.gov/alerts/active?point=${lat},${lon}`),
    canadian
      ? ecccAlertsPayload(lat, lon)
      : Promise.resolve([]),
  ]);
  const nwsAlerts = nwsResult.status === "fulfilled"
    ? (nwsResult.value.features || []).map(normalizeNwsAlert)
    : [];
  const ecccAlerts = ecccResult.status === "fulfilled" ? ecccResult.value : [];
  const alerts = mergeAlerts(nwsAlerts, ecccAlerts).map(alert => ({
    ...alert,
    tags: alert.tags || tagsForAlert(alert),
  }));
  const sources = [
    !canadian && nwsResult.status === "fulfilled" && "NWS api.weather.gov alerts",
    canadian && ecccResult.status === "fulfilled" && "ECCC alerts",
  ].filter(Boolean);
  return {
    alerts,
    source: sources.join(" + ") || "Alerts unavailable",
  };
}

// ─── Plain-English forecast writing ─────────────────────────────────────────
// Everything below turns numbers into the kind of sentence a person would say
// out loud. The rule of thumb: lead with what someone actually needs to know
// (do I need a coat, will I get rained on), keep it to one or two short
// sentences, and never emit a phrase that sounds machine-assembled.

function headlineFor(condition, forecast) {
  const text = condition || forecast?.shortForecast || "Live weather";
  const name = townName();
  if (/thunder/i.test(text)) return `Storms are moving through ${name}.`;
  if (/freezing|sleet/i.test(text)) return "Ice is the thing to watch right now.";
  if (/snow/i.test(text)) return `Snow is falling over ${name}.`;
  if (/rain|shower|drizzle/i.test(text)) return "It's wet out there right now.";
  if (/fog/i.test(text)) return "Fog has settled in — give yourself extra time.";
  if (/clear|sunny|mainly clear/i.test(text)) return `Clear skies over ${name}.`;
  if (/partly/i.test(text)) return `A mix of sun and clouds over ${name}.`;
  if (/cloud|overcast/i.test(text)) return `Grey skies over ${name}.`;
  return `${text} over ${name} right now.`;
}

/* ============================================================================
   PHRASE VARIETY
   ----------------------------------------------------------------------------
   The forecast blurbs are assembled from a handful of sentence frames, so a
   settled week printed the same sentence seven times over — "Sunny and warm,
   topping out near 84°. Lows near 62°." on every card. Each frame now has
   several phrasings and picks between them here.

   The choice has to be deterministic: a unit toggle, a tab switch or a refresh
   re-renders every card, and wording that reshuffled on each pass would read as
   a glitch. It is keyed off the card's position in the list plus a hash of the
   frame's name, which gives two useful properties — consecutive days can never
   land on the same variant of the same frame (the index advances by one, the
   list is walked in order), and different frames within one summary start at
   different offsets instead of moving in lockstep.
   ========================================================================== */
function phraseHash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pickPhrase(list, salt, index = 0) {
  if (!list || !list.length) return null;
  return list[(phraseHash(salt) + (Number(index) || 0)) % list.length];
}

const capitalize = str => str ? `${str[0].toUpperCase()}${str.slice(1)}` : str;

// A word for how a temperature actually feels, used to open a sentence.
function temperatureFeel(tempF) {
  if (tempF == null) return null;
  if (tempF >= 95) return "dangerously hot";
  if (tempF >= 88) return "hot";
  if (tempF >= 78) return "warm";
  if (tempF >= 65) return "mild";
  if (tempF >= 50) return "cool";
  if (tempF >= 35) return "chilly";
  if (tempF >= 20) return "cold";
  return "bitterly cold";
}

// Plain-language sky wording, kept deliberately shorter and warmer than the
// raw WMO description ("Mainly clear" → "mostly sunny").
function skyPhrase(code, isDaytime = true) {
  const sun = isDaytime ? "sun" : "clear skies";
  if (code == null) return null;
  if (code >= 95) return "thunderstorms";
  if (code >= 85) return "snow showers";
  if (code >= 80) return "showers";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 66) return "freezing rain";
  if (code >= 61) return "rain";
  if (code >= 56) return "freezing drizzle";
  if (code >= 51) return "drizzle";
  if (code >= 45) return "fog";
  if (code === 3) return "clouds";
  if (code === 2) return isDaytime ? "a mix of sun and clouds" : "passing clouds";
  if (code === 1) return isDaytime ? "mostly sun" : "mostly clear skies";
  return isDaytime ? "full sun" : "clear skies";
}

// The adjectival form, for openers like "Cloudy and warm, topping out near 82°".
function skyAdjective(code, isDaytime = true) {
  if (code == null) return null;
  if (code >= 45 && code <= 48) return "Foggy";
  if (code === 3) return "Cloudy";
  // "Partly cloudy" is the idiomatic term after dark too — "partly clear" is not.
  if (code === 2) return "Partly cloudy";
  if (code === 1) return isDaytime ? "Mostly sunny" : "Mostly clear";
  if (code === 0) return isDaytime ? "Sunny" : "Clear";
  return null;
}

// Sky cover the station actually reported, as a percentage. METAR cloud layers
// are given in oktas by category, and the observation lists one entry per
// layer, so the densest layer sets the total cover.
const CLOUD_AMOUNT_PERCENT = {
  SKC: 0, CLR: 0, NCD: 0, NSC: 0,
  FEW: 19, SCT: 44, BKN: 75, OVC: 100, VV: 100, OVX: 100,
};

function observedCloudCover(observation) {
  const layers = observation?.properties?.cloudLayers;
  if (!Array.isArray(layers) || !layers.length) return null;
  let cover = null;
  for (const layer of layers) {
    const pct = CLOUD_AMOUNT_PERCENT[String(layer?.amount || "").toUpperCase()];
    if (pct == null) continue;
    cover = cover == null ? pct : Math.max(cover, pct);
  }
  return cover;
}

// Sky cover on a 0 (clear) to 3 (overcast) scale, so the station's plain-text
// report and the model's WMO code can be compared directly.
function skyCoverRank(code) {
  return code != null && code >= 0 && code <= 3 ? code : null;
}

function observedSkyRank(text) {
  if (!text) return null;
  if (/mostly cloudy|overcast|^cloudy/i.test(text)) return 3;
  if (/partly cloudy|partly sunny|scattered clouds/i.test(text)) return 2;
  if (/mostly clear|mostly sunny|few clouds/i.test(text)) return 1;
  if (/^(clear|fair|sunny)/i.test(text)) return 0;
  return null;
}

// Which CAVEATS entry a period's precipitation calls for: snow reads
// differently from rain, and "wet enough to move plans indoors" is the wrong
// sentence for a snowy day.
function wetKindOf(weatherCode, condition) {
  if (isWetCode(weatherCode)) return precipNoun(weatherCode) === "snow" ? "snow" : "precip";
  if (isWetCondition(condition)) return /snow|sleet|ice pellet/i.test(condition) ? "snow" : "precip";
  return null;
}

// Whether a plain-text condition report describes falling precipitation.
function isWetCondition(text) {
  return /rain|shower|drizzle|snow|sleet|thunder|storm|freezing|ice pellet/i.test(text || "");
}

// Codes 51 and up are falling precipitation. Fog (45) and freezing fog (48) sit
// below that on purpose: they obscure rather than fall, and treating them as
// wet had foggy days rendering as "Rain, with a high near…" — they belong on
// the sky branch, which calls them foggy.
function isWetCode(code) {
  return code != null && code >= 51;
}

// Which part of the day an hour falls in, for "rain moves in by late afternoon".
function dayPartLabel(date, tz) {
  const hour = Number(date.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: tz }));
  // Phrased to follow a verb cleanly: "rain moves in by afternoon".
  if (hour < 6) return "before dawn";
  if (hour < 10) return "by mid-morning";
  if (hour < 13) return "around midday";
  if (hour < 16) return "by afternoon";
  if (hour < 19) return "by late afternoon";
  if (hour < 23) return "by evening";
  return "overnight";
}

function precipNoun(code) {
  if (code == null) return "rain";
  if (code >= 95) return "storms";
  if (code >= 85 || (code >= 71 && code <= 77)) return "snow";
  if ((code >= 66 && code <= 67) || (code >= 56 && code <= 57)) return "freezing rain";
  return "rain";
}

// Likelihood expressed as a noun phrase — "scattered rain", "a stray shower" —
// rather than a bare percentage. The exact number is already on the chip below.
// A sky code is not the same thing as a dry forecast. When the model gives a
// strong chance of precipitation but leaves the WMO condition at "Overcast",
// make the likely wet period the visible forecast condition instead.
const LIKELY_PRECIP_CHANCE = 60;

function hasLikelyPrecipitation(pop) {
  const chance = Number(pop);
  return Number.isFinite(chance) && chance >= LIKELY_PRECIP_CHANCE;
}

function periodPrecipNoun(code, precipWindow = null) {
  const windowCode = precipWindow?.code;
  return precipNoun(isWetCode(windowCode) ? windowCode : code);
}

function precipitationChancePhrase(pop, noun = "rain") {
  const chance = Number(pop);
  const qualifier = chance >= 80 ? "high chance" : chance >= 60 ? "good chance" : "chance";
  return `a ${qualifier} of ${noun}`;
}

function forecastConditionDescription(code, pop, precipWindow = null) {
  if (isWetCode(code) || !hasLikelyPrecipitation(pop)) return wmoDescription(code);
  return `Chance of ${periodPrecipNoun(code, precipWindow)}`;
}

function precipPhrase(pop, noun = "rain") {
  if (pop == null) return null;
  if (pop >= 80) return `steady ${noun}`;
  if (pop >= 60) return `widespread ${noun}`;
  if (pop >= 40) return `scattered ${noun}`;
  if (pop >= 20) return noun === "storms" ? "an isolated storm" : `a stray bit of ${noun}`;
  return null;
}

// One warm sentence about what the rest of today holds, shown under the
// current conditions hero. Reads the next several hours rather than repeating
// the condition already printed right above it.
// Returns null when the series can't support it (an ECCC feed carries its own
// hand-written prose, which is better than anything assembled here), so callers
// can fall back.
function nowSummary(hours, tz = selectedLocation.timezone, observed = null) {
  const all = hours || [];
  // At night, stop at sunrise rather than running twelve hours into tomorrow —
  // "clear overnight, climbing to 88°" describes two different days at once.
  let span = 12;
  if (all[0] && !all[0].isDaytime) {
    const dawn = all.findIndex(h => h.isDaytime);
    if (dawn > 0) span = Math.max(4, Math.min(12, dawn));
  }
  const next = all.slice(0, span);
  if (!next.length || !next.some(h => h.weatherCode != null)) return null;

  const temps = next.map(h => h.temperature).filter(v => v != null);
  const nowTemp = temps[0];
  const peak = temps.length ? Math.max(...temps) : null;
  const trough = temps.length ? Math.min(...temps) : null;
  const window = next[0].isDaytime ? "through the rest of the day" : "through the night";

  const parts = [];
  const wetAt = next.findIndex(h => {
    const pop = h.probabilityOfPrecipitation?.value ?? 0;
    return (isWetCode(h.weatherCode) && pop >= PRECIP_HOUR_THRESHOLD) ||
      (!isWetCode(h.weatherCode) && hasLikelyPrecipitation(pop));
  });
  const wet = wetAt >= 0 ? next[wetAt] : null;
  // The station's own report wins for what is happening right now; the model
  // only gets to say what happens next.
  const observedWet = isWetCondition(observed);
  const observedObscured = /fog|mist|haze|smoke/i.test(observed || "");

  if (observedWet) {
    const noun = (observed || "precipitation").toLowerCase();
    // How long the wet stretch that's already underway lasts.
    let lastWet = -1;
    for (let i = 0; i < next.length; i++) {
      const pop = next[i].probabilityOfPrecipitation?.value ?? 0;
      if ((isWetCode(next[i].weatherCode) && pop >= PRECIP_HOUR_THRESHOLD) ||
          (!isWetCode(next[i].weatherCode) && hasLikelyPrecipitation(pop))) lastWet = i;
      else break;
    }
    const easesAt = lastWet >= 0 && lastWet < next.length - 1 ? clockLabel(next[lastWet].startTime, tz) : null;
    parts.push(easesAt
      ? `${noun[0].toUpperCase()}${noun.slice(1)} right now, easing off around ${easesAt}`
      : `${noun[0].toUpperCase()}${noun.slice(1)} right now and sticking around a while`);
  } else if (wet) {
    const noun = periodPrecipNoun(wet.weatherCode);
    const when = clockLabel(wet.startTime, tz) || dayPartLabel(new Date(wet.startTime), tz);
    if (isWetCode(wet.weatherCode) && hasLikelyPrecipitation(wet.probabilityOfPrecipitation?.value)) {
      parts.push(wetAt === 0
        ? `${noun[0].toUpperCase()}${noun.slice(1)} starting up now`
        : `${noun[0].toUpperCase()}${noun.slice(1)} moving in around ${when}`);
    } else {
      const chance = capitalize(precipitationChancePhrase(wet.probabilityOfPrecipitation?.value, noun));
      parts.push(wetAt === 0 ? `${chance} now` : `${chance} around ${when}`);
    }
  } else if (observedObscured) {
    parts.push(`${observed} right now, and quiet otherwise ${window}`);
  } else {
    // Describe the sky as a change from what the station is actually reporting,
    // so the hero never says "clear skies" while the observation says cloudy.
    const code = dominantWmoCode(next.map(h => h.weatherCode));
    const modelRank = skyCoverRank(code);
    const observedRank = observedSkyRank(observed);
    // Reworded from the rank rather than echoed verbatim, so a station's
    // "Partly Cloudy" and Open-Meteo's "Clear sky" both come out in the same
    // voice as everything else on the page.
    const observedAdjective = observedRank == null ? null : skyAdjective(observedRank, next[0].isDaytime);
    if (observedAdjective && modelRank != null && observedRank !== modelRank) {
      parts.push(`${observedAdjective} now, ${modelRank < observedRank ? "clearing out" : "clouding over"} ${window}`);
    } else if (observedAdjective) {
      parts.push(`${observedAdjective} ${window}`);
    } else {
      const sky = skyPhrase(code, next[0].isDaytime);
      parts.push(sky ? `Look for ${sky} ${window}` : `Quiet conditions ${window}`);
    }
  }

  if (peak != null && nowTemp != null) {
    if (peak - nowTemp >= 6) parts.push(`temperatures climbing to about ${uTempNum(peak)}${tempUnit()}`);
    else if (nowTemp - trough >= 8) parts.push(`temperatures easing back toward ${uTempNum(trough)}${tempUnit()}`);
    else parts.push(`temperatures holding near ${uTempNum(nowTemp)}${tempUnit()}`);
  }

  const gusts = next.map(h => numericWind(h.windGust)).filter(v => v != null);
  const peakGust = gusts.length ? Math.max(...gusts) : null;
  if (peakGust != null && peakGust >= 25) parts.push(`and gusts up to ${fmtWind(peakGust)}`);

  return `${parts.join(", ").replace(/, and /, " and ")}.`;
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
  const aqi = Number(current.us_aqi);
  const category = !Number.isFinite(aqi) ? "" : aqi <= 50 ? "Good" : aqi <= 100 ? "Moderate" :
    aqi <= 150 ? "Unhealthy for sensitive groups" : aqi <= 200 ? "Unhealthy" :
      aqi <= 300 ? "Very unhealthy" : "Hazardous";
  const pollutants = current.pm2_5 == null ? "" :
    `PM2.5 ${f(current.pm2_5, 1)} µg/m³, O₃ ${f(current.ozone, 1)} µg/m³`;
  return {
    label: current.us_aqi == null ? "Unavailable" : `${Math.round(current.us_aqi)} AQI`,
    detail: [category, pollutants].filter(Boolean).join(" · ") || "Open-Meteo air quality",
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

// ─── Forecast series (Open-Meteo) ───────────────────────────────────────────
// The NWS gridpoint forecast is the hand-edited NDFD grid: it refreshes only a
// couple of times a day, smooths the ridge-and-valley terrain around Ephrata
// into a single 2.5 km cell, and its narrative text is written for a whole
// county at a time. Open-Meteo serves the high-resolution regional runs
// (HRRR/NBM over the US, ICON-D2 over Europe) for the first two days and blends
// into the global runs beyond, refreshed hourly, with per-hour precipitation
// amounts and gusts the NWS periods never carry. Everything downstream still
// speaks the NWS period shape, so this reshapes one into the other.

const OPEN_METEO_HOURLY_VARS = [
  "temperature_2m", "apparent_temperature", "relative_humidity_2m", "dew_point_2m",
  "precipitation_probability", "precipitation", "snowfall", "weather_code",
  "wind_speed_10m", "wind_gusts_10m", "wind_direction_10m", "visibility",
  "cloud_cover", "is_day",
];

const OPEN_METEO_DAILY_VARS = [
  "weather_code", "temperature_2m_max", "temperature_2m_min",
  "apparent_temperature_max", "apparent_temperature_min",
  "precipitation_probability_max", "precipitation_sum", "snowfall_sum",
  "wind_speed_10m_max", "wind_gusts_10m_max", "wind_direction_10m_dominant",
  "uv_index_max", "relative_humidity_2m_mean", "cloud_cover_mean",
];

function openMeteoForecastUrl(loc, timezone) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,dew_point_2m,weather_code,` +
    `pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,cloud_cover,is_day` +
    `&hourly=${OPEN_METEO_HOURLY_VARS.join(",")}` +
    `&daily=${OPEN_METEO_DAILY_VARS.join(",")}` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
    `&forecast_days=8&timeformat=unixtime&timezone=${timezone ? encodeURIComponent(timezone) : "auto"}`;
}

// How much a WMO code matters when one has to stand in for a stretch of hours:
// a thunderstorm hour outranks the six clear ones around it, but codes 0–3 are
// only sky cover and rank among themselves.
function wmoSeverity(code) {
  if (code == null) return -1;
  if (code >= 95) return 100;          // thunderstorms
  if (code >= 85) return 90;           // snow showers
  if (code >= 80) return 70;           // rain showers
  if (code >= 71 && code <= 77) return 85;  // snow
  if (code >= 66) return 80;           // freezing rain
  if (code >= 61) return 65;           // rain
  if (code >= 56) return 60;           // freezing drizzle
  if (code >= 51) return 45;           // drizzle
  if (code >= 45) return 40;           // fog
  return code;                          // 0–3 sky cover
}

function dominantWmoCode(codes) {
  const list = codes.filter(c => c != null);
  if (!list.length) return null;
  const counts = new Map();
  list.forEach(c => counts.set(c, (counts.get(c) || 0) + 1));
  // Prefer the most significant code that holds for at least two hours, so a
  // lone outlier hour can't rename the whole period.
  const sustained = [...counts.keys()].filter(c => counts.get(c) >= 2);
  const pool = sustained.length ? sustained : [...counts.keys()];
  const worst = pool.reduce((a, b) => (wmoSeverity(b) > wmoSeverity(a) ? b : a));
  if (wmoSeverity(worst) > 3) return worst;
  // Nothing but sky cover across the period: report the sky it mostly had.
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

// Vector mean of wind directions — averaging 350° and 10° arithmetically gives
// due south, which is exactly backwards.
function meanWindDirection(degrees) {
  const list = degrees.filter(d => d != null);
  if (!list.length) return null;
  let x = 0, y = 0;
  for (const deg of list) {
    const rad = (deg * Math.PI) / 180;
    x += Math.cos(rad); y += Math.sin(rad);
  }
  if (x === 0 && y === 0) return null;
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// When, inside a forecast period, precipitation is actually expected. Hours
// already in the past are skipped — the question a daily card answers is when
// the rain is coming, not when it went. Returns the first and last wet hour so
// the wording can be a point in time ("around 3 PM") or a span ("2 PM to 7 PM").
const PRECIP_HOUR_THRESHOLD = 30;
function precipWindowFor(idxs, hi, times, nowSec) {
  const ahead = idxs.filter(i => times[i] + 3600 > nowSec);
  // A day that only ever reaches 25% still has a most-likely stretch worth
  // naming, so the bar drops to meet the day's own peak rather than hiding the
  // timing entirely.
  const peak = Math.max(0, ...ahead.map(i => hi.precipitation_probability?.[i] ?? 0));
  const bar = Math.min(PRECIP_HOUR_THRESHOLD, Math.max(15, peak * 0.7));
  const wet = ahead.filter(i => {
    const pop = hi.precipitation_probability?.[i];
    const amount = hi.precipitation?.[i] ?? 0;
    return (pop != null && pop >= bar) || amount >= 0.01;
  });
  if (!wet.length) return null;
  const pops = wet.map(i => hi.precipitation_probability?.[i]).filter(v => v != null);
  return {
    start: new Date(times[wet[0]] * 1000).toISOString(),
    // The last wet hour covers the hour that follows it, so the window closes
    // an hour after that reading.
    end: new Date((times[wet[wet.length - 1]] + 3600) * 1000).toISOString(),
    hours: wet.length,
    periodHours: idxs.length,
    peakPop: pops.length ? Math.max(...pops) : null,
    code: dominantWmoCode(wet.map(i => normalizeWmoWeatherCode(
      hi.weather_code?.[i], hi.temperature_2m?.[i],
    ))),
  };
}

// Reshape an Open-Meteo response into the NWS-style { hourly, daily,
// dailyExtras } trio every renderer already understands. Daily periods are
// aggregated from the hourly series rather than read off the daily block, so a
// "Tonight" low is the actual overnight minimum instead of the calendar day's.
function buildForecastSeries(data, tzHint) {
  const tz = data.timezone || tzHint || "America/New_York";
  const offset = data.utc_offset_seconds ?? 0;
  const hi = data.hourly || {};
  const di = data.daily || {};
  const times = hi.time || [];
  const round = v => (v == null ? null : Math.round(v));

  const nowSec = Date.now() / 1000;
  let startIdx = times.findIndex(t => t >= nowSec - 3600);
  if (startIdx < 0) startIdx = 0;

  const hourly = times.slice(startIdx, startIdx + 48).map((t, k) => {
    const i = startIdx + k;
    const weatherCode = normalizeWmoWeatherCode(hi.weather_code?.[i], hi.temperature_2m?.[i]);
    const pop = hi.precipitation_probability?.[i] ?? null;
    return {
      startTime: new Date(t * 1000).toISOString(),
      temperature: round(hi.temperature_2m?.[i]),
      apparentTemperature: round(hi.apparent_temperature?.[i]),
      shortForecast: forecastConditionDescription(weatherCode, pop),
      weatherCode: weatherCode ?? null,
      windSpeed: hi.wind_speed_10m?.[i] != null ? `${Math.round(hi.wind_speed_10m[i])} mph` : null,
      windGust: hi.wind_gusts_10m?.[i] != null ? `${Math.round(hi.wind_gusts_10m[i])} mph` : null,
      windDirection: windDirLabel(hi.wind_direction_10m?.[i]),
      probabilityOfPrecipitation: { value: pop },
      relativeHumidity: { value: hi.relative_humidity_2m?.[i] ?? null },
      precipAmount: hi.precipitation?.[i] ?? null,
      snowAmount: hi.snowfall?.[i] ?? null,
      cloudCover: hi.cloud_cover?.[i] ?? null,
      visibility: hi.visibility?.[i] == null ? null : metersToMiles(hi.visibility[i]),
      // Renderers expect NWS-style dewpoint in Celsius
      dewpoint: { value: hi.dew_point_2m?.[i] != null ? (hi.dew_point_2m[i] - 32) * 5 / 9 : null },
      isDaytime: hi.is_day?.[i] == null ? true : hi.is_day[i] === 1,
    };
  });

  // Bucket every forecast hour into a local daytime (06–18) or nighttime
  // (18–06, filed under the evening's date) window.
  const localDayOf = t => Math.floor((t + offset) / 86400);
  const localHourOf = t => Math.floor(((((t + offset) % 86400) + 86400) % 86400) / 3600);
  const buckets = new Map();
  times.forEach((t, i) => {
    const hour = localHourOf(t);
    const isDay = hour >= 6 && hour < 18;
    const key = `${isDay ? localDayOf(t) : (hour < 6 ? localDayOf(t) - 1 : localDayOf(t))}|${isDay ? "d" : "n"}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  });

  const pick = (idxs, arr, fn) => {
    const vals = idxs.map(i => arr?.[i]).filter(v => v != null);
    return vals.length ? fn(vals) : null;
  };
  const sum = (idxs, arr) => idxs.reduce((total, i) => total + (arr?.[i] || 0), 0);

  const dayTimes = (di.time || []).slice(0, 7);
  const daily = [];
  dayTimes.forEach((dayStart, index) => {
    const key = localDayOf(dayStart);
    const weekday = new Date(dayStart * 1000).toLocaleDateString("en-US", { weekday: "long", timeZone: tz });

    [true, false].forEach(isDaytime => {
      const idxs = buckets.get(`${key}|${isDaytime ? "d" : "n"}`) || [];
      const fallbackTemp = isDaytime ? di.temperature_2m_max?.[index] : di.temperature_2m_min?.[index];
      const temperature = idxs.length
        ? pick(idxs, hi.temperature_2m, vals => (isDaytime ? Math.max(...vals) : Math.min(...vals)))
        : fallbackTemp;
      const code = idxs.length
        ? dominantWmoCode(idxs.map(i => normalizeWmoWeatherCode(
          hi.weather_code?.[i], hi.temperature_2m?.[i],
        )))
        : normalizeWmoWeatherCode(di.weather_code?.[index], temperature);
      const windMax = idxs.length ? pick(idxs, hi.wind_speed_10m, vals => Math.max(...vals)) : di.wind_speed_10m_max?.[index];
      const gustMax = idxs.length ? pick(idxs, hi.wind_gusts_10m, vals => Math.max(...vals)) : di.wind_gusts_10m_max?.[index];
      const pop = idxs.length ? pick(idxs, hi.precipitation_probability, vals => Math.max(...vals)) : di.precipitation_probability_max?.[index];
      const direction = idxs.length
        ? meanWindDirection(idxs.map(i => hi.wind_direction_10m?.[i]))
        : di.wind_direction_10m_dominant?.[index];
      // Build this before choosing the visible condition so a high-PoP sky
      // period can use the forecast precipitation type and timing.
      const precipWindow = precipWindowFor(idxs, hi, times, nowSec);
      const shortForecast = forecastConditionDescription(code, pop, precipWindow);

      daily.push({
        startTime: new Date((idxs.length ? times[idxs[0]] : dayStart) * 1000).toISOString(),
        name: index === 0 ? (isDaytime ? "Today" : "Tonight") : (isDaytime ? weekday : `${weekday} Night`),
        isDaytime,
        temperature: round(temperature),
        shortForecast,
        weatherCode: code ?? null,
        detailedForecast: "",
        windSpeed: windMax != null ? `${Math.round(windMax)} mph` : null,
        windGust: gustMax != null ? `${Math.round(gustMax)} mph` : null,
        windDirection: windDirLabel(direction),
        probabilityOfPrecipitation: { value: pop == null ? null : Math.round(pop) },
        precipAmount: idxs.length ? sum(idxs, hi.precipitation) : (isDaytime ? di.precipitation_sum?.[index] ?? null : null),
        snowAmount: idxs.length ? sum(idxs, hi.snowfall) : (isDaytime ? di.snowfall_sum?.[index] ?? null : null),
        cloudCover: idxs.length ? pick(idxs, hi.cloud_cover, vals => vals.reduce((a, b) => a + b, 0) / vals.length) : di.cloud_cover_mean?.[index],
        humidity: idxs.length ? pick(idxs, hi.relative_humidity_2m, vals => vals.reduce((a, b) => a + b, 0) / vals.length) : di.relative_humidity_2m_mean?.[index],
        hourIndexes: idxs.map(i => i - startIdx).filter(i => i >= 0 && i < hourly.length),
        // Computed here, against the full 8-day hourly arrays, rather than at
        // render time against the 48-hour slice — otherwise days 3–7 could
        // never say when their rain arrives.
        precipWindow,
      });
    });
  });

  return {
    tz,
    hourly,
    daily,
    dailyExtras: {
      apparent_temperature_max: di.apparent_temperature_max || [],
      apparent_temperature_min: di.apparent_temperature_min || [],
      uv_index_max: di.uv_index_max || [],
      relative_humidity_2m_mean: di.relative_humidity_2m_mean || [],
      wind_gusts_10m_max: di.wind_gusts_10m_max || [],
      cloud_cover_mean: di.cloud_cover_mean || [],
      precipitation_sum: di.precipitation_sum || [],
      snowfall_sum: di.snowfall_sum || [],
    },
    startIdx,
  };
}

// api.weather.gov exposes the official 12-hour, hourly, and raw grid forecasts
// as three linked products. The period feeds provide the readable forecast;
// raw grid fields fill in aviation/operations details that the period objects
// do not carry (gusts, sky cover, visibility, ceiling, and UV).
function isoDurationMs(duration = "") {
  const match = String(duration).match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!match) return 0;
  return ((Number(match[1]) || 0) * 86400 + (Number(match[2]) || 0) * 3600 +
    (Number(match[3]) || 0) * 60 + (Number(match[4]) || 0)) * 1000;
}

function gridValueAt(field, when) {
  const at = new Date(when).getTime();
  if (!Number.isFinite(at)) return null;
  for (const item of (field?.values || [])) {
    const [startText, duration] = String(item.validTime || "").split("/");
    const start = new Date(startText).getTime();
    const end = start + isoDurationMs(duration);
    if (Number.isFinite(start) && at >= start && at < (end || start + 3600000)) return item.value ?? null;
  }
  return null;
}

function gridUnit(field = {}) {
  return String(field.uom || field.unitCode || "").toLowerCase();
}

function gridSpeedMph(field, when) {
  const value = gridValueAt(field, when);
  if (value == null) return null;
  const unit = gridUnit(field);
  if (unit.includes("km_h") || unit.includes("km/h")) return value * 0.621371;
  if (unit.includes("m_s") || unit.includes("m/s")) return value * 2.23694;
  if (unit.includes("kt") || unit.includes("knot")) return value * 1.15078;
  return Number(value);
}

function gridDistanceMiles(field, when) {
  const value = gridValueAt(field, when);
  if (value == null) return null;
  const unit = gridUnit(field);
  if (unit.includes("km")) return value * 0.621371;
  if (unit.includes("ft")) return value / 5280;
  if (unit.includes("mi")) return Number(value);
  return value / 1609.344;
}

function gridHeightFeet(field, when) {
  const value = gridValueAt(field, when);
  if (value == null) return null;
  const unit = gridUnit(field);
  if (unit.includes("ft")) return Number(value);
  return value * 3.28084;
}

function forecastTextWeatherCode(text = "") {
  const value = String(text).toLowerCase();
  if (/thunder|t-?storm/.test(value)) return 95;
  if (/snow shower|snow squall/.test(value)) return 85;
  if (/snow|sleet|ice pellet/.test(value)) return 73;
  if (/freezing rain|freezing drizzle|ice storm/.test(value)) return 66;
  if (/shower/.test(value)) return 80;
  if (/rain/.test(value)) return 61;
  if (/drizzle/.test(value)) return 51;
  if (/fog|mist/.test(value)) return 45;
  if (/overcast|cloudy/.test(value) && !/partly/.test(value)) return 3;
  if (/partly/.test(value)) return 2;
  if (/mostly sunny|mostly clear|few clouds/.test(value)) return 1;
  if (/sunny|clear|fair/.test(value)) return 0;
  return null;
}

function normalizedNwsTemperature(value, unitCode) {
  const amount = value?.value ?? value;
  if (amount == null) return null;
  return String(value?.unitCode || unitCode || "").toLowerCase().includes("degc")
    ? fahrenheit(Number(amount)) : Math.round(Number(amount));
}

function normalizedNwsWind(value) {
  if (value == null || typeof value !== "object") return value;
  const speed = gridUnit(value).includes("km_h") ? Number(value.value) * 0.621371 : Number(value.value);
  return Number.isFinite(speed) ? `${Math.round(speed)} mph` : null;
}

function buildNwsForecastSeries(forecastData, hourlyData, gridData) {
  const grid = gridData?.properties || {};
  const enrich = period => {
    const start = period.startTime;
    const gust = gridSpeedMph(grid.windGust, start);
    const visibility = gridDistanceMiles(grid.visibility, start);
    const ceiling = gridHeightFeet(grid.ceilingHeight, start);
    return {
      ...period,
      temperature: normalizedNwsTemperature(period.temperature, period.temperatureUnit),
      windSpeed: normalizedNwsWind(period.windSpeed),
      weatherCode: forecastTextWeatherCode(`${period.shortForecast || ""} ${period.detailedForecast || ""}`),
      windGust: gust == null ? null : `${Math.round(gust)} mph`,
      cloudCover: gridValueAt(grid.skyCover, start),
      visibility: visibility == null ? null : Number(visibility.toFixed(1)),
      ceiling: ceiling == null ? null : Math.round(ceiling),
      apparentTemperature: normalizedNwsTemperature(
        gridValueAt(grid.apparentTemperature, start), grid.apparentTemperature?.uom,
      ),
      uvIndex: gridValueAt(grid.maxUVIndex, start),
      precipAmount: gridValueAt(grid.quantitativePrecipitation, start),
      snowAmount: gridValueAt(grid.snowfallAmount, start),
    };
  };

  const hourly = (hourlyData?.properties?.periods || []).map(enrich);
  const daily = (forecastData?.properties?.periods || []).map(enrich);
  const daytime = daily.filter(period => period.isDaytime !== false).slice(0, 7);
  const valuesFor = (period, read) => {
    const start = new Date(period.startTime).getTime();
    const end = new Date(period.endTime || start + 12 * 3600000).getTime();
    return hourly.filter(hour => {
      const time = new Date(hour.startTime).getTime();
      return time >= start && time < end;
    }).map(read).filter(Number.isFinite);
  };
  const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const maximum = values => values.length ? Math.max(...values) : null;

  return {
    hourly,
    daily,
    dailyExtras: {
      apparent_temperature_max: daytime.map(period => maximum(valuesFor(period, hour => hour.apparentTemperature))),
      apparent_temperature_min: daytime.map(period => {
        const nextNight = daily[daily.indexOf(period) + 1];
        return nextNight ? minimumFinite(valuesFor(nextNight, hour => hour.apparentTemperature)) : null;
      }),
      uv_index_max: daytime.map(period => maximum(valuesFor(period, hour =>
        hour.uvIndex == null ? null : Number(hour.uvIndex)))),
      relative_humidity_2m_mean: daytime.map(period => average(valuesFor(period, hour => {
        const humidity = nwsValue(hour, "relativeHumidity");
        return humidity == null ? null : Number(humidity);
      }))),
      wind_gusts_10m_max: daytime.map(period => maximum(valuesFor(period, hour => numericWind(hour.windGust)))),
      cloud_cover_mean: daytime.map(period => average(valuesFor(period, hour =>
        hour.cloudCover == null ? null : Number(hour.cloudCover)))),
      precipitation_sum: daytime.map(() => null),
      snowfall_sum: daytime.map(() => null),
    },
  };
}

function minimumFinite(values) {
  return values.length ? Math.min(...values) : null;
}

function preferredNwsStation(features = []) {
  // NWS station lists can begin with a tide/mesonet platform that publishes
  // temperature but no visibility, ceiling, pressure, or sky cover. Prefer a
  // four-letter U.S. ICAO/FAA station for complete current and aviation data.
  return features.find(feature => /^[KP][A-Z0-9]{3}$/i.test(feature?.properties?.stationIdentifier || ""))
    || features[0]
    || null;
}

async function weatherPayload() {
  const loc = point();
  const gridPoint = await getJson(`https://api.weather.gov/points/${loc.lat},${loc.lon}`);
  const props = gridPoint.properties;
  selectedLocation.timezone = props.timeZone || loc.timezone || "America/New_York";
  // Use all three official NWS point products: readable daily/hourly periods
  // plus the raw grid fields needed for gust, ceiling, visibility, cloud and UV.
  const [forecast, hourlyForecast, gridForecast, stations, alertsData, airQuality, pollen, astronomy, tempest, shore] = await Promise.all([
    getJson(props.forecast),
    getJson(props.forecastHourly),
    getJson(props.forecastGridData),
    getJson(props.observationStations),
    alertsPayload(loc.lat, loc.lon, loc).catch(() => ({ alerts: [], source: "Unavailable" })),
    airQualityPayload().catch(error => ({ label: "Unavailable", detail: `Open-Meteo air quality ${error.message}` })),
    pollenPayload().catch(() => null),
    astronomyPayload().catch(() => null),
    usesTempestStation(loc) ? tempestCurrent().catch(() => null) : Promise.resolve(null),
    coastalObservationPayload(loc.lat, loc.lon).catch(() => null),
  ]);
  const series = buildNwsForecastSeries(forecast, hourlyForecast, gridForecast);
  const station = preferredNwsStation(stations.features || []);
  const stationId = station?.properties?.stationIdentifier;
  if (!stationId) throw new Error("No NWS observation station found nearby");
  const observation = await getJson(`https://api.weather.gov/stations/${stationId}/observations/latest`);
  const p = observation.properties || {};
  const firstHour = series.hourly[0] || {};
  const firstDay = series.daily[0] || {};
  let temp = fahrenheit(propertyValue(observation, "temperature")) ?? firstHour.temperature;
  let dewPoint = fahrenheit(propertyValue(observation, "dewpoint"))
    ?? normalizedNwsTemperature(firstHour.dewpoint);
  let wind = mph(propertyValue(observation, "windSpeed")) ?? parseInt(firstHour.windSpeed, 10);
  let gust = mph(propertyValue(observation, "windGust")) ?? numericWind(firstHour.windGust) ?? wind;
  let pressure = paToInHg(propertyValue(observation, "barometricPressure"))
    ?? paToInHg(gridValueAt(gridForecast?.properties?.pressure, firstHour.startTime));
  let visibility = metersToMiles(propertyValue(observation, "visibility")) ?? firstHour.visibility ?? null;
  let humidity = propertyValue(observation, "relativeHumidity") ?? nwsValue(firstHour, "relativeHumidity");
  let condition = p.textDescription || firstHour.shortForecast || firstDay.shortForecast;
  // The station reports its own cloud layers; the model run is only the
  // fallback for stations that publish no sky condition.
  let cloudCover = observedCloudCover(observation) ?? firstHour.cloudCover ?? null;
  // No surface station measures UV, so this one genuinely has to come from the
  // model (a Tempest station overrides it further down).
  let uv = firstHour.uvIndex ?? series.dailyExtras.uv_index_max?.[0] ?? null;
  let updated = p.timestamp || firstHour.startTime || new Date().toISOString();
  let currentSource = "NWS";

  // Barrier islands and spits have no FAA or NWS station of their own, so the
  // nearest one is inland across a bay and reads several degrees off. When a
  // NOAA shore station sits closer to the town than that station does, its
  // sensors take over the readings they actually carry.
  const nwsStationCoords = station?.geometry?.coordinates;
  const nwsStationMiles = Array.isArray(nwsStationCoords)
    ? milesBetween(loc.lat, loc.lon, nwsStationCoords[1], nwsStationCoords[0]) : Infinity;
  const useShore = shore && shore.station.distance < nwsStationMiles - 1;
  // Shore stations carry only the sensors they carry — most have air
  // temperature and pressure, many have no anemometer at all — so the swap is
  // per reading, and the rest stay on the NWS station.
  const shoreFields = [];
  if (useShore) {
    if (Number.isFinite(shore.tempF)) { temp = Math.round(shore.tempF); shoreFields.push("temperature"); }
    if (Number.isFinite(shore.windMph)) { wind = Math.round(shore.windMph); shoreFields.push("wind"); }
    if (Number.isFinite(shore.gustMph)) gust = Math.round(shore.gustMph);
    if (Number.isFinite(shore.pressureInHg)) { pressure = shore.pressureInHg; shoreFields.push("pressure"); }
    if (Number.isFinite(shore.humidity)) { humidity = shore.humidity; shoreFields.push("humidity"); }
    // CO-OPS publishes no dew point, so derive it whenever both inputs came
    // from the shore station (Magnus formula).
    if (Number.isFinite(shore.tempF) && Number.isFinite(shore.humidity)) {
      dewPoint = Math.round(dewPointFrom(shore.tempF, shore.humidity));
    }
    if (shoreFields.length && shore.at?.iso) updated = shore.at.iso;
    if (shoreFields.length) {
      currentSource = shoreFields.length >= 4
        ? `NOAA ${shore.station.name} shore station`
        : `NOAA ${shore.station.name} shore station + ${stationId}`;
    }
  }

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
      summary: nowSummary(series.hourly, series.tz, condition) || firstDay.shortForecast || condition,
      humidity: humidity == null ? null : Math.round(humidity),
      dewPoint,
      wind,
      gust,
      uv,
      cloudCover,
      pollen: Array.isArray(pollen) ? pollen[0]?.label || null : pollen?.label || null,
      pollenDetail: Array.isArray(pollen) ? pollen[0]?.detail || null : pollen?.detail || null,
      airQuality: airQuality?.label || "Unavailable",
      airQualityDetail: airQuality?.detail || "Open-Meteo air quality unavailable",
      visibility: visibility == null ? null : Number(visibility.toFixed(1)),
      pressure,
      updated,
      source: currentSource,
      shoreStation: shoreFields.length ? { ...shore.station, fields: shoreFields, milesInlandStation: nwsStationMiles } : null,
      nwsStation: `${stationId}, ${station?.properties?.name || stationId}`,
    },
    hourly: series.hourly,
    daily: series.daily,
    dailyExtras: series.dailyExtras,
    forecastSource: "NWS api.weather.gov",
    alerts: alertsData.alerts || [],
    alertSource: alertsData.source || "NWS",
    pollenForecast: Array.isArray(pollen) ? pollen : [],
    astronomy,
    sources: [
      tempest ? "Tempest station " + TEMPEST_STATION_ID : null,
      shoreFields.length ? `NOAA CO-OPS ${shore.station.id}` : null,
      "api.weather.gov (forecast + observations + alerts)",
      "air-quality-api.open-meteo.com (air quality)",
      "pollen.googleapis.com",
    ].filter(Boolean),
  };
}

// Full forecast payload from Open-Meteo, shaped like the NWS payload so every
// renderer works unchanged. Used for international locations and whenever the
// NWS pipeline fails.
async function openMeteoWeatherPayload() {
  const loc = point();
  const data = await getJson(openMeteoForecastUrl(loc, null));
  selectedLocation.timezone = data.timezone || loc.timezone || "America/New_York";

  const [alertsData, airQuality, pollen, astronomy] = await Promise.all([
    alertsPayload(loc.lat, loc.lon, loc).catch(() => ({ alerts: [], source: "Unavailable" })),
    airQualityPayload().catch(error => ({ label: "Unavailable", detail: `Open-Meteo air quality ${error.message}` })),
    pollenPayload().catch(() => null),
    astronomyPayload().catch(() => null),
  ]);

  const series = buildForecastSeries(data, selectedLocation.timezone);
  const { hourly, daily, dailyExtras, startIdx } = series;
  const hi = data.hourly || {};

  const cur = data.current || {};
  const condition = wmoDescription(cur.weather_code, cur.temperature_2m);
  const firstDay = daily[0] || {};
  const visibilityMeters = hi.visibility?.[startIdx];
  const visibility = metersToMiles(visibilityMeters);

  return {
    current: {
      temp: cur.temperature_2m != null ? Math.round(cur.temperature_2m) : null,
      condition,
      headline: headlineFor(condition, firstDay),
      summary: nowSummary(series.hourly, series.tz, condition) || firstDay.shortForecast || condition,
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
    dailyExtras,
    forecastSource: "Open-Meteo",
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
    alertsPayload(loc.lat, loc.lon, loc).catch(() => ({ alerts: [], source: "Unavailable" })),
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
    forecastSource: "Environment and Climate Change Canada",
    alerts: alertsData.alerts || [],
    alertSource: alertsData.source || "ECCC",
    pollenForecast: Array.isArray(pollen) ? pollen : [],
    astronomy,
    sources: ["api.weather.gc.ca", "pollen.googleapis.com"],
  };
}

// Provider routing is country-aware: NWS for the US, ECCC for Canada, and
// Open-Meteo everywhere else. The secondary fallback only runs after the
// location's primary national service fails.
async function primaryWeatherPayload() {
  const provider = forecastProviderFor();
  if (provider === "ECCC") {
    try {
      return await canadaWeatherPayload();
    } catch (error) {
      console.warn("Environment Canada forecast unavailable, falling back to Open-Meteo", error);
      return openMeteoWeatherPayload();
    }
  }
  if (provider === "NWS") {
    try {
      return await weatherPayload();
    } catch (error) {
      console.warn("NWS forecast/observation pipeline unavailable, falling back to Open-Meteo", error);
      return openMeteoWeatherPayload();
    }
  }
  return openMeteoWeatherPayload();
}

function flightCategoryFor(visibilityMiles, ceilingFeet) {
  const visibility = visibilityMiles == null ? NaN : Number(visibilityMiles);
  const ceiling = ceilingFeet == null ? NaN : Number(ceilingFeet);
  const hasVisibility = Number.isFinite(visibility);
  const hasCeiling = Number.isFinite(ceiling);
  if (!hasVisibility && !hasCeiling) return "UNK";
  if ((hasVisibility && visibility < 1) || (hasCeiling && ceiling < 500)) return "LIFR";
  if ((hasVisibility && visibility < 3) || (hasCeiling && ceiling < 1000)) return "IFR";
  if ((hasVisibility && visibility <= 5) || (hasCeiling && ceiling < 3000)) return "MVFR";
  return "VFR";
}

function forecastFlightCategory(hour = {}) {
  const measured = flightCategoryFor(hour.visibility, hour.ceiling);
  if (measured !== "UNK") return { category: measured, estimated: false };
  const text = String(hour.shortForecast || "").toLowerCase();
  if (/dense fog|heavy (rain|snow)|blizzard/.test(text)) return { category: "IFR", estimated: true };
  // A shower or thunderstorm is an operational hazard, but it does not by
  // itself define a flight category; that classification is based on ceiling
  // and visibility. Only wording that directly implies a restriction is used
  // as the fallback when those fields are absent.
  if (/fog|mist|moderate (rain|snow)|\bsnow\b|\bsleet\b/.test(text)) return { category: "MVFR", estimated: true };
  return { category: "VFR", estimated: true };
}

async function aviationPayload() {
  let stationId, stationName;
  if (metarStationOverride) {
    stationId = metarStationOverride.toUpperCase();
    stationName = stationId;
  } else {
    if (!isUsLocation()) return null;
    const loc = point();
    const gridPoint = await getJson(`https://api.weather.gov/points/${loc.lat},${loc.lon}`);
    const stations = await getJson(gridPoint.properties.observationStations);
    const station = preferredNwsStation(stations.features || []);
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
  const flightRule = flightCategoryFor(visibility, ceiling);

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

function droneOperatingAssessment(hour = {}) {
  const wind = numericWind(hour.windSpeed);
  const gust = numericWind(hour.windGust);
  const visibility = hour.visibility == null ? NaN : Number(hour.visibility);
  const ceiling = hour.ceiling == null ? NaN : Number(hour.ceiling);
  const precipValue = hour.probabilityOfPrecipitation?.value;
  const precip = precipValue == null ? NaN : Number(precipValue);
  const condition = String(hour.shortForecast || "");
  const reasons = [];
  let level = 0;

  const add = (severity, reason) => {
    level = Math.max(level, severity);
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  if (/thunder|lightning/i.test(condition)) add(2, "thunderstorms/lightning");
  if (/freezing rain|ice storm|snow squall/i.test(condition)) add(2, "icing or snow-squall conditions");
  if (Number.isFinite(gust) && gust >= 30) add(2, `gusts near ${Math.round(gust)} mph`);
  else if (Number.isFinite(gust) && gust >= 20) add(1, `gusts near ${Math.round(gust)} mph`);
  if (Number.isFinite(wind) && wind >= 25) add(2, `sustained wind near ${Math.round(wind)} mph`);
  else if (Number.isFinite(wind) && wind >= 15) add(1, `wind near ${Math.round(wind)} mph`);
  if (Number.isFinite(visibility) && visibility < 1) add(2, `visibility near ${visibility.toFixed(1)} mi`);
  else if (Number.isFinite(visibility) && visibility < 3) add(1, `visibility near ${visibility.toFixed(1)} mi`);
  if (Number.isFinite(ceiling) && ceiling < 500) add(2, `ceiling near ${Math.round(ceiling)} ft`);
  else if (Number.isFinite(ceiling) && ceiling < 1000) add(1, `ceiling near ${Math.round(ceiling)} ft`);
  if (Number.isFinite(precip) && precip >= 70) add(2, `${Math.round(precip)}% precipitation chance`);
  else if (Number.isFinite(precip) && precip >= 40) add(1, `${Math.round(precip)}% precipitation chance`);
  if (/fog|mist|heavy rain|heavy snow/i.test(condition)) add(1, condition.toLowerCase());

  const labels = ["Favorable", "Caution", "Poor"];
  return {
    level,
    label: labels[level],
    reasons: reasons.length ? reasons : ["no major weather limits in the available forecast"],
  };
}

// SWPC retired the /products/solar-wind/plasma-1-day.json and mag-1-day.json
// feeds — both now 404. Because all three requests were awaited with
// Promise.all, those two 404s rejected the whole payload and the Space Weather
// card showed "--" for every field, Kp included. The DSCOVR summary products
// carry the same two numbers (latest sample only, which is all this card
// shows), and each source is now settled independently so one outage can't
// blank the rest of the panel.
const SWPC_SOURCES = {
  kp:    "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
  wind:  "https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json",
  mag:   "https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json",
  scales: "https://services.swpc.noaa.gov/products/noaa-scales.json",
};

async function spacePayload() {
  const [kpRes, windRes, magRes, scalesRes] = await Promise.allSettled([
    getJson(SWPC_SOURCES.kp),
    getJson(SWPC_SOURCES.wind),
    getJson(SWPC_SOURCES.mag),
    getJson(SWPC_SOURCES.scales),
  ]);
  const value = res => res.status === "fulfilled" ? res.value : null;

  // The Kp product is an array of objects, newest last, and occasionally ends
  // with rows whose Kp is still null while the period is being estimated.
  const kpRows = value(kpRes);
  const latestKp = Array.isArray(kpRows)
    ? kpRows.slice().reverse().find(row => Number.isFinite(Number(row?.Kp ?? row?.kp_index ?? row?.[1])))
    : null;
  const kp = latestKp ? Number(latestKp.Kp ?? latestKp.kp_index ?? latestKp[1]) : NaN;

  const windRow = value(windRes)?.[0];
  const magRow  = value(magRes)?.[0];
  const speed = Number(windRow?.proton_speed ?? windRow?.speed);
  const bz    = Number(magRow?.bz_gsm ?? magRow?.bz);

  // NOAA publishes the observed G scale directly; derive it from Kp only when
  // that feed is the one that is down.
  const observedG = value(scalesRes)?.["0"]?.G?.Scale;
  const gScale = observedG != null
    ? `G${observedG}`
    : (Number.isFinite(kp) && kp >= 5 ? `G${Math.min(5, Math.floor(kp - 4))}` : "G0");

  const payload = {
    kp: Number.isFinite(kp) ? kp.toFixed(1) : null,
    gScale,
    solarWind: Number.isFinite(speed) ? Math.round(speed) : null,
    bz: Number.isFinite(bz) ? bz.toFixed(1) : null,
    updated: windRow?.time_tag || magRow?.time_tag || latestKp?.time_tag || null,
  };
  // Everything failing means SWPC itself is unreachable — say so rather than
  // drawing a full card of dashes that looks like a quiet sun.
  if (payload.kp == null && payload.solarWind == null && payload.bz == null) {
    throw new Error("SWPC space weather feeds unavailable");
  }
  return payload;
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
const COOPS_APP = "EphrataWeatherPortal";
const M_TO_FT = 3.28084;

// Three CO-OPS station networks, each fetched only when it can help:
//   gauges   — ~300 real water level gauges (live level, water temperature)
//   met      — ~316 stations that also carry air temperature and pressure
//   predicted— ~3,500 harmonic and subordinate tide prediction stations, which
//              sit in the inlets and back bays that the gauges miss. This is
//              the big list (~340 KB gzipped), so it is only pulled once the
//              location is already known to be coastal.
const COOPS_LISTS = {
  gauges:    "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels",
  met:       "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=met",
  predicted: "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/tidepredstations.json",
};
const TIDE_GAUGE_MAX_MI = 45;     // beyond this a gauge no longer describes the local water
const TIDE_PRED_MAX_MI = 25;      // prediction stations are dense, so hold them close
const TIDE_OCEAN_REACH_MI = 6;    // how much further than the nearest an ocean station may sit
const TIDE_OCEAN_MAX_MI = 15;     // hard ceiling on that reach
const COASTAL_OBS_MAX_MI = 30;    // how far a shore station may be and still beat inland

function milesBetween(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// CO-OPS stations never move, so each list is cached for a month rather than
// refetched on every location change.
const coopsListCache = {};
const COOPS_STATION_TTL = 30 * 24 * 60 * 60 * 1000;
async function coopsStations(kind) {
  if (coopsListCache[kind]) return coopsListCache[kind];
  const key = `coopsStations_${kind}`;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if (saved?.stations?.length && Date.now() - saved.time < COOPS_STATION_TTL) {
      coopsListCache[kind] = saved.stations;
      return coopsListCache[kind];
    }
  } catch { /* fall through to a network fetch */ }
  const data = await getJson(COOPS_LISTS[kind]);
  // The prediction list uses stationList/stationId; the others use stations/id.
  const rows = data.stations || data.stationList || [];
  coopsListCache[kind] = rows
    .map(s => ({
      id: String(s.id ?? s.stationId ?? ""),
      name: s.name || s.stationName || "",
      state: s.state || "",
      lat: s.lat,
      lon: s.lng ?? s.lon,
    }))
    .filter(s => s.id && Number.isFinite(s.lat) && Number.isFinite(s.lon));
  try {
    localStorage.setItem(key, JSON.stringify({ time: Date.now(), stations: coopsListCache[kind] }));
  } catch { /* private mode or quota — the in-memory cache still holds */ }
  return coopsListCache[kind];
}

async function nearestCoopsStations(kind, lat, lon, maxMiles, limit = 1) {
  return (await coopsStations(kind))
    .map(station => ({ ...station, distance: milesBetween(lat, lon, station.lat, station.lon) }))
    .filter(station => station.distance <= maxMiles)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

async function nearestCoopsStation(kind, lat, lon, maxMiles) {
  return (await nearestCoopsStations(kind, lat, lon, maxMiles))[0] || null;
}

/* The tide a beach town cares about is the one breaking on its ocean side, but
   the nearest prediction station is very often a back-bay one a mile behind the
   dunes, running up to an hour late. CO-OPS has no exposure flag, and the wave
   model's grid is far too coarse to tell a bay cell from a surf cell, so the
   water body is read off the station name — which CO-OPS names consistently
   after exactly that. */
const TIDE_OCEAN_WORDS = /\b(OCEAN|BEACH|SURF|SEASIDE|OCEANSIDE|INLET|CAPE|FISHING PIER|OCEAN PIER|COAST ?GUARD|USCG|JETT(?:Y|IES)|BREAKWATER|LIGHTHOUSE|LIGHT STATION|SEA BUOY|OFFSHORE|STRAND|HEADLAND)\b/;
const TIDE_INLAND_WORDS = /\b(BAY|BAYOU|BAYSIDE|RIVER|CREEK|CR\.|THOROFARE|CHANNEL|CHAN|SOUND|SND|HARBOU?R|COVE|CANAL|SLOUGH|SL\.|LAGOON|MARSH|LAKE|POND|BASIN|SWAMP|NECK|INTRACOASTAL|ICW|YACHT|MARINA|BRIDGE|FERRY|DITCH|NARROWS|SHOAL|WHARF|DOCK|SLIP|BRANCH|FORK|LANDING|ESTUARY|REACH|GUT)\b/;

// An inland word always wins: "OCEAN GATE, BARNEGAT BAY" is a bay station, and
// "THOMAS POINT SHOAL LIGHTHOUSE" sits well inside the Chesapeake.
function classifyTideStation(name = "") {
  const upper = name.toUpperCase();
  if (TIDE_INLAND_WORDS.test(upper)) return "inland";
  return TIDE_OCEAN_WORDS.test(upper) ? "ocean" : "unknown";
}

// Ocean-facing by default. The nearest station is kept unless it is plainly a
// back-bay one, and the swap only reaches a few miles further out — otherwise a
// town that genuinely sits on a bay or a sound (Annapolis, Seattle, Half Moon
// Bay) would be dragged to an ocean station that describes nothing local.
function pickOceanFacingStation(candidates = []) {
  const nearest = candidates[0];
  if (!nearest || nearest.water !== "inland") return nearest || null;
  const cap = Math.min(nearest.distance + TIDE_OCEAN_REACH_MI, TIDE_OCEAN_MAX_MI);
  const within = candidates.filter(item => item.distance <= cap);
  return within.find(item => item.water === "ocean")
    || within.find(item => item.water === "unknown")
    || nearest;
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

// Tides come from two stations, because the accurate one and the live one are
// rarely the same place: predictions from the nearest harmonic/subordinate
// prediction station (often an inlet a couple of miles away), observations from
// the nearest real gauge. `gauge` is resolved first and doubles as the coastal
// test, so inland locations never pull the large prediction list.
async function tidePayload(lat, lon, gauge, preferredStationId = null) {
  if (!gauge) return null;
  const nearby = (await nearestCoopsStations("predicted", lat, lon, TIDE_PRED_MAX_MI, 10).catch(() => []))
    .map(item => ({ ...item, water: classifyTideStation(item.name) }));
  const station = nearby.find(item => item.id === preferredStationId) || pickOceanFacingStation(nearby) || gauge;

  const today = new Date();
  const begin = coopsDate(today);
  const end = coopsDate(new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000));
  const [highLow, level, water] = await Promise.allSettled([
    getJson(coopsUrl({ product: "predictions", datum: "MLLW", interval: "hilo", begin_date: begin, end_date: end, station: station.id })),
    getJson(coopsUrl({ product: "water_level", datum: "MLLW", date: "latest", station: gauge.id })),
    getJson(coopsUrl({ product: "water_temperature", date: "latest", station: gauge.id })),
  ]);

  // Great Lakes gauges have no tidal signal, so they return no predictions —
  // the station is still kept for its live water level and temperature.
  const events = (highLow.status === "fulfilled" ? highLow.value.predictions || [] : []).map(row => ({
    ...parseCoopsTime(row.t),
    heightFt: Number(row.v),
    type: row.type === "H" ? "High" : "Low",
  })).filter(row => row.iso && Number.isFinite(row.heightFt));

  const observedRow = level.status === "fulfilled" ? level.value.data?.[0] : null;
  const tempRow = water.status === "fulfilled" ? water.value.data?.[0] : null;

  return {
    station,
    nearby: nearby.length ? nearby : [station],
    gauge,
    sameStation: station.id === gauge.id,
    datum: "MLLW",
    hasTides: events.length > 0,
    events,
    curve: tideCurveFromEvents(events),
    observed: observedRow && Number.isFinite(Number(observedRow.v))
      ? { ...parseCoopsTime(observedRow.t), heightFt: Number(observedRow.v) } : null,
    waterTempF: tempRow && Number.isFinite(Number(tempRow.v)) ? Number(tempRow.v) : null,
    waterTempAt: tempRow ? parseCoopsTime(tempRow.t) : null,
  };
}

// Subordinate stations publish only high/low times and heights, so the curve is
// reconstructed by easing between consecutive turns with a raised cosine — the
// shape a tide actually traces. Checked against CO-OPS's own 30-minute
// predictions at Ocean City Inlet: 0.04 ft mean and 0.13 ft worst-case error
// across a 2.4 ft range, well under a line width on screen.
function tideCurveFromEvents(events, stepMinutes = 6) {
  const points = [];
  for (let i = 0; i < events.length - 1; i += 1) {
    const from = events[i];
    const to = events[i + 1];
    const span = tideKey(to) - tideKey(from);
    if (!(span > 0) || span > 24 * 60) continue;   // guard against gaps in the series
    for (let offset = 0; offset < span; offset += stepMinutes) {
      const u = offset / span;
      points.push({
        ...tideKeyToStamp(tideKey(from) + offset),
        heightFt: from.heightFt + (to.heightFt - from.heightFt) * (1 - Math.cos(Math.PI * u)) / 2,
      });
    }
  }
  const last = events[events.length - 1];
  if (last) points.push({ ...tideKeyToStamp(tideKey(last)), heightFt: last.heightFt });
  return points;
}

// Live shore observations. CO-OPS met stations sit on piers, jetties and inlet
// bulkheads, so on a barrier island they describe the air far better than the
// mainland airport the NWS station list hands back — but they carry only a few
// sensors, and not every station carries all of them.
async function coastalObservationPayload(lat, lon) {
  const station = await nearestCoopsStation("met", lat, lon, COASTAL_OBS_MAX_MI).catch(() => null);
  if (!station) return null;
  // These readings feed the Today tab's "updated" stamp, which needs a real
  // instant — so unlike the tide products (whose labels are only ever shown as
  // station wall-clock time) they are requested in GMT.
  const products = ["air_temperature", "wind", "air_pressure", "humidity", "water_temperature"];
  const results = await Promise.allSettled(products.map(product =>
    getJson(coopsUrl({ product, date: "latest", station: station.id, time_zone: "gmt" }))));

  const value = index => {
    const row = results[index].status === "fulfilled" ? results[index].value.data?.[0] : null;
    return row || null;
  };
  const num = (row, key = "v") => (row && Number.isFinite(Number(row[key])) ? Number(row[key]) : null);
  const airRow = value(0);
  const windRow = value(1);
  const pressureRow = value(2);
  const humidityRow = value(3);
  const waterRow = value(4);
  const observed = airRow || windRow || pressureRow || waterRow;
  if (!observed) return null;

  const observedAt = new Date(`${observed.t.replace(" ", "T")}:00Z`);
  return {
    station,
    at: Number.isFinite(observedAt.getTime())
      ? { iso: observedAt.toISOString(), label: observedAt.toLocaleTimeString([], { timeZone: selectedLocation.timezone || "America/New_York", hour: "numeric", minute: "2-digit" }) }
      : null,
    tempF: num(airRow),
    windMph: num(windRow, "s"),
    gustMph: num(windRow, "g"),
    windDir: num(windRow, "d"),
    pressureInHg: num(pressureRow) == null ? null : num(pressureRow) / 33.8639,   // CO-OPS reports mb
    humidity: num(humidityRow),
    waterTempF: num(waterRow),
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
  // The wave model and the ~31 KB gauge list are the cheap pair that decides
  // whether this location is coastal at all; everything heavier waits on them.
  const [marineResult, gaugeResult] = await Promise.allSettled([
    marinePayload(loc.lat, loc.lon),
    nearestCoopsStation("gauges", loc.lat, loc.lon, TIDE_GAUGE_MAX_MI),
  ]);
  const marine = marineResult.status === "fulfilled" ? marineResult.value : null;
  const gauge = gaugeResult.status === "fulfilled" ? gaugeResult.value : null;

  if (!marine?.hasWaves && !gauge) {
    return { isCoastal: false, marine: null, tides: null, observations: null, surf: null, waters: null };
  }

  const [tideResult, obsResult] = await Promise.allSettled([
    tidePayload(loc.lat, loc.lon, gauge, coastalTideStationId),
    coastalObservationPayload(loc.lat, loc.lon),
  ]);
  const tides = tideResult.status === "fulfilled" ? tideResult.value : null;
  const observations = obsResult.status === "fulfilled" ? obsResult.value : null;

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

  return { isCoastal: true, marine, tides, observations, surf, waters, zoneId };
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
      day: 1,
      catLabel: findCatLabel(cat1),
      tornado: t1.risk, tornCig: t1.cig,
      wind:    w1.risk, windCig: w1.cig,
      hail:    h1.risk, hailCig: h1.cig,
    },
    {
      day: 2,
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

  return results.map((r, index) => ({
    day: index + 1,
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
  if (uv < 3) return "Low. Minimal protection is generally needed.";
  if (uv < 6) return "Moderate. Use sunscreen and seek shade around midday.";
  if (uv < 8) return "High. Reduce midday exposure and use sun protection.";
  if (uv < 11) return "Very high. Minimize midday exposure and cover up.";
  return "Extreme. Avoid midday sun when possible and use full protection.";
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

// The accent theme (`data-theme`) and the condition class (`data-condition`)
// are applied together, so night wins outright here: rain after dark is
// `theme="midnight" condition="rain"`, and the stylesheet layers the rain
// accents over the night palette. Previously the condition tests ran first and
// returned "sunny", which is how a rainy or foggy midnight got the daytime
// theme — and, because `isNightPeriod` keys off `theme === "midnight"`, the
// daytime icons to go with it.
function chooseTheme(current) {
  const text = `${current.condition || ""}`.toLowerCase();
  const { night, sunset } = skyDaylight();
  if (night) return "midnight";
  if (text.includes("thunder") || text.includes("storm") || text.includes("heavy rain")) return "storm";
  if (sunset) return "sunset";
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
  return `<span class="weather-icon" aria-hidden="true">${WeatherIcons.fromText(type, forceDay ? false : isNightPeriod(type), { animated: true })}</span>`;
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
    condition:   current.condition,
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
  // Recomputed here rather than read off the payload so switching units
  // rewrites the numbers inside the sentence too.
  document.querySelector("#weatherSummary").textContent =
    nowSummary(weatherState.hourly, selectedLocation.timezone, current.condition) || current.summary;
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
  currentMetricGuide = metrics;

  metricGrid.innerHTML = metrics.map(([icon, name, value, detail], index) => `
    <article class="tile metric">
      <div class="metric-head">
        ${uiIcon(icon)}
        <p class="eyebrow">${name}</p>
        <button type="button" class="mini-info-btn metric-info-btn" data-current-metric-info="${index}" aria-label="Explain ${safeText(name)}">i</button>
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
    const iconHtml = `<span class="weather-icon" aria-hidden="true">${WeatherIcons.fromText(iconForCondition(hour.shortForecast), isHourNight, { animated: true })}</span>`;
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
  const fs   = Math.max(10, Math.min(13, W / 68));  // value label size
  const tfs  = Math.max(9,  Math.min(11, W / 92));  // time label size
  // The padding is derived from the type sizes rather than fixed, because
  // everything that used to spill out of the chart spilled out of a corner:
  // the first and last value labels ran past the left/right edges, a label on
  // the highest point clipped against the top, and a label under the lowest
  // point landed in the row of hour labels. Reserve a gutter wide enough for
  // half a value label on each side, and a band tall enough for a full one
  // above the plot and below it.
  const padL = Math.round(fs * 1.8), padR = Math.round(fs * 1.8);
  const padT = Math.round(fs + 20), padB = Math.round(fs + tfs + 15);
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
  const step = W < 450 ? 4 : 3;                     // label every Nth hour

  // Rough advance width for the 800-weight UI font. Good enough to keep labels
  // inside the frame and off each other without measuring text in the DOM.
  const textW = str => str.length * fs * 0.6;

  // Value labels sit above their point by default. On a valley — a point lower
  // than both neighbours — "above" is the inside of the dip, where the label
  // lands right on the curve, so those flip underneath. Either placement is
  // then clamped into the plot's padding band rather than being allowed to run
  // off the top of the chart or down into the hour labels.
  const labelY = (y, i) => {
    const prevY = i > 0 ? pts[i - 1][1] : y;
    const nextY = i < pts.length - 1 ? pts[i + 1][1] : y;
    const valley = y > prevY && y > nextY;          // larger y = lower value
    const above = y - 9;
    const below = y + fs + 7;
    if (valley && below <= H - padB + fs + 6) return below;
    if (above >= fs + 3) return above;
    return below;
  };

  // Walk left to right and drop any label that would collide with the last one
  // kept. The FWI metric prints "62 Pleasant" rather than a bare number, so on
  // a narrow screen consecutive labels used to overprint each other.
  let labelRight = -Infinity;
  const dotsSvg = pts.map(([x, y], i) => {
    const show = (i % step === 0 || i === pts.length - 1);
    const vStr = cfg.formatValue ? cfg.formatValue(vals[i], hourly[i]) : `${vals[i]}${cfg.unit}`;
    const half = textW(vStr) / 2;
    // Nudge end labels inward so they stay inside the viewBox instead of being
    // clipped in half by the chart's rounded frame.
    const lx = Math.min(W - 3 - half, Math.max(3 + half, x));
    const fits = show && lx - half > labelRight + 6;
    if (fits) labelRight = lx + half;
    return `
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${show ? 3.5 : 2}"
        fill="${col}" stroke="rgba(2,6,23,0.85)" stroke-width="${show ? 1.8 : 1.2}"
        opacity="${show ? 1 : 0.5}" data-hour-index="${i}"/>
      ${fits ? `<text x="${lx.toFixed(1)}" y="${labelY(y, i).toFixed(1)}" text-anchor="middle"
        fill="${col}" font-size="${fs}" font-weight="800" paint-order="stroke"
        stroke="rgba(2,6,23,0.55)" stroke-width="2.6" stroke-linejoin="round"
        font-family="Inter,system-ui,sans-serif">${safeText(vStr)}</text>` : ""}`;
  }).join("");

  const timeSvg = hourly.map((h, i) => {
    if (i % step !== 0 && i !== hourly.length - 1) return "";
    const t = new Date(h.startTime);
    const lbl = i === 0 ? "Now" : t.toLocaleTimeString([], { hour: "numeric" });
    const half = lbl.length * tfs * 0.55 / 2;
    const lx = Math.min(W - 3 - half, Math.max(3 + half, xFor(i)));
    return `<text x="${lx.toFixed(1)}" y="${(H - 5).toFixed(1)}" text-anchor="middle"
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
    // Keep the card inside the frame horizontally, and flip it below the point
    // when there is no room above — clamping it to the top edge instead used to
    // park it on top of the value labels and the start of the line.
    const tx = Math.max(3, Math.min(W - 3 - tipW, cx - tipW / 2));
    const ty = cy - tipH - 12 >= 3 ? cy - tipH - 12 : Math.min(H - tipH - 3, cy + 14);
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
  const ecccColor = alert.source === "ECCC" ? ecccRiskColor(alert.riskColor) : "";
  if (event.includes("tornado warning") && ecccColor === "red") return 1000;
  if (event.includes("tornado warning") && ecccColor === "orange") return 900;
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

// On a phone the alert panel used to push the entire dashboard below the fold:
// four stacked cards, each carrying a full headline paragraph, the county list
// and a row of tags. Every one of those details already lives in the alert
// modal a tap away, so the panel is now a list of single-line rows — event,
// when it expires, where — and anything past the first two collapses behind a
// "show more" toggle.
const ALERT_COLLAPSE_AFTER = 2;
let alertsExpanded = false;

// "Lancaster, PA; Berks, PA; Lebanon, PA" is three lines on a phone. One area
// plus a count is enough to know whether it's you.
function alertAreaShort(areaDesc) {
  if (!areaDesc) return "";
  const areas = areaDesc.split(/;\s*/).map(a => a.trim()).filter(Boolean);
  if (!areas.length) return "";
  return areas.length > 1 ? `${areas[0]} +${areas.length - 1}` : areas[0];
}

function alertExpiryLabel(alert) {
  if (!alert.expires) return "";
  const expires = new Date(alert.expires);
  if (Number.isNaN(expires.getTime())) return "";
  const time = expires.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sameDay = expires.toDateString() === new Date().toDateString();
  return sameDay ? `until ${time}` : `until ${expires.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

function renderAlerts() {
  const alerts = [...(weatherState.alerts || [])].sort((a, b) => alertPriority(b) - alertPriority(a));
  weatherState.alerts = alerts;
  if (!alerts.length) {
    alertsPanel.hidden = true;
    alertsPanel.innerHTML = "";
    alertsExpanded = false;
    return;
  }
  const hasMore = alerts.length > ALERT_COLLAPSE_AFTER;
  const shown = hasMore && !alertsExpanded ? alerts.slice(0, ALERT_COLLAPSE_AFTER) : alerts;

  alertsPanel.hidden = false;
  alertsPanel.innerHTML = `
    <div class="alert-head">
      <span class="alert-head-count">${alerts.length} active alert${alerts.length > 1 ? "s" : ""}</span>
      <span class="alert-head-source">${safeText(weatherState.alertSource || "NWS")}</span>
    </div>
    <div class="alert-list">
      ${shown.map((alert, index) => {
        const meta = [alertExpiryLabel(alert), alertAreaShort(alert.areaDesc)].filter(Boolean).join(" · ");
        // Each row carries its own event color so the panel matches the polygon
        // on the map and the swatch on weather.gov.
        const color = alertEventColor(alert.event || "", alert.severity || "");
        return `
        <button class="alert-row severity-${safeText((alert.severity || "unknown").toLowerCase())}" type="button" data-alert-index="${index}" style="--alert-color:${safeText(color.fill)};--alert-edge:${safeText(color.line)}">
          <span class="alert-row-text">
            <span class="alert-row-event">${safeText(alertDisplayEvent(alert))}</span>
            ${meta ? `<span class="alert-row-meta">${safeText(meta)}</span>` : ""}
          </span>
          <svg class="alert-row-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>
        </button>`;
      }).join("")}
    </div>
    ${hasMore ? `
      <button class="alert-more" type="button" data-alert-toggle aria-expanded="${alertsExpanded}">
        ${alertsExpanded ? "Show fewer" : `Show ${alerts.length - ALERT_COLLAPSE_AFTER} more`}
      </button>` : ""}
  `;
}

function normalizeAlertNotificationId(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/api\.weather\.gov\/alerts\//i, "")
    .replace(/\/actual$/i, "")
    .toLowerCase();
}

function notificationParameterValues(parameters, name) {
  const value = parameters?.[name];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value == null || value === "" ? [] : [value];
}

function alertNotificationVtecId(alert) {
  const p = alert.parameters || {};
  const vtec = [
    ...notificationParameterValues(p, "VTEC"),
    ...notificationParameterValues(p, "vtec"),
  ];
  const text = [...vtec, alert.description || "", alert.headline || ""].join("\n");
  const match = text.match(/\/[OTEX]\.[A-Z]{3}\.([A-Z0-9]{4})\.([A-Z]{2})\.([A-Z])\.(\d{4})\.(\d{6})T\d{4}Z-(\d{6})T\d{4}Z/i);
  if (!match) return "";
  const yearStamp = match[5] === "000000" ? match[6] : match[5];
  return `nws-vtec:${match[1].toUpperCase()}.${match[2].toUpperCase()}.${match[3].toUpperCase()}.${match[4]}.${yearStamp.slice(0, 2)}`;
}

function alertReferenceIds(references) {
  const items = Array.isArray(references) ? references : [references];
  return items.flatMap(reference => {
    if (!reference) return [];
    if (typeof reference === "object") {
      return [reference.identifier || reference.id || reference["@id"]].filter(Boolean);
    }
    return String(reference).trim().split(/\s+/).map(value => {
      const fields = value.split(",");
      return fields.length >= 3 ? fields[1] : value;
    }).filter(Boolean);
  });
}

function alertNotificationIds(alert) {
  const values = [
    alertNotificationVtecId(alert),
    alert.id || [alert.event, alert.effective, alert.expires, alert.headline].filter(Boolean).join("|"),
    ...alertReferenceIds(alert.references),
  ];
  const seen = new Set();
  return values.filter(value => {
    const normalized = normalizeAlertNotificationId(value);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function alertNotificationId(alert) {
  return alertNotificationVtecId(alert) || alertNotificationIds(alert)[0] || "weather-alert";
}

function alertMatchesNotificationIds(alert, ids) {
  const normalizedIds = new Set(Array.from(ids || []).map(normalizeAlertNotificationId));
  return alertNotificationIds(alert).some(id => normalizedIds.has(normalizeAlertNotificationId(id)));
}

function notificationTagLabel(value) {
  const text = String(value || "").replace(/_/g, " ").trim().toLowerCase();
  if (!text) return "";
  if (text === "pds") return "PDS";
  return text.replace(/\b\w/g, letter => letter.toUpperCase());
}

function warningNotificationTags(alert) {
  const event = String(alert.event || "").toLowerCase();
  const targetedWarning = event === "severe thunderstorm warning" ||
    event === "tornado warning" || event === "flash flood warning";
  if (!targetedWarning) return [];
  const p = alert.parameters || {};
  const parameter = event === "severe thunderstorm warning"
    ? "thunderstormDamageThreat"
    : event === "tornado warning" ? "tornadoDamageThreat" : "flashFloodDamageThreat";
  const text = `${alert.headline || ""} ${alert.description || ""}`;
  const raw = [
    notificationParameterValues(p, parameter)[0],
    event === "tornado warning" && notificationParameterValues(p, "tornadoDetection")[0],
    event === "flash flood warning" && notificationParameterValues(p, "flashFloodDetection")[0],
    /particularly dangerous situation/i.test(text) && "PDS",
    /\b(tornado|flash flood) emergency\b/i.test(text) && "Emergency",
  ];
  if (event === "severe thunderstorm warning") {
    raw.push([
      ...notificationParameterValues(p, "windThreat"),
      ...notificationParameterValues(p, "hailThreat"),
    ]
      .find(value => /observed|radar indicated/i.test(String(value))));
  }
  const seen = new Set();
  return raw.map(notificationTagLabel).filter(tag => {
    const key = tag.toLowerCase();
    if (!tag || key === "base" || key === "none" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function notificationMeasurement(value, unit) {
  const text = String(value || "").trim();
  const number = text.match(/\d*\.?\d+/)?.[0];
  return number ? `${parseFloat(number)} ${unit}` : text;
}

function alertNotificationContent(alert) {
  const displayEvent = alertDisplayEvent(alert);
  const tags = warningNotificationTags(alert);
  const details = [...tags];
  if (/^severe thunderstorm warning$/i.test(alert.event || "")) {
    const wind = notificationParameterValues(alert.parameters, "maxWindGust")[0];
    const hail = notificationParameterValues(alert.parameters, "maxHailSize")[0];
    if (wind) details.push(`Max wind: ${notificationMeasurement(wind, "mph")}`);
    if (hail) details.push(`Max hail: ${notificationMeasurement(hail, "in")}`);
  }
  const expiry = alertExpiryLabel(alert);
  if (expiry) details.push(expiry.charAt(0).toUpperCase() + expiry.slice(1));
  return {
    title: tags[0] ? `${displayEvent} — ${tags[0]}` : displayEvent,
    body: details.length
      ? details.join(" • ")
      : alert.headline || alert.description || `New alert for ${selectedLocation.name}`,
  };
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
  const ids = [...new Set((weatherState.alerts || []).flatMap(alertNotificationIds).filter(Boolean))];
  localStorage.setItem("weatherSeenAlertIds", JSON.stringify(ids));
}

async function showAlertNotification(alert) {
  if (!notificationsEnabled()) return;
  const { title, body } = alertNotificationContent(alert);
  const options = {
    body,
    tag: alertNotificationId(alert),
    renotify: false,
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
  const currentIds = [...new Set(alerts.flatMap(alertNotificationIds).filter(Boolean))];
  if (suppressNextAlertNotifications || storedIds == null) {
    localStorage.setItem("weatherSeenAlertIds", JSON.stringify(currentIds));
    suppressNextAlertNotifications = false;
    return;
  }
  const oldIds = new Set(JSON.parse(storedIds || "[]"));
  const newAlerts = alerts.filter(alert => !alertMatchesNotificationIds(alert, oldIds));
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
        const ids = Array.isArray(event.data.ids) ? event.data.ids : [event.data.id];
        ids.filter(Boolean).forEach(id => existing.add(id));
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

// Outlook feeds are numbered relative to today, while an NWS daily forecast
// can begin with tomorrow once today's daytime period has ended. Match by the
// period's local calendar date instead of its position in the forecast array so
// an expired Day 1 risk is never attached to tomorrow's card overnight.
function localCalendarParts(value, timeZone = "UTC") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const read = type => Number(parts.find(part => part.type === type)?.value);
  const year = read("year"), month = read("month"), day = read("day");
  return year && month && day ? { year, month, day } : null;
}

function localCalendarDayOffset(from, to, timeZone = "UTC") {
  const a = localCalendarParts(from, timeZone);
  const b = localCalendarParts(to, timeZone);
  if (!a || !b) return null;
  const aUtc = Date.UTC(a.year, a.month - 1, a.day);
  const bUtc = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((bUtc - aUtc) / 86400000);
}

function outlookForForecastPeriod(outlooks = [], period, now = new Date(), timeZone = "UTC") {
  if (!period?.startTime) return null;
  const offset = localCalendarDayOffset(now, period.startTime, timeZone);
  if (offset == null || offset < 0) return null;
  return outlooks.find(outlook => Number(outlook?.day) === offset + 1) || null;
}

// Trim any leftover provider prose down to a sentence or two, dropping the
// boilerplate precipitation-accumulation lines nobody reads.
function condenseProviderText(detailed, fallback) {
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
  return (parts.join(". ") + (parts.length ? "." : "")).trim() || fallback;
}

/* ── Daily summary sentence frames ────────────────────────────────────────────
   Every list below is interchangeable within itself: the pieces they take are
   already-formed clauses ("topping out near 84°"), so any frame can pair with
   any set of numbers without the grammar coming apart. Sky adjectives are the
   one thing to watch — they are used both capitalised at the head of a sentence
   ("Foggy and cool …") and lowercased mid-sentence ("Cool and foggy …"), so no
   frame may follow one with a noun. "Foggy skies" is not a thing anyone says.
*/

// "…, topping out near 84°." — the clause that carries the day's high.
const HIGH_CLAUSES = [
  t => `topping out near ${t}`,
  t => `with a high near ${t}`,
  t => `climbing to about ${t}`,
  t => `peaking around ${t}`,
  t => `reaching ${t} at the warmest`,
  t => `with ${t} at the top of the day`,
];

// Dry-day openers. `adj` arrives capitalised.
const DRY_OPENERS = [
  ({ adj, feel, highClause }) => `${adj} and ${feel}, ${highClause}.`,
  ({ adj, feel, highClause }) => `${capitalize(feel)} and ${adj.toLowerCase()}, ${highClause}.`,
  ({ adj, feel, highClause }) => `${adj}, ${feel}, ${highClause}.`,
  ({ adj, feel, highClause }) => `A ${feel}, ${adj.toLowerCase()} day, ${highClause}.`,
];

// The same, when there is no temperature to hang the sentence on.
const DRY_OPENERS_NO_TEMP = [
  ({ adj }) => `${adj} through the day.`,
  ({ adj }) => `${adj} for most of the day.`,
  ({ adj }) => `${adj}, start to finish.`,
];

// Wet-day openers. `lead` is the precipitation and its timing, already
// capitalised — "Rain from 2 PM to 7 PM", "Thunderstorms around 4 PM".
const WET_OPENERS = [
  ({ lead, highClause }) => `${lead}, ${highClause}.`,
  ({ lead, highClause }) => `${lead} — ${highClause}.`,
  ({ lead, highClause }) => `Expect ${lead.toLowerCase()}, ${highClause}.`,
];

// "Watch for scattered rain and winds gusting to 35 mph."
const WATCH_FRAMES = [
  joined => `Watch for ${joined}`,
  joined => `Keep an eye out for ${joined}`,
  joined => `Worth planning around ${joined}`,
  joined => `The wrinkle: ${joined}`,
  joined => `Also in the mix: ${joined}`,
];

// The overnight low appears in two positions — trailing a "Watch for …"
// sentence ("…, with lows near 62°.") and standing alone as its own sentence
// ("Dipping to 62° after dark."). A gerund reads well in the second and not at
// all in the first ("with dipping to 62°"), so each entry carries both forms
// rather than one string being bent into both jobs.
const LOW_CLAUSES = [
  { after: t => `lows near ${t}`,            solo: t => `Lows near ${t}.` },
  { after: t => `a low of ${t} after dark`,  solo: t => `Dipping to ${t} after dark.` },
  { after: t => `${t} overnight`,            solo: t => `Settling back to ${t} overnight.` },
  { after: t => `${t} by morning`,           solo: t => `${t} by morning.` },
];

const FREEZING_LOW_CLAUSES = [
  { after: t => `a freezing ${t} overnight`,          solo: t => `A freezing ${t} overnight.` },
  { after: t => `a hard freeze at ${t} after dark`,   solo: t => `A hard freeze at ${t} after dark.` },
  { after: t => `${t} and freezing by morning`,       solo: t => `Down to a freezing ${t} by morning.` },
];

// Writes the one-or-two-sentence blurb on a daily card. Composed from the
// numbers rather than lifted from a forecast product, so it reads like a person
// describing the day: what the sky does, how warm it gets, whether you'll get
// rained on and roughly when, and the overnight low to plan around.
//
// `options.variant` is the card's position in the list; it selects between the
// sentence frames above so a settled week doesn't print one sentence seven
// times. Pass the same value for a given day everywhere it is rendered (card
// and modal) so the two agree.
function generateDailySummary(day, precip, night, options = {}) {
  if (!day) return "Forecast details unavailable.";
  // Providers that publish genuinely readable prose (Environment Canada) keep it.
  const detailed = (day.detailedForecast || "").trim();
  if (detailed) return condenseProviderText(detailed, day.shortForecast || "");
  if (day.weatherCode == null) return day.shortForecast || "Forecast details unavailable.";

  const v = options.variant || 0;
  const tz = selectedLocation.timezone || "America/New_York";
  const high = day.temperature;
  const low = night?.temperature;
  const pop = precip ?? day.probabilityOfPrecipitation?.value;
  const sky = skyPhrase(day.weatherCode, true);
  const adjective = skyAdjective(day.weatherCode, true);
  const feel = temperatureFeel(high);
  const wet = isWetCode(day.weatherCode);
  const likelyPrecip = !wet && hasLikelyPrecipitation(pop);
  const highClause = high != null
    ? pickPhrase(HIGH_CLAUSES, "high", v)(`${uTempNum(high)}${tempUnit()}`)
    : null;

  const sentences = [];

  // Opening line: the sky and the high, joined the way you'd say it aloud.
  if (wet || likelyPrecip) {
    const noun = periodPrecipNoun(day.weatherCode, day.precipWindow);
    const timing = wetSpellTiming(day, tz);
    const lead = wet
      ? capitalize(day.weatherCode >= 95 ? "thunderstorms" : noun) + (timing ? ` ${timing}` : "")
      : capitalize(precipitationChancePhrase(pop, noun)) + (timing ? ` ${timing}` : "");
    sentences.push(highClause
      ? pickPhrase(WET_OPENERS, "wet", v)({ lead, highClause })
      : `${lead}.`);
  } else if (adjective && feel && highClause) {
    sentences.push(pickPhrase(DRY_OPENERS, "dry", v)({ adj: adjective, feel, highClause }));
  } else if (adjective && highClause) {
    sentences.push(`${adjective}, ${highClause}.`);
  } else if (adjective) {
    sentences.push(pickPhrase(DRY_OPENERS_NO_TEMP, "dryflat", v)({ adj: adjective }));
  } else if (sky) {
    sentences.push(`${capitalize(sky)} through the day.`);
  }

  // Second line: the things that would change your plans. Everything here is a
  // noun phrase so it slots into one "Watch for …" frame without the grammar
  // going sideways when two of them land in the same day.
  const watchFor = [];
  if (!wet && !likelyPrecip) {
    const phrase = precipPhrase(pop, periodPrecipNoun(
      night && isWetCode(night.weatherCode) ? night.weatherCode : day.weatherCode,
      day.precipWindow,
    ));
    if (phrase) {
      const timing = wetSpellTiming(day, tz);
      watchFor.push(`${phrase}${timing ? ` ${timing}` : ""}`);
    }
  }
  const gust = numericWind(day.windGust);
  if (gust != null && gust >= 30) watchFor.push(`winds gusting to ${fmtWind(gust)}`);
  const snow = day.snowAmount;
  if (snow != null && snow >= 0.5) {
    const amount = unitChoice("precip") === "mm"
      ? `${(snow * 2.54).toFixed(0)} cm`
      : `${snow.toFixed(snow < 2 ? 1 : 0)} in`;
    watchFor.push(`around ${amount} of snow`);
  }

  // The day modal prints a dedicated overnight line right below, so the low is
  // dropped there rather than said twice.
  const lowText = `${uTempNum(low)}${tempUnit()}`;
  const lowClause = low != null && options.includeOvernight !== false
    ? pickPhrase(low <= 32 ? FREEZING_LOW_CLAUSES : LOW_CLAUSES, "low", v)
    : null;

  if (watchFor.length) {
    const joined = watchFor.length > 1
      ? `${watchFor.slice(0, -1).join(", ")} and ${watchFor[watchFor.length - 1]}`
      : watchFor[0];
    sentences.push(`${pickPhrase(WATCH_FRAMES, "watch", v)(joined)}${lowClause ? `, with ${lowClause.after(lowText)}` : ""}.`);
  } else if (lowClause) {
    sentences.push(lowClause.solo(lowText));
  }

  return sentences.join(" ") || day.shortForecast || "Forecast details unavailable.";
}

// Overnight frames. `sky` is a clause ("clear skies", "passing clouds"),
// `lowText` the formatted temperature, `late` an optional trailing chance.
const NIGHT_DRY_FRAMES = [
  ({ sky, lowText }) => `${capitalize(sky)} overnight, with a low around ${lowText}`,
  ({ sky, lowText }) => `${capitalize(sky)} after dark, bottoming out near ${lowText}`,
  ({ sky, lowText }) => `Expect ${sky} overnight and a low of about ${lowText}`,
  ({ sky, lowText }) => `${capitalize(sky)} through the night, down to ${lowText}`,
];

const NIGHT_WET_FRAMES = [
  ({ noun, lowText }) => `Overnight ${noun}, with a low around ${lowText}`,
  ({ noun, lowText }) => `${capitalize(noun)} after dark, bottoming out near ${lowText}`,
  ({ noun, lowText }) => `${capitalize(noun)} continuing overnight, down to about ${lowText}`,
];

const NIGHT_LATE_FRAMES = [
  phrase => `and ${phrase} possible late`,
  phrase => `with ${phrase} not out of the question`,
  phrase => `and an outside chance of ${phrase}`,
];

// The overnight companion to generateDailySummary: a low, not a high, and no
// talk of sun.
function generateNightSummary(night, precip, variant = 0) {
  if (!night) return "";
  const v = Number(variant) || 0;
  const low = night.temperature;
  const pop = precip ?? night.probabilityOfPrecipitation?.value;
  const wet = isWetCode(night.weatherCode);
  const likelyPrecip = !wet && hasLikelyPrecipitation(pop);
  const lowText = low != null ? `${uTempNum(low)}${tempUnit()}` : null;
  const bits = [];

  if (wet) {
    const noun = periodPrecipNoun(night.weatherCode, night.precipWindow);
    bits.push(lowText
      ? pickPhrase(NIGHT_WET_FRAMES, "nightwet", v)({ noun, lowText })
      : `Overnight ${noun}`);
  } else if (likelyPrecip) {
    const chance = capitalize(precipitationChancePhrase(pop, periodPrecipNoun(night.weatherCode, night.precipWindow)));
    bits.push(lowText
      ? `${chance} overnight, with a low around ${lowText}`
      : `${chance} overnight`);
  } else {
    const sky = skyPhrase(night.weatherCode, false);
    if (sky && lowText)   bits.push(pickPhrase(NIGHT_DRY_FRAMES, "nightdry", v)({ sky, lowText }));
    else if (sky)         bits.push(`${capitalize(sky)} overnight`);
    else if (lowText)     bits.push(`A quiet night, down to about ${lowText}`);
    else                  bits.push("Quiet overnight");
  }

  if (!wet && !likelyPrecip) {
    const phrase = precipPhrase(pop, periodPrecipNoun(night.weatherCode, night.precipWindow));
    if (phrase) bits.push(pickPhrase(NIGHT_LATE_FRAMES, "nightlate", v)(phrase));
  }
  return `${bits.join(" ")}.`;
}

function clockLabel(iso, tz) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  // Drop ":00" so the common on-the-hour case reads "3 PM", not "3:00 PM".
  return date.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })
    .replace(":00", "");
}

// When the wet weather actually shows up during a period. Prefers a real clock
// time — "around 3 PM", "from 2 PM to 7 PM" — and only falls back to a vague
// part of the day when the window is too ragged to pin down.
function wetSpellTiming(period, tz) {
  const window = period?.precipWindow;
  if (!window) return null;

  // Wet for most of the period: no single time worth naming.
  if (window.hours >= Math.max(6, (window.periodHours || 12) * 0.6)) {
    return period.isDaytime === false ? "on and off overnight" : "on and off through the day";
  }

  const start = clockLabel(window.start, tz);
  if (!start) return `moving in ${dayPartLabel(new Date(window.start), tz)}`;
  if (window.hours <= 2) return `around ${start}`;

  const end = clockLabel(window.end, tz);
  return end ? `from ${start} to ${end}` : `starting around ${start}`;
}

function renderDaily() {
  const days = getDailyPairs(weatherState.daily || []);

  const extras = weatherState.dailyExtras || {};
  const pollenForecast = weatherState.pollenForecast || [];
  const outlookTimeZone = selectedLocation.timezone || "UTC";
  const sourceLabel = document.querySelector("#extended-source-label");
  const sourceNote = document.querySelector("#extended-source-note");
  const source = String(weatherState.forecastSource || "");
  const nwsForecast = /NWS|weather\.gov/i.test(source);
  if (sourceLabel) sourceLabel.textContent = nwsForecast ? "Official NWS Forecast" : (source || "Forecast");
  if (sourceNote) sourceNote.textContent = nwsForecast
    ? "NWS point forecast · official SPC/WPC outlook tags"
    : `${source || "Weather forecast"} · outlook tags shown where available`;
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
      weatherCode: day.weatherCode,
      month:       dayMonth,
      variant:     index,
    });

    const spcDay = outlookForForecastPeriod(weatherState.spcDays, day, new Date(), outlookTimeZone);
    const spcCat = spcDay?.catLabel || null;
    const spcColor = spcRiskColor(spcCat);
    const spcBadge = (spcColor && spcCat !== "TSTM")
      ? `<span class="spc-risk-badge" aria-label="SPC severe thunderstorm risk: ${safeText(spcLabel(spcCat))}" style="background:${spcColor}22;color:${spcColor};border:1px solid ${spcColor}88" title="Triangle = severe thunderstorms · SPC Day ${spcDay.day} ${spcLabel(spcCat)}"><svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" style="vertical-align:-1px" aria-hidden="true"><path d="M12 2L2 22h20L12 2zm0 14.5a.75.75 0 110 1.5.75.75 0 010-1.5zm-.75-5.5h1.5v5h-1.5V11z"/></svg> ${safeText(spcCat)}</span>`
      : "";

    const wpcDay = outlookForForecastPeriod(weatherState.wpcDays, day, new Date(), outlookTimeZone);
    const wpcCat = wpcDay?.label || null;
    const wpcColor = spcRiskColor(wpcCat);
    const wpcBadge = (wpcColor && wpcCat)
      ? `<span class="spc-risk-badge wpc-risk-badge" aria-label="WPC excessive rainfall and flash flooding risk: ${safeText(wpcCat)}" style="background:${wpcColor}22;color:${wpcColor};border:1px solid ${wpcColor}88" title="Rain cloud = excessive rainfall and flash flooding · WPC Day ${wpcDay.day} ${wpcCat}"><svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="vertical-align:-1px" aria-hidden="true"><path d="M20 16.2A4.5 4.5 0 0 0 17.5 8h-1.8A7 7 0 1 0 4 14.9"/><line x1="8" y1="19" x2="8" y2="21"/><line x1="12" y1="17" x2="12" y2="19"/><line x1="16" y1="19" x2="16" y2="21"/></svg> ${safeText(wpcCat)}</span>`
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
      <p class="daily-summary">${safeText(generateDailySummary(day, precip, night, { variant: index }))} <span style="color:${fwi.color};opacity:0.9">${safeText(fwi.sentence)}</span></p>
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
    weatherCode: day.weatherCode,
    month: periodDate.getMonth(),
    variant: index,
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
  {
    const spcDay = outlookForForecastPeriod(
      weatherState.spcDays, day, new Date(), selectedLocation.timezone || "UTC",
    );
    const catLabel = spcDay?.catLabel || null;
    if (catLabel) {
      risks.push({ color: spcRiskColor(catLabel) || "#fbbf24", icon: "severe",
        title: catLabel === "TSTM" ? "General thunderstorms possible" : `${spcLabel(catLabel)} of severe storms`,
        sub: `${spcDaySummary(spcDay)} — SPC Day ${spcDay.day} convective outlook`.trim() });
    }
  }
  {
    const wpcDay = outlookForForecastPeriod(
      weatherState.wpcDays, day, new Date(), selectedLocation.timezone || "UTC",
    );
    if (wpcDay?.label) {
      const wpcNames = { MRGL: "Marginal", SLGT: "Slight", MDT: "Moderate", HIGH: "High" };
      const wpcSummary = wpcDaySummary(wpcDay.label);
      risks.push({ color: spcRiskColor(wpcDay.label) || "#60a5fa", icon: "precip",
        title: `${wpcNames[wpcDay.label] || wpcDay.label} risk of excessive rainfall`,
        sub: `${wpcSummary ? `${wpcSummary} — ` : ""}WPC Day ${wpcDay.day} excessive rainfall outlook` });
    }
  }
  const riskHtml = risks.length ? `<div class="day-modal-risks">${risks.map(risk => `
    <div class="day-modal-risk" style="border-color:${risk.color}55;background:${risk.color}14">
      <span class="day-modal-risk-icon" style="color:${risk.color}">${uiIcon(risk.icon)}</span>
      <div><strong style="color:${risk.color}">${safeText(risk.title)}</strong><small>${safeText(risk.sub)}</small></div>
    </div>`).join("")}</div>` : "";

  // With the forecast coming from model output rather than a written product,
  // the narrative is composed from the day's own numbers.
  const nightBlurb = night && night.weatherCode != null
    ? generateNightSummary(night, precipNight, index)
    : (night?.detailedForecast ? `Night: ${night.detailedForecast}` : "");
  const discussion = [generateDailySummary(day, precipDay, night, { includeOvernight: !nightBlurb, variant: index }), nightBlurb].filter(Boolean);

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
        `<span class="weather-icon" aria-hidden="true">${WeatherIcons.fromText(iconForCondition(night.shortForecast), true, { animated: true })}</span>`,
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
  const ecccColor = alert.source === "ECCC" ? ecccRiskColor(alert.riskColor) : "";
  if (ecccColor && isColorTieredEcccWarning(event)) {
    return `${titleCaseAlertName(ecccColor)} ${event}`;
  }
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
    { label: "PDS",       color: "#a855f7", desc: "Particularly Dangerous Situation — a strong tornado is likely ongoing. Take shelter immediately in a lowest-floor interior room away from windows." },
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

// Canadian color tiers represent the same escalation as the corresponding
// NWS warning ladders, but keep ECCC's color and impact terminology. The
// descriptions intentionally mirror the existing US guidance at each level.
const ECCC_ALERT_LEVEL_CATEGORIES = {
  "Tornado Warning": [
    { label: "YELLOW · MODERATE", riskColor: "yellow", color: "#eab308", desc: "A tornado is imminent or occurring. Take shelter immediately in a lowest-floor interior room away from windows." },
    { label: "ORANGE · HIGH", riskColor: "orange", color: "#f97316", desc: "An especially dangerous tornado threat is underway, and a strong tornado is likely. Take shelter immediately in a lowest-floor interior room away from windows." },
    { label: "RED · EXTREME", riskColor: "red", color: "#dc2626", desc: "A confirmed, exceptionally dangerous tornado is producing devastating damage. This is the highest-level tornado warning — act immediately." },
  ],
  "Severe Thunderstorm Warning": [
    { label: "YELLOW · MODERATE", riskColor: "yellow", color: "#eab308", desc: "Damaging winds and/or large hail from severe thunderstorms. Move indoors and away from windows." },
    { label: "ORANGE · HIGH", riskColor: "orange", color: "#f97316", desc: "Particularly dangerous storm with winds 70–80+ mph or hail 1.75\"+ diameter. Seek sturdy shelter immediately." },
    { label: "RED · EXTREME", riskColor: "red", color: "#dc2626", desc: "Extremely dangerous storm with wind damage threat 80+ mph and/or hail 2.75\"+ diameter. Catastrophic damage likely." },
  ],
};

function activeNwsAlertLevel(event = "", tags = []) {
  const currentTagsLower = tags.map(tag => String(tag).toLowerCase());
  if (/\bwatch\b/i.test(event)) {
    if (currentTagsLower.some(tag => tag.includes("pds") || tag.includes("particularly dangerous"))) return "PDS WATCH";
    return "WATCH";
  }
  if (currentTagsLower.some(tag => tag.includes("emergency"))) return "EMERGENCY";
  if (currentTagsLower.some(tag => tag.includes("pds") || tag.includes("particularly dangerous"))) return "PDS";
  if (currentTagsLower.some(tag => tag.includes("destructive"))) return "DESTRUCTIVE";
  if (currentTagsLower.some(tag => tag.includes("considerable"))) return "CONSIDERABLE";
  // "Observed" confirms how a tornado was detected; it does not create a
  // separate tornado-warning level. Flash-flood warnings do have an Observed
  // row, so retain that behavior only for that event.
  if (/flash flood warning/i.test(event) && currentTagsLower.some(tag => tag.includes("observed"))) return "OBSERVED";
  return "WARNING";
}

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

  modalEyebrow.textContent = "Weather Alert";
  modalTitle.textContent = displayEvent;

  // Severity badge colors
  const sevBg = { Extreme: "#dc262622", Severe: "#f9731622", Moderate: "#f59e0b22", Minor: "#22d3ee22" };
  const sevColor = { Extreme: "#ef4444", Severe: "#fb923c", Moderate: "#fbbf24", Minor: "#67e8f9" };
  const bg = sevBg[severity] || "rgba(148,163,184,0.15)";
  const col = sevColor[severity] || "#94a3b8";

  // Tags row. The event chip carries the alert's own weather.gov color so the
  // modal, the alert list and the map polygon all read as the same alert.
  const eventColor = alertEventColor(event, severity);
  const tagsHtml = `<div class="alert-modal-tags">
    <span class="alert-modal-tag alert-modal-event-tag" style="background:${safeText(eventColor.fill)}2e;color:${safeText(eventColor.line)};border:1px solid ${safeText(eventColor.line)}88">
      <span class="alert-modal-swatch" style="background:${safeText(eventColor.fill)}"></span>${safeText(displayEvent)}
    </span>
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
  const ecccCategories = alert.source === "ECCC" ? ECCC_ALERT_LEVEL_CATEGORIES[event] : null;
  const categories = ecccCategories || ALERT_LEVEL_CATEGORIES[event] || null;
  const activeLevel = categories
    ? (ecccCategories
      ? categories.find(category => category.riskColor === ecccRiskColor(alert.riskColor))?.label || null
      : activeNwsAlertLevel(event, tags))
    : null;
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
  renderOperationalForecasts(weatherState);
}

function operationalForecastHours(weather = weatherState) {
  return (weather?.hourly || []).slice(0, 18).filter((_, index) => index % 2 === 0).slice(0, 8);
}

function operationsTimeLabel(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString([], {
    timeZone: selectedLocation.timezone || "America/New_York",
    hour: "numeric",
  });
}

function renderOperationalForecasts(weather = weatherState) {
  const aviationEl = document.querySelector("#aviationForecast");
  const droneEl = document.querySelector("#droneForecast");
  if (!aviationEl || !droneEl) return;
  const hours = operationalForecastHours(weather);
  const source = weather?.forecastSource || forecastProviderFor();

  if (!hours.length) {
    const empty = `<p class="ops-empty">Operational forecast guidance is unavailable for this location right now.</p>`;
    aviationEl.innerHTML = empty;
    droneEl.innerHTML = empty;
    return;
  }

  aviationEl.innerHTML = `
    <div class="ops-source">Derived from ${safeText(source)} hourly forecast</div>
    <div class="ops-forecast-list">${hours.map(hour => {
      const flight = forecastFlightCategory(hour);
      const category = flight.category;
      const wind = numericWind(hour.windSpeed);
      const gust = numericWind(hour.windGust);
      const details = [
        hour.ceiling == null ? null : `${Math.round(hour.ceiling)} ft ceiling`,
        hour.visibility == null ? null : `${fmtVis(hour.visibility)} visibility`,
        wind == null ? null : `${fmtWind(wind)}${gust != null ? ` gust ${fmtWind(gust)}` : ""}`,
      ].filter(Boolean);
      if (hour.ceiling == null && hour.visibility == null) details.unshift("no ceiling/visibility restriction published");
      return `<div class="ops-row">
        <time>${safeText(operationsTimeLabel(hour.startTime))}</time>
        <span class="ops-badge flight-${category.toLowerCase()}">${safeText(category)}${flight.estimated ? " est." : ""}</span>
        <div><strong>${safeText(hour.shortForecast || "Forecast")}</strong><small>${safeText(details.join(" · "))}</small></div>
      </div>`;
    }).join("")}</div>
    <p class="ops-disclaimer">Planning outlook only. Check current METARs, TAFs, NOTAMs, and official aviation briefings before flight.</p>`;

  droneEl.innerHTML = `
    <div class="ops-source">Weather suitability from ${safeText(source)}</div>
    <div class="ops-forecast-list">${hours.map(hour => {
      const assessment = droneOperatingAssessment(hour);
      const wind = numericWind(hour.windSpeed);
      const weather = [
        wind == null ? null : `${fmtWind(wind)} wind`,
        hour.probabilityOfPrecipitation?.value == null ? null : `${Math.round(hour.probabilityOfPrecipitation.value)}% precip`,
      ].filter(Boolean).join(" · ");
      return `<div class="ops-row">
        <time>${safeText(operationsTimeLabel(hour.startTime))}</time>
        <span class="ops-badge drone-${assessment.level}">${safeText(assessment.label)}</span>
        <div><strong>${safeText(assessment.reasons.join(", "))}</strong><small>${safeText(weather || hour.shortForecast || "Forecast")}</small></div>
      </div>`;
    }).join("")}</div>
    <p class="ops-disclaimer">Advisory weather screen, not a go/no-go decision. Apply your aircraft limits, local rules, airspace authorization, VLOS requirements, and pilot judgment.</p>`;
}

// Kp runs 0-9; the descriptions are NOAA's own wording for the G scale.
function auroraNote(space) {
  if (!space) return "Live space weather data from NOAA SWPC is unavailable right now.";
  const kp = Number(space.kp);
  if (!Number.isFinite(kp)) return "Solar wind is being observed, but the planetary K index has not been published for this period yet.";
  const bzNote = Number(space.bz) <= -5
    ? " The interplanetary field is tilted southward, which couples the solar wind into Earth's magnetosphere more efficiently."
    : "";
  if (kp >= 7) return `Severe geomagnetic storming (Kp ${space.kp}). Aurora may be visible well into the mid-latitudes.${bzNote}`;
  if (kp >= 5) return `Geomagnetic storm conditions (Kp ${space.kp}). Aurora is possible at northern-tier latitudes given clear, dark skies.${bzNote}`;
  if (kp >= 4) return `Unsettled to active field (Kp ${space.kp}). Aurora is largely confined to high latitudes.${bzNote}`;
  return `Quiet geomagnetic field (Kp ${space.kp}). Aurora is unlikely outside the polar regions.${bzNote}`;
}

function renderSpace(space) {
  const values = [
    ["Kp Index", space?.kp ?? "--"],
    ["NOAA G-Scale", space?.gScale || "--"],
    ["Solar Wind", space?.solarWind != null ? `${space.solarWind} km/s` : "--"],
    ["Bz Field", space?.bz != null ? `${space.bz} nT` : "--"],
  ];
  document.querySelector("#spaceReadouts").innerHTML = values.map(([label, value]) => `
    <div class="space-item">
      <p class="eyebrow">${label}</p>
      <span class="space-value">${value}</span>
    </div>
  `).join("");

  const kp = Number(space?.kp);
  const bar = document.querySelector(".aurora-bar span");
  // Kp 0-9 across the bar, with a visible stub at Kp 0 so the meter still
  // reads as a meter. An unavailable feed empties it rather than parking it
  // at the same width a quiet sun would produce.
  if (bar) {
    const pct = Number.isFinite(kp) ? Math.min(100, Math.max(6, (kp / 9) * 100)) : 0;
    bar.style.width = `${pct}%`;
    // Paint the gradient at full-track scale so Kp 3 is always the same colour
    // whether or not the fill happens to end there.
    bar.style.setProperty("--aurora-track", pct ? `${(100 / pct) * 100}%` : "100%");
  }

  const note = document.querySelector("#spaceNote");
  if (note) note.textContent = auroraNote(space);
  const stamp = document.querySelector("#spaceUpdated");
  if (stamp) {
    stamp.textContent = space?.updated
      ? `NOAA SWPC · ${new Date(/Z$|[+-]\d\d:?\d\d$/.test(space.updated) ? space.updated : `${space.updated}Z`)
          .toLocaleTimeString([], { timeZone: selectedLocation.timezone || "America/New_York", hour: "numeric", minute: "2-digit" })}`
      : "NOAA SWPC";
  }
}

/* ============================================================================
   COASTAL SCREEN
   ========================================================================== */

let coastalState = null;          // null while loading; {isCoastal:…} once resolved
let coastalError = null;
let coastalSegmentIndex = 0;      // which SRF beach segment is on screen
let coastalWatersIndex = 0;       // which CWF marine zone is on screen
let coastalWaveMode = "hourly";   // hourly | daily
let activeCoastalView = "overview";
let activeAviationView = "current";
let coastalTideStationId = null;  // user's pick from the nearby prediction stations

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

// Inverse of tideKey: back to the {iso, day, minutes, label} stamp shape the
// rest of the tide code passes around.
function tideKeyToStamp(key) {
  const day = new Date(Math.floor(key / 1440) * 86400000).toISOString().slice(0, 10);
  const minutes = ((key % 1440) + 1440) % 1440;
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return {
    iso: `${day}T${hh}:${mm}`,
    day,
    minutes,
    label: new Date(`${day}T${hh}:${mm}:00`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
  };
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

// ["temperature","wind"] → "temperature and wind"
function listPhrase(items = []) {
  if (items.length <= 1) return items[0] || "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function compassLabel(deg) {
  return deg == null ? "--" : `${windDirLabel(deg)} (${Math.round(deg)}°)`;
}

function coastalSourceLine() {
  const parts = ["Open-Meteo marine model"];
  if (coastalState?.tides) parts.push(coastalState.tides.hasTides ? "NOAA CO-OPS tides" : "NOAA CO-OPS gauge");
  else if (coastalState?.observations) parts.push("NOAA CO-OPS shore station");
  if (coastalState?.surf) parts.push(`NWS ${coastalState.surf.office} surf zone forecast`);
  return parts.join(" · ");
}

const sectionViewTransitionTokens = new Map();

function syncSectionView(switchSelector, buttonAttribute, panelAttribute, activeValue, animate = false) {
  document.querySelectorAll(`${switchSelector} [${buttonAttribute}]`).forEach(button => {
    const active = button.getAttribute(buttonAttribute) === activeValue;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const panels = [...document.querySelectorAll(`[${panelAttribute}]`)];
  const incoming = panels.find(panel => panel.getAttribute(panelAttribute) === activeValue);
  const outgoing = panels.find(panel => !panel.hidden && panel !== incoming);
  const reduceMotion = document.documentElement.classList.contains("reduce-motion") ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const token = (sectionViewTransitionTokens.get(panelAttribute) || 0) + 1;
  sectionViewTransitionTokens.set(panelAttribute, token);

  if (!animate || reduceMotion || !incoming || !outgoing || typeof incoming.animate !== "function") {
    panels.forEach(panel => { panel.hidden = panel !== incoming; });
    if (animate && !reduceMotion && incoming) {
      incoming.classList.remove("section-panel-enter");
      // Force the keyframe to restart when a user returns to a panel they have
      // already visited. CSS animation is the fallback for browsers without
      // the Web Animations API.
      void incoming.offsetWidth;
      incoming.classList.add("section-panel-enter");
      window.setTimeout(() => incoming.classList.remove("section-panel-enter"), 260);
    }
    return Promise.resolve();
  }

  outgoing.getAnimations?.().forEach(animation => animation.cancel());
  incoming.getAnimations?.().forEach(animation => animation.cancel());
  const exit = outgoing.animate([
    { opacity: 1, transform: "translateY(0) scale(1)" },
    { opacity: 0, transform: "translateY(-5px) scale(.995)" },
  ], { duration: 130, easing: "ease-in", fill: "both" });

  return exit.finished.catch(() => {}).then(() => {
    if (sectionViewTransitionTokens.get(panelAttribute) !== token) return;
    panels.forEach(panel => { panel.hidden = panel !== incoming; });
    incoming.animate([
      { opacity: 0, transform: "translateY(9px) scale(.995)" },
      { opacity: 1, transform: "translateY(0) scale(1)" },
    ], { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" });
  });
}

function syncCoastalView(animate = false) {
  return syncSectionView("#coastalViewSwitch", "data-coastal-view", "data-coastal-panel", activeCoastalView, animate);
}

function syncAviationView(animate = false) {
  return syncSectionView("#aviationViewSwitch", "data-aviation-view", "data-aviation-panel", activeAviationView, animate);
}

function coastalViewPanel(id, content, emptyText) {
  return `<div class="coastal-view-panel" data-coastal-panel="${id}"${id === activeCoastalView ? "" : " hidden"}>
    ${content || `<article class="tile coastal-empty"><h3>Nothing to show in this view</h3><p>${safeText(emptyText)}</p></article>`}
  </div>`;
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
  coastalChartSpecs = {};
  const overview = [renderRipAndSea(), renderCoastalMetrics(), renderShoreObsPanel()].filter(Boolean).join("");
  const tides = renderTidePanel();
  const waves = renderWavePanel();
  const outlooks = [renderSurfForecastPanel(), renderCoastalWatersPanel()].filter(Boolean).join("");
  body.innerHTML = renderBeachPicker() +
    coastalViewPanel("overview", overview, "Current coastal conditions are unavailable for this point.") +
    coastalViewPanel("tides", tides, "No NOAA tide-prediction station covers this point.") +
    coastalViewPanel("waves", waves, "No marine wave-model forecast covers this point.") +
    coastalViewPanel("outlooks", outlooks, "No NWS surf-zone or coastal-waters text forecast covers this point.");
  syncCoastalView();
  wireCoastalCharts();
}

// Barrier islands and spits rarely have an FAA or NWS station of their own, so
// this names the shore station the app is reading instead — and what it beat.
function renderShoreObsPanel() {
  const obs = coastalState.observations;
  if (!obs) return "";
  const rows = [
    ["Air temperature", obs.tempF == null ? null : fmtTemp(obs.tempF)],
    ["Water temperature", obs.waterTempF == null ? null : fmtTemp(obs.waterTempF)],
    ["Wind", obs.windMph == null ? null : `${fmtWind(obs.windMph)}${obs.windDir == null ? "" : ` from ${compassLabel(obs.windDir)}`}${obs.gustMph ? `, gusting ${fmtWind(obs.gustMph)}` : ""}`],
    ["Humidity", obs.humidity == null ? null : `${Math.round(obs.humidity)}%`],
    ["Pressure", obs.pressureInHg == null ? null : fmtPressure(obs.pressureInHg)],
  ].filter(([, value]) => value);
  if (!rows.length) return "";

  const inland = weatherState?.current?.nwsStation;
  const isPrimary = Boolean(weatherState?.current?.shoreStation);
  return `
    <section class="tile coastal-panel">
      <div class="section-head">
        <div>
          <p class="eyebrow">NOAA CO-OPS · ${safeText(obs.station.name)}${obs.station.state ? `, ${safeText(obs.station.state)}` : ""}</p>
          <h3>Shore Observations</h3>
        </div>
        <span>${obs.station.distance.toFixed(1)} mi away${obs.at ? ` · ${safeText(obs.at.label)}` : ""}</span>
      </div>
      <dl class="sea-rows">
        ${rows.map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join("")}
      </dl>
      <p class="coastal-footnote">${isPrimary
        ? `${obs.station.distance.toFixed(1)} mi from ${safeText(townName())}, against ${weatherState.current.shoreStation.milesInlandStation.toFixed(1)} mi to the nearest NWS/FAA station${inland ? ` (${safeText(inland)})` : ""} — so Today reads its ${safeText(listPhrase(weatherState.current.shoreStation.fields))} from here. Anything this station has no sensor for still comes from the NWS station.`
        : `The nearest NWS/FAA station${inland ? ` (${safeText(inland)})` : ""} is closer than this gauge, so Today keeps using it. These are the on-the-water readings for comparison.`}</p>
    </section>
  `;
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
    ["seaTemp", "Water Temp", waterTemp == null ? "--" : fmtTemp(waterTemp), tides?.waterTempF != null ? `Gauge at ${safeText(tides.gauge.name)}` : "Modelled sea surface"],
    tides?.hasTides ? ["tide", nextTide ? `Next ${nextTide.type} Tide` : "Next Tide", nextTide ? nextTide.label : "--", nextTide ? `${fmtHeight(nextTide.heightFt, 1)} above ${tides.datum} at ${safeText(tides.station.name)}` : `${safeText(tides.station.name)}`] : null,
    tides?.observed ? ["tide", "Water Level", fmtHeight(tides.observed.heightFt, 1), `${safeText(tides.gauge.name)} gauge, ${tides.observed.label}`] : null,
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
        ${tides.nearby.length > 1 ? `<select id="coastalTideSelect" class="mrms-select" aria-label="Tide prediction station">
          ${tides.nearby.map(item => `<option value="${safeText(item.id)}"${item.id === tides.station.id ? " selected" : ""}>${safeText(item.name)} — ${item.distance.toFixed(1)} mi${item.water === "ocean" ? " · ocean" : item.water === "inland" ? " · bay" : ""}</option>`).join("")}
        </select>` : `<span>Station ${safeText(tides.station.id)}, ${tides.station.distance.toFixed(1)} mi away</span>`}
      </div>
      <div class="tide-chips">${chips || "<p>No further tide predictions in the next three days.</p>"}</div>
      ${tideCurveSvg(tides)}
      <p class="coastal-footnote">Predictions from ${safeText(tides.station.name)}, ${tides.station.distance.toFixed(1)} mi away, above ${tides.datum}${tideStationNote(tides)}.${tides.observed ? ` Live level ${fmtHeight(tides.observed.heightFt, 1)} at the ${safeText(tides.gauge.name)} gauge, ${safeText(tides.observed.label)}${tides.waterTempF == null ? "" : `, water ${fmtTemp(tides.waterTempF)}`}.` : ""} Predictions are astronomical only — wind and surge shift the real water level.</p>
    </section>
  `;
}

/* ---------------------------------------------------------------------------
   Coastal charts

   Both charts are emitted as SVG strings and then made interactive after the
   panel is in the DOM: the readout that each one carries is populated by a
   pointer (or finger) dragged across the plot, and falls back to the value at
   "now" when the pointer leaves.
   ------------------------------------------------------------------------- */

let coastalChartSpecs = {};   // chart id → { points, readout } for the hover wiring

// Value labels are drawn over a filled area and a stroked line, so every one
// gets a dark halo — paint-order puts the stroke behind the glyphs.
function chartLabel(x, y, text, color, { size = 11, anchor = "middle", weight = 800, halo = 3.4 } = {}) {
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" fill="${color}"
    stroke="rgba(2,6,23,0.72)" stroke-width="${halo}" stroke-linejoin="round" paint-order="stroke"
    font-size="${size}" font-weight="${weight}" font-family="Inter,system-ui,sans-serif">${text}</text>`;
}

// Explains the default when it skipped a closer station, so the choice never
// looks like a bug.
function tideStationNote(tides) {
  if (tides.nearby.length < 2) return "";
  const nearest = tides.nearby[0];
  if (nearest.id !== tides.station.id && nearest.water === "inland") {
    return `, chosen as the ocean-facing station over ${safeText(nearest.name)} ${nearest.distance.toFixed(1)} mi away in the back bay — switch above if you want the bay tide`;
  }
  return " — switch stations above for the ocean side or the back bay";
}

// 24-hour tide trace (6 h behind, 18 h ahead) with high/low callouts and a
// scrubber that reads out the predicted height at any moment.
function tideCurveSvg(tides) {
  const nowKey = tideNowKey();
  const points = tides.curve
    .map(row => ({ ...row, key: tideKey(row) }))
    .filter(row => row.key >= nowKey - 360 && row.key <= nowKey + 1080);
  if (points.length < 4) return "";

  // Narrow screens get a smaller viewBox so the SVG's fixed-size labels are not
  // scaled down into illegibility.
  const narrow = window.innerWidth < 760;
  const W = narrow ? 380 : 720, H = narrow ? 210 : 200;
  const padL = 12, padR = 12, padT = 30, padB = 32;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const values = points.map(p => p.heightFt);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const firstKey = points[0].key;
  const lastKey = points[points.length - 1].key;
  const xFor = key => padL + ((key - firstKey) / (lastKey - firstKey)) * plotW;
  const yFor = v => padT + plotH - ((v - minV) / range) * plotH;

  const line = points.map((p, i) => `${i ? "L" : "M"}${xFor(p.key).toFixed(1)},${yFor(p.heightFt).toFixed(1)}`).join(" ");
  const area = `${line} L${xFor(lastKey).toFixed(1)},${(padT + plotH).toFixed(1)} L${xFor(firstKey).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

  const marks = tides.events
    .map(event => ({ ...event, key: tideKey(event) }))
    .filter(event => event.key >= firstKey && event.key <= lastKey)
    .map(event => {
      const x = xFor(event.key);
      const y = yFor(event.heightFt);
      const anchor = x < 62 ? "start" : x > W - 62 ? "end" : "middle";
      const label = `${event.type === "High" ? "H" : "L"} ${safeText(event.label)}`;
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="#8fd3ff" stroke="rgba(2,6,23,0.85)" stroke-width="1.6"/>
        ${chartLabel(x, event.type === "High" ? y - 11 : y + 19, label, "#8fd3ff", { anchor })}`;
    }).join("");

  const nowX = xFor(nowKey);
  const chartId = "tideChart";
  coastalChartSpecs[chartId] = {
    color: "#38bdf8",
    points: points.map(p => ({
      x: xFor(p.key),
      y: yFor(p.heightFt),
      value: p.heightFt,
      label: p.key === nowKey ? "Now" : p.label,
      key: p.key,
    })),
    nowKey,
    format: point => `${fmtHeight(point.value, 1)} · ${point.label}`,
    hint: `Heights above ${tides.datum}`,
  };

  return `
    <div class="coastal-chart" style="aspect-ratio:${W} / ${H}" data-chart="${chartId}">
      <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" role="img" aria-label="Tide curve for the next 18 hours">
        <defs>
          <linearGradient id="tideFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.42"/>
            <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.02"/>
          </linearGradient>
        </defs>
        <path d="${area}" fill="url(#tideFill)"/>
        <path d="${line}" fill="none" stroke="#38bdf8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="${nowX.toFixed(1)}" y1="${padT - 14}" x2="${nowX.toFixed(1)}" y2="${padT + plotH}" stroke="var(--accent)" stroke-width="1.6" stroke-dasharray="4,3"/>
        ${chartLabel(nowX, padT - 18, "Now", "var(--accent)")}
        ${marks}
        <line class="chart-scrub" x1="0" y1="${padT - 8}" x2="0" y2="${padT + plotH}" stroke="rgba(255,255,255,0.55)" stroke-width="1.4" visibility="hidden"/>
        <circle class="chart-scrub-dot" r="5.5" fill="#38bdf8" stroke="rgba(2,6,23,0.9)" stroke-width="2.2" visibility="hidden"/>
        <rect class="chart-hit" x="${padL}" y="0" width="${plotW}" height="${H}" fill="transparent" style="cursor:col-resize"/>
      </svg>
    </div>
    <p class="chart-readout" data-readout="${chartId}"></p>
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
  // padT leaves room for the value labels to clear the trace at its highest.
  const padL = 12, padR = 12, padT = 34, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxV = Math.max(...rows.map(r => Math.max(r.waveFt, r.swellFt ?? 0))) || 1;
  const xFor = i => padL + (i / (rows.length - 1)) * plotW;
  const yFor = v => padT + plotH - (v / maxV) * plotH;

  const path = key => rows.map((row, i) => `${i ? "L" : "M"}${xFor(i).toFixed(1)},${yFor(row[key] ?? 0).toFixed(1)}`).join(" ");
  const waveLine = path("waveFt");
  const area = `${waveLine} L${xFor(rows.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)} L${padL},${(padT + plotH).toFixed(1)} Z`;

  const step = narrow ? 12 : 8;
  const timeLabels = rows.map((row, i) => {
    if (i % step !== 0) return "";
    const t = new Date(row.time);
    const text = i === 0 ? "Now" : t.toLocaleTimeString([], { hour: "numeric" });
    return chartLabel(xFor(i), H - 8, text, "rgba(232,240,255,0.55)", { size: 11, weight: 600, halo: 2.4 });
  }).join("");

  // Only the turning points of the trace carry a printed value; everything in
  // between is available by scrubbing. Candidates must be strict turns that
  // clear a fraction of the plotted range — otherwise a flat stretch emits a
  // label at every 0.1 ft wobble — and they are then thinned so no two labels
  // land within a label's width of each other.
  const prominence = Math.max(0.15, maxV * 0.06);
  const candidates = [];
  rows.forEach((row, i) => {
    const prev = rows[i - 1]?.waveFt;
    const next = rows[i + 1]?.waveFt;
    if (prev == null || next == null) return;
    const isPeak = row.waveFt - prev >= prominence && row.waveFt - next >= prominence;
    const isTrough = prev - row.waveFt >= prominence && next - row.waveFt >= prominence;
    if (isPeak || isTrough) candidates.push({ i, isPeak, value: row.waveFt });
  });
  // The opening value anchors the left edge; the highest sea is always worth
  // naming even when it sits on a plateau the turn test rejected.
  const peakIndex = rows.reduce((best, row, i) => (row.waveFt > rows[best].waveFt ? i : best), 0);
  candidates.unshift({ i: 0, isPeak: true, value: rows[0].waveFt });
  if (!candidates.some(c => c.i === peakIndex)) candidates.push({ i: peakIndex, isPeak: true, value: rows[peakIndex].waveFt });
  candidates.sort((a, b) => a.i - b.i);

  const minGap = narrow ? 74 : 84;
  const placed = [];
  candidates.forEach(candidate => {
    const last = placed[placed.length - 1];
    if (last && xFor(candidate.i) - xFor(last.i) < minGap) {
      // Keep whichever of the two is the more extreme reading.
      if (Math.abs(candidate.value - maxV / 2) > Math.abs(last.value - maxV / 2)) placed[placed.length - 1] = candidate;
      return;
    }
    placed.push(candidate);
  });

  const extremaLabels = placed.map(({ i, isPeak }) => {
    const x = xFor(i);
    const anchor = x < 34 ? "start" : x > W - 34 ? "end" : "middle";
    return chartLabel(x, yFor(rows[i].waveFt) + (isPeak ? -11 : 17), fmtHeight(rows[i].waveFt), "#7dd3fc", { anchor });
  }).join("");

  const chartId = "waveChart";
  coastalChartSpecs[chartId] = {
    color: "#7dd3fc",
    points: rows.map((row, i) => ({
      x: xFor(i),
      y: yFor(row.waveFt),
      value: row.waveFt,
      label: i === 0 ? "Now" : new Date(row.time).toLocaleString([], { weekday: "short", hour: "numeric" }),
      swell: row.swellFt,
      period: row.periodS,
    })),
    format: point => [
      `${fmtHeight(point.value)} seas`,
      point.period == null ? null : `${Math.round(point.period)} s`,
      point.swell == null ? null : `swell ${fmtHeight(point.swell)}`,
      point.label,
    ].filter(Boolean).join(" · "),
    hint: "Drag across the chart for any hour",
  };

  return `
    <div class="coastal-chart tall" style="aspect-ratio:${W} / ${H}" data-chart="${chartId}">
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
        ${extremaLabels}
        ${timeLabels}
        <line class="chart-scrub" x1="0" y1="${padT - 8}" x2="0" y2="${padT + plotH}" stroke="rgba(255,255,255,0.55)" stroke-width="1.4" visibility="hidden"/>
        <circle class="chart-scrub-dot" r="5.5" fill="#7dd3fc" stroke="rgba(2,6,23,0.9)" stroke-width="2.2" visibility="hidden"/>
        <rect class="chart-hit" x="${padL}" y="0" width="${plotW}" height="${H}" fill="transparent" style="cursor:col-resize"/>
      </svg>
    </div>
    <p class="chart-readout" data-readout="${chartId}"></p>
    <p class="coastal-legend"><span class="swatch" style="--c:#7dd3fc"></span>Significant wave height<span class="swatch dashed" style="--c:#c4b5fd"></span>Swell component</p>
  `;
}

// Turns every chart emitted in the current render into a scrubber. Called once
// per render, after the markup is in the DOM.
function wireCoastalCharts() {
  document.querySelectorAll("#coastalBody [data-chart]").forEach(wrap => {
    const spec = coastalChartSpecs[wrap.dataset.chart];
    const svg = wrap.querySelector("svg");
    const readout = document.querySelector(`#coastalBody [data-readout="${wrap.dataset.chart}"]`);
    if (!spec?.points?.length || !svg || !readout) return;

    const scrub = svg.querySelector(".chart-scrub");
    const dot = svg.querySelector(".chart-scrub-dot");
    const hit = svg.querySelector(".chart-hit");
    const viewW = svg.viewBox.baseVal.width;

    // Resting state: the value at "now", which is the first point on both charts
    // except the tide curve, where "now" sits six hours in.
    const restIndex = spec.nowKey == null
      ? 0
      : spec.points.reduce((best, p, i) => (Math.abs(p.key - spec.nowKey) < Math.abs(spec.points[best].key - spec.nowKey) ? i : best), 0);

    function show(index, pinned) {
      const point = spec.points[index];
      scrub.setAttribute("x1", point.x); scrub.setAttribute("x2", point.x);
      dot.setAttribute("cx", point.x); dot.setAttribute("cy", point.y);
      scrub.setAttribute("visibility", pinned ? "visible" : "hidden");
      dot.setAttribute("visibility", "visible");
      readout.innerHTML = `<strong>${safeText(spec.format(point))}</strong>${spec.hint ? `<span>${safeText(spec.hint)}</span>` : ""}`;
    }

    function indexAt(clientX) {
      const rect = svg.getBoundingClientRect();
      const svgX = ((clientX - rect.left) / rect.width) * viewW;
      let best = 0;
      spec.points.forEach((p, i) => { if (Math.abs(p.x - svgX) < Math.abs(spec.points[best].x - svgX)) best = i; });
      return best;
    }

    const move = clientX => show(indexAt(clientX), true);
    hit.addEventListener("pointermove", event => move(event.clientX));
    hit.addEventListener("pointerdown", event => { hit.setPointerCapture(event.pointerId); move(event.clientX); });
    hit.addEventListener("pointerup", event => hit.releasePointerCapture(event.pointerId));
    hit.addEventListener("pointerleave", () => show(restIndex, false));
    // Touch drags would otherwise scroll the page away under the finger.
    hit.addEventListener("touchmove", event => { event.preventDefault(); move(event.touches[0].clientX); }, { passive: false });
    hit.addEventListener("touchstart", event => { event.preventDefault(); move(event.touches[0].clientX); }, { passive: false });

    show(restIndex, false);
  });
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

// Re-pulls just the tide predictions when the user picks a different station.
async function selectTideStation(stationId) {
  coastalTideStationId = stationId;
  const loc = point();
  const select = document.querySelector("#coastalTideSelect");
  if (select) select.disabled = true;
  try {
    const tides = await tidePayload(loc.lat, loc.lon, coastalState.tides.gauge, stationId);
    if (tides) coastalState.tides = tides;
  } catch { /* keep the station already on screen */ }
  renderCoastal();
}

// The Coast tab is only meaningful where there is a coastline. It starts
// visible and is taken away once the marine check comes back negative — rather
// than being hidden on every refresh and re-shown a second later, which made
// the whole tab bar jump. A failed check leaves the tab in place so the error
// is reachable instead of silently swallowing a genuinely coastal location.
let coastalTabVisible = true;
function updateCoastalTabVisibility() {
  const tab = document.querySelector('.tab[data-tab="coastal"]');
  if (!tab) return;
  tab.hidden = !coastalTabVisible;
  // Don't strand the user on a screen that just disappeared out from under them.
  if (!coastalTabVisible && tab.classList.contains("active")) {
    document.querySelector('.tab[data-tab="current"]')?.click();
  }
}

function refreshCoastal() {
  coastalState = null;
  coastalError = null;
  coastalSegmentIndex = 0;
  coastalWatersIndex = 0;
  coastalTideStationId = null;
  renderCoastal();
  return coastalPayload().then(data => {
    coastalState = data;
    const segments = data.surf?.segments || [];
    const matched = segments.findIndex(segment => segment.zones.includes(data.zoneId));
    coastalSegmentIndex = matched === -1 ? 0 : matched;
    coastalTabVisible = data.isCoastal === true;
    updateCoastalTabVisibility();
    renderCoastal();
  }).catch(error => {
    coastalError = error.message;
    coastalTabVisible = true;
    updateCoastalTabVisibility();
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
      // Climate pressure arrives in hPa; the secondary line always shows the
      // other unit so the reading is legible either way.
      ["Avg Pressure",
        pressure == null ? "--" : (unitChoice("pressure") === "hpa" ? `${Math.round(pressure)} hPa` : `${(pressure * 0.02953).toFixed(2)} inHg`),
        pressure == null ? "--" : (unitChoice("pressure") === "hpa" ? `${(pressure * 0.02953).toFixed(2)} inHg` : `${Math.round(pressure)} hPa`),
        "pressure"],
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
  skyT = document.documentElement.classList.contains("reduce-motion") ? 0 : (ts || 0) / 1000;
  const stops = SKY[skyBucket] || SKY.clearDay;
  // Everything below reasons about the weather, not the hour: "rainNight"
  // slants and flashes exactly like "rain", it is just painted after dark.
  const bucket = baseSky(skyBucket);
  const night = isNightSky(skyBucket);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Measure the canvas's actual rendered size so its buffer matches the CSS
  // overshoot. iOS standalone can still clip fixed elements out of safe-area
  // bands, so the body::before gradient mirrors this palette as the reliable fallback.
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  const canvasRect = canvas.getBoundingClientRect();
  const viewTop = Math.max(0, -canvasRect.top);
  const viewH = Math.max(1, Math.min(window.innerHeight, h - viewTop));
  // The map covers the lower viewport, so horizon-positioned celestial bodies
  // looked chopped in half at the map's top edge. On that screen, keep every
  // sun/moon variant in the same upper-sky anchor above the map controls.
  const mapSky = document.body.classList.contains("map-mode");
  const mapCelestialY = viewTop + viewH * 0.085;
  const bufferW = Math.round(w * dpr);
  const bufferH = Math.round(h * dpr);
  if (canvas.width !== bufferW || canvas.height !== bufferH) {
    canvas.width = bufferW;
    canvas.height = bufferH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const t = skyT;
  ctx.clearRect(0, 0, w, h);

  const grad = ctx.createLinearGradient(0, viewTop, 0, viewTop + viewH);
  stops.forEach((color, i) => grad.addColorStop(i / (stops.length - 1), color));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  if (skyScene.stars.length) {
    skyScene.stars.forEach((s) => {
      // A restrained shimmer avoids the noisy on/off sparkle of the previous
      // full-opacity pulse while keeping the sky visibly alive.
      ctx.globalAlpha = s.a * (0.82 + 0.18 * Math.sin(t * s.twinkle + s.ph));
      ctx.fillStyle = "#eaf3ff";
      ctx.beginPath(); ctx.arc(s.x * w, s.y * h, s.r, 0, 6.284); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  // The moon disc belongs to a clear night only. A rainy or foggy night keeps
  // its dim star field (mostly hidden behind the cloud deck) but no moon —
  // a bright disc punched through an overcast sky was the giveaway that the
  // night scene was just the clear-night scene wearing a different gradient.
  if (skyBucket === "clearNight") {
    const mx = w * 0.82, my = mapSky ? mapCelestialY : viewTop + viewH * 0.17;
    const mg = ctx.createRadialGradient(mx, my, 0, mx, my, viewH * 0.45);
    mg.addColorStop(0, "rgba(226,238,255,.45)"); mg.addColorStop(0.12, "rgba(190,214,255,.14)"); mg.addColorStop(1, "rgba(190,214,255,0)");
    ctx.fillStyle = mg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(238,245,255,.92)";
    ctx.beginPath(); ctx.arc(mx, my, Math.max(16, viewH * 0.034), 0, 6.284); ctx.fill();
  }

  if (bucket === "clearDay" || bucket === "partly") {
    const sx = w * 0.82;
    const sy = mapSky ? mapCelestialY : viewTop + viewH * (bucket === "clearDay" ? 0.14 : 0.18);
    const pulse = 0.9 + 0.1 * Math.sin(t * 0.8);
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, viewH * 0.85 * pulse);
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

  if (bucket === "sunset") {
    const sx = w * (mapSky ? 0.82 : 0.68);
    const sy = mapSky ? mapCelestialY : viewTop + viewH * 0.72;
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, viewH * 0.95);
    sg.addColorStop(0, "rgba(255,236,190,.95)"); sg.addColorStop(0.045, "rgba(255,197,120,.58)");
    sg.addColorStop(0.28, "rgba(255,140,90,.19)"); sg.addColorStop(1, "rgba(255,120,80,0)");
    ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h);
  }

  const tint = night
    ? ({ overcast: "96,110,128", storm: "70,84,102", rain: "84,100,120", snow: "126,142,166", fog: "104,116,132", clearNight: "160,185,220" }[bucket] || "150,170,196")
    : ({ overcast: "245,248,252", storm: "150,165,182", rain: "180,195,210", snow: "235,242,250", fog: "240,244,248", sunset: "255,205,170" }[bucket] || "255,255,255");
  skyScene.clouds.forEach((cl) => {
    const x = ((cl.x + t * cl.s) % 1.5 - 0.25) * w, y = cl.y * h, cw = cl.w * w, ch = cl.h * h;
    // Three softly overlapping lobes make a coherent cloud bank instead of a
    // row of identical fuzzy discs. Shape is fixed per scene, so it drifts
    // without boiling or changing outline from frame to frame.
    const lobes = [
      [-0.23, 0.08, 0.58, 0.72],
      [0.02, -0.08 - Math.sin(cl.shape) * 0.04, 0.7, 1],
      [0.27, 0.06, 0.52, 0.68],
    ];
    lobes.forEach(([ox, oy, sx, sy], index) => {
      const lx = x + ox * cw, ly = y + oy * ch;
      const radius = cw * sx * 0.48;
      const cg = ctx.createRadialGradient(lx, ly, 0, lx, ly, radius);
      cg.addColorStop(0, `rgba(${tint},${cl.a * (index === 1 ? 1 : 0.8)})`);
      cg.addColorStop(0.58, `rgba(${tint},${cl.a * 0.42})`);
      cg.addColorStop(1, `rgba(${tint},0)`);
      ctx.fillStyle = cg;
      ctx.save(); ctx.translate(lx, ly); ctx.scale(1, (ch * sy) / Math.max(1, radius));
      ctx.beginPath(); ctx.arc(0, 0, radius, 0, 6.284); ctx.fill(); ctx.restore();
    });
  });

  skyScene.fogBanks.forEach((f) => {
    const y = f.y * h + Math.sin(t * 0.2 + f.x * 6) * h * 0.015;
    const fg = ctx.createLinearGradient(0, y - f.h * h * 0.5, 0, y + f.h * h * 0.5);
    const fogRgb = night ? "104,116,132" : "226,232,238";
    fg.addColorStop(0, `rgba(${fogRgb},0)`); fg.addColorStop(0.5, `rgba(${fogRgb},${f.a})`); fg.addColorStop(1, `rgba(${fogRgb},0)`);
    ctx.fillStyle = fg;
    const off = ((f.x + t * f.s) % 1.4 - 0.2) * w;
    ctx.fillRect(off - w, y - f.h * h * 0.5, w * 2.4, f.h * h);
  });

  if (skyScene.drops.length) {
    const slant = bucket === "storm" ? 0.34 : 0.18;
    ctx.lineCap = "round";
    skyScene.drops.forEach((d) => {
      const y = ((d.y + t * d.s * d.depth) % 1.15) * h - h * 0.08;
      const x = ((d.x + t * 0.018 + (y / h) * slant) % 1) * w, len = d.l * h * d.depth;
      ctx.strokeStyle = night ? `rgba(150,186,220,${d.a * 0.8})` : `rgba(214,236,255,${d.a})`;
      ctx.lineWidth = d.w * d.depth;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - len * slant, y + len); ctx.stroke();
    });
  }

  if (skyScene.flakes.length) {
    skyScene.flakes.forEach((f) => {
      const y = ((f.y + t * f.s) % 1.12) * h - h * 0.06;
      const x = (f.x + Math.sin(t * 0.8 + f.ph) * f.sw) * w;
      ctx.globalAlpha = night ? f.a * 0.75 : f.a; ctx.fillStyle = night ? "#c8d8ec" : "#f7fbff";
      ctx.beginPath(); ctx.arc(x, y, f.r, 0, 6.284); ctx.fill();
    });
    ctx.globalAlpha = 1;
    const ag = ctx.createLinearGradient(0, h * 0.84, 0, h);
    const agRgb = night ? "150,170,196" : "236,244,252";
    ag.addColorStop(0, `rgba(${agRgb},0)`); ag.addColorStop(1, `rgba(${agRgb},${night ? 0.16 : 0.26})`);
    ctx.fillStyle = ag; ctx.fillRect(0, h * 0.84, w, h * 0.16);
  }

  if (bucket === "storm") {
    const flash = skyScene.flash;
    if (t > flash.next) {
      flash.on = 1;
      flash.next = t + skyRnd(3.2, 7.5);
      flash.x = skyRnd(0.15, 0.85);
      let bx = flash.x, by = 0.05;
      flash.bolt = [[bx, by]];
      for (let i = 0; i < 7; i++) {
        bx += skyRnd(-0.035, 0.035);
        by += 0.07;
        flash.bolt.push([bx, by]);
      }
    }
    if (flash.on > 0) {
      flash.on = Math.max(0, flash.on - 0.055);
      const e = flash.on * flash.on, fx = flash.x * w;
      const fg = ctx.createRadialGradient(fx, h * 0.1, 0, fx, h * 0.1, h * 1.1);
      fg.addColorStop(0, `rgba(226,238,255,${0.5 * e})`); fg.addColorStop(0.4, `rgba(190,214,255,${0.16 * e})`); fg.addColorStop(1, "rgba(190,214,255,0)");
      ctx.fillStyle = fg; ctx.fillRect(0, 0, w, h);
      if (flash.on > 0.72) {
        ctx.strokeStyle = `rgba(238,246,255,${0.85 * e})`; ctx.lineWidth = 1.8; ctx.beginPath();
        flash.bolt.forEach(([bx, by], index) => index ? ctx.lineTo(bx * w, by * h) : ctx.moveTo(bx * w, by * h));
        ctx.stroke();
      }
    }
  }

  if (bucket === "fog") {
    const vg = ctx.createRadialGradient(w * 0.5, h * 0.5, h * 0.1, w * 0.5, h * 0.5, h * 0.95);
    if (night) { vg.addColorStop(0, "rgba(10,14,20,0)"); vg.addColorStop(1, "rgba(6,9,14,.5)"); }
    else       { vg.addColorStop(0, "rgba(190,197,204,0)"); vg.addColorStop(1, "rgba(174,182,190,.4)"); }
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  }

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

function setPlayButtonsEnabled(enabled) {
  document.querySelectorAll("#radarPlayButton, #mapFramePlayButton").forEach(btn => { btn.disabled = !enabled; });
}

// Play/pause is offered twice — the labelled button in the Layers panel and the
// icon button on the bottom scrubber — so both are driven from one place.
function setPlayingUi(playing) {
  const lbl = document.querySelector("#playLabel");
  if (lbl) lbl.textContent = playing ? "Pause" : "Play";
  document.querySelectorAll("#radarPlayButton, #mapFramePlayButton").forEach(btn => {
    btn.classList.toggle("playing", playing);
    btn.setAttribute("aria-label", playing ? "Pause frame animation" : "Play frame animation");
  });
}

function stopRadarAnimation() {
  if (radarAnimationTimer) clearInterval(radarAnimationTimer);
  radarAnimationTimer = null;
  setPlayingUi(false);
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
    condition: current.condition,
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
          <span class="sidebar-chip-label">Temp</span>
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

// The timeline exists twice: the full row inside the Layers panel and the bare
// slider docked at the bottom of the map. Both are driven from the same state,
// so every update goes through here to keep them in lockstep.
function syncFrameSliders({ value, max, disabled } = {}) {
  ["#radarTimeline", "#mapFrameSlider"].forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    if (max      !== undefined) el.max      = String(max);
    if (value    !== undefined) el.value    = String(value);
    if (disabled !== undefined) el.disabled = disabled;
  });
}

// The valid time of the frame on screen shows in two places: the timeline row
// in the Layers panel and the scrubber docked at the bottom of the map.
function setFrameTimeLabel(text, { forecast = false } = {}) {
  document.querySelectorAll("#radarTimeLabel, #mapFrameTimeLabel").forEach(el => {
    el.textContent = text;
    // Frames past now read in the accent colour, so scrubbing into the forecast
    // half of the timeline is unmistakable.
    el.classList.toggle("forecast-frame", Boolean(forecast));
  });
}

function updateRadarLabel() {
  if (!document.querySelector("#radarTimeLabel") && !document.querySelector("#mapFrameTimeLabel")) return;

  // Satellite owns the timeline whenever it is active.
  if (satelliteActive) {
    if (onDeviceSatelliteFrameInfo.length) {
      syncFrameSliders({ value: satFrameIndex });
      setFrameTimeLabel(decodedFrameLabel(onDeviceSatelliteFrameInfo[satFrameIndex]));
      return;
    }
    if (!satFrames.length) {
      const max = Number(document.querySelector("#mapFrameSlider")?.max || 0);
      syncFrameSliders({ value: max });
      setFrameTimeLabel("Latest");
      return;
    }
    syncFrameSliders({ value: satFrameIndex });
    const frame = satFrames.length ? satFrames[satFrameIndex] : 0;
    setFrameTimeLabel(frame === 0 ? "Latest" : `−${frame} frame${frame > 1 ? "s" : ""}`);
    return;
  }

  if (!onDeviceRadarFrameInfo.length) {
    const max = Number(document.querySelector("#mapFrameSlider")?.max || 0);
    syncFrameSliders({ value: max });
    setFrameTimeLabel("Latest");
    return;
  }
  syncFrameSliders({ value: radarFrameIndex });
  const frame = onDeviceRadarFrameInfo[radarFrameIndex];
  setFrameTimeLabel(
    decodedFrameLabel(
      frame,
      activeRadarMode === "single" ? onDeviceRadarSite?.id || "" : ""
    ),
    { forecast: Boolean(frame?.forecast) },
  );
}

function setRadarFrame(index) {
  radarFrameIndex = Math.max(0, Math.min(radarFrames.length - 1, Number(index)));
  updateRadarLabel();
  return getOnDeviceWeather()
    .then(api => api.showRadarFrame(radarFrameIndex))
    .then(result => {
      // Showing a decoded frame re-mounts/moves its custom layer at the decoder's
      // basemap anchor. Restore the shared weather order immediately so alert
      // borders never spend a frame underneath radar.
      restackWeatherLayers();
      raiseBoundaryLayers();
      refreshInspectReadout();
      return result;
    })
    .catch(error => {
      setFrameTimeLabel(`Radar decode failed: ${error.message}`);
      console.warn("On-device radar frame unavailable", error);
    });
}

function setRainfallOpacity(pct, { persist = true } = {}) {
  const normalizedPct = Math.max(10, Math.min(100, Math.round(Number(pct) || 78)));
  radarOpacity = normalizedPct / 100;
  if (persist) {
    try { localStorage.setItem(WEATHER_LAYER_OPACITY_KEY, String(normalizedPct)); } catch {}
  }
  if (onDeviceWeatherApi) onDeviceWeatherApi.setOpacity(radarOpacity);
  if (radarMap && mapLoaded) {
    if (radarMap.getLayer("satellite-layer"))
      radarMap.setPaintProperty("satellite-layer", "raster-opacity", radarOpacity);
  }
  const slider = document.querySelector("#radarOpacitySlider");
  if (slider) slider.value = String(normalizedPct);
  const label = document.querySelector("#radarOpacityLabel");
  if (label) label.textContent = `${normalizedPct}%`;
}

function removeMapLayer(id) {
  if (radarMap?.getLayer(id)) radarMap.removeLayer(id);
}

function removeMapSource(id) {
  if (radarMap?.getSource(id)) radarMap.removeSource(id);
}

function clearWeatherLayers() {
  // Any alert requests still resolving belong to the layer set being removed.
  alertLoadSequence++;
  // A GLM request belongs to the style/layer stack that started it. Abort it on
  // every redraw so a slow NOAA response cannot mount into a replacement style.
  glmLoadSequence++;
  glmAbortController?.abort();
  glmAbortController = null;
  clearTimeout(glmRefreshTimer);
  stopRadarAnimation();
  clearTimeout(radarFrameTransitionTimer);
  ["radar-layer-a", "radar-layer-b",
   "spc-fill", "spc-line", "spc-cig-fill", "spc-cig-line",
   "drought-fill", "drought-line",
   "alerts-fill", "alerts-halo", "alerts-casing", "alerts-line",
   "nws-alerts-fill", "nws-alerts-halo", "nws-alerts-casing", "nws-alerts-line",
   "fire-fill", "fire-line",
   "wpc-rain-fill", "wpc-rain-line",
   "glm-halo", "glm-flashes",
   "lsr-hit",
   "surface-layer",
   "satellite-layer",
   "cyclones-radii-fill", "cyclones-radii-line", "cyclones-track",
   "cyclones-points", "cyclones-labels",
  ].forEach(removeMapLayer);
  ["radar-source-a", "radar-source-b",
   "spc-source",
   "drought-source",
   "alerts-source", "nws-alerts-source",
   "fire-source",
   "wpc-rain-source",
   "glm-source",
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

// Swapping the basemap replaces every layer in the style, so the whole weather
// stack is rebuilt once the new style reports ready. Called from both the
// Layers panel and the Settings dialog.
function setBasemap(styleId) {
  if (!BASEMAP_STYLES.some(style => style.id === styleId) || styleId === activeBasemap) return;
  activeBasemap = styleId;
  localStorage.setItem("weatherBasemap", activeBasemap);
  renderBasemapButtons();
  if (!radarMap) return;
  radarMap.setStyle(`mapbox://styles/mapbox/${activeBasemap}`);
  radarMap.once("style.load", () => {
    mapLoaded = true;
    radarMap.setProjection("mercator"); // keep flat projection across basemap swaps
    applyBasemapLabelTypography();
    // Clear per-layer wiring flags so cursor handlers are re-added
    popupWiredLayers.delete("spc"); popupWiredLayers.delete("fire");
    popupWiredLayers.delete("wpc-rain"); popupWiredLayers.delete("all-alerts");
    droughtPopupWired = false;
    drawRadar(false);
  });
}

function renderBasemapButtons() {
  const container = document.querySelector("#basemapBtns");
  if (!container) return;
  container.innerHTML = BASEMAP_STYLES.map(s =>
    `<button type="button" data-basemap="${s.id}" class="${s.id === activeBasemap ? "active" : ""}">${s.label}</button>`
  ).join("");
  container.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => setBasemap(btn.dataset.basemap));
  });
}

// The scale bar follows whichever distance unit the user picked in Settings.
let mapScaleControl = null;
function scaleControlUnit() {
  return unitChoice("distance") === "km" ? "metric" : "imperial";
}

function syncScaleControlUnit() {
  try { mapScaleControl?.setUnit(scaleControlUnit()); } catch {}
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
    // Replaced below by a compact instance placed opposite the scale bar.
    attributionControl: false,
  });
  radarMap.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");
  // Scale on the left, attribution on the right, so the two never stack into a
  // two-line credit strip that swallows the legend on a phone. The attribution
  // is forced compact (an "i" disc that expands on tap) for the same reason.
  mapScaleControl = new mapboxgl.ScaleControl({ unit: scaleControlUnit() });
  radarMap.addControl(mapScaleControl, "bottom-left");
  radarMap.addControl(new mapboxgl.AttributionControl({ compact: true }), "bottom-right");
  // "style.load" is the right signal for "the style is parsed, layers can be
  // added"; "load" additionally waits for the first screenful of tiles, so on a
  // slow or partially failing tile fetch the weather stack was never mounted at
  // all and the tab sat empty. The basemap swap in setBasemap() already keys off
  // style.load for exactly this reason — init now matches it. `once`, so a later
  // basemap swap runs its own handler instead of two.
  radarMap.once("style.load", () => {
    mapLoaded = true;
    applyBasemapLabelTypography();
    drawRadar(true);
    wireUnifiedClickHandler();
    wireInspectTool();
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        updateUserLocationMarker(pos.coords.latitude, pos.coords.longitude);
      }, () => {}, { timeout: 5000, maximumAge: 120000 });
    }
  });
  // The extrapolation covers the whole radar domain, so panning never rebuilds
  // it. Nudging it after a move only drops frames whose valid time has passed
  // and picks up a newer scan if one landed while the map was moving.
  radarMap.on("moveend", () => {
    if (!radarActive || !mrmsProductHasNowcast()) return;
    clearTimeout(futureRadarPanTimer);
    futureRadarPanTimer = setTimeout(() => {
      if (radarActive && mrmsProductHasNowcast()) {
        onDeviceWeatherApi?.refreshNowcast?.();
      }
    }, 400);
  });
  updateRadarLabel();
  document.querySelector("#mapLocateBtn")?.addEventListener("click", locateOnMap);
}

async function addRadarLayer(relocate = false) {
  const requestedMode = activeRadarMode;
  const requestedProduct = activeMrmsProduct;
  const requestedSite = requestedMode === "single" ? selectedRadarSite : null;
  const requestKey = `${requestedMode}:${requestedProduct}`;
  const resetToLatest = radarLatestResetKey === requestKey;
  const requestIsCurrent = () => Boolean(
    radarActive &&
    activeRadarMode === requestedMode &&
    activeMrmsProduct === requestedProduct &&
    (requestedMode !== "single" || !requestedSite || selectedRadarSite === requestedSite)
  );
  const radarOwnsTimeline = () => requestIsCurrent() && !satelliteActive;
  const api = await getOnDeviceWeather();
  if (!requestIsCurrent()) return;
  api.setVisibility({ radar: radarActive, satellite: satelliteActive });
  api.setOpacity(radarOpacity);
  try {
    await api.loadRadar({
      map: radarMap,
      beforeId: boundaryAnchorId(),
      location: selectedLocation,
      mode: requestedMode,
      productKey: requestedProduct,
      siteId: requestedSite,
      resetToLatest,
      onStatus: status => {
        if (radarOwnsTimeline()) handleOnDeviceStatus(status);
      },
      onFrame: event => {
        if (radarOwnsTimeline()) handleOnDeviceFrame(event);
      },
    });
  } catch (error) {
    if (!requestIsCurrent()) return;
    throw error;
  }
  if (!requestIsCurrent()) return;
  if (radarLatestResetKey === requestKey) radarLatestResetKey = null;
  renderMrmsLegend();
  restackWeatherLayers();
  raiseBoundaryLayers();
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

function getGlmLoader() {
  if (!glmLoaderPromise) glmLoaderPromise = import("./js/glm.js");
  return glmLoaderPromise;
}

function scheduleGlmRefresh() {
  clearTimeout(glmRefreshTimer);
  if (!activeOverlays.has("GOES GLM")) return;
  glmRefreshTimer = setTimeout(() => {
    addGlmLayer({ force: true }).catch(error => {
      if (error?.name !== "AbortError") console.warn("GOES GLM refresh failed", error);
    });
  }, 60_000);
}

async function addGlmLayer({ force = false } = {}) {
  if (!radarMap || !mapLoaded || !activeOverlays.has("GOES GLM")) return;
  const sequence = ++glmLoadSequence;
  const cacheIsFresh = glmLayerData && Date.now() - glmFetchedAt < 45_000;

  if (force || !cacheIsFresh) {
    glmAbortController?.abort();
    const controller = new AbortController();
    glmAbortController = controller;
    try {
      const { loadRecentGlmGeoJson } = await getGlmLoader();
      const data = await loadRecentGlmGeoJson({ signal: controller.signal });
      if (sequence !== glmLoadSequence || controller.signal.aborted) return;
      glmLayerData = data;
      glmFetchedAt = Date.now();
    } catch (error) {
      if (error?.name === "AbortError") return;
      // If NOAA has a brief listing/file outage, leave the last successful five
      // minutes visible and try again on the normal refresh cadence.
      if (!glmLayerData || Date.now() - glmFetchedAt > 180_000) {
        radarMap?.getSource("glm-source")?.setData({ type: "FeatureCollection", features: [] });
        scheduleGlmRefresh();
        throw error;
      }
      console.warn("Using cached GOES GLM flashes after refresh failed", error);
    } finally {
      if (glmAbortController === controller) glmAbortController = null;
    }
  }

  if (sequence !== glmLoadSequence || !glmLayerData ||
      !activeOverlays.has("GOES GLM") || !radarMap?.getStyle()) return;

  const source = radarMap.getSource("glm-source");
  if (source) {
    source.setData(glmLayerData);
  } else {
    radarMap.addSource("glm-source", {
      type: "geojson",
      data: glmLayerData,
      attribution: "NOAA/NESDIS GOES-19 GLM",
    });
    addWeatherLayer({
      id: "glm-halo",
      type: "circle",
      source: "glm-source",
      paint: {
        "circle-color": "#111827",
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 3.4, 6, 6, 10, 10],
        "circle-opacity": ["interpolate", ["linear"], ["get", "ageMinutes"], 0, 0.66, 5, 0.12],
        "circle-blur": 0.25,
      },
    });
    addWeatherLayer({
      id: "glm-flashes",
      type: "circle",
      source: "glm-source",
      paint: {
        "circle-color": ["interpolate", ["linear"], ["get", "ageMinutes"],
          0, "#ffffff", 0.75, "#fef08a", 2.5, "#facc15", 5, "#f97316"],
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 1.4, 6, 2.8, 10, 5.2],
        "circle-opacity": ["interpolate", ["linear"], ["get", "ageMinutes"], 0, 0.98, 5, 0.34],
        "circle-stroke-color": "rgba(15, 23, 42, 0.82)",
        "circle-stroke-width": 0.45,
      },
    });
  }
  restackWeatherLayers();
  raiseBoundaryLayers();
  scheduleGlmRefresh();
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
// Bands the given source actually publishes (some products are GOES-only).
function satBandsFor(source) {
  return SATELLITE_BANDS.filter(b => !b.sources || b.sources.includes(source.id));
}
function satBand() {
  const available = satBandsFor(satSource());
  return available.find(b => b.id === activeSatelliteType) || available[0];
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

function captureRenderedSatelliteView() {
  const source = satSource();
  const availableBands = satBandsFor(source);
  const band = availableBands.find(item => item.id === activeSatelliteType) || availableBands[0];
  const sectorId = activeSatelliteSector || null;
  const sector = sectorId
    ? (satSectorCache[source.id] || []).find(item => item.id === sectorId) || null
    : null;
  return {
    source,
    band,
    sector,
    sectorId,
    extent: [...(sector ? sector.extent : source.extent)],
    key: `${source.id}|${sectorId ? `sec:${sectorId}` : "full"}|${band.id}`,
  };
}

function renderedSatelliteViewIsCurrent(view) {
  return captureRenderedSatelliteView().key === view.key;
}

function satDataUrl(source, file) {
  const base = source.base || `${SATELLITE_RAW}/${source.repo}/main/site/data`;
  return `${base}/${file}`;
}
// Raw PNG url for a given frame (full-disk or sector), honouring repo naming.
function satFrameRawUrl(frame, view = captureRenderedSatelliteView()) {
  const { source, band, sector } = view;
  const fr = String(frame).padStart(2, "0");
  if (sector) return satDataUrl(source, sector.fileFor(band.file, fr));
  return satDataUrl(source, `${band.file}_${fr}.png`);
}
// Stable cache key for a frame's warped image.
function satFrameKey(frame, view = captureRenderedSatelliteView()) {
  return `${view.key}|${frame}`;
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
async function warpedFrameUrl(frame, view = captureRenderedSatelliteView()) {
  // Mercator-rendered sources (e.g. GOES-18, Himawari) already ship Web Mercator
  // PNGs — warping them again would double-project. Use the raw frame as-is.
  if (view.source.proj === "mercator") return satFrameRawUrl(frame, view);
  const key = satFrameKey(frame, view);
  if (satWarpCache.has(key)) return satWarpCache.get(key);
  const img = await loadImgCors(satFrameRawUrl(frame, view));
  const dataUrl = warpEquirectToMercator(img, view.extent).toDataURL("image/png");
  satWarpCache.set(key, dataUrl);
  // Keep the cache bounded so band/source/sector churn can't grow unbounded.
  if (satWarpCache.size > 60) satWarpCache.delete(satWarpCache.keys().next().value);
  return dataUrl;
}

// Probe how many frames the active view currently publishes (rolling buffers can
// be partially filled). Cached per source/sector/band view key.
async function detectSatFrameCount(view = captureRenderedSatelliteView()) {
  const key = satFrameKey("count", view); // distinct per view; band rarely changes count
  if (satFrameCountCache[key]) return satFrameCountCache[key];
  let count = 1; // frame 00 is assumed to exist
  for (let i = 1; i < SATELLITE_MAX_FRAMES; i++) {
    let res;
    try {
      res = await fetch(satFrameRawUrl(i, view), { method: "HEAD", cache: "no-store" });
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
// Outlook fills are deliberately below radar; their line layers and GLM are
// deliberately above both selectable base layers. This invariant is re-applied
// after asynchronous decoders finish and after every Mapbox style replacement.
const WEATHER_LAYER_ORDER = [
  "satellite-layer", "on-device-satellite",
  "drought-fill",
  "fire-fill",
  "wpc-rain-fill",
  "spc-fill", "spc-cig-fill",
  "surface-layer",
  "alerts-fill", "nws-alerts-fill",
  "radar-layer-a", "radar-layer-b", "on-device-radar", "on-device-mrms",
  "glm-halo", "glm-flashes",
  "drought-line", "fire-line", "wpc-rain-line", "spc-line", "spc-cig-line",
  "nws-alerts-halo", "nws-alerts-casing", "nws-alerts-line",
  "alerts-halo", "alerts-casing", "alerts-line",
  "lsr-hit",
  "cyclones-radii-fill", "cyclones-radii-line", "cyclones-track", "cyclones-points",
];

// ── Country / state borders ─────────────────────────────────────────────────
// Weather layers are inserted beneath the basemap's own boundary and label
// layers, which is meant to leave borders drawn over the weather. In practice
// nothing was visible: an opaque MRMS fill or a full-coverage satellite image
// swallows the basemap's hairline admin lines, and the Dark basemap draws
// country borders at such low contrast that they disappear under any overlay
// at all. So the map now carries its own admin lines, styled for legibility
// over saturated radar colours, mounted at the top of the stack where nothing
// weather-related can cover them.
const BOUNDARY_SOURCE_ID = "admin-boundaries";
// The shoreline comes from a different tileset than the admin lines — see
// addBoundaryLayers for why the streets water polygons can't draw one.
const SHORELINE_SOURCE_ID = "shoreline-boundaries";
// Bottom → top. The shoreline sits under the admin lines so a border that runs
// along a coast still reads as a border, and counties sit under the state and
// country lines they subdivide.
const BOUNDARY_LAYER_IDS = [
  "coastline-casing", "coastline-line",
  "admin-county-line", "admin-state-line", "admin-country-line",
];

// How heavy the reference lines are drawn, per basemap tone.
//
// The Dark basemap is nearly black, so the lines need a dark casing and bright
// cores to survive on top of saturated radar colours. Light, Streets and
// Outdoors are the opposite problem: that same near-black casing, at up to 5px
// with a bright core on top of it, is a fat opaque ribbon laid over exactly the
// land the storms are moving across. On those the casing turns into a thin
// light halo and every line drops roughly a third of its width, which is still
// plenty of separation against a pale basemap.
//
// `width` entries are the tail of an ["interpolate", ["linear"], ["zoom"], …]
// expression: zoom, px, zoom, px, …
const BOUNDARY_THEMES = {
  dark: {
    coastCasing: { color: "rgba(3, 10, 24, 0.85)",     width: [2, 2.2, 6, 3.4, 10, 5] },
    coastLine:   { color: "rgba(148, 233, 255, 0.95)", width: [2, 0.9, 6, 1.6, 10, 2.6] },
    county:      { color: "rgba(214, 227, 245, 0.42)", width: [4, 0.4, 7, 0.7, 10, 1.1, 13, 1.5] },
    state:       { color: "rgba(226, 236, 250, 0.62)", width: [3, 0.6, 6, 1, 10, 1.6] },
    country:     { color: "rgba(255, 255, 255, 0.92)", width: [2, 0.9, 6, 1.8, 10, 3] },
  },
  light: {
    // A pale halo instead of a black one: it lifts the line off the basemap
    // without printing a wide dark band across the radar underneath it.
    coastCasing: { color: "rgba(255, 255, 255, 0.72)", width: [2, 1.4, 6, 2, 10, 2.8] },
    coastLine:   { color: "rgba(12, 96, 140, 0.92)",   width: [2, 0.7, 6, 1.1, 10, 1.7] },
    county:      { color: "rgba(40, 56, 78, 0.42)",    width: [4, 0.35, 7, 0.6, 10, 0.9, 13, 1.2] },
    state:       { color: "rgba(30, 44, 66, 0.7)",     width: [3, 0.5, 6, 0.8, 10, 1.2] },
    country:     { color: "rgba(17, 27, 44, 0.9)",     width: [2, 0.7, 6, 1.2, 10, 2] },
  },
};

function boundaryTheme() {
  return activeBasemap === "dark-v11" ? BOUNDARY_THEMES.dark : BOUNDARY_THEMES.light;
}

function zoomWidth(stops) {
  return ["interpolate", ["linear"], ["zoom"], ...stops];
}

function addBoundaryLayers() {
  if (!radarMap || !radarMap.getStyle()) return;
  if (!radarMap.getSource(BOUNDARY_SOURCE_ID)) {
    radarMap.addSource(BOUNDARY_SOURCE_ID, { type: "vector", url: "mapbox://mapbox.mapbox-streets-v8" });
  }
  if (!radarMap.getSource(SHORELINE_SOURCE_ID)) {
    radarMap.addSource(SHORELINE_SOURCE_ID, { type: "vector", url: "mapbox://mapbox.country-boundaries-v1" });
  }
  const theme = boundaryTheme();
  // Maritime segments are the offshore continuations of a land border; drawing
  // them puts long straight lines out across open ocean radar returns.
  const notMaritime = ["!=", ["get", "maritime"], "true"];
  // Each border feature is published once per worldview; without this filter
  // every disputed boundary draws two or three times, one per interpretation.
  const worldview = ["match", ["get", "worldview"], ["all", "US"], true, false];
  // The country tileset publishes worldview as either "all" or a list of the
  // codes a feature belongs to ("US,CN"), so a whole-string match would drop
  // shared entries; this is the filter Mapbox documents for it.
  const countryWorldview = ["any",
    ["==", "all", ["get", "worldview"]],
    ["in", "US", ["get", "worldview"]],
  ];

  // ── Shoreline ──
  // Admin borders stop at the water's edge, so a storm moving off the coast
  // crosses an unmarked boundary: reflectivity over the ocean looks exactly like
  // reflectivity over land once a radar layer covers the basemap. This line is
  // the actual land/water edge, drawn on top of every weather layer, so it is
  // always obvious which side of the shore a cell is on.
  //
  // It is *not* traced from the streets tileset's water polygons, which is the
  // obvious source and was the original one. Those polygons carry no attributes
  // at all — the whole tile is a single unnamed multipolygon — so there is no
  // filter that separates the coast from inland water, and outlining them drew
  // every river in the country as a bright double line: the Susquehanna, the
  // Potomac and the entire Chesapeake tributary network competing with the
  // storms for attention. Country polygons solve it exactly: they exclude
  // marine water (oceans, bays, sounds, the Great Lakes) and include land that
  // rivers merely run across, so their outline is the shoreline and nothing
  // else. The land borders they share with Canada and Mexico are covered by the
  // country line drawn over them.
  if (!radarMap.getLayer("coastline-casing")) {
    radarMap.addLayer({
      id: "coastline-casing",
      type: "line",
      source: SHORELINE_SOURCE_ID,
      "source-layer": "country_boundaries",
      filter: countryWorldview,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": theme.coastCasing.color,
        "line-width": zoomWidth(theme.coastCasing.width),
      },
    });
  }
  if (!radarMap.getLayer("coastline-line")) {
    radarMap.addLayer({
      id: "coastline-line",
      type: "line",
      source: SHORELINE_SOURCE_ID,
      "source-layer": "country_boundaries",
      filter: countryWorldview,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        // A cool cyan reads as "water edge" without competing with the warm
        // reds and oranges of heavy reflectivity.
        "line-color": theme.coastLine.color,
        "line-width": zoomWidth(theme.coastLine.width),
      },
    });
  }

  // ── County lines ──
  // No minzoom: counties are how NWS warnings, LSRs and zone forecasts are
  // addressed, so the grid is worth having at every zoom the tileset publishes
  // it at rather than appearing only once you are far enough in. It is drawn
  // thinner and fainter than the state line so a continent-wide view reads as
  // texture under the borders instead of a mesh over them.
  if (!radarMap.getLayer("admin-county-line")) {
    radarMap.addLayer({
      id: "admin-county-line",
      type: "line",
      source: BOUNDARY_SOURCE_ID,
      "source-layer": "admin",
      filter: ["all", ["==", ["get", "admin_level"], 2], notMaritime, worldview],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": theme.county.color,
        "line-width": zoomWidth(theme.county.width),
      },
    });
  }

  if (!radarMap.getLayer("admin-state-line")) {
    radarMap.addLayer({
      id: "admin-state-line",
      type: "line",
      source: BOUNDARY_SOURCE_ID,
      "source-layer": "admin",
      filter: ["all", ["==", ["get", "admin_level"], 1], notMaritime, worldview],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": theme.state.color,
        "line-dasharray": [3, 2],
        "line-width": zoomWidth(theme.state.width),
      },
    });
  }
  if (!radarMap.getLayer("admin-country-line")) {
    radarMap.addLayer({
      id: "admin-country-line",
      type: "line",
      source: BOUNDARY_SOURCE_ID,
      "source-layer": "admin",
      filter: ["all", ["<=", ["get", "admin_level"], 0], notMaritime, worldview],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": theme.country.color,
        "line-width": zoomWidth(theme.country.width),
      },
    });
  }
  applyBoundaryTheme();
}

// Re-assert the per-basemap weights on layers that already exist. addBoundary
// Layers only paints them at creation time, and the same layers survive a
// re-draw, so a basemap swap has to push the new theme onto them.
function applyBoundaryTheme() {
  if (!radarMap || !radarMap.getStyle()) return;
  const theme = boundaryTheme();
  const paints = [
    ["coastline-casing", theme.coastCasing],
    ["coastline-line", theme.coastLine],
    ["admin-county-line", theme.county],
    ["admin-state-line", theme.state],
    ["admin-country-line", theme.country],
  ];
  for (const [id, spec] of paints) {
    if (!radarMap.getLayer(id)) continue;
    try {
      radarMap.setPaintProperty(id, "line-color", spec.color);
      radarMap.setPaintProperty(id, "line-width", zoomWidth(spec.width));
    } catch {}
  }
}

// Weather layers mount beneath the basemap's labels, so they normally land
// below these. Re-assert it anyway after a batch of layer adds: a basemap with
// no symbol layers to anchor against would otherwise stack weather on top.
function raiseBoundaryLayers() {
  if (!radarMap || !radarMap.getStyle()) return;
  BOUNDARY_LAYER_IDS.forEach(id => {
    if (radarMap.getLayer(id)) radarMap.moveLayer(id, boundaryAnchorId());
  });
  applyBoundarySettings();
}

function setLayerVisible(id, visible) {
  if (radarMap?.getLayer(id)) {
    radarMap.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
}

// Honour the Settings toggles for the reference lines this app draws itself.
function applyBoundarySettings() {
  if (!radarMap || !radarMap.getStyle()) return;
  setLayerVisible("coastline-casing", mapSettings.coastlines);
  setLayerVisible("coastline-line", mapSettings.coastlines);
  setLayerVisible("admin-county-line", mapSettings.countyBorders);
  setLayerVisible("admin-state-line", mapSettings.stateBorders);
  setLayerVisible("admin-country-line", mapSettings.countryBorders);
  applyBoundaryTheme();
  applyPlaceLabelSetting();
}

function basemapLabelFontStack(layer) {
  const original = layer.layout?.["text-font"];
  const originalText = Array.isArray(original)
    ? JSON.stringify(original).toLowerCase()
    : String(original || "").toLowerCase();
  if (/bold|black|heavy|semibold|demi/.test(originalText)) return MAP_LABEL_FONT_STACKS.bold;
  if (/medium/.test(originalText)) return MAP_LABEL_FONT_STACKS.medium;
  return MAP_LABEL_FONT_STACKS.regular;
}

// Apply this while a fresh basemap style is loaded, before weather overlays add
// their own symbol layers. That makes roads, water, cities, and other native
// map labels share the app's typography without changing any overlay behavior.
function applyBasemapLabelTypography() {
  if (!radarMap || !radarMap.getStyle()) return;
  for (const layer of radarMap.getStyle().layers || []) {
    if (layer.type !== "symbol" || layer.layout?.["text-field"] == null) continue;
    try {
      radarMap.setLayoutProperty(layer.id, "text-font", basemapLabelFontStack(layer));
    } catch {}
  }
}

// Town names at the basemap's own size are set for reading a street map on a
// desktop monitor, not for picking your town out from under a radar sweep on a
// phone. A modest bump keeps them recognisably part of the basemap while making
// them legible through a translucent weather layer.
const PLACE_LABEL_SCALE = 1.1;
// Which symbol layers count as a settlement name. POIs, roads, water and
// country/state names are left at the basemap's own sizes.
const SETTLEMENT_LABEL_RE = /settlement|^place-label|town|village|city/;
// The basemap's own text-size for each layer we have scaled, so repeated calls
// scale the original rather than compounding on the last result. Keyed by the
// basemap they were read from, since a style swap replaces every layer.
let placeLabelBaseSizes = new Map();
let placeLabelBaseStyle = "";

function expressionUsesZoom(expression) {
  if (!Array.isArray(expression)) return false;
  if (expression[0] === "zoom") return true;
  return expression.some(expressionUsesZoom);
}

// Multiply what a text-size expression evaluates to, without wrapping it.
//
// The obvious ["*", <the basemap's expression>, 1.16] is rejected by the style
// spec: a ["zoom"] expression is only legal as the direct input of a top-level
// step/interpolate, so burying the basemap's zoom curve inside a multiply makes
// the whole property invalid and the size silently stays as it was. Scaling the
// *outputs* — the numbers each branch resolves to — keeps the zoom curve where
// the spec requires it and produces the same result.
//
// Returns null for a shape this doesn't know how to walk, which leaves that
// layer at the basemap's own size rather than breaking it.
function scaleSizeExpression(expression, factor) {
  if (typeof expression === "number") return expression * factor;
  if (!Array.isArray(expression)) return null;
  const scaleAll = (values) => {
    const out = [];
    for (const value of values) {
      const scaled = scaleSizeExpression(value, factor);
      if (scaled == null) return null;
      out.push(scaled);
    }
    return out;
  };
  const op = expression[0];
  // [op, interpolation, input, stop, output, stop, output, …]
  if (op === "interpolate" || op === "interpolate-hcl" || op === "interpolate-lab") {
    const head = expression.slice(0, 3);
    const stops = expression.slice(3);
    const outputs = scaleAll(stops.filter((_, index) => index % 2 === 1));
    if (!outputs) return null;
    return [...head, ...stops.map((value, index) => (index % 2 === 1 ? outputs[(index - 1) / 2] : value))];
  }
  // ["step", input, default, stop, output, stop, output, …]
  if (op === "step") {
    const rest = expression.slice(2);
    const outputs = scaleAll(rest.filter((_, index) => index % 2 === 0));
    if (!outputs) return null;
    return [op, expression[1], ...rest.map((value, index) => (index % 2 === 0 ? outputs[index / 2] : value))];
  }
  // ["match", input, label, output, …, default]
  if (op === "match") {
    const rest = expression.slice(2);
    const scaled = rest.map((value, index) =>
      (index % 2 === 1 || index === rest.length - 1) ? scaleSizeExpression(value, factor) : value);
    if (scaled.some((value, index) =>
      (index % 2 === 1 || index === rest.length - 1) && value == null)) return null;
    return [op, expression[1], ...scaled];
  }
  // ["case", condition, output, …, default]
  if (op === "case") {
    const rest = expression.slice(1);
    const scaled = rest.map((value, index) =>
      (index % 2 === 1 || index === rest.length - 1) ? scaleSizeExpression(value, factor) : value);
    if (scaled.some((value, index) =>
      (index % 2 === 1 || index === rest.length - 1) && value == null)) return null;
    return [op, ...scaled];
  }
  // Anything else can be multiplied outright, as long as no zoom curve is
  // hiding inside it.
  return expressionUsesZoom(expression) ? null : ["*", expression, factor];
}

// Place names come from the basemap style, so hiding them (and sizing them)
// means walking its symbol layers rather than one of ours.
function applyPlaceLabelSetting() {
  if (!radarMap || !radarMap.getStyle()) return;
  if (placeLabelBaseStyle !== activeBasemap) {
    placeLabelBaseSizes = new Map();
    placeLabelBaseStyle = activeBasemap;
  }
  for (const layer of radarMap.getStyle().layers || []) {
    if (layer.type !== "symbol") continue;
    if (!/label|place|poi|settlement|country|state|marine|water-point/.test(layer.id)) continue;
    try {
      radarMap.setLayoutProperty(layer.id, "visibility", mapSettings.placeLabels ? "visible" : "none");
    } catch {}
    if (!SETTLEMENT_LABEL_RE.test(layer.id)) continue;
    try {
      if (!placeLabelBaseSizes.has(layer.id)) {
        placeLabelBaseSizes.set(layer.id, radarMap.getLayoutProperty(layer.id, "text-size") ?? null);
      }
      const base = placeLabelBaseSizes.get(layer.id);
      const scaled = scaleSizeExpression(base, PLACE_LABEL_SCALE);
      if (scaled == null) continue;
      radarMap.setLayoutProperty(layer.id, "text-size", scaled);
    } catch {}
  }
}

// Scale the whole alert-outline stack in one go. The stops of an
// ["interpolate", ["linear"], ["zoom"], z0, px0, z1, px1, …] expression alternate
// zoom, width from index 3 onward — only the widths are scaled.
function scaledZoomWidths(expression, scale) {
  return expression.map((value, index) =>
    index >= 4 && index % 2 === 0 ? Number((value * scale).toFixed(2)) : value);
}

function applyAlertBorderSettings() {
  if (!radarMap || !radarMap.getStyle()) return;
  const scale = ALERT_BORDER_SCALE[mapSettings.alertBorders] ?? 1;
  for (const prefix of ["alerts", "nws-alerts"]) {
    for (const [part, base] of Object.entries(ALERT_BORDER_WEIGHTS)) {
      const id = `${prefix}-${part}`;
      if (!radarMap.getLayer(id)) continue;
      try { radarMap.setPaintProperty(id, "line-width", scaledZoomWidths(base, scale)); } catch {}
    }
  }
}

// Legends and the docked scrubber are both optional furniture.
function applyMapChromeSettings() {
  renderMrmsLegend();
  renderSpcLegend();
  const scrubber = document.querySelector("#mapFrameScrubber");
  if (scrubber) scrubber.hidden = !mapSettings.scrubber || !(radarActive || satelliteActive);
}

// Everything the Settings panel can change about the map, applied to a live map.
function applyMapSettings() {
  document.documentElement.classList.toggle("reduce-motion", mapSettings.reduceAnimations);
  applyBoundarySettings();
  applyAlertBorderSettings();
  applyMapChromeSettings();
}

// Place names still belong above the borders; everything else does not.
function boundaryAnchorId() {
  const layers = radarMap.getStyle()?.layers || [];
  return layers.find(layer => layer.type === "symbol" && /label|place|poi/.test(layer.id))?.id;
}

// First basemap boundary or label layer. Weather layers insert beneath it so
// admin borders and place names always render on top of the weather stack.
function basemapLabelAnchorId() {
  const layers = radarMap.getStyle()?.layers || [];
  const anchor = layers.find(layer =>
    layer.type === "symbol" || (layer.type === "line" && /admin|boundary/.test(layer.id)));
  // Falling back to our own border layers keeps weather underneath them even
  // on a basemap that has no labels or admin lines of its own.
  return anchor?.id || BOUNDARY_LAYER_IDS.find(id => radarMap.getLayer(id));
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
  restackWeatherLayers();
}

// Async decoders mount custom WebGL layers outside addWeatherLayer(), and the
// order their network requests finish is nondeterministic. Rebuild the complete
// weather stack after any layer lands so alert fills always stay below radar
// while alert outlines always stay above it.
function restackWeatherLayers() {
  if (!radarMap || !radarMap.getStyle()) return;
  const anchor = basemapLabelAnchorId();
  WEATHER_LAYER_ORDER.forEach(id => {
    if (!radarMap.getLayer(id)) return;
    try { radarMap.moveLayer(id, anchor); } catch {}
  });
}

async function addSatelliteLayer() {
  const renderedSequence = ++renderedSatelliteSequence;
  // The legacy frame publisher still owns its storm-specific cropped products.
  // Full-disk/CONUS imagery below is raw and decoded locally; selecting an
  // explicit storm crop temporarily uses that publisher until the raw decoder
  // gains the same cyclone-window control.
  if (activeSatelliteSector) {
    const renderedView = captureRenderedSatelliteView();
    onDeviceWeatherApi?.setVisibility({ satellite: false });
    onDeviceSatelliteFrameInfo = [];
    return addRenderedSatelliteLayer(renderedView, renderedSequence);
  }
  const requestedSource = activeSatelliteSource;
  const requestedType = activeSatelliteType;
  const requestIsCurrent = () => Boolean(
    satelliteActive &&
    !activeSatelliteSector &&
    activeSatelliteSource === requestedSource &&
    activeSatelliteType === requestedType
  );
  try {
    const api = await getOnDeviceWeather();
    if (!requestIsCurrent()) return;
    api.setVisibility({ radar: radarActive, satellite: satelliteActive });
    api.setOpacity(radarOpacity);
    await api.loadSatellite({
      map: radarMap,
      beforeId: boundaryAnchorId(),
      sourceKey: requestedSource,
      productKey: requestedType,
      location: selectedLocation,
      onStatus: status => {
        if (requestIsCurrent()) handleOnDeviceStatus(status);
      },
      onFrame: event => {
        if (requestIsCurrent()) handleOnDeviceFrame(event);
      },
    });
    if (!requestIsCurrent()) return;
    restackWeatherLayers();
    raiseBoundaryLayers();
  } catch (error) {
    if (!requestIsCurrent()) return;
    // Keep the existing generated-frame path as a resilience fallback for old
    // browsers that lack module workers, DecompressionStream, or WebGL support.
    console.warn("On-device satellite decode unavailable; using rendered fallback", error);
    onDeviceWeatherApi?.setVisibility({ satellite: false });
    onDeviceSatelliteFrameInfo = [];
    if (satSource().rawOnly) {
      setFrameTimeLabel(`Satellite decode failed: ${error.message}`);
      return;
    }
    await addRenderedSatelliteLayer(captureRenderedSatelliteView(), renderedSequence);
  }
}

async function addRenderedSatelliteLayer(
  view = captureRenderedSatelliteView(),
  sequence = ++renderedSatelliteSequence,
) {
  if (!radarMap || !mapLoaded) return;
  const requestIsCurrent = () => Boolean(
    sequence === renderedSatelliteSequence &&
    satelliteActive &&
    renderedSatelliteViewIsCurrent(view)
  );

  const count = await detectSatFrameCount(view);
  if (!radarMap || !radarMap.getStyle() || !requestIsCurrent()) return;
  satFrames = Array.from({ length: count }, (_, i) => count - 1 - i); // [count-1 … 0]
  satFrameIndex = satFrames.length - 1;                                // newest

  const [west, east, south, north] = view.extent;
  const coords = [[west, north], [east, north], [east, south], [west, south]];

  const url = await warpedFrameUrl(satFrames[satFrameIndex], view).catch(() => null);
  if (!url || !radarMap.getStyle() || !requestIsCurrent()) return;
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
  if (requestIsCurrent()) {
    syncFrameSliders({
      max: satFrames.length - 1,
      value: satFrameIndex,
      disabled: satFrames.length < 2,
    });
    setPlayButtonsEnabled(satFrames.length >= 2);
    updateRadarLabel();
  }
  prewarmSatFrames(view); // warp the rest in the background for smooth animation
}

// Warp remaining frames ahead of time so scrubbing/animation doesn't stutter.
function prewarmSatFrames(view = captureRenderedSatelliteView()) {
  [...satFrames].forEach(frame => { warpedFrameUrl(frame, view).catch(() => {}); });
}

function setSatelliteFrame(index) {
  if (onDeviceSatelliteFrameInfo.length) {
    satFrameIndex = Math.max(0, Math.min(satFrames.length - 1, Number(index)));
    updateRadarLabel();
    return getOnDeviceWeather()
      .then(api => api.showSatelliteFrame(satFrameIndex))
      .then(result => {
        restackWeatherLayers();
        raiseBoundaryLayers();
        refreshInspectReadout();
        return result;
      })
      .catch(error => {
        setFrameTimeLabel(`Satellite decode failed: ${error.message}`);
        console.warn("On-device satellite frame unavailable", error);
      });
  }
  if (!satFrames.length) return;
  satFrameIndex = Math.max(0, Math.min(satFrames.length - 1, Number(index)));
  const frame = satFrames[satFrameIndex];
  const view = captureRenderedSatelliteView();
  warpedFrameUrl(frame, view).then(url => {
    const src = radarMap?.getSource("satellite-source");
    if (
      url &&
      src &&
      satelliteActive &&
      renderedSatelliteViewIsCurrent(view) &&
      satFrames[satFrameIndex] === frame
    ) {
      try { src.updateImage({ url }); } catch {}
    }
  }).catch(() => {});
  updateRadarLabel();
}

// ─── Satellite TC sectors ─────────────────────────────────────────────────────
// Each satellite repo also renders zoomed, native-resolution crops around active
// tropical cyclones, with its own metadata file and naming convention.
function sectorMetaUrl(source) {
  const file = source.sectorScheme === "himawari" ? "sectors_meta.json" : "cyclones.json";
  return satDataUrl(source, file);
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
  if (!source || source.rawOnly || !source.sectorScheme) {
    satSectorCache[sourceId] = [];
    return satSectorCache[sourceId];
  }
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

// ── Intensity, derived from the wind rather than taken from the feed ─────────
// The classification and colour a warning centre ships with a fix describe that
// centre's own scale, and in the west Pacific they disagree with the wind speed
// in the very same record: JTWC calls everything from 64 kt to 155 kt a
// "Typhoon" (with one colour for all of it), and the forecast points inherit
// whatever the current fix was tagged with rather than being re-classified at
// the wind they are forecasting. The maximum sustained wind is the one number
// both JTWC and NHC actually publish per point, so every label and colour on
// the overlay is computed from it here — a 130 kt typhoon reads as the Category
// 4 equivalent it is, and a forecast point that weakens changes colour.
const SAFFIR_SIMPSON = [
  { minKt: 137, cat: 5, color: "#ff6060" },
  { minKt: 113, cat: 4, color: "#ff8f20" },
  { minKt: 96,  cat: 3, color: "#ffc140" },
  { minKt: 83,  cat: 2, color: "#ffe775" },
  { minKt: 64,  cat: 1, color: "#ffffcc" },
];
const TROPICAL_STORM_STYLE = { label: "Tropical Storm", color: "#00faf4" };
const TROPICAL_DEPRESSION_STYLE = { label: "Tropical Depression", color: "#5ebaff" };

// What a hurricane-force tropical cyclone is called in the basin it is in. The
// Saffir–Simpson number is an equivalence everywhere outside the Atlantic and
// east Pacific, but it is the scale readers know, so it is shown for all of them.
function cycloneBasinTerm(basinCode = "", basinName = "") {
  const text = `${basinCode} ${basinName}`.toUpperCase();
  // "WEST" alone is not enough — the south-west Indian Ocean is a cyclone basin.
  if (/\bWP\b|WEST\w*\s+(NORTH\s+)?PACIFIC/.test(text)) return "Typhoon";
  if (/\bIO\b|\bSH\b|INDIAN|SOUTHERN/.test(text)) return "Cyclone";
  return "Hurricane";
}

// { label, color } for one fix or forecast point, from its sustained wind (kt).
function cycloneIntensity(windKt, basinCode, basinName) {
  const wind = Number(windKt);
  if (!Number.isFinite(wind)) return { label: "", color: TROPICAL_DEPRESSION_STYLE.color };
  const step = SAFFIR_SIMPSON.find(entry => wind >= entry.minKt);
  if (!step) {
    const style = wind >= 34 ? TROPICAL_STORM_STYLE : TROPICAL_DEPRESSION_STYLE;
    return { label: style.label, color: style.color };
  }
  const term = cycloneBasinTerm(basinCode, basinName);
  // "Hurricane (Cat 3)" in the Atlantic, where the scale is native; elsewhere the
  // number is an equivalence and says so.
  const suffix = term === "Hurricane" ? `Cat ${step.cat}` : `Cat ${step.cat} equivalent`;
  return { label: `${term} (${suffix})`, color: step.color };
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
    const basinCode = storm.basin || "";
    const basinName = storm.basin_name || "";
    const intensityOf = point => cycloneIntensity(point?.wind_kt, basinCode, basinName);
    const trackColor = cur ? intensityOf(cur).color : "#38bdf8";

    if (fc.length > 1) {
      tracks.push({
        type: "Feature",
        properties: { color: trackColor, name: storm.name || storm.id },
        geometry: { type: "LineString", coordinates: fc.map(p => [p.lon, p.lat]) },
      });
    }

    fc.forEach(p => {
      const intensity = intensityOf(p);
      points.push({
        type: "Feature",
        properties: {
          color: intensity.color,
          isCurrent: p.tau === 0,
          tau: p.tau,
          name: storm.name || storm.id,
          id: storm.id,
          basin: basinName || basinCode,
          classification: intensity.label,
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
    new mapboxgl.Popup({ offset: 12, maxWidth: POPUP_MAX_WIDTH })
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
    ? `<span class="popup-chip" style="background:${color}22;color:${color};border-color:${color}66">Current</span>`
    : `<span class="popup-chip">+${tau}h forecast</span>`;
  const finalTag = (Number(p.isFinal) === 1 && isCur)
    ? `<span class="popup-chip" style="background:rgba(239,68,68,0.18);color:#fca5a5;border-color:rgba(239,68,68,0.5)">Final warning</span>` : "";
  const lat = Number(p.lat), lon = Number(p.lon);
  const pos = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
  const when = p.datetime
    ? new Date(p.datetime).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC"
    : "—";
  const press = Number(p.pressure_mb) > 0 ? `${p.pressure_mb} mb` : "";
  const mph = numericWind(p.wind_mph) != null ? fmtWind(numericWind(p.wind_mph)) : `${p.wind_mph} mph`;
  return `
    <div class="popup-header">
      <div class="popup-icon" style="background:${color}22;border:1px solid ${color}66;color:${color}">🌀</div>
      <div>
        <div class="popup-title">${safeText(p.name)}</div>
        <div class="popup-subtitle">${safeText([p.id, p.basin].filter(Boolean).join(" · "))}</div>
      </div>
    </div>
    <div class="popup-chip-row">${tag}${finalTag}${p.classification ? `<span class="popup-chip" style="background:${color}22;color:${color};border-color:${color}66">${safeText(p.classification)}</span>` : ""}</div>
    <div class="popup-reading">
      <span class="popup-reading-value" style="color:${color}">${safeText(String(p.wind_kt))} kt</span>
      <span class="popup-reading-sub">${safeText([mph, press].filter(Boolean).join(" · "))}</span>
    </div>
    <div class="popup-stat"><span class="popup-key">Position</span><span class="popup-val">${pos}</span></div>
    <div class="popup-stat"><span class="popup-key">Valid</span><span class="popup-val">${safeText(when)}</span></div>`;
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
  radarMap.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 60, maxZoom: 6, duration: mapMotionMs(800) });
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

// A storm report is what was seen, where, and when. The magnitude leads when
// there is one — that is the number people came for — and the observer's remark
// follows underneath, where a long one wraps instead of becoming the title.
function buildLsrItemHtml(feature) {
  const p = feature.properties || {};
  const cfg = lsrIconConfig(p);
  const time = p.valid
    ? new Date(p.valid).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";
  const place = p.city || p.county || "";
  const magnitude = p.magnitude
    ? `${String(p.magnitude)}${p.magUnit ? ` ${p.magUnit}` : ""}`.trim()
    : "";
  return `
    <div class="popup-header">
      <div class="popup-icon" style="background:${cfg.color}22;border:1px solid ${cfg.color}66;color:${cfg.color}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${cfg.svg}</svg></div>
      <div>
        <div class="popup-title">${safeText(cfg.label)}</div>
        <div class="popup-subtitle">${safeText([place, time].filter(Boolean).join(" · ") || "Storm report")}</div>
      </div>
    </div>
    [NAV_SLOT]
    <div class="popup-reading">
      <span class="popup-reading-value">${safeText(magnitude || cfg.label)}</span>
      ${p.source ? `<span class="popup-reading-sub">Reported by ${safeText(p.source)}</span>` : ""}
    </div>
    ${p.remark ? `<div class="popup-note">${safeText(p.remark)}</div>` : ""}`;
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
        alertId: alert.id,
        event: alert.event,
        headline: alert.headline,
        severity: alert.severity,
        expires: alert.expires,
        description: alert.description,
        areaDesc: alert.areaDesc,
        riskColor: alert.riskColor,
        damageThreat: alert.damageThreat,
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

function normalizeMapAlertId(value) {
  return String(value || "")
    .replace(/^https?:\/\/api\.weather\.gov\/alerts\//i, "")
    .replace(/\/actual$/i, "")
    .trim()
    .toLowerCase();
}

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

async function refreshAlertsForCurrentView() {
  if (!activeOverlays.has("Alerts") || !radarMap || !mapLoaded) return;
  if (alertPanRefreshInFlight) {
    alertPanRefreshQueued = true;
    return;
  }
  if (alertFetchBox && boxContains(alertFetchBox, desiredAlertFetchBox())) return;
  alertPanRefreshInFlight = true;
  alertPanRefreshQueued = false;
  try {
    // Keep the currently painted polygons in place while the next camera box
    // loads. addAlertsLayer replaces the source atomically when it is ready.
    nwsAlertPolygonData = null;
    await addAlertsLayer();
  } catch (error) {
    console.warn("Alert overlay refresh failed", error);
  } finally {
    alertPanRefreshInFlight = false;
    const movedPastResult = activeOverlays.has("Alerts") && alertFetchBox &&
      !boxContains(alertFetchBox, desiredAlertFetchBox());
    if (alertPanRefreshQueued || movedPastResult) {
      alertPanRefreshQueued = false;
      setTimeout(refreshAlertsForCurrentView, 0);
    }
  }
}

async function nwsAlertFeatureCollection() {
  const loc = selectedLocation;
  // Fetch the regional queries for what the map is actually showing (plus
  // margin) so panning anywhere on the continent surfaces alerts; the
  // moveend handler in addAlertsLayer refetches once the view leaves the box.
  const box = desiredAlertFetchBox();
  const [nwsResult, ecccResult, wwaResult] = await Promise.allSettled([
    getJson(`https://api.weather.gov/alerts/active?point=${loc.lat},${loc.lon}`, { cache: "no-store" }),
    ecccAlertMapFeatures(box),
    nwsRegionalAlertFeatures(box),
  ]);
  const data = nwsResult.status === "fulfilled" ? nwsResult.value : { features: [] };
  const features = ecccResult.status === "fulfilled" ? [...ecccResult.value] : [];
  const localAlertIds = new Set((data.features || [])
    .map(feature => normalizeMapAlertId(feature.properties?.id))
    .filter(Boolean));
  if (wwaResult.status === "fulfilled") {
    // Skip regional copies of alerts the point query already supplies with
    // fuller properties (zone names, descriptions) for the selected location.
    features.push(...wwaResult.value.filter(feature =>
      !localAlertIds.has(normalizeMapAlertId(feature.properties.capId))));
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
  return {
    collection: { type: "FeatureCollection", features },
    box,
    // The regional WWA query is what makes this result representative of the
    // visible map. If it failed, leave the coverage box unset so the next
    // camera stop retries instead of treating a point-only response as loaded.
    regionalLoaded: wwaResult.status === "fulfilled",
  };
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
      p.hailtag && `Hail ${unitChoice("precip") === "mm" && Number.isFinite(Number(p.hailtag)) ? `${(Number(p.hailtag) * 2.54).toFixed(1)} cm` : `${p.hailtag}"`}`,
      p.tornadotag && `Tornado ${String(p.tornadotag).toLowerCase()}`,
    ];
  } else {
    const evtLower = (p.event || "").toLowerCase();
    const matchedAlert = (weatherState.alerts || []).find(alert =>
      alert.event?.toLowerCase() === evtLower &&
      (p.ecccAlert
        ? alert.source === "ECCC" && ecccRiskColor(alert.riskColor) === ecccRiskColor(p.riskColor)
        : alert.source !== "ECCC")
    );
    title = safeText(matchedAlert
      ? alertDisplayEvent(matchedAlert)
      : alertDisplayEvent({ event: p.event || "Weather Alert", source: p.ecccAlert ? "ECCC" : "NWS", riskColor: p.riskColor }));
    subtitle = p.ecccAlert ? "ECCC Alert" : "NWS Alert";
    iconStyle = `background:${safeText(p.fillColor || "#f59e0b")}22;border:1px solid ${safeText(p.lineColor || "#fbbf24")}66;`;
    chips = [
      expiresChip(p.expires),
      p.severity,
      ...(p.ecccAlert ? ecccWarningTags(p.event, p.riskColor) : []),
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

// A warned polygon has to be findable at a glance on a busy radar loop, so its
// edge is drawn as three stacked lines rather than one hairline:
//   halo   — a wide, soft, colored bloom that separates the outline from the
//            reflectivity underneath it,
//   casing — a near-black stroke that guarantees contrast on any basemap or
//            precipitation color,
//   line   — the alert's own color on top.
// Every width scales with zoom so the border is bold on a continental view and
// stays proportionate when zoomed into a single county.
const ALERT_BORDER_WEIGHTS = {
  // [zoom, px] stops, widest → narrowest, for [halo, casing, line].
  halo:   ["interpolate", ["linear"], ["zoom"], 3, 6, 6, 9, 10, 13],
  casing: ["interpolate", ["linear"], ["zoom"], 3, 4.4, 6, 6.4, 10, 8.8],
  line:   ["interpolate", ["linear"], ["zoom"], 3, 2.6, 6, 4, 10, 5.6],
};

const ALERT_LINE_LAYOUT = { "line-join": "round", "line-cap": "round" };

// Storm-based (IEM) polygons are keyed by phenomenon code; the paint expression
// is generated from the same palette the rest of the app uses.
const IEM_PHENOMENA_MATCH = key => [
  "match", ["get", "phenomena"],
  ...Object.entries(IEM_PHENOMENON_EVENTS).flatMap(([code, event]) => [code, alertEventColor(event)[key]]),
  "rgba(0,0,0,0)",
];

function alertBorderLayers(sourceId, prefix, colorExpression) {
  // Mount at the weight the user has chosen so a "Normal" setting never flashes
  // the maximum-width outline on the first paint.
  const scale = ALERT_BORDER_SCALE[mapSettings.alertBorders] ?? 1;
  const width = part => scaledZoomWidths(ALERT_BORDER_WEIGHTS[part], scale);
  return [
    {
      id: `${prefix}-halo`,
      type: "line",
      source: sourceId,
      layout: ALERT_LINE_LAYOUT,
      paint: {
        "line-color": colorExpression,
        "line-width": width("halo"),
        "line-opacity": 0.34,
        "line-blur": 3.5,
      },
    },
    {
      id: `${prefix}-casing`,
      type: "line",
      source: sourceId,
      layout: ALERT_LINE_LAYOUT,
      paint: {
        "line-color": "rgba(4, 8, 18, 0.88)",
        "line-width": width("casing"),
      },
    },
    {
      id: `${prefix}-line`,
      type: "line",
      source: sourceId,
      layout: ALERT_LINE_LAYOUT,
      paint: {
        "line-color": colorExpression,
        "line-width": width("line"),
      },
    },
  ];
}

function mountAlertLayers() {
  if (!radarMap || !mapLoaded) return;
  const emptyCollection = { type: "FeatureCollection", features: [] };

  if (!radarMap.getSource("alerts-source")) {
    radarMap.addSource("alerts-source", {
      type: "geojson",
      data: filterAlertCollectionForMap(alertPolygonData || emptyCollection, "iem"),
      // Generate real source tiles through the map's closest useful zooms.
      // Stopping at 10 made county/watch polygons depend on heavily overscaled
      // low-zoom tiles, where some features could disappear as users zoomed in.
      maxzoom: 22,
      tolerance: 0.25,
    });
  }
  if (!radarMap.getLayer("alerts-fill")) {
    addWeatherLayer({
      id: "alerts-fill",
      type: "fill",
      source: "alerts-source",
      paint: {
        "fill-color": IEM_PHENOMENA_MATCH("fill"),
        "fill-opacity": 0.3,
      },
    });
  }
  alertBorderLayers("alerts-source", "alerts", IEM_PHENOMENA_MATCH("line"))
    .forEach(layer => { if (!radarMap.getLayer(layer.id)) addWeatherLayer(layer); });

  if (!radarMap.getSource("nws-alerts-source")) {
    radarMap.addSource("nws-alerts-source", {
      type: "geojson",
      data: filterAlertCollectionForMap(nwsAlertPolygonData || emptyCollection, "nws"),
      maxzoom: 22,
      tolerance: 0.25,
    });
  }
  if (!radarMap.getLayer("nws-alerts-fill")) {
    addWeatherLayer({
      id: "nws-alerts-fill",
      type: "fill",
      source: "nws-alerts-source",
      paint: {
        "fill-color": ["get", "fillColor"],
        "fill-opacity": 0.22,
      },
    });
  }
  alertBorderLayers("nws-alerts-source", "nws-alerts", ["get", "lineColor"])
    .forEach(layer => { if (!radarMap.getLayer(layer.id)) addWeatherLayer(layer); });

  ensureAlertLayersVisible();
  restackWeatherLayers();
  applyAlertBorderSettings();

  if (!popupWiredLayers.has("all-alerts")) {
    ["alerts-fill", "nws-alerts-fill"].forEach(layer => {
      radarMap.on("mouseenter", layer, () => { radarMap.getCanvas().style.cursor = "pointer"; });
      radarMap.on("mouseleave", layer, () => { radarMap.getCanvas().style.cursor = ""; });
    });
    popupWiredLayers.add("all-alerts");
  }

  if (!popupWiredLayers.has("alerts-pan-refresh")) {
    radarMap.on("moveend", refreshAlertsForCurrentView);
    // A style/camera render can briefly evict a GeoJSON tile at high zoom.
    // Reassert the source data after the camera settles instead of waiting for
    // the next network refresh to make alerts visible again.
    radarMap.on("idle", () => {
      if (!activeOverlays.has("Alerts")) return;
      if (ALERT_LAYER_IDS.some(id => !radarMap.getLayer(id))) mountAlertLayers();
      ensureAlertLayersVisible();
    });
    popupWiredLayers.add("alerts-pan-refresh");
  }
}

async function addAlertsLayer() {
  if (!radarMap || !mapLoaded || !activeOverlays.has("Alerts")) return;
  const loadSequence = ++alertLoadSequence;

  // Mount both empty/cached sources immediately. Each provider paints as soon
  // as it finishes, and the sequence guard prevents an older pan/toggle request
  // from writing into layers created by a newer redraw.
  mountAlertLayers();
  const stillCurrent = () =>
    loadSequence === alertLoadSequence &&
    radarMap && mapLoaded && activeOverlays.has("Alerts");

  const iemLoad = (alertPolygonData
    ? Promise.resolve(alertPolygonData)
    : fetchOutlookGeoJson(IEM_SBW_URL).then(filterMapColoredWarnings))
    .then(data => {
      alertPolygonData = data;
      if (!stillCurrent()) return;
      radarMap.getSource("alerts-source")?.setData(filterAlertCollectionForMap(data, "iem"));
      restackWeatherLayers();
    });

  const nwsLoad = (nwsAlertPolygonData
    ? Promise.resolve({
        collection: nwsAlertPolygonData,
        box: alertFetchBox,
        regionalLoaded: Boolean(alertFetchBox),
      })
    : nwsAlertFeatureCollection())
    .then(result => {
      nwsAlertPolygonData = result.collection;
      alertFetchBox = result.regionalLoaded ? result.box : null;
      if (!stillCurrent()) return;
      radarMap.getSource("nws-alerts-source")?.setData(
        filterAlertCollectionForMap(result.collection, "nws"),
      );
      restackWeatherLayers();
    });

  const results = await Promise.allSettled([iemLoad, nwsLoad]);
  if (results.every(result => result.status === "rejected")) {
    throw new Error("All alert map sources failed to load");
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

const ALERT_LAYER_IDS = [
  "nws-alerts-fill", "nws-alerts-halo", "nws-alerts-casing", "nws-alerts-line",
  "alerts-fill", "alerts-halo", "alerts-casing", "alerts-line",
];

function ensureAlertLayersVisible() {
  if (!radarMap || !mapLoaded) return;
  ALERT_LAYER_IDS.forEach(id => {
    if (!radarMap.getLayer(id)) return;
    if (radarMap.getFilter(id)) radarMap.setFilter(id, null);
    if (radarMap.getLayoutProperty(id, "visibility") !== "visible") {
      radarMap.setLayoutProperty(id, "visibility", "visible");
    }
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
  if (onDeviceWeatherApi) {
    onDeviceWeatherApi.setVisibility({
      radar: radarActive,
      satellite: satelliteActive,
    });
  }
  // Mounted before the weather so every weather layer has something to anchor
  // beneath, and re-asserted after the async adds settle.
  addBoundaryLayers();

  if (radarActive)
    addRadarLayer(relocate).catch(e => console.warn("Radar unavailable", e));
  syncRadarSiteMarkers().catch(e => console.warn("Radar sites unavailable", e));
  if (activeOverlays.has("SPC"))          addSpcLayer().catch(e => console.warn("SPC unavailable", e));
  if (activeOverlays.has("Drought"))      addDroughtLayer().catch(e => console.warn("Drought unavailable", e));
  if (activeOverlays.has("Alerts"))       addAlertsLayer().catch(e => console.warn("Alerts unavailable", e));
  if (activeOverlays.has("Fire Wx"))      addFireWeatherLayer().catch(e => console.warn("Fire Wx unavailable", e));
  if (activeOverlays.has("WPC Rain"))     addWpcRainfallLayer().catch(e => console.warn("WPC Rain unavailable", e));
  if (activeOverlays.has("GOES GLM"))     addGlmLayer().catch(e => console.warn("GOES GLM unavailable", e));
  if (activeOverlays.has("LSR"))          addLsrLayer().catch(e => console.warn("LSR unavailable", e));
  if (activeOverlays.has("Cyclones"))     addCyclonesLayer().catch(e => console.warn("Cyclones unavailable", e));
  if (satelliteActive)                    addSatelliteLayer().catch(e => console.warn("Satellite unavailable", e));

  mapMarker?.setLngLat([selectedLocation.lon, selectedLocation.lat]);
  mapMarker?.setPopup(new mapboxgl.Popup({ offset: 14, maxWidth: POPUP_MAX_WIDTH }).setHTML(buildLocationPopup(selectedLocation.name)));
  // The adds above are async; give them a turn to land before restacking and
  // re-applying the user's map preferences over the rebuilt stack.
  setTimeout(() => { raiseBoundaryLayers(); applyMapSettings(); }, 0);
  radarMap.resize();
  if (relocate) {
    radarMap.flyTo({ center: [selectedLocation.lon, selectedLocation.lat], zoom: Math.max(radarMap.getZoom(), 8), duration: mapMotionMs(700) });
  }
}

function animateRadarLayer() {
  stopRadarAnimation();
  // Satellite owns the timeline whenever it is active; otherwise animate radar.
  const sat = satelliteActive;
  const frames = sat ? satFrames : radarFrames;
  if ((sat ? !satelliteActive : !radarActive) || !frames.length) return;
  setPlayingUi(true);
  // Radar is always decoded here; satellite still has a published-frame path.
  // A locally decoded frame is awaited before the next step is armed, so a slow
  // frame delays playback instead of stacking decodes up behind it.
  const decodedLocally = sat ? onDeviceSatelliteFrameInfo.length > 0 : true;
  if (!decodedLocally) {
    radarAnimationTimer = setInterval(() => {
    // Animate oldest→newest, wrapping back to the oldest after the latest frame.
      if (sat) setSatelliteFrame((satFrameIndex + 1) % satFrames.length);
      else setRadarFrame((radarFrameIndex + 1) % radarFrames.length);
    }, radarFrameDelay());
    return;
  }
  const tick = async () => {
    if (!radarAnimationTimer) return;
    if (sat) await setSatelliteFrame((satFrameIndex + 1) % satFrames.length);
    else await setRadarFrame((radarFrameIndex + 1) % radarFrames.length);
    if (radarAnimationTimer) radarAnimationTimer = setTimeout(tick, radarFrameDelay());
  };
  radarAnimationTimer = setTimeout(tick, radarFrameDelay());
}

const MAP_LAYER_INFO = {
  Radar: "MRMS radar combines many radar sites into one nationwide view. The default Precipitation Type product separates rain, snow, and ice.",
  Satellite: "GOES satellite imagery shows clouds, moisture, and storm structure from space.",
  "GOES GLM": "GOES-19 Geostationary Lightning Mapper flashes observed during the latest five minutes. New flashes are white; older flashes fade through yellow and orange.",
  SPC: "Storm Prediction Center outlooks show where severe thunderstorms are possible and how the risk changes over the next several days.",
  Alerts: "Active official warnings, watches, and advisories from the National Weather Service or Environment Canada.",
  "Fire Wx": "Storm Prediction Center fire-weather outlooks highlight areas where wind and dry fuels may support dangerous fire spread.",
  "WPC Rain": "Weather Prediction Center excessive-rainfall outlooks show where heavy rain could cause flash flooding.",
  LSR: "Local Storm Reports are recent reports of hail, wind damage, flooding, tornadoes, and other significant weather.",
  Drought: "The U.S. Drought Monitor's weekly assessment, from abnormally dry conditions through exceptional drought.",
  Cyclones: "Current National Hurricane Center and Joint Typhoon Warning Center tropical cyclone tracks and positions.",
};

function showMapLayerHelp(layerName = null) {
  const box = document.querySelector("#mapLayerHelp");
  const toggle = document.querySelector("#layerHelpToggle");
  if (!box) return;
  const entries = layerName
    ? [[layerName, MAP_LAYER_INFO[layerName]]]
    : Object.entries(MAP_LAYER_INFO).filter(([name]) => !["Radar", "Satellite"].includes(name));
  box.innerHTML = entries.map(([name, description]) => `
    <div class="map-layer-help-item">
      <strong>${safeText(name)}</strong>
      <span>${safeText(description)}</span>
    </div>`).join("");
  box.hidden = false;
  toggle?.setAttribute("aria-expanded", "true");
}

function renderLayers() {
  const baseEl = document.querySelector("#baseLayerPills");
  const overlayEl = document.querySelector("#overlayLayerPills");
  if (!baseEl || !overlayEl) return;

  const BASE_LAYERS = [
    { id: "Radar",     isActive: () => radarActive },
    { id: "Satellite", isActive: () => satelliteActive },
  ];
  const OVERLAY_LAYERS = ["GOES GLM", "SPC", "Alerts", "Fire Wx", "WPC Rain", "LSR", "Drought", "Cyclones"];

  baseEl.innerHTML = BASE_LAYERS.map(l =>
    `<button type="button" role="radio" aria-checked="${l.isActive()}" data-layer="${l.id}" class="${l.isActive() ? "active" : ""}" title="${safeText(MAP_LAYER_INFO[l.id])}">${l.id}</button>`
  ).join("");

  overlayEl.innerHTML = OVERLAY_LAYERS.map(l =>
    `<span class="layer-option">
      <button type="button" data-layer="${l}" aria-pressed="${activeOverlays.has(l)}" class="${activeOverlays.has(l) ? "active" : ""}" title="${safeText(MAP_LAYER_INFO[l])}">${l}</button>
      <button type="button" class="layer-info-btn" data-layer-info="${l}" title="${safeText(MAP_LAYER_INFO[l])}" aria-label="What is ${l}?">i</button>
    </span>`
  ).join("");

  baseEl.querySelectorAll("button[data-layer]").forEach(btn => {
    btn.addEventListener("click", () => {
      const layer = BASE_LAYERS.find(l => l.id === btn.dataset.layer);
      if (!layer || layer.isActive()) return;
      radarActive = layer.id === "Radar";
      satelliteActive = layer.id === "Satellite";
      stopRadarAnimation();
      renderLayers();
      drawRadar(false);
      if (
        layer?.id === "Satellite" &&
        satelliteActive &&
        radarMap &&
        !satelliteExtentContains(radarMap.getCenter().lng, radarMap.getCenter().lat)
      ) {
        fitSatelliteExtent(currentSatExtent());
      }
    });
  });

  overlayEl.querySelectorAll("button[data-layer-info]").forEach(btn => {
    btn.addEventListener("click", () => showMapLayerHelp(btn.dataset.layerInfo));
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
  // The bottom-docked scrubber follows the same rule: visible only while a
  // frame-based layer (radar or satellite) is on the map.
  const scrubber = document.querySelector("#mapFrameScrubber");
  if (scrubber) scrubber.hidden = !mapSettings.scrubber || !(radarActive || satelliteActive);
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

const RADAR_PALETTE_STORE_KEY = "weatherRadarPalettes";
let radarPalettesRestored = false;

function readRadarPaletteStore() {
  try {
    const value = JSON.parse(localStorage.getItem(RADAR_PALETTE_STORE_KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeRadarPaletteStore(store) {
  try { localStorage.setItem(RADAR_PALETTE_STORE_KEY, JSON.stringify(store)); } catch {}
}

function radarPaletteKey(mode = activeRadarMode, product = activeMrmsProduct) {
  return `${mode}:${product}`;
}

function restoreRadarPalettes(api) {
  if (radarPalettesRestored) return;
  radarPalettesRestored = true;
  for (const entry of Object.values(readRadarPaletteStore())) {
    if (!entry?.text || !entry.mode || !entry.productKey) continue;
    try { api.applyRadarPalette(entry); } catch {}
  }
}

async function loadRadarPaletteFile(file) {
  if (!file) return;
  const input = document.querySelector("#radarPaletteInput");
  try {
    const text = await file.text();
    const api = await getOnDeviceWeather();
    const entry = {
      mode: activeRadarMode,
      productKey: activeMrmsProduct,
      text,
      name: file.name,
    };
    api.applyRadarPalette(entry);
    const store = readRadarPaletteStore();
    store[radarPaletteKey()] = entry;
    writeRadarPaletteStore(store);
    renderRadarSubControls();
    renderMrmsLegend();
    setFrameTimeLabel(`${file.name} color table applied`);
  } catch (error) {
    setFrameTimeLabel(`Color table failed: ${error.message}`);
  } finally {
    if (input) input.value = "";
  }
}

async function resetActiveRadarPalette() {
  const api = await getOnDeviceWeather();
  api.resetRadarPalette({ mode: activeRadarMode, productKey: activeMrmsProduct });
  const store = readRadarPaletteStore();
  delete store[radarPaletteKey()];
  writeRadarPaletteStore(store);
  renderRadarSubControls();
  renderMrmsLegend();
}

function fitSatelliteExtent(extent, padding = 30) {
  if (!radarMap || !extent) return;
  const [west, east, south, north] = extent;
  radarMap.fitBounds(
    [[west, Math.max(-85, south)], [east, Math.min(85, north)]],
    { padding, duration: mapMotionMs(700) }
  );
}

function satelliteExtentContains(lon, lat, extent = currentSatExtent()) {
  if (!extent || !Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  const [west, east, south, north] = extent;
  if (lat < south || lat > north) return false;
  return [lon - 360, lon, lon + 360].some(candidate => candidate >= west && candidate <= east);
}

function renderSatelliteSubControls() {
  const sourceEl = document.querySelector("#satelliteSourceSelect");
  const typeEl   = document.querySelector("#satelliteTypeBtns");
  const sectorEl = document.querySelector("#satelliteSectorSelect");
  const sectorRow = document.querySelector("#satelliteSectorRow");

  if (sourceEl) {
    const standardSources = SATELLITE_SOURCES.filter(s => !s.rawOnly);
    const rapidScanSources = SATELLITE_SOURCES.filter(s => s.rawOnly);
    sourceEl.innerHTML = `
      <optgroup label="Full disk and regional">
        ${standardSources.map(s => `<option value="${s.id}" title="${safeText(s.note)}">${safeText(s.label)}</option>`).join("")}
      </optgroup>
      <optgroup label="Rapid scan (mesoscale and target)">
        ${rapidScanSources.map(s => `<option value="${s.id}" title="${safeText(s.note)}">${safeText(s.label)}</option>`).join("")}
      </optgroup>`;
    sourceEl.value = activeSatelliteSource;
    sourceEl.onchange = () => {
      if (sourceEl.value === activeSatelliteSource) return;
      activeSatelliteSource = sourceEl.value;
      activeSatelliteSector = null; // storm crops are per-source
      activeSatelliteType = satBand().id; // drop bands the new source lacks
      localStorage.setItem("satelliteSource", activeSatelliteSource);
      renderSatelliteSubControls();
      drawRadar(false);
      fitSatelliteExtent(satSource().extent); // frame the newly selected region
    };
  }

  if (typeEl) {
    const activeBandId = satBand().id;
    typeEl.innerHTML = satBandsFor(satSource()).map(b => {
      const title = b.note ? ` title="${safeText(b.note)}"` : "";
      return `<button type="button" data-sat-type="${b.id}" class="${b.id === activeBandId ? "active" : ""}"${title}>${safeText(b.label)}</button>`;
    }).join("");
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
      sectorEl.innerHTML = [{ id: null, label: "Full sector" }, ...sectors]
        .map(s => `<option value="${s.id ?? ""}">${safeText(s.label)}</option>`)
        .join("");
      sectorEl.value = activeSatelliteSector || "";
      sectorEl.onchange = () => {
        const id = sectorEl.value || null;
        if (id === activeSatelliteSector) return;
        activeSatelliteSector = id;
        renderSatelliteSubControls();
        drawRadar(false);
        fitSatelliteExtent(currentSatExtent(), id ? 60 : 30);
      };
    }
  }
}

function renderSpcLegend() {
  const box = document.querySelector("#spcLegendBox");
  if (!box) return;
  if (!activeOverlays.has("SPC") || !mapSettings.legend) { box.hidden = true; return; }
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
  document.querySelectorAll("#radarModeBtns [data-radar-mode]").forEach(button => {
    button.classList.toggle("active", button.dataset.radarMode === activeRadarMode);
  });
  sel.querySelectorAll("optgroup[data-radar-products]").forEach(group => {
    const enabled = group.dataset.radarProducts === activeRadarMode;
    group.hidden = !enabled;
    group.disabled = !enabled;
  });
  sel.value = activeMrmsProduct;
  const paletteRow = document.querySelector(".radar-palette-row");
  if (paletteRow) paletteRow.hidden = isPrecipTypeProduct();
  const palette = onDeviceWeatherApi?.radarPalette(activeRadarMode, activeMrmsProduct);
  const paletteName = document.querySelector("#radarPaletteName");
  if (paletteName) paletteName.textContent = palette?.name || "Default";
}

// The legend is a colour key and nothing else. It used to double as a status
// line — how the data was decoded, which storm-motion vector the extrapolation
// had fitted, how confident it was — none of which helps read the map, and all
// of which crowded the box on a phone. The scrubber already labels which frame
// is on screen, so what is left here is the product name, the ramp, and its
// values.
function renderMrmsLegend() {
  const box = document.querySelector("#mrmsLegendBox");
  if (!box) return;
  if (!radarActive || !mapSettings.legend) { box.hidden = true; return; }
  box.hidden = false;
  // A banded product reports no single ramp, so it falls through to its own
  // multi-ramp key below.
  const livePalette = onDeviceWeatherApi?.radarPalette(activeRadarMode, activeMrmsProduct);
  if (livePalette) {
    const cfg = activeRadarMode === "single"
      ? ON_DEVICE_RADAR_PRODUCTS[activeMrmsProduct]
      : MRMS_PRODUCTS[activeMrmsProduct];
    const mid = (livePalette.lo + livePalette.hi) / 2;
    const decimals = Math.max(Math.abs(livePalette.lo), Math.abs(livePalette.hi)) < 10 ? 1 : 0;
    const tick = value => Number(value).toFixed(decimals);
    box.innerHTML = `
      <div class="legend-title">${safeText((cfg?.label || "RADAR").toUpperCase())}</div>
      <div class="mrms-legend-section">
        <div class="legend-gradient" style="background:linear-gradient(90deg,${livePalette.colors.join(",")})"></div>
        <div class="legend-ticks" style="--tick-count:3">
          ${[livePalette.lo, mid, livePalette.hi].map((value, index) =>
            `<span class="legend-tick"><span>${safeText(tick(value))}${index === 2 && livePalette.unit ? ` ${safeText(livePalette.unit)}` : ""}</span></span>`
          ).join("")}
        </div>
      </div>`;
    return;
  }
  if (activeRadarMode === "single") {
    const legend = ON_DEVICE_RADAR_LEGENDS[activeMrmsProduct];
    box.innerHTML = legend ? `
      <div class="legend-title">${safeText(legend.title)}</div>
      <div class="mrms-legend-section">
        <div class="legend-gradient" style="background:${legend.gradient}"></div>
        <div class="legend-ticks" style="--tick-count:${legend.ticks.length}">
          ${legend.ticks.map(tick => `<span class="legend-tick"><span>${safeText(tick)}</span></span>`).join("")}
        </div>
      </div>` : "";
    return;
  }
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

// ─── Map click readouts ──────────────────────────────────────────────────────

async function loadImgCors(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image load failed: ${url}`));
    img.src = url;
  });
}

// Read the radar value under a click. Every product is decoded in the browser,
// so the answer is the grid cell (or radar gate) itself — no companion file to
// download, no colour to reverse-engineer.
function sampleRadarValue(lngLat) {
  if (!lngLat || !onDeviceWeatherApi) return null;
  return onDeviceWeatherApi.sampleRadar(lngLat.lng, lngLat.lat);
}

// "0.16 in/hr", "47 dBZ" — the number that was clicked on, and nothing else.
function radarValueLabel(data) {
  if (!Number.isFinite(data.value)) return "--";
  return `${data.value.toFixed(data.dec ?? 0)}${data.unit ? ` ${data.unit}` : ""}`;
}

// ─── Inspect tool ────────────────────────────────────────────────────────────
// A live readout of the value under a point, rather than the click-a-spot,
// read-a-popup, dismiss-the-popup loop. It takes two shapes because the two
// kinds of device can't share one:
//
//   • Pointer devices track the mouse. The reading follows the cursor, so
//     sweeping across a cell reads the whole gradient as you go.
//   • Touch devices have no hover and a finger covers what it is pointing at,
//     so the sight is fixed at the centre of the map and the map is dragged
//     under it.
//
// It is also the *only* way to read a value: a map click no longer opens a
// radar-value popup (see collectPopupItems), which answered the same question
// once and then had to be dismissed.
let inspectMode = false;
let inspectPointerPoint = null;   // last mouse position, in map-canvas pixels
let inspectRefreshQueued = false;

function usesTouchInspect() {
  return window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
}

function inspectElements() {
  return {
    button: document.querySelector("#mapInspectToggle"),
    readout: document.querySelector("#mapInspectReadout"),
    crosshair: document.querySelector("#mapInspectCrosshair"),
  };
}

function setInspectMode(on) {
  const next = on ?? !inspectMode;
  if (next === inspectMode) return;
  inspectMode = next;
  const { button, readout, crosshair } = inspectElements();
  button?.classList.toggle("active", inspectMode);
  button?.setAttribute("aria-pressed", String(inspectMode));
  if (crosshair) crosshair.hidden = !(inspectMode && usesTouchInspect());
  if (!inspectMode) {
    inspectPointerPoint = null;
    if (readout) { readout.hidden = true; readout.innerHTML = ""; }
    return;
  }
  // A mouse has not moved yet, so there is nothing to read until it does; the
  // crosshair always has the centre of the map to read. The canvas cursor is
  // deliberately left alone — the overlay layers set it to a pointer over their
  // own polygons, and fighting them for it just makes it flicker.
  refreshInspectReadout();
}

// Called from the map's own move/mouse events and whenever a new radar frame
// lands, so the number on screen always describes the frame on screen.
function refreshInspectReadout() {
  if (!inspectMode || inspectRefreshQueued) return;
  inspectRefreshQueued = true;
  requestAnimationFrame(() => {
    inspectRefreshQueued = false;
    if (inspectMode) drawInspectReadout();
  });
}

function drawInspectReadout() {
  const { readout } = inspectElements();
  if (!readout || !radarMap) return;
  const touch = usesTouchInspect();
  if (!touch && !inspectPointerPoint) { readout.hidden = true; return; }

  // The touch sight is nailed to the centre of the map, which is the map's own
  // centre coordinate; the pointer one has to be unprojected from the cursor.
  const point = inspectPointerPoint;
  const lngLat = touch ? radarMap.getCenter() : radarMap.unproject([point.x, point.y]);

  let reading = null;
  try { reading = radarActive ? sampleRadarValue(lngLat) : null; } catch {}

  const coords = `${lngLat.lat.toFixed(3)}°, ${lngLat.lng.toFixed(3)}°`;
  let title = "Inspect";
  let value = "--";
  let sub = coords;
  if (!radarActive) {
    value = "No radar";
    sub = "Turn on the Radar layer to read values";
  } else if (!reading || reading.noData) {
    title = onDeviceWeatherApi?.currentState?.()?.radar?.product?.label || "Radar";
    value = "No data";
  } else {
    title = reading.product || "Radar";
    value = reading.precipType || radarValueLabel(reading);
    const parts = [reading.precipType ? radarValueLabel(reading) : "", reading.site || "", coords];
    sub = parts.filter(Boolean).join(" · ");
  }

  readout.hidden = false;
  readout.classList.toggle("is-centred", touch);
  readout.innerHTML = `
    <span class="map-inspect-label">${safeText(title)}</span>
    <span class="map-inspect-value">${safeText(value)}</span>
    <span class="map-inspect-sub">${safeText(sub)}</span>`;

  if (touch) {
    // Docked just under the crosshair; the CSS centres it.
    readout.style.left = "";
    readout.style.top = "";
    return;
  }
  positionInspectReadout(readout, point);
}

// Sit the card beside the cursor, flipping to the other side (or above) rather
// than letting it run off the edge of the map.
function positionInspectReadout(readout, point) {
  const stage = document.querySelector("#mapStage");
  if (!stage) return;
  const gap = 16;
  const stageBox = stage.getBoundingClientRect();
  const box = readout.getBoundingClientRect();
  let left = point.x + gap;
  let top = point.y + gap;
  if (left + box.width > stageBox.width - 8) left = point.x - gap - box.width;
  if (top + box.height > stageBox.height - 8) top = point.y - gap - box.height;
  readout.style.left = `${Math.max(8, left)}px`;
  readout.style.top = `${Math.max(8, top)}px`;
}

// Wired once, when the map is first built.
function wireInspectTool() {
  if (!radarMap || popupWiredLayers.has("inspect")) return;
  popupWiredLayers.add("inspect");

  radarMap.on("mousemove", event => {
    if (!inspectMode || usesTouchInspect()) return;
    inspectPointerPoint = { x: event.point.x, y: event.point.y };
    refreshInspectReadout();
  });
  radarMap.on("mouseout", () => {
    if (!inspectMode || usesTouchInspect()) return;
    inspectPointerPoint = null;
    const { readout } = inspectElements();
    if (readout) readout.hidden = true;
  });
  // The touch sight reads whatever is under the middle of the map, so it has to
  // follow the map rather than the finger — and on a pointer device a pan or a
  // zoom moves the ground out from under a cursor that never moved.
  radarMap.on("move", () => refreshInspectReadout());
}

document.querySelector("#mapInspectToggle")?.addEventListener("click", () => setInspectMode());

// ─── Overlay popup content builders ──────────────────────────────────────────

function buildOverlayItemHtml(feature) {
  const f = feature.properties || {};
  const lid = feature.layer?.id || "";
  // Each overlay answers one question: what does this area mean here. Title,
  // which outlook it came from, and the level — nothing about who publishes it.
  const overlay = (icon, iconStyle, title, subtitle, reading) => `
    <div class="popup-header">
      <div class="popup-icon" style="${iconStyle}">${icon}</div>
      <div>
        <div class="popup-title">${safeText(title)}</div>
        <div class="popup-subtitle">${safeText(subtitle)}</div>
      </div>
    </div>
    [NAV_SLOT]
    <div class="popup-reading"><span class="popup-reading-value">${safeText(reading)}</span></div>`;

  if (lid === "spc-fill") {
    const typeLabel = activeSpcType === "cat" ? "Categorical" : activeSpcType.charAt(0).toUpperCase() + activeSpcType.slice(1);
    return overlay("⚡", "background:rgba(250,204,21,0.15);border:1px solid rgba(250,204,21,0.35);",
      `SPC Day ${activeSpcDay} Outlook`, `${typeLabel} risk`, spcPopupLabel(f));
  }
  if (lid === "drought-fill") {
    return overlay("🌵", "background:rgba(234,179,8,0.15);border:1px solid rgba(234,179,8,0.35);",
      "Drought Monitor", "Weekly classification", droughtLabel(f.CATEGORY || ""));
  }
  if (lid === "fire-fill") {
    const label = f.LABEL || "Fire Weather Area";
    const labelNice = { ELEVATED: "Elevated", CRITICAL: "Critical", EXTREME: "Extreme" }[label] ?? (label.charAt(0) + label.slice(1).toLowerCase());
    return overlay("🔥", "background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.35);",
      "Fire Weather Outlook", `Day ${activeFireDay}`, labelNice);
  }
  if (lid === "wpc-rain-fill") {
    const label = f.LABEL || "Unknown";
    const labelNames = { MRGL: "Marginal", SLGT: "Slight", MDT: "Moderate", HIGH: "High" };
    return overlay("🌧️", "background:rgba(102,212,255,0.15);border:1px solid rgba(102,212,255,0.35);",
      "Excessive Rainfall", `Day ${activeWpcDay} outlook`, labelNames[label] || label);
  }
  return `<div class="popup-header"><div><div class="popup-title">Map Feature</div></div></div>[NAV_SLOT]`;
}

// ─── Unified click handler ────────────────────────────────────────────────────

// queryRenderedFeatures can return the same GeoJSON feature once per rendered
// tile, and some NWS alerts are expanded into more than one zone polygon. Use
// the provider's stable alert id so a clicked warning/watch is offered once,
// while distinct overlapping hazards remain separate popup pages.
function alertPopupFeatureKey(feature) {
  const p = feature?.properties || {};
  const stableId = p.alertId || p.capId || p.id || p.uri || p.feature_id;
  if (stableId) return normalizeMapAlertId(stableId);
  const provider = p.ecccAlert ? "eccc" : (p.phenomena != null ? "iem" : "nws");
  return [
    provider,
    p.event || `${p.phenomena || ""}.${p.significance || ""}`,
    p.expires || p.expire || "",
    p.issue || "",
    p.headline || "",
    p.areaDesc || p.zoneName || "",
  ].map(value => String(value).trim().toLowerCase()).join("|");
}

function dedupeAlertPopupFeatures(features = []) {
  const seen = new Set();
  return features.filter(feature => {
    const key = alertPopupFeatureKey(feature);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function collectPopupItems(point, preferredLsrFeature = null) {
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
    dedupeAlertPopupFeatures(radarMap.queryRenderedFeatures(point, { layers: alertLayerIds }))
      .forEach(f => items.push({ type: "alert", feature: f }));
  }

  // Reading the value under a spot is the Inspect tool's job, on every device —
  // it tracks the cursor (or the crosshair) and answers continuously, where a
  // popup answered once and then had to be dismissed. So a click here is only
  // ever about the things a popup is the only way to reach: alerts, storm
  // reports and outlook polygons.
  return items;
}

function showPopupItems(lngLat, items) {
  if (!items.length) return;
  activeUnifiedPopup?.remove();

  let currentIdx = 0;
  const popupId = ++alertPopupCounter;
  const alertFeatures = items.filter(x => x.type === "alert").map(x => x.feature);
  alertPopupRegistry.set(popupId, alertFeatures);

  const popup = new mapboxgl.Popup({ offset: 8, maxWidth: POPUP_MAX_WIDTH }).setLngLat(lngLat).addTo(radarMap);
  activeUnifiedPopup = popup;
  popup.on("close", () => {
    alertPopupRegistry.delete(popupId);
    if (activeUnifiedPopup === popup) activeUnifiedPopup = null;
    if (activeUnifiedPopupNav?.popup === popup) activeUnifiedPopupNav = null;
  });

  const buildItem = (item, idx, total) => {
    const nav = buildPopupNavHtml(idx, total);
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
  const items = await collectPopupItems(point, preferredLsrFeature);
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
  alertFetchBox = null;

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
document.querySelector("#layerHelpToggle")?.addEventListener("click", event => {
  const box = document.querySelector("#mapLayerHelp");
  if (!box) return;
  if (box.hidden) showMapLayerHelp();
  else {
    box.hidden = true;
    event.currentTarget.setAttribute("aria-expanded", "false");
  }
});
document.querySelector("#mapFullscreenBtn")?.addEventListener("click", () => setMapFullscreen());

refreshButton.addEventListener("click", refreshLiveData);
notifyButton?.addEventListener("click", toggleNotifications);
document.querySelector("#unitToggle")?.addEventListener("click", event => {
  // Clicking a specific side picks that system; clicking elsewhere just flips.
  const opt = event.target.closest(".unit-opt");
  unitSystem = opt ? opt.dataset.system : (unitChoice("temp") === "c" ? "imperial" : "metric");
  localStorage.setItem("unitSystem", unitSystem);
  // A pinned temperature unit would make this toggle look broken, so the
  // header switch hands temperature back to the system.
  if (unitPrefs.temp !== "auto") { unitPrefs.temp = "auto"; saveUnitPrefs(); }
  renderSettingsPanel();
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
    // Nothing worth geocoding yet, so the box falls back to the saved towns.
    showFavoriteSuggestions();
    return;
  }
  locationSuggestionTimer = setTimeout(async () => {
    try {
      renderLocationSuggestions(mergeFavoritesIntoResults(await searchLocations(query)));
    } catch {
      renderLocationSuggestions([]);
    }
  }, 180);
});

locationInput.addEventListener("focus", () => {
  if (!locationInput.value.trim()) {
    showFavoriteSuggestions();
    return;
  }
  if (locationSuggestionResults.length) locationSuggestions.hidden = false;
});

locationSuggestions.addEventListener("click", event => {
  const star = event.target.closest("[data-favorite-index]");
  if (star) {
    // Starring must not also pick the town, and the dropdown has to stay open
    // so several places can be saved in one pass.
    event.preventDefault();
    event.stopPropagation();
    const target = locationSuggestionResults[Number(star.dataset.favoriteIndex)];
    if (!target) return;
    toggleFavoriteLocation(target);
    // Re-render so the list reflects the new set — including dropping a row
    // when the user un-stars something while browsing their favorites.
    if (!locationInput.value.trim()) showFavoriteSuggestions();
    else renderLocationSuggestions(locationSuggestionResults);
    locationInput.focus();
    return;
  }
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
  if (event.target.closest("[data-alert-toggle]")) {
    alertsExpanded = !alertsExpanded;
    renderAlerts();
    return;
  }
  const card = event.target.closest("[data-alert-index]");
  if (card) showAlertDetails(Number(card.dataset.alertIndex));
});
detailModal.addEventListener("click", event => {
  if (event.target.closest("[data-close-modal]")) closeDetails();
});
document.addEventListener("click", event => {
  const infoButton = event.target.closest("[data-info-key]");
  if (infoButton) {
    showProductGuide(infoButton.dataset.infoKey);
    return;
  }
  const metricInfo = event.target.closest("[data-current-metric-info]");
  if (metricInfo) {
    showCurrentMetricGuide(metricInfo.dataset.currentMetricInfo);
  }
});
document.querySelector("#settingsButton")?.addEventListener("click", openSettings);
settingsModal?.addEventListener("click", event => {
  if (event.target.closest("[data-close-settings]")) { closeSettings(); return; }
  handleSettingsClick(event);
});
window.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (settingsModal && !settingsModal.hidden) closeSettings();
  else if (!detailModal.hidden) closeDetails();
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
["#radarTimeline", "#mapFrameSlider"].forEach(sel => {
  document.querySelector(sel)?.addEventListener("input", event => {
    stopRadarAnimation();
    if (satelliteActive) setSatelliteFrame(event.target.value);
    else                 setRadarFrame(event.target.value);
  });
});
document.querySelectorAll("#radarPlayButton, #mapFramePlayButton").forEach(btn => {
  btn.addEventListener("click", () => {
    if (radarAnimationTimer) stopRadarAnimation();
    else animateRadarLayer();
  });
});
document.querySelector("#radarOpacitySlider")?.addEventListener("input", event => {
  setRainfallOpacity(Number(event.target.value));
});
document.querySelector("#mrmsProductSelect")?.addEventListener("change", event => {
  activeMrmsProduct = event.target.value;
  localStorage.setItem("mrmsProduct", activeMrmsProduct);
  localStorage.setItem("radarMrmsProduct", activeMrmsProduct);
  radarLatestResetKey = `${activeRadarMode}:${activeMrmsProduct}`;
  onDeviceRadarFrameInfo = [];
  radarFrames = [];
  radarFrameIndex = 0;
  renderRadarSubControls();
  drawRadar(false);
});
document.querySelector("#radarPaletteInput")?.addEventListener("change", event => {
  loadRadarPaletteFile(event.target.files?.[0]);
});
document.querySelector("#radarPaletteReset")?.addEventListener("click", () => {
  resetActiveRadarPalette().catch(error => setFrameTimeLabel(`Color reset failed: ${error.message}`));
});
document.querySelector(".map-options-details")?.addEventListener("toggle", event => {
  const details = event.currentTarget;
  if (!details.open) return;
  const panel = details.closest(".map-panel");
  if (!panel) return;
  requestAnimationFrame(() => {
    const targetTop = Math.max(0, details.offsetTop + details.offsetHeight - panel.clientHeight + 12);
    panel.scrollTo({
      top: targetTop,
      behavior: mapSettings.reduceAnimations ? "auto" : "smooth",
    });
  });
});

const coastalBody = document.querySelector("#coastalBody");
document.querySelector("#coastalViewSwitch")?.addEventListener("click", event => {
  const button = event.target.closest("[data-coastal-view]");
  if (!button) return;
  activeCoastalView = button.dataset.coastalView;
  syncCoastalView(true);
});
document.querySelector("#aviationViewSwitch")?.addEventListener("click", event => {
  const button = event.target.closest("[data-aviation-view]");
  if (!button) return;
  activeAviationView = button.dataset.aviationView;
  syncAviationView(true);
});
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
  } else if (event.target.id === "coastalTideSelect") {
    selectTideStation(event.target.value);
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

setRainfallOpacity(radarOpacity * 100, { persist: false });
renderLayers();
renderCoastal();   // placeholder until the first refresh resolves the marine sources
syncAviationView();
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
    alertFetchBox = null;
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
    const alertIdx = alerts.findIndex(alert =>
      alert.event?.toLowerCase() === evtLower &&
      (p.ecccAlert
        ? alert.source === "ECCC" && ecccRiskColor(alert.riskColor) === ecccRiskColor(p.riskColor)
        : alert.source !== "ECCC")
    );
    if (alertIdx !== -1) {
      showAlertDetails(alertIdx);
    } else {
      // Show directly from feature properties
      showAlertDetails({
        event: p.event || "Weather Alert",
        severity: p.severity || "Moderate",
        tags: p.ecccAlert ? ecccWarningTags(p.event, p.riskColor) : [],
        description: p.description || "",
        instruction: p.instruction || "",
        expires: p.expires,
        areaDesc: p.zoneName || p.areaDesc || "",
        source: p.ecccAlert ? "ECCC" : "NWS",
        riskColor: p.riskColor || "",
        damageThreat: p.damageThreat || "",
        headline: p.headline || p.event || "Weather Alert",
      });
    }
  }
};
