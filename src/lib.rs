//! A bounded-work, deliberately approximate fractal renderer. No host imports.
//! Cubic orbit charts carry local structure across zooms. Tile polynomials skip
//! additional safe-ish prefixes; none of the visual error tests are certificates.
use std::ops::{Add, Mul, Sub};

const PIXEL_STEPS: usize = 101;
const MAX_PIXEL_STEPS: usize = 201;
const TILE_STEPS: usize = 24;
const CHART_STEPS: usize = 8;
const COLS: usize = 16;
const ROWS: usize = 12;
const MAX_WIDTH: usize = 960;
const MAX_HEIGHT: usize = 720;
const LUT_SIZE: usize = 2048;

#[derive(Clone, Copy, Default, Debug)]
struct C { x: f64, y: f64 }
impl C {
    const fn new(x: f64, y: f64) -> Self { Self { x, y } }
    fn norm(self) -> f64 { self.x*self.x+self.y*self.y }
    fn abs(self) -> f64 { self.norm().sqrt() }
    fn finite(self) -> bool { self.x.is_finite() && self.y.is_finite() }
}
impl Add for C { type Output=Self; fn add(self,b:Self)->Self { Self::new(self.x+b.x,self.y+b.y) } }
impl Sub for C { type Output=Self; fn sub(self,b:Self)->Self { Self::new(self.x-b.x,self.y-b.y) } }
impl Mul for C { type Output=Self; fn mul(self,b:Self)->Self { Self::new(self.x*b.x-self.y*b.y,self.x*b.y+self.y*b.x) } }
impl Mul<f64> for C { type Output=Self; fn mul(self,b:f64)->Self { Self::new(self.x*b,self.y*b) } }

#[derive(Clone, Copy, Default, Debug)]
struct Jet { q: [C;4] }
impl Jet {
    fn at(self,u:C)->C { ((self.q[3]*u+self.q[2])*u+self.q[1])*u+self.q[0] }
    /// Q(s + scale*u), exactly for the stored cubic.
    fn translated(self,s:C,scale:f64)->Self {
        let [a,b,c,d]=self.q;
        Self { q:[((d*s+c)*s+b)*s+a,
            (b+c*s*2.0+d*s*s*3.0)*scale,
            (c+d*s*3.0)*(scale*scale),d*(scale*scale*scale)] }
    }
    fn next(self,c:C,dc:C)->Self {
        let [a,b,d,e]=self.q;
        Self { q:[a*a+c,a*b*2.0+dc,a*d*2.0+b*b,a*e*2.0+b*d*2.0] }
    }
    fn variation(self,r:f64)->f64 { self.q[1].abs()*r+self.q[2].abs()*r*r+self.q[3].abs()*r*r*r }
    fn tail(self,r:f64)->f64 {
        let a=self.q[1].abs()*r;
        let b=self.q[2].abs()*r*r;
        let c=self.q[3].abs()*r*r*r;
        2.0*a*c+b*b+2.0*b*c+c*c
    }
    fn finite(self)->bool { self.q.iter().all(|z|z.finite()) }
}

