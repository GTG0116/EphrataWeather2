// nowcast.js — dependency-free, short-term MRMS reflectivity extrapolation.
//
// This module deliberately implements a conservative radar advection nowcast,
// not a numerical-weather or machine-learning forecast. It:
//   1. reduces two same-geometry latitude/longitude reflectivity grids,
//   2. estimates an old -> new displacement globally and in local tiles,
//   3. carries the latest field forward at five-minute intervals, and
//   4. applies only a small, damped, motion-compensated intensity tendency.
//
// All exported functions are pure and work in browsers and Node. Grid rows are
// expected to run north -> south, matching the objects returned by grib2.js:
//   { ni, nj, lon1, lat1, di, dj, values: Float32Array, time }

export const NOWCAST_LEADS_MINUTES = Object.freeze([5, 10, 15, 20, 25, 30]);

const METRES_PER_DEGREE = 111320;
const COMPASS_16 = Object.freeze([
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
]);

const DEFAULTS = Object.freeze({
  maxWidth: 900,
  maxHeight: 500,
  echoThreshold: 15,
  signalCeiling: 60,
  minIntervalMinutes: 2,
  maxIntervalMinutes: 20,
  maxAgeMinutes: 20,
  maxFutureSkewMinutes: 5,
  maxSpeedMps: 75,
  maxSearchCells: 80,
  minGlobalScore: 0.30,
  minLocalScore: 0.27,
  maxTrendDbzPerMinute: 0.30,
  trendTauMinutes: 10,
  maxTrendDeltaDbz: 4,
});

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function finite(value) {
  return Number.isFinite(Number(value));
}

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value === 'string' && value.trim()) return new Date(value).getTime();
  return NaN;
}

function rejection(code, reason, details = {}) {
  return { accepted: false, code, reason, ...details };
}

function geometryOf(grid) {
  return {
    ni: Number(grid?.ni),
    nj: Number(grid?.nj),
    lon1: Number(grid?.lon1),
    lat1: Number(grid?.lat1),
    di: Number(grid?.di),
    dj: Number(grid?.dj),
  };
}

function validateGrid(grid, name) {
  const g = geometryOf(grid);
  if (
    !Number.isInteger(g.ni) || g.ni < 2 ||
    !Number.isInteger(g.nj) || g.nj < 2 ||
    !finite(g.lon1) || !finite(g.lat1) ||
    !finite(g.di) || g.di <= 0 ||
    !finite(g.dj) || g.dj <= 0
  ) {
    return `${name} has invalid lat/lon grid geometry`;
  }
  const values = grid?.values;
  if (!values || typeof values.length !== 'number' || values.length !== g.ni * g.nj) {
    return `${name} values do not match its grid dimensions`;
  }
  return null;
}

function sameGeometry(a, b) {
  const ga = geometryOf(a);
  const gb = geometryOf(b);
  const close = (x, y) => Math.abs(x - y) <= 1e-7;
  return ga.ni === gb.ni && ga.nj === gb.nj &&
    close(ga.lon1, gb.lon1) && close(ga.lat1, gb.lat1) &&
    close(ga.di, gb.di) && close(ga.dj, gb.dj);
}

function configured(options = {}) {
  return { ...DEFAULTS, ...options };
}

function downsampleFactor(grid, options) {
  return Math.max(
    1,
    Math.ceil(grid.ni / options.maxWidth),
    Math.ceil(grid.nj / options.maxHeight),
  );
}

/**
 * Max-pool a regular MRMS lat/lon grid to a browser-friendly size.
 * Max pooling preserves compact convective cores better than averaging.
 */
