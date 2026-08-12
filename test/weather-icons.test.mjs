import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const source = readFileSync(new URL('../icons.js', import.meta.url), 'utf8');
const context = {};
vm.runInNewContext(`${source}\nglobalThis.WeatherIconsForTest = WeatherIcons;`, context);
const WeatherIcons = context.WeatherIconsForTest;

test('rain streaks stay centered beneath the cloud', () => {
  const svg = WeatherIcons.render('rain');
  for (const x of [20, 28, 36, 44]) assert.match(svg, new RegExp(`x1="${x}"`));
  assert.doesNotMatch(svg, /x1="49\.5"/);
});

test('patchy fog leaves a clean gap between cloud and fog banks', () => {
  const svg = WeatherIcons.render('fog');
  assert.match(svg, /translate\(-1 -15\) scale\(0\.86\)/);
  assert.match(svg, /y1="40"/);
  assert.match(svg, /y1="48"/);
  assert.match(svg, /y1="56"/);
});

test('thunderstorm uses a shaped gradient bolt instead of a text glyph', () => {
  const svg = WeatherIcons.render('storm');
  assert.match(svg, /linearGradient/);
  assert.match(svg, /M36 40L27 50\.5h6L30 59/);
  assert.doesNotMatch(svg, /⚡/);
});

