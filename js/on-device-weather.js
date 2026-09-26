// Browser-native radar and satellite controller.
//
// Raw NEXRAD Level II and GOES/Himawari files are fetched from the public
// CORS-enabled NOAA/Unidata buckets. Binary parsing and decompression happen in
// module Web Workers; only decoded typed arrays and ready-to-upload textures
// reach the page.

import { listVolumes, fetchVolume, nearestSite, RADARS } from './s3.js';
import { PRODUCTS, makeScale, parsePal } from './products.js';
import { createRadarLayer } from './radarLayer.js';
import { dealiasVelocitySweep } from './dealias.js';
import { MRMS_PRODUCTS, listMrms, loadMrms, precipTypeReading } from './mrms.js';
import { createGridLayer, prepareGridTexture } from './gridLayer.js';
import { SATELLITES, SECTORS, listScenes } from './goes.js';
import {
  loadSatelliteFrameAsync,
  clearSceneCache,
  cancelInFlightSatelliteDecode,
} from './satClient.js';
import { bandsFor } from './satProducts.js';
import { createSatelliteLayer } from './satelliteLayer.js';

export const RADAR_PRODUCTS = {
  nexrad_ref: { decoderId: 'REF', label: 'Reflectivity', unit: 'dBZ' },
  nexrad_vel: { decoderId: 'VEL', label: 'Velocity', unit: 'kt' },
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
const MRMS_CACHE_MAX = constrained ? 2 : 12;
const MRMS_PREPARED_CACHE_MAX = constrained ? 12 : 18;
// Level II volumes are an order of magnitude larger than an MRMS grid, so those
// are warmed through the byte cache and decoded on demand.
const RADAR_WARM_LIMIT = constrained ? 0 : 6;

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
// Rendering follows a latest-wins queue. A range input can emit several events
// before one large weather file has decoded; starting all of them at once turns
// a scrub into competing downloads/decodes. Keep the current job, retain only
// the newest pending index, and let stale jobs finish quietly into the cache.
let radarFrameRequest = null;
let radarFrameDrain = null;
const radarCache = new Map();
const radarInflight = new Map();
const mrmsCache = new Map();
const mrmsInflight = new Map();
const mrmsPreparedCache = new Map();

const defaultColorTables = new WeakMap();

let satelliteSequence = 0;
let satelliteSourceKey = null;
let satelliteProductKey = null;
let satelliteFrames = [];
let satelliteFrameIndex = -1;
let satelliteFrameMeta = null;
let satelliteDecodeBBox = null;
const satelliteCache = new Map();
const satelliteInflight = new Map();
// Foreground selections and low-priority look-ahead share one drain. Keeping
// them on the same lane prevents an idle prefetch from starting a second large
// satellite decode while a user is scrubbing the timeline.
let satelliteFrameRequest = null;
let satelliteWarmRequest = null;
let satelliteActiveWarm = null;
let satelliteFrameDrain = null;
let satelliteWarmToken = 0;
let cancelSatelliteWarmCallback = null;

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
    })),
    index: radarFrameIndex,
    frame: radarFrameMeta,
    mode: radarMode,
    productKey: radarProductKey,
    site: radarSite
      ? { id: radarSite[0], name: radarSite[1], lat: radarSite[2], lon: radarSite[3] }
      : null,
    product,
  };
}

function queueRadarFrame(index, sequence = ++radarSequence) {
  return new Promise((resolve, reject) => {
    const request = { index, sequence, waiters: [{ resolve, reject }] };
    // A pending request has not touched the network yet. Fold its callers into
    // the latest request rather than decoding every intermediate slider value.
    if (radarFrameRequest) request.waiters.unshift(...radarFrameRequest.waiters);
    radarFrameRequest = request;
    if (!radarFrameDrain) drainRadarFrameRequests();
  });
}

function drainRadarFrameRequests() {
  if (radarFrameDrain) return;
  radarFrameDrain = (async () => {
    while (radarFrameRequest) {
      const request = radarFrameRequest;
      radarFrameRequest = null;
      let result;
      let error = null;
      try {
        // A newer selection made this request obsolete before it started.
        result = request.sequence === radarSequence
          ? await renderRadarFrame(request.index, request.sequence)
          : radarResult();
      } catch (caught) {
        // Never surface an error from a request the user has already replaced.
        if (request.sequence === radarSequence) error = caught;
        else result = radarResult();
      }
      for (const waiter of request.waiters) {
        if (error) waiter.reject(error);
        else waiter.resolve(result);
      }
    }
  })().finally(() => {
    radarFrameDrain = null;
    // A request can arrive between the loop's final check and this callback.
    if (radarFrameRequest) drainRadarFrameRequests();
  });
}

