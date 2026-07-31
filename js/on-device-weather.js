// Browser-native radar and satellite controller.
//
// Raw NEXRAD Level II and GOES/Himawari files are fetched from the public
// CORS-enabled NOAA/Unidata buckets. Binary parsing and decompression happen in
// module Web Workers; only decoded typed arrays and ready-to-upload textures
// reach the page.

import { listVolumes, fetchVolume, nearestSite, RADARS } from './s3.js';
import { PRODUCTS, makeScale, parsePal } from './products.js';
import { createRadarLayer } from './radarLayer.js';
import { MRMS_PRODUCTS, listMrms, loadMrms, precipTypeReading } from './mrms.js';
import { createGridLayer } from './gridLayer.js';
import {
  NOWCAST_MAX_LEAD_MINUTES,
  prepareReflectivityNowcast,
  advectReflectivityStream,
  cropLatLonGrid,
} from './nowcast.js';
import { SATELLITES, SECTORS, listScenes, sceneBBox } from './goes.js';
import { loadSceneAsync, ensureBandsAsync, clearSceneCache } from './satClient.js';
import { bandsFor, buildRGBA } from './satProducts.js';
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
  // Composite reflectivity carries the extrapolated frames on the end of its own
  // timeline (`nowcast`), so the future radar is simply the part of the radar
  // timeline that runs past now — not a separate product to switch to.
  refl:      { decoderId: 'REFC',     label: 'Composite Reflectivity', unit: 'dBZ', nowcast: true },
  mesh:      { decoderId: 'MESH',     label: 'Hail (MESH)', unit: 'in' },
  qpe6h:     { decoderId: 'QPE6H',    label: '6-Hr Precip', unit: 'in' },
  qpe24h:    { decoderId: 'QPE24H',   label: '24-Hr Precip', unit: 'in' },
  lightning: { decoderId: 'LTG30',    label: 'Lightning Probability', unit: '%' },
  rotation:  { decoderId: 'AZSHEAR',  label: 'Azimuthal Shear', unit: '10⁻³ s⁻¹' },
  // Precipitation type is derived in the browser from three MRMS fields (see
  // mrms.js): the rate sets the shade, the flag and wet-bulb set the band.
  rate:      { decoderId: 'PTYPE',    label: 'Precip Type', unit: 'in/hr' },
};

