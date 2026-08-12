import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('product guides distinguish product identity from result meaning', () => {
  assert.match(appSource, /<strong>What it is<\/strong>/);
  assert.match(appSource, /<strong>What it means<\/strong>/);
});

test('current-condition information uses the same two-part explanation', () => {
  assert.match(appSource, /function showCurrentMetricGuide/);
  assert.match(appSource, /CURRENT_METRIC_DEFINITIONS/);
  assert.match(appSource, /Current value: <strong>/);
  assert.match(appSource, /showCurrentMetricGuide\(metricInfo\.dataset\.currentMetricInfo\)/);
});

test('forecast tag guide distinguishes severe and flooding icons', () => {
  assert.match(appSource, /Triangle icon · Severe storms/);
  assert.match(appSource, /Rain-cloud icon · Flooding/);
  assert.match(appSource, /Triangle: isolated severe storms are possible/);
  assert.match(appSource, /Rain cloud: isolated flash flooding is possible/);
});

test('shared SPC and WPC levels are explained together while product-only levels remain explicit', () => {
  assert.match(appSource, /MRGL · Marginal/);
  assert.match(appSource, /SLGT · Slight/);
  assert.match(appSource, /MDT · Moderate/);
  assert.match(appSource, /ENH · Enhanced · SPC only/);
  assert.match(appSource, /TSTM · SPC only/);
});
