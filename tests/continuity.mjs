import fs from 'node:fs';
import assert from 'node:assert/strict';
const api = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(new URL('../web/mandelbrot_drift.wasm', import.meta.url))), {}).exports;
const results = [];
const mx = 0.5 + (-0.743643887037151 + 0.5) / (2 * 1.32 * 1.5);
const my = 0.5 - 0.13182590420533 / (2 * 1.32);
for (const depth of [4, 12, 13, 28, 36, 128 * Math.log10(2)]) {
  for (const direction of [-1, 1]) {
    const e = api.engine_create(192, 128);
    let remaining = depth - direction * 1e-10;
    while (remaining > 1e-12) {
      const dz = Math.min(0.25, remaining);
      api.engine_step(e, dz / 2.5, mx, my, 2.5, 1);
      remaining -= dz;
    }
    let ptr;
    for (let i = 0; i < 16; i++) ptr = api.engine_step(e, 0, mx, my, 0, 0);
    const before = new Uint8Array(api.memory.buffer, ptr, 192 * 128 * 4).slice();
    ptr = api.engine_step(e, 2e-10 / 2.5, mx, my, direction * 2.5, 1);
    const after = new Uint8Array(api.memory.buffer, ptr, before.length).slice();
    let difference = 0;
    for (let i = 0; i < before.length; i++) if (i % 4 !== 3) difference += Math.abs(after[i] - before[i]);
    const meanChannelChange = difference / (192 * 128 * 3);
    // With thousands of iterations, tiny movements can cross very fine
    // boundaries. Compare the crossing with an equal step beside it.
    ptr = api.engine_step(e, 2e-10 / 2.5, mx, my, direction * 2.5, 1);
    const nearby = new Uint8Array(api.memory.buffer, ptr, before.length).slice();
    let ordinaryDifference = 0;
    for (let i = 0; i < after.length; i++) if (i % 4 !== 3) ordinaryDifference += Math.abs(nearby[i] - after[i]);
    const ordinaryChange = ordinaryDifference / (192 * 128 * 3);
    ptr = api.engine_step(e, 0, mx, my, 0, 0);
    assert.deepEqual(new Uint8Array(api.memory.buffer, ptr, before.length), nearby, 'A paused view must not keep changing');
    assert.equal(api.engine_stat(e, 2), 0);
    assert.ok(meanChannelChange < Math.max(0.2, 3 * ordinaryChange), `Visible seam at 10^${depth}, direction ${direction}: ${meanChannelChange}`);
    results.push({ depth, direction, meanChannelChange, ordinaryChange });
    api.engine_free(e);
  }
}
console.log(JSON.stringify(results, null, 2));
fs.mkdirSync(new URL('./artifacts/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./artifacts/continuity.json', import.meta.url), JSON.stringify(results, null, 2));
