// nowcast.js — dependency-free, short-term MRMS reflectivity extrapolation.
//
// This module deliberately implements a conservative radar advection nowcast,
// not a numerical-weather or machine-learning forecast. It:
//   1. reduces two or three same-geometry latitude/longitude reflectivity grids,
//   2. estimates an old -> new displacement globally and in local tiles, refined
//      to sub-cell accuracy so a 30-minute lead is not quantised to whole cells,
//   3. fits growth/decay — and, given a third scan, the *rate of change* of that
//      growth/decay plus a first-order motion acceleration — per tile,
//   4. carries the latest field forward along multi-step semi-Lagrangian
//      trajectories shared by every lead, so curving and accelerating flow is
//      followed rather than approximated by one straight jump,
//   5. damps the result by spatial scale rather than uniformly, because small
//      scales lose their skill in minutes while the large-scale pattern survives
//      the whole window, and
//   6. restores the observed intensity distribution by probability matching, so
//      that damping softens *where* the rain is without washing out *how hard*
//      it is falling.
//
// Steps 5 and 6 are what separate this from plain Lagrangian persistence: a
// smoothed field verifies better in position but badly under-forecasts peak
// rates, and rank-matching it back onto the observed histogram recovers those
// rates without giving up the smoothing's placement skill.
//
// All exported functions are pure and work in browsers and Node. Grid rows are
// expected to run north -> south, matching the objects returned by grib2.js:
//   { ni, nj, lon1, lat1, di, dj, values: Float32Array, time }

export const NOWCAST_LEADS_MINUTES = Object.freeze([5, 10, 15, 20, 25, 30]);

// Extrapolation skill falls off quickly; nothing beyond this is published even
// when a caller asks for it.
export const NOWCAST_MAX_LEAD_MINUTES = 30;

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
  // Growth and decay are not symmetric. A convective cell takes tens of minutes
  // to build and can collapse in ten, so caps tight enough to stop a noisy
  // two-scan trend from exploding a storm are far too tight to let a dying one
  // fade — and a forecast that cannot let rain stop keeps painting rain over
  // ground that has already dried out. Both the rate a decay is believed at and
  // the total drop it may accumulate are therefore looser than their growth
  // counterparts. The asymmetry is modest on purpose: it is enough to let a
  // collapsing cell go away over half an hour, not enough for one noisy scan
  // pair to erase a storm.
  maxDecayDbzPerMinute: 0.55,
  maxDecayDeltaDbz: 8,
  // Marshall–Palmer Z = a·R^b. Used to move between reflectivity and rain rate
  // so the smoothing below can be done in the units precipitation is actually
  // measured in.
  zrCoefficient: 200,
  zrExponent: 1.6,
  // Trajectories are integrated in steps no longer than this, so a parcel
  // follows a curving/accelerating flow field instead of one straight jump.
  advectionStepMinutes: 5,
  // How far below the echo threshold a growth/decay tendency is allowed to
  // reach. Without this an intensifying line can never expand its coverage,
  // because only cells that already hold an echo are adjusted.
  growthEdgeDbz: 8,
  // Position error grows with lead time and shrinks with tracking quality. It
  // sets the length scale the field is damped over, which is how an uncertain
  // nowcast should look: a spread-out envelope, not a crisp lie.
  uncertaintyKmPerHour: 9,
  maxSmoothRadiusCells: 4,
  // Scale-dependent Lagrangian persistence. Convective detail decorrelates in
  // minutes; the meso-scale envelope holds for the better part of an hour; the
  // large-scale pattern is essentially persistent over a 30-minute window. Each
  // band is damped toward the next larger one on its own timescale instead of
  // the whole field being blurred by one radius.
  smallScaleTauMinutes: 13,
  mesoScaleTauMinutes: 55,
  // Damping alone leaves the field in the right place with the wrong numbers.
  // Rank-matching it back onto the undamped field's histogram restores observed
  // peak intensities — without this a 30-minute frame under-forecasts heavy
  // rain everywhere it smooths.
  probabilityMatch: true,
  probabilityMatchBinDbz: 0.5,
  // Given a third scan: how fast the growth/decay tendency is itself allowed to
  // change, and how much of the measured motion acceleration is trusted.
  maxTrendRateDbzPerMinute2: 0.025,
  // A second difference is signal proportional to the baseline it was measured
  // over, divided by a noise that does not shrink with it. So the fraction of
  // the measured acceleration worth believing is the Wiener weight
  // gap² / (gap² + accelBaselineMinutes²) — near a third when two touching
  // 8-minute intervals are all there is, and most of it once the two velocities
  // are a quarter of an hour apart. Calibrated against synthetic storms on a
  // known accelerating flow.
  accelBaselineMinutes: 6.5,
  maxAccelDampen: 0.9,
  // The acceleration correction may never rewrite more than this fraction of a
  // parcel's steady-flow displacement, so a noisy third scan cannot fling an
  // echo somewhere the two-scan estimate would never have put it.
  maxAccelDisplacementFraction: 0.4,
  // Trajectories are integrated on a coarse lattice and the resulting
  // displacement field is interpolated to full resolution. Displacements vary on
  // the motion field's tile scale (tens of cells), so this is exact to well
  // under a cell while making a CONUS-wide advection affordable.
  trajectoryLatticeStep: 4,
  // Leads are trimmed when the tracking quality cannot support them.
  minQualityFor30Min: 0.50,
  minQualityFor20Min: 0.36,
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

/**
 * Max-pool the part of a regular lat/lon grid that covers `bounds` down to at
 * most `maxWidth` x `maxHeight` cells.
 *
 * A native MRMS CONUS field is ~24.5 M cells; the extrapolation only ever needs
 * the viewed area, and cropping first is what keeps the motion search and the
 * advection bounded. Max pooling (not averaging) preserves convective cores.
 */
