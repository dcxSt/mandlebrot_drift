# An indefinitely running Mandelbrot-like zoom with fixed work per frame

We can build the experience you want by fixing the rendering budget and allowing the source of new detail to change. Use accurate local Mandelbrot calculations while they are affordable; introduce coherent, deliberately generated fractal detail where the accurate calculation can no longer keep up.

Here “constant computation” means a bounded amount of work per displayed frame at a fixed resolution. Running forever still consumes an unbounded total amount of computation. The intended result is an indefinitely running visual explorer, not a promise of arbitrary-depth exact Mandelbrot membership.

The [experiments](results/experiment-report.md) support local polynomial reuse, but also show why simply shrinking the grid and adding one iteration forever is insufficient. Small inherited errors eventually exceed the new differences between neighboring pixels. The original [explainer](mandelbrot-zoom-explainer.md) supplies the mathematical foundation.

**First, make the original shortcut operate in local coordinates.**

For one reference tile, write the approximate orbit as

$$
Q_t(u)=q_{t,0}+q_{t,1}u+\cdots+q_{t,p}u^p,
\qquad c=c_t+r_tu,\quad |u|\le1.
$$

Here $q_{t,k}=a_{n_t,k}r_t^k$, so the coefficients describe changes across the visible tile rather than derivatives multiplied by extremely small offsets later. Hold $p$ fixed initially at 3. The experiments justify testing degree 5 as a second option, but not increasing degree without a budget limit.

If the next viewport moves by $r_ts$ and shrinks by three, substitute

$$
u=s+v/3.
$$

Translate the polynomial with a fixed amount of work:

$$
\widetilde q_j=3^{-j}\sum_{k=j}^{p}\binom{k}{j}q_{t,k}s^{k-j}.
$$

If we advance one more Mandelbrot iteration, compute

$$
Q_{t+1}(v)=\operatorname{trunc}_p
\left[\widetilde Q_t(v)^2+c_{t+1}+r_{t+1}v\right].
$$

This costs $O(p^2)$ per tile, independent of the already skipped iteration count. It is a useful local prediction model. Its error is inherited and propagated; truncation does not reset that error. Repeated shrinking alone can leave a smooth or nearly flat field, so it is not a mechanism for producing endless accurate new structure.

