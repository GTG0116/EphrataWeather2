// Browser-native radar and satellite controller.
//
// Raw NEXRAD Level II and GOES/Himawari files are fetched from the public
// CORS-enabled NOAA/Unidata buckets. Binary parsing and decompression happen in
// module Web Workers; only decoded typed arrays and ready-to-upload textures
// reach the page.

import { listVolumes, fetchVolume, nearestSite, RADARS } from './s3.js';
import { PRODUCTS, makeScale, parsePal } from './products.js';
import { createRadarLayer } from './radarLayer.js';
import { MRMS_PRODUCTS, listMrms, loadMrms } from './mrms.js';
import { createGridLayer } from './gridLayer.js';
import { SATELLITES, SECTORS, listScenes, sceneBBox } from './goes.js';
import { loadSceneAsync, ensureBandsAsync, clearSceneCache } from './satClient.js';
import { bandsFor, buildRGBA, SAT_PRECIP_ID } from './satProducts.js';
import { computePrecipRate } from './satPrecip.js';
import { createSatelliteLayer } from './satelliteLayer.js';

export const RADAR_PRODUCTS = {
  nexrad_ref: { decoderId: 'REF', label: 'Reflectivity', unit: 'dBZ' },
  nexrad_vel: { decoderId: 'VEL', label: 'Velocity', unit: 'mph' },
  nexrad_sw:  { decoderId: 'SW',  label: 'Spectrum Width', unit: 'mph' },
  nexrad_rho: { decoderId: 'RHO', label: 'Correlation Coeff.', unit: 'ρHV' },
  nexrad_zdr: { decoderId: 'ZDR', label: 'Differential Refl.', unit: 'dB' },
  nexrad_phi: { decoderId: 'PHI', label: 'Differential Phase', unit: '°' },
  nexrad_kdp: { decoderId: 'KDP', label: 'Specific Diff. Phase', unit: '°/km' },
};

export const MRMS_RADAR_PRODUCTS = {
  refl:      { decoderId: 'REFC',     label: 'Composite Reflectivity', unit: 'dBZ' },
  mesh:      { decoderId: 'MESH',     label: 'Hail (MESH)', unit: 'in' },
  qpe6h:     { decoderId: 'QPE6H',    label: '6-Hr Precip', unit: 'in' },
  qpe24h:    { decoderId: 'QPE24H',   label: '24-Hr Precip', unit: 'in' },
  lightning: { decoderId: 'LTG30',    label: 'Lightning Probability', unit: '%' },
  rotation:  { decoderId: 'AZSHEAR',  label: 'Azimuthal Shear', unit: '10⁻³ s⁻¹' },
  rate:      { decoderId: 'PRATE',    label: 'Precipitation Rate', unit: 'in/hr' },
};

export const SATELLITE_PRODUCTS = {
  geocolor: 'RGB_GEOCOLOR',
  infrared: 'C13',
  watervapor: 'C09',
  visible: 'C02',
  precip: SAT_PRECIP_ID,
};

export const SATELLITE_SOURCES = {
  goes19fd:    { satKey: 'goes19', sectorKey: 'full',  label: 'GOES-19 Full Disk' },
  goes19conus: { satKey: 'goes19', sectorKey: 'conus', label: 'GOES-19 CONUS' },
  goes19meso1: { satKey: 'goes19', sectorKey: 'meso1', label: 'GOES-19 Mesoscale 1' },
  goes19meso2: { satKey: 'goes19', sectorKey: 'meso2', label: 'GOES-19 Mesoscale 2' },
  goes18:      { satKey: 'goes18', sectorKey: 'full',  label: 'GOES-18 Full Disk' },
  goes18meso1: { satKey: 'goes18', sectorKey: 'meso1', label: 'GOES-18 Mesoscale 1' },
  goes18meso2: { satKey: 'goes18', sectorKey: 'meso2', label: 'GOES-18 Mesoscale 2' },
  himawari:    { satKey: 'himawari9', sectorKey: 'hfd', label: 'Himawari-9' },
  himawaritarget: { satKey: 'himawari9', sectorKey: 'target', label: 'Himawari-9 Target Sector' },
};

