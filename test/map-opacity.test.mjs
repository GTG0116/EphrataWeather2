import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = appSource.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Could not find ${name} in app.js`);
  const bodyStart = appSource.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    if (appSource[index] === '{') depth += 1;
    if (appSource[index] === '}' && --depth === 0) return appSource.slice(start, index + 1);
  }
  throw new Error(`Could not find the end of ${name} in app.js`);
}

function loadOpacity(value) {
  const context = {
    localStorage: {
      getItem: () => value,
    },
  };
  vm.runInNewContext(`
    const WEATHER_LAYER_OPACITY_KEY = "weatherLayerOpacity";
    ${extractFunction('loadWeatherLayerOpacity')}
    globalThis.result = loadWeatherLayerOpacity();
  `, context);
  return context.result;
}

test('saved map-layer opacity is restored after refresh', () => {
  assert.equal(loadOpacity('42'), 0.42);
  assert.equal(loadOpacity('100'), 1);
});

test('invalid saved opacity falls back to the 78 percent default', () => {
  assert.equal(loadOpacity(null), 0.78);
  assert.equal(loadOpacity('9'), 0.78);
  assert.equal(loadOpacity('not-a-number'), 0.78);
});

test('moving the opacity slider persists and startup restores the UI', () => {
  const setter = appSource.slice(
    appSource.indexOf('function setRainfallOpacity('),
    appSource.indexOf('function removeMapLayer('),
  );
  assert.match(setter, /localStorage\.setItem\(WEATHER_LAYER_OPACITY_KEY/);
  assert.match(setter, /#radarOpacitySlider/);
  assert.match(appSource, /setRainfallOpacity\(radarOpacity \* 100, \{ persist: false \}\);/);
});
