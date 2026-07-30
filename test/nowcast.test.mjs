import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NOWCAST_LEADS_MINUTES,
  buildReflectivityNowcast,
  downsampleReflectivityGrid,
} from '../js/nowcast.js';
import { prepareGridTexture } from '../js/gridLayer.js';
import { MRMS_PRODUCTS } from '../js/mrms.js';

const MINUTE = 60_000;

function makeGrid({
  width = 120,
  height = 84,
  time = new Date(),
  di = 0.01,
  dj = 0.01,
} = {}) {
  return {
    proj: 'latlon',
    ni: width,
    nj: height,
    lon1: -77,
    lat1: 41,
    di,
    dj,
    time,
    values: new Float32Array(width * height),
  };
}

function addBlob(grid, cx, cy, peak = 55, radius = 9) {
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(grid.nj - 1, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(grid.ni - 1, Math.ceil(cx + radius)); x++) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance > radius) continue;
      const value = 18 + (peak - 18) * (1 - distance / radius);
      grid.values[y * grid.ni + x] = Math.max(grid.values[y * grid.ni + x], value);
    }
  }
  return grid;
}

function translated(grid, dx, dy, intensityDelta, time) {
  const output = makeGrid({
    width: grid.ni,
    height: grid.nj,
    time,
    di: grid.di,
    dj: grid.dj,
  });
  output.lon1 = grid.lon1;
  output.lat1 = grid.lat1;
  for (let y = 0; y < output.nj; y++) {
    const sourceY = y - dy;
    if (sourceY < 0 || sourceY >= grid.nj) continue;
    for (let x = 0; x < output.ni; x++) {
      const sourceX = x - dx;
      if (sourceX < 0 || sourceX >= grid.ni) continue;
      const value = grid.values[sourceY * grid.ni + sourceX];
      output.values[y * output.ni + x] = value >= 15
        ? value + intensityDelta
        : value;
    }
  }
  return output;
}

function echoCentroid(grid, threshold = 20) {
  let sx = 0;
  let sy = 0;
  let weight = 0;
  for (let y = 0; y < grid.nj; y++) {
    for (let x = 0; x < grid.ni; x++) {
      const value = grid.values[y * grid.ni + x];
      if (!(value >= threshold)) continue;
      const w = value - threshold + 1;
      sx += x * w;
      sy += y * w;
      weight += w;
    }
  }
  return { x: sx / weight, y: sy / weight };
}

function maximum(grid) {
  let value = -Infinity;
  for (const sample of grid.values) {
    if (Number.isFinite(sample)) value = Math.max(value, sample);
  }
  return value;
}

function normalOptions(now) {
  return {
    now,
    minEchoPixels: 10,
    maxAgeMinutes: 20,
    minGlobalScore: 0.25,
  };
}

test('downsamples a CONUS-like grid within the requested dimensions and preserves geometry', () => {
  const grid = makeGrid({ width: 1801, height: 1001 });
  grid.values[500 * grid.ni + 900] = 52;
  const reduced = downsampleReflectivityGrid(grid, { maxWidth: 900, maxHeight: 500 });
  assert.ok(reduced.ni <= 900);
  assert.ok(reduced.nj <= 500);
  assert.equal(reduced.downsampleFactor, 3);
  assert.equal(maximum(reduced), 52);
  assert.equal(reduced.di, grid.di * 3);
  assert.equal(reduced.dj, grid.dj * 3);
});

test('finds eastward storm motion and produces all six five-minute leads', () => {
  const latestTime = new Date(Date.now() - MINUTE);
  const previousTime = new Date(latestTime.getTime() - 10 * MINUTE);
  const previous = makeGrid({ time: previousTime });
  addBlob(previous, 28, 28, 56, 10);
  addBlob(previous, 72, 52, 48, 7);
  addBlob(previous, 91, 23, 43, 5);
  const latest = translated(previous, 6, 0, 0, latestTime);

  const result = buildReflectivityNowcast(previous, latest, normalOptions(latestTime));
  assert.equal(result.accepted, true, result.reason);
  assert.deepEqual(result.leadsMinutes, NOWCAST_LEADS_MINUTES);
  assert.equal(result.forecasts.length, 6);
  assert.ok(Math.abs(result.summary.dxCells - 6) <= 1.1, result.summary.text);
  assert.ok(Math.abs(result.summary.dyCells) <= 1.1, result.summary.text);
  assert.equal(result.summary.direction, 'E');
  assert.ok(result.summary.bearing > 80 && result.summary.bearing < 100);

  const currentCenter = echoCentroid(result.baseGrid);
  const plusTen = result.forecasts.find((frame) => frame.leadMinutes === 10);
  const forecastCenter = echoCentroid(plusTen);
  assert.ok(Math.abs((forecastCenter.x - currentCenter.x) - 6) < 1.5);
  assert.equal(
    plusTen.time.getTime(),
    latestTime.getTime() + 10 * MINUTE,
  );
  const texture = prepareGridTexture(plusTen, MRMS_PRODUCTS.REFC, { packed: true });
  assert.equal(texture.tex.W, plusTen.ni);
  assert.equal(texture.tex.H, plusTen.nj);
  assert.equal(texture.tex.packed.length, plusTen.ni * plusTen.nj);
  assert.equal(texture.verts.length, 12);
});