export function cropLatLonGrid(grid, bounds, { maxWidth, maxHeight }) {
  const ni = Number(grid?.ni);
  const nj = Number(grid?.nj);
  const lon1 = Number(grid?.lon1);
  const lat1 = Number(grid?.lat1);
  const di = Number(grid?.di);
  const dj = Number(grid?.dj);
  if (
    !Number.isInteger(ni) || !Number.isInteger(nj) ||
    ![lon1, lat1, di, dj].every(Number.isFinite) ||
    !(di > 0) || !(dj > 0)
  ) {
    throw new TypeError('MRMS grid has invalid latitude/longitude geometry');
  }

  const col0 = Math.max(0, Math.floor((bounds.west - lon1) / di));
  const col1 = Math.min(ni - 1, Math.ceil((bounds.east - lon1) / di));
  const row0 = Math.max(0, Math.floor((lat1 - bounds.north) / dj));
  const row1 = Math.min(nj - 1, Math.ceil((lat1 - bounds.south) / dj));
  if (col1 < col0 || row1 < row0) {
    throw new RangeError('selected map area is outside MRMS CONUS coverage');
  }

  const sourceWidth = col1 - col0 + 1;
  const sourceHeight = row1 - row0 + 1;
  const factor = Math.max(
    1,
    Math.ceil(sourceWidth / maxWidth),
    Math.ceil(sourceHeight / maxHeight),
  );
  const width = Math.ceil(sourceWidth / factor);
  const height = Math.ceil(sourceHeight / factor);
  const values = new Float32Array(width * height);
  values.fill(NaN);
  for (let outRow = 0; outRow < height; outRow++) {
    const sourceRow = row0 + outRow * factor;
    for (let outCol = 0; outCol < width; outCol++) {
      const sourceCol = col0 + outCol * factor;
      let best = -Infinity;
      let found = false;
      for (let dy = 0; dy < factor && sourceRow + dy <= row1; dy++) {
        const base = (sourceRow + dy) * ni + sourceCol;
        for (let dx = 0; dx < factor && sourceCol + dx <= col1; dx++) {
          const value = Number(grid.values[base + dx]);
          if (Number.isFinite(value) && (!found || value > best)) {
            best = value;
            found = true;
          }
        }
      }
      if (found) values[outRow * width + outCol] = best;
    }
  }
  return {
    ...grid,
    proj: 'latlon',
    ni: width,
    nj: height,
    lon1: lon1 + (col0 + (factor - 1) / 2) * di,
    lat1: lat1 - (row0 + (factor - 1) / 2) * dj,
    di: di * factor,
    dj: dj * factor,
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

// Vertex of the parabola through three scores sampled one cell apart. Only a
// real maximum (a downward parabola) yields a shift; anything else keeps the
// integer peak.
function parabolicOffset(low, mid, high) {
  const denom = low - 2 * mid + high;
  if (!(denom < -1e-9)) return 0;
  return clamp(0.5 * (low - high) / denom, -0.5, 0.5);
}

// The block search only ever lands on whole cells, so an 8-minute scan pair
// quantises motion to ~0.125 cell/min — nearly four cells of position error by
// the 30-minute lead. Fitting a parabola through the neighbouring scores
// recovers the sub-cell peak, which is where most of the extra accuracy in a
// half-hour extrapolation comes from.
function refineDisplacement(
  previous,
  latest,
  width,
  height,
  best,
  region,
  sampleStep,
  minSamples,
) {
  const scoreAt = (dx, dy) => displacementScore(
    previous, latest, width, height, dx, dy, region, sampleStep, minSamples,
  )?.score ?? null;
  const west = scoreAt(best.dx - 1, best.dy);
  const east = scoreAt(best.dx + 1, best.dy);
  const north = scoreAt(best.dx, best.dy - 1);
  const south = scoreAt(best.dx, best.dy + 1);
  return {
    dxSub: best.dx + (west !== null && east !== null
      ? parabolicOffset(west, best.score, east)
      : 0),
    dySub: best.dy + (north !== null && south !== null
      ? parabolicOffset(north, best.score, south)
      : 0),
  };
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

// Median motion-compensated dBZ change in a tile, plus how much echo *coverage*
// the tile gained or lost once the motion is removed. A histogram avoids
// allocating thousands of short-lived arrays while local vectors are searched.
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
  let previousEcho = 0;
  let gained = 0;
  let lost = 0;
  for (let y = region.y0; y < region.y1; y++) {
    const sourceY = y - dy;
    if (sourceY < 0 || sourceY >= latestGrid.nj) continue;
    for (let x = region.x0; x < region.x1; x++) {
      const sourceX = x - dx;
      if (sourceX < 0 || sourceX >= latestGrid.ni) continue;
      const oldValue = Number(previousGrid.values[sourceY * latestGrid.ni + sourceX]);
      const newValue = Number(latestGrid.values[y * latestGrid.ni + x]);
      if (!Number.isFinite(oldValue) || !Number.isFinite(newValue)) continue;
      const hadEcho = oldValue >= echoThreshold;
      const hasEcho = newValue >= echoThreshold;
      if (hadEcho) previousEcho++;
      if (hasEcho && !hadEcho) gained++;
      if (hadEcho && !hasEcho) lost++;
      // Requiring a matched echo in both scans avoids treating a translated edge
      // or a newly uncovered background cell as explosive growth/decay.
      if (!hadEcho || !hasEcho) continue;
      const difference = clamp(newValue - oldValue, -20, 20);
      bins[Math.round((difference + 20) * 2)]++;
      count++;
    }
  }
  // Coverage change as a fraction of the tile's echo area per minute; it is the
  // clearest signal that a line is building outward or falling apart, which a
  // median dBZ tendency over matched cells alone cannot see.
  const areaTrend = previousEcho >= 8
    ? clamp((gained - lost) / previousEcho / intervalMinutes, -0.1, 0.1)
    : 0;
  if (count < 8) return { trend: 0, count, areaTrend };
  const target = Math.ceil(count / 2);
  let cumulative = 0;
  let bin = 40;
  for (let i = 0; i < bins.length; i++) {
    cumulative += bins[i];
    if (cumulative >= target) { bin = i; break; }
  }
  return { trend: ((bin / 2) - 20) / intervalMinutes, count, areaTrend };
}

// Replace every tile with the median of its 3x3 neighbourhood.
function medianSmoothTiles(values, columns, rows) {
  const output = new Float32Array(values.length);
  const window = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      window.length = 0;
      for (let oy = -1; oy <= 1; oy++) {
        const ny = y + oy;
        if (ny < 0 || ny >= rows) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox;
          if (nx < 0 || nx >= columns) continue;
          window.push(values[ny * columns + nx]);
        }
      }
      output[y * columns + x] = median(window);
    }
  }
  return output;
}

