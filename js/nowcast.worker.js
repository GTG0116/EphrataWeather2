// nowcast.worker.js — runs the reflectivity extrapolation off the main thread.
//
// Three separate costs used to land on the page while a user was panning the
// map: downloading and decoding the older MRMS scan the motion estimate needs
// (a ~100 MB native CONUS field), the correlation search, and one advection pass
// per forecast lead. All of it happens here instead. The page only ever holds
// the small cropped grids and the finished frames.
//
// Each lead is posted back the moment it is ready (its value buffer transferred,
// not copied), so the timeline fills in progressively instead of appearing all
// at once at the end.

import {
  prepareReflectivityNowcast,
  advectReflectivityGrid,
  cropLatLonGrid,
} from './nowcast.js';
import { loadMrms } from './mrms.js';

function millis(value) {
  if (value instanceof Date) return value.getTime();
  const time = Number(value);
  return Number.isFinite(time) ? time : NaN;
}

function gridMessage(grid) {
  return {
    ni: grid.ni,
    nj: grid.nj,
    lon1: grid.lon1,
    lat1: grid.lat1,
    di: grid.di,
    dj: grid.dj,
    values: grid.values,
    timeMillis: millis(grid.time ?? grid.validTime),
    leadMinutes: grid.leadMinutes,
    confidence: grid.confidence,
    uncertaintyKm: grid.uncertaintyKm,
  };
}

// The older scan is named, not shipped: fetching and decoding it here keeps the
// native field (and its GRIB2 decode) entirely off the page, and it is discarded
// as soon as the viewed area has been cropped out of it.
async function historyGrid({ key, timeMillis }, bounds, limits) {
  const raw = await loadMrms('REFC', key);
  try {
    const cropped = cropLatLonGrid(raw, bounds, limits);
    cropped.key = key;
    cropped.time = new Date(Number.isFinite(timeMillis) ? timeMillis : raw.time);
    cropped.validTime = cropped.time;
    return cropped;
  } finally {
    raw.values = new Float32Array(0);
  }
}

self.onmessage = async ({ data }) => {
  const { id, previous, previousKey, latest, bounds, limits, options } = data || {};
  try {
    const previousGrid = previous
      ? { ...previous, time: new Date(previous.timeMillis) }
      : await historyGrid(previousKey, bounds, limits);
    const prepared = prepareReflectivityNowcast(
      previousGrid,
      { ...latest, time: new Date(latest.timeMillis) },
      options || {},
    );
    if (!prepared.accepted) {
      self.postMessage({ id, type: 'rejected', code: prepared.code, reason: prepared.reason });
      return;
    }
    self.postMessage({
      id,
      type: 'motion',
      summary: prepared.summary,
      quality: prepared.quality,
      method: prepared.method,
      intervalMinutes: prepared.intervalMinutes,
      leadsMinutes: prepared.leadsMinutes,
      leadsTrimmed: prepared.leadsTrimmed,
      downsampleFactor: prepared.downsampleFactor,
    });
    prepared.leadsMinutes.forEach((lead, index) => {
      const forecast = advectReflectivityGrid(
        prepared.baseGrid, prepared.motion, lead, prepared.config,
      );
      const message = gridMessage(forecast);
      self.postMessage({ id, type: 'forecast', index, grid: message }, [message.values.buffer]);
    });
    self.postMessage({ id, type: 'done' });
  } catch (error) {
    self.postMessage({ id, type: 'error', error: error?.message || 'nowcast failed' });
  }
};