const RADAR_LAYER_ID = 'on-device-radar';
const MRMS_LAYER_ID = 'on-device-mrms';
const SATELLITE_LAYER_ID = 'on-device-satellite';
const MRMS_SMOOTH_LEVEL = 1;
const MAX_RADAR_FRAMES = 10;
const MAX_SATELLITE_FRAMES = 10;
const nav = typeof navigator === 'undefined' ? {} : navigator;
const viewportMin =
  typeof innerWidth === 'number' && typeof innerHeight === 'number'
    ? Math.min(innerWidth, innerHeight)
    : Infinity;
const constrained =
  (nav.deviceMemory && nav.deviceMemory <= 4) ||
  (nav.maxTouchPoints > 0 && viewportMin <= 1024);
const RADAR_CACHE_MAX = constrained ? 1 : 3;
const SATELLITE_CACHE_MAX = constrained ? 1 : 2;

let radarLayer = null;
let mrmsLayer = null;
let satelliteLayer = null;
let radarVisible = false;
let satelliteVisible = false;
let opacity = 0.78;
let anchorId = null;
let activeMap = null;
let hooks = {};

let decodeWorker = null;
let decodeSequence = 0;
const decodeJobs = new Map();

let radarSequence = 0;
let radarMode = 'mrms';
let radarSite = null;
let radarProductKey = 'refl';
let radarFrames = [];
let radarFrameIndex = -1;
let radarFrameMeta = null;
let shownRadar = null;
const radarCache = new Map();
const radarInflight = new Map();
const mrmsCache = new Map();

const defaultColorTables = new WeakMap();

let satelliteSequence = 0;
let satelliteSourceKey = null;
let satelliteProductKey = null;
let satelliteFrames = [];
let satelliteFrameIndex = -1;
let satelliteScene = null;
let satelliteFrameMeta = null;
let satelliteDecodeBBox = null;
const satelliteCache = new Map();

function emitStatus(kind, phase, detail = '', progress = null) {
  hooks.onStatus?.({ kind, phase, detail, progress });
}

function lruGet(cache, key) {
  if (!cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function lruSet(cache, key, value, max) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > max) cache.delete(cache.keys().next().value);
}

function mountLayer(map, layer, beforeId) {
  if (!map || !map.getStyle?.()) return;
  if (!map.getLayer(layer.id)) {
    const validAnchor = beforeId && map.getLayer(beforeId) ? beforeId : undefined;
    map.addLayer(layer, validAnchor);
  } else if (beforeId && map.getLayer(beforeId)) {
    try { map.moveLayer(layer.id, beforeId); } catch {}
  }
  // Satellite is the photographic base; radar returns stay above it.
  const activeRadarLayer = map.getLayer(MRMS_LAYER_ID)
    ? MRMS_LAYER_ID
    : (map.getLayer(RADAR_LAYER_ID) ? RADAR_LAYER_ID : null);
  if (map.getLayer(SATELLITE_LAYER_ID) && activeRadarLayer) {
    try { map.moveLayer(SATELLITE_LAYER_ID, activeRadarLayer); } catch {}
  }
}

function ensureRadarLayer(map, beforeId) {
  if (!radarLayer) radarLayer = createRadarLayer(RADAR_LAYER_ID);
  mountLayer(map, radarLayer, beforeId);
  radarLayer.setOpacity(opacity);
  return radarLayer;
}

function ensureMrmsLayer(map, beforeId) {
  if (!mrmsLayer) mrmsLayer = createGridLayer(MRMS_LAYER_ID);
  mountLayer(map, mrmsLayer, beforeId);
  mrmsLayer.setOpacity(opacity);
  mrmsLayer.setSmooth(MRMS_SMOOTH_LEVEL);
  return mrmsLayer;
}