// Second differences across three scans: how fast each tile's motion and its
// growth/decay tendency are themselves changing. `prior` describes the earlier
// interval and must share this field's tile layout, which it does whenever both
// estimates ran on the same cropped geometry.
//
// The two velocity estimates are also a free consistency check: tiles where they
// disagree by more than the search could resolve are tiles whose vector is noise,
// so their acceleration is dropped and their confidence cut.
function deriveSecondOrder(field, prior, intervalMinutes, config) {
  if (
    !prior ||
    prior.columns !== field.columns ||
    prior.rows !== field.rows
  ) return;

  const length = field.columns * field.rows;
  // Each velocity describes the middle of the interval it was measured over, so
  // the two are separated by the distance between those midpoints — not by an
  // interval length. Measuring the earlier one further back lengthens this
  // baseline, and a second difference of two block searches needs all the
  // baseline it can get to rise above its own noise.
  const gapMinutes = Number(prior.midpointBeforeLatestMinutes) - intervalMinutes / 2;
  if (!(gapMinutes > 0)) return;
  const dampen = Math.min(
    config.maxAccelDampen,
    (gapMinutes * gapMinutes) /
      (gapMinutes * gapMinutes + config.accelBaselineMinutes ** 2),
  );
  const ax = new Float32Array(length);
  const ay = new Float32Array(length);
  const trendRate = new Float32Array(length);
  // A vector that moved by more than this between the two intervals is not an
  // accelerating storm, it is a mismatched block.
  const allowedDrift = Math.max(0.35, (field.searchRadius || 4) / intervalMinutes);

  for (let i = 0; i < length; i++) {
    const dvx = field.dxPerMinute[i] - prior.dxPerMinute[i];
    const dvy = field.dyPerMinute[i] - prior.dyPerMinute[i];
    const drift = Math.hypot(dvx, dvy);
    if (drift > allowedDrift) {
      field.confidence[i] *= 0.8;
      continue;
    }
    ax[i] = (dvx / gapMinutes) * dampen;
    ay[i] = (dvy / gapMinutes) * dampen;
    // Both intervals agreeing on the motion is real corroboration; a tile that
    // survives it has earned a little more trust than one scan pair can justify.
    field.confidence[i] = clamp(
      field.confidence[i] * (1 + 0.18 * (1 - drift / allowedDrift)), 0, 1,
    );
    // The same second-difference shrinkage: whether a storm's growth is itself
    // accelerating is exactly as hard to measure as whether its motion is.
    trendRate[i] = clamp(
      ((field.trendDbzPerMinute[i] - prior.trendDbzPerMinute[i]) / gapMinutes) * dampen,
      -config.maxTrendRateDbzPerMinute2,
      config.maxTrendRateDbzPerMinute2,
    );
  }

  // A second difference of two block searches is a noisy quantity — noisy
  // enough that trusting it tile by tile is worse than ignoring it. Taking the
  // neighbourhood median first keeps the part that is coherent across a storm,
  // which is the part that is real, and discards the per-tile jitter.
  field.axPerMinute2 = medianSmoothTiles(ax, field.columns, field.rows);
  field.ayPerMinute2 = medianSmoothTiles(ay, field.columns, field.rows);
  field.trendRateDbzPerMinute2 = medianSmoothTiles(trendRate, field.columns, field.rows);
  field.accelBaselineMinutes = gapMinutes;
  field.accelDampen = dampen;
  // Every tendency is centred on the midpoint of the interval it was measured
  // over, not on the latest scan, so extrapolating forward starts half an
  // interval already elapsed.
  field.baseOffsetMinutes = intervalMinutes / 2;
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
  const areaTrend = new Float32Array(length);
  const confidence = new Float32Array(length);
  const accepted = new Uint8Array(length);
  const sampleCounts = new Uint32Array(length);
  const globalDxPerMinute = (global.dxSub ?? global.dx) / intervalMinutes;
  const globalDyPerMinute = (global.dySub ?? global.dy) / intervalMinutes;

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
        dx[index] = globalDxPerMinute;
        dy[index] = globalDyPerMinute;
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
      const refined = refineDisplacement(
        previousSignal,
        latestSignal,
        width,
        height,
        candidate,
        region,
        sampleStep,
        minSamples,
      );

      dx[index] = refined.dxSub / intervalMinutes;
      dy[index] = refined.dySub / intervalMinutes;
      // Asymmetric: a measured decay is trusted further than a measured growth.
      // See maxDecayDbzPerMinute — a cell that is falling apart between two
      // scans really can lose reflectivity that fast, whereas a growth signal
      // of the same size is far more often a tracking artefact.
      trend[index] = clamp(
        tendency.trend,
        -config.maxDecayDbzPerMinute,
        config.maxTrendDbzPerMinute,
      ) * trendConfidence;
      areaTrend[index] = tendency.areaTrend * trendConfidence;
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
  const smoothAreaTrend = new Float32Array(areaTrend);
  const smoothConfidence = new Float32Array(confidence);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < columns; tx++) {
      const index = ty * columns + tx;
      const nearDx = [];
      const nearDy = [];
      const nearTrend = [];
      const nearArea = [];
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
          nearArea.push(areaTrend[ni]);
          nearConfidence.push(confidence[ni]);
        }
      }
      if (!nearDx.length) continue;
      const mdx = median(nearDx);
      const mdy = median(nearDy);
      const mtrend = median(nearTrend);
      const marea = median(nearArea);
      if (accepted[index]) {
        const deviation = Math.hypot(dx[index] - mdx, dy[index] - mdy);
        const allowed = Math.max(0.35, radius / intervalMinutes);
        const localWeight = deviation > allowed ? 0.25 : 0.72;
        smoothDx[index] = dx[index] * localWeight + mdx * (1 - localWeight);
        smoothDy[index] = dy[index] * localWeight + mdy * (1 - localWeight);
        smoothTrend[index] = trend[index] * 0.7 + mtrend * 0.3;
        smoothAreaTrend[index] = areaTrend[index] * 0.7 + marea * 0.3;
      } else if (nearDx.length >= 2) {
        smoothDx[index] = mdx;
        smoothDy[index] = mdy;
        smoothTrend[index] = mtrend * 0.65;
        smoothAreaTrend[index] = marea * 0.65;
        smoothConfidence[index] = median(nearConfidence) * 0.65;
      }
    }
  }

  return {
    columns,
    rows,
    stride,
    tileSize,
    searchRadius: radius,
    intervalMinutes,
    dxPerMinute: smoothDx,
    dyPerMinute: smoothDy,
    trendDbzPerMinute: smoothTrend,
    areaTrendPerMinute: smoothAreaTrend,
    confidence: smoothConfidence,
    accepted,
    sampleCounts,
    // Filled in by deriveSecondOrder when a third scan is available.
    axPerMinute2: null,
    ayPerMinute2: null,
    trendRateDbzPerMinute2: null,
    baseOffsetMinutes: 0,
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

// Bilinear read of a regular lattice laid over the grid every `step` cells. The
// trajectory integration runs on such a lattice rather than per cell.
function latticeSample(array, columns, rows, step, x, y) {
  const gx = clamp(x / step, 0, columns - 1);
  const gy = clamp(y / step, 0, rows - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(columns - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const fx = gx - x0;
  const fy = gy - y0;
  const top = y0 * columns;
  const bottom = y1 * columns;
  return (array[top + x0] * (1 - fx) + array[top + x1] * fx) * (1 - fy) +
    (array[bottom + x0] * (1 - fx) + array[bottom + x1] * fx) * fy;
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
  const areaValues = [];
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
    areaValues.push(field.areaTrendPerMinute?.[i] ?? 0);
    weights.push(weight);
    localQualities.push(field.confidence[i]);
  }

  const dxCells = Number.isFinite(weightedMedian(dxValues, weights))
    ? weightedMedian(dxValues, weights)
    : (global.dxSub ?? global.dx);
  const dyCells = Number.isFinite(weightedMedian(dyValues, weights))
    ? weightedMedian(dyValues, weights)
    : (global.dySub ?? global.dy);
  const trendDbzPerMinute = Number.isFinite(weightedMedian(trendValues, weights))
    ? weightedMedian(trendValues, weights)
    : 0;
  const areaTrendPerMinute = Number.isFinite(weightedMedian(areaValues, weights))
    ? weightedMedian(areaValues, weights)
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
  // Coverage change over the next half hour if the observed trend holds.
  const areaChangePercent = clamp(areaTrendPerMinute * 30 * 100, -95, 300);
  const coverage = areaChangePercent > 8
    ? 'expanding'
    : areaChangePercent < -8
      ? 'shrinking'
      : 'holding';
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
    trendDbzPer30Min: trendDbzPerMinute * 30,
    intensity,
    areaTrendPerMinute,
    areaChangePercent,
    coverage,
    quality,
    confidence: quality >= 0.6 ? 'high' : quality >= 0.4 ? 'moderate' : 'low',
    acceptedTiles,
    tileCount: field.accepted.length,
    evolution: coverage === 'holding'
      ? intensity
      : `${intensity}, coverage ${coverage}`,
    text: direction === 'Stationary'
      ? `Nearly stationary; ${intensity}${coverage === 'holding' ? '' : `, coverage ${coverage}`}`
      : `Moving ${direction} at ${Math.round(speedMps * 2.2369362921)} mph; ` +
        `${intensity}${coverage === 'holding' ? '' : `, coverage ${coverage}`}`,
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
  const globalSampleStep = Math.max(1, Math.ceil(Math.max(width, height) / 600));
  const refinedGlobal = refineDisplacement(
    previousSignal,
    latestSignal,
    width,
    height,
    global,
    null,
    globalSampleStep,
    8,
  );
  global.dxSub = refinedGlobal.dxSub;
  global.dySub = refinedGlobal.dySub;
  const field = localMotionField(
    previousGrid,
    latestGrid,
    previousSignal,
    latestSignal,
    global,
    intervalMinutes,
    config,
  );
  deriveSecondOrder(field, options.priorField, intervalMinutes, config);
  const dominant = dominantSummary(field, latestGrid, intervalMinutes, global);

  return {
    accepted: true,
    intervalMinutes,
    secondOrder: Boolean(field.axPerMinute2),
    global: {
      dxCells: global.dxSub,
      dyCells: global.dySub,
      dxCellsWhole: global.dx,
      dyCellsWhole: global.dy,
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

// Mean of the finite samples within `radius` cells, ignoring holes and treating
// deep "no coverage" codes as a floor so they cannot drag an echo edge down.
//
// Running prefix sums make this cost the same whatever the radius, which matters
// because the scale decomposition below blurs the whole domain several times per
// forecast lead.
function boxBlurNaN(input, width, height, radius, floorValue) {
  const horizontal = new Float32Array(input.length);
  const output = new Float32Array(input.length);
  const sums = new Float64Array(Math.max(width, height) + 1);
  const counts = new Int32Array(Math.max(width, height) + 1);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    sums[0] = 0;
    counts[0] = 0;
    for (let x = 0; x < width; x++) {
      const sample = input[row + x];
      const usable = Number.isFinite(sample);
      sums[x + 1] = sums[x] + (usable ? (sample < floorValue ? floorValue : sample) : 0);
      counts[x + 1] = counts[x] + (usable ? 1 : 0);
    }
    for (let x = 0; x < width; x++) {
      const from = x - radius > 0 ? x - radius : 0;
      const to = x + radius < width - 1 ? x + radius : width - 1;
      const count = counts[to + 1] - counts[from];
      horizontal[row + x] = count ? (sums[to + 1] - sums[from]) / count : NaN;
    }
  }

  for (let x = 0; x < width; x++) {
    sums[0] = 0;
    counts[0] = 0;
    for (let y = 0; y < height; y++) {
      const sample = horizontal[y * width + x];
      const usable = Number.isFinite(sample);
      sums[y + 1] = sums[y] + (usable ? sample : 0);
      counts[y + 1] = counts[y] + (usable ? 1 : 0);
    }
    for (let y = 0; y < height; y++) {
      const from = y - radius > 0 ? y - radius : 0;
      const to = y + radius < height - 1 ? y + radius : height - 1;
      const count = counts[to + 1] - counts[from];
      output[y * width + x] = count ? (sums[to + 1] - sums[from]) / count : NaN;
    }
  }
  return output;
}

/* ── Reflectivity ↔ rain rate ────────────────────────────────────────────────
   Z = a·R^b (Marshall–Palmer), with dBZ = 10·log₁₀ Z. Exported so callers that
   want a precipitation estimate out of a forecast frame use the same relation
   the smoothing below is built on. */
export function reflectivityToRainRate(dbz, options = {}) {
  const config = configured(options);
  if (!Number.isFinite(dbz)) return NaN;
  const z = Math.pow(10, dbz / 10);
  return Math.pow(z / config.zrCoefficient, 1 / config.zrExponent);
}

export function rainRateToReflectivity(rate, options = {}) {
  const config = configured(options);
  if (!Number.isFinite(rate) || rate <= 0) return MATCH_FLOOR_DBZ;
  return 10 * Math.log10(config.zrCoefficient * Math.pow(rate, config.zrExponent));
}

// Damp the forecast by spatial scale instead of blurring it uniformly.
//
// Extrapolation skill is not one number: the large-scale rain pattern is very
// nearly persistent over half an hour, the meso-scale envelope holds for tens of
// minutes, and individual convective cells are unrecognisable after ten. Splitting
// the field into those three bands and shrinking each toward the next larger one
// on its own timescale reproduces that, so a 30-minute frame keeps the shape of
// the system while giving up the cell-by-cell detail it genuinely cannot know.
// The band widths come from the position error, so a well-tracked field is cut
// far less than a marginal one.
//
// All of that happens in *rain rate*, not in dBZ. dBZ is 10·log₁₀ Z, so
// averaging dBZ takes a geometric mean of Z — always below the arithmetic one,
// and further below it the more the values in the window differ. Smoothing a
// reflectivity field in dBZ therefore destroys precipitation as a pure artefact
// of the smoothing, and because the smoothing radius grows with lead time the
// loss compounds: the 30-minute frame was reporting materially less water than
// the field it was built from, which is exactly the accumulation a viewer reads
// off the future half of the timeline. Converting to rain rate first makes each
// box mean conserve water, so a forecast frame redistributes the observed
// precipitation instead of quietly evaporating it.
function dampenByScale(values, width, height, leadMinutes, radius, quality, config) {
  if (radius < 1) return values;
  const toRate = (dbz) => Math.pow(Math.pow(10, dbz / 10) / config.zrCoefficient, 1 / config.zrExponent);
  const toDbz = (rate) =>
    rate > 0 ? 10 * Math.log10(config.zrCoefficient * Math.pow(rate, config.zrExponent)) : MATCH_FLOOR_DBZ;

  const rates = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    rates[i] = Number.isFinite(value) ? toRate(value) : NaN;
  }
  const floorRate = toRate(config.echoThreshold - 15);
  const meso = boxBlurNaN(rates, width, height, radius, floorRate);
  const large = boxBlurNaN(meso, width, height, radius * 3, floorRate);
  // Confidence stretches both timescales rather than changing the shape of the
  // decay: tracking a storm well means its detail stays believable for longer.
  const stretch = 0.55 + 0.9 * quality;
  const smallWeight = Math.exp(-leadMinutes / (config.smallScaleTauMinutes * stretch));
  const mesoWeight = Math.exp(-leadMinutes / (config.mesoScaleTauMinutes * stretch));
  for (let i = 0; i < values.length; i++) {
    const rate = rates[i];
    const middle = meso[i];
    const broad = large[i];
    if (!Number.isFinite(rate) || !Number.isFinite(middle) || !Number.isFinite(broad)) {
      continue;
    }
    const blended = broad + (middle - broad) * mesoWeight + (rate - middle) * smallWeight;
    values[i] = toDbz(blended);
  }
  return values;
}

const MATCH_FLOOR_DBZ = -35;
const MATCH_CEILING_DBZ = 100;

// Rank-match `values` onto the distribution of `reference` (the same forecast
// before it was damped).
//
// Damping is what puts the rain in a defensible *place*; on its own it also
// flattens every peak, which is why smoothed nowcasts chronically under-forecast
// heavy rain. Because the damping is monotone-ish but not intensity-preserving,
// re-imposing the undamped histogram by rank restores real 50-60 dBZ cores — and
// with them realistic rain rates — without moving anything.
function matchDistribution(values, reference, config) {
  const binSize = Math.max(0.1, config.probabilityMatchBinDbz);
  const bins = Math.ceil((MATCH_CEILING_DBZ - MATCH_FLOOR_DBZ) / binSize) + 1;
  const binOf = (value) =>
    clamp(Math.round((value - MATCH_FLOOR_DBZ) / binSize), 0, bins - 1);

  const sourceHistogram = new Uint32Array(bins);
  const targetHistogram = new Uint32Array(bins);
  let sourceCount = 0;
  let targetCount = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (Number.isFinite(value)) { sourceHistogram[binOf(value)]++; sourceCount++; }
    const target = reference[i];
    if (Number.isFinite(target)) { targetHistogram[binOf(target)]++; targetCount++; }
  }
  if (!sourceCount || !targetCount) return values;

  // Walk both cumulative distributions once, so bin b of the forecast takes the
  // value standing at the same rank in the reference.
  const lookup = new Float32Array(bins);
  let targetBin = 0;
  let targetBelow = 0;
  let sourceBelow = 0;
  for (let bin = 0; bin < bins; bin++) {
    const population = sourceHistogram[bin];
    if (!population) {
      lookup[bin] = MATCH_FLOOR_DBZ + bin * binSize;
      continue;
    }
    const wanted = ((sourceBelow + population / 2) / sourceCount) * targetCount;
    sourceBelow += population;
    while (
      targetBin < bins - 1 &&
      targetBelow + targetHistogram[targetBin] < wanted
    ) {
      targetBelow += targetHistogram[targetBin];
      targetBin++;
    }
    const within = targetHistogram[targetBin]
      ? clamp((wanted - targetBelow) / targetHistogram[targetBin], 0, 1)
      : 0.5;
    lookup[bin] = MATCH_FLOOR_DBZ + (targetBin + within - 0.5) * binSize;
  }

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (Number.isFinite(value)) values[i] = lookup[binOf(value)];
  }
  return values;
}

function averageCellKm(grid) {
  const centerLat = Number(grid.lat1) - ((grid.nj - 1) * Number(grid.dj)) / 2;
  const kmX = Number(grid.di) * 111.32 *
    Math.max(0.15, Math.cos(centerLat * Math.PI / 180));
  const kmY = Number(grid.dj) * 111.32;
  return (kmX + kmY) / 2;
}

// ∫₀ᴸ e^(-s/τ) ds — how many minutes of a steady tendency actually land by lead
// L. A tendency that simply ran for the whole lead would turn a two-scan blip
// into a 20 dBZ swing, so it saturates: most of the change arrives early.
function tendencyMinutes(lead, tau) {
  return tau * (1 - Math.exp(-lead / tau));
}

// ∫₀ᴸ (L - s + offset) e^(-s/τ) ds — the same weighting applied to a tendency
// that is itself changing at a constant rate, so a storm that is not just
// growing but growing *faster* is carried forward as one. `offset` is the half
// interval that had already elapsed when the tendency was measured.
function tendencyRateMinutes(lead, tau, offset) {
  const decay = Math.exp(-lead / tau);
  const firstMoment = tau * tau * (1 - decay) - tau * lead * decay;
  return (lead + offset) * tendencyMinutes(lead, tau) - firstMoment;
}

/**
 * Backward-advect the latest reflectivity through a motion field, once per
 * requested lead, returning the forecasts in ascending lead order.
 *
 * The back-trajectories are integrated in bounded substeps (each with its own
 * midpoint correction) so a parcel follows curving or diverging flow, and they
 * are integrated *once* for the whole set: every lead is a checkpoint on the
 * same trajectory rather than a fresh integration, which is both cheaper and
 * self-consistent between frames. Integration runs on a coarse lattice and the
 * resulting displacement field is interpolated back to full resolution — the
 * motion field varies on a tile scale of tens of cells, so this is exact to far
 * under one cell.
 *
 * Returns an iterator so a caller can publish each frame the moment it is ready
 * instead of waiting for the whole set; the arguments are validated eagerly, not
 * on the first `next()`.
 */
export function advectReflectivityStream(latestGrid, motion, leadsMinutes, options = {}) {
  const config = configured(options);
  const problem = validateGrid(latestGrid, 'latest grid');
  if (problem) throw new TypeError(problem);
  if (!motion?.accepted || !motion.field) {
    throw new TypeError('an accepted motion estimate is required');
  }
  const leads = Array.from(leadsMinutes ?? [])
    .map(Number)
    .filter((lead) => Number.isFinite(lead) && lead > 0)
    .sort((a, b) => a - b);
  if (!leads.length) {
    throw new TypeError('at least one positive forecast lead is required');
  }

  const field = motion.field;
  const width = latestGrid.ni;
  const height = latestGrid.nj;
  const quality = clamp(Number(motion.quality ?? motion.dominant?.quality ?? 0.5), 0, 1);
  // A poorly tracked field gets less of its own tendency, not more.
  const trendScale = 0.35 + 0.65 * quality;
  const tau = config.trendTauMinutes;
  const offsetMinutes = field.baseOffsetMinutes || 0;
  const accelerating = Boolean(field.axPerMinute2 && field.ayPerMinute2);
  const edgeReach = Math.max(1, config.growthEdgeDbz);
  const growthFloor = config.echoThreshold - edgeReach;
  const cellKm = averageCellKm(latestGrid);

  const latticeStep = Math.max(1, Math.round(config.trajectoryLatticeStep));
  const columns = Math.max(2, Math.ceil((width - 1) / latticeStep) + 1);
  const rows = Math.max(2, Math.ceil((height - 1) / latticeStep) + 1);
  const points = columns * rows;
  const originX = new Float32Array(points);
  const originY = new Float32Array(points);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      originX[j * columns + i] = Math.min(i * latticeStep, width - 1);
      originY[j * columns + i] = Math.min(j * latticeStep, height - 1);
    }
  }
  const pathX = Float32Array.from(originX);
  const pathY = Float32Array.from(originY);
  // ∫ a ds and ∫ a·s ds along the steady path. Together they give the
  // first-order acceleration correction to the displacement at any lead, which
  // is what lets one shared trajectory set carry a time-varying velocity.
  const accelX = accelerating ? new Float32Array(points) : null;
  const accelY = accelerating ? new Float32Array(points) : null;
  const accelMomentX = accelerating ? new Float32Array(points) : null;
  const accelMomentY = accelerating ? new Float32Array(points) : null;

  const displacementX = new Float32Array(points);
  const displacementY = new Float32Array(points);
  const tendencyDbz = new Float32Array(points);
  const areaTrend = new Float32Array(points);

  let elapsed = 0;

  function* stream() {
    for (const lead of leads) {
      while (elapsed < lead - 1e-9) {
        const substep = Math.min(config.advectionStepMinutes, lead - elapsed);
        const midpointS = elapsed + substep / 2;
        for (let index = 0; index < points; index++) {
          const x = pathX[index];
          const y = pathY[index];
          const startX = sampleField(field, field.dxPerMinute, x, y);
          const startY = sampleField(field, field.dyPerMinute, x, y);
          const midX = x - startX * substep * 0.5;
          const midY = y - startY * substep * 0.5;
          pathX[index] = x - sampleField(field, field.dxPerMinute, midX, midY) * substep;
          pathY[index] = y - sampleField(field, field.dyPerMinute, midX, midY) * substep;
          if (!accelerating) continue;
          const ax = sampleField(field, field.axPerMinute2, midX, midY);
          const ay = sampleField(field, field.ayPerMinute2, midX, midY);
          accelX[index] += ax * substep;
          accelY[index] += ay * substep;
          accelMomentX[index] += ax * midpointS * substep;
          accelMomentY[index] += ay * midpointS * substep;
        }
        elapsed += substep;
      }

      const steadyMinutes = tendencyMinutes(lead, tau);
      const rateMinutes = tendencyRateMinutes(lead, tau, offsetMinutes);
      for (let index = 0; index < points; index++) {
        let dx = pathX[index] - originX[index];
        let dy = pathY[index] - originY[index];
        if (accelerating) {
          const limit = config.maxAccelDisplacementFraction * Math.hypot(dx, dy);
          const correctionX = (lead + offsetMinutes) * accelX[index] - accelMomentX[index];
          const correctionY = (lead + offsetMinutes) * accelY[index] - accelMomentY[index];
          dx -= clamp(correctionX, -limit, limit);
          dy -= clamp(correctionY, -limit, limit);
        }
        displacementX[index] = dx;
        displacementY[index] = dy;
        // The tendency is a property of the storm, so it is read once at the
        // trajectory's origin — the storm whose recent evolution is being carried
        // forward to this cell — and held along the path.
        const x = originX[index] + dx;
        const y = originY[index] + dy;
        const trend = sampleField(field, field.trendDbzPerMinute, x, y);
        const rate = field.trendRateDbzPerMinute2
          ? sampleField(field, field.trendRateDbzPerMinute2, x, y)
          : 0;
        // Asymmetric on purpose — see maxDecayDeltaDbz. Growth stays tightly
        // capped so a noisy trend cannot invent a storm; decay is given more
        // room so a collapsing cell is allowed to actually go away.
        tendencyDbz[index] = clamp(
          (trend * steadyMinutes + rate * rateMinutes) * trendScale,
          -config.maxDecayDeltaDbz,
          config.maxTrendDeltaDbz,
        );
        areaTrend[index] = field.areaTrendPerMinute
          ? sampleField(field, field.areaTrendPerMinute, x, y)
          : 0;
      }

      const values = new Float32Array(width * height);
      values.fill(NaN);
      for (let y = 0; y < height; y++) {
        // The lattice row weights are shared by the whole scan line.
        const gy = clamp(y / latticeStep, 0, rows - 1);
        const row0 = Math.floor(gy);
        const row1 = Math.min(rows - 1, row0 + 1);
        const fy = gy - row0;
        const top = row0 * columns;
        const bottom = row1 * columns;
        for (let x = 0; x < width; x++) {
          const gx = clamp(x / latticeStep, 0, columns - 1);
          const column0 = Math.floor(gx);
          const column1 = Math.min(columns - 1, column0 + 1);
          const fx = gx - column0;
          const wTopLeft = (1 - fx) * (1 - fy);
          const wTopRight = fx * (1 - fy);
          const wBottomLeft = (1 - fx) * fy;
          const wBottomRight = fx * fy;
          const topLeft = top + column0;
          const topRight = top + column1;
          const bottomLeft = bottom + column0;
          const bottomRight = bottom + column1;
          const mix = (array) =>
            array[topLeft] * wTopLeft + array[topRight] * wTopRight +
            array[bottomLeft] * wBottomLeft + array[bottomRight] * wBottomRight;

          const value = bilinearFinite(
            latestGrid.values, width, height, x + mix(displacementX), y + mix(displacementY),
          );
          if (!Number.isFinite(value)) continue;
          const tendency = mix(tendencyDbz);
          // Inside the echo the tendency applies in full. Just outside it, it
          // tapers off — so a growing storm can push its edge outward across the
          // display threshold and a collapsing one can pull it back, instead of
          // every storm keeping exactly the footprint it has now.
          let reach = 1;
          if (value < config.echoThreshold) {
            // Outward growth is also gated on the coverage trend: a storm whose
            // echo area is shrinking should not spread just because its core
            // brightened.
            const expanding = clamp(0.35 + mix(areaTrend) * 12, 0, 1);
            reach = value > growthFloor
              ? ((value - growthFloor) / edgeReach) * (tendency > 0 ? expanding : 1)
              : 0;
          }
          values[y * width + x] = value + tendency * reach;
        }
      }

      // Position error grows with lead and shrinks with tracking quality: it sets
      // the scale the damping works over, so a well tracked squall line keeps its
      // structure at 30 minutes while a marginal match becomes the soft envelope
      // it deserves to be.
      const spreadKm = config.uncertaintyKmPerHour * (lead / 60) * (0.95 - 0.65 * quality);
      const radius = Math.min(
        config.maxSmoothRadiusCells,
        Math.round(cellKm > 0 ? spreadKm / cellKm : 0),
      );
      // Kept before the damping so the intensity distribution can be restored from
      // the forecast's own undamped values rather than from the observation.
      const undamped = config.probabilityMatch && radius >= 1
        ? Float32Array.from(values)
        : null;
      dampenByScale(values, width, height, lead, radius, quality, config);
      if (undamped) matchDistribution(values, undamped, config);

      const latestTime = toMillis(latestGrid.time ?? latestGrid.validTime);
      const validMillis = Number.isFinite(latestTime) ? latestTime + lead * 60000 : NaN;
      yield {
        ...latestGrid,
        values,
        leadMinutes: lead,
        kind: 'forecast',
        extrapolated: true,
        // How much of the tracking quality survives to this lead, for callers that
        // want to label or trim frames.
        confidence: clamp(quality * Math.exp(-lead / 60), 0, 1),
        uncertaintyKm: Number(spreadKm.toFixed(2)),
        time: Number.isFinite(validMillis) ? new Date(validMillis) : null,
        validTime: Number.isFinite(validMillis) ? new Date(validMillis) : null,
      };
    }
  }

  return stream();
}

