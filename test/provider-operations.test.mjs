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

function loadHelpers() {
  const names = [
    'isCanadianLocation', 'isUsLocation', 'forecastProviderFor', 'alertAgencyLabel', 'numericWind',
    'flightCategoryFor', 'forecastFlightCategory', 'droneOperatingAssessment', 'isoDurationMs', 'gridValueAt',
    'gridUnit', 'gridSpeedMph', 'gridDistanceMiles', 'gridHeightFeet',
    'forecastTextWeatherCode', 'preferredNwsStation',
  ];
  const context = {
    US_STATE_NAMES: new Set(['pennsylvania', 'new york']),
    US_STATE_CODES: new Set(['PA', 'NY']),
  };
  vm.runInNewContext(`${names.map(extractFunction).join('\n')}
    globalThis.helpers = { ${names.join(', ')} };`, context);
  return context.helpers;
}

test('forecast providers route by country instead of probing NWS globally', () => {
  const { forecastProviderFor, alertAgencyLabel } = loadHelpers();
  assert.equal(forecastProviderFor({ name: 'Ephrata, PA', countryCode: 'US' }), 'NWS');
  assert.equal(forecastProviderFor({ name: 'Toronto, CA', countryCode: 'CA' }), 'ECCC');
  assert.equal(forecastProviderFor({ name: 'Berlin, Berlin, DE', countryCode: 'DE' }), 'Open-Meteo');
  assert.equal(forecastProviderFor({ name: 'Lancaster, Pennsylvania' }), 'NWS');
  assert.equal(alertAgencyLabel({ name: 'Omaha, NE', countryCode: 'US', lat: 41.26, lon: -95.94 }), 'NWS');
  assert.equal(alertAgencyLabel({ name: 'Toronto, CA', countryCode: 'CA', lat: 43.65, lon: -79.38 }), 'ECCC');
});

test('alert requests use the selected country instead of the overlapping Canada query box', () => {
  const source = extractFunction('alertsPayload');
  assert.match(source, /const canadian = isCanadianLocation\(location\)/);
  assert.match(source, /canadian\s*\? Promise\.resolve\(\{ features: \[\] \}\)\s*:\s*getJson/);
  assert.match(source, /canadian\s*\? ecccAlertsPayload\(lat, lon\)\s*:\s*Promise\.resolve\(\[\]\)/);
  assert.doesNotMatch(source, /isInCanada\(lat, lon\)/);
});

test('the US weather pipeline consumes all official NWS point forecast links', () => {
  const source = extractFunction('weatherPayload');
  assert.match(source, /getJson\(props\.forecast\)/);
  assert.match(source, /getJson\(props\.forecastHourly\)/);
  assert.match(source, /getJson\(props\.forecastGridData\)/);
  assert.doesNotMatch(source, /openMeteoForecastUrl/);
});

test('NWS current conditions fall back to official hourly and grid fields when a station omits readings', () => {
  const source = extractFunction('weatherPayload');
  assert.match(source, /normalizedNwsTemperature\(firstHour\.dewpoint\)/);
  assert.match(source, /nwsValue\(firstHour, "relativeHumidity"\)/);
  assert.match(source, /firstHour\.visibility/);
  assert.match(source, /numericWind\(firstHour\.windGust\)/);
  assert.match(source, /gridForecast\?\.properties\?\.pressure/);
});

test('complete ICAO observations are preferred over sparse coastal or mesonet platforms', () => {
  const { preferredNwsStation } = loadHelpers();
  const sparse = { properties: { stationIdentifier: 'SFOC1' } };
  const airport = { properties: { stationIdentifier: 'KSFO' } };
  assert.equal(preferredNwsStation([sparse, airport]), airport);
  assert.equal(preferredNwsStation([sparse]), sparse);
});

test('aviation categories follow standard ceiling and visibility thresholds', () => {
  const { flightCategoryFor, forecastFlightCategory } = loadHelpers();
  assert.equal(flightCategoryFor(10, 5000), 'VFR');
  assert.equal(flightCategoryFor(4, 5000), 'MVFR');
  assert.equal(flightCategoryFor(10, 800), 'IFR');
  assert.equal(flightCategoryFor(0.5, 5000), 'LIFR');
  assert.equal(flightCategoryFor(null, null), 'UNK');
  assert.deepEqual(
    { ...forecastFlightCategory({ shortForecast: 'Mostly Clear' }) },
    { category: 'VFR', estimated: true },
  );
  assert.equal(forecastFlightCategory({ shortForecast: 'Chance Rain Showers' }).category, 'VFR');
  assert.equal(forecastFlightCategory({ shortForecast: 'Patchy Fog' }).category, 'MVFR');
});

test('drone planning guidance escalates wind and convective hazards', () => {
  const { droneOperatingAssessment } = loadHelpers();
  assert.equal(droneOperatingAssessment({
    windSpeed: '6 mph', windGust: '10 mph', visibility: 10, ceiling: 5000,
    probabilityOfPrecipitation: { value: 10 }, shortForecast: 'Mostly Sunny',
  }).label, 'Favorable');
  assert.equal(droneOperatingAssessment({
    windSpeed: '17 mph', windGust: '23 mph', visibility: 8, ceiling: 4000,
    probabilityOfPrecipitation: { value: 20 }, shortForecast: 'Partly Cloudy',
  }).label, 'Caution');
  const poor = droneOperatingAssessment({
    windSpeed: '12 mph', windGust: '35 mph', visibility: 5, ceiling: 2000,
    probabilityOfPrecipitation: { value: 80 }, shortForecast: 'Thunderstorms',
  });
  assert.equal(poor.label, 'Poor');
  assert.ok(poor.reasons.some(reason => reason.includes('thunderstorms')));
});

test('NWS raw grid intervals and metric units are normalized for operations', () => {
  const { gridValueAt, gridSpeedMph, gridDistanceMiles, gridHeightFeet } = loadHelpers();
  const when = '2026-08-05T13:00:00Z';
  const field = { uom: 'wmoUnit:km_h-1', values: [
    { validTime: '2026-08-05T12:00:00Z/PT3H', value: 32.1869 },
  ] };
  assert.equal(gridValueAt(field, when), 32.1869);
  assert.ok(Math.abs(gridSpeedMph(field, when) - 20) < 0.01);
  assert.ok(Math.abs(gridDistanceMiles({ ...field, uom: 'wmoUnit:m', values: [
    { validTime: '2026-08-05T12:00:00Z/PT3H', value: 1609.344 },
  ] }, when) - 1) < 0.001);
  assert.ok(Math.abs(gridHeightFeet({ ...field, uom: 'wmoUnit:m', values: [
    { validTime: '2026-08-05T12:00:00Z/PT3H', value: 304.8 },
  ] }, when) - 1000) < 0.01);
});