#[derive(Clone, Copy)]
struct Chart { c:C, dc:C, jet:Jet, skipped:u32, age:f64, initial_scale:f64 }
impl Chart {
    fn new(c:C,scale:f64)->Self { Self { c,dc:C::new(scale,0.0),jet:Jet::default(),skipped:0,age:0.0,initial_scale:scale } }
    fn initial()->Self { Self::new(C::new(-0.5,0.0),1.32) }
    fn zoom(&mut self,pointer:C,factor:f64) {
        let shift=pointer*(1.0-factor);
        self.c=self.c+self.dc*shift;
        self.dc=self.dc*factor;
        self.jet=self.jet.translated(shift,factor);
        self.age-=factor.log10();
        if factor>1.0 && self.dc.norm()==0.0 && self.age<300.0 {
            self.dc=C::new(self.initial_scale*10.0_f64.powf(-self.age),0.0);
        }
    }
    fn pan(&mut self,shift:C) {
        self.c=self.c+self.dc*shift;
        self.jet=self.jet.translated(shift,1.0);
    }
    fn iterations(self)->usize {
        let levels=(self.age.max(0.0)/0.47712125471966244+1e-10).floor() as usize;
        PIXEL_STEPS+levels.min((MAX_PIXEL_STEPS-PIXEL_STEPS)/5)*5
    }
    fn advance(&mut self,extent:f64) {
        for _ in 0..CHART_STEPS {
            let next=self.jet.next(self.c,self.dc);
            let spread=next.variation(extent);
            // Local approximation policy: small new truncation and bounded orbit.
            // Inherited common-mode drift is intentionally retained.
            if !next.finite() || next.q[0].abs()+spread>1.85 || spread>0.12
                || self.jet.tail(extent)>1e-8 { break; }
            self.jet=next;
            self.skipped=self.skipped.saturating_add(1);
        }
    }
    fn tile(self,offset:C,radius:f64)->Tile {
        let mut jet=self.jet.translated(offset,radius);
        let c=self.c+self.dc*offset;
        let dc=self.dc*radius;
        let mut error=0.0;
        let mut skipped=0;
        for _ in 0..TILE_STEPS {
            let next=jet.next(c,dc);
            let next_error=2.0*(jet.q[0].abs()+jet.variation(1.0))*error+error*error+jet.tail(1.0);
            if !next.finite() || next.q[0].abs()+next.variation(1.0)+next_error>1.95
                || next_error>1e-7 { break; }
            jet=next; error=next_error; skipped+=1;
        }
        Tile { jet,c,dc,skipped:self.skipped+skipped,extra:skipped }
    }
}

#[derive(Clone, Copy)]
struct Tile { jet:Jet,c:C,dc:C,skipped:u32,extra:u32 }

fn in_main_bulbs(c:C)->bool {
    let x=c.x-0.25;
    let q=x*x+c.y*c.y;
    q*(q+x)<0.25*c.y*c.y || (c.x+1.0)*(c.x+1.0)+c.y*c.y<0.0625
}

// Positive normal inputs only. The atanh series has < 1.7e-6 absolute
// log2 error here, below a visible palette step, without a libm log call.
fn color_log2(value:f64)->f64 {
    let bits=value.to_bits();
    let exponent=((bits>>52)&0x7ff) as i32-1023;
    let mantissa=f64::from_bits((bits&0x000f_ffff_ffff_ffff)|(1023_u64<<52));
    let y=(mantissa-1.0)/(mantissa+1.0);
    let y2=y*y;
    exponent as f64+2.8853900817779268*y*(1.0+y2*(1.0/3.0+y2*(1.0/5.0+y2*(1.0/7.0+y2/9.0))))
}

fn escape_orbit(z:C,c:C,skipped:u32,limit:usize)->f64 {
    if in_main_bulbs(c) {return -1.0;}
    if !z.finite() || !c.finite() {return 0.0;}
    let mut x=z.x;let mut y=z.y;
    let mut checkpoint=z;
    for n in 0..limit {
        let xx=x*x;let yy=y*y;
        let mag=xx+yy;
        if mag>256.0 {
            return (skipped as f64+n as f64+1.0-color_log2(0.5*color_log2(mag))).max(0.0);
        }
        // A tiny-tolerance periodicity shortcut, intentionally approximate.
        // Comparing every 16 steps avoids per-iteration checkpoint traffic.
        if n>0 && n&15==0 {
            let dx=x-checkpoint.x;let dy=y-checkpoint.y;
            if dx*dx+dy*dy<1e-28 {return -1.0;}
            checkpoint=C::new(x,y);
        }
        y=(x+x)*y+c.y;
        x=xx-yy+c.x;
    }
    -1.0
}

fn escape(tile:Tile,u:C)->f64 {
    escape_orbit(tile.jet.at(u),tile.c+tile.dc*u,tile.skipped,PIXEL_STEPS)
}