Keep a separate radius exponent rather than forming tiny global coordinates on the GPU. Use a capped precision budget for reference calculations. Scaling prevents some underflow, but does not restore missing significant digits or eliminate sensitivity. Perturbation and rescaling already exploit this separation between large reference values and small offsets. [Deep zoom theory and practice](https://mathr.co.uk/blog/2021-05-14_deep_zoom_theory_and_practice.html)

**Use uncertainty relative to visible detail.**

An absolute orbit error of $10^{-18}$ cannot by itself certify distinctions between neighbors whose orbits differ by $10^{-30}$. However, an error shared by the whole patch can largely cancel in those differences. Track two quantities: error in the common reference orbit, and error in the relative geometry of its neighbors. For a tile covering $L$ pixels across, a first estimate of one-pixel orbit variation is

$$
V_{\mathrm{pixel}}(u)\approx |Q_t'(u)|\frac{2}{L}.
$$

Use the ratio

$$
\eta(u)=\frac{E_{\mathrm{shape},t}}{\max(V_{\mathrm{pixel}}(u),\epsilon_{\mathrm{floor}})}
$$

as a scheduling signal, where $E_{\mathrm{shape},t}$ estimates error in neighbor-to-center differences. Small $\eta$ favors reuse; increasing $\eta$ favors rebuilding or substituting a local detail model. The numerical floor prevents division by zero; it is not evidence of accuracy. Near vanishing derivatives, evaluate higher-order variation or the polynomial at several nearby positions instead. Estimating this differential error without a full baseline is additional implementation work; absolute error envelopes alone may overestimate it substantially.

An initial engineering target is $\eta<0.1$, subject to image comparisons. This is a heuristic, not a proven screen-space displacement bound. Escape-time classification still requires checking the bailout margin and skipped prefix. Pixel variation, contour displacement, and error in the final color are different quantities.

**Try allowing coordinate drift before inventing new geometry.**

The repeated-zoom experiment shows that common orbit error can become much larger than the neighbor signal while the differential error stays small. For the visual mode, first allow a patch to follow its approximate reference orbit, accepting that it no longer denotes the requested global Mandelbrot coordinate precisely. Retain its local polynomial and relative offsets.

The mechanism can be seen algebraically. If the reference error is $e_0$ and the error in the neighbor difference is $e_\Delta$, the exact difference update gives, before additional truncation or rounding,

$$
e_\Delta'=2(z+\Delta)e_\Delta+e_\Delta^2
+2e_0(\Delta+e_\Delta).
$$

The common reference error enters multiplied by the small neighbor difference. It need not immediately destroy fine structure. Nevertheless, $e_0$ itself can grow, and behavior near critical points can change sharply. This is not a shadowing theorem or a guarantee that the approximate patch corresponds to any single nearby true Mandelbrot parameter.

Use this as the first visual concession: preserve local structure while tolerating drift in exact location. Use procedural residuals only when the local model loses detail, becomes unstable, or cannot be refreshed within budget. This gives the measured reuse strategy the longest useful life before introducing new geometry.

**Put a hard ceiling on every source of work.**

Start with these tunable budgets, which are design choices rather than measured iPhone optima:

| Resource | Initial ceiling | When the ceiling is reached |
|---|---|---|
| Output | Fixed 512×512 internal image | Upscale for display; do not add pixels with depth |
| Active reference tiles | 64 | Reuse or replace the least useful tile |
| Local degree | Cubic; optional degree 5 within budget | Shorten jumps or change detail model |
| Per-pixel orbit work | 24 continuation steps per update | Keep an unresolved estimate |
| Extra refinement | At most one eighth of pixels per frame | Carry the rest forward |
| Reference precision | Fixed limb count selected on device | Stop claiming finer global coordinates are exact |
| Reference building | Fixed number of arithmetic operations per frame | Suspend and resume the job |
| Active detail bands | Three adjacent scale bands | Retire the oldest band |
| Navigation history | A fixed ring of recent levels | Older exact backtracking is unavailable |

Budget reference building, error checks, cache maintenance, and fallback work as well as GPU pixel iterations. The guarded CPU experiment demonstrates that fallback and bookkeeping can erase a shortcut's speed advantage. “Do a full recomputation when necessary” is not a fixed-work policy unless that recomputation is spread across frames.

With fixed precision, tile count, degree, image size, and loop limits, a work model is

$$
W_{\mathrm{frame}}\le
C_1N(p+K)+C_2Rp^2+C_3B_{\mathrm{ref}}+C_4N J,
$$

where $N$ is pixel count, $K$ is the continuation ceiling, $R$ is the tile ceiling, $B_{\mathrm{ref}}$ is the reference-work allowance, and $J$ is the fixed number of active detail bands. The constants include the chosen fixed-size arithmetic. This is an operation bound, not a guarantee of identical wall time: thermal throttling, scheduling, and memory traffic still matter.

**The deliberate corner to cut is uncomputed fine geometry.**

Preserve the computed large-scale shape, contours, and color continuity. In regions whose fine structure is unresolved, replace unavailable exact detail with a deterministic local procedural field. Generate a field from bounded-iteration quadratic dynamics, not independent white-noise pixels.

A candidate field on a tile is

$$
S(u)=P(u)+a\,W(u)\,H_{\sigma}(u).
$$

- $P$ is the inherited coarse scalar field used to draw contours. It need not be an exact distance function.
- $H_{\sigma}$ is a bounded, band-limited detail field derived from a fixed-iteration Julia or Mandelbrot-like motif, using seed $\sigma$.
- $W$ is a boundary window whose value and first derivative vanish at the tile edge.
- $a$ limits how much the new detail can move an existing contour.

For a square tile with coordinates $(x,y)\in[-1,1]^2$, one possible window is $W=(1-x^2)^2(1-y^2)^2$. It prevents the residual from creating a discontinuity at the boundary, provided neighboring tiles already share a consistent inherited field. It can also create visibly quiet tile edges, so use overlapping patches and test for a grid imprint.

Construct $H$ by subtracting a coarse reconstruction from a finer bounded-iteration motif, then normalizing its amplitude. Restrict its spatial frequencies to what the current pixel grid can represent. Fixed supersampling or a fixed-size filter keeps that step within budget. This preserves the coarse appearance while supplying resolvable smaller structures.

Where the inherited field has a reliable nonzero contour gradient, the local estimate $\delta x\approx a|H|/|\nabla P|$ can guide the amplitude limit. Aim for less than a quarter of a parent pixel of initial displacement. Near critical or flat regions, this estimate fails: use measured contour comparisons, taper the residual, or choose a new local motif. The number is a proposed perceptual target, not a validated bound.

Activate residuals mainly near unresolved boundaries. Adding detail everywhere would turn interior bulbs and exterior regions into texture and lose the Mandelbrot appearance. Occasionally introduce a coherent bulb or branching motif below the current resolution, with its orientation and scale tied to the parent's contour geometry.

**Keep newly revealed detail stable over time.**

When zooming 3×, crop and reuse the previous field; retain its geometry while it grows on screen. Introduce the next detail band while it is still subpixel, and let it become visible as magnification increases. Never choose a new random seed every frame.

Give each tile a deterministic child seed from its parent seed and child index. Persist the seed across frames and cache the most recent parents. Within the supported cache window, revisiting a tile should recover the same details. Arbitrary exact backtracking through an unbounded user-chosen path would require additional history; it is outside the constant-memory design.

Use a fractional local zoom phase to blend adjacent bands smoothly. At a scale boundary, rotate the three-band cache and renormalize coordinates. Do not carry an ever-growing floating-point world coordinate into the shader. A bounded seed generator and phase allow indefinite operation, although finite machine state cannot guarantee infinitely many globally unique images.

The difficult part is making each child consistent with the image that was already visible. In the first prototype, explicitly compare the downsampled child image with its parent crop and penalize changes at low spatial frequencies. This is a stronger visual constraint than merely crossfading unrelated fractals.

**Continue improving accurate detail when the camera pauses.**

Spend the fixed refinement allowance on pixels with the largest uncertainty near visible boundaries. Complete suspended reference jobs across multiple frames. Replace procedural estimates with computed ones only when their large-scale appearance agrees, blending changes gradually.

There are two distinct outcomes: additional time can improve Mandelbrot accuracy while the capped representation remains adequate; beyond that range, further work improves the synthetic field's sampling and visual continuity. Do not call the latter convergence to the original Mandelbrot set.

During uninterrupted fast zooming, true refinement may never catch up. The procedural model is what keeps new detail available without increasing work. An optional accurate exploration mode could instead slow navigation or reduce output resolution, but that is a different product tradeoff.

**Implementation order and acceptance criteria.**

1. Build an interactive fixed-resolution viewer with direct rendering as a comparison mode. Add cubic tile checkpoints, normalized offsets, error diagnostics, and a budgeted refinement queue.
2. Port the bounded pixel loop to a GPU backend and measure it on an actual iPhone. Measure p50/p95 frame times, sustained thermal behavior, memory, and reference-job latency; choose the budgets from those measurements.
3. Add the inherited scalar field, deterministic detail generator, and three-band cache. Show an accurate/synthetic diagnostic overlay during development. The user-facing goal is stable shape and satisfying new structure.
4. Test at least 1,000 consecutive 3× zoom transitions. Assert fixed loop ceilings and bounded memory, and check for numerical overflow, flat frames, repeated obvious motifs, seams, and flicker. Passing a finite test is not proof of infinite mathematical novelty.
5. At depths where a higher-precision offline reference is affordable, compare contour displacement, escaped/unresolved classification, and image differences. Once synthetic detail is used, report visual consistency separately from Mandelbrot accuracy.
6. Test paused refinement and navigation reversal within the retained history window. Require deterministic revisits, no large contour jumps, and visible reduction of unresolved accurate pixels where the numerical budget permits it.

The research harness and experiments are implemented. This viewer, its procedural detail model, and its iPhone performance remain proposed work. The next concrete prototype should combine cubic reuse with fixed budgets and a deterministic residual field; that directly tests whether the permitted approximation produces the experience we want.
