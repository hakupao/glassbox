/* glassbox background art: a library of 19 dot-matrix pieces drawn from today's usage, one per day (rotated by date).
   Used by web/app.js (G.boot -> art()). No text here: names and captions are i18n keys in web/i18n.js.

   THIRD-PARTY: templates 10-20 are adapted from pieces of ascii.rest (github.com/bas3line/ascii):
   jellyfish, aquarium, whale, starlings, fireflies, snowfall, sea-swell, pond-ripples, black-hole, moon-phases, lantern-lake.
   Each adapted template names its source piece in its header comment. See also THIRD_PARTY_NOTICES.md.
   ascii.rest is used under the MIT License, reproduced in full:

MIT License

Copyright (c) 2026 bas3line

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
(function(){
'use strict';

/* ================= shared kit ================= */
const BLUE = [108, 151, 214], OR = [219, 168, 67], LV = 9, P = 5, TAU = Math.PI * 2;
function mulberry(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; }; }
/* integer avalanche mix (lowbias32): consecutive days land far apart */
function mix(x){ x |= 0; x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16; return x >>> 0; }
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
const sstep = (a, b, x) => smooth((x - a) / (b - a));

/* ---------- data inputs (set by mount; identical for every template) ----------
   Module state: single instance. Only one piece is mounted per page (create() is called once, by app.js); D, nT and perm belong to it. */
let D = null, nT = 2;
const curveAt = s => { const f = clamp01(s) * (nT - 1), i = Math.min(nT - 2, Math.floor(f)), u = f - i, k = (1 - Math.cos(u * Math.PI)) / 2; return D.curve[i] + (D.curve[i + 1] - D.curve[i]) * k; };

/* ---------- date-seeded noise (rebuilt when the date changes) ---------- */
const perm = new Float32Array(65536);
function seedNoise(ymd){ const r = mulberry(ymd ^ 0x9e3779b9); for(let i = 0; i < perm.length; i++) perm[i] = r(); }
function noise(x, y){ const s_ = v => v * v * (3 - 2 * v);
  const xi = Math.floor(x), yi = Math.floor(y), xf = s_(x - xi), yf = s_(y - yi), x0 = xi & 255, x1 = (xi + 1) & 255, y0 = (yi & 255) << 8, y1 = ((yi + 1) & 255) << 8;
  const a = perm[y0 | x0], b = perm[y0 | x1], c = perm[y1 | x0], d = perm[y1 | x1]; return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf; }

/* ---------- one renderer: 5px cells, 9 levels, two colours, four cell styles ----------
   sq = square bricks (size by level), dot = round halftone dots, br = braille-like 2x4 micro dots (count by level),
   sh = shade steps, 2x2 sub-squares (count by level). Draw batches one path per (colour, level). */
const BR = [[0, 1], [1, 2], [0, 3], [1, 0], [0, 2], [1, 3], [0, 0], [1, 1]], SH = [[0, 0], [1, 1], [1, 0], [0, 1]];
class Layer{
  constructor(cols, rows){ this.cols = cols; this.rows = rows; const n = cols * rows; this.gb = new Float32Array(n); this.gc = new Uint8Array(n);
    this.bk = Array.from({length: 2 * LV}, () => new Int32Array(n)); this.bc = new Int32Array(2 * LV); }
  clear(){ this.gb.fill(0); }
  put(x, y, b, c){ x = Math.round(x); y = Math.round(y); if(x < 0 || y < 0 || x >= this.cols || y >= this.rows) return; const k = x * this.rows + y; if(b > this.gb[k]){ this.gb[k] = Math.min(1, b); this.gc[k] = c; } }
  draw(ax, gain, halo, style){
    const {gb, gc, bk, bc, rows} = this; bc.fill(0);
    for(let k = 0; k < gb.length; k++){ const a = gb[k]; if(a < .05) continue; const key = gc[k] * LV + Math.min(LV, Math.ceil(a * LV)) - 1; bk[key][bc[key]++] = k; }
    for(let key = 0; key < 2 * LV; key++){
      const n = bc[key]; if(!n) continue;
      const col = key >= LV ? OR : BLUE, f = (key % LV + 1) / LV, a = bk[key], rgb = `${col[0]},${col[1]},${col[2]}`;
      if(halo && f > .85){   /* soft halo: one larger faint square per bright cell, no shadowBlur */
        const hs = P * 2.2, ho = (P - hs) / 2; ax.fillStyle = `rgba(${rgb},${(.1 * gain).toFixed(3)})`; ax.beginPath();
        if(style === 'dot') for(let i = 0; i < n; i++){ const k = a[i], x = ((k / rows) | 0) * P + P / 2, y = (k % rows) * P + P / 2; ax.moveTo(x + hs / 2, y); ax.arc(x, y, hs / 2, 0, TAU); }
        else for(let i = 0; i < n; i++){ const k = a[i]; ax.rect(((k / rows) | 0) * P + ho, (k % rows) * P + ho, hs, hs); }
        ax.fill(); }
      ax.beginPath();
      if(style === 'dot'){
        const r = P * (.17 + .33 * f); ax.fillStyle = `rgba(${rgb},${((.2 + .66 * f) * gain).toFixed(3)})`;
        if(r < 1.45) for(let i = 0; i < n; i++){ const k = a[i]; ax.rect(((k / rows) | 0) * P + P / 2 - r, (k % rows) * P + P / 2 - r, 2 * r, 2 * r); }   /* tiny dots: a square reads the same and is far cheaper */
        else for(let i = 0; i < n; i++){ const k = a[i], x = ((k / rows) | 0) * P + P / 2, y = (k % rows) * P + P / 2; ax.moveTo(x + r, y); ax.arc(x, y, r, 0, TAU); }
      } else if(style === 'br'){
        const m = Math.max(1, Math.round(f * 8)); ax.fillStyle = `rgba(${rgb},${((.34 + .6 * f) * gain).toFixed(3)})`;
        for(let i = 0; i < n; i++){ const k = a[i], x = ((k / rows) | 0) * P + .8, y = (k % rows) * P + .35;
          for(let j = 0; j < m; j++) ax.rect(x + BR[j][0] * 2.3, y + BR[j][1] * 1.2, 1.05, 1.05); }
      } else if(style === 'sh'){
        const m = Math.max(1, Math.ceil(f * 4)); ax.fillStyle = `rgba(${rgb},${((.22 + .6 * f) * gain).toFixed(3)})`;
        for(let i = 0; i < n; i++){ const k = a[i], x = ((k / rows) | 0) * P + .35, y = (k % rows) * P + .35;
          for(let j = 0; j < m; j++) ax.rect(x + SH[j][0] * 2.2, y + SH[j][1] * 2.2, 1.95, 1.95); }
      } else {
        const s = P * (.3 + .6 * f), off = (P - s) / 2; ax.fillStyle = `rgba(${rgb},${((.14 + .66 * f) * gain).toFixed(3)})`;
        for(let i = 0; i < n; i++){ const k = a[i]; ax.rect(((k / rows) | 0) * P + off, (k % rows) * P + off, s, s); }
      }
      ax.fill();
    }
  }
}
/* static layers are re-rasterised into an offscreen canvas at a slow tick and blitted every frame */
function offscreen(env){ const c = document.createElement('canvas'); c.width = Math.round(env.W * env.dpr); c.height = Math.round(env.H * env.dpr); const x = c.getContext('2d');
  return {c, begin(){ x.setTransform(env.dpr, 0, 0, env.dpr, 0, 0); x.clearRect(0, 0, env.W, env.H); return x; }, blit(){ env.ax.drawImage(c, 0, 0, env.W, env.H); }}; }
function ticker(dt, fn){ let ts = -1e9; return tm => { if(tm - ts > dt || tm < ts){ fn(tm); ts = tm; } }; }
/* trace K polylines of ST points through a direction field; particles later ride them as a pure function of time */
function tracePaths(out, K, ST, seeds, dir, step){ const v = [0, 0];
  for(let k = 0; k < K; k++){ let x = seeds[k * 2], y = seeds[k * 2 + 1];
    for(let i = 0; i < ST; i++){ const o = (k * ST + i) * 2; out[o] = x; out[o + 1] = y; dir(x, y, v); x += v[0] * step; y += v[1] * step; } } }
function ridePath(L, paths, ST, k, s, b, c, tail){
  const fade = Math.sin(Math.PI * s / (ST - 1)); if(fade <= 0) return;
  for(let j = 0; j <= tail; j++){ const q = s - j * .9; if(q < 0) break; const i = Math.min(ST - 2, q | 0), u = q - i, o = (k * ST + i) * 2;
    L.put(paths[o] + (paths[o + 2] - paths[o]) * u, paths[o + 1] + (paths[o + 3] - paths[o + 1]) * u, b * fade * (j ? .62 * (1 - j / (tail + 1)) : 1), c); } }

/* ================= templates =================
   Each: make(env, X) -> draw(tm). env = canvas geometry; X = {D (data), p (date-seeded params), rnd (particle stream)}.
   draw(tm) is a pure function of tm, so a single static frame (?t=, reduced motion) is a real frame. */

/* 01 terrain: s17-bg-a as is (ridge = smoothed 30-day cost, particles = tokens) */
function tTerrain(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, sp = X.p.speed, TL = new Layer(cols, rows), PL = new Layer(cols, rows), off = offscreen(env);
  const ymin = new Float32Array(cols), hy = rows * (phone ? .30 : .36), focal = rows * (phone ? .78 : .9), kx = .62 * cols / rows;
  const NZ = 84, zs = Array.from({length: NZ}, (_, i) => 1.1 * Math.pow(15 / 1.1, i / (NZ - 1)));
  const parts = Array.from({length: D.nPart}, () => ({bx: X.rnd() * 2 - 1, by: X.rnd(), bz: X.rnd(), ph: X.rnd() * TAU, cx: X.rnd() > D.share}));
  const PN = phone ? Math.round(parts.length * .5) : parts.length, ridge = xn => curveAt(xn * .5 + .5);
  const tick = ticker(.11, tm => {
    TL.clear(); ymin.fill(rows);
    const A = 2.1 + .3 * Math.sin(tm * .33), camH = 2.0 + .06 * Math.sin(tm * .21), trav = tm * .16 * sp;
    for(let c = 0; c < cols; c++){
      const xn = (c + .5) / cols * 2 - 1, rg = ridge(xn) - D.curveMean;
      for(let i = 0; i < NZ; i++){
        const z = zs[i], wx = xn * z * kx, zz = z + trav, far = sstep(5, 13, z), amp = A * (.3 + .7 * sstep(2, 8, z));
        const Hf = (x, q) => (noise(x * .42 + 7, q * .42) - .5) * amp + (noise(x * 1.15 + 31, q * 1.15 + 5) - .5) * D.jitter * .35;
        const hc = Hf(wx, zz), ys = hy + (camH - (hc + rg * far * 3.2 + .3)) / z * focal;
        if(ys >= ymin[c]) continue;
        const slope = -(Hf(wx, zz + .3) - hc) / .3 * .6 + (Hf(wx + .3, zz) - hc) / .3 * .35, fog = Math.exp(-(z - 1.1) * .12);
        const b0 = Math.max(.16, Math.min(.8, .22 + slope * 1.7)) * (.4 + .6 * fog), y0 = Math.max(0, Math.ceil(ys)), y1 = Math.min(rows, Math.ceil(ymin[c]));
        for(let y = y0; y < y1; y++){ const body = .42 + .58 * Math.exp(-(y - ys) / (rows * .16)), b = b0 * body * (y === y0 ? 1.6 : 1); TL.put(c, y, Math.min(.85, b), 0); }
        ymin[c] = ys;
      }
    }
    TL.draw(off.begin(), .95, false, 'sq');
  });
  return tm => {
    tick(tm); off.blit(); PL.clear();
    for(let n = 0; n < PN; n++){
      const p = parts[n], u = (p.bz + tm * .011 * sp) % 1, z = 2.2 + u * 12, life = Math.sin(u * Math.PI);
      const wx = p.bx * z * kx + Math.sin(tm * .22 + p.ph) * .5 + Math.sin(tm * .13 + p.by * 5) * .4, wy = .9 + p.by * 3.6 + Math.sin(tm * .3 + p.bx * 4 + p.ph) * .3 + Math.sin(tm * .17 + z) * .2;
      const sx = ((wx / (z * kx)) * .5 + .5) * cols, sy = hy + (1.9 - wy) / z * focal, cx = sx | 0, cy = sy | 0;
      if(cx < 0 || cx >= cols || cy < 0 || cy >= rows || sy >= ymin[cx] - 1) continue;
      const b = (.55 + .45 * life) * (.8 + .2 * Math.sin(tm * .7 + p.ph)) * (.55 + .45 * Math.exp(-(z - 2) * .12));
      PL.put(cx, cy, b > .5 ? b : 0, p.cx ? 1 : 0);
    }
    PL.draw(ax, 1, true, 'sq');
  };
}

/* 02 torus: a ring sampled on (phi, theta), z-buffered per cell, lit by n·L. Arc of the ring = Claude/Codex split and travels as it spins.
   Tube thickness = trend, surface wobble = cache miss, dust in the ring plane = tokens (hidden behind the surface). */
