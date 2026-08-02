// satellite.worker.js — runs the GOES/Himawari fetch + decode off the main thread.
//
// GOES scenes are a single NetCDF-4/HDF5 file; Himawari full-disk scenes are ten
// bzip2-compressed HSD segments per band, decompressed in pure JS and resampled
// onto a 5500×5500 grid. Doing that on the page froze the browser for seconds
// every time a frame loaded (the Himawari bzip2 especially). Here it happens in a
// worker, with the decoded channel buffers transferred back so the page only ever
// touches finished arrays.
//
// The worker keeps the few most-recent full scenes (with their decode source —
// the parsed HDF5 file for GOES, the sector/frame meta for Himawari) so a product
// switch that needs another band is added without re-downloading. The channel
// buffers it hands back are transferred (detached) — that's fine, because
// ensureBands only ever *adds* missing bands and never re-reads the ones already
// sent.

import { loadScene, ensureBands, bboxKey, sceneBBox } from './goes.js';
import { buildRGBA } from './satProducts.js';

// LRU of decoded scenes, so ensureBands can add bands without a re-download while
// keeping memory bounded (each cached GOES scene pins its downloaded file bytes).
const scenes = new Map();
const order = [];
let cacheEpoch = 0;
// Full-disk source files are very large. Keep only the active scene: product
// switches still reuse it, while scan changes cannot leave a second parsed
// NetCDF/Himawari scene resident during the next decode.
const MAX_SCENES = 1;

function remember(key, scene) {
  scenes.set(key, scene);
  const i = order.indexOf(key);
  if (i >= 0) order.splice(i, 1);
  order.push(key);
  while (order.length > MAX_SCENES) scenes.delete(order.shift());
}

// The cloneable view of a scene the page needs (geometry + projection + the
// requested channel arrays), plus the channel buffers to transfer.
function slimScene(scene, bands, maxDim = 0) {
  const channels = {};
  const transfer = [];
  const stride = maxDim > 0 ? Math.max(1, Math.ceil(Math.max(scene.width, scene.height) / maxDim)) : 1;
  const width = Math.ceil(scene.width / stride);
  const height = Math.ceil(scene.height / stride);
  for (const b of bands) {
    const arr = scene.channels[b];
    if (!arr) continue;
    if (stride === 1) {
      channels[b] = arr;
      transfer.push(arr.buffer);
    } else {
      const sampled = new Float32Array(width * height);
      for (let y = 0; y < height; y++) {
        const srcY = Math.min(scene.height - 1, y * stride);
        for (let x = 0; x < width; x++)
          sampled[y * width + x] = arr[srcY * scene.width + Math.min(scene.width - 1, x * stride)];
      }
      channels[b] = sampled;
      transfer.push(sampled.buffer);
    }
  }
  const slim = {
    width, height,
    xScale: scene.xScale * stride, xOffset: scene.xOffset,
    yScale: scene.yScale * stride, yOffset: scene.yOffset,
    proj: scene.proj, time: scene.time, key: scene.key, channels,
    maxDim: maxDim || 0,
  };
  return { slim, transfer };
}

function workerSceneFor(msg) {
  // Look-ahead work deliberately does not touch the one cached source scene:
  // it should make playback smoother without evicting the image a user may
  // immediately recolour into another satellite product.
  if (msg.cache === false) return null;
  const scene = scenes.get(msg.key);
  if (scene && (scene._bboxKey || '') !== bboxKey(msg.bbox)) return null;
  return scene || null;
}

async function loadFrameScene(msg, progress) {
  let scene = workerSceneFor(msg);
  if (!scene) {
    scene = await loadScene(
      msg.satKey, msg.sectorKey, msg.key, msg.bands, progress, msg.maxDim, msg.bbox,
    );
    if (msg.cache !== false && cacheEpoch === msg.epoch) remember(msg.key, scene);
    return scene;
  }

  // A previous response can have transferred a channel away from this worker,
  // leaving a zero-length typed array behind. Treat it as absent so a later
  // colour product always rereads the band instead of producing a blank frame.
  for (const band of msg.bands) {
    if (scene.channels[band] && !scene.channels[band].length) delete scene.channels[band];
  }
  await ensureBands(scene, msg.bands);
  return scene;
}

function frameMeta(scene) {
  return {
    width: scene.width,
    height: scene.height,
    xScale: scene.xScale,
    xOffset: scene.xOffset,
    yScale: scene.yScale,
    yOffset: scene.yOffset,
    proj: scene.proj,
  };
}

self.onmessage = async (e) => {
  const msg = e.data;
  const { id, type } = msg;
  const progress = (frac) => self.postMessage({ id, progress: frac });
  try {
    if (type === 'evict') {
      scenes.delete(msg.key);
      const i = order.indexOf(msg.key);
      if (i >= 0) order.splice(i, 1);
      return;
    }
    if (type === 'clear') {
      // In-flight load handlers continue after this message returns. Advance an
      // epoch so one that started before the clear cannot repopulate the cache
      // after the user has left satellite mode.
      cacheEpoch++;
      scenes.clear();
      order.length = 0;
      return;
    }
    if (type === 'load') {
      const epoch = cacheEpoch;
      const scene = await loadScene(msg.satKey, msg.sectorKey, msg.key, msg.bands, progress, msg.maxDim, msg.bbox);
      if (epoch === cacheEpoch) remember(msg.key, scene);
      const { slim, transfer } = slimScene(scene, msg.bands, msg.maxDim);
      self.postMessage({ id, ok: true, scene: slim }, transfer);
      return;
    }
    if (type === 'frame') {
      const epoch = cacheEpoch;
      const scene = await loadFrameScene({ ...msg, epoch }, progress);
      // Build the GPU-ready pixels here as well. On a full-disk image this is a
      // multi-million-pixel pass; doing it in the worker avoids a long page-thread
      // task between otherwise smooth Mapbox frames.
      const { slim } = slimScene(scene, msg.bands, msg.maxDim);
      const rgba = buildRGBA(slim, msg.productId, { enhanceIR: true });
      self.postMessage({
        id,
        ok: true,
        meta: frameMeta(slim),
        bbox: sceneBBox(slim),
        rgba,
      }, [rgba.buffer]);
      return;
    }
    if (type === 'ensure') {
      const epoch = cacheEpoch;
      let scene = scenes.get(msg.key);
      let added = msg.bands;
      // A scene decoded for one crop holds nothing outside it, so a request for
      // a different crop has to re-read the file rather than reuse it.
      if (scene && (scene._bboxKey || '') !== bboxKey(msg.bbox)) scene = null;
      if (!scene) {
        // Evicted (or this worker never had it): reload just the bands wanted.
        scene = await loadScene(msg.satKey, msg.sectorKey, msg.key, msg.bands, progress, msg.maxDim, msg.bbox);
        if (epoch === cacheEpoch) remember(msg.key, scene);
      } else {
        const before = new Set(Object.keys(scene.channels));
        await ensureBands(scene, msg.bands);
        added = msg.bands.filter((b) => !before.has(String(b)));
      }
      const { slim, transfer } = slimScene(scene, added, msg.maxDim);
      self.postMessage({ id, ok: true, channels: slim.channels }, transfer);
      return;
    }
    throw new Error(`unknown message ${type}`);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err) });
  }
};
