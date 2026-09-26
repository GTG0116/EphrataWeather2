import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const fn = name => source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`))[0];
const context = {
  RIVER_MAX_MI: 5, RIVER_MAX_GAUGES: 6, RIVER_STALE_HOURS: 6,
  RIVER_UNRATED: new Set(['not_defined', 'out_of_service', 'obs_not_current', 'low_threshold']),
};
vm.createContext(context);
vm.runInContext(['milesBetween', 'riverCategory', 'riverGaugeCandidates', 'riverImpacts', 'floodingTitle'].map(fn).join('\n'), context);
const { riverCategory, riverGaugeCandidates, riverImpacts, floodingTitle } = context;

// Conestoga River at Lancaster (LNCP1) stages from NWPS.
const lancaster = { action: 9, minor: 11, moderate: 13, major: 15 };

test('river stages map onto the NWS categories', () => {
  assert.equal(riverCategory(3.8, lancaster), 'none');
  assert.equal(riverCategory(9, lancaster), 'action');
  assert.equal(riverCategory(11.2, lancaster), 'minor');
  assert.equal(riverCategory(13, lancaster), 'moderate');
  assert.equal(riverCategory(21.3, lancaster), 'major');
  assert.equal(riverCategory(NaN, lancaster), null);
  assert.equal(riverCategory(5, { action: null, minor: null }), null);
});

test('only in-service, rated, recently reporting river gauges are kept', () => {
  const now = Date.parse('2026-09-26T03:00:00Z');
  const gauge = (lid, observed, status = {}, pedts = 'HGIRG', latitude = 40.17, longitude = -76.17) => ({
    lid, name: lid, latitude, longitude, pedts: { observed: pedts, forecast: 'HGIFF' },
    status: {
      observed: { primary: 3.8, floodCategory: 'no_flooding', validTime: observed, ...status },
      forecast: { primary: 4.8 },
    },
  });
  const kept = riverGaugeCandidates([
    gauge('REAP1', '2026-09-26T02:15:00Z'),
    // Conestoga at Lancaster and Schuylkill at Reading are other towns' rivers.
    gauge('LNCP1', '2026-09-26T02:15:00Z', {}, 'HGIRG', 40.05, -76.28),
    gauge('RDRP1', '2026-09-26T02:15:00Z', {}, 'HGIRG', 40.33, -75.93),
    gauge('STALE', '2026-09-25T12:00:00Z'),
    gauge('OOS', '2026-09-26T02:15:00Z', { floodCategory: 'out_of_service' }),
    gauge('UNRATED', '2026-09-26T02:15:00Z', { floodCategory: 'not_defined' }),
    gauge('MISSING', '2026-09-26T02:15:00Z', { primary: -999 }),
    gauge('TIDE', '2026-09-26T02:15:00Z', {}, 'HMIRG'),
    gauge('POOL', '2026-09-26T02:15:00Z', {}, 'HPIRG'),
  ], 40.1795, -76.1789, now);
  assert.deepEqual(kept.map(item => item.lid), ['REAP1']);
  assert.equal(kept[0].hasForecast, true);
});

test('impact statements are cleaned and sorted lowest stage first', () => {
  const impacts = riverImpacts([
    { stage: 13, statement: 'Several homes are affected by high water.' },
    { stage: 11, statement: 'Grofftown Road  will flood.' },
    { stage: -999, statement: 'bad' },
    { stage: 14, statement: '' },
  ]);
  assert.deepEqual(impacts.map(item => [item.stageFt, item.statement]),
    [[11, 'Grofftown Road will flood.'], [13, 'Several homes are affected by high water.']]);
});

test('flood titles lead with what is happening now and add a worse forecast', () => {
  const levels = { none: { short: 'None' }, minor: { short: 'Minor' }, moderate: { short: 'Moderate' }, major: { short: 'Major' } };
  const rank = { none: 0, near: 1, minor: 2, moderate: 3, major: 4 };
  assert.equal(floodingTitle('Coastal', levels, rank, 'minor', 'major'), 'Minor Coastal Flooding Ongoing · Major Flooding Expected');
  assert.equal(floodingTitle('Coastal', levels, rank, 'moderate', 'minor'), 'Moderate Coastal Flooding Ongoing');
  assert.equal(floodingTitle('River', levels, rank, 'none', 'moderate'), 'Moderate River Flooding Expected');
});