function tTorus(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, TL = new Layer(cols, rows), PL = new Layer(cols, rows), off = offscreen(env), zb = new Float32Array(cols * rows);
  const r0 = .26 + .18 * D.trendK, K2 = 5, scr = rows * (phone ? .46 : .5), K1 = scr * K2 / (1 + r0);
  const cx = cols * (phone ? .55 : .66 + .1 * p.off), cy = rows * (phone ? .64 : .9);
  const NPH = phone ? 300 : 420, NTH = phone ? 120 : 160, wi = new Int16Array(cols * rows), hist = new Int32Array(NPH), s0 = (p.yaw / TAU * NPH) | 0, cph = new Float32Array(NPH), sph = new Float32Array(NPH), cth = new Float32Array(NTH), sth = new Float32Array(NTH);
  for(let i = 0; i < NPH; i++){ cph[i] = Math.cos(i / NPH * TAU); sph[i] = Math.sin(i / NPH * TAU); }
  for(let j = 0; j < NTH; j++){ cth[j] = Math.cos(j / NTH * TAU); sth[j] = Math.sin(j / NTH * TAU); }
  const Lx = -.45, Ly = .66, Lz = -.6, Ln = Math.hypot(Lx, Ly, Lz), lx = Lx / Ln, ly = Ly / Ln, lz = Lz / Ln, M = new Float32Array(9);
  function rot(tm){ /* M = Ry(c) Rx(a) Rz(b) */
    const a = .92 + .12 * p.tilt + .1 * Math.sin(tm * .05), b = tm * .07 * sp + p.yaw, c = -.5 + .25 * p.off + .18 * Math.sin(tm * .031);
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
    const r00 = cb, r01 = -sb, r10 = ca * sb, r11 = ca * cb, r12 = -sa, r20 = sa * sb, r21 = sa * cb, r22 = ca; /* Rx·Rz (r02 = 0) */
    M[0] = cc * r00 + sc * r20; M[1] = cc * r01 + sc * r21; M[2] = sc * r22;
    M[3] = r10; M[4] = r11; M[5] = r12;
    M[6] = -sc * r00 + cc * r20; M[7] = -sc * r01 + cc * r21; M[8] = cc * r22;
  }
  const parts = Array.from({length: Math.round(D.nPart * .6)}, () => ({rho: 1.5 + Math.pow(X.rnd(), .7) * 1.6, a0: X.rnd() * TAU, h: (X.rnd() - .5) * .35, ph: X.rnd() * TAU, cx: X.rnd() > D.share}));
  const PN = phone ? Math.round(parts.length * .5) : parts.length;
  const tick = ticker(.11, tm => {
    rot(tm); TL.clear(); zb.fill(0); const {gb, gc} = TL, wob = D.jitter * .05;
    for(let i = 0; i < NPH; i++){
      const cp = cph[i], spp = sph[i];
      for(let j = 0; j < NTH; j++){
        const r = r0 * (1 + wob * Math.sin(i * .21 + j * .37 + tm * 1.3)), rr = 1 + r * cth[j];
        const px = rr * cp, py = rr * spp, pz = r * sth[j], nx = cth[j] * cp, ny = cth[j] * spp, nz = sth[j];
        const X1 = M[0] * px + M[1] * py + M[2] * pz, Y1 = M[3] * px + M[4] * py + M[5] * pz, Z1 = M[6] * px + M[7] * py + M[8] * pz + K2, ooz = 1 / Z1;
        const sx = Math.round(cx + K1 * X1 * ooz), sy = Math.round(cy - K1 * Y1 * ooz);
        if(sx < 0 || sy < 0 || sx >= cols || sy >= rows) continue;
        const k = sx * rows + sy; if(ooz <= zb[k]) continue; zb[k] = ooz;
        const lum = (M[0] * nx + M[1] * ny + M[2] * nz) * lx + (M[3] * nx + M[4] * ny + M[5] * nz) * ly + (M[6] * nx + M[7] * ny + M[8] * nz) * lz;
        gb[k] = Math.min(.56, .06 + .46 * Math.pow(Math.max(0, lum), 1.3)); wi[k] = i;
      }
    }
    /* R07c: the arc is sized on screen, not in angle. Perspective makes the near arc cover far more cells than its angle, so count the visible
       cells each phi slice won and grow the amber arc from a fixed start until it holds (1 - share) of them. Amber reads ~17% brighter than blue, so it is dimmed to match. */
    hist.fill(0); let tot = 0; for(let k = 0; k < gb.length; k++) if(zb[k] > 0){ hist[wi[k]]++; tot++; }
    const want = (1 - D.share) * tot, inArc = new Uint8Array(NPH); let acc = 0;
    for(let j = 0; j < NPH && acc < want; j++){ const i = (s0 + j) % NPH; inArc[i] = 1; acc += hist[i]; }
    for(let k = 0; k < gb.length; k++) if(zb[k] > 0){ const o = inArc[wi[k]]; gc[k] = o; if(o) gb[k] *= .86; }
    TL.draw(off.begin(), .85, false, 'sh');
  });
  return tm => {
    tick(tm); off.blit(); PL.clear();
    for(let n = 0; n < PN; n++){
      const q = parts[n], a = q.a0 + tm * .05 * sp / q.rho, px = q.rho * Math.cos(a), py = q.rho * Math.sin(a), pz = q.h + .05 * Math.sin(tm * .4 + q.ph);
      const X1 = M[0] * px + M[1] * py + M[2] * pz, Y1 = M[3] * px + M[4] * py + M[5] * pz, ooz = 1 / (M[6] * px + M[7] * py + M[8] * pz + K2);
      const sx = Math.round(cx + K1 * X1 * ooz), sy = Math.round(cy - K1 * Y1 * ooz);
      if(sx < 0 || sy < 0 || sx >= cols || sy >= rows || zb[sx * rows + sy] > ooz) continue;
      const b = (.6 + .4 * Math.sin(tm * .6 + q.ph)) * (1.08 - .25 * (q.rho - 1.5)) * (.75 + .25 * ooz * K2);
      PL.put(sx, sy, b > .5 ? b : 0, q.cx ? 1 : 0);
    }
    PL.draw(ax, 1, true, 'sq');
  };
}

/* 03 flow field: streamlines of a slowly turning noise field drawn in braille micro dots; tokens ride them as short comets.
   Field turbulence = trend, extra field grain = cache miss, line colour = split. */
function tFlow(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, TL = new Layer(cols, rows), PL = new Layer(cols, rows), off = offscreen(env);
  const K = phone ? 150 : 300, ST = 70, paths = new Float32Array(K * ST * 2), seeds = new Float32Array(K * 2), lcol = new Uint8Array(K), ldep = new Float32Array(K);
  const fs = .028 + .03 * D.trendK, base = -.32 + .22 * p.off, grain = D.jitter * .12;
  for(let k = 0; k < K; k++){ seeds[k * 2] = (X.rnd() * 1.3 - .3) * cols; seeds[k * 2 + 1] = rows * (.3 + .7 * Math.pow(X.rnd(), .7)); lcol[k] = X.rnd() < D.share ? 0 : 1; ldep[k] = X.rnd(); }
  let ft = 0;
  const dir = (x, y, v) => { const a = base + (noise(x * fs + 11, y * fs * 1.4 + ft) - .5) * 2.8 + (noise(x * .2 + 70, y * .2) - .5) * grain; v[0] = Math.cos(a); v[1] = Math.sin(a) * .8; };
  const parts = Array.from({length: Math.round(D.nPart * .45)}, () => ({k: (X.rnd() * K) | 0, ph: X.rnd(), v: 5 + 5 * X.rnd(), cx: 0}));
  parts.forEach(q => q.cx = lcol[q.k]);
  const PN = phone ? Math.round(parts.length * .5) : parts.length;
  const tick = ticker(.22, tm => {
    ft = tm * .014 * sp; tracePaths(paths, K, ST, seeds, dir, 1.15); TL.clear();
    for(let k = 0; k < K; k++){ const dep = .45 + .55 * ldep[k];
      for(let i = 0; i < ST; i++){ const o = (k * ST + i) * 2, y = paths[o + 1], low = .45 + .55 * clamp01(y / rows);
        TL.put(paths[o], y, (.12 + .4 * dep) * Math.sin(Math.PI * i / (ST - 1)) * low, lcol[k]); } }
    TL.draw(off.begin(), .95, false, 'br');
  });
  return tm => {
    tick(tm); off.blit(); PL.clear();
    for(let n = 0; n < PN; n++){ const q = parts[n], s = (q.ph * ST + tm * q.v * sp) % (ST - 1);
      ridePath(PL, paths, ST, q.k, s, .7 + .3 * Math.sin(tm * .5 + q.ph * 9), q.cx, 4); }
    PL.draw(ax, 1, true, 'br');
  };
}

/* 04 ripples: 3-4 point sources on a water plane seen in perspective; brightness = wave face toward the viewer.
   Codex source carries (1 - share) of the amplitude and colours the cells it dominates; wavelength = trend; surface grain = cache miss;
   tokens = glints that light up only on crests. */
function tRipple(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, TL = new Layer(cols, rows), PL = new Layer(cols, rows), off = offscreen(env);
  const hy = rows * (phone ? .30 : .38), focal = rows * .9, camH = 3, kx = .62 * cols / rows;
  const S = mulberry(mix(X.p.seed + 4)), NS = 3 + (S() * 2 | 0), src = [];
  for(let i = 0; i < NS; i++){ const cxr = i === NS - 1; src.push({x: (S() * 2 - 1) * (cxr ? 1.6 : 2.8) + p.off * .6, z: cxr ? 4.6 + S() * 2 : 4.4 + S() * 6, ph: S() * TAU, a: cxr ? (1 - D.share) * 1.6 : D.share / (NS - 1), c: cxr ? 1 : 0}); }
  const kw = 8 + 5 * D.trendK, om = 1.1;
  const wave = (x, z, t, out) => { let h = 0, dz = 0, cb = 0, co = 0;
    for(let i = 0; i < NS; i++){ const s = src[i], ddx = x - s.x, ddz = z - s.z, r = Math.sqrt(ddx * ddx + ddz * ddz) + 1e-3, e = s.a * Math.exp(-.05 * r), ph = kw * r - om * t + s.ph;
      h += e * Math.sin(ph); dz += e * kw * Math.cos(ph) * ddz / r; if(s.c) co += s.a / (r + .3); else cb += s.a / (r + .3); }
    out[0] = h; out[1] = dz; out[2] = co > cb ? 1 : 0; };
  const w = [0, 0, 0], ampSum = src.reduce((a, s) => a + s.a, 0);
  const parts = Array.from({length: Math.round(D.nPart * .55)}, () => ({px: X.rnd() * 2 - 1, z: X.rnd(), ph: X.rnd() * TAU}));
  const PN = phone ? Math.round(parts.length * .5) : parts.length;
  const tick = ticker(.11, tm => {
    const t = tm * sp; TL.clear();
    for(let y = Math.ceil(hy + 1); y < rows; y++){
      const z = camH * focal / (y - hy); if(z > 14) continue; const fog = Math.exp(-(z - 4) * .22);
      for(let c = 0; c < cols; c++){
        const x = ((c + .5) / cols * 2 - 1) * z * kx; wave(x, z, t, w);
        const g = D.jitter ? (noise(x * 2.5 + 40, z * 2.5 + t * .4) - .5) * D.jitter * .25 : 0;
        const b = (.06 + .7 * Math.pow(clamp01(.5 - (w[1] + g * 5) * .12), 2.4)) * Math.min(1, .15 + .85 * fog);
        TL.put(c, y, Math.min(.82, b), w[2]);
      }
    }
    TL.draw(off.begin(), .95, false, 'dot');
  });
  return tm => {
    tick(tm); off.blit(); PL.clear(); const t = tm * sp;
    for(let n = 0; n < PN; n++){ const q = parts[n], u = (q.z + tm * .006 * sp) % 1, z = 4.2 + (1 - u) * 6, x = q.px * z * kx;
      wave(x, z, t, w); const crest = sstep(.18, .5, w[0] / ampSum), life = Math.sin(u * Math.PI);
      const b = crest * (.6 + .4 * Math.sin(tm * .9 + q.ph)) * life * (.6 + .4 * Math.exp(-(z - 4.2) * .2));
      if(b < .5) continue; PL.put(((x / (z * kx)) * .5 + .5) * cols, hy + camH / z * focal, b, w[2]); }
    PL.draw(ax, 1, true, 'dot');
  };
}

/* 05 road: a dotted ground grid sliding toward the viewer, a road that bends with the trend, and car lights.
   Cars = tokens (one car per ~22 tokens-particles), outgoing (blue) vs oncoming (amber) = split; cache miss = light flicker. */
function tRoad(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, TL = new Layer(cols, rows), PL = new Layer(cols, rows), off = offscreen(env);
  const hy = rows * (phone ? .36 : .6), focal = rows * .9, camH = .9, kx = .62 * cols / rows, gs = 1.2, hw = 1.05, drive = .2 * sp;
  const curv = (D.trendK - .5) * .05 + .012 * p.off;
  const roadX = (z, tm) => (curv + .006 * Math.sin(tm * .07)) * z * z + .25 * p.off;
  const proj = (x, z) => ((x / (z * kx)) * .5 + .5) * cols, rowOf = z => hy + camH / z * focal;
  const fogOf = z => Math.exp(-(z - 1) * .085);
  const NC = Math.max(6, Math.round(D.nPart / 22)), cars = Array.from({length: NC}, () => ({out: X.rnd() < D.share, z0: X.rnd() * 26, v: .7 + .5 * X.rnd(), ph: X.rnd() * TAU}));
  const dust = Array.from({length: Math.round(D.nPart * .3)}, () => ({bx: X.rnd() * 2 - 1, by: X.rnd(), bz: X.rnd(), ph: X.rnd() * TAU, cx: X.rnd() > D.share}));
  const CN = phone ? Math.ceil(NC * .5) : NC, DN = phone ? Math.round(dust.length * .5) : dust.length;
  const tick = ticker(.09, tm => {
    TL.clear(); const shift = (tm * drive) % gs;
    for(let c = 0; c < cols; c++){ const v = c / cols - .5; TL.put(c, hy, .14 + .2 * Math.exp(-v * v * 40), 0); }        /* horizon */
    for(let n = 1; n < 28; n++){ const z = n * gs - shift; if(z < .9) continue; const y = rowOf(z), f = fogOf(z), rx = roadX(z, tm);   /* cross lines */
      for(let c = 0; c < cols; c++){ const x = ((c + .5) / cols * 2 - 1) * z * kx; if(Math.abs(x - rx) < hw || (c & 1)) continue; TL.put(c, y, .36 * f, 0); } }
    for(let y = Math.ceil(hy + 1); y < rows; y++){ const z = camH * focal / (y - hy), f = fogOf(z), rx = roadX(z, tm);           /* long lines + road */
      for(let m = -14; m <= 14; m++){ const x = m * gs; if(Math.abs(x - rx) < hw + .1) continue; TL.put(proj(x, z), y, .3 * f, 0); }
      TL.put(proj(rx - hw, z), y, .5 * f, 0); TL.put(proj(rx + hw, z), y, .5 * f, 0);
      if(((z + tm * drive) % 1.4) < .7) TL.put(proj(rx, z), y, .44 * f, 0); }
    TL.draw(off.begin(), .95, false, 'sq');
  });
  return tm => {
    tick(tm); off.blit(); PL.clear();
    for(let n = 0; n < CN; n++){ const q = cars[n], span = 26, u = ((q.z0 + (q.out ? .12 + .2 * q.v : -(.5 + .4 * q.v)) * tm * sp) % span + span) % span, z = 1.6 + u;
      const rx = roadX(z, tm) + (q.out ? .5 : -.5), f = fogOf(z), fl = 1 - D.jitter * .06 * (1 + Math.sin(tm * 7 + q.ph)), b = (.55 + .43 * f) * fl;
      const y = rowOf(z) - .3 / z * focal * .5, sep = Math.max(.55, .22 / (z * kx) * cols * .5);
      const x0 = proj(rx, z); PL.put(x0 - sep, y, b, q.out ? 0 : 1); PL.put(x0 + sep, y, b, q.out ? 0 : 1); }
    for(let n = 0; n < DN; n++){ const q = dust[n], u = (q.bz + tm * .009 * sp) % 1, z = 2.5 + u * 14, life = Math.sin(u * Math.PI);
      const x = q.bx * z * kx + Math.sin(tm * .2 + q.ph) * .4, wy = .4 + q.by * 2.2 + Math.sin(tm * .27 + q.ph) * .25, y = hy + (camH - wy) / z * focal;
      const b = (.52 + .3 * life) * (.8 + .2 * Math.sin(tm * .7 + q.ph)) * (.6 + .4 * fogOf(z)); if(b > .5 && y < rows - 1) PL.put(proj(x, z), y, b, q.cx ? 1 : 0); }
    PL.draw(ax, 1, true, 'sq');
  };
}

/* 06 topography: contour lines of a slowly morphing height map, tilted away from the viewer. Elevation above the (1 - share) quantile is amber,
   so Codex owns exactly its share of the map. Contour count = trend, morph speed = cache miss, tokens = walkers along the contours. */
