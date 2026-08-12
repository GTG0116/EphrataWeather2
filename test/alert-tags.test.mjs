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

for (const [riskColor, damage, severity] of [
  ['yellow', 'Moderate', 'Moderate'],
  ['orange', 'High', 'Severe'],
  ['red', 'Extreme', 'Extreme'],
]) {
  for (const event of ['Tornado Warning', 'Severe Thunderstorm Warning']) {
    test(`${riskColor} ECCC ${event} carries its color and damage tier`, () => {
      const alert = { event, source: 'ECCC', riskColor };
      assert.equal(alertDisplayEvent(alert), `${riskColor[0].toUpperCase()}${riskColor.slice(1)} ${event}`);
      assert.deepEqual(Array.from(ecccWarningTags(event, riskColor)), [
        `${riskColor[0].toUpperCase()}${riskColor.slice(1)}`,
        `${damage} damage`,
      ]);
      assert.equal(ecccSeverity({ risk_colour_en: riskColor, alert_type: 'warning' }), severity);
    });
  }
}

test('an observed US tornado remains a regular warning level', () => {
  assert.equal(activeNwsAlertLevel('Tornado Warning', ['Observed']), 'WARNING');
});

test('an observed flash flood still selects its observed level', () => {
  assert.equal(activeNwsAlertLevel('Flash Flood Warning', ['Observed']), 'OBSERVED');
});

