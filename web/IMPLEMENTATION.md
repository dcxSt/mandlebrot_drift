# The static viewer

Serve the contents of `web/` over HTTP(S). Rust performs the rendering in a worker; JavaScript handles input, transfers reusable RGBA buffers, and displays them on Canvas. There are no runtime dependencies, external math libraries, remote rendering services, or required WASM threads. The default module uses f64 SIMD; the worker falls back to `mandelbrot_drift_scalar.wasm` if loading the SIMD module fails. `?renderer=scalar` exercises that fallback.

## Navigation

Scroll up to start continuous zoom in; scroll down to reverse. Velocity eases through zero. Space or the play button stops travel. The mouse guides the zoom; dragging with mouse or touch pans and temporarily holds zoom. Clicking or tapping eases the selected point to the center and starts zooming in. Zoom out stops at the current region's overview. Reset restores the full set. Hidden tabs do not accumulate a time jump.

“The math” opens a scrollable on-page summary with HTML equations, on desktop and mobile. Opening it pauses travel; closing resumes if previously running. The original research explainer remains unchanged.

## Local orbit reuse

For a local parameter `c = c₀ + r u`, a cubic represents an already-computed orbit:

$$Q(u)=A+Bu+Cu^2+Du^3.$$

Each recurrence step updates the coefficients to

$$A'=A^2+c_0,\quad B'=2AB+r,\quad C'=2AC+B^2,\quad D'=2AD+2BC.$$

A zoom evaluates `Q(s + f u)` by translating and scaling its coefficients. That transformation is exact for the stored cubic. Orbit advancement truncates higher powers, so inherited error remains. At most eight shared steps are attempted each frame, accepting only limited spread and small new tails. A fixed 16×12 tile grid attempts at most 24 further steps per tile with a local error estimate.

Pixel continuation starts at 101 steps, adds five per 3× local zoom, and caps at 201. Analytic cardioid and period-two bulb checks, a near-periodicity check every 16 steps, finite-difference scanlines, two-lane SIMD, approximate color logarithms, and a palette lookup table reduce work. The log approximation has a tested absolute error below 1.7e-6 on the relevant mantissa range. These are visual heuristics, not interval-certified membership or escape-time bounds.

Expanding the viewport clears its truncated orbit prefix, because a polynomial accepted on a smaller disk cannot be assumed valid on a larger one. Local coordinates may drift in floating point; this is not an arbitrary-precision explorer.

## Continuous deep detail

The former automatic atlas replacement at 12 decades (or in a quiet region) has been removed. Zooming alone never invokes a regional refresh.

Between 8 and 16 local zoom decades, a smoothstep envelope blends the orbit image into a synthesized periodic field. The field uses the same Mandelbrot recurrence, with bounded continuation, and a periodic parameter map:

$$c(x,y)=-0.5+1.4\sin x+i\,1.1\sin y.$$

Two layers sample phases `p = phase + radius·u` and `2p`. Radius remains between 2 and 4. Their blend weight is `smoothstep(log₂(4/radius))`. When radius passes below 2, it doubles and phase doubles: the old fine layer becomes exactly the new coarse layer. The inverse transition works when zooming out. Blend slopes vanish at endpoints. Phase wraps modulo 2π, which preserves both current layers. Panning and mouse anchoring transform both layers together.

Consequently the scale transitions have matching limits; they do not replace an image with an unrelated atlas patch. Pixel sampling, finite iteration cutoffs, palette quantization, and approximation can still produce small pixel changes. This is continuous artistic motion with repeating synthesized detail, not unique mathematical detail forever. Discarding phase bits means long reverse trips can follow a different route. The absolute parameter scale is recovered when reversing from floating-point underflow, but discarded precision is not recovered.

“Find another edge” explicitly searches four candidates in a ten-region atlas with 25 probes each and crossfades over about 0.9 seconds. It resets the local zoom counter when the new region arrives. This intentional region change is distinct from normal zooming.

## Resource budget

At fixed resolution N, a frame has a constant upper work bound: at most two local chart renders (201N continuation steps and 192×24 tile steps each), plus two procedural orbits per pixel (201 steps each). The periodic map computes its sine values once per row and column, and its scale weight once per frame. Once procedural detail is opaque, the covered local chart is skipped entirely (except during an explicit region transition). Shared advancement and explicit atlas search also have fixed caps. Many orbits escape or stop early; constant bounded work does not mean identical frame time.

Auto detail starts around 185,000 desktop or 115,000 narrow-screen pixels and adapts between 65,000 and 260,000. A paused frame requests at least 340,000. Light uses 80,000 and Sharp 360,000, with dimensions capped at 960×720. Only one frame request is in flight; the display requests at most 30 fps. Rust reuses two image buffers, and the worker recycles its transferable buffer. Fixed-resolution zoom does not grow storage.

## Validation

- Native tests cover coefficient translation, mouse anchoring, scanline evaluation, tile shortcuts, color logs, iteration limits, pan, click destinations, zoom reversal, numerical limits, and matching procedural scale boundaries in both directions.
- Actual SIMD WASM completed 4,000 accelerated frames, reaching 1,000 decades (about 2,096 threefold zooms), then 4,000 reverse frames back to overview. No automatic region changes occurred. Linear memory stayed at 1,179,648 bytes. 199 of 200 sampled forward frames contained more than 20 sampled colors.
- SIMD and scalar images match byte-for-byte over 120 frames that cross the procedural handover, including odd tile widths.
- Browser checks cover wheel reversal, mouse/touch navigation, pause, reset, explicit refresh, palette/detail controls, the math panel, mobile layout, and scalar fallback.
- A follow-up optimization preserved all six reference image hashes. At 512×320, the deep-detail case fell from 46.61 ms to 7.60 ms (6.14×), and the mixed handover case from 46.62 ms to 38.92 ms (1.20×). Shallow cases were within about 2–6% slower in this sequential run; their algorithm was unchanged. See `tests/performance-reference.json` for the complete measurements.
- The initial optimization pass measured 1.47–1.72× faster rendering at 512×320 across four fixed views, despite raising continuation budgets from 96 to 101–131. These are Mac/Node measurements, not iPhone results.

Run `cargo test --offline --release`, `node tests/wasm.mjs`, `node tests/continuity.mjs`, and the browser script described in the README. `tests/performance.mjs` compares identical paths against `BASELINE_WASM` or an optional ignored baseline artifact. Machine-specific results and screenshots go to `tests/artifacts/`. The original high-precision experiments and their reports are preserved separately.

To reproduce the follow-up comparison, extract `web/mandelbrot_drift.wasm` from commit `3458da0` to a temporary file, then run `BASELINE_WASM=/path/to/that.wasm REQUIRE_IDENTICAL=1 node tests/performance.mjs`. Timing runs should not overlap other CPU-heavy tests. Local orbit diagnostics report zero when that fully covered image is skipped.
