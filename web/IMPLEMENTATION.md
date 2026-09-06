# The static viewer

`index.html`, `style.css`, `app.js`, `worker.js`, `icon.svg`, and `mandelbrot_drift.wasm` are the deployable application. Serve them together over HTTP(S). No external fonts, libraries, rendering services, cross-origin isolation, SharedArrayBuffer, or WebAssembly threading are required.

**Rust owns the rendering.**

The dependency-free Rust crate exports a small C-style interface. An opaque engine holds two pixel buffers, a fixed palette lookup table, a current cubic orbit chart, and at most one incoming chart. JavaScript transfers pointer/speed state to a dedicated worker, calls the WASM engine there, and transfers one reusable RGBA buffer back to Canvas. Only one frame request is in flight, so rendering cannot build an unbounded queue or block the main thread.

Within a chart, the engine represents the orbit as a cubic in normalized local coordinates. A mouse-anchored zoom translates and scales that cubic using the binomial identity. It advances at most eight global coefficient steps per frame, accepting only small new truncation tails and limited orbit spread. Common reference drift is deliberately retained.

Every frame recomputes a 16×12 tile grid from the current chart. Each tile can skip at most 24 additional iterations using its own cubic and a conservative local tail envelope. Pixel rendering evaluates the tile polynomial and takes at most 96 continuation steps. Analytic main-cardioid and period-two-bulb checks avoid unnecessary work. Escaped values use smooth escape coloring through a precomputed palette.

The local envelopes are visual heuristics in floating-point arithmetic, not certified error bounds. The engine does not independently prove every skipped escape time or carry an arbitrary-precision global parameter. The earlier experimental report documents why that distinction matters.

**Refreshes keep exploration going.**

If the view has too little variation for about 0.45 seconds, the chart spans more than 12 decades of local zoom, the reference skip count exceeds 2,048, or a numerical condition fails, the engine prepares another patch. A fixed search compares four candidates from a ten-region Mandelbrot atlas, using 25 probes each. It chooses a candidate with useful variation and blends between the two live renders over approximately 0.9 seconds. Travel slows to 12% during that blend so the new patch does not disappear before it becomes visible.

The same procedure powers “Find another edge,” which also works when paused. This is a deliberate finite-scale re-anchoring. It can change the apparent global geometry, and the atlas can repeat. Continued local mouse steering yields different paths through those regions. The implementation provides indefinite operation with bounded resources, not infinitely many guaranteed unique mathematical images.

All pointer positions and charts use local coordinates. A portrait reset fits the full set to the available width. Resizing during a journey changes the aspect ratio without discarding the journey. Hidden tabs stop requesting frames; returning does not trigger a large accumulated-time jump. Reset restores the initial scene and travel counter.

**The budget is independent of zoom depth.**

At a chosen resolution of $N$ pixels, the dominant work is bounded by

$$
2\left[96N+192\cdot24\cdot C_{\mathrm{cubic}}\right]
+2\cdot8\cdot C_{\mathrm{cubic}}+C_{\mathrm{refresh}}.
$$

The factor two is needed only during a transition. Palette lookup, transfer, and Canvas display add linear work in $N$. The fixed refresh search has 100 pixel probes plus four bounded tile setups. These are operation ceilings, not a claim of identical wall time on every frame.

Auto detail starts around 185,000 pixels on desktop and 115,000 on narrow screens, adapts between 65,000 and 260,000, and requests a sharper still frame when paused. Light uses 80,000 pixels; Sharp uses 360,000. Dimensions are independently capped at 960×720, and rounding can reduce the effective pixel count. The main thread requests at most 30 frames per second. Hardware load and thermal behavior can reduce the achieved rate.

Both Rust buffers are reused, and the worker recycles its transferable output buffer. Resizing may grow memory up to the selected resolution's peak; zooming at a fixed resolution does not grow storage. The compiled module uses `f64` arithmetic, avoiding a dependency on optional GPU floating-point features.

**Validation performed.**

- Native Rust tests check cubic translation, pointer anchoring, bounded tile jumps against direct escape coloring, dimension limits, reset, and a 1,000-upsample run.
- An actual WebAssembly run in Node completed 4,000 accelerated 96×64 frames: about 1,253 equivalent 3× zooms, 203 refreshes, and fixed linear memory of 1,179,648 bytes after initialization. 175 of 200 sampled frames had more than 20 sampled colors. That is a simple nonblank check, not a perceptual quality guarantee.
- The small-grid Node run measured approximately 0.61 ms median and 1.33 ms p95 per call on this Mac. Those numbers are not full-screen or iPhone benchmarks.
- Headless Chromium checks passed WASM loading, mouse steering, Space pause, reset, manual refresh, palettes, quality controls, portrait layout, and touch steering, with no captured browser errors.
- A desktop browser sample at 520×344 took about 6.8 ms in the rendering worker. Touch checks used browser emulation; a physical iPhone has not been benchmarked.

Raw automated check outputs and screenshots are written to `tests/artifacts/` when the checks run. The original Decimal experiments, plots, and explainer remain separate and unchanged by the viewer build.