function tTopo(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, TL = new Layer(cols, rows), PL = new Layer(cols, rows), off = offscreen(env);
  const Hg = new Float32Array(cols * rows), levels = 7 + Math.round(D.trendK * 6), samp = new Float32Array(1500), sidx = Array.from({length: 1500}, () => (X.rnd() * cols * rows) | 0);
  const u0 = p.off * 4 + 13, top = phone ? .16 : .22, ws = phone ? 1.45 : 1;
  let thr = 1;
  const K = phone ? 60 : 120, ST = 46, paths = new Float32Array(K * ST * 2), seeds = new Float32Array(K * 2);
  for(let k = 0; k < K; k++){ seeds[k * 2] = X.rnd() * cols; seeds[k * 2 + 1] = rows * (top + (1 - top) * Math.pow(X.rnd(), .6)); }
  const at = (x, y) => { x = Math.max(1, Math.min(cols - 2, x | 0)); y = Math.max(1, Math.min(rows - 2, y | 0)); return x * rows + y; };
  const dir = (x, y, v) => { const k = at(x, y), gx = Hg[k + rows] - Hg[k - rows], gy = Hg[k + 1] - Hg[k - 1], g = Math.hypot(gx, gy) || 1; v[0] = -gy / g; v[1] = gx / g * .7; };
  const parts = Array.from({length: Math.round(D.nPart * .3)}, () => ({k: (X.rnd() * K) | 0, ph: X.rnd(), v: 3 + 3 * X.rnd()}));
  const PN = phone ? Math.round(parts.length * .5) : parts.length;
  const tick = ticker(.16, tm => {
    const t = tm * .01 * sp * (1 + D.jitter * .6);
    for(let y = 0; y < rows; y++){ const yn = y / rows, v = 3.1 / (yn + .55) - t, sc = (1 + 1.1 * (1 - yn)) * ws;
      for(let c = 0; c < cols; c++){ const u = (c - cols * .5) / rows * sc * 1.1 + u0;
        let h = .62 * noise(u * .8, v * .8) + .28 * noise(u * 1.9 + 9, v * 1.9 + 3) + .1 * noise(u * 4.1 + 2, v * 4.1 - 7);
        Hg[c * rows + y] = h * h * 1.6; } }
    for(let i = 0; i < samp.length; i++) samp[i] = Hg[sidx[i]]; samp.sort(); thr = samp[Math.min(samp.length - 1, Math.floor(samp.length * D.share))];
    TL.clear(); const {gb, gc} = TL;
    for(let c = 1; c < cols - 1; c++) for(let y = 1; y < rows - 1; y++){
      const k = c * rows + y, h = Hg[k], f = h * levels * 1.4, fr = f - Math.floor(f), e = Math.min(fr, 1 - fr);
      const g = Math.hypot(Hg[k + rows] - Hg[k - rows], Hg[k + 1] - Hg[k - 1]) * .5 * levels * 1.4 + 1e-4, dist = e / g;
      const fog = (.42 + .58 * y / rows) * sstep(top * rows - 2, top * rows + 10, y), idx = Math.round(f) % 5 === 0;
      let b = 0;
      if(dist < .62) b = (idx ? .64 : .3) * (1 - dist * .55);
      if(b * fog >= .05){ gb[k] = b * fog; gc[k] = h > thr ? 1 : 0; }
    }
    tracePaths(paths, K, ST, seeds, dir, 1.1);
    TL.draw(off.begin(), .95, false, 'sq');
  });
  return tm => {
    tick(tm); off.blit(); PL.clear();
    for(let n = 0; n < PN; n++){ const q = parts[n], s = (q.ph * ST + tm * q.v * sp) % (ST - 1), o = (q.k * ST + (s | 0)) * 2, y = paths[o + 1];
      if(y < top * rows + 4) continue; ridePath(PL, paths, ST, q.k, s, .62 + .36 * Math.sin(tm * .6 + q.ph * 7), Hg[at(paths[o], y)] > thr ? 1 : 0, 2); }
    PL.draw(ax, 1, true, 'sq');
  };
}

/* 07 planet: a halftone gas giant rising from the bottom edge, bands turning slowly, the terminator sweeping across.
   Polar cap above the latitude whose area = (1 - share) is amber; band turbulence = trend; band jitter = cache miss; tokens = drifting stars. */
function tPlanet(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, TL = new Layer(cols, rows), PL = new Layer(cols, rows), off = offscreen(env);
  const R = rows * (phone ? .66 : .76), cx = cols * (phone ? .6 : .68 + .1 * p.off), cy = rows + R * (phone ? .28 : .5);
  const tilt = .32 + .12 * p.tilt, ct = Math.cos(tilt), st = Math.sin(tilt), sinCap = 2 * D.share - 1, turb = .6 + 1.6 * D.trendK;
  const stars = Array.from({length: Math.round(D.nPart * .3)}, () => ({px: X.rnd(), y: Math.pow(X.rnd(), .7), d: .3 + X.rnd(), ph: X.rnd() * TAU, cx: X.rnd() > D.share}));
  const PN = phone ? Math.round(stars.length * .5) : stars.length;
  const tick = ticker(.15, tm => {
    TL.clear(); const spin = tm * .018 * sp + p.yaw, la = tm * .02 * sp + 2.2 + p.off, Lx = Math.cos(la), Lz = Math.sin(la) * .9 + .25, Ly = .35, Ln = Math.hypot(Lx, Ly, Lz);
    const y0 = Math.max(0, Math.floor(cy - R - 3));
    for(let y = y0; y < rows; y++){ const dy = (cy - y) / R;
      for(let c = Math.max(0, Math.floor(cx - R - 3)); c < Math.min(cols, Math.ceil(cx + R + 3)); c++){
        const dx = (c - cx) / R, rr = dx * dx + dy * dy;
        if(rr > 1){ const rim = Math.sqrt(rr) - 1; if(rim < .035){ const l = (dx * Lx + dy * Ly) / Ln; if(l > .1) TL.put(c, y, .26 * l * (1 - rim / .035), 0); } continue; }
        const nz = Math.sqrt(1 - rr), ny = dy * ct - nz * st, nzz = dy * st + nz * ct, lat = Math.asin(Math.max(-1, Math.min(1, ny))), lon = Math.atan2(dx, nzz) + spin;
        const band = .5 + .5 * Math.sin(lat * 9 + (noise(lon * 1.6 + 20, lat * 5) - .5) * turb * 2.4 + D.jitter * .2 * Math.sin(lon * 6 + tm * .3));
        const alb = .42 + .5 * band, lum = Math.max(0, (dx * Lx + dy * Ly + nz * Lz) / Ln);
        const b = Math.min(.58, alb * Math.pow(lum, .8) * .6 + .03 * nz);   /* R07c: toned down to sit level with 01 */
        TL.put(c, y, b, ny > sinCap ? 1 : 0);
      }
    }
    TL.draw(off.begin(), .95, false, 'dot');
  });
  return tm => {
    tick(tm); off.blit(); PL.clear();
    for(let n = 0; n < PN; n++){ const q = stars[n], x = ((q.px - tm * .0025 * q.d * sp) % 1 + 1) % 1 * cols, y = (.2 + .8 * q.y) * rows;
      const dx = (x - cx) / R, dy = (y - cy) / R; if(dx * dx + dy * dy < 1.08) continue;
      const b = (.5 + .5 * Math.sin(tm * (.4 + .5 * q.d) + q.ph)) * (.5 + .42 * q.d); if(b > .5) PL.put(x, y, b, q.cx ? 1 : 0); }
    PL.draw(ax, 1, true, 'dot');
  };
}

/* 08 galaxy: a two-armed spiral disk seen at a steep angle, low on the left. The arm pattern turns rigidly (a density wave), stars ride it with a
   small sway so the arms never smear. Arm winding = trend, disk thickness = cache miss, stars = tokens, star colour = split. */
function tGalaxy(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, TL = new Layer(cols, rows), PL = new Layer(cols, rows), off = offscreen(env);
  const inc = 1.17 + .12 * p.tilt, ci = Math.cos(inc), si = Math.sin(inc), Rg = rows * (phone ? .62 : .95), cx = cols * (phone ? .5 : .3 + .08 * p.off), cy = rows * (phone ? .72 : .84);
  const tp = .2 + .22 * (1 - D.trendK), thick = .03 + D.jitter * .04, Om = .035 * sp;
  const stars = Array.from({length: Math.round(D.nPart * .7)}, () => { const r = .06 + Math.pow(X.rnd(), .75) * .94, arm = X.rnd() < .5 ? 0 : Math.PI, g = (X.rnd() + X.rnd() + X.rnd() - 1.5) * .5;
    return {r, th: Math.log(r) / tp + arm + g * (.35 + .4 * r), h: (X.rnd() - .5) * thick * 2, ph: X.rnd() * TAU, cx: X.rnd() > D.share}; });
  const PN = phone ? Math.round(stars.length * .5) : stars.length;
  const tick = ticker(.11, tm => {
    TL.clear(); const rot = tm * Om + p.yaw, x0 = Math.max(0, Math.floor(cx - Rg * 1.05)), x1 = Math.min(cols, Math.ceil(cx + Rg * 1.05)), y0 = Math.max(0, Math.floor(cy - Rg * ci * 1.05)), y1 = Math.min(rows, Math.ceil(cy + Rg * ci * 1.05));
    for(let c = x0; c < x1; c++) for(let y = y0; y < y1; y++){
      const u = (c - cx) / Rg, v = (y - cy) / (Rg * ci), r = Math.hypot(u, v); if(r > 1.05 || r < .004) continue;
      const th = Math.atan2(v, u) - rot, ph = th - Math.log(r) / tp, d = Math.cos(2 * ph), arm = Math.pow(.5 + .5 * d, 3);
      const b = (.06 + .55 * arm * (.55 + .45 * noise(u * 9 + 3, v * 9))) * Math.exp(-r * 1.9) * (1 - sstep(.8, 1.05, r)) + .85 * Math.exp(-r * r / .004);
      if(b > .05) TL.put(c, y, Math.min(.8, b * 1.4), 0); }
    TL.draw(off.begin(), .95, false, 'br');
  });
  return tm => {
    tick(tm); off.blit(); PL.clear(); const rot = tm * Om + p.yaw;
    for(let n = 0; n < PN; n++){ const q = stars[n], th = q.th + rot + .12 * Math.sin(tm * .05 + q.ph), x = q.r * Math.cos(th), y = q.r * Math.sin(th);
      const Y = y * ci - q.h * si, dep = y * si + q.h * ci, b = (.55 + .45 * Math.sin(tm * .45 + q.ph)) * (.95 - .3 * q.r) * (.85 + .15 * dep);
      if(b > .5) PL.put(cx + x * Rg, cy + Y * Rg, b, q.cx ? 1 : 0); }
    PL.draw(ax, 1, true, 'br');
  };
}

/* ================= ported templates (10+) =================
   Each one below rewrites the algorithm of one ascii.rest piece for this renderer: the source's 1:2 character cells become square cells, a value the
   source computed before picking a glyph goes straight to cell brightness, and where the source only has glyphs (strokes, marks, ramps) the glyph's
   measured ink coverage becomes the brightness (INK below). Fixed seeds become the date stream, and every clock is slowed for a background. */

/* glyph density table: ink coverage of each glyph, measured once from a monospace raster and normalised to the densest glyph of the set asked for */
const INK = (() => { const cache = {}; let cx = null;
  return s => { const out = {};
    for(const ch of s){ if(!(ch in cache)){
        if(!cx){ const c = document.createElement('canvas'); c.width = 24; c.height = 40; cx = c.getContext('2d', {willReadFrequently: true}); cx.font = '32px Menlo, Consolas, monospace'; cx.textBaseline = 'top'; }
        cx.clearRect(0, 0, 24, 40); cx.fillStyle = '#fff'; cx.fillText(ch, 2, 2); const d = cx.getImageData(0, 0, 24, 40).data; let a = 0; for(let i = 3; i < d.length; i += 4) a += d[i]; cache[ch] = a; }
      out[ch] = cache[ch]; }
    const mx = Math.max(...Object.values(out)) || 1; for(const k in out) out[k] /= mx; return out; }; })();
const hash2 = (a, b) => { let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1); h = Math.imul(h ^ h >>> 15, 0x85ebca6b); h = Math.imul(h ^ h >>> 13, 0xc2b2ae35); return ((h ^ h >>> 16) >>> 0) / 4294967296; };
const easeS = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

/* 10 jellyfish.
   Adapted from ascii.rest piece 'jellyfish' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: the squeeze / lift stroke, the rim that swings on a five-stroke beat, threads and mouth arms that hang from where the rim
   was a moment ago, and the bell's shade (glassy crown, thick edges, four pale horseshoes). One near jelly and two far ones; marine snow streams
   past faster while a bell pushes. Stroke period = trend; thread wobble = cache miss; snow = tokens, its colour = split. */
function tJelly(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, L = new Layer(cols, rows), PL = new Layer(cols, rows), off = offscreen(env);
  const PER = (7.4 - 2.4 * D.trendK) / sp, SQ = .28, wob = 1.5 + D.jitter * 1.2, ink = INK(".:|/\\();");
  const phs = t => ((t % PER) + PER) % PER / PER;
  const squeeze = t => { const q = phs(t); return q < SQ ? easeS(q / SQ) : 1 - easeS((q - SQ) / (1 - SQ)); };
  const lift = t => { const q = phs(t); return q < .4 ? easeS(q / .4) : 1 - easeS((q - .4) / .6); };
  /* source units: x in columns, y in rows (a row = two columns); s = cells per column */
  const J = [{x: phone ? .64 : .7 + .07 * p.off, y: phone ? .64 : .79, s: rows * (phone ? .013 : .0132), g: 1, t0: 0},   /* R08: desktop jelly lower and smaller, clear of the caption row */
             {x: phone ? .2 : .22 + .06 * p.tilt, y: .8, s: rows * .0072, g: .66, t0: PER * .43},
             {x: phone ? .4 : .46 - .05 * p.tilt, y: .76, s: rows * .0046, g: .5, t0: PER * .71}];
  const rimAt = t => { const c = squeeze(t); return {c, x: 1.5 * Math.sin(TAU * t / (5 * PER)), y: -.8 * c - 1.4 * lift(t), half: (13 - 2.6 * c) * (1 - .3 * c)}; };
  const mark = (dx, bow, f) => f > .9 ? '.' : f > .8 ? ':' : dx > .6 ? '\\' : dx < -.6 ? '/' : bow > .22 ? '(' : bow < -.22 ? ')' : '|';
  function jelly(j, tm){
    const t = tm + j.t0, now = rimAt(t), c = now.c, a = 13 - 2.6 * c, b = 13 + 2 * c, S = j.s, X0 = j.x * cols, Y0 = j.y * rows;
    const CX = X0 + now.x * S, RY = Y0 + now.y * 2 * S, g = j.g;
    const width = s => a * Math.sqrt(Math.max(0, 1 - s * s)) * (1 - .3 * c * (1 - s) ** 2);
    /* bell: a half dome b columns tall over the rim */
    const x0 = Math.floor(CX - a * S - 2), x1 = Math.ceil(CX + a * S + 2), y0 = Math.floor(RY - b * S - 2), y1 = Math.ceil(RY);
    for(let cx = x0; cx <= x1; cx++) for(let cy = y0; cy <= y1; cy++){
      const U = (cx + .5 - CX) / S, s = (RY - cy - .5) / S / b; if(s < 0 || s >= 1) continue;
      const w = width(s); if(Math.abs(U) >= w) continue;
      const u = Math.max(-.999, Math.min(.999, U / w)), nz = Math.sqrt(1 - u * u) * Math.sqrt(1 - s * s), ph = Math.asin(u);
      const gg = Math.min(Math.abs(ph - .6), Math.abs(ph + .6)), ring = Math.max(0, 1 - Math.abs(Math.hypot(gg / .36, (s - .45) / .26) - 1) * 3.5);
      const crown = 1 - .6 * easeS((s - .62) / .38);
      let v = Math.min(1, (.16 + .07 * s + .6 * (1 - nz) ** 2) * crown + .55 * ring);
      if(1 - Math.abs(u) < .07 || s > .965) v = Math.max(v, .62);                          /* the outline */
      L.put(cx, cy, (.08 + .82 * v) * g, 0);
    }
    for(let cx = Math.floor(CX - width(0) * S); cx <= CX + width(0) * S; cx++) L.put(cx, RY, (cx & 1 ? .5 : .36) * g, 0);   /* rim */
    /* threads and mouth arms: each point d rows down hangs from the rim of d * lag seconds ago */
    const lagK = PER / 2.2, rim = now.y;
    const trail = (d, lag) => { const w_ = rimAt(t - d * lag * lagK); return {x: w_.x, y: d + Math.max(0, w_.y - rim) * .8, half: w_.half}; };
    const strand = (len, lag, xAt, bri) => { let px = null, pdx = 0, pr = -1;
      for(let d = 1; d < len; d += .2){ const at = trail(d, lag), x = xAt(d, at), y = at.y;
        if(px !== null && Math.floor(y) !== pr){ const dx = x - px, bow = dx - pdx; pdx = dx; px = x; pr = Math.floor(y);
          L.put(CX + (x - now.x) * S, RY + y * 2 * S, bri(mark(dx, bow, d / len), d / len) * g, 0); }
        else if(px === null){ px = x; pr = Math.floor(y); }
        L.put(CX + (x - now.x) * S, RY + y * 2 * S, .26 * (1 - d / len) * g, 0); } };
    for(let i = 0; i < 8; i++){ const u = -.92 + 1.84 * i / 7, len = 8.5 + 3.2 * (1 - Math.abs(u)) + ((i * 3) % 5) * .8;
      strand(len, .06, (d, at) => at.x + u * at.half * (1 - .01 * d) + (.05 + d * .013) * d * wob * Math.sin(d * .5 - t * 3 * 2.2 / PER + i * 1.9), (ch, f) => (.2 + .4 * ink[ch]) * (1 - .5 * f)); }
    for(let i = 0; i < 2; i++){ const sg = i ? 1 : -1;
      strand(10, .09, (d, at) => at.x + sg * 2 * (1 - d * .06) * (at.half / 10) + .9 * Math.sin(d * .6 - t * 2.2 * 2.2 / PER + i * 2.5), (ch, f) => (.24 + .4 * ink[f > .8 ? ch : ';']) * (1 - .4 * f)); }
  }
  /* marine snow: the water moves past, faster while a bell pushes */
  const travel = t => { const k = Math.floor(t / PER), q = phs(t); return .25 * t + .9 * (k + (q < SQ ? .8 * easeS(q / SQ) : .8 + .2 * (q - SQ) / (1 - SQ))); };
  const snow = Array.from({length: Math.round(D.nPart * .3)}, () => ({px: X.rnd() * cols, y: X.rnd(), z: .4 + X.rnd() * .6, w: X.rnd() * TAU, cx: X.rnd() > D.share}));
  const PN = phone ? Math.round(snow.length * .5) : snow.length;
  const tick = ticker(.06, tm => { L.clear(); J.forEach(j => jelly(j, tm)); L.draw(off.begin(), .9, false, 'dot'); });
  return tm => {
    tick(tm); off.blit(); PL.clear(); const Dv = travel(tm) * rows * .06;
    for(let n = 0; n < PN; n++){ const q = snow[n], y = (((q.y * rows + Dv * q.z) % rows) + rows) % rows, b = (.45 + .5 * q.z) * (.8 + .2 * Math.sin(tm * .5 + q.w));
      if(b > .5) PL.put(q.px + 2 * Math.sin(tm * .2 + q.w), y, b * (.6 + .4 * y / rows), q.cx ? 1 : 0); }
    PL.draw(ax, .8, true, 'dot');
  };
}

