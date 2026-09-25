import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const controller = await readFile(new URL('../js/on-device-weather.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

test('active radar and satellite overlays poll for new scans every 90 seconds', () => {
  assert.match(app, /WEATHER_OVERLAY_REFRESH_MS\s*=\s*90\s*\*\s*1000/);
  assert.match(app, /addSatelliteLayer\(true\)/);
  assert.match(app, /addRadarLayer\(false, true\)/);
  assert.match(controller, /resetToLatest\s*=\s*false/);
  assert.match(controller, /sourceChanged \|\| productChanged \|\| resetToLatest \|\| !satelliteFrames\.length/);
});

test('bottom map controls account for every phone safe-area inset', () => {
  assert.match(styles, /--map-safe-bottom:\s*env\(safe-area-inset-bottom/);
  assert.match(styles, /--map-safe-left:\s*env\(safe-area-inset-left/);
  assert.match(styles, /--map-safe-right:\s*env\(safe-area-inset-right/);
  assert.match(styles, /padding-bottom:\s*var\(--map-safe-bottom/);
});
