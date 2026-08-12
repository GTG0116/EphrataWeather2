import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('alert GeoJSON sources generate tiles at close map zooms', () => {
  const mountStart = appSource.indexOf('function mountAlertLayers()');
  const mountEnd = appSource.indexOf('async function addAlertsLayer()', mountStart);
  const mountSource = appSource.slice(mountStart, mountEnd);
  assert.equal((mountSource.match(/maxzoom: 22/g) || []).length, 2);
  assert.equal((mountSource.match(/tolerance: 0\.25/g) || []).length, 2);
  assert.doesNotMatch(mountSource, /maxzoom: 10/);
});