test('reports southeastward displacement using real scan spacing', () => {
  const latestTime = new Date(Date.now() - MINUTE);
  const previousTime = new Date(latestTime.getTime() - 8 * MINUTE);
  const previous = makeGrid({ time: previousTime });
  addBlob(previous, 31, 24, 54, 9);
  addBlob(previous, 79, 54, 46, 8);
  const latest = translated(previous, 4, 4, 0, latestTime);

  const result = buildReflectivityNowcast(previous, latest, normalOptions(latestTime));
  assert.equal(result.accepted, true, result.reason);
  assert.ok(result.summary.dxCells > 2.5);
  assert.ok(result.summary.dyCells > 2.5);
  assert.ok(result.summary.bearing > 110 && result.summary.bearing < 160);
  assert.ok(['ESE', 'SE'].includes(result.summary.direction), result.summary.text);
});

test('detects and conservatively carries a strengthening tendency', () => {
  const latestTime = new Date(Date.now() - MINUTE);
  const previousTime = new Date(latestTime.getTime() - 10 * MINUTE);
  const previous = makeGrid({ time: previousTime });
  addBlob(previous, 35, 34, 48, 11);
  addBlob(previous, 82, 49, 43, 7);
  const latest = translated(previous, 4, -1, 6, latestTime);

  const result = buildReflectivityNowcast(previous, latest, normalOptions(latestTime));
  assert.equal(result.accepted, true, result.reason);
  assert.equal(result.summary.intensity, 'strengthening');
  assert.ok(result.summary.trendDbzPerMinute > 0);
  const plusThirty = result.forecasts.at(-1);
  assert.ok(maximum(plusThirty) > maximum(result.baseGrid));
  assert.ok(maximum(plusThirty) - maximum(result.baseGrid) <= 4.1);
});

test('detects and damps a weakening tendency', () => {
  const latestTime = new Date(Date.now() - MINUTE);
  const previousTime = new Date(latestTime.getTime() - 10 * MINUTE);
  const previous = makeGrid({ time: previousTime });
  addBlob(previous, 37, 33, 57, 11);
  addBlob(previous, 80, 54, 48, 8);
  const latest = translated(previous, -3, 2, -6, latestTime);

  const result = buildReflectivityNowcast(previous, latest, normalOptions(latestTime));
  assert.equal(result.accepted, true, result.reason);
  assert.equal(result.summary.intensity, 'weakening');
  assert.ok(result.summary.trendDbzPerMinute < 0);
  assert.ok(maximum(result.forecasts.at(-1)) < maximum(result.baseGrid));
  assert.ok(maximum(result.baseGrid) - maximum(result.forecasts.at(-1)) <= 4.1);
});

test('rejects fields without trackable echoes', () => {
  const latestTime = new Date();
  const previous = makeGrid({ time: new Date(latestTime.getTime() - 10 * MINUTE) });
  const latest = makeGrid({ time: latestTime });
  const result = buildReflectivityNowcast(previous, latest, normalOptions(latestTime));
  assert.equal(result.accepted, false);
  assert.equal(result.code, 'NO_ECHO');
  assert.equal(result.forecasts, undefined);
});

test('rejects irregular and stale scan times', () => {
  const now = new Date();
  const old = makeGrid({ time: new Date(now.getTime() - 50 * MINUTE) });
  addBlob(old, 40, 40, 50, 9);
  const tooLargeGap = translated(old, 3, 0, 0, new Date(now.getTime() - 5 * MINUTE));
  const gapResult = buildReflectivityNowcast(old, tooLargeGap, normalOptions(now));
  assert.equal(gapResult.accepted, false);
  assert.equal(gapResult.code, 'INVALID_INTERVAL');

  const stalePrevious = makeGrid({ time: new Date(now.getTime() - 40 * MINUTE) });
  addBlob(stalePrevious, 40, 40, 50, 9);
  const staleLatest = translated(
    stalePrevious,
    3,
    0,
    0,
    new Date(now.getTime() - 30 * MINUTE),
  );
  const staleResult = buildReflectivityNowcast(
    stalePrevious,
    staleLatest,
    normalOptions(now),
  );
  assert.equal(staleResult.accepted, false);
  assert.equal(staleResult.code, 'STALE_INPUT');
});