/* 11 goldfish.
   Adapted from ascii.rest piece 'aquarium' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: each fish swims there and back on asin(sin) so it eases into every turn, drifts between depths over a long loop and shows
   its face-on view mid-turn; weed blades rise straight and bend toward a swinging tip; bubbles stream from a stone and swell as they rise.
   The glyph fish become shaded bodies (round flank, fan tail, eye) that narrow to an oval as they turn. Goldfish (amber) = Codex share of the
   fish, the rest are blue koi; swim pace = trend; weed sway = cache miss; bubbles = tokens, their colour = split. */
function tFish(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, SL = new Layer(cols, rows), L = new Layer(cols, rows), off = offscreen(env);
  const S = mulberry(mix(p.seed + 11)), FLOOR = rows - Math.max(4, Math.round(rows * .07)), NF = phone ? 5 : 8, pace = (1.25 - .5 * D.trendK) / sp;
  const nGold = Math.round((1 - D.share) * NF);
  const fish = Array.from({length: NF}, (_, i) => { const z = S(), span = cols * (.25 + .3 * S()), from = S() * (cols - span);
    return {z, from, to: from + span, row: rows * (phone ? .6 + .27 * S() : .67 + .2 * S()), per: (34 + 40 * S()) * pace, ph: S(), drift: rows * (.03 + .05 * S()), dp: S() * TAU,
      Lf: rows * (phone ? .13 : .105) * (.6 + .6 * z), gold: 0, beat: .9 + .5 * S()}; });   /* R08: desktop fish lower and smaller, clear of the caption row */
  fish.sort((a, b) => a.z - b.z);                                                       /* far first, near drawn over */
  const order = fish.map((_, i) => i).sort((a, b) => hash2(p.seed, a) - hash2(p.seed, b)); for(let i = 0; i < nGold; i++) fish[order[i]].gold = 1;
  const LOOP = 120 / sp, sway = 1 + D.jitter * .8;
  const weeds = []; for(let x = S() * 60; x < cols; x += 50 + S() * 90){ const n = 2 + (S() * 3 | 0); for(let k = 0; k < n; k++) weeds.push({c: x + k * 1.6, h: rows * (.06 + .14 * S()), lean: (S() - .5) * 8, ph: S() * TAU}); }
  const stones = [cols * (.62 + .1 * p.off), cols * (.18 + .08 * p.tilt)];
  const bub = Array.from({length: Math.round(D.nPart * .08)}, (_, k) => ({k, s: k % 2, r: X.rnd(), cx: X.rnd() > D.share}));
  const BN = phone ? Math.round(bub.length * .5) : bub.length;
  /* static: gravel bed and the two stones */
  const gravel = offscreen(env); { SL.clear();
    for(let c = 0; c < cols; c++) for(let y = FLOOR; y < rows; y++){ const n = hash2(c, y * 7 + 3), dep = (y - FLOOR) / (rows - FLOOR);
      if(n < .5 - .2 * dep) SL.put(c, y, (.12 + .2 * hash2(c, y)) * (1 - .4 * dep), 0); }
    stones.forEach((sx, i) => { const w = rows * (.07 - .02 * i), h = w * .55; for(let c = -w; c <= w; c++) for(let y = -h; y <= 0; y++){ const e = (c / w) ** 2 + (y / h) ** 2; if(e < 1) SL.put(sx + c, FLOOR + y, .1 + .22 * (1 - e) * (y < -h * .4 ? 1.3 : 1), 0); } });
    SL.draw(gravel.begin(), .9, false, 'dot'); }
  const tick = ticker(.12, tm => { L.clear(); const u = tm;
    for(const w of weeds){ let px = w.c; const n = Math.ceil(w.h);
      for(let k = 1; k <= n; k++){ const f = k / n, sw = 1.4 * sway * rows * .02 * Math.sin(TAU * u / (16 / sp) + w.ph - f * .7 + w.lean * .02), x = w.c + w.lean * f ** 1.5 + sw * f * f;
        L.put(x, FLOOR - k, .1 + .14 * (1 - f) + .08 * Math.min(1, Math.abs(x - px) * 2), 0); px = x; } }
    L.draw(off.begin(), .9, false, 'dot'); });
  const FL = new Layer(cols, rows);
  function drawFish(f, tm){
    const th = TAU * (tm / f.per + f.ph), q = Math.asin(.995 * Math.sin(th)) / (Math.PI / 2), cosT = Math.cos(th);
    const cx = f.from + (q + 1) / 2 * (f.to - f.from), cy = f.row + f.drift * Math.sin(TAU * tm / LOOP + f.dp) + rows * .006 * Math.sin(TAU * tm / 9 + f.dp * 3);
    const dir = cosT >= 0 ? 1 : -1, sx = Math.max(.24, Math.pow(Math.abs(cosT), .6)), Lf = f.Lf, H = Lf * .46, g = .5 + .5 * f.z, col = f.gold;
    const beat = Math.sin(tm * 1.6 * f.beat + f.dp);
    const xr = Lf * (2.2 * sx + .3), yr = H * 2.4;
    for(let c = Math.floor(cx - xr); c <= cx + xr; c++) for(let y = Math.floor(cy - yr); y <= cy + yr; y++){
      const a = (c + .5 - cx) / (Lf * sx) * dir, yy = (y + .5 - cy) / H;              /* a: -1 tail root .. +1 snout */
      let b = 0;
      if(a > -1 && a < 1){ const hh = Math.pow(1 - a * a, .7) * (a < 0 ? 1 + .35 * a : 1) * (1 + .06 * beat * (1 - a));
        if(Math.abs(yy) < hh){ const v = yy / hh, nz = Math.sqrt(1 - v * v);
          b = .2 + .42 * nz - .14 * v; if(a > .55 && a < .78 && v > -.55 && v < -.05 && sx > .5) b = .06;   /* eye */
          if(Math.abs(v) > .84) b = Math.max(b, .38); }                                            /* rim */
        else if(yy < 0 && a > -.35 && a < .45){ const fin = (1 - Math.abs((a - .05) / .4)) * .55; if(-yy - hh < fin) b = .16 + .08 * Math.cos(a * 20) ** 2; } }   /* dorsal fin */
      else if(a <= -.9 && a > -2.2){ const k = (-.9 - a) / 1.3, tw = beat * .45 * k, sp_ = .22 + 1.25 * k, v = yy - tw * 1.2;   /* fan tail, forked, fluttering */
        const notch = k > .6 ? (k - .6) / .4 * sp_ * .45 : 0;
        if(Math.abs(v) < sp_ && Math.abs(v) >= notch){ b = (.16 + .16 * Math.cos(v / sp_ * 7 + beat) ** 2) * (1 - .5 * k); } }
      if(b > 0) FL.put(c, y, b * g, col);
    }
  }
  return tm => {
    tick(tm); gravel.blit(); off.blit(); FL.clear();
    for(const f of fish) drawFish(f, tm);
    for(let n = 0; n < BN; n++){ const q = bub[n], age = ((tm * sp - q.k * (LOOP / bub.length) * 2) % (LOOP / 2) + LOOP / 2) % (LOOP / 2), y = FLOOR - rows * .04 - age * rows * (.022 + .012 * q.r);
      if(y < rows * .2) continue; const x = stones[q.s] + rows * .012 * Math.sin(age * 1.4 + q.k) + (q.r - .5) * 3, b = .5 + .4 * (1 - y / rows) * (.7 + .3 * q.r);
      FL.put(x, y, b, q.cx ? 1 : 0); if(y < rows * .5) FL.put(x + 1, y, b * .55, q.cx ? 1 : 0); }
    FL.draw(ax, .85, true, 'dot');
  };
}
/* 12 whale.
   Adapted from ascii.rest piece 'whale' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: the three side-on shapes (back, arch, fluke; their outlines are the source's own, read here as a top profile per column and
   filled), the timeline that brings each up and sinks it (blow, roll, dive, fluke last), the blow's column that opens into a bushy head and drifts
   downwind, white water off the head, water streaming off the fluke and the smooth patch it leaves. The outline is the brightest edge, the back is
   darker than the flank. One cycle is ~33 s; the static frame lands on the blow. Whale size = trend; surface chop = cache miss;
   glints on the water = tokens, their colour = split. */
const WHALE_ART = {
  surf: ["                 _.-''-._", "          __..--'        `--.....______", "     _.--'                             ``--.._/|", "   .'       #o#                              `-.._", "  (____..--''                                     `-.._"],
  arch: ["                __..--.._/|", "           _.-''           `-._", "        .-'                    `-._", "      .'                           `-._", "     /                                 `-._", "    /                                      `-._"],
  fluke: [" ._                          _.", "  \\`-.._                _..-'/", "   `.   ``--.._    _.--''   .'", "     `-._      `\\/'      _.-'", "         ``--.._||_..--''", "                ||", "                ||", "                ||"]};
function whaleShape(art, both){ /* per source column: top (and bottom) of the outline in rows, sub-row from where the glyph sits in its cell */
  const w = Math.max(...art.map(l => l.length)), at = {'_': .9, '.': .72, ',': .72, '-': .5, '~': .5, "'": .12, '`': .12, '^': .1}, top = new Float32Array(w).fill(NaN), bot = new Float32Array(w).fill(NaN);
  let eye = null;
  art.forEach((l, r) => [...l].forEach((ch, k) => { if(ch === ' ') return; if(ch === 'o' && l.includes('#o#')){ eye = [k + .5, r + .5]; return; } if(ch === '#') return;
    const y = r + (at[ch] ?? .5); if(isNaN(top[k]) || y < top[k]) top[k] = y; if(isNaN(bot[k]) || y > bot[k]) bot[k] = y; }));
  return {w, h: art.length, top, bot: both ? bot : null, eye}; }
function tWhale(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, L = new Layer(cols, rows), PL = new Layer(cols, rows);
  const sc = Math.min(cols / 150, rows / 52) * (.86 + .28 * D.trendK), rh = 2 * sc;            /* cells per source column / per source row */
  const SEA = rows * (phone ? .72 : .74), SH = {surf: whaleShape(WHALE_ART.surf), arch: whaleShape(WHALE_ART.arch), fluke: whaleShape(WHALE_ART.fluke, true)};
  const LOOP = 10, SWIM = 2.6, BLOW = .7, WIND = 1.5, HOLE = WHALE_ART.surf[0].indexOf("''") + 1, FIN = WHALE_ART.surf[2].indexOf('|') - WHALE_ART.arch[0].indexOf('|');
  const UP = {surf: [0, 1, 3, 3.8], arch: [3.1, 3.8, 4.6, 5.2], fluke: [5, 5.9, 7.5, 8.5]}, DIVE = UP.arch[3];
  const X0 = cols * (phone ? .5 : .6 + .08 * p.off) / sc;                                      /* the snout's column (source units) */
  const FLUKE_X = X0 - SWIM * DIVE - 2 + FIN + WHALE_ART.arch[0].indexOf('|') + 4;
  const depth = (u, a) => u < a[0] || u > a[3] ? 1 : u < a[1] ? 1 - easeS((u - a[0]) / (a[1] - a[0])) : u < a[2] ? 0 : easeS((u - a[2]) / (a[3] - a[2]));
  const chop = .5 + D.jitter * .6, DRIP = [3, 6, 10, 13, 19, 22, 26, 29];
  const glints = Array.from({length: Math.round(D.nPart * .2)}, () => ({px: X.rnd(), d: X.rnd(), ph: X.rnd() * TAU, r: .2 + X.rnd() * .5, cx: X.rnd() > D.share}));
  const GN = phone ? Math.round(glints.length * .5) : glints.length;
  /* stamp a shape standing on the sea, sunk by `sink` of its height; returns the screen row of its top */
  function stamp(S, left, sink){
    const drop = sink * S.h, x0 = Math.floor(left * sc), x1 = Math.ceil((left + S.w) * sc), y0 = SEA - (S.h - drop) * rh;
    for(let c = x0; c <= x1; c++){ const k = c / sc - left, i = Math.floor(k), f = k - i; if(i < 0 || i >= S.w - 1 && f > 0) continue;
      const tA = S.top[i], tB = S.top[Math.min(S.w - 1, i + 1)]; if(isNaN(tA) && isNaN(tB)) continue;
      const tp = isNaN(tA) ? tB : isNaN(tB) ? tA : tA + (tB - tA) * f, bt = S.bot ? (isNaN(S.bot[i]) ? tp : S.bot[i]) : S.h;
      for(let y = Math.floor(y0 + tp * rh); y < SEA && y <= y0 + bt * rh + 1; y++){ const r = (y + .5 - y0) / rh; if(r < tp) continue;
        const e = (r - tp) * rh, back = r / S.h;
        let b = e < 1.4 ? .6 : S.bot ? (.16 + .16 * (1 - (r - tp) / Math.max(.5, bt - tp))) : (.12 + .2 * back);       /* outline, then a darker back over a paler flank */
        if(S.bot && (bt - r) * rh < 1.2) b = .5;
        if(S.eye && Math.hypot(k - S.eye[0], (r - S.eye[1]) * 2) < .7) b = .04;
        L.put(c, y, b, 0); } }
    return y0; }
  return tm => {
    const t = tm * .3 * sp, u = (((tm - 14) * .3 * sp + 1.5) % LOOP + LOOP) % LOOP; L.clear(); PL.clear();
    /* the sea: a calm surface with the odd crest, faint swells beneath it */
    for(let c = 0; c < cols; c++){ const x = c / sc, h = Math.sin(x * .61 - t * 1.4) + .7 * Math.sin(x * .27 + t * .8) * chop;
      L.put(c, SEA, h > 1.2 ? .42 : (c & 1 ? .26 : .18), 0);
      for(const [dr, k] of [[2, .6], [4, -.4], [6.5, .3]]){ const v = Math.sin(x * .45 + t * k * 2 + dr) * Math.sin(x * .06 - t * k * .3 + dr); if(v > .6) L.put(c, SEA + dr * rh * .55, .16 + .1 * (v - .6) / .4, 0); } }
    const hx = X0 - SWIM * Math.min(u, DIVE);
    const top = stamp(SH.surf, hx - 2, depth(u, UP.surf)), arch = depth(u, UP.arch);
    stamp(SH.arch, hx - 2 + FIN, arch);
    if(arch < .7){ const low = SH.arch.h - 1 - Math.round(arch * SH.arch.h), lip = hx - 2 + FIN + WHALE_ART.arch[Math.max(0, low)].search(/\S/);   /* white water off the head */
      for(let j = 0; j < 10; j++){ const q = (u * 1.4 + hash2(j, 3)) % 1, a = hash2(j, 4); PL.put((lip - 1 - q * (1 + 2 * a)) * sc, SEA - (.6 + 1.6 * a) * Math.sin(Math.PI * q) * rh, .62 - .2 * q, 0); } }
    if(u > BLOW && u < BLOW + 3){ const s = u - BLOW, bc = (hx - 2 + HOLE), from = X0 - SWIM * BLOW - 2 + HOLE;   /* the blow */
      const tp = 6.6 * Math.sqrt(Math.min(1, s / .5)), cut = s < .8 ? 0 : (s - .8) * 7, hw = 1 + 3.6 * Math.min(1, s / .8) + 2.4 * Math.max(0, s - .8);
      const hh = 1 + .6 * Math.min(1, s / .8) + .5 * Math.max(0, s - .8), hy0 = tp - .6 - .5 * Math.max(0, s - 1), amp = Math.min(1, s / .2) * (s < 1 ? 1 : Math.exp(-(s - 1) / 1.2)), drift = WIND * s;
      for(let y = Math.floor(top - 10 * rh); y < top; y++){ const yy = (top - y) / rh, lean = Math.min(1, yy / Math.max(1, tp)), mid = bc + (from - bc) * lean + drift * lean * lean;
        for(let c = Math.floor((mid - 12) * sc); c <= (mid + 12) * sc; c++){ const dx = c / sc - mid, dy = (yy - hy0) / hh;
          let d = yy > cut && yy <= tp ? Math.exp(-((dx / (.3 + .17 * yy)) ** 2)) : 0; d = Math.max(d, amp * Math.exp(-((dx / hw) ** 2) - dy * dy)); d *= .85 + .3 * hash2(c * 31 + y, 5);
          if(d > .18) L.put(c, y, Math.min(.66, .1 + .55 * d), 0); } } }
    const sink = depth(u, UP.fluke), fx = FLUKE_X - 16; stamp(SH.fluke, fx, sink);
    if(sink < 1 && u > UP.fluke[1] - .2){ const ft = SEA - (SH.fluke.h - sink * SH.fluke.h) * rh;   /* water streaming off the fluke */
      DRIP.forEach((dx, j) => { const row = isNaN(SH.fluke.bot[dx]) ? 3 : SH.fluke.bot[dx]; for(const lag of [0, .33, .66]){ const q = (u * 1.6 + hash2(j, 9) + lag) % 1, y0 = ft + (row + .5) * rh; PL.put((fx + dx) * sc, y0 + q * q * (SEA - y0), .55 - .2 * q, 0); } }); }
    const gone = UP.fluke[3] - .2; if(u > gone && u < gone + 1.6){ const w = 4 + 5 * (u - gone), fade = (u - gone) / 1.6;      /* the smooth patch where it went down */
      for(let c = Math.floor((FLUKE_X - w) * sc); c <= (FLUKE_X + w) * sc; c++) if(hash2(c + 40, Math.floor(u * 4)) > fade) L.put(c, SEA, .4, 0); }
    for(let n = 0; n < GN; n++){ const q = glints[n], z = 1 + q.d * 5, y = SEA + (rows - SEA) * (.12 + .88 * (1 - q.d)), b = Math.pow(Math.max(0, Math.sin(tm * q.r + q.ph)), 6) * (.95 - .3 * q.d);
      if(b > .5) PL.put(((q.px + tm * .004 / z) % 1) * cols, y, b, q.cx ? 1 : 0); }
    L.draw(ax, .9, false, 'sh'); PL.draw(ax, 1, true, 'sq');
  };
}

