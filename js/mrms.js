// mrms.js — list and load NOAA MRMS (Multi-Radar Multi-Sensor) gridded products
// from the open `noaa-mrms-pds` AWS bucket, decoded with grib2.js.
//
// Keys look like:
//   CONUS/<ProductFolder>/<YYYYMMDD>/MRMS_<Product>_<YYYYMMDD>-<HHMMSS>.grib2.gz
// The bucket is CORS-enabled for listing and GET, like the radar/satellite ones.

import { decodeGrib2 } from './grib2.js';
import { makeScale } from './products.js';

const BUCKET = 'https://noaa-mrms-pds.s3.amazonaws.com';

const s = (v, c) => ({ v, c1: [...c, 255], c2: null });

// Reflectivity ramp (matches the radar REF look) for the composite product.
const REFL = [
  s(5, [4, 233, 231]), s(15, [3, 0, 244]), s(25, [1, 197, 1]), s(35, [253, 248, 2]),
  s(45, [253, 149, 0]), s(55, [212, 0, 0]), s(65, [248, 0, 253]), s(75, [253, 253, 253]),
];
// Rotation / shear ramp (blue→yellow→red→magenta) for AzShear & rotation tracks.
// MRMS packs azimuthal shear in native units of 10⁻³ s⁻¹ (so a decoded value of
// 20 ≈ 0.020 s⁻¹, a strong mesocyclone), on the 0.005° super-res grid. We colour
// in those native units and label the legend accordingly.
const ROT = [
  s(2, [40, 40, 70]), s(4, [0, 120, 220]), s(8, [0, 200, 120]),
  s(12, [230, 220, 0]), s(16, [255, 120, 0]), s(24, [220, 0, 0]), s(40, [255, 0, 255]),
];
// Hail size (mm) ramp.
const HAIL = [
  s(0, [90, 150, 255]), s(20, [0, 200, 120]), s(30, [230, 220, 0]),
  s(45, [255, 120, 0]), s(60, [220, 0, 0]), s(100, [255, 0, 255]),
];
// Probability (%) ramp.
const PROB = [
  s(0, [40, 40, 70]), s(20, [0, 120, 220]), s(40, [0, 200, 120]),
  s(60, [230, 220, 0]), s(80, [255, 120, 0]), s(100, [220, 0, 0]),
];
// Precipitation accumulation (mm) ramp.
const QPE = [
  s(0.2, [120, 200, 255]), s(5, [0, 120, 240]), s(15, [0, 200, 120]),
  s(30, [230, 220, 0]), s(60, [255, 120, 0]), s(100, [220, 0, 0]),
  s(150, [180, 0, 90]), s(250, [255, 0, 255]), s(762, [255, 0, 255]),
];
// Echo-top height (km) ramp - short/warm storms blue, tall (severe) tops red to
// magenta. The final color waits until ~75 kft instead of topping out near 60 kft.
const ETOP = [
  s(2, [40, 60, 120]), s(5, [0, 150, 210]), s(8, [0, 200, 120]),
  s(10, [230, 220, 0]), s(12, [255, 150, 0]), s(15, [220, 0, 0]),
  s(18, [220, 0, 0]), s(23, [255, 0, 255]),
];
// Vertically Integrated Liquid (kg/m²) ramp — high VIL flags hail cores.
const VILR = [
  s(1, [40, 60, 120]), s(5, [0, 150, 210]), s(10, [0, 200, 120]),
  s(20, [230, 220, 0]), s(35, [255, 150, 0]), s(50, [220, 0, 0]), s(70, [255, 0, 255]),
];
// Instantaneous precipitation rate (mm/hr) ramp.
const PRATE = [
  s(0.5, [120, 200, 255]), s(2, [0, 120, 240]), s(5, [0, 200, 120]),
  s(10, [230, 220, 0]), s(25, [255, 120, 0]), s(50, [220, 0, 0]), s(100, [255, 0, 255]),
];
// Cloud-to-ground lightning density (flashes / km² / min) ramp.
const LDEN = [
  s(0.05, [40, 40, 70]), s(0.2, [0, 120, 220]), s(0.5, [0, 200, 120]),
  s(1, [230, 220, 0]), s(2, [255, 120, 0]), s(5, [220, 0, 0]), s(10, [255, 0, 255]),
];
// FLASH average-recurrence-interval (years) ramp — how rare the observed rainfall
// is; longer recurrence (rarer event) shades toward red/magenta.
const ARI = [
  s(0.5, [40, 60, 120]), s(1, [0, 150, 210]), s(2, [0, 200, 120]),
  s(5, [230, 220, 0]), s(10, [255, 150, 0]), s(25, [220, 0, 0]), s(100, [255, 0, 255]),
];
// FLASH QPE-to-flash-flood-guidance ratio (unitless) ramp — values ≥1 mean the
// observed rainfall has met/exceeded guidance, the flash-flood threshold.
const FFG = [
  s(0.25, [40, 60, 120]), s(0.5, [0, 150, 210]), s(0.75, [0, 200, 120]),
  s(1, [230, 220, 0]), s(1.5, [255, 120, 0]), s(2, [220, 0, 0]), s(3, [255, 0, 255]),
];
// Flash-flood-guidance EXCEEDANCE (mm) ramp — how much the observed rainfall
// sits *above* guidance. Only positive (over-guidance) depths are ever coloured;
// cells at or below guidance are dropped to NaN upstream so they render fully
// transparent, and the ramp graduates the amount of the overage (pale yellow just
// over, through orange/red to magenta for the most extreme exceedances).
const EXCEED = [
  s(1, [255, 245, 140]), s(5, [255, 210, 0]), s(12, [255, 150, 0]),
  s(25, [255, 70, 0]), s(50, [210, 0, 0]), s(90, [150, 0, 90]), s(127, [255, 0, 255]),
];

