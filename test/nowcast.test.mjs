import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NOWCAST_LEADS_MINUTES,
  advectReflectivityGrid,
  advectReflectivitySeries,
  buildReflectivityNowcast,
  cropLatLonGrid,
  downsampleReflectivityGrid,
  prepareReflectivityNowcast,
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
  // The tendency itself is capped at maxTrendDeltaDbz (4); probability matching
  // holds the rest of the drop to what resampling and damping cost the peak.
  assert.ok(maximum(result.baseGrid) - maximum(result.forecasts.at(-1)) <= 5.6);
});

test('recovers sub-cell motion so a half-hour lead is not quantised to whole cells', () => {
  // Six cells of travel in eight minutes is 0.75 cell/min — a rate the integer
  // block search cannot represent. The sub-cell peak fit has to find it, or the
  // 30-minute frame lands two cells short.
  const latestTime = new Date(Date.now() - MINUTE);
  const previousTime = new Date(latestTime.getTime() - 8 * MINUTE);
  const previous = makeGrid({ time: previousTime });
  addBlob(previous, 26, 30, 55, 10);
  addBlob(previous, 70, 50, 47, 8);
  const latest = translated(previous, 6, 0, 0, latestTime);

  const result = buildReflectivityNowcast(previous, latest, normalOptions(latestTime));
  assert.equal(result.accepted, true, result.reason);
  assert.ok(
    Math.abs(result.summary.dxCellsPerMinute - 0.75) < 0.12,
    `expected ~0.75 cells/min, got ${result.summary.dxCellsPerMinute}`,
  );
  const baseCenter = echoCentroid(result.baseGrid);
  const plusTwenty = result.forecasts.find((frame) => frame.leadMinutes === 20);
  const forecastCenter = echoCentroid(plusTwenty);
  assert.ok(
    Math.abs((forecastCenter.x - baseCenter.x) - 15) < 2,
    `expected ~15 cells of travel, got ${forecastCenter.x - baseCenter.x}`,
  );
});

test('carries a growing echo outward past the display threshold', () => {
  // A blob that fades to nothing over several cells, the way a real echo edge
  // does — a hard-edged disc has no sub-threshold rim for growth to act on.
  const addFadingBlob = (grid, cx, cy, peak, radius) => {
    for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(grid.nj - 1, Math.ceil(cy + radius)); y++) {
      for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(grid.ni - 1, Math.ceil(cx + radius)); x++) {
        const distance = Math.hypot(x - cx, y - cy);
        if (distance > radius) continue;
        const value = peak * (1 - distance / radius);
        grid.values[y * grid.ni + x] = Math.max(grid.values[y * grid.ni + x], value);
      }
    }
    return grid;
  };
  const latestTime = new Date(Date.now() - MINUTE);
  const previousTime = new Date(latestTime.getTime() - 10 * MINUTE);
  const previous = makeGrid({ time: previousTime });
  addFadingBlob(previous, 40, 34, 48, 15);
  addFadingBlob(previous, 86, 52, 44, 12);
  // The same storms advected the same way, once intensifying and once steady, so
  // the comparison isolates growth from resampling losses.
  const growing = buildReflectivityNowcast(
    previous, translated(previous, 3, 0, 7, latestTime), normalOptions(latestTime),
  );
  const steady = buildReflectivityNowcast(
    previous, translated(previous, 3, 0, 0, latestTime), normalOptions(latestTime),
  );
  assert.equal(growing.accepted, true, growing.reason);
  assert.equal(steady.accepted, true, steady.reason);

  const echoCells = (grid) => grid.values.reduce(
    (count, value) => (value >= 15 ? count + 1 : count), 0,
  );
  assert.ok(
    echoCells(growing.forecasts.at(-1)) > echoCells(steady.forecasts.at(-1)),
    'an intensifying storm should not keep exactly its present footprint',
  );
  assert.equal(growing.summary.intensity, 'strengthening');
  // The synthetic pair intensifies without widening, so coverage is unchanged.
  assert.equal(growing.summary.coverage, 'holding');
  assert.ok(Math.abs(growing.summary.areaChangePercent) < 8);

  // Widening the same storms instead of brightening them has to show up as a
  // coverage trend, which a matched-cell dBZ tendency alone cannot see.
  const spreadingLatest = translated(previous, 3, 0, 0, latestTime);
  addFadingBlob(spreadingLatest, 43, 34, 48, 19);
  addFadingBlob(spreadingLatest, 89, 52, 44, 15);
  const spreading = buildReflectivityNowcast(
    previous, spreadingLatest, normalOptions(latestTime),
  );
  assert.equal(spreading.accepted, true, spreading.reason);
  assert.equal(spreading.summary.coverage, 'expanding');
  assert.ok(spreading.summary.areaChangePercent > 8);
  assert.match(spreading.summary.text, /coverage expanding/);
});