/** Every requested lead, in ascending order, off one shared trajectory set. */
export function advectReflectivitySeries(latestGrid, motion, leadsMinutes, options = {}) {
  return Array.from(advectReflectivityStream(latestGrid, motion, leadsMinutes, options));
}

/**
 * Backward-advect the latest reflectivity to a single lead.
 *
 * Callers that want several leads should use `advectReflectivityStream`, which
 * shares one set of trajectories across the whole set instead of re-integrating
 * from the base time for every frame.
 */
export function advectReflectivityGrid(latestGrid, motion, leadMinutes, options = {}) {
  if (!Number.isFinite(Number(leadMinutes)) || Number(leadMinutes) <= 0) {
    throw new TypeError('leadMinutes must be positive');
  }
  return advectReflectivitySeries(latestGrid, motion, [Number(leadMinutes)], options)[0];
}

// The motion field of the interval *before* the tracked pair, or null when there
// is no usable third scan. Everything here is best-effort: a scan that is
// missing, mis-shaped, badly spaced or simply untrackable just means the nowcast
// falls back to the two-scan behaviour.
function earlierMotionField(pair, referenceGrid, latestMillis, factor, config) {
  if (!pair) return null;
  const [fromGrid, toGrid] = pair;
  if (validateGrid(fromGrid, 'earlier grid') || validateGrid(toGrid, 'earlier grid')) {
    return null;
  }
  if (!sameGeometry(fromGrid, referenceGrid) || !sameGeometry(toGrid, referenceGrid)) {
    return null;
  }
  const fromMillis = toMillis(fromGrid.time ?? fromGrid.validTime);
  const toMillisValue = toMillis(toGrid.time ?? toGrid.validTime);
  if (!Number.isFinite(fromMillis) || !Number.isFinite(toMillisValue)) return null;
  const intervalMinutes = (toMillisValue - fromMillis) / 60000;
  if (
    intervalMinutes < config.minIntervalMinutes ||
    intervalMinutes > config.maxIntervalMinutes
  ) return null;

  const reduce = (grid, millis) => {
    const reduced = downsampleReflectivityGrid(grid, { ...config, factor });
    reduced.time = new Date(millis);
    reduced.validTime = reduced.time;
    return reduced;
  };
  const motion = estimateReflectivityMotion(
    reduce(fromGrid, fromMillis),
    reduce(toGrid, toMillisValue),
    { ...config, intervalMinutes },
  );
  if (!motion.accepted) return null;
  // Where this velocity sits in time, so the second difference knows its own
  // baseline however far back the pair was taken from.
  motion.field.midpointBeforeLatestMinutes =
    (latestMillis - (fromMillis + toMillisValue) / 2) / 60000;
  return motion.field;
}