/* 13 starlings.
   Adapted from ascii.rest piece 'starlings' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: the flocking rule (align, cohere, separate on a spatial grid), the slow wandering target that wheels the cloud, the oval
   of open sky birds turn back from instead of braking, and the falcon that cuts through and scatters it. Fixed-step simulation from the date seed;
   a backwards or long jump in time re-warms it, so a frame is still a function of time. Played at 0.45x. Birds = tokens, each bird's colour =
   split, the cell brightens as birds crowd in (ink of the source's crowd ramp); wheel radius = trend; steering noise = cache miss. */
function tFlock(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, L = new Layer(cols, rows);
  const N = Math.max(60, Math.round(D.nPart * .45 * (phone ? .5 : 1))), DT = 1 / 30, WARM = 150, PASS = 420, FIRST = WARM + 120;
  const y0 = rows * .38, hh = rows * .58, H = 19.2, W = H * cols / hh, R = 1.6, SEP = .85, LOOK = .6, TURN = 90, FLEE = 4.2, MX = 1.5, MY = 1.2;
  const GX = Math.ceil(W / R), GY = Math.ceil(H / R), wheel = .08 + .1 * D.trendK, noiseA = D.jitter * 4;
  const x = new Float64Array(N), y = new Float64Array(N), vx = new Float64Array(N), vy = new Float64Array(N), col = new Uint8Array(N), head = new Int32Array(GX * GY), next = new Int32Array(N);
  const osc = (t, q) => { const v = 1 - Math.abs(2 * (t / q - Math.floor(t / q)) - 1); return 2 * v * v * (3 - 2 * v) - 1; };
  let k = 0, fx = NaN, fy = 0, fd = -1, rr = null, tBase = 0;
  const den = new Float32Array(cols * rows), amb = new Float32Array(cols * rows), ink = INK(" .':;+*%#"), RAMP = " .:;+*%%##";
  function reset(){ rr = mulberry(mix(p.seed + 26)); k = 0; fx = NaN; fy = 0; fd = -1;
    for(let i = 0; i < N; i++){ x[i] = W * (.3 + .3 * rr()); y[i] = H * (.3 + .4 * rr()); vx[i] = 6 + 2 * rr(); vy[i] = 2 * rr() - 1; col[i] = hash2(p.seed, i) > D.share ? 1 : 0; }
    while(k < WARM) step(); }
  function step(){
    const t = k * DT, ph = (k - FIRST + PASS * 9) % PASS, hunting = k++ >= FIRST && ph < 110;
    const tx = W * (.5 + wheel * 2.2 * osc(t, 37)), ty = H * (.5 + wheel * osc(t + 4, 11)); let cy = 0;
    for(let i = 0; i < N; i++) cy += y[i] / N;
    if(hunting && ph === 0){ fd = -fd; fx = fd < 0 ? -2 : W + 2; fy = cy; }
    fx = hunting ? fx + fd * 20 * DT * Math.max(1, W / 60) * .7 : NaN; if(hunting) fy += (cy - fy) * 3 * DT;
    head.fill(-1);
    for(let i = 0; i < N; i++){ const c = Math.min(GY - 1, Math.max(0, Math.floor(y[i] / R))) * GX + Math.min(GX - 1, Math.max(0, Math.floor(x[i] / R))); next[i] = head[c]; head[c] = i; }
    for(let i = 0; i < N; i++){
      const gx0 = Math.floor(x[i] / R), gy0 = Math.floor(y[i] / R); let n = 0, sx = 0, sy = 0, svx = 0, svy = 0, px = 0, py = 0;
      for(let gy = Math.max(0, gy0 - 1); gy <= Math.min(GY - 1, gy0 + 1); gy++) for(let gx = Math.max(0, gx0 - 1); gx <= Math.min(GX - 1, gx0 + 1); gx++)
        for(let j = head[gy * GX + gx]; j >= 0; j = next[j]){ const dx = x[j] - x[i], dy = y[j] - y[i], d2 = dx * dx + dy * dy; if(j === i || d2 > R * R) continue;
          n++; sx += dx; sy += dy; svx += vx[j]; svy += vy[j]; if(d2 < SEP * SEP){ px -= dx / (d2 + .02); py -= dy / (d2 + .02); } }
      let ax_ = (tx - x[i]) * .25, ay_ = (ty - y[i]) * .5;
      if(n){ ax_ += (svx / n - vx[i]) * 3 + sx / n * .5 + px * 4; ay_ += (svy / n - vy[i]) * 3 + sy / n * .5 + py * 4; }
      if(noiseA){ ax_ += (rr() - .5) * noiseA * 6; ay_ += (rr() - .5) * noiseA * 6; }
      const lx = (x[i] + vx[i] * LOOK - W / 2) / (W / 2 - MX), ly = (y[i] + vy[i] * LOOK - H / 2) / (H / 2 - MY), out = Math.hypot(lx, ly) - .6;
      if(out > 0){ const s = Math.hypot(vx[i], vy[i]), side = vx[i] * (H / 2 - y[i]) - vy[i] * (W / 2 - x[i]) > 0 ? 1 : -1; ax_ += -vy[i] / s * side * TURN * out; ay_ += vx[i] / s * side * TURN * out; }
      let top = 10; const dx = x[i] - fx, dy = y[i] - fy, d2 = dx * dx + dy * dy;
      if(d2 < FLEE * FLEE){ ax_ += dx / (d2 + .4) * 90; ay_ += dy / (d2 + .4) * 90; top = 15; }
      const ux = vx[i] + ax_ * DT, uy = vy[i] + ay_ * DT, s = Math.sqrt(ux * ux + uy * uy), m = s > top ? top / s : s < 5 ? 5 / s : 1; vx[i] = ux * m; vy[i] = uy * m; }
    for(let i = 0; i < N; i++){ x[i] += vx[i] * DT; y[i] += vy[i] * DT; } }
  return tm => {
    /* bounded work per frame: a reset (first frame, time going backwards, or a jump of more than ~8 s, e.g. a hidden tab) re-warms and replays at
       most 4 s, so ?t= frames stay deterministic; otherwise at most 12 steps a frame, catching up over a few frames like the source */
    let want = WARM + Math.floor(Math.max(0, tm - tBase) * .45 * sp / DT + 1e-6);
    if(rr === null || want < k || want - k > 240){ tBase = Math.max(0, tm - 4); reset(); want = WARM + Math.floor((tm - tBase) * .45 * sp / DT + 1e-6); while(k < want) step(); }
    for(let s = 0; s < 12 && k < want; s++) step();
    /* each bird splats into a small cross, so the flock reads as a cloud whose crowded parts are heavier (the source's crowd ramp, by ink) */
    L.clear(); den.fill(0); amb.fill(0); const sx = cols / W, sy = hh / H, SPL = [[0, 0, 1], [1, 0, .5], [-1, 0, .5], [0, 1, .5], [0, -1, .5]];
    for(let i = 0; i < N; i++){ const c = Math.floor(x[i] * sx), r = Math.floor(y0 + y[i] * sy);
      for(const [dc, dr, w] of SPL){ const cc = c + dc, r_ = r + dr; if(cc < 0 || cc >= cols || r_ < 0 || r_ >= rows) continue; const kk = cc * rows + r_; den[kk] += w; if(col[i]) amb[kk] += w; } }
    for(let kk = 0; kk < den.length; kk++){ const n = den[kk]; if(n < .5) continue;
      L.gb[kk] = .12 + .32 * ink[RAMP[Math.min(9, Math.round(n * 1.6))]]; L.gc[kk] = hash2(kk, p.seed) < amb[kk] / n ? 1 : 0; }
    if(fx === fx){ const c = fx * sx, r = y0 + fy * sy, wing = (k >> 3) & 1 ? 1 : 0;           /* the falcon, beating its wings */
      L.put(c, r, .95, 0); L.put(c - 1, r - wing, .72, 0); L.put(c + 1, r - wing, .72, 0); L.put(c - 2, r - 1 + wing, .55, 0); L.put(c + 2, r - 1 + wing, .55, 0); }
    L.draw(ax, .85, true, 'dot');
  };
}

/* 14 fireflies.
   Adapted from ascii.rest piece 'fireflies' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: flies wandering on three slow waves over a meadow, each flashing on its own beat (quick rise, slow fade), a sweep that
   starts at the fly furthest to one side every few seconds and runs fly to fly across the meadow, the faint trail where a fly was brighter a
   moment ago, a halo that stays above the grass, tufts of blades fanning from one root, a far treeline and a crescent moon.
   Flies = tokens, each fly's colour = split; beat length = trend; wander amplitude = cache miss. */
function tFly(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, SL = new Layer(cols, rows), GL = new Layer(cols, rows), L = new Layer(cols, rows), sky = offscreen(env), grass = offscreen(env);
  const S = mulberry(mix(p.seed + 14)), GROUND = rows - 2, HOR = rows * (phone ? .52 : .6), sc = cols / 60, WAVE = 16 / sp, SPEED = 9 * sc * sp, beat = 1 - .35 * D.trendK, wan = 1 + D.jitter * .6;
  /* sky, built once: stars, the far treeline as rounded crowns, the moon */
  { SL.clear(); const ridge = c => HOR - rows * (.03 + .05 * Math.max(0, Math.sin(c * .05 + p.off * 3)) ** 2 + .03 * noise(c * .09, 3) + .025 * Math.max(0, Math.sin(c * .31 + 1.3 * p.tilt)) ** 4);
    for(let c = 0; c < cols; c++){ const r = ridge(c); for(let y = Math.floor(r); y < HOR + 2; y++) SL.put(c, y, y < r + 1 ? .2 : .07 * (1 - (y - r) / (HOR + 2 - r)), 0); }
    for(let i = 0; i < 60; i++){ const c = S() * cols, y = S() * (HOR - rows * .1); SL.put(c, y, .12 + .2 * S() * S(), 0); }
    const mx = cols * (phone ? .8 : .935), my = rows * (phone ? .3 : .42), mr = rows * .06;
    for(let c = -mr; c <= mr; c++) for(let y = -mr; y <= mr; y++){ const a = Math.hypot(c, y) / mr, b_ = Math.hypot(c - mr * .45, y + mr * .2) / mr; if(a < 1 && b_ > .92) SL.put(mx + c, my + y, .32 + .26 * (1 - a), 0); }
    SL.draw(sky.begin(), .9, false, 'dot'); }
  const blades = [], FANS = [[-1, 0, 1], [-1, 0, 1], [0, 1], [-1, 0], [-1, 1]];
  for(let x = 2 + S() * 3; x < cols - 2; x += (4 + S() * 7) * sc * .55){ const h = rows * (.05 + .07 * S()), c = Math.floor(x), ph = x * .05;
    for(const lean of FANS[Math.floor(S() * FANS.length)]) blades.push({c, h: lean ? h * (.6 + .3 * S()) : h, lean: lean * .5, ph}); }
  const NF = Math.round(D.nPart * .11 * (phone ? .5 : 1)), flies = Array.from({length: NF}, () => ({x: 3 + X.rnd() * (cols - 6), y: HOR + (GROUND - HOR) * (.15 + .7 * X.rnd()),
    w: [.05 + X.rnd() * .08, .11 + X.rnd() * .1, .07 + X.rnd() * .08], p: [X.rnd() * TAU, X.rnd() * TAU, X.rnd() * TAU], cx: X.rnd() > D.share}));
  const place = (f, s, o) => { o[0] = f.x + 6 * sc * wan * Math.sin(f.w[0] * s + f.p[0]) + 2.5 * sc * Math.sin(f.w[1] * s + f.p[1]); o[1] = f.y + 1.4 * sc * wan * Math.sin(f.w[2] * s + f.p[2]) + .6 * sc * Math.sin(f.w[1] * 1.7 * s + f.p[0]); };
  const glow = ph => ph < .04 ? ph / .04 : Math.exp(-(ph - .04) / .13), hits = new Map(), o = [0, 0];
  const sweep = w => { if(hits.has(w)) return hits.get(w); const at = flies.map(f => { place(f, w * WAVE, o); return [o[0], o[1]]; });
    const or = at.reduce((b, q) => ((w & 1 ? q[0] > b[0] : q[0] < b[0]) ? q : b));
    const out = at.map(([x_, y_], i) => ({t: w * WAVE + Math.hypot(x_ - or[0], 2 * (y_ - or[1])) / SPEED, rate: 1 / ((5 + 3.5 * hash2(p.seed + i, w)) * beat / sp)}));
    hits.set(w, out); if(hits.size > 6) hits.delete(hits.keys().next().value); return out; };
  const bright = (i, s) => { const w = Math.floor(s / WAVE); let h = sweep(w)[i]; if(s < h.t) h = sweep(w - 1)[i]; const ph = (s - h.t) * h.rate; return ph < 0 ? 0 : glow(ph - Math.floor(ph)); };
  const HALO = [[0, 0, 1], [-1, 0, .42], [1, 0, .42], [0, -1, .42], [0, 1, .42], [-1, -1, .22], [1, -1, .22], [-1, 1, .22], [1, 1, .22]];
  const tick = ticker(.15, tm => { GL.clear(); const s = tm * sp;
    for(const b of blades){ const sw = .6 * sc * Math.sin(s * .5 - b.ph), n = Math.ceil(b.h);
      for(let k = 1; k <= n; k++){ const f = k / n; GL.put(b.c + .5 + b.lean * k + sw * f * f, GROUND - k, .14 + .12 * f, 0); } }
    for(let c = 0; c < cols; c += 2) GL.put(c, GROUND, .16, 0);
    GL.draw(grass.begin(), .9, false, 'dot'); });
  return tm => {
    tick(tm); sky.blit(); L.clear(); const s = WAVE * 3 + 2.4 + tm * .8;
    flies.forEach((f, i) => { const v = bright(i, s), c = f.cx ? 1 : 0;
      if(v > .05){ place(f, s, o); for(const [dc, dr, k] of HALO){ const yy = o[1] + dr; if(yy < GROUND - 1) L.put(o[0] + dc, yy, (.18 + .8 * v) * k * (v > .3 ? 1 : .8), c); } }
      for(let j = 1; j <= 4; j++){ const old = bright(i, s - j * .3); if(old > v && old > .2){ place(f, s - j * .3, o); L.put(o[0], o[1], .25 + .25 * old, c); } } });
    grass.blit(); L.draw(ax, 1, true, 'dot');
  };
}
/* 15 snowfall.
   Adapted from ascii.rest piece 'snowfall' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: snow in three depths (far flakes small and slow, near ones larger, faster, swaying more) on a light wind, a rolling
   snow bed swept into a long drift in the fence's lee, and a fence whose rails carry a ridge of snow and whose posts wear caps. The source lets
   flakes settle and grow the drifts step by step; here the flakes wrap and the drift is fixed, so a frame stays a pure function of time.
   Flakes = tokens, each flake's colour = split; wind = trend; sway (gustiness) = cache miss. */