export function downsampleReflectivityGrid(grid, options = {}) {
  const config = configured(options);
  const problem = validateGrid(grid, 'grid');
  if (problem) throw new TypeError(problem);

  const factor = options.factor || downsampleFactor(grid, config);
  if (!Number.isInteger(factor) || factor < 1) {
    throw new TypeError('downsample factor must be a positive integer');
  }

  const width = Math.ceil(grid.ni / factor);
  const height = Math.ceil(grid.nj / factor);
  const values = new Float32Array(width * height);
  values.fill(NaN);

  for (let oy = 0; oy < height; oy++) {
    const sourceY = oy * factor;
    for (let ox = 0; ox < width; ox++) {
      const sourceX = ox * factor;
      let best = -Infinity;
      let found = false;
      for (let by = 0; by < factor && sourceY + by < grid.nj; by++) {
        const base = (sourceY + by) * grid.ni + sourceX;
        for (let bx = 0; bx < factor && sourceX + bx < grid.ni; bx++) {
          const value = Number(grid.values[base + bx]);
          if (Number.isFinite(value) && (!found || value > best)) {
            best = value;
            found = true;
          }
        }
      }
      if (found) values[oy * width + ox] = best;
    }
  }

  return {
    ...grid,
    proj: 'latlon',
    ni: width,
    nj: height,
    lon1: Number(grid.lon1) + ((factor - 1) / 2) * Number(grid.di),
    lat1: Number(grid.lat1) - ((factor - 1) / 2) * Number(grid.dj),
    di: Number(grid.di) * factor,
    dj: Number(grid.dj) * factor,
    values,
    downsampleFactor: factor,
  };
}

function echoCount(grid, threshold) {
  let count = 0;
  for (let i = 0; i < grid.values.length; i++) {
    if (Number(grid.values[i]) >= threshold) count++;
  }
  return count;
}

function makeSignal(grid, threshold, ceiling) {
  const signal = new Float32Array(grid.values.length);
  const span = Math.max(1, ceiling - threshold + 3);
  for (let i = 0; i < signal.length; i++) {
    const value = Number(grid.values[i]);
    signal[i] = Number.isFinite(value) && value >= threshold
      ? clamp((value - threshold + 3) / span, 0, 1)
      : 0;
  }
  return blur3(signal, grid.ni, grid.nj);
}

// A small separable blur suppresses single-cell flicker while retaining storm
// shape. Edge samples are renormalised instead of being padded with zeros.
function blur3(input, width, height) {
  const horizontal = new Float32Array(input.length);
  const output = new Float32Array(input.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let sum = input[row + x];
      let count = 1;
      if (x > 0) { sum += input[row + x - 1]; count++; }
      if (x + 1 < width) { sum += input[row + x + 1]; count++; }
      horizontal[row + x] = sum / count;
    }
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let sum = horizontal[row + x];
      let count = 1;
      if (y > 0) { sum += horizontal[row - width + x]; count++; }
      if (y + 1 < height) { sum += horizontal[row + width + x]; count++; }
      output[row + x] = sum / count;
    }
  }
  return output;
}

function reduceSignal(input, width, height, factor) {
  if (factor === 1) return { values: input, width, height };
  const outWidth = Math.ceil(width / factor);
  const outHeight = Math.ceil(height / factor);
  const values = new Float32Array(outWidth * outHeight);
  for (let oy = 0; oy < outHeight; oy++) {
    for (let ox = 0; ox < outWidth; ox++) {
      let best = 0;
      for (let by = 0; by < factor && oy * factor + by < height; by++) {
        const base = (oy * factor + by) * width + ox * factor;
        for (let bx = 0; bx < factor && ox * factor + bx < width; bx++) {
          best = Math.max(best, input[base + bx]);
        }
      }
      values[oy * outWidth + ox] = best;
    }
  }
  return { values, width: outWidth, height: outHeight };
}

// Score old -> new displacement. dx > 0 moves east/right; dy > 0 moves
// south/down. Cosine correlation is insensitive to a uniform intensity change,
// while echo-mask IoU makes similarly shaped but displaced fields distinct.
function displacementScore(
  previous,
  latest,
  width,
  height,
  dx,
  dy,
  region,
  sampleStep,
  minSamples,
) {
  const x0 = Math.max(0, region?.x0 ?? 0);
  const y0 = Math.max(0, region?.y0 ?? 0);
  const x1 = Math.min(width, region?.x1 ?? width);
  const y1 = Math.min(height, region?.y1 ?? height);

  let sumAB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let union = 0;
  let intersection = 0;

  for (let y = y0; y < y1; y += sampleStep) {
    const sourceY = y - dy;
    if (sourceY < 0 || sourceY >= height) continue;
    const latestRow = y * width;
    const previousRow = sourceY * width;
    for (let x = x0; x < x1; x += sampleStep) {
      const sourceX = x - dx;
      if (sourceX < 0 || sourceX >= width) continue;
      const a = previous[previousRow + sourceX];
      const b = latest[latestRow + x];
      const hasA = a > 0;
      const hasB = b > 0;
      if (!hasA && !hasB) continue;
      union++;
      if (hasA && hasB) intersection++;
      sumAB += a * b;
      sumAA += a * a;
      sumBB += b * b;
    }
  }

  if (union < minSamples || sumAA <= 1e-8 || sumBB <= 1e-8) return null;
  const correlation = clamp(sumAB / Math.sqrt(sumAA * sumBB), 0, 1);
  const overlap = intersection / union;
  return {
    dx,
    dy,
    correlation,
    overlap,
    samples: union,
    score: 0.72 * correlation + 0.28 * overlap,
  };
}

