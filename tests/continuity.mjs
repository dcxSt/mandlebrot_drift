import fs from 'node:fs';
import assert from 'node:assert/strict';
const api = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(new URL('../web/mandelbrot_drift.wasm', import.meta.url))), {}).exports;
const results = [];
for (const depth of [8, 12, 13, 16, 64 * Math.log10(2)]) {
  for (const direction of [-1, 1]) {
    const e = api.engine_create(192, 128);
    let remaining = depth - direction * 1e-7;
    while (remaining > 1e-12) {
      const dz = Math.min(0.25, remaining);
      api.engine_step(e, dz / 2.5, 0.46, 0.45, 2.5, 1);
      remaining -= dz;
    }
    let ptr;
    for (let i = 0; i < 16; i++) ptr = api.engine_step(e, 0, 0.46, 0.45, 0, 0);
    const before = new Uint8Array(api.memory.buffer, ptr, 192 * 128 * 4).slice();
    ptr = api.engine_step(e, 2e-7 / 2.5, 0.46, 0.45, direction * 2.5, 1);
    const after = new Uint8Array(api.memory.buffer, ptr, before.length);
    let difference = 0;
    for (let i = 0; i < before.length; i++) if (i % 4 !== 3) difference += Math.abs(after[i] - before[i]);
    const meanChannelChange = difference / (192 * 128 * 3);
    assert.equal(api.engine_stat(e, 2), 0);
    assert.ok(meanChannelChange < 0.2, `Visible seam at 10^${depth}, direction ${direction}: ${meanChannelChange}`);
    results.push({ depth, direction, meanChannelChange });
    api.engine_free(e);
  }
}
console.log(JSON.stringify(results, null, 2));
fs.mkdirSync(new URL('./artifacts/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('./artifacts/continuity.json', import.meta.url), JSON.stringify(results, null, 2));
