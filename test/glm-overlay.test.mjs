import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GLM_BUCKET,
  GLM_PRODUCT,
  glmKeysFromS3Listing,
  glmTimestampForKey,
  listRecentGlmFiles,
} from '../js/glm.js';

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('GOES GLM keys decode their year/day/hour/minute/second start time', () => {
  const key = 'GLM-L2-LCFA/2026/225/01/' +
    'OR_GLM-L2-LCFA_G19_s20262250101200_e20262250101400_c20262250101420.nc';
  assert.equal(glmTimestampForKey(key)?.toISOString(), '2026-08-13T01:01:20.000Z');
  assert.equal(glmTimestampForKey('not-a-glm-file'), null);
});

test('S3 listings accept only GOES-19 GLM-L2-LCFA objects', () => {
  const valid = 'GLM-L2-LCFA/2026/225/01/' +
    'OR_GLM-L2-LCFA_G19_s20262250100000_e20262250100200_c20262250100219.nc';
  const xml = `<ListBucketResult><Key>${valid}</Key>` +
    '<Key>ABI-L2-MCMIPC/2026/not-glm.nc</Key>' +
    '<Key>GLM-L2-LCFA/2026/OR_GLM-L2-LCFA_G18_s20262250100000.nc</Key>' +
    '</ListBucketResult>';
  assert.deepEqual(glmKeysFromS3Listing(xml), [valid]);
  assert.equal(GLM_BUCKET, 'https://noaa-goes19.s3.amazonaws.com');
  assert.equal(GLM_PRODUCT, 'GLM-L2-LCFA');
});

test('recent GLM listing is de-duplicated, freshness-limited, and newest-last', async () => {
  const keys = [
    'GLM-L2-LCFA/2026/225/00/OR_GLM-L2-LCFA_G19_s20262250040000_e0_c0.nc',
    'GLM-L2-LCFA/2026/225/01/OR_GLM-L2-LCFA_G19_s20262250100000_e0_c0.nc',
    'GLM-L2-LCFA/2026/225/01/OR_GLM-L2-LCFA_G19_s20262250100200_e0_c0.nc',
    'GLM-L2-LCFA/2026/225/01/OR_GLM-L2-LCFA_G19_s20262250100400_e0_c0.nc',
    'GLM-L2-LCFA/2026/225/01/OR_GLM-L2-LCFA_G19_s20262250105000_e0_c0.nc',
  ];
  const xml = `<ListBucketResult>${keys.map(key => `<Key>${key}</Key>`).join('')}</ListBucketResult>`;
  const fetchImpl = async () => ({ ok: true, text: async () => xml });
  const files = await listRecentGlmFiles({
    now: new Date('2026-08-13T01:02:00Z'), fetchImpl, maxFiles: 2,
  });
  assert.deepEqual(files.map(file => file.time.toISOString()), [
    '2026-08-13T01:00:20.000Z',
    '2026-08-13T01:00:40.000Z',
  ]);
});

test('outlook fills, radar, GLM, and outlook borders keep the required stack', () => {
  const block = appSource.match(/const WEATHER_LAYER_ORDER = \[([\s\S]*?)\];/)?.[1] || '';
  const order = [...block.matchAll(/"([^"]+)"/g)].map(match => match[1]);
  const radarIds = ['radar-layer-a', 'radar-layer-b', 'on-device-radar', 'on-device-mrms'];
  const radarBottom = Math.min(...radarIds.map(id => order.indexOf(id)));
  const radarTop = Math.max(...radarIds.map(id => order.indexOf(id)));
  const pairs = [
    ['spc-fill', 'spc-line'],
    ['spc-cig-fill', 'spc-cig-line'],
    ['fire-fill', 'fire-line'],
    ['wpc-rain-fill', 'wpc-rain-line'],
  ];
  for (const [fill, line] of pairs) {
    assert.ok(order.indexOf(fill) < radarBottom, `${fill} should be below radar`);
    assert.ok(order.indexOf(line) > radarTop, `${line} should be above radar`);
    assert.ok(order.indexOf(line) > order.indexOf('glm-flashes'), `${line} should remain above GLM`);
  }
  assert.ok(order.indexOf('glm-halo') > radarTop);
  assert.ok(order.indexOf('glm-flashes') > order.indexOf('glm-halo'));
});

test('GLM is a transparent point overlay rebuilt after Mapbox style changes', () => {
  assert.match(appSource, /const OVERLAY_LAYERS = \["GOES GLM"/);
  assert.match(appSource, /id: "glm-flashes",\s*type: "circle"/);
  assert.match(appSource, /radarMap\.once\("style\.load", \(\) => \{[\s\S]*?drawRadar\(false\)/);
  assert.doesNotMatch(appSource, /realtime_goes16_glm|glm[^\n]*type: "raster"/i);
});