// ---------------------------------------------------------------------------
// Precipitation type (derived, decoded in the browser like every other product).
//
// A precip-type map is three MRMS fields on one 0.01° grid: PrecipFlag says
// whether the surface is seeing rain or snow, Model_WetBulbTemp says whether
// rain falling onto a freezing surface is freezing rain (the flag has no
// category of its own for it), and PrecipRate is the intensity the colour reads
// out. The grid layer draws a single scalar through a single colour table, so
// the three are folded into one value: the band index (0 rain, 1 freezing,
// 2 snow) plus where the rate sits inside that band, 0..1. The colour table is
// the three ramps laid end to end, so 1.4 is moderate freezing rain.
// ---------------------------------------------------------------------------
export const PRECIP_TYPE_BANDS = [
  { id: 'rain', label: 'Rain', lo: 0.2, hi: 75,
    colors: [[0, 255, 157], [0, 216, 95], [30, 140, 0], [255, 255, 0], [255, 155, 0], [255, 0, 0]] },
  { id: 'ice', label: 'Freezing Rain / Sleet', lo: 0.1, hi: 15,
    colors: [[255, 77, 255], [224, 0, 223], [176, 0, 170], [122, 0, 120]] },
  { id: 'snow', label: 'Snow', lo: 0.05, hi: 8,
    colors: [[0, 255, 255], [120, 242, 255], [182, 213, 255], [216, 209, 255]] },
];

// MRMS PrecipFlag categories. Everything liquid is one of the rain codes; the
// separation into freezing rain comes from the wet-bulb field below.
const FLAG_SNOW = new Set([3, 4]);
const FLAG_RAIN = new Set([1, 2, 6, 7, 10, 91, 96]);
// Rain reaching a surface at or below this wet-bulb temperature (°C) is
// freezing on contact. Slightly above zero because the wet-bulb grid is a model
// field on a 0.01° mesh, not a thermometer at the point of impact.
const FREEZING_WET_BULB_C = 0.5;
// The readout keeps the rate as hundredths of a mm/hr rather than a second
// full-precision copy of a 24-million-cell field: 0.01 mm/hr is four decimal
// places finer than the two the popup prints.
const RATE_CENTI_MAX = 65535;

// Three ramps end to end over [0, 3), sampled straight into the LUT the grid
// shader reads. Built here rather than through makeScale because the band edges
// must be hard steps — a value must never blend from heavy rain into ice.
function precipTypeScale(steps = 1024) {
  const rgba = new Uint8Array(steps * 4);
  const bands = PRECIP_TYPE_BANDS.length;
  for (let i = 0; i < steps; i++) {
    const v = (bands * i) / (steps - 1);
    const bandIndex = Math.min(bands - 1, Math.floor(v));
    const colors = PRECIP_TYPE_BANDS[bandIndex].colors;
    const t = Math.min(1, Math.max(0, v - bandIndex));
    const pos = t * (colors.length - 1);
    const a = colors[Math.floor(pos)];
    const b = colors[Math.min(colors.length - 1, Math.floor(pos) + 1)];
    const f = pos - Math.floor(pos);
    const o = i * 4;
    rgba[o] = Math.round(a[0] + (b[0] - a[0]) * f);
    rgba[o + 1] = Math.round(a[1] + (b[1] - a[1]) * f);
    rgba[o + 2] = Math.round(a[2] + (b[2] - a[2]) * f);
    rgba[o + 3] = 255;
  }
  return { lo: 0, hi: bands, steps, rgba };
}

// Where a rate sits inside its band, on a log scale (the way rainfall intensity
// reads. The top is held a couple of LUT steps short of the band edge: the
// colour table is sampled at 1024 steps across all three bands, so a value that
// sits flush against an edge rounds up into the first colour of the next band —
// the heaviest rain would come out the colour of ice.
const BAND_FRACTION_MAX = 0.99;
function bandFraction(band, rate) {
  const t = Math.log(rate / band.lo) / Math.log(band.hi / band.lo);
  return t <= 0 ? 0 : t >= BAND_FRACTION_MAX ? BAND_FRACTION_MAX : t;
}

