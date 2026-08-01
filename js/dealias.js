// Region-based two-dimensional Doppler velocity unfolding.
//
// Gates are grouped into connected velocity bands, neighbouring regions vote
// on their 2*Nyquist offset, and the strongest shared boundaries are solved
// first. This is the same family of approach used by GR2Analyst/Py-ART and is
// substantially more stable in shear than unfolding each radial independently.

function physical(moment, gate) {
  const code = moment?.raw?.[gate] ?? 0;
  return code < 2 ? NaN : (code - moment.offset) / (moment.scale || 1);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : NaN;
}

function encodedMoment(source, values) {
  // Hundredths of a metre per second leaves ample range for strongly folded
  // velocities while retaining more precision than the source product.
  const scale = 100;
  const offset = 32768;
  const raw = new Uint16Array(values.length);
  for (let gate = 0; gate < values.length; gate++) {
    const value = values[gate];
    if (!Number.isFinite(value)) continue;
    raw[gate] = Math.max(2, Math.min(65535, Math.round(value * scale + offset)));
  }
  return {
    ...source,
    gateCount: values.length,
    scale,
    offset,
    raw,
  };
}

export function dealiasVelocitySweep(sweep, { maxFolds = 3 } = {}) {
  const radials = sweep?.radials || [];
  const rayCount = radials.length;
  const moments = radials.map(radial => radial.moments?.VEL || null);
  const gateCounts = moments.map(moment => moment?.gateCount || 0);
  const maxGates = Math.max(0, ...gateCounts);
  if (!rayCount || !maxGates) return sweep;

  const nyquists = radials.map(radial => {
    const value = Number(radial.nyquist);
    return Number.isFinite(value) && value > 0 ? value : NaN;
  });
  const sweepNyquist = median(nyquists);
  if (!Number.isFinite(sweepNyquist)) return sweep;
  const interval = 2 * sweepNyquist;
  const foldsLimit = Math.max(1, Math.min(8, Math.trunc(maxFolds)));
  const values = moments.map((moment, ray) => {
    const out = new Float32Array(gateCounts[ray]);
    for (let gate = 0; gate < out.length; gate++) out[gate] = physical(moment, gate);
    return out;
  });

  // Six bands per Nyquist co-interval prevent an aliased storm core from being
  // merged into ordinary flow of the same sign before boundaries are solved.
  const bandOf = value => Math.max(0, Math.min(5,
    Math.floor(((value + sweepNyquist) / interval) * 6)));
  const regionOf = new Int32Array(rayCount * maxGates).fill(-1);
  const regionSizes = [];
  const stack = new Int32Array(rayCount * maxGates);
  for (let seedRay = 0; seedRay < rayCount; seedRay++) {
    if (!Number.isFinite(nyquists[seedRay])) continue;
    for (let seedGate = 0; seedGate < gateCounts[seedRay]; seedGate++) {
      const seed = seedRay * maxGates + seedGate;
      if (regionOf[seed] !== -1 || !Number.isFinite(values[seedRay][seedGate])) continue;
      const region = regionSizes.length;
      let top = 0;
      let size = 0;
      stack[top++] = seed;
      regionOf[seed] = region;
      while (top) {
        const cell = stack[--top];
        const ray = Math.floor(cell / maxGates);
        const gate = cell - ray * maxGates;
        const band = bandOf(values[ray][gate]);
        size++;
        const visit = (nextRay, nextGate) => {
          nextRay = (nextRay + rayCount) % rayCount;
          if (nextGate < 0 || nextGate >= gateCounts[nextRay]) return;
          const next = nextRay * maxGates + nextGate;
          if (regionOf[next] !== -1 || !Number.isFinite(nyquists[nextRay])) return;
          const value = values[nextRay][nextGate];
          if (!Number.isFinite(value) || bandOf(value) !== band) return;
          regionOf[next] = region;
          stack[top++] = next;
        };
        visit(ray, gate - 1);
        visit(ray, gate + 1);
        visit(ray - 1, gate);
        visit(ray + 1, gate);
      }
      regionSizes.push(size);
    }
  }
  if (!regionSizes.length) return sweep;

  // Each border stores weighted votes for fold(B)-fold(A). Long, clean fold
  // boundaries therefore dominate short noisy shear boundaries.
  const borders = new Map();
  const addBorder = (a, b, va, vb) => {
    if (a === b || a < 0 || b < 0) return;
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    const key = `${low}:${high}`;
    const lowValue = a === low ? va : vb;
    const highValue = a === low ? vb : va;
    const ratio = (lowValue - highValue) / interval;
    const delta = Math.max(-1, Math.min(1, Math.round(ratio)));
    const weight = Math.max(0.05, 1 - Math.abs(ratio - delta));
    let border = borders.get(key);
    if (!border) {
      border = { low, high, weight: 0, votes: [0, 0, 0] };
      borders.set(key, border);
    }
    border.weight += weight;
    border.votes[delta + 1] += weight;
  };
  for (let ray = 0; ray < rayCount; ray++) {
    const nextRay = (ray + 1) % rayCount;
    for (let gate = 0; gate < gateCounts[ray]; gate++) {
      const region = regionOf[ray * maxGates + gate];
      const value = values[ray][gate];
      if (gate + 1 < gateCounts[ray]) {
        addBorder(region, regionOf[ray * maxGates + gate + 1], value, values[ray][gate + 1]);
      }
      if (rayCount > 1 && gate < gateCounts[nextRay]) {
        addBorder(region, regionOf[nextRay * maxGates + gate], value, values[nextRay][gate]);
      }
    }
  }

  const adjacency = Array.from({ length: regionSizes.length }, () => []);
  for (const border of borders.values()) {
    let delta = -1;
    if (border.votes[1] >= border.votes[0] && border.votes[1] >= border.votes[2]) delta = 0;
    else if (border.votes[2] > border.votes[0]) delta = 1;
    adjacency[border.low].push({ other: border.high, delta, weight: border.weight });
    adjacency[border.high].push({ other: border.low, delta: -delta, weight: border.weight });
  }

  const regionFolds = new Int8Array(regionSizes.length);
  const assigned = new Uint8Array(regionSizes.length);
  const roots = [...regionSizes.keys()].sort((a, b) => regionSizes[b] - regionSizes[a]);
  for (const root of roots) {
    if (assigned[root]) continue;
    assigned[root] = 1;
    for (;;) {
      let best = null;
      for (let region = 0; region < adjacency.length; region++) {
        if (!assigned[region]) continue;
        for (const edge of adjacency[region]) {
          if (assigned[edge.other]) continue;
          if (!best || edge.weight > best.edge.weight) best = { region, edge };
        }
      }
      if (!best) break;
      regionFolds[best.edge.other] = Math.max(-foldsLimit, Math.min(foldsLimit,
        regionFolds[best.region] + best.edge.delta));
      assigned[best.edge.other] = 1;
    }
  }

  // A VAD-like whole-sweep anchor removes the otherwise ambiguous global fold.
  const ringMeans = [];
  const stride = Math.max(2, Math.floor(maxGates / 40));
  for (let gate = stride; gate < maxGates; gate += stride) {
    let sum = 0;
    let count = 0;
    for (let ray = 0; ray < rayCount; ray++) {
      if (gate >= gateCounts[ray]) continue;
      const region = regionOf[ray * maxGates + gate];
      if (region < 0) continue;
      sum += values[ray][gate] + regionFolds[region] * interval;
      count++;
    }
    if (count >= Math.min(90, rayCount * 0.65)) ringMeans.push(sum / count);
  }
  const globalMean = median(ringMeans);
  const globalShift = Number.isFinite(globalMean)
    ? Math.max(-foldsLimit, Math.min(foldsLimit, Math.round(globalMean / interval)))
    : 0;

  const unfolded = values.map((rayValues, ray) => {
    const out = Float32Array.from(rayValues);
    const radialInterval = Number.isFinite(nyquists[ray]) ? 2 * nyquists[ray] : interval;
    for (let gate = 0; gate < out.length; gate++) {
      const region = regionOf[ray * maxGates + gate];
      if (region >= 0 && Number.isFinite(out[gate])) {
        out[gate] += (regionFolds[region] - globalShift) * radialInterval;
      }
    }
    return out;
  });

  return {
    ...sweep,
    dealiased: true,
    radials: radials.map((radial, ray) => ({
      ...radial,
      moments: {
        ...radial.moments,
        VEL: encodedMoment(radial.moments?.VEL, unfolded[ray]),
      },
    })),
  };
}
