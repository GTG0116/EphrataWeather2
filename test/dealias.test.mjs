import test from 'node:test';
import assert from 'node:assert/strict';
import { dealiasVelocitySweep } from '../js/dealias.js';

function moment(values) {
  const scale = 2;
  const offset = 129;
  const raw = Uint8Array.from(values, value => Math.round(value * scale + offset));
  return { gateCount: raw.length, firstGate: 250, gateSpacing: 250, scale, offset, raw };
}

test('region dealiasing unfolds a folded velocity core without shifting the ambient wind', () => {
  const radials = Array.from({ length: 360 }, (_, azimuth) => {
    const ambient = 10 * Math.sin(azimuth * Math.PI / 180);
    const values = Array(12).fill(ambient);
    if (azimuth >= 50 && azimuth <= 70) {
      for (let gate = 6; gate < 12; gate++) values[gate] = -8; // 22 m/s folded at Nyquist 15
    }
    return {
      azimuth,
      elevation: 0.5,
      nyquist: 15,
      moments: { VEL: moment(values) },
    };
  });
  const output = dealiasVelocitySweep({ elevation: 0.5, radials });
  assert.equal(output.dealiased, true);
  const core = output.radials[60].moments.VEL;
  assert.ok(Math.abs((core.raw[9] - core.offset) / core.scale - 22) < 0.1);
  const ambient = output.radials[180].moments.VEL;
  assert.ok(Math.abs((ambient.raw[2] - ambient.offset) / ambient.scale) < 0.1);
});
