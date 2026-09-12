import fs from 'node:fs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

const bytes = fs.readFileSync(new URL('../web/mandelbrot_drift.wasm', import.meta.url));
const module = new WebAssembly.Module(bytes);
assert.equal(WebAssembly.Module.imports(module).length, 0);
const e = new WebAssembly.Instance(module, {}).exports;
const engine = e.engine_create(96, 64);
const memory = e.memory.buffer.byteLength;
const measurements = [];
let nonblank = 0;
const totalFrames = 4000;
for (let frame = 0; frame < totalFrames; frame++) {
  const started = performance.now();
  const pointer = e.engine_step(engine, 0.1, 0.45 + 0.2 * Math.sin(frame * 0.007), 0.45, 2.5, 1);
  measurements.push(performance.now() - started);
  assert.equal(e.memory.buffer.byteLength, memory, 'Memory grew with depth');
  assert.ok(Number.isFinite(e.engine_stat(engine, 0)));
  if (frame % 20 === 0) {
    const pixels = new Uint8Array(e.memory.buffer, pointer, 96 * 64 * 4);
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += 16) colors.add(pixels[i] * 65536 + pixels[i + 1] * 256 + pixels[i + 2]);
    if (colors.size > 20) nonblank++;
  }
}
assert.equal(e.engine_stat(engine, 2), 0, 'Zoom must never change atlas regions automatically');
assert.ok(nonblank > totalFrames / 20 * 0.6, `Too little detail: ${nonblank}/${totalFrames / 20} sampled frames`);
assert.ok(e.engine_stat(engine, 0) / Math.log10(3) > 1000);
const sorted = measurements.toSorted((a, b) => a - b);
const result = { frames: measurements.length, zoomDecades: e.engine_stat(engine, 0),
  equivalentThreefoldZooms: e.engine_stat(engine, 0) / Math.log10(3),
  refreshes: e.engine_stat(engine, 2), memoryBytes: memory, nonblankSamples: nonblank,
  medianMs: sorted[Math.floor(totalFrames * 0.5)], p95Ms: sorted[Math.floor(totalFrames * 0.95)], moduleBytes: bytes.length };
// Reverse after coordinate underflow: local scale must recover without NaNs.
for (let i = 0; i < 4000; i++) e.engine_step(engine, 0.1, 0.5, 0.5, -2.5, 1);
assert.equal(e.engine_stat(engine, 0), 0);
assert.ok(e.engine_stat(engine, 14) > 1);
assert.equal(e.memory.buffer.byteLength, memory);
result.reverseFrames = 4000;
e.engine_reset(engine);
assert.equal(e.engine_stat(engine, 0), 0);
assert.equal(e.engine_stat(engine, 2), 0);
e.engine_free(engine);
// SIMD must preserve the scalar renderer's output, including odd-width tiles.
const scalar = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(new URL('../web/mandelbrot_drift_scalar.wasm', import.meta.url))), {}).exports;
const pair = [e.engine_create(193, 129), scalar.engine_create(193, 129)];
for (let i = 0; i < 120; i++) {
  const pointers = [e, scalar].map((api, j) => api.engine_step(pair[j], 0.1, 0.46, 0.45, 2.5, 1));
  const a = new Uint8Array(e.memory.buffer, pointers[0], 193 * 129 * 4);
  const b = new Uint8Array(scalar.memory.buffer, pointers[1], 193 * 129 * 4);
  assert.deepEqual(a, b, `SIMD/scalar mismatch at frame ${i}`);
}
// Also compare a detailed boundary path through 10^13, not only interiors.
[e, scalar].forEach((api, j) => api.engine_reset(pair[j]));
const targetX = 0.5 + (-0.743643887037151 + 0.5) / (2 * 1.32 * 193 / 129);
const targetY = 0.5 - 0.13182590420533 / (2 * 1.32);
for (let i = 0; i < 52; i++) {
  const pointers = [e, scalar].map((api, j) => api.engine_step(pair[j], 0.1, targetX, targetY, 2.5, 1));
  assert.deepEqual(new Uint8Array(e.memory.buffer, pointers[0], 193 * 129 * 4),
    new Uint8Array(scalar.memory.buffer, pointers[1], 193 * 129 * 4), `Deep SIMD/scalar mismatch at frame ${i}`);
}
result.deepParityFrames = 52;
e.engine_free(pair[0]); scalar.engine_free(pair[1]);
result.scalarParityFrames = 120;
console.log(JSON.stringify(result, null, 2));
fs.mkdirSync(new URL('./artifacts/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./artifacts/wasm-results.json', import.meta.url), JSON.stringify(result, null, 2));