function tSnow(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, SL = new Layer(cols, rows), L = new Layer(cols, rows), off = offscreen(env);
  const S = mulberry(mix(p.seed + 15)), u = rows / 22;                                         /* cells per source row */
  const LAY = [{v: 1.1, sway: .5, b: .52, f: .5}, {v: 1.8, sway: 1, b: .7, f: .35}, {v: 2.8, sway: 1.6, b: .86, f: .15}];
  const wind = (.35 + .9 * D.trendK) * u, gust = 1 + D.jitter * .5, slow = .42 * sp;
  const f0 = cols * (phone ? .3 : .5 + .08 * p.off), POSTS = [0, 1, 2, 3].map(i => f0 + i * cols * (phone ? .18 : .1)), TOP = rows - 6.6 * u, RAILS = [rows - 6 * u, rows - 4.2 * u];
  const lee = POSTS[3] + cols * .03, ground = new Float32Array(cols);
  for(let c = 0; c < cols; c++){ const x = c / u; ground[c] = (1.1 + .55 * Math.sin(x * .19 + 1.3 + p.tilt) + .3 * Math.sin(x * .47 + .4) + 3.2 * sstep(lee - 20 * u, lee, c) * (1 - sstep(lee, lee + 4 * u, c))) * u * .9; }
  { SL.clear();                                                                                 /* static: the snow bed, the fence, its snow */
    for(let c = 0; c < cols; c++){ const s = rows - ground[c];
      for(let y = Math.floor(s); y < rows; y++){ const d = y - s; SL.put(c, y, d < 1 ? .44 : (.1 + .14 * Math.exp(-d / (u * 1.5))) * (.85 + .3 * hash2(c, y)), 0); } }
    POSTS.forEach((c, i) => { for(let y = TOP; y < rows - ground[Math.round(c)] + 1; y++) SL.put(c, y, .26, 0);
      const cap = 1 + 1.5 * hash2(i, p.seed); for(let k = -1; k <= 1; k++) for(let y = 0; y < cap * u * .5; y++) SL.put(c + k, TOP - 1 - y, k ? .3 : .42, 0); });
    RAILS.forEach((r, k) => { for(let c = Math.ceil(POSTS[0]) + 1; c < POSTS[3]; c++){ if(POSTS.some(q => Math.abs(q - c) < 1)) continue;
      SL.put(c, r, .2, 0); const ridge = (.5 + .35 * Math.sin(c * .2 + k * 2) + .3 * hash2(c, k)) * u * .6; for(let y = 1; y <= ridge; y++) SL.put(c, r - y, y > ridge - 1 ? .4 : .3, 0); } });
    SL.draw(off.begin(), .9, false, 'dot'); }
  const NF = Math.round(D.nPart * .42), flakes = [];
  LAY.forEach((Lr, li) => { const n = Math.round(NF * Lr.f); for(let i = 0; i < n; i++) flakes.push({li, x: X.rnd() * cols, y: X.rnd(), ph: X.rnd() * TAU, w: .8 + X.rnd() * .45, cx: X.rnd() > D.share}); });
  const FN = phone ? flakes.filter((_, i) => i % 2 === 0) : flakes, span = rows * 1.05;
  return tm => {
    off.blit(); L.clear(); const t = tm * slow;
    for(const f of FN){ const Lr = LAY[f.li], y = ((f.y * span + Lr.v * f.w * u * t) % span) - rows * .05;
      const x = ((f.x + wind * (1 + f.li * .6) * t + Lr.sway * gust * u * Math.sin(t * f.w * 1.3 + f.ph) / (f.w * 1.3)) % cols + cols) % cols;
      if(y < 0 || y > rows - ground[x | 0] - .5) continue;                                       /* gone into the bed until it wraps */
      L.put(x, y, Lr.b * (.85 + .15 * Math.sin(tm * .6 + f.ph)), f.cx ? 1 : 0); if(f.li === 2) L.put(x + 1, y, Lr.b * .5, f.cx ? 1 : 0); }
    L.draw(ax, 1, true, 'dot');
  };
}

/* 16 sea swell.
   Adapted from ascii.rest piece 'sea-swell' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: a long trochoidal swell seen side on with its crest sheared forward, a second train running against it so crest heights
   rise and fall, the far horizon that only shows over the near trough, flecks under the surface that ride the swell less the deeper they lie,
   and a small sailboat that surges with the water and pitches to the slope under its hull. Swell height = trend; the counter-train = cache
   miss; flecks = tokens (their glyph ink sets brightness), each fleck's colour = split; the masthead lamp is the one warm point. */
function tSwell(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, L = new Layer(cols, rows), PL = new Layer(cols, rows);
  const sc = cols / 64, rv = rows * (phone ? .038 : .04), MEAN = rows * (phone ? .66 : .72), HOR = MEAN - 2.6 * rv;
  const WAVES = [[64, .0625 * .62 * sp, 2.6 + 2.4 * D.trendK, .5], [32, -.0625 * .62 * sp, .5 + D.jitter * .9, .3]], LEAN = 2, K = TAU / 32;
  const troch = (v_, q) => { let v = v_; for(let i = 0; i < 4; i++) v = v_ + q / TAU * Math.sin(TAU * v); return .5 * Math.cos(TAU * v); };
  const surface = (x, t) => { const [l, v, a, q] = WAVES[0]; let h = troch(x / l - t * v, q); for(let i = 0; i < 3; i++) h = troch((x - LEAN * (h + .5)) / l - t * v, q);
    let y = -a * h; const [l2, v2, a2, q2] = WAVES[1]; y -= a2 * troch(x / l2 - t * v2, q2); return MEAN + y * rv; };   /* x in source columns, returns a screen row */
  const ink = INK('~-·'), fl = [];
  for(let d = 1.5; d < 14; d += .5){ const g = d < 3 ? '~' : d < 6 ? '-' : '·', gap = (3 + d * 2) * .9, run = d < 3 ? 3 : d < 6 ? 2 : 1;
    for(let i = X.rnd() * gap; i < 64; i += gap * (.6 + X.rnd())){ const n = 1 + Math.floor(X.rnd() * run * 2); for(let k = 0; k < n; k++) fl.push({x: i + k / sc, d, g, cx: X.rnd() > D.share, ph: X.rnd() * TAU}); } }
  while(fl.length > D.nPart * .5) fl.splice((X.rnd() * fl.length) | 0, 1);
  const FN = phone ? fl.filter((_, i) => i % 2 === 0) : fl, sy = new Float32Array(cols + 1);
  const BX = 64 * (phone ? .42 : .3 + .08 * p.off), HULL = phone ? 9 : 7;                       /* boat: left end and hull length, in source columns */
  return tm => {
    const t = tm + 2.5; L.clear(); PL.clear();
    for(let c = 0; c <= cols; c++) sy[c] = surface(c / sc, t);
    for(let c = 0; c < cols; c++){ if(HOR < Math.min(sy[Math.max(0, c - 3)], sy[Math.min(cols, c + 4)]) - .9 * rv) L.put(c, HOR, c % 3 ? .2 : .28, 0); }   /* horizon over the trough only */
    for(let c = 0; c < cols; c++){ const a = sy[c], b = sy[c + 1], lo = Math.min(a, b), hi = Math.max(a, b), crest = clamp01((MEAN - (a + b) / 2) / (rv * 2.4));
      for(let y = Math.floor(lo); y <= Math.max(Math.floor(lo), Math.floor(hi)); y++) L.put(c, y, .3 + .34 * crest, 0);
      for(let y = Math.floor(hi) + 1; y < hi + 6 && y < rows; y++) L.put(c, y, .06 * (1 - (y - hi) / 6), 0); }                 /* a little body under the line */
    for(const f of FN){ const c = Math.min(cols - 1, Math.max(0, Math.round(f.x * sc))), y0 = (sy[c] + sy[c + 1]) / 2, y = MEAN + (y0 - MEAN) * Math.exp(-K * f.d) + f.d * rv * .62;
      if(y <= y0 + 1 || y >= rows) continue; const b = (.3 + .62 * ink[f.g]) * (1 - .35 * f.d / 14) * (.75 + .25 * Math.sin(tm * .4 + f.ph));
      if(b > .5) PL.put(c, y, b, f.cx ? 1 : 0); else L.put(c, y, b, f.cx ? 1 : 0); }
    /* the boat: surges with the swell, pitches to the slope along the hull */
    const [l, v] = WAVES[0], c0 = BX - 1.5 * Math.sin(TAU * ((BX + HULL / 2) / l - t * v)), ya = surface(c0 + 1, t), yb = surface(c0 + HULL - 1, t);
    const ang = Math.atan2(yb - ya, (HULL - 2) * sc), ca = Math.cos(ang), sa = Math.sin(ang), mx = (c0 + HULL / 2) * sc, my = surface(c0 + HULL / 2, t) - 1;
    const P = (u, w) => [mx + u * ca - w * sa, my + u * sa + w * ca], hl = HULL * sc / 2, mh = rv * 3.3;
    for(let u = -hl; u <= hl; u += .5){ const k = Math.abs(u) / hl, d = 1.6 * (1 - k * k) + .3; for(let w = 0; w <= d; w += .5){ const [x, y] = P(u, -w + .3); L.put(x, y, w < .6 ? .44 : .24, 0); } }   /* hull */
    for(let w = 1; w <= mh; w += .5){ const [x, y] = P(-hl * .25, -w); L.put(x, y, .36, 0); }                                                                   /* mast */
    for(let w = 1.4; w <= mh; w += .5){ const span = (w - 1.4) / (mh - 1.4), wd = hl * .9 * (1 - span); for(let u = .5; u <= wd; u += .5){ const [x, y] = P(-hl * .25 + u, -w); L.put(x, y, .2 + .18 * (1 - u / Math.max(1, wd)), 0); } }   /* sail */
    const [lx, ly] = P(-hl * .25, -mh - .8); PL.put(lx, ly, .92 + .06 * Math.sin(tm * 1.1), 1);
    L.draw(ax, .9, false, 'br'); PL.draw(ax, 1, true, 'br');
  };
}

/* 17 pond rain.
   Adapted from ascii.rest piece 'pond-ripples' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: drops land at hashed times and places inside an oval bank, each a splash, then a ring with a fainter one following it
   in; a ring is drawn whole while strong and in spaced dashes as it weakens, it fades before it reaches the bank, and where two strong rings
   cross they peak. Here the pond is seen at a low angle (rings flatten into ellipses) and every clock runs slower. Drops = tokens (rate), each
   drop's colour = split; ring speed = trend; ring wobble = cache miss. Unlike 04 (a continuous wave field in perspective) this is sparse lines. */
