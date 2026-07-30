// The extrapolation runs in a module worker, so the page never blocks on it. The
// contract that makes that work — motion first, then one message per finished
// lead, then done — is what this exercises, with the older scan supplied inline
// so nothing is fetched.

import test from 'node:test';
import assert from 'node:assert/strict';

const MINUTE = 60_000;
const WIDTH = 140;
const HEIGHT = 96;

function makeGrid(timeMillis) {
  return {
    ni: WIDTH,
    nj: HEIGHT,
    lon1: -77,
    lat1: 41,
    di: 0.01,
    dj: 0.01,
    values: new Float32Array(WIDTH * HEIGHT),
    timeMillis,
  };
}

function addBlob(grid, cx, cy, peak, radius) {
  for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(HEIGHT - 1, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(WIDTH - 1, Math.ceil(cx + radius)); x++) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance > radius) continue;
      grid.values[y * WIDTH + x] = Math.max(
        grid.values[y * WIDTH + x],
        peak * (1 - distance / radius),
      );
    }
  }
  return grid;
}

function shifted(grid, dx, timeMillis) {
  const out = makeGrid(timeMillis);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const sourceX = x - dx;
      if (sourceX < 0 || sourceX >= WIDTH) continue;
      out.values[y * WIDTH + x] = grid.values[y * WIDTH + sourceX];
    }
  }
  return out;
}

// Stand in for the worker global, collecting what the worker posts back. The
// module registers its handler once, on first evaluation, so the stub outlives
// individual runs.
const workerGlobal = { postMessage: () => {} };
let messageHandler = null;
async function workerOnMessage() {
  if (!messageHandler) {
    globalThis.self = workerGlobal;
    await import('../js/nowcast.worker.js');
    messageHandler = workerGlobal.onmessage;
    assert.equal(typeof messageHandler, 'function');
  }
  return messageHandler;
}

async function runWorker(message) {
  const handler = await workerOnMessage();
  const posted = [];
  workerGlobal.postMessage = (data, transfer) => posted.push({ data, transfer });
  await handler({ data: message });
  workerGlobal.postMessage = () => {};
  return posted;
}

test('posts the motion estimate first, then one message per lead, then done', async () => {
  const latestMillis = Date.now() - MINUTE;
  const previous = makeGrid(latestMillis - 8 * MINUTE);
  addBlob(previous, 34, 40, 52, 14);
  addBlob(previous, 92, 58, 46, 11);
  const latest = shifted(previous, 6, latestMillis);

  const posted = await runWorker({
    id: 7,
    previous,
    latest,
    options: { now: latestMillis, minEchoPixels: 10, minGlobalScore: 0.25 },
  });

  assert.ok(posted.length >= 3, 'expected motion, forecasts and a completion');
  assert.equal(posted.every(({ data }) => data.id === 7), true);

  const [{ data: motion }] = posted;
  assert.equal(motion.type, 'motion');
  assert.ok(motion.leadsMinutes.length > 0);
  assert.equal(motion.summary.direction, 'E');
  assert.ok(motion.quality > 0);

  const forecasts = posted.filter(({ data }) => data.type === 'forecast');
  assert.equal(forecasts.length, motion.leadsMinutes.length);
  forecasts.forEach(({ data, transfer }, index) => {
    assert.equal(data.index, index);
    assert.equal(data.grid.ni, WIDTH);
    assert.equal(data.grid.nj, HEIGHT);
    assert.equal(data.grid.values.length, WIDTH * HEIGHT);
    // Valid times run forward, and each frame's buffer is transferred rather
    // than copied back to the page.
    assert.ok(data.grid.timeMillis > latestMillis);
    assert.ok(data.grid.confidence > 0 && data.grid.confidence <= 1);
    assert.deepEqual(transfer, [data.grid.values.buffer]);
  });
  assert.ok(
    forecasts.at(-1).data.grid.timeMillis > forecasts[0].data.grid.timeMillis,
  );
  assert.equal(posted.at(-1).data.type, 'done');
});

test('reports an untrackable field as a rejection rather than an error', async () => {
  const latestMillis = Date.now() - MINUTE;
  const previous = makeGrid(latestMillis - 8 * MINUTE);
  const latest = makeGrid(latestMillis);

  const posted = await runWorker({
    id: 1,
    previous,
    latest,
    options: { now: latestMillis },
  });

  assert.equal(posted.length, 1);
  assert.equal(posted[0].data.type, 'rejected');
  assert.equal(posted[0].data.code, 'NO_ECHO');
  assert.ok(posted[0].data.reason);
});

test('accepts a scan history and reports the second-order fit back to the page', async () => {
  // The page names the earlier scans; the ones it already holds are passed
  // inline. Two of them means the growth and motion get a rate of change.
  const latestMillis = Date.now() - MINUTE;
  const earliest = makeGrid(latestMillis - 24 * MINUTE);
  addBlob(earliest, 30, 40, 52, 14);
  addBlob(earliest, 88, 58, 46, 11);
  const previous = shifted(earliest, 8, latestMillis - 8 * MINUTE);
  const latest = shifted(earliest, 14, latestMillis);

  const posted = await runWorker({
    id: 9,
    history: [
      { key: 'earliest', timeMillis: earliest.timeMillis, grid: earliest },
      { key: 'previous', timeMillis: previous.timeMillis, grid: previous },
    ],
    latest,
    options: { now: latestMillis, minEchoPixels: 10, minGlobalScore: 0.25 },
  });

  const [{ data: motion }] = posted;
  assert.equal(motion.type, 'motion');
  assert.equal(motion.scanCount, 3);
  assert.equal(motion.secondOrder, true);
  assert.equal(motion.summary.direction, 'E');

  const forecasts = posted.filter(({ data }) => data.type === 'forecast');
  assert.equal(forecasts.length, motion.leadsMinutes.length);
  assert.equal(posted.at(-1).data.type, 'done');
});
