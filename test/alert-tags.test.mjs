import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = appSource.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Could not find ${name} in app.js`);
  const bodyStart = appSource.indexOf(') {', start) + 2;
  let depth = 0;
  for (let index = bodyStart; index < appSource.length; index += 1) {
    if (appSource[index] === '{') depth += 1;
    if (appSource[index] === '}') depth -= 1;
    if (depth === 0) return appSource.slice(start, index + 1);
  }
  throw new Error(`Could not find the end of ${name} in app.js`);
}

const damageLevels = appSource.match(/const ECCC_WARNING_DAMAGE_LEVELS = \{[\s\S]*?\n\};/)?.[0];
if (!damageLevels) throw new Error('Could not find ECCC_WARNING_DAMAGE_LEVELS in app.js');

const context = {};
vm.createContext(context);
vm.runInContext(`${damageLevels}
${[
  'titleCaseAlertName',
  'ecccBaseEvent',
  'ecccSeverity',
  'ecccRiskColor',
  'isColorTieredEcccWarning',
  'ecccWarningTags',
  'alertDisplayEvent',
  'activeNwsAlertLevel',
].map(extractFunction).join('\n')}
globalThis.alertTagHelpers = {
  ecccSeverity,
  ecccWarningTags,
  alertDisplayEvent,
  activeNwsAlertLevel,
};` , context);

const {
  ecccSeverity,
  ecccWarningTags,
  alertDisplayEvent,
  activeNwsAlertLevel,
} = context.alertTagHelpers;

for (const riskColor of ['yellow', 'orange', 'red']) {
  for (const event of ['Tornado Warning', 'Severe Thunderstorm Warning']) {
    test(`${riskColor} ECCC ${event} uses only the base alert`, () => {
      const alert = { event, source: 'ECCC', riskColor };
      assert.equal(alertDisplayEvent(alert), event);
      assert.equal(alertDisplayEvent({ ...alert, event: `${riskColor} ${event}` }), event);
      assert.deepEqual(Array.from(ecccWarningTags(event, riskColor)), []);
      assert.equal(ecccSeverity({ alert_name_en: event, risk_colour_en: riskColor, alert_type: 'warning' }),
        event === 'Tornado Warning' ? 'Extreme' : 'Severe');
    });
  }
}

test('an observed US tornado remains a regular warning level', () => {
  assert.equal(activeNwsAlertLevel('Tornado Warning', ['Observed']), 'WARNING');
});

test('an observed flash flood still selects its observed level', () => {
  assert.equal(activeNwsAlertLevel('Flash Flood Warning', ['Observed']), 'OBSERVED');
});

const colors = {};
vm.createContext(colors);
vm.runInContext([
  appSource.slice(appSource.indexOf('function hexToRgb('), appSource.indexOf('// Coarse alert class')),
  appSource.match(/const ECCC_TO_NWS_EVENT = \[[\s\S]*?\n\];/)[0],
  ...['titleCaseAlertName', 'ecccBaseEvent', 'ecccSeverity', 'ecccAlertMapColor'].map(extractFunction),
].join('\n'), colors);

for (const [canadian, us] of [
  ['Tornado Warning', 'Tornado Warning'],
  ['Severe Thunderstorm Warning', 'Severe Thunderstorm Warning'],
  ['Rainfall Warning', 'Flood Warning'],
  ['Blizzard Warning', 'Blizzard Warning'],
  ['Freezing Rain Warning', 'Ice Storm Warning'],
  ['Snowfall Warning', 'Winter Storm Warning'],
  ['Coastal Flood Warning', 'Coastal Flood Warning'],
  ['Red Flag Warning', 'Red Flag Warning'],
]) {
  test(`${canadian} cards and polygons share the base ${us} color for every tier`, () => {
    const expected = colors.nwsAlertColor(us, 'Severe');
    for (const tier of ['yellow', 'orange', 'red']) {
      assert.deepEqual(colors.ecccAlertMapColor({ alert_name_en: `${tier} ${canadian}`, risk_colour_en: tier, alert_type: 'warning' }), expected);
      assert.deepEqual(colors.alertEventColor(canadian, 'Severe'), expected);
    }
  });
}