#[cfg(all(target_arch="wasm32",feature="simd"))]
#[target_feature(enable="simd128")]
unsafe fn escape_pair_simd(z:[C;2],c:[C;2],skipped:u32,limit:usize)->[f64;2] {
    use core::arch::wasm32::*;
    let mut values=[-1.0;2];
    let mut active=0_u8;
    for lane in 0..2 {
        if !z[lane].finite() || !c[lane].finite() {values[lane]=0.0;}
        else if !in_main_bulbs(c[lane]) {active|=1<<lane;}
    }
    if active==0 {return values;}
    let mut x=f64x2(z[0].x,z[1].x);let mut y=f64x2(z[0].y,z[1].y);
    let cx=f64x2(c[0].x,c[1].x);let cy=f64x2(c[0].y,c[1].y);
    let mut px=x;let mut py=y;
    let bailout=f64x2_splat(256.0);let tolerance=f64x2_splat(1e-28);
    for n in 0..limit {
        let xx=f64x2_mul(x,x);let yy=f64x2_mul(y,y);
        let mag=f64x2_add(xx,yy);
        let escaped=i64x2_bitmask(f64x2_gt(mag,bailout))&active;
        if escaped!=0 {
            let magnitudes=[f64x2_extract_lane::<0>(mag),f64x2_extract_lane::<1>(mag)];
            for lane in 0..2 {
                if escaped&(1<<lane)!=0 {
                    values[lane]=(skipped as f64+n as f64+1.0-color_log2(0.5*color_log2(magnitudes[lane]))).max(0.0);
                }
            }
            active&=!escaped;
            if active==0 {break;}
        }
        if n>0 && n&15==0 {
            let dx=f64x2_sub(x,px);let dy=f64x2_sub(y,py);
            let distance=f64x2_add(f64x2_mul(dx,dx),f64x2_mul(dy,dy));
            active&=!i64x2_bitmask(f64x2_lt(distance,tolerance));
            if active==0 {break;}
            px=x;py=y;
        }
        y=f64x2_add(f64x2_mul(f64x2_add(x,x),y),cy);
        x=f64x2_add(f64x2_sub(xx,yy),cx);
    }
    values
}

fn escape_pair(z:[C;2],c:[C;2],skipped:u32,limit:usize)->[f64;2] {
    #[cfg(all(target_arch="wasm32",feature="simd"))]
    {unsafe {escape_pair_simd(z,c,skipped,limit)}}
    #[cfg(not(all(target_arch="wasm32",feature="simd")))]
    {[escape_orbit(z[0],c[0],skipped,limit),escape_orbit(z[1],c[1],skipped,limit)]}
}

// Values of a cubic on a scanline advance with three complex additions.
// Analytic differences avoid subtracting nearly equal orbit values.
fn scanline(jet:Jet,u:C,h:f64)->[C;4] {
    let [_,b,c,d]=jet.q;
    [jet.at(u),
     (b+c*(u*2.0+C::new(h,0.0))+d*(u*u*3.0+u*(3.0*h)+C::new(h*h,0.0)))*h,
     (c*2.0+d*(u+C::new(h,0.0))*6.0)*(h*h),
     d*(6.0*h*h*h)]
}

const ATLAS: [(f64,f64,f64);10]=[
    (-0.7435,0.1314,0.0035),(-0.74543,0.11301,0.004),
    (-0.1011,0.9563,0.012),(-1.7685,0.0008,0.012),
    (-0.7463,0.1102,0.01),(0.275,0.008,0.015),
    (-1.25066,0.02012,0.007),(-0.1607,1.03756,0.007),
    (-0.75,0.1,0.013),(-0.76157,0.08476,0.006),
];

// A periodic detail field with two overlapping spatial scales. At a scale
// boundary the old fine layer is exactly the new coarse layer. Coordinates stay
// bounded; discarded phase bits may change the route when zooming far back out.
#[derive(Clone, Copy)]
struct Detail { phase:C, radius:f64 }
impl Detail {
    fn new()->Self {Self{phase:C::new(-0.7,0.3),radius:4.0}}
    fn pan(&mut self,shift:C) {
        self.phase=self.phase+shift*self.radius;
        self.wrap();
    }
    fn wrap(&mut self) {
        self.phase.x=self.phase.x.rem_euclid(std::f64::consts::TAU);
        self.phase.y=self.phase.y.rem_euclid(std::f64::consts::TAU);
    }
    fn zoom(&mut self,pointer:C,factor:f64) {
        self.phase=self.phase+pointer*(self.radius*(1.0-factor));
        self.radius*=factor;
        while self.radius<2.0 {self.radius*=2.0;self.phase=self.phase*2.0;}
        while self.radius>4.0 {self.radius*=0.5;self.phase=self.phase*0.5;}
        self.wrap();
    }
    fn weight(self)->f64 {smooth((4.0/self.radius).log2())}
    fn color(self,u:C,palette:&[[u8;3];LUT_SIZE])->[f64;3] {
        let p=self.phase+u*self.radius;
        let c=[C::new(-0.5+1.4*p.x.sin(),1.1*p.y.sin()),
            C::new(-0.5+1.4*(p.x*2.0).sin(),1.1*(p.y*2.0).sin())];
        let values=escape_pair([C::default();2],c,0,MAX_PIXEL_STEPS);
        let a=rgb(values[0],palette);let b=rgb(values[1],palette);
        let w=self.weight();
        std::array::from_fn(|k|a[k] as f64*(1.0-w)+b[k] as f64*w)
    }
}
fn smooth(t:f64)->f64 {let t=t.clamp(0.0,1.0);t*t*(3.0-2.0*t)}
fn rgb(mu:f64,palette:&[[u8;3];LUT_SIZE])->[u8;3] {
    if mu<0.0 {[5,12,18]}else{palette[((mu*0.024+0.12).fract()*LUT_SIZE as f64) as usize%LUT_SIZE]}
}

