import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

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

function loadHelpers() {
  const names = ['localCalendarParts', 'localCalendarDayOffset', 'outlookForForecastPeriod'];
  const context = { Intl, Date };
  vm.runInNewContext(
    `${names.map(extractFunction).join('\n')}\nglobalThis.helpers = { ${names.join(', ')} };`,
    context,
  );
  return context.helpers;
}

test('an overnight NWS forecast beginning tomorrow receives Day 2, not expired Day 1', () => {
  const { outlookForForecastPeriod } = loadHelpers();
  const outlooks = [
    { day: 1, catLabel: 'SLGT' },
    { day: 2, catLabel: 'MRGL' },
  ];
  const now = new Date('2026-08-11T23:30:00-04:00');
  const tomorrow = { startTime: '2026-08-12T06:00:00-04:00' };

  assert.equal(outlookForForecastPeriod(outlooks, tomorrow, now, 'America/New_York').day, 2);
  assert.equal(outlookForForecastPeriod(outlooks, tomorrow, now, 'America/New_York').catLabel, 'MRGL');
});

test('Day 1 remains attached to a forecast period on the current local date', () => {
  const { outlookForForecastPeriod } = loadHelpers();
  const outlooks = [{ day: 1, catLabel: 'SLGT' }, { day: 2, catLabel: 'MRGL' }];
  const now = new Date('2026-08-11T01:00:00-04:00');
  const today = { startTime: '2026-08-11T06:00:00-04:00' };

  assert.equal(outlookForForecastPeriod(outlooks, today, now, 'America/New_York').day, 1);
});

test('date matching uses the selected location timezone across UTC midnight', () => {
  const { outlookForForecastPeriod } = loadHelpers();
  const outlooks = [{ day: 1 }, { day: 2 }];
  const now = new Date('2026-08-12T02:30:00Z'); // still Aug 11 in New York
  const tomorrow = { startTime: '2026-08-12T10:00:00Z' };

  assert.equal(outlookForForecastPeriod(outlooks, tomorrow, now, 'America/New_York').day, 2);
});

