let wasm, engine, width, height;

async function init(w, h) {
  const response = await fetch(new URL('mandelbrot_drift.wasm', import.meta.url));
  if (!response.ok) throw new Error(`Renderer download failed (${response.status}).`);
  let result;
  try { result = await WebAssembly.instantiateStreaming(response.clone(), {}); }
  catch { result = await WebAssembly.instantiate(await response.arrayBuffer(), {}); }
  wasm = result.instance.exports;
  engine = wasm.engine_create(w, h);
  width = wasm.engine_stat(engine, 7);
  height = wasm.engine_stat(engine, 8);
  postMessage({ type: 'ready' });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') { await init(data.width, data.height); return; }
    if (!wasm) return;
    if (data.type === 'reset') { wasm.engine_reset(engine); return; }
    if (data.type === 'renew') { wasm.engine_renew(engine); return; }
    if (data.type === 'palette') { wasm.engine_palette(engine, data.id); return; }
    if (data.type !== 'frame') return;
    if (data.width !== width || data.height !== height) {
      wasm.engine_resize(engine, data.width, data.height);
      width = wasm.engine_stat(engine, 7); height = wasm.engine_stat(engine, 8);
    }
    const started = performance.now();
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
      memory: wasm.memory.buffer.byteLength,
    }, [buffer]);
  } catch (error) {
    postMessage({ type: 'error', message: error.message || String(error) });
  }
};
