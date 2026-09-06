// Same camera paths, resolution, warmup, and timings for two WASM builds.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const current = new URL('../web/mandelbrot_drift.wasm', import.meta.url);
const baseline = process.env.BASELINE_WASM || new URL('./artifacts/baseline.wasm', import.meta.url);
const cases = [
  { name: 'overview', frames: 0, x: -0.5, y: 0 },
  { name: 'seahorse', frames: 40, x: -0.75, y: 0.1 },
  { name: 'boundary', frames: 60, x: -0.743643887037151, y: 0.13182590420533 },
  { name: 'miniature', frames: 48, x: -1.7685, y: 0.0008 },
  { name: 'handover', frames: 240, x: -0.743643887037151, y: 0.13182590420533 },
  { name: 'deep-detail', frames: 400, x: -0.743643887037151, y: 0.13182590420533 },
];

function measure(path) {
  const bytes = fs.readFileSync(path);
  const api = new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports;
  const results = [];
  for (const c of cases) {
    const e = api.engine_create(512, 320);
    const mx = 0.5 + (c.x + 0.5) / (2 * 1.32 * 1.6);
    const my = 0.5 - c.y / (2 * 1.32);
    for (let i = 0; i < c.frames; i++) api.engine_step(e, 0.1, mx, my, 0.5, 1);
    for (let i = 0; i < 8; i++) api.engine_step(e, 0, mx, my, 0.5, 0);
    const samples = [];
    let pointer;
    for (let i = 0; i < 25; i++) {
      const start = performance.now();
      pointer = api.engine_step(e, 0, mx, my, 0.5, 0);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    results.push({ name: c.name, medianMs: samples[12], p95Ms: samples[23],
      iterations: api.engine_stat(e, 10) || 96, depth: api.engine_stat(e, 0),
      refreshes: api.engine_stat(e, 2), tileSkip: api.engine_stat(e, 4),
      escapedFraction: api.engine_stat(e, 5),
      imageHash: createHash('sha256').update(new Uint8Array(api.memory.buffer, pointer, 512 * 320 * 4)).digest('hex') });
    api.engine_free(e);
  }
  return results;
}

const results = { resolution: [512, 320], baseline: fs.existsSync(baseline) ? measure(baseline) : null, current: measure(current) };
if (results.baseline) results.comparison = results.current.map((r, i) => ({
  name: r.name, identicalImage: r.imageHash === results.baseline[i].imageHash, speedup: results.baseline[i].medianMs / r.medianMs,
  sameRegion: r.refreshes === results.baseline[i].refreshes && Math.abs(r.depth - results.baseline[i].depth) < 1e-10,
  baselineIterations: results.baseline[i].iterations, currentIterations: r.iterations,
}));
if (process.env.REQUIRE_IDENTICAL === '1') assert.ok(results.comparison?.every(r => r.identicalImage && r.sameRegion), 'Optimization changed a reference image');
fs.mkdirSync(new URL('./artifacts/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./artifacts/performance.json', import.meta.url), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