function tPond(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, L = new Layer(cols, rows), own = new Int16Array(cols * rows), off = offscreen(env), BL = new Layer(cols, rows);
  const CX = cols * (.5 + .06 * p.off), CY = rows * (phone ? .72 : .75), AX = cols * (phone ? .48 : .47), SQ = phone ? .5 : .3, AY = AX * SQ > rows * .22 ? rows * .22 : AX * SQ, sq = AY / AX;
  const EVERY = Math.max(.6, Math.min(4, 60 / (D.nPart / 22))) / sp * (phone ? 1.6 : 1), LIFE = 10 / sp, SPEED = cols * (.022 + .016 * D.trendK) * sp, WAVE = cols * .018, wob = D.jitter * .6;
  const open = (x, y) => easeS((1 - ((x - CX) / AX) ** 2 - ((y - CY) / AY) ** 2) / .35);
  { BL.clear(); for(let i = 0; i < 1400; i++){ const a = i / 1400 * TAU, x = CX + AX * Math.cos(a), y = CY + AY * Math.sin(a); BL.put(x, y, (i % 3 ? .12 : .18) * (Math.sin(a) > 0 ? 1 : .6), 0); }
    for(let i = 0; i < 70; i++){ const a = hash2(i, 1) * TAU, r = 1.02 + .08 * hash2(i, 2), x = CX + AX * r * Math.cos(a), y = CY + AY * r * Math.sin(a); if(Math.sin(a) < 0) continue; for(let k = 0; k < 2 + hash2(i, 3) * 4; k++) BL.put(x + k * .3, y - k, .1, 0); }   /* a few reeds on the near bank */
    BL.draw(off.begin(), .9, false, 'br'); }
  const kindOf = a => { const s = Math.abs(Math.sin(a)); return s > .7 ? 0 : s < .3 ? 1 : (Math.sin(a) * Math.cos(a) > 0 ? 2 : 3); };
  return tm => {
    off.blit(); L.clear(); own.fill(-1); const t = 7.35 / sp + tm;
    const draw = (x, y, b, who, a) => { x = Math.round(x); y = Math.round(y); if(x < 0 || y < 0 || x >= cols || y >= rows) return; const k = x * rows + y;
      if(b > .4 && L.gb[k] > .4 && own[k] !== who && own[k] >= 0){ L.gb[k] = .9; return; }          /* two strong rings crossing peak */
      if(b > L.gb[k]){ L.gb[k] = b; own[k] = who; L.gc[k] = ((who * .6180339887 + hash2(p.seed, 5)) % 1) > D.share ? 1 : 0; } };   /* low-discrepancy: any run of drops carries the split */
    for(let i = Math.floor((t - LIFE) / EVERY) - 1; i <= Math.floor(t / EVERY) + 1; i++){
      const age = t - (i + .7 * (hash2(i, 0) - .5)) * EVERY; if(age < 0 || age > LIFE) continue;
      const r = .62 * Math.sqrt(hash2(i, 1)), ph = TAU * hash2(i, 2), dx = CX + AX * r * Math.cos(ph), dy = CY + AY * r * Math.sin(ph), who = i & 0x3fff;
      const life = (.8 + .2 * hash2(i, 3)) * (1 - age / LIFE);
      if(age < .25){ draw(dx, dy, .95, who); continue; }
      if(age < .6){ draw(dx - 1, dy, .7, who); draw(dx + 1, dy, .7, who); continue; }
      const R = 2 + SPEED * age, n = Math.ceil(TAU * R / .8);
      for(let j = 0; j < n; j++){ const a = j / n * TAU, rr = R * (1 + wob * .04 * Math.sin(a * 5 + i)), x = dx + rr * Math.cos(a), y = dy + rr * sq * Math.sin(a), near = open(x, y);
        if(life > .45 && near > .6) draw(x, y, .3 + .32 * life * (kindOf(a) === 0 ? 1 : .8), who);
        else if(life > .18 && near > .45 && Math.floor((a * R) / 5) % 2) draw(x, y, .18 + .2 * life, who); }
      const r2 = R - WAVE; if(life > .5 && r2 > 3){ const n2 = Math.ceil(TAU * r2 / 3);
        for(let j = 0; j < n2; j++){ const a = j / n2 * TAU; if(j % 2) draw(dx + r2 * Math.cos(a), dy + r2 * sq * Math.sin(a), .2 * life, who); } } }
    L.draw(ax, 1, true, 'br');
  };
}
/* 18 black hole.
   Adapted from ascii.rest piece 'black-hole' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: rays traced once through Schwarzschild space (u'' = 1.5u^2 - u, RK4, a table over impact parameter), each ray's plane
   and its crossings of the disk plane between the inner and outer edge, a dimmer image seen through the disk, rings of gas as closed noise each
   turning a whole number of times a loop (Kepler), and the Doppler side brighter. Then only the gas turns. Here 2x2 rays per square cell; the
   inner rim is amber out to the radius that holds the Codex share of the disk's light; camera height = trend; gas flicker = cache miss;
   background stars = tokens, their colour = split. */
const BH_TABLE = (() => { let tab = null; return () => { if(tab) return tab; const f = u => 1.5 * u * u - u, D0 = 30, OUT = 9, BMAX = 12, NB = 1500, H = .02; tab = [];
  for(let n = 0; n < NB; n++){ const b = (n + .5) / NB * BMAX; let u = 1 / D0, w = Math.sqrt(1 - (b / D0) ** 2) / b; const us = [u];
    while(u < 1 && (u > 1 / (OUT + 1) || w > 0) && us.length < 400){ const k1 = w, l1 = f(u), k2 = w + H / 2 * l1, l2 = f(u + H / 2 * k1), k3 = w + H / 2 * l2, l3 = f(u + H / 2 * k2), k4 = w + H * l3, l4 = f(u + H * k3);
      u += H / 6 * (k1 + 2 * k2 + 2 * k3 + k4); w += H / 6 * (l1 + 2 * l2 + 2 * l3 + l4); us.push(u); }
    tab.push(Float32Array.from(us)); } return tab; }; })();
function tHole(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, L = new Layer(cols, rows), PL = new Layer(cols, rows), off = offscreen(env);
  const D0 = 30, IN = 3, OUT = 9, SPAN = .34, BANDS = 12, TAB = 256, SPIN = 7, NB = 1500, BMAX = 12, H = .02, LOOP = 150 / sp, GAIN = 1.25, FLOOR = .03;
  const TILT = .1 + .12 * D.trendK, s_ = Math.sin(TILT), c_ = Math.cos(TILT), table = BH_TABLE(), R = mulberry(mix(p.seed + 17));
  const hw = Math.min(cols * (phone ? .36 : .26), rows * .8), cx = cols * (phone ? .5 : .68 + .07 * p.off), cy = rows * (phone ? .68 : .7), tq = SPAN / hw;
  const band = []; for(let b = 0; b < BANDS; b++){ const r = IN + (OUT - IN) * b / (BANDS - 1), turns = Math.max(1, Math.round(SPIN * (IN / r) ** 1.5)), tab = new Float32Array(TAB);
    const wv = [2, 3, 5, 8, 13].map(k => [k, R() * TAU, (.5 + R()) / Math.sqrt(k)]); let lo = 1e9, hi = -1e9;
    for(let i = 0; i < TAB; i++){ for(const [k, ph, a] of wv) tab[i] += a * Math.sin(k * TAU * i / TAB + ph); lo = Math.min(lo, tab[i]); hi = Math.max(hi, tab[i]); }
    for(let i = 0; i < TAB; i++) tab[i] = .45 + .55 * (tab[i] - lo) / (hi - lo); band.push({tab, turns}); }
  /* per cell: crossings as (cell, band, frac, phi, weight, radius) in flat arrays */
  const x0 = Math.max(0, Math.floor(cx - hw * 1.45)), x1 = Math.min(cols, Math.ceil(cx + hw * 1.45)), E = {k: [], b: [], fr: [], phi: [], w: [], r: []}, empty = new Uint8Array(cols * rows).fill(1);
  for(let c = x0; c < x1; c++) for(let y = 0; y < rows; y++) for(let j = 0; j < 2; j++) for(let i = 0; i < 2; i++){
    const xt = (c + (i + .5) / 2 - cx) * tq, yt = (cy - y - (j + .5) / 2) * tq, n = Math.hypot(xt, yt, 1), d0 = xt / n, d1 = (yt * c_ - s_) / n, d2 = (yt * s_ + c_) / n;
    const out = d1 * s_ - d2 * c_, side = Math.sqrt(1 - out * out), e0 = d0 / side, e1 = (d1 - out * s_) / side, e2 = (d2 + out * c_) / side;
    const us = table[Math.min(NB - 1, Math.floor(D0 * side * NB / BMAX))], k = c * rows + y; if(us[us.length - 1] >= 1) empty[k] = 0;
    const end = Math.min((us.length - 1) * H, 5.6); let light = 1;
    for(let a = (Math.atan2(-s_, e1) + TAU) % Math.PI; a < end; a += Math.PI){ const q = a / H, qi = Math.floor(q); if(qi + 1 >= us.length) break;
      const r = 1 / (us[qi] + (us[qi + 1] - us[qi]) * (q - qi)); if(r <= IN || r >= OUT) continue;
      const phi = Math.atan2(Math.sin(a) * e2 - Math.cos(a) * c_, Math.sin(a) * e0), edge = Math.min(1, (r - IN) / .7) * (1 - ((r - IN) / (OUT - IN)) ** 2);
      const pos = (r - IN) / (OUT - IN) * (BANDS - 1), b0 = Math.min(BANDS - 2, Math.floor(pos)); empty[k] = 0;
      E.k.push(k); E.b.push(b0); E.fr.push(pos - b0); E.phi.push(phi); E.w.push(light * edge * (1 - .5 * Math.cos(phi)) * (IN / r) ** 1.5 / 4); E.r.push(r); light *= .45; } }
  /* amber rim: the radius inside which the disk holds (1 - share) of its light */
  const ord = E.r.map((r, i) => i).sort((a, b) => E.r[a] - E.r[b]), totW = E.w.reduce((a, b) => a + b, 0); let acc = 0, rT = IN;
  for(const i of ord){ acc += E.w[i]; if(acc >= (1 - D.share) * totW){ rT = E.r[i]; break; } }
  const NE = E.k.length, ek = Int32Array.from(E.k), eb = Uint8Array.from(E.b), efr = Float32Array.from(E.fr), eph = Float32Array.from(E.phi), ew = Float32Array.from(E.w), eo = Uint8Array.from(E.r.map(r => r < rT ? 1 : 0));
  const sumB = new Float32Array(cols * rows), sumO = new Float32Array(cols * rows), at = (b, a) => { const i = Math.floor(a / TAU * TAB) % TAB; return band[b].tab[i < 0 ? i + TAB : i]; };
  const stars = []; for(let tries = 0; tries < 20000 && stars.length < D.nPart * .25; tries++){ const k = (X.rnd() * cols * rows) | 0, yy = k % rows; if(empty[k] && yy > rows * .15) stars.push({k, ph: X.rnd() * TAU, r: .3 + X.rnd(), cx: X.rnd() > D.share}); }
  const SN = phone ? Math.round(stars.length * .5) : stars.length, fl = D.jitter * .12;
  const tick = ticker(.1, tm => { const turn = TAU * (tm % LOOP) / LOOP; sumB.fill(0); sumO.fill(0); L.clear();
    for(let i = 0; i < NE; i++){ const b = eb[i], g0 = at(b, eph[i] - band[b].turns * turn), g1 = at(b + 1, eph[i] - band[b + 1].turns * turn), v = ew[i] * (g0 + (g1 - g0) * efr[i]) * (1 + fl * Math.sin(tm * 2.3 + eph[i] * 3 + b));
      if(eo[i]) sumO[ek[i]] += v; else sumB[ek[i]] += v; }
    for(let c = x0; c < x1; c++) for(let y = 0; y < rows; y++){ const k = c * rows + y, s = sumB[k] + sumO[k]; if(!s) continue;
      const v = Math.pow(Math.min(1, Math.max(0, s * GAIN - FLOOR) / (1 - FLOOR)), .75); if(v > .02) L.put(c, y, .04 + .5 * v, sumO[k] > sumB[k] ? 1 : 0); }
    L.draw(off.begin(), .9, false, 'dot'); });
  return tm => {
    tick(tm); off.blit(); PL.clear();
    for(let n = 0; n < SN; n++){ const q = stars[n], b = (.5 + .5 * Math.sin(tm * q.r * .7 + q.ph)) * .9; if(b > .5) PL.put((q.k / rows) | 0, q.k % rows, b, q.cx ? 1 : 0); }
    PL.draw(ax, 1, true, 'dot');
  };
}

/* 19 moon.
   Adapted from ascii.rest piece 'moon-phases' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: the near side's maria as tilted ellipses, the young bright craters and Tycho's rays, the light model (mostly
   Lommel-Seeliger, a little Lambert so the ball still reads as round), the earthshine that shows the night side's highlands near new moon,
   and the faint rim on the dark limb. Instead of a month in 24 s, the phase is the real phase on that date and the terminator creeps a few
   degrees an hour. Moon height = trend; star twinkle = cache miss; stars = tokens, their colour = split. */
const MOON_MARIA = [[-.62, .08, .28, .5, .62, 0], [-.3, .45, .27, .21, .7, 0], [-.3, .71, .25, .1, .55, .25], [.14, .79, .22, .085, .5, -.2], [.19, .42, .15, .14, .7, 0], [.38, .12, .21, .16, .7, 0], [.05, .25, .09, .06, .5, 0],
  [-.28, .08, .12, .09, .4, 0], [.75, .3, .1, .14, .72, 0], [.62, -.12, .12, .2, .62, 0], [.42, -.28, .09, .09, .62, 0], [-.2, -.34, .19, .14, .6, 0], [-.52, -.43, .09, .1, .65, 0], [-.88, -.06, .05, .08, .5, 0]];
const MOON_CRATERS = [[-.15, -.72, .09, .4], [-.33, .17, .05, .2], [-.6, .14, .035, .15], [-.75, .38, .03, .3]], MOON_RAYS = [[1.75, .55], [1.3, .4], [2.3, .35], [.4, .3], [3.1, .3], [-.6, .22], [4.1, .2]];
function moonAlbedo(x, y){ const sm = (a, b, v) => easeS((v - a) / (b - a)); let alb = 1;
  for(const [mx, my, rx, ry, k, rot] of MOON_MARIA){ const c = Math.cos(rot), s = Math.sin(rot), dx = x - mx, dy = y - my; alb -= k * (1 - sm(.55, 1, Math.hypot((dx * c + dy * s) / rx, (dy * c - dx * s) / ry))); }
  alb = Math.max(.3, alb); for(const [mx, my, rr, k] of MOON_CRATERS) alb += k * (1 - sm(.3, 1, Math.hypot(x - mx, y - my) / rr));
  const T = MOON_CRATERS[0], dx = x - T[0], dy = y - T[1], d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
  for(const [at, len] of MOON_RAYS){ const o = Math.abs(Math.atan2(Math.sin(a - at), Math.cos(a - at))); if(d > T[2] && d < len && o < 1) alb += .3 * (1 - d / len) * Math.exp(-(((o * d) / .03) ** 2)); }
  return Math.min(1.35, alb); }
