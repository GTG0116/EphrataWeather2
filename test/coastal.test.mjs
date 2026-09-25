import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const fn = name => source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const context = { COASTAL_GRID_MAX_MI: 10 };
vm.createContext(context);
vm.runInContext(fn('milesBetween') + '\n' + fn('hasLocalCoastalData'), context);
const { hasLocalCoastalData, milesBetween } = context;
test('Conestoga cannot become coastal from Chesapeake wave data', () => {
  const distance = milesBetween(39.9407, -76.3463, 39.5, -76.0);
  assert.equal(hasLocalCoastalData({ hasWaves: true, gridDistanceMi: distance }), false);
});
test('Ocean City accepts nearby Atlantic wave data, including calm seas', () => {
  // Coordinates returned by the public marine API during verification.
  const distance = milesBetween(38.3365, -75.0849, 38.208336, -75.12499);
  assert.equal(hasLocalCoastalData({ hasWaves: true, gridDistanceMi: distance }), true);
});
test('missing waves or missing/invalid coordinates cannot prove proximity', () => {
  for (const marine of [null, {}, { hasWaves: false, gridDistanceMi: 1 },
    ...[null, undefined, NaN, Infinity, -1, 11].map(gridDistanceMi => ({ hasWaves: true, gridDistanceMi }))]) {
    assert.equal(hasLocalCoastalData(marine), false);
  }
});
test('a nearby gauge alone cannot unlock coastal products', async () => {
  const ctx = {
    point: () => ({ lat: 39.9407, lon: -76.3463 }),
    marinePayload: async () => null,
    nearestCoopsStation: async () => ({ distance: 20 }),
    hasLocalCoastalData, TIDE_GAUGE_MAX_MI: 45,
    tidePayload: () => { throw new Error('Should not request tides'); },
  };
  vm.createContext(ctx);
  vm.runInContext(fn('coastalPayload'), ctx);
  assert.equal((await ctx.coastalPayload()).isCoastal, false);
});
test('a stale coastal response cannot reveal the tab for the next inland location', async () => {
  const pending = [];
  const ctx = {
    coastalPayload: () => new Promise(resolve => pending.push(resolve)),
    renderCoastal() {}, updateCoastalTabVisibility() {},
  };
  vm.createContext(ctx);
  vm.runInContext(`let coastalRequestId = 0, coastalTabVisible = false;
    let coastalState, coastalError, coastalSegmentIndex, coastalWatersIndex, coastalTideStationId;
    ${fn('refreshCoastal')}`, ctx);
  const old = ctx.refreshCoastal();
  const current = ctx.refreshCoastal();
  pending[1]({ isCoastal: false });
  await current;
  pending[0]({ isCoastal: true });
  await old;
  assert.equal(vm.runInContext('coastalTabVisible', ctx), false);
  assert.equal(vm.runInContext('coastalState.isCoastal', ctx), false);
});
