import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

// app.js is a browser script rather than an ES module. Extract the small pure
// helpers under test so the production implementation, not a duplicate, is
// exercised without needing a DOM or map runtime.
function extractFunction(name) {
  const start = appSource.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Could not find ${name} in app.js`);
  const bodyStart = appSource.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < appSource.length; index++) {
    if (appSource[index] === '{') depth++;
    if (appSource[index] === '}' && --depth === 0) return appSource.slice(start, index + 1);
  }
  throw new Error(`Could not find the end of ${name} in app.js`);
}

function loadForecastHelpers() {
  const helpers = [
    'normalizeWmoWeatherCode',
    'wmoDescription',
    'windDirLabel',
    'isWetCode',
    'precipNoun',
    'hasLikelyPrecipitation',
    'periodPrecipNoun',
    'precipitationChancePhrase',
    'forecastConditionDescription',
    'wmoSeverity',
    'dominantWmoCode',
    'meanWindDirection',
    'precipWindowFor',
    'buildForecastSeries',
  ].map(extractFunction).join('\n');
  const context = {
    FREEZING_PRECIP_MAX_TEMP_F: 38,
    LIKELY_PRECIP_CHANCE: 60,
    PRECIP_HOUR_THRESHOLD: 30,
    WARM_WEATHER_EQUIVALENTS: { 48: 45, 56: 51, 57: 53, 66: 61, 67: 65 },
    WMO_CODES: {
      3: 'Overcast', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle',
      53: 'Drizzle', 56: 'Light freezing drizzle', 57: 'Freezing drizzle',
      61: 'Light rain', 65: 'Heavy rain', 66: 'Light freezing rain',
      67: 'Heavy freezing rain', 95: 'Thunderstorm',
    },
  };
  vm.runInNewContext(`${helpers}\nglobalThis.forecastHelpers = {
    normalizeWmoWeatherCode, wmoDescription, forecastConditionDescription,
    buildForecastSeries,
  };`, context);
  return context.forecastHelpers;
}

test('warm forecast temperatures do not display freezing rain wording', () => {
  const { normalizeWmoWeatherCode, wmoDescription } = loadForecastHelpers();
  assert.equal(normalizeWmoWeatherCode(66, 78), 61);
  assert.equal(wmoDescription(66, 78), 'Light rain');
  assert.equal(normalizeWmoWeatherCode(67, 31), 67);
  assert.equal(wmoDescription(67, 31), 'Heavy freezing rain');
});

test('a high precipitation chance is displayed as a chance of rain, not only overcast', () => {
  const { forecastConditionDescription } = loadForecastHelpers();
  assert.equal(forecastConditionDescription(3, 70), 'Chance of rain');
  assert.equal(forecastConditionDescription(3, 70, { code: 95 }), 'Chance of storms');
  assert.equal(forecastConditionDescription(3, 59), 'Overcast');
  assert.equal(forecastConditionDescription(61, 70), 'Light rain');
});

function buildUniformForecast({ code, temperature, pop }) {
  const hour = 60 * 60;
  const now = Math.floor(Date.now() / 1000);
  const dayStart = Math.floor(now / (24 * hour)) * 24 * hour;
  const times = Array.from({ length: 48 }, (_, index) => dayStart + index * hour);
  const series = loadForecastHelpers().buildForecastSeries({
    timezone: 'UTC',
    utc_offset_seconds: 0,
    hourly: {
      time: times,
      temperature_2m: times.map(() => temperature),
      precipitation_probability: times.map(() => pop),
      precipitation: times.map(() => 0),
      weather_code: times.map(() => code),
      is_day: times.map(() => 1),
    },
    daily: { time: [dayStart] },
  }, 'UTC');
  return series.daily[0];
}

test('daily aggregation normalizes warm freezing codes and promotes high-PoP cloud periods', () => {
  const warmFreezing = buildUniformForecast({ code: 66, temperature: 78, pop: 70 });
  assert.equal(warmFreezing.weatherCode, 61);
  assert.equal(warmFreezing.shortForecast, 'Light rain');

  const likelyRain = buildUniformForecast({ code: 3, temperature: 72, pop: 70 });
  assert.equal(likelyRain.weatherCode, 3);
  assert.equal(likelyRain.shortForecast, 'Chance of rain');
});