const MM_TO_IN = 0.0393700787;
const KM_TO_KFT = 3.2808399; // km → thousands of feet
// FLASH stores the QPE/FFG field as percent: a decoded value of 105 means a
// ratio of 1.05 (QPE is 105% of guidance), not a ratio of 105.
const FLASH_RATIO_FACTOR = 0.01;

// `disp` { unit, factor } gives an imperial display conversion for legend ticks
// and the inspect readout, leaving the native values/colors untouched.
function product(id, folder, name, unit, lo, hi, floor, stops, disp) {
  const scale = makeScale(stops);
  const dispUnit = (disp && disp.unit) || unit;
  const dispFactor = (disp && disp.factor) || 1;
  return { id, folder, name, unit, lo, hi, floor, scale, dispUnit, dispFactor, dispOffset: 0 };
}

// A custom "flash-flood-guidance exceedance" product: not a single S3 folder but
// a derived field. Its `folder` (the QPE accumulation) drives frame listing so the
// rest of the app treats it like any other product; the loader then pairs each QPE
// frame with the matching FLASH QPE/FFG ratio grid to recover guidance and returns
// the overage. `custom: 'ffgx'` routes loadMrms() to loadMrmsExceedance().
function exceedProduct(id, name, qpeFolder, ffgFolder) {
  const p = product(id, qpeFolder, name, 'mm', 0, 127, 0.05, EXCEED, { unit: 'in', factor: MM_TO_IN });
  p.custom = 'ffgx';
  p.ffgFolder = ffgFolder;
  return p;
}

// The precipitation-type product. Its frames are the PrecipRate folder's, so it
// scrubs on the 2-minute rate cadence; the flag and wet-bulb fields are paired
// to each frame by time. `categorical: true` tells the renderer this is a
// banded field: no smoothing across band edges, no user colour table, and a
// legend of three ramps rather than one.
function precipTypeProduct() {
  return {
    id: 'PTYPE',
    folder: 'PrecipRate_00.00',
    flagFolder: 'PrecipFlag_00.00',
    wetBulbFolder: 'Model_WetBulbTemp_00.50',
    name: 'Precip Type',
    unit: 'in/hr',
    lo: 0,
    hi: PRECIP_TYPE_BANDS.length,
    floor: 0,
    scale: precipTypeScale(),
    dispUnit: 'in/hr',
    dispFactor: 1,
    dispOffset: 0,
    custom: 'ptype',
    categorical: true,
    // Tells the grid layer this field is banded, so pooling picks the band that
    // covers a block rather than the highest one in it.
    bandCount: PRECIP_TYPE_BANDS.length,
  };
}