function ensureSatelliteLayer(map, beforeId) {
  if (!satelliteLayer) satelliteLayer = createSatelliteLayer(SATELLITE_LAYER_ID);
  mountLayer(map, satelliteLayer, beforeId);
  satelliteLayer.setOpacity(opacity);
  return satelliteLayer;
}

function failDecoder(error) {
  for (const job of decodeJobs.values()) job.reject(error);
  decodeJobs.clear();
  try { decodeWorker?.terminate(); } catch {}
  decodeWorker = null;
}

function getDecoder() {
  if (decodeWorker) return decodeWorker;
  const worker = new Worker(new URL('./decoder.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const job = decodeJobs.get(data.id);
    if (!job) return;
    decodeJobs.delete(data.id);
    if (data.ok) job.resolve(data.result);
    else job.reject(new Error(data.error || 'radar decode failed'));
  };
  worker.onerror = (event) =>
    failDecoder(new Error(`radar decoder failed: ${event.message || 'worker crashed'}`));
  worker.onmessageerror = () =>
    failDecoder(new Error('radar decoder returned an unreadable response'));
  decodeWorker = worker;
  return worker;
}

function decodeRadar(bytes) {
  const id = ++decodeSequence;
  return new Promise((resolve, reject) => {
    const worker = getDecoder();
    decodeJobs.set(id, { resolve, reject });
    try {
      worker.postMessage({ id, bytes }, [bytes.buffer]);
    } catch (error) {
      decodeJobs.delete(id);
      reject(error);
    }
  });
}

function radarSiteFromFrame(frame, fallback) {
  const site = frame?.site;
  if (site && Number.isFinite(site.lat) && Number.isFinite(site.lon)) return site;
  return { lat: fallback[2], lon: fallback[3], height: 0, inferred: true };
}

function pickSweep(volume, decoderId) {
  const moment = PRODUCTS[decoderId]?.moment;
  const candidates = (volume?.sweeps || []).filter((sweep) =>
    sweep.moments?.includes(moment)
  );
  if (!candidates.length) return null;
  const lowest = Math.min(...candidates.map((sweep) => sweep.elevation));
  return candidates
    .filter((sweep) => Math.abs(sweep.elevation - lowest) <= 0.1)
    .sort((a, b) => (b.time || 0) - (a.time || 0))[0];
}

async function decodedRadarFrame(frame, onProgress) {
  const cached = lruGet(radarCache, frame.key);
  if (cached) return cached;
  if (radarInflight.has(frame.key)) return radarInflight.get(frame.key);
  const task = (async () => {
    const bytes = await fetchVolume(frame.key, onProgress);
    emitStatus('radar', 'decoding', 'Decoding Level II on this device', 1);
    const volume = await decodeRadar(bytes);
    lruSet(radarCache, frame.key, volume, RADAR_CACHE_MAX);
    return volume;
  })();
  radarInflight.set(frame.key, task);
  task.finally(() => radarInflight.delete(frame.key)).catch(() => {});
  return task;
}

function radarResult() {
  const product =
    radarMode === 'mrms'
      ? MRMS_RADAR_PRODUCTS[radarProductKey]
      : RADAR_PRODUCTS[radarProductKey];
  return {
    frames: radarFrames.map((frame) => ({ key: frame.key, time: frame.time, label: frame.label })),
    index: radarFrameIndex,
    frame: radarFrameMeta,
    mode: radarMode,
    site: radarSite
      ? { id: radarSite[0], name: radarSite[1], lat: radarSite[2], lon: radarSite[3] }
      : null,
    product,
  };
}

async function showRadar(index, sequence = ++radarSequence) {
  if (radarMode === 'mrms') return showMrmsRadar(index, sequence);
  const productInfo = RADAR_PRODUCTS[radarProductKey];
  const frame = radarFrames[Math.max(0, Math.min(radarFrames.length - 1, Number(index)))];
  if (!frame || !productInfo) throw new Error('No raw radar frame is available');
  radarFrameIndex = radarFrames.indexOf(frame);
  emitStatus('radar', 'downloading', `Downloading ${radarSite[0]} Level II`, 0);
  const volume = await decodedRadarFrame(frame, (progress) => {
    if (sequence === radarSequence)
      emitStatus('radar', 'downloading', `Downloading ${radarSite[0]} Level II`, progress);
  });
  if (sequence !== radarSequence) return radarResult();
  const sweep = pickSweep(volume, productInfo.decoderId);
  if (!sweep) throw new Error(`${productInfo.label} is unavailable in this volume`);
  const site = radarSiteFromFrame(volume, radarSite);
  radarFrameMeta = {
    key: frame.key,
    time: frame.time || (sweep.time ? new Date(sweep.time) : null),
    elevation: sweep.elevation,
    radialCount: sweep.radials.length,
  };
  if (radarVisible && activeMap) {
    ensureRadarLayer(activeMap, anchorId).setSweep(sweep, PRODUCTS[productInfo.decoderId], site);
  }
  shownRadar = { sweep, site, product: PRODUCTS[productInfo.decoderId], productInfo };
  emitStatus(
    'radar',
    'ready',
    `${radarSite[0]} ${productInfo.label} · ${sweep.elevation.toFixed(1)}°`,
    1
  );
  hooks.onFrame?.({ kind: 'radar', ...radarResult() });
  return radarResult();
}

async function decodedMrmsFrame(frame, decoderId, onProgress) {
  const cacheKey = `${decoderId}|${frame.key}`;
  const cached = lruGet(mrmsCache, cacheKey);
  if (cached) return cached;
  emitStatus('radar', 'downloading', `Downloading MRMS ${MRMS_PRODUCTS[decoderId].name}`, 0);
  const grid = await loadMrms(decoderId, frame.key, onProgress);
  lruSet(mrmsCache, cacheKey, grid, constrained ? 1 : 2);
  return grid;
}

async function showMrmsRadar(index, sequence = ++radarSequence) {
  const productInfo = MRMS_RADAR_PRODUCTS[radarProductKey];
  const product = productInfo && MRMS_PRODUCTS[productInfo.decoderId];
  const frame = radarFrames[Math.max(0, Math.min(radarFrames.length - 1, Number(index)))];
  if (!frame || !product) throw new Error('No raw MRMS frame is available');
  radarFrameIndex = radarFrames.indexOf(frame);
  const grid = await decodedMrmsFrame(frame, productInfo.decoderId, (progress) => {
    if (sequence === radarSequence)
      emitStatus('radar', 'decoding', 'Decoding MRMS GRIB2 on this device', progress);
  });
  if (sequence !== radarSequence) return radarResult();
  radarFrameMeta = { key: frame.key, time: frame.time || grid.time || null };
  if (radarVisible && activeMap) {
    radarLayer?.clear();
    ensureMrmsLayer(activeMap, anchorId).setGrid(grid, product);
  }
  shownRadar = { mode: 'mrms', grid, product, productInfo };
  emitStatus('radar', 'ready', `${productInfo.label} · MRMS decoded locally`, 1);
  hooks.onFrame?.({ kind: 'radar', ...radarResult() });
  return radarResult();
}

function satelliteConfig(sourceKey) {
  const source = SATELLITE_SOURCES[sourceKey];
  if (!source || !SATELLITES[source.satKey] || !SECTORS[source.sectorKey])
    throw new Error('Unknown raw satellite source');
  return source;
}

function productDecoderId(productKey) {
  const product = SATELLITE_PRODUCTS[productKey];
  if (!product) throw new Error('Unknown satellite product');
  return product;
}

function normalizeDecodeBBox(sourceKey, location) {
  // Keep the whole fixed grid addressable by the projection shader. Constrained
  // devices are downsampled by satClient before the texture is transferred.
  // Regional range-windowing remains available in the imported decoder, but a
  // full scene avoids exposing chunk boundaries when a user pans outside the
  // initial location box.
  void sourceKey;
  void location;
  return null;
}

function satelliteCacheKey(sourceKey, productKey, key, bbox) {
  return `${sourceKey}|${productKey}|${key}|${bbox ? bbox.join(',') : 'full'}`;
}

async function prepareSatelliteFrame(sourceKey, productKey, frame, bbox, sequence) {
  const cacheKey = satelliteCacheKey(sourceKey, productKey, frame.key, bbox);
  const cached = lruGet(satelliteCache, cacheKey);
  if (cached) return cached;
  const source = satelliteConfig(sourceKey);
  const decoderId = productDecoderId(productKey);
  emitStatus('satellite', 'downloading', `Downloading ${source.label}`, 0);
  let scene = satelliteScene;
  if (
    !scene ||
    scene.key !== frame.key ||
    scene._sourceKey !== sourceKey ||
    JSON.stringify(scene._bbox || null) !== JSON.stringify(bbox || null)
  ) {
    scene = await loadSceneAsync(
      source.satKey,
      source.sectorKey,
      frame.key,
      bandsFor(decoderId),
      (progress) => {
        if (sequence === satelliteSequence)
          emitStatus('satellite', 'decoding', `Decoding ${source.label} on this device`, progress);
      },
      bbox
    );
    scene._sourceKey = sourceKey;
  } else {
    await ensureBandsAsync(scene, source.satKey, source.sectorKey, bandsFor(decoderId));
  }
  if (decoderId === SAT_PRECIP_ID) {
    emitStatus('satellite', 'deriving', 'Deriving satellite rain rate on this device', 1);
    scene.channels.RR = computePrecipRate(scene);
  }
  const rgba = buildRGBA(scene, decoderId, { enhanceIR: true });
  let visibleSamples = 0;
  let maxSample = 0;
  const sampleStride = Math.max(4, Math.floor(rgba.length / (4 * 4096)) * 4);
  for (let offset = 3; offset < rgba.length; offset += sampleStride) {
    if (rgba[offset] > 0) {
      visibleSamples++;
      maxSample = Math.max(maxSample, rgba[offset - 3], rgba[offset - 2], rgba[offset - 1]);
    }
  }
  if (!visibleSamples) throw new Error(`${source.label} decoded without any visible pixels`);
  const meta = {
    width: scene.width,
    height: scene.height,
    xScale: scene.xScale,
    xOffset: scene.xOffset,
    yScale: scene.yScale,
    yOffset: scene.yOffset,
    proj: scene.proj,
  };
  const payload = {
    scene,
    meta,
    rgba,
    bbox: bbox || sceneBBox(scene),
    visibleSamples,
    maxSample,
  };
  lruSet(satelliteCache, cacheKey, payload, SATELLITE_CACHE_MAX);
  return payload;
}

function satelliteResult() {
  return {
    frames: satelliteFrames.map((frame) => ({ key: frame.key, time: frame.time, label: frame.label })),
    index: satelliteFrameIndex,
    frame: satelliteFrameMeta,
    source: SATELLITE_SOURCES[satelliteSourceKey] || null,
    productKey: satelliteProductKey,
  };
}

async function showSatellite(index, sequence = ++satelliteSequence) {
  const frame =
    satelliteFrames[Math.max(0, Math.min(satelliteFrames.length - 1, Number(index)))];
  if (!frame) throw new Error('No raw satellite frame is available');
  satelliteFrameIndex = satelliteFrames.indexOf(frame);
  const payload = await prepareSatelliteFrame(
    satelliteSourceKey,
    satelliteProductKey,
    frame,
    satelliteDecodeBBox,
    sequence
  );
  if (sequence !== satelliteSequence) return satelliteResult();
  satelliteScene = payload.scene;
  satelliteFrameMeta = {
    key: frame.key,
    time: frame.time,
    label: frame.label,
    width: payload.meta.width,
    height: payload.meta.height,
    bbox: payload.bbox,
    visibleSamples: payload.visibleSamples,
    maxSample: payload.maxSample,
  };
  if (satelliteVisible && activeMap) {
    ensureSatelliteLayer(activeMap, anchorId).setScene(payload.meta, payload.rgba, payload.bbox);
  }
  emitStatus(
    'satellite',
    'ready',
    `${SATELLITE_SOURCES[satelliteSourceKey].label} · decoded locally`,
    1
  );
  hooks.onFrame?.({ kind: 'satellite', ...satelliteResult() });
  return satelliteResult();
}

export async function loadRadar({
  map,
  beforeId = null,
  location,
  mode = 'mrms',
  productKey = 'refl',
  siteId = null,
  onStatus,
  onFrame,
} = {}) {
  hooks = { ...hooks, onStatus, onFrame };
  activeMap = map || activeMap;
  anchorId = beforeId || anchorId;
  radarVisible = true;
  radarMode = mode === 'single' ? 'single' : 'mrms';
  const previousProduct = radarProductKey;
  radarProductKey =
    radarMode === 'mrms'
      ? (MRMS_RADAR_PRODUCTS[productKey] ? productKey : 'refl')
      : (RADAR_PRODUCTS[productKey] ? productKey : 'nexrad_ref');
  const sequence = ++radarSequence;

  if (radarMode === 'mrms') {
    radarSite = null;
    radarLayer?.clear();
    const product = MRMS_RADAR_PRODUCTS[radarProductKey];
    if (previousProduct !== radarProductKey || !radarFrames.length || shownRadar?.mode !== 'mrms') {
      emitStatus('radar', 'listing', `Finding recent MRMS ${product.label} frames`, null);
      let frames = await listMrms(product.decoderId, new Date());
      if (!frames.length) frames = await listMrms(product.decoderId, new Date(Date.now() - 86400000));
      if (sequence !== radarSequence) return radarResult();
      radarFrames = frames.slice(-MAX_RADAR_FRAMES);
      radarFrameIndex = radarFrames.length - 1;
    }
    if (!radarFrames.length) throw new Error(`No recent MRMS ${product.label} frames were found`);
    return showMrmsRadar(radarFrameIndex < 0 ? radarFrames.length - 1 : radarFrameIndex, sequence);
  }

  mrmsLayer?.clear();
  const requestedSite = String(siteId || '').toUpperCase();
  const selected =
    RADARS.find((site) => site[0] === requestedSite) ||
    nearestSite(Number(location?.lat), Number(location?.lon));
  if (!selected) throw new Error('No NEXRAD site is available for this location');
  const siteChanged = radarSite?.[0] !== selected[0] || shownRadar?.mode === 'mrms';
  radarSite = selected;
  if (siteChanged || !radarFrames.length) {
    emitStatus('radar', 'listing', `Finding recent ${selected[0]} scans`, null);
    let volumes = await listVolumes(selected[0], new Date());
    if (!volumes.length) volumes = await listVolumes(selected[0], new Date(Date.now() - 86400000));
    if (sequence !== radarSequence) return radarResult();
    radarFrames = volumes.slice(-MAX_RADAR_FRAMES);
    radarFrameIndex = radarFrames.length - 1;
  }
  if (!radarFrames.length) throw new Error(`No recent ${selected[0]} Level II scans were found`);
  return showRadar(radarFrameIndex < 0 ? radarFrames.length - 1 : radarFrameIndex, sequence);
}

export function showRadarFrame(index) {
  return showRadar(index);
}

export async function loadSatellite({
  map,
  beforeId = null,
  sourceKey = 'goes19conus',
  productKey = 'geocolor',
  location = null,
  onStatus,
  onFrame,
} = {}) {
  hooks = { ...hooks, onStatus, onFrame };
  activeMap = map || activeMap;
  anchorId = beforeId || anchorId;
  satelliteVisible = true;
  const source = satelliteConfig(sourceKey);
  productDecoderId(productKey);
  const sourceChanged = sourceKey !== satelliteSourceKey;
  satelliteSourceKey = sourceKey;
  satelliteProductKey = productKey;
  satelliteDecodeBBox = normalizeDecodeBBox(sourceKey, location);
  const sequence = ++satelliteSequence;

  if (sourceChanged || !satelliteFrames.length) {
    emitStatus('satellite', 'listing', `Finding recent ${source.label} scenes`, null);
    let frames = await listScenes(source.satKey, source.sectorKey, new Date());
    if (!frames.length)
      frames = await listScenes(source.satKey, source.sectorKey, new Date(Date.now() - 86400000));
    if (sequence !== satelliteSequence) return satelliteResult();
    satelliteFrames = frames.slice(-MAX_SATELLITE_FRAMES);
    satelliteFrameIndex = satelliteFrames.length - 1;
    satelliteScene = null;
  }
  if (!satelliteFrames.length) throw new Error(`No recent ${source.label} scenes were found`);
  return showSatellite(
    satelliteFrameIndex < 0 ? satelliteFrames.length - 1 : satelliteFrameIndex,
    sequence
  );
}

export function showSatelliteFrame(index) {
  return showSatellite(index);
}

export function setOpacity(value) {
  opacity = Math.max(0, Math.min(1, Number(value)));
  radarLayer?.setOpacity(opacity);
  mrmsLayer?.setOpacity(opacity);
  satelliteLayer?.setOpacity(opacity);
}

export function setVisibility({ radar = radarVisible, satellite = satelliteVisible } = {}) {
  radarVisible = Boolean(radar);
  satelliteVisible = Boolean(satellite);
  if (!radarVisible) {
    radarLayer?.clear();
    mrmsLayer?.clear();
  }
  if (!satelliteVisible) satelliteLayer?.clear();
}

function circularDifference(a, b) {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

export function sampleRadar(lon, lat) {
  const shown = shownRadar;
  if (!shown || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (shown.mode === 'mrms') {
    const { grid, productInfo } = shown;
    const col = Math.round((lon - grid.lon1) / grid.di);
    const row = Math.round((grid.lat1 - lat) / grid.dj);
    if (col < 0 || col >= grid.ni || row < 0 || row >= grid.nj) return { noData: true };
    const native = grid.values[row * grid.ni + col];
    if (!Number.isFinite(native)) return { noData: true };
    const value = native * (shown.product.dispFactor || 1) + (shown.product.dispOffset || 0);
    return {
      source: 'MRMS · decoded on this device',
      site: '',
      product: productInfo.label,
      unit: productInfo.unit,
      low: value,
      high: value,
      exact: true,
      dec: productInfo.unit === 'in' || productInfo.unit === 'in/hr' ? 2 : 0,
      color: null,
    };
  }
  const { sweep, site, product, productInfo } = shown;
  const dy = (lat - site.lat) * 111320;
  const dx = (lon - site.lon) * 111320 * Math.cos(site.lat * Math.PI / 180);
  const range = Math.hypot(dx, dy);
  const azimuth = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  let radial = null;
  let best = Infinity;
  for (const candidate of sweep.radials) {
    const diff = circularDifference(candidate.azimuth, azimuth);
    if (diff < best) { best = diff; radial = candidate; }
  }
  const moment = radial?.moments?.[product.moment];
  if (!moment || best > 2) return { noData: true };
  const gate = Math.round((range - moment.firstGate) / moment.gateSpacing);
  if (gate < 0 || gate >= moment.gateCount) return { noData: true };
  const code = moment.raw[gate];
  if (code < 2) return { noData: true };
  const nativeValue = (code - moment.offset) / (moment.scale || 1);
  const value = nativeValue * (product.dispFactor || 1) + (product.dispOffset || 0);
  const decimals = productInfo.unit === 'ρHV' ? 2 : productInfo.unit === 'dB' ? 1 : 0;
  return {
    source: 'NEXRAD Level II',
    site: radarSite?.[0] || '',
    product: productInfo.label,
    unit: productInfo.unit,
    low: value,
    high: value,
    exact: true,
    dec: decimals,
    color: null,
  };
}

function radarProduct(mode, productKey) {
  if (mode === 'mrms') {
    const info = MRMS_RADAR_PRODUCTS[productKey];
    return info ? MRMS_PRODUCTS[info.decoderId] : null;
  }
  const info = RADAR_PRODUCTS[productKey];
  return info ? PRODUCTS[info.decoderId] : null;
}

function rememberDefaultColorTable(product) {
  if (product && !defaultColorTables.has(product)) {
    defaultColorTables.set(product, {
      scale: product.scale,
      range: product.range ? [...product.range] : null,
      lo: product.lo,
      hi: product.hi,
      dispUnit: product.dispUnit,
      dispFactor: product.dispFactor,
      dispOffset: product.dispOffset,
      customPal: product.customPal,
    });
  }
}

function repaintRadarProduct(product) {
  if (!shownRadar || shownRadar.product !== product || !radarVisible || !activeMap) return;
  if (shownRadar.mode === 'mrms') {
    ensureMrmsLayer(activeMap, anchorId).setGrid(shownRadar.grid, product);
  } else {
    ensureRadarLayer(activeMap, anchorId).setSweep(shownRadar.sweep, product, shownRadar.site);
  }
}

export function applyRadarPalette({ mode = radarMode, productKey = radarProductKey, text, name = 'Custom palette' } = {}) {
  const product = radarProduct(mode, productKey);
  if (!product) throw new Error('This radar product does not support custom color tables');
  const pal = parsePal(String(text || ''));
  if (!pal.segments || pal.segments.length < 2) throw new Error('The color table needs at least two color stops');
  rememberDefaultColorTable(product);
  product.scale = makeScale(pal.segments);
  if (product.range) product.range = [product.scale.lo, product.scale.hi];
  if ('lo' in product) product.lo = product.scale.lo;
  if ('hi' in product) product.hi = product.scale.hi;
  product.dispUnit = pal.units || product.dispUnit || product.unit;
  product.dispFactor = 1;
  product.dispOffset = 0;
  product.customPal = name;
  repaintRadarProduct(product);
  return radarPalette(mode, productKey);
}

export function resetRadarPalette({ mode = radarMode, productKey = radarProductKey } = {}) {
  const product = radarProduct(mode, productKey);
  const defaults = product && defaultColorTables.get(product);
  if (!product || !defaults) return radarPalette(mode, productKey);
  product.scale = defaults.scale;
  if (defaults.range) product.range = [...defaults.range];
  if ('lo' in product) product.lo = defaults.lo;
  if ('hi' in product) product.hi = defaults.hi;
  product.dispUnit = defaults.dispUnit;
  product.dispFactor = defaults.dispFactor;
  product.dispOffset = defaults.dispOffset;
  product.customPal = defaults.customPal;
  repaintRadarProduct(product);
  return radarPalette(mode, productKey);
}

export function radarPalette(mode = radarMode, productKey = radarProductKey) {
  const product = radarProduct(mode, productKey);
  if (!product?.scale?.rgba) return null;
  const colors = [];
  const count = 9;
  for (let i = 0; i < count; i++) {
    const step = Math.round((i / (count - 1)) * (product.scale.steps - 1));
    const off = step * 4;
    colors.push(`rgba(${product.scale.rgba[off]},${product.scale.rgba[off + 1]},${product.scale.rgba[off + 2]},${product.scale.rgba[off + 3] / 255})`);
  }
  return {
    colors,
    lo: product.scale.lo * (product.dispFactor || 1) + (product.dispOffset || 0),
    hi: product.scale.hi * (product.dispFactor || 1) + (product.dispOffset || 0),
    unit: product.dispUnit || product.unit || '',
    name: product.customPal || null,
  };
}

export function radarSites() {
  return RADARS.map(([id, name, lat, lon]) => ({ id, name, lat, lon }));
}

export function clearSatelliteDecoderCache() {
  satelliteCache.clear();
  satelliteScene = null;
  clearSceneCache();
}

export function currentState() {
  return { radar: radarResult(), satellite: satelliteResult() };
}
