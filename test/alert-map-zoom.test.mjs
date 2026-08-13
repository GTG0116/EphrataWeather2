import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = appSource.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Could not find ${name} in app.js`);
  const bodyStart = appSource.indexOf('{', appSource.indexOf(')', start));
  let depth = 0;
  for (let index = bodyStart; index < appSource.length; index++) {
    if (appSource[index] === '{') depth++;
    if (appSource[index] === '}' && --depth === 0) return appSource.slice(start, index + 1);
  }
  throw new Error(`Could not find the end of ${name} in app.js`);
}

test('alert GeoJSON sources generate tiles at close map zooms', () => {
  const mountStart = appSource.indexOf('function mountAlertLayers()');
  const mountEnd = appSource.indexOf('async function addAlertsLayer()', mountStart);
  const mountSource = appSource.slice(mountStart, mountEnd);
  assert.equal((mountSource.match(/maxzoom: 22/g) || []).length, 2);
  assert.equal((mountSource.match(/tolerance: 0\.25/g) || []).length, 2);
  assert.doesNotMatch(mountSource, /maxzoom: 10/);
});

test('switching decoded frames restores alert borders above the base layer', () => {
  for (const name of ['setRadarFrame', 'setSatelliteFrame']) {
    const source = extractFunction(name);
    assert.match(source, /restackWeatherLayers\(\)/, `${name} should restore weather stacking`);
    assert.match(source, /raiseBoundaryLayers\(\)/, `${name} should preserve reference borders`);
  }
});

test('map alert popup de-duplicates repeated rendered copies by stable alert id', () => {
  const context = {};
  vm.runInNewContext(`
    ${extractFunction('normalizeMapAlertId')}
    ${extractFunction('alertPopupFeatureKey')}
    ${extractFunction('dedupeAlertPopupFeatures')}
    globalThis.helpers = { alertPopupFeatureKey, dedupeAlertPopupFeatures };
  `, context);
  const warning = { properties: {
    id: 'https://api.weather.gov/alerts/urn:oid:warning-1',
    event: 'Severe Thunderstorm Warning',
    expires: '2026-08-13T03:00:00Z',
  } };
  // The regional NOAA map feed carries the same CAP id without the API URL.
  const tiledCopy = { properties: {
    capId: 'urn:oid:warning-1',
    event: warning.properties.event,
    expires: warning.properties.expires,
  } };
  const watch = { properties: {
    capId: 'urn:oid:watch-1',
    event: 'Severe Thunderstorm Watch',
    expires: '2026-08-13T05:00:00Z',
  } };
  const result = context.helpers.dedupeAlertPopupFeatures([warning, tiledCopy, watch]);
  assert.equal(result.length, 2);
  assert.equal(result[0].properties.event, 'Severe Thunderstorm Warning');
  assert.equal(result[1].properties.event, 'Severe Thunderstorm Watch');
});