export const MRMS_PRODUCTS = {
  // ---- Reflectivity variants ----
  REFC: product('REFC', 'MergedReflectivityQCComposite_00.50', 'Composite Reflectivity', 'dBZ', 5, 75, 5, REFL),
  LLREF: product('LLREF', 'LowLevelCompositeReflectivity_00.50', 'Low-Level Composite Refl.', 'dBZ', 5, 75, 5, REFL),
  RALA: product('RALA', 'MergedReflectivityAtLowestAltitude_00.50', 'Refl. at Lowest Altitude', 'dBZ', 5, 75, 5, REFL),
  REF0C: product('REF0C', 'Reflectivity_0C_00.50', 'Reflectivity at 0°C', 'dBZ', 5, 75, 5, REFL),
  REFM20C: product('REFM20C', 'Reflectivity_-20C_00.50', 'Reflectivity at −20°C', 'dBZ', 5, 75, 5, REFL),
  // ---- Echo tops ----
  ET18: product('ET18', 'EchoTop_18_00.50', '18 dBZ Echo Top', 'km', 0, 23, 0.5, ETOP, { unit: 'kft', factor: KM_TO_KFT }),
  ET30: product('ET30', 'EchoTop_30_00.50', '30 dBZ Echo Top', 'km', 0, 23, 0.5, ETOP, { unit: 'kft', factor: KM_TO_KFT }),
  ET50: product('ET50', 'EchoTop_50_00.50', '50 dBZ Echo Top', 'km', 0, 23, 0.5, ETOP, { unit: 'kft', factor: KM_TO_KFT }),
  ET60: product('ET60', 'EchoTop_60_00.50', '60 dBZ Echo Top', 'km', 0, 23, 0.5, ETOP, { unit: 'kft', factor: KM_TO_KFT }),
  // ---- Vertically integrated liquid / ice ----
  VIL: product('VIL', 'VIL_00.50', 'Vert. Integrated Liquid', 'kg/m²', 0, 70, 0.5, VILR),
  VILD: product('VILD', 'VIL_Density_00.50', 'VIL Density', 'g/m³', 0, 6, 0.1, VILR.map((k) => ({ ...k, v: k.v / 11.7 }))),
  VIL2H: product('VIL2H', 'VIL_Max_120min_00.50', '2-hr Max VIL', 'kg/m²', 0, 70, 0.5, VILR),
  VIL24H: product('VIL24H', 'VIL_Max_1440min_00.50', '24-hr Max VIL', 'kg/m²', 0, 70, 0.5, VILR),
  VII: product('VII', 'VII_00.50', 'Vert. Integrated Ice', 'kg/m²', 0, 40, 0.5, VILR.map((k) => ({ ...k, v: k.v * 0.57 }))),
  // ---- Rotation (low-level 0–2 km AGL and mid-level 3–6 km AGL) ----
  AZSHEAR: product('AZSHEAR', 'MergedAzShear_0-2kmAGL_00.50', 'AzShear 0–2 km (Instant Rotation)', '10⁻³ s⁻¹', 2, 40, 2, ROT),
  AZSHEAR36: product('AZSHEAR36', 'MergedAzShear_3-6kmAGL_00.50', 'AzShear 3–6 km (Mid-Level)', '10⁻³ s⁻¹', 2, 40, 2, ROT),
  ROT1H: product('ROT1H', 'RotationTrack60min_00.50', '1-hr Rotation Track 0–2 km', '10⁻³ s⁻¹', 2, 40, 2, ROT),
  ROT6H: product('ROT6H', 'RotationTrack360min_00.50', '6-hr Rotation Track 0–2 km', '10⁻³ s⁻¹', 2, 40, 2, ROT),
  ROT24H: product('ROT24H', 'RotationTrack1440min_00.50', '24-hr Rotation Track 0–2 km', '10⁻³ s⁻¹', 2, 40, 2, ROT),
  ROTML1H: product('ROTML1H', 'RotationTrackML60min_00.50', '1-hr Rotation Track 3–6 km', '10⁻³ s⁻¹', 2, 40, 2, ROT),
  ROTML6H: product('ROTML6H', 'RotationTrackML360min_00.50', '6-hr Rotation Track 3–6 km', '10⁻³ s⁻¹', 2, 40, 2, ROT),
  ROTML24H: product('ROTML24H', 'RotationTrackML1440min_00.50', '24-hr Rotation Track 3–6 km', '10⁻³ s⁻¹', 2, 40, 2, ROT),
  // ---- Hail ----
  MESH: product('MESH', 'MESH_00.50', 'Max Estimated Hail Size', 'mm', 0, 100, 0.5, HAIL, { unit: 'in', factor: MM_TO_IN }),
  MESH1H: product('MESH1H', 'MESH_Max_60min_00.50', '1-hr Max Hail Size', 'mm', 0, 100, 0.5, HAIL, { unit: 'in', factor: MM_TO_IN }),
  MESH6H: product('MESH6H', 'MESH_Max_360min_00.50', '6-hr Max Hail Size', 'mm', 0, 100, 0.5, HAIL, { unit: 'in', factor: MM_TO_IN }),
  MESH24H: product('MESH24H', 'MESH_Max_1440min_00.50', '24-hr Max Hail Size', 'mm', 0, 100, 0.5, HAIL, { unit: 'in', factor: MM_TO_IN }),
  POSH: product('POSH', 'POSH_00.50', 'Prob. of Severe Hail', '%', 0, 100, 1, PROB),
  SHI: product('SHI', 'SHI_00.50', 'Severe Hail Index', '', 0, 200, 1, HAIL.map((k) => ({ ...k, v: k.v * 2 }))),
  // ---- Lightning ----
  LTG30: product('LTG30', 'LightningProbabilityNext30minGrid_scale_1', '30-min CG Lightning Prob.', '%', 0, 100, 1, PROB),
  LTG60: product('LTG60', 'LightningProbabilityNext60minGrid_scale_1', '60-min CG Lightning Prob.', '%', 0, 100, 1, PROB),
  CGD1: product('CGD1', 'NLDN_CG_001min_AvgDensity_00.00', '1-min CG Lightning Density', 'fl/km²/min', 0, 10, 0.05, LDEN),
  CGD5: product('CGD5', 'NLDN_CG_005min_AvgDensity_00.00', '5-min CG Lightning Density', 'fl/km²/min', 0, 10, 0.05, LDEN),
  CGD15: product('CGD15', 'NLDN_CG_015min_AvgDensity_00.00', '15-min CG Lightning Density', 'fl/km²/min', 0, 10, 0.05, LDEN),
  CGD30: product('CGD30', 'NLDN_CG_030min_AvgDensity_00.00', '30-min CG Lightning Density', 'fl/km²/min', 0, 10, 0.05, LDEN),
  // ---- Flooding (FLASH average recurrence interval + QPE-to-FFG ratio) ----
  ARI1H: product('ARI1H', 'FLASH_QPE_ARI01H_00.00', '1-hr Avg. Recurrence Interval', 'yr', 0, 100, 0.25, ARI),
  ARI3H: product('ARI3H', 'FLASH_QPE_ARI03H_00.00', '3-hr Avg. Recurrence Interval', 'yr', 0, 100, 0.25, ARI),
  ARI6H: product('ARI6H', 'FLASH_QPE_ARI06H_00.00', '6-hr Avg. Recurrence Interval', 'yr', 0, 100, 0.25, ARI),
  ARI24H: product('ARI24H', 'FLASH_QPE_ARI24H_00.00', '24-hr Avg. Recurrence Interval', 'yr', 0, 100, 0.25, ARI),
  ARIMAX: product('ARIMAX', 'FLASH_QPE_ARIMAX_00.00', 'Max Avg. Recurrence Interval', 'yr', 0, 100, 0.25, ARI),
  FFG1H: product('FFG1H', 'FLASH_QPE_FFG01H_00.00', '1-hr QPE/FFG Ratio', '', 0, 3, 0.1, FFG),
  FFG3H: product('FFG3H', 'FLASH_QPE_FFG03H_00.00', '3-hr QPE/FFG Ratio', '', 0, 3, 0.1, FFG),
  FFG6H: product('FFG6H', 'FLASH_QPE_FFG06H_00.00', '6-hr QPE/FFG Ratio', '', 0, 3, 0.1, FFG),
  FFGMAX: product('FFGMAX', 'FLASH_QPE_FFGMAX_00.00', 'Max QPE/FFG Ratio', '', 0, 3, 0.1, FFG),
  // ---- Precipitation type + accumulation ----
  PTYPE: precipTypeProduct(),
  PRATE: product('PRATE', 'PrecipRate_00.00', 'Precip Rate', 'mm/hr', 0, 100, 0.2, PRATE, { unit: 'in/hr', factor: MM_TO_IN }),
  QPE1H: product('QPE1H', 'MultiSensor_QPE_01H_Pass2_00.00', '1-hr Precip Total', 'mm', 0, 762, 0.2, QPE, { unit: 'in', factor: MM_TO_IN }),
  QPE3H: product('QPE3H', 'MultiSensor_QPE_03H_Pass2_00.00', '3-hr Precip Total', 'mm', 0, 762, 0.2, QPE, { unit: 'in', factor: MM_TO_IN }),
  QPE6H: product('QPE6H', 'MultiSensor_QPE_06H_Pass2_00.00', '6-hr Precip Total', 'mm', 0, 762, 0.2, QPE, { unit: 'in', factor: MM_TO_IN }),
  QPE12H: product('QPE12H', 'MultiSensor_QPE_12H_Pass2_00.00', '12-hr Precip Total', 'mm', 0, 762, 0.2, QPE, { unit: 'in', factor: MM_TO_IN }),
  QPE24H: product('QPE24H', 'MultiSensor_QPE_24H_Pass2_00.00', '24-hr Precip Total', 'mm', 0, 762, 0.2, QPE, { unit: 'in', factor: MM_TO_IN }),
  QPE48H: product('QPE48H', 'MultiSensor_QPE_48H_Pass2_00.00', '48-hr Precip Total', 'mm', 0, 762, 0.2, QPE, { unit: 'in', factor: MM_TO_IN }),
  QPE72H: product('QPE72H', 'MultiSensor_QPE_72H_Pass2_00.00', '72-hr Precip Total', 'mm', 0, 762, 0.2, QPE, { unit: 'in', factor: MM_TO_IN }),
  QPEST: product('QPEST', 'RadarOnly_QPE_Since12Z_00.00', 'Storm Total (since 12Z)', 'mm', 0, 762, 0.2, QPE, { unit: 'in', factor: MM_TO_IN }),
  // ---- Flash-flood-guidance exceedance (custom: radar QPE minus FFG) ----
  // Uses the radar-only QPE that FLASH itself compares against guidance, so the
  // recovered FFG (= QPE ÷ ratio) and the overage are internally consistent.
  FFGX1: exceedProduct('FFGX1', '1-hr FFG Exceedance', 'RadarOnly_QPE_01H_00.00', 'FLASH_QPE_FFG01H_00.00'),
  FFGX3: exceedProduct('FFGX3', '3-hr FFG Exceedance', 'RadarOnly_QPE_03H_00.00', 'FLASH_QPE_FFG03H_00.00'),
  FFGX6: exceedProduct('FFGX6', '6-hr FFG Exceedance', 'RadarOnly_QPE_06H_00.00', 'FLASH_QPE_FFG06H_00.00'),
};