function searchDisplacement(
  previous,
  latest,
  width,
  height,
  bounds,
  region = null,
  sampleStep = 1,
  minSamples = 5,
) {
  let best = null;
  let second = null;
  for (let dy = bounds.minDy; dy <= bounds.maxDy; dy++) {
    for (let dx = bounds.minDx; dx <= bounds.maxDx; dx++) {
      const candidate = displacementScore(
        previous, latest, width, height, dx, dy, region, sampleStep, minSamples,
      );
      if (!candidate) continue;
      if (!best || candidate.score > best.score) {
        second = best;
        best = candidate;
      } else if (!second || candidate.score > second.score) {
        second = candidate;
      }
    }
  }
  if (best) {
    best.secondScore = second?.score ?? 0;
    best.peakSeparation = Math.max(0, best.score - best.secondScore);
  }
  return best;
}

function median(numbers) {
  if (!numbers.length) return NaN;
  const sorted = numbers.slice().sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length & 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function weightedMedian(values, weights) {
  if (!values.length || values.length !== weights.length) return NaN;
  const entries = values
    .map((value, index) => ({ value, weight: Math.max(0, weights[index]) }))
    .filter((entry) => Number.isFinite(entry.value) && entry.weight > 0)
    .sort((a, b) => a.value - b.value);
  if (!entries.length) return NaN;
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let cumulative = 0;
  for (const entry of entries) {
    cumulative += entry.weight;
    if (cumulative >= total / 2) return entry.value;
  }
  return entries[entries.length - 1].value;
}

// Median motion-compensated dBZ change in a tile. A histogram avoids allocating
// thousands of short-lived arrays while local vectors are searched.
function tileTrend(
  previousGrid,
  latestGrid,
  dx,
  dy,
  region,
  echoThreshold,
  intervalMinutes,
) {
  const bins = new Uint32Array(81); // -20..+20 dBZ in 0.5 dBZ bins
  let count = 0;
  for (let y = region.y0; y < region.y1; y++) {
    const sourceY = y - dy;
    if (sourceY < 0 || sourceY >= latestGrid.nj) continue;
    for (let x = region.x0; x < region.x1; x++) {
      const sourceX = x - dx;
      if (sourceX < 0 || sourceX >= latestGrid.ni) continue;
      const oldValue = Number(previousGrid.values[sourceY * latestGrid.ni + sourceX]);
      const newValue = Number(latestGrid.values[y * latestGrid.ni + x]);
      // Requiring a matched echo in both scans avoids treating a translated edge
      // or a newly uncovered background cell as explosive growth/decay.
      if (
        !Number.isFinite(oldValue) || !Number.isFinite(newValue) ||
        oldValue < echoThreshold || newValue < echoThreshold
      ) continue;
      const difference = clamp(newValue - oldValue, -20, 20);
      bins[Math.round((difference + 20) * 2)]++;
      count++;
    }
  }
  if (count < 8) return { trend: 0, count };
  const target = Math.ceil(count / 2);
  let cumulative = 0;
  let bin = 40;
  for (let i = 0; i < bins.length; i++) {
    cumulative += bins[i];
    if (cumulative >= target) { bin = i; break; }
  }
  return { trend: ((bin / 2) - 20) / intervalMinutes, count };
}

function localMotionField(
  previousGrid,
  latestGrid,
  previousSignal,
  latestSignal,
  global,
  intervalMinutes,
  config,
) {
  const width = latestGrid.ni;
  const height = latestGrid.nj;
  const tileSize = Math.round(config.tileSize ||
    clamp(Math.min(width, height) / 5, 36, 80));
  const stride = Math.max(18, Math.round(config.tileStride || tileSize * 0.55));
  const columns = Math.max(2, Math.ceil((width - 1) / stride) + 1);
  const rows = Math.max(2, Math.ceil((height - 1) / stride) + 1);
  const length = columns * rows;
  const dx = new Float32Array(length);
  const dy = new Float32Array(length);
  const trend = new Float32Array(length);
  const confidence = new Float32Array(length);
  const accepted = new Uint8Array(length);
  const sampleCounts = new Uint32Array(length);

  const globalMagnitude = Math.hypot(global.dx, global.dy);
  const radius = Math.round(config.localSearchRadius ||
    clamp(Math.ceil(globalMagnitude * 0.35) + 2, 3, 6));
  const sampleStep = tileSize >= 58 ? 2 : 1;
  const minSamples = Math.max(5, Math.floor((tileSize / sampleStep) ** 2 * 0.008));
  const half = Math.floor(tileSize / 2);

  for (let ty = 0; ty < rows; ty++) {
    const cy = ty * stride;
    for (let tx = 0; tx < columns; tx++) {
      const cx = tx * stride;
      const index = ty * columns + tx;
      const region = {
        x0: Math.max(0, cx - half),
        y0: Math.max(0, cy - half),
        x1: Math.min(width, cx + half + 1),
        y1: Math.min(height, cy + half + 1),
      };
      const candidate = searchDisplacement(
        previousSignal,
        latestSignal,
        width,
        height,
        {
          minDx: Math.round(global.dx) - radius,
          maxDx: Math.round(global.dx) + radius,
          minDy: Math.round(global.dy) - radius,
          maxDy: Math.round(global.dy) + radius,
        },
        region,
        sampleStep,
        minSamples,
      );

      if (
        !candidate ||
        candidate.score < config.minLocalScore ||
        candidate.overlap < 0.06
      ) {
        dx[index] = global.dx / intervalMinutes;
        dy[index] = global.dy / intervalMinutes;
        confidence[index] = global.quality * 0.45;
        continue;
      }

      const uniqueness = clamp(candidate.peakSeparation / 0.12, 0, 1);
      const quality = clamp(candidate.score * (0.75 + 0.25 * uniqueness), 0, 1);
      const tendency = tileTrend(
        previousGrid,
        latestGrid,
        candidate.dx,
        candidate.dy,
        region,
        config.echoThreshold,
        intervalMinutes,
      );
      const trendSupport = clamp(tendency.count / 40, 0, 1);
      const trendConfidence = clamp((quality - 0.25) / 0.55, 0, 1) * trendSupport;

      dx[index] = candidate.dx / intervalMinutes;
      dy[index] = candidate.dy / intervalMinutes;
      trend[index] = clamp(
        tendency.trend,
        -config.maxTrendDbzPerMinute,
        config.maxTrendDbzPerMinute,
      ) * trendConfidence;
      confidence[index] = quality;
      accepted[index] = 1;
      sampleCounts[index] = candidate.samples;
    }
  }

  // Suppress isolated vector outliers and let rejected tiles inherit nearby
  // accepted motion. This preserves separate storm motions without leaving sharp
  // vector seams in the advected image.
  const smoothDx = new Float32Array(dx);
  const smoothDy = new Float32Array(dy);
  const smoothTrend = new Float32Array(trend);
  const smoothConfidence = new Float32Array(confidence);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < columns; tx++) {
      const index = ty * columns + tx;
      const nearDx = [];
      const nearDy = [];
      const nearTrend = [];
      const nearConfidence = [];
      for (let oy = -1; oy <= 1; oy++) {
        const ny = ty + oy;
        if (ny < 0 || ny >= rows) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const nx = tx + ox;
          if (nx < 0 || nx >= columns) continue;
          const ni = ny * columns + nx;
          if (!accepted[ni]) continue;
          nearDx.push(dx[ni]);
          nearDy.push(dy[ni]);
          nearTrend.push(trend[ni]);
          nearConfidence.push(confidence[ni]);
        }
      }
      if (!nearDx.length) continue;
      const mdx = median(nearDx);
      const mdy = median(nearDy);
      const mtrend = median(nearTrend);
      if (accepted[index]) {
        const deviation = Math.hypot(dx[index] - mdx, dy[index] - mdy);
        const allowed = Math.max(0.35, radius / intervalMinutes);
        const localWeight = deviation > allowed ? 0.25 : 0.72;
        smoothDx[index] = dx[index] * localWeight + mdx * (1 - localWeight);
        smoothDy[index] = dy[index] * localWeight + mdy * (1 - localWeight);
        smoothTrend[index] = trend[index] * 0.7 + mtrend * 0.3;
      } else if (nearDx.length >= 2) {
        smoothDx[index] = mdx;
        smoothDy[index] = mdy;
        smoothTrend[index] = mtrend * 0.65;
        smoothConfidence[index] = median(nearConfidence) * 0.65;
      }
    }
  }

  return {
    columns,
    rows,
    stride,
    tileSize,
    dxPerMinute: smoothDx,
    dyPerMinute: smoothDy,
    trendDbzPerMinute: smoothTrend,
    confidence: smoothConfidence,
    accepted,
    sampleCounts,
  };
}