async function renderRadarFrame(index, sequence) {
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
  let sweep = pickSweep(volume, productInfo.decoderId);
  if (!sweep) throw new Error(`${productInfo.label} is unavailable in this volume`);
  if (productInfo.decoderId === 'VEL') sweep = dealiasVelocitySweep(sweep);
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

function preparedMrmsFrame(frame, decoderId, grid, product) {
  const cacheKey = `${decoderId}|${frame.key}`;
  let prepared = lruGet(mrmsPreparedCache, cacheKey);
  if (!prepared && grid?.values?.length) {
    prepared = prepareGridTexture(grid, product, { packed: true });
    lruSet(mrmsPreparedCache, cacheKey, prepared, MRMS_PREPARED_CACHE_MAX);
  }
  return prepared;
}

async function showMrmsRadar(index, sequence = ++radarSequence) {
  const productInfo = MRMS_RADAR_PRODUCTS[radarProductKey];
  const product = productInfo && MRMS_PRODUCTS[productInfo.decoderId];
  const frame = radarFrames[Math.max(0, Math.min(radarFrames.length - 1, Number(index)))];
  if (!frame || !product) throw new Error('No raw MRMS frame is available');
  radarFrameIndex = radarFrames.indexOf(frame);
  const cacheKey = `${productInfo.decoderId}|${frame.key}`;
  let grid = lruGet(mrmsCache, cacheKey);
  let prepared = lruGet(mrmsPreparedCache, cacheKey);
  if (!grid && !prepared) {
    grid = await decodedMrmsFrame(frame, productInfo.decoderId, (progress) => {
        if (sequence === radarSequence)
          emitStatus('radar', 'processing', 'Processing radar', progress);
      });
  }
  if (sequence !== radarSequence) return radarResult();
  prepared = prepared || preparedMrmsFrame(frame, productInfo.decoderId, grid, product);
  radarFrameMeta = {
    key: frame.key,
    time: frame.time || grid?.time || null,
  };
  if (radarVisible && activeMap) {
    radarLayer?.clear();
    const layer = ensureMrmsLayer(activeMap, anchorId, product);
    if (prepared) layer.showPrepared(prepared);
    else layer.setGrid(grid, product);
  }
  shownRadar = {
    mode: 'mrms',
    productKey: radarProductKey,
    grid: grid || null,
    product,
    productInfo,
  };
  emitStatus('radar', 'ready', `${productInfo.label} · MRMS`, 1);
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
   time. Every step re-checks the loaded timeline context, so switching product,
   mode, site or tab abandons the warm immediately without treating each normal
   playback tick as a new timeline.
   ────────────────────────────────────────────────────────────────────────── */
let warmSequence = 0;

function idle(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function radarWarmContext() {
  return {
    mode: radarMode,
    productKey: radarProductKey,
    siteId: radarSite?.[0] || '',
    frameKeys: radarFrames.map((frame) => frame?.key || '').join('|'),
  };
}

// Warm the observed frames behind `skipKey` for whichever radar path is active.
// Fire-and-forget: failures are the same "this frame is unavailable" the
// foreground path already tolerates. Its lifetime deliberately follows the
// timeline context, not radarSequence: radarSequence changes for each slider or
// playback selection, and used to stop warming after the first animation frame.
function warmRadarFrames(context, skipKey) {
  const token = ++warmSequence;
  const current = () => {
    const now = radarWarmContext();
    return token === warmSequence &&
      radarVisible &&
      now.mode === context.mode &&
      now.productKey === context.productKey &&
      now.siteId === context.siteId &&
      now.frameKeys === context.frameKeys;
  };
  const waitForForeground = async () => {
    while (radarFrameDrain || radarFrameRequest) {
      await idle(40);
      if (!current()) return false;
    }
    return current();
  };
  (async () => {
    // Give the frame on screen a clear run at the network first.
    await idle(250);
    if (!current()) return;

    // Newest first: that is the order a user scrubs backwards through.
    const observed = radarFrames
      .filter((frame) => frame && frame.key !== skipKey)
      .reverse();
    if (!observed.length) return;

    if (radarMode === 'mrms') {
      const decoderId = MRMS_RADAR_PRODUCTS[radarProductKey]?.decoderId;
      const product = MRMS_PRODUCTS[decoderId];
      if (!decoderId || !product) return;
      for (const frame of observed) {
        if (!current()) return;
        if (!await waitForForeground()) return;
        // Silent: warming must never write over the status line describing the
        // frame the user is looking at.
        const grid = await decodedMrmsFrame(frame, decoderId, null, { quiet: true }).catch(() => null);
        if (grid) {
          preparedMrmsFrame(frame, decoderId, grid, product);
          // Compact prepared frames are the phone playback cache. Drop the
          // much larger decoded field once it has been packed; the compressed
          // response bytes were already transient and are no longer retained.
          if (constrained && frame.key !== skipKey) mrmsCache.delete(`${decoderId}|${frame.key}`);
        }
        await idle(0);
      }
      return;
    }

    for (const frame of observed.slice(0, RADAR_WARM_LIMIT)) {
      if (!current()) return;
      if (!await waitForForeground()) return;
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

async function prepareSatelliteFrame(
  sourceKey,
  productKey,
  frame,
  bbox,
  sequence,
  { quiet = false, cache = true, shouldCache = null } = {},
) {
  const cacheKey = satelliteCacheKey(sourceKey, productKey, frame.key, bbox);
  const cached = lruGet(satelliteCache, cacheKey);
  if (cached) return cached;
  if (satelliteInflight.has(cacheKey)) return satelliteInflight.get(cacheKey);
  const source = satelliteConfig(sourceKey);
  const decoderId = productDecoderId(productKey);
  const task = (async () => {
    if (!quiet) emitStatus('satellite', 'downloading', `Downloading ${source.label}`, 0);
    const rendered = await loadSatelliteFrameAsync(
      source.satKey,
      source.sectorKey,
      frame.key,
      bandsFor(decoderId),
      decoderId,
      (progress) => {
        if (!quiet && sequence === satelliteSequence)
          emitStatus('satellite', 'processing', `Processing ${source.label}`, progress);
      },
      bbox,
      { cache },
    );
    const { meta, rgba } = rendered;
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
    const payload = {
      meta,
      rgba,
      bbox: bbox || rendered.bbox,
      visibleSamples,
      maxSample,
    };
    // A look-ahead may finish after its source/product has been replaced. Its
    // pixels are still a valid result for any foreground caller sharing this
    // request, but must not displace a newer active image in the LRU.
    if (!shouldCache || shouldCache()) {
      lruSet(satelliteCache, cacheKey, payload, SATELLITE_CACHE_MAX);
    }
    return payload;
  })();
  satelliteInflight.set(cacheKey, task);
  task.finally(() => {
    // A canceled warm can be replaced by a new foreground request for the same
    // frame. Do not let the older task erase that newer in-flight entry.
    if (satelliteInflight.get(cacheKey) === task) satelliteInflight.delete(cacheKey);
  }).catch(() => {});
  return task;
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

function cancelSatelliteWarm() {
  satelliteWarmToken++;
  // A queued warm job has not started decoding yet, so drop it immediately.
  // An already-running warm job is allowed to finish on the shared lane; its
  // token makes its output ineligible for the cache after cancellation.
  satelliteWarmRequest = null;
  if (cancelSatelliteWarmCallback) {
    cancelSatelliteWarmCallback();
    cancelSatelliteWarmCallback = null;
  }
}

function scheduleSatelliteLookAhead(index) {
  cancelSatelliteWarm();
  // A constrained device intentionally has room for only the visible RGBA
  // image. Do not evict that image just to stage a successor; the foreground
  // decode remains the better tradeoff there.
  if (satelliteFrames.length < 2 || SATELLITE_CACHE_MAX < 2) return;
  const token = satelliteWarmToken;
  const sourceKey = satelliteSourceKey;
  const productKey = satelliteProductKey;
  const frameKeys = satelliteFrames.map((frame) => frame?.key || '').join('|');
  const target = satelliteFrames[(index + 1) % satelliteFrames.length];
  if (!target) return;

  const current = () =>
    token === satelliteWarmToken &&
    satelliteVisible &&
    satelliteSourceKey === sourceKey &&
    satelliteProductKey === productKey &&
    satelliteFrameIndex === index &&
    satelliteFrames.map((frame) => frame?.key || '').join('|') === frameKeys;
  const run = () => {
    cancelSatelliteWarmCallback = null;
    if (!current()) return;
    // Retain the visible frame and exactly one successor in the existing LRU.
    // That makes a looping animation smooth without increasing the timeline or
    // keeping all ten full-resolution RGBA images resident at once.
    queueSatelliteWarm({
      sourceKey,
      productKey,
      target,
      bbox: satelliteDecodeBBox,
      sequence: satelliteSequence,
      isCurrent: current,
    });
  };

  // Let the foreground image paint before touching the next large source file.
  // `requestIdleCallback` naturally gives panning, zooming and input priority;
  // the bounded timeout still warms a frame on browsers without idle callbacks.
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run, { timeout: 1000 });
    cancelSatelliteWarmCallback = () => {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(id);
    };
  } else {
    const id = setTimeout(run, 350);
    cancelSatelliteWarmCallback = () => clearTimeout(id);
  }
}

function queueSatelliteWarm(request) {
  if (!request.isCurrent()) return;
  // A later displayed frame supersedes any not-yet-started look-ahead. The
  // foreground queue is always taken first by the shared drain below.
  satelliteWarmRequest = request;
  if (!satelliteFrameDrain) drainSatelliteFrameRequests();
}

function preemptActiveSatelliteWarm() {
  const activeWarm = satelliteActiveWarm;
  const activeWarmKey = activeWarm && satelliteCacheKey(
    activeWarm.sourceKey,
    activeWarm.productKey,
    activeWarm.target.key,
    activeWarm.bbox,
  );
  const activeWarmTask = activeWarmKey ? satelliteInflight.get(activeWarmKey) : null;
  cancelSatelliteWarm();
  // Only an idle look-ahead may be preempted. The shared drain never marks a
  // foreground render as `satelliteActiveWarm`, so a user-requested frame is
  // never canceled by another scrub event.
  if (activeWarm && cancelInFlightSatelliteDecode() &&
      satelliteInflight.get(activeWarmKey) === activeWarmTask) {
    // Remove the rejected warm promise now so an immediately-following request
    // for the same frame starts fresh instead of inheriting that cancellation.
    // The task's own identity check in prepareSatelliteFrame cannot erase a
    // replacement entry later.
    satelliteInflight.delete(activeWarmKey);
  }
}

function queueSatelliteFrame(index, sequence = ++satelliteSequence) {
  preemptActiveSatelliteWarm();
  return new Promise((resolve, reject) => {
    const request = { index, sequence, waiters: [{ resolve, reject }] };
    if (satelliteFrameRequest) request.waiters.unshift(...satelliteFrameRequest.waiters);
    satelliteFrameRequest = request;
    if (!satelliteFrameDrain) drainSatelliteFrameRequests();
  });
}

function drainSatelliteFrameRequests() {
  if (satelliteFrameDrain) return;
  satelliteFrameDrain = (async () => {
    while (satelliteFrameRequest || satelliteWarmRequest) {
      // A user-selected frame always wins over idle prefetch work.
      if (satelliteFrameRequest) {
        const request = satelliteFrameRequest;
        satelliteFrameRequest = null;
        let result;
        let error = null;
        try {
          result = request.sequence === satelliteSequence
            ? await renderSatelliteFrame(request.index, request.sequence)
            : satelliteResult();
        } catch (caught) {
          if (request.sequence === satelliteSequence) error = caught;
          else result = satelliteResult();
        }
        for (const waiter of request.waiters) {
          if (error) waiter.reject(error);
          else waiter.resolve(result);
        }
        continue;
      }

      const warm = satelliteWarmRequest;
      satelliteWarmRequest = null;
      if (!warm?.isCurrent()) continue;
      satelliteActiveWarm = warm;
      try {
        await prepareSatelliteFrame(
          warm.sourceKey,
          warm.productKey,
          warm.target,
          warm.bbox,
          warm.sequence,
          { quiet: true, cache: false, shouldCache: warm.isCurrent },
        );
      } catch {
        // Look-ahead is optional. Foreground requests surface their own errors.
      } finally {
        if (satelliteActiveWarm === warm) satelliteActiveWarm = null;
      }
    }
  })().finally(() => {
    satelliteFrameDrain = null;
    if (satelliteFrameRequest || satelliteWarmRequest) drainSatelliteFrameRequests();
  });
}

async function renderSatelliteFrame(index, sequence) {
  const frame =
    satelliteFrames[Math.max(0, Math.min(satelliteFrames.length - 1, Number(index)))];
  if (!frame) throw new Error('No raw satellite frame is available');
  satelliteFrameIndex = satelliteFrames.indexOf(frame);
  const sourceKey = satelliteSourceKey;
  const productKey = satelliteProductKey;
  const cacheStillCurrent = () =>
    sequence === satelliteSequence &&
    satelliteVisible &&
    satelliteSourceKey === sourceKey &&
    satelliteProductKey === productKey;
  const payload = await prepareSatelliteFrame(
    sourceKey,
    productKey,
    frame,
    satelliteDecodeBBox,
    sequence,
    { shouldCache: cacheStillCurrent },
  );
  if (sequence !== satelliteSequence) return satelliteResult();
  // A foreground caller can have joined an in-flight look-ahead whose original
  // warm context was superseded. Promote this now-visible result back into the
  // LRU, while stale background-only results remain discarded above.
  lruSet(
    satelliteCache,
    satelliteCacheKey(satelliteSourceKey, satelliteProductKey, frame.key, satelliteDecodeBBox),
    payload,
    SATELLITE_CACHE_MAX,
  );
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
  scheduleSatelliteLookAhead(satelliteFrameIndex);
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

  // Which single-site scan list the request lands on has to be known before the
  // frames are thrown away, because a product switch inside one site keeps them.
  const requestedSite = String(siteId || '').toUpperCase();
  const selectedSite =
    requestedMode === 'single'
      ? RADARS.find((site) => site[0] === requestedSite) ||
        nearestSite(Number(location?.lat), Number(location?.lon))
      : null;
  if (requestedMode === 'single' && !selectedSite)
    throw new Error('No NEXRAD site is available for this location');
  const siteChanged =
    requestedMode === 'single' &&
    (previousMode !== 'single' ||
      radarSite?.[0] !== selectedSite[0] ||
      shownRadar?.mode === 'mrms');
  // Every moment of a scan — reflectivity, velocity, ρHV, all of them — comes
  // out of the *same* Level II volume, so switching product inside one site
  // changes which moment is read, not which files exist. Wiping the timeline
  // and re-listing the site's whole day from S3 for that was what made a
  // product switch look like it had not registered: the scrubber emptied, the
  // old sweep stayed on screen, and nothing replaced it until the listing
  // finally came back (or until the product was picked a second time, by which
  // point the browser had the listing cached). Keeping the frames means the new
  // moment is drawn from the volume already in the cache, immediately.
  const keepSingleTimeline =
    requestedMode === 'single' && contextChanged && !siteChanged && radarFrames.length > 0;

  if (contextChanged && !keepSingleTimeline) {
    radarFrames = [];
    radarFrameIndex = -1;
    radarFrameMeta = null;
    shownRadar = null;
    radarHooks.onFrame?.({ kind: 'radar', ...radarResult() });
  } else if (contextChanged) {
    // The timeline survives; only what is drawn from it is stale. Re-announce it
    // so the page relabels the scrubber for the new product without blanking it.
    radarFrameMeta = null;
    shownRadar = null;
    radarHooks.onFrame?.({ kind: 'radar', ...radarResult() });
  }

  if (radarMode === 'mrms') {
    radarSite = null;
    radarLayer?.clear();
    const product = MRMS_RADAR_PRODUCTS[radarProductKey];
    if (contextChanged || resetToLatest || !radarFrames.length || shownRadar?.mode !== 'mrms') {
      emitStatus('radar', 'listing', `Finding recent MRMS ${product.label} frames`, null);
      const frames = await recentMrmsFrames(product.decoderId, MAX_RADAR_FRAMES);
      if (sequence !== radarSequence) return radarResult();
      radarFrames = frames;
      radarFrameIndex = Math.max(0, radarFrames.length - 1);
    }
    if (!radarFrames.length) throw new Error(`No recent MRMS ${product.label} frames were found`);
    const targetIndex = contextChanged || resetToLatest || radarFrameIndex < 0
      ? radarFrames.length - 1
      : Math.min(radarFrameIndex, radarFrames.length - 1);
    const shown = await queueRadarFrame(targetIndex, sequence);
    // Not awaited — the rest of the loop fills in behind the frame
    // that is already drawn.
    if (sequence === radarSequence) warmRadarFrames(radarWarmContext(), radarFrames[targetIndex]?.key);
    return shown;
  }

  mrmsLayer?.clear();
  const selected = selectedSite;
  if (siteChanged && radarFrames.length) {
    radarFrames = [];
    radarFrameIndex = -1;
    radarFrameMeta = null;
    radarHooks.onFrame?.({ kind: 'radar', ...radarResult() });
  }
  radarSite = selected;
  // `resetToLatest` accompanies a product switch too, and re-listing on one is
  // exactly what the retained timeline exists to avoid.
  if (siteChanged || !radarFrames.length || (resetToLatest && !keepSingleTimeline)) {
    emitStatus('radar', 'listing', `Finding recent ${selected[0]} scans`, null);
    let volumes = await listVolumes(selected[0], new Date());
    if (!volumes.length) volumes = await listVolumes(selected[0], new Date(Date.now() - 86400000));
    if (sequence !== radarSequence) return radarResult();
    radarFrames = volumes.slice(-MAX_RADAR_FRAMES);
    radarFrameIndex = radarFrames.length - 1;
  }
  if (!radarFrames.length) throw new Error(`No recent ${selected[0]} Level II scans were found`);
  // A kept timeline stays where the user scrubbed it: switching reflectivity to
  // velocity should show the same scan in a different moment, not jump to now.
  const targetIndex = keepSingleTimeline
    ? Math.max(0, Math.min(radarFrameIndex, radarFrames.length - 1))
    : (contextChanged || siteChanged || resetToLatest || radarFrameIndex < 0
      ? radarFrames.length - 1
      : Math.min(radarFrameIndex, radarFrames.length - 1));
  const shown = await queueRadarFrame(targetIndex, sequence);
  if (sequence === radarSequence) warmRadarFrames(radarWarmContext(), radarFrames[targetIndex]?.key);
  return shown;
}

export function showRadarFrame(index) {
  return queueRadarFrame(index);
}

export async function loadSatellite({
  map,
  beforeId = null,
  sourceKey = 'goes19conus',
  productKey = 'geocolor',
  location = null,
  onStatus,
  onFrame,
  resetToLatest = false,
} = {}) {
  satelliteHooks = { onStatus, onFrame };
  activeMap = map || activeMap;
  anchorId = beforeId || anchorId;
  satelliteVisible = true;
  const source = satelliteConfig(sourceKey);
  productDecoderId(productKey);
  const sourceChanged = sourceKey !== satelliteSourceKey;
  const productChanged = productKey !== satelliteProductKey;
  if (sourceChanged || productChanged) preemptActiveSatelliteWarm();
  satelliteSourceKey = sourceKey;
  satelliteProductKey = productKey;
  satelliteDecodeBBox = normalizeDecodeBBox(sourceKey, location);
  const sequence = ++satelliteSequence;

  if (sourceChanged || productChanged) {
    satelliteFrames = [];
    satelliteFrameIndex = -1;
    satelliteFrameMeta = null;
    satelliteHooks.onFrame?.({ kind: 'satellite', ...satelliteResult() });
  }
  if (sourceChanged || productChanged || resetToLatest || !satelliteFrames.length) {
    emitStatus('satellite', 'listing', `Finding recent ${source.label} scenes`, null);
    let frames = await listScenes(source.satKey, source.sectorKey, new Date());
    if (!frames.length)
      frames = await listScenes(source.satKey, source.sectorKey, new Date(Date.now() - 86400000));
    if (sequence !== satelliteSequence) return satelliteResult();
    satelliteFrames = frames.slice(-MAX_SATELLITE_FRAMES);
    satelliteFrameIndex = satelliteFrames.length - 1;
  }
  if (!satelliteFrames.length) throw new Error(`No recent ${source.label} scenes were found`);
  const targetIndex = sourceChanged || productChanged || resetToLatest || satelliteFrameIndex < 0
    ? satelliteFrames.length - 1
    : Math.min(satelliteFrameIndex, satelliteFrames.length - 1);
  return queueSatelliteFrame(targetIndex, sequence);
}

export function showSatelliteFrame(index) {
  return queueSatelliteFrame(index);
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
  }
  if (satelliteVisible && !nextSatelliteVisible) {
    satelliteSequence++;
    cancelSatelliteWarm();
  }
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
    const base = {
      site: '',
      product: productInfo.label,
      time: radarFrameMeta?.time || grid.time || null,
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
  cancelSatelliteWarm();
  satelliteCache.clear();
  clearSceneCache();
}

export function currentState() {
  return { radar: radarResult(), satellite: satelliteResult() };
}
