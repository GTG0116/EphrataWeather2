import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function functionSource(name, nextName) {
  const start = appSource.indexOf(`function ${name}(`);
  const end = appSource.indexOf(`function ${nextName}(`, start);
  assert.notEqual(start, -1, `${name} should exist`);
  assert.notEqual(end, -1, `${nextName} should follow ${name}`);
  return appSource.slice(start, end);
}

test('coastal overview presents wave products only in the sea-state card', () => {
  const seaState = functionSource('renderRipAndSea', 'renderCoastalMetrics');
  const highlights = functionSource('renderCoastalMetrics', 'renderTidePanel');

  assert.match(seaState, /"Significant wave height"/);
  assert.match(seaState, /"Swell"/);
  assert.doesNotMatch(highlights, /"Wave Height"/);
  assert.doesNotMatch(highlights, /"Swell"/);
  assert.doesNotMatch(highlights, /"Water Temp"/);
});

test('coastal sea state does not relabel model values as duplicate observations', () => {
  const seaState = functionSource('renderRipAndSea', 'renderCoastalMetrics');

  assert.match(seaState, /surfHeight \? \["Surf height"/);
  assert.match(seaState, /tides\?\.waterTempF != null \? \["Water temperature"/);
  assert.doesNotMatch(seaState, /surfHeight \? safeText\(surfHeight\) : fmtHeight/);
});
