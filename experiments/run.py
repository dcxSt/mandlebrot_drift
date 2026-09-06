"""Reproducible Mandelbrot reuse experiments. Run: python3 experiments/run.py.

Decimal supplies an independent high-precision baseline; NumPy timings describe
this host, not an iPhone. Outputs overwrite only generated files in results/.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import platform
import statistics
import time
from dataclasses import dataclass
from decimal import Decimal as D, localcontext
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "results"
SITES = {
    "attracting_zero": ("0", "0"),
    "period_two": ("-1", "0"),
    "parabolic_cusp": ("0.25", "0"),
    "escaping_seahorse": ("-0.75", "0.1"),
    "deep_boundary": ("-0.743643887037151", "0.13182590420533"),
    "repelling_tip": ("-2", "0"),
}


@dataclass(frozen=True)
class C:
    x: D = D(0)
    y: D = D(0)

    def __add__(self, other):
        if not isinstance(other, C):
            other = C(D(other))
        return C(self.x + other.x, self.y + other.y)

    __radd__ = __add__

    def __neg__(self):
        return C(-self.x, -self.y)

    def __sub__(self, other):
        return self + -other

    def __mul__(self, other):
        if not isinstance(other, C):
            return C(self.x * D(other), self.y * D(other))
        return C(self.x * other.x - self.y * other.y,
                 self.x * other.y + self.y * other.x)

    __rmul__ = __mul__

    def __abs__(self):
        return (self.x * self.x + self.y * self.y).sqrt()

    def native(self):
        return complex(float(self.x), float(self.y))


def point(name):
    return C(*(D(v) for v in SITES[name]))


def evaluate(q, u):
    value = C()
    for coefficient in reversed(q):
        value = value * u + coefficient
    return value


def advance(q, center, radius):
    """Exact retained coefficients of F_n(center + radius*u)."""
    p = len(q) - 1
    result = [sum((q[j] * q[k-j] for j in range(k+1)), C())
              for k in range(p+1)]
    result[0] = result[0] + center
    if p:
        result[1] = result[1] + radius
    return result


def build(center, radius, n, p):
    q = [C()] * (p+1)
    for _ in range(n):
        q = advance(q, center, radius)
    return q


def orbit(center, n):
    z = C()
    for _ in range(n):
        z = z*z + center
    return z


def logmag(v):
    return float(v.log10()) if v else -999.0


def write_csv(name, rows):
    with (OUT / name).open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def error_sweep(precision, max_n, sites=None, radii=None):
    rows, summaries = [], []
    directions = [C(D(x), D(y)) for x,y in
                  [(1,0),(-1,0),(0,1),(0,-1),
                   (".6",".8"),("-.6",".8"),(".6","-.8"),("-.6","-.8")]]
    orders = [1, 3, 5, 8]
    radii = radii or ["1e-3", "1e-6", "1e-9", "1e-12", "1e-18"]
    with localcontext() as ctx:
        ctx.prec = precision
        for name in (sites or SITES):
            print("Error sweep:", name, flush=True)
            for radius_string in radii:
                r = D(radius_string)
                center = point(name)
                q = [C()] * 9
                w = [C()] * len(directions)
                parameters = [center + u*r for u in directions]
                bounds = {p: D(0) for p in orders}
                alive = {p: True for p in orders}
                safe = {p: 0 for p in orders}
                endpoint_alive = {p: True for p in orders}
                endpoint_safe = {p: 0 for p in orders}
                bound_alive = {p: True for p in orders}
                bound_safe = {p: 0 for p in orders}
                for n in range(1, max_n+1):
                    for p in orders:
                        coefficients = [abs(v) for v in q[1:p+1]]
                        s = sum(coefficients)
                        tail = sum(coefficients[i-1]*coefficients[j-1]
                                   for i in range(1,p+1) for j in range(1,p+1)
                                   if i+j>p)
                        e = bounds[p]
                        # Once huge, retain infinity instead of exponential overflow.
                        bounds[p] = (2*(abs(q[0])+s)*e+e*e+tail
                                     if e < D("1e100") else D("Infinity"))
                    q = advance(q, center, r)
                    w = [v*v+c for v,c in zip(w, parameters)]
                    max_orbit = max(abs(v) for v in w)
                    for p in orders:
                        err = max(abs(v-evaluate(q[:p+1],u))
                                  for v,u in zip(w,directions))
                        e = bounds[p]
                        s = sum(abs(v) for v in q[1:p+1])
                        endpoint_alive[p] &= err <= D("1e-8")
                        alive[p] &= err <= D("1e-8") and max_orbit <= 2
                        bound_alive[p] &= e <= D("1e-8") and abs(q[0])+s+e <= 2
                        if endpoint_alive[p]: endpoint_safe[p] = n
                        if alive[p]: safe[p] = n
                        if bound_alive[p]: bound_safe[p] = n
                        # Tolerance accounts for Decimal roundoff; not certification.
                        assert err <= e*(1+D("1e-25")) + D(10)**(-precision+30), (name,n,p,err,e)
                        rows.append(dict(site=name,radius=radius_string,order=p,n=n,
                            log10_error=logmag(err), log10_bound=logmag(e),
                            log10_sensitivity=logmag(abs(q[1]))-logmag(r),
                            max_orbit=float(max_orbit),
                            below_noise_floor=err < D(10)**(-precision+30)))
                    if max_orbit>4 or abs(q[0])>4:
                        break
                for p in orders:
                    summaries.append(dict(site=name,radius=radius_string,order=p,
                        observed_prefix=safe[p], bound_prefix=bound_safe[p],
                        endpoint_prefix=endpoint_safe[p],horizon=n,
                        horizon_reached=n==max_n))
    return rows,summaries


def repeated_zoom(precision):
    rows=[]
    with localcontext() as ctx:
        ctx.prec=precision
        for name in ["parabolic_cusp", "deep_boundary", "escaping_seahorse"]:
            center=point(name)
            radius=D("1e-5")
            n=10
            q=build(center,radius,n,3)
            refreshed=q
            shift=C(D(".12"),D(".08"))
            for level in range(60):
                if level % 8 == 0:
                    refreshed=build(center,radius,n,3)
                # Translate old polynomial to center+r*shift, shrink r by 3.
                def translate(coefficients):
                    return [sum((coefficients[k]*shift_power(shift,k-j)*math.comb(k,j)
                                 for k in range(j,4)), C()) * (D(1)/3)**j
                            for j in range(4)]
                translated=translate(q)
                refreshed=translate(refreshed)
                center=center+shift*radius
                radius=radius/3
                q=advance(translated,center,radius)
                refreshed=advance(refreshed,center,radius)
                n+=1
                # Stop before escaped values grow explosively.
                exact=orbit(center,n)
                if abs(exact)>4:
                    break
                rebuilt=build(center,radius,n,3)
                directions=[C(D(1)),C(D(-1)),C(D(0),D(1)),C(D(0),D(-1))]
                truth=[orbit(center+u*radius,n) for u in directions]
                inherited=max(abs(evaluate(q,u)-v) for u,v in zip(directions,truth))
                fresh=max(abs(evaluate(rebuilt,u)-v) for u,v in zip(directions,truth))
                periodic=max(abs(evaluate(refreshed,u)-v) for u,v in zip(directions,truth))
                signal=max(abs(v-exact) for v in truth)
                differential=max(abs((evaluate(q,u)-q[0])-(v-exact))
                                 for u,v in zip(directions,truth))
                rows.append(dict(site=name,level=level+1,n=n,
                    log10_radius=logmag(radius),log10_inherited_error=logmag(inherited),
                    log10_fresh_error=logmag(fresh),log10_periodic_error=logmag(periodic),
                    log10_neighbor_signal=logmag(signal),
                    log10_differential_error=logmag(differential),
                    log10_differential_relative_to_signal=logmag(differential)-logmag(signal),
                    log10_inherited_relative_to_signal=logmag(inherited)-logmag(signal),
                    log10_periodic_relative_to_signal=logmag(periodic)-logmag(signal)))
    return rows


def shift_power(c, k):
    result=C(D(1))
    for _ in range(k): result=result*c
    return result


def precision_experiment(precision):
    rows=[]
    with localcontext() as ctx:
        ctx.prec=precision
        for name,n in [("deep_boundary",128),("parabolic_cusp",128),
                       ("escaping_seahorse",30)]:
            center=point(name)
            reference=[C()]
            for _ in range(n): reference.append(reference[-1]*reference[-1]+center)
            for radius in ["1e-6","1e-12","1e-20","1e-30"]:
                d=C(D(radius),D(radius)*D(".3"))
                target=orbit(center+d,n)
                delta_truth=target-reference[-1]
                for dtype in [np.complex64,np.complex128]:
                    direct=dtype(0)
                    low_c=dtype((center+d).native())
                    delta=dtype(0)
                    low_d=dtype(d.native())
                    for j in range(n):
                        direct=dtype(direct*direct+low_c)
                        z=dtype(reference[j].native())
                        delta=dtype(dtype(2)*z*delta+delta*delta+low_d)
                    def from_native(z):
                        return C(D.from_float(float(z.real)),D.from_float(float(z.imag)))
                    direct_err=abs(from_native(direct)-target)
                    delta_err=abs(from_native(delta)-delta_truth)
                    rows.append(dict(site=name,n=n,radius=radius,dtype=dtype.__name__,
                        log10_direct_abs_error=logmag(direct_err),
                        log10_perturb_delta_abs_error=logmag(delta_err),
                        log10_perturb_delta_relative_error=logmag(delta_err)-logmag(abs(delta_truth)),
                        parameter_collapsed=low_c==dtype(center.native())))
    return rows


def direct_grid(c, limit):
    z=np.zeros_like(c)
    counts=np.full(c.shape,limit+1,dtype=np.int32)
    active=np.ones(c.shape,dtype=bool)
    for n in range(1,limit+1):
        z[active]=z[active]*z[active]+c[active]
        escaped=active & (np.abs(z)>2)
        counts[escaped]=n
        active[escaped]=False
        if not active.any(): break
    return z,counts


def jump_grid(c,d,q,skip,limit):
    z=np.zeros_like(c)
    for a in reversed(q): z=z*d+a
    counts=np.full(c.shape,limit+1,dtype=np.int32)
    active=np.ones(c.shape,dtype=bool)
    for n in range(skip+1,limit+1):
        z[active]=z[active]*z[active]+c[active]
        escaped=active & (np.abs(z)>2)
        counts[escaped]=n
        active[escaped]=False
        if not active.any(): break
    return z,counts


def prefix_envelope(center,radius,skip,precision):
    with localcontext() as ctx:
        ctx.prec=precision
        q=[C()]*4
        e=D(0)
        prefix_ok=True
        for _ in range(skip):
            a,b,c=(abs(v) for v in q[1:])
            tail=2*a*c+b*b+2*b*c+c*c
            e=2*(abs(q[0])+a+b+c)*e+e*e+tail
            q=advance(q,center,D.from_float(radius))
            prefix_ok &= abs(q[0])+sum(abs(v) for v in q[1:])+e<=2
    return float(e),prefix_ok


def guarded_grid(c,d,q,skip,limit,initial_error):
    """Experimental envelope + direct fallback. Float bounds are not certified."""
    z=np.zeros_like(c)
    for a in reversed(q): z=z*d+a
    r=np.max(np.abs(d))
    sensitivity=sum(k*abs(q[k])*r**(k-1) for k in range(1,len(q)))
    e=np.full(c.shape,initial_error+32*np.finfo(float).eps*(1+sensitivity))
    counts=np.full(c.shape,limit+1,dtype=np.int32)
    active=np.ones(c.shape,dtype=bool)
    fallback=np.zeros(c.shape,dtype=bool)
    for n in range(skip+1,limit+1):
        e[active]=2*np.abs(z[active])*e[active]+e[active]**2+32*np.finfo(float).eps*(1+np.abs(c[active])+np.abs(z[active])**2)
        z[active]=z[active]*z[active]+c[active]
        magnitude=np.abs(z)
        uncertain=active & (((magnitude-e<=2)&(magnitude+e>2)) | (e>1e-6))
        fallback[uncertain]=True
        active[uncertain]=False
        escaped=active & (magnitude-e>2)
        counts[escaped]=n
        active[escaped]=False
        if not active.any(): break
    if fallback.any():
        z[fallback],counts[fallback]=direct_grid(c[fallback],limit)
    return z,counts,int(fallback.sum())


def benchmark(precision,side):
    rows=[]
    cases=[("parabolic_cusp",1e-6,128,256),
           ("deep_boundary",1e-10,128,256),
           ("escaping_seahorse",1e-4,16,64),
           ("escaping_seahorse",.002,8,256),
           ("deep_boundary",1e-6,64,512)]
    for name,radius,skip,limit in cases:
        print("Timing:",name,flush=True)
        axis=np.linspace(-radius,radius,side)
        d=axis[None,:]+1j*axis[:,None]
        c=point(name).native()+d
        def setup():
            with localcontext() as ctx:
                ctx.prec=precision
                q=build(point(name),D(1),skip,3)
            return np.array([v.native() for v in q])
        q=setup()
        direct_z,direct_counts=direct_grid(c,limit)
        jump_z,jump_counts=jump_grid(c,d,q,skip,limit)
        _,prefix_counts=direct_grid(c,skip)
        assert np.all(prefix_counts==skip+1), "Benchmark jump skipped an escape"
        initial_error,prefix_ok=prefix_envelope(point(name),float(np.max(abs(d))),skip,precision)
        assert prefix_ok, "Guarded benchmark requires a bounded unescaped prefix"
        _,guarded_counts,fallback_count=guarded_grid(c,d,q,skip,limit,initial_error)
        assert np.array_equal(guarded_counts,direct_counts)
        timings={}
        for label,fn in [("direct",lambda:direct_grid(c,limit)),
                         ("jump_cached",lambda:jump_grid(c,d,q,skip,limit)),
                         ("jump_with_setup",lambda:jump_grid(c,d,setup(),skip,limit)),
                         ("guarded_cached",lambda:guarded_grid(c,d,q,skip,limit,initial_error))]:
            fn()
            samples=[]
            for _ in range(5):
                t=time.perf_counter(); fn(); samples.append(time.perf_counter()-t)
            timings[label]=statistics.median(samples)*1000
        mismatch=np.count_nonzero(direct_counts!=jump_counts)
        rows.append(dict(site=name,radius=radius,side=side,skip=skip,limit=limit,
                         mismatched_escape_pixels=int(mismatch),
                         distinct_escape_counts=int(len(np.unique(direct_counts))),
                         unresolved_pixels=int(np.sum(direct_counts==limit+1)),
                         guarded_mismatches=int(np.count_nonzero(guarded_counts!=direct_counts)),
                         fallback_pixels=fallback_count,
                         max_endpoint_difference=float(np.max(np.abs(direct_z-jump_z))),
                         direct_ms=timings["direct"],cached_ms=timings["jump_cached"],
                         with_setup_ms=timings["jump_with_setup"],
                         cached_speedup=timings["direct"]/timings["jump_cached"],
                         total_speedup=timings["direct"]/timings["jump_with_setup"]))
        rows[-1]["guarded_cached_ms"]=timings["guarded_cached"]
        rows[-1]["guarded_speedup"]=timings["direct"]/timings["guarded_cached"]
        if name=="deep_boundary" and radius==1e-6:
            np.savez_compressed(OUT/"stress-grid.npz",direct=direct_counts,
                               raw=jump_counts,guarded=guarded_counts,limit=limit)
    return rows


def checks():
    with localcontext() as ctx:
        ctx.prec=90
        c=C(D("-.75"),D(".1"))
        q=build(c,D(1),3,4)
        assert abs(q[0]-orbit(c,3))<D("1e-80")
        assert abs(q[1]-(c*c*c*4+c*c*6+c*2+1))<D("1e-80")
        assert abs(q[2]-(c*c*6+c*6+1))<D("1e-80")
        assert abs(q[3]-(c*4+2))<D("1e-80")
        assert q[4]==C(D(1))
        for d in [C(D(".001")),C(D(".002"),D("-.003"))]:
            assert abs(evaluate(q,d)-orbit(c+d,3))<D("1e-80")
        # For n>=2: A_2=-3, then A_(n+1)=4*A_n+1.
        for n in [2,10,40]:
            a=build(C(D(-2)),D(1),n,1)[1]
            assert a==C(-D(2*4**(n-1)+1)/3)
    print("Algebra checks passed",flush=True)


def plots(rows,zoom,precision):
    os.environ.setdefault("MPLCONFIGDIR",str(OUT/".mpl-cache"))
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig,axes=plt.subplots(2,3,figsize=(14,8),sharey=True)
    for ax,name in zip(axes.flat,SITES):
        for order in [1,3,5,8]:
            selected=[r for r in rows if r["site"]==name and r["radius"]=="1e-6"
                      and r["order"]==order and not r["below_noise_floor"]]
            ax.plot([r["n"] for r in selected], [r["log10_error"] for r in selected],label=f"degree {order}")
        ax.axhline(-8,color="black",linestyle=":",linewidth=1)
        ax.set(title=name.replace("_"," "),xlabel="orbit iteration",ylim=(-65,2))
        ax.grid(alpha=.2)
    axes[0,0].set_ylabel("log10 maximum sampled absolute error")
    axes[1,0].set_ylabel("log10 maximum sampled absolute error")
    axes[0,0].legend()
    fig.suptitle(f"Taylor truncation error: radius 1e-6, eight directions, {precision}-digit baseline")
    fig.tight_layout(); fig.savefig(OUT/"error-growth.png",dpi=160); plt.close(fig)
    fig,axes=plt.subplots(1,3,figsize=(14,4),sharey=True)
    for ax,name in zip(axes,["parabolic_cusp","deep_boundary","escaping_seahorse"]):
        s=[r for r in zoom if r["site"]==name]
        for field,label in [("log10_inherited_error","reuse and translate"),
                            ("log10_periodic_error","rebuild every 8 zooms"),
                            ("log10_fresh_error","fresh coefficients")]:
            ax.plot([r["level"] for r in s],[max(-70,r[field]) for r in s],label=label)
        ax.set(title=name.replace("_"," "),xlabel="3x zoom step",ylim=(-72,2))
        ax.grid(alpha=.2)
    axes[0].set_ylabel("log10 maximum sampled absolute error")
    axes[0].legend(); fig.tight_layout(); fig.savefig(OUT/"repeated-zoom.png",dpi=160); plt.close(fig)
    fig,axes=plt.subplots(1,3,figsize=(14,4),sharey=True)
    for ax,name in zip(axes,["parabolic_cusp","deep_boundary","escaping_seahorse"]):
        selected=[r for r in zoom if r["site"]==name]
        for key,label in [("log10_inherited_relative_to_signal","absolute error / neighbor signal"),
                          ("log10_differential_relative_to_signal","differential error / neighbor signal")]:
            ax.plot([r["level"] for r in selected],[r[key] for r in selected],label=label)
        ax.axhline(0,color="black",linestyle=":")
        ax.set(title=name.replace("_"," "),xlabel="3x zoom step")
        ax.grid(alpha=.2)
    axes[0].set_ylabel("log10 error relative to neighbor signal")
    axes[0].legend(fontsize=8)
    fig.tight_layout(); fig.savefig(OUT/"local-detail-error.png",dpi=160); plt.close(fig)
    data=np.load(OUT/"stress-grid.npz")
    fig,axes=plt.subplots(1,3,figsize=(12,4))
    for ax,key,title in zip(axes,["direct","raw","guarded"],
                           ["Direct escape counts","Unguarded cubic: mismatches","Guarded: mismatches"]):
        if key=="direct":
            ax.imshow(data[key],cmap="magma",origin="lower")
        else:
            ax.imshow(data[key]!=data["direct"],cmap="gray",vmin=0,vmax=1,origin="lower")
        ax.set_title(title); ax.set_axis_off()
    fig.tight_layout(); fig.savefig(OUT/"stress-grid.png",dpi=160); plt.close(fig)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--precision",type=int,default=90)
    parser.add_argument("--iterations",type=int,default=384)
    parser.add_argument("--side",type=int,default=256)
    parser.add_argument("--check-only",action="store_true")
    args=parser.parse_args()
    OUT.mkdir(exist_ok=True)
    checks()
    if args.check_only: return
    start=time.perf_counter()
    rows,summaries=error_sweep(args.precision,args.iterations)
    write_csv("error-sweep.csv",rows)
    write_csv("skip-summary.csv",summaries)
    audit,_=error_sweep(args.precision+40,args.iterations,
        sites=["parabolic_cusp","deep_boundary","repelling_tip"],
        radii=["1e-6","1e-18"])
    original={(r["site"],r["radius"],r["order"],r["n"]):r for r in rows}
    differences=[]
    for r in audit:
        old=original[(r["site"],r["radius"],r["order"],r["n"])]
        if not old["below_noise_floor"]:
            differences.append(abs(r["log10_error"]-old["log10_error"]))
    assert max(differences)<1e-8, max(differences)
    zoom=repeated_zoom(args.precision); write_csv("repeated-zoom.csv",zoom)
    zoom_audit=repeated_zoom(args.precision+40)
    assert len(zoom)==len(zoom_audit)
    zoom_differences=[abs(a["log10_differential_relative_to_signal"]-
                          b["log10_differential_relative_to_signal"])
                      for a,b in zip(zoom,zoom_audit)]
    assert max(zoom_differences)<1e-8
    precision=precision_experiment(args.precision); write_csv("precision.csv",precision)
    bench=benchmark(args.precision,args.side); write_csv("timings.csv",bench)
    plots(rows,zoom,args.precision)
    metadata=dict(arguments=vars(args),python=platform.python_version(),
                  platform=platform.platform(),numpy=np.__version__,
                  elapsed_seconds=time.perf_counter()-start,
                  precision_audit_cases=len(differences),
                  precision_audit_max_log10_difference=max(differences),
                  differential_audit_cases=len(zoom_differences),
                  differential_audit_max_log10_difference=max(zoom_differences),
                  source_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  baseline="Decimal complex arithmetic; finite precision, not interval certified")
    (OUT/"metadata.json").write_text(json.dumps(metadata,indent=2)+"\n")
    print(json.dumps(metadata,indent=2),flush=True)


if __name__=="__main__": main()