// The MRMS reflectivity products all share the single-site radar reflectivity
// color table (resolved at render time in app.js), so every dBZ field looks the
// same and a user-loaded reflectivity .pal applies to all of them — not just the
// composite.
for (const id of ['REFC', 'LLREF', 'RALA', 'REF0C', 'REFM20C']) {
  MRMS_PRODUCTS[id].reflectivity = true;
}
// Convert the encoded FLASH percentage to the physical ratio used by the
// product scale, cursor readout, and derived exceedance calculations.
for (const id of ['FFG1H', 'FFG3H', 'FFG6H', 'FFGMAX']) {
  MRMS_PRODUCTS[id].valueFactor = FLASH_RATIO_FACTOR;
}

// MRMS products grouped into the menu sections the picker renders, in the order
// they appear. MRMS_ORDER is derived from these so anything listed here is part
// of the catalogue.
export const MRMS_CATEGORIES = [
  { id: 'reflectivity', name: 'Reflectivity', products: ['REFC', 'LLREF', 'RALA', 'REF0C', 'REFM20C'] },
  { id: 'rotation', name: 'Rotation', products: ['AZSHEAR', 'AZSHEAR36', 'ROT1H', 'ROT6H', 'ROT24H', 'ROTML1H', 'ROTML6H', 'ROTML24H'] },
  { id: 'hail', name: 'Hail', products: ['MESH', 'MESH1H', 'MESH6H', 'MESH24H', 'POSH', 'SHI'] },
  { id: 'lightning', name: 'Lightning', products: ['LTG30', 'LTG60', 'CGD1', 'CGD5', 'CGD15', 'CGD30'] },
  { id: 'precip', name: 'Precip Accumulation', products: ['PTYPE', 'PRATE', 'QPE1H', 'QPE3H', 'QPE6H', 'QPE12H', 'QPE24H', 'QPE48H', 'QPE72H', 'QPEST'] },
  { id: 'ffgx', name: 'FFG Exceedance', products: ['FFGX1', 'FFGX3', 'FFGX6'] },
  { id: 'flooding', name: 'Flooding', products: ['ARI1H', 'ARI3H', 'ARI6H', 'ARI24H', 'ARIMAX', 'FFG1H', 'FFG3H', 'FFG6H', 'FFGMAX'] },
  { id: 'echotops', name: 'Echo Tops', products: ['ET18', 'ET30', 'ET50', 'ET60'] },
  { id: 'vil', name: 'Vertically Integrated Liquid', products: ['VIL', 'VILD', 'VIL2H', 'VIL24H', 'VII'] },
];

