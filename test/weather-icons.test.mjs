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

test('partly-cloudy sun keeps a complete ray ring while it rotates', () => {
  const svg = WeatherIcons.render('partly', { animated: true });
  assert.equal((svg.match(/<line x1=/g) || []).length, 8);
  assert.match(svg, /animation:wxSpin/);
});

test('thunderstorm uses a centered monoline bolt consistent with the icon set', () => {
  const svg = WeatherIcons.render('storm');
  assert.match(svg, /M37\.5 39\.5L28\.5 49\.5h6L31\.5 58\.5/);
  assert.doesNotMatch(svg, /linearGradient|#fbbf24|fill="url/);
  assert.doesNotMatch(svg, /⚡/);
});
