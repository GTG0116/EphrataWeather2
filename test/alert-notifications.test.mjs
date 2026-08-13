import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Could not find ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not find the end of ${name}`);
}

function loadFunctions(source, names) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`
    ${names.map(name => extractFunction(source, name)).join('\n')}
    globalThis.exports = { ${names.join(', ')} };
  `, context);
  return context.exports;
}

const workerSource = readFileSync(new URL('../cloudflare-alert-worker.js', import.meta.url), 'utf8');
const worker = loadFunctions(workerSource, [
  'normalizeAlertIdentity',
  'uniqueAlertIdentities',
  'alertVtecIdentity',
  'referenceIdentifiers',
  'alertIdentityAliases',
  'anyAlertIdentitySeen',
  'parameterValues',
  'alertDisplayEvent',
  'titleCaseTag',
  'warningNotificationTags',
  'formatNotificationMeasurement',
  'severeThunderstormImpacts',
  'alertNotificationContent',
  'formatExpiration',
]);

const originalId = 'https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.original';
const firstUpdateId = 'https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.update-1';
const secondUpdateId = 'https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.update-2';
const updateVtec = '/O.CON.KCTP.SV.W.0123.260812T1900Z-260812T2030Z/';

test('an existing raw CAP id suppresses the first update that references it', () => {
  const update = {
    id: firstUpdateId,
    references: [originalId],
    parameters: { VTEC: [updateVtec] },
  };
  const oldRecord = new Set([worker.normalizeAlertIdentity(originalId)]);
  const aliases = worker.alertIdentityAliases(update);

  assert.equal(worker.anyAlertIdentitySeen(aliases, oldRecord), true);
  assert.ok(aliases.includes(firstUpdateId));
  assert.ok(aliases.includes(originalId));
  assert.ok(aliases.some(alias => alias.startsWith('nws-vtec:KCTP.SV.W.0123.26')));
});

test('the deployed polling path migrates an existing raw id without sending an update push', async () => {
  const record = {
    subscription: {
      endpoint: 'https://push.example.test/subscription',
      keys: { p256dh: 'unused', auth: 'unused' },
    },
    location: { lat: 40.1, lon: -76.2, nwsZones: [] },
    seenAlertIds: [originalId],
  };
  const writes = [];
  let upstreamCalls = 0;
  const context = {
    URL,
    Response,
    TextEncoder,
    console,
    fetch: async url => {
      upstreamCalls += 1;
      assert.match(String(url), /^https:\/\/api\.weather\.gov\/alerts\/active\?point=/);
      return new Response(JSON.stringify({
        features: [{
          id: firstUpdateId,
          properties: {
            event: 'Severe Thunderstorm Warning',
            references: [{ identifier: originalId.replace('https://api.weather.gov/alerts/', '') }],
            parameters: { VTEC: [updateVtec] },
          },
        }],
      }), { headers: { 'Content-Type': 'application/json' } });
    },
  };
  vm.createContext(context);
  vm.runInContext(workerSource.replace('export default', 'globalThis.workerDefault ='), context);
  const env = {
    SUBSCRIPTIONS: {
      list: async () => ({ list_complete: true, keys: [{ name: 'sub:test' }] }),
      get: async () => record,
      put: async (_key, value) => writes.push(JSON.parse(value)),
      delete: async () => { throw new Error('subscription should not be deleted'); },
    },
    NWS_USER_AGENT: 'WeatherPortal notification test',
  };

  const response = await context.workerDefault.fetch(
    { method: 'GET', url: 'https://worker.example.test/check-now' },
    env,
  );
  const stats = await response.json();

  assert.equal(upstreamCalls, 1);
  assert.equal(stats.sent, 0);
  assert.deepEqual(stats.errors, []);
  assert.equal(writes.length, 1);
  assert.ok(writes[0].seenAlertIds.includes(firstUpdateId));
  assert.ok(writes[0].seenAlertIds.some(id => id.startsWith('nws-vtec:')));
});

test('background alerts use the selected point and reject a warning polygon elsewhere in its county', async () => {
  const calls = [];
  const context = {
    URL,
    Response,
    TextEncoder,
    console,
    fetch: async url => {
      calls.push(String(url));
      return new Response(JSON.stringify({
        features: [
          {
            id: 'outside-warning',
            geometry: {
              type: 'Polygon',
              coordinates: [[[-76.8, 40.5], [-76.7, 40.5], [-76.7, 40.6], [-76.8, 40.6], [-76.8, 40.5]]],
            },
            properties: { event: 'Severe Thunderstorm Warning' },
          },
          {
            id: 'inside-warning',
            geometry: {
              type: 'Polygon',
              coordinates: [[[-76.3, 40.0], [-76.1, 40.0], [-76.1, 40.2], [-76.3, 40.2], [-76.3, 40.0]]],
            },
            properties: { event: 'Severe Thunderstorm Warning' },
          },
        ],
      }), { headers: { 'Content-Type': 'application/json' } });
    },
  };
  vm.createContext(context);
  vm.runInContext(workerSource.replace('export default', 'globalThis.workerDefault ='), context);

  const alerts = await context.nwsActiveAlerts(
    { lat: 40.1, lon: -76.2, nwsZones: ['PAC071'] },
    { NWS_USER_AGENT: 'WeatherPortal notification test' },
  );

  assert.deepEqual(calls, ['https://api.weather.gov/alerts/active?point=40.1,-76.2']);
  assert.deepEqual(Array.from(alerts, alert => alert.id), ['inside-warning']);
});

test('a flood-style one-link CAP update chain remains suppressed after learning the prior update id', () => {
  const firstUpdateAliases = worker.alertIdentityAliases({
    id: firstUpdateId,
    references: [originalId],
    parameters: {},
  });
  const migratedRecord = new Set(firstUpdateAliases.map(worker.normalizeAlertIdentity));
  const secondUpdateAliases = worker.alertIdentityAliases({
    id: secondUpdateId,
    references: [firstUpdateId],
    parameters: {},
  });

  assert.equal(worker.anyAlertIdentitySeen(secondUpdateAliases, migratedRecord), true);
});

test('distinct warning event numbers do not collapse into one notification family', () => {
  const first = worker.alertVtecIdentity({ parameters: { VTEC: [updateVtec] } });
  const second = worker.alertVtecIdentity({
    parameters: { VTEC: ['/O.NEW.KCTP.SV.W.0124.260812T1915Z-260812T2045Z/'] },
  });
  assert.notEqual(first, second);
});

test('destructive severe-thunderstorm push includes its tag, maximum wind, and hail', () => {
  const content = worker.alertNotificationContent({
    event: 'Severe Thunderstorm Warning',
    parameters: {
      thunderstormDamageThreat: ['DESTRUCTIVE'],
      maxWindGust: ['80 MPH'],
      maxHailSize: ['2.75'],
    },
  }, {});

  assert.equal(content.title, 'Severe Thunderstorm Warning — Destructive');
  assert.equal(content.body, 'Destructive • Max wind: 80 mph • Max hail: 2.75 in');
});

test('catastrophic flash-flood push is labeled as an emergency and retains the tag', () => {
  const content = worker.alertNotificationContent({
    event: 'Flash Flood Warning',
    parameters: { flashFloodDamageThreat: ['CATASTROPHIC'] },
  }, {});

  assert.equal(content.title, 'Flash Flood Emergency — Catastrophic');
  assert.equal(content.body, 'Catastrophic');
});

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const foreground = loadFunctions(appSource, [
  'normalizeAlertNotificationId',
  'notificationParameterValues',
  'alertNotificationVtecId',
  'alertReferenceIds',
  'alertNotificationIds',
  'alertNotificationId',
  'alertMatchesNotificationIds',
]);

test('foreground notifications match an updated CAP message to the old stored raw id', () => {
  const update = {
    id: firstUpdateId,
    references: [originalId],
    parameters: { VTEC: [updateVtec] },
  };
  assert.equal(foreground.alertMatchesNotificationIds(update, new Set([originalId])), true);
  assert.match(foreground.alertNotificationId(update), /^nws-vtec:/);
});

test('foreground notification parameters accept both CAP arrays and scalar fallbacks', () => {
  assert.deepEqual(
    Array.from(foreground.notificationParameterValues({ maxWindGust: '80 MPH' }, 'maxWindGust')),
    ['80 MPH'],
  );
  assert.deepEqual(
    Array.from(foreground.notificationParameterValues({ maxHailSize: ['2.75'] }, 'maxHailSize')),
    ['2.75'],
  );
});
