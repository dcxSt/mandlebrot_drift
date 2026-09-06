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
assert.ok(e.engine_stat(engine, 2) > 10, 'No automatic refreshes');
assert.ok(nonblank > totalFrames / 20 * 0.6, `Too little detail: ${nonblank}/${totalFrames / 20} sampled frames`);
assert.ok(e.engine_stat(engine, 0) / Math.log10(3) > 1000);
const sorted = measurements.toSorted((a, b) => a - b);
const result = { frames: measurements.length, zoomDecades: e.engine_stat(engine, 0),
  equivalentThreefoldZooms: e.engine_stat(engine, 0) / Math.log10(3),
  refreshes: e.engine_stat(engine, 2), memoryBytes: memory, nonblankSamples: nonblank,
  medianMs: sorted[Math.floor(totalFrames * 0.5)], p95Ms: sorted[Math.floor(totalFrames * 0.95)], moduleBytes: bytes.length };
e.engine_reset(engine);
assert.equal(e.engine_stat(engine, 0), 0);
assert.equal(e.engine_stat(engine, 2), 0);
e.engine_free(engine);
console.log(JSON.stringify(result, null, 2));
fs.mkdirSync(new URL('./artifacts/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./artifacts/wasm-results.json', import.meta.url), JSON.stringify(result, null, 2));