export const MRMS_ORDER = MRMS_CATEGORIES.flatMap((c) => c.products);

const pad = (n, w = 2) => String(n).padStart(w, '0');

function timeForKey(key) {
  const m = key.match(/_(\d{8})-(\d{6})\./);
  if (!m) return null;
  const d = m[1], t = m[2];
  return new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8),
    +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6)));
}

function labelForKey(key) {
  const t = timeForKey(key);
  return t ? `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}Z` : key.split('/').pop();
}

// List the frames in one product folder on a UTC day, newest last.
async function listFolder(folder, date) {
  const ymd = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  const prefix = `CONUS/${folder}/${ymd}/`;
  const url = `${BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MRMS list failed: ${res.status}`);
  const xml = await res.text();
  const keys = [];
  const re = /<Key>([^<]+)<\/Key>/g;
  let m;
  while ((m = re.exec(xml)) !== null) keys.push(m[1]);
  keys.sort();
  return keys.map((key) => ({ key, label: labelForKey(key), time: timeForKey(key) }));
}

// List the available frames for a product on a UTC day, newest last. Custom
// (exceedance) products list their QPE-accumulation folder, so the frame slider
// tracks the observed-rainfall cadence.
export async function listMrms(productId, date) {
  const prod = MRMS_PRODUCTS[productId];
  if (!prod) throw new Error('unknown MRMS product');
  return listFolder(prod.folder, date);
}

// The FLASH ratio grid nearest (at or just before) a target time — searched on
// the target's UTC day and, if nothing sits at/before it, the previous day.
// Small per-day cache keeps playback from re-listing the same folder each frame.
const folderListCache = new Map();
async function cachedList(folder, date) {
  const ymd = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  const ck = `${folder}/${ymd}`;
  if (!folderListCache.has(ck)) folderListCache.set(ck, await listFolder(folder, date));
  return folderListCache.get(ck);
}
async function nearestFrame(folder, target) {
  const day = await cachedList(folder, target);
  const pick = (frames) => {
    let best = null;
    for (const f of frames) {
      if (!f.time) continue;
      if (f.time <= target && (!best || f.time > best.time)) best = f;
    }
    return best;
  };
  let best = pick(day);
  if (!best) {
    const prev = new Date(target.getTime() - 24 * 3600 * 1000);
    best = pick(await cachedList(folder, prev));
  }
  // Fall back to the earliest available frame if the target predates them all.
  if (!best && day.length) best = day.find((f) => f.time) || null;
  return best;
}

