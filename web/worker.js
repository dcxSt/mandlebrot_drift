let wasm, engine, width, height, backend = 'simd';

async function loadModule(name) {
  const response = await fetch(new URL(name, import.meta.url));
  if (!response.ok) throw new Error(`Renderer download failed (${response.status}).`);
  try { return await WebAssembly.instantiateStreaming(response.clone(), {}); }
  catch { return await WebAssembly.instantiate(await response.arrayBuffer(), {}); }
}

async function init(w, h, forceScalar) {
  let result;
  try {
    if (forceScalar) throw new Error('Scalar renderer requested');
    result = await loadModule('mandelbrot_drift.wasm');
  } catch {
    backend = 'scalar';
    result = await loadModule('mandelbrot_drift_scalar.wasm');
  }
  wasm = result.instance.exports;
  engine = wasm.engine_create(w, h);
  width = wasm.engine_stat(engine, 7);
  height = wasm.engine_stat(engine, 8);
  postMessage({ type: 'ready' });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') { await init(data.width, data.height, data.forceScalar); return; }
    if (!wasm) return;
    if (data.type === 'reset') { wasm.engine_reset(engine); return; }
    if (data.type === 'renew') { wasm.engine_renew(engine); return; }
    if (data.type === 'palette') { wasm.engine_palette(engine, data.id); return; }
    if (data.type === 'goto') { wasm.engine_goto(engine, data.mx, data.my); return; }
    if (data.type === 'cancel-goto') { wasm.engine_goto(engine, 0.5, 0.5); return; }
    if (data.type !== 'frame') return;
    if (data.width !== width || data.height !== height) {
      wasm.engine_resize(engine, data.width, data.height);
      width = wasm.engine_stat(engine, 7); height = wasm.engine_stat(engine, 8);
    }
    const started = performance.now();
    if (data.panX || data.panY) wasm.engine_pan(engine, data.panX || 0, data.panY || 0);
    const pointer = wasm.engine_step(engine, data.dt, data.mx, data.my, data.speed, +data.running);
    const length = width * height * 4;
    const buffer = data.recycle?.byteLength === length ? data.recycle : new ArrayBuffer(length);
    new Uint8Array(buffer).set(new Uint8Array(wasm.memory.buffer, pointer, length));
    postMessage({ type: 'frame', buffer, width, height, version: data.version,
      ms: performance.now() - started,
      depth: wasm.engine_stat(engine, 0), skipped: wasm.engine_stat(engine, 1),
      refreshes: wasm.engine_stat(engine, 2), tileSkip: wasm.engine_stat(engine, 4),
      transitioning: !!wasm.engine_stat(engine, 9),
      escaped: wasm.engine_stat(engine, 5), variance: wasm.engine_stat(engine, 6),
      iterations: wasm.engine_stat(engine, 10), navigating: !!wasm.engine_stat(engine, 11),
      center: [wasm.engine_stat(engine, 12), wasm.engine_stat(engine, 13)], scale: wasm.engine_stat(engine, 14),
      memory: wasm.memory.buffer.byteLength,
      backend, detailBlend: wasm.engine_stat(engine, 15),
    }, [buffer]);
  } catch (error) {
    postMessage({ type: 'error', message: error.message || String(error) });
  }
};