export const SATELLITE_PRODUCTS = {
  geocolor: 'RGB_GEOCOLOR',
  infrared: 'C13',
  watervapor: 'C09',
  visible: 'C02',
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
const NOWCAST_MAX_SOURCE_AGE_MINUTES = 8;
// How far before the tracked pair to reach for the scan that gives growth, decay
// and motion a rate of change. Capped by the extrapolation's own 20-minute limit
// on how far apart two matchable scans can be.
const NOWCAST_RATE_BASELINE_MINUTES = 16;
// The nowcast picks its scan history from a longer listing than the timeline
// shows. This costs no extra request — the bucket listing is the same one — and
// it is what makes the baseline above reachable.
const NOWCAST_HISTORY_FRAMES = 12;
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
// Scrubbing or pressing play used to download and decode each frame on demand,
// so the first pass through the loop stuttered on every step. Once the newest
// frame is on screen the rest of the buffer is fetched quietly in the
// background, oldest-first-behind-newest, one at a time so the warming never
// competes with a frame the user is actually waiting for.
//
// Decoded MRMS grids are a few MB each, so the whole observed buffer is held in
// memory only where there is memory to hold it; a constrained device still
// warms the network so the bytes are local even when the grid has to be rebuilt.
const MRMS_CACHE_MAX = constrained ? 1 : 12;
// Level II volumes are an order of magnitude larger than an MRMS grid, so those
// are warmed through the byte cache and decoded on demand.
const RADAR_WARM_LIMIT = constrained ? 0 : 6;
// Forecast frames are spaced closer than the 5-minute steps the extrapolation
// used to publish, so playing past "now" glides at roughly the observed scan
// cadence instead of jumping. Each frame is a float grid, so phones get the
// coarser spacing.
const NOWCAST_LEAD_STEP_MINUTES = constrained ? 5 : 3;
const NOWCAST_DISPLAY_LEADS_MINUTES = Object.freeze(
  Array.from(
    { length: Math.floor(NOWCAST_MAX_LEAD_MINUTES / NOWCAST_LEAD_STEP_MINUTES) },
    (_, index) => (index + 1) * NOWCAST_LEAD_STEP_MINUTES,
  ),
);
// A finished build stays valid until a newer scan lands; this only bounds how
// long we trust it when the bucket listing has not moved on yet.
const NOWCAST_REUSE_MS = 150_000;
// The extrapolation covers the entire MRMS domain, not the sector the map
// happens to be showing. Panning or zooming therefore never invalidates it: the
// storm two states away has already been extrapolated by the time the view
// reaches it, and scrubbing into the future keeps working while the map moves.
// cropLatLonGrid clamps to the source grid, so this is simply "all of it".
const NOWCAST_DOMAIN = Object.freeze({
  west: -130,
  east: -60,
  south: 20,
  north: 55,
});
// Covering the whole domain means the cell budget buys resolution everywhere
// instead of detail in one window. A native CONUS field is 7000 x 3500 cells, so
// this reduces it by 6 (about 6.5 km cells) on a desktop and by 9 on a phone —
// comfortably finer than the position uncertainty of a 30-minute extrapolation,
// which is the accuracy that actually bounds the forecast.
const NOWCAST_GRID_LIMITS = Object.freeze({
  maxWidth: constrained ? 800 : 1200,
  maxHeight: constrained ? 420 : 620,
});

let radarLayer = null;
let mrmsLayer = null;
let satelliteLayer = null;
let radarVisible = false;
let satelliteVisible = false;
let opacity = 0.78;
let anchorId = null;
let activeMap = null;
let radarHooks = {};
let satelliteHooks = {};

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
// How many of `radarFrames` are observations; anything after them is an
// extrapolated frame appended by the nowcast.
let radarObservedCount = 0;
// Every recent scan the last listing turned up, which reaches further back than
// the observed timeline so the nowcast can measure a rate of change.
let mrmsHistoryCatalog = [];
let nowcastBuildSequence = 0;
let nowcastFrames = [];
let nowcastSourceKey = null;
let nowcastRegionKey = null;
let nowcastGeneratedAt = 0;
let nowcastSummary = null;
let nowcastStatus = 'idle'; // idle | building | ready | unavailable
let nowcastFailedKey = null;
let nowcastFailedAt = 0;
let nowcastInflightPromise = null;
let nowcastInflightToken = -1;
let nowcastInflightRegionKey = null;
let nowcastAbortController = null;
let nowcastWorker = null;
const radarCache = new Map();
const radarInflight = new Map();
const mrmsCache = new Map();
const mrmsInflight = new Map();

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
  const target = kind === 'satellite' ? satelliteHooks : radarHooks;
  target.onStatus?.({ kind, phase, detail, progress });
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

// A banded field (precipitation type) is drawn crisp: the smoothing blend runs
// through the colour table, so blurring across a rain/snow edge would paint a
// stripe of the band that lies between them.
function ensureMrmsLayer(map, beforeId, product = null) {
  if (!mrmsLayer) mrmsLayer = createGridLayer(MRMS_LAYER_ID);
  mountLayer(map, mrmsLayer, beforeId);
  mrmsLayer.setOpacity(opacity);
  mrmsLayer.setSmooth(product?.categorical ? 0 : MRMS_SMOOTH_LEVEL);
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
    emitStatus('radar', 'processing', `Processing ${radarSite?.[0] || 'radar'} scan`, 1);
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
    frames: radarFrames.map((frame) => ({
      key: frame.key,
      time: frame.time || frame.validTime || null,
      label: frame.label,
      forecast: Boolean(frame.forecast || frame.extrapolated),
      leadMinutes: Number(frame.leadMinutes) || 0,
      quality: Number.isFinite(frame.quality) ? frame.quality : null,
      summary: frame.summary || null,
    })),
    index: radarFrameIndex,
    frame: radarFrameMeta,
    mode: radarMode,
    productKey: radarProductKey,
    // Where the observed timeline ends and the extrapolation begins, plus the
    // state of the build, so the page can label the future half of the scrubber.
    observedCount: radarObservedCount || radarFrames.length,
    nowcast: {
      supported: radarMode === 'mrms' && Boolean(MRMS_RADAR_PRODUCTS[radarProductKey]?.nowcast),
      status: nowcastStatus,
      frameCount: Math.max(0, radarFrames.length - radarObservedCount),
      summary: nowcastSummary,
    },
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
  emitStatus('radar', 'downloading', `Loading ${radarSite[0]} radar`, 0);
  const volume = await decodedRadarFrame(frame, (progress) => {
    if (sequence === radarSequence)
      emitStatus('radar', 'downloading', `Loading ${radarSite[0]} radar`, progress);
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
  shownRadar = {
    mode: 'single',
    productKey: radarProductKey,
    sweep,
    site,
    product: PRODUCTS[productInfo.decoderId],
    productInfo,
  };
  emitStatus(
    'radar',
    'ready',
    `${radarSite[0]} ${productInfo.label} · ${sweep.elevation.toFixed(1)}°`,
    1
  );
  radarHooks.onFrame?.({ kind: 'radar', ...radarResult() });
  return radarResult();
}

// `quiet` suppresses the status line. The background warmer loads frames nobody
// asked for yet, so it must not replace the label describing the frame that is
// actually on screen with a progress readout for a different one.
async function decodedMrmsFrame(frame, decoderId, onProgress, { quiet = false } = {}) {
  const cacheKey = `${decoderId}|${frame.key}`;
  const cached = lruGet(mrmsCache, cacheKey);
  if (cached) return cached;
  if (mrmsInflight.has(cacheKey)) return mrmsInflight.get(cacheKey);
  const task = (async () => {
    if (!quiet) emitStatus('radar', 'downloading', `Loading ${MRMS_PRODUCTS[decoderId].name}`, 0);
    const grid = await loadMrms(decoderId, frame.key, onProgress);
    lruSet(mrmsCache, cacheKey, grid, MRMS_CACHE_MAX);
    return grid;
  })();
  mrmsInflight.set(cacheKey, task);
  task.finally(() => mrmsInflight.delete(cacheKey)).catch(() => {});
  return task;
}

async function showMrmsRadar(index, sequence = ++radarSequence) {
  const productInfo = MRMS_RADAR_PRODUCTS[radarProductKey];
  const product = productInfo && MRMS_PRODUCTS[productInfo.decoderId];
  const frame = radarFrames[Math.max(0, Math.min(radarFrames.length - 1, Number(index)))];
  if (!frame || !product) throw new Error('No raw MRMS frame is available');
  radarFrameIndex = radarFrames.indexOf(frame);
  const forecast = Boolean(frame.forecast || frame.extrapolated);
  const grid = frame.grid
    ? frame.grid
    : await decodedMrmsFrame(frame, productInfo.decoderId, (progress) => {
        if (sequence === radarSequence)
          emitStatus('radar', 'processing', 'Processing radar', progress);
      });
  if (sequence !== radarSequence) return radarResult();
  radarFrameMeta = {
    key: frame.key,
    time: frame.time || grid.time || null,
    forecast,
    leadMinutes: Number(frame.leadMinutes) || 0,
    quality: Number.isFinite(frame.quality) ? frame.quality : null,
    summary: frame.summary || null,
  };
  if (radarVisible && activeMap) {
    radarLayer?.clear();
    ensureMrmsLayer(activeMap, anchorId, product).setGrid(grid, product);
  }
  shownRadar = {
    mode: 'mrms',
    productKey: radarProductKey,
    grid,
    product,
    productInfo,
    forecast: radarFrameMeta,
  };
  emitStatus(
    'radar',
    'ready',
    forecast
      ? `+${radarFrameMeta.leadMinutes} min outlook`
      : `${productInfo.label} · MRMS`,
    1,
  );
  radarHooks.onFrame?.({ kind: 'radar', ...radarResult() });
  return radarResult();
}

function frameTimeMillis(frame) {
  const raw = frame?.time;
  const value = raw instanceof Date ? raw.getTime() : raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(value) ? value : NaN;
}

/* ──────────────────────────────────────────────────────────────────────────
   Background frame warming
   The frame the user asked for is always fetched first and on its own; this
   fills in the rest of the buffer afterwards, newest-backwards, one frame at a
   time. Every step re-checks `radarSequence`, so switching product, mode, site
   or tab abandons the warm immediately instead of finishing a download nobody
   is going to look at.
   ────────────────────────────────────────────────────────────────────────── */
let warmSequence = 0;

function idle(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Warm the observed frames behind `skipKey` for whichever radar path is active.
// Fire-and-forget: failures are the same "this frame is unavailable" the
// foreground path already tolerates.
function warmRadarFrames(sequence, skipKey) {
  const token = ++warmSequence;
  const current = () => sequence === radarSequence && token === warmSequence && radarVisible;
  (async () => {
    // Give the frame on screen a clear run at the network first.
    await idle(250);
    if (!current()) return;

    // Newest first: that is the order a user scrubs backwards through.
    const observed = radarFrames
      .slice(0, radarObservedCount || radarFrames.length)
      .filter((frame) => frame && !frame.forecast && !frame.extrapolated && frame.key !== skipKey)
      .reverse();
    if (!observed.length) return;

    if (radarMode === 'mrms') {
      const decoderId = MRMS_RADAR_PRODUCTS[radarProductKey]?.decoderId;
      if (!decoderId) return;
      for (const frame of observed) {
        if (!current()) return;
        // Silent: warming must never write over the status line describing the
        // frame the user is looking at.
        await decodedMrmsFrame(frame, decoderId, null, { quiet: true }).catch(() => {});
        await idle(0);
      }
      return;
    }

    for (const frame of observed.slice(0, RADAR_WARM_LIMIT)) {
      if (!current()) return;
      // Only the bytes are warmed here — the browser's HTTP cache keeps them, so
      // the decode when the user reaches this frame starts from local data
      // instead of a multi-megabyte download.
      await fetchVolume(frame.key).catch(() => {});
      await idle(0);
    }
  })();
}

async function recentMrmsFrames(productId, limit = MAX_RADAR_FRAMES) {
  const now = new Date();
  const today = await listMrms(productId, now);
  let frames = today;
  if (today.length < limit) {
    const yesterday = await listMrms(productId, new Date(now.getTime() - 86400000));
    const byKey = new Map([...yesterday, ...today].map(frame => [frame.key, frame]));
    frames = [...byKey.values()].sort((a, b) => frameTimeMillis(a) - frameTimeMillis(b));
  }
  return frames.slice(-limit);
}

// The observed frame closest to `targetMinutes` before `beforeMillis`, within the
// spacing the motion search can work with.
function nowcastHistoryFrame(frames, beforeMillis, targetMinutes = 8) {
  let best = null;
  let bestDistance = Infinity;
  for (const frame of frames) {
    const intervalMinutes = (beforeMillis - frameTimeMillis(frame)) / 60000;
    if (!(intervalMinutes >= 2 && intervalMinutes <= 20)) continue;
    const distance = Math.abs(intervalMinutes - targetMinutes);
    if (distance < bestDistance) {
      best = frame;
      bestDistance = distance;
    }
  }
  return best;
}

// Up to two earlier scans, oldest first. The newer of the two is what the
// displacement is measured against; pairing it with the older one turns growth,
// decay and motion into a fitted rate of change instead of a single difference,
// so a storm that is not merely growing but growing *faster* — or curving rather
// than tracking straight — is carried forward as one.
//
// The older scan is picked well back rather than immediately before, because the
// rate of change is a second difference: its signal grows with the separation
// between the two velocities while its noise does not, and a pair a quarter of
// an hour apart is worth believing where two touching intervals are not. It is
// optional — with only one usable earlier scan the nowcast still runs, without
// the second-order terms.
function nowcastHistoryFrames(frames, latest) {
  const previous = nowcastHistoryFrame(frames, frameTimeMillis(latest));
  if (!previous) return [];
  const earlier = nowcastHistoryFrame(
    frames, frameTimeMillis(previous), NOWCAST_RATE_BASELINE_MINUTES,
  );
  return earlier ? [earlier, previous] : [previous];
}

function nowcastProduct(productKey = radarProductKey) {
  return radarMode === 'mrms' && Boolean(MRMS_RADAR_PRODUCTS[productKey]?.nowcast);
}

function nowcastJobIsCurrent(token) {
  return (
    token === nowcastBuildSequence &&
    radarVisible &&
    nowcastProduct()
  );
}

function stopNowcastWorker() {
  if (!nowcastWorker) return;
  try { nowcastWorker.terminate(); } catch {}
  nowcastWorker = null;
}

function invalidateNowcastBuild() {
  nowcastBuildSequence++;
  nowcastAbortController?.abort();
  nowcastAbortController = null;
  // Terminating is how an in-progress extrapolation is cancelled: the work is a
  // bounded synchronous loop inside the worker, so there is nothing to poll.
  stopNowcastWorker();
}

function publishRadarFrames() {
  radarHooks.onFrame?.({ kind: 'radar', ...radarResult() });
}

function observedRadarFrames() {
  return radarFrames.slice(0, radarObservedCount || radarFrames.length);
}

// Extrapolated frames are only ever the tail of the timeline, so replacing them
// never disturbs the observed frames or which frame the user is looking at.
function applyNowcastFrames(frames) {
  const selectedKey = radarFrames[radarFrameIndex]?.key;
  nowcastFrames = frames;
  radarFrames = observedRadarFrames().concat(frames);
  const selectedIndex = radarFrames.findIndex((frame) => frame.key === selectedKey);
  radarFrameIndex = selectedIndex >= 0
    ? selectedIndex
    : Math.min(Math.max(0, radarObservedCount - 1), Math.max(0, radarFrames.length - 1));
  publishRadarFrames();
  // The frame the user was on is gone (it aged past its valid time, or a rebuild
  // replaced it) — put whatever the timeline now points at on the map so the
  // label and the picture agree.
  if (selectedKey && selectedIndex < 0 && radarFrames.length) {
    showMrmsRadar(radarFrameIndex).catch((error) =>
      console.warn('Radar frame unavailable', error));
  }
}

function futureNowcastFrames(frames = nowcastFrames) {
  const now = Date.now();
  return frames.filter((frame) => frameTimeMillis(frame) > now);
}

// A finished build is reusable while it still describes the newest scan, covers
// the same area, and has frames left in the future — switching products or
// panning back then re-shows it instantly instead of rebuilding.
function reusableNowcastFrames(latestKey, regionKey) {
  if (
    nowcastSourceKey !== latestKey ||
    nowcastRegionKey !== regionKey ||
    !nowcastGeneratedAt ||
    Date.now() - nowcastGeneratedAt > NOWCAST_REUSE_MS
  ) return null;
  const usable = futureNowcastFrames();
  return usable.length ? usable : null;
}

// One build covers the whole domain, so the region it was built for is a
// constant. Keeping the key means a build still knows what it covers, and it is
// still what tells a reused build apart from a stale one.
function nowcastBoundsKey(bounds) {
  return [bounds.west, bounds.east, bounds.south, bounds.north]
    .map(value => (Math.round(value * 4) / 4).toFixed(2))
    .join(':');
}

const NOWCAST_REGION_KEY = nowcastBoundsKey(NOWCAST_DOMAIN);


// A decoded native grid for this scan that is already in memory, if any: the
// frame's own grid, the one currently on the map, or a cached decode. Never
// downloads — callers use this to avoid re-fetching a field the page already has.
function residentMrmsGrid(frame) {
  const usable = (grid) => grid?.values?.length > 0 && grid.key === frame.key;
  if (usable(frame.grid)) return frame.grid;
  if (usable(shownRadar?.grid)) return shownRadar.grid;
  const cached = lruGet(mrmsCache, `REFC|${frame.key}`);
  return usable(cached) ? cached : null;
}

function croppedNowcastGrid(raw, frame, bounds) {
  const reduced = cropLatLonGrid(raw, bounds, NOWCAST_GRID_LIMITS);
  reduced.key = frame.key;
  reduced.time = frame.time || raw.time || null;
  reduced.validTime = reduced.time;
  return reduced;
}

// Reduce one scan to the nowcast's working resolution, downloading it only if
// the page does not already hold it. The newest scan is resident, so that one is
// a reduction of an in-memory field with no network at all; older scans reached
// for by the motion fit are named and left to the worker.
async function nowcastSourceGrid(frame, bounds, signal, onProgress) {
  let raw = residentMrmsGrid(frame);
  let ownsRaw = false;
  const cacheKey = `REFC|${frame.key}`;
  if (!raw && mrmsInflight.has(cacheKey)) raw = await mrmsInflight.get(cacheKey);
  if (!raw?.values?.length) {
    raw = await loadMrms('REFC', frame.key, onProgress, signal);
    ownsRaw = true;
  }
  try {
    if (signal?.aborted) {
      const error = new Error('the extrapolation was canceled');
      error.name = 'AbortError';
      throw error;
    }
    return croppedNowcastGrid(raw, frame, bounds);
  } finally {
    // A native CONUS field is close to 100 MB. Release the one this build
    // downloaded itself so constrained devices never retain two at once; a grid
    // borrowed from the frame cache is still backing the observed view and is
    // left untouched.
    if (ownsRaw) raw.values = new Float32Array(0);
  }
}

function nowcastGridMessage(grid) {
  return {
    ni: grid.ni,
    nj: grid.nj,
    lon1: grid.lon1,
    lat1: grid.lat1,
    di: grid.di,
    dj: grid.dj,
    values: grid.values,
    timeMillis: frameTimeMillis(grid),
  };
}

function nowcastForecastFrame(sourceFrame, leadMinutes, grid, motion) {
  const time = Number.isFinite(grid.timeMillis) ? new Date(grid.timeMillis) : null;
  return {
    key: `nowcast:${sourceFrame.key}:+${leadMinutes}`,
    label: `Extrapolated +${leadMinutes} min`,
    time,
    validTime: time,
    forecast: true,
    extrapolated: true,
    leadMinutes,
    sourceLeadMinutes: grid.leadMinutes,
    quality: Number.isFinite(grid.confidence) ? grid.confidence : motion.quality,
    summary: motion.summary,
    method: motion.method,
    grid: {
      proj: 'latlon',
      ni: grid.ni,
      nj: grid.nj,
      lon1: grid.lon1,
      lat1: grid.lat1,
      di: grid.di,
      dj: grid.dj,
      values: grid.values,
      key: `nowcast:${sourceFrame.key}:+${leadMinutes}`,
      time,
      validTime: time,
      forecast: true,
      extrapolated: true,
      leadMinutes,
    },
  };
}

// Run the extrapolation in a module worker, handing each finished lead straight
// to `onForecast`. The older scan is passed by key so the worker downloads and
// decodes it itself. Falls back to running in-page (fetching that scan here and
// yielding between leads so the map keeps painting) if a worker cannot be made.
function runNowcastEngine(request, hooks) {
  const { onMotion, onForecast, isCurrent } = hooks;
  let worker = null;
  try {
    worker = new Worker(new URL('./nowcast.worker.js', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  if (!worker) return runNowcastInPage(request, hooks);

  stopNowcastWorker();
  nowcastWorker = worker;
  return new Promise((resolve, reject) => {
    let motion = null;
    const finish = (action, value) => {
      if (nowcastWorker === worker) stopNowcastWorker();
      else { try { worker.terminate(); } catch {} }
      action(value);
    };
    worker.onmessage = ({ data }) => {
      if (!isCurrent()) { finish(resolve, { canceled: true }); return; }
      if (data.type === 'motion') {
        motion = data;
        onMotion(data);
      } else if (data.type === 'forecast') {
        onForecast(data.index, data.grid, motion);
      } else if (data.type === 'rejected') {
        finish(resolve, { rejected: data.reason || 'the echo field could not be tracked' });
      } else if (data.type === 'error') {
        finish(reject, new Error(data.error));
      } else if (data.type === 'done') {
        finish(resolve, { motion });
      }
    };
    worker.onerror = (event) =>
      finish(reject, new Error(event.message || 'the extrapolation worker crashed'));
    worker.onmessageerror = () =>
      finish(reject, new Error('the extrapolation worker returned an unreadable response'));
    worker.postMessage({ id: 1, ...request });
  });
}

async function runNowcastInPage(request, { onMotion, onForecast, isCurrent }) {
  const { latest, options } = request;
  const priorGrids = [];
  for (const entry of request.history) {
    const grid = entry.grid || await nowcastSourceGrid(
      { key: entry.key, time: new Date(entry.timeMillis) },
      request.bounds,
      null,
    );
    priorGrids.push({
      ...grid,
      time: new Date(grid.timeMillis ?? frameTimeMillis(grid)),
    });
  }
  const prepared = prepareReflectivityNowcast(
    priorGrids,
    { ...latest, time: new Date(latest.timeMillis) },
    options,
  );
  if (!prepared.accepted) {
    return { rejected: prepared.reason || 'the echo field could not be tracked' };
  }
  const motion = {
    summary: prepared.summary,
    quality: prepared.quality,
    method: prepared.method,
    intervalMinutes: prepared.intervalMinutes,
    leadsMinutes: prepared.leadsMinutes,
    leadsTrimmed: prepared.leadsTrimmed,
    scanCount: prepared.scanCount,
    secondOrder: prepared.secondOrder,
  };
  onMotion(motion);
  const stream = advectReflectivityStream(
    prepared.baseGrid, prepared.motion, prepared.leadsMinutes, prepared.config,
  );
  let index = 0;
  for (const forecast of stream) {
    if (!isCurrent()) return { canceled: true };
    // One frame per turn of the event loop, so a slow device still paints and
    // scrolls between leads rather than freezing for the whole set.
    await new Promise((resolve) => setTimeout(resolve, 0));
    onForecast(index++, {
      ni: forecast.ni,
      nj: forecast.nj,
      lon1: forecast.lon1,
      lat1: forecast.lat1,
      di: forecast.di,
      dj: forecast.dj,
      values: forecast.values,
      timeMillis: frameTimeMillis(forecast),
      leadMinutes: forecast.leadMinutes,
      confidence: forecast.confidence,
      uncertaintyKm: forecast.uncertaintyKm,
    }, motion);
  }
  return { motion };
}

function markNowcastUnavailable(reason) {
  nowcastStatus = 'unavailable';
  nowcastSummary = { unavailable: true, reason, text: reason };
  nowcastGeneratedAt = 0;
  // Remember what failed, so panning around or flipping products does not retry
  // the same doomed build (and its download) over and over.
  nowcastFailedKey = `${nowcastSourceKey}|${nowcastRegionKey}`;
  nowcastFailedAt = Date.now();
  applyNowcastFrames([]);
}

// Build (or rebuild) the extrapolated tail of the reflectivity timeline. The
// observed frames are already on screen and are never touched by this, so a
// failure here costs the user nothing and a success simply extends the scrubber.
async function buildNowcast(token, bounds, regionKey) {
  const observed = observedRadarFrames();
  const latest = observed[observed.length - 1];
  if (!latest) return;
  nowcastSourceKey = latest.key;
  nowcastRegionKey = regionKey;
  nowcastGeneratedAt = 0;
  nowcastSummary = null;

  const latestAgeMinutes = (Date.now() - frameTimeMillis(latest)) / 60000;
  if (!(latestAgeMinutes <= NOWCAST_MAX_SOURCE_AGE_MINUTES)) {
    markNowcastUnavailable(`latest scan is ${Math.round(latestAgeMinutes)} minutes old`);
    return;
  }
  // Scans older than the timeline shows are still fair game for the motion fit.
  const searchable = mrmsHistoryCatalog.length ? mrmsHistoryCatalog : observed;
  const history = nowcastHistoryFrames(searchable, latest);
  if (!history.length) {
    markNowcastUnavailable('not enough recent scan history');
    return;
  }

  nowcastStatus = 'building';
  publishRadarFrames();

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  nowcastAbortController = controller;
  let latestGrid;
  try {
    // The newest scan is already decoded for the observed view, so this is just a
    // crop. The older one is left to the worker, which fetches and decodes it
    // without the page ever touching a native CONUS field.
    latestGrid = await nowcastSourceGrid(latest, bounds, controller?.signal);
  } catch (error) {
    if (!nowcastJobIsCurrent(token)) return;
    markNowcastUnavailable(error?.name === 'AbortError'
      ? 'the extrapolation was canceled'
      : `the latest scan could not be prepared: ${error.message}`);
    return;
  } finally {
    if (nowcastAbortController === controller) nowcastAbortController = null;
  }
  if (!nowcastJobIsCurrent(token)) return;

  const buildNow = Date.now();
  // Leads are counted from now rather than from the scan time, so "+3 min" is
  // three minutes away for the user, not three minutes after a scan that landed
  // two minutes ago.
  const sourceAgeMinutes = Math.max(0, (buildNow - frameTimeMillis(latest)) / 60000);
  const advectionLeads = NOWCAST_DISPLAY_LEADS_MINUTES.map((lead) => lead + sourceAgeMinutes);
  // Existing frames stay on the timeline until the replacements are complete, so
  // a rebuild (a pan, say) never makes the future half of the scrubber flicker.
  const replacing = nowcastFrames.length > 0;
  const pending = [];
  let motionInfo = null;

  // Any earlier scan that happens to be decoded already (the user animated the
  // timeline, say) is cropped here, skipping the worker's download entirely. The
  // rest are named and left for the worker to fetch, so the page never touches a
  // native CONUS field.
  const historyMessages = history.map((frame) => {
    const resident = residentMrmsGrid(frame);
    return {
      key: frame.key,
      timeMillis: frameTimeMillis(frame),
      grid: resident
        ? nowcastGridMessage(croppedNowcastGrid(resident, frame, bounds))
        : null,
    };
  });

  const outcome = await runNowcastEngine({
    latest: nowcastGridMessage(latestGrid),
    history: historyMessages,
    bounds,
    limits: NOWCAST_GRID_LIMITS,
    options: {
      now: buildNow,
      ...NOWCAST_GRID_LIMITS,
      maxAgeMinutes: NOWCAST_MAX_SOURCE_AGE_MINUTES,
      leadsMinutes: advectionLeads,
    },
  }, {
    isCurrent: () => nowcastJobIsCurrent(token),
    onMotion: (motion) => {
      motionInfo = motion;
      nowcastSummary = motion.summary;
      if (!replacing) publishRadarFrames();
    },
    onForecast: (index, grid, motion) => {
      const leadMinutes = NOWCAST_DISPLAY_LEADS_MINUTES[index];
      if (!Number.isFinite(leadMinutes)) return;
      const frame = nowcastForecastFrame(
        latest, leadMinutes, grid, motion || motionInfo || { quality: 0 },
      );
      if (frameTimeMillis(frame) <= Date.now()) return;
      if (replacing) pending.push(frame);
      else applyNowcastFrames(nowcastFrames.concat(frame));
    },
  });

  if (!nowcastJobIsCurrent(token) || outcome?.canceled) return;
  if (outcome?.rejected) {
    markNowcastUnavailable(outcome.rejected);
    return;
  }
  if (replacing) applyNowcastFrames(pending);
  if (!nowcastFrames.length) {
    markNowcastUnavailable('no extrapolated frame has a future valid time');
    return;
  }
  nowcastStatus = 'ready';
  nowcastGeneratedAt = Date.now();
  publishRadarFrames();
}

function queuedNowcast(token, bounds, regionKey) {
  if (
    nowcastInflightPromise &&
    nowcastInflightToken === token &&
    nowcastInflightRegionKey === regionKey
  ) {
    return nowcastInflightPromise;
  }
  const previous = nowcastInflightPromise;
  const task = (async () => {
    if (previous) {
      try { await previous; } catch {}
    }
    if (!nowcastJobIsCurrent(token)) return;
    await buildNowcast(token, bounds, regionKey);
  })();
  nowcastInflightPromise = task;
  nowcastInflightToken = token;
  nowcastInflightRegionKey = regionKey;
  task.finally(() => {
    if (nowcastInflightPromise === task) {
      nowcastInflightPromise = null;
      nowcastInflightToken = -1;
      nowcastInflightRegionKey = null;
    }
  }).catch((error) => {
    if (nowcastJobIsCurrent(token)) markNowcastUnavailable(error.message);
    console.warn('Radar extrapolation unavailable', error);
  });
  return task;
}

// Extend the reflectivity timeline into the future once its observed frames are
// on screen. Deliberately not awaited by the caller: the radar is already
// usable, and the extrapolation only ever adds to the end of the timeline.
function scheduleNowcast() {
  if (!nowcastProduct() || !radarVisible || !radarFrames.length) return;
  const bounds = NOWCAST_DOMAIN;
  const regionKey = NOWCAST_REGION_KEY;
  const latest = observedRadarFrames().at(-1);
  if (!latest) return;

  const reusable = reusableNowcastFrames(latest.key, regionKey);
  if (reusable) {
    if (reusable.length !== nowcastFrames.length || radarFrames.length === radarObservedCount) {
      applyNowcastFrames(reusable);
    }
    nowcastStatus = 'ready';
    return;
  }
  if (
    nowcastInflightPromise &&
    nowcastInflightRegionKey === regionKey &&
    nowcastSourceKey === latest.key
  ) return;
  // The same scan over the same area already failed a moment ago; leave the
  // "unavailable" note in place instead of grinding through it again.
  if (
    nowcastFailedKey === `${latest.key}|${regionKey}` &&
    Date.now() - nowcastFailedAt < 60_000
  ) return;

  // A newer source scan means the frames in hand are stale. Moving the map no
  // longer does: the build already covers everywhere it could be moved to.
  invalidateNowcastBuild();
  const token = nowcastBuildSequence;
  queuedNowcast(token, bounds, regionKey);
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
          emitStatus('satellite', 'processing', `Processing ${source.label}`, progress);
      },
      bbox
    );
    scene._sourceKey = sourceKey;
  } else {
    await ensureBandsAsync(scene, source.satKey, source.sectorKey, bandsFor(decoderId));
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
    SATELLITE_SOURCES[satelliteSourceKey].label,
    1
  );
  satelliteHooks.onFrame?.({ kind: 'satellite', ...satelliteResult() });
  return satelliteResult();
}

export async function loadRadar({
  map,
  beforeId = null,
  location,
  mode = 'mrms',
  productKey = 'refl',
  siteId = null,
  resetToLatest = false,
  onStatus,
  onFrame,
} = {}) {
  radarHooks = { onStatus, onFrame };
  activeMap = map || activeMap;
  anchorId = beforeId || anchorId;
  radarVisible = true;
  const requestedMode = mode === 'single' ? 'single' : 'mrms';
  const previousMode = radarMode;
  const previousProduct = radarProductKey;
  const requestedProduct =
    requestedMode === 'mrms'
      ? (MRMS_RADAR_PRODUCTS[productKey] ? productKey : 'refl')
      : (RADAR_PRODUCTS[productKey] ? productKey : 'nexrad_ref');
  const contextChanged =
    requestedMode !== previousMode || requestedProduct !== previousProduct;
  radarMode = requestedMode;
  radarProductKey = requestedProduct;
  const sequence = ++radarSequence;
  if (contextChanged) {
    invalidateNowcastBuild();
    radarFrames = [];
    radarFrameIndex = -1;
    radarFrameMeta = null;
    radarObservedCount = 0;
    shownRadar = null;
    // Frames from the previous product are gone, but a still-valid extrapolation
    // of the same source scan is kept so switching back is instant.
    if (!nowcastProduct(requestedProduct)) {
      nowcastStatus = 'idle';
      nowcastSummary = null;
    }
    radarHooks.onFrame?.({ kind: 'radar', ...radarResult() });
  }

  if (radarMode === 'mrms') {
    radarSite = null;
    radarLayer?.clear();
    const product = MRMS_RADAR_PRODUCTS[radarProductKey];
    if (contextChanged || resetToLatest || !radarFrames.length || shownRadar?.mode !== 'mrms') {
      emitStatus('radar', 'listing', `Finding recent MRMS ${product.label} frames`, null);
      const frames = await recentMrmsFrames(
        product.decoderId, MAX_RADAR_FRAMES + NOWCAST_HISTORY_FRAMES,
      );
      if (sequence !== radarSequence) return radarResult();
      mrmsHistoryCatalog = frames;
      const observed = frames.slice(-MAX_RADAR_FRAMES);
      radarObservedCount = observed.length;
      // A build that still describes the newest scan is put straight back on the
      // timeline; otherwise the tail starts out empty and fills in behind the
      // observed frames.
      const reusable = product.nowcast
        ? reusableNowcastFrames(observed.at(-1)?.key, NOWCAST_REGION_KEY)
        : null;
      nowcastFrames = reusable || [];
      radarFrames = observed.concat(nowcastFrames);
      radarFrameIndex = Math.max(0, radarObservedCount - 1);
    }
    if (!radarFrames.length) throw new Error(`No recent MRMS ${product.label} frames were found`);
    if (!radarObservedCount) radarObservedCount = radarFrames.length;
    const latestObservedIndex = Math.max(0, radarObservedCount - 1);
    const targetIndex = contextChanged || resetToLatest || radarFrameIndex < 0
      ? latestObservedIndex
      : Math.min(radarFrameIndex, radarFrames.length - 1);
    const shown = await showMrmsRadar(targetIndex, sequence);
    // Deliberately not awaited: the observed radar is already on the map, and the
    // extrapolated frames append themselves to the timeline as they finish.
    if (product.nowcast && sequence === radarSequence) {
      scheduleNowcast();
    }
    // Likewise not awaited — the rest of the loop fills in behind the frame
    // that is already drawn.
    if (sequence === radarSequence) warmRadarFrames(sequence, radarFrames[targetIndex]?.key);
    return shown;
  }

  radarObservedCount = 0;
  mrmsHistoryCatalog = [];
  nowcastFrames = [];
  nowcastStatus = 'idle';
  mrmsLayer?.clear();
  const requestedSite = String(siteId || '').toUpperCase();
  const selected =
    RADARS.find((site) => site[0] === requestedSite) ||
    nearestSite(Number(location?.lat), Number(location?.lon));
  if (!selected) throw new Error('No NEXRAD site is available for this location');
  const siteChanged =
    radarSite?.[0] !== selected[0] ||
    previousMode !== 'single' ||
    shownRadar?.mode === 'mrms';
  if (siteChanged && radarFrames.length) {
    radarFrames = [];
    radarFrameIndex = -1;
    radarFrameMeta = null;
    radarHooks.onFrame?.({ kind: 'radar', ...radarResult() });
  }
  radarSite = selected;
  if (siteChanged || resetToLatest || !radarFrames.length) {
    emitStatus('radar', 'listing', `Finding recent ${selected[0]} scans`, null);
    let volumes = await listVolumes(selected[0], new Date());
    if (!volumes.length) volumes = await listVolumes(selected[0], new Date(Date.now() - 86400000));
    if (sequence !== radarSequence) return radarResult();
    radarFrames = volumes.slice(-MAX_RADAR_FRAMES);
    radarFrameIndex = radarFrames.length - 1;
  }
  if (!radarFrames.length) throw new Error(`No recent ${selected[0]} Level II scans were found`);
  const targetIndex = contextChanged || siteChanged || resetToLatest || radarFrameIndex < 0
    ? radarFrames.length - 1
    : Math.min(radarFrameIndex, radarFrames.length - 1);
  const shown = await showRadar(targetIndex, sequence);
  if (sequence === radarSequence) warmRadarFrames(sequence, radarFrames[targetIndex]?.key);
  return shown;
}

export function showRadarFrame(index) {
  return showRadar(index);
}

/**
 * Drop any extrapolated frame whose valid time has passed, and rebuild the tail
 * if a newer scan has landed. Cheap to call on every map idle: the build covers
 * the whole domain, so moving the map alone never triggers one.
 */
export function refreshNowcast() {
  if (!radarVisible || !nowcastProduct() || !radarFrames.length) return;
  const usable = futureNowcastFrames();
  if (usable.length !== nowcastFrames.length) applyNowcastFrames(usable);
  scheduleNowcast();
}

export function nowcastState() {
  return {
    supported: nowcastProduct(),
    status: nowcastStatus,
    frameCount: nowcastFrames.length,
    observedCount: radarObservedCount,
    leadsMinutes: [...NOWCAST_DISPLAY_LEADS_MINUTES],
    summary: nowcastSummary,
    generatedAt: nowcastGeneratedAt || null,
  };
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
  satelliteHooks = { onStatus, onFrame };
  activeMap = map || activeMap;
  anchorId = beforeId || anchorId;
  satelliteVisible = true;
  const source = satelliteConfig(sourceKey);
  productDecoderId(productKey);
  const sourceChanged = sourceKey !== satelliteSourceKey;
  const productChanged = productKey !== satelliteProductKey;
  satelliteSourceKey = sourceKey;
  satelliteProductKey = productKey;
  satelliteDecodeBBox = normalizeDecodeBBox(sourceKey, location);
  const sequence = ++satelliteSequence;

  if (sourceChanged || productChanged) {
    satelliteFrames = [];
    satelliteFrameIndex = -1;
    satelliteFrameMeta = null;
    satelliteScene = null;
    satelliteHooks.onFrame?.({ kind: 'satellite', ...satelliteResult() });
  }
  if (sourceChanged || productChanged || !satelliteFrames.length) {
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
  const targetIndex = sourceChanged || productChanged || satelliteFrameIndex < 0
    ? satelliteFrames.length - 1
    : Math.min(satelliteFrameIndex, satelliteFrames.length - 1);
  return showSatellite(targetIndex, sequence);
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
  const nextRadarVisible = Boolean(radar);
  const nextSatelliteVisible = Boolean(satellite);
  if (radarVisible && !nextRadarVisible) {
    radarSequence++;
    invalidateNowcastBuild();
  }
  if (satelliteVisible && !nextSatelliteVisible) satelliteSequence++;
  radarVisible = nextRadarVisible;
  satelliteVisible = nextSatelliteVisible;
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

// What is under a click: the product, the value there, and when it was valid.
// Nothing about how the field was fetched or decoded — the popup is a readout,
// not a provenance note.
export function sampleRadar(lon, lat) {
  const shown = shownRadar;
  if (!shown || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (shown.mode === 'mrms') {
    const { grid, productInfo } = shown;
    const col = Math.round((lon - grid.lon1) / grid.di);
    const row = Math.round((grid.lat1 - lat) / grid.dj);
    if (col < 0 || col >= grid.ni || row < 0 || row >= grid.nj) return { noData: true };
    const index = row * grid.ni + col;
    const forecast = Boolean(shown.forecast?.forecast);
    const base = {
      site: '',
      product: productInfo.label,
      forecast,
      leadMinutes: forecast ? Number(shown.forecast?.leadMinutes) || 0 : 0,
      time: shown.forecast?.time || grid.time || null,
    };
    if (shown.product.categorical) {
      const reading = precipTypeReading(grid, index);
      if (!reading) return { noData: true };
      return { ...base, precipType: reading.type, value: reading.rate, unit: reading.unit, dec: 2 };
    }
    const native = grid.values[index];
    if (!Number.isFinite(native)) return { noData: true };
    return {
      ...base,
      value: native * (shown.product.dispFactor || 1) + (shown.product.dispOffset || 0),
      unit: productInfo.unit,
      dec: productInfo.unit === 'in' || productInfo.unit === 'in/hr' ? 2 : 0,
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
    site: radarSite?.[0] || '',
    product: productInfo.label,
    unit: productInfo.unit,
    value,
    dec: decimals,
    forecast: false,
    leadMinutes: 0,
    time: radarFrameMeta?.time || null,
    elevation: sweep.elevation,
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
    ensureMrmsLayer(activeMap, anchorId, product).setGrid(shownRadar.grid, product);
  } else {
    ensureRadarLayer(activeMap, anchorId).setSweep(shownRadar.sweep, product, shownRadar.site);
  }
}

export function applyRadarPalette({ mode = radarMode, productKey = radarProductKey, text, name = 'Custom palette' } = {}) {
  const product = radarProduct(mode, productKey);
  // A banded product's colour table is three ramps whose edges carry meaning,
  // so a single-ramp .pal cannot replace it.
  if (!product || product.categorical) throw new Error('This radar product does not support custom color tables');
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

// The single ramp + range a legend draws. Banded products have no single ramp,
// so they report none and the page falls back to their own multi-ramp key.
export function radarPalette(mode = radarMode, productKey = radarProductKey) {
  const product = radarProduct(mode, productKey);
  if (!product?.scale?.rgba || product.categorical) return null;
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