pub struct Engine {
    width:usize,height:usize,pixels:Vec<u8>,scratch:Vec<u8>,
    palette:[[u8;3];LUT_SIZE],chart:Chart,incoming:Option<Chart>,
    transition:f64,quiet:f64,elapsed:f64,depth:f64,refreshes:u32,seed:u32,
    mean:f64,variance:f64,escaped_fraction:f64,mean_skip:f64,
    palette_id:u32,
    pristine:bool,go_remaining:C,go_time:f64,detail:Detail,
}
impl Engine {
    fn new(width:usize,height:usize)->Self {
        let mut s=Self { width:0,height:0,pixels:vec![],scratch:vec![],
            palette:[[0;3];LUT_SIZE],chart:Chart::initial(),incoming:None,
            transition:0.0,quiet:0.0,elapsed:0.0,depth:0.0,refreshes:0,seed:0x5f3759df,
            mean:0.0,variance:0.0,escaped_fraction:0.0,mean_skip:0.0,palette_id:0,
            pristine:true,go_remaining:C::default(),go_time:0.0,detail:Detail::new() };
        s.resize(width,height); s.set_palette(0); s
    }
    fn resize(&mut self,width:usize,height:usize) {
        self.width=width.clamp(32,MAX_WIDTH);self.height=height.clamp(24,MAX_HEIGHT);
        self.pixels.resize(self.width*self.height*4,255);
        self.scratch.resize(self.width*self.height*4,255);
        if self.pristine {self.chart=self.fitted_initial();}
    }
    fn fitted_initial(&self)->Chart {
        Chart::new(C::new(-0.5,0.0),1.32/(self.width as f64/self.height as f64).min(1.0))
    }
    fn reset(&mut self) {
        self.chart=self.fitted_initial();self.incoming=None;self.transition=0.0;
        self.quiet=0.0;self.elapsed=0.0;self.depth=0.0;self.refreshes=0;self.seed=0x5f3759df;
        self.pristine=true;self.go_remaining=C::default();self.go_time=0.0;self.detail=Detail::new();
    }
    fn pan(&mut self,dx:f64,dy:f64) {
        if !dx.is_finite() || !dy.is_finite() {return;}
        let shift=C::new(-2.0*dx*self.width as f64/self.height as f64,2.0*dy);
        self.shift(shift);
        self.go_remaining=C::default();self.go_time=0.0;
    }
    fn shift(&mut self,shift:C) {
        if shift.norm()==0.0 {return;}
        self.pristine=false;
        self.chart.pan(shift);
        self.detail.pan(shift);
        if let Some(ref mut chart)=self.incoming {chart.pan(shift);}
        self.quiet=0.0;
    }
    fn go_to(&mut self,mx:f64,my:f64) {
        if !mx.is_finite() || !my.is_finite() {return;}
        self.go_remaining=C::new((mx.clamp(0.0,1.0)*2.0-1.0)*self.width as f64/self.height as f64,
            1.0-my.clamp(0.0,1.0)*2.0);
        self.go_time=0.0;
        if self.go_remaining.norm()>1e-18 {self.pristine=false;}
    }
    fn random(&mut self)->u32 {
        self.seed^=self.seed<<13;self.seed^=self.seed>>17;self.seed^=self.seed<<5;self.seed
    }
    fn renew(&mut self) {
        if self.incoming.is_some() { return; }
        self.pristine=false;
        // Fixed search budget, preferring a patch with both interior and detail.
        let start=self.random() as usize%ATLAS.len();
        let mut best=Chart::new(C::new(ATLAS[start].0,ATLAS[start].1),ATLAS[start].2);
        let mut best_score=-1.0;
        for k in 0..4 {
            let (x,y,r)=ATLAS[(start+k)%ATLAS.len()];
            let candidate=Chart::new(C::new(x,y),r);
            let tile=candidate.tile(C::default(),1.0);
            let mut escaped:f64=0.0;let mut sum=0.0;let mut sq=0.0;
            for j in 0..25 {
                let u=C::new((j%5) as f64/2.0-1.0,(j/5) as f64/2.0-1.0);
                let value=escape(tile,u);
                if value>=0.0 { escaped+=1.0;sum+=value;sq+=value*value; }
            }
            let variance=(sq/25.0-(sum/25.0).powi(2)).max(0.0);
            let score=variance.sqrt()+escaped.min(25.0-escaped)*3.0;
            if score>best_score {best_score=score;best=candidate;}
        }
        self.incoming=Some(best);self.transition=0.0;self.quiet=0.0;
        self.refreshes=self.refreshes.wrapping_add(1);
    }
    fn set_palette(&mut self,id:u32) {
        self.palette_id=id%3;
        let stops=match self.palette_id {
            1=>[[8,9,22],[42,29,64],[162,71,71],[255,173,105],[255,238,195],[43,77,96],[8,9,22]],
            2=>[[4,12,19],[12,54,71],[31,140,153],[175,230,206],[247,250,221],[37,81,101],[4,12,19]],
            _=>[[6,16,24],[10,54,67],[37,133,141],[219,206,143],[249,236,192],[126,78,37],[6,16,24]],
        };
        for (i,p) in self.palette.iter_mut().enumerate() {
            let t=i as f64/(LUT_SIZE-1) as f64*6.0;
            let j=(t as usize).min(5);let f=t-j as f64;let f=f*f*(3.0-2.0*f);
            for k in 0..3 {p[k]=(stops[j][k] as f64*(1.0-f)+stops[j+1][k] as f64*f) as u8;}
        }
    }
    fn render_chart(chart:Chart,width:usize,height:usize,palette:&[[u8;3];LUT_SIZE],output:&mut[u8])->(f64,f64,f64,f64) {
        let aspect=width as f64/height as f64;
        let limit=chart.iterations();
        let mut sum=0.0;let mut sumsq=0.0;let mut count=0;let mut skipped=0.0;
        for ty in 0..ROWS {
            let y0=ty*height/ROWS;let y1=(ty+1)*height/ROWS;
            for tx in 0..COLS {
                let x0=tx*width/COLS;let x1=(tx+1)*width/COLS;
                let center=C::new((x0+x1) as f64/height as f64-aspect,1.0-(y0+y1) as f64/height as f64);
                let radius=(((x1-x0).pow(2)+(y1-y0).pow(2)) as f64).sqrt()/height as f64;
                let tile=chart.tile(center,radius);
                skipped+=tile.extra as f64;
                let h=2.0/(height as f64*radius);
                let ux0=(x0 as f64+0.5-(x0+x1) as f64*0.5)*h;
                let c_step=tile.dc*h;
                for y in y0..y1 {
                    let uy=(1.0-(2*y+1) as f64/height as f64-center.y)/radius;
                    let u=C::new(ux0,uy);
                    let [mut z,mut dz,mut ddz,dddz]=scanline(tile.jet,u,h);
                    let mut c=tile.c+tile.dc*u;
                    for x in (x0..x1).step_by(2) {
                        let z0=z;let c0=c;
                        z=z+dz;dz=dz+ddz;ddz=ddz+dddz;c=c+c_step;
                        let lanes=(x1-x).min(2);
                        let values=if lanes==2 {escape_pair([z0,z],[c0,c],tile.skipped,limit)}
                            else {[escape_orbit(z0,c0,tile.skipped,limit),-1.0]};
                        z=z+dz;dz=dz+ddz;ddz=ddz+dddz;c=c+c_step;
                        for lane in 0..lanes {
                            let mu=values[lane];
                            let rgb=if mu<0.0 {[5,12,18]} else {
                                sum+=mu; sumsq+=mu*mu;count+=1;
                                let t=(mu*0.024+0.12).fract();
                                palette[(t*LUT_SIZE as f64) as usize%LUT_SIZE]
                            };
                            let i=(y*width+x+lane)*4;
                            output[i..i+3].copy_from_slice(&rgb);output[i+3]=255;
                        }
                    }
                }
            }
        }
        let n=(width*height) as f64;
        let mean=sum/n;
        (mean,(sumsq/n-mean*mean).max(0.0),count as f64/n,skipped/(COLS*ROWS) as f64)
    }
    fn step(&mut self,dt:f64,mx:f64,my:f64,speed:f64,running:bool) {
        let dt=if dt.is_finite(){dt.clamp(0.0,0.1)}else{0.0};
        let aspect=self.width as f64/self.height as f64;
        let mut pointer=C::new((mx.clamp(0.0,1.0)*2.0-1.0)*aspect,1.0-my.clamp(0.0,1.0)*2.0);
        if self.go_remaining.norm()>1e-18 {
            self.go_time+=dt;
            let fraction=if self.go_time>=0.6 {1.0}else{1.0-(-10.0*dt).exp()};
            let shift=self.go_remaining*fraction;
            self.shift(shift);
            self.go_remaining=self.go_remaining-shift;
            pointer=C::default();
        }
        if running {
            // Keep an arriving patch legible even at maximum travel speed.
            let dz=(dt*speed.clamp(-2.5,2.5)*if self.incoming.is_some(){0.12}else{1.0}).max(-self.depth);
            let factor=10.0_f64.powf(-dz);
            self.pristine=false;
            self.chart.zoom(pointer,factor);
            self.detail.zoom(pointer,factor);
            // Expanding the disk invalidates its truncated orbit prefix.
            if dz<0.0 {self.chart.jet=Jet::default();self.chart.skipped=0;}
            if let Some(ref mut chart)=self.incoming {chart.zoom(pointer,factor);}
            self.go_remaining=self.go_remaining*(1.0/factor);
            self.depth=(self.depth+dz).clamp(0.0,1e12);self.elapsed+=dt;
        }
        let extent=(aspect*aspect+1.0).sqrt();
        if self.chart.age<16.0 {self.chart.advance(extent);}
        if let Some(ref mut chart)=self.incoming {chart.advance(extent);}
        let stats=Self::render_chart(self.chart,self.width,self.height,&self.palette,&mut self.pixels);
        self.mean=stats.0;self.variance=stats.1;self.escaped_fraction=stats.2;self.mean_skip=stats.3;
        if let Some(incoming)=self.incoming {
            Self::render_chart(incoming,self.width,self.height,&self.palette,&mut self.scratch);
            self.transition=(self.transition+dt/0.9).min(1.0);
            let blend=self.transition*self.transition*(3.0-2.0*self.transition);
            for (a,b) in self.pixels.iter_mut().zip(&self.scratch) {*a=(*a as f64*(1.0-blend)+*b as f64*blend) as u8;}
            if self.transition>=1.0 {self.chart=incoming;self.depth=incoming.age;self.incoming=None;self.quiet=0.0;self.elapsed=0.0;}
        }
        // Fade over eight decades, never replace the chart automatically.
        // This is synthesized detail, not a claim of deeper exact coordinates.
        let weight=smooth((self.chart.age-8.0)/8.0)*if self.incoming.is_some(){1.0-smooth(self.transition)}else{1.0};
        if weight>0.0 {
            for y in 0..self.height {for x in 0..self.width {
                let u=C::new((2*x+1) as f64/self.height as f64-aspect,
                    1.0-(2*y+1) as f64/self.height as f64);
                let color=self.detail.color(u,&self.palette);
                let i=(y*self.width+x)*4;
                for k in 0..3 {self.pixels[i+k]=(self.pixels[i+k] as f64*(1.0-weight)+color[k]*weight).round() as u8;}
            }}
        }
    }
}