// The MRMS CONUS grids share one standard 0.01° geometry, so reading a second
// field at a first field's cells is a straight index. If the geometries ever
// differ, fall back to nearest-neighbour: map each `ref` cell centre into `src`,
// or -1 where it falls outside.
function alignedIndex(src, ref) {
  const same = src.ni === ref.ni && src.nj === ref.nj &&
    Math.abs(src.lon1 - ref.lon1) < 1e-4 && Math.abs(src.lat1 - ref.lat1) < 1e-4;
  if (same) return (i) => i;
  return (i) => {
    const col = i % ref.ni, row = (i - col) / ref.ni;
    const lon = ref.lon1 + col * ref.di, lat = ref.lat1 - row * ref.dj;
    const ci = Math.round((lon - src.lon1) / src.di);
    const cj = Math.round((src.lat1 - lat) / src.dj);
    if (ci < 0 || ci >= src.ni || cj < 0 || cj >= src.nj) return -1;
    return cj * src.ni + ci;
  };
}

// The FLASH ratio at each QPE cell, converted from its stored percentage to the
// physical ratio the exceedance maths works in.
function ratioAt(ratio, qpe) {
  const at = alignedIndex(ratio, qpe);
  return (i) => {
    const j = at(i);
    return j < 0 ? NaN : ratio.values[j] * FLASH_RATIO_FACTOR;
  };
}

// exceedance = QPE − FFG = QPE·(1 − 1/ratio), kept only where the ratio exceeds 1
// (rainfall has passed guidance). Everywhere else → NaN, which the grid layer
// renders transparent. Returns a Float32Array aligned to the QPE grid.
function exceedanceValues(qpe, ratio) {
  const get = ratioAt(ratio, qpe);
  const q = qpe.values;
  const out = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) {
    const qi = q[i], ri = get(i);
    out[i] = (qi > 0 && ri > 1 && Number.isFinite(qi) && Number.isFinite(ri))
      ? qi * (1 - 1 / ri) : NaN;
  }
  return out;
}

// Recover the guidance grid itself (mm) from radar QPE and the normalized FLASH
// ratio: FFG = QPE ÷ ratio, defined wherever rain was observed. Exposed so the
// single-site radar exceedance path can sample the same field onto its polar gates.
export async function loadMrmsFfgGrid(qpeFolder, ffgFolder, when, onProgress) {
  const qFrame = await nearestFrame(qpeFolder, when);
  if (!qFrame) throw new Error('no QPE frame');
  const rFrame = await nearestFrame(ffgFolder, qFrame.time || when);
  if (!rFrame) throw new Error('no FFG frame');
  const qpe = await decodeGrib2(await fetchMrms(qFrame.key, (p) => onProgress && onProgress(p * 0.5)));
  const ratio = await decodeGrib2(await fetchMrms(rFrame.key, (p) => onProgress && onProgress(0.5 + p * 0.5)));
  const get = ratioAt(ratio, qpe);
  const ffg = new Float32Array(qpe.values.length);
  for (let i = 0; i < ffg.length; i++) {
    const qi = qpe.values[i], ri = get(i);
    ffg[i] = (qi > 0 && ri > 0 && Number.isFinite(qi) && Number.isFinite(ri)) ? qi / ri : NaN;
  }
  return { ...qpe, values: ffg, time: qFrame.time };
}

// Load one exceedance frame: the QPE grid at `qpeKey`, paired with the FLASH
// ratio nearest that time, differenced into an over-guidance depth grid.
async function loadMrmsExceedance(productId, qpeKey, onProgress) {
  const prod = MRMS_PRODUCTS[productId];
  const target = timeForKey(qpeKey) || new Date();
  const qpe = await decodeGrib2(await fetchMrms(qpeKey, (p) => onProgress && onProgress(p * 0.5)));
  const rFrame = await nearestFrame(prod.ffgFolder, target);
  if (!rFrame) throw new Error('no FFG frame');
  const ratio = await decodeGrib2(await fetchMrms(rFrame.key, (p) => onProgress && onProgress(0.5 + p * 0.5)));
  const grid = { ...qpe, values: exceedanceValues(qpe, ratio) };
  grid.product = prod;
  grid.time = target;
  grid.key = qpeKey;
  return grid;
}