function sampleField(field, array, x, y) {
  const gx = clamp(x / field.stride, 0, field.columns - 1);
  const gy = clamp(y / field.stride, 0, field.rows - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(field.columns - 1, x0 + 1);
  const y1 = Math.min(field.rows - 1, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;
  const a = array[y0 * field.columns + x0];
  const b = array[y0 * field.columns + x1];
  const c = array[y1 * field.columns + x0];
  const d = array[y1 * field.columns + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) +
    (c * (1 - fx) + d * fx) * fy;
}

function sampleMotion(field, x, y) {
  return {
    dxPerMinute: sampleField(field, field.dxPerMinute, x, y),
    dyPerMinute: sampleField(field, field.dyPerMinute, x, y),
    trendDbzPerMinute: sampleField(field, field.trendDbzPerMinute, x, y),
    confidence: sampleField(field, field.confidence, x, y),
  };
}

function bilinearFinite(values, width, height, x, y) {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return NaN;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const samples = [
    [values[y0 * width + x0], (1 - fx) * (1 - fy)],
    [values[y0 * width + x1], fx * (1 - fy)],
    [values[y1 * width + x0], (1 - fx) * fy],
    [values[y1 * width + x1], fx * fy],
  ];
  let value = 0;
  let weight = 0;
  for (const [sample, sampleWeight] of samples) {
    if (Number.isFinite(Number(sample)) && sampleWeight > 0) {
      value += Number(sample) * sampleWeight;
      weight += sampleWeight;
    }
  }
  return weight > 1e-8 ? value / weight : NaN;
}

function bearingFor(vx, vy) {
  return (Math.atan2(vx, vy) * 180 / Math.PI + 360) % 360;
}

export function compassDirection(bearing) {
  if (!Number.isFinite(Number(bearing))) return null;
  return COMPASS_16[Math.round((((Number(bearing) % 360) + 360) % 360) / 22.5) % 16];
}

function dominantSummary(field, grid, intervalMinutes, global) {
  const dxValues = [];
  const dyValues = [];
  const trendValues = [];
  const weights = [];
  const localQualities = [];
  let acceptedTiles = 0;

  for (let i = 0; i < field.accepted.length; i++) {
    if (!field.accepted[i]) continue;
    acceptedTiles++;
    const weight = Math.max(1, field.sampleCounts[i]) * Math.max(0.05, field.confidence[i]);
    dxValues.push(field.dxPerMinute[i] * intervalMinutes);
    dyValues.push(field.dyPerMinute[i] * intervalMinutes);
    trendValues.push(field.trendDbzPerMinute[i]);
    weights.push(weight);
    localQualities.push(field.confidence[i]);
  }

  const dxCells = Number.isFinite(weightedMedian(dxValues, weights))
    ? weightedMedian(dxValues, weights)
    : global.dx;
  const dyCells = Number.isFinite(weightedMedian(dyValues, weights))
    ? weightedMedian(dyValues, weights)
    : global.dy;
  const trendDbzPerMinute = Number.isFinite(weightedMedian(trendValues, weights))
    ? weightedMedian(trendValues, weights)
    : 0;

  const centerLat = grid.lat1 - ((grid.nj - 1) * grid.dj) / 2;
  const metresX = grid.di * METRES_PER_DEGREE *
    Math.max(0.15, Math.cos(centerLat * Math.PI / 180));
  const metresY = grid.dj * METRES_PER_DEGREE;
  const seconds = intervalMinutes * 60;
  const velocityEastMps = dxCells * metresX / seconds;
  const velocityNorthMps = -dyCells * metresY / seconds;
  const speedMps = Math.hypot(velocityEastMps, velocityNorthMps);
  const bearing = speedMps < 0.5 ? null : bearingFor(velocityEastMps, velocityNorthMps);
  const direction = bearing === null ? 'Stationary' : compassDirection(bearing);
  const intensity = trendDbzPerMinute > 0.035
    ? 'strengthening'
    : trendDbzPerMinute < -0.035
      ? 'weakening'
      : 'steady';
  const localQuality = localQualities.length ? median(localQualities) : global.quality * 0.6;
  const echoTileFraction = acceptedTiles / Math.max(1, field.accepted.length);
  const quality = clamp(
    0.62 * global.quality +
    0.28 * localQuality +
    0.10 * clamp(echoTileFraction * 4, 0, 1),
    0,
    1,
  );

  return {
    dxCells,
    dyCells,
    dxCellsPerMinute: dxCells / intervalMinutes,
    dyCellsPerMinute: dyCells / intervalMinutes,
    velocityEastMps,
    velocityNorthMps,
    speedMps,
    speedMph: speedMps * 2.2369362921,
    bearing,
    direction,
    trendDbzPerMinute,
    intensity,
    quality,
    acceptedTiles,
    tileCount: field.accepted.length,
    text: direction === 'Stationary'
      ? `Nearly stationary; ${intensity}`
      : `Moving ${direction} at ${Math.round(speedMps * 2.2369362921)} mph; ${intensity}`,
  };
}

/**
 * Estimate a global-then-local motion field between two already manageable,
 * same-geometry reflectivity grids.
 */
export function estimateReflectivityMotion(previousGrid, latestGrid, options = {}) {
  const config = configured(options);
  const previousProblem = validateGrid(previousGrid, 'previous grid');
  const latestProblem = validateGrid(latestGrid, 'latest grid');
  if (previousProblem || latestProblem) {
    return rejection('INVALID_GRID', previousProblem || latestProblem);
  }
  if (!sameGeometry(previousGrid, latestGrid)) {
    return rejection('GEOMETRY_MISMATCH', 'reflectivity grids must have identical geometry');
  }

  const intervalMinutes = Number(options.intervalMinutes);
  if (
    !Number.isFinite(intervalMinutes) ||
    intervalMinutes < config.minIntervalMinutes ||
    intervalMinutes > config.maxIntervalMinutes
  ) {
    return rejection(
      'INVALID_INTERVAL',
      `scan interval must be ${config.minIntervalMinutes}-${config.maxIntervalMinutes} minutes`,
      { intervalMinutes },
    );
  }

  const width = latestGrid.ni;
  const height = latestGrid.nj;
  const previousEchoes = echoCount(previousGrid, config.echoThreshold);
  const latestEchoes = echoCount(latestGrid, config.echoThreshold);
  const minEchoPixels = Math.round(options.minEchoPixels ||
    Math.max(12, width * height * 0.00025));
  if (previousEchoes < minEchoPixels || latestEchoes < minEchoPixels) {
    return rejection('NO_ECHO', 'not enough trackable reflectivity in both scans', {
      previousEchoes,
      latestEchoes,
      minEchoPixels,
    });
  }

  const previousSignal = makeSignal(
    previousGrid, config.echoThreshold, config.signalCeiling,
  );
  const latestSignal = makeSignal(
    latestGrid, config.echoThreshold, config.signalCeiling,
  );

  const centerLat = latestGrid.lat1 - ((height - 1) * latestGrid.dj) / 2;
  const cellMetresX = latestGrid.di * METRES_PER_DEGREE *
    Math.max(0.15, Math.cos(centerLat * Math.PI / 180));
  const cellMetresY = latestGrid.dj * METRES_PER_DEGREE;
  const intervalSeconds = intervalMinutes * 60;
  const maxDx = Math.max(1, Math.min(
    config.maxSearchCells,
    Math.floor(width * 0.28),
    Math.ceil(config.maxSpeedMps * intervalSeconds / cellMetresX) + 1,
  ));
  const maxDy = Math.max(1, Math.min(
    config.maxSearchCells,
    Math.floor(height * 0.28),
    Math.ceil(config.maxSpeedMps * intervalSeconds / cellMetresY) + 1,
  ));

  const pyramidFactor = Math.max(
    1,
    Math.ceil(width / 220),
    Math.ceil(height / 140),
  );
  const coarsePrevious = reduceSignal(previousSignal, width, height, pyramidFactor);
  const coarseLatest = reduceSignal(latestSignal, width, height, pyramidFactor);
  const coarse = searchDisplacement(
    coarsePrevious.values,
    coarseLatest.values,
    coarseLatest.width,
    coarseLatest.height,
    {
      minDx: -Math.ceil(maxDx / pyramidFactor),
      maxDx: Math.ceil(maxDx / pyramidFactor),
      minDy: -Math.ceil(maxDy / pyramidFactor),
      maxDy: Math.ceil(maxDy / pyramidFactor),
    },
    null,
    1,
    4,
  );
  if (!coarse) {
    return rejection('LOW_CORRELATION', 'the echo field could not be matched');
  }

  const coarseDx = coarse.dx * pyramidFactor;
  const coarseDy = coarse.dy * pyramidFactor;
  const refinementRadius = pyramidFactor + 2;
  const global = searchDisplacement(
    previousSignal,
    latestSignal,
    width,
    height,
    {
      minDx: Math.max(-maxDx, coarseDx - refinementRadius),
      maxDx: Math.min(maxDx, coarseDx + refinementRadius),
      minDy: Math.max(-maxDy, coarseDy - refinementRadius),
      maxDy: Math.min(maxDy, coarseDy + refinementRadius),
    },
    null,
    Math.max(1, Math.ceil(Math.max(width, height) / 600)),
    8,
  );
  if (!global || global.score < config.minGlobalScore || global.overlap < 0.06) {
    return rejection('LOW_CORRELATION', 'the echo field has no reliable displacement', {
      score: global?.score ?? 0,
      overlap: global?.overlap ?? 0,
    });
  }

  const uniqueness = clamp(global.peakSeparation / 0.12, 0, 1);
  global.quality = clamp(global.score * (0.75 + 0.25 * uniqueness), 0, 1);
  const field = localMotionField(
    previousGrid,
    latestGrid,
    previousSignal,
    latestSignal,
    global,
    intervalMinutes,
    config,
  );
  const dominant = dominantSummary(field, latestGrid, intervalMinutes, global);

  return {
    accepted: true,
    intervalMinutes,
    global: {
      dxCells: global.dx,
      dyCells: global.dy,
      correlation: global.correlation,
      overlap: global.overlap,
      score: global.score,
      quality: global.quality,
    },
    field,
    dominant,
    quality: dominant.quality,
    previousEchoes,
    latestEchoes,
  };
}

/**
 * Backward-advect the latest reflectivity through a motion field. The midpoint
 * flow sample is a cheap second-order correction when neighbouring storms have
 * different vectors.
 */
export function advectReflectivityGrid(latestGrid, motion, leadMinutes, options = {}) {
  const config = configured(options);
  const problem = validateGrid(latestGrid, 'latest grid');
  if (problem) throw new TypeError(problem);
  if (!motion?.accepted || !motion.field) {
    throw new TypeError('an accepted motion estimate is required');
  }
  if (!Number.isFinite(Number(leadMinutes)) || Number(leadMinutes) <= 0) {
    throw new TypeError('leadMinutes must be positive');
  }

  const lead = Number(leadMinutes);
  const width = latestGrid.ni;
  const height = latestGrid.nj;
  const values = new Float32Array(width * height);
  values.fill(NaN);
  const effectiveTrendMinutes = config.trendTauMinutes *
    (1 - Math.exp(-lead / config.trendTauMinutes));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const initial = sampleMotion(motion.field, x, y);
      const midX = x - initial.dxPerMinute * lead * 0.5;
      const midY = y - initial.dyPerMinute * lead * 0.5;
      const local = sampleMotion(motion.field, midX, midY);
      const sourceX = x - local.dxPerMinute * lead;
      const sourceY = y - local.dyPerMinute * lead;
      let value = bilinearFinite(latestGrid.values, width, height, sourceX, sourceY);
      if (!Number.isFinite(value)) continue;

      if (value >= config.echoThreshold) {
        const tendency = clamp(
          local.trendDbzPerMinute * effectiveTrendMinutes,
          -config.maxTrendDeltaDbz,
          config.maxTrendDeltaDbz,
        );
        value += tendency;
      }
      values[y * width + x] = value;
    }
  }

  const latestTime = toMillis(latestGrid.time ?? latestGrid.validTime);
  const validMillis = Number.isFinite(latestTime)
    ? latestTime + lead * 60000
    : NaN;
  return {
    ...latestGrid,
    values,
    leadMinutes: lead,
    kind: 'forecast',
    extrapolated: true,
    time: Number.isFinite(validMillis) ? new Date(validMillis) : null,
    validTime: Number.isFinite(validMillis) ? new Date(validMillis) : null,
  };
}

