# The static viewer

Serve `web/` over HTTP(S). Rust renders in a worker; JavaScript handles input and displays reusable RGBA buffers on Canvas. The SIMD module has a scalar fallback, also selectable with `?renderer=scalar`. No external rendering service, math runtime, or WASM threading is required.

## Controls and detail

Scroll up to start continuous zoom in, down to reverse. Velocity eases through zero. Space or the play button pauses. The pointer guides zoom; dragging pans, and clicking/tapping glides to the chosen point. Reset returns to the overview. “The math” opens a scrollable explanation on desktop and mobile. It pauses travel while open.

The iteration budget is

$$\min\left(4096,\;544+\left\lceil\frac{96d}{\log_{10}3}\right\rceil\right),$$

where d is local zoom in decades. The initial 544 includes three 3× levels of headroom above a base of 256. Growth happens one iteration at a time. At 10¹³ the budget is about 3,160, compared with the former 206 cap. Procedural layers use 4,096 steps.

Auto detail starts at 185,000 desktop or 115,000 narrow-screen pixels, can grow to 260,000, and preserves those starting floors when frames become expensive. Paused views request at least 340,000 pixels. Light uses 80,000 and Sharp 360,000, with dimensions capped at 960×720. Difficult regions trade frame rate and travel speed for detail instead of automatically collapsing resolution to 65,000 pixels. There is one frame request in flight, at most 30 per second, and hidden tabs accumulate no time jump.

## Accurate reference, inexpensive differences

Camera coordinates retain a high and low component using compensated addition and Dekker multiplication (double-double arithmetic). Each frame rebuilds one reference orbit in that arithmetic. The same method renders all zoom levels, avoiding a visible switch between the old transported approximation and the new renderer.

For reference parameter C and pixel offset δc, the exact difference recurrence is

$$\delta z_{n+1}=2Z_n\delta z_n+(\delta z_n)^2+\delta c.$$

The reference Z is computed in double-double; pixel differences use f64. A cubic series in the local offset skips a shared prefix. Its accumulated truncation estimate must remain below 1e-18, its spread below 0.02, and its whole disk inside radius 1.9. Rebuilding this series each frame avoids inheriting the old chart's common drift. These are numerical safeguards, not certified interval bounds.

Two adjacent perturbation orbits share SIMD operations. If a pixel outlives the reference, it rebases onto reference index zero and continues, retaining its iteration count. Severe cancellation (pixel squared magnitude below 1e-8 of reference squared magnitude) triggers a direct double-double orbit for that pixel. A tiny-tolerance periodicity check samples every 16 steps and retains checkpoints for doubling intervals. Analytic bulb checks help shallow views. A palette lookup and approximate logarithms reduce color cost.

The difference recurrence, cancellation criterion, and rebasing are described in Claude Heiland-Allen’s [Deep zoom theory and practice](https://www.mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html). Budgets, tolerances, and the implementation here are project choices tested below.

## Beyond finite precision

Normal zooming never changes atlas regions. The former handover at 10⁸–10¹⁶ is gone: 10¹³ now renders the Mandelbrot calculation with no synthesized blend.

For indefinite artistic travel, a smoothstep envelope introduces a periodic detail field between 10²⁸ and 10³⁶. This is a finite-precision policy, not a guarantee of exact coordinates to a particular depth. The field evaluates the Mandelbrot recurrence at

$$c(x,y)=-0.5+1.4\sin x+i\,1.1\sin y.$$

Two layers sample p = phase + radius·u and 2p, with radius between 2 and 4 and weight `smoothstep(log₂(4/radius))`. At a boundary, the old fine layer becomes the new coarse layer. Phase wraps modulo 2π. The matching layers avoid abrupt image swaps, but detail repeats, morphs as layers blend, and long reverse trips may take a different route. This remains artistic continuation, not arbitrary-precision infinite zoom.

“Find another edge” explicitly searches four of ten atlas regions with 25 probes each and crossfades over about 0.9 seconds. It resets the local zoom counter when the new region arrives.

## Bounded resources and limits

The reference is a fixed stack array of 4,097 complex values. At fixed resolution N, each pixel has at most 4,096 perturbation iterations and, when needed, one additional bounded direct orbit. A manual transition renders two regions; procedural blending adds two bounded orbits per pixel. Trigonometric values for the periodic field are cached by row and column, and a fully covered orbit image is skipped. Two Rust pixel buffers and the worker's transferable buffer are reused. Zoom does not grow storage at fixed resolution.

Fixed work ceilings do not mean constant wall time. Late-escaping views and cancellation fallback can be much slower. Finite iteration limits leave some exterior points unresolved; floating-point error, pixel sampling, and fine boundaries can still change individual pixels during zoom. This does not promise crisp or exact detail everywhere.

## Validation

- Native tests cover algebra, camera movements below f64 resolution, iteration headroom, reference perturbation against direct double-double, dimensions, controls, and exact procedural layer matching.
- Five independent 90-digit Decimal fixtures around 10¹³ check direct double-double and perturbation colors within 0.01 iteration. Regenerate with `python3 tests/precision-reference.py`.
- A 31×31 boundary-grid comparison at age 7 reduces missed escapes from 461 with the old cutoff to 63, using a 4,096-step reference run.
- Actual WASM tests travel 4,000 frames to 1,000 decades and 4,000 frames back, checking fixed memory and no automatic atlas changes.
- SIMD/scalar byte parity covers 120 frames plus a detailed 52-frame boundary path to 10¹³, including odd image widths.
- Continuity tests compare movement across thresholds with equal nearby movements and require paused rerenders to be identical. Exact scale matching is tested separately because fine fractal boundaries can change sampled pixels under tiny camera movements.
- Browser checks cover scrolling, mouse/touch navigation, the math panel, scalar fallback, and a 10¹³ boundary screenshot with no procedural blend.

Run `cargo test --offline --release`, `node tests/wasm.mjs`, `node tests/continuity.mjs`, and the browser script described in the README. `tests/performance.mjs` times fixed views at 512×320 after approaching them at 128×80 with the same aspect ratio. Historical optimization timings in `tests/performance-reference.json` describe the earlier, lower-iteration renderer. New machine-specific results and screenshots go to `tests/artifacts/`. A physical iPhone has not been benchmarked. The original high-precision experiments and mathematical explainer remain preserved separately.

The current Mac/Node 512×320 benchmark ranges from about 5.5 ms (overview) to 325 ms (the difficult 10¹² boundary view); a 10²⁰ view takes about 9.9 ms because its shared prefix skips much more work. The slow case is about three frames per second at that resolution. Full results are in `tests/precision-performance.json`; these figures describe a precision/fidelity increase, not a universal speedup.