function tMoon(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, L = new Layer(cols, rows), PL = new Layer(cols, rows), off = offscreen(env);
  const R = rows * (phone ? .19 : .22), cx = cols * (phone ? .7 : .74 + .08 * p.off), cy = rows * (phone ? .62 : .72 - .08 * D.trendK);
  const age = ((p.ymd ? (dayOf(String(p.ymd).replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3')) - dayOf('2000-01-06') - .26) : 0) % 29.530588 + 29.530588) % 29.530588;   /* days since new moon */
  const ph0 = age / 29.530588 * TAU, SS = 2, cells = [];
  for(let c = Math.floor(cx - R - 1); c <= cx + R + 1; c++) for(let y = Math.floor(cy - R - 1); y <= cy + R + 1; y++){ const smp = [];
    for(let j = 0; j < SS; j++) for(let i = 0; i < SS; i++){ const x = (c + (i + .5) / SS - cx) / R, yy = (cy - y - (j + .5) / SS) / R, d = x * x + yy * yy; if(d < 1) smp.push(x, yy, Math.sqrt(1 - d), moonAlbedo(x, yy)); }
    if(smp.length >= 8){ let g = 0; for(let i = 3; i < smp.length; i += 4) g += smp[i] / (smp.length / 4); const rr = Math.hypot(c + .5 - cx, y + .5 - cy) / R; cells.push({c, y, smp, g, rim: rr > .93}); } }
  const stars = Array.from({length: Math.round(D.nPart * .2)}, () => ({px: X.rnd() * cols, y: X.rnd() * rows * .9, ph: X.rnd() * TAU, r: (.3 + X.rnd()) * (1 + D.jitter), cx: X.rnd() > D.share})).filter(s => Math.hypot(s.px - cx, s.y - cy) > R * 1.15);
  const SN = phone ? Math.round(stars.length * .5) : stars.length;
  const tick = ticker(.5, tm => {
    const ph = ph0 + tm * .0006 * sp, m = Math.hypot(Math.sin(ph), .12, Math.cos(ph)), lx = Math.sin(ph) / m, ly = .12 / m, lz = -Math.cos(ph) / m, es = easeS(Math.cos(ph) / .5);
    L.clear();
    for(const q of cells){ const s = q.smp; let sum = 0; for(let i = 0; i < s.length; i += 4){ const mu0 = s[i] * lx + s[i + 1] * ly + s[i + 2] * lz; if(mu0 > 0) sum += s[i + 3] * (.3 * mu0 + .7 * 2 * mu0 / (mu0 + s[i + 2])); }
      const v = Math.min(1, sum / (s.length / 4)); L.put(q.c, q.y, v < .015 ? (q.rim ? .12 : es * q.g > .72 ? .08 : 0) : .07 + .4 * v, 0); }
    L.draw(off.begin(), .9, false, 'dot'); });
  return tm => {
    tick(tm); off.blit(); PL.clear();
    for(let n = 0; n < SN; n++){ const q = stars[n], b = (.5 + .5 * Math.sin(tm * q.r * .6 + q.ph)) * (.6 + .4 * q.y / rows); if(b > .5) PL.put(q.px, q.y, b, q.cx ? 1 : 0); }
    PL.draw(ax, 1, true, 'dot');
  };
}

/* 20 lantern lake.
   Adapted from ascii.rest piece 'lantern-lake' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: lanterns let go from the far shore by the hundred, about one in six a near, larger one; each has a size that sets its
   climb speed (v = 0.3 + 0.62 s), a climb height and so a flight time, a breeze that leans the plume more the higher it climbs
   (climb * wd + climb^2 * 0.004), a sway, and a new start each lap, clustered round the festival unless it is a wide one; it starts hidden
   behind the shore trees and, unless it sails off the top, gutters, flickers and goes out over its last four seconds. Drawn as a spark below
   1.4 cells, two cells tall below 2.6, a paper lantern above; a few lanterns let go near us rise past from below the frame; shore lights
   flicker; the lake carries the lights as broken strips. Not taken: the boat and figure, the colour sky and halo shading; the ranges and the
   festival's dome are simplified. Units are the source's cells (200 x 100, waterline at row 64) mapped onto the art; played at 0.5x.
   Lanterns = tokens, each one's colour = split; breeze = trend; reflection shimmer = cache miss. */
function tLantern(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, SL = new Layer(cols, rows), L = new Layer(cols, rows), off = offscreen(env);
  const SHORE = rows * (phone ? .68 : .7), FX = cols * (.42 + .12 * p.off), breeze = (.15 + .5 * D.trendK) * (p.tilt >= 0 ? 1 : -1), shim = .5 + D.jitter * .8, S = mulberry(mix(p.seed + 20));
  const ridge = c => { const u = c / cols; return SHORE - rows * (.06 + .16 * Math.max(0, 1 - Math.abs(u - .12 - .05 * p.tilt) / .3) ** 1.6 + .13 * Math.max(0, 1 - Math.abs(u - .9) / .28) ** 1.4 + .025 * noise(c * .05, 9)); };
  const strip = y => hash2(y, 77) < .62;                                                         /* rows of water that carry the reflection */
  { SL.clear();
    for(let c = 0; c < cols; c++){ const r = ridge(c), glow = Math.exp(-(((c - FX) / (cols * .16)) ** 2));
      for(let y = Math.floor(r); y < SHORE; y++){ const e = y - r; SL.put(c, y, e < 1 ? .16 + .1 * glow : (.04 + .1 * glow * Math.exp(-(SHORE - y) / (rows * .05))) * (hash2(c, y) < .7 ? 1 : 0), glow > .6 && e < 1 && hash2(c, 3) > D.share ? 1 : 0); }
      for(let y = Math.floor(SHORE - rows * .2); y < SHORE; y++){ const h = SHORE - y, v = .26 * glow * Math.exp(-h / (rows * .08)); if(v > .05 && hash2(c * 3, y) < .6) SL.put(c, y, v, hash2(c, y * 9) > D.share ? 1 : 0); }   /* the festival's dome, in the air in front of the ranges */
      SL.put(c, SHORE, .1 + .2 * glow, 0);
      for(let y = SHORE + 1; y < rows; y++){ if(!strip(y)) continue; const d = y - SHORE, v = .12 * glow * Math.exp(-d / (rows * .12)); if(v > .04 && hash2(c, y * 5) < .6) SL.put(c, y, v, 0); } }
    SL.draw(off.begin(), .9, false, 'sq'); }
  const g = SHORE * .62 / 64, WL = 64, slow = .5 * sp, sm = (a, b, x) => easeS((x - a) / (b - a)), lean0 = .6 + .9 * D.trendK;
  const SX = x => FX + (x - 100) * cols / 200 * (phone ? 1 : .9), SY = y => SHORE + (y - WL) * g;   /* source cell -> art cell */
  const NL = Math.round(D.nPart * .14 * (phone ? .5 : 1)), nearFrom = Math.round(NL * .82), sh = [];
  for(let i = 0; i < NL; i++){ const near = i >= nearFrom, h = hash2(i + p.seed, 11), s = near ? 1.5 + 1.7 * h ** 1.5 : .45 + .9 * h ** 1.4, v = .3 + .62 * s, out = near && hash2(i, 12) < .7;
    const climb = out ? WL + 3 * s + 4 : 12 + 46 * hash2(i, 13) ** .8;
    sh.push({i, s, v, life: (climb + s + 1) / v, off: hash2(i + p.seed, 14), wd: (.12 + .3 * hash2(i, 15)) * lean0, sw: .25 * s + .2, sf: .3 + .5 * hash2(i, 16), ph: hash2(i, 17) * TAU,
      f1: 2 + 3 * hash2(i, 18), f2: 5 + 4 * hash2(i, 19), out, wide: near || hash2(i, 20) < .08, cx: hash2(i, p.seed) > D.share ? 1 : 0}); }
  sh.sort((a, b) => a.s - b.s);
  const startX = (f, lap) => { const n = f.i * 7 + lap * 131; return f.wide ? 12 + 176 * hash2(n, 23) : 94 + 30 * (hash2(n, 23) + hash2(n, 24) + hash2(n, 25) - 1.5); };
  const close = [[4.4, 30, 40], [5.2, 160, 90], [3.6, 70, 150]].slice(0, phone ? 1 : 3).map(([s, x, y], i) => { const v = .35 + .42 * s, path = 100 + 5 * s, life = path / v * (1.08 + .3 * hash2(i, 41));
    return {i, s, v, x, path, life, off: (100 + 2.5 * s - y) / v / life, wd: s * .05, sw: .35 * s, sf: .2 + .2 * hash2(i, 42), ph: hash2(i, 43) * TAU, cx: i === 1 && D.share < .9 ? 1 : 0}; });
  const lights = Array.from({length: 9}, (_, i) => ({px: 100 + (hash2(i, 61) - .5) * 40, ph: hash2(i, 62) * TAU, cx: hash2(i, 63) > D.share ? 1 : 0}));
  const lantern = (x, y, hs, b, c, refl) => {                                                  /* hs: height in art cells */
    if(hs < 1.4) L.put(x, y, b, c);
    else if(hs < 2.6){ L.put(x, y - 1, b * .72, c); L.put(x, y, b, c); }
    else for(let dy = -1; dy <= 1; dy++) for(let dx = 0; dx <= 1; dx++) L.put(x + dx, y + dy, b * (dy === 1 ? 1 : dy === 0 ? .8 : .62), c);
    if(refl && y < SHORE){ const ry = 2 * SHORE - y; if(ry < rows && strip(ry | 0)) L.put(x + shim * Math.sin(refl * .9 + ry * .7), ry, b * .42, c); } };   /* broken reflection */
  return tm => {
    off.blit(); L.clear(); const t = tm * slow;
    for(const f of sh){ const u = t / f.life + f.off, lap = Math.floor(u), a = (u - lap) * f.life, climb = f.v * a;
      const x = startX(f, lap) + climb * f.wd + climb * climb * .004 * lean0 + f.sw * (Math.sin(a * f.sf + f.ph) - Math.sin(f.ph)), y = WL + f.s * .5 + .6 - climb;
      if(y > WL - 2.2) continue;                                                                   /* still behind the shore trees */
      let I = (.7 + .45 * Math.min(1, f.s)) * (.88 + .08 * Math.sin(t * f.f1 + f.ph) + .04 * Math.sin(t * f.f2)), alpha = 1;
      if(!f.out){ const end = sm(f.life - 4, f.life, a); I *= 1 - .55 * end * (.6 + .4 * Math.sin(a * 11 + f.ph)); alpha = 1 - end; }   /* it gutters and goes */
      const b = Math.min(.95, .66 * I * alpha * (.75 + .25 * Math.min(1.6, f.s))); if(b < .1) continue;
      lantern(SX(x), SY(y), f.s * g * 1.5, b, f.cx, tm); }
    for(const q of lights){ const v = .9 + .15 * Math.sin(t * 3.1 + q.ph) + .1 * Math.sin(t * 7.3 + q.ph * 2); L.put(SX(q.px), SHORE - 1, .52 * v, q.cx); L.put(SX(q.px) + .4 * Math.sin(t + q.ph), SHORE + 2, .22 * v, q.cx); }
    for(const c of close){ const u = t / c.life + c.off, lap = Math.floor(u), a = (u - lap) * c.life; if(lap < 0 || a * c.v > c.path) continue;
      const x0 = lap ? 6 + 188 * hash2(c.i * 17 + lap, 44) : c.x, x = x0 + c.wd * a + c.sw * (Math.sin(a * c.sf + c.ph) - Math.sin(c.ph)), y = 100 + 2.5 * c.s - c.v * a;
      lantern(SX(x), SY(y), 3, .9 + .05 * Math.sin(t * 3.3 + c.ph), c.cx, 0); }
    L.draw(ax, 1, true, 'sq');
  };
}

/* ================= library =================
   id, source piece (ascii.rest slug, credited in the caption), cell style, factory, and the count the caption reports (the particle budget the
   template actually spends). Names and captions live in web/i18n.js under art.name.NN / art.legend.NN / art.enc.NN.
   09 (aurora) from the design library is not shipped: it read as a skyline. */
const TPL = [
  {id: 1, style: 'sq', make: tTerrain, n: () => D.nPart},
  {id: 2, style: 'sh', make: tTorus, n: () => Math.round(D.nPart * .6)},
  {id: 3, style: 'br', make: tFlow, n: () => Math.round(D.nPart * .45)},
  {id: 4, style: 'dot', make: tRipple, n: () => Math.round(D.nPart * .55)},
  {id: 5, style: 'sq', make: tRoad, n: () => Math.max(6, Math.round(D.nPart / 22))},
  {id: 6, style: 'sq', make: tTopo, n: () => Math.round(D.nPart * .3)},
  {id: 7, style: 'dot', make: tPlanet, n: () => Math.round(D.nPart * .3)},
  {id: 8, style: 'br', make: tGalaxy, n: () => Math.round(D.nPart * .7)},
  {id: 10, src: 'jellyfish', style: 'dot', make: tJelly, n: () => Math.round(D.nPart * .3)},
  {id: 11, src: 'aquarium', style: 'dot', make: tFish, n: () => Math.round(D.nPart * .08)},
  {id: 12, src: 'whale', style: 'sh', make: tWhale, n: () => Math.round(D.nPart * .2)},
  {id: 13, src: 'starlings', style: 'dot', make: tFlock, n: () => Math.max(60, Math.round(D.nPart * .45))},
  {id: 14, src: 'fireflies', style: 'dot', make: tFly, n: () => Math.round(D.nPart * .11)},
  {id: 15, src: 'snowfall', style: 'dot', make: tSnow, n: () => Math.round(D.nPart * .42)},
  {id: 16, src: 'sea-swell', style: 'br', make: tSwell, n: () => Math.round(D.nPart * .5)},
  {id: 17, src: 'pond-ripples', style: 'br', make: tPond, n: () => Math.round(D.nPart / 22)},
  {id: 18, src: 'black-hole', style: 'dot', make: tHole, n: () => Math.round(D.nPart * .25)},
  {id: 19, src: 'moon-phases', style: 'dot', make: tMoon, n: () => Math.round(D.nPart * .2)},
  {id: 20, src: 'lantern-lake', style: 'sq', make: tLantern, n: () => Math.round(D.nPart * .14)}
];
const BY_ID = new Map(TPL.map(t => [t.id, t]));
const ENABLED = TPL.map(t => t.id);

/* ---------- rotation: stateless, no two days in a row repeat ----------
   day = UTC day number of the page's local date. Even day: ENABLED[h(day) % N]. Odd day: pick from ENABLED minus both neighbours' (even-day)
   picks. Each pick only reads its neighbours' raw picks, so any date is computed in O(1) with no epoch walk. */
const hDay = d => mix(d * 0x9e3779b1 ^ 0x51ed27);
function pickDay(d){ const L = ENABLED, N = L.length;
  if(N === 1) return L[0]; if(N === 2) return L[((d % 2) + 2) % 2];
  if(d % 2 === 0) return L[hDay(d) % N];
  const a = L[hDay(d - 1) % N], b = L[hDay(d + 1) % N], c = L.filter(x => x !== a && x !== b); return c[hDay(d) % c.length]; }
const dayOf = s => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
const dateOf = n => new Date(n * 864e5).toISOString().slice(0, 10);
function params(day, id){ const ymd = parseInt(dateOf(day).replace(/-/g, ''), 10), S = mulberry(mix(day * 31 + id * 7919));
  return {ymd, seed: mix(ymd), speed: .82 + .36 * S(), off: S() * 2 - 1, tilt: S() * 2 - 1, yaw: S() * TAU}; }

/* ---------- data: raw inputs -> the knobs every template reads ----------
   tok: today's tokens; share: Claude Code share of the Claude Code + Codex requests (0..1); trend: daily totals, oldest first; cache: hit rate.
   Every input may be missing or zero: a flat curve, a neutral trend knob and a calm surface are used instead. */
function smoothSeries(a){ const w = [1, 2, 3, 2, 1], out = a.map((_, i) => { let s = 0, k = 0; w.forEach((wv, j) => { const x = Math.max(0, Math.min(a.length - 1, i + j - 2)); s += a[x] * wv; k += wv; }); return s / k; });
  out[out.length - 1] = a[a.length - 1] * .6 + out[out.length - 1] * .4; return out; }
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const fin = (v, d) => typeof v === 'number' && isFinite(v) ? v : d;
function derive(inp){
  const tok = Math.max(0, fin(inp.tok, 0)), share = clamp01(fin(inp.share, 1));
  let totals = (Array.isArray(inp.trend) ? inp.trend : []).map(v => Math.max(0, fin(v, 0)));
  if(!totals.length) totals = [0];
  if(totals.length < 2) totals = [totals[0], totals[0]];
  const sm = smoothSeries(totals), maxT = Math.max(...sm) || 1, m30 = mean(totals), ratio = m30 > 0 ? mean(totals.slice(-7)) / m30 : 1;
  const cache = clamp01(fin(inp.cache, 1));
  return {tok, nPart: Math.min(2400, Math.round(tok / 1e6 * 22)), share, curve: sm.map(v => v / maxT), curveMean: mean(sm) / maxT,
    trendK: clamp01((ratio - .7) / .8), cache, jitter: (1 - cache) * 4};
}

/* ---------- mount ----------
   create(canvas, inputs, {date: 'YYYY-MM-DD', art: id or null}) -> {id, auto, src, n, ymd, draw(tm), relayout()}.
   draw(tm) is a pure function of tm (static layers are re-rasterised on a slow tick, so one ?t= frame is a real frame). */
function create(cv, inputs, o){
  const ax = cv.getContext && cv.getContext('2d'); if(!ax) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(o.date || '') ? o.date : '2026-01-01', day = dayOf(date), auto = pickDay(day);
  const id = BY_ID.has(o.art) ? o.art : auto, t = BY_ID.get(id), pr = params(day, id), data = derive(inputs);
  D = data; nT = data.curve.length; seedNoise(pr.ymd);
  let env = null, draw = null, broken = false;
  function layout(){ draw = null; const W = cv.clientWidth, H = cv.clientHeight; if(!W || !H) return;
    const dpr = Math.min(devicePixelRatio || 1, 2); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    env = {cv, ax, W, H, dpr, cols: Math.floor(W / P), rows: Math.floor(H / P), P, phone: W < 640};
    D = data; nT = data.curve.length;
    try{ draw = t.make(env, {D: data, p: pr, rnd: mulberry(pr.ymd)}); }catch(e){ broken = true; console.error('art', id, e); } }      /* particles: own stream, so data changes never move the camera */
  return {id, auto, src: t.src || '', n: t.n(), ymd: pr.ymd,
    draw(tm){ if(broken) return; if(!draw) layout(); if(!draw) return;
      ax.setTransform(env.dpr, 0, 0, env.dpr, 0, 0); ax.clearRect(0, 0, env.W, env.H);
      try{ draw(tm); }catch(e){ broken = true; console.error('art', id, e); } },
    relayout(){ draw = null; }};
}
window.GLASSBOX_ART = {ENABLED, create, pick: date => pickDay(dayOf(date))};
})();