/**
 * End-to-end public API.
 *
 * Returns either:
 *   { accepted:false, code, reason, ...diagnostics }
 * or:
 *   { accepted:true, baseGrid, motion, forecasts, summary, quality, ... }
 */
export function buildReflectivityNowcast(previousGrid, latestGrid, options = {}) {
  const config = configured(options);
  const previousProblem = validateGrid(previousGrid, 'previous grid');
  const latestProblem = validateGrid(latestGrid, 'latest grid');
  if (previousProblem || latestProblem) {
    return rejection('INVALID_GRID', previousProblem || latestProblem);
  }
  if (!sameGeometry(previousGrid, latestGrid)) {
    return rejection('GEOMETRY_MISMATCH', 'reflectivity grids must have identical geometry');
  }

  const previousMillis = toMillis(
    options.previousTime ?? previousGrid.time ?? previousGrid.validTime,
  );
  const latestMillis = toMillis(
    options.latestTime ?? latestGrid.time ?? latestGrid.validTime,
  );
  if (!Number.isFinite(previousMillis) || !Number.isFinite(latestMillis)) {
    return rejection('MISSING_TIME', 'both scans need real valid timestamps');
  }
  const intervalMinutes = (latestMillis - previousMillis) / 60000;
  if (
    intervalMinutes < config.minIntervalMinutes ||
    intervalMinutes > config.maxIntervalMinutes
  ) {
    return rejection(
      'INVALID_INTERVAL',
      `scan interval must be ${config.minIntervalMinutes}-${config.maxIntervalMinutes} minutes`,
      { intervalMinutes },
    );
  }

  const nowMillis = toMillis(options.now ?? Date.now());
  if (!Number.isFinite(nowMillis)) {
    return rejection('INVALID_NOW', 'now must be a valid timestamp');
  }
  const ageMinutes = (nowMillis - latestMillis) / 60000;
  if (ageMinutes > config.maxAgeMinutes) {
    return rejection('STALE_INPUT', 'latest radar scan is too old for extrapolation', {
      ageMinutes,
    });
  }
  if (ageMinutes < -config.maxFutureSkewMinutes) {
    return rejection('FUTURE_INPUT', 'latest radar scan is implausibly in the future', {
      ageMinutes,
    });
  }

  const factor = downsampleFactor(latestGrid, config);
  const previous = downsampleReflectivityGrid(previousGrid, { ...config, factor });
  const latest = downsampleReflectivityGrid(latestGrid, { ...config, factor });
  previous.time = new Date(previousMillis);
  previous.validTime = new Date(previousMillis);
  latest.time = new Date(latestMillis);
  latest.validTime = new Date(latestMillis);

  const motion = estimateReflectivityMotion(previous, latest, {
    ...config,
    intervalMinutes,
  });
  if (!motion.accepted) {
    return {
      ...motion,
      intervalMinutes,
      previousTime: new Date(previousMillis),
      latestTime: new Date(latestMillis),
      downsampleFactor: factor,
    };
  }

  const leads = Array.from(options.leadsMinutes || NOWCAST_LEADS_MINUTES)
    .map(Number)
    .filter((lead) => Number.isFinite(lead) && lead > 0)
    .sort((a, b) => a - b);
  if (!leads.length) {
    return rejection('INVALID_LEADS', 'at least one positive forecast lead is required');
  }
  const forecasts = leads.map((lead) =>
    advectReflectivityGrid(latest, motion, lead, config));

  return {
    accepted: true,
    kind: 'radar-nowcast',
    method: 'multi-scale block correlation and backward advection',
    previousTime: new Date(previousMillis),
    latestTime: new Date(latestMillis),
    intervalMinutes,
    ageMinutes,
    downsampleFactor: factor,
    baseGrid: latest,
    motion,
    forecasts,
    leadsMinutes: leads,
    summary: motion.dominant,
    quality: motion.quality,
  };
}