// Opaque engine pointers are owned by the worker. No Rust references are retained
// across calls, and JavaScript reacquires memory views after any allocating call.
#[no_mangle] pub extern "C" fn engine_create(w:u32,h:u32)->*mut Engine {Box::into_raw(Box::new(Engine::new(w as usize,h as usize)))}
#[no_mangle] pub unsafe extern "C" fn engine_free(e:*mut Engine) {if !e.is_null(){drop(Box::from_raw(e));}}
#[no_mangle] pub unsafe extern "C" fn engine_resize(e:*mut Engine,w:u32,h:u32) {if let Some(e)=e.as_mut(){e.resize(w as usize,h as usize);}}
#[no_mangle] pub unsafe extern "C" fn engine_reset(e:*mut Engine) {if let Some(e)=e.as_mut(){e.reset();}}
#[no_mangle] pub unsafe extern "C" fn engine_renew(e:*mut Engine) {if let Some(e)=e.as_mut(){e.renew();}}
#[no_mangle] pub unsafe extern "C" fn engine_palette(e:*mut Engine,id:u32) {if let Some(e)=e.as_mut(){e.set_palette(id);}}
#[no_mangle] pub unsafe extern "C" fn engine_pan(e:*mut Engine,dx:f64,dy:f64) {if let Some(e)=e.as_mut(){e.pan(dx,dy);}}
#[no_mangle] pub unsafe extern "C" fn engine_goto(e:*mut Engine,mx:f64,my:f64) {if let Some(e)=e.as_mut(){e.go_to(mx,my);}}
#[no_mangle] pub unsafe extern "C" fn engine_step(e:*mut Engine,dt:f64,mx:f64,my:f64,speed:f64,running:u32)->*const u8 {
    if let Some(e)=e.as_mut(){e.step(dt,mx,my,speed,running!=0);e.pixels.as_ptr()}else{std::ptr::null()}
}
#[no_mangle] pub unsafe extern "C" fn engine_stat(e:*const Engine,id:u32)->f64 {
    if let Some(e)=e.as_ref(){match id {0=>e.depth,1=>e.chart.skipped as f64,2=>e.refreshes as f64,
        3=>e.transition,4=>e.mean_skip,5=>e.escaped_fraction,6=>e.variance,
        7=>e.width as f64,8=>e.height as f64,9=>e.incoming.is_some() as u8 as f64,
        10=>e.chart.iterations() as f64,11=>(e.go_remaining.norm()>1e-18) as u8 as f64,
        12=>e.chart.c.x,13=>e.chart.c.y,14=>e.chart.dc.abs(),15=>smooth((e.chart.age-8.0)/8.0),_=>0.0}}else{0.0}
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn scanline_matches_cubic_at_every_pixel() {
        let jet=Jet{q:[C::new(-0.3,0.2),C::new(0.12,-0.04),C::new(0.02,0.007),C::new(-0.003,0.001)]};
        let start=C::new(-0.9,0.2);let h=0.03;
        let [mut z,mut dz,mut ddz,dddz]=scanline(jet,start,h);
        for i in 0..60 {
            assert!((z-jet.at(start+C::new(i as f64*h,0.0))).abs()<1e-12);
            z=z+dz;dz=dz+ddz;ddz=ddz+dddz;
        }
    }
    #[test] fn fast_color_log_is_below_palette_resolution() {
        for i in 0..10000 {
            let v=2.0_f64.powf(i as f64*0.0016);
            assert!((color_log2(v)-v.log2()).abs()<1.7e-6);
        }
    }
    #[test] fn iterations_increase_five_per_threefold_zoom_then_cap() {
        let mut c=Chart::initial();
        assert_eq!(c.iterations(),101);
        for level in 1..=100 {
            c.zoom(C::default(),1.0/3.0);
            assert_eq!(c.iterations(),(101+level*5).min(201));
        }
    }
    #[test] fn pan_preserves_scale_and_survives_resize_before_zooming() {
        let mut e=Engine::new(480,320);
        let before=e.chart.c;let scale=e.chart.dc;
        e.pan(0.1,-0.05);
        assert!((e.chart.c-(before+scale*C::new(-0.3,-0.1))).abs()<1e-14);
        assert_eq!(e.chart.dc.norm(),scale.norm());assert_eq!(e.depth,0.0);
        let moved=e.chart.c;
        e.resize(600,400);
        assert!((e.chart.c-moved).abs()<1e-14);
    }
    #[test] fn goto_centers_the_selected_point_while_zooming() {
        let mut e=Engine::new(48,32);
        let target=e.chart.c+e.chart.dc*C::new(0.6,0.4);
        e.go_to(0.7,0.3);
        for _ in 0..65 {e.step(0.01,0.5,0.5,0.2,true);}
        assert!(e.go_remaining.norm()<1e-18);
        assert!((e.chart.c-target).abs()<1e-12);
        assert!(e.depth>0.1);
        assert_eq!(e.refreshes,0);
    }
    #[test] fn translation_preserves_cubic_and_mouse_anchor() {
        let jet=Jet {q:[C::new(-0.4,0.2),C::new(0.1,0.05),C::new(0.03,-0.01),C::new(0.002,0.003)]};
        let s=C::new(0.12,-0.08);let u=C::new(-0.3,0.7);
        assert!((jet.at(s+u*(1.0/3.0))-jet.translated(s,1.0/3.0).at(u)).abs()<1e-14);
        let mut chart=Chart::initial();chart.jet=jet;
        let before=chart.c+chart.dc*u;chart.zoom(u,0.33);
        assert!((before-(chart.c+chart.dc*u)).abs()<1e-14);
    }
    #[test] fn bounded_tile_jump_agrees_with_direct_escape() {
        let chart=Chart::new(C::new(-0.75,0.1),0.0001);
        let tile=chart.tile(C::default(),1.0);
        assert!(tile.extra>8);
        for i in 0..100 {
            let u=C::new((i%10) as f64/5.0-0.9,(i/10) as f64/5.0-0.9);
            let direct=Tile{jet:Jet::default(),c:chart.c,dc:chart.dc,skipped:0,extra:0};
            assert!((escape(tile,u)-escape(direct,u)).abs()<1e-4);
        }
    }
    #[test] fn deep_zoom_stays_bounded_without_changing_regions() {
        let mut e=Engine::new(48,32);let capacity=e.pixels.capacity();
        for _ in 0..4000 {
            e.step(0.1,0.54,0.47,2.5,true);
            assert!(e.chart.jet.finite());assert_eq!(e.pixels.capacity(),capacity);
            assert!(e.detail.radius>=2.0 && e.detail.radius<=4.0);
            assert!(e.detail.phase.abs()<9.0);
            assert_eq!(e.refreshes,0);assert!(e.incoming.is_none());
        }
        assert_eq!(e.depth,1000.0);
    }
    #[test] fn detail_is_continuous_at_scale_boundaries_in_both_directions() {
        let e=Engine::new(48,32);
        for direction in [-1.0,1.0] {
            let mut d=Detail{phase:C::new(1.3,2.1),radius:if direction>0.0 {2.0}else{4.0}};
            let before=d;
            d.zoom(C::new(0.2,-0.1),1.0-direction*1e-12);
            for i in 0..100 {
                let u=C::new(i as f64*0.023-1.0,0.37);
                let a=before.color(u,&e.palette);let b=d.color(u,&e.palette);
                for k in 0..3 {assert!((a[k]-b[k]).abs()<1e-6,"scale seam");}
            }
        }
    }
    #[test] fn zoom_out_is_anchored_and_stops_at_overview() {
        let mut e=Engine::new(48,32);
        for _ in 0..20 {e.step(0.1,0.6,0.4,1.0,true);}
        let target=e.chart.c+e.chart.dc*C::new(0.3,0.2);
        for _ in 0..40 {e.step(0.1,0.6,0.4,-1.0,true);}
        assert_eq!(e.depth,0.0);
        assert!((e.chart.c+e.chart.dc*C::new(0.3,0.2)-target).abs()<1e-12);
        assert_eq!(e.refreshes,0);
    }
    #[test] fn dimensions_and_invalid_time_are_bounded() {
        let mut e=Engine::new(100_000,100_000);
        assert_eq!(e.width,MAX_WIDTH);assert_eq!(e.height,MAX_HEIGHT);
        e.resize(0,0);e.step(f64::NAN,0.5,0.5,0.5,true);
        assert_eq!(e.depth,0.0);assert_eq!(e.pixels.len(),32*24*4);
    }
}
