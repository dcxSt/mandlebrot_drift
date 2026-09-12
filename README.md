# Mandel / Drift

A static, interactive Mandelbrot-like zoom built in **Rust and WebAssembly**. Scroll to zoom in or out, steer with the mouse, drag to pan, click to travel, reset, change pace, and choose a palette. The original mathematical explainer and experimental results are preserved below.

The ready-to-serve site is in **`web/`**, including compiled SIMD and scalar WebAssembly modules. It has no runtime dependencies, CDN assets, or application backend.

```sh
python3 scripts/serve.py --port 0
```

Open the localhost address printed by the server. To deploy, upload the **contents of `web/`** to any static web host; all paths are relative. Opening `index.html` directly through `file://` cannot load its worker and WebAssembly module in normal browsers.

Rebuild the Rust engine after editing:

```sh
rustup target add wasm32-unknown-unknown  # once, if not already installed
sh scripts/build.sh
```

The Rust crate has no third-party dependencies and builds offline once the target is installed. JavaScript handles input, a worker, and Canvas display; the fractal calculations are in Rust.

- **Space:** start/pause. **R:** reset.
- **Scroll:** up starts zooming in, down reverses; Space stops. **Pointer:** guides zoom. **Drag:** pan with mouse or touch. **Click/tap:** glide to a point.
- **The math:** read an on-page explanation of orbit reuse, error, optimizations, and artistic shortcuts.
- **Pace:** controls continuous zoom speed. **Find another edge:** blends to another region.
- **Auto detail:** adapts resolution within fixed ceilings. **Light/Sharp:** choose fixed pixel budgets.

The renderer rebuilds a double-double reference orbit and shared cubic perturbation prefix each frame. Pixel continuation starts at 544 steps, grows by 96 per 3× zoom (in single-iteration increments), and caps at 4,096. The initial budget includes three 3× zoom levels of headroom so more detail resolves ahead of the camera. Reference-orbit perturbation reduces accumulated drift, with a direct high-precision fallback for cancellation. Normal zooming never jumps to another atlas region. Instead, between 10²⁸ and 10³⁶ local zoom it gradually introduces a periodic Mandelbrot-like detail field whose overlapping scales match at their boundaries. This keeps motion continuous and resources bounded. Detail repeats and coordinates can drift; it is an artistic continuation, not an exact infinite-precision Mandelbrot zoom. “Find another edge” is an explicit region change and resets the local zoom counter.

See [implementation details and validation](web/IMPLEMENTATION.md). Run the mathematical and actual WASM checks with:

```sh
cargo test --offline --release
node tests/wasm.mjs
```

Browser checks are in [tests/browser.mjs](tests/browser.mjs). They use `puppeteer-core` and an installed Chromium browser; set `DRIFT_URL` to the local server and `CHROME_EXECUTABLE` if needed. `PUPPETEER_MODULE` can point to an existing installed `puppeteer-core.js` module. Browser tooling is needed only for these checks, not for the application.

**The research behind the viewer**

This project investigates reusing local Mandelbrot orbit polynomials while zooming, including where the shortcut fails and how to build an indefinitely running visual zoom with bounded work per frame.

- [Original mathematical explainer](mandelbrot-zoom-explainer.md)
- [Experimental findings](results/experiment-report.md)
- [Proposed constant-work visual zoom](constant-work-zoom-plan.md)
- [Error growth chart](results/error-growth.png)
- [Repeated zoom chart](results/repeated-zoom.png)
- [Local detail versus shared error](results/local-detail-error.png)
- [Escape-count stress test](results/stress-grid.png)

The experiments implement Taylor reuse, error envelopes, recentering, periodic rebuilding, low-precision perturbation, and a NumPy rendering benchmark with direct fallback. The subsequent Rust viewer implements bounded cubic reuse and a continuous periodic detail field. Its procedural field is an artistic approximation, separate from the high-precision numerical experiments.

Run from this directory:

```sh
python3 -m pip install -r experiments/requirements.txt
python3 experiments/run.py
```

The experiment uses Python's standard-library `decimal` module for independent complex arithmetic at 90 decimal digits. NumPy supplies CPU rendering benchmarks; Matplotlib writes figures. No network access is needed once dependencies are installed.

```sh
python3 experiments/run.py --check-only
python3 experiments/run.py --precision 110 --iterations 512 --side 256
```

Reruns overwrite generated CSVs, figures, the stress-grid archive, and metadata in `results/`. The written report describes the default run; it does not update itself when parameters change. Timings vary by machine and load. The script audits selected error results at an additional 40 digits and checks algebraic identities and guarded escape-count agreement.

| Output | Contents |
|---|---|
| `results/error-sweep.csv` | Errors and envelopes by location, radius, degree, and iteration |
| `results/skip-summary.csv` | Prefix lengths before tolerance or bailout conditions fail |
| `results/repeated-zoom.csv` | Inherited, rebuilt, and periodically rebuilt errors |
| `results/precision.csv` | Direct and perturbation errors at 32- and 64-bit component precision |
| `results/timings.csv` | Median CPU timings, escape mismatches, fallback counts |
| `results/metadata.json` | Parameters, environment, precision audit, and script hash |

The high-precision comparisons are numerical evidence. Floating-point error envelopes in this prototype are not interval-certified bounds, and timing-grid comparisons use a double-precision baseline. No iPhone or GPU benchmarking has been performed.
