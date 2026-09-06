# Mandelbrot zoom experiments

This project investigates reusing local Mandelbrot orbit polynomials while zooming, including where the shortcut fails and how to build an indefinitely running visual zoom with bounded work per frame.

- [Original mathematical explainer](mandelbrot-zoom-explainer.md)
- [Experimental findings](results/experiment-report.md)
- [Proposed constant-work visual zoom](constant-work-zoom-plan.md)
- [Error growth chart](results/error-growth.png)
- [Repeated zoom chart](results/repeated-zoom.png)
- [Local detail versus shared error](results/local-detail-error.png)
- [Escape-count stress test](results/stress-grid.png)

The original explainer is preserved. The experiments implement Taylor reuse, error envelopes, recentering, periodic rebuilding, low-precision perturbation, and a NumPy rendering benchmark with direct fallback. The proposed visual zoom is a design, not yet an implemented renderer.

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