// Load one precipitation-type frame: the rate grid at `rateKey`, classified by
// the PrecipFlag and wet-bulb grids nearest that time. The rate array is encoded
// in place — a CONUS field is ~100 MB, so the frame carries one of them plus a
// hundredths-of-a-mm/hr copy for the readout, not three.
let freezingMask = null; // { key, mask, geometry } for the last wet-bulb frame used
async function loadMrmsPrecipType(rateKey, onProgress, signal) {
  const prod = MRMS_PRODUCTS.PTYPE;
  const target = timeForKey(rateKey) || new Date();
  const step = (base, span) => (p) => onProgress && onProgress(base + p * span);

  // Wet bulb first, reduced immediately to a freezing/not-freezing mask so the
  // full field is not held alongside the other two. It is published hourly
  // against a 2-minute rate cadence, so every frame in a loop shares one — hence
  // the single-entry memo rather than a download and decode per frame.
  let freezing = null;
  let freezingAt = null;
  const wetBulbFrame = await nearestFrame(prod.wetBulbFolder, target).catch(() => null);
  if (wetBulbFrame && freezingMask?.key === wetBulbFrame.key) {
    ({ mask: freezing, geometry: freezingAt } = freezingMask);
  } else if (wetBulbFrame) {
    const wetBulb = await decodeGrib2(await fetchMrms(wetBulbFrame.key, step(0, 0.25), signal));
    freezing = new Uint8Array(wetBulb.values.length);
    for (let i = 0; i < freezing.length; i++) {
      const t = wetBulb.values[i];
      freezing[i] = Number.isFinite(t) && t > -900 && t <= FREEZING_WET_BULB_C ? 1 : 0;
    }
    freezingAt = { ni: wetBulb.ni, nj: wetBulb.nj, lon1: wetBulb.lon1, lat1: wetBulb.lat1, di: wetBulb.di, dj: wetBulb.dj };
    wetBulb.values = new Float32Array(0);
    freezingMask = { key: wetBulbFrame.key, mask: freezing, geometry: freezingAt };
  }

  const flagFrame = await nearestFrame(prod.flagFolder, target);
  if (!flagFrame) throw new Error('no precipitation-type frame');
  const flag = await decodeGrib2(await fetchMrms(flagFrame.key, step(0.25, 0.35), signal));
  const rate = await decodeGrib2(await fetchMrms(rateKey, step(0.6, 0.4), signal));

  const flagAt = alignedIndex(flag, rate);
  const iceAt = freezing ? alignedIndex(freezingAt, rate) : null;
  const values = rate.values;
  const rateCenti = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const mmPerHour = values[i];
    values[i] = NaN;
    if (!(mmPerHour > 0)) continue;
    const fj = flagAt(i);
    const code = fj < 0 ? 0 : flag.values[fj];
    let bandIndex;
    if (FLAG_SNOW.has(code)) bandIndex = 2;
    else if (FLAG_RAIN.has(code)) {
      const ij = iceAt ? iceAt(i) : -1;
      bandIndex = ij >= 0 && freezing[ij] ? 1 : 0;
    } else continue;
    const band = PRECIP_TYPE_BANDS[bandIndex];
    if (mmPerHour < band.lo) continue;
    values[i] = bandIndex + bandFraction(band, mmPerHour);
    rateCenti[i] = Math.min(RATE_CENTI_MAX, Math.round(mmPerHour * 100));
  }
  flag.values = new Float32Array(0);

  return {
    ...rate,
    values,
    rateCenti,
    product: prod,
    time: timeForKey(rateKey),
    flagTime: flagFrame.time || null,
    key: rateKey,
  };
}

// What a click on the precipitation-type map landed on: the type itself and the
// rate that set its shade. Returns null where nothing is falling.
export function precipTypeReading(grid, index) {
  const encoded = grid?.values?.[index];
  if (!Number.isFinite(encoded)) return null;
  const band = PRECIP_TYPE_BANDS[Math.min(PRECIP_TYPE_BANDS.length - 1, Math.floor(encoded))];
  const mmPerHour = (grid.rateCenti?.[index] || 0) / 100;
  return { type: band.label, rate: mmPerHour * MM_TO_IN, unit: 'in/hr' };
}

export async function fetchMrms(key, onProgress, signal) {
  const res = await fetch(`${BUCKET}/${key}`, { signal });
  if (!res.ok) throw new Error(`MRMS download failed: ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onProgress) onProgress(received / total);
  }
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// Download + decode one MRMS frame into a lat/lon grid of physical values.
export async function loadMrms(productId, key, onProgress, signal) {
  const prod = MRMS_PRODUCTS[productId];
  if (prod && prod.custom === 'ffgx') return loadMrmsExceedance(productId, key, onProgress);
  if (prod && prod.custom === 'ptype') return loadMrmsPrecipType(key, onProgress, signal);
  const bytes = await fetchMrms(key, onProgress, signal);
  const grid = await decodeGrib2(bytes);
  if (prod && prod.valueFactor != null && prod.valueFactor !== 1) {
    const values = grid.values;
    const scaled = new Float32Array(values.length);
    for (let i = 0; i < values.length; i++) scaled[i] = values[i] * prod.valueFactor;
    grid.values = scaled;
  }
  grid.product = prod;
  grid.time = timeForKey(key);
  grid.key = key;
  return grid;
}
