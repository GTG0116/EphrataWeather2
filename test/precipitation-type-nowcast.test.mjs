import test from 'node:test';
import assert from 'node:assert/strict';

import { precipitationTypeForecastGrid } from '../js/on-device-weather.js';

function grid(width = 11, height = 7, fill = NaN) {
  const values = new Float32Array(width * height);
  values.fill(fill);
  return { ni: width, nj: height, lon1: -80, lat1: 42, di: 0.01, dj: 0.01, values };
}

function finiteCount(values) {
  return Array.from(values).filter(Number.isFinite).length;
}

test('precipitation type uncertainty does not grow with forecast lead time', () => {
  // The reflectivity envelope is deliberately broad. Only a two-cell observed
  // rain band should classify it, plus the fixed one-cell alignment tolerance.
  const reflectivity = grid(11, 7, 12);
  const latestType = grid();
  latestType.values[3 * latestType.ni + 4] = 0.2;
  latestType.values[3 * latestType.ni + 5] = 0.2;

  const shortLead = precipitationTypeForecastGrid(reflectivity, latestType, 5);
  const longLead = precipitationTypeForecastGrid(reflectivity, latestType, 30);

  assert.ok(finiteCount(shortLead.values) > 0);
  assert.equal(finiteCount(longLead.values), finiteCount(shortLead.values));
});

test('precipitation classification follows measured echo motion', () => {
  const reflectivity = grid();
  reflectivity.values[3 * reflectivity.ni + 7] = 24;
  const latestType = grid();
  latestType.values[3 * latestType.ni + 5] = 0.4;

  const forecast = precipitationTypeForecastGrid(reflectivity, latestType, 10, {
    summary: { dxCellsPerMinute: 0.2, dyCellsPerMinute: 0 },
  });

  assert.ok(Number.isFinite(forecast.values[3 * forecast.ni + 7]));
});