test('reports a lead range the tracking quality can support', () => {
  const latestTime = new Date(Date.now() - MINUTE);
  const previousTime = new Date(latestTime.getTime() - 10 * MINUTE);
  const previous = makeGrid({ time: previousTime });
  addBlob(previous, 30, 30, 55, 10);
  addBlob(previous, 74, 52, 48, 8);
  const latest = translated(previous, 5, 0, 0, latestTime);

  const confident = buildReflectivityNowcast(previous, latest, normalOptions(latestTime));
  assert.equal(confident.accepted, true, confident.reason);
  assert.equal(confident.leadsTrimmed, false);
  assert.deepEqual(confident.leadsMinutes, NOWCAST_LEADS_MINUTES);
  assert.ok(confident.forecasts.every((frame) => frame.confidence > 0));
  // Confidence has to decay with lead, or the label means nothing.
  assert.ok(confident.forecasts.at(-1).confidence < confident.forecasts[0].confidence);

  // Forcing the quality gates above what any real pair could reach must trim the
  // published range rather than extrapolate on a weak match.
  const trimmed = buildReflectivityNowcast(previous, latest, {
    ...normalOptions(latestTime),
    minQualityFor30Min: 1.01,
    minQualityFor20Min: 1.02,
  });
  assert.equal(trimmed.accepted, true, trimmed.reason);
  assert.equal(trimmed.leadsTrimmed, true);
  assert.ok(trimmed.leadsMinutes.length >= 1);
  assert.ok(trimmed.leadsMinutes.at(-1) <= 20);
  assert.deepEqual(trimmed.requestedLeadsMinutes, [...NOWCAST_LEADS_MINUTES]);
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

test('covers the whole MRMS domain rather than a window inside it', () => {
  // The nowcast asks for all of CONUS and lets the crop clamp to the source, so
  // a build is valid wherever the map is panned instead of only where it was.
  const grid = makeGrid({ width: 700, height: 350, di: 0.1, dj: 0.1 });
  grid.lon1 = -129.995;
  grid.lat1 = 54.995;
  addBlob(grid, 40, 40, 52, 8);      // far west
  addBlob(grid, 660, 300, 48, 8);    // far southeast
  const domain = { west: -130, east: -60, south: 20, north: 55 };
  const cropped = cropLatLonGrid(grid, domain, { maxWidth: 350, maxHeight: 175 });

  assert.equal(cropped.downsampleFactor, 2);
  assert.equal(cropped.ni, 350);
  assert.equal(cropped.nj, 175);
  // Both corners survive, so nothing in the domain was cropped away.
  assert.equal(maximum(cropped), 52);
  assert.ok(cropped.values[20 * cropped.ni + 20] > 15, 'the western storm is missing');
  assert.ok(cropped.values[150 * cropped.ni + 330] > 15, 'the southeastern storm is missing');
  // The reduced grid still spans the source, west edge to east edge.
  assert.ok(Math.abs(cropped.lon1 - (grid.lon1 + grid.di / 2)) < 1e-6);
  const east = cropped.lon1 + (cropped.ni - 1) * cropped.di;
  assert.ok(east > grid.lon1 + (grid.ni - 1) * grid.di - cropped.di);
});

test('probability matching keeps peak intensity through the scale damping', () => {
  const latestTime = new Date(Date.now() - MINUTE);
  const previousTime = new Date(latestTime.getTime() - 8 * MINUTE);
  const previous = makeGrid({ width: 200, height: 120, time: previousTime });
  addBlob(previous, 60, 60, 62, 9);
  addBlob(previous, 120, 45, 58, 7);
  addBlob(previous, 95, 85, 54, 6);
  const latest = translated(previous, 5, 0, 0, latestTime);

  const options = { ...normalOptions(latestTime), maxWidth: 200, maxHeight: 120 };
  const matched = buildReflectivityNowcast(previous, latest, options);
  const unmatched = buildReflectivityNowcast(previous, latest, {
    ...options,
    probabilityMatch: false,
  });
  assert.equal(matched.accepted, true, matched.reason);
  assert.equal(unmatched.accepted, true, unmatched.reason);

  const observedPeak = maximum(matched.baseGrid);
  const matchedPeak = maximum(matched.forecasts.at(-1));
  const unmatchedPeak = maximum(unmatched.forecasts.at(-1));
  // Damping alone flattens the core; rank-matching puts it back.
  assert.ok(
    unmatchedPeak < observedPeak - 1,
    `expected damping to flatten the core, got ${unmatchedPeak} vs ${observedPeak}`,
  );
  assert.ok(
    matchedPeak > unmatchedPeak,
    `matching should recover intensity: ${matchedPeak} vs ${unmatchedPeak}`,
  );
  assert.ok(
    Math.abs(matchedPeak - observedPeak) < Math.abs(unmatchedPeak - observedPeak),
    'the matched peak should sit closer to the observed peak',
  );
  // Matching moves values, never cells: it must not invent echo out of nothing.
  const finite = (grid) => grid.values.reduce(
    (count, value) => (Number.isFinite(value) ? count + 1 : count), 0,
  );
  assert.equal(finite(matched.forecasts.at(-1)), finite(unmatched.forecasts.at(-1)));
});

test('a third scan follows an accelerating storm the two-scan estimate undershoots', () => {
  // Constant acceleration: 0.02 cells/min² on top of 0.42 cells/min. Two scans
  // can only ever measure the average speed between them and project it
  // straight; three give the curve.
  const latestTime = new Date(Date.now() - MINUTE);
  const at = (minutes) => new Date(latestTime.getTime() + minutes * MINUTE);
  const position = (minutes) => 60 + 0.5 * minutes + 0.5 * 0.02 * minutes * minutes;

  const scan = (minutes) => {
    const grid = makeGrid({ width: 220, height: 120, time: at(minutes) });
    const shift = position(minutes) - position(0);
    addBlob(grid, 60 + shift, 55, 56, 10);
    addBlob(grid, 120 + shift, 82, 49, 8);
    addBlob(grid, 155 + shift, 38, 45, 7);
    return grid;
  };
  const earliest = scan(-24);
  const previous = scan(-8);
  const latest = scan(0);
  const options = {
    ...normalOptions(latestTime), maxWidth: 220, maxHeight: 120, leadsMinutes: [30],
  };

  const twoScan = buildReflectivityNowcast(previous, latest, options);
  const threeScan = buildReflectivityNowcast([earliest, previous], latest, options);
  assert.equal(twoScan.accepted, true, twoScan.reason);
  assert.equal(threeScan.accepted, true, threeScan.reason);
  assert.equal(twoScan.scanCount, 2);
  assert.equal(twoScan.secondOrder, false);
  assert.equal(threeScan.scanCount, 3);
  assert.equal(threeScan.secondOrder, true);

  const truth = position(30) - position(0);
  const base = echoCentroid(twoScan.baseGrid).x;
  const twoScanTravel = echoCentroid(twoScan.forecasts.at(-1)).x - base;
  const threeScanTravel = echoCentroid(threeScan.forecasts.at(-1)).x - base;

  assert.ok(
    twoScanTravel < truth - 5,
    `a straight projection should fall short of ${truth}, got ${twoScanTravel}`,
  );
  assert.ok(
    threeScanTravel > twoScanTravel,
    `expected the curve to carry further: ${threeScanTravel} vs ${twoScanTravel}`,
  );
  assert.ok(
    Math.abs(threeScanTravel - truth) < Math.abs(twoScanTravel - truth),
    `expected ${threeScanTravel} to sit closer to ${truth} than ${twoScanTravel}`,
  );
  // The acceleration is bounded: it may bend the projection, never invert it.
  assert.ok(threeScanTravel < truth * 1.5);
});

test('a lead advected in a series matches the same lead advected alone', () => {
  // Every frame rides one shared set of trajectories, so the series has to agree
  // with a standalone advection rather than drifting from it.
  const latestTime = new Date(Date.now() - MINUTE);
  const previousTime = new Date(latestTime.getTime() - 8 * MINUTE);
  const previous = makeGrid({ width: 160, height: 110, time: previousTime });
  addBlob(previous, 45, 40, 55, 11);
  addBlob(previous, 100, 70, 47, 9);
  const latest = translated(previous, 5, 2, 0, latestTime);

  const prepared = prepareReflectivityNowcast(previous, latest, {
    ...normalOptions(latestTime), maxWidth: 160, maxHeight: 110,
  });
  assert.equal(prepared.accepted, true, prepared.reason);

  const series = advectReflectivitySeries(
    prepared.baseGrid, prepared.motion, [5, 15, 30], prepared.config,
  );
  assert.deepEqual(series.map((frame) => frame.leadMinutes), [5, 15, 30]);
  for (const frame of series) {
    const alone = advectReflectivityGrid(
      prepared.baseGrid, prepared.motion, frame.leadMinutes, prepared.config,
    );
    assert.equal(frame.values.length, alone.values.length);
    for (let i = 0; i < frame.values.length; i++) {
      const a = frame.values[i];
      const b = alone.values[i];
      assert.equal(Number.isFinite(a), Number.isFinite(b));
      if (Number.isFinite(a)) assert.ok(Math.abs(a - b) < 1e-4);
    }
  }
});
