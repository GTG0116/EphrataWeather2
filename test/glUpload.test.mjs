// Regression tests for the WebGL texture-reuse path shared by the radar, MRMS
// (including the future-radar nowcast frames) and satellite layers.
//
// The bug these lock down: texSubImage2D's short form
//   (target, level, xoffset, yoffset, format, type, source)
// only accepts a TexImageSource — ImageData, ImageBitmap, canvas, video. Passing
// an ArrayBufferView to it throws
//   "Failed to execute 'texSubImage2D' on 'WebGL2RenderingContext':
//    Overload resolution failed."
// which aborted the whole frame and surfaced as a "decode failed" banner on the
// second and every later frame of a product (the first frame allocates with
// texImage2D and so always worked). Typed-array uploads must use the long form
// with explicit width/height.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createRadarLayer } from '../js/radarLayer.js';
import { createGridLayer, prepareGridTexture } from '../js/gridLayer.js';
import { createSatelliteLayer } from '../js/satelliteLayer.js';
import { PRODUCTS } from '../js/products.js';
import { MRMS_PRODUCTS } from '../js/mrms.js';

// A WebGL2 stub that enforces the parts of the IDL the layers depend on, so a
// bad overload fails here exactly as it does in a browser.
function makeGL() {
  const calls = { texImage2D: [], texSubImage2D: [] };
  const overloadError = (name) => new TypeError(
    `Failed to execute '${name}' on 'WebGL2RenderingContext': Overload resolution failed.`);
  const gl = {
    calls,
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, TEXTURE_2D: 7, TEXTURE_MIN_FILTER: 8,
    TEXTURE_MAG_FILTER: 9, TEXTURE_WRAP_S: 10, TEXTURE_WRAP_T: 11,
    NEAREST: 12, CLAMP_TO_EDGE: 13, UNPACK_ALIGNMENT: 14, RGBA: 15,
    UNSIGNED_BYTE: 16,

    createShader: () => ({}),
    shaderSource() {},
    compileShader() {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => '',
    createProgram: () => ({}),
    attachShader() {},
    linkProgram() {},
    getProgramParameter: () => true,
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    createBuffer: () => ({}),
    createTexture: () => ({}),
    bindBuffer() {},
    bufferData() {},
    bindTexture() {},
    texParameteri() {},
    pixelStorei() {},

    // texImage2D(target, level, internalformat, width, height, border, format,
    //            type, pixels) — the ArrayBufferView form.
    texImage2D(...args) {
      if (args.length !== 9) throw overloadError('texImage2D');
      const [, , , width, height, , , , pixels] = args;
      if (!ArrayBuffer.isView(pixels)) throw overloadError('texImage2D');
      if (pixels.byteLength < width * height * 4)
        throw new Error('texImage2D: source buffer too small');
      calls.texImage2D.push({ width, height, length: pixels.length });
    },

    // texSubImage2D(target, level, xoffset, yoffset, width, height, format,
    //               type, pixels). The 7-argument form takes a TexImageSource
    //               only — an ArrayBufferView there is the bug under test.
    texSubImage2D(...args) {
      if (args.length !== 9) throw overloadError('texSubImage2D');
      const [, , xoffset, yoffset, width, height, , , pixels] = args;
      if (!ArrayBuffer.isView(pixels)) throw overloadError('texSubImage2D');
      if (pixels.byteLength < width * height * 4)
        throw new Error('texSubImage2D: source buffer too small');
      calls.texSubImage2D.push({ xoffset, yoffset, width, height, length: pixels.length });
    },
  };
  return gl;
}

const fakeMap = { triggerRepaint() {} };

// --- radar -----------------------------------------------------------------

function makeSweep({ radials = 360, gates = 400, seed = 1 } = {}) {
  const out = [];
  for (let r = 0; r < radials; r++) {
    const raw = new Uint16Array(gates);
    for (let g = 0; g < gates; g++) raw[g] = (r * gates + g + seed) % 65535;
    out.push({
      azimuth: (r * 360) / radials,
      moments: {
        REF: { gateCount: gates, raw, firstGate: 2125, gateSpacing: 250, offset: 66, scale: 2 },
      },
    });
  }
  return { radials: out };
}

const site = { lat: 40.03, lon: -76.51 };

test('radar layer reuses its texture without an overload error', () => {
  const gl = makeGL();
  const layer = createRadarLayer();
  layer.onAdd(fakeMap, gl);

  layer.setSweep(makeSweep(), PRODUCTS.REF, site);
  assert.equal(gl.calls.texImage2D.length, 2); // data + colour LUT
  assert.equal(gl.calls.texSubImage2D.length, 0);

  // Same geometry -> the in-place path. This is what used to throw.
  layer.setSweep(makeSweep({ seed: 7 }), PRODUCTS.REF, site);
  assert.equal(gl.calls.texSubImage2D.length, 1);
  const sub = gl.calls.texSubImage2D[0];
  assert.equal(sub.width, 400);
  assert.equal(sub.height, 1440);
  assert.equal(sub.length, 400 * 1440 * 4); // exactly this frame, no scratch tail

  // A different gate count must still reallocate rather than sub-upload.
  layer.setSweep(makeSweep({ gates: 300 }), PRODUCTS.REF, site);
  assert.equal(gl.calls.texSubImage2D.length, 1);
  assert.equal(gl.calls.texImage2D.at(-2).width, 300);
});

test('radar grids resampled after a larger sweep upload only their own bytes', () => {
  const gl = makeGL();
  const layer = createRadarLayer();
  layer.onAdd(fakeMap, gl);

  // Size the shared scratch with a big sweep, then draw two smaller frames.
  layer.setSweep(makeSweep({ gates: 1832 }), PRODUCTS.REF, site);
  layer.setSweep(makeSweep({ gates: 500 }), PRODUCTS.REF, site);
  layer.setSweep(makeSweep({ gates: 500, seed: 9 }), PRODUCTS.REF, site);

  const sub = gl.calls.texSubImage2D.at(-1);
  assert.equal(sub.width, 500);
  assert.equal(sub.length, 500 * 1440 * 4);
});

// --- MRMS / future radar ---------------------------------------------------

function makeLatLonGrid({ ni = 300, nj = 200, seed = 0 } = {}) {
  const values = new Float32Array(ni * nj);
  for (let i = 0; i < values.length; i++) values[i] = ((i + seed) % 60) + 5;
  return { proj: 'latlon', ni, nj, lon1: -78, lat1: 41.5, di: 0.01, dj: 0.01, values };
}

for (const packed of [false, true]) {
  test(`grid layer reuses its texture without an overload error (packed: ${packed})`, () => {
    const gl = makeGL();
    const layer = createGridLayer();
    layer.onAdd(fakeMap, gl);
    const product = MRMS_PRODUCTS.REFLECTIVITY_QC ?? Object.values(MRMS_PRODUCTS)[0];

    const first = prepareGridTexture(makeLatLonGrid(), product, { packed });
    layer.showPrepared(first);
    assert.equal(gl.calls.texSubImage2D.length, 0);

    // Nowcast playback swaps frames that share the pooled grid geometry.
    const second = prepareGridTexture(makeLatLonGrid({ seed: 13 }), product, { packed });
    layer.showPrepared(second);
    const sub = gl.calls.texSubImage2D.at(-1);
    assert.equal(sub.width, first.tex.W);
    assert.equal(sub.height, first.tex.H);
    assert.equal(sub.length, first.tex.W * first.tex.H * 4);

    const third = prepareGridTexture(makeLatLonGrid({ ni: 260, nj: 180 }), product, { packed });
    layer.showPrepared(third);
    assert.equal(gl.calls.texSubImage2D.length, 1);
    assert.equal(gl.calls.texImage2D.at(-2).width, third.tex.W);
  });
}

// --- satellite -------------------------------------------------------------

function makeScene({ width = 500, height = 300 } = {}) {
  return {
    width, height,
    xScale: 5.6e-5, xOffset: -0.101332, yScale: -5.6e-5, yOffset: 0.128212,
    proj: { lon0: -75, H: 42164160, rEq: 6378137, rPol: 6356752.31414, sweep: 'x' },
  };
}

test('satellite layer reuses its texture without an overload error', () => {
  const gl = makeGL();
  const layer = createSatelliteLayer();
  layer.onAdd(fakeMap, gl);
  const bbox = [-84, 33, -68, 45];

  const scene = makeScene();
  layer.setScene(scene, new Uint8Array(scene.width * scene.height * 4), bbox);
  assert.equal(gl.calls.texImage2D.length, 1);
  assert.equal(gl.calls.texSubImage2D.length, 0);

  // Next frame of the same sector — the animation path that used to throw.
  layer.setScene(scene, new Uint8Array(scene.width * scene.height * 4), bbox);
  const sub = gl.calls.texSubImage2D.at(-1);
  assert.equal(sub.width, 500);
  assert.equal(sub.height, 300);
  assert.equal(sub.length, 500 * 300 * 4);

  const bigger = makeScene({ width: 640, height: 400 });
  layer.setScene(bigger, new Uint8Array(bigger.width * bigger.height * 4), bbox);
  assert.equal(gl.calls.texSubImage2D.length, 1);
  assert.equal(gl.calls.texImage2D.at(-1).width, 640);
});

// --- deferred (pre-GL) uploads ---------------------------------------------

test('payloads staged before onAdd upload correctly once GL exists', () => {
  const gl = makeGL();
  const layer = createRadarLayer();
  layer.setSweep(makeSweep(), PRODUCTS.REF, site);   // no GL yet
  layer.setSweep(makeSweep({ gates: 200 }), PRODUCTS.REF, site); // scratch reused
  layer.onAdd(fakeMap, gl);
  assert.equal(gl.calls.texImage2D.at(-2).width, 200);
});
