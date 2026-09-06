# Reusing Mandelbrot calculations while zooming

The proposed strategy is to keep a fixed-size image, zoom into one ninth of its area, retain useful old samples, and cheaply fill the spaces between them. The mathematical opportunity is real: nearby parameters share a locally predictable orbit. Store a small polynomial describing that neighborhood, and a new pixel can jump past many iterations by evaluating the polynomial.

The important qualification is that fixed pixel count does not guarantee fixed computation. The accuracy and useful lifetime of that polynomial depend on the orbit. We can make reuse adaptive, with an explicit error budget and a fallback when a neighborhood becomes difficult.

This document derives the idea, gives a numerical example, and sketches an algorithm. It is a design explanation, not an implemented or benchmarked phone renderer. The established techniques closest to this proposal are **perturbation** and **series approximation**. Perturbation computes differences from a shared reference orbit; series approximation evaluates a local polynomial to skip an initial stretch of iterations. [Perturbation](https://mathr.co.uk/web/m-perturbation.html), [Series approximation](https://mathr.co.uk/web/m-series-approximation.html)

**Start with the function we actually want to reuse.**

Let the complex parameter be $c=x+iy$. Define

$$
F_0(c)=0,\qquad F_{n+1}(c)=F_n(c)^2+c.
$$

Thus

$$
\begin{aligned}
F_1(c)&=c,\\
F_2(c)&=c^2+c,\\
F_3(c)&=(c^2+c)^2+c=c^4+2c^3+c^2+c.
\end{aligned}
$$

Strictly, this is $F_n(c)=T_c^{\circ n}(0)$, where $T_c(z)=z^2+c$. We repeatedly apply a map in $z$, holding $c$ fixed; we are not repeatedly composing the function $F_1(c)=c$.

For $n\ge1$, the degree of $F_n$ is $2^{n-1}$. The tenth iterate is already a degree-512 polynomial. Expanding the entire polynomial becomes impractical very quickly, but a short local expansion can remain useful.

Use $d$ for the fixed parameter offset between two pixels, and $\Delta_n$ for their changing orbit difference. Both are complex numbers:

$$
z_n=F_n(c),\qquad w_n=F_n(c+d),\qquad \Delta_n=w_n-z_n.
$$

**The difference recurrence is exact.**

Subtract the two orbit updates:

$$
\begin{aligned}
\Delta_{n+1}
&=(z_n+\Delta_n)^2+c+d-(z_n^2+c)\\
&=2z_n\Delta_n+\Delta_n^2+d.
\end{aligned}
$$

Therefore

$$
\boxed{\Delta_0=0,\qquad\Delta_{n+1}=2z_n\Delta_n+\Delta_n^2+d.}
$$

Nothing has been approximated here. In exact arithmetic this produces the exact neighbor orbit. In floating-point arithmetic it still incurs rounding error. By itself it also still takes one update per iteration; skipping work requires another step.

Your suggested factorization is exact too. Write $\Delta_n=dG_n(c,d)$. Then

$$
G_0=0,\qquad G_{n+1}=2F_n(c)G_n+dG_n^2+1.
$$

This defines a polynomial even at $d=0$, without dividing numerically by a tiny number. But evaluating this recurrence separately for each neighbor still repeats all the iterations.

**Precompute how the orbit changes with the parameter.**

Expand about the reference parameter:

$$
\Delta_n=A_nd+B_nd^2+C_nd^3+\cdots.
$$

Here $A_n=F_n'(c)$, $B_n=F_n''(c)/2!$, and $C_n=F_n'''(c)/3!$. Substitute this expansion into the exact difference recurrence and collect powers of $d$:

$$
\boxed{\begin{aligned}
A_{n+1}&=2z_nA_n+1,\\
B_{n+1}&=2z_nB_n+A_n^2,\\
C_{n+1}&=2z_nC_n+2A_nB_n.
\end{aligned}}
$$

Initialize all three coefficients to zero. Update them using the **old** values of $z_n,A_n,B_n,C_n$, then advance $z_n$.

For an arbitrary retained order $p$, writing $a_{n,k}$ for the coefficient of $d^k$,

$$
a_{n+1,k}=2z_na_{n,k}
+\sum_{j=1}^{k-1}a_{n,j}a_{n,k-j}
+\mathbf{1}_{k=1}.
$$

The retained coefficients are the exact Taylor coefficients in exact arithmetic: higher powers cannot feed back into lower powers. The approximation occurs when we omit the higher powers during evaluation.

For a concrete symbolic check, the third iterate gives

$$
\begin{aligned}
F_3(c+d)=F_3(c)
&+(4c^3+6c^2+2c+1)d\\
&+(6c^2+6c+1)d^2\\
&+(4c+2)d^3+d^4.
\end{aligned}
$$

At iteration 10, store $z_{10},A_{10},B_{10},C_{10}$. For each new neighbor, evaluate

$$
\widehat w_{10}=z_{10}+d\bigl(A_{10}+d(B_{10}+dC_{10})\bigr),
$$

then continue with

$$
\widehat w_{11}=\widehat w_{10}^2+(c+d).
$$

That replaces ten orbit steps per new pixel with a cubic evaluation, provided its error is acceptable. The same idea is more compelling when a shared polynomial can skip hundreds or thousands of steps. These coefficient recurrences and shared evaluations are the core of established series approximation. [Series approximation](https://mathr.co.uk/web/m-series-approximation.html)

**How fast can neighboring orbits separate?**

For very small $d$ and fixed $n$, the leading behavior is

$$
\Delta_n\approx A_nd.
$$

Unrolling the derivative recurrence gives

$$
A_n=\sum_{j=0}^{n-1}\prod_{k=j+1}^{n-1}(2z_k),
$$

where an empty product is 1. Products of orbit values can amplify tiny offsets enormously; their complex phases can also cause cancellation. Sensitivity depends on the whole orbit, not just its latest value.

A conservative bound on the full separation, valid for every $|d|\le r$, is

$$
D_0=0,\qquad D_{n+1}=2|z_n|D_n+D_n^2+r.
$$

Then $|\Delta_n|\le D_n$. This bound can become pessimistic because it discards cancellations, but it demonstrates why pixel spacing alone is insufficient.

There is no universal rule that a 3× spatial zoom requires exactly one extra Mandelbrot iteration. Zoom changes which parameters we sample; the iteration budget controls how long we investigate them. Their relationship depends on location and the detail we want to resolve.

Shrinking $|d|$ by three suppresses a degree-$k$ term by $3^k$, **at the same reference and iteration**. Thus a cubic's leading fourth-order error often drops by roughly 81×. Advancing the orbit changes the coefficients, so this is not an unconditional gain across zoom levels.

**A numerical example at your proposed tenth iteration.**

For $c=-0.75+0.1i$, direct calculation gives approximately

$$
\begin{aligned}
z_{10}&=-0.345378913-0.119013396i,\\
A_{10}&=-1.415887542+0.858455908i,\\
B_{10}&=6.716548457+3.709918813i,\\
C_{10}&=17.541453894-31.372896248i.
\end{aligned}
$$

Using unrounded coefficients, compare each approximation against direct iteration of $c+d$, with a real offset $d$:

| Offset | Linear absolute error | Quadratic absolute error | Cubic absolute error |
|---|---:|---:|---:|
| $10^{-2}$ | $7.666\times10^{-4}$ | $3.530\times10^{-5}$ | $1.842\times10^{-6}$ |
| $10^{-3}$ | $7.673\times10^{-6}$ | $3.588\times10^{-8}$ | $1.863\times10^{-10}$ |
| $10^{-4}$ | $7.673\times10^{-8}$ | $3.594\times10^{-11}$ | $\approx1.9\times10^{-14}$ |

These are illustrative floating-point measurements, not certified bounds; the smallest value is affected by rounding. They show the expected second-, third-, and fourth-order error reduction. Other locations and later iterations can behave very differently.

**An error bound that can decide whether to skip.**

Here is a conservative bound derived directly from the recurrence. Let

$$
P_n(d)=\sum_{k=1}^{p}a_{n,k}d^k,
\qquad e_n(d)=\Delta_n(d)-P_n(d).
$$

Suppose the entire tile lies in $|d|\le r$. Define

$$
S_n=\sum_{k=1}^{p}|a_{n,k}|r^k
$$

and bound the discarded high-degree part of $P_n^2$ by

$$
T_n=\sum_{\substack{1\le i,j\le p\\i+j>p}}
|a_{n,i}|\,|a_{n,j}|r^{i+j}.
$$

Because $P_{n+1}$ retains the terms through degree $p$ of $2z_nP_n+P_n^2+d$, subtraction yields

$$
e_{n+1}=2(z_n+P_n)e_n+e_n^2
+\operatorname{tail}_{>p}(P_n^2).
$$

Consequently, a uniform error bound is

$$
\boxed{E_0=0,\qquad
E_{n+1}=2(|z_n|+S_n)E_n+E_n^2+T_n.}
$$

This proves $|e_n(d)|\le E_n$ for the tile **in exact arithmetic**. For a cubic,

$$
T_n=(2|A_nC_n|+|B_n|^2)r^4
+2|B_nC_n|r^5+|C_n|^2r^6.
$$

Choose an absolute orbit-error budget $\tau$, and accept a checkpoint only when $E_n\le\tau$. There is no universal $\tau$ that guarantees every color or membership decision: those require their own margins.

To make this a machine-certified bound, also enclose reference-orbit, coefficient, polynomial-evaluation, and rounding errors using outward-rounded interval or ball arithmetic. Merely computing the displayed positive bound with ordinary floats does not make it certified. A practical first prototype can use this bound as a conservative guide and compare results against a higher-precision baseline.

Checking that the last retained term is small is cheaper, but is a heuristic: it does not bound all omitted terms or accumulated error.

**A correct tenth iterate is not the whole rendering problem.**

Escape-time coloring asks when an orbit first exceeds the bailout radius, usually 2. If we jump to iteration 10, we must account for iterations 1–9 as well.

A sufficient tile-wide condition for a safe skipped prefix is

$$
|z_j|+S_j+E_j\le2
\quad\text{for every skipped iteration }j.
$$

Then no pixel in the tile crossed that bailout threshold during the prefix. If this bound fails, it does not prove escape; it means we need smaller tiles, a shorter skip, or individual checks. Cache the prefix result when building the tile rather than repeating all these checks for every pixel.

After a jump, let a pixel's approximate orbit value be $\widehat w$, with error at most $E$. For an otherwise exact ordinary update, its propagated error is bounded by

$$
E_{\mathrm{next}}\le2|\widehat w|E+E^2.
$$

Add rounding and parameter errors in an implementation. If $|\widehat w|-E>2$, escape is certain. If $|\widehat w|+E\le2$, it has not crossed the threshold at this iteration. An overlapping interval requires refinement. Smooth coloring needs enough accuracy in the escaped orbit value as well.

A pixel that has not escaped by a finite iteration limit remains unresolved unless a separate interior test proves membership. Reusing an old black pixel as permanently inside would lose newly revealed detail.

**Apply this to a 3× zoom on each axis.**

Suppose the viewport contains $N=W\times H$ pixels and the old complex-plane grid spacing is $h$. The next viewport covers one ninth of the area with the same $N$ pixels and spacing $h/3$.

For appropriately aligned grids, approximately $N/9$ old samples lie in the new viewport and coincide with every third new sample on each axis. Approximately $8N/9$ samples are new. Exact counts depend on boundaries and alignment; arbitrary panning need not preserve any exact sample positions.

Around an aligned retained sample, its eight immediate new neighbors have offsets

$$
d\in\{(a+ib)h/3:a,b\in\{-1,0,1\}\},
$$

so their maximum distance is $\sqrt{2}h/3$. That radius can drive the error bound. A local polynomial supports arbitrary offsets too, so exact grid alignment is helpful but unnecessary.

Storing only $F_{10}(c)$, an iteration count, or a color is insufficient to determine how neighbors behave. Store the local coefficients and their validity information, or retain the reference history needed to construct them. Computing those coefficients costs work, so sharing them across a tile is often more attractive than maintaining a polynomial at every pixel.

One possible frame update is:

1. Keep a fixed output grid and crop the cache to the new viewport, retaining reference data needed by visible tiles.
2. Reuse exact coincident samples with their orbit state and uncertainty.
3. For each remaining region, use a cached local polynomial whose parameter disk contains it.
4. Choose the deepest cached checkpoint satisfying the error budget and the skipped-prefix bailout condition.
5. Evaluate the polynomial at each new pixel, then continue its orbit until escape or the current iteration limit.
6. Split difficult tiles or compute a new reference when the available approximation is insufficient. Refine unresolved pixels progressively.

At very deep zoom, represent a pixel as a high-precision reference parameter plus a separate small offset. Do not form $c+d$ in low precision if it rounds back to $c$. Continue with the perturbation recurrence and shared reference orbit instead. This is the principal precision advantage of perturbation; it is not inherently a reduction in iteration count. [Perturbation](https://mathr.co.uk/web/m-perturbation.html)

**Reusing a polynomial across successive zooms.**

If the zoom stays centered on the same reference, the existing coefficients remain applicable; only the required radius shrinks. Recompute the radius-dependent bounds from cached coefficient checkpoints, or retain the earlier conservative bounds. This can make a previously unusable deeper checkpoint valid.

If the center moves by $s$, a stored polynomial

$$
Q_n(d)=z_n+\sum_{k=1}^{p}a_{n,k}d^k
$$

can be translated by substituting $d=s+u$. Its new coefficients are

$$
b_j=\sum_{k=j}^{p}q_k\binom{k}{j}s^{k-j},
\qquad q_0=z_n,\quad q_k=a_{n,k}\ (k\ge1).
$$

This translation is exact for the stored polynomial, not for the full Mandelbrot iterate. The old uniform error bound still applies if the new disk lies inside the old one: $|s|+r_{\mathrm{new}}\le r_{\mathrm{old}}$. Translation does not recover omitted information. Repeated translations and continued iterations must carry their uncertainty; periodically building a fresh reference prevents uncontrolled drift.

For numerical range, it can help to write $d=ru$ and store scaled coefficients $a_{n,k}r^k$, evaluating at $|u|\le1$. This avoids some combinations of enormous coefficients and tiny powers, but does not remove precision or conditioning limits.

**What resources does this save?**

Let $K$ be the desired iteration limit, $m$ a valid skipped prefix, $p$ the polynomial order, and $R$ the number of reference tiles. A simplified arithmetic model is:

| Method | Approximate work for a frame |
|---|---|
| Direct iteration | $O(NK)$ |
| Shared degree-$p$ prefix, then continuation | $O(Rmp^2+N[p+K-m])$ |

The first term builds coefficients by straightforward convolution; it can be amortized across frames. The estimate omits early escapes, adaptive checks, precision costs, cache traffic, and fallback work. It illustrates the desired saving without promising a particular speedup.

Holding $N$ fixed prevents pixel count from growing. If $p$, $R$, and the remaining work $K-m$ stay modest, frame cost can stay fairly stable in favorable regions. None is guaranteed to stay fixed along every zoom path. A fixed frame-time budget is achievable by progressive refinement, with variable time to reach a chosen quality.

Storing one cubic state as four complex values with 32-bit real components uses 32 bytes, or about 32 MB for a million pixels, before bounds and other metadata. This is a storage illustration, not an accuracy recommendation. Tile references reduce coefficient storage; orbit histories and checkpoints add their own memory costs. Keep a bounded cache and measure the tradeoff between reuse and memory traffic.

Reference coordinates need more precision as zoom deepens, even if per-pixel differences use cheaper arithmetic. Cancellation between a reference orbit and its delta can also spoil accuracy; failed uncertainty checks should trigger a better reference or a higher-precision fallback.

An additional established option is to approximate blocks of perturbation steps by a map $\Delta_{n+\ell}\approx A\Delta_n+Bd$. Two consecutive blocks compose as $A=A_2A_1$, $B=A_2B_1+B_2$, allowing long jumps wherever their validity conditions hold. This is commonly called BLA and can accelerate later portions of an orbit, beyond a single initial Taylor jump. The cited account explicitly treats some radius estimates as heuristic; such estimates are not a substitute for certified error bounds. [Deep zoom theory and practice (again)](https://mathr.co.uk/blog/2022-02-21_deep_zoom_theory_and_practice_again.html)

For an initial experiment, use cubic tile polynomials, the tenth-iterate example, and a higher-precision direct baseline. Measure accepted skip lengths, orbit error, escape-time agreement, fallback frequency, total frame time, and cache size across several zoom locations. The decisive question is how much shared history can be skipped within a specified error budget—not simply how small the new pixel spacing becomes.