/**
 * Everything up to (but not including) the per-lead advection: validation,
 * reduction, motion estimation and the lead list the estimate can support.
 *
 * Splitting this out lets a caller advect one lead at a time — publishing each
 * forecast frame as it becomes available instead of waiting for the whole set —
 * while `buildReflectivityNowcast` keeps the batch behaviour.
 *
 * Returns either:
 *   { accepted:false, code, reason, ...diagnostics }
 * or:
 *   { accepted:true, baseGrid, motion, leadsMinutes, summary, quality, config }
 */
export function prepareReflectivityNowcast(previousGrids, latestGrid, options = {}) {
  const config = configured(options);
  // Callers may pass one earlier scan or a list of them (oldest first). The most
  // recent is what the displacement is measured against; the one before it, if
  // there is a usable one, is what turns growth/decay and motion from a single
  // difference into a fitted rate of change.
  const priors = (Array.isArray(previousGrids) ? previousGrids : [previousGrids])
    .filter(Boolean);
  const previousGrid = priors[priors.length - 1];
  // The rate-of-change pair is taken from the *front* of the list, so a caller
  // that supplies three earlier scans gets its acceleration measured over the
  // longest baseline available rather than over two touching intervals.
  const earlierPair = priors.length > 1 ? [priors[0], priors[1]] : null;
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

  // The scan before the pair, when there is a usable one, gives a second
  // displacement estimate over the same tiles. That is what makes the growth and
  // decay a fitted rate of change rather than one noisy difference, and it also
  // corroborates every vector for free.
  const priorField = earlierMotionField(
    earlierPair, previousGrid, latestMillis, factor, config,
  );
  const motion = estimateReflectivityMotion(previous, latest, {
    ...config,
    intervalMinutes,
    priorField,
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

  const requested = Array.from(options.leadsMinutes || NOWCAST_LEADS_MINUTES)
    .map(Number)
    .filter((lead) => Number.isFinite(lead) && lead > 0)
    .sort((a, b) => a - b);
  if (!requested.length) {
    return rejection('INVALID_LEADS', 'at least one positive forecast lead is required');
  }
  // A weakly tracked field does not earn a half-hour projection. Trimming the
  // range is a better answer than publishing a frame nobody should trust — the
  // shortest lead is always kept so the caller still gets something usable. The
  // ceiling is a fraction of the requested span, so it holds whatever base the
  // caller counts leads from.
  const usableSpan = motion.quality >= config.minQualityFor30Min
    ? 1
    : motion.quality >= config.minQualityFor20Min
      ? 0.68
      : 0.5;
  const leadCeiling = requested[0] +
    (requested[requested.length - 1] - requested[0]) * usableSpan;
  const leads = requested.filter((lead, index) => index === 0 || lead <= leadCeiling + 1e-6);

  return {
    accepted: true,
    kind: 'radar-nowcast',
    method: motion.secondOrder
      ? 'three-scan sub-cell block correlation with scale-damped, ' +
        'probability-matched semi-Lagrangian advection'
      : 'sub-cell block correlation with scale-damped, probability-matched ' +
        'semi-Lagrangian advection',
    scanCount: priorField ? 3 : 2,
    secondOrder: Boolean(motion.secondOrder),
    previousTime: new Date(previousMillis),
    latestTime: new Date(latestMillis),
    intervalMinutes,
    ageMinutes,
    downsampleFactor: factor,
    baseGrid: latest,
    motion,
    leadsMinutes: leads,
    requestedLeadsMinutes: requested,
    leadsTrimmed: leads.length < requested.length,
    summary: motion.dominant,
    quality: motion.quality,
    config,
  };
}

/**
 * End-to-end public API: prepare, then advect every supported lead.
 *
 * Returns either:
 *   { accepted:false, code, reason, ...diagnostics }
 * or:
 *   { accepted:true, baseGrid, motion, forecasts, summary, quality, ... }
 */
export function buildReflectivityNowcast(previousGrids, latestGrid, options = {}) {
  const prepared = prepareReflectivityNowcast(previousGrids, latestGrid, options);
  if (!prepared.accepted) return prepared;
  return {
    ...prepared,
    forecasts: advectReflectivitySeries(
      prepared.baseGrid, prepared.motion, prepared.leadsMinutes, prepared.config,
    ),
  };
}
