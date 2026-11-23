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
const BLUE = [108, 151, 214], OR = [219, 168, 67], PAL = [BLUE, OR], LV = 9, P = 5, TAU = Math.PI * 2;
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
   sh = shade steps, 2x2 sub-squares (count by level). Draw batches one path per (colour, level).
   A layer may bring its own palette (new Layer(c, r, pal)): entries 0 / 1 are always the two data colours (Claude Code blue, Codex amber) and are kept for
   the elements that carry data; the rest are scenery colours of the piece. A piece may also ask for a finer cell (cell in its library row). */
const BR = [[0, 1], [1, 2], [0, 3], [1, 0], [0, 2], [1, 3], [0, 0], [1, 1]], SH = [[0, 0], [1, 1], [1, 0], [0, 1]];
/* the (colour, level) runs of a layer are found with a counting sort into one index array; layers draw one at a time, so all of them share it */
let LORD = new Int32Array(0), LKEY = new Int16Array(0), LCNT = new Int32Array(0);
class Layer{
  constructor(cols, rows, pal, cell){ this.cols = cols; this.rows = rows; this.pal = pal || PAL; this.P = cell || P; const n = cols * rows; this.gb = new Float32Array(n); this.gc = new Uint8Array(n); }
  clear(){ this.gb.fill(0); }
  /* set: write over whatever is there (b = 0 erases), so a near subject can cover a far one; put keeps the brighter of the two */
  set(x, y, b, c){ x = Math.round(x); y = Math.round(y); if(x < 0 || y < 0 || x >= this.cols || y >= this.rows) return; const k = x * this.rows + y; this.gb[k] = Math.min(1, b); this.gc[k] = c; }
  put(x, y, b, c){ x = Math.round(x); y = Math.round(y); if(x < 0 || y < 0 || x >= this.cols || y >= this.rows) return; const k = x * this.rows + y; if(b > this.gb[k]){ this.gb[k] = Math.min(1, b); this.gc[k] = c; } }
  draw(ax, gain, halo, style){
    const {gb, gc, rows, P} = this, N = gb.length, NK = this.pal.length * LV;
    if(LORD.length < N){ LORD = new Int32Array(N); LKEY = new Int16Array(N); } if(LCNT.length < NK + 1) LCNT = new Int32Array(NK + 1);
    const ord = LORD, kb = LKEY, cnt = LCNT; cnt.fill(0, 0, NK + 1);
    for(let k = 0; k < N; k++){ const a = gb[k]; if(!(a >= .05)){ kb[k] = -1; continue; } const key = gc[k] * LV + Math.min(LV, Math.ceil(a * LV)) - 1; kb[k] = key; cnt[key + 1]++; }
    for(let i = 1; i <= NK; i++) cnt[i] += cnt[i - 1];
    for(let k = 0; k < N; k++){ const key = kb[k]; if(key >= 0) ord[cnt[key]++] = k; }          /* afterwards cnt[key] is where the run of key ends */
    for(let key = 0, i0 = 0; key < NK; key++){
      const i1 = cnt[key], n = i1 - i0; if(!n) continue;
      const col = this.pal[(key / LV) | 0], f = (key % LV + 1) / LV, a = ord.subarray(i0, i1), rgb = `${col[0]},${col[1]},${col[2]}`; i0 = i1;
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
/* 3D subjects: plot shaded surface samples of a model into a small z-buffer (the nearest sample of a cell wins; a translucent sample lets what is
   behind it show through), then stamp the buffer onto a layer, over what is there, with an optional one-cell dark gap around the form.
   z grows toward the viewer. dith() is a 4x4 ordered-dither offset, to break the nine levels into smoother ramps. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], dith = (x, y) => ((BAYER[(x & 3) + ((y & 3) << 2)] + .5) / 16 - .5) / LV;
class Zbuf{
  constructor(cols, rows){ this.cols = cols; this.rows = rows; const n = cols * rows; this.z = new Float32Array(n).fill(-1e9); this.b = new Float32Array(n); this.c = new Uint8Array(n); this.x0 = cols; this.x1 = -1; this.y0 = rows; this.y1 = -1; }
  clear(){ const {rows, z, b} = this; for(let x = this.x0; x <= this.x1; x++){ const o = x * rows; z.fill(-1e9, o + this.y0, o + this.y1 + 1); b.fill(0, o + this.y0, o + this.y1 + 1); } this.x0 = this.cols; this.x1 = -1; this.y0 = rows; this.y1 = -1; }
  pt(x, y, z, b, c, a){ x = Math.round(x); y = Math.round(y); if(x < 0 || y < 0 || x >= this.cols || y >= this.rows) return; const k = x * this.rows + y, old = this.z[k];
    if(x < this.x0) this.x0 = x; if(x > this.x1) this.x1 = x; if(y < this.y0) this.y0 = y; if(y > this.y1) this.y1 = y;
    if(a === undefined || a >= 1){ if(z > old){ this.z[k] = z; this.b[k] = b; this.c[k] = c; } return; }
    if(z > old){ this.b[k] = b * a + this.b[k] * (1 - a); if(a > .5 || old < -1e8) this.c[k] = c; if(old < -1e8) this.z[k] = z - 1e-3; }      /* membrane in front: tint what is behind */
    else if(old < -1e8){ this.b[k] = b * a; this.c[k] = c; } }
  stamp(L, gap){ const {rows, cols, z, b, c} = this;
    for(let x = this.x0; x <= this.x1; x++) for(let y = this.y0; y <= this.y1; y++){ const k = x * rows + y;
      if(b[k] > 0) L.set(x, y, Math.max(0, b[k] + dith(x, y)), c[k]);
      else if(gap && ((x > 0 && b[k - rows] > 0) || (x < cols - 1 && b[k + rows] > 0) || (y > 0 && b[k - 1] > 0) || (y < rows - 1 && b[k + 1] > 0))) L.set(x, y, 0, 0); } }
}
/* static layers are re-rasterised into an offscreen canvas at a slow tick and blitted every frame */
function offscreen(env){ const c = document.createElement('canvas'); c.width = Math.round(env.W * env.dpr); c.height = Math.round(env.H * env.dpr); const x = c.getContext('2d');
  return {c, begin(){ x.setTransform(env.dpr, 0, 0, env.dpr, 0, 0); x.clearRect(0, 0, env.W, env.H); return x; }, blit(){ env.ax.drawImage(c, 0, 0, env.W, env.H); }}; }
/* a slow layer: fn runs once per step of dt, at the step's own time, so what it draws depends on tm alone and not on the frames before it */
function ticker(dt, fn){ let k = NaN; return tm => { const j = Math.floor(tm / dt); if(j !== k){ k = j; fn(j * dt); } }; }
/* trace K polylines of ST points through a direction field; particles later ride them as a pure function of time */
function tracePaths(out, K, ST, seeds, dir, step){ const v = [0, 0];
  for(let k = 0; k < K; k++){ let x = seeds[k * 2], y = seeds[k * 2 + 1];
    for(let i = 0; i < ST; i++){ const o = (k * ST + i) * 2; out[o] = x; out[o + 1] = y; dir(x, y, v); x += v[0] * step; y += v[1] * step; } } }
function ridePath(L, paths, ST, k, s, b, c, tail){
  const fade = Math.sin(Math.PI * s / (ST - 1)); if(fade <= 0) return;
  for(let j = 0; j <= tail; j++){ const qo = s - j * .9; if(qo < 0) break; const i = Math.min(ST - 2, qo | 0), u = qo - i, o = (k * ST + i) * 2;
    L.put(paths[o] + (paths[o + 2] - paths[o]) * u, paths[o + 1] + (paths[o + 3] - paths[o + 1]) * u, b * fade * (j ? .62 * (1 - j / (tail + 1)) : 1), c); } }

/* ================= templates =================
   Each: make(env, X) -> draw(tm). env = canvas geometry; X = {D (data), p (date-seeded params), rnd (particle stream)}.
   draw(tm) is a pure function of tm, so a single static frame (?t=, reduced motion) is a real frame. */

/* 01 far mountains: first light on high summits standing out of a sea of cloud, through a long lens from a tripod (a time-lapse, not a flight).
   Modelled on photographs of real peaks at sunrise (the Matterhorn with its banner cloud, Spitzmauer, Denali): glacial horns with spur ridges and
   cirques between them, ridges at three scales, flutes down the fall line and ledges of the strata; snow and ice over most of the upper mountain,
   in hollows, on ledges and lee slopes and as cornices on the crests, bare rock where it is too steep to hold snow; paler ranges behind.
   The terrain is a height field sampled once per column and depth step; the camera does not move, so the picture is built once (depth, height,
   material, how squarely each cell faces the sun, and the angle at which the sun clears the terrain in its way) and only the light is redrawn.
   The sun is low and to one side: the light line comes down the summits, on snow rose first, then peach, then gold (smooth and pale), on rock
   dark red to orange (rough, darker), each face as bright as it is turned to the sun, cut by the soft-edged shadows the ridges throw; shadowed
   snow stays blue. The light reaches the cloud sea and turns the sunward heads of its billows pink, holds while cloud shadows cross, climbs back
   at dusk and leaves a short blue hour. The cloud sea is fog that fills the terrain below a moving surface (it laps the faces and spills through
   the cols) and three billowed decks at different depths, each flowing at its own speed; a banner cloud streams off the highest summit. The sky
   is dark above and lighter toward the horizon, with a band of colour that sinks as the light comes and thin cirrus.
   Stars = tokens (about 1.1 stars per million tokens; they dim at sunrise but stay); blue-white and amber stars = the split. Nothing else
   carries data. Birds, cloud and the banner are scenery. Phones frame one summit; desktop two or three. */
function tTerrain(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, S = mulberry(mix(p.seed + 1)), N = cols * rows, PX = env.P;
  /* palette: blue hour in the shadows (sky, snow, rock, forest, fog, far ranges), three steps of sunrise colour on snow and two on rock */
  const PALT = [BLUE, OR, [58, 70, 126], [176, 118, 158], [124, 146, 232], [255, 128, 150], [255, 172, 140], [255, 210, 156], [96, 96, 146], [196, 92, 80], [208, 134, 92],
    [58, 122, 112], [150, 168, 220], [250, 198, 180], [56, 96, 142], [108, 124, 184], [138, 152, 204], [240, 240, 250], [20, 23, 28], [122, 132, 92], [214, 228, 255], [255, 196, 110], [88, 114, 190], [146, 68, 80], [236, 214, 206]];
  const SKY = 2, VENUS = 3, SNS = 4, ROSE = 5, PEACH = 6, GOLD = 7, RKS = 8, RKR = 9, RKO = 10, FOR = 11, FOG = 12, FOGL = 13, WAT = 14, FAR1 = 15, FAR2 = 16, STAR = 17, DARK = 18, FORL = 19, LCOOL = 20, LWARM = 21, SKYL = 22, RKD = 23, CIR = 24;
  const mg = phone ? 0 : Math.max(0, Math.round((env.W - 1240) / 2 / PX)), cap = phone ? 0 : Math.ceil(rows * .47) + 1;      /* desktop: the content column above `cap` stays dark (caption) */
  const flip = p.off >= 0;                                                                              /* the big summit sits left or right of centre by date */
  const ys0 = Math.round(rows * (phone ? 1.3 : 1.3)), topRow = phone ? Math.round(rows * .27) : cap + 3;                      /* row of height 0 (below the frame: a long lens on the upper mountain); row of the highest summit */
  const HH = 3.2, ZH = 9.3, F0 = (ys0 - topRow) / (HH / ZH); let F = F0; const dx = ZH / F0 * (phone ? .75 : 1), cH = cols * (phone ? .5 : .37), RS = F0 / 92;   /* heights in km; one column = dx km */
  const BTA = new Float32Array(N); for(let c = 0; c < cols; c++) for(let y = 0; y < rows; y++) BTA[c * rows + y] = (BAYER[(c & 3) + ((y & 3) << 2)] + .5) / 16;
  /* the page masks the canvas (opaque in the bottom 14%, .55 at 46% up, clear at the top). Brightness below is "as seen"; LIFT undoes the mask as far as a cell can */
  const LIFT = Float32Array.from({length: rows}, (_, y) => { const u = 1 - (y + .5) / rows, m = u < .14 ? 1 : u < .46 ? 1 - .45 * (u - .14) / .32 : .55 * (1 - u) / .54; return Math.min(2.4, 1 / Math.max(.05, m)); });

  /* ---- the range: per column, crest height and depth, the shore, the foothill in front ---- */
  const rdg = (x, z) => { const n = 1 - Math.abs(2 * noise(x, z) - 1); return n * n; };
  const xL = -cH * dx - 4, xR = (cols - cH) * dx + 4, peaks = [{x: 0, h: HH, wl: 2.1, wr: 3.6, el: 1.1, er: 1.5}, {x: 1.3, h: 2.72, wl: .8, wr: 1.3, el: 1, er: 1.3}, {x: -2.1, h: 2.4, wl: 1, wr: .9, el: 1.2, er: 1}];
  for(let x = -3.9 - 1.5 * S(); x > xL; x -= 2.6 + 1.8 * S()) peaks.push({x, h: 2.5 + .45 * S(), wl: 2 + 1.4 * S(), wr: 2 + 1.4 * S(), el: 1.1 + .5 * S(), er: 1.1 + .5 * S()});
  for(let x = 4.3 + 1.5 * S(); x < Math.min(xR, 15); x += 2.6 + 1.8 * S()) peaks.push({x, h: (2.5 + .45 * S()) * (1 - .45 * sstep(7, 15, x)), wl: 2 + 1.4 * S(), wr: 2 + 1.4 * S(), el: 1.1 + .5 * S(), er: 1.1 + .5 * S()});
  const a1 = S() * TAU, Z0 = 6.4, DZ = .05, NZ = 112, GH = new Float32Array(cols * NZ);
  const CR = new Float32Array(cols), ZC = new Float32Array(cols), ZS = new Float32Array(cols), FA = new Float32Array(cols), FZ = new Float32Array(cols), XC = new Float32Array(cols), TN = new Float32Array(cols);
  for(let i = 0; i < cols; i++){ const x = (i + .5 - cH) * dx, open = 1 - .7 * sstep(9, 16, x); XC[i] = x;
    let m = (1.8 + .7 * (noise(x * .4 + 31, 8.2) - .5)) * open; const base = m;
    for(const qo of peaks){ const l = x < qo.x, u = Math.abs(x - qo.x) / (l ? qo.wl : qo.wr); if(u < 1) m = Math.max(m, base + (qo.h * (qo.x ? open : 1) - base) * Math.pow(1 - u, l ? qo.el : qo.er)); }
    CR[i] = m * (1 + .17 * (rdg(x * .7 + 3, 5.5) - .45) + .07 * (rdg(x * 1.9 + 8, 1.5) - .45)); ZC[i] = 9.45 + .45 * Math.sin(x * .31 + a1) + .5 * (noise(x * .35 + 7, 3.3) - .5) - .25 * Math.exp(-x * x / 6);
    ZS[i] = 4.75 + .5 * (noise(x * .22 + 60, 4.4) - .5); FA[i] = .15 * sstep(.3, .8, noise(x * .3 + 20, 1.7)) + .04 * noise(x * 1.7, 6.1) + (hash2(i, 3) > .45 ? .05 : 0) + (hash2(i, 5) > .7 ? .06 : 0);   /* shore knolls; the last two terms are conifer tops, a cell or two high */ FZ[i] = 5.5 + .5 * (noise(x * .3 + 5, 9.1) - .5);
    TN[i] = .16 * (noise(x * .3 + 77, .5) - .5); }
  const hRaw = (i, z) => { const x = XC[i], g0 = (z - ZS[i]) * .16; if(g0 <= 0) return g0;
    const spur = rdg(x * .4 + .35 * noise(z * .5 + 3, x * .15), 2.2 + z * .06), Wf = 2.5 + 2.1 * spur, t = (ZC[i] - z) / Wf, Hc = CR[i];
    let hm = (t <= 0 ? Hc * Math.max(0, 1 + t * Wf / 1.1) : t < 1 ? Hc * Math.pow(1 - t, 1.45) : 0) * sstep(6.2, 7.2, z);
    if(hm > .3){ const rel = sstep(.3, 1.5, hm);                                                       
      hm += rel * (.22 * (rdg(x * 1.25 + .5 * noise(x * .6 + 9, z * .6), z + 40) - .4) + .12 * (rdg(x * 2.7 + 3 + .4 * noise(z * 1.3, x * 1.1), z * 2.2 + 7) - .4) + .06 * (rdg(x * 5.6 + 1, z * 4.6 + 3) - .4)
        + .05 * (rdg(x * 2.6 + .9 * noise(x * .5 + 2, z * .8), z * .45 + 40) - .4) + .03 * Math.sin(hm * 26 + 4 * noise(x * .4 + 11, z * .4))); }                 /* ridges at three scales, flutes down the fall line, ledges of the strata */
    const g = g0 > .03 ? .03 + (g0 - .03) * .1 : g0, e = (z - FZ[i]) / .45;
    return Math.max(hm, g + Math.max(0, FA[i] * Math.exp(-e * e) + .1 * (noise(x * 1.1 + 70, z * 1.1) - .5))); };
  let mhz = 0; for(let i = 0; i < cols; i++) for(let j = 0; j < NZ; j++){ const z = Z0 + j * DZ, h = GH[i * NZ + j] = hRaw(i, z); if(h / z > mhz) mhz = h / z; }
  F = Math.min(F0, (ys0 - topRow) / mhz);                                                                 /* whatever the date's noise adds, the highest point lands on topRow, never in the caption rows */
  const gh = (i, j) => GH[(i < 0 ? 0 : i >= cols ? cols - 1 : i) * NZ + (j < 0 ? 0 : j >= NZ ? NZ - 1 : j)];

  /* ---- the picture, built once: what each cell shows and how it answers the sun ---- */
  const KIND = new Uint8Array(N), BS = new Float32Array(N), BD = new Float32Array(N), CS = new Uint8Array(N), CL = new Uint8Array(N), HZ = new Float32Array(N), PH = new Float32Array(N), PZ = new Float32Array(N), LM = new Float32Array(N);
  const FB = new Float32Array(N), FC = new Uint8Array(N), KEY = new Uint8Array(N).fill(255), KEY2 = new Uint8Array(N).fill(255);
  const KAP = .1, HS = 3.3, sx = -.92, sz = -.39, ZFOG = 6.3, ZCL = 7.3;                                 /* the sun: low, from the left and a little behind the camera (before the flip), so faces are lit from the side and relief shows */
  const pc = i => flip ? cols - 1 - i : i, inCol = c => !phone && c >= mg && c < cols - mg;
  const farA = x => 1 + 2.1 * (.4 * noise(x * .12 + 3, 6.6) + .45 * rdg(x * .3 + 5, 2.2) + .15 * rdg(x * .8, 9.1)), farB = x => 1.6 + 2.6 * (.5 * noise(x * .08 + 13, 1.6) + .35 * rdg(x * .2 + 15, 7.2) + .15 * rdg(x * .6, 4.1));
  for(let i = 0; i < cols; i++){ const c = pc(i), x = XC[i], top = inCol(c) ? cap : 0; let ymin = rows;
    for(let j = 0; j < NZ && ymin > top; j++){ const h = GH[i * NZ + j]; if(h <= 0) continue; const z = Z0 + j * DZ, y0 = Math.max(top, Math.ceil(ys0 - h / z * F)); if(y0 >= ymin) continue;
      /* slope, hollow or rib, and the angle at which the sun clears the terrain toward it */
      const fq = h * 5 + z * 1.3, fb = z > 0 ? (rdg(x * 7 + .7, fq) - rdg(x * 7 - .7, fq)) * .7 + (rdg(x * 13 + .7, fq * 1.7 + 9) - rdg(x * 13 - .7, fq * 1.7 + 9)) * .4 : 0;        /* facets finer than the grid: tilt the normal sideways cell by cell */
      const gx = (gh(i + 1, j) - gh(i - 1, j)) / (2 * dx) + fb, gz = (gh(i, j + 1) - gh(i, j - 1)) / (2 * DZ), sl = Math.hypot(gx - fb, gz), nl = Math.hypot(gx, 1, gz), hol = ((gh(i - 2, j) + gh(i + 2, j)) / 2 - h) / (dx * 2);
      let hz = -1; for(let s = 2; s < 46; s++){ const d = s * .07, a = (gh(Math.round(i + sx * d / dx), Math.round(j + sz * d / DZ)) - h) / d; if(a > hz) hz = a; }
      const lam = sstep(.12, 1.02, (-gx * sx + .1 - gz * sz) / nl * 1.15), gs = gx - fb * .55, lamS = sstep(.05, 1, (-gs * sx + .1 - gz * sz) / Math.hypot(gs, 1, gz) * 1.15), sky = (.55 + .45 / nl) * (1 - .5 * sstep(0, .7, hz)), hzf = sstep(6.2, 10.5, z) * .22;
      /* snow: above a snowline that wanders, in the hollows between ribs and on ledges and lee slopes; rock stands out as ribs down the fall line, as bands of the strata and wherever it is steep */
      const sc = (h - 1.8) / .45 + .9 * (noise(x * .45 + 40, z * .45) - .5) + .3 * (noise(x * 4.5, z * 4.5 + 9) - .5) + 1.7 * Math.max(-1, Math.min(1, hol * 3))
        - .9 * sstep(.5, .9, Math.sin(h * 13 + 2.5 * noise(x * .4 + 3, z * .4))) + .4 * Math.max(-1, Math.min(1, gx * .5)) + .7 * sstep(1.6, .6, sl) - 2.4 * sstep(1.7, 3, sl), tl = .5 + .16 * (noise(x * .8 + 7, z * .8) - .5) - .3 * clamp01(hol * 1.5);
      const fo = sl < 1.5 ? sstep(.05, -.05, h - tl) : 0, strat = .7 + .6 * noise(h * 18 + x * .25, x * .2 + 50);
      for(let y = y0; y < ymin; y++){ const k = c * rows + y, bt = BTA[k]; KIND[k] = 2; PZ[k] = z; PH[k] = h; HZ[k] = hz; LM[k] = lam; let bs, bd, cs, cl;
        if(sc > (bt - .5) * .35){ bs = .8 * sky + .05; bd = .2 + .75 * lamS; cs = SNS; cl = 0; LM[k] = lamS; }
        else if(fo > bt){ bs = (z < ZFOG ? .14 : .2 + .12 * sky) * (.7 + .6 * hash2(i * 7 + j, y >> 1)); bd = .22 * lam; cs = FOR; cl = 2; }
        else { const scree = sl < 1.05; bs = (scree ? .42 : .36) * sky * (scree ? 1 : strat); bd = scree ? .06 + .42 * lam : (.04 + .5 * lam) * strat; cs = RKS; cl = 1; }
        if(hzf > 0){ bs = bs * (1 - hzf) + .3 * hzf; if(hzf > bt * .5 + .12 && cs !== SNS) cs = FAR1; }                 /* air between: far slopes paler and bluer */
        BS[k] = bs; BD[k] = bd; CS[k] = cs; CL[k] = cl; }
      ymin = y0; }
    /* behind: two far ranges, then the sky with the pink band that stands opposite the sun */
    const ra = ys0 - (farA(x) + 1.1) / 15 * F, rb = ys0 - (farB(x) + 2.6) / 27 * F;
    for(let y = top; y < ymin; y++){ const k = c * rows + y, a = (ys0 - y) / F;
      if(y >= ra || y >= rb){ const A = y >= ra, zf = A ? 15 : 27, h = a * zf, r0 = A ? ra : rb; KIND[k] = 2; PZ[k] = zf; PH[k] = h + (A ? .25 : .45); HZ[k] = -1; LM[k] = .6;
        const sn = h > (A ? 1.7 : 1.9) + .3 * noise(x * .7, y * .3), fl = .8 + .4 * noise(x * 1.3 + y * .2, y * .5 + (A ? 0 : 9));
        BS[k] = (A ? .3 : .25) + .06 * sstep(r0 + 6 * RS, r0, y) * (sn ? 1 : .3); BD[k] = sn ? (A ? .26 : .18) * fl : .05; CS[k] = A ? FAR1 : FAR2; CL[k] = 3; continue; }
      KIND[k] = 1; PZ[k] = 99; PH[k] = a; BS[k] = 1; }
    if(top) for(let y = cap; y < cap + 5; y++){ const k = c * rows + y, f = (y - cap + .5) / 5; BS[k] *= f; BD[k] *= f; }   /* fade in under the caption */
    /* skyline: cornices of snow on the high crests; a rim of fog light on the tops of the shore knolls */
    for(let y = top + 1; y < rows; y++){ const k = c * rows + y; if(KIND[k] !== 2 || PZ[k] > 12) continue; const up = KIND[k - 1] !== 2 || PZ[k - 1] > PZ[k] + 1.2;
      if(up && PH[k] > 1.5 && CL[k] === 1 && hash2(i, 41) > .3){ BS[k] = .6; BD[k] = .12 + .62 * LM[k]; CS[k] = SNS; CL[k] = 0; }
} }

  /* one painter for every layer: square cells, size and alpha by level (the kit's 'sq' look), one path per colour and level, no per-colour buffers */
  const NK = PALT.length * LV, cnt = new Int32Array(NK + 1), ord = new Int32Array(N);
  const paint = (cx, K, y0, y1, halo) => { cnt.fill(0); for(let c = 0; c < cols; c++) for(let k = c * rows + y0, e = c * rows + y1; k < e; k++) if(K[k] !== 255) cnt[K[k] + 1]++;
    for(let qo = 0; qo < NK; qo++) cnt[qo + 1] += cnt[qo];
    for(let c = 0; c < cols; c++) for(let k = c * rows + y0, e = c * rows + y1; k < e; k++) if(K[k] !== 255) ord[cnt[K[k]]++] = k;
    for(let qo = 0, i = 0; qo < NK; qo++){ const e = cnt[qo]; if(e === i) continue; const col = PALT[(qo / LV) | 0], f = (qo % LV + 1) / LV, s = PX * (.3 + .6 * f), o = (PX - s) / 2, rgb = `${col[0]},${col[1]},${col[2]}`;
      if(halo && f > .85){ const hs = PX * 2.4, ho = (PX - hs) / 2; cx.fillStyle = `rgba(${rgb},.12)`; cx.beginPath(); for(let j = i; j < e; j++){ const k = ord[j]; cx.rect(((k / rows) | 0) * PX + ho, (k % rows) * PX + ho, hs, hs); } cx.fill(); }
      cx.fillStyle = `rgba(${rgb},${(.14 + .66 * f).toFixed(3)})`; cx.beginPath(); for(; i < e; i++){ const k = ord[i]; cx.rect(((k / rows) | 0) * PX + o, (k % rows) * PX + o, s, s); } cx.fill(); } };
  /* shadows are lifted less than light, so they fade upward with the mask and the lit faces stay the brightest thing; the upper half of the range is squeezed, not clipped, so slope still shows in the highlights */
  const SL = phone ? 1.5 : 2.1, key = (k, b, ad, c) => { const L = LIFT[k % rows], Ls = L < SL ? L : SL; let u = b * Ls + ad * L; if(u > .45) u = .45 + (u - .45) / (.25 * Ls + .95 * L - .45) * .55; const v = Math.ceil(u * LV + BTA[k] - .5); return u < .04 || v < 1 ? 255 : c * LV + (v > LV ? LV : v) - 1; };

  /* ---- time: one evening and morning in 72 s. The light line (a height) comes down from the summit into the cloud sea, holds, climbs back, and a short blue hour follows ---- */
  const CYC = 72, lineAt = tm => { const f = (((tm - 14) * sp / CYC + (phone ? .27 : .25)) % 1 + 1) % 1; return 3.5 - 2.1 * (f < .34 ? smooth(f / .34) : f < .52 ? 1 : f < .86 ? 1 - smooth((f - .52) / .34) : 0); };
  /* the cloud sea: fog that fills the terrain below a moving surface (it laps the faces and spills through the cols), and three decks in front of it,
     each a billowed edge with its own depth, speed and size: a pale far deck behind the summits, one at their feet, one near the camera */
  const FH = 1.72 + .1 * S(), frow = new Float32Array(cols), off = offscreen(env), sd = flip ? 1 : -1;
  const DK = [{zc: 12, base: rows * (phone ? .7 : .83), amp: 3.5, f: .5, v: .012, b: .4, hl: 1.95, col: FAR2}, {zc: 7.6, base: rows * (phone ? .77 : .9), amp: phone ? 5 : 7, f: .8, v: .03, b: .4, hl: 1.8, col: FOG},
    {zc: 0, base: rows * (phone ? .845 : .975), amp: phone ? 7 : 10, f: .55, v: .055, b: .33, hl: 1.62, col: FOG}].map((qo, n) => ({...qo, n, r: new Float32Array(cols + 2), sf: new Float32Array(cols)}));
  /* the summit, for the banner cloud that streams off it downwind */
  let cs = pc(Math.round(cH)), ysm = rows; for(let c = Math.max(1, cs - 14); c < Math.min(cols - 1, cs + 14); c++) for(let y = 0; y < ysm; y++){ const k = c * rows + y; if(KIND[k] === 2 && PZ[k] < 12){ ysm = y; cs = c; break; } }
  const LB = cols * (phone ? .4 : .15), UP = (() => { const a = []; for(let k = 0; k < N; k++) if(KIND[k]) a.push(k); return Int32Array.from(a); })();
  let octx = null, lq = -1e9;
  const land = t => { const hT = lineAt(t), e = (HS - hT) * KAP, w = sstep(3.5, 1.2, hT), av = .3 - .13 * w, cirL = sstep(3.5, 2.9, hT), banL = sstep(3.3, 2.9, hT);
    for(let i = 0; i < cols; i++){ const x = XC[i], c = pc(i);
      frow[c] = FH + .5 * (noise(x * .25 - t * .02, 4.4) - .5) + .16 * (1 - Math.abs(2 * noise(x * .8 - t * .04, 9.9 + t * .012) - 1)) + .05 * noise(x * 2.6 - t * .06, 1.3); }
    for(const qo of DK){ for(let i = -1; i <= cols; i++){ const x = (i + .5 - cH) * dx, n1 = clamp01((noise(x * qo.f - t * qo.v, qo.n * 7.7 + t * .006) - .5) * 2.4 + .5), n2 = clamp01((noise(x * qo.f * 2.9 - t * qo.v * 1.3, qo.n * 3.1 + 20 + t * .01) - .5) * 2.4 + .5);
        qo.r[(flip ? cols - 1 - i : i) + 1] = qo.base - qo.amp * (.62 * n1 + .32 * Math.sqrt(n2) + .12 * noise(x * qo.f * 7 - t * qo.v * 2, 5.5) - .5); }      /* billows: broad swells with rounder heads on them */
      for(let c = 0; c < cols; c++) qo.sf[c] = clamp01(.5 + (qo.r[c + 1 + sd] - qo.r[c + 1 - sd]) * .3); }                                          /* which side of a billow faces the sun */
    for(let n = 0; n < UP.length; n++){ const k = UP[n], c = (k / rows) | 0, y = k - c * rows, bt = BTA[k], z = PZ[k], i = pc(c); let b = BS[k], ad = 0, col = CS[k];
      if(KIND[k] === 2){ const h = PH[k], dz = e - HZ[k], d = h - hT - TN[i];
        if(d > -.05 && dz > -.012){ let L = Math.min(d > .09 ? 1 : (d + .05) / .14, dz > .04 ? 1 : (dz + .012) / .052); if(z < 12){ const sh = noise(XC[i] * .3 - t * .05, z * .5 + 13); if(sh > .58) L *= 1 - .75 * sstep(.58, .72, sh); }     /* soft edges of ridge shadows; cloud shadows cross the lit faces */
          ad = L * BD[k]; b *= 1 - .3 * L; if(L > bt * .6 + .2){ const m = CL[k], wm = LM[k] + (d < .5 ? d : .5) * .3 + (bt - .5) * .2, ws = (d < 1.4 ? d : 1.4) * .62 + LM[k] * .25 + (bt - .5) * .22;     /* rock: hue by how squarely it meets the sun; snow: by how long it has been lit */
            col = m === 0 ? (ws < .42 ? ROSE : ws < .95 ? PEACH : GOLD) : m === 1 ? (wm < .3 ? RKD : wm < .62 ? RKR : RKO) : m === 2 ? FORL : FOGL; } } }
      else { /* sky: dark above, lighter toward the horizon, a band of colour that sinks toward the cloud sea as the light comes; cirrus that catches the sun before the summits do */
        const a = PH[k], v = Math.exp(-(((a - av) / .06) ** 2)) * (1 - .4 * w); b = (.07 + .05 * w + (.1 + .16 * w) * Math.exp(-Math.max(0, a - .1) * 9) + .15 * v) * BS[k];
        col = v > bt * .8 + .28 ? VENUS : a < .13 + .2 * w - bt * .07 ? SKYL : SKY;
        if(a > .15 && a < .36 && LIFT[y] < 1.9){ const cn = noise(XC[i] * .16 - t * .025, a * 95 + 5 + .25 * XC[i]) * (.5 + noise(XC[i] * .5 - t * .025, a * 12 + 2)); if(cn > .76 + bt * .08){ b = (.08 + cirL * (.06 + (cn - .76))) * BS[k]; col = cirL > bt * .9 + .05 ? (w < .6 ? VENUS : CIR) : SKYL; } } }
      { const u = (c - cs) * -sd; if(u > 1 && u < LB && y > ysm - 12 && y < ysm + 30){ const g = u / LB, v = (y - (ysm + 2.5 + u * .26)) / (1.5 + (phone ? 6 : 9) * Math.sqrt(g) * (1 - .55 * g));       /* banner cloud: hangs on the lee side from the summit down, billows, frays downwind */
          if(v > -1.3 && v < 1.3){ const n1 = noise(u * .1 - t * .7, y * .16 + t * .1), n2 = noise(u * .34 - t * 1.5, y * .42 + t * .2), dn = (1 - v * v) * (1 - g * g) + 1.5 * (n1 - .5) + .8 * (n2 - .5);
            if(dn > .34 + bt * .45){ const up = clamp01(.5 - v * .6 + 1.6 * (n2 - .5)); b = .22 + .2 * dn + .16 * n1; ad = banL * (.05 + .6 * up) * clamp01(dn * 1.3); col = ad > .2 + bt * .14 ? FOGL : FOG; } } } }
      if(KIND[k] === 2 && z < 12 && PH[k] < frow[c]){ const dd = (frow[c] - PH[k]) * 7; if(.2 + dd > bt){ const bl = noise(XC[i] * .55 - t * .03, y * .5 + t * .01), lf = clamp01((frow[c] + .2 * (bl - .5) - hT + .02) / .12) * clamp01(1.3 - dd * .7);
          b = (dd < .4 ? .5 : .4) + .16 * bl; ad = .3 * lf; col = lf > bt * .9 + .1 ? FOGL : FOG; } }
      for(let l = 0; l < 3; l++){ const qo = DK[l], dd = y - qo.r[c + 1]; if(z > qo.zc && dd > -bt * .9){ const xs = XC[i] * 2.2 * qo.f - t * qo.v * 2.2, ys = y * (l ? .2 : .32) + l * 9 + t * .008, hd = noise(xs, ys), gr = (noise(xs - sd * .35, ys - .3) - hd) * 5;   /* heads inside the deck: lit on the sunward shoulder, shadowed in the hollows */
          const sf = clamp01(dd < 2 ? qo.sf[c] : .5 + gr), lf = clamp01((qo.hl + (qo.base - qo.r[c + 1]) * .04 + .3 * (hd - .5) - hT) / .25), dp = dd < 5 ? 1 : Math.max(.35, 1 - (dd - 5) * .06);
          b = qo.b + .1 * sf + .34 * (hd - .5) - Math.min(.1, dd * .01) + (dd < 1 ? .07 : 0); ad = lf * dp * (.04 + .5 * sf * (.4 + .9 * hd)); col = ad > .13 + bt * .12 ? FOGL : qo.col; } }
      FB[k] = b + ad; FC[k] = col; KEY[k] = key(k, b, ad, col); }
    paint(octx, KEY, 0, rows, false); };

  /* ---- stars (the count the caption reports: about 1.1 per million tokens; blue-white and amber stars = the split), birds ---- */
  const NL = Math.round(D.nPart * .05), used = new Set(), stars = [], cand = []; for(let k = 0; k < N; k++){ const y = k % rows; if(KIND[k] === 1 && BS[k] > .9 && y > rows * .16 && y < DK[0].base - DK[0].amp - 2) cand.push(k); }
  for(let n = 0; n < NL && cand.length; n++){ const r1 = X.rnd(), r2 = X.rnd(), r3 = X.rnd(), r4 = X.rnd(); let k = cand[(r1 * cand.length) | 0];
    for(let tr = 0; tr < 60 && (used.has(k) || used.has(k - rows) || used.has(k + rows) || used.has(k - 1) || used.has(k + 1)); tr++) k = cand[(hash2(n * 131 + tr, 77) * cand.length) | 0];
    for(let qo = 0; used.has(k) && qo < cand.length; qo++) k = cand[qo];                                         /* crowded: any free sky cell, so the count stays true */
    used.add(k); stars.push({k, b: .3 + .7 * r2 * r2, ph: r3 * TAU, cx: r4 > D.share ? LWARM : LCOOL}); }
  const dot = (c, y, b, col) => { c = Math.round(c); y = Math.round(y); if(c < 0 || y < 0 || c >= cols || y >= rows) return; const k = c * rows + y; KEY2[k] = col * LV + Math.max(0, Math.min(LV, Math.ceil(b * LIFT[y] * LV)) - 1); };

  return tm => {
    const l = Math.floor(tm / .2); if(l !== lq){ octx = off.begin(); land(l * .2); lq = l; }               /* the picture is relit five times a second; stars and birds every frame */
    off.blit(); KEY2.fill(255);
    const hT = lineAt(tm), night = sstep(1.2, 3.4, hT);
    /* birds: now and then a few choughs cross in front of the faces and the cloud. Each flaps in bursts and glides between (about 3 beats a second, wings
       up or down for two live frames or more); dark against lit snow and cloud, lost against shadow, as at that distance */
    const ev = Math.floor((tm - 5) / 23), u = ((tm - 5) / 23 - ev) * 1.6; if(u < 1){ const dir = hash2(ev, 5) > .5 ? 1 : -1, nb = 2 + (hash2(ev, 7) * (phone ? 2 : 4) | 0), y0 = rows * ((phone ? .56 : .7) + .12 * hash2(ev, 6));
      for(let n = 0; n < nb; n++){ const ph = hash2(ev, n + 20) * 9, x = Math.round((dir > 0 ? u : 1 - u) * (cols + 60) - 30 - dir * (n * 7 + 5 * hash2(ev, n))), y = Math.round(y0 + n * 1.7 * (hash2(ev, n + 9) - .3) + 1.5 * Math.sin(tm * .5 + ph));
        const g = ((tm + ph) / 2.6) % 1, w = g < .55 ? Math.sin((tm + ph) * 19) : .25, a = w > .35 ? -1 : w < -.35 ? 1 : 0;
        dot(x, y, 1, DARK); dot(x - dir, y, 1, DARK); dot(x - 1, y + a, 1, DARK); dot(x + 1, y + a, 1, DARK); dot(x - 2, y + a * 2, 1, DARK); dot(x + 2, y + a * 2, 1, DARK); } }
    for(const s of stars){ const y = s.k % rows; dot((s.k / rows) | 0, y, s.b * (.3 + .7 * night) * (.8 + .2 * Math.sin(tm * 1.7 + s.ph)) / LIFT[y] * 1.5, s.cx); }
    paint(ax, KEY2, 0, rows, true);
  };
}

/* 02 Saturn (function name kept from the piece it replaces; an original piece).
   Saturn and its rings as a spacecraft on a close pass films them: a long lens, the globe large and cut by the frame, the rings sweeping across
   the picture. Everything is in Saturn radii and every cell is a ray from the camera, so occlusion, shadows and translucency are computed, not drawn.
   The globe is an oblate spheroid (polar radius 0.902 of the equatorial). Its cloud bands are a profile by latitude (bright equatorial zone,
   darker belts, greyer poles with a dark cap) times a map of streaks, wavy band edges and a few
   storms that is carried round by the wind of each latitude (the equatorial jet laps the rest). The hemisphere tilted away from the sun is
   blue-grey, as the winter hemisphere was in 2004. Light: a hazy atmosphere (darker toward the limb, a soft terminator that reddens), no fill.
   The rings are a disc with a radial table of optical depth in kilometres: D, C with its plateaus and the Colombo and Maxwell gaps, B (inner, the
   opaque core, outer), the Huygens gap, the Cassini Division and its bands, A with density waves, the Encke and Keeler gaps, the F ring.
   A ring cell is lit by single scattering through a layer of that depth: on the sunlit face thick rings are bright and thin ones dim; seen from
   the dark face it is the thin ones (C, the Cassini Division) that glow and the B ring that is black. Icy particles scatter back toward the sun;
   dust (the F and D rings, spokes) scatters forward and shows when the sun is behind the rings. What is behind a ring shows through it by
   exp(-depth / sine of the viewing angle): the globe through the C ring, stars through the Cassini Division.
   Shadows: the globe's shadow falls across the rings; the rings' shadow falls on the globe as bands (each ring by its depth, so the Cassini
   Division is a light line in it); a moon's shadow is a dot.
   Motion: the camera is on an inclined, eccentric orbit (Kepler's equation), so it moves faster as it comes closer; the ring opening and the phase
   change and the stars slide by behind. Over a whole orbit it passes behind the planet (the rings backlit, the F ring bright), crosses the ring
   plane and comes back under the dark face of the rings. The globe turns once in 60 s (a time-lapse); the moons (Mimas, Enceladus, Tethys, Dione, Rhea, Titan,
   true sizes, distances and periods on that clock) creep along their orbits, cross the globe, pass behind it and go dark in its shadow; ring
   particles move at their Kepler speed as faint grain; spokes form on the B ring in a second or two, are carried round with the planet's
   rotation, shear and fade. The camera's own orbit is not on that clock: it runs several times faster than a real orbit of that size would.
   Data: the stars of the sky the camera sweeps = tokens, their colour = split (the exact UI blue and amber). Saturn, rings and moons carry no data. */
function tTorus(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, PX = env.P, N = cols * rows, sp = p.speed, LVN = 9, RD = Math.PI / 180, S = mulberry(mix(p.seed + 2));
  const U = rows / (phone ? 97 : 139), TOP = Math.round((phone ? 12 : 64) * U), MG = phone ? 0 : Math.max(0, Math.floor((env.W - 1240) / 2 / PX));
  /* palette: 0 / 1 the data colours (stars only); 2-14 the globe, a path from the terminator (umber, brown) through ochre, butterscotch, gold and cream
     to the grey-beige and pale blue of the winter pole; 15-19 the rings (dark taupe to ivory); 20 dust in forward light; 21 white star; 22 icy moon; 23 Titan */
  const PA = [BLUE, OR, [88, 54, 40], [118, 76, 50], [148, 102, 64], [172, 124, 76], [194, 146, 90], [212, 168, 106], [226, 188, 124], [238, 208, 150], [246, 226, 178], [224, 214, 188], [196, 202, 206], [170, 188, 210], [136, 158, 190],
    [92, 80, 70], [140, 122, 102], [186, 166, 138], [220, 202, 168], [244, 232, 204], [206, 216, 234], [232, 236, 246], [224, 224, 218], [230, 172, 96]];
  const GP = 2, RP = 15, DUSTC = 20, STARC = 21, MOONC = 22, TITANC = 23;
  const GV = new Float32Array(N), GC = new Uint8Array(N), KEY = new Uint8Array(N), ORD = new Int32Array(N), CNT = new Int32Array(PA.length * LVN + 1);
  /* painter: one index array for all (colour, level) runs (counting sort), so memory does not grow with the number of colours */
  const paint = (r0, r1) => { const k0 = r0 * cols, k1 = r1 * cols; CNT.fill(0);
    for(let k = k0; k < k1; k++){ const a = GV[k]; if(a < .05){ KEY[k] = 255; continue; } const key = GC[k] * LVN + (a >= 1 ? LVN : Math.ceil(a * LVN)) - 1; KEY[k] = key; CNT[key + 1]++; }
    for(let i = 1; i < CNT.length; i++) CNT[i] += CNT[i - 1];
    for(let k = k0; k < k1; k++){ const key = KEY[k]; if(key !== 255) ORD[CNT[key]++] = k; }
    let i0 = 0;
    for(let key = 0; key < CNT.length - 1; key++){ const i1 = CNT[key]; if(i1 === i0) continue;
      const col = PA[(key / LVN) | 0], f = (key % LVN + 1) / LVN, s = PX * (.4 + .52 * f), o = (PX - s) / 2;
      ax.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${(.16 + .78 * f).toFixed(3)})`; ax.beginPath();
      for(let i = i0; i < i1; i++){ const k = ORD[i]; ax.rect((k % cols) * PX + o, ((k / cols) | 0) * PX + o, s, s); }
      ax.fill(); i0 = i1; } };
  const EXT = new Float32Array(1025), GAM = new Float32Array(257), PWA = new Float32Array(257), PWB = new Float32Array(257);
  for(let i = 0; i <= 1024; i++) EXT[i] = Math.exp(-i / 85.3334);
  for(let i = 0; i <= 256; i++){ GAM[i] = Math.pow(Math.min(1, (1 - Math.exp(-1.7 * i / 160)) / .8806), .85); PWA[i] = Math.pow(i / 256, .9); PWB[i] = Math.pow(Math.max(.03, i / 256), -.1); }
  const ex = x => x >= 12 ? 0 : EXT[(x * 85.3334) | 0];
  const at2 = (y, x) => { const ax_ = x < 0 ? -x : x, ay = y < 0 ? -y : y, a = (ax_ < ay ? ax_ : ay) / ((ax_ > ay ? ax_ : ay) + 1e-12), s = a * a; let r = ((-.0464964749 * s + .15931422) * s - .327622764) * s * a + a;
    if(ay > ax_) r = 1.57079637 - r; if(x < 0) r = 3.14159274 - r; return y < 0 ? -r : r; };

  /* ---- the rings: optical depth by radius, 37 km a sample, from 1.10 to 2.345 radii; the same on every date ----
     Ten tables, each the one before averaged over twice the width; each keeps how much of that width holds any ring at all and the depth of
     the part that does, so a gap narrower than a cell dims the cell instead of vanishing. A cell reads the table that matches the width of ring it covers. Also by radius: particle albedo, tint, share of dust. */
  const RA = 1.10, RB = 2.345, NR = 2048, RI = (NR - 1) / (RB - RA), NM = 10, RKM = 60268;
  const TM = new Float32Array(NM * NR), CV = new Float32Array(NM * NR), RW = new Float32Array(NM * NR), RT = new Float32Array(NM * NR), RDU = new Float32Array(NR), KEP = new Float32Array(NR);
  { const R = mulberry(0x5a7c1), V = new Float32Array(4096).map(() => R()), n1 = x => { const i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f); return V[i & 4095] + (V[(i + 1) & 4095] - V[i & 4095]) * s; };
    const box = (km, a, b, e) => sstep(a - e, a + e, km) * (1 - sstep(b - e, b + e, km)), gs = (km, c, w) => Math.exp(-((km - c) / w) * ((km - c) / w));
    const PLAT = [[76180, 160], [77350, 110], [79240, 180], [84840, 190], [85690, 140], [86400, 200], [88420, 220], [89230, 130], [89850, 170], [90180, 110], [90480, 150]], e0 = new Float64Array(NR + 1), c0 = new Float64Array(NR + 1), w0 = new Float64Array(NR + 1), t0 = new Float64Array(NR + 1);
    for(let i = 0; i < NR; i++){ const rho = RA + i / RI, km = rho * RKM, f1 = n1(km / 900), f2 = n1(km / 260 + 77), f3 = n1(km / 95 + 191); let t = 0, w = .5, tint = 2, du = .03;
      if(km < 74658){ t = .0012 + .005 * gs(km, 67600, 250) + .003 * gs(km, 71600, 300) + .005 * gs(km, 73200, 250); du = 1; tint = 1; }
      else if(km < 92000){ t = .045 + .06 * (km - 74658) / 17342 + .04 * (f2 - .5) + .03 * (f3 - .5); for(const [c, pw] of PLAT) t += .36 * box(km, c - pw / 2, c + pw / 2, 22);
        t *= 1 - box(km, 77795, 77945, 12); t += 1.2 * gs(km, 77880, 22); t *= 1 - box(km, 87356, 87626, 14); t += .9 * gs(km, 87500, 40);
        if(km > 90620) t = Math.max(t, .1 + .28 * (km - 90620) / 1380); w = .27 + .1 * sstep(90620, 92000, km); tint = .9 + 1.2 * sstep(90000, 92000, km); du = .05; }
      else if(km < 117580){ t = km < 94400 ? 1.05 + .5 * (f2 - .5) : km < 95300 ? .85 : km < 99000 ? 1.25 + .8 * (f3 - .5) + .3 * (f1 - .5) : km < 104100 ? (f2 > .5 ? 2.9 : 1.3) + .5 * (f3 - .5)
          : km < 110300 ? 4.6 - 2.5 * sstep(.8, .95, f2) : km < 116400 ? 2.7 + 1.3 * (f2 - .5) + .6 * (f3 - .5) : 2 + (f3 - .5);
        w = (.5 + .1 * sstep(92000, 104000, km)) * (1 + .4 * (f1 - .5) + .4 * (f2 - .5) + .2 * (f3 - .5)); tint = 2.7 + .5 * sstep(92000, 110000, km) + .8 * (f1 - .5); }
      else if(km < 122170){ t = (.07 + .05 * (f2 - .5) + .06 * box(km, 118300, 118900, 30) + .07 * box(km, 120550, 120800, 25)) * (1 - box(km, 117600, 117930, 14)) * (1 - box(km, 118183, 118285, 12)) * (1 - box(km, 119848, 120086, 14)) + .8 * gs(km, 117848, 20);
        if(km > 120900) t = Math.max(t, .09 + .2 * (km - 120900) / 1150); w = .3; tint = 1; du = .08; }
      else if(km < 136790){ t = .47 + .6 * Math.exp(-(km - 122170) / 1100) + .1 * sstep(131000, 134500, km) + .12 * (f3 - .5) + .25 * gs(km, 125270, 130) + .2 * gs(km, 130700, 150) + .2 * gs(km, 132300, 150) + .25 * gs(km, 134310, 120);
        t *= (1 - box(km, 133427, 133751, 16)) * (1 - .85 * gs(km, 136505, 24)) * (1 - sstep(136755, 136790, km)); w = .43 * (1 + .25 * (f1 - .5) + .2 * (f2 - .5)); tint = 2.2 + .5 * (f1 - .5); }
      else { t = .0008 + .32 * gs(km, 140180, 45) + .12 * gs(km, 140180, 300); du = .9; w = .8; tint = 2; }
      TM[i] = t; RW[i] = w; RT[i] = tint; RDU[i] = du; KEP[i] = Math.pow(1.86 / rho, 1.5); const fl = t > .0005 ? 1 : 0; CV[i] = fl; c0[i + 1] = c0[i] + fl; w0[i + 1] = w0[i] + fl * w; t0[i + 1] = t0[i] + fl * tint; e0[i + 1] = e0[i] + fl * Math.exp(-t / .35); }
    for(let m = 1; m < NM; m++){ const h = 1 << (m - 1); for(let i = 0; i < NR; i++){ const a = Math.max(0, i - h), b = Math.min(NR, i + h + 1); const n = c0[b] - c0[a]; CV[m * NR + i] = n / (b - a); RW[m * NR + i] = n > 0 ? (w0[b] - w0[a]) / n : 0; RT[m * NR + i] = n > 0 ? (t0[b] - t0[a]) / n : 0; TM[m * NR + i] = n > 0 ? Math.min(8, -.35 * Math.log((e0[b] - e0[a]) / n)) : 0; } } }

  /* ---- the globe: tables by latitude (the index is even in latitude near the poles), and a map of the weather ---- */
  const KZ = 1 / .902, NL = 1536, NLON = 512, NLT = NL >> 3, ALB = new Float32Array(NL), QH = new Float32Array(NL), ROT = new Float32Array(NL), ROFF = new Float32Array(NL), T1 = new Float32Array(NLON * NLT), T2 = new Float32Array(NLON * NLT);
  const SE = (10.5 + 1.6 * (S() - .5)) * RD, Lx = Math.cos(SE), Lz = Math.sin(SE), MU0 = Lz;                               /* the sun: north of the ring plane, so the south is the winter hemisphere */
  const wn = (x, y, K) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf), x0 = ((xi % K) + K) % K, x1 = (x0 + 1) % K, y0 = (yi & 255) << 8, y1 = ((yi + 1) & 255) << 8;
    const a = perm[y0 | x0], b = perm[y0 | x1], c = perm[y1 | x0], d = perm[y1 | x1]; return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy; };
  { const R = mulberry(0x51a7), V = new Float32Array(1024).map(() => R()), n1 = x => { const i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f); return V[i & 1023] + (V[(i + 1) & 1023] - V[i & 1023]) * s; };
    const g = (x, c, w) => Math.exp(-((x - c) / w) * ((x - c) / w)), LAT = new Float32Array(NL);
    for(let i = 0; i < NL; i++){ const qo = 2 * i / (NL - 1) - 1, s = Math.sign(qo) * (1 - (1 - Math.abs(qo)) * (1 - Math.abs(qo))), lat = Math.asin(s) / RD, al = Math.abs(lat); LAT[i] = lat;
      let a = .86 + .1 * g(lat, 0, 9) - .03 * g(lat, 0, 1.6) - .1 * g(al, 19, 5) + .045 * g(al, 28, 4) - .07 * g(al, 37.5, 4) + .03 * g(al, 46, 3.5) - .06 * g(al, 55, 3.5) + .02 * g(al, 61, 2) - .05 * g(al, 66, 3) - .16 * sstep(69, 88, al);
      a += .05 * (n1(lat * .9 + 300) - .5) + .035 * (n1(lat * 2.6 + 500) - .5);
      if(lat > 0){ a += .07 * g(lat, 77.3, .7) - .1 * sstep(77.6, 78.6, lat) - .14 * sstep(88.2, 89, lat); } else a += .06 * g(lat, -86, 1) - .2 * sstep(-87, -88.3, lat);
      a = .86 + (a - .86) * 1.1; ALB[i] = a; const m = .6 * sstep(25, 70, -lat), qw = Math.max(3.5, Math.min(8.2, 6.2 + (a - .86) * 22)), qb = Math.max(9.2, Math.min(12, 10 + (.86 - a) * 10 + 1.2 * sstep(55, 86, al)));
      QH[i] = qw + (qb - qw) * m;
      const wind = al > 74 ? 0 : 430 * g(lat, 0, 11) + 110 * g(al, 42, 5) + 100 * g(al, 56, 4) + 90 * g(al, 68, 3.5) - 20;       /* m/s eastward against the rotation of the interior (9.96 km/s at the equator) */
      ROT[i] = 1 + wind / (9960 * Math.cos(lat * RD)); }
    const ST = []; for(let i = 0; i < 6; i++) ST.push([i < 2 ? -35 + 5 * (S() - .5) : (S() < .5 ? -1 : 1) * (18 + 44 * S()), S() * NLON, 1.8 + 2.2 * S(), S() < .6 ? .22 : -.16]);
    for(let il = 0; il < NLT; il++){ const lat = LAT[il * 8 + 4];
      for(let j = 0; j < NLON; j++){ const k = il * NLON + j, x = j / NLON; let v = .1 * (wn(x * 20, il * .33, 20) - .5) + .08 * (wn(x * 64, il * .6 + 40, 64) - .5) + .05 * (wn(x * 160, il * .9 + 90, 160) - .5);
        let d = 15 * (wn(x * 12, il * .05 + 70, 12) - .5) + 7 * (wn(x * 40, il * .2 + 120, 40) - .5);
        for(const [sl, sj, sz, sa] of ST){ const dl = (lat - sl) / sz; if(dl > -3 && dl < 3){ let dj = Math.abs(j - sj); if(dj > NLON / 2) dj = NLON - dj; const e = dl * dl + (dj * .703 / (sz * 2.2)) * (dj * .703 / (sz * 2.2)); v += sa * Math.exp(-e) - (sa < 0 ? sa * .6 * Math.exp(-(e - 1.6) * (e - 1.6) * 3) : 0); } }
        T1[k] = v * 1.3; T2[k] = d; } } }

  /* ---- the camera: an inclined, eccentric orbit round Saturn; the static frame is 70 degrees of true anomaly before the closest point ---- */
  const side = mix(p.seed ^ 0x2a7) & 1 ? 1 : -1, INC = (24 + 2 * p.tilt) * RD, BH = (17 + p.off) * RD, LH = side * (38 + 10 * (S() - .5)) * RD, ECC = .3, SMA = 20, NUH = -70 * RD, NMEAN = 1.7 * RD;
  const UH = Math.asin(Math.sin(BH) / Math.sin(INC)), ARGP = UH - NUH, NODE = LH - Math.atan2(Math.sin(UH) * Math.cos(INC), Math.cos(UH)), cN = Math.cos(NODE), sN = Math.sin(NODE), cI = Math.cos(INC), sI = Math.sin(INC);
  const EH = 2 * Math.atan(Math.sqrt((1 - ECC) / (1 + ECC)) * Math.tan(NUH / 2)), MH = EH - ECC * Math.sin(EH), RH = SMA * (1 - ECC * Math.cos(EH));
  const RS = (phone ? 29 : 36) * U, CXS = phone ? (side > 0 ? 17 * U : cols - 1 - 17 * U) : cols / 2 - side * (62 + 10 * p.off) * U, CY0 = TOP + (phone ? 40 : 39) * U, ROLL = side * ((phone ? 9 : 7) + 4 * (S() - .5)) * RD, OMS = TAU / 60;
  let Cx = 0, Cy = 0, Cz = 0, CR = 1, Fx = 0, Fy = 0, Fz = 0, Rx = 0, Ry = 0, Rz = 0, Ux = 0, Uy = 0, Uz = 0, FL = 1, PI_ = 1, PD = 0, CA = 0, XPO = 1, CYS = CY0;
  function cam(t){ let M = (MH + NMEAN * t) % TAU; if(M > Math.PI) M -= TAU; if(M < -Math.PI) M += TAU; let E = M; for(let i = 0; i < 6; i++) E -= (E - ECC * Math.sin(E) - M) / (1 - ECC * Math.cos(E));
    const nu = 2 * Math.atan2(Math.sqrt(1 + ECC) * Math.sin(E / 2), Math.sqrt(1 - ECC) * Math.cos(E / 2)), u = ARGP + nu, cu = Math.cos(u), su = Math.sin(u); CR = SMA * (1 - ECC * Math.cos(E));
    Cx = CR * (cu * cN - su * sN * cI); Cy = CR * (cu * sN + su * cN * cI); Cz = CR * su * sI; Fx = -Cx / CR; Fy = -Cy / CR; Fz = -Cz / CR;
    const h = Math.hypot(Fx, Fy), rx = Fy / h, ry = -Fx / h, ux = ry * Fz, uy = -rx * Fz, uz = rx * Fy - ry * Fx, cr = Math.cos(ROLL), sr = Math.sin(ROLL);
    Rx = rx * cr + ux * sr; Ry = ry * cr + uy * sr; Rz = uz * sr; Ux = ux * cr - rx * sr; Uy = uy * cr - ry * sr; Uz = uz * cr;
    FL = RS * Math.sqrt(RH / CR) * CR; CA = -(Fx * Lx + Fz * Lz);                                           /* CA = cosine of the phase angle */
    PI_ = .1 + .9 * Math.pow((1 + CA) / 2, 1.7); PD = .4816 / Math.pow(1.5184 + 1.44 * CA, 1.5); XPO = Math.min(2.4, .8 / (.18 + .82 * PI_)); }           /* ice scatters back; dust forward (Henyey-Greenstein, g = .72) */

  /* ---- moons: orbit radius, radius, period in days, albedo, colour; on circular orbits in the ring plane. At the static frame Mimas'
     shadow is coming onto the globe with Enceladus' behind it and Tethys stands near; the others are placed by the date. A moon smaller than a cell is
     drawn as a disc about a cell in radius with a dimmer limb, larger than life, so that it can be seen ---- */
  const MO = [[3.079, .00329, .942, .9, 22], [3.948, .00418, 1.370, 1.2, 22], [4.889, .00881, 1.888, 1, 22], [6.262, .00932, 2.737, .9, 22], [8.746, .01267, 4.518, .85, 22], [20.274, .04272, 15.945, .5, 23]];
  cam(0); const LAM0 = Math.atan2(Cy, Cx); MO.forEach((m, i) => { m[5] = i === 0 ? -6 * RD : i === 1 ? 12 * RD : i === 2 ? LAM0 - 20 * RD : S() * TAU; m[6] = OMS * .44 / m[2]; });
  /* ---- stars: a belt of sky round the camera's orbit. Counted stars (tokens) take the two data colours by the split; a few hundred faint white ones are not counted ---- */
  const NSD = Math.round(D.nPart * 1.5), NS = NSD + 301, SX = new Float32Array(NS), SY = new Float32Array(NS), SZ = new Float32Array(NS), SB = new Float32Array(NS), SC = new Uint8Array(NS);
  for(let i = 0; i < NS; i++){ const a = X.rnd() * TAU, z = (X.rnd() * 2 - 1) * .56, h = Math.sqrt(1 - z * z), u = X.rnd(), qo = X.rnd(); SX[i] = h * Math.cos(a); SY[i] = h * Math.sin(a); SZ[i] = z;
    if(i < NSD){ SB[i] = .34 + .66 * u * u * u; SC[i] = qo < D.share ? 0 : 1; } else { SB[i] = .2 + .3 * u * u; SC[i] = STARC; } }
  /* one bright white star (not counted) is placed so that just after the static frame it goes behind the sunlit ansa and crosses the rings */
  { cam(1 / sp); const a = Math.atan2(Cy, Cx) - side * 1.571, r = side > 0 ? 2.45 : 1.13, qox = r * Math.cos(a) - Cx, qy = r * Math.sin(a) - Cy, qz = -Cz, h = Math.hypot(qox, qy, qz); SX[NS - 1] = qox / h; SY[NS - 1] = qy / h; SZ[NS - 1] = qz / h; SB[NS - 1] = 1; SC[NS - 1] = STARC; }
  /* ---- spokes: five clocks; each makes a spoke now and then (hashed from its clock). A spoke is born radial, most often on the morning side
     just out of the shadow, in under two seconds; after that every radius keeps its own Kepler speed, so the spoke leans over as it fades ---- */
  const NSPK = 5, SPK = new Float32Array(NSPK * 6), ROWG = new Float32Array(rows), PS = new Float32Array(cols), Y0 = MG > 0 ? Math.round(rows * .08) : TOP;
  for(let y = 0; y < rows; y++) ROWG[y] = 1 + (phone ? .7 : .5) * clamp01((TOP + (phone ? 60 : 40) * U - y) / ((phone ? 60 : 40) * U));
  const FADE = new Float32Array(rows); for(let y = 0; y < rows; y++) FADE[y] = sstep(TOP - 1, TOP + 14 * U, y);                 /* inside the content column the picture fades in under the caption line */
  const TH = new Float32Array(N), TH2 = new Float32Array(N); for(let k = 0; k < N; k++){ const x = k % cols, y = (k / cols) | 0, a = 52.9829189 * ((.06711056 * x + .00583715 * y) % 1), b = 52.9829189 * ((.06711056 * (x + 37) + .00583715 * (y + 91)) % 1); TH[k] = a - Math.floor(a); TH2[k] = b - Math.floor(b); }   /* dither thresholds without a grid pattern */
  const mip = w => { const s = w * RI; return s < .8 ? 0 : s < 2.2 ? NR : s < 4 ? 2 * NR : s < 7.5 ? 3 * NR : s < 15 ? 4 * NR : s < 30 ? 5 * NR : s < 60 ? 6 * NR : s < 120 ? 7 * NR : s < 240 ? 8 * NR : 9 * NR; };   /* the table whose width is at least the cell's, so a thin ring is a line, not beads */
  return tm => {
    const t = (tm - 14) * sp; cam(t);
    const ox = Cx, oy = Cy, oz = Cz, ozk = oz * KZ, CC = ox * ox + oy * oy + ozk * ozk - 1, f = FL, fi = 1 / f, lit = oz * Lz > 0, aL = Lx * Lx + Lz * KZ * Lz * KZ, im0 = 1 / MU0, spin = OMS * t;
    for(let i = 0; i < NL; i++) ROFF[i] = ((spin * ROT[i] + p.yaw) / TAU % 1) * NLON;
    /* spokes alive now: [longitude at birth turned to now, inner radius, outer radius, half width, strength, age] */
    let nsp = 0; const spk = CA > .2 ? -.4 * sstep(.2, .7, CA) : .6 * sstep(.2, -.5, CA);                      /* dark in back-scattered light, bright in forward light */
    for(let i = 0; i < NSPK; i++){ const per = 15 + 7 * hash2(i, 3), tt = i < 2 ? t + per + (i ? 2.5 : -1.5) : t + 1000 + per * hash2(i, 5), e = Math.floor(tt / per), age = tt - e * per, life = per * (.6 + .38 * hash2(e, i + 9));
      if(age > life || (i > 0 && hash2(e, i + 20) < .15)) continue; const o = nsp++ * 6, r0 = 1.6 + .16 * hash2(e, i + 30), h = hash2(e, i + 40); let az = Math.PI + .4 + 5.2 * h * h;
      if(i < 2){ cam(t - age); az = Math.atan2(Cy, Cx) + (i ? -.5 + .5 * h : side * (1.3 + .2 * h)); }                 /* two of the clocks make theirs where the camera is looking: at the ansa and on the near arc */
      SPK[o] = az; SPK[o + 1] = r0; SPK[o + 2] = Math.min(1.94, r0 + .12 + .18 * hash2(e, i + 50)); SPK[o + 3] = (2.5 + 3 * hash2(e, i + 60)) * RD; SPK[o + 4] = spk * (.65 + .35 * hash2(e, i + 70)) * sstep(0, 1.2, age) * (1 - sstep(life * .5, life, age)); SPK[o + 5] = age * OMS; }
    cam(t);
    GV.fill(0, Y0 * cols); PS.fill(0);
    for(let y = Y0; y < rows; y++){ const v = (CYS - y) * fi, bx = Fx + v * Ux, by = Fy + v * Uy, bz = Fz + v * Uz, full = y >= TOP, rg = ROWG[y], rgc = rg * FADE[y];
      let sl = 0;
      for(let x = 0; x < cols; x++){ if(!full && x === MG){ x = cols - MG - 1; sl = 0; continue; }
        const u = (x - CXS) * fi, dx = bx + u * Rx, dy = by + u * Ry, dz = bz + u * Rz, il = 1 - .5 * (u * u + v * v), k = y * cols + x, th = TH[k], th2 = TH2[k];
        const dzk = dz * KZ, A = dx * dx + dy * dy + dzk * dzk, B = ox * dx + oy * dy + ozk * dzk, disc = B * B - A * CC, tg = disc > 0 ? (-B - Math.sqrt(disc)) / A : 1e9, tr = -oz / dz;
        let gv = 0, gq = 0, rv = 0, rT = 1, rc = 0, rho = 0, sh = 0;
        if(tr > 0 && tr < tg){ const qox = ox + tr * dx, qy = oy + tr * dy, r2 = qox * qox + qy * qy;
          if(r2 > RA * RA && r2 < RB * RB){ rho = Math.sqrt(r2); const t1 = -oz / (dz + Uz * fi), ax1 = ox + t1 * (dx + Ux * fi), ay1 = oy + t1 * (dy + Uy * fi), t2 = -oz / (dz + Rz * fi), ax2 = ox + t2 * (dx + Rx * fi), ay2 = oy + t2 * (dy + Ry * fi), w1 = Math.abs(Math.sqrt(ax1 * ax1 + ay1 * ay1) - rho), w2 = Math.abs(Math.sqrt(ax2 * ax2 + ay2 * ay2) - rho), w = w1 > w2 ? w1 : w2, ri = ((rho - RA) * RI) | 0, mo = mip(w) + ri, tau = TM[mo], cv = CV[mo], mu = Math.max(.004, (dz < 0 ? -dz : dz) * il);
            const bq = qox * Lx, ds = bq * bq - aL * (r2 - 1), sun = bq < 0 && ds > 0 ? 1 - clamp01(ds * 6 / (w * 10 + .012)) : 1;
            rT = 1 - cv + cv * ex(tau / mu);
            if(sun > 0){ const du = RDU[ri]; let al = RW[mo] * (PI_ * (1 - du) + PD * du) * 3.1 * sun * cv * XPO, I;
              if(lit) I = MU0 / (mu + MU0) * (1 - ex(tau * (1 / mu + im0))); else { const dm = mu - MU0; I = dm > -.002 && dm < .002 ? tau * im0 * ex(tau * im0) : MU0 / dm * (ex(tau / mu) - ex(tau * im0)); }
              if(rho > 1.5){ const an = at2(qy, qox), kp = KEP[ri];
                al *= 1 + (rho < 1.96 ? .035 : .07) * (noise((an - spin * kp) * 40.7437 + 4096, rho * 25) - .5);                     /* grain carried at the Kepler speed of this radius */
                for(let i = 0; i < nsp; i++){ const o = i * 6; if(rho < SPK[o + 1] - .03 || rho > SPK[o + 2] + .03) continue; let da = an - SPK[o] - SPK[o + 5] * kp; da -= TAU * Math.round(da / TAU); const ww = SPK[o + 3]; if(da > 3 * ww || da < -3 * ww) continue;
                  al *= 1 + SPK[o + 4] * Math.exp(-da * da / (ww * ww)) * sstep(SPK[o + 1] - .03, SPK[o + 1] + .02, rho) * (1 - sstep(SPK[o + 2] - .04, SPK[o + 2] + .03, rho)); } }
              rv = al * I; rc = PD * du > 3 * PI_ * (1 - du) ? DUSTC : -1; if(rc < 0){ const qo = RT[mo] + (rv - .5) * 2.5 + .25 + .5 * th2; rc = RP + (qo < 0 ? 0 : qo > 4 ? 4 : qo | 0); } } }
          }
        if(tg < 1e8 && rT > .02){ const px = ox + tg * dx, py = oy + tg * dy, pz = oz + tg * dz, nz0 = pz * KZ * KZ, ni = 1 / Math.sqrt(px * px + py * py + nz0 * nz0), sl_ = nz0 * ni, m0 = (px * Lx + nz0 * Lz) * ni, mu = Math.max(0, -(px * dx + py * dy + nz0 * dz) * ni * il);
          const as = sl_ < 0 ? -sl_ : sl_, li = ((.5 + (sl_ < 0 ? -.5 : .5) * (1 - Math.sqrt(1 - (as > 1 ? 1 : as)))) * (NL - 1)) | 0, jf = at2(py, px) * (NLON / TAU) - ROFF[li] + 8 * NLON, k2 = (li >> 3) * NLON + ((jf | 0) & (NLON - 1));
          let l2 = (li + T2[k2]) | 0; l2 = l2 < 0 ? 0 : l2 >= NL ? NL - 1 : l2;
          let T = 1, rs = 0;
          if(pz * Lz < 0){ const s = -pz / Lz, sx = px + s * Lx, r2 = sx * sx + py * py; if(r2 > RA * RA && r2 < RB * RB){ rs = Math.sqrt(r2); const w = sl > 0 || PS[x] > 0 ? Math.max(sl > 0 ? Math.abs(rs - sl) : 0, PS[x] > 0 ? Math.abs(rs - PS[x]) : 0) : .03, mo = mip(w) + (((rs - RA) * RI) | 0); T = 1 - CV[mo] + CV[mo] * ex(TM[mo] * im0); } }
          sl = rs; PS[x] = rs;
          const ms = m0 > -.07 ? (m0 + .07) / 1.07 : 0, lim = PWA[(ms * 256) | 0] * PWB[(mu * 256) | 0];
          gv = ALB[l2] * (1 + T1[k2]) * lim * T * 1.15 * XPO + (sl_ > .02 && m0 < .12 ? .15 * sstep(.02, .22, sl_) * (1 - .7 * sl_ * sl_) * sstep(.12, -.05, m0) * (.4 + .6 * mu) : 0);   /* ringshine: the night side north of the rings is lit by their sunlit face */
          gq = QH[l2]; if(gq < 8.6) gq -= 5 * (1 - sstep(0, .4, ms)) + 1.5 * (1 - T); else gq += 1.5 * (1 - sstep(0, .3, ms)); }
        else { sl = 0; PS[x] = 0; }
        let b = rv + rT * gv, c;
        if(b < .03) continue;
        if(rv > rT * gv) c = rc; else { const qo = gq + th; c = GP + (qo < 0 ? 0 : qo > 12 ? 12 : qo | 0); }
        b *= x >= MG && x < cols - MG ? rgc : rg; GV[k] = GAM[b >= 1.6 ? 256 : (b * 160) | 0] + (th - .5) * (c >= RP ? .045 : .1); GC[k] = c; } }
    /* stars: each one's own ray, so it dims through the fine structure of whatever ring it is behind and goes out behind the globe */
    const hf = cols / f + .1, vf = rows / f + .1;
    for(let i = 0; i < NS; i++){ const sx = SX[i], sy = SY[i], sz = SZ[i], zc = sx * Fx + sy * Fy + sz * Fz; if(zc < .8) continue; const xc = (sx * Rx + sy * Ry + sz * Rz) / zc, yc = (sx * Ux + sy * Uy + sz * Uz) / zc; if(xc > hf || xc < -hf || yc > vf || yc < -vf) continue;
      const x = Math.round(CXS + f * xc), y = Math.round(CYS - f * yc); if(x < 0 || x >= cols || y < Y0 || y >= rows || (y < TOP && x >= MG && x < cols - MG)) continue;
      const szk = sz * KZ, A = sx * sx + sy * sy + szk * szk, B = ox * sx + oy * sy + ozk * szk; if(B < 0 && B * B - A * CC > 0) continue;
      let T = 1; const tr = -oz / sz; if(tr > 0){ const qox = ox + tr * sx, qy = oy + tr * sy, r2 = qox * qox + qy * qy; if(r2 > RA * RA && r2 < RB * RB){ const mo = 2 * NR + (((Math.sqrt(r2) - RA) * RI) | 0); T = 1 - CV[mo] + CV[mo] * ex(TM[mo] / Math.max(.004, Math.abs(sz))); } }
      const b = SB[i] * T * ROWG[y], k = y * cols + x; if(SB[i] > .9 && b > .12 && GV[k] > .05){ GV[k] = Math.min(1, GV[k] + b); GC[k] = SC[i]; }   /* a bright star's light adds to the ring it shines through */
      else if(b > GV[k] + .08){ GV[k] = b; GC[k] = SC[i]; } }
    /* moons, far to near; each also throws its shadow at the globe */
    for(let i = MO.length - 1; i >= 0; i--){ const m = MO[i], an = m[5] + m[6] * t, mx = m[0] * Math.cos(an), my = m[0] * Math.sin(an), ex_ = mx - ox, ey = my - oy, ez = -oz, zc = ex_ * Fx + ey * Fy + ez * Fz; if(zc < 1) continue;
      const bq = mx * Lx, ds = bq * bq - aL * (m[0] * m[0] - 1), sun = bq < 0 && ds > 0 ? 1 - clamp01(ds * 40) : 1;
      if(sun > 0){ /* the shadow: from the moon away from the sun to the globe */
        const A = aL, B = -(mx * Lx), Cq = m[0] * m[0] - 1, dq = B * B - A * Cq; if(B < 0 && dq > 0){ const s = (-B - Math.sqrt(dq)) / A, gx = mx - s * Lx, gy = my, gz = -s * Lz, nz0 = gz * KZ * KZ, vis = (ox - gx) * gx + (oy - gy) * gy + (oz - gz) * nz0;
          if(vis > 0){ const wx = gx - ox, wy = gy - oy, wz = gz - oz, wc = wx * Fx + wy * Fy + wz * Fz, x = Math.round(CXS + f * (wx * Rx + wy * Ry + wz * Rz) / wc), y = Math.round(CYS - f * (wx * Ux + wy * Uy + wz * Uz) / wc), rr = Math.max(.9, m[1] * f / wc);
            for(let yy = Math.floor(y - rr); yy <= Math.ceil(y + rr); yy++) for(let xx = Math.floor(x - rr); xx <= Math.ceil(x + rr); xx++){ if(xx < 0 || xx >= cols || yy < Y0 || yy >= rows) continue; const d = Math.hypot(xx - x, yy - y); if(d < rr + .5 && GC[yy * cols + xx] < RP && GC[yy * cols + xx] >= GP) GV[yy * cols + xx] *= d < rr ? .1 : .6; } } } }
      const xs = CXS + f * (ex_ * Rx + ey * Ry + ez * Rz) / zc, ys = CYS - f * (ex_ * Ux + ey * Uy + ez * Uz) / zc, rr = m[1] * f / zc; if(xs < -rr - 1 || xs > cols + rr || ys < Y0 - rr || ys > rows + rr) continue;
      const ezk = ez * KZ, A = ex_ * ex_ + ey * ey + ezk * ezk, B = ox * ex_ + oy * ey + ozk * ezk, dq = B * B - A * CC; if(dq > 0 && (-B - Math.sqrt(dq)) / A < 1) continue;                              /* behind the globe */
      const T = sun;                                                                                 /* a moon is in the ring plane, so the camera's ray to it never passes through the rings */
      const ph = .5 + .5 * ((ox - mx) * Lx + (oz) * Lz) / Math.hypot(ox - mx, oy - my, oz), bm = Math.min(1, m[3] * (.25 + .75 * ph)) * T, r1 = Math.max(rr, .9 + 40 * m[1]), x0 = Math.round(xs), y0 = Math.round(ys);
      for(let yy = Math.floor(y0 - r1); yy <= Math.ceil(y0 + r1); yy++) for(let xx = Math.floor(x0 - r1); xx <= Math.ceil(x0 + r1); xx++){ if(xx < 0 || xx >= cols || yy < Y0 || yy >= rows || (yy < TOP && xx >= MG && xx < cols - MG)) continue;
        const d = Math.hypot(xx - x0, yy - y0), cov = clamp01((r1 + .55 - d) * 1.4) * (d < .5 ? 1 : .55 + .45 * clamp01(r1 - d)); if(cov <= 0) continue;
        let bb = bm * cov; if(rr > 1.5){ const nx = (xx - x0) / rr, ny = (y0 - yy) / rr, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)); bb *= clamp01(.15 + 1.1 * (nx * (Lx * Rx + Lz * Rz) + ny * (Lx * Ux + Lz * Uz) - nz * (Lx * Fx + Lz * Fz))); }
        const k = yy * cols + xx; if(bb > .08){ GV[k] = Math.max(bb * ROWG[yy], cov < 1 ? GV[k] : 0); GC[k] = m[4]; } } }
    paint(Y0, rows);
  };
}
/* 03 aurora over a frozen lake in the boreal forest (replaces the abstract flow field; an original piece).
   Modelled on real-time aurora video and photographs, not on a drawing of one.
   The aurora is a small 3D model: one curtain about 700 km north of the camera (and a faint far arc 1050 km north, low behind the fells).
   The curtain is a thin sheet whose foot is a line on the ground that swings north and south in two or three great folds; along that line it
   is sampled as rays. A ray starts at a sharp lower border about 105 to 110 km up and fades upward along the magnetic field line, which
   leans 13 degrees from the vertical. Colour follows height the way the emissions do: a pink fringe just under the border where the
   display is strong (nitrogen), green above it (oxygen, 557.7 nm), red and then violet in the faint tops (oxygen, 630 nm). Every ray is
   projected from the ground (the curve of the Earth included) onto a true-scale panorama and added into the sky, so the lower border rises
   and falls with the folds in perspective, a stretch of sheet seen edge-on is bright because the line of sight runs along it, the rays lean
   apart toward the sides of the view, and stars show through.
   Motion, at the speeds measured on real-time video: the great folds drift along the sheet at about a kilometre a second; two soft ray
   patterns run along it in opposite directions; during the breakup long brightness waves race along it. The fast event is a substorm:
   the quiet curtain, a brightening that starts at one place and spreads, the breakup (the folds deepen and one curls over, rays lengthen
   and redden on top, the pink fringe appears), then a fade into patches that switch on and off every 5 to 16 s. The still frame (tm = 14)
   is the breakup a few seconds after it starts.
   Place, at natural scale from a camera 2.5 m above a lake shore: far fells, the spruce line of the far shore, lake ice (a dark mirror where
   the wind has swept it, pale drifts elsewhere), near banks with snow-laden spruces, a cabin on a point with one lit window. The lake
   shows the sky 1.7 times higher than a flat mirror would, as rough ice draws a reflection out toward the viewer. The snow brightens and
   turns greener with the display.
   Data: how often the display breaks up follows today's tokens (every 150 s on an empty day, every 60 s at 50M tokens or more).
   Stars, lake and forest carry no data. */
function tFlow(env, X){
  const {cols, rows, ax, phone} = env, PX = env.P, U = 5 / PX, D = X.D, p = X.p, sp = p.speed, N = cols * rows, S = mulberry(p.seed ^ 0x3a51), cl = (v, a, b) => v < a ? a : v > b ? b : v;
  const PART = 31;                                                  /* which parts are drawn (curtains 1, patches 2, lake 4, stars 8, land 16): all, except while measuring */
  /* 0-9 aurora by height (pink fringe .. green .. red .. violet tops, 9 = the white-green core), 10-11 stars, 12 horizon haze, 13-14 snow under starlight / under the aurora,
     15 far fell snow, 16 forest, 17 window, 18 lamp-lit snow, 19 log wall */
  const PAL = [[236, 98, 162], [240, 170, 196], [92, 234, 124], [150, 226, 112], [198, 176, 118], [216, 104, 100], [204, 66, 96], [170, 74, 152], [124, 88, 194], [196, 255, 210],
    [214, 224, 255], [255, 226, 190], [62, 76, 128], [150, 168, 204], [142, 208, 172], [98, 114, 152], [44, 70, 72], [255, 192, 96], [214, 150, 96], [84, 62, 50]];
  const mg = phone ? 0 : Math.max(0, Math.round((env.W - 1240) / 2 / PX)), TOP = phone ? Math.round(11 * U) : Math.ceil(rows * .47) + 1, BOT = phone ? Math.round(65 * U) : rows;
  const yH = TOP + Math.round((BOT - TOP) * (phone ? .76 : .66)), DEG = Math.PI / 180, AS = cl(150 / cols, .3, .56) * DEG, flip = p.tilt < 0 ? -1 : 1, HD = (phone ? .2 : .1 + .2 * Math.abs(p.off)), cxs = cols * .5, CAM = 2.5;
  const B = new Float32Array(N), QO = new Float32Array(N), VB = new Float32Array(N), VC = new Uint8Array(N), FB = new Float32Array(N), FC = new Uint8Array(N);
  const KIND = new Uint8Array(N), SA = new Float32Array(N), SE = new Float32Array(N), SK = new Uint8Array(N), ICE = new Float32Array(N), HZ = new Float32Array(N), ST = new Float32Array(N), DT = new Float32Array(N), DH = new Float32Array(N);
  const TOPC = new Int16Array(cols), LIFT = new Float32Array(rows), inCol = x => phone || (x >= mg - 1 && x <= cols - mg);
  for(let x = 0; x < cols; x++){ TOPC[x] = inCol(x) ? TOP - (phone ? 3 : 0) : 0; for(let y = 0; y < rows; y++){ const k = x * rows + y; DT[k] = y > yH ? (hash2(x, y) - .5) / LV : dith(x, y); DH[k] = y > yH ? hash2(x + 7, y + 3) - .5 : dith(x + 2, y + 1) * LV; } }
  /* the page fades the canvas toward its top; the sky is lifted against that (up to a limit), so the brightest band stays the brightest thing on the page */
  for(let y = 0; y < rows; y++){ const u = 1 - (y + .5) / rows, mk = u < .14 ? 1 : u < .46 ? 1 - .45 * (u - .14) / .32 : .55 * (1 - (u - .46) / .54); LIFT[y] = Math.min(phone ? 2.4 : 1.4, 1 / Math.max(.05, mk)); }

  /* rows above the horizon for an elevation (radians), and the tangent of the elevation at each row */
  const RE = e => e / AS, TANE = new Float32Array(rows + 1); for(let r = 0; r <= rows; r++) TANE[r] = Math.tan(Math.min(89 * DEG, r * AS));
  /* above the band the side margins are open; next to the text column they fade the way the column does, so there is no edge between the two */
  const MF = (x, y) => { if(inCol(x)) return sstep(0, 14, y - TOPC[x] + .5); const e = cl(Math.min(mg - 1 - x, x - (cols - mg)) / Math.max(1, mg - 3), 0, 1); return Math.max(e * e, sstep(0, 14, y - TOP + .5)); };

  /* ---------------- the place (built once, in a canonical left-to-right layout, mirrored on some dates) ---------------- */
  const solid = (x, y, a, c, e) => { x = Math.round(x); y = Math.round(y); if(x < 0 || y < 0 || x >= cols || y >= rows) return; const k = x * rows + y; KIND[k] = 2; SA[k] = a; SK[k] = c; SE[k] = e || 0; };
  const distAt = j => CAM / Math.tan(Math.max(.2, j) * AS);                                        /* metres to the ground seen j rows under the horizon */
  /* far fells: massifs that rise toward the sides of the view and leave a low saddle where the lake runs out; snow faces that take the green
     of the sky, spurs running down from the crests with a lit and a shaded side, rock bands, bright crest lines; in front, low wooded hills */
  { const prof = new Float32Array(cols + 2), rdg = (v, w) => 1 - Math.abs(2 * noise(v, w) - 1);
    for(let x = -1; x <= cols; x++){ const az = (x - cxs) * AS, side = sstep(.1, 1, Math.abs(x - cxs * 1.08) / cxs);
      prof[x + 1] = (.8 + (1.2 + 3.2 * side) * Math.pow(rdg(az * 2.4 + 5, 1.5), 1.5) + 1.2 * side + .8 * rdg(az * 7 + 2, 4.5) * (.4 + side) + .3 * rdg(az * 22, 6.5)) * DEG / AS; }
    for(let x = 0; x < cols; x++){ const az = (x - cxs) * AS, r1 = prof[x + 1], sl = prof[x + 2] - prof[x], sg = sl > 0 ? 1 : -1, r2 = (.3 + 1.1 * Math.pow(noise(az * 3.1 + 40, 9.5), 1.3) + .25 * noise(az * 13, 2.5)) * DEG / AS;
      for(let y = Math.floor(yH - Math.max(r1, r2)); y <= yH + 1; y++){ const up = yH - y;
        if(up <= r2) solid(x, y, noise(x * .5, y * .9 + 9) > .72 ? .1 : .03 * noise(x * .9, y * .9), 16);
        else { const h = up / r1, dn = r1 - up, spur = .6 * noise((x + sg * dn * .9) * .2 + 8, dn * .07 + 4) + .45 * noise(x * .11 + 2, dn * .22 + 9), lit = sstep(.32, .68, spur), rock = sstep(.7, .8, noise(x * .4 + 3, up * .8 + 7)) * (1 - h);
          solid(x, y, dn < 1.1 ? .2 + .45 * cl(r1 * AS / (3.2 * DEG), 0, 1) : (.16 + .46 * lit * (.45 + .55 * h)) * (1 - .8 * rock), dn < 1.1 ? 14 : 15); } } } }
  /* the far shore: a line of small spruces in front of the fells */
  for(let x = -2; x < cols + 2;){ const h = (.6 + 1.4 * S() * S()) * DEG / AS, w = .45 + h * .2; for(let i = 0; i <= h + 1; i++){ const ww = w * Math.min(1, i / h) + .2; for(let xx = Math.ceil(x - ww); xx <= x + ww; xx++) solid(xx, yH + 2 - h + i, S() < .1 ? .1 : 0, 16); } x += .5 + 1.6 * S() * S(); }
  /* the lake: dark bare ice where the wind has swept it (widest in the middle), pale drifts elsewhere: long soft-edged forms lying flat in
     perspective, each with a brighter windward edge */
  for(let x = 0; x < cols; x++) for(let y = yH + 3; y < rows; y++){ const k = x * rows + y, dz = distAt(y - yH), lz = Math.log(dz), xw = (x - cxs) * AS * dz, j = (y - yH) / (BOT - yH), edge = Math.abs(x - cxs * 1.02) / cxs; KIND[k] = 1;
    const dr = xx => noise(xx * .02 + 3, lz * 2.2 + 8) * .62 + noise(xx * .007 + 20, lz * 1.1 + 2) * .5, n = dr(xw), win = n - .5 * Math.pow(edge, 2.4) - .3 * Math.pow(1 - j, 5) + .06;
    ICE[k] = sstep(.42, .6, win); SA[k] = cl(.8 + 9 * (dr(xw + 3) - n), .45, 1.5) * (.75 + .45 * j) * (.85 + .3 * noise(x * .5, y * .9)); }
  /* near banks: high in the left corner, lower in the right one; on phones the snow also fills what the tab bar covers */
  const HB = BOT - yH, bank = x => { const l = Math.pow(Math.max(0, 1 - x / (cols * (phone ? .4 : .3))), 1.5) * HB * (phone ? .5 : .7), r = Math.pow(Math.max(0, 1 - (cols - 1 - x) / (cols * (phone ? .28 : .2))), 1.4) * HB * (phone ? .4 : .55), m = Math.max(l, r, phone ? 1.5 : 0);
    return m + (m > .5 ? Math.min(m, 2.6) * (noise(x * .09, 77.5) - .3) : 0); };
  const gY = x => BOT - bank(cl(x, 0, cols - 1));                                                    /* row of the bank top at a column */
  const snow = (x, y, lit) => solid(x, y, lit * (.3 + .3 * noise(x * .13 + 5, y * .45 + 2) + .12 * noise(x * .7, y * 1.3)), 13);
  for(let x = 0; x < cols; x++){ if(bank(x) <= .5) continue; const y0 = Math.round(gY(x)); for(let y = Math.max(y0, yH + 3); y < rows; y++) snow(x, y, y === y0 ? 1.5 : 1.05 - .25 * Math.min(1, (y - y0) / 8)); }
  /* a snow-laden spruce, built bough by bough: a dark ragged spire, then tiers of boughs of unequal length and droop (some missing), snow
     heaped on each, a clump on some tips, shade under each; the trunk leans and bends a little. H rows tall, foot at (xc, yb). */
  const spruce = (xc, yb, H, sd) => { const R = mulberry(sd * 7919 + 13), W = Math.max(2.4, H * (.15 + .05 * R())), lean = (R() - .5) * .14, bend = (R() - .5) * .12, cxAt = i => xc + lean * i + bend * i * i / H;
    for(let i = 0; i <= H; i++){ const w = W * Math.pow(1 - i / H, .9) * .5 + .3; for(let o = -Math.round(w); o <= Math.round(w); o++) solid(cxAt(i) + o, yb - i, 0, 13); }
    for(let qo = 0; qo < Math.max(2, H * .09); qo++) solid(cxAt(H - qo), yb - H + qo, .5 - .12 * qo, 13);
    for(let down = Math.max(2, H * .09); down < H;){ const f = down / H;
      for(const sgn of [-1, 1]){ if(R() < .1) continue; const L = W * Math.pow(f, .8) * (.5 + .8 * R()) + .8, slope = .3 + .55 * R(), load = .8 + .6 * R(), x0 = cxAt(H - down); let px = x0, py = yb - H + down;
        for(let o = 0; o <= L; o++){ px = x0 + sgn * o; py = yb - H + down + o * slope; const out = o / L; solid(px, py + 1, 0, 13); solid(px, py, load * (.2 + .34 * out + .12 * R()), 13); if(L > 4 && R() < .65) solid(px, py - 1, load * (.26 + .3 * out), 13); }
        if(R() < .5){ solid(px + sgn, py + 1, load * .5, 13); if(R() < .5) solid(px + sgn, py + 2, load * .35, 13); } }
      down += Math.max(1.5, (1.5 + 1.9 * R()) * (.65 + .7 * f)); } };
  const trees = phone ? [[.03, 22, 1], [.17, 12, 2], [.97, 16, 5]]
    : [[mg * .32 / cols, 27, 1], [mg * 1.1 / cols, 20, 2], [.108, 14.5, 3], [.14, 11, 4], [.166, 8, 5], [.2, 5.5, 9], [1 - mg * .4 / cols, 22, 6], [.925, 13, 7], [.89, 9, 8]];
  /* a point of land at mid distance with the cabin: log wall, a slab of snow on the roof, a chimney, one window; lamp light on the snow below it */
  const dCab = phone ? 75 : 55, sC = 1 / (dCab * AS), xCab = Math.round(cols * (phone ? .5 : .62)), ySp = yH + Math.round(CAM * sC), wC = Math.round(6.4 * sC), hW = Math.max(3, Math.round(2.4 * sC)), hR = Math.max(2, Math.round(1.5 * sC));
  { const x0 = xCab - Math.round(cols * (phone ? .1 : .05)), x1 = xCab + wC + Math.round(cols * (phone ? .12 : .065));
    for(let x = x0; x <= x1; x++){ const e = Math.min(1, (x - x0) / 12, (x1 - x) / 16), th = Math.round((1.6 + 1.8 * noise(x * .11, 50)) * Math.sqrt(Math.max(0, e))), up = Math.round(1.3 * noise(x * .07, 53) * e); for(let i = -up; i < th; i++) snow(x, ySp + i, i === -up ? 1.4 : 1); }
    for(const [fx, hd, sd] of phone ? [[1.3, 8, 21]] : [[1.3, 10, 21], [1.75, 7.5, 23], [-.42, 8, 22], [-.8, 5.5, 24]]) spruce(xCab + fx * wC, ySp + 1, RE(hd * DEG), sd);
    for(let x = xCab; x < xCab + wC; x++) for(let i = 0; i < hW; i++) solid(x, ySp - i, i % 2 ? .1 : .05, 19);
    for(let i = 0; i < hR; i++){ const ins = Math.round(i * (wC * .09)); for(let x = xCab - 1 + ins; x <= xCab + wC - Math.round(ins * .3); x++) solid(x, ySp - hW - i, i === hR - 1 ? .72 : .5 - .06 * i + .1 * noise(x * .6, i), 13); }
    const xch = xCab + Math.round(wC * .74); solid(xch, ySp - hW - hR, .08, 19); solid(xch, ySp - hW - hR - 1, .55, 13);
    const ww = Math.max(2, Math.round(1.1 * sC)), wh = Math.max(2, Math.round(1.1 * sC)), wx = xCab + Math.round(wC * .28), wy = ySp - Math.round((hW - wh) * .5);
    for(let a = 0; a < ww; a++) for(let b = 0; b < wh; b++) solid(wx + a, wy - b, 0, 17, ww > 2 && a === 1 ? .62 : 1 - .08 * b);
    for(let x = wx - 6; x <= wx + ww + 6; x++) for(let i = 1; i <= 3; i++){ const g = Math.max(0, 1 - Math.abs(x - wx - ww * .5 + .5) / 7) * [.5, .3, .15][i - 1]; if(g > .05 && x >= 0 && x < cols){ const k = x * rows + ySp + i; if(KIND[k] === 2) SE[k] = g; else if(KIND[k] === 1) { KIND[k] = 2; SA[k] = .3; SK[k] = 13; SE[k] = g; } } } }
  for(const [fx, hd, sd] of trees){ const x = fx * cols; spruce(x, gY(x) + 1, RE(hd * DEG), sd); }
  if(flip < 0) for(const A of [KIND, SA, SE, SK, ICE]) for(let x = 0; x < cols >> 1; x++) for(let y = 0; y < rows; y++){ const a = x * rows + y, b = (cols - 1 - x) * rows + y, t = A[a]; A[a] = A[b]; A[b] = t; }
  /* inside the text column nothing is lit above the open band; below it the land fades in over a few rows */
  for(let x = 0; x < cols; x++) for(let y = 0; y < TOP + 15; y++){ const k = x * rows + y; if(KIND[k] === 2){ const f = MF(x, y); SA[k] *= f; SE[k] *= f; } }
  /* horizon haze, a little air glow low in the sky */
  for(let x = 0; x < cols; x++) for(let y = TOPC[x]; y <= yH; y++){ const k = x * rows + y; if(!KIND[k]) HZ[k] = .15 * Math.exp(-(yH - y) * AS / (5 * DEG)) * (.6 + .8 * noise(x * .05, y * .2 + 60)); }
  /* stars: scenery, about one sky cell in ninety, a few of them bright */
  const stars = []; let NS = 0; for(let x = 0; x < cols; x++) NS += Math.max(0, yH - Math.max(TOPC[x], TOP - 2)); NS = Math.round(NS / 75);
  for(let i = 0, tr = 0; i < NS && tr < NS * 60; tr++){ const x = Math.floor(X.rnd() * cols), y = Math.max(TOPC[x], TOP - 2) + 3 + Math.floor(X.rnd() * (yH - TOP - 4)), k = x * rows + y, m = X.rnd(), ph = X.rnd(), wm = X.rnd();
    if(y >= yH - 1 || KIND[k] || ST[k]) continue; ST[k] = .17 + .65 * Math.pow(m, 4); stars.push({k, y, b: ST[k], ph: ph * TAU, w: 2.5 + 5 * wm, c: wm < .16 ? 11 : 10}); i++; }
  for(let i = 0, tr = 0; i < NS / 3 && tr < NS * 20; tr++){ const x = Math.floor(X.rnd() * cols), y = yH - 2 - Math.floor(X.rnd() * 22), k = x * rows + y, m = X.rnd(), ph = X.rnd(), wm = X.rnd();                    /* a few more low in the sky, where the lower border of the curtain leaves it dark */
    if(y < TOPC[x] + 3 || KIND[k] || ST[k]) continue; ST[k] = .2 + .5 * Math.pow(m, 3); stars.push({k, y, b: ST[k], ph: ph * TAU, w: 2.5 + 5 * wm, c: 10}); i++; }
  const LAND = [], LAKE = []; for(let k = 0; k < N; k++){ if(KIND[k] === 2 && (SA[k] > 0 || SE[k] > 0)) LAND.push(k); else if(KIND[k] === 1) LAKE.push(k); }
  const LK = Int32Array.from(LAKE), LKm = new Int32Array(LK.length), LKs = new Uint8Array(LK.length);
  /* what a lake cell mirrors: the sky straight above it on the screen, 1.7 times higher than a flat mirror would show (rough ice draws reflections out toward the viewer), blurred up and down */
  LK.forEach((k, i) => { const x = (k / rows) | 0, y = k % rows, j = y - yH - 1, s = 1 + Math.round(j * .16), xo = cl(x + Math.round((noise(x * .23, y * .7) - .5) * (1 + j * .1)), 0, cols - 1); LKm[i] = xo * rows + Math.max(2 * s + 1, yH - Math.round(j * 1.7)); LKs[i] = s; });

  /* ---------------- the aurora ---------------- */
  /* light of one ray by height above its lower border (2 km steps): green rising within about 3 km and falling off with the scale height Hs,
     red from about 90 km above the border; tq = the same light weighted by where it sits on the colour ramp (0 green .. 1 red .. 1.5 violet) */
  const NP = 150, NHS = 12, NRR = 4, HSV = i => 11 * Math.pow(1.25, i), TB = [], TQ = [];
  for(let i = 0; i < NHS; i++) for(let r = 0; r < NRR; r++){ const tb = new Float32Array(NP), tq = new Float32Array(NP), Hs = HSV(i), rr = [0, .1, .22, .38][r] * (.45 + Hs / 70);
    for(let n = 0; n < NP; n++){ const h = n * 2 + 1, g = (1 - Math.exp(-h / 2.2)) * (.45 * Math.exp(-h / 10) + .62 * Math.exp(-h / Hs)), rd = rr * sstep(50, 115, h) * Math.exp(-Math.max(0, h - 115) / 60), fo = 1 - sstep(240, 298, h), b = (g + rd) * fo;
      tb[n] = b; tq[n] = b * (rd / (g + rd + 1e-6)) * (1 + .5 * sstep(190, 280, h)); } TB.push(tb); TQ.push(tq); }
  const EC = 1 / 12742, TILT = .23, HT = 170;                                                        /* Earth curvature drop per km squared; field line lean (tan 13 deg); height span used to find how a ray leans on screen */
  /* one ray: foot at (x east, z north) km, lower border h0 km, weight w, profile class, pink fringe fr. For each row of the screen the height
     at which that line of sight meets the ray is worked out (the ray leans toward the equator as it climbs, so it comes nearer or goes farther). */
  const ray = (x, z, w, h0, cls, fr) => { const d = Math.sqrt(x * x + z * z); if(d < 40) return; const colB = cxs + flip * (Math.atan2(x, z) - HD) / AS; if(colB < -70 || colB > cols + 70) return;
    const e0 = Math.atan((h0 - d * d * EC) / d), rB = RE(e0); if(e0 < -.3) return;
    const slh = (cxs + flip * (Math.atan2(x, z - TILT * HT) - HD) / AS - colB) / HT, ka = TILT * z / d, A0 = d + ka * h0, C0 = d * d * EC, tb = TB[cls], tq = TQ[cls]; w *= Math.min(1, Math.exp(-.05 * (1 / Math.sin(Math.max(.01, e0) + .025) - 3.4))) * sstep(-.07, .03, e0);        /* dimmed by the long path through the air near the horizon */
    for(let r = Math.max(0, Math.floor(rB) - (fr > 0 ? 2 : 0)); r <= yH; r++){ if(r < 0) continue; const T = TANE[r], h = (T * A0 + C0) / (1 + T * ka) - h0, cf = colB + slh * h, c = Math.floor(cf), y = yH - r; if(c < 0 || c >= cols - 1) continue;
      if(y < TOPC[c]){ if(c > mg + 14 && c < cols - mg - 14) break; continue; }
      const k = c * rows + y, w1 = w * (cf - c), w0 = w - w1; let bb, qq;
      if(h < 0){ if(h < -5) continue; bb = fr * (1 + h / 5) * .7; qq = -bb; }
      else { const i = (h * .5) | 0; if(i >= NP) break; bb = tb[i]; qq = tq[i]; if(fr > 0 && h < 4){ const f = fr * (1 - h / 4) * .6; bb += f; qq -= f; } }
      B[k] += w0 * bb; QO[k] += w0 * qq; B[k + rows] += w1 * bb; QO[k + rows] += w1 * qq; } };
  /* the curtains: 0 = the curtain, 1 = the faint far arc. Z = distance north (km), cu = bend, lm / am = length and swing of the great folds,
     l1..l3 = lengths of the smaller folds on them (km). */
  const CU = [{Z: 700, cu: -1.2e-4, lm: phone ? 500 : 600, am: 70, l1: 250, l2: 72, l3: 19, sd: 1.7, um: 2400}, {Z: 1050, cu: 2e-5, lm: 900, am: 30, l1: 330, l2: 95, l3: 25, sd: 5.3, um: 1600}];
  for(const c of CU) c.f = [S() * TAU, S() * TAU, S() * TAU, S() * TAU];
  const uM0 = 700 * Math.tan(HD - (phone ? .08 : .12)), uC = 700 * Math.tan(HD);
  /* tau = seconds from the still frame, n = which cycle (it moves the place where each breakup starts), dcy = how much of the breakup is left */
  const curtain = (ci, t, tau, n, dcy) => { const c = CU[ci], main = ci === 0, kM = TAU / c.lm, k1 = TAU / c.l1, k2 = TAU / c.l2, k3 = TAU / c.l3, sd = c.sd, on = -4.6, uF = uM0 + (n ? (hash2(n, 3) - .5) * 420 : 0) + t;
    const brk = dcy * sstep(-4.3, 1.5, tau), AM0 = c.am * (main ? 1 + .3 * brk : 1), PHI = main ? dcy * (phone ? .6 : 1) * (.8 * sstep(-4.2, 1.5, tau) + .25 * sstep(0, 12, tau)) : 0, RS = 200, step = .7 * AS;
    let u = -c.um, px = 0, pz = 0, first = true;
    while(u < c.um){
      /* how active the sheet is here: the brightening spreads from where it started; sg marks the fold that curls over, which is also the brightest part */
      const a = main ? dcy * sstep(0, 650, 85 * (tau - on) - Math.abs(u - uF) + 250) : dcy * sstep(-3, .5, tau), sg = main ? a * Math.exp(-((u - uF) * (u - uF)) / 22000) : 0;
      const E1 = (.35 + .8 * a) * (.4 + 1.1 * noise(u / 420 + sd, 7.5 + t * .013)), E2 = (.3 + .9 * a) * (.3 + 1.3 * noise(u / 150 + sd * 3, 17.5 + t * .03)), E3 = a * 1.6 * noise(u / 60 + sd * 5, 27.5 + t * .1);
      const r = u - uF, ph = PHI * Math.exp(-r * r / (RS * RS)), AM = AM0 * (1 - .92 * sstep(260, 800, Math.abs(u)));                    /* the folds flatten toward the ends, where the sheet is seen more and more along its length */
      const x = uF + r * Math.cos(ph), z = c.Z + c.cu * u * u + r * Math.sin(ph) + AM * Math.sin(kM * (u - 1.2 * t) + c.f[3]) + 12 * E1 * Math.sin(k1 * (u - 1.4 * t) + c.f[0]) + 4.5 * E2 * Math.sin(k2 * (u + 2.6 * t) + c.f[1]) + 2 * E3 * Math.sin(k3 * (u - 8 * t) + c.f[2]);
      const d = Math.sqrt(x * x + z * z), du = Math.max(1.3, step * d);
      if(first){ first = false; px = x; pz = z; u += du; continue; }
      const ds = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz)); px = x; pz = z; u += du;
      const lv = main ? (.9 + .2 * a + .1 * sg) * (1 - sstep(900, 2300, Math.abs(u - uC))) : (.2 + .3 * a) * (1 - sstep(700, 1500, Math.abs(u - uC))); if(lv < .01) continue;                    /* the curtain thins out toward its two ends */
      /* ray texture: broad bands, two soft ray patterns running against each other, and (when active) long waves that race along the sheet */
      const Rm = sstep(.1, .9, noise((u - 1.2 * t) / 60 + sd * 11, 37.5 + t * .05)), Rf = (.15 + 1.5 * sstep(.25, .75, noise((u - 5 * t) / 15 + sd * 2, 47.5))) * (.5 + noise((u + 8 * t) / 24 + sd * 4, 57.5 + t * .2));
      const Rp = noise((u - 21 * t) / 150 + sd * 7, 67.5 + t * .04), cm = .3 + .1 * a, cf = .55 + .15 * a, cp = .4 * a;
      const I = lv * (1 - cm + cm * Rm) * (1 - cf + cf * Math.min(1.6, Rf)) * (1 - cp + cp * 2 * Rp);
      const Rh = sstep(.25, .9, noise((u + 1.1 * t) / 70 + sd * 13, 77.5 + t * .08)), Hs = main ? 60 + 16 * a + (26 + 30 * a) * Rh + 10 * sg : 12 + 18 * Rh;
      const hc = cl(Math.round(Math.log(Hs / 11) / Math.log(1.25)), 0, NHS - 1), rc = main ? cl(Math.round((.8 + 2.4 * a * noise(u / 260 + sd * 17, 87.5 + t * .03)) * (.55 + .5 * Rh)), 0, NRR - 1) : 0;
      ray(x, z, 2 * I * ds / (d * AS), 110 - 6 * a * Rm - 4 * sg, hc * NRR + rc, a * cl((I - .7) * 2, 0, 1));
    } };
  /* pulsating patches (late in the substorm): flat patches of glow about 100 km up, each keeping its shape and switching on and off on its own clock */
  const PT = Array.from({length: phone ? 6 : 9}, (_, i) => ({x: (S() * 2 - 1) * (phone ? 330 : 820) + 600 * Math.tan(HD), z: 560 + 260 * S(), rx: 30 + 55 * S(), rz: 12 + 20 * S(), per: 5 + 11 * S(), ph: S(), sd: S() * 90}));
  const patch = (qo, t, lvl) => { const s = (t / qo.per + qo.ph) % 1, on = sstep(0, .07, s) * (1 - sstep(.4, .5, s)) * lvl; if(on < .03) return;
    for(let zz = -qo.rz; zz <= qo.rz; zz += 8){ const z = qo.z + zz, hw = qo.rx * Math.sqrt(1 - zz * zz / (qo.rz * qo.rz)) * (.6 + .8 * noise(zz * .09 + qo.sd, 5.5)), st = Math.max(2, .85 * AS * z);
      for(let xx = -hw; xx <= hw; xx += st){ const e = 1 - Math.abs(xx) / (hw + 1), x = qo.x + xx + t * .25; ray(x, z, on * .4 * sstep(0, .35, e) * (.6 + .8 * noise(xx * .06 + qo.sd, zz * .1)) * st / (Math.sqrt(x * x + z * z) * AS), 97, NRR, 0); } } };

  /* ---------------- drawing ---------------- */
  /* a painter that draws like the kit's round dots (one path per colour and level), with one sort buffer for the whole piece */
  const NK = PAL.length * LV, ord = new Int32Array(N), kb = new Int16Array(N), cnt = new Int32Array(NK + 1), pos = new Int32Array(NK), CSS = PAL.map(c => `${c[0]},${c[1]},${c[2]}`);
  const paint = () => { cnt.fill(0);
    for(let k = 0; k < N; k++){ const a = FB[k]; if(a < .05){ kb[k] = -1; continue; } const key = FC[k] * LV + Math.min(LV, Math.ceil(a * LV)) - 1; kb[k] = key; cnt[key + 1]++; }
    for(let i = 0; i < NK; i++){ cnt[i + 1] += cnt[i]; pos[i] = cnt[i]; }
    for(let k = 0; k < N; k++) if(kb[k] >= 0) ord[pos[kb[k]]++] = k;
    for(let key = 0; key < NK; key++){ const a0 = cnt[key], a1 = cnt[key + 1]; if(a1 === a0) continue; const ci = (key / LV) | 0, f = (key % LV + 1) / LV, rgb = CSS[ci];
      if(f > .85 && (ci < 10 || ci === 17)){ const hs = PX * 2.3, ho = (PX - hs) / 2; ax.fillStyle = `rgba(${rgb},.1)`; ax.beginPath(); for(let i = a0; i < a1; i++){ const k = ord[i]; ax.rect(((k / rows) | 0) * PX + ho, (k % rows) * PX + ho, hs, hs); } ax.fill(); }
      const r = PX * (.17 + .33 * f); ax.fillStyle = `rgba(${rgb},${(.2 + .66 * f).toFixed(3)})`; ax.beginPath();
      if(r < 1.45) for(let i = a0; i < a1; i++){ const k = ord[i]; ax.rect(((k / rows) | 0) * PX + PX / 2 - r, (k % rows) * PX + PX / 2 - r, 2 * r, 2 * r); }
      else for(let i = a0; i < a1; i++){ const k = ord[i], x = ((k / rows) | 0) * PX + PX / 2, y = (k % rows) * PX + PX / 2; ax.moveTo(x + r, y); ax.arc(x, y, r, 0, TAU); }
      ax.fill(); } };
  /* one substorm every CY seconds of the clock: 150 on an empty day, 60 at 50M tokens or more (the same number the caption reports) */
  const CY = Math.round(150 - 90 * Math.min(1, D.nPart / 1100));
  return tm => { const n = Math.floor((tm - 6) / CY), tau = (tm - 14 - n * CY) * sp, t = (tm - 14) * sp;
    /* the substorm: dcy = how much of the breakup is left, pa = strength of the pulsating patches, amb = how much the display lights the snow */
    const dcy = 1 - sstep(9, 24, tau), act = dcy * sstep(-4.6, .5, tau), pa = sstep(10, 16, tau) * (1 - sstep(27, 36, tau)), amb = .2 + .65 * act * (.85 + .3 * noise(t * .9, 91.5)) + .22 * pa, grn = .25 + .6 * act + .3 * pa;
    B.fill(0); QO.fill(0); FB.fill(0);
    if(PART & 1) for(let ci = 0; ci < 2; ci++) curtain(ci, t, tau, n, dcy);
    if((PART & 2) && pa > .02) for(const qo of PT) patch(qo, t, pa);
    /* sky: light summed along each line of sight, squeezed into the nine levels; colour from where on the rays it came from */
    const veil = .1 + .1 * act + .16 * pa;
    for(let x = 0; x < cols; x++){ const inc = inCol(x), t0 = TOPC[x]; for(let y = t0, k = x * rows + t0; y <= yH; y++, k++){ if(KIND[k]){ VB[k] = 0; continue; }
      const b = B[k] + veil * HZ[k] * 2.4, hz = HZ[k]; let v = Math.min(1, 1.65 * b / (1 + 1.5 * b)), c = 12;                    /* a soft shoulder: light stacked where sheets overlap keeps its ray texture instead of burning out */
      if(v > hz){ const qo = QO[k] / (b + 1e-6), f = qo < 0 ? (qo + 1) * 2 : 2 + qo * 4; c = cl(Math.floor(f + .5 + DH[k]), 0, 8); if(c === 2 && v > .95 + DH[k] * .1) c = 9; } else v = hz;
      VB[k] = v; VC[k] = c; FB[k] = Math.min(1, v * LIFT[y] * (y < TOP + 15 ? MF(x, y) : 1)) + DT[k]; FC[k] = c; } }
    /* stars twinkle a little, more near the horizon; they show through all but the brightest light */
    if(PART & 8) for(const s of stars){ const v = s.b * (1 + (.1 + .25 * s.y / yH * (s.y > yH - 14 ? 1 : .4)) * Math.sin(tm * s.w + s.ph)); if(v > VB[s.k] * 1.05){ FB[s.k] = Math.min(1, v * Math.min(1.5, LIFT[s.y])); FC[s.k] = s.c; } }
    /* lake: bare ice mirrors the sky above the far shore, smeared a little up and down; snow on the ice takes the colour of the display */
    if(PART & 4) for(let i = 0; i < LK.length; i++){ const k = LK[i], m = LKm[i], s = LKs[i], ice = ICE[k], r = Math.min(.62, (VB[m] * 2 + (VB[m - s] + VB[m + s]) * 1.5 + (VB[m - 2 * s] + VB[m + 2 * s]) * .5) / 6 * (.08 + .7 * ice)), sn = (1 - ice) * SA[k] * (.08 + .2 * amb);
      if(r > sn){ FB[k] = r + DT[k]; FC[k] = VC[m]; } else { FB[k] = sn + DT[k]; FC[k] = DH[k] < grn - .5 ? 14 : 13; } }
    /* land: snow lit by the sky, the window by its lamp */
    if(PART & 16) for(let i = 0; i < LAND.length; i++){ const k = LAND[i], e = SE[k], s = SA[k] * (.42 + 1.1 * amb), c = SK[k]; FB[k] = Math.min(1, e + s) + DT[k];
      FC[k] = c === 17 ? 17 : e > s * .8 ? 18 : c === 13 ? (DH[k] < grn - .5 ? 14 : 13) : c === 15 ? (DH[k] < grn - .75 ? 14 : 15) : c; }
    paint(); };
}
/* 04 meadow in wind (an original piece; replaces the abstract ripples).
   A hay meadow seen from among the grass on a day of broken cloud: the near field is level, the far field climbs to a ridge with a
   hedge and one oak. The light is low key: the field lies in cloud shadow, patches of sun travel over it, and a pale lane of sky sits
   under the cloud at the ridge.
   Wind is the subject. Every stem is an elastic rod fixed at the ground: wind bends it downwind, and when the wind lets go it swings
   back at its own frequency (1.4 to 3 times a second) and dies down. Gusts are patches that travel with the wind, so a stem's swing is
   set by how long ago the patch left it: neighbours move together and waves run through the grass behind each gust. Bent grass shows
   its pale side, so a gust is a pale band crossing the field. Now and then the breeze drops (everything stands up), then a strong
   gust front crosses: it flattens a lane of grass, shakes loose seed fluff and poppy petals, and the grass rings down behind it.
   Fine grasses stream, stiff flower stems bob; seed heads follow the stem a moment late.
   Plants: false oat-grass (loose panicles), timothy (dense spikes), an awned brome-like grass, leaf blades; field poppies (flowers,
   hooked buds, capsules), cornflowers, oxeye daisies, red clover. Animals: a roe doe that raises her head above the grass, turns it,
   swivels her ears and ducks to graze; barn swallows hawking low; butterflies and bumblebees at the flowers.
   The strong gust comes at uneven intervals of 14 to 40 seconds and with uneven strength; its front is ragged and patches of grass go
   down at different moments.
   Not physical, for the grid and the page: a stem's curve is a parabola, not a true bent rod; plants within reach of the lens bend half as
   far, so they stay in the picture; the far slope is a second plane; the sky is cloud bands laid out by angle, not a cloud deck in
   perspective; the swallows roll more than level flight needs, so their wings show; the
   butterflies' wingbeat is slowed to what 20 frames a second can show; on canvases of more than 100,000 cells the piece draws 5 px cells.
   Data: flowering stems (poppies with their buds and capsules, cornflowers, daisies, clover) = tokens (the caption count; a few stand
   just outside the frame); how hard it blows = 7-day trend. The Claude Code / Codex split and the cache are not drawn. */
function tRipple(env, X){
  const {ax, phone} = env, PX = env.cols * env.rows > 100000 ? 5 : env.P, cols = Math.floor(env.W / PX), rows = Math.floor(env.H / PX), D = X.D, p = X.p, sp = p.speed, N = cols * rows, LVN = 9;
  let PART = 31;                                                   /* bit 1 wind, 2 moving light, 4 stems and flowers, 8 animals, 16 fluff and petals */
  const S = mulberry(mix(p.seed + 4)), FLIP = p.off < 0 ? -1 : 1, sm = v => v * v * (3 - 2 * v), hs = (a, b) => mix(Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ p.seed) / 4294967296;
  /* ---- the view. TOP: first row that may be lit inside the text column; HZ: the ridge (skyline); HV: eye level, where the level near field
     would vanish; the far slope fills the rows between. F: cells per metre at one metre. The lens is CH above the ground, the grass top is HC. ---- */
  const TOP = phone ? 11 : Math.round(rows * .48), HZ = TOP + (phone ? 20 : Math.round(rows * .1)), BOT = phone ? rows - 14 : rows;
  const DF = Math.round((BOT - HZ) * .43), HV = HZ + DF - 1, CH = 1, HC = .7, K = (BOT - HV) * (phone ? 1.3 : 1.1), F = K / (CH - HC), CX = cols * .5, ZR = 230, SC = F / 132;
  const mgc = Math.max(0, (env.W - 1240) / 2 / PX), CL = phone ? 0 : Math.floor(mgc), CR = phone ? cols : Math.ceil(cols - mgc);
  const ZRW = new Float32Array(rows); for(let r = HZ + 1; r < rows; r++){ const d = r - HZ; ZRW[r] = d <= DF ? 1 / (1 / ZR + d / DF * (1 / K - 1 / ZR)) : K / (r - HV); }
  const WX = .92 * FLIP, WZ = -.39, U = 6, UG = 10, UC = 10, GM = .75, CM = 2.5, SH0 = -10, GAP = 270, WK = .8 + .4 * D.trendK;
  /* palette: 0 / 1 the data colours (not used) */
  const PA = [BLUE, OR, [46, 54, 68], [88, 98, 114], [170, 180, 190], [236, 226, 200], [108, 136, 170],        /* 2-6 sky: slate, slate, silver, cream, blue-grey */
    [58, 82, 92], [28, 54, 42], [92, 126, 70],                                                                  /* 7 far haze, 8 hedge, 9 lit tree */
    [22, 54, 38], [46, 92, 50], [86, 134, 58], [152, 178, 78], [170, 194, 156], [184, 158, 96], [228, 210, 152], [84, 120, 104], [240, 236, 212],   /* 10-13 greens, 14 pale underside, 15 tawny, 16 straw, 17 far green, 18 silver seed */
    [142, 28, 26], [224, 54, 34], [255, 118, 62], [34, 20, 38],                                                 /* 19-21 poppy, 22 dark centre */
    [76, 98, 222], [142, 162, 248], [108, 66, 172],                                                             /* 23-24 cornflower, 25 violet */
    [246, 244, 232], [168, 180, 192], [242, 198, 52],                                                           /* 26 white, 27 white in shade, 28 yellow */
    [218, 112, 172], [148, 62, 120],                                                                            /* 29-30 clover */
    [188, 118, 66], [108, 70, 46], [234, 218, 190], [18, 18, 20],                                               /* 31-32 roe coat, 33 cream, 34 black */
    [70, 98, 160], [176, 76, 44], [128, 90, 56], [234, 144, 50]];                                               /* 35 steel blue, 36 chestnut, 37 brown, 38 orange */
  /* ---- one grid, one painter: a counting sort by (colour, level), one path each ---- */
  const FB = new Float32Array(N), FK = new Uint8Array(N), KEY = new Uint16Array(N), ORD = new Int32Array(N), CNT = new Int32Array(PA.length * LVN + 1);
  const paint = () => { CNT.fill(0);
    for(let k = 0; k < N; k++){ const a = FB[k]; if(a < .05){ KEY[k] = 65535; continue; } const key = FK[k] * LVN + (a >= 1 ? LVN : Math.ceil(a * LVN)) - 1; KEY[k] = key; CNT[key + 1]++; }
    for(let i = 1; i < CNT.length; i++) CNT[i] += CNT[i - 1];
    for(let k = 0; k < N; k++){ const key = KEY[k]; if(key !== 65535) ORD[CNT[key]++] = k; }
    let i0 = 0;
    for(let key = 0; key < CNT.length - 1; key++){ const i1 = CNT[key]; if(i1 === i0) continue;
      const col = PA[(key / LVN) | 0], f = (key % LVN + 1) / LVN, s = PX * (.4 + .52 * f), o = (PX - s) / 2; ax.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${(.2 + .72 * f).toFixed(3)})`; ax.beginPath();
      for(let i = i0; i < i1; i++){ const k = ORD[i]; ax.rect((k % cols) * PX + o, ((k / cols) | 0) * PX + o, s, s); }
      ax.fill(); i0 = i1; } };
  /* set: write over what is there; put: keep the brighter. Inside the text column nothing is lit above TOP, and the first rows under it fade in. */
  const set = (c, r, b, k) => { c = Math.round(c); r = Math.round(r); if(c < 0 || r < 0 || c >= cols || r >= rows) return; if(r < TOP + 3 && c >= CL && c < CR){ if(r < TOP) return; b *= (r - TOP + 1) / 4; } const i = r * cols + c; FB[i] = b > 1 ? 1 : b; FK[i] = k; };
  const put = (c, r, b, k) => { c = Math.round(c); r = Math.round(r); if(c < 0 || r < 0 || c >= cols || r >= rows) return; if(r < TOP + 3 && c >= CL && c < CR){ if(r < TOP) return; b *= (r - TOP + 1) / 4; } const i = r * cols + c; if(b > FB[i]){ FB[i] = b > 1 ? 1 : b; FK[i] = k; } };
  const BT = Float32Array.from(BAYER, v => (v + .5) / 16), bay = (c, r) => BT[(c & 3) + ((r & 3) << 2)];
  /* ---- textures that tile: 128 x 128 sums of lattice noise, read with wrap and linear blending ---- */
  const mkTex = (bx, by, oct, gain) => { const T = new Float32Array(16384); let amp = 1, tot = 0;
    for(let o = 0; o < oct; o++){ const lx = bx << o, ly = by << o, L = new Float32Array(lx * ly); for(let i = 0; i < L.length; i++) L[i] = S();
      for(let j = 0; j < 128; j++){ const v = j * ly / 128, vi = v | 0, fv = sm(v - vi), a = (vi % ly) * lx, b = ((vi + 1) % ly) * lx;
        for(let i = 0; i < 128; i++){ const u = i * lx / 128, ui = u | 0, fu = sm(u - ui), i0 = ui % lx, i1 = (ui + 1) % lx;
          T[j * 128 + i] += amp * ((L[a + i0] + (L[a + i1] - L[a + i0]) * fu) * (1 - fv) + (L[b + i0] + (L[b + i1] - L[b + i0]) * fu) * fv); } }
      tot += amp; amp *= gain; }
    for(let i = 0; i < 16384; i++) T[i] = clamp01((T[i] / tot - .5) * 2.6 + .5); return T; };
  const smp = (T, u, v) => { const ui = Math.floor(u), vi = Math.floor(v), fu = u - ui, fv = v - vi, a = (vi & 127) << 7, b = ((vi + 1) & 127) << 7, i0 = ui & 127, i1 = (ui + 1) & 127, qo = T[a | i0], w = T[b | i0];
    return (qo + (T[a | i1] - qo) * fu) * (1 - fv) + (w + (T[b | i1] - w) * fu) * fv; };
  /* TG: breeze gusts as patches (u runs downwind, 0.75 m a texel); TR: the same with a tail upwind of each patch, the grass still swinging
     where a gust has just left; TC: cloud (2.5 m a texel; sun where it is thin); TS: streaks of the grass top; TP: what grows where */
  const TG = mkTex(4, 4, 3, .5), TR = new Float32Array(16384), TC = mkTex(7, 7, 3, .5), TS = mkTex(64, 8, 2, .6), TP = mkTex(5, 5, 3, .55);
  for(let i = 0; i < 16384; i++){ TG[i] = sstep(.5, .68, TG[i]); TC[i] = sstep(.34, .5, TC[i]); TS[i] = Math.pow(clamp01((TS[i] - .3) / .7), 1.6); }
  for(let j = 0; j < 128; j++){ let rr = 0; for(let n = 0; n < 256; n++){ const i = 127 - (n & 127), g = TG[j * 128 + i]; rr = Math.max(g, rr * .915); if(n >= 128) TR[j * 128 + i] = rr; } }
  /* the cloud texture is slid so that, in the still frame, sun falls on the near flowers and on the oak and the middle of the field is in shade, and so
     that the sun is still on the near grass when the strong gust crosses it two seconds later */
  let OU = 0, OV = 0; { let best = -9; const pr = (x, z, u, v) => smp(TC, (x * WX + z * WZ) / CM + u, (z * WX - x * WZ) / CM + v);
    for(let n = 0; n < 400; n++){ const u = S() * 128, v = S() * 128, sc = pr(-.5 * FLIP, 1.1, u, v) + pr(.4 * FLIP, 1.4, u, v) * .6 + pr(60 * FLIP, 220, u, v) * .7 - pr(0, 14, u, v) * .8 - pr(-20 * FLIP, 60, u, v) * .5 + pr(-70 * FLIP, 150, u, v) * .4 + (smp(TC, -18 / CM + u, .4 / CM + v) + smp(TC, -26 / CM + u, .4 / CM + v)) * .6;
      if(sc > best){ best = sc; OU = u; OV = v; } } }
  /* ---- time. tA: seconds from the still frame; strong gust fronts are GAP metres apart, and the one numbered 0 reaches the lens at tA = 0 ---- */
  let tA = 0, tC = 0, fS = 0;
  const K0 = TAU * 2 / U;
  /* the wind at a point (s metres downwind, c across) and a time lag: w0 steady push, w1 size of the swing left by a breeze gust,
     w2 size of the swing left by the strong gust, wd metres behind the strong front (negative: it has not arrived) */
  let w0 = 0, w1 = 0, w2 = 0, wd = 0;
  const windAt = (s, c, lag) => { if(!(PART & 1)){ w0 = w1 = w2 = 0; wd = -30; return; }
    const fw = 6 * Math.sin(c * .07 + 1.3) + 3 * Math.sin(c * .19 + .4) + 10 * smp(TP, c * .23 + 3, s * .04 + 9) - 5, qo = fS - UG * lag + fw - s + 60, n = Math.floor(qo / GAP), j = -n, d = qo - n * GAP - 60 - (n ? 130 * hs(n, 3) : 0) - 8 * smp(TP, s * .19 + 5, c * .19) + 4;
    const kg = (j === 0 ? 1 : .5 + .5 * hs(j, 7)) * clamp01(.72 + .42 * Math.sin(c * .045 + 2 + j * 1.7)) * WK;
    const e = d < -46 ? 1 : d < -32 ? 1 - .97 * sm((d + 46) / 14) : d < 26 ? .03 : d < 48 ? .03 + .97 * sm((d - 26) / 22) : 1;
    const P = d <= 0 ? 0 : d < 1.4 ? sm(d / 1.4) : d < 18 ? 1 - .15 * (d - 1.4) / 16.6 : d < 38 ? .85 * (1 - sm((d - 18) / 20)) : 0;
    const u = (s - U * (tA - lag)) / GM, v = c / GM, g = smp(TG, u, v), r = smp(TR, u, v);
    w0 = e * (.05 + .34 * g) * WK + kg * P * .95; w1 = e * .34 * (r - g) * WK; w2 = d > 18 ? kg * .42 * Math.exp(-(d - 18) / 17) : 0; wd = d; };
  const sunAt = (s, c) => smp(TC, (s - UC * tC) / CM + OU, c / CM + OV);
  /* ---- the grass top, cell by cell: what grows there (static), and per frame the light and the lean. Its texture is strokes: short and
     upright where the grass stands, long and lying downwind where it is bent (the two are blended by the lean and slide with it) ---- */
  const ALB = new Uint8Array(N), SPK = new Uint8Array(N), WRP = new Int8Array(N), VRW = new Float32Array(rows), KRW = new Uint8Array(rows);
  for(let r = HZ + 1; r < rows; r++){ const z = ZRW[r]; VRW[r] = Math.log(z) * 300; KRW[r] = Math.max(z > 30 ? 6 : 2, Math.min(12, Math.floor(GM * F / z / 1.5)));
    for(let c = 0; c < cols; c++){ const x = (c - CX) * z / F, a = smp(TP, x / 1.1 + 31, z / 1.1 + 7), f = smp(TP, x / .7 + 77, z / .7 + 55), h = hs(c, r);
      ALB[r * cols + c] = Math.round(255 * a); WRP[r * cols + c] = Math.round(250 * (smp(TP, c * .07 + 11, r * .13 + 3) - .5)); SPK[r * cols + c] = z > 9 && h < (f - .5) * .5 * Math.min(1, 30 / z + .25) ? (hs(c + 9, r) < .55 ? 20 : hs(c + 5, r + 3) < .6 ? 26 : 23) : 0; } }
  const EL = new Float32Array(cols + 10), ES = new Float32Array(cols + 10);
  const field = () => { const st = WX * .16 * F;
    for(let r = HZ + 1; r < rows; r++){ const z = ZRW[r], xs = z / F, Kk = KRW[r], M = Math.ceil((cols - 1) / Kk), far = clamp01((z - 1) / 9), hz = clamp01((z - 40) / 120), o = r * cols, vr = VRW[r], sh = st / z, near = 1 - clamp01((z - 1.1) / 2.2);
      for(let m = 0; m <= M; m++){ const x = (m * Kk - CX) * xs, s = x * WX + z * WZ, c = z * WX - x * WZ; windAt(s, c, 0);
        EL[m] = Math.max(0, w0 + w1 * Math.sin(K0 * (s - U * tA) + 4 * smp(TP, c * .2, s * .05)) + w2 * Math.sin(1.1 * (wd - 18))); ES[m] = sunAt(s, c); }
      const b0 = .25 + .17 * far - .09 * near, b1 = .16 - .04 * far, bst = 1 + 1.2 * hz, lk = .26 + .2 * far, ra = r * .88 * FLIP, rb = r * .47 * 1.25;
      for(let c = 0; c < cols; c++){ if(r < TOP + 3 && c >= CL && c < CR) continue;
        const mf = c / Kk, m = mf | 0, f = mf - m, L = EL[m] + (EL[m + 1] - EL[m]) * f, sn = ES[m] + (ES[m + 1] - ES[m]) * f, k = o + c, al = ALB[k] / 255, dt = bay(c, r), wv = WRP[k] * .045, L2 = (L * (.7 + .6 * al) - .13) * 2.7, Lc = L2 > 1 ? 1 : L2 < 0 ? 0 : L2, w = Lc < .25 ? 0 : Lc > .8 ? 1 : sm((Lc - .25) / .55);
        const tx = z > 45 ? .25 + .3 * dt : ((w < 1 ? smp(TS, (c - CX) * 1.07 - L * sh, vr) * (1 - w) : 0) + (w > 0 ? smp(TS, (c * .47 + ra) * 1.9 + wv, (c * 1.1 * FLIP - rb) * (.55 + .5 * al) - L * sh * FLIP + wv * 4) * w * (.5 + al) : 0));
        let b = ((b0 + tx * b1) * (.9 + 1.05 * sn) * (1 - hz * .5 + hz * al) + Lc * (.05 + tx * (lk + .12 * sn))) * bst, kc;
        if(SPK[k]){ kc = SPK[k]; b = (.42 + .45 * sn) * (kc === 23 ? 1.1 : 1); }
        else if(Lc * (.45 + .9 * tx) > .44 + dt * .4) kc = sn > .55 && al > .45 ? 16 : 14;
        else if(hz > dt * .9 + .05) kc = sn > .45 + dt * .2 ? (al > .5 ? 15 : 13) : al > .62 + dt * .06 ? 15 : al < .3 + dt * .06 ? 11 : 17;
        else if(sn > .35 + dt * .3) kc = far > .5 && al > .6 + dt * .3 ? 15 : tx > .5 + dt * .3 ? 13 : 12;
        else kc = b < .2 + dt * .08 ? 10 : 11;
        FB[k] = b > 1 ? 1 : b; FK[k] = kc; } } };
  /* ---- sky: cumulus laid out by angle (smaller and flatter toward the ridge), drifting with the wind: a cell is cloud where the cloud
     field is dense; it is a lit top where the field thins upward and a grey base where it thins downward. Bright sky between, palest at the
     ridge. Worked out again every third of a second and kept between. ---- */
  const SKN = (HZ + 1) * cols, SKB = new Float32Array(SKN), SKK = new Uint8Array(SKN); let skT = 1e9;
  const sky = () => { const tq = Math.floor(tC / .33); FB.fill(0, SKN); if(tq === skT){ FB.set(SKB); FK.set(SKK); return; } skT = tq; const dr = tq * .33 * .03 * FLIP;
    for(let r = 0; r <= HZ; r++){ const e = (HZ - r + .5) / F, gl = Math.exp(-e * 11), v = Math.sqrt(e) * 62, o = r * cols, up = clamp01(1.15 - e * 1.6), bias = .3 * (sstep(.015, .12, e) - .62);
      for(let c = 0; c < cols; c++){ const k = o + c; if((r < TOP && c >= CL && c < CR) || e > .75){ SKB[k] = 0; continue; }
        const a = (c - CX) / F * 70 - dr * (4 + 30 * e) + 40, n0 = smp(TP, a, v + 9), cd = sstep(.44, .56, n0 + bias), dt = bay(c, r); let b, kc;
        if(cd > .35 + dt * .5){ const top = clamp01((n0 - smp(TP, a + FLIP * 1.2, v + 12)) * 5 + .45), base = clamp01((n0 - smp(TP, a, v + 6.5)) * 5);
          b = .2 + .7 * top * (1 - .7 * base) + .1 * gl; kc = top > .62 + dt * .2 ? (top > .85 ? 26 : 5) : top > .34 + dt * .2 && base < .5 ? 4 : b > .26 ? 3 : 2; }
        else { b = .26 + .55 * gl + .1 * (1 - cd); kc = gl > .4 + dt * .3 ? 5 : gl > .16 + dt * .15 ? 4 : 6; }
        b *= (.5 + .5 * up) * 1.15; SKB[k] = b > 1 ? 1 : b; SKK[k] = kc; } }
    FB.set(SKB); FK.set(SKK); };
  /* ---- the ridge hedge, the hedge at the foot of the slope, and one oak standing on the slope (a short thick trunk and a broad crown
     of overlapping domes, lit from above; it shivers and leans a little in a gust) ---- */
  const RH = new Float32Array(cols), OAK = [], OZ = 95, OD = Math.round(DF * (1 / OZ - 1 / ZR) / (1 / K - 1 / ZR)), OH = Math.min(HZ + OD - TOP, Math.round(24 * SC)), OC = Math.round(CX + FLIP * cols * (phone ? .2 : .235));
  for(let c = 0; c < cols; c++){ const a = (c - CX) / F, t = smp(TP, a * 60 + 3, 90), g = smp(TP, a * 9 + 50, 20); RH[c] = g < .3 ? 0 : (.7 + 2.6 * Math.pow(t, 2.2) + (g > .55 ? .8 : 0)) * SC; }
  { const u = OH / 12, B = [[0, -6.9, 5.2, 3.1], [-4.4, -6.2, 3.6, 2.6], [4.6, -6.4, 3.7, 2.7], [-2.2, -9, 3.4, 2.4], [2.6, -8.9, 3.6, 2.5], [-6.6, -5.6, 2.3, 1.7], [6.9, -5.8, 2.4, 1.8], [0, -10.4, 2.5, 1.5], [-5.2, -8, 2.3, 1.7], [5.6, -7.9, 2.4, 1.8]];
    for(let dr = -Math.ceil(12 * u); dr <= 0; dr++) for(let dc = -Math.ceil(11 * u); dc <= Math.ceil(11 * u); dc++){ const x = dc / u, y = dr / u; let lit = -1;
      for(const [bx, by, rx, ry] of B){ const qox = (x - bx) / rx, qy = (y - by) / ry, qo = qox * qox + qy * qy; if(qo < 1 - .3 * hs(dc + 40, dr) && !(qo > .25 && (hs(dc, dr + 9) < .06 || smp(TP, dc * 1.1 / u * 3 + 7, dr * 1.1 / u * 3 + 3) > .8))) lit = Math.max(lit, clamp01(.4 - qy * .5 - FLIP * qox * .4 - FLIP * x * .035 + .1 * (1 - qo))); }
      if(lit < 0) for(const [bx, by] of B){ const ex = bx * .85, ey = by + .6 + 4.6, t = clamp01((x * ex + (y + 4.6) * ey) / (ex * ex + ey * ey)); if(Math.hypot(x - ex * t, y + 4.6 - ey * t) < .42 - .2 * t){ lit = -2; break; } }      /* limbs, seen where the leaves leave a gap */
      if(lit < 0 && Math.abs(x) < .95 + .6 * (y > -.8 ? 1 : 0) && y > -5) lit = -2;                                    /* trunk */
      if(lit < 0 && y > -5 && y < -3 && Math.abs(Math.abs(x) - (-(y + 3)) * 1.6 - .8) < .6) lit = -2;                   /* two limbs */
      if(lit !== -1) OAK.push(dc, dr, lit, hs(dc, dr + 70)); } }
  const hedge = (r0, zh, base) => { for(let c = 0; c < cols; c++){ const a = (c - CX) / F, g = smp(TP, a * 14 + 20 + base, 60), t = smp(TP, a * 70 + 9, 33 + base); if(g < .36) continue; const h = (1.2 + 2.4 * t * t + (t > .8 ? 1.5 : 0)) * SC, x = (c - CX) * zh / F, sn = sunAt(x * WX + zh * WZ, zh * WX - x * WZ);
      for(let j = 0; j < h; j++){ const top = j >= h - 1.2; set(c, r0 - j, (top ? .36 + .4 * sn : .24 + .12 * sn) * (.8 + .4 * hs(c, j)), top && sn > .35 ? 9 : top ? 12 : 8); } } };
  const ridge = () => { for(let c = 0; c < cols; c++){ const h = RH[c]; if(h <= 0) continue; const x = (c - CX) * ZR / F, sn = sunAt(x * WX + ZR * WZ, ZR * WX - x * WZ);
      for(let j = 0; j < h; j++){ const top = j >= h - 1; set(c, HZ - j, top ? .26 + .34 * sn : .2 + .1 * sn, top && sn > .4 ? 9 : 8); } } };
  const oak = () => { const xo = (OC - CX) * OZ / F, sO = xo * WX + OZ * WZ, cO = OZ * WX - xo * WZ, sn = sunAt(sO, cO); windAt(sO, cO, 0); const sh = Math.min(1, w0 + Math.abs(w2));
    for(let i = 0; i < OAK.length; i += 4){ const lit = OAK[i + 2], h = OAK[i + 3], hi = -OAK[i + 1] / OH, c = OC + OAK[i] + Math.round(sh * hi * hi * 1.6 * SC * FLIP + sh * .6 * hi * Math.sin(tA * 3.1 + h * 3)), r = HZ + OD + OAK[i + 1];
      if(lit === -2){ set(c, r, .2 + .1 * h, 32); continue; }
      const fl = sh * .3 * Math.sin(tA * (5 + 4 * h) + h * 40), b = (.17 + lit * (.4 + .45 * sn) + .06 * h) * (1 + fl); set(c, r, b, lit > .55 + .2 * h ? (sn > .3 ? 13 : 9) : lit > .3 + .15 * h ? 12 : 8); } };
  /* ---- plants. Kinds: 0 leaf blade, 1 oat-grass, 2 timothy, 3 awned grass, 4 poppy, 5 cornflower, 6 daisy, 7 clover. Each is a rod of height
     PH at (PX_, PZ) that bends by an angle th: its tip moves h sin th downwind and drops h (1 - cos th); between, a parabola.
     Three tiers: a few plants a hand's reach from the lens, placed by hand and drawn large; the near meadow; the middle distance, where only
     what stands above the grass top shows. ---- */
  const DEERZ = phone ? 5 : 5.5, DEERX = (phone ? -.12 : -.01) * FLIP * cols / 2 / F * DEERZ, lane = (x, z) => z < DEERZ && Math.abs(x / z - DEERX / DEERZ) * F < 15 ? x + 32 * z / F * (S() < .5 ? -1 : 1) : x;   /* nothing grows in front of the doe */
  const NFL = 40 + Math.round(.3 * Math.min(1500, D.nPart)), HERO = phone ?
    [[-.55, .6, .97, 4, .1], [.5, .55, .95, 6, .2], [.92, .8, .99, 5, .3], [-.85, .7, 1.12, 1, .4], [.85, .75, 1.12, 1, .5], [.2, .6, 1.03, 2, .6], [-.95, .9, .98, 4, .5], [.66, .9, .96, 6, .65],
     [-.9, .46, 1.3, 0, .3], [.3, .44, 1.25, 0, .8]] :
    [[-.62, .5, .96, 4, .1], [-.4, .62, 1.0, 4, .35], [-.78, .75, 1.02, 4, .5], [-.5, .55, 1.0, 4, .75], [-.3, .7, .95, 4, .9],
     [.36, .5, .94, 6, .2], [.5, .6, .99, 6, .6], [.62, .8, .97, 6, .4], [.27, .85, .93, 6, .65],
     [.76, .55, .98, 5, .3], [.68, .8, 1.0, 5, .55], [-.16, .7, .97, 5, .5], [-.92, .7, .95, 5, .45],
     [-.86, .6, 1.12, 1, .4], [-.24, .7, 1.13, 1, .2], [.14, .62, 1.1, 1, .7], [.56, .75, 1.14, 1, .5], [.9, .6, 1.1, 1, .9],
     [.22, .5, 1.02, 2, .6], [-.96, .7, 1.04, 2, .3], [.95, .75, 1.03, 2, .8], [-.11, .55, 1.0, 3, .5], [.72, .5, 1.0, 3, .2],
     [-.7, .42, 1.32, 0, .3], [.1, .45, 1.26, 0, .8], [.44, .42, 1.3, 0, .5], [.85, .44, 1.34, 0, .1], [-.35, .45, 1.22, 0, .6], [-.98, .5, 1.28, 0, .9]];
  const NH = HERO.filter(h => h[3] >= 4).length, AR = Math.min(1.5, cols / F / 2.88), N2 = Math.round((phone ? 50 : 170) * AR), N3 = Math.round((phone ? 40 : 120) * AR), NP = N2 + N3 + NFL - NH + HERO.length, ZMAX = phone ? 22 : 11;
  const PX_ = new Float32Array(NP), PZ = new Float32Array(NP), PH = new Float32Array(NP), PT = new Uint8Array(NP), PR = new Float32Array(NP), PF = new Float32Array(NP), PC = new Float32Array(NP), PA0 = new Float32Array(NP), PB0 = new Float32Array(NP), PU0 = new Float32Array(NP), PO = new Int32Array(NP), TIPX = new Float32Array(NP), TIPY = new Float32Array(NP), FLW = [];
  { const CMP = [.9, 1.15, .7, .9, .8, .7, .55, .35], hw = z => (cols / 2 + 8) / F * z; let n = 0;
    const add = (x, z, h, t, r) => { PX_[n] = x; PZ[n] = z; PH[n] = h; PT[n] = t; PR[n] = r; PF[n] = TAU * (t === 0 ? 1.6 + S() * 1.2 : t < 4 ? 1.4 + S() * 1 : 2.2 + S() * .8); PC[n] = CMP[t] * (.85 + .3 * S()) * Math.max(.5, Math.min(1, z / 1.3));
      const sd = S() < .5 ? -1 : 1; PA0[n] = t === 0 ? sd * h * (.2 + .35 * S()) : sd * h * .1 * S() * (t === 1 ? 1.6 : 1); PB0[n] = t === 0 ? .12 + .2 * S() : .02 * S(); PU0[n] = Math.min(.92, HC * (.68 + .25 * S()) / h); n++; };
    for(const [fx, z, h, t, r] of HERO) add(fx * FLIP * (cols / 2 - 6) / F * z, z, h, t, r);
    for(let i = 0; i < NFL - NH; i++){ let x = 0, z = 0; for(let k = 0; k < 6; k++){ z = 1 + (ZMAX - 1) * Math.pow(S(), 1.25); x = (S() * 2 - 1) * hw(z); if(smp(TP, x / .7 + 77, z / .7 + 55) > .35 + .3 * S()) break; }
      const qo = S(), t = qo < .4 ? 4 : qo < .62 ? 5 : qo < .87 ? 6 : 7; add(lane(x, z), z, t === 7 ? .6 + .14 * S() : t === 6 ? .78 + .2 * S() : .8 + .24 * S(), t, S()); }
    for(let i = 0; i < N2; i++){ const z = .9 + 2.6 * Math.pow(S(), .8), x = (S() * 2 - 1) * hw(z), qo = S(), t = qo < .45 ? 0 : qo < .72 ? 1 : qo < .87 ? 2 : 3; add(lane(x, z), z, t === 0 ? .8 + .4 * S() : t === 1 ? .9 + .3 * S() : .84 + .24 * S(), t, S()); }
    while(n < NP){ const z = 3.5 + 7.5 * Math.pow(S(), .7), x = (S() * 2 - 1) * hw(z), qo = S(), t = qo < .6 ? 1 : qo < .8 ? 2 : 3; add(x, z, .86 + .34 * S(), t, S()); }
    Array.from({length: NP}, (_, i) => i).sort((a, b) => PZ[b] - PZ[a]).forEach((v, i) => { PO[i] = v; });
    for(let i = 0; i < NP; i++) if(PT[i] >= 4 && PT[i] <= 6 && PZ[i] < 1.6 && !(PT[i] === 4 && PR[i] > .7)) FLW.push(i); }
  /* a flower head seen at a slant: cells of a tilted disc, read in the disc's own polar coordinates. li: sun on it; fl: flutter */
  const flower = (cx, cy, R, qo, rot, t, li, sd, fl) => { const cr = Math.cos(rot), sr = Math.sin(rot), m = Math.ceil(R + 1), lit = .8 + .36 * li;
    if(R < 1.1){ const k = t === 4 ? (li > .5 ? 21 : 20) : t === 5 ? 23 : t === 6 ? 26 : 29; set(cx, cy, .5 + .45 * li, k); if(R > .7){ set(cx + (sd > .5 ? 1 : -1), cy, .4 + .4 * li, k); if(t === 6) set(cx, cy, .6 + .3 * li, 28); } return; }
    for(let dy = -m; dy <= m; dy++) for(let dx = -m; dx <= m; dx++){ const a = (dx * cr + dy * sr) / R, bb = -dx * sr + dy * cr, back = bb < 0, v = bb / (R * (t === 4 && back ? qo + .32 : qo)), ro = Math.sqrt(a * a + v * v); if(ro > 1.02) continue;
      const th = Math.atan2(v, a), c = Math.round(cx + dx), r = Math.round(cy + dy), dt = bay(c, r); let k, b;
      if(t === 4){ if(ro > .84 + .16 * Math.cos(2 * th + sd * 6 + fl) + .06 * Math.sin(7 * th + sd * 40 + fl * 3)) continue;
        if(ro < .2 && !back){ k = 22; b = .45; } else if(ro < .36 && !back){ k = 19; b = .6 * lit; }
        else { const fold = Math.abs(Math.sin(2 * th + sd * 6 + fl + .8)) < .16; k = back ? (li > .3 + dt * .4 ? 21 : 20) : (ro > .7 + dt * .2 && li < .6 ? 19 : 20); b = (back ? .78 + .22 * ro : .6 + .25 * ro) * lit * (fold ? .62 : 1) + (back ? .1 : 0); } }
      else if(t === 6){ if(ro > 1 - .16 * (.5 + .5 * Math.cos(11 * th + sd * 9))) continue;
        if(ro < .34){ k = 28; b = (v > .1 ? .62 : .9) * lit; } else { k = back || li > .6 + dt * .3 ? 26 : 27; b = (back ? .95 : .78) * lit + .05; } }
      else if(t === 5){ if(ro > .62 + .38 * Math.abs(Math.cos(4.5 * th + sd * 5))) continue;
        if(ro < .32){ k = 25; b = .7 * lit; } else { k = ro > .6 && (back || li > .5) ? 24 : 23; b = (.72 + .25 * ro) * lit + .06; } }
      else { k = dy < -.2 * R + dt ? 29 : 30; b = (.55 + .4 * (1 - (dy + m) / (2 * m))) * lit * (.8 + .4 * hs(c, r)); }
      set(c, r, b, k); } };
  /* ---- the doe, in the middle distance where the grass is shorter: back, rump with its pale patch, neck, head with a pale chin and dark
     nose, two long ears. She lifts her head, turns it to the lens or in profile, swivels her ears and lowers it to graze. ---- */
  const deer = () => { const sc = F / DEERZ, s = DEERX * WX + DEERZ * WZ, cw = DEERZ * WX - DEERX * WZ, lt = .66 + .5 * sunAt(s, cw), bx = CX + DEERX * sc, gy = HV + CH * sc, fd = -FLIP;
    const sl = (tA + 2.6) / 5.2, si = Math.floor(sl), sf = sl - si, upn = si === 0 ? 1 : .45 + .4 * hs(si, 3), up = sm(clamp01(sf / .09)) * (1 - sm(clamp01((sf - upn) / .1)));
    const ts = (tA + 40) / 1.7, ti = Math.floor(ts), tf = sm(clamp01((ts - ti) / .16)), fa = ti === 23 || hs(ti, 5) > .5 ? 1 : 0, fb = ti === 24 || hs(ti - 1, 5) > .5 ? 1 : 0, face = fb + (fa - fb) * tf;
    const E = (x, y, rx, ry, fn) => { const c0 = bx + fd * x * sc, r0 = gy - y * sc, a = rx * sc + .35, b = ry * sc + .35;
      for(let r = Math.floor(r0 - b); r <= Math.ceil(r0 + b); r++) for(let c = Math.floor(c0 - a); c <= Math.ceil(c0 + a); c++){ const u = (c - c0) / a * fd, v = (r0 - r) / b; if(u * u + v * v > 1 || (gy - r) / sc < .5 + .07 * hs(c, 91)) continue; fn(c, r, u, v); } };
    const coat = (c, r, u, v) => set(c, r, (.3 + .5 * (v > 0 ? v : 0) + .1 * bay(c, r)) * lt, v > .3 ? 31 : 32);
    E(0, .54, .42, .16, coat); E(.3, .6, .16, .16, coat); E(-.34, .62, .19, .18, (c, r, u, v) => u < -.6 && v > -.3 ? set(c, r, .8 * lt, 33) : coat(c, r, u, v));
    const hx = .56 + .2 * (1 - up), hy = 1.0 - .62 * (1 - up), dark = (c, r) => set(c, r, .4, 34);
    for(let i = 0; i <= 8; i++){ const t = i / 8; E(.44 + (hx - .05 - .44) * t, .66 + (hy - .05 - .66) * t, .062 - .016 * t, .06, coat); }
    E(hx, hy, .075 - .022 * face, .058 + .014 * face, (c, r, u, v) => face > .5 && v < -.45 && Math.abs(u) < .45 ? dark(c, r) : face > .5 && v < -.1 && Math.abs(u) < .6 ? set(c, r, .78 * lt, 33) : coat(c, r, u, v));
    if(face < .5) E(hx + .09, hy - .028, .05, .034, (c, r, u, v) => u > .5 ? dark(c, r) : v < -.15 ? set(c, r, .78 * lt, 33) : coat(c, r, u, v));
    for(let e = -1; e <= 1; e += 2){ const es = (tA + 30 + e * 3.7) / .8, ei = Math.floor(es), ef = sm(clamp01((es - ei) / .16)), sa = hs(ei, 11 + e) - .5, sb = hs(ei - 1, 11 + e) - .5, sw = sb + (sa - sb) * ef;
      const ang = face * e * .9 + (1 - face) * (-.55 + e * .3) + sw * .5, ex = hx - .04 * (1 - face) + e * .035 * face, ey = hy + .04, n = Math.ceil(.15 * sc);
      for(let i = 1; i <= n; i++){ const d = i / sc, y = ey + Math.cos(ang) * d; if(y > .58) set(bx + fd * (ex + Math.sin(ang) * d) * sc, gy - y * sc, (i === n ? .5 : .74) * lt, i === n ? 32 : 33); } } };
  /* ---- swallows: figure-of-eight beats low over the grass; wings beat in bursts with glides between; they bank into the turns ---- */
  const BIRD = [[6.5, 3.3, 1.2, .62, 0, 0], [9, 4.6, 1.8, .5, 2.3, 1.1], [5.5, 2.9, .9, .7, 4.4, 2.9]], bp = [0, 0, 0];
  const bpos = (b, t) => { const [A, zc, B, om, p1, p2] = BIRD[b], a = om * t + p1 + Math.asin(.14 * (phone ? .5 : 1)); bp[0] = FLIP * A * Math.sin(a) * (phone ? .45 : 1); bp[2] = zc + B * Math.sin(2 * a + p2 - 1.25); bp[1] = 1.02 + .16 * Math.sin(1.3 * a + p2) + .08 * Math.sin(3.1 * a); };
  const line = (x0, y0, x1, y1, b, k, w) => { const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)))); for(let i = 0; i <= n; i++){ const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t; set(x, y, b, k); if(w > 1) set(x, y + 1, b * .85, k); } };
  const bird = b => { bpos(b, tA - .04); const x0 = bp[0], y0 = bp[1], z0 = bp[2]; bpos(b, tA + .04); const x1 = bp[0], y1 = bp[1], z1 = bp[2]; bpos(b, tA + .3); const x2 = bp[0], z2 = bp[2]; bpos(b, tA);
    const x = bp[0], y = bp[1], z = bp[2]; if(z < 1.5) return; const sc = F / z, px = CX + x * sc, py = HV + (CH - y) * sc; if(px < -20 || px > cols + 20) return;
    let fx = x1 - x0, fy = y1 - y0, fz = z1 - z0; const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    const h0 = Math.atan2(x1 - x0, z1 - z0), h1 = Math.atan2(x2 - x, z2 - z); let dh = h1 - h0; if(dh > Math.PI) dh -= TAU; if(dh < -Math.PI) dh += TAU; const bank = Math.max(-1.25, Math.min(1.25, dh * 2.6 + .95 * Math.sin(tA * 2.1 + b * 2) + .4 * Math.sin(tA * 5.3 + b)));
    /* right = up x forward, then rolled by the bank */
    let rx = fz, rz = -fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl; const cb = Math.cos(bank), sb = Math.sin(bank), Rx = rx * cb, Ry = sb, Rz = rz * cb, Ux = -rx * sb, Uy = cb, Uz = -rz * sb;
    const bs = (tA + b * 1.7) / .95, bi = Math.floor(bs), flap = bs - bi < .35 + .4 * hs(bi, 20 + b), ph = flap ? 1.2 * Math.sin(TAU * 6 * tA + b) : .55, sun = sunAt(x * WX + z * WZ, z * WX - x * WZ), lt = .8 + .3 * sun;
    const P2 = (f, r, u) => [px + (f * fx + r * Rx + u * Ux) * sc, py - (f * fy + r * Ry + u * Uy) * sc], hd = P2(.07, 0, 0), tl = P2(-.07, 0, 0), under = Uz < -.15 || y > CH + .1;
    const tri = (A, B, C, b, k) => { const x0 = Math.floor(Math.min(A[0], B[0], C[0])), x1 = Math.ceil(Math.max(A[0], B[0], C[0])), y0 = Math.floor(Math.min(A[1], B[1], C[1])), y1 = Math.ceil(Math.max(A[1], B[1], C[1])), d = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
      if(Math.abs(d) < .3 || x1 - x0 > 60 || y1 - y0 > 60){ line(A[0], A[1], C[0], C[1], b, k, 1); return; }
      for(let yy = y0; yy <= y1; yy++) for(let xx = x0; xx <= x1; xx++){ const u = ((B[1] - C[1]) * (xx - C[0]) + (C[0] - B[0]) * (yy - C[1])) / d, v = ((C[1] - A[1]) * (xx - C[0]) + (A[0] - C[0]) * (yy - C[1])) / d; if(u >= -.08 && v >= -.08 && u + v <= 1.08) set(xx, yy, b * (.8 + .3 * u), k); } };
    /* each wing: an inner panel and a long swept hand; the hand rises and falls further than the arm */
    for(let e = -1; e <= 1; e += 2){ const a = ph * .8, er = e * .075 * Math.cos(a * .6), eu = .075 * Math.sin(a * .6), tr = e * (.075 * Math.cos(a * .6) + .1 * Math.cos(a)), tu = eu + .1 * Math.sin(a), top = (e * Rz + 0) > 0 ? .85 : 1;
      tri(P2(.045, 0, 0), P2(-.02, 0, 0), P2(.03, er, eu), .8 * lt * top, under ? 33 : 6); tri(P2(-.02, 0, 0), P2(.03, er, eu), P2(-.025, er, eu), .75 * lt * top, under ? 27 : 6); tri(P2(.03, er, eu), P2(-.025, er, eu), P2(-.11, tr * 1.1, tu), .9 * lt * top, under ? 6 : 35);
      const st = P2(-.2, e * .08, 0); line(tl[0], tl[1], st[0], st[1], .7 * lt, 35, 1); }
    line(tl[0], tl[1], hd[0], hd[1], under ? .9 * lt : .74 * lt, under ? 33 : 35, sc > 22 ? 2 : 1); set(hd[0], hd[1], .75 * lt, 36); if(sc > 30) set(hd[0] - fx, hd[1] + 1, .7 * lt, 36); };
  /* ---- fluff and petals torn loose by the strong gust: each leaves when the front reaches it, rides the wind and rises or falls ---- */
  const NDB = phone ? 70 : 240, DBX = new Float32Array(NDB), DBZ = new Float32Array(NDB), DBR = new Float32Array(NDB);
  for(let i = 0; i < NDB; i++){ DBZ[i] = 1.6 + 8 * Math.pow(S(), 1.2); DBX[i] = (S() * 2 - 1) * (cols / 2 + 20) / F * DBZ[i] - FLIP * (1 + 4 * S()); DBR[i] = S(); }
  const debris = () => { for(let i = 0; i < NDB; i++){ const x0 = DBX[i], z0 = DBZ[i], r = DBR[i], s = x0 * WX + z0 * WZ, c = z0 * WX - x0 * WZ; windAt(s, c, 0);
      const age = (wd - 1 - 12 * r) / UG, life = 2.4 + 2.2 * hs(i, 31); if(age <= 0 || age > life || w0 + w2 < .05) continue;
      const pet = i % 3 === 0, dn = UG * .62 * age * (1 - .08 * age), wob = Math.sin(age * (4 + 3 * r) + i);
      const x = x0 + WX * dn + .1 * wob * age, z = z0 + WZ * dn; if(z < .6) continue; const y = .9 + (pet ? .5 * age - .32 * age * age : .22 * age + .1 * Math.sin(age * 2.2 + i)) + .06 * wob;
      if(y < HC) continue; const sc = F / z, f = Math.min(1, age * 5) * clamp01((life - age) * 2), sun = sunAt(s, c), px = CX + x * sc, py = HV + (CH - y) * sc, n = sc > 55 ? 3 : 2;
      if(pet){ const tw = Math.sin(age * 17 + i * 2); for(let k = 0; k < n; k++) put(px - FLIP * k, py + (k & 1 ? (tw > 0 ? 1 : 0) : 0), (.62 + .38 * sun) * (.65 + .35 * tw) * f * (1 - k * .2), tw > 0 ? 21 : 20); }
      else for(let k = 0; k < n + 1; k++) put(px - FLIP * k * 1.4, py + k * .3, (.6 + .4 * sun) * f * (k === 0 ? 1 : .5 - k * .1), 18); } };
  /* ---- butterflies and bumblebees keep to the near flowers ---- */
  const insects = () => { if(!FLW.length) return; const nf = FLW.length;
    for(let b = 0; b < (phone ? 2 : 3); b++){ const st = (tA + 50 + b * 2.9) / (4.6 + b * .7), si = Math.floor(st), sf = st - si, fa = FLW[Math.floor(hs(si - 1, 40 + b) * nf)], fb = FLW[Math.floor(hs(si, 40 + b) * nf)];
      const fly = sm(clamp01(sf / .5)), perched = sf > .5, zz = PZ[fb], sc = F / zz, w = Math.max(3.2, .045 * sc);
      windAt(PX_[fb] * WX + zz * WZ, zz * WX - PX_[fb] * WZ, 0); if(w0 > .55 && !perched) continue;                    /* a strong gust puts the ones in the air down into the grass */
      let cx = TIPX[fa] + (TIPX[fb] - TIPX[fa]) * fly, cy = TIPY[fa] + (TIPY[fb] - TIPY[fa]) * fly - 1.5, op;
      if(perched){ op = w0 > .3 ? .08 : .15 + .8 * sm(clamp01(.5 + .5 * Math.sin(tA * 1.3 + b * 2))); cy -= w * .3; }
      else { const a = Math.sin(Math.PI * fly), ft = tA * 6.5 + b; op = Math.abs(Math.sin(Math.PI * ft)); cx += a * w * (2.2 * Math.sin(tA * 2.3 + b * 4) + 1.2 * Math.sin(tA * 5.1 + b)); cy -= a * w * (2.5 + 1.2 * Math.sin(tA * 3.1 + b * 2)) + (1 - op) * 1.2; }
      const white = b === 2, ka = white ? 26 : 37, kb = white ? 27 : 38, al = .16 + 1.5 * op;
      for(let e = -1; e <= 1; e += 2){ const tx = cx + e * w * Math.sin(al), ty = cy - w * Math.cos(al), n = Math.ceil(w * 1.5);
        for(let i = 0; i <= n; i++){ const t = i / n, hw = Math.sin(Math.PI * Math.pow(t, .8)) * w * .34; for(let j = -Math.round(hw); j <= Math.round(hw); j++) set(cx + (tx - cx) * t + j * (perched && op < .2 ? 0 : .6) * e, cy + (ty - cy) * t + j * .5, t > .45 && t < .8 ? .85 : .62, t > .45 && t < .8 ? kb : ka); } }
      set(cx, cy, .4, 34); }
    for(let b = 0; b < (phone ? 2 : 4); b++){ const st = (tA + 80 + b * 1.3) / (2.2 + b * .5), si = Math.floor(st), sf = st - si, fa = FLW[Math.floor(hs(si - 1, 60 + b) * nf)], fb = FLW[Math.floor(hs(si, 60 + b) * nf)], go = sm(clamp01(sf / .18));
      const jx = Math.sin(tA * 23 + b * 9) * .7 + Math.sin(tA * 7 + b) * 1.2, jy = Math.sin(tA * 17 + b * 5) * .6, cx = TIPX[fa] + (TIPX[fb] - TIPX[fa]) * go + jx + 2, cy = TIPY[fa] + (TIPY[fb] - TIPY[fa]) * go + jy - 2 - 3 * Math.sin(Math.PI * go);
      set(cx, cy, .8, 28); set(cx + 1, cy, .5, 34); put(cx, cy - 1, .3, 27); } };
  /* ---- the plants, far to near ---- */
  const LS = FLIP > 0 ? 1 : -1;                                       /* the lit edge of a thick stem is on the side the sun is on */
  const NB = phone ? 2 : 3, BZ = [0, 0, 0];
  const plants = () => { let deerDone = !(PART & 8), bd = PART & 8 ? 0 : 7; for(let b = 0; b < NB; b++){ bpos(b, tA); BZ[b] = bp[2]; }
    for(let qo = 0; qo < NP; qo++){ const i = PO[qo], z = PZ[i], x = PX_[i], t = PT[i], h = PH[i], rn = PR[i];
      if(!deerDone && z < DEERZ){ deer(); deerDone = true; }
      for(let b = 0; b < NB; b++) if(!(bd >> b & 1) && z < BZ[b]){ bird(b); bd |= 1 << b; }
      const sc = F / z, bc = CX + x * sc, br = HV + CH * sc, s = x * WX + z * WZ, cw = z * WX - x * WZ;
      windAt(s, cw, .06); const ph = rn * 40, kf = PF[i] / U, swing = w1 * Math.sin(kf * (s - U * tA) + ph) + w2 * Math.sin(PF[i] / UG * (wd - 18) + ph * .2);
      let th = (w0 + swing + .05 * w0 * Math.sin(tA * (9 + 6 * rn) + ph)) * PC[i]; if(th > 1.3) th = 1.3;
      const sn = Math.sin(th), cs = Math.cos(th), Hs = h * sc, A = (h * sn * .85 * WX + PA0[i]) * sc, B = h * ((1 - cs) * .85 + PB0[i]) * sc;
      let u0 = PU0[i]; if(br - Hs * u0 > rows) u0 = (br - rows) / Hs; if(u0 > .97) continue;
      const sun = sunAt(s, cw), lt = .76 + .6 * sun, dim = z > 3.5 ? .55 : z > 1 ? .8 : 1, n = Math.max(2, Math.ceil((1 - u0) * Math.hypot(Hs, A) / .8));
      const wS = t === 0 ? Math.max(1, Math.min(4, Math.round(sc * .011))) : sc > 150 ? 2 : 1, sheen = th > .4;
      let cxp = 0, cyp = 0, cx1 = 0, cy1 = 0;
      for(let j = 0; j <= n; j++){ const f = j / n, u = u0 + (1 - u0) * f, c = bc + A * u * u, r = br - Hs * u + B * u * u; if(j === n - 2 || n < 3){ cx1 = c; cy1 = r; } cxp = c; cyp = r; if(r >= rows || r < 0) continue;
        const b = (.1 + .34 * f * f + (t === 0 ? .1 * f : 0)) * lt * dim, w = t === 0 ? Math.max(1, Math.round(wS * (1 - .8 * f * f))) : wS, kc = sheen && f > .4 ? 14 : b > .4 ? 13 : b > .22 ? 12 : 11;
        if(w === 1) set(c, r, b, kc); else for(let k = 0; k < w; k++) set(c - k * LS, r, k === 0 ? b * 1.5 + .1 : k === w - 1 ? b * .55 : b * .9, k === 0 ? (sheen ? 14 : 13) : kc); }
      TIPX[i] = cxp; TIPY[i] = cyp; if(t === 0 || cyp < -4 || cyp >= rows + 6) continue;
      let dx = cxp - cx1, dy = cyp - cy1; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
      if(t >= 4){ const R = (t === 4 ? .036 : t === 5 ? .021 : t === 6 ? .025 : .016) * (.85 + .3 * rn) * sc, fl = w0 > .2 ? Math.sin(tA * 14 + ph) * Math.min(1, w0) : 0;
        if(t === 4 && rn > .7){
          if(rn > .85){ const m = Math.max(1, R * .55), w = R > 4 ? 2 : 1;                                             /* a capsule: an urn with a flat ribbed lid */
            for(let j = 0; j <= m; j++) for(let k = -w; k <= w; k++){ if(Math.abs(k) === w && (j < m * .25)) continue; set(cxp + dx * j + k, cyp + dy * j, (k === -LS * w ? .7 : .45) * lt, k === -LS * w ? 14 : 12); }
            for(let k = -w - 1; k <= w + 1; k++) set(cxp + dx * (m + 1) + k, cyp + dy * (m + 1), .62 * lt, 15); }
          else { const hk = Math.max(1.5, R * .55), sd = PA0[i] < 0 ? -1 : 1, bw = R > 4 ? 1 : 0, bl = Math.max(1.5, R * .9);            /* a bud hanging from a hooked stalk */
            for(let j = 0; j <= 6; j++){ const a = j / 6 * 2.9; set(cxp + sd * hk * .5 * (1 - Math.cos(a)), cyp - hk * .5 * Math.sin(a), .4 * lt, 12); }
            for(let j = 0; j < bl; j++) for(let k = -bw; k <= bw; k++){ if(bw && Math.abs(k) === bw && (j < 1 || j > bl - 1.5)) continue; set(cxp + sd * hk + k, cyp + 1 + j, (k === -LS * bw ? .66 : .42) * lt, k === -LS * bw ? 13 : 12); } } }
        else flower(cxp, cyp - (t === 7 ? 0 : R * .2), R, t === 7 ? 1 : .46 + .26 * rn, Math.max(-1, Math.min(1, th * WX * .8 + PA0[i] / h * .6)) + fl * .12, t, sun * (z > 4 ? .5 : 1) - (z > 4 ? .3 : 0), rn, fl * (t === 4 ? .5 : .1));
        continue; }
      /* seed heads follow the stem a moment late: read the wind again a little in the past */
      let nod = 0; if(sc > 30){ windAt(s, cw, .22); nod = (w0 + w1 * Math.sin(kf * (s - U * (tA - .16)) + ph)) * PC[i] * WX; }
      const big = sc > 150, hb = (.42 + .45 * sun) * dim * (big ? 1.15 : .85);
      if(t === 1){ const pl = Math.max(1, .19 * (.7 + .6 * rn) * sc), m = Math.ceil(pl / .9), sd0 = PA0[i] < 0 ? -1 : 1; let ang = Math.atan2(dy, dx), hx = cxp, hy = cyp;
        if(pl < 2.2){ set(cxp, cyp, hb, 16); if(pl > 1.3) set(cxp + dx, cyp + dy, hb * .8, 15); continue; }
        for(let j = 0; j <= m; j++){ const f = j / m; ang += (.5 * nod + .22 * sd0 + .1 * LS) / m; hx += Math.cos(ang) * .9; hy += Math.sin(ang) * .9; set(hx, hy, .4 * lt, 15);
          if(j % (big ? 3 : 2) === 0){ const sd = (j & (big ? 3 : 2) ? 1 : -1) * (big && j % 2 ? -1 : 1), bl = sc * (.012 + .036 * (1 - f)), ox = sd * bl * .55 * (1 - Math.min(1, Math.abs(nod) * 1.2)) + nod * bl * 1.1, oy = bl * (.55 + .2 * hs(i, j)), ol = Math.hypot(ox, oy) || 1, kx = ox / ol, ky = oy / ol, bs = (big ? .6 + .4 * sun : .34 + .3 * sun) * dim * (.8 + .2 * hs(j, i));
            for(let k = 1; k < ol - .5; k++) put(hx + kx * k, hy + ky * k, .26 * lt, 15);
            set(hx + ox, hy + oy, bs, big && sun > .45 ? 18 : 16);
            if(bl > 3.2){ set(hx + ox + kx, hy + oy + ky, bs * .9, 16); if(big){ set(hx + ox + kx * 2, hy + oy + ky * 2, bs * .75, 16); put(hx + ox + kx * 3.4, hy + oy + ky * 3.4, .3 * lt, 16); put(hx + ox + kx * 4.6, hy + oy + ky * 4.6, .22 * lt, 16); } } } } }
      else if(t === 2){ const pl = Math.max(1, .1 * (.7 + .6 * rn) * sc), w = Math.max(0, Math.min(2, Math.round(sc * .0045 - .3))), nx = -dy, ny = dx;
        for(let j = 0; j <= pl; j++){ const ww = j < 1 || j > pl - 1 ? Math.max(0, w - 1) : w; for(let k = -ww; k <= ww; k++){ const e = k * LS < 0 ? 1 : k === 0 ? .8 : .55; set(cxp + dx * j + nx * k, cyp + dy * j + ny * k, hb * e * (.85 + .3 * hs(j + i, k)), sun > .5 && e > .7 ? 16 : 14); }
          if(big && hs(j, i) < .5){ put(cxp + dx * j + nx * (w + 1), cyp + dy * j + ny * (w + 1), .24 * lt, 16); put(cxp + dx * j - nx * (w + 1), cyp + dy * j - ny * (w + 1), .2 * lt, 16); } } }
      else { const pl = Math.max(1, .09 * (.7 + .6 * rn) * sc); let ang = Math.atan2(dy, dx), hx = cxp, hy = cyp;
        for(let j = 0; j <= pl; j++){ ang += (.9 * nod + .5 * (PA0[i] < 0 ? -1 : 1)) / (pl + 1); hx += Math.cos(ang); hy += Math.sin(ang); set(hx, hy, hb, sun > .5 ? 16 : 15); if(big) set(hx - LS, hy, hb * .7, 15);
          if(sc > 75 && j % (big ? 3 : 2) === 0) for(let e = -1; e <= 1; e += 2){ const aa = ang + e * .4, al = .075 * sc; for(let k = 2; k < al; k += 1) put(hx + Math.cos(aa) * k, hy + Math.sin(aa) * k, (.22 + .22 * sun) * (1 - k / al * .6), 16); } } } }
    if(!deerDone) deer(); for(let b = 0; b < NB; b++) if(!(bd >> b & 1)) bird(b); };
  return tm => { tA = (tm - 14) * sp; tC = PART & 2 ? tA : 0; fS = SH0 + UG * tA; sky(); ridge(); field(); hedge(HZ + DF, K, 0); hedge(HZ + Math.round(DF * .52), 1 / (1 / ZR + .52 * (1 / K - 1 / ZR)), 40); oak();
    if(PART & 4) plants(); else if(PART & 8) deer();
    if(PART & 8){ if(!(PART & 4)) for(let b = 0; b < NB; b++) bird(b); else insects(); }
    if(PART & 16 && PART & 1) debris();
    paint(); };
}
/* 05 dunes in wind (an original piece; it replaces the road grid and keeps its id and function name).
   A field of sand dunes in low afternoon sun, seen from the flank of the highest of them, just upwind of its crest, looking along the crests.
   The wind crosses the picture from left to right. The sun is 18 degrees up, ahead of the lens and to its left, out of the frame: the scene is
   lit from behind, so shade is most of the picture and the sunlit slopes and crest lines carry it.
   The ground is a real surface in metres. Two families of ridges lie across the wind: each ridge has a crest line that wanders in plan, a height
   that rises and falls along it (where a ridge is low its crest runs ahead downwind, as the horns of a barchan do), a windward (stoss) slope that
   steepens to about 14 degrees at the crest and a slip face at the angle of repose (tan 33 degrees), measured square to the crest. The dune under
   the lens is 17 m high and its crest is drawn by hand (an S through a saddle to a second top); the ridges round it are kept low so that the view
   is open, and reach about 15 m farther off, 135 m apart. Small dunes up to 4.6 m ride in the hollows and on the lower slopes.
   The picture is made once, when the piece is laid out: each column is marched from the lens outward in depth and keeps the highest row it has
   filled, so every dune is a body that hides what is behind it; each cell then knows its place on the ground, its slope, how much sun and how
   much sky it gets, whether a crest shades it (a short march toward the sun, with a soft edge) and how much air lies in front of it.
   Wind ripples (13 cm apart, crests square to the wind, wandering) are worked into the sunlight of the near slopes and fade where a cell covers
   more than a wavelength. Two far ranges of big dunes close the view.
   The still picture is painted once into an offscreen canvas; a frame copies it and repaints only the cells that differ.
   The sky is a low-key afternoon gradient with warm haze at the horizon and a few thin clouds: the far part of the same cloud field whose
   shadows cross the dunes, seen edge-on.
   A frame adds what moves: cloud shadows that slide over the field and take the sun off whatever they cross (ripples flatten with it), sand
   blown off the crests as streamers that flutter and thin downwind, lit only while they fly above the shadow of their own crest, sheets of
   saltating sand that snake low across the near slopes, both rising and dropping with the lulls and blows of the wind, now and then a slip-face
   avalanche that starts as a point under the brink (a puff of dust catches the light there) and runs down as tongues with round, grainy
   noses, shimmer on the far rows, and a string of camels on a rope, led by a man on foot, with their shadows laid along the slope.
   Data: the camels = tokens (one for every 5.5 million, up to nine, none on a day without tokens); how hard it blows = 7-day trend; how gusty = cache
   miss. The split is not drawn. The dunes, the light and the clouds carry no data. */
function tRoad(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, PX = env.P, N = cols * rows, sp = p.speed, LVN = 9, S0 = mulberry(mix(p.seed + 5));
  const SCL = phone ? 1 : Math.max(1, rows / 139), MG = phone ? 0 : Math.max(0, Math.floor((env.W - 1240) / 2 / PX));
  const TOP = phone ? Math.ceil(rows * .13) + 1 : Math.round(rows * .468), HZ = phone ? 26 : Math.round(rows * .59), F = (phone ? 235 : 330) * SCL, CX = cols * (phone ? .72 : .46);
  const PART = 127;                                   /* parts drawn: 1 ground and sky, 2 cloud shadows, 4 crest streamers, 8 saltation, 16 avalanche, 32 camels, 64 shimmer */
  /* palette: 0 / 1 the data colours; 2-3 shadow near (slate violet, lighter); 4 shadow far; 5-8 sunlit sand, low to high (rose umber, amber, gold, pale gold);
     9 sunlit far; 10 sky deep; 11 sky mid; 12 horizon haze; 13 airborne sand; 14 camel in shade; 15 camel rim; 16 warm haze at the horizon; 17 thin cloud */
  const PA = [BLUE, OR, [86, 78, 138], [126, 110, 166], [150, 138, 182], [172, 88, 64], [216, 130, 74], [240, 174, 102], [252, 218, 156], [232, 190, 160], [52, 72, 128], [86, 108, 162], [168, 164, 186], [252, 232, 196], [70, 52, 58], [244, 190, 130], [200, 150, 122], [214, 196, 190]];
  /* ---- frame buffer and painter. The still picture (ground and sky with nothing moving) is painted once into an offscreen canvas and copied
     into every frame; a frame then repaints only the cells whose level or colour differs from it (each is wiped first). One index array serves all
     (colour, level) runs (counting sort), so memory does not grow with the colours ---- */
  const FB = new Float32Array(N), FC = new Uint8Array(N), KEY = new Uint8Array(N), KEY0 = new Uint8Array(N).fill(254), ORD = new Int32Array(N), CNT = new Int32Array(PA.length * LVN + 1), off = offscreen(env);
  const TF = new Uint8Array(N), TL = new Int32Array(N); let ntl = 0;                 /* the cells a frame has written to */
  const paint = base => { const cx = base ? off.begin() : ax, n = base ? N : ntl; CNT.fill(0); let nd = 0;
    for(let i = 0; i < n; i++){ const k = base ? i : TL[i], a = FB[k], key = a < .05 ? 255 : FC[k] * LVN + (a >= 1 ? LVN : Math.ceil(a * LVN)) - 1; TF[k] = 0;
      if(base) KEY0[k] = key; else if(key === KEY0[k]) continue; if(!base) TL[nd] = k; nd++; KEY[k] = key; if(key < 255) CNT[key + 1]++; }
    if(!base){ off.blit(); if(!nd) return; cx.globalCompositeOperation = 'destination-out'; cx.fillStyle = '#000'; cx.beginPath(); for(let i = 0; i < nd; i++){ const k = TL[i]; cx.rect((k % cols) * PX, ((k / cols) | 0) * PX, PX, PX); } cx.fill(); cx.globalCompositeOperation = 'source-over'; }
    for(let i = 1; i < CNT.length; i++) CNT[i] += CNT[i - 1];
    for(let i = 0; i < nd; i++){ const k = base ? i : TL[i], key = KEY[k]; if(key < 255) ORD[CNT[key]++] = k; }
    let i0 = 0;
    for(let key = 0; key < CNT.length - 1; key++){ const i1 = CNT[key]; if(i1 === i0) continue;
      const col = PA[(key / LVN) | 0], f = (key % LVN + 1) / LVN, s = PX * (.4 + .54 * f), o = (PX - s) / 2;
      cx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${(.2 + .74 * f).toFixed(3)})`; cx.beginPath();
      for(let i = i0; i < i1; i++){ const k = ORD[i]; cx.rect((k % cols) * PX + o, ((k / cols) | 0) * PX + o, s, s); }
      cx.fill(); i0 = i1; } };
  /* ---- the ground, in metres. a = distance along the wind, b = distance along the crests; the lens looks along +z ---- */
  const PSI = .22 + .04 * p.tilt, PS0 = .17, CS = Math.cos(PSI), SN = Math.sin(PSI), ZMAX = 2300, SLIP = .65, LSF = 6;
  const XR = Math.max(CX, cols - CX) / F + .08, AMIN = (-XR * CS - SN) * ZMAX - 320, AMAX = Math.max(320, (XR * CS - SN) * ZMAX + 320);
  const mkFam = (lam, tb0, tb1, tbs, a0, a1) => { const j0 = Math.floor(a0 / lam) - 1, nj = Math.ceil(a1 / lam) + 2 - j0, n = Math.ceil((tb1 - tb0) / tbs) + 2; return {lam, tb0, tbs, n, j0, nj, s: new Float32Array(nj * n), h: new Float32Array(nj * n), qo: new Float32Array(nj * n)}; };
  const BG = mkFam(135, -340, ZMAX * 1.12 + 340, 6, AMIN, AMAX), ZS = 520, SM = mkFam(41, -120, ZS * 1.15 + 160, 2, (-XR * CS - SN) * ZS - 160, XR * CS * ZS + 160);
  const A0 = -2.5;                                      /* the lens stands on the windward slope, 2.5 m upwind of the crest of ridge 0, at its highest point */
  for(let j = 0; j < BG.nj; j++){ const J = j + BG.j0, o = j * BG.n, kj = .42 + .55 * hash2(J, 3);
    for(let i = 0; i < BG.n; i++){ const b = BG.tb0 + i * BG.tbs; let hr = clamp01(1.75 * noise(b / 190 + 31.7, J * 5.31 + 7.7) - .32), s = 78 * (noise(b / 270 + 11.3, J * 9.17 + 3.1) - .5) + 12 * (noise(b / 64 + 5.1, J * 3.7 + 1.9) - .5);
      let hm = 15 * kj * hr * (.3 + .7 * sstep(220, 640, Math.hypot(J * BG.lam, b)));          /* the dunes round the high one are low: the view is open */
      if(J === 0){ const e = sstep(280, 430, b), g1 = (b - 100) / 55, g2 = b / 55, g3 = (b - 215) / 55;          /* the dune the lens stands on: drawn by hand as far as 280 m, then it joins the field */
        hm = (1 - e) * (9.5 + 7.5 * Math.exp(-g2 * g2) + 6 * Math.exp(-g3 * g3)) + e * hm; hr = (1 - e) + e * hr;
        s = (1 - e) * (-30 * Math.exp(-g1 * g1) + 8 * sstep(150, 320, b) + 4 * p.off * Math.sin(b / 40) * sstep(30, 90, b) + (Math.tan(PS0) - Math.tan(PSI)) * b) + e * s; }
      BG.h[o + i] = hm; BG.s[o + i] = s + 26 * (1 - hr) * (1 - hr); }
    for(let i = 0; i < BG.n; i++){ const d = (BG.s[o + Math.min(BG.n - 1, i + 1)] - BG.s[o + Math.max(0, i - 1)]) / (2 * BG.tbs); BG.qo[o + i] = 1 / Math.sqrt(1 + d * d); } }
  for(let j = 0; j < SM.nj; j++){ const J = j + SM.j0, o = j * SM.n;
    for(let i = 0; i < SM.n; i++){ const b = SM.tb0 + i * SM.tbs, hr = clamp01(2.3 * noise(b / 52 + 71.7, J * 4.31 + 2.7) - .62);
      SM.h[o + i] = 4.6 * hr; SM.s[o + i] = 30 * (noise(b / 75 + 1.3, J * 7.17 + 9.1) - .5) + 9 * (1 - hr) * (1 - hr); }
    for(let i = 0; i < SM.n; i++){ const d = (SM.s[o + Math.min(SM.n - 1, i + 1)] - SM.s[o + Math.max(0, i - 1)]) / (2 * SM.tbs); SM.qo[o + i] = 1 / Math.sqrt(1 + d * d); } }
  /* height of one family at (a, b): the highest of the three ridges nearest in a. gD = distance to the crest of the ridge that wins
     (negative on the windward side), gH = its height there, gJ = which ridge */
  let gD = -1e3, gH = 1, gJ = 0;
  const fam = (G, a, b) => { const fi = (b - G.tb0) / G.tbs; let i = fi | 0; if(i < 0) i = 0; else if(i > G.n - 2) i = G.n - 2; let u = fi - i; if(u < 0) u = 0; else if(u > 1) u = 1;
    const jc = Math.round(a / G.lam); let best = 0; gD = -1e3; gH = 1; gJ = jc;
    for(let J = jc - 1; J <= jc + 1; J++){ const j = J - G.j0; if(j < 0 || j >= G.nj) continue; const o = j * G.n + i, h = G.h[o] + (G.h[o + 1] - G.h[o]) * u; if(h < .3) continue;
      const d = (a - J * G.lam - (G.s[o] + (G.s[o + 1] - G.s[o]) * u)) * (G.qo[o] + (G.qo[o + 1] - G.qo[o]) * u); let v;
      if(d < 0){ const t = -d / (h * LSF); if(t >= 1) continue; v = h * (1 - t) * Math.sqrt(1 - t); }
      else { const t = d * SLIP / h; if(t >= 1.2) continue; v = t < .8 ? h * (1 - t) : h * 1.25 * (1.2 - t) * (1.2 - t); }
      if(v > best){ best = v; gD = d; gH = h; gJ = J; } }
    return best; };
  let hD = -1e3, hH = 1, hJ = 0;                          /* the same three values for the large ridge, kept by hgt */
  const hgt = (x, z) => { const a = x * CS - z * SN + A0, b = x * SN + z * CS; let h = fam(BG, a, b); hD = gD; hH = gH; hJ = gJ;
    h += 2.6 * noise(x / 230 + 3.3, z / 230 + 9.1);
    if(z < ZS){ const mk = hD < 0 ? clamp01((-hD - 12) / 25) : clamp01((hD - hH / SLIP * .96) / 7); if(mk > 0) h += fam(SM, a, b) * mk * (z > ZS - 120 ? (ZS - z) / 120 : 1); }
    return h; };
  /* ---- light ---- */
  const EL = .32, AZ = 1.0, LX = -Math.cos(EL) * Math.cos(AZ), LY = Math.sin(EL), LZ = Math.cos(EL) * Math.sin(AZ), HTOP = 27;
  const SKN = Math.hypot(LX * 1.6, .5, LZ * 1.6), SKX = LX * 1.6 / SKN, SKY = .5 / SKN, SKZ = LZ * 1.6 / SKN, LA = LX * CS - LZ * SN;
  const EYE = 1.7, CY = hgt(0, 0) + EYE;
  const hgtB = (x, z) => fam(BG, x * CS - z * SN + A0, x * SN + z * CS) + 2.6 * noise(x / 230 + 3.3, z / 230 + 9.1);          /* the large ridges alone: enough for a shadow cast from more than 20 m off */
  const shade = (x, y, z) => { let res = 1; for(let t = 1; t < 130; t *= 1.7){ const py = y + LY * t + .05 + .012 * t; if(py > HTOP) break; const r = (py - (t < 20 ? hgt(x + LX * t, z + LZ * t) : hgtB(x + LX * t, z + LZ * t))) / t; if(r < res){ res = r; if(r <= 0) return 0; } } return res >= .035 ? 1 : res / .035; };
  /* ---- the view: per cell, where on the ground it looks ---- */
  const ZN = 1.4, RK = 1 + .034 / SCL, ZKL = []; for(let z = ZN; z < ZMAX; z *= RK) ZKL.push(z); const NK = ZKL.length, ZK = Float32Array.from(ZKL);
  const TY = new Uint8Array(N), ZC = new Float32Array(N), WA = new Float32Array(N), WB = new Float32Array(N), SD = new Float32Array(N), AM = new Float32Array(N), HZF = new Float32Array(N), DT = new Float32Array(N), SLD = new Float32Array(N), PLB = new Float32Array(N), SKB = new Float32Array(N), SKC = new Uint8Array(N);
  const skk = new Int32Array(N), ska = new Float32Array(N), skb = new Float32Array(N), skw = new Float32Array(N); let nsk = 0;
  const inCol = c => c >= MG && c < cols - MG, gainOf = r => 1 + .55 * (1 - sstep(TOP + (rows - TOP) * .1, TOP + (rows - TOP) * .62, r));
  const HAZE = 1500, RIP = .13;
  const ridge2 = (c, L) => { const u = (c - CX) / F * L; return L === 3600 ? 58 + 120 * Math.pow(noise(u / 900 + 4.2, 1.7), 1.4) + 26 * noise(u / 210, 8.8) : 70 + 190 * Math.pow(noise(u / 1500 + 9.4, 5.1), 1.5) + 30 * noise(u / 330, 2.2); };
  for(let c = 0; c < cols; c++){ const tx = (c + .5 - CX) / F, lim = inCol(c) ? TOP : 0; let top = rows, yp = rows + .5, zp = ZN;
    for(let k = 0; k < NK && top > lim; k++){ const z = ZK[k], y = HZ - (hgt(tx * z, z) - CY) / z * F, rn = Math.max(lim, Math.ceil(y - .5));
      for(let r = top - 1; r >= rn; r--){ let u = (yp - (r + .5)) / (yp - y); u = u < 0 ? 0 : u > 1 ? 1 : u; const zz = zp + (z - zp) * u, kk = r * cols + c; TY[kk] = 1; ZC[kk] = zz; }
      if(rn < top) top = rn; yp = y; zp = z; }
    /* two far ranges: large dunes 3.6 and 7 km off, lit from the left like the rest */
    for(const L of [3600, 7000]){ const y = HZ - (ridge2(c, L) - CY) / L * F, rn = Math.max(lim, Math.ceil(y - .5)), sl = clamp01(.5 + (ridge2(c + 5, L) - ridge2(c - 5, L)) * (L === 3600 ? .022 : .012));
      for(let r = top - 1; r >= rn; r--){ const kk = r * cols + c; TY[kk] = 8; ZC[kk] = L; const hz = L === 3600 ? .8 : .9, up = clamp01((r + .5 - y) / 5); SD[kk] = sl * (.5 - .2 * up) * (1 - hz) * 1.6 * gainOf(r); AM[kk] = (.46 + .06 * up) * gainOf(r); HZF[kk] = hz; WA[kk] = (c - CX) / F * L; WB[kk] = L; }
      if(rn < top) top = rn; }
    for(let r = 0; r < top; r++){ const kk = r * cols + c, e = (HZ - r - .5) / F, fade = inCol(c) ? sstep(TOP - .5, TOP + 5, r) : r >= TOP ? 1 : sstep(TOP * .25, TOP, r) * .8;          /* inside the content column nothing is lit above the open band (the caption sits there); the sky fades in just below it */
      const warm = Math.exp(-(tx + .5) * (tx + .5) / .22), ee = Math.max(0, e), b = (.2 + .26 * Math.exp(-ee / .045) + .2 * warm * Math.exp(-ee / .09)) * fade * gainOf(r), dd = dith(c, r);
      SKB[kk] = b; SKC[kk] = ee < .008 + .05 * warm + dd * .25 ? 16 : ee < .03 + .03 * warm + dd * .3 ? 12 : ee < .1 + dd * .5 ? 11 : 10;
      /* thin cloud: the cloud field that shades the dunes, continued beyond the ground in view. The band of sky in the picture is within three
         degrees of the horizon, so those clouds are kilometres off and seen edge-on: each is a streak a couple of rows deep */
      if(e > .004 && fade > .05 && !(r <= TOP && inCol(c))){ const gx = tx * 6000, gz = 6000 + e * 40000; skk[nsk] = kk; ska[nsk] = gx * CS - gz * SN + A0; skb[nsk] = gx * SN + gz * CS; skw[nsk++] = fade * gainOf(r) * (.55 + .45 * warm); } }
  }
  const nearEnd = 100;
  for(let r = 0; r < rows; r++) for(let c = 0; c < cols; c++){ const kk = r * cols + c; DT[kk] = dith(c, r) * LVN; if(TY[kk] !== 1) continue;
    const z = ZC[kk], x = (c + .5 - CX) / F * z, e = Math.max(.08, z / F * .5), h = hgt(x, z), d0 = hD, h0 = hH, hJ0 = hJ, hx = (hgt(x + e, z) - h) / e, hz = (hgt(x, z + e) - h) / e, il = 1 / Math.sqrt(1 + hx * hx + hz * hz);
    const a = x * CS - z * SN + A0, b = x * SN + z * CS, ndl = (-hx * LX + LY - hz * LZ) * il, slip = d0 > .2 && d0 < h0 / SLIP * 1.02, lee = slip || hx * CS - hz * SN < -.42, hazef = 1 - Math.exp(-z / HAZE), g = gainOf(r);
    WA[kk] = a; WB[kk] = b; HZF[kk] = hazef; if(lee) TY[kk] |= 2; if(slip && hJ0 === 0 && b < 260){ TY[kk] |= 16; SLD[kk] = d0; }
    const nf = clamp01(1 - z / 260), grain = 1 + nf * (.2 * (noise(a * 1.7 + 3, b * 1.7) - .5) + .34 * (noise(a / 6 + 9, b / 15) - .5) + .2 * (noise(a / 1.1 + 5, b / 9) - .5));
    let sun = ndl > 0 ? Math.min(1.12, ndl * 1.38) * grain * shade(x, h, z) : 0;
    /* wind ripples: a saw-tooth across the wind, bright on the long windward side and dark on the short lee, averaged over the cell's footprint */
    const fa = Math.max(Math.abs(CS) * z / F, Math.abs(SN) * z * z / (F * Math.max(.6, CY - h))) , rho = fa / RIP;
    let rp = 1; if(rho < 1.1 && !lee){ let m = 0; for(let qo = 0; qo < 3; qo++){ const aa = a + (qo - 1) * fa * .33, w = aa / RIP + 1.3 * noise(b * .42 + 17, aa * .3) + 5 * noise(b / 6 + 3, aa / 9), f = w - Math.floor(w); m += f < .7 ? .12 + .3 * f : -1.05 * Math.sin((f - .7) / .3 * Math.PI); }
      rp = 1 + m / 3 * clamp01((1.1 - rho) / .7) * .9; }
    /* skylight: brightest from the side of the sun, so shaded ground still shows which way it leans; a slip face darkens toward its foot */
    const sk = clamp01(.5 + .5 * (-hx * SKX + SKY - hz * SKZ) * il), occ = slip ? .7 + .5 * clamp01(1 - d0 * SLIP / h0) : 1;
    SD[kk] = sun * rp * (1 - hazef) * g; if(z < nearEnd && !lee && SD[kk] > .015) TY[kk] |= 4; AM[kk] = ((.36 + .5 * sk * Math.sqrt(sk)) * occ * (.92 + .08 * rp) * (.94 + .12 * (grain - 1)) * (1 - hazef) + .46 * hazef) * g; }
  const FAR = new Uint8Array(N), SHF = new Float32Array(cols), SHC = new Uint8Array(cols); let FR0 = rows, FR1 = 0; for(let kk = 0; kk < N; kk++) if(TY[kk] && ZC[kk] > 1500){ FAR[kk] = 1; const r = (kk / cols) | 0; if(r < FR0) FR0 = r; if(r > FR1) FR1 = r; }
  /* ---- clouds: a field that drifts with the upper wind; the offset is searched so that the still frame has the near dune in the sun ---- */
  const CL = 250, CVX = 8.5 * sp, CVB = 2.2 * sp; let CO = 0;
  const cloudN = (a, b, tm) => noise((a - CVX * tm) / CL + CO, (b - CVB * tm) / CL), cloud = (a, b, tm) => { const n = cloudN(a, b, tm); return n < .64 ? 0 : n > .78 ? 1 : sstep(.64, .78, n); };
  { let best = -1, bo = 0; for(let i = 0; i < 160; i++){ CO = i * .731; let sc = 0; for(const [a, b, w] of [[-8, 30, 2], [-20, 110, 2], [-60, 60, 1], [30, 200, 1]]) sc += w * (1 - cloud(a + A0, b, 14)); sc += .8 * cloud(-260 + A0, 420, 14) + .8 * cloud(-30 + A0, 60, 34) - cloud(-30 + A0, 60, 20); if(sc > best){ best = sc; bo = i; } } CO = bo * .731; }
  /* a frame looks the clouds up on a 60 m grid first; only ground under a grid square that has cloud at a corner is worked out again */
  let ga0 = 1e9, ga1 = -1e9, gb0 = 1e9, gb1 = -1e9; for(let kk = 0; kk < N; kk++) if(TY[kk] & 1){ const a = WA[kk], b = WB[kk]; if(a < ga0) ga0 = a; if(a > ga1) ga1 = a; if(b < gb0) gb0 = b; if(b > gb1) gb1 = b; }
  const GS = 60, GNX = Math.ceil((ga1 - ga0) / GS) + 1, GNY = Math.ceil((gb1 - gb0) / GS) + 1, CGV = new Uint8Array((GNX + 1) * (GNY + 1)), CGF = new Uint8Array(GNX * GNY + 1), CI = new Uint16Array(N).fill(GNX * GNY);
  for(let kk = 0; kk < N; kk++) if(TY[kk] & 1) CI[kk] = Math.min(GNX - 1, ((WA[kk] - ga0) / GS) | 0) + Math.min(GNY - 1, ((WB[kk] - gb0) / GS) | 0) * GNX;
  const cloudGrid = tm => { for(let j = 0; j <= GNY; j++) for(let i = 0; i <= GNX; i++) CGV[j * (GNX + 1) + i] = cloudN(ga0 + i * GS, gb0 + j * GS, tm) > .62 ? 1 : 0;
    for(let j = 0; j < GNY; j++) for(let i = 0; i < GNX; i++){ const o = j * (GNX + 1) + i; CGF[j * GNX + i] = CGV[o] | CGV[o + 1] | CGV[o + GNX + 1] | CGV[o + GNX + 2]; } };
  /* the clouds in the sky are far and move slowly across the picture: they are worked out twice a second (from the time rounded down to half a second) */
  const NSK = nsk, SKK = skk, SKA = ska, SKBB = skb, SKW = skw, SKL = new Int32Array(NSK), SKV = new Float32Array(NSK); let skq = -1e9, nskl = 0;
  const skyClouds = tm => { const qo = Math.floor(tm * 2); if(qo === skq) return; skq = qo; nskl = 0; const t = qo / 2; for(let i = 0; i < NSK; i++){ const v = cloud(SKA[i], SKBB[i], t * .35) * SKW[i]; if(v > .02){ SKL[nskl] = SKK[i]; SKV[nskl++] = v; } } };
  /* ---- wind: gusts are patches of stronger wind that travel downwind; trend sets how hard it blows, cache misses how gusty it is ---- */
  const WND = .5 + .5 * D.trendK, GST = .55 + .45 * clamp01(D.jitter * .5), UG = 9 * sp, US = 5.5 * sp, T14 = 14;
  /* the wind as a whole rises and drops over some seconds (lulls and blows); the still frame is taken in a blow that follows a lull */
  let GT = 0; { let best = -1; for(let i = 0; i < 200; i++){ const g = i * .377, e = t => clamp01(noise(t * .14 * sp + g, 9.3) * 2.6 - .6), sc = e(14) + .6 * e(16.5) - e(9.5) - .5 * e(11) + .4 * e(20) - .5 * e(25); if(sc > best){ best = sc; GT = g; } } }
  let GO = 0, GE = 1, GEt = NaN; const gust = (a, b, tm) => { if(tm !== GEt){ GEt = tm; GE = WND * (.3 + .7 * clamp01(noise(tm * .14 * sp + GT, 9.3) * 2.6 - .6)); } const n = noise((a - UG * (tm - T14)) / 85 + GO, b / 150 + (tm - T14) * .03 * sp + 3.7); return GE * clamp01(n * 2.8 - .78 + (1 - GST) * .7); };
  /* ---- crest lines: points along every crest the lens can see, about a cell apart; the streamers leave from them ---- */
  const crx = [], cry = [], crz = [], cra = [], crb = [], crk = [];
  const crests = (G, big) => { for(let j = 0; j < G.nj; j++){ const J = j + G.j0, o = j * G.n; let b = -10;
    while(b < (big ? 1100 : ZS - 110)){ const fi = (b - G.tb0) / G.tbs, i = fi | 0, u = fi - i; if(i < 0 || i > G.n - 2){ b += 2; continue; }
      const h = G.h[o + i] + (G.h[o + i + 1] - G.h[o + i]) * u, ap = J * G.lam + G.s[o + i] + (G.s[o + i + 1] - G.s[o + i]) * u - A0, x = ap * CS + b * SN, z = -ap * SN + b * CS;
      if(z < 3){ b += 1; continue; } const st = Math.max(.15, z / F * 1.5); b += st;
      if(h < (big ? 2 : 1.5) || Math.abs(x / z) > XR) continue;
      const y = hgt(x - .12 * CS, z + .12 * SN); if(big ? (hJ !== J || hD < -.6) : (hD > -14 && hD < hH / SLIP + 4)) continue;
      const c = Math.floor(CX + x / z * F), r = Math.floor(HZ - (y - CY) / z * F); if(c < 0 || c >= cols || r < 1 || r >= rows) continue;
      const kk = r * cols + c; if(TY[kk] && ZC[kk] < z * .96 - .4 && ZC[kk - cols] < z * .96 - .4) continue;
      if(!big && fam(SM, ap + A0 - .12, b) < h * .8) continue;
      crx.push(x); cry.push(y); crz.push(z); cra.push(ap + A0); crb.push(b); crk.push(clamp01(h / (big ? 7 : 4.5)) * (J === 0 && big ? (b < 260 ? sstep(55, 85, z) : 1) : .8) * (S0() < .5 && z > 300 ? 0 : 1)); } } };
  crests(BG, true); crests(SM, false);
  const NCR = crx.length, CRX = Float32Array.from(crx), CRY = Float32Array.from(cry), CRZ = Float32Array.from(crz), CRA = Float32Array.from(cra), CRB = Float32Array.from(crb), CRK = Float32Array.from(crk);
  /* the near crest is too close for points: there the streamer sheet is worked out per cell. Each cell's line of sight is cut with the sheet
     (level with the crest, sagging downwind); the cell keeps how far downwind of the crest and where along it the cut lies */
  const HO = -BG.j0 * BG.n, heroS = b => { const fi = (b - BG.tb0) / BG.tbs, i = fi | 0; return BG.s[HO + i] + (BG.s[HO + i + 1] - BG.s[HO + i]) * (fi - i); };
  const HYT = new Float32Array(260); for(let i = 0; i < 260; i++){ const b = i * .5 - 10, ap = heroS(b) - A0 - .12; HYT[i] = hgt(ap * CS + b * SN, -ap * SN + b * CS); }
  const heroY = b => { const f = Math.max(0, Math.min(258, (b + 10) * 2)), i = f | 0; return HYT[i] + (HYT[i + 1] - HYT[i]) * (f - i); };
  const shk = [], shd = [], shb = [];
  for(let r = HZ - 4; r < rows; r++) for(let c = 0; c < cols; c++){ const kk = r * cols + c, tx = (c + .5 - CX) / F, tyd = (HZ - r - .5) / F; if(tyd > -.004) continue;
    let z = Math.min(TY[kk] ? ZC[kk] : 80, 80), d = 0, b = 0; for(let qo = 0; qo < 6; qo++){ b = tx * z * SN + z * CS; const dc = d < 0 ? 0 : d > 9 ? 9 : d; z = .5 * z + .5 * (heroY(b) + .3 * dc - .034 * dc * dc - CY) / tyd; if(!(z > 2 && z < 95)) break; d = tx * z * CS - z * SN + A0 - heroS(tx * z * SN + z * CS); if(qo === 1 && (d < -6 || d > 16)) break; }
    if(z < 2.5 || z > 90 || d < 0 || d > 9.5 || (TY[kk] && z > ZC[kk] + .3)) continue; shk.push(kk); shd.push(d); shb.push(tx * z * SN + z * CS); }
  const NSH = shk.length, SHK = Int32Array.from(shk), SHD = Float32Array.from(shd), SHB = Float32Array.from(shb);
  /* the gust offset is searched so that the still frame has the near crest smoking */
  { let best = -1, bo = 0; for(let i = 0; i < 120; i++){ GO = i * .618; let sc = 0; for(const b of [25, 45, 70, 100]){ const j = -BG.j0 * BG.n + Math.round((b - BG.tb0) / BG.tbs); sc += gust(BG.s[j], b, 14) + .5 * gust(BG.s[j], b, 17); } sc -= .8 * gust(BG.s[-BG.j0 * BG.n + Math.round((60 - BG.tb0) / BG.tbs)], 60, 8.5); if(sc > best){ best = sc; bo = i; } } GO = bo * .618; }
  /* ---- avalanche sites: stretches of the near slip face that the lens sees well ---- */
  const bins = new Int32Array(70); for(let kk = 0; kk < N; kk++) if(TY[kk] & 16){ const i = (WB[kk] / 4) | 0; if(i >= 0 && i < 70) bins[i]++; }
  const sites = []; { let mx = 0; for(let i = 3; i < 70; i++) mx = Math.max(mx, bins[i] + bins[i - 1] + bins[i + 1 < 70 ? i + 1 : i]); for(let i = 3; i < 69; i++) if(bins[i] + bins[i - 1] + bins[i + 1] > mx * .6) sites.push(i * 4 + 2); }
  /* ---- camels: a string of dromedaries led on foot across the windward slope of the near dune, up to its crest and along it to the saddle.
     Each is a side view built from capsules (trunk, hump, a long neck carried forward and low, a head that nods twice a stride, four jointed
     legs), in metres (1.9 m at the shoulder), set on the ground where it stands, leaning with it and turned to its heading; its shadow is the
     same figure laid on the slope away from the sun. On a narrow screen the path is nearer the lens ---- */
  const NCAM = Math.min(9, Math.round(D.nPart / 120)), CSH = new Uint8Array(N), cshl = new Int32Array(4096); let ncsh = 0;
  const PTH = phone ? [[-70, 26], [-40, 34], [-12, 41], [-14, 50], [-21, 64], [-27, 76], [-32, 90], [-37.5, 103]] : [[-96, 34], [-50, 47], [-21.5, 56], [-23, 66], [-27, 76], [-32, 90], [-37.5, 103]], PLN = [0]; for(let b = 118; b <= 268; b += 15) PTH.push([heroS(b) - 2.5, b]);          /* past the saddle it keeps to the windward side of the crest and is lost to sight in the distance */
  for(let i = 1; i < PTH.length; i++) PLN.push(PLN[i - 1] + Math.hypot(PTH[i][0] - PTH[i - 1][0], PTH[i][1] - PTH[i - 1][1]));
  const pathAt = (qo, o) => { let i = 1; while(i < PTH.length - 1 && PLN[i] < qo) i++; const u = (qo - PLN[i - 1]) / (PLN[i] - PLN[i - 1]); o[0] = PTH[i - 1][0] + (PTH[i][0] - PTH[i - 1][0]) * u; o[1] = PTH[i - 1][1] + (PTH[i][1] - PTH[i - 1][1]) * u; };
  const sdSeg = (px, py, x1, y1, x2, y2, r) => { const dx = x2 - x1, dy = y2 - y1, qox = px - x1, qy = py - y1; let h = (qox * dx + qy * dy) / (dx * dx + dy * dy); h = h < 0 ? 0 : h > 1 ? 1 : h; const ex = qox - dx * h, ey = qy - dy * h; return Math.sqrt(ex * ex + ey * ey) - r; };
  /* a leg: the foot rests on the ground and slides back for six tenths of the stride, then lifts and swings forward; the knee of a foreleg
     folds forward as it lifts, the hock of a hind leg stays bent backward. Both legs of one side move together (the pace) */
  const leg = (u, v, f, hx, hy, fore, reach, mr) => { const cy = f - Math.floor(f), st = cy < .6, tau = st ? cy / .6 : (cy - .6) / .4, fx = hx + reach * (st ? 1 - 2 * tau : 2 * tau - 1), lf = st ? 0 : Math.sin(Math.PI * tau) * .24;
    const jx = (hx + fx) / 2 + (fore ? .03 + .7 * lf : -.1 - .45 * lf), jy = (hy + lf) / 2 + .06; return Math.min(sdSeg(u, v, hx, hy, jx, jy, Math.max(fore ? .085 : .105, mr)), sdSeg(u, v, jx, jy, fx, lf + .05, Math.max(.06, mr))); };
  const camel = (u, v, ph, mr) => { const nb = .05 * Math.sin(TAU * ph * 2), hu = (u + .1) / .46, hv = (v - 1.93) / .34;
    let d = Math.min(sdSeg(u, v, -.7, 1.5, .6, 1.52, .36), (Math.sqrt(hu * hu + hv * hv) - 1) * .34, sdSeg(u, v, .72, 1.5, 1.2, 1.42 + nb * .5, .17), sdSeg(u, v, 1.2, 1.42 + nb * .5, 1.62, 1.98 + nb, Math.max(.12, mr)), sdSeg(u, v, 1.62, 2.03 + nb, 2.02, 1.9 + nb, Math.max(.095, mr)), sdSeg(u, v, -1.06, 1.62, -1.16, 1.12, .045));
    if(v < 1.5) d = Math.min(d, leg(u, v, ph, .5, 1.32, true, .42, mr), leg(u, v, ph + .5, .5, 1.32, true, .42, mr), leg(u, v, ph + .06, -.68, 1.34, false, .42, mr), leg(u, v, ph + .56, -.68, 1.34, false, .42, mr));
    return d; };
  const walker = (u, v, ph, mr) => Math.min(sdSeg(u, v, 0, .86, .05, 1.38, .17), sdSeg(u, v, .08, 1.61, .08, 1.63, .115), leg(u, v, ph * 2.6, 0, .86, true, .3, mr), leg(u, v, ph * 2.6 + .5, 0, .86, true, .3, mr), sdSeg(u, v, .04, 1.32, -.3, 1.02, Math.max(.05, mr)));
  const cpo = [0, 0], cpn = [0, 0], CSP = 4.3, CV = 1.15 * sp, CLOOP = PLN[PLN.length - 1] + CSP * 10 + 4, CS14 = PLN[2] + (phone ? 2.5 : 6), anc = new Float32Array(44);
  /* one figure, or its shadow, into the frame. A figure covers cells of the picture and leans with the ground under it; a shadow is a mark
     that takes the sun off the ground, and is laid along the slope it falls on */
  const figure = (i, qo, shadow) => { pathAt(qo, cpo); pathAt(qo + .6, cpn); let fa = cpn[0] - cpo[0], fb = cpn[1] - cpo[1]; const fl = Math.hypot(fa, fb) || 1; fa /= fl; fb /= fl; if(!shadow) anc[(i + 1) * 4] = -1;
    const ap = cpo[0] - A0, x0 = ap * CS + cpo[1] * SN, z0 = -ap * SN + cpo[1] * CS; if(z0 < 6 || Math.abs(x0 / z0) > XR + .1) return; const y0 = hgt(x0, z0), fx = fa * CS + fb * SN, fz = -fa * SN + fb * CS, gf = (hgt(x0 + fx, z0 + fz) - y0);
    const ky = F / z0, c0 = Math.round(CX + x0 * ky), r0 = Math.round(HZ - (y0 - CY) * ky + .5); let kx = (fx - fz * x0 / z0) * ky; if(Math.abs(kx) < .3 * ky) kx = (kx < 0 ? -.3 : .3) * ky;
    const kr = (y0 - CY) * fz * ky / z0 - ky * gf; let m12 = 0, m22 = -ky;
    if(shadow){ const gx = hgt(x0 + 1, z0) - y0, gz = hgt(x0, z0 + 1) - y0, den = Math.max(.1, LY - gx * LX - gz * LZ), sx = -LX / den, sz = -LZ / den; m12 = (sx - sz * x0 / z0) * ky; m22 = -ky * (gx * sx + gz * sz) + (y0 - CY) * ky / z0 * sz; }
    const det = kx * m22 - m12 * kr, ph = qo / 2.1, man = i < 0, mr = .36 / ky, u0 = man ? -.45 : -1.3, u1 = man ? .5 : 2.15, v1 = man ? 1.78 : 2.4; let ca = 1e9, cb = -1e9, ra = 1e9, rb = -1e9;
    if(!shadow){ const o = (i + 1) * 4, hu = man ? -.3 : 1.95, hv = man ? 1.02 : 1.86, tu = -1.1, tv = 1.5; anc[o] = c0 + hu * kx; anc[o + 1] = r0 + hu * kr - hv * ky; anc[o + 2] = c0 + tu * kx; anc[o + 3] = r0 + tu * kr - tv * ky; }
    for(const [u, v] of [[u0, 0], [u1, 0], [u0, v1], [u1, v1]]){ const c = c0 + u * kx + v * m12, r = r0 + u * kr + v * m22; if(c < ca) ca = c; if(c > cb) cb = c; if(r < ra) ra = r; if(r > rb) rb = r; }
    ca = Math.max(0, Math.floor(ca)); cb = Math.min(cols - 1, Math.ceil(cb)); ra = Math.max(0, Math.floor(ra)); rb = Math.min(rows - 1, Math.ceil(rb)); const lu = kx > 0 ? -.15 : .15;
    for(let r = ra; r <= rb; r++) for(let c = ca; c <= cb; c++){ const kk = r * cols + c; if(TY[kk] ? ZC[kk] < z0 - (shadow ? 30 : 1.5) : r < TOP && c >= MG && c < cols - MG) continue;
      const dc = c - c0, dr = r - r0 - .5, u = (dc * m22 - m12 * dr) / det, v = (kx * dr - kr * dc) / det; if(v < -.05 || v > v1 || u < u0 || u > u1) continue;
      let sd = man ? walker(u, v, ph, mr) : camel(u, v, ph, mr);
      if(shadow){ const du = -m12 * .34 / det, dv = kx * .34 / det; sd = Math.min(sd, man ? walker(u + du, v + dv, ph, mr) : camel(u + du, v + dv, ph, mr), man ? walker(u - du, v - dv, ph, mr) : camel(u - du, v - dv, ph, mr)); }          /* a shadow on ground seen at a low angle is squeezed: take the cell's whole depth */
      if(sd * ky > (shadow ? .2 : .1)) continue;
      if(shadow){ if(TY[kk] && !CSH[kk] && ncsh < 4096){ CSH[kk] = 1; cshl[ncsh++] = kk; } continue; }
      const rim = FC[kk] < 5 && (man ? walker(u + lu, v + .17, ph, mr) : camel(u + lu, v + .17, ph, mr)) > 0;
      if(!TF[kk]){ TF[kk] = 1; TL[ntl++] = kk; } FB[kk] = (rim ? .9 : .52 + .1 * clamp01(v - 1.2)) + DT[kk] / LVN * .5; FC[kk] = rim ? 15 : 14; } };
  const caravan = (tm, shadow) => { const q0 = ((CS14 + CV * (tm - 14)) % CLOOP + CLOOP) % CLOOP; for(let i = NCAM - 1; i >= -1; i--){ const qo = q0 - CSP * (i + 1) + (i < 0 ? 1.6 : 0); if(qo > .5 && qo < PLN[PLN.length - 1] - 1) figure(i, qo, shadow); else if(!shadow) anc[(i + 1) * 4] = -1; }
    /* the rope: from each camel's halter to the tail of the one ahead (the first is led by hand), hanging a little */
    if(!shadow) for(let i = 0; i < NCAM; i++){ const o = (i + 1) * 4, n = i * 4; if(anc[o] < 0 || anc[n] < 0) continue; const x1 = anc[o], y1 = anc[o + 1], x2 = i ? anc[n + 2] : anc[n], y2 = i ? anc[n + 3] : anc[n + 1], len = Math.hypot(x2 - x1, y2 - y1); if(len < 2 || len > 60) continue;
      for(let t = 0; t <= len; t++){ const u = t / len, c = Math.round(x1 + (x2 - x1) * u), r = Math.round(y1 + (y2 - y1) * u + .09 * len * 4 * u * (1 - u)); if(c < 0 || c >= cols || r < 0 || r >= rows) continue; const kk = r * cols + c; if(FC[kk] !== 14 && FC[kk] !== 15 && (t & 1 || len < 9)){ if(!TF[kk]){ TF[kk] = 1; TL[ntl++] = kk; } FB[kk] = .34; FC[kk] = 14; } } } };
  let nti = 0; for(let kk = 0; kk < N; kk++) if(TY[kk]) nti++; const TI = new Int32Array(nti), NTI = nti, skt = new Int32Array(2048); let nskt = 0; nti = 0; for(let kk = 0; kk < N; kk++) if(TY[kk]) TI[nti++] = kk;
  const AVP = 46, AVT = 15.2;                                                   /* one avalanche every 46 s; the first starts 1.2 s after the still frame */
  const FB0 = new Float32Array(N), FC0 = new Uint8Array(N);
  const frame = (tm, base) => { ntl = 0; const cl = PART & 2 ? tm : 14, wt = PART & 12 ? tm : 14, salt = PART & 8;
    /* sand blown off the crests: a sheet that leaves each crest point level, then sags; dense streaks ride down it with the wind */
    PLB.fill(0); nskt = 0; for(let i = 0; i < ncsh; i++) CSH[cshl[i]] = 0; ncsh = 0; if(!base && PART & 32 && NCAM) caravan(tm, true);
    if(!base && PART & 4) for(let i = 0; i < NCR; i++){ const a = CRA[i], b = CRB[i], g = gust(a, b, wt) * CRK[i] * clamp01(2.6 * noise(b / 7 + wt * .22, a / 50 + 5) - .55); if(g < .06) continue;
      const x = CRX[i], y = CRY[i], z = CRZ[i], Lp = (1.2 + 8 * g) * (z > 200 ? 1.5 : 1), cellm = z / F, np = Math.max(2, Math.min(14, Math.round(Lp / cellm))), dd = Lp / np, wd = Math.min(1.6, dd / cellm) * (1 - .93 * cloud(a, b, cl));
      const fl = (noise(b * .8 + 40, wt * 1.5) - .5) * .7, j0 = hash2(i, 7);
      for(let m = 0; m < np; m++){ const d = (m + j0) * dd, e = d / Lp, st = noise(b * 1.4 + 7, (d - US * 1.5 * wt) * .4), rho = g * (1 - e) * (1 - e) * (.25 + 1.5 * st * st) * wd; if(rho < .03) continue;
        const yv = y + .3 * d - .034 * d * d + fl * Math.sqrt(d), zs = z - SN * d, xs = x + CS * d, c = Math.floor(CX + xs / zs * F), r = Math.floor(HZ - (yv - CY) / zs * F); if(c < 0 || c >= cols || r < 0 || r >= rows) continue;
        const kk = r * cols + c; if(TY[kk] ? zs > ZC[kk] + .5 : r < TOP && c >= MG && c < cols - MG) continue; if(!TY[kk] && PLB[kk] === 0 && nskt < 2048) skt[nskt++] = kk; PLB[kk] += rho * clamp01((yv - y + d * LY / -LA) / .4 + .3); } }
    if(!base && PART & 4) for(let i = 0; i < NSH; i++){ const b = SHB[i], a = heroS(b), g = gust(a, b, wt) * clamp01(2.6 * noise(b / 7 + wt * .22, a / 50 + 5) - .55); if(g < .06) continue; const Lp = 1.2 + 8 * g, d = SHD[i] * (1 + .5 * (noise(b * .8 + 40, wt * 1.5) - .5)); if(d >= Lp) continue;
      const e = d / Lp, st = noise(b * 1.4 + 7, (d - US * 1.5 * wt) * .4), f2 = noise(b * 4.3 + 2, (d - US * 1.5 * wt) * 1.3); const kk = SHK[i]; if(!TY[kk] && PLB[kk] === 0 && nskt < 2048) skt[nskt++] = kk; PLB[kk] += g * (1 - e) * (1 - e) * (.2 + 1.3 * st * st + .5 * f2 * f2) * (1 - .93 * cloud(a, b, cl)) * clamp01((90 - b) / 25); }
    /* the avalanche of this period: three tongues of different size side by side, the second and third set off by the first. Each starts as a
       point under the brink; a round nose runs down the face and the tongue behind it narrows to a neck, while the scar works back up to the brink */
    const an = Math.floor((tm - AVT) / (AVP / sp)), at = !base && PART & 16 && sites.length ? tm - AVT - an * AVP / sp : -1, ab = sites.length ? (an === 0 ? sites[sites.length >> 1] : sites[mix(an * 7919 + p.seed) % sites.length]) : 0, aon = at >= 0 && at < 34, gq = Math.floor(tm * 6);
    if(base){ FB.set(SKB); FC.set(SKC); } else { FB.set(FB0); FC.set(FC0); cloudGrid(cl);
      /* thin cloud in the sky, lit from the sun's side */
      skyClouds(cl); for(let i = 0; i < nskl; i++){ const kk = SKL[i], v = SKV[i], d = DT[kk]; if(!TF[kk]){ TF[kk] = 1; TL[ntl++] = kk; } FB[kk] = SKB[kk] + .3 * v + d / LVN; if(v > .4 + d * .6) FC[kk] = SKC[kk] === 16 ? 9 : 17; }
      for(let i = 0; i < nskt; i++){ const kk = skt[i], d = DT[kk], pl = Math.min(.8, PLB[kk]); if(!TF[kk]){ TF[kk] = 1; TL[ntl++] = kk; } FB[kk] += pl * .7; if(pl > .3 + d * .5) FC[kk] = 13; } }
    const msk = (salt ? 4 : 0) | (aon ? 16 : 0);
    for(let i = 0; i < NTI; i++){ const kk = TI[i], ty = TY[kk], cg = CGF[CI[kk]] && SD[kk] > .015; let pl = PLB[kk];
      if(!base && !cg && !(ty & msk) && pl === 0 && !CSH[kk]) continue;          /* nothing moves over this cell: it keeps the still ground laid down at the start */
      if(!TF[kk]){ TF[kk] = 1; TL[ntl++] = kk; } const d = DT[kk], hz = HZF[kk], a = WA[kk], b = WB[kk], sun = base ? 1 : CSH[kk] ? .06 : cg ? 1 - .88 * cloud(a, b, cl) : 1; let lit = SD[kk] * sun, am = AM[kk], av = 0;
      if(ty & 4 && salt && !base){ /* saltation: streamers a few metres long and half a metre wide that snake downwind, thicker in the gusts */
        const nr = clamp01((34 - ZC[kk]) / 22), f = nr > 0 ? clamp01(noise((a - US * wt) / 3.2, b / .55 + 2.4 * noise(a / 8 + wt * .3, b / 11)) * 3.4 - 1.75) : 0, f2 = clamp01(noise((a - US * wt) / 16, b / 5 + 31 + wt * .11) * 3 - 1.5), s0 = nr * f + (1 - nr * .6) * .8 * f2;
        if(s0 > .02){ const sv = s0 * (.1 + gust(a, b, wt)); lit += sv * (.1 + .48 * sun * clamp01(SD[kk] * 3)) * (1 - hz); am += sv * .1; } }
      if(aon && ty & 16){ const sd = SLD[kk]; let add = 0;
        for(let qo = 0; qo < 3; qo++){ const t = at - (qo === 0 ? 0 : qo === 1 ? 2.4 : 5), bc = ab + (qo === 0 ? 0 : qo === 1 ? 8.5 : -11.5), R = qo === 0 ? 3.6 : qo === 1 ? 2.5 : 4.4, kv = qo === 0 ? 1 : qo === 1 ? .82 : 1.1; if(t <= 0) continue;
          const flow = Math.min(t, 10), dn = 2.4 + 1.9 * kv * flow * (1 - .025 * flow), du = Math.max(.25, 2.4 - .8 * flow), s = dn - sd; if(s < 0 || sd < du) continue;
          const w = Math.abs(b - bc + 2.6 * (noise(sd * .22 + qo * 9, bc * .1) - .5)), gr = Math.min(1, .25 + flow * .25), nose = 1 - s / (R * gr), W = R * gr * (s < R * gr ? Math.sqrt(1 - nose * nose) : .5 + .5 * Math.exp(-(s - R * gr) / (2.2 * R))) * clamp01((sd - du) / 1.4 + .3); if(w > W) continue;
          const fade = t < 10 ? 1 : Math.exp(-(t - 10) / 8), grn = hash2(kk, gq + qo), fr = s < 1.6 ? (.34 + .5 * grn) * (t < 10 ? 1 : .3) : 0;
          add = Math.max(add, fade * (fr + .17 + (t < 10 ? .2 : .05) * (noise(b * 1.6 + qo * 5, (sd - 1.9 * kv * flow) * .8) - .3) + (w > W * .74 ? .14 : 0)));
          if(t < 2 && sd < 2.6 && w < 1.6 + t) pl += .5 * (1 - t / 2) * (.5 + .5 * grn); }             /* the first slip throws a little dust up into the light at the brink */
        am += add; av = add; }
      if(pl > .75) pl = .75; const tot = am + lit + pl * .7, w = lit / (am + lit);
      FB[kk] = tot * .76 + d / LVN;
      FC[kk] = pl > .34 + d * .5 ? 13 : w > .25 + d * .1 ? (hz > .55 + d * .5 ? 9 : lit > .86 + d * .2 ? 8 : lit > .58 + d * .26 ? 7 : lit > .36 + d * .2 ? 6 : 5) : (hz > .5 + d * .6 || av > .4 ? 4 : tot > .6 + d * .2 ? 3 : 2); }
    if(base){ FB0.set(FB); FC0.set(FC); paint(true); return; }
    /* shimmer: the far rows (beyond 1500 m) slip sideways by a cell in slow waves */
    if(PART & 64) for(let r = FR0; r <= FR1; r++){ const o = r * cols, p1 = r * 2.1 + tm * 1.9 * sp, p2 = r * .8 - tm * 2.7 * sp + 1;
      for(let c = 1; c < cols - 1; c++){ const sh = Math.round(.62 * Math.sin(p1 + c * .13) + .5 * Math.sin(p2 - c * .08)); SHF[c] = sh && FAR[o + c] && FAR[o + c + sh] ? FB[o + c + sh] : -1; SHC[c] = FC[o + c + sh]; } for(let c = 1; c < cols - 1; c++) if(SHF[c] >= 0){ const kk = o + c; if(!TF[kk]){ TF[kk] = 1; TL[ntl++] = kk; } FB[kk] = SHF[c]; FC[kk] = SHC[c]; } }
    if(PART & 32 && NCAM) caravan(tm, false);
    paint(false); };
  frame(14, true);                                    /* the still ground and sky, once; frames then redo only what moves */
  return tm => frame(tm, false);
}
/* 06 braided river: a glacial river on a plain of black sand, seen from a drone looking steeply down under an overcast sky, drifting slowly downstream.
   Modelled on aerial photographs of real braided rivers (a river on black sand with moss in Iceland, seen almost from overhead; the Waimakariri and
   the Murchison in New Zealand; an outwash river in Alaska). What is taken from them: many threads that wander down the valley, cross at shallow
   angles and enclose long lozenge-shaped bars; one or two broad main threads and many fine ones; water pale where it is shallow and teal where it is
   deep; dark wet sand beside the water, paler dry bar tops marked by the sweeping lines of old channels; moss on the older, higher ground.
   The river is a map built once per date: three families of wandering threads (broad, medium, fine) laid over each other, a depth for every map
   cell (how far inside a thread it is; deeper where threads join), then the discharge sent down the valley row by row, each cell sharing its water
   among its three downstream neighbours in proportion to their conveyance (depth to the 5/3), after the water-routing rule of cellular braided-river
   models (Murray and Paola 1994; only the routing, not their sediment transport). The same pass carries two tracers: clear spring water that rises
   where a thread begins, and brown silt brought in by side streams. The map repeats both ways, so the drone can fly on for ever.
   Flow: a few thousand streamlines are traced through the routed flow (each step follows the local speed and sideways drift of the water), and
   flecks of foam and darker parcels of water ride them, each for up to 20 s: fast in the deep, well-fed threads, slow in the shallows, round every
   bend. Standing waves stay where the water is shallow and fast. Pulses of silt travel down the brown threads and thin out where they meet clear water.
   Light: flat overcast with slow cloud shadows and one gap in the cloud whose pool of sun crosses the picture. A few whooper swans rest on a bar,
   then fly low across the water to another (scenery; they are not counted).
   The river stands higher with more tokens: more of the medium and fine threads carry water (the caption gives the level, 40% at no tokens to
   100%). Nothing else carries data. The ground is recomputed in eight strips, one at a time, so no frame carries the whole cost. */
function tTopo(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, N = cols * rows, PX = env.P;
  /* palette: water (silver, four depths of glacial turquoise, two of silt, clear spring water, foam), sand dry / wet / sunlit, moss, swans */
  const PALR = [[206, 222, 228], [178, 228, 220], [126, 208, 202], [80, 176, 182], [48, 136, 150], [216, 198, 162], [172, 146, 110], [40, 96, 96], [242, 247, 245], [96, 100, 112], [62, 66, 78],
    [132, 142, 60], [84, 104, 50], [186, 188, 76], [232, 238, 242], [128, 134, 140]];
  const SIL = 0, PTQ = 1, TQ = 2, TEAL = 3, DEEP = 4, TAN = 5, TAN2 = 6, CLR = 7, FOAM = 8, SAND = 9, WSAND = 10, MOSS = 11, MOSS2 = 12, MOSSL = 13, SWAN = 14, SANDL = 15;
  const mg = phone ? 0 : Math.max(0, Math.round((env.W - 1240) / 2 / PX)), cap = Math.ceil(rows * (phone ? .125 : .47)) + 1;      /* the content column above `cap` stays dark (caption); on a phone the caption lies over the top eighth of the canvas, full width */
  const BTA = new Float32Array(N); for(let c = 0; c < cols; c++) for(let y = 0; y < rows; y++) BTA[c * rows + y] = (BAYER[(c & 3) + ((y & 3) << 2)] + .5) / 16;
  /* the page masks the canvas (opaque in the bottom 14%, .55 at 46% up, clear at the top). Brightness below is "as seen"; LIFT undoes the mask as far as a cell can */
  const LIFT = Float32Array.from({length: rows}, (_, y) => { const u = 1 - (y + .5) / rows, m = u < .14 ? 1 : u < .46 ? 1 - .45 * (u - .14) / .32 : .55 * (1 - u) / .54; return Math.min(2.2, 1 / Math.max(.05, m)); });

  /* ---- the river map (built once): depth, speed, sideways drift, silt, clear water. It repeats along and across the plain ---- */
  const NX = 384, NZ = 384, NM = NX * NZ, Dp = new Float32Array(NM), QO = new Float32Array(NM), V = new Float32Array(NM), U = new Float32Array(NM), T = new Float32Array(NM), C = new Float32Array(NM), K = new Float32Array(NM);
  /* value noise on a lattice that wraps both ways (nx by nz lattice cells to a period) */
  const pn = (x, z, nx, nz, s) => { const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi, u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf), x0 = ((xi % nx) + nx) % nx, x1 = (x0 + 1) % nx, z0 = ((zi % nz) + nz) % nz, z1 = (z0 + 1) % nz;
    const a = perm[(z0 * 311 + x0 * 17 + s) & 65535], b = perm[(z0 * 311 + x1 * 17 + s) & 65535], c = perm[(z1 * 311 + x0 * 17 + s) & 65535], d = perm[(z1 * 311 + x1 * 17 + s) & 65535]; return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v; };
  const stage = -.05 + .085 * Math.pow(clamp01(D.nPart / 1100), .6), ph1 = perm[11] * TAU, ph2 = perm[12] * TAU;
  /* thread families: m threads across a period, how far they wander (A, with lx by nz lattice cells), width (w0 + w1 * noise on wx by wz; below 0 the thread is dry there), depth c */
  const FAM = [{m: 4, A: 2.3, lx: 2, nz: 5, w0: .1, w1: .14, wx: 7, wz: 7, c: 1}, {m: 10, A: 2.5, lx: 4, nz: 11, w0: -.07, w1: .36, wx: 15, wz: 11, c: .8}, {m: 20, A: 2.1, lx: 8, nz: 22, w0: -.3, w1: .56, wx: 28, wz: 16, c: .5}];
  for(let z = 0; z < NZ; z++) for(let x = 0; x < NX; x++){ let d = -1, d2 = -1;
    for(let j = 0; j < 3; j++){ const f = FAM[j], ph = x * f.m / NX + f.A * (pn(x * f.lx / NX + j * .31, z * f.nz / NZ, f.lx, f.nz, j * 3000) - .5) + j * .37, r = Math.abs(ph - Math.round(ph)) * 2;
      const dj = (f.w0 + f.w1 * pn(x * f.wx / NX + j * .17, z * f.wz / NZ, f.wx, f.wz, 20000 + j * 3000) + stage - r) * f.c; if(dj > d){ d2 = d; d = dj; } else if(dj > d2) d2 = dj; }
    Dp[z * NX + x] = d + (d2 > 0 ? .6 * d2 : 0); }                         /* where two threads join the bed is scoured deeper */
  /* side streams: three to a period, from alternate sides; each brings a tenth of the river's water, brown with silt */
  const TRIB = [0, 1, 2].map(i => ({z: Math.round(NZ * (i + .25 + .4 * perm[40 + i]) / 3) % NZ, x0: Math.round(NX * perm[50 + i]), s: (i & 1 ? 1 : -1) * (p.off >= 0 ? 1 : -1), f: .1, J: 54}));
  const wx = x => ((x % NX) + NX) % NX;
  for(const qo of TRIB){ const hw = 1.6 + 5.5 * Math.sqrt(qo.f); qo.hw = hw;
    for(let j = 0; j <= qo.J; j++){ const t = j / qo.J, z = (qo.z + j) % NZ, xm = qo.x0 + qo.s * 90 * Math.pow(t, 1.2) + 14 * Math.sin(j * .21 + qo.z) * t * (1 - t), h = hw * (1 - .6 * t * t);
      for(let x = Math.floor(xm - h); x <= Math.ceil(xm + h); x++){ const d = (1 - Math.abs(x - xm) / h) * (.05 + .1 * Math.sqrt(qo.f)), i = z * NX + wx(x); if(d > Dp[i]) Dp[i] = d; }
      if(j === qo.J) qo.xe = xm; } }
  for(let i = 0; i < NM; i++){ const d = Dp[i]; K[i] = d > 0 ? d * Math.cbrt(d * d) : 0; }
  { const z0 = NZ + (NZ >> 1) - 1; let qt = 0; for(let x = 0; x < NX; x++) qt += QO[(z0 % NZ) * NX + x] = K[(z0 % NZ) * NX + x];
    for(let zz = z0; zz > 0; zz--){ const zr = zz % NZ, r = zr * NX, rn = ((zz - 1) % NZ) * NX; let s = 0;
      for(const qo of TRIB) if((qo.z + qo.J) % NZ === zr){ let ks = 0; for(let x = Math.floor(qo.xe - qo.hw); x <= Math.ceil(qo.xe + qo.hw); x++) ks += K[r + wx(x)];
        if(ks > 0) for(let x = Math.floor(qo.xe - qo.hw); x <= Math.ceil(qo.xe + qo.hw); x++){ const i = r + wx(x); QO[i] = qo.f * qt * K[i] / ks; T[i] = 1; C[i] = 0; } }
      for(let x = 0; x < NX; x++){ QO[rn + x] = 0; T[rn + x] = 0; C[rn + x] = 0; }
      for(let x = 0; x < NX; x++){ let qo = QO[r + x]; const kk = K[r + x]; if(kk <= 0) continue; const xl = x ? x - 1 : NX - 1, xr = x === NX - 1 ? 0 : x + 1;
        if(qo <= 0){ if(QO[r + xl] > 0){ qo = QO[r + x] = kk * QO[r + xl] / K[r + xl]; T[r + x] = T[r + xl]; C[r + x] = C[r + xl]; }      /* a thread widening: the same water as beside it */
          else if(QO[r + xr] > 0 && K[r + xr] > 0){ qo = QO[r + x] = kk * QO[r + xr] / K[r + xr]; T[r + x] = T[r + xr]; C[r + x] = C[r + xr]; }
          else { qo = QO[r + x] = kk * .5; T[r + x] = 0; C[r + x] = 1; } }                                                                     /* a thread beginning: clear water rising from the gravel */
        const kl = K[rn + xl] * .7, kc = K[rn + x], kr = K[rn + xr] * .7, k = kl + kc + kr; s += qo; if(k <= 0) continue; const w = qo / k, t = T[r + x] * w * .9975, c = C[r + x] * w * .996;
        QO[rn + xl] += kl * w; QO[rn + x] += kc * w; QO[rn + xr] += kr * w; T[rn + xl] += kl * t; T[rn + x] += kc * t; T[rn + xr] += kr * t; C[rn + xl] += kl * c; C[rn + x] += kc * c; C[rn + xr] += kr * c; U[r + x] = (kr - kl) / k; }
      const g = s > 0 ? qt / s : 1; for(let x = 0; x < NX; x++){ const qo = QO[rn + x]; if(qo > 0){ T[rn + x] /= qo; C[rn + x] /= qo; QO[rn + x] = qo * Math.min(1.5, g); } } } }       /* what seeps into the gravel comes back: the river carries the same water all the way */
  { const sm = []; for(let i = 0; i < NM; i += 13) if(K[i] > 0) sm.push(QO[i] / (Dp[i] + .02)); sm.sort((a, b) => a - b); const v9 = sm[Math.floor(sm.length * .9)] || 1;
    for(let i = 0; i < NM; i++) V[i] = K[i] > 0 ? Math.max(.25, Math.min(1.5, QO[i] / (Dp[i] + .02) / v9)) : .4; }

  /* ---- streamlines: where a fleck of foam set down in the water is carried, step by step (a quarter of a second a step) ---- */
  const SK = 1800, SM = 80, DT = .25, VS = 1.5, SLX = new Float32Array(SK * SM), SLZ = new Float32Array(SK * SM), SLN = new Uint8Array(SK), SR = mulberry(mix(p.seed + 6));
  for(let k = 0; k < SK; k++){ let x = 0, z = 0, i = 0; for(let tr = 0; tr < 60; tr++){ x = SR() * NX; z = SR() * NZ; i = (z | 0) * NX + (x | 0); if(K[i] > 0 && Dp[i] > .02) break; }
    let n = 0; for(; n < SM; n++){ SLX[k * SM + n] = x; SLZ[k * SM + n] = z; const zi = ((Math.floor(z) % NZ) + NZ) % NZ, xi = ((Math.floor(x) % NX) + NX) % NX; i = zi * NX + xi; if(K[i] <= 0) break;
      const v = VS * V[i] * DT; z -= v; x += U[i] * v;
      const zn = ((Math.floor(z) % NZ) + NZ) % NZ * NX, xn = ((Math.floor(x) % NX) + NX) % NX; if(K[zn + xn] <= 0){ const l = K[zn + (xn ? xn - 1 : NX - 1)], r = K[zn + (xn === NX - 1 ? 0 : xn + 1)]; if(l > 0 || r > 0) x += l > r ? -1 : 1; } }     /* pushed back into the water at a bend */
    SLN[k] = n; }
  const NFL = SK * 7, FPH = Float32Array.from({length: NFL}, () => SR()), FAM2 = Float32Array.from({length: NFL}, () => { const r = SR(); return r < .28 ? -.5 - .5 * SR() : .5 + .5 * SR(); });      /* seven flecks to a streamline; about a quarter are darker parcels */

  /* ---- the view: a camera looking 62 degrees down (one map row is drawn 1.5 map columns long); for every cell, where on the ground it looks (in map columns, along and across the valley) ---- */
  const TH = 62 * Math.PI / 180, sT = Math.sin(TH), cT = Math.cos(TH), FV = rows * (phone ? 1.1 : .8), RS = phone ? 1.7 : 1.45, AZ = 1.5, HC = RS * FV * sT, Y0 = HC * cT / sT, yc = rows * (phone ? .5 : .73);
  const PHI = (phone ? 1.05 : .3) + .12 * p.tilt, sg = p.off >= 0 ? 1 : -1, edx = Math.cos(PHI), edy = -Math.sin(PHI) * sg, exx = Math.sin(PHI) * sg, exy = Math.cos(PHI);      /* downstream runs across the band (down the screen on a phone), a little askew */
  const gk = [], ga = [], gb = [], gs = [], gf = [], NS = 8, SB = new Int32Array(NS + 1), GI = new Int32Array(N).fill(-1);
  for(let c = 0; c < cols; c++){ if(c % Math.ceil(cols / NS) === 0) SB[(c / Math.ceil(cols / NS)) | 0] = gk.length; const inCol = c >= mg && c < cols - mg;
    for(let y = inCol ? cap : 0; y < rows; y++){ const sx = c + .5 - cols / 2, sy = yc - (y + .5), t = HC / (FV * sT - sy * cT), xg = t * sx, yg = t * (sy * sT + FV * cT) - Y0;
      GI[c * rows + y] = gk.length; gk.push(c * rows + y); ga.push(xg * edx + yg * edy); gb.push(xg * exx + yg * exy); gs.push(t); gf.push(inCol ? sstep(cap - .5, cap + 5, y) : 1); } }
  for(let j = Math.ceil(cols / Math.ceil(cols / NS)); j <= NS; j++) SB[j] = gk.length;
  const ng = gk.length, GK = Int32Array.from(gk), GA = Float32Array.from(ga), GV = Float32Array.from(gb), GS = Float32Array.from(gs), GFD = Float32Array.from(gf);
  const WET = new Uint8Array(ng), WD = new Float32Array(ng), WV = new Float32Array(ng), WT = new Float32Array(ng), WC = new Float32Array(ng), WZ = new Float32Array(ng), WXM = new Float32Array(ng), WL = new Float32Array(ng), WP = new Float32Array(ng), FB = new Float32Array(ng), WBB = new Float32Array(ng), WBC = new Uint8Array(ng), WBK = new Uint8Array(ng), WFL = new Uint8Array(ng), WSW = new Float32Array(ng), WLIST = new Int32Array(ng), WN = new Int32Array(NS), PK = new Int32Array(ng), LKEY = new Uint8Array(ng).fill(255), WKEY = new Uint8Array(ng).fill(255);
  const NK = PALR.length * LV, cnt = new Int32Array(NK + 1), ord = new Int32Array(ng);
  const DPR = env.dpr;      /* squares are snapped to whole device pixels: no soft edges, so a strip repainted on its own looks exactly as when the whole ground is painted */
  /* one painter: square cells, size and alpha by level, one path per colour and level; bright cells get a faint larger square (glow) */
  const paint = (cx, idx, keys, i0, i1, halo) => { cnt.fill(0); for(let i = i0; i < i1; i++){ const qo = keys[i]; if(qo !== 255) cnt[qo + 1]++; }
    for(let qo = 0; qo < NK; qo++) cnt[qo + 1] += cnt[qo];
    for(let i = i0; i < i1; i++){ const qo = keys[i]; if(qo !== 255) ord[cnt[qo]++] = idx[i]; }
    for(let qo = 0, i = 0; qo < NK; qo++){ const e = cnt[qo]; if(e === i) continue; const col = PALR[(qo / LV) | 0], f = (qo % LV + 1) / LV, s = Math.max(1, Math.round(PX * (.3 + .62 * f) * DPR)) / DPR, o = Math.round((PX - s) / 2 * DPR) / DPR, rgb = `${col[0]},${col[1]},${col[2]}`;
      if(halo && f > .85){ const hs = Math.round(PX * 2.3 * DPR) / DPR, ho = Math.round((PX - hs) / 2 * DPR) / DPR; cx.fillStyle = `rgba(${rgb},.1)`; cx.beginPath(); for(let j = i; j < e; j++){ const k = ord[j]; cx.rect(((k / rows) | 0) * PX + ho, (k % rows) * PX + ho, hs, hs); } cx.fill(); }
      cx.fillStyle = `rgba(${rgb},${(.15 + .75 * f).toFixed(3)})`; cx.beginPath(); for(; i < e; i++){ const k = ord[i]; cx.rect(((k / rows) | 0) * PX + o, (k % rows) * PX + o, s, s); } cx.fill(); } };
  const key = (k, b, c) => { const u = b * LIFT[k % rows], v = Math.ceil((u > 1 ? 1 : u) * LV + BTA[k] - .5); return u < .045 || v < 1 ? 255 : c * LV + (v > LV ? LV : v) - 1; };

  /* ---- camera, light ---- */
  const CZ0 = NZ * perm[20], VD = .16;                         /* drift downstream, map rows a second */
  const belt = z => NX / 2 + 60 * Math.sin(z / NZ * TAU + ph1) + 25 * Math.sin(2 * z / NZ * TAU + ph2);      /* the main belt of the river wanders across the plain; the drone follows it */
  const cam = ts => { const z = CZ0 - VD * ts; return [.5 * belt(z) + .5 * belt(z - 40) + 10 * Math.sin(ts * .031 + p.yaw), z]; };
  /* the pool of sun crosses the band once every 64 s; at the static frame it lies in the middle */
  const PC = 64, SPAN = cols * RS * .8, pool = ts => { const u = ((ts / PC + .5) % 1 + 1) % 1; return [(.5 - u) * SPAN * 2.2, 12 * p.tilt, sstep(0, .1, u) * sstep(1, .9, u)]; };
  /* map position -> screen cell (for flecks and birds) */
  const pj = [0, 0], proj = (xw, zw, cx, cz) => { const b = xw - cx, a = (cz - zw) * AZ, xg = a * edx + b * exx, yn = a * edy + b * exy + Y0, sy = FV * (yn * sT - HC * cT) / (HC * sT + yn * cT), t = HC / (FV * sT - sy * cT); pj[0] = xg / t + cols / 2; pj[1] = yc - sy; };
  const off = offscreen(env), octx = off.begin(), lastT = new Float64Array(NS).fill(NaN), TT = N > 90000 ? .64 : .4;      /* a wide screen has more ground in a strip: its strips take turns more slowly */

  /* one strip of the ground, as it is at time ts: which cells are water (and what the frame pass needs to know about them), and the land painted into the strip */
  const land = (j, ts) => { const cm = cam(ts), cx = cm[0], cz = cm[1], pl = pool(ts), pa = pl[0], pb = pl[1], pamp = pl[2], sga = phone ? 34 : 60, sgb = 44, i0 = SB[j], i1 = SB[j + 1]; let wn = 0;
    for(let i = i0; i < i1; i++){ const k = GK[i], bt = BTA[k], xw = cx + GV[i], zw = cz - GA[i] / AZ, mx = xw - NX * Math.floor(xw / NX), mz = zw - NZ * Math.floor(zw / NZ);
      const x0 = mx | 0, z0 = mz | 0, fx = mx - x0, fz = mz - z0, x1 = x0 + 1 === NX ? 0 : x0 + 1, z1 = z0 + 1 === NZ ? 0 : z0 + 1, ra = z0 * NX, rb = z1 * NX, idx = (fz < .5 ? ra : rb) + (fx < .5 ? x0 : x1);
      let d = (Dp[ra + x0] * (1 - fx) + Dp[ra + x1] * fx) * (1 - fz) + (Dp[rb + x0] * (1 - fx) + Dp[rb + x1] * fx) * fz;
      if(GS[i] > 1.9){ const x2 = x1 + 1 === NX ? 0 : x1 + 1, d2 = (Dp[ra + x1] * (1 - fx) + Dp[ra + x2] * fx) * (1 - fz) + (Dp[rb + x1] * (1 - fx) + Dp[rb + x2] * fx) * fz; if(d2 > d && d2 > 0 && d < 0) d = d2 * .5; }      /* far, small cells: a fine thread is not lost between samples */
      /* away from the main belt the plain stands a little higher: fewer threads carry water there */
      d -= .17 * sstep(45, 200, Math.abs(xw - belt(zw))) - .01; const g0 = noise(xw * .9 + 9, zw * 2.1); d += .012 * (g0 - .5);
      /* light: overcast with slow cloud shadows, and the pool of sun */
      const amb = .86 + .34 * (noise(xw * .014 + ts * .012, zw * .03 - ts * .016) - .5), ea = (GA[i] - pa) / sga, eb = (GV[i] - pb) / sgb, e2 = ea * ea + eb * eb, lp0 = e2 < 6 ? pamp * Math.exp(-e2) * (.7 + .6 * noise(xw * .05 + 5, zw * .1 + ts * .03)) : 0, lp = lp0 > 1 ? 1 : lp0;
      if(d > 0){ WET[i] = 1; WD[i] = d; const v = V[idx], cc = C[idx]; WT[i] = T[idx]; WZ[i] = zw; WL[i] = amb * GFD[i] * (1 + .9 * lp); WP[i] = lp; LKEY[i] = 255; WLIST[i0 + wn++] = i;
        /* the part of the water's look that only changes with the light: colour by depth (pale shallows, a darker deep thread), clear spring water darker, fine ripples on the shallows */
        let col, b, fl = T[idx] > .05 ? 2 : 0; const dd = d + (bt - .5) * .03;
        if(cc > .45 + bt * .1){ col = d > .12 + bt * .05 ? TEAL : CLR; b = .74 - .8 * d; } else { col = dd < .05 ? PTQ : dd < .12 ? TQ : dd < .24 ? TEAL : DEEP; b = 1 - 1.5 * d; }
        if(b < .5) b = .5; if(d < .09) b *= 1 + .14 * Math.sin(zw * 3.1 + xw * .8 + 3 * g0) * (1 - d / .09);
        if(v > .6 && d < .08){ const sw = Math.sin(zw * 2.6 + 4 * noise(xw * .12, zw * .1)); if(sw > .5){ fl |= 1; WSW[i] = sw - (v - .6) * .4; } }        /* standing waves where the water is shallow and fast */
        if(lp > .04){ fl |= 4; if(dd < .07 + lp * .05) col = SIL; }                                                                        /* in the sun the shallows turn silver; the deep thread keeps its colour */
        b *= WL[i]; WBB[i] = b; WBC[i] = col; WFL[i] = fl; WBK[i] = key(k, b, col); continue; }
      WET[i] = 0;
      /* land: dark wet sand beside the water, paler dry bar tops; old channels show as darker sweeping lines and the bar's growth as faint ridges that follow them; moss on high old ground */
      const h = -d, g1 = noise(xw * .7 + 1, zw * 1.9), dry = sstep(.015, .16, h), scar = .5 + .5 * Math.sin(h * 85 + 2 * noise(xw * .05, zw * .12)), lt = amb * (1 + 2.4 * lp);
      let b = (.07 + .2 * dry + .06 * sstep(.3, .7, h)) * (.72 + .5 * g1) * (.78 + .44 * scar * sstep(.03, .2, h)), col = dry > bt * .8 + .25 ? (lp > .45 + bt * .3 ? SANDL : SAND) : WSAND;
      const ms = noise(xw * .022 + 3, zw * .05 + 7) + .55 * sstep(.22, .55, h) + .2 * g1 - .94;
      if(ms > 0 && h > .14 && ms * 5 + .1 > bt){ b = .2 + .16 * g1 + .12 * Math.min(1, ms * 4); col = lp > .3 + bt * .4 ? MOSSL : g1 + scar * .3 > .6 ? MOSS : MOSS2; }
      LKEY[i] = key(k, b * lt * GFD[i], col); }
    const c0 = (GK[i0] / rows) | 0, c1 = ((GK[i1 - 1] / rows) | 0) + 1; WN[j] = wn; octx.clearRect(c0 * PX, 0, (c1 - c0) * PX, env.H); paint(octx, GK, LKEY, i0, i1, false); };

  /* ---- swans: a small flock, scenery ---- */
  const NB = phone ? 6 : 9, CY = 46, FD = 6, BO = Float32Array.from({length: NB * 4}, () => X.rnd()), sites = new Map();
  const dAt = (xw, zw) => Dp[(((Math.round(zw) % NZ) + NZ) % NZ) * NX + ((Math.round(xw) % NX) + NX) % NX] - .17 * sstep(45, 200, Math.abs(xw - belt(zw)));
  const site = n => { let s = sites.get(n); if(s) return s; const cm = cam(n * CY - 3.5 - CY * .5), a0 = (n & 1 ? 1 : -1) * (.12 + .2 * hash2(n, 72)) * cols * RS * (phone ? .3 : 1), b0 = (hash2(n, 71) - .5) * (phone ? 60 : 44); let bx = cm[0], bz = cm[1], bd = 9;
    for(let j = 0; j < 40; j++){ const a = a0 + (hash2(n * 41 + j, 73) - .5) * 50, b = b0 + (hash2(n * 41 + j, 74) - .5) * 30, x = cm[0] + a * exx * 0 + b, z = cm[1] - a / AZ; let d = Math.max(dAt(x, z), dAt(x - 3, z), dAt(x + 3, z), dAt(x, z + 2), dAt(x, z - 2)); d = d > 0 ? 5 + d : Math.abs(d + .12);   /* a dry bar, not too high */
      if(d < bd){ bd = d; bx = x; bz = z; } }
    if(sites.size > 40) sites.clear(); s = [bx, bz]; sites.set(n, s); return s; };
  const BI = new Int32Array(NB * 8), BK = new Uint8Array(NB * 8), SHD = new Int32Array(NB * 2);
  const swans = (ts, cx, cz) => { const n = Math.floor((ts + 3.5) / CY), lt = ts + 3.5 - n * CY, A = site(n), B = site(n + 1); let nb = 0, nsh = 0;
    const dot = (c, y, b) => { c = Math.round(c); y = Math.round(y); if(c < 0 || y < 0 || c >= cols || y >= rows || GI[c * rows + y] < 0) return; BI[nb] = c * rows + y; BK[nb++] = SWAN * LV + Math.max(0, Math.min(LV, Math.ceil(b * LIFT[y] * LV)) - 1); };
    const dxp = B[0] - A[0], dzp = B[1] - A[1];
    for(let i = 0; i < NB; i++){ const o = i * 4, dl = i / NB * 3 + .5 * BO[o + 2], s = clamp01((lt - dl) / FD), e = s * s * (3 - 2 * s), fly = s > 0 && s < 1, rr = 3 + 7 * Math.sqrt(BO[o]), an = BO[o + 1] * TAU, an2 = an + 2 + BO[o + 3], lift = Math.sin(Math.PI * s);
      const xw = A[0] + dxp * e + rr * (Math.cos(an) * (1 - e) + Math.cos(an2) * e) * (1 - .6 * lift), zw = A[1] + dzp * e + rr * .5 * (Math.sin(an) * (1 - e) + Math.sin(an2) * e) * (1 - .6 * lift); proj(xw, zw, cx, cz); const c = Math.floor(pj[0]), y = Math.floor(pj[1]);
      if(!fly){ dot(c, y, .9); if(BO[o + 2] > .4) dot(c + (BO[o + 3] > .5 ? 1 : -1), y, .6); continue; }
      proj(xw + dxp * .02, zw + dzp * .02, cx, cz); const hx = pj[0] - c > .5 ? 1 : -1, wp = (ts * 3.1 + BO[o + 1] * 7) % 1, sh = Math.round(1 + 2 * Math.sqrt(lift)); if(c + sh >= 0 && c + sh < cols && y + sh < rows && y + sh >= 0) SHD[nsh++] = (c + sh) * rows + y + sh;
      dot(c, y, 1); dot(c + hx, y, .8); dot(c - hx, y, .5);                                                  /* long neck ahead, tail behind */
      if(wp < .55){ dot(c, y - 1, .9); dot(c, y + 1, .9); if(wp < .3){ dot(c, y - 2, .5); dot(c, y + 2, .5); } } }                             /* wings: out wide, half folded, down */
    swans.nsh = nsh; return nb; };

  /* ---- a frame ---- */
  const touched = new Int32Array(NFL * 3 + 8);
  return tm => { const ts = (tm - 14) * sp;
    for(let j = 0; j < NS; j++){ const qo = Math.floor((ts - j * TT / NS) / TT); if(qo !== lastT[j]){ land(j, qo * TT + j * TT / NS); lastT[j] = qo; } }      /* each strip of ground is redone every 0.4 s, the strips one after another */
    off.blit();
    const cm = cam(ts), cx = cm[0], cz = cm[1]; let nt = 0;
    /* flecks ride the streamlines; each leaves a short streak */
    for(let f = 0; f < NFL; f++){ const k = f % SK, n = SLN[k]; if(n < 6) continue; const qo = ((ts / DT / n + FPH[f]) % 1 + 1) % 1 * (n - 1), q0 = qo | 0, u = qo - q0, o = k * SM + q0;
      let x = SLX[o] + (SLX[o + 1] - SLX[o]) * u, z = SLZ[o] + (SLZ[o + 1] - SLZ[o]) * u; x += NX * Math.round((cx - x) / NX); z += NZ * Math.round((cz - z) / NZ);
      proj(x, z, cx, cz); const c = Math.floor(pj[0]), y = Math.floor(pj[1]); if(c < 0 || y < 0 || c >= cols || y >= rows) continue; const i = GI[c * rows + y]; if(i < 0 || !WET[i]) continue;
      const am = FAM2[f] * Math.min(1, qo / 4, (n - 1 - qo) / 4); if(FB[i] === 0) touched[nt++] = i; FB[i] += am;
      let lc = c, ly = y; for(let m = 1; m < 4; m++){ const qq = qo - m * .55; if(qq < 0) break; const q1 = qq | 0, u1 = qq - q1, o1 = k * SM + q1, sh = x - (SLX[o] + (SLX[o + 1] - SLX[o]) * u), sz = z - (SLZ[o] + (SLZ[o + 1] - SLZ[o]) * u);      /* its wake: a streak two to four cells long, back along the way it came */
        proj(SLX[o1] + (SLX[o1 + 1] - SLX[o1]) * u1 + sh, SLZ[o1] + (SLZ[o1 + 1] - SLZ[o1]) * u1 + sz, cx, cz); const c2 = Math.floor(pj[0]), y2 = Math.floor(pj[1]); if(c2 === lc && y2 === ly) continue; lc = c2; ly = y2;
        if(c2 < 0 || y2 < 0 || c2 >= cols || y2 >= rows) break; const i2 = GI[c2 * rows + y2]; if(i2 < 0 || !WET[i2]) break; if(FB[i2] === 0) touched[nt++] = i2; FB[i2] += am * (1 - m * .24); } }
    const fq = Math.floor(ts * 3), sph = ts * VS;
    let np = 0;
    for(let j = 0; j < NS; j++) for(let w = SB[j], e = w + WN[j]; w < e; w++){ const i = WLIST[w], fl = WFL[i], f = FB[i]; PK[np] = GK[i];
      if(!fl && f === 0){ WKEY[np++] = WBK[i]; continue; }                                                     /* most water cells only change with the light */
      const k = GK[i], bt = BTA[k], d = WD[i]; let b = WBB[i], col = WBC[i];
      if(fl & 2){ const tt = WT[i] * (.8 + .2 * Math.sin((WZ[i] + sph) * .16)); if(tt > .42 + bt * .1){ col = d > .1 + bt * .06 ? TAN2 : TAN; b = (.9 - .8 * d) * WL[i]; } }      /* silt: a sharp edge against the other water, coming down in pulses */
      if(fl & 1){ b += .16 * (1 + .4 * Math.sin(ts * 5 + WZ[i])) * WL[i]; if(WSW[i] > .9 && col !== TAN && col !== TAN2) col = SIL; }                 /* standing waves hold their place and flicker */
      if(f > 0){ b += .28 * (f > 1.4 ? 1.4 : f); if(f > .3 + bt * .2) col = f > .8 ? FOAM : col === TAN || col === TAN2 ? TAN : col === SIL ? FOAM : SIL; } else if(f < 0){ b += .3 * (f < -1.2 ? -1.2 : f); if(f < -.35) col = col === SIL || col === PTQ ? TQ : col === TQ ? TEAL : col === TEAL ? DEEP : col; }
      if(fl & 4 && hash2(k, fq) < .025 * WP[i]){ col = FOAM; b = 1.2; }                                         /* a gentle sparkle in the sun */
      WKEY[np++] = key(k, b, col); }
    for(let j = 0; j < nt; j++) FB[touched[j]] = 0;
    paint(ax, PK, WKEY, 0, np, true);
    const nb = swans(ts, cx, cz); if(swans.nsh){ ax.fillStyle = 'rgba(8,10,14,.75)'; ax.beginPath(); for(let i = 0; i < swans.nsh; i++){ const k = SHD[i]; ax.rect(((k / rows) | 0) * PX, (k % rows) * PX, PX, PX); } ax.fill(); }      /* a flying bird's shadow on the ground */
    if(nb) paint(ax, BI, BK, 0, nb, true);
  };
}

/* 07 night pass: the Earth at night from the International Space Station, 400 km up, looking ahead along the orbit. An original piece.
   Real: ISS_LIT is NASA's Black Marble 2012 night lights (public domain) and ISS_LAND the Natural Earth 1:50m land outline (public domain),
   both at half a degree. Generated: the towns and road threads inside a lit map cell (about 55 km), cloud, stars, the Milky Way, the aurora.
   A 51.6 degree orbit over a turning Earth, 14 times faster than real; each pass is picked by date for lit ground in view (no real ephemeris).
   Each cell's ray is traced to the ground and to a cloud shell 11 km up, or past the limb, where its tangent height gives the airglow layers.
   Cloud is lit by the Moon at its real phase; storms flash in clusters (a stroke holds 130 ms); a pass ends in a sunrise.
   Stars = tokens (the count is the whole turning sky; a part is in view), amber stars = the Codex share. Nothing else carries data. */
const ISS_LIT = '3vOuPoAQRIIYQvIQMrQYIIKJ3tA2MtJoHQOQMuQYQsQYC3oYYvoN2pAoDCIY_INDJpIQ_qQTqGQIAIQAIO1AvoG2pIRAMuBIICDoIAIEBFJqTvIQIRIQBYc3oI2qNuIIQQGBFIQcIQREMtRKJKpNoQIbYQaYaE5uSAIYQACAIQbAJANRAIQNAIuPoApTIQJYQTAAIJ5uIQYJBIBNJDIQFQQIQMLTMpBtAJoaJAIJIIIQI3wO1pIqQQPOEAfQIAFbUoNuIKOAAJIQYYYQQIQYYZIIK$Y0Qc3tIoGoAoIJISLNoQrTqJAIYdIBAYQYYAQQYIIYP$PzqIgVO3rAPCFQNpQIJYSIDQTrIrAOTIQgSAYYQAQYYYgQJIIB3QGqQFrE2oQCQRDAABAYYOIBIIoAQQAAIYQQAYKSFvHAYYZIYYIQQJIYYQBL3L3sDoAgIPQQYIFIACoAYIIIQgYRMIYYTItOoLoQBQJQBKvQY4yoGQNIAQggYIAGQIAYLpIAIYggJAtOAFqFLqLrPvoN0oO2qQQFIYgYYCJIARIIIgboIYBBIAKAJADoTRrSrLQNuIB3Q3YEILJoRAqCUrTpDqIEFGrIpKrIG1GqFV2pQIQQMAQQIIKINp_pJrIQBMpWoUASqQIoKoOQYQ_4$oQIIAIMFpYYQJQBAqLoCoZNqIQVILrQIWsOAV3EpgYM1pKIdJpILSCBHoMpBoBAGqOIAAOQSqYPsE3oACpQf1pIQHpNTJAOoQWpQIIOILAoKoYAENIQYJOBqLoIFrCNrT2AcAAQANKBL1pIIYgRoMoIIQYDYIIQIIPrIAYYYYKRJAAQYdUoIIAJoABNsABKEQKAYYJBQBoIQ3pJIYQIKOILIJqJ0qgggYQFoGIAIaIQYYYINoTBAoFoAQYgggYIEBPBIYcQYpPsCNBLAQJAWD3qIQaEPG1oITIIICYLpAIAQIAIBIArPDIYYgQYFKHoIFoAIJYWPoSpQMIUvoH1pApLBITIIIJQM1oQQQYbIIJgkpINoBAYCQNQBUoAOAQAQIQAIfpIQJLQbDBPoHSpQVUqM3FCCoCARJAAIACIQTP1AAIQYMIRQRKpAIQBARMAIAAIYYIpIPoJIQVoVQIoDoMAtQQKqAIIF3oToIBIIQggQKKpGsAzoAIAAIQVQggggYYpIIIYYQLBIICBIIRAICCOQcOoANpQCBONuQYIFQEpJ3qBQIIQYYRBAQQGSwoF$AJIQYbIIYggYgYQKoQQQQAIYAQ_QQCIIQYSKIBVpUpIVQIIQYIIoVIKEAKoEqVrIQGvodqAM0oAIQQIAAIILLCIBvoIKyAQAIQQLBIQgggYYQIQFYQYQQRRAIEIYRIIAIQQQQQIQIIIIDqDIIIaIHoKAIIIUEqFqLrIYIJ3oFoAQQYILAQMAYRAGO0pIAIIIQHIYgYgYYQUAYggYYYQQQYQYYYIQAQYQAIIIQYYQYQIIQggQJAVoIoGAIPoEKKIAIDsQEtQgApP3IQIMoKKDB0qQWAQYYYYQYYggYMQggggYYYYYYIIIIIQQJIQIIIQQQYQIYYIQQUqVcoQRoBLIYYOrIvR3pBYdpAIoHC0pAAQYYQYggYYRQYgggggggggYIAQIIIIYYQQYIIQQQYYIIIQIQQQAIVqaEoIJoLJoQIqQOzoA1LoQTFoQIJBIC1IQIIQYIQKYYgggggggYggQQQAIIQQQYYQYQQQQQQQQQQYAQYIIFBPQ_KIQpBGpF3$oIoHJoIIQULMIDuIJyoQIIJoAQIgggggYYIIQQYgQIQIQIQQIIYYQQQIQQYggYQQQIMoCYYDEAQKCCoHpJEqANoLtHpBpAO1pBoIMoTGoIQIAIAIRAIIYbACF0pLQQQQYYYIAQQYYYQQgYQQQQQIBQIIIIIIQYQgYYYYQIJBIKAoAoJIQHvISpEvE2oIIYgQPDqAIQQBLAIIIQuMzAIAYQYYYggQQRAYggYQggYJIQIIJAIIIIQYYQIQIIQADAAoJoID0oRG2IAQUrQYIMDALDDqJKoIQQVIGyoAAIAAIICIQgggQIIJIYIYgYYgQQIQQQQJICIQQQQILQAMLpIUQIIJoQYqIKzqK1oQIfoTpIgggZPIINo_oDJIKoAIYTIGyoISIIQIJQAIIQYQARAIQQYYIQIQQYYYAIIAQIIQYYYQQBBQAIINOoABILIYQQIIIoHpQgazqL1oQgPIYSoFoAQYgRoQQIAIDIAqDpIGJOpIQ$IIQQIBAIJIQIRMQYgYIQQIIIIIIINYIIQQQYIIIIQIIALAFoRIAUTITFqYTpFvoQC3IYgCJPoHoISoILJIILsADFFyoQYQQAASQACQYQQYYYgYQRAIOQIAJAQYYIJIIAoJJJpJIIYOpLsIwCpMoL1pAITQLoLAApALTKIYQQJLfoNIKoEQIYgTsFwoIQIAKKJIQIIQYYOADIIAIQIIIJJIBDARKALBBJIAOqQrPyQRoJOpK0qAIMIIUoHqIIIIISApNDAoQQQYYQIQToSFVyQAFIJQYQYgYQAAQQIIIYIQQZQQQQQIAIIJQQAUIMGI_oBHoIJoOpQQAyEQQF1qAgQEPoMIIqQQQYAIGDDpKQQQYggYYJoPKyoQIAIISAYIYggYYQIIYgggYYYgggYYAIIYYIAAAIQIIISIAAJISOpBABqAqNrIPvoBQYOIK1pQg_sCIAAQQIYgZDDNCoFQgYQYggYQSoNEyoQRIIKAIQYQYQIQgggggggggaQQQIIAAIIQQIYQALJJIIAJIAHoAIAIQQBIIICpJzpToIpMN0qQStSIJIYgZIJIRAQLLoIOIIIAIWRJoQDyoIYYQABJBIYBAAYgYYIYgggYSLCJIQQQgYSIKQQYeoINIQIQIIQIIMLvoOwoKpK1QCOqILRpAIQIIJBIAQYUBoIYQIIIIIAMNIIzoCIQJIKQYICIQYQQQQQYYgMUIAIAIQYRABQIAAQYAJITpAEAAASwRIQIIQAAvoIJAoH1qQQoMoIpWBJIAIIAQQSCIQVIYggVGBBTyoIIIAAQoQIJIYQRIYYYYJQYQDYggQQYYDIQSSIIQYICBAILqQFARAKIoTuLoQdoCsDoNYQIRoDpISH0pBNpOqIJLOQYQgSQQIIQYIIBQQggYYIYQIYQRATIQayoAQYQBAYIIQYYYYQIQQQQQQQQYJIYYQWAIQYYYYdIIWIVIARB_pAANIIYQYYQKoPsYVwoIGGQQpAYUB1oQICDoJBpPKIAIQYgaQYQYQggYRQIIAQgIQQQQKIgAAIYgayoIYQIARQDIYQcJIAYLoKIIQYYIgPLIQQIBYKBJICqIIoBQWsMAIQDrIMuJPOIHoIaJGoHIQHzqARAtBTAJIIQIJIYYgiQYQQYggYLQIJBIQILIIYQggbyogQTQABRQQWIIQIpQYYQYY_IRIQYSAAIRQGqJIoAAMpAITpR$IMKARrIU1pAPoDpYIBYIQQIIYgggYgYQQQYYBQYQQEIAIQAIQYQgYYgYSyoYYIQJBQIDIQRIYIYgYKoOYgYQQQQPRIIIBGIBoOLoNYIEOpYIJpHpBAIMTvKBIgYKAGAUpQM1pQNoPOJYbJIAAIIJQQYYYIQYgQQYYYYgggYQAKIQQYQQgggYQNyoYgYQBBIBoIYYdoGQQYgYQQYcAZICIIIIIJAIIYQYZBIQQJEQQICKIoOHrIgKIYIOoNQQJuIoLKQQQQYf1qDLpQcoIIBoBSSoJIYQKIIQQQQYQQYYggYggQIQRQYYgggggYGyoYYQSJIYYeAOoIIAIoYgYQIYYbSAIYYQIIJAAICQYYYQQNIAKIIQIIQSoAQAILQDrAYQRQYYgYLvLAYQAIYAIIAAQMNQJYSrIQQ1MpaIIoYYBqDIIQQIYYYQQYQYYQQQgggYYQIYggggggBzYYQUAYgdIQpAKoAYQAIQQlAQIQNBIIQQYQLIYNPoQMRIIIYRSepIQILIAIQJQQYIKvoBLZBAIYgQQQRMTVpF1oLUqgjpWRIYQQIAQQgYQYgYYgYQIQYYIQIYYgYggYZzAgYNIQQMQdQKoVoIQKSJJIQOAIAIBAAIKIYQGDDNAEAQIWIIFpQJAIYVuQpVYQARIQUQggYQgYYRAIJCMpKoJJ1QCVpIG_oJQAgYCIBAIJIIIQQQYQggQQQIQJYABQYggYYQYBzggRKDAKBYYpAQVoYINAJIIPQIDAHIpEGPQTpQQIYIBQApINoBrDoIYEIYQRQIIABAQYYgYYQMYOEqIAP0qJQgHqdoDIIYYIJYAQggYQIIIIIQYQYQQIQQVIIYggQYfwoDrgYAIIIICILBQYJMqAY_IJQIGQYSJIQGQQWPKAANKoCpIIYQYUWuLoeIJKLIQYYYgYIMQTrJIQO0qQYQYGqANoIAoSIYYQIQIQQIQgYYQQIYYYQKIQIYQQIQUzJHICIYgJqISQQYRoIQIIQkIQYQQIAIBMAIMBSAIALKJQaAQJpIUoNQBpJtHYVSIJQJYYQIQQYRIAFoAQAIOpQY_0qIgYYdsIYGIIIBIIIQQIQYIQYQYYIIQYQbJIYYIAL$JrDAAIIQATQYZqAQIIIQaoASQQYFIQQIQAIKISALKLQIINAQIIDIIoQPYKCYdLIJLvMIIKJKAIRYYAQQQIQBIIQSQQRoQggRQCpQQAQJ1QYAYMoIrKJQQIYNQIQQQQIIIIQQIQYQQQQQYRIQYYWzQYQQQYYAQIYBAWpPQQQcoIJoQIMUCAQQQIQIIQIQQQIQQMIIaCYgYoATIADACRoIqLtKQQIQKIIYQCQQIIQIIQYYIQQAQQ_QggYQAQIIQVoISQK1aIYNpLpJKJQIQVIQIQQQYYQAAIQQQQYQIQAQQIIIAYjzoYIIYQJQIoIYgYYQIQQQQQCIYOAYPpCIKYQMIYQIYIQQQQJQIQAIQIABIITIIKQQIQYYIQQoSADoKBvcAMQQYYQSATIgYIIIYYggYYQQSPQggYQYQgUoYZSYQW1QfYWqCIIAYgQIYAJKIIIQQQIYgYQQIYYYYYQQYggYYQQIIICzoIIToIQQQQIQQQYYQQAEIKrLLGAQQYQIDTIYYYPAQQYKQYJINJQQZICvHoIIcCGIRQYIYQIQQQQQAIQYgSoIYgYgQYgYUFQBIQQgggU1BA_MoMIAoBDIYYIIQQQLIQIQIQQYJQYYQIQgYQQQYgggYYggYYFzoQQoQYQOIQQQQAGeIBsQQQKIIJMQggQQoIIggYIIUoGwJGQBKQQIIYBYQYIQQIQAQIQUogYQYgggUQRCIIJIIQgggc1JQY_IMoBYAoaBBAYgQAJQQAQIYRIYgIIJQQQIYYBIQYgggYIYgYYSzpIIQAIIIARNJAAJGKqAIPoYTQYWYMIYgZIAAIBQJQIYYLoJOwoBKAIAIKQYYIIQQQYQIYQYMoQgYQggglIIAAAIQYgZAYYYW1LQIRoKoQoHQIIJMIQgJIQYIQIYYgQQYYIQQggYQYQYYYIQQUzpIQSFDAJoSsIQQLIYYGUIZISJAQKIYDrUCIvMIQYQIIIIYYYgYIAIAQYQYQdoQYQYQYQISKIYQYggYYgYb1oIQYgYZBqQBHAQAFIIQJBQIYIIIYYQQYggYQYQYYYYQQQVzoRABwYQIoBCQIIYRQQIQQQQAIWoGNoDQYQIYIIYvQQYgYEIQYYBIQIIYQQQIUoAJQQQISQIQQQYQQYRJ1pgggQ_gapIVJAIQICAJDIAIAQQIYgYYYgggRQYYYYQYYMzoQYRIQGoHOAKIMsQgYWoYYQIbIQIAQAIOrIQQYYYQIKvoIYIIRIIYIIQQQQLoIQUAQgSIIJAN1pIYoIYgEoAEPQYgQAIIQAIKIBIIQIQYYRQYgQQIYYQQYIMzoIIYEpNAQuYYYEoQYgcAIRAAJOrASIQYYIOuIJoIQIAJIAAIAAIIQIYCoYQcQYQASC1qYZQQQMWoIAQIoAYggYIIYIQIIQCQIQIABQQQYQIgIIAAIQYUyoILpLpRpYggYUoIIYIHpQggQNoAYQQSJMIYmoOpRJIIQQgYNvKIKKQIYYJAIQYDoQcQQZF1qIKIOQfUIJIQICSAQYQQIYYQYBIJQgQIQAAIIYIQQIQIIQQYWzoEQLpKCoDQQQIQRoYVNpYggfoYYISYYYYSQYYCIRrBIQIQYYYYCuMoTSCJQgggYYSoQlAA2MoGQkAIQYAoRIIAIAALJQQYJJAIIJQIIIAQRzpQKoGoQYlFPoVpNIgggUCoIQJJgIQYYJIIMZBpCJoKAQQYYggQIOtARBCoHAIYIQgQggggRoIdIQT2oJGEAFEQRCKIISAQIZIAQIIQRIQQAIIP0oKQBNoMpIDYggggaIYgQS_oQIZQYYggYBCIHoAUpQYYYggYYYVtIYQBBIAoCoIYQQYYggioWN3IaQIIIAAJQIYYQQQIgQYIIIIIQIaT0p_pLoAISIQgggggkBMFJoIQggYYYgYIAPBIoIJpJIQYYYYYYgYgMtggAIITNUQYTAIQIIAQgggYBoC3oBIgJIYgQYYYQYYYgYQYQQQQIISRAQIgWzoQRrHpDoIoQgggYNMDUoYggYIQQggAAINIAQSpPQQYYYYQYYYYYgYYYQPsIYQQAIAIoAAIKYYIoYgggQV3pYYQAAIggYQSIQQYYVoIQQ_0obsDQgIQLIIoQVIGQgKIQQIIQYMBoDpIQYQIQIQYYYYgYYRAANpPpIQAIIIYYQoEJAQLJAQYQYgRK2qATpLYYQRIQY_AIGoYIYA1CDIJAIJpgePpIYgZQQYIaSCMMLpIQSIIAIQYYgYYQQY_sJIAQYRoK_LQYYAQ_3QBoJIYYYQIRAAqQYggVzJsQaIWoERAJIpYDFGpggIAZIRIBIIFJOpIQoAQYggYQYYQBNsIQIEoOYDARIJYJE3BAKoYYQIIEqYggYfyoQQINsKALpNpkVIRpQSQQYIfoMpAAQQVKIQYYggYQIQISVuYUJIILIAQYAfV2pBApCIJIQcqYgYAIQzINqCpQIoHoQHocIIIoEIYONYUAYYJOEpQQPIIIIYYYYYYYJIIJIAIIAJLpIEoIoIDACAIIQQIAKHQaP2qLpIArQYAIAdzGtIrQcTCoIQIKoIIYcIYRCIYIWFoIQJoJYYgQYYYYYQQAJIQQQIIGIDoIYHoKAAANCGGLIoIS3oNrQYAAaN0pYMrQbHMJAKAQJNBQgaQZIBBYOpQQoIIJQIYYYQQIQYIIYQIQQYQKABBQIMIIJAIKoCVKAZJoKoC_oK3oQgYGqan0pHrYYeFoIgYQPAYgYQQPPpQoQQIQSISRAIQIIIIIQYAAIAAAJIIIIIIIYIJMpCQIRoDoKY_oV2pIIAoQcIgKIQIrIg2IcoGAQQRQeYYQQgYIIRQRY_pIUMAIINILAIQIIQYIIQLIQIKBJJMoOIIpISKFYSU3BoLAIAGrNP1pDQoJCoIQIQQQQJJYZYgZQTggYPLoIJQYoAQIQAYQJAIQABBYYYQQRIIJJIODpAYIIAIBoUoIJYYYCYc3I_3pUoQQEBQKIYgTaIILAIgYYQDpQaoBYYZQQQIABABQQKBINIJJKJJIpIYIApBAVBYgYQBYYf2qCoP2qCpRoAZQ_IBIIQYgRAUIASYgYgIdqIQJIIQIIIIAAUIKUIIAJIQIIQQIIIDpAIDoQGIEKYTQhC3pCK3pQIGLQKILGAAbKQQYKqQQIIQDIARQJRoQYYYYQKAYQYOpOIDNIIYJSQYUIgYAP3OIsQIB2pNoNoQRIBIIQQVpITYgQIRIIIAYQCYKIIILSAYQYUQGpIoACKIIQgggYKYegIH3oIGrQR2pIUqISQBIQIIUpQIQIIQYQQIAIYJIQQFoIYAIQgerYCSIQYgggYIIogQI3pRIVSrIF2oYFoSpBLMpYIQIJYYJAIKCJCIQYYSIIBIQQgN_rIIYgYbPAJ3pR3qIgYIJuIIJIQYRDoJQYYQYQJIJIAIpKpEQQIAAQIQJAP0oIR$oEAYIIKIAHoIERpB2oYYYRJDqKqSIAYQABALBIYIIQYYSSAAIMrIYQIDJYMK3qKQYRQYYYICQWoQDFpH2BQJuIQKIJIIABIIJMIWYQWrYQQIAIeQIYU3qIQIIQQQQQYYQQQsBI2oIYJLIOtQIQ_BMoYIJqLoAIAIQQKKYgQO3qBIAQAQYggIIQIoSsO1qAQYIIuKQIQQIQGJrWLoBAAQQQIIQIA3rIKDQYgYgQAIfYMpEpQO1qQYRuRIYYAIQIJAOoNqEoAIQQIICK3sQYYQQQQHHrLIKC1qQQYQPpAIrIQYYYIMIIIQFHqQUoBQQMQA3sGJIAAIQIgUqIQQMoIIDYYgZCB1pIYg_pUrQQQMAIIIOAMpIoAIIMPITIf3rEBoIIAYYNqIMpKE1pAQAQIcuQYRAIIYZJLIZrMQoQIBQS3tPNuH1oIgRLpfrJCIIIYYIACILqGNLG3tVOQV3oAgUpAHrQRDIQAIQIIIQQCqVAIRCDH3uVMuIO3oAAABAIICAQQADrFQIIoPpG3sARAE2oIVpACEAYAtQAKAIBCAPrPoIqF3rPI_1pYqOpUNtQJJQWsTMPPpV3rQQIQUEtIOwMzMtLDAsYYQIRJrAY_3rIADAW3GuAIFIOrQYgIFrQZ3sIS3oOuJIKII_rYggYIFrIF3sGtNwByoEuCBYgRQYerYAQewN4qAI$oLuKQQYYQQYYerRQYQLoC3voSrFoHyDzqAYJIIQ_rMFoI3voPqYEzqGrFwoAJJIQQQfrIAoOBA3$KFLoP0pOwoRQQQIIIPrMoIRIYL3voEpVgNJAMAISAQzoBzoIQRIQQWrNoQgQYUqI3tIQ_oILJAIbYQYYYYQBYIQRIQYzoBzoaIAIPrUoQQIJIFqO3sAQTpADAJIQAJEIQgi$MsGzTQCGsPIH3voPQOAHAQIAIoQYYUzoWuLvoQIRIsIC3$N_PAJQBoQYIQLzoGuLvoQIQS4rGoQAJYFzAzpQIsIBO3yAZzqK0qKID3yQQzqAKEzpQOrAIOoKrI3vOqB$oGQAoY_zpQPrQAV3$oQSzpFJIATIZQI0qIQBISqAJo_C3vIKrV$oYHAYgYYYP0oBoQSQDANpP3voLKzoQULoIQIQgIC0pFYUTCpC3wagPzoOoIQYYII0qQTNpIQA3wJIQIWzqJAYggJN0pQTP3$ISJQ0IYIQEAM0oAbIIK_3$Qd0_0pEYYFpO3wEqD3vQgQO51oYQApK5P0pCQQcoI3woE0o_0pMgToL3wLF3$I3$oSCtAyoOsQzoPqO3vAIaT3yPoL3vIKO0oO0pJrUG3uACTuARyPtczKqN3vAJLuMyQsCzpKoL3wIAevL$oG1LoC3voIUvY3sIIrF3uWrIPoF3tBQDpJ3voEvCoCYR$J0qMoBoM4oGoIU$NYtF4yoEsJoJ$QQJ0qCI3woGuEoQoBI$IgR0qTqK4qdwoQS0qIE4tOwoa0qAYggQ_3wPwIOwoYEtWzYYYYQQQQYQIIAG4qLCQIVwoW0qQQIQIQQIQYgIIsD3yoIQUwoQB1IIYYQQYYQN3voFwAQQU3rIIQQQRJ3$oPtAI$csBEzqRN4pIDJIBB$EsG1qB3rEuAQIS5yLvNpIIKzpB4$PwIYG51oP5yoQP1oEoB4yISHvIQ_$B2oL3yoQQczL2C3qG1pE1qAS3qD1qF1G3sE4rA3yCL3wC5U1oJ3wo_oYfzpFoM1M3tJrDoIIK0H0pAAIJJRoS3uNraoC3wQJEoQISIBpH3rW3yoIMI3wT0qIS0qNAYJpJoQE3rB0oAvAzqHIe3$oMoDN0oIDzqFpd3$KEL3voIBJIYUqFK3voNAYYMANzpM0pHH3woJpBIQWZzoIuIRyoHYLSRpS3wAoAAYIAIIFMQ_0qCyoQoQQJQYAAIBCrP3vCJAIQYGBIAAAAO0qICzIKQJQtN3rDqBAQIIKLJBV3vQYIIQYYQB_oA3uJoBpOKIIQAQQRKIIQIASIC3vMQYQABQoD3$ABIAYgYIIRQggYYJICyBqIE0pFJYQZI3wHpIQTABYggYaBKzpO0paRIQIQRBK3vJrKAFAQYggAJzpCIIRE0pBQQEQKBISsO3pHUrQOzpAAI1FI3voIWpAFzqSEIRT0pKoSMrCL3tYZC_AIAYCzpEIIQIKAT0pQZQgVoP3wJCJoAYKzpJKYYgIYCAQIT0qLEsM3sOCoQfzpIggQTK0qYIQHaBL3vZoFpYezpQIYJV0qAQIoQAIQLqGoJ3qILoIVUAJACJd3woYfAasIU3qSoMoDCezpNAO0qIYQMNsQZ3qKqNQWzpO1YYSItN3tLIbzpHBLQR5oNoHoQYJPzpQAoK5LqGKIIgQQ0QgQ0qR3yZB0W51oT2pN3pPAcBMIB50qQVBIFYPoJ0F0oYO3$BJoToP3voYEvK3pAQLYFoIf0oAP0oGvIQ3pIIaAYTTOQTD3woGvIA3pIAaHIoBDzqIYNFQR2qYa3pAVoAoQYAzqIWED2qQC3pVJpQggSYQAK4fpC3pIAqIR4oMpV3pM7zH3pRPpOO4voZ2NDpD4wO2qM4pYbuJL2qL4pJRB3qIoQCoWF50qIK4$M51pF51oG60oKL4$oI8uO3rL4woP51oO83woN74sP51oP8$oW51oIYH51oD74rJ74oG51pQO51oV51F51pG74qA';
const ISS_LAND = 'AJW-nDGCUBDBPDKJEBCCQWp-h0GEF$D---gW-$BoBLJCHSTp-h2FDFwE---iBFT--iS_Qn-g3H2D---sKDF--ZCCUNCJRfBFZBLD4qFHDEB----VCQF--fBFBCWMFGTdBCaFCM2UBBBVM----cHIL--hCENVEDWZkRzTISL----cKFMKB--VCIJZb_jSyVGVDFC----ao--UDKICHQbWlOzVGYE----dp--QGGDERPaWoG2WF----7WDN--RLBNCMHCEcU-jWG----+g--URDWIDBdR-jWG-----Ce--TTBGBDGBDJFgQ-gYI----fCYk--TbBDMtP-fZI----VEGCUp--RgNtN-gYJ----SHDFRtaCFE-phRvG-hZI----RORrCDYCHH-liQJBnE-UBMbIGH----AOHBCGB3SDDSCB-biQID--McS----BNF-GQFBY-ZiRIE--LBBJBPK---$HBKHKG-HCDBBKf-YBBeUFG--LIDMLBB---wjG-RHCBgDB-Ufe-wBDDUEGKLBE---sjH-SEECgFB-Tfe-yDgJEBL---rhM-OEEDjBBBB-TDBce-wI_CDJDBGDC---qjM-NDt-eYe-wHWEEIJ---ujO-KEy-cRBFe-$FWFEHK---tkNBB-GE1CB-dSh-vHUECDBDN---rlN-HC6CB-iKk-qBEHUCBCBBS---pnN-EC-C-iGr-kGEFTDCBMCD---qEBjN--J-hGs-hHFGTECDE---2EBGBaJ-CB-ECD-iGmBG-eIGGPBB----GCEEBaI--JBF-gGu-eHDKK----TCCaI--KBF-fHt-eHELG----VCDZF--V-eGu-cHEMG----ZbE--V-gDt-eDHMG----WCDaD--_--MEC-oKE----_DDaC--_CB--JEC-oIE----aDD--zFB-4BKFC-1----aDE--0EB-0GCKE-y----cDE--2EC-vECECIJ-p----gDE--4DC-sCHMJ-lCD----gDC--7CC-rBIML-j----lEB--8-4LN-k----iFB--8-4TBCC-m----fGC--8-3IBOB-n-OEYF--tHD--7-5BCCD-3-ADGGWI--sIB--9-7DD-3+GEGUK--r---I-1CH-6bCgHHBVI--tJC--9-zDF-9bFcJCGTI--tKD--8-vGD--AUCGFbURH--tLE--7-tIC-zBMSFGFaWQH--rMH--3-t-8ZECIHGWZOI--oMK--2-s-9YMBDGIUbNJ--gDBNI--5-s-9YLCEGJSbNJ--eTBEC--7-s-8YMBGHHRJGMOIBC--aUC---B-p--BVWHGTFLIQL--Z---W-o--DTPCJHEJEDDpHBB--ICPVD--+-m--ETQCLEBCCGBCFuG--KDN_E--+-l--ESFCKCNBHGGvI--GEECGZE--+-k--ESSCNCHFGBBtI--FFBHEZE---A-i--FTgBJFHsK--BPG_E---C-eBC--GRgCKFFtK--COHWD---E-d--JQbGMDIsK--EDBLFUE---E-d--JPWBHDNDJuH--ECFIGSF---F-d--NILEBLHBPBKFCnD--MKGOJ---F-d--OBMUmCEDE--rMGNJ---H-c--OBK_y--qNGNJ---I-a--PDBCDZZFOCE--pOGGOBB---J-Z--OisCF--pOCJJBD---P-U--Rhz--sVECBBD---W-Q--Qky--sUBDECB---Y-O--Pov--uRFBC---e-L--QuODZ--uTD---h-K--QyJH_--vSC---j-I--RyJKT--wSC---jDD-B--R1HPFEE--$SB---lDD-A--R4E---O---4DDvHJ--S----K---5DDlBIIBDF--Q-1F--R---5DCjICBBME--P-_BeF--R---6DChaE--N-4F--P---8CDddE--BBK-aBCBbF--O---8EEbdE--J-eEbG--L---9FDaeF--H-gDcH--J----AEEYfE--H-gEcIDD--A----DCEZeE--F-iFbO-+----FCDZfD--F-jFaCBJBC-9----FCFWhB--F-lEdICJFCBD-q----GDFVmB--A-lEdGEV-oFC----BCGU--m-nEcFGV-mFC----ECFT--l-oGnU-kFD----FBGS--l-oGpT-hHD----NQcJ--A-qGpV-bKC----PPbCEG-9-rFqSsCrOB----PQdBFF-6-tEpUFBhGo----hQPGRE-4-tEoWEBdKfFB--8B-mRNHSG-2-sFmYBEcLcGC----kRNGUG-1-tFkebNb---GC-kSMGdF-t-tGjdaQZGE--8C-lSKHdH-r-tHieYRYGE----nRIIeI-q-sHgg_TYFE----pRBMUDFGIC-l-uGehWV_dD----Vb--S-vGbjVWYcD----Wa--S-vHZkTYZbE----YW--S-wHWoSYFBUaE----aHBM--S-wITqQaDDVZD----eCFT--J-$GTrOiW_D----nT--H-zFStMj_WD----oS--G-2EN$MkWWD----pR--H-2DMzLkW_DBB----qN--I-2CJ2Lk__BBDBB----qBBI--I-3CE6MkDCRWCDC----tI--I-4BD8KZBLDCR_B----zH_C-u-5-AKlDFOeC----sGWC-$-2PB$JlDGMgB----tEUEDE-r-3KF$JlCHMaCDC----tFQOOB-e-2DLyIlCIJcDCB----uFQHBMCECB-e--FyHmBLFYBHC----$BBDPHCT-h--DzFnBMDgCBB----zDFEEe-g--C0FCCjCLCYBJBEB----$ICCCf-h--B0DECjDjBOC----yFEm-e--A2CEDiEtH----0DDn-d--A7EjDrJ----7n-e-89EjCrBDF----8n-e-79EkDeCND----+o-fZF-a+DlEcDND----+v-ZWI-Z-oEbF-----Ny-_RN-_-fEGFZH-----Mz-YEY-W-gFFGWI-----N0-6-P-hFEGVI-----P0-6-N-jFEFUI-----P1-7-L-lFDFTJ-----O2-7-K-nFDEQM-----N4-6-J-pFDEPNUB----16-4-I-sGDCLBCOTB----26-4-G-rBDHNTFBGBFC----z8-4-F-wIMSEJGC----z8-4-E-yILR----yBV6BF-1-D-0HLREBPBFB----_BV-BBC-$-D-1HMQEBFCQF----m-H-v-D-yBDILOFCBDBBPG----m-ABJ-t-B-3ICBINGFFBFBIEHC----d-K-t-A-5IBCHNFFWDFG----c-O-p9-7KCBFMFDBCVEDL----Z-T-k7-8JMCBFGDBDHCCFEFBO----V-W-k6-9IRCICBDIBMBBU----S-_-k4--AHbCCDYUPB---+-Z-k3--CFbCCBBBbSMC----B-c-g2--EEbCEBdRKC----C-d-f2---JREGGB---7-d-g1--IE0BISECJB---8-b-g2--GHDD1SQB---8-a-h1--IOzQ----P-a-h1--LBBLhBNMCF----P-Z-i0--RJFBMBaBDHFE----P-Y-h1--bGCEGEbGGEYB---0-_-i1--sCgBKF_B---z-W-k1--hCGDtFUB---2-V-k2--oByD----L-T-m2-------r-S-n1--5BTC----c-Q-n2--2BDCRC----c-P-o2RB--lMJD----d-O-n3RB--kMKE----c-M-o4RC--iMLE----c-M-o4PE--iMLE----d-L-o4PE--aDENLF----c-L-n6NG--_GDMMH----c-J-n5NH--_WLIqB---w-I-n5LHBB--WZJI----e-G-n4JL--_aII----g-E-n3KL--TBBeFJ-DC---d-C-m1ML--TjDK----i-B-m0NL--Tw-AC---h+-oyOL--Tw----j+-pwPK--Ty----i+-puSJ--Tz----i8-rsTJ--R3----g8-rsTISB-68----f7-trSJ--K-CfB---96-urRK--I-FfB---86-vrQJ--I-GgC---56-$qPK--H-HiB---45-yqQJ--F-M----Z0-3qQI--G-M----Zy-5qQI--G-N----Yv-8qQI--G-O----_u-9pSG--H-P----Wt--AlWD--K-O----Ws--Bk--k-P----Vs--Bk--k-P----Ut--Bk--j-Q----Ut--Cj--k-Q----Tt--Ci--l-Q----Tt--Dh--m-P----St--Ff--n-P----Ss--Hd--p-O----Sr--Ic--q-O----Sr--Ic--q-N----ToBB--Ka--r-N----To--NY--t-M----Tn--O_--ubGq----Tn--PV--vYMm----Um--PV--wTSk----Um--QT--yRVGBb----Vl--SQ--zR_EBc----VbBJ--TG--8JgCCb----WcDE--WB---DFiBDBBZ----Ve------OYtD---le------LBD_uC---kg------PVwB---kh------PU$B---ih------QU$D---gg------SSzDCC---bg------UGBF2I---bc------hB4H---c_-------fG---e_-------gF---eW-------iD---e_-------dBED---eS------pIvECC---fBCP------qHuF---jBCQBB------oFvF---jBBQCB------oFuF---kBBQ------sCuG---nQ-------bI---nP-------aH---nBBQ-------ZH---oBBN-------bI---oO-------bI---oP-------cG---pQ-----------MR-----------KR-----------IT-----------IR-----------KQ----VD------yCBM-----------OM-----------OM-----------RK-----------RKRF----------6L-----------RGBD-----------SCBBBE-----------RCBCCF-----------SCCG8B----------VL6B----------_C-----------------------------------------------------------------C';
let ISS_G = null;
function issMaps(){ const A = 'ABCDEFGHIJKLMNOPQRSTUVW_YZabcdefghijklmnopqrstuvw$yz0123456789+-', ix = {}, ZR = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 28, 32, 48, 64, 96, 128, 256, 512, 1024, 2048]; for(let i = 0; i < 64; i++) ix[A[i]] = i;
  const L = new Float32Array(720 * 244), M = new Uint8Array(720 * 252); let k = 3, cur = 0;
  /* lights: a char under 40 is a lit cell (five steps, a factor of two each) and 0..7 dark cells after it; 40..63 is a run of dark cells. land: runs of sea and land in turn */
  for(let i = 0; i < ISS_LIT.length; i++){ const c = ix[ISS_LIT[i]]; if(c < 40){ L[k++] = .04 * (1 << (c >> 3)); k += c & 7; } else k += ZR[c - 40] * 8; }
  k = 0; for(let i = 0; i < ISS_LAND.length; i++){ const c = ix[ISS_LAND[i]]; if(c === 63){ M.fill(cur, k, k + 63); k += 63; } else { M.fill(cur, k, k + c); k += c; cur ^= 1; } }
  return {L, M}; }
function tPlanet(env, X){
  const {cols, rows, ax, phone} = env, PX = env.P, D = X.D, p = X.p, sp = p.speed, N = cols * rows, rad = Math.PI / 180, cl = (v, a, b) => v < a ? a : v > b ? b : v;
  if(cols < 60 || rows < 48) return () => {};                 /* too small to hold the view */
  const PART = 255;                                         /* what is drawn: 1 city lights, 2 cloud, 4 stars, 8 lightning, 16 air (limb, airglow, sunrise), 32 aurora, 64 station (kept for measuring) */
  const {L: GL, M: GM} = ISS_G || (ISS_G = issMaps());
  /* the two maps, bilinear; lat and lon in degrees */
  const grid = (F, top, ny) => (lat, lon) => { const fy = (top - lat) * 2 - .5; if(fy < 0 || fy >= ny - 1) return 0; let fx = (lon + 180) * 2 - .5; fx -= Math.floor(fx / 720) * 720;
    const x0 = fx | 0, y0 = fy | 0, x1 = x0 === 719 ? 0 : x0 + 1, u = fx - x0, v = fy - y0, o = y0 * 720; return (F[o + x0] * (1 - u) + F[o + x1] * u) * (1 - v) + (F[o + 720 + x0] * (1 - u) + F[o + 720 + x1] * u) * v; };
  const litAt = grid(GL, 66, 244), landAt = grid(GM, 68, 252);

  /* ---- the camera: 400 km up, aimed at the horizon ahead ---- */
  const RE = 6371, RC = 1 + 400 / RE, DEP = Math.acos(1 / RC), SI = Math.sin(51.6 * rad), CI = Math.cos(51.6 * rad), ER = 5561 / 86164, RSC = 1 + 11 / RE;
  const mg = phone ? 0 : Math.max(0, (env.W - 1240) / 2 / PX), TOP = phone ? Math.round(rows * .145) : Math.ceil(rows * .47) + 1;
  const f = rows * (phone ? 1.9 : 1.54), roll = (phone ? (p.tilt >= 0 ? 1 : -1) * (7 + 4 * Math.abs(p.tilt)) : 3.5 * p.tilt) * rad, cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(DEP), sps = Math.sin(DEP);
  const pcx = cols * (.5 + (phone ? .1 : .14) * p.off); let pcy = 0;
  const R3 = [0, 0, 0], H2 = [0, 0];
  const ray = (x, y) => { const a = (x - pcx) / f, b = (pcy - y) / f, x1 = a * cr - b * sr, y1 = a * sr + b * cr, dy = y1 * cp - sps, dz = y1 * sps + cp, n = 1 / Math.hypot(x1, dy, dz); R3[0] = x1 * n; R3[1] = dy * n; R3[2] = dz * n; };
  const shell = rs => { const dy = R3[1], b = RC * dy, qo = b * b - RC * RC + rs * rs; if(dy >= 0 || qo < 0) return false; const t = -b - Math.sqrt(qo); H2[0] = Math.atan2(t * R3[2], RC + t * dy); H2[1] = Math.asin(t * R3[0] / rs); return true; };
  const proj = (dx, dy, dz) => { const zc = dz * cp - dy * sps; if(zc <= .02) return false; const a = dx / zc, b = (dy * cp + dz * sps) / zc; H2[0] = pcx + f * (a * cr + b * sr); H2[1] = pcy - f * (-a * sr + b * cr); return true; };
  /* put the top of the limb's arc a little under the caption line */
  { let ym = 1e9; for(let x = 0; x < cols; x += 2) for(let y = -rows; y < rows; y++){ ray(x + .5, y + .5); if(shell(1)){ if(y < ym) ym = y; break; } } pcy = (phone ? Math.round(rows * .42) : TOP + 13) - ym; }
  const MK = new Float32Array(rows); for(let y = 0; y < rows; y++){ const t = 1 - (y + .5) / rows, a = t <= .14 ? 1 : t <= .46 ? 1 - .45 * (t - .14) / .32 : .55 * (1 - (t - .46) / .54); MK[y] = Math.min(1.6, Math.pow(Math.max(.05, a), -.85)); }

  /* ---- the date: the Moon's phase lights the cloud; the orbit of each pass ---- */
  const day = dayOf(String(p.ymd).replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3')), age = (((day + 2440587.5 - 2451550.26) / 29.530588) % 1 + 1) % 1, moonK = .3 + .5 * (1 - Math.cos(age * TAU)) / 2;
  const WO = TAU / 5561 * 14, TP = 100, TS = TP - 6, DA = Math.max(6e-4, .17 / f);
  const geo = (ua, c, om, o) => { const cu = Math.cos(ua), su = Math.sin(ua), cc = Math.cos(c), sc = Math.sin(c), px = cc * cu, py = cc * su * CI + sc * SI, pz = cc * su * SI - sc * CI; o[0] = Math.asin(pz) / rad; o[1] = ((om + Math.atan2(py, px) - ER * ua) / rad % 360 + 540) % 360 - 180; };
  const passes = new Map(), LL = [0, 0];
  const passOf = n => { let qo = passes.get(n); if(qo) return qo; let best = -1, sd = 0;
    for(let k = 0; k < 24; k++){ const om = hash2(p.seed + n * 977, k * 2 + 1) * TAU, u0 = TAU + hash2(p.seed + n * 977, k * 2 + 2) * TAU;
      let s = 0, d = 0;
      for(let i = 0; i < 5; i++) for(let j = -3; j <= 3; j++){ geo(u0 + (.1 + .05 * i), j * .03, om, LL); cloudLow(LL[0], LL[1], 0); const v = Math.sqrt(litAt(LL[0], LL[1])) * (1 - nT[0]) * (1 - nT[0]); s += v - .05 * nT[0]; d += v * j; geo(u0 + WO * 25 + (.1 + .05 * i), j * .03, om, LL); s += .4 * Math.sqrt(litAt(LL[0], LL[1])); }
      s *= .6 + .4 * hash2(p.seed + n, k + 50); if(s > best){ best = s; qo = {om, u0, sd: d > 0 ? -1 : 1, au: sstep(.45, .85, hash2(p.seed + n, 93)), az: (hash2(p.seed + n, 91) < .5 ? -1 : 1) * (.14 + .22 * hash2(p.seed + n, 92)) * (phone ? .4 : 1)}; } }
    passes.set(n, qo); return qo; };

  /* ---- every cell: sky or ground; ground cells know where they look (offsets along and across the track, in map texels) ---- */
  const SKb = new Float32Array(N), SKc = new Uint8Array(N), OK = new Uint8Array(N), ZT = new Float32Array(N), AZ = new Float32Array(N);
  const gc = [], cc_ = [], sk = [], sd = [];
  const lay = (zt, z0, wc, wt) => zt > z0 ? Math.exp(-(zt - z0) / wt) : Math.sqrt(wc / (z0 - zt + wc));
  const air = (zt, o) => { const g = .62 * lay(zt, 96, 2.5, 5), s = .3 * lay(zt, 86, 14, 9), r = .2 * lay(zt, 250, 40, 60) * (zt > 60 ? 1 : zt > 0 ? zt / 60 : 0), b = zt >= 0 ? .34 * moonK * Math.exp(-zt / 11) : 0; o[0] = g; o[1] = s; o[2] = r; o[3] = b; };
  const A4 = [0, 0, 0, 0], AH = DEP, AHC = Math.acos(RSC / RC);
  let aMin = 1e9, aMax = -1e9, cMax = 0, eg = 0, ec = 0, ey = -1, NG = 0;
  let GK = new Int32Array(N), G0 = new Float32Array(N), GW = new Float32Array(N), C0 = new Float32Array(N), CW = new Float32Array(N), GH = new Float32Array(N), GHC = new Uint8Array(N), GX = new Float32Array(N), GT = new Float32Array(N);
  for(let x = 0; x < cols; x++) for(let y = 0; y < rows; y++){ const k = x * rows + y, col = phone || (x >= mg && x < cols - mg); if(y < TOP && col) continue;
    ray(x + .5, y + .5); const dy = R3[1], az = Math.atan2(R3[0], R3[2]); AZ[k] = az;
    let g = 0, s = 0, r = 0, b = 0, zt0 = 0; for(let qo = -1; qo <= 1; qo++){ ray(x + .5, y + .5 + qo * .33); const d = R3[1], zt = d < 0 ? (RC * Math.sqrt(1 - d * d) - 1) * RE : 1e3 + d * 3e3; if(!qo) zt0 = zt; air(zt, A4); g += A4[0] / 3; s += A4[1] / 3; r += A4[2] / 3; b += A4[3] / 3; }
    ZT[k] = zt0; const dt = dith(x, y) * LV, sum = g + s + r + b, c = b > g + s ? 12 : r > g + s ? 11 : g > s * (1.7 + dt * .4) ? 9 : 10;
    ray(x + .5, y + .5);
    if(!shell(1)){ OK[k] = 1; SKb[k] = sum; SKc[k] = c; sk.push(k); sd.push(R3[0], R3[1], R3[2]); continue; }
    /* the cell's top and bottom edges on the ground and on the cloud shell; a bottom edge is the next cell's top edge, so it is traced once */
    const a = H2[0], c1 = H2[1], cc1 = shell(RSC) ? H2[1] : c1; if(ey !== y){ ray(x + .5, y); eg = shell(1) ? H2[0] : NaN; ec = shell(RSC) ? H2[0] : NaN; }
    const tg = eg, tc = ec; ray(x + .5, y + 1); eg = shell(1) ? H2[0] : NaN; ec = shell(RSC) ? H2[0] : NaN; ey = y + 1;
    const a0 = eg === eg ? eg : a, a1 = tg === tg ? tg : AH - 1e-4, ca0 = ec === ec ? ec : a0, ca1 = tc === tc ? tc : AHC - 1e-4;
    const w = Math.max(1, (a1 - a0) / DA), wc2 = Math.max(1, (ca1 - ca0) / DA);
    GK[NG] = k; G0[NG] = ((a0 + a1) / 2 / DA - w / 2); GW[NG] = w; gc.push(c1 / DA); C0[NG] = ((ca0 + ca1) / 2 / DA - wc2 / 2); CW[NG] = wc2; cc_.push(cc1 / DA); GH[NG] = (sum * .4 * Math.exp(zt0 / 250)); GHC[NG] = c; GT[NG] = (Math.exp(-(AH - a) / .045)); GX[NG++] = (Math.pow(w, .4) * Math.exp(-.12 / Math.max(.004, Math.sin(Math.atan2(Math.cos(a) - 1 / RC, Math.sin(a))))));
    aMin = Math.min(aMin, a0, ca0); aMax = Math.max(aMax, a1, ca1); cMax = Math.max(cMax, Math.abs(c1), Math.abs(cc1)); }
  if(NG < 9) return () => {};
  GK = GK.slice(0, NG); G0 = G0.slice(0, NG); GW = GW.slice(0, NG); C0 = C0.slice(0, NG); CW = CW.slice(0, NG); GH = GH.slice(0, NG); GHC = GHC.slice(0, NG); GX = GX.slice(0, NG); GT = GT.slice(0, NG);
  const NSK = sk.length, SKK = Int32Array.from(sk), SD = Float32Array.from(sd);
  const NC = 2 * (Math.ceil(cMax / DA) + 3), HC = NC / 2, GC = Int16Array.from(gc, v => Math.round(v + HC)), CC = Int16Array.from(cc_, v => Math.round(v + HC));
  const T0 = Math.floor(aMin / DA) - 2, WN = Math.ceil(aMax / DA) + 3 - T0; let NA = 64; while(NA < WN + 4) NA *= 2; const AM = NA - 1;
  const CH = new Int16Array(WN + 1); for(let j = 0; j < NG; j++){ const h = Math.max(Math.abs(GC[j] - HC), Math.abs(CC[j] - HC)) + 32, i0 = Math.max(0, Math.floor(Math.min(G0[j], C0[j])) - T0 - 1), i1 = Math.min(WN, Math.ceil(Math.max(G0[j] + GW[j], C0[j] + CW[j])) - T0 + 1); for(let i = i0; i <= i1; i++) if(h > CH[i]) CH[i] = h; }
  for(let i = 1; i <= WN; i++) if(CH[i] < CH[i - 1]) CH[i] = CH[i - 1];

  /* ---- the ground under the track: a strip of map texels in orbit coordinates (along, across), built column by column as the pass goes on.
     Each column keeps running sums along the track, so a far cell that looks at a long thin piece of ground reads its mean in four look-ups. ---- */
  const SL = new Int32Array(NA * NC), SA = new Int32Array(NA * NC), SB = new Int32Array(NA * NC), RG = new Float32Array(NA * NC), SEA = new Uint8Array(NA * NC), TP_ = new Float32Array(NC);
  const NN = (NC >> 3) + 2, nC = new Float32Array(NN), nS = new Float32Array(NN), nLat = new Float32Array(NN), nLon = new Float32Array(NN), nT = new Float32Array(NN), nV = new Float32Array(NN), nF = new Float32Array(NN);
  for(let j = 0; j < NN; j++){ const c = (j * 8 - HC + .5) * DA; nC[j] = Math.cos(c); nS[j] = Math.sin(c); }
  const FLEET = [39, 133, 5, 30, 124.5, 4, 10, 101.5, 3, 17, 71.5, 3, -45.5, -60.5, 2.5, -5, 110, 3, -12, -79, 3];
  /* cloud by climate: storm clusters along the equatorial trough, clear subtropics with fields of small cells, long frontal bands in the middle latitudes */
  let cT = 0, cV = 0;
  const cloud0 = (lat, lon) => { const al = Math.abs(lat), xr = lon * .866 + lat * .5, yr = lat * .866 - lon * .5, wx = noise(xr * .12 + 3, yr * .12 + 50) - .5, wy = noise(xr * .12 + 90, yr * .12 + 13) - .5;
    const B = .55 * noise(xr * .085 + wx * .5 + 31, yr * .14 + wy * .5 + 7) + .45 * noise(xr * .27 + wx * .7 + 5, yr * .4 + wy * .7 + 60), itc = Math.exp(-((lat - 6) / 9) * ((lat - 6) / 9));
    const cov = .27 + .16 * sstep(30, 48, al) + .2 * itc - .14 * sstep(8, 18, al) * (1 - sstep(28, 38, al)), th = .5 + (.5 - cov) * .6;
    cT = sstep(th - .06, th + .1, B); cV = itc * sstep(th + .02, th + .14, B) + .2 * sstep(40, 50, al); };
  /* the noise does not repeat round the globe, so near longitude 180 the two sides are cross-faded; the fine noise below uses longitude factors that are whole multiples of 256 / 360, which do repeat */
  const cloudLow = (lat, l0, j) => { const lon = (l0 % 360 + 540) % 360 - 180, m = .5 * sstep(165, 180, Math.abs(lon)); cloud0(lat, lon); let T = cT, V = cV; if(m > 0){ cloud0(lat, lon < 0 ? lon + 360 : lon - 360); T += (cT - T) * m; V += (cV - V) * m; } nT[j] = T; nV[j] = V;
    let fl = 0; for(let i = 0; i < FLEET.length; i += 3){ const d = Math.hypot(lat - FLEET[i], (lon - FLEET[i + 1]) * Math.cos(lat * rad)) / FLEET[i + 2]; if(d < 1) fl = Math.max(fl, 1 - d * d); } nF[j] = fl; };
  const NGJ = (NC >> 5) + 1, SM = (NA >> 5) - 1, ST = new Float32Array((SM + 1) * NGJ);
  let bLo = 0, bHi = -1, bPass = null, lastU = -1e9, OM = 0;
  const build = (I, half) => { const s = (I & AM) * NC, pv = ((I - 1) & AM) * NC, first = I === bLo, ua = (I + .5) * DA, cu = Math.cos(ua), su = Math.sin(ua), lonE = OM - ER * ua;
    const j0 = Math.max(0, (HC - half) >> 3), j1 = Math.min(NN - 2, ((HC + half) >> 3) + 1); let lp = 0;
    for(let j = j0; j <= j1 + 1; j++){ const px = nC[j] * cu, py = nC[j] * su * CI + nS[j] * SI, pz = nC[j] * su * SI - nS[j] * CI, lat = Math.asin(pz) / rad; let lon = (Math.atan2(py, px) + lonE) / rad; lon += 360 * Math.round(((j > j0 ? lp : 0) - lon) / 360); lp = lon; nLat[j] = lat; nLon[j] = lon; cloudLow(lat, lon, j); }
    for(let C = 0; C < NC; C++){ const o = s + C, j = C >> 3; let li = 0, al = 0, cb = 0;
      if(j >= j0 && j <= j1){ const w = (C & 7) / 8, lat = nLat[j] + (nLat[j + 1] - nLat[j]) * w, lon = nLon[j] + (nLon[j + 1] - nLon[j]) * w, tb = nT[j] + (nT[j + 1] - nT[j]) * w, rho = litAt(lat, lon), land = landAt(lat, lon);
        SEA[o] = land < .5 ? 1 : 0; RG[o] = rho;
        if(rho > .004 && land > .2){ const n1 = noise(lon * 2.8444 + 9, lat * 3.1 + 4), n2 = noise(lon * 7.1111 + 21, lat * 7.3 + 33), n3 = noise(lon * 21.3333 + 2, lat * 21 + 8), rd = 1 - Math.abs(2 * noise(lon * 4.2667 + 60 + n1, lat * 4.3 + 30) - 1), r4 = rd * rd * rd * rd, n2s = sstep(.3, .75, n2), sq = Math.sqrt(rho), T = Math.max(0, n3 * (.35 + 1.25 * n2s) - 1.2 + .7 * sq);
          li = (.012 * rho + sq * ((1.2 * T + 7 * T * T * T) * (.5 + n1) + .5 * r4 * r4 * r4 * (.25 + n2s))) * sstep(.2, .5, land); }
        else if(land < .5){ const fl = nF[j] + (nF[j + 1] - nF[j]) * w; if(fl > 0){ const n = noise(lon * 22.7556 + 70, lat * 23 + 15); if(n > .8) li = fl * (n - .8) * 2.5 * sstep(.4, .65, noise(lon * 2.8444 + 7, lat * 2.5 + 90)); } }
        if(tb > .02){ const xa = lon * 4.2667 + lat * 2.3, ya = lat * 3.98 - lon * 2.1333, d1 = noise(xa + 17, ya + 3), d = .3 * noise(lon * .7111 + lat * .55 + 70, lat * 1.386 - lon * .7111 + 44) + .35 * d1 + .1 * noise(lon * 14.2222 + 40, lat * 14 + 9) + .25 * noise(lon * .7111 + lat * .6 + 8, lat * 6.06 - lon * 3.5556 + 21); let t = (tb * 1.3 - (1 - d) * 1.02) * 3; const cv = nV[j] + (nV[j + 1] - nV[j]) * w; if(cv > 0) t += cv * 2.4 * sstep(.5, .8, noise(lon * 2.1333 + 5, lat * 2.4 + 77)) * d;
          if(t > 0){ al = 1 - Math.exp(-1.6 * t); cb = al * (.07 + .93 * Math.pow(t / (t + 2.5), 1.3)) * cl(.9 + .8 * (d1 - noise(xa + 17.3, ya + 3.3)) + .5 * (d - .5), .45, 1.35); } TP_[C] = t > 0 ? t : 0; } else TP_[C] = 0; }
      else { SEA[o] = 1; RG[o] = 0; TP_[C] = 0; }
      li = Math.round(li * 4096); al = Math.round(al * 4096); cb = Math.round(cb * 4096);          /* whole numbers: the sums, and so the picture, do not depend on where the strip was started */
      if(first){ SL[o] = li; SA[o] = al; SB[o] = cb; } else { SL[o] = SL[pv + C] + li; SA[o] = SA[pv + C] + al; SB[o] = SB[pv + C] + cb; } }
    for(let gi = I >> 5, gj = 0; gj < NGJ; gj++){ const id = gi * 131 + gj; if(((hash2(id, 71) * 32) | 0) !== (I & 31)) continue; const C = gj * 32 + ((hash2(id, 72) * 32) | 0); ST[(gi & SM) * NGJ + gj] = C < NC ? sstep(.7, 2.2, TP_[C]) * Math.min(1, nV[C >> 3] * 1.6) : 0; } };
  const ensure = (qo, uT) => { const lo = Math.floor(uT) + T0, hi = lo + WN; if(qo !== bPass || lo < bLo || lo > bHi + 1 || uT < lastU){ bPass = qo; OM = qo.om; bLo = lo; bHi = lo - 1; } lastU = uT;
    while(bHi < hi){ bHi++; build(bHi, CH[cl(bHi - lo, 0, WN)]); } if(bHi - bLo > NA - 8) bLo = bHi - NA + 8; };

  /* ---- stars: fixed to the sky, which turns once an orbit; they come up through the air at the limb ahead ---- */
  const NS = 3600 + Math.round(D.nPart * 3.5), sS = new Float32Array(NS), sP = new Float32Array(NS), sM = new Float32Array(NS), sC = new Uint8Array(NS);
  { const a = Array.from({length: NS}, () => [X.rnd() * TAU, X.rnd() * 1.5 - .75, .16 + .84 * Math.pow(X.rnd(), 3.2), X.rnd()]); a.sort((u, v) => u[0] - v[0]); a.forEach((qo, i) => { sP[i] = qo[0]; sS[i] = qo[1]; sM[i] = qo[2]; sC[i] = qo[3] > D.share ? 19 : qo[3] < .3 * D.share ? 17 : 18; }); }

  const PAL = [[70, 84, 120], [140, 154, 184], [208, 216, 232], [196, 104, 44], [238, 160, 70], [255, 214, 150], [255, 240, 214], [176, 232, 214], [190, 150, 110], [104, 196, 112], [178, 124, 70], [150, 58, 64], [58, 98, 176], [96, 156, 246], [250, 206, 120], [255, 246, 228], [206, 220, 255], [186, 204, 244], [236, 232, 220], [236, 186, 128], [96, 226, 138], [168, 84, 140], [120, 124, 156], [96, 100, 112], [206, 150, 64], [44, 62, 104]];
  const SK = PAL.map(c => Array.from({length: LV}, (_, i) => `rgba(${c[0]},${c[1]},${c[2]},${(.2 + .66 * (i + 1) / LV).toFixed(3)})`));
  /* ---- the painter: round dots like the kit's, one sort buffer for the whole piece ---- */
  const Lb = new Float32Array(N), Lc = new Uint8Array(N), NK = PAL.length * LV, ord = new Int32Array(N), kb = new Int16Array(N), cnt = new Int32Array(NK + 1), pos = new Int32Array(NK);
  const paint = c => { cnt.fill(0); for(let k = 0; k < N; k++){ const a = Lb[k]; if(a < .05){ kb[k] = -1; continue; } const key = Lc[k] * LV + Math.min(LV, Math.ceil(a * LV)) - 1; kb[k] = key; cnt[key + 1]++; }
    for(let i = 0; i < NK; i++){ cnt[i + 1] += cnt[i]; pos[i] = cnt[i]; } for(let k = 0; k < N; k++) if(kb[k] >= 0) ord[pos[kb[k]]++] = k;
    for(let key = 0; key < NK; key++){ const a0 = cnt[key], a1 = cnt[key + 1]; if(a1 === a0) continue; const fq = (key % LV + 1) / LV, r = PX * (.17 + .33 * fq); c.fillStyle = SK[(key / LV) | 0][key % LV]; c.beginPath();
      if(r < 1.45) for(let i = a0; i < a1; i++){ const k = ord[i]; c.rect(((k / rows) | 0) * PX + PX / 2 - r, (k % rows) * PX + PX / 2 - r, 2 * r, 2 * r); }
      else for(let i = a0; i < a1; i++){ const k = ord[i], x = ((k / rows) | 0) * PX + PX / 2, y = (k % rows) * PX + PX / 2; c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }
      c.fill(); } };
  const DI = new Float32Array(N); for(let x = 0; x < cols; x++) for(let y = 0; y < rows; y++) DI[x * rows + y] = dith(x, y) * LV;

  /* ---- lightning: a flash lights the cloud round it from inside ---- */
  const FL = new Float32Array(N), FT = new Int32Array(N); let nFT = 0;
  const flash = (aT, cT, e, r) => { const a = (aT + .5) * DA, c = cT * DA; if(a > AHC - .004 || a < .02) return; const cc = Math.cos(c) * RSC, qox = Math.sin(c) * RSC, qy = cc * Math.cos(a) - RC, qz = cc * Math.sin(a);
    if(!proj(qox, qy, qz)) return; const x = H2[0], y = H2[1], rx = Math.max(1.2, r * f / Math.hypot(qox, qy, qz)); if(!proj(qox, cc * Math.cos(a + r) - RC, cc * Math.sin(a + r))) return; const ry = Math.max(.9, Math.abs(H2[1] - y));
    for(let i = Math.max(0, Math.floor(x - 2.2 * rx)); i <= Math.min(cols - 1, Math.ceil(x + 2.2 * rx)); i++) for(let j = Math.max(0, Math.floor(y - 2.2 * ry)); j <= Math.min(rows - 1, Math.ceil(y + 2.2 * ry)); j++){ const dx = (i + .5 - x) / rx, dy = (j + .5 - y) / ry, g = e * Math.exp(-dx * dx - dy * dy); if(g < .02) continue; const k = i * rows + j; if(FL[k] === 0) FT[nFT++] = k; FL[k] += g; } };
  /* ---- the Milky Way: a band of the turning sky, by date ---- */
  const mwv = (h1, h2) => { const z = hash2(p.seed, h1) * 2 - 1, a = hash2(p.seed, h2) * TAU, r = Math.sqrt(1 - z * z); return [z, r * Math.cos(a), r * Math.sin(a)]; }, MWm = mwv(61, 62);
  let MWa = mwv(63, 64); { const d = MWa[0] * MWm[0] + MWa[1] * MWm[1] + MWa[2] * MWm[2]; MWa = MWa.map((v, i) => v - d * MWm[i]); const l = Math.hypot(...MWa); MWa = MWa.map(v => v / l); }
  const MWb = [MWm[1] * MWa[2] - MWm[2] * MWa[1], MWm[2] * MWa[0] - MWm[0] * MWa[2], MWm[0] * MWa[1] - MWm[1] * MWa[0]];
  for(let i = 0; i < NS; i += 3){ const l = sP[i], bt = (sS[i] / .75) * .16, cb = Math.cos(bt), e = [0, 1, 2].map(j => cb * (Math.cos(l) * MWa[j] + Math.sin(l) * MWb[j]) + Math.sin(bt) * MWm[j]); if(Math.abs(e[0]) < .75){ sS[i] = e[0]; sP[i] = (Math.atan2(e[2], e[1]) + TAU) % TAU; sM[i] *= .7; } }
  { const o = Array.from({length: NS}, (_, i) => i).sort((a, b) => sP[a] - sP[b]), cp_ = a => a.slice(); const P_ = cp_(sP), S_ = cp_(sS), M_ = cp_(sM), C_ = cp_(sC); o.forEach((j, i) => { sP[i] = P_[j]; sS[i] = S_[j]; sM[i] = M_[j]; sC[i] = C_[j]; }); }
  /* ---- the station: one solar array wing across the corner (desktop), dark against the sky until the sun reaches it ---- */
  const TR = new Uint8Array(N), trk = [];
  if(!phone){ const sd_ = passOf(0).sd, us = rows / 139, mx = v => sd_ > 0 ? v : cols - v, x0 = mx(cols - 16 * us), y0 = -6, x1 = mx(cols - 78 * us), y1 = TOP + 34 * us, L = Math.hypot(x1 - x0, y1 - y0), ex = (x1 - x0) / L, ey = (y1 - y0) / L, hw = 15 * us;
    for(let x = 0; x < cols; x++) for(let y = 0; y < Math.min(rows, y1 + hw); y++){ const k = x * rows + y, dx = x + .5 - x0, dy = y + .5 - y0, sA = dx * ex + dy * ey, w = (dx * -ey + dy * ex) / hw; if(sA < 0 || sA > L || Math.abs(w) > 1) continue;
      const m = sA / (7 * us), wl = Math.abs(Math.abs(w) - .52); TR[k] = Math.abs(w) > 1 - 1.1 / hw || sA > L - 1.1 ? 3 : Math.abs(w) < 1.2 / hw || m - Math.floor(m) < 1 / (7 * us) || wl < .6 / hw ? 2 : 1; trk.push(k); } }
  /* ---- aurora: the oval round the geomagnetic pole, a curtain from 100 km up ---- */
  const AB = new Float32Array(N), AT_ = new Int32Array(N), AC = new Uint8Array(N); let nAT = 0;
  const MP = 9.3 * rad, O2 = [0, 0];
  const oval = (lm, pm, south, om, u) => { const th = (90 - pm) * rad, st = Math.sin(th), x = st * Math.cos(lm), y = st * Math.sin(lm), z = Math.cos(th), x1 = x * Math.cos(MP) + z * Math.sin(MP), z1 = z * Math.cos(MP) - x * Math.sin(MP), sg = south ? -1 : 1;
    const lat = Math.asin(z1) * sg, L = Math.atan2(y, x1) * sg + (south ? 107.3 : -72.7) * rad - om + ER * u, cl_ = Math.cos(lat), gx_ = cl_ * Math.cos(L), gy = cl_ * Math.sin(L), gz = Math.sin(lat), a = Math.atan2(gy * CI + gz * SI, gx_) - u; O2[0] = a - TAU * Math.round(a / TAU); O2[1] = -Math.asin(gz * CI - gy * SI); };

  return tm => { const tau = (tm - 14) * sp + 30, n = Math.floor(tau / TP), tp = tau - n * TP, qo = passOf(n), uT = (qo.u0 + WO * (tp - 30)) / DA, u = uT * DA, cu = Math.cos(u), su = Math.sin(u);
    const gain = sstep(0, 2.5, tp) * (1 - sstep(TP - 2.6, TP - .5, tp)), sS_ = tp - TS, sI = PART & 16 && sS_ > -24 ? Math.min(1, Math.exp(sS_ * WO / rad / 4.5)) : 0, sg2 = .2 + .4 * sI, sgi = 1 / (sg2 * sg2);
    ensure(qo, uT);
    if(PART & 16){ Lb.set(SKb); Lc.set(SKc); } else Lb.fill(0);
    /* the Milky Way and the dawn arc, on the sky cells */
    if(PART & 4) for(let i = 0, j = 0; i < NSK; i++, j += 3){ const dx = SD[j], dy = SD[j + 1], dz = SD[j + 2], ey = dy * cu - dz * su, ez = dy * su + dz * cu, sb = dx * MWm[0] + ey * MWm[1] + ez * MWm[2]; if(sb > .36 || sb < -.36) continue;
      const k = SKK[i], ea = dx * MWa[0] + ey * MWa[1] + ez * MWa[2], eb = dx * MWb[0] + ey * MWb[1] + ez * MWb[2], lane = sb - .05 * (noise(ea * 3 + 9, eb * 3 + 4) - .5);
      const v = .28 * Math.exp(-sb * sb / .02) * (.3 + noise(ea * 7 + 3, eb * 7 + 8)) * (1 - .85 * Math.exp(-lane * lane / .0016) * sstep(.25, .6, noise(ea * 5 + 50, eb * 5))) * sstep(15, 110, ZT[k]) * (1 - .9 * sI);
      const vv = v * (.35 + 1.3 * hash2(k, 9)); if(vv > .06){ if(vv > Lb[k]) Lc[k] = 22; Lb[k] += vv; } }
    if(sI > .01) for(let i = 0; i < NSK; i++){ const k = SKK[i], zt = ZT[k]; if(zt > 170) continue; const da = AZ[k] - qo.az, w = Math.exp(-da * da * sgi), B = 1.2 * sI * Math.exp(-zt / 42) * w, Gd = 2.3 * Math.pow(sI, 1.8) * Math.exp(-zt / 19) * w * w * w, v = B + Gd; if(v < .03) continue; Lb[k] *= 1 - .85 * sI * w;
      if(v > Lb[k]) Lc[k] = Gd > B * (.8 + .6 * DI[k]) ? zt < 9 && sI > .3 ? 3 : Gd > .9 + DI[k] * .4 ? 15 : 14 : 13; Lb[k] += v; }
    /* stars */
    if(PART & 4){ const lo = ((u + 1.05) % TAU + TAU) % TAU, span = .95; let i = 0, hi = NS; while(i < hi){ const m = (i + hi) >> 1; if(sP[m] < lo) i = m + 1; else hi = m; }
      for(let c = 0; c < NS; c++, i++){ if(i >= NS) i = 0; let d = sP[i] - lo; if(d < 0) d += TAU; if(d > span) break; const ang = sP[i] - u, sx = sS[i], qq = Math.sqrt(1 - sx * sx), dy = qq * Math.cos(ang), dz = qq * Math.sin(ang);
        if(!proj(sx, dy, dz)) continue; const x = Math.floor(H2[0]), y = Math.floor(H2[1]); if(x < 0 || x >= cols || y < 0 || y >= rows) continue; const k = x * rows + y; if(!OK[k]) continue;
        const zt = dy < 0 ? (RC * Math.sqrt(1 - dy * dy) - 1) * RE : 1e3, ex = zt > 90 ? 1 : Math.exp(-7 * Math.exp(-zt / 9)), b = sM[i] * ex * (.8 + .4 * noise(i * .37, tm * 3)) * (1 - .8 * sI); if(b < .06) continue;
        if(b > Lb[k] * .8){ Lb[k] = Math.min(1, Lb[k] * .5 + b); Lc[k] = ex < .6 ? 3 : sC[i]; } } }
    /* lightning: storms flash in clusters; each stroke holds for 130 ms and dies away over 200 */
    if(PART & 8){ const lo = Math.floor(uT) + T0; for(let gi = lo >> 5; gi <= (lo + WN) >> 5; gi++) for(let gj = 0; gj < NGJ; gj++){ const act = ST[(gi & SM) * NGJ + gj]; if(act < .1) continue; const id = gi * 131 + gj, Is = gi * 32 + ((hash2(id, 71) * 32) | 0); if(Is > lo + WN || Is <= lo) continue;
        const Cs = gj * 32 + ((hash2(id, 72) * 32) | 0), Tc = 1.4 + 2.4 * hash2(id, 73), ph = hash2(id, 74), kk = Math.floor(tau / Tc + ph); if(hash2(id * 17 + kk, 75) > .25 + .7 * act) continue; const t0 = (kk - ph) * Tc, ns = 1 + ((hash2(id * 17 + kk, 76) * 3.4 * act) | 0);
        for(let s = 0; s < ns; s++){ const hs = id * 17 + kk * 5 + s, dt = tau - t0 - hash2(hs, 77) * Tc * .7; if(dt < 0 || dt > .33) continue; const e = (dt < .13 ? 1 : .45 * (1 - (dt - .13) / .2)) * (.55 + .45 * hash2(hs, 80)), fx = Is + (hash2(hs, 78) - .5) * 16 - uT, fy = Cs + (hash2(hs, 79) - .5) * 16 - HC; flash(fx, fy, e, .0022 + .002 * hash2(hs, 81)); flash(fx + 5 * hash2(hs, 82) - 2, fy + 7 * hash2(hs, 83) - 3, e * .7, .0016); flash(fx - 4 * hash2(hs, 84), fy - 6 * hash2(hs, 85) + 2, e * .6, .0014); } } }
    /* the ground: lights, then cloud over them */
    const kL = PART & 1 ? 1 : 0, kC = PART & 2 ? 1 : 0, kH = PART & 16 ? 1 : 0;
    for(let j = 0; j < NG; j++){ const k = GK[j];
      let x0 = uT + C0[j], w = CW[j], I = Math.floor(x0), fr = x0 - I, C = CC[j], o = (I & AM) * NC + C, om = ((I - 1) & AM) * NC + C, sa0 = SA[om] + (SA[o] - SA[om]) * fr, sb0 = SB[om] + (SB[o] - SB[om]) * fr;
      x0 += w; I = Math.floor(x0); fr = x0 - I; o = (I & AM) * NC + C; om = ((I - 1) & AM) * NC + C; const al = kC * (SA[om] + (SA[o] - SA[om]) * fr - sa0) / (w * 4096), cb = kC * (SB[om] + (SB[o] - SB[om]) * fr - sb0) / (w * 4096);
      x0 = uT + G0[j]; w = GW[j]; I = Math.floor(x0); fr = x0 - I; C = GC[j]; o = (I & AM) * NC + C; om = ((I - 1) & AM) * NC + C; const sl0 = SL[om] + (SL[o] - SL[om]) * fr;
      x0 += w; const Ic = Math.floor(x0 - w / 2); I = Math.floor(x0); fr = x0 - I; o = (I & AM) * NC + C; om = ((I - 1) & AM) * NC + C; const vl = kL * (SL[om] + (SL[o] - SL[om]) * fr - sl0) / (w * 4096), oc = (Ic & AM) * NC + C;
      const tr = 1 - al, gx_ = GX[j], vL = (1 - Math.exp(-5 * vl * gx_)) * tr * tr, vG = kL * RG[oc] * al * tr * 2.4, di = DI[k], hz = kH * GH[j], fl = FL[k] * (.1 + 2.6 * cb * Math.sqrt(cb));
      let vC = cb * moonK * 1.6, tw = 0; if(sI > .01){ const da = AZ[k] - qo.az; tw = sI * GT[j] * Math.exp(-da * da * sgi); vC += al * tw * .9; tw *= .35; }
      let b = vL + vG + vC + hz + fl + tw, c;
      if(fl > (b - fl) * .7) c = 16;
      else if(vL > (vG + vC + hz) * (.6 + di)) c = SEA[oc] ? 7 : vL > .8 + di ? 6 : vL > .5 + di ? 5 : vL > .24 + di ? 4 : 3;
      else if(vG > vC + hz) c = 8; else if(tw > vC + hz) c = 13; else if(hz > vC) c = GHC[j]; else c = vC > .42 + di * .5 ? 2 : vC > .19 + di * .5 ? 1 : 0;
      b = b * gain * MK[k % rows]; Lb[k] = b < .05 ? 0 : Math.min(1, b + di * .09); Lc[k] = c; }
    for(let i = 0; i < nFT; i++) FL[FT[i]] = 0; nFT = 0;
    for(let i = 0; i < NSK; i++){ const k = SKK[i], b = Lb[k] * gain * MK[k % rows]; Lb[k] = b > 1 ? 1 : b; }
    /* aurora */
    if(PART & 32 && qo.au > .05){ const lat = Math.asin(Math.sin(u) * SI), south = lat < 0, pm0 = 67.5 - 5 * qo.au; let on = false;
      for(let m = 0; m <= 360; m += 4){ oval(m * rad, pm0, south, qo.om, u); const rg = Math.hypot(O2[0], O2[1], .06), vis = O2[0] > .04 && O2[0] < .6 && Math.abs(O2[1]) < .55, dl = cl(.8 * rg / (f * .39) / rad, .08, .5), dh = cl(.9 * rg * RE / f, 4, 14), nr = sstep(.1, .2, rg); if((vis || on) && nr > 0) for(let lm = m - 4; lm < m; lm += dl){ const ln = lm * .9, pm = pm0 + .9 * Math.sin(lm * .31 + tau * .21) + 2.2 * (noise(lm * .11 + 7, tau * .05) - .5), it = nr * (1 - sstep(.4, .58, O2[0])) * (1 - sstep(.38, .54, Math.abs(O2[1]))) * qo.au * (.2 + .9 * noise(lm * .17 + 40, tau * .1)) * (.4 + .45 * noise(ln * .5, tau * .45 + 9) + .45 * noise(ln * .14 + 70, tau * .2)); if(it < .08) continue;
          oval(lm * rad, pm, south, qo.om, u); const a = O2[0], c = O2[1], sa = Math.sin(a), ca = Math.cos(a), sc = Math.sin(c), cc = Math.cos(c);
          for(let h = 98; h < 300; h += dh){ const rs = 1 + h / RE; if(!proj(sc * rs, cc * ca * rs - RC, cc * sa * rs)) break; const x = Math.floor(H2[0]), y = Math.floor(H2[1]); if(x < 0 || x >= cols || y < 0 || y >= rows) continue; const k = x * rows + y; if(OK[k] ? 0 : a > AH || ZT[k] === 0) continue;
            const v = it * (ZT[k] < 30 && OK[k] ? .3 + ZT[k] / 43 : 1) * (phone || (x >= mg && x < cols - mg) ? sstep(TOP, TOP + 5, y) : 1) * (h < 108 ? (h - 96) / 12 : Math.exp(-(h - 108) / 55)); for(let e = 0, kk = k; e < 2 && kk < N; e++, kk += rows) if(v > AB[kk] && (OK[kk] || ZT[kk] < 0)){ if(AB[kk] === 0) AT_[nAT++] = kk; AB[kk] = v; AC[kk] = h > 185 ? 21 : 20; } } }
        on = vis; }
      for(let i = 0; i < nAT; i++){ const k = AT_[i], v = AB[k] * gain * MK[k % rows] * .8; AB[k] = 0; if(v > Lb[k] * .7) Lc[k] = AC[k]; Lb[k] = Math.min(1, Lb[k] + v); } nAT = 0; }
    /* the sun's edge clears the limb: a small hard light with a short glare, then the shot ends */
    if(sS_ > 0 && kH){ const ca = Math.cos(DEP - .006); proj(ca * Math.sin(qo.az), -Math.sin(DEP - .006), ca * Math.cos(qo.az)); const xs = H2[0], ys = H2[1], g = Math.min(1, sS_ / 1.5) * gain, r = 1 / (1.3 + 1.1 * Math.min(3, sS_)), R = Math.ceil(5 / r);
      for(let x = Math.max(0, Math.floor(xs - 2 * R)); x <= Math.min(cols - 1, xs + 2 * R); x++) for(let y = Math.max(0, Math.floor(ys - R)); y <= Math.min(rows - 1, ys + R); y++){ const k = x * rows + y; if(!OK[k] && ZT[k] === 0 && Lb[k] === 0 && y < TOP) continue;
        const v = g * 1.25 * Math.exp(-Math.hypot((x + .5 - xs) * .4, y + .5 - ys) * r * 1.5) * MK[y] + DI[k] * .08; if(v < .06) continue; if(v > Lb[k] * .8) Lc[k] = v > .75 ? 15 : 14; Lb[k] = Math.min(1, Lb[k] + v); } }
    /* the station in front of everything */
    if(PART & 64) for(let i = 0; i < trk.length; i++){ const k = trk[i], t = TR[k], y = k % rows, col = (k / rows | 0) >= mg && (k / rows | 0) < cols - mg; if(col && y < TOP){ Lb[k] = 0; continue; }
      const s2 = sI * sI * gain, h = hash2(k, 5); const e2 = sstep(.15, .6, sI) * gain; Lb[k] = Math.min(1, (t === 1 ? s2 * (.5 + .3 * h) + DI[k] * .1 * s2 : t === 2 ? .085 * (1 - s2) + s2 * .12 : .1 + e2 * .85) * MK[y] * (t === 1 ? 1 : .6 + .4 * gain)); Lc[k] = t === 3 ? e2 > .2 ? 15 : 23 : s2 > .08 ? 24 : 23; }
    paint(ax); };
}

/* 08 galaxy: Messier 81 as a long-exposure telescope picture, filmed (an original piece).
   The model is one galaxy, not a generic spiral: M81 (NGC 3031), a grand-design spiral with no bar, seen 59 degrees from face-on. Lengths are in
   pixels of the Hubble mosaic it was measured on (0.884 arcsec, about 16 parsecs). Measured on that picture: the axis ratio of the disc (0.52),
   the two arms as logarithmic spirals of pitch 13.5 degrees that pass radius 330 at angles 125 and 310 degrees from the major axis, where the
   blue arms begin (radius 300) and the rounder bulge (0.66). The side whose dust lanes show dark against the bulge is the near side.
   Light is added up per cell as starlight, then compressed like an astrophoto (an asinh stretch), so only the nucleus is white:
   a bulge of old stars (a Sersic profile, warm), an exponential disc of old stars, young blue stars in the arms (a sharp inner edge, a slow fall
   outward, clumps that follow the gas), pink H II knots strung along the ridge, a thin dust lane on the inner edge of each arm, dust filaments
   that spiral into the bulge and feathers that cross between the arms. Dust dims what lies behind it: on the near side most of the bulge.
   Motion, all a pure function of time and all cyclic:
   - the arm pattern turns rigidly (a density wave, corotation at radius 733); stars, gas and dust turn on a flat rotation curve, so inside
     corotation they overtake the arms, pass through the dust lane and light up beyond it; clump fields shear into trailing spurs as they age
     and two of them cross-fade, so the winding never grows without limit. One second is about 80,000 years;
   - the camera drifts and zooms slowly, as documentary footage does;
   - foreground stars of our own galaxy twinkle with the seeing, which has calm spells and bad ones; the faint outskirts carry photon grain;
   - a supernova at the place of SN 1993J follows that supernova's light curve (two peaks) on its own clock, one day a second, once a cycle;
   - now and then a satellite crosses the field.
   The picture is kept in an offscreen canvas. Cells are refreshed in 16 interleaved groups, each on its own clock (0.8 s apart in time for one
   group), and a cell is redrawn only when its dot changes; the content of a group depends only on that group's clock time, so any single frame
   drawn from nothing equals the same frame reached by playing.
   Data: the faint field stars = tokens, their colour (blue-white or amber) = split. The galaxy, its rotation and the supernova carry no data. */
function tGalaxy(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, PX = env.P, N = cols * rows, sp = p.speed, RD = Math.PI / 180, LVN = 12;
  const U = rows / (phone ? 97 : 139), TOP = Math.round((phone ? 12 : 64) * U), MG = phone ? 0 : Math.max(0, Math.floor((env.W - 1240) / 2 / PX)), Y0 = MG > 0 ? Math.round(rows * .08) : TOP;
  /* palette: 0-7 starlight from the old bulge (cream, yellow) through the disc to the young arms (blue-white); 8, 9 light reddened by dust;
     10, 11 H II regions; 12 white (stars that carry no data, the satellite), 13 blue-white and 14 amber (token stars; 13 also the young supernova); 15 a distant galaxy */
  const PA = [[255, 240, 212], [250, 220, 168], [238, 206, 158], [224, 198, 162], [208, 198, 186], [196, 204, 224], [180, 198, 236], [158, 182, 234],
    [204, 142, 92], [158, 104, 70], [255, 126, 150], [255, 172, 190], [255, 250, 240], [176, 206, 255], [255, 198, 124], [226, 170, 130]];
  const STY = PA.map(c => Array.from({length: LVN}, (_, l) => `rgba(${c[0]},${c[1]},${c[2]},${(.2 + .76 * (l + 1) / LVN).toFixed(3)})`));
  /* dots are drawn in device pixels inside a square of whole pixels per cell (the cell itself when the device scale makes it whole, else the
     largest square that fits in every cell), so clearing one cell never touches its neighbours at any scale */
  const CD = PX * env.dpr, WI = Math.abs(CD - Math.round(CD)) < 1e-6 ? Math.round(CD) : Math.floor(CD) - 1, XD = Float32Array.from({length: cols}, (_, x) => Math.ceil(x * CD - 1e-6)), YD = Float32Array.from({length: rows}, (_, y) => Math.ceil(y * CD - 1e-6));
  const DR = Float32Array.from({length: LVN + 1}, (_, l) => WI * (.19 + .31 * Math.pow(l / LVN, .8))), RSQ = .24 * WI;
  const dot = (g, x, y, c, l) => { const r = DR[l], px = XD[x] + WI / 2, py = YD[y] + WI / 2; g.fillStyle = STY[c][l - 1]; if(r < RSQ) g.fillRect(px - r, py - r, 2 * r, 2 * r); else { g.beginPath(); g.arc(px, py, r, 0, TAU); g.fill(); } };

  /* ---- the galaxy, the same on every date (its own fixed random stream) ---- */
  const G = mulberry(0x4d383100), LAT = Float32Array.from({length: 4096}, () => G());
  const nz = (x, y, K) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), x0 = ((xi % K) + K) % K, x1 = (x0 + 1) % K, y0 = (yi & 63) << 6, y1 = ((yi + 1) & 63) << 6;
    const a = LAT[y0 | (x0 & 63)], b = LAT[y0 | (x1 & 63)], c = LAT[y1 | (x0 & 63)], d = LAT[y1 | (x1 & 63)]; return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy; };
  const QO = .52, QB = .66, PSI = 13.5 * RD, TANP = Math.tan(PSI), LN330 = Math.log(330), THA = 125 * RD, THB = 310 * RD, RMAX = 960, V0 = 1.2, RC = 60, OMP = V0 / 733;
  /* by radius, 4 px a step: old disc light, where the arms form stars, where they carry dust, how fast things turn */
  const NR = 241, DISC = new Float32Array(NR), RY = new Float32Array(NR), RL = new Float32Array(NR), RIN = new Float32Array(NR), RMF = new Float32Array(NR), OMR = new Float32Array(NR), WX = new Float32Array(NR);
  for(let j = 0; j < NR; j++){ const r = j * 4; DISC[j] = .95 * Math.exp(-r / 210) * (1 - sstep(600, 900, r)); RY[j] = sstep(250, 335, r) * (1 - .72 * sstep(560, 950, r)) * (1 - sstep(900, 960, r));
    RL[j] = sstep(150, 300, r) * (1 - .6 * sstep(520, 900, r)); RIN[j] = sstep(55, 110, r) * (1 - sstep(250, 340, r)); RMF[j] = sstep(140, 300, r); OMR[j] = V0 / Math.sqrt(r * r + RC * RC); WX[j] = 1 + .9 * sstep(430, 900, r); }
  /* the bulge by elliptical radius, 1 px a step (Sersic n = 3, effective radius 185), with the bright nucleus */
  const BUL = Float32Array.from({length: 1200}, (_, m) => 2.3 * Math.exp(-5.673 * (Math.pow((m + .7) / 185, 1 / 3) - 1)) + 260 * Math.exp(-m * m / 30));
  /* across an arm, by x = ln(radius / radius of the ridge): young stars, H II, the dust lane, the old stars' broad wave */
  const NX = 513, KX = 320, EY = new Float32Array(NX), EH = new Float32Array(NX), EL = new Float32Array(NX), EO = new Float32Array(NX), EF = new Float32Array(NX);
  for(let i = 0; i < NX; i++){ const x = i / KX - .8, g = (c, s) => Math.exp(-((x - c) / s) * ((x - c) / s));
    EY[i] = x < 0 ? g(0, .036) : .82 * g(0, .1) + .18 * g(0, .22); EH[i] = g(.014, .036); EL[i] = .85 * g(-.058, .02) + .22 * g(-.1, .045); EO[i] = g(.03, .17); EF[i] = g(.2, .2); }
  /* along each arm, by ln of the ridge radius: where it is rich and where it thins (both arms are bright near 360 and near 570, thinner between) */
  const NA = 256, LA0 = Math.log(120), KA = (NA - 1) / (Math.log(1100) - LA0), AMA = new Float32Array(NA), AMB = new Float32Array(NA);
  for(let i = 0; i < NA; i++){ const lr = LA0 + i / KA, bump = Math.exp(-Math.pow((lr - Math.log(365)) / .13, 2)) + .9 * Math.exp(-Math.pow((lr - Math.log(575)) / .15, 2));
    AMA[i] = .34 + .5 * bump + .55 * nz(lr * 9, 3.3, 64) + .3 * nz(lr * 23, 9.1, 64); AMB[i] = .34 + .5 * bump + .55 * nz(lr * 9 + 31, 17.7, 64) + .3 * nz(lr * 23 + 11, 29.3, 64); }
  /* gas and stars that ride the rotation: three maps over (radius, angle): blue clumps, H II knots, dust filaments. Features are as wide as a
     fixed angle, so they grow with radius, and are stretched along the radius; the shear of the rotation turns them into trailing spurs */
  const NT = 512, MBL = new Uint8Array(NR * NT), MHI = new Uint8Array(NR * NT), MDU = new Uint8Array(NR * NT);
  for(let j = 30; j < NR; j++){ const lb = Math.log(j * 4) * 72 / TAU, o = j * NT;
    for(let i = 0; i < NT; i++){ const a = i / NT, f = .5 * nz(a * 72, lb, 72) + .32 * nz(a * 144 + 7, lb * 2 + 5, 144) + .18 * nz(a * 288 + 3, lb * 4 + 9, 288);
      MBL[o + i] = 255 * Math.pow(clamp01((f - .44) * 4.6), 1.3) * (.6 + .4 * G()); const rd = 1 - Math.abs(2 * nz(a * 40 + 13, lb * .3 + 21, 40) - 1), r2 = 1 - Math.abs(2 * nz(a * 88 + 5, lb * .6 + 40, 88) - 1); MDU[o + i] = 255 * clamp01(.75 * Math.pow(rd, 5) + .45 * Math.pow(r2, 4)); } }
  for(let n = 0; n < 900; n++){ const j = Math.round(Math.exp(Math.log(250) + G() * Math.log(940 / 250)) / 4), i = (G() * NT) | 0, s = Math.pow(G(), 2.2), w = G() < .25 ? 1 : 0;
    for(let dj = -w; dj <= w; dj++) for(let di = -1; di <= 1; di++){ const jj = j + dj, k = jj * NT + ((i + di + NT) & (NT - 1)); if(jj > 0 && jj < NR) MHI[k] = Math.max(MHI[k], 255 * (.3 + .7 * s) * (di || dj ? .5 : 1)); } }
  const EXT = Float32Array.from({length: 257}, (_, i) => Math.exp(-i / 64));

  /* ---- framing: the photo rolled so the disc sweeps across the band; the camera drifts and zooms about that ---- */
  const S0 = (phone ? .14 : .165) * U, ROLL = -(phone ? 36 + 4 * p.tilt : 13 + 3 * p.tilt) * RD, CR0 = Math.cos(ROLL), SR0 = Math.sin(ROLL);
  const HX = phone ? cols * .5 : cols * (.48 + .045 * p.off), HY = TOP + (phone ? 37 : 47) * U, A2 = p.yaw, A3 = p.yaw * 1.7 + 1;
  const cam = ts => { const z = Math.exp((phone ? .07 : .085) * Math.sin(TAU * ts / 113 + .5)); return [HX + (phone ? 3 : 11) * U * (Math.sin(TAU * ts / 151 + A2) - Math.sin(A2)), HY + (phone ? 2.5 : 3) * U * (Math.sin(TAU * ts / 97 + A3) - Math.sin(A3)), S0 * z]; };
  const ROWG = new Float32Array(rows), FADE = new Float32Array(rows);
  for(let y = 0; y < rows; y++){ ROWG[y] = 1 + (phone ? .55 : .45) * clamp01((TOP + (phone ? 55 : 38) * U - y) / ((phone ? 55 : 38) * U)); FADE[y] = sstep(TOP - 1, TOP + 10 * U, y); }

  /* ---- the picture: per cell the stretched light (before grain), the dot now on the offscreen canvas, fixed grain ---- */
  const GV = new Float32Array(N), LV8 = new Uint8Array(N), CO8 = new Uint8Array(N), H0 = new Uint8Array(N), H1 = new Uint8Array(N);
  { const S = mulberry(mix(p.seed + 8)); for(let k = 0; k < N; k++){ H0[k] = S() * 256; H1[k] = S() * 256; } }
  const NG = 16, PER = .8, GRP = Array.from({length: NG}, () => []), last = new Float64Array(NG).fill(NaN);
  for(let y = Y0; y < rows; y++) for(let x = 0; x < cols; x++){ if(y < TOP && x >= MG && x < cols - MG) continue; GRP[BAYER[(x & 3) + ((y & 3) << 2)]].push(y * cols + x); }
  const off = offscreen(env), gx = off.begin(); gx.setTransform(1, 0, 0, 1, 0, 0); const BETA = .25, ASN = 1 / Math.log(75 / BETA + Math.sqrt(75 * 75 / (BETA * BETA) + 1));
  const refresh = (cells, ts, qo) => {
    const [cx, cy, s] = cam(ts), is = 1 / s, pr = OMP * ts, ph = ts / 480, fa = ph - Math.floor(ph), fb = ph + .5 - Math.floor(ph + .5), wa = Math.pow(Math.sin(Math.PI * fa), 2), wb = 1 - wa;
    const ga = 140 + 480 * fa, gb = 140 + 480 * fb, oa = mix(Math.floor(ph) * 7 + 3) % NT, ob = mix(Math.floor(ph + .5) * 13 + 5) % NT, KT = NT / TAU, qs = (mix(qo + 77) >>> 8) & 255;
    for(let n = 0; n < cells.length; n++){ const k = cells[n], x = k % cols, y = (k / cols) | 0, dx = (x - cx) * is, dy = (y - cy) * is, u = dx * CR0 + dy * SR0, v = -dx * SR0 + dy * CR0, Yd = v / QO, r = Math.sqrt(u * u + Yd * Yd), vb = v / QB, m = Math.sqrt(u * u + vb * vb);
      let I = m < 1199 ? BUL[m | 0] : 0, yng = 0, hii = 0, red = 0;
      if(r < RMAX && r > 8){ const j = (r * .25) | 0, lr = Math.log(r), th = Math.atan2(Yd, u), f0 = th - (lr - LN330) / TANP + pr; let da = f0 - THA, db = f0 - THB; da -= TAU * Math.round(da / TAU); db -= TAU * Math.round(db / TAU);
        const xa = -TANP * da, xb = -TANP * db, wx = WX[j] * KX, ia = Math.max(0, Math.min(NX - 1, (xa * wx + .8 * KX) | 0)), ib = Math.max(0, Math.min(NX - 1, (xb * wx + .8 * KX) | 0)), ma = AMA[Math.max(0, Math.min(NA - 1, ((lr - xa - LA0) * KA) | 0))], mb = AMB[Math.max(0, Math.min(NA - 1, ((lr - xb - LA0) * KA) | 0))];
        const om = OMR[j], o = j * NT, i1 = o + ((((th + om * ga) * KT) | 0) + oa + 8 * NT & (NT - 1)), i2 = o + ((((th + om * gb) * KT) | 0) + ob + 8 * NT & (NT - 1)), mf = RMF[j];
        const cb = (wa * MBL[i1] + wb * MBL[i2]) / 255, ch = (wa * MHI[i1] + wb * MHI[i2]) / 255, cd = (wa * MDU[i1] + wb * MDU[i2]) / 255;
        const ey = EY[ia] * ma + EY[ib] * mb, eo = EO[ia] + EO[ib];
        yng = RY[j] * (ey * (.1 + 1.2 * cb + 3.4 * cb * cb) + .14 * cb * cb * eo) * 2.9; hii = RY[j] * (EH[ia] * ma + EH[ib] * mb) * ch * (.3 + ch) * 6.5;
        /* inner dust: three thin filaments of wider pitch that wind into the bulge */
        const fi = Math.cos(1.5 * (th - (lr - LN330) / .47 + pr) + 2.2 * cd), tin = RIN[j] * Math.pow(.5 + .5 * fi, 10) * (.5 + 1.2 * cd);
        const tau = RL[j] * ((EL[ia] * (.5 + .6 * ma) + EL[ib] * (.5 + .6 * mb)) * (.55 + .9 * cd) + .9 * mf * cd * cd * (EF[ia] + EF[ib])) + 1.1 * tin, ex = EXT[Math.min(256, (tau * 64) | 0)], nr = .5 - .44 * Math.tanh(v / 70);
        red = (1 - ex); I = I * (1 - nr * red) + DISC[j] * (1 + .32 * eo) * (.4 + .6 * ex) + yng * (.55 + .45 * ex) + hii; }
      const z = I / BETA; let val = Math.log(z + Math.sqrt(z * z + 1)) * ASN; val = (val > 1 ? 1 : val) * ROWG[y]; if(x >= MG && x < cols - MG) val *= FADE[y]; GV[k] = val;
      /* grain: a fixed pattern that dithers the twelve levels, plus photon noise that is re-drawn each refresh and matters only where the light is faint */
      const h = H0[k] / 255, ht = ((H1[k] + qs * 97) & 255) / 255, gr = val + (h - .5) / LVN + (ht - .5) * .08 * Math.exp(-val / .1); let lv = gr <= .06 ? 0 : Math.min(LVN, Math.ceil(gr * LVN)), c = 0;
      if(lv){ const fy = (yng * .9) / (I + 1e-6) + (h - .5) * .14, fh = hii / (I + 1e-6); c = Math.max(0, fh > .3 + .2 * h ? (fh > .55 ? 10 : 11) : red * (1 - fy * 1.6) > .3 + .3 * h ? (red > .8 ? 9 : 8) : Math.min(7, Math.round((I > 22 ? 0 : I > 2.4 ? 1 : I > .9 ? 2 : 3) + h * .9 - .45 + fy * 8.5))); }
      if(lv !== LV8[k] || (lv && c !== CO8[k])){ if(LV8[k]) gx.clearRect(XD[x], YD[y], WI, WI); if(lv) dot(gx, x, y, c, lv); LV8[k] = lv; CO8[k] = c; } } };

  /* ---- what is drawn over the picture every frame: stars, distant galaxies, the supernova, a satellite ---- */
  const OV = new Float32Array(N), OC = new Uint8Array(N), TL = new Int32Array(N); let nt = 0;
  const add = (x, y, v, c) => { if(x < 0 || x >= cols || y < Y0 || y >= rows || (y < TOP && x >= MG && x < cols - MG)) return; const k = y * cols + x; if(OV[k] === 0) TL[nt++] = k; if(v > OV[k]){ OV[k] = v; OC[k] = c; } };
  const splat = (fx, fy, F, c, sg, spike) => { const x0 = Math.round(fx), y0 = Math.round(fy), R = F > .9 ? 2 : 1, i2 = 1 / (2 * sg * sg);
    for(let dy = -R; dy <= R; dy++) for(let dx = -R; dx <= R; dx++){ const ex = x0 + dx - fx, ey = y0 + dy - fy, v = F * Math.exp(-(ex * ex + ey * ey) * i2); if(v > .04) add(x0 + dx, y0 + dy, v, c); }
    if(spike > 0) for(let i = 2; i < spike * 4; i++){ const v = F * .5 * Math.exp(-i / spike); if(v < .06) break; add(x0 + i, y0, v, c); add(x0 - i, y0, v, c); add(x0, y0 + i, v, c); add(x0, y0 - i, v, c); } };
  /* the sixteen brightest point sources of the Hubble frame at their measured places (frame pixels), then faint field stars by date; all white, they carry no data */
  const HST = [666, 4, 19.1, 199, 746, 15.7, 417, 186, 14.5, 1053, 25, 14, 1059, 35, 12.5, 847, 647, 11, 572, 189, 10.7, 896, 365, 10.3, 120, 78, 9.2, 831, 275, 8.2, 1141, 844, 8.2, 270, 349, 8, 1257, 478, 7.6, 383, 140, 7.3, 1253, 612, 7.1, 638, 720, 7.1];
  const SK = mulberry(mix(p.seed + 81)), c6 = Math.cos(6 * RD), s6 = Math.sin(6 * RD), ST = [];
  for(let i = 0; i < HST.length; i += 3){ const dx = HST[i] - 662.5, dy = HST[i + 1] - 414.4, f = HST[i + 2] / 19.1; ST.push({u: dx * c6 + dy * s6, v: -dx * s6 + dy * c6, F: .55 + 1.9 * f * f, c: 12, ph: SK() * TAU, w: 0}); }
  for(let i = 0; i < 46; i++) ST.push({u: (SK() - .5) * 2600, v: (SK() - .5) * 1500, F: Math.min(.8, .13 / Math.pow(SK() + .02, .6)), c: 12, ph: SK() * TAU, w: 0});
  /* token stars: a field the size of the open band that wraps round, so every one of them is always in it and always lights at least one cell (over the galaxy, one level above it) */
  const NTOK = Math.round(D.nPart * .25 * (phone ? .4 : 1)), BW = cols, BH = rows - TOP;
  for(let i = 0; i < NTOK; i++) ST.push({u: X.rnd() * BW, v: X.rnd() * BH, F: Math.max(.17, Math.min(.62, .1 / Math.pow(X.rnd() + .015, .55))), c: X.rnd() < D.share ? 13 : 14, ph: X.rnd() * TAU, w: 1});
  /* a few distant galaxies: small soft smudges well outside the disc */
  const BG = Array.from({length: 5}, () => { let u, v; do { u = (SK() - .5) * 2300; v = (SK() - .5) * 760; } while(Math.hypot(u, v / QO) < 620); return {u, v, a: SK() * Math.PI, e: .35 + .5 * SK(), s: 5 + 9 * SK(), F: .2 + .16 * SK()}; });
  /* the supernova: sky offset of SN 1993J from the nucleus (129 arcsec along the frame's x, 107 up) and its light curve by day */
  const SNU = 132.7, SNV = -135.5, SNC = 100, SNT0 = -4.6;
  const snl = d => d < 0 ? 0 : (d < 2.5 ? Math.pow(d / 2.5, 1.6) : d < 9 ? .36 + .64 * Math.pow(1 - sstep(2.5, 9, d), 1.3) : d < 21 ? .36 + .5 * sstep(9, 21, d) : .86 * Math.exp(-(d - 21) * .0184)) * (1 - sstep(70, 96, d));
  const see = ts => { const b = ts / 31 - .03, e = b - Math.floor(b), on = (mix(Math.floor(b) * 19 + 7) & 3) < 3 || Math.floor(b) === 0 ? 1 : 0; return 1 + .3 * Math.sin(ts * .23 + 1) + .2 * Math.sin(ts * .61 + 2) + 1.5 * on * sstep(0, .012, e) * (1 - sstep(.035, .075, e)); };

  return tm => {
    for(let g = 0; g < NG; g++){ const qo = Math.floor((tm - g * PER / NG) / PER); if(qo !== last[g]){ refresh(GRP[g], (qo * PER + g * PER / NG - 14) * sp, qo); last[g] = qo; } }
    off.blit(); ax.setTransform(1, 0, 0, 1, 0, 0);
    const ts = (tm - 14) * sp, [cx, cy, s] = cam(ts), se = see(ts), sg = .52 + .1 * se;
    for(let i = 0; i < ST.length; i++){ const qo = ST[i]; let fx, fy;
      if(qo.w){ fx = qo.u + (cx - HX) + (s / S0 - 1) * (qo.u - HX); fy = qo.v + (cy - HY) + (s / S0 - 1) * (qo.v + TOP - HY); fx -= BW * Math.floor(fx / BW) + .5; fy = TOP + fy - BH * Math.floor(fy / BH) - .5; }
      else { fx = cx + s * (qo.u * CR0 - qo.v * SR0); fy = cy + s * (qo.u * SR0 + qo.v * CR0); }
      if(fx < -9 || fx > cols + 9 || fy < Y0 - 9 || fy > rows + 9) continue;
      const tw = Math.max(.6, 1 + se * (.1 * Math.sin(tm * 5.3 + qo.ph) + .08 * Math.sin(tm * 8.9 + qo.ph * 3.1)) * (qo.F < .9 ? 1.5 : .7)), F = qo.F * tw * ROWG[Math.max(0, Math.min(rows - 1, Math.round(fy)))];
      splat(fx, fy, F, qo.c, sg * (qo.F > .9 ? 1.25 : 1), qo.F > 1 ? 1.1 + 1.6 * (qo.F - 1) : 0); }
    for(const b of BG){ const fx = cx + s * (b.u * CR0 - b.v * SR0), fy = cy + s * (b.u * SR0 + b.v * CR0), x0 = Math.round(fx), y0 = Math.round(fy), ca = Math.cos(b.a), sa = Math.sin(b.a), sl = b.s * s;
      for(let dy = -3; dy <= 3; dy++) for(let dx = -3; dx <= 3; dx++){ const ex = x0 + dx - fx, ey = y0 + dy - fy, a = (ex * ca + ey * sa) / (sl + .5), c = (-ex * sa + ey * ca) / (sl * b.e + .4), v = b.F * Math.exp(-(a * a + c * c)); if(v > .07) add(x0 + dx, y0 + dy, v, 15); } }
    { const d = ts - SNT0 - SNC * Math.floor((ts - SNT0) / SNC), L = snl(d); if(L > .02){ const fx = cx + s * (SNU * CR0 - SNV * SR0), fy = cy + s * (SNU * SR0 + SNV * CR0); splat(fx, fy, 2.3 * L * ROWG[Math.max(0, Math.min(rows - 1, Math.round(fy)))], d < 9 ? 13 : 12, sg * 1.2, L > .45 ? .9 + 1.5 * L : 0); } }
    { const b = (ts - 3.1) / 47, n = Math.floor(b), e = (b - n) * 47 / 1.7; if(e < 1.25){ const h = mix(n * 31 + (p.seed & 1023)), y0 = TOP + (.12 + .5 * ((h & 255) / 255)) * (rows - TOP), sl = ((h >> 8 & 255) / 255 - .5) * .5, dir = h >> 16 & 1 ? 1 : -1, L = phone ? 16 : 34, hx = dir > 0 ? e * (cols + L) : cols - e * (cols + L);
        for(let i = 0; i < L; i++){ const x = Math.round(hx - dir * i), ee = (dir > 0 ? x : cols - x) / (cols + L), gl = .5 + .5 * Math.pow(Math.sin(ee * 23 + (h & 7)), 2); add(x, Math.round(y0 + sl * (x - cols / 2)), (.62 - .5 * i / L) * gl, 12); } } }
    for(let i = 0; i < nt; i++){ const k = TL[i], lv = Math.min(LVN, Math.max(LV8[k] + 1, Math.ceil(Math.min(1, GV[k] * .75 + OV[k]) * LVN))); OV[k] = 0;
      if(lv > LV8[k]){ const x = k % cols, y = (k / cols) | 0; if(LV8[k]) ax.clearRect(XD[x], YD[y], WI, WI); dot(ax, x, y, OC[k], lv); } }
    nt = 0;
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
   Kept from the source: a bell that squeezes quickly and reopens slowly, the lift on each squeeze, threads and mouth arms that hang from where
   the rim was a moment ago, a glassy bell with brighter edges, and marine snow that streams past the animal.
   Rebuilt to read like footage of Pacific sea nettles (Chrysaora fuscescens) filmed by a camera that travels with them.
   Anatomy, measured on photographs: a shallow dome, 0.36 of its width high when open
   and about 0.6 when squeezed; sixteen lobes round the lower bell with furrows between them that deepen as it squeezes; a darker scalloped
   margin of 32 small flaps; 24 thin maroon tentacles from the margin, three to four bell widths long; a pale mouth tube under the middle and
   four oral arms about three bell widths long: twisted ribbons with thick ruffled white edges and a brown line along the middle. Pigment
   is the animal's own: apricot crown, burnt orange flank, rust margin, maroon tentacles, cream arms.
   The bell is a translucent surface of revolution: surface samples add their light into the cell they fall in, so a wall seen edge-on glows
   brighter and the far wall and the mouth tube show through the near one. It is lit from the upper left.
   Motion, from published work on how such medusae swim (moon jelly figures: a pulse every four seconds or so, about 0.4 s of squeeze, about
   1.4 s of reopening, then a pause; a third of the distance is covered during the pause): the squeeze is short and the reopening slow; the
   margin runs a little behind the rest of the bell, so it is still spread while the bell squeezes and still tucked while it reopens; speed is worked
   out once from thrust and drag (push on the squeeze, a small pull back on refilling, a second small push early in the pause) and the body
   surges and coasts along its heading by it. The camera keeps the animal's mean speed, so the water and the snow stream backward.
   Every point of a tentacle or arm stays in the water where the margin left it: the strands trail behind along the path, pulled together
   in the wake, and each squeeze sends a kink down them; they sink a little and wander with the water further back.
   So that a coasting animal is calm, each one is placed on whole cells and its dither pattern is fixed to it.
   Scene: one near animal, three or four far ones dimmed and greyed by the water (a slow layer), light shafts from above, pale plankton specks.
   Data: marine snow = tokens (every flake always on screen, at three depths), its colour = split (the exact UI blue and amber); pulse rate
   = 7-day trend; how much the strands wander = cache miss. The animals, plankton and light carry no data. */
function tJelly(env, X){
  const PART = 7;                                                                                   /* what is drawn of each animal: 1 bell, 2 oral arms, 4 tentacles (kept for measuring) */
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, PX = env.P, U = 5 / PX, N = cols * rows;
  /* palette: 0 / 1 data (snow only); 2..9 the near animal from maroon through rust and orange to cream and white; 10..14 far animals, greyed by
     the water; 15 light shafts; 16 plankton */
  const PAL = [BLUE, OR, [92, 34, 38], [138, 50, 42], [180, 74, 46], [210, 106, 60], [232, 140, 84], [240, 178, 132], [246, 226, 206], [250, 244, 234],
               [70, 46, 66], [112, 62, 70], [158, 92, 80], [190, 138, 120], [206, 190, 180], [40, 92, 112], [150, 196, 196]];
  const JL = new Layer(cols, rows, PAL, PX), FL = new Layer(cols, rows, PAL, PX), PL = new Layer(cols, rows, PAL, PX), RL = new Layer(cols, rows, PAL, PX), off = offscreen(env), off2 = offscreen(env);
  const mg = Math.max(0, (env.W - 1240) / 2 / PX), TOP = phone ? Math.round(11 * U) : Math.round(rows * .47), BOT = phone ? Math.round(65 * U) : rows, band = BOT - TOP;
  const wob = 1 + D.jitter * .5;
  /* the pulse: PER seconds from squeeze to squeeze; TC of it squeezing, TR reopening, the rest paused */
  const PER = (4.6 - 1.1 * D.trendK) / sp, TC = .42 / sp / PER, TR = 1.4 / sp / PER, LAGM = .16 / sp / PER;
  const sq = qo => { qo -= Math.floor(qo); return qo < TC ? easeS(qo / TC) : qo < TC + TR ? 1 - easeS((qo - TC) / TR) : 0; };
  /* speed through one pulse, from thrust and drag, and the distance covered (WI, 0..1 over a pulse) */
  const NW = 256, WI = new Float32Array(NW + 1);
  { const v = new Float32Array(NW), kd = PER / 1.1; let s = 0, m = 0;
    for(let rep = 0; rep < 8; rep++) for(let i = 0; i < NW; i++){ const qo = i / NW, dc = (sq(qo + 1 / NW) - sq(qo)) * NW, r = (qo - TC - TR + .03) / (.9 / PER);
      const f = (dc > 0 ? dc : .3 * dc) + (r > 0 && r < 1 ? 1.6 * Math.sin(Math.PI * r) ** 2 : 0); s += (f - kd * s) / NW; v[i] = s; }
    for(let i = 0; i < NW; i++) m += v[i]; m /= NW; let a = 0;
    for(let i = 0; i < NW; i++){ v[i] = Math.max(.3, v[i] / m); a += v[i]; }
    let c = 0; for(let i = 0; i < NW; i++){ WI[i] = c / a; c += v[i]; } WI[NW] = 1; }
  const wi = qo => { const f = qo * NW, i = f | 0; return WI[i] + (WI[i + 1] - WI[i]) * (f - i); };
  /* the cast: psi = heading on screen (0 up, quarter turn = right), b0 = lean toward the viewer; t = 0 (look t = 8) is the hero frame */
  const Rh = phone ? Math.min(band * .24, cols * .17) : Math.min(band * .29, cols * .062), hx = cols * (phone ? .62 : .72 + .02 * p.off);
  const psi0 = phone ? .55 : 1.15;
  const J = [{X: hx, Y: TOP + band * (phone ? .3 : .37), Z: 0, R: Rh, g: 1, q0: .78, psi: psi0, b0: .62, nT: 24, nA: 4}];
  const far = (X_, Y_, k, Z, g, q0, dpsi, i) => J.push({X: X_, Y: Y_, Z, R: Rh * k, g, q0, psi: psi0 + dpsi, b0: -.2 + .7 * hash2(i, 5), nT: 12, nA: 4, far: 1});
  if(phone){ far(cols * .2, TOP + band * .66, .36, -90, .62, .12, -.3, 1); far(cols * .22, TOP + band * .16, .24, -140, .5, .5, .25, 2); }
  else { far(cols * (.22 + .03 * p.tilt), TOP + band * .3, .46, -80, .66, .12, -.25, 1); far(cols * (.47 - .02 * p.tilt), TOP + band * .2, .25, -140, .5, .45, .12, 2);
    far(cols * .9, TOP + band * .74, .33, -110, .56, .3, -.5, 3); if(mg > 10 * U) far(mg * .5, rows * .3, Math.min(.42, mg * .28 / Rh), -120, .56, .85, -1.1, 4); }
  J.forEach((j, i) => Object.assign(j, {per: PER * (i ? .92 + .3 * hash2(i, 7) : 1), Sl: j.R * 1.1, rT: (37 + 11 * hash2(i, 8)) / sp, rP: hash2(i, 9) * TAU, bT: (53 + 20 * hash2(i, 10)) / sp, bP: hash2(i, 11) * TAU,
    wT: (47 + 15 * hash2(i, 12)) / sp, wP: hash2(i, 13) * TAU, wA: i ? Math.min(3 * U, j.R * .3) : 2.5 * U, kv: i ? .05 * (hash2(i, 14) - .5) + (hash2(i, 15) < .5 ? -.04 : .04) : .008,
    max: Math.sin(j.psi) * Math.cos(j.b0), may: -Math.cos(j.psi) * Math.cos(j.b0), m1x: Math.cos(j.psi), m1y: Math.sin(j.psi), m2x: -Math.sin(j.b0) * Math.sin(j.psi), m2y: Math.sin(j.b0) * Math.cos(j.psi)}));   /* mean heading: the trail lies along it */
  /* pose of animal j at anchored time t: pulse shape, heading, lean, place. Vectors: a = bell axis (toward the crown), e1 across the screen, e2 toward the viewer */
  function pose(j, t, o){
    const u = t / j.per + j.q0, qo = u - Math.floor(u), c1 = sq(qo), c2 = sq(qo - LAGM + 1);
    o.c = c1; o.A = 1 - .26 * c1; o.B = .83 - .08 * c1; o.T1 = 1.44 + .3 * c1; o.T2 = o.T1 + .62 * (c2 - c1);
    o.yr = o.B * (1 + Math.cos(o.T1)) / 2; o.rm = o.A * Math.sin(o.T2); o.ym = o.B * Math.cos(o.T2) - o.yr;
    const ps = j.psi + .05 * Math.sin(TAU * t / j.rT + j.rP) + .03 * Math.sin(Math.PI * u), be = j.b0 + .16 * Math.sin(TAU * t / j.bT + j.bP);
    const sp_ = Math.sin(ps), cp = Math.cos(ps), sb = Math.sin(be), cb = Math.cos(be);
    o.ax = sp_ * cb; o.ay = -cp * cb; o.az = sb; o.e1x = cp; o.e1y = sp_; o.e2x = -sb * sp_; o.e2y = sb * cp; o.e2z = cb;
    const os = o.os = (wi(qo) - qo) * j.Sl;
    o.wx = j.wA * Math.sin(TAU * t / j.wT + j.wP); o.wy = j.wA * .6 * Math.sin(TAU * t / j.wT * .73 + j.wP * 1.7);
    o.X = j.X + o.wx + o.ax * os; o.Y = j.Y + o.wy + o.ay * os; o.Z = j.Z; o.R = j.R;
    o.ox = Math.round(o.X); o.oy = Math.round(o.Y); return o; }
  /* light buffers: glow G, hue-weighted glow Hs, thread buffer T (strands combine by max, so a bundle stays lines), ZF = depth of the near bell wall */
  const G = new Float32Array(N), Hs = new Float32Array(N), T = new Float32Array(N), ZF = new Float32Array(N).fill(-1e9), Ga = new Float32Array(N), Ha = new Float32Array(N); let ch = 0, arm = false, bx0 = cols, bx1 = -1, by0 = rows, by1 = -1;
  const add = (x, y, w) => { if(x < 0 || y < 0 || x >= cols || y >= rows || w <= 0) return; const k = x * rows + y; if(arm){ Ga[k] += w; Ha[k] += w * ch; } else { G[k] += w; Hs[k] += w * ch; } if(x < bx0) bx0 = x; if(x > bx1) bx1 = x; if(y < by0) by0 = y; if(y > by1) by1 = y; };
  const splat = (x, y, w) => { const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    add(x0, y0, w * (1 - fx) * (1 - fy)); add(x0 + 1, y0, w * fx * (1 - fy)); add(x0, y0 + 1, w * (1 - fx) * fy); add(x0 + 1, y0 + 1, w * fx * fy); };
  const thread = (x, y, b) => { x = Math.round(x); y = Math.round(y); if(x < 0 || y < 0 || x >= cols || y >= rows) return; const k = x * rows + y; if(b > T[k]){ add(x, y, b - T[k]); T[k] = b; } };
  /* a strand from (px, py) to (x, y): one cell per column (or per row if steep), where the line crosses its middle, so a strand that slides along itself lights the same cells */
  const seg = (px, py, x, y, b) => { const dx = x - px, dy = y - py;
    if(Math.abs(dx) >= Math.abs(dy)){ if(dx === 0) return; const a = Math.ceil(Math.min(px, x)), e = Math.floor(Math.max(px, x)); for(let c = a; c <= e; c++) thread(c, py + dy * (c - px) / dx, b); }
    else { const a = Math.ceil(Math.min(py, y)), e = Math.floor(Math.max(py, y)); for(let r = a; r <= e; r++) thread(px + dx * (r - py) / dy, r, b); } };
  const behind = (x, y, z) => { x = Math.round(x); y = Math.round(y); return x >= 0 && y >= 0 && x < cols && y < rows && ZF[x * rows + y] > z + .5; };
  const LX = -.46, LY = -.74, LZ = .49;                                                              /* key light: from the upper left, a little toward the viewer (screen y runs down) */
  const O = {}, BS = .55;
  function bell(j, o, hero){
    const {A, B, T1, T2, yr, R, ox, oy, c} = o, gain = j.g;
    for(let s = .02; s < 1;){
      const th = s * (T1 + (T2 - T1) * sstep(.5, 1, s)), ct = Math.cos(th), st = Math.sin(th), nl = Math.hypot(B * st, A * ct), nr = B * st / nl, ny = A * ct / nl;
      const r0 = A * st, yl = B * ct - yr, n = Math.max(6, Math.ceil(TAU * r0 * R / BS)), dph = TAU / n, low = sstep(.3, .9, s), pa = hero ? (.014 + .045 * c) * low : 0, rimS = sstep(.8, .95, s);
      const winS = hero ? sstep(.4, .55, s) * (1 - sstep(.78, .9, s)) : 0, lapS = s > .9, core = .3 * Math.exp(-r0 * r0 / .16);
      for(let k = 0; k < n; k++){
        const ph = (k + .5) * dph, cp = Math.cos(ph), sp_ = Math.sin(ph); let c16 = 0, s16 = 0, lp = 1;
        if(hero){ c16 = Math.cos(16 * ph); s16 = Math.sin(16 * ph); lp = c16 * c16; if(lapS && s > .93 + .07 * lp) continue; }
        const r = r0 * (1 + pa * c16), nf = pa * 16 * s16, il = 1 / Math.sqrt(1 + nf * nf), nx = (nr * cp - nf * sp_) * il, nz = (nr * sp_ + nf * cp) * il, nyy = ny * il;
        const wx = nx * o.e1x + nyy * o.ax + nz * o.e2x, wy = nx * o.e1y + nyy * o.ay + nz * o.e2y, wz = nyy * o.az + nz * o.e2z;
        const lx = r * cp, lz = r * sp_, sx = ox + (lx * o.e1x + yl * o.ax + lz * o.e2x) * R, sy = oy + (lx * o.e1y + yl * o.ay + lz * o.e2y) * R, z = o.Z + (yl * o.az + lz * o.e2z) * R;
        const fur = .5 - .5 * c16, win = winS * (.5 + .5 * c16); let e, h;
        if(wz >= 0){ const dif = Math.max(0, wx * LX + wy * LY + wz * LZ), sv = dif > .93 ? (dif - .93) / .07 : 0;
          e = (.3 + .14 * (1 - s) + .3 * win - .26 * low * fur * fur + .3 * rimS) * (.28 + 1.05 * dif) + .5 * sv * sv * (1 - rimS) + core;
          h = .54 - .2 * low - .22 * rimS + .1 * win - .1 * low * fur + .13 * dif * dif * (1 - rimS) + .3 * sv - (lapS ? .1 : 0) + core * .45;
          if(hero){ const xi = Math.round(sx), yi = Math.round(sy); if(xi >= 0 && yi >= 0 && xi < cols && yi < rows){ const kk = xi * rows + yi; if(z > ZF[kk]) ZF[kk] = z; } } }
        else { const canal = hero && c16 > .93 ? .5 * s : 0;                                         /* the far wall, seen from inside: pale, with thin radial canals and the orange margin */
          e = (.1 + .1 * Math.max(0, -(wx * LX + wy * LY)) + canal + .3 * rimS) * .8; h = .72 - .3 * canal - .44 * rimS; }
        ch = h < 0 ? 0 : h > 1 ? 1 : h; splat(sx, sy, e * BS * BS * gain * 3.4);
      }
      s += BS / (R * T1 * Math.hypot(A * ct, B * st) + .01);
    }
    /* the mouth tube under the middle of the bell, pale, seen through the wall */
    const ya = -yr + B * .55, yb = o.ym - .16, nm = Math.ceil((ya - yb) * R / .6);
    for(let i = 0; i <= nm; i++){ const yl = ya + (yb - ya) * i / nm, cx = ox + yl * o.ax * R, cy = oy + yl * o.ay * R, z = o.Z + yl * o.az * R, rr = Math.max(.8, (.2 - .06 * i / nm) * R), dim = behind(cx, cy, z) ? .7 : 1;
      ch = .8; for(let x = Math.floor(cx - rr); x <= cx + rr; x++) for(let y = Math.floor(cy - rr); y <= cy + rr; y++){ const d = ((x - cx) ** 2 + (y - cy) ** 2) / (rr * rr); if(d < 1) add(x, y, .16 * gain * dim * (1 - d)); } }
  }
  /* the trail. A point l cells along a strand lies l behind the animal on its path. Near the bell it is carried along with each surge; further
     back it keeps the animal's mean speed, so there the strand holds still in the picture while the bends of the path (which stay with the
     water) pass down it. Per step along the strand: place along the heading (ha), radius of the bundle, from the margin's radius when that
     water was at the margin (hr), how far the animal has wandered since (hwx, hwy), the meander of the whole wake (hm) */
  const DL = .45, NH = Math.ceil(Math.max(...J.map(j => j.R)) * 8.2 / DL) + 2, ha = new Float32Array(NH), hr = new Float32Array(NH), hwx = new Float32Array(NH), hwy = new Float32Array(NH), hm = new Float32Array(NH), k1x = new Float32Array(NH), k1y = new Float32Array(NH), k2x = new Float32Array(NH), k2y = new Float32Array(NH);
  function strands(j, o, t, hero){
    const R = j.R, V = j.Sl / j.per, n = Math.min(NH, Math.ceil(R * 8.2 / DL)), gain = j.g, sink = .05 * R / V, wt = t * .021, wc = V * t / R, BX = j.X + o.wx, BY = j.Y + o.wy, snx = o.ox - BX, sny = o.oy - BY;   /* the strands start from the bell's whole-cell place and follow its steps in whole cells */
    for(let k = 0; k < n; k++){ const l = k * DL, tt = t - l / V, u = tt / j.per + j.q0, qo = u - Math.floor(u), c1 = sq(qo), c2 = sq(qo - LAGM + 1), e = Math.exp(-l / (1.5 * R)), ul = Math.min(1, l / (7 * R));
      ha[k] = (o.ym * e - .36 * (1 - e)) * R - l; hr[k] = ((1 - .26 * c1) * Math.sin(1.44 + .3 * c1 + .62 * (c2 - c1)) * (1 - sstep(0, 2.6 * R, l)) + .9 * sstep(0, 2.6 * R, l)) * (.66 + .34 * Math.exp(-l / (1.3 * R))) * R;
      hwx[k] = j.wA * Math.sin(TAU * tt / j.wT + j.wP) - o.wx + Math.round(snx * e); hwy[k] = j.wA * .6 * Math.sin(TAU * tt / j.wT * .73 + j.wP * 1.7) - o.wy + Math.round(sny * e);
      k1x[k] = j.m1x + (o.e1x - j.m1x) * e; k1y[k] = j.m1y + (o.e1y - j.m1y) * e; k2x[k] = j.m2x + (o.e2x - j.m2x) * e; k2y[k] = j.m2y + (o.e2y - j.m2y) * e;
      hm[k] = R * 1.5 * ul * Math.sqrt(ul) * (noise((wc - l / R) / 5.5 + R * 3.3, R + wt) - .5) * 2 + j.kv * R * (l / R) * (l / R); }
    if(PART & 4) for(let i = 0; i < j.nT; i++){
      const f = (i + .5) / j.nT * TAU, cf = Math.cos(f), sf = Math.sin(f), len = R * (5.2 + 2.8 * hash2(i, 32)), bk = sf * o.e2z < 0, id = i * 13.7 + j.R, sk = sink * (.5 + hash2(i, 34)), b0 = (hero ? .6 : .55) * gain * (bk ? .6 : 1); let px = 0, py = 0;
      for(let k = 0; k < n; k++){ const l = k * DL; if(l > len) break; const ul = l / len, rr = hr[k], ya = ha[k];
        const wv = wob * R * (.02 + .9 * ul * Math.sqrt(ul)) * (noise((wc - l / R) / 2.4 + id, id * .31 + wt) - .5) * 2 + hm[k];
        const x = BX + hwx[k] + ya * j.max + (rr * cf + wv) * k1x[k] + rr * sf * k2x[k], y = BY + hwy[k] + ya * j.may + (rr * cf + wv) * k1y[k] + rr * sf * k2y[k] + sk * l;
        let b = b0 * (1 - .75 * ul * ul); if(hero && l < 2 * R && behind(x, y, o.Z + ya * o.az + rr * sf * o.e2z)) b *= .55;
        ch = bk ? .1 : .2 - .1 * ul; if(k) seg(px, py, x, y, b); px = x; py = y; } }
    /* oral arms: twisted ribbons from the mouth, ruffled thick edges, a brown line along the middle near the mouth */
    arm = true; if(PART & 2) for(let i = 0; i < j.nA; i++){
      const f0 = i * TAU / j.nA + .5, len = R * (hero ? 6.2 : 5) * (.82 + .18 * hash2(i, 41)), ph = i * 1.9, id = i * 29.3 + 5 + j.R, wd = R * .17, sk = sink * (.4 + .6 * hash2(i, 43)), sc = 20 / R;
      for(let k = 0; k < n; k++){ const l = k * DL; if(l > len) break; const ul = l / len, f = f0 + l * .014 * sc, sr = R * (.08 + .3 * sstep(0, 2.5 * R, l) + .25 * ul) * (hero ? 1 : 1.5), cf = Math.cos(f), sf = Math.sin(f);
        const wv = wob * R * (.03 + .5 * ul) * (noise((wc - l / R) / 3 + id, id * .17 + wt) - .5) * 2 + hm[k], ya = ha[k] - .16 * R, lat = Math.round((sr * cf + wv) * 2) / 2;   /* sideways in half-cell steps: a ribbon that drifts changes cell by cell, not all at once */
        const cx = BX + hwx[k] + ya * j.max + lat * k1x[k] + sr * sf * k2x[k], cy = BY + hwy[k] + ya * j.may + lat * k1y[k] + sr * sf * k2y[k] + sk * l;
        const tw = Math.cos(l * .21 * sc + ph), W = Math.max(.5, wd * (1 - .55 * ul) * (.3 + .7 * Math.abs(tw))), taper = (1 - .8 * ul * ul) * gain * (hero ? (phone ? .6 : 1) : .26) * (hero && l < 1.5 * R && behind(cx, cy, o.Z + ya * o.az) ? .6 : 1);
        const ea = W + .5 * Math.sin(l * 1.7 + ph), eb = -W - .5 * Math.sin(l * 1.45 + ph * 2 + 1), nn = Math.max(2, Math.ceil((ea - eb) / .55));
        for(let s = 0; s <= nn; s++){ const d = eb + (ea - eb) * s / nn, edge = s === 0 || s === nn, x = cx + d * j.m1x, y = cy + d * j.m1y;
          if(edge){ ch = hero ? .96 : .72; splat(x, y, (.2 + .08 * Math.sin(l * 2.3 + s + ph)) * taper); }
          else if(s === (nn >> 1) && ul < .45){ ch = .3; splat(x, y, .09 * taper * (1 - ul / .45)); }
          else { ch = .7; splat(x, y, .075 * taper); } } } }
    arm = false;
  }
  /* render a set of animals into the light buffers, then tone-map into layer L: hue picks the pigment; (dx, dy) fixes the dither pattern to the animal */
  function light(list, t, L, base, nc){
    for(let x = bx0; x <= bx1; x++){ const a = x * rows + by0, b = x * rows + by1 + 1; G.fill(0, a, b); Hs.fill(0, a, b); Ga.fill(0, a, b); Ha.fill(0, a, b); T.fill(0, a, b); ZF.fill(-1e9, a, b); }
    bx0 = cols; bx1 = -1; by0 = rows; by1 = -1; L.clear(); let dx = 0, dy = 0;
    for(const j of list){ pose(j, t, O); if(PART & 1) bell(j, O, !j.far); strands(j, O, t, !j.far); dx = O.ox; dy = O.oy; }
    if(list.length > 1) dx = dy = 0;
    for(let x = bx0; x <= bx1; x++){ const inCol = phone || (x >= mg - 1 && x <= cols - mg);
      for(let y = Math.max(by0, inCol ? TOP : 0); y <= by1; y++){ const k = x * rows + y, ga = Ga[k], g = G[k] + ga; if(g < .03) continue;
        let v = 1 - Math.exp(-1.25 * g); if(inCol) v *= sstep(TOP - 1, TOP + 4, y); if(phone) v *= 1 - sstep(BOT - 2, BOT + 6, y);
        const h = (ga > .4 * G[k] ? Ha[k] / ga : (Hs[k] + Ha[k]) / g) + .12 * Math.max(0, v - .72); L.set(x, y, v + (ZF[k] > -1e8 ? dith(x - dx, y - dy) : dith(x, y)), base + Math.max(0, Math.min(nc - 1, Math.floor(h * nc)))); } }
  }
  /* marine snow = tokens: three depths, the near ones larger and faster; it streams backward past the near animal at the animal's mean speed */
  const NS = Math.round(D.nPart * .3), nAm = Math.round(NS * (1 - D.share));
  const snow = Array.from({length: NS}, () => { const r = X.rnd(), z = r < .45 ? .35 : r < .8 ? .65 : 1.15; return {x: X.rnd(), y: X.rnd(), z, w: X.rnd() * TAU, o: X.rnd(), cx: 0}; });
  snow.map((_, i) => i).sort((a, b) => snow[a].o - snow[b].o).slice(0, nAm).forEach(i => snow[i].cx = 1);
  const SY0 = TOP + 1, SYH = BOT - SY0, V0 = J[0].Sl / PER, fx = -Math.sin(psi0) * V0, fy = Math.cos(psi0) * V0;
  const PK = Array.from({length: phone ? 46 : 150}, (_, i) => ({x: hash2(i, 61), y: hash2(i, 62), z: .18 + .3 * hash2(i, 63), w: hash2(i, 64) * TAU}));
  const wrap = (v, m) => ((v % m) + m) % m;
  /* light shafts from the upper left: slow layer */
  const beams = Array.from({length: phone ? 3 : 8}, (_, i) => ({s: (i + .3 + .4 * hash2(i, 51)) / (phone ? 3 : 8) * cols * 1.25, w: (5 + 8 * hash2(i, 52)) * U, ph: hash2(i, 53) * TAU}));
  const tick = ticker(.12, tm => { RL.clear();
    const bs = beams.map(b => b.s + 5 * U * Math.sin(tm * .04 * sp + b.ph)), ba = beams.map(b => .5 + .5 * Math.sin(tm * .07 * sp + b.ph * 2.3));
    for(let c = 0; c < cols; c++){ const open = !phone && (c < mg - 1 || c > cols - mg);
      for(let y = open ? 0 : TOP; y < rows; y++){ const s = c - y * .62 + rows * .62; let v = 0;
        for(let i = 0; i < bs.length; i++){ const d = (s - bs[i]) / beams[i].w; if(d > -2.5 && d < 2.5) v += ba[i] * Math.exp(-d * d); }
        const b = Math.min(.5, v * .5) * (1.1 - .7 * y / rows) * (open ? 1 : sstep(TOP, TOP + 8 * U, y)) * (.6 + .4 * hash2(c, y));
        if(b > .06) RL.put(c, y, b, 15); } }
    RL.draw(off.begin(), 1, false, PX < 5 ? 'sq' : 'br'); });
  const tickFar = ticker(.09, tm => { light(J.slice(1), tm - 14, FL, 10, 5); FL.draw(off2.begin(), .9, false, 'dot'); });
  return tm => {
    tick(tm); off.blit(); tickFar(tm); off2.blit();
    const t = tm - 14;
    light([J[0]], t, JL, 2, 8);
    JL.draw(ax, 1, true, 'dot');
    PL.clear();
    for(const qo of PK){ const x = Math.round(wrap(qo.x * cols + fx * qo.z * t + 1.5 * U * Math.sin(t * .11 + qo.w), cols)), y = SY0 + Math.round(wrap(qo.y * SYH + fy * qo.z * t + 2 * U * Math.sin(t * .07 + qo.w * 2), SYH)) % SYH;
      PL.put(x, y, .16 + .5 * qo.z * (.8 + .2 * Math.sin(t * .5 + qo.w)), 16); }
    /* snow: wraps inside the open band, so every flake is always on screen; flakes behind the near bell are seen through it, dimmer */
    for(const qo of snow){ const x = Math.round(wrap(qo.x * cols + fx * qo.z * t + 1.6 * U * Math.sin(t * .13 * qo.z + qo.w), cols)) % cols, y = SY0 + Math.round(wrap(qo.y * SYH + (fy + .5 * U) * qo.z * t, SYH)) % SYH;
      let b = (qo.z < .5 ? .34 : qo.z < .9 ? .54 : .8) * (.88 + .12 * Math.sin(t * .6 + qo.w));
      if(qo.z < .9 && behind(x, y, -40 * (1 - qo.z))) b *= .6;
      let yy = y; for(let n = 0; n < 6 && PL.gb[x * rows + yy] > 0 && PL.gc[x * rows + yy] < 2; n++) yy = yy + 1 < SY0 + SYH ? yy + 1 : SY0;   /* never two flakes in one cell: the count stays exact */
      PL.set(x, yy, b, qo.cx); }
    PL.draw(ax, .9, true, 'dot');
  };
}
/* 11 goldfish.
   Adapted from ascii.rest piece 'aquarium' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: fish of two kinds cross the tank there and back, change depth and show a face-on view as they turn; weed rises from the
   root and bends toward a swinging tip, one clump stands in front of the fish; bubbles stream up, wobbling as they rise; a gravel bed with stones.
   Rebuilt to read like footage of a planted tank, not like a drawing of one.
   Anatomy, measured on photographs of real fish (a wild-type Carassius auratus in side view for the outline, head, eye and fin places; a comet
   goldfish for its tail and dorsal; an asagi koi seen from above for the width, head and tail of the koi; the koi's depth is the usual carp
   figure, not measured): the body is a spindle flattened from side to side, deepest at 0.45 of its standard length (snout to tail root),
   depth 0.33 (comet) or 0.29 (koi) of that length, width about half the depth (comet) or 0.21 of the length (koi), tapering to a tail root
   0.14 deep. The head is a wedge, a quarter of the length, its outline running
   straight on into the back; the mouth is small and at the tip; the eye is a fifth of the head long, dark, at mid-side, with at most one glint;
   the gill cover is a curved shadow line. Fins sit where they do on the animal: pectorals low behind the gill cover, pelvics under the belly at
   mid-length, a long-based dorsal from the highest point of the back, an anal fin, a forked tail (long and deeply forked with pointed lobes on
   the comet, short on the koi, which also has two barbels).
   Each fish is a 3D model rendered through a z-buffer every frame, lit from above: a darker back, a paler flank and a pale belly
   (countershading), a sheen that slides along the upper flank as the body turns, moving dapples of light on the back, a lit edge where the
   surface turns away, and fins as see-through membranes with thin rays. Colours are those of real fish: orange-gold, red-and-white and white
   comets, a red-and-white koi and a slate-blue asagi koi with a pale net on its back and a red belly.
   Motion, from how such fish swim, so that what changes from frame to frame is uneven the way it is in footage: a wave runs down the body,
   smallest just behind the head and largest at the tail (the tail tip sweeps about a fifth of a body length, the snout a few hundredths), and
   it runs backward faster than the fish goes forward (the fish covers about 0.7 of a wavelength per beat); a few strong beats and then a
   glide with the body held straight, slowing (burst and coast); a turn is the whole body bent into a C and then straightened; the paired fins
   scull to hold station and fold flat in a burst, and the dorsal lowers at speed. The small fish keep loosely together (same heading, a
   little apart, each a little late). One fish noses down to the sand and picks at it. Every fourth beat the big fish startles while it holds
   station: a tenth of a second with the body snapped into a C, another tenth of launch, a long glide; the others startle a few frames later,
   the nearest first.
   So that a gliding fish does not shimmer all over, each fish is drawn on the cell grid as a whole: its place is rounded to whole cells, the
   shade of its body is fixed to the body (a faint scale grain, no screen dither), and so a straight body moves as one block and cells change
   at its edges, in its fins and where it bends.
   Scene: light shafts from above, a net of light on the sand, stones, blade-leaved and whorled stem plants that sway with a wave travelling up
   them, far plant masses cooled and dimmed by distance, drifting specks; the water round the big fish is kept clear.
   Data: bubbles = tokens (every bubble is on screen at all times), their colour = split (the exact UI blue and amber); swim pace = 7-day
   trend; weed sway = cache miss. The fish, light, plants, sand and specks carry no data: fish colours are natural, not a code. */
function tFish(env, X){
  const SNAP = true;                                                                                /* false: the fish are placed at fractions of a cell (kept for comparison) */
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, PX = env.P, N = cols * rows, U = 5 / PX;   /* U: cells per 5 px, so sizes hold on any grid */
  /* palette: 0 / 1 the data colours (bubbles only); 2 pale highlight and belly; 3-5 spare tints; 6 cool edge light; 7-15 scenery; 16-21 fish
     pigments (orange, deep orange, red, white, grey shadow of white, slate blue) */
  const PL = [BLUE, OR, [250, 236, 206], [198, 96, 52], [218, 228, 240], [62, 80, 132], [138, 204, 206], [224, 206, 164], [66, 140, 146], [170, 130, 88], [232, 222, 196],
    [96, 160, 106], [160, 90, 70], [52, 104, 112], [60, 116, 98], [156, 198, 122], [234, 134, 54], [164, 78, 38], [210, 78, 46], [238, 230, 212], [150, 152, 160], [104, 132, 180]];
  const GL = 2, KL = 4, KD = 5, RIM = 6, SHAFT = 7, HAZE = 8, SAND = 9, PAPER = 10, WEED = 11, WEEDR = 12, FAR = 13, FARB = 14, LEAF = 15, ORG = 16, ORGD = 17, RED = 18, WHT = 19, WHTD = 20, SLATE = 21;
  /* colour morphs: main pigment, patch pigment, shadow tint, fin colour, share of the body under patches; 0 orange-gold comet, 1 red-and-white
     comet, 2 white comet, 3 red-and-white koi, 4 asagi koi */
  const MORPH = [{A: ORG, B: ORG, D: ORGD, fin: ORG, pc: 0}, {A: WHT, B: RED, D: WHTD, fin: WHT, pc: .5}, {A: WHT, B: ORG, D: WHTD, fin: WHT, pc: .12}, {A: WHT, B: RED, D: WHTD, fin: WHT, pc: .45}, {A: SLATE, B: RED, D: KD, fin: WHT, pc: 0}];
  const RL = new Layer(cols, rows, PL, PX), BL = new Layer(cols, rows, PL, PX), FL = new Layer(cols, rows, PL, PX), off = offscreen(env), S = mulberry(mix(p.seed + 11));
  const TOP = phone ? Math.round(10 * U) : Math.round(rows * .48), FLOOR = rows - Math.round((phone ? 21 : 13) * U), band = FLOOR - TOP;   /* TOP..FLOOR: the water the page leaves open */
  const mg = Math.max(0, (env.W - 1240) / 2 / PX), vel = sp * (.7 + .6 * D.trendK), sway = 1 + D.jitter * .8;   /* mg: side margin beside the content column, in cells */
  const dune = new Float32Array(cols); for(let c = 0; c < cols; c++) dune[c] = FLOOR + U * (1.4 * Math.sin(c * .043 / U + p.off * 3) + 1.2 * (noise(c * .09 / U + 3, 7) - .5));
  const at = x => dune[Math.max(0, Math.min(cols - 1, x | 0))];
  const VX = cols / 2, VY = TOP + band * .5, F = (phone ? 120 : 200) * U;                            /* camera: vanishing point and focal length, in cells */
  const nrm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }, LK = nrm([-.28, .86, .42]), HK = nrm([LK[0], LK[1], LK[2] + 1]);   /* key light: from above, a little to the left and front */
  /* species (0 asagi koi, 1 comet goldfish), in standard lengths: half depth, half width, where the body is deepest, depth of the tail root
     (of the greatest depth), belly fullness; tail length, spread, depth of the fork, swim wave at the tail, how long the tail trails (s), how
     much it sinks at rest; dorsal height, start and end of its base; pectoral, pelvic, anal fin lengths; eye position and radius; gill cover */
  const SPEC = [
    {H: .145, W: .105, pk: .44, ped: .42, bel: 1.08, tl: .27, tv: .55, notch: .5, wave: .1, lag: .25, droop: .1, dh: .1, d0: .38, d1: .76, pf: .15, pv: .12, af: .11, es: .09, er: .026, gs: .25, barb: 1},
    {H: .165, W: .08, pk: .45, ped: .4, bel: 1.12, tl: .66, tv: .5, notch: .5, wave: .12, lag: .6, droop: .3, dh: .19, d0: .4, d1: .72, pf: .16, pv: .15, af: .13, es: .09, er: .029, gs: .26, barb: 0}];
  /* outline of the body along its length (0 snout .. 1 tail root), as a share of the greatest depth: a wedge-shaped head that runs straight
     into the back (measured: 0.41 at the eye, 0.85 at the gill cover), then a taper to the tail root */
  const rad = (K, s) => { if(s < K.pk){ const x = 1 - s / K.pk; return .1 + .9 * Math.pow(1 - Math.pow(x, 1.7), .9); } return K.ped + (1 - K.ped) * Math.pow(Math.cos((s - K.pk) / (1 - K.pk) * 1.5708), 1.6); };
  /* ---- the cast: one large comet that swims from far to near (the near pass is the hero frame), two koi of middle size (the second one
     forages), and a loose school of small comets that follows one path (lead): each member keeps its own place beside it and runs a little
     late. sd = how long after the big fish each one startles (nearest first), sl = how far it darts (body lengths), sk = how far it is thrown
     off its heading ---- */
  const NS = phone ? 3 : 5, tiers = phone ? [2, 1] : [2, 1, 1];
  const home = (sxc, row, cz, axs, ays, az) => { const k0 = F / (F - cz); return {cz, X0: VX + (sxc - VX) / k0, Y0: VY + (row - VY) / k0, AX: axs / k0, AY: ays / k0, AZ: az, k0, hx: sxc}; };
  const HX = cols * (phone ? .52 : .6 + .02 * p.off), HT = 6 / vel, HG = .45, EV = 14 + (.86 - HG) * HT, SPER = 4 * HT;   /* the startle: while the big fish holds station, every fourth beat */
  const lead = Object.assign(home(cols * (phone ? .5 : .28), TOP + band * (phone ? .28 : .36), -62 * U, cols * (phone ? .3 : .22), band * .16, 34 * U), {i: 20, L: 9 * U, T: 5.6 / vel, g0: .2 + 8 * hash2(p.seed, 31), bow: .22, hs: (p.seed % 9973) * 31 + 20011, qo: 1.7, beat: 1});
  const fish = [], sdl = hx => .08 + .25 * Math.abs(hx - HX) / cols;                 /* three to six frames after the big fish */
  tiers.forEach((t, i) => { const hero = t === 2, mo = hero ? (hash2(p.seed, 5) < .6 ? 0 : 1) : i === 1 ? 3 : 4;
    const h = hero ? home(HX, TOP + band * (phone ? .56 : .5), (phone ? -22 : -40) * U, cols * (phone ? .2 : .17), band * (phone ? .05 : .08), (phone ? 26 : 50) * U)
      : i === 1 ? home(cols * (phone ? .2 : .2), TOP + band * (phone ? .86 : .7), -80 * U, cols * (phone ? .12 : .07), band * .06, 20 * U) : home(cols * .12, TOP + band * .62, -48 * U, cols * .07, band * .1, 18 * U);
    fish.push(Object.assign(h, {i, t, mo, g: mo < 3 ? 1 : 0, hero, forage: i === 2 || phone && i === 1, L: hero ? (phone ? 27 : 39) * U : (phone ? 14 : 19) * U / h.k0, bow: .16,
      T: hero ? HT : (4.6 + 1.2 * hash2(p.seed, 40 + i)) / vel, g0: hero ? HG : 8 * hash2(p.seed, 50 + i), qo: TAU * hash2(p.seed, 60 + i), beat: .9 + .2 * hash2(p.seed, 70 + i), hs: (p.seed % 9973) * 31 + i * 1009,
      sd: hero ? 0 : sdl(h.hx), sl: hero ? .8 : 1.2, sk: (hero ? .7 : .5 + .5 * hash2(p.seed, 75 + i)) * (hash2(p.seed, 77 + i) < .5 ? -1 : 1)})); });
  for(let j = 0; j < NS; j++){ const i = tiers.length + j, a = TAU * (j + .5 * hash2(p.seed, 80 + j)) / NS, r = .5 + .5 * hash2(p.seed, 90 + j), hm = hash2(p.seed, 140 + j), mo = hm < .5 ? 0 : hm < .8 ? 1 : 2;
    fish.push({i, t: 0, mo, g: 1, lead, L: (phone ? 7.5 : 9.5) * (.85 + .3 * hash2(p.seed, 100 + j)) * U / lead.k0, ox: Math.cos(a) * r * 13 * U, oy: Math.sin(a) * r * 5 * U, oz: Math.sin(a * 1.7 + 1) * r * 14 * U,
      delay: .15 + .5 * hash2(p.seed, 110 + j), qo: TAU * hash2(p.seed, 120 + j), beat: 1 + .3 * hash2(p.seed, 130 + j),
      sd: sdl(lead.hx + Math.cos(a) * r * 13 * U) + .03 * j, sl: 1.6, sk: (.5 + .5 * hash2(p.seed, 150 + j)) * (hash2(p.seed, 160 + j) < .5 ? -1 : 1)}); }
  /* a burst: a quick start and a long glide; prof is the distance covered (0..1), dprof its speed (peak about 1.7) */
  const prof = v => { const w = v * Math.sqrt(v), qo = 1 - w; return 1 - qo * qo * qo; }, dprof = v => { if(v <= 0 || v >= 1) return 0; const qo = 1 - v * Math.sqrt(v); return 4.5 * Math.sqrt(v) * qo * qo; };
  /* where beat k of a path starts (o), how far the path bows to one side (o.w) and whether the fish feeds there (o.fg: down at the sand). The
     places step round the fish's home water at uneven distances from its middle, so most turns are a third of a circle or less, at every
     angle to the camera, and the track never repeats. The big fish's beats -1, 0 and 1 are composed (it comes up from the back, then crosses from
     the upper right and far to the lower left and near): look t = 8 is the hero frame, the near pass, on any date */
  const way = (f, k, o) => { const a = k * 1.9 + f.hs % 7 + .9 * hash2(f.hs + k * 3, 1); let fx = Math.cos(a) * (.35 + .65 * hash2(f.hs + k * 3, 6)), fy = hash2(f.hs + k * 3, 2) * 2 - 1, fz = Math.sin(a) * (.35 + .65 * hash2(f.hs + k * 3, 3)); o.w = f.bow * (hash2(f.hs + k * 3, 4) * 2 - 1);
    o.fg = f.forage && hash2(f.hs + k * 3, 5) > .45 ? 1 : 0;
    if(f.hero && k === -1){ fx = .5; fy = -.7; fz = -.9; } else if(f.hero && k === 0){ fx = 1; fy = -.1; fz = .72; o.w = f.bow * .5; } else if(f.hero && k === 1){ fx = -.55; fy = .3; fz = .95; }
    o.x = f.X0 + f.AX * fx; o.y = o.fg ? VY + (at(VX + (o.x - VX) * f.k0) - 1.6 * U - .2 * f.L * f.k0 - VY) / f.k0 : f.Y0 + f.AY * fy; o.z = f.cz + f.AZ * (o.fg ? .3 * fz : fz); };
  const WA = {x: 0, y: 0, z: 0, w: 0, fg: 0}, WB = {x: 0, y: 0, z: 0, w: 0, fg: 0}, WC = {x: 0, y: 0, z: 0, w: 0, fg: 0};
  /* one path at time t, a pure function of t. A beat: the body bends into the turn while the fish is already moving off (first quarter), a
     burst, a glide along a shallow arc in the ground plane, then holding station (or nosing down to feed). spd = speed (0..1), thr = how hard
     the tail is beating (1 in the burst, 0 in the glide), hov = how much it is holding station, turn = how hard it is turning (-1..1).
     The phase of the body wave advances with the distance swum: 0.7 of a body length per wave, whatever the length of the beat */
  function path(f, t, o){
    const g = (t - 14) / f.T + f.g0, k = Math.floor(g), uu = g - k; way(f, k - 1, WC); way(f, k, WA); way(f, k + 1, WB);
    const v = clamp01((uu - .07) / .7), s = prof(v), dv = dprof(v), hov = 1 - Math.min(1, dv / .9), e = clamp01(uu / .27);
    const dx = WB.x - WA.x, dy = WB.y - WA.y, dz = WB.z - WA.z, ex = WA.x - WC.x, ez = WA.z - WC.z;
    const cx = dx / 2 - dz * WA.w, cz = dz / 2 + dx * WA.w, qox = ex / 2 - ez * WC.w, qz = ez / 2 + ex * WC.w;         /* control points, relative to the start of each arc */
    const tx = (1 - s) * cx + s * (dx - cx), tz = (1 - s) * cz + s * (dz - cz);                                      /* tangent now */
    let d = Math.atan2(cz, cx) - Math.atan2(ez - qz, ex - qox); d -= TAU * Math.round(d / TAU);                         /* the turn that joins the last arc to this one */
    const feed = WB.fg * sstep(.6, .85, uu) + WA.fg * (1 - sstep(.04, .3, uu));                                       /* nose down at the sand, picking */
    o.X = WA.x + 2 * s * (1 - s) * cx + s * s * dx + feed * .25 * U * Math.sin(t * 6.3 + f.qo); o.Z = WA.z + 2 * s * (1 - s) * cz + s * s * dz;
    o.Y = WA.y + dy * (s * s * (3 - 2 * s)) + .3 * U * Math.sin(t * .45 + f.qo) * hov * (1 - feed);
    o.yaw = Math.atan2(tz, tx) - d * (1 - easeS(e)) + .05 * Math.sin(t * .6 + f.qo) * hov; o.spd = Math.min(1, dv / 1.7); o.hov = hov; o.turn = d / Math.PI * 4 * e * (1 - e);
    o.pitch = Math.max(-.4, Math.min(.4, Math.atan2(-dy, Math.hypot(dx, dz)) * 1.3)) * Math.sin(Math.PI * s) - feed * (.62 + .06 * Math.sin(t * 6.3 + f.qo)); o.roll = -.35 * o.turn;
    o.thr = sstep(0, .07, v) * (1 - sstep(.3, .52, v));
    const G = Math.min(26, 9 * Math.hypot(dx, dz) / f.L), Gp = Math.min(26, 9 * Math.hypot(ex, ez) / f.L); let lo = Gp % TAU; if(lo > Math.PI) lo -= TAU;   /* what the last beat left over, taken up during the turn */
    o.bp = t * TAU * .12 * f.beat + f.qo + G * s + lo * (1 - easeS(clamp01(uu / .25))); return o; }
  /* where a fish is at time t and how it is turned. A member of the school takes the school's path a moment late and keeps its place beside
     it (the places breathe slowly). The startle, for every fish in its turn: a tenth of a second with the body snapped into a C and thrown off its
     heading, another tenth of launch, a long straight glide while its flank flashes, and over the next seconds a drift back to its path */
  const O3 = {};
  function pose(f, t, o){
    if(f.lead){ path(f.lead, t - f.delay, o); o.yaw += .12 * Math.sin(t * .4 + f.qo);
      const c = Math.cos(o.yaw), s = Math.sin(o.yaw), br = 1 + .25 * Math.sin(t * .23 + f.qo), la = .5 * Math.sin(t * .31 + f.qo * 2) * f.L;
      o.X += (f.ox * c - f.oz * s) * br + c * la; o.Z += (f.ox * s + f.oz * c) * br + s * la; o.Y += f.oy * br + .4 * U * Math.sin(t * .5 + f.qo); o.bp += f.qo;
    } else path(f, t, o);
    const u = (((t - EV - f.sd) % SPER) + SPER) % SPER; o.su = u; o.fl = 0;
    if(u < 9){ path(f.lead || f, t - u - (f.lead ? f.delay : 0), O3);                                      /* its heading when it took fright: the dart keeps that line */
      let kick = f.sk; if(f.hero){ kick = (Math.cos(O3.yaw) >= 0 ? -.4 : Math.PI + .4) - O3.yaw; kick -= TAU * Math.round(kick / TAU); if(Math.abs(kick) < .5) kick = kick < 0 ? -.6 : .6; }   /* the big fish darts across the picture, a little toward us */
      const sg = kick > 0 ? 1 : -1, hd = O3.yaw + kick, go = u < .1 ? 0 : sstep(.1, .2, u), la = f.sl * f.L * go * (1 - sstep(1.2, 8.5, u));
      o.yaw += kick * (u < .1 ? 1 : Math.exp(-(u - .1) * 1.1)); o.X += Math.cos(hd) * la; o.Z += Math.sin(hd) * la; o.fl = u < .1 ? 1 : Math.exp(-(u - .1) * 1.4);
      if(u < .1){ o.turn = sg * 2.4; o.thr = 0; o.spd = 0; }                                             /* stage 1: a tenth of a second (a pose of one frame could be skipped at the page's 20 frames a second), the body a C */
      else if(u < .2){ o.turn = -sg * 1.1 * (1 - go); o.thr = 1; o.spd = 1; o.hov = 0; }                   /* stage 2: the counter-bend that pushes it off */
      else if(u < 3){ const gl = sstep(3, .2, u); o.thr *= 1 - gl; o.spd = Math.max(o.spd, gl); o.hov *= 1 - gl; }   /* then a long straight glide */
      o.roll = -.35 * o.turn; }
    o.k = F / (F - o.Z); o.sx = VX + (o.X - VX) * o.k; o.sy = VY + (o.Y - VY) * o.k; return o; }
  /* rotation of a pose: m maps a local point (x toward the head, y up, z to the fish's side) to world (x, up, z toward the camera) */
  const basis = (o, m) => { const cy_ = Math.cos(o.yaw), sy_ = Math.sin(o.yaw), cp = Math.cos(o.pitch), spp = Math.sin(o.pitch), cr = Math.cos(o.roll), sr = Math.sin(o.roll);
    m[0] = cy_ * cp; m[1] = cy_ * -spp * cr - sy_ * sr; m[2] = cy_ * spp * sr - sy_ * cr; m[3] = spp; m[4] = cp * cr; m[5] = -cp * sr; m[6] = sy_ * cp; m[7] = sy_ * -spp * cr + cy_ * sr; m[8] = -sy_ * spp * sr + cy_ * cr; };
  /* ---- the buffer the fish are rendered into: nearest sample wins; a membrane sample tints what is behind it, once per sheet ---- */
  const ZZ = new Float32Array(N).fill(-1e9), ZB = new Float32Array(N), ZC = new Uint8Array(N), ZO = new Int8Array(N), ZM = new Int16Array(N), MK = new Uint8Array(N), mk = [];
  let x0 = cols, x1 = -1, y0 = rows, y1 = -1, sx = 0, sy = 0, sz = 0;
  const cell = () => { const x = Math.round(sx), y = Math.round(sy); if(x < 0 || y < 0 || x >= cols || y >= rows) return -1;
    if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y; return x * rows + y; };
  /* a body sample. Of the samples of one surface that fall in a cell, the one nearest the cell's centre is kept (not whichever is a hair nearer
     the eye), so the shade is read at the same spot of every cell and its contours come out as clean lines, which then move with the body */
  const ZD = new Float32Array(N).fill(9);
  const op = (b, c, o) => { const k = cell(); if(k < 0) return; const fx = sx - Math.round(sx), fy = sy - Math.round(sy), d = fx * fx + fy * fy, same = ZO[k] === o && sz > ZZ[k] - 2.5 * U;
    if(same ? d < ZD[k] : sz > ZZ[k]){ ZZ[k] = same ? Math.max(sz, ZZ[k]) : sz; ZB[k] = b; ZC[k] = c; ZO[k] = o; ZM[k] = 0; ZD[k] = d; } };
  /* den: 0 = every cell, 1 = every other cell (checker), 2 = one cell in four */
  const mem = (b, c, a, sid, o, den) => { const k = cell(); if(k < 0 || sz <= ZZ[k]) return;
    if(den){ const x = (k / rows) | 0, y = k % rows; if(den === 1 ? (x + y) & 1 : (x & 1) | (y & 1)) return; }
    const e = ZZ[k] < -1e8, v = b * (.45 + .55 * a);
    if(ZM[k] === sid){ if(v > ZB[k]){ ZB[k] = v; ZC[k] = c; } return; }                                /* same sheet again: keep its brightest sample (a ray over the membrane) */
    const ob = ZB[k]; ZB[k] = e ? v : Math.max(b * a + ob * (1 - a), ob * .5); if(e || b > ob) ZC[k] = c; ZM[k] = sid; if(e){ ZZ[k] = sz; ZO[k] = -o; } };
  const M = new Float32Array(9), M2 = new Float32Array(9);
  let PXo = 0, PYo = 0, PZo = 0;
  const projW = (wx, wy, wz) => { const k = F / (F - wz); sx = VX + (wx - VX) * k; sy = VY + (wy - VY) * k; sz = wz; };
  const proj = (x, y, z) => projW(PXo + M[0] * x + M[1] * y + M[2] * z, PYo - (M[3] * x + M[4] * y + M[5] * z), PZo + M[6] * x + M[7] * y + M[8] * z);
  /* light: a caustic net (two ridged noise sheets sliding over each other) and slanting shafts that breathe */
  let ct = 0;
  const caus = (x, y) => { const w = noise(x * .05 + 40, y * .09 - ct), v = 1 - Math.abs(2 * noise(x * .1 + w * 1.6 + ct, y * .21 + w * 1.6 + 3) - 1), qo = v * v * v; return qo * qo * v; };
  const beams = Array.from({length: phone ? 4 : 9}, (_, i) => ({s: (i + .2 + .6 * S()) / (phone ? 4 : 9) * cols * 1.5, w: (5 + 9 * S()) * U, ph: S() * TAU})), bs = new Float32Array(beams.length), ba = new Float32Array(beams.length);
  const SN = Math.ceil(cols + rows * 1.2) * 2, ST = new Float32Array(SN + 2);                       /* the light across the shaft coordinate, tabulated each tick */
  const shaft = (c, y) => { const qo = Math.max(0, Math.min(SN, (c - y * .55 + rows * .55) * 2)), i = qo | 0; return ST[i] + (ST[i + 1] - ST[i]) * (qo - i); };
  /* the tail chain: KC links; centre, the direction across the veil and the direction out of its plane at each node, in world cells */
  const KC = 14, CH = new Float32Array((KC + 1) * 9), O2 = {};
  /* ---- one fish ---- */
  function render(f, o, tm){
    const K = SPEC[f.g], L = f.L, kc = o.k, far = f.t === 0, MO = MORPH[f.mo], LI = GL, id = f.i + 1, sid0 = f.i * 16 + 1;
    basis(o, M); PXo = o.X; PYo = o.Y; PZo = o.Z;
    if(SNAP){ PXo += (Math.round(o.sx) - o.sx) / kc; PYo += (Math.round(o.sy) - o.sy) / kc; }             /* the whole fish sits on the cell grid */
    const lift = 1 + (phone ? 1.3 : .28) * clamp01((FLOOR - o.sy) / band);                              /* the canvas fades upward: lift what swims high */
    const gain = [.74, .92, 1.08][f.t] * (phone ? 1.2 : 1) * (1 + .8 * o.fl) * Math.round(lift * 12) / 12 * (f.hero ? .8 + .25 * clamp01((o.Z - f.cz) / f.AZ * .5 + .5) : 1);   /* far fish are fainter; the big fish brightens as it comes near */
    const bp = o.bp, st = far ? .75 : .55, amp = .03 + .97 * o.thr + .18 * o.hov * (1 - o.thr);
    /* the spine: the swim wave (smallest just behind the head, largest at the tail, one wave per body length; strong in a burst, gone in a
       glide, a slow idle wave while holding station) and the bend of a turn (the whole body curved to one side) */
    const zb = s => L * (amp * (.015 - .07 * s + .135 * s * s) * Math.sin(bp - 6.28 * s) + .27 * o.turn * s * s);
    const be = s => (zb(s + .01) - zb(s - .01)) / (.02 * L);
    /* body: rings along the spine, samples around each ring, back faces culled. Light from above: pigment (dark back, pale belly) times the key
       light, a sheen where the scales mirror the light toward the eye (it slides as the body turns, and glitters scale by scale), dapples of the
       light net on the back, a lit edge where the surface turns away, a cool glow from the sand under the belly */
    const Nb = Math.max(8, Math.ceil(L * kc / st)), R2 = (K.H + K.W) / 2 * L, er = Math.max(.62, K.er * L * kc);
    for(let i = 0; i <= Nb; i++){
      const s = i / Nb, r = rad(K, s), dr = (rad(K, Math.min(1, s + .005)) - rad(K, Math.max(0, s - .005))) / .01;
      const yh = r * K.H * L, zw = r * K.W * L, lx = L * (.42 - s), z0 = zb(s), b0 = be(s), n = Math.max(6, Math.ceil(TAU * Math.sqrt((yh * yh + zw * zw) / 2) * kc / st));
      for(let j = 0; j < n; j++){
        const th = j / n * TAU - Math.PI, c = Math.cos(th), si = Math.sin(th);
        let nx = dr * K.H * K.W, ny = K.W * c, nz = K.H * si; const t_ = nx; nx -= nz * b0; nz += t_ * b0;
        let wx = M[0] * nx + M[1] * ny + M[2] * nz, wy = M[3] * nx + M[4] * ny + M[5] * nz, wz = M[6] * nx + M[7] * ny + M[8] * nz; const nl = Math.hypot(wx, wy, wz) || 1; wx /= nl; wy /= nl; wz /= nl;
        if(wz < -.22) continue;
        proj(lx, yh * c * (c < 0 ? K.bel : 1), zw * si + z0);
        const dif = Math.max(0, wx * LK[0] + wy * LK[1] + wz * LK[2]), hv = Math.max(0, wx * HK[0] + wy * HK[1] + wz * HK[2]), h2 = hv * hv * hv, sh = h2 * h2;
        const fr = 1 - Math.max(0, wz), fres = fr * fr, up = clamp01(.55 + .6 * wy), back = sstep(.45, .85, c), belly = sstep(-.25, -.7, c);
        const iu = Math.floor(s * L / (1.7 * U)), iv = Math.floor(th * r * R2 / (1.7 * U)), tex = far ? .5 : hash2(iu * 31 + f.i, iv);   /* one value per scale, fixed to the body */
        const gl = .5 * sh * (.8 + .4 * tex) * (s < K.gs ? 1.1 : 1);                                                                 /* the gill cover and cheek shine most */
        /* pigment: the morph's patches (fixed to the body); the asagi koi has a slate back with a pale net, a white head and a red belly */
        let pig = MO.A;
        if(f.mo === 4){ pig = s < .2 ? WHT : c < -.2 ? RED : SLATE; }
        else if(MO.pc && s > .12 && noise(s * 2.6 + f.i * 7.3, th * .7 + f.i) > 1 - MO.pc - .25 * back) pig = MO.B;
        let b = (1 - .4 * back + .18 * belly) * (.2 + .5 * dif) + gl + .34 * fres * up + .18 * fres * (1 - up);
        let col = gl > .38 ? LI : belly > .55 && pig === MO.A && f.mo !== 4 ? LI : b < .24 && pig === MO.A ? MO.D : pig;
        if(f.mo === 4 && pig === SLATE && !far && tex > .62){ col = WHT; b += .06; }                                                   /* asagi: pale-edged scales */
        if(wy > .25){ const qo = caus(sx / U, sy * 2 / U) * wy; if(qo > .3){ b += .3 * qo; if(qo > .6) col = LI; } }                         /* light dapples on the back */
        const gd = (s - K.gs - .05 * c * c) * L;                                                                                      /* gill cover: a curved shadow line with a lit rim in front of it */
        if(c > -.75 && c < .8){ if(Math.abs(gd) < .45 * U) b *= .5; else if(!far && gd < 0 && gd > -1.4 * U) b += .08; }
        if(s < .025 && c > -.5 && c < .15) b = 0;                                                                                    /* mouth: small, at the tip */
        else if(!far && s < .07 && Math.abs(c + .22) < .09) b *= .45;                                                               /* and the line of the lips running back from it */
        const de = Math.hypot((s - K.es) * L, (Math.abs(th) - 1.42) * r * R2) * kc;                                                 /* eye: small, dark, at mid-side; one glint, a thin pale iris */
        if(de < er){ b = er > 1 && s < K.es && Math.abs(th) < 1.42 && de > er * .4 ? .9 : 0; col = b ? PAPER : KD; }
        else if(!far && de < er + .9){ b = Math.max(b, .5); col = LI; }
        op(b < .07 ? 0 : Math.min(1.1, b * gain), col, id);
      }
    }
    if(K.barb && !far) for(const sd of [-1, 1]) for(let qo = 0; qo <= 4; qo++){ const u = qo / 4; proj(L * (.4 - .04 * u), -L * (.02 + .045 * u), sd * L * (.02 + .02 * u) + zb(.03)); op(.5 * gain, LI, id); }   /* koi: two barbels at the mouth */
    const base = MO.fin;
    /* a fin cell: a see-through membrane in the fish's own colour (even near the root, thinning to a checker and then to one cell in four
       toward the tip), brighter along the rays; the outer edge is only a little brighter, never an outline. ray = 0 (membrane) .. 1 (on a ray) */
    const QO = {x: 0, y: 0, z: 0, b: 0, c: 0, a: 1, d: 0};
    const veil = (ray, edge, r, full) => { if(ray > .2){ QO.b = (edge ? .7 - .3 * r : .8 - .4 * r) * ray; QO.c = r > .7 ? LI : base; QO.d = 0; QO.a = .3 + .5 * ray; }
      else { QO.b = full ? .4 - .16 * r : .34 - .12 * r; QO.c = full && r < .3 && MO.B !== WHT ? MO.B : base; QO.d = full ? (r > .88 ? 1 : 0) : r > .75 ? 2 : r > .4 ? 1 : 0; QO.a = .35; } };   /* full: an unbroken membrane (the tail) */
    /* rays stay about one cell thin whatever the grid: qo = position across the fin (0..1), wc = the fin's width there in cells, n = number of rays.
       Returns how much of a ray this point carries: 1 on its centre line, falling to 0 one cell away, so a ray that drifts across the grid
       hands its light from one cell to the next instead of jumping. Where the fin folds narrow and rays would touch, every second (then every
       fourth) ray fades out gradually, so there is always dark between rays and none pops on or off. EDGE is set on the two outer rays */
    let EDGE = false;
    const rayAt = (qo, wc, n) => { const g = qo * (n - 1), i = Math.round(g), sp_ = wc / (n - 1), w = 1 - Math.abs(g - i) * sp_ / .95; EDGE = i === 0 || i === n - 1; if(w <= 0) return 0;
      return EDGE ? w : w * (i & 1 ? clamp01((sp_ - 1.6) / 1.2) : i & 2 ? clamp01((sp_ - .8) / .6) : 1); };
    const rays = wc => Math.max(3, Math.min(17, Math.floor(wc / 3.6) + 1));
    const sheet = (sid, na, nr, fn) => { na = Math.max(2, Math.ceil(na)); nr = Math.max(2, Math.ceil(nr));
      for(let i = 0; i <= na; i++) for(let j = 0; j <= nr; j++){ fn(i / na, j / nr); if(QO.b < 0) continue; proj(QO.x, QO.y, QO.z); mem(Math.min(1, QO.b * gain), QO.c, QO.a, sid, id, QO.d); } };
    const kk = kc / st;
    /* tail: a forked fan on a chain. Node n of the chain takes its direction from the heading the fish had n links ago, so the lobes trail
       through a turn; they sink a little when the fish is slow and carry the swim wave outward. The fork is cut into the fan: the middle rays
       are short, the outer ones run to a point */
    const xT = L * (.42 - 1), zT = zb(1), TL = K.tl * L, seg = TL / KC, hr = K.ped * K.H * L;
    { const w0 = L * amp * .08 * Math.sin(bp - 6.28); let cx = PXo + M[0] * xT + M[2] * zT, cy = PYo - (M[3] * xT + M[5] * zT), cz = PZo + M[6] * xT + M[8] * zT;
      for(let n = 0; n <= KC; n++){ const r = n / KC, qo = n * 9; pose(f, tm - r * K.lag, O2); basis(O2, M2);
        let dx = -M2[0], dy = M2[3] + K.droop * r * (1 - .85 * O2.spd), dz = -M2[6]; const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
        if(n){ cx += dx * seg; cy += dy * seg; cz += dz * seg; }
        let ux = M2[1], uy = -M2[4], uz = M2[7], bx = dy * uz - dz * uy, by = dz * ux - dx * uz, bz = dx * uy - dy * ux; const bl = Math.hypot(bx, by, bz) || 1; bx /= bl; by /= bl; bz /= bl;
        const s = 1 + r * Math.min(.3, K.tl), wv = w0 - L * amp * Math.min(.105, .015 - .07 * s + .135 * s * s) * Math.sin(bp - 6.28 * (1 + r * K.tl));   /* 0.1 at the tip of a short tail: a sweep of a fifth of a body length */      /* the swim wave runs on into the fin (measured from the tail root; this axis points to the fish's other side) */
        CH[qo] = cx + bx * wv; CH[qo + 1] = cy + by * wv; CH[qo + 2] = cz + bz * wv; CH[qo + 3] = ux; CH[qo + 4] = uy; CH[qo + 5] = uz; CH[qo + 6] = bx; CH[qo + 7] = by; CH[qo + 8] = bz; }
      const open = 1 - .35 * o.spd, wid = r => (hr + r * TL * K.tv) * (r < .15 ? 1 : 1 - (1 - open) * (r - .15) / .85);
      const wmax = hr + TL * K.tv, na = Math.max(2, Math.ceil(2 * wmax * kk)), nr = Math.max(4, Math.ceil(TL * kk)), nR = rays(2 * wmax * kc);
      for(let j = 0; j <= nr; j++){ const r = j / nr, fq = r * KC, n0 = Math.min(KC - 1, fq | 0), u = fq - n0, qo = n0 * 9, w = wid(r), wc = w * kc;
        const X_ = CH[qo] + (CH[qo + 9] - CH[qo]) * u, Y_ = CH[qo + 1] + (CH[qo + 10] - CH[qo + 1]) * u, Z_ = CH[qo + 2] + (CH[qo + 11] - CH[qo + 2]) * u;
        const ux = CH[qo + 3] + (CH[qo + 12] - CH[qo + 3]) * u, uy = CH[qo + 4] + (CH[qo + 13] - CH[qo + 4]) * u, uz = CH[qo + 5] + (CH[qo + 14] - CH[qo + 5]) * u;
        const fold = .8 + .3 * Math.cos(bp - 6.28 * (1 + r * K.tl) + 1);
        for(let i = 0; i <= na; i++){ const a2 = i / na * 2 - 1, aa = Math.abs(a2), rm = 1 - K.notch * Math.pow(1 - aa, 1.6) - .05 * (a2 > 0 ? a2 : 0); if(r > rm) continue;      /* a rounded fork; the lower lobe a little longer */
          const d_ = a2 * w; projW(X_ + ux * d_, Y_ + uy * d_, Z_ + uz * d_);
          veil(rayAt(a2 * .5 + .5, 2 * wc, nR), EDGE || (rm - r) * TL * kc < 1, r, true);
          mem(Math.min(1, QO.b * gain * fold * (r < .12 ? 1.2 : 1)), QO.c, QO.a, sid0 + 1, id, QO.d); } } }
    /* dorsal: a long base from the highest point of the back, tallest in front and sloping away behind; it lowers and sweeps back at speed */
    const dh = K.dh * L * (1 - .4 * o.spd), dlen = (K.d1 - K.d0) * L * kc, dnr = rays(dlen * 1.2);
    sheet(sid0 + 4, (K.d1 - K.d0) * L * kk * 1.2, dh * kk * 1.3, (a, r) => {
      const s = K.d0 + (K.d1 - K.d0) * a, h = Math.min(1, a * 6) * Math.pow(1 - a, .55) * 1.1;
      if(r > h){ QO.b = -1; return; }
      QO.x = L * (.42 - s) - r * dh * (.45 + .7 * o.spd); QO.y = rad(K, s) * K.H * L * .9 + r * dh; QO.z = zb(s) + .06 * L * r * r * Math.sin(bp * .6 - a * 2);
      const ry = rayAt(a, dlen, dnr); if(h - r < 1.1 / Math.max(1.2, dh * kc)) veil(1, true, r * .7); else veil(ry, false, r * .7); });
    if(far) return;
    /* paired fins (pectorals low behind the gill cover, pelvics under the belly) and the anal fin: narrow fans from a root on the body. The
       pectorals scull, one after the other, while the fish holds station, and every fin folds flat against the body in a burst */
    const fan = (sid, s, yr, zr, d, e, len, w, ph) => { const r0 = rad(K, s), bx = L * (.42 - s), by = yr * r0 * K.H * L, bz = zr * r0 * K.W * L + zb(s);
      d = nrm([d[0] - 1.1 * o.spd, d[1] * (1 - .55 * o.spd), d[2] * (1 - .6 * o.spd)]);
      const fnr = rays((w + len * .5) * kc * 1.2);
      sheet(sid, (w + len * .5) * kk, len * kk, (a, r) => {
        const a2 = a * 2 - 1, lim = Math.sqrt(Math.max(0, 1 - .7 * a2 * a2)) - .1 * Math.max(0, -a2);
        if(r > lim){ QO.b = -1; return; }
        const sw = (w + r * len * .5) * a2 * .5, fl = .1 * len * r * r * Math.sin(bp * .8 + ph - r * 2);
        QO.x = bx + d[0] * r * len + e[0] * sw; QO.y = by + d[1] * r * len + e[1] * sw - fl * .5; QO.z = bz + d[2] * r * len + e[2] * sw + fl;
        veil(rayAt(a, (w + r * len * .5) * kc, fnr), false, r * .8); }); };
    for(const sd of [-1, 1]){ const ro = o.hov * .55 * Math.sin(tm * TAU * 1.5 + f.qo + sd * 1.57);                                    /* sculling */
      fan(sid0 + 5 + (sd > 0), K.gs + .03, -.6, .85 * sd, nrm([-.55, -.55 - .25 * ro, sd * (.6 + .35 * ro)]), [.7, -.7, 0], K.pf * L, .04 * L, sd);
      fan(sid0 + 7 + (sd > 0), .5, -.92, .3 * sd, nrm([-.6, -.76, sd * .25]), [1, 0, 0], K.pv * L, .04 * L, sd + 2); }
    fan(sid0 + 9, .76, -.9, 0, nrm([-.68, -.73, 0]), [1, 0, 0], K.af * L, .06 * L, 4);
  }
  /* write the buffer onto the fish layer: a dark seam where a nearer fish's edge lies over a farther one; body cells (lit or dark) are also cut out
     of the background so nothing shows through a body. Before that, every bright cell spills a little light into the empty cells one and two
     steps beside it: the soft fringe that stands in for a hard outline */
  const glow = [], DX = [-1, 1, 0, 0], DY = [0, 0, -1, 1];
  function stamp(){
    const yc = TOP - 1;                                                                 /* never above the band inside the content column (caption line; on a phone the column is the whole width) */
    for(let x = x0; x <= x1; x++) for(let y = y0; y <= y1; y++){ const b = ZB[x * rows + y]; if(b < .5) continue;
      for(let n = 0; 8 > n; n++){ const d = n < 4 ? 1 : 2, nx = x + DX[n & 3] * d, ny = y + DY[n & 3] * d; if(nx < 0 || ny < 0 || nx >= cols || ny >= rows || ZZ[nx * rows + ny] > -1e8) continue;
        glow.push(nx, ny, b * (d === 1 ? .26 : .12), ZC[x * rows + y]); } }
    for(let x = x0; x <= x1; x++) for(let y = y0; y <= y1; y++){ const k = x * rows + y, z = ZZ[k], o = ZO[k];
      if(y < yc && x >= mg - 1 && x <= cols - mg){ ZZ[k] = -1e9; ZB[k] = 0; ZO[k] = 0; ZM[k] = 0; ZD[k] = 9; continue; }
      let gap = false;
      for(let n = 0; n < 4 && !gap; n++){ const qo = k + (n === 0 ? -rows : n === 1 ? rows : n === 2 ? -1 : 1); if(qo >= 0 && qo < N && ZO[qo] > 0 && ZO[qo] !== Math.abs(o) && ZZ[qo] > z + 3 * U) gap = true; }
      if(z > -1e8 && !gap){ FL.set(x, y, ZB[k] > 0 ? Math.max(0, ZB[k] + (o > 0 ? 0 : dith(x, y))) : 0, ZC[k]); if(o > 0 && !MK[k]){ MK[k] = 1; mk.push(k); } }
      else if(gap){ FL.set(x, y, 0, 0); if(!MK[k]){ MK[k] = 1; mk.push(k); } }
      ZZ[k] = -1e9; ZB[k] = 0; ZO[k] = 0; ZM[k] = 0; ZD[k] = 9; }
    for(let i = 0; i < glow.length; i += 4){ const x = glow[i], y = glow[i + 1]; if(!(y < yc && x >= mg - 1 && x <= cols - mg) && !MK[x * rows + y]) FL.put(x, y, glow[i + 2], glow[i + 3]); }
    glow.length = 0; x0 = cols; x1 = -1; y0 = rows; y1 = -1; }
  const cutCell = qo => { if(qo >= 0 && qo < N && !MK[qo]){ MK[qo] = 1; mk.push(qo); } };
  function blade(L, w, base, tm, cut){ const n = Math.ceil(w.h), ph = TAU * tm / (13 / sp) + w.ph;
    for(let k = 0; k <= n; k++){ const f = k / n; let x = w.x + w.lean * f + (2 * w.am * Math.sin(f * 5.2 + w.ph * 3 - ph * .5) + sway * Math.min(w.h, 60 * U) * .07 * Math.sin(ph - f * 1.7) * f) * Math.min(1, f * 3);
      if(w.lo !== undefined) x = Math.max(w.lo, Math.min(w.hi, x));   /* margin kelp stays in the margin beside the content column */
      const hw = (1.8 * w.am * (.55 + .45 * Math.sin(f * 9 + w.ph) ** 2) + .3 * U) * Math.min(1, (1 - f) * 5 + .25), y = Math.round(base - k);
      for(let c = Math.floor(x - hw - 1.5); c <= x + hw + 1.5; c++){ const d = (c + .5 - x) / hw;
        if(d >= -1 && d <= 1){ L.set(c, y, w.g * ((Math.abs(d) < .3 ? .6 : d < 0 ? .45 : .2) * (1 - .3 * f) + .04), w.c); if(cut) cutCell(Math.round(c) * rows + y); }
        else if(cut) L.set(c, y, 0, 0); } } }
  /* ---- plants. Blade-leaved plants (broad ribbons, lit down the middle): tall ones in the side margins, lower ones at the back, one clump
     in front of the fish. Stem plants: a stem with a whorl of narrow leaves every few cells, the leaves reaching up and out and shorter toward
     the tip. All sway with a wave that travels up the plant; cache misses make it stronger. Grass on the sand ---- */
  function stem(w, tm){ const n = Math.ceil(w.h), ph = TAU * tm / (11 / sp) + w.ph, base = at(w.x), gap = Math.max(2, Math.round(2.6 * U));
    for(let k = 0; k <= n; k++){ const f = k / n, x = w.x + w.lean * f * f + sway * w.h * .06 * Math.sin(ph - f * 2.4) * f, y = base - k;
      BL.put(x, y, w.g * (.4 + .2 * f), w.c);
      if(k % gap === 0 && k > 0){ const ll = w.ll * (1 - .55 * f) * (.8 + .2 * Math.sin(ph * .7 + k)); for(const sd of [-1, 1]) for(let qo = 1; qo <= ll; qo++){ const u = qo / ll;
        BL.put(x + sd * qo, y - qo * (.55 + .25 * Math.sin(ph - f * 2.4 + sd)) , w.g * (.75 - .3 * u) * (sd < 0 ? 1.15 : .8), u > .45 ? LEAF : w.c); } } } }
  const kelp = [], grass = [], stems = [], rocks = [], bush = [], KH = rows * (phone ? .42 : .66), clear = x => !phone && x > cols * .46 && x < cols * .8;   /* clear: the water behind the big fish */
  const kx = phone ? [cols * .02, cols * .98] : mg > 8 * U ? [mg * .2, mg * .45, cols - mg * .45, cols - mg * .2] : [cols * .03, cols * .97];
  kx.forEach((x, i) => { const L_ = i < kx.length / 2; kelp.push({x, h: KH * (.7 + .3 * S()), lean: (L_ ? -1 : 1) * (1 + 2 * S()) * U, ph: S() * TAU, g: .55 + .2 * S(), am: (phone ? .7 : 1) * U, c: i % 3 === 1 ? WEEDR : WEED,
    lo: phone || mg <= 8 * U ? undefined : L_ ? -9 : cols - mg + 4.5 * U, hi: L_ ? mg - 4.5 * U : cols + 9}); });
  if(!phone) for(let x = cols * (.08 + .04 * S()); x < cols * .95; x += cols * (.075 + .07 * S())){ const cl = clear(x);
    if(S() < .5 && !cl) kelp.push({x, h: band * (.35 + .35 * S()), lean: (S() - .5) * 6 * U, ph: S() * TAU, g: .36 + .14 * S(), am: .8 * U, c: WEED});
    else { const n = cl ? 2 : 3 + (S() * 2 | 0), c = S() < .3 ? WEEDR : WEED; for(let k = 0; k < n; k++) stems.push({x: x + (k - n / 2) * 3.4 * U, h: band * (cl ? .16 + .1 * S() : .34 + .4 * S()), lean: (S() - .5) * 7 * U, ph: S() * TAU, g: (cl ? .6 : .78) + .2 * S(), ll: (3 + 2.5 * S()) * U, c}); } }
  else for(const x of [cols * .18, cols * .8]) for(let k = 0; k < 2; k++) stems.push({x: x + k * 3.4 * U, h: band * (.3 + .2 * S()), lean: (S() - .5) * 5 * U, ph: S() * TAU, g: .6, ll: (2.5 + 1.5 * S()) * U, c: WEED});
  const front = {x: cols * (phone ? .05 : .31 + .04 * p.tilt), h: band * (phone ? .5 : .74), lean: 4 * U, ph: 1.3, g: .8, am: (phone ? .8 : 1.15) * U, c: WEED};
  for(let x = S() * 12 * U; x < cols; x += ((phone ? 16 : 9) + S() * 30) * U){ const n = 3 + (S() * 3 | 0), l = (S() - .5) * 6, c = S() < .3 ? WEEDR : WEED; for(let k = 0; k < n; k++) grass.push({x: x + k * 1.7 * U, h: (2 + S() * 5) * U, lean: (l + k - 1) * U, ph: S() * TAU, c}); }
  /* stones (the first two are the air stones) and far plant masses at the back, cooled and dimmed by the water between */
  rocks.push({x: cols * (phone ? .12 : .12 + .02 * p.off), w: (phone ? 4 : 6) * U}, {x: cols * (phone ? .87 : .9 - .02 * p.tilt), w: (phone ? 4 : 7) * U}, {x: cols * (.47 + .04 * p.off), w: (phone ? 3 : 5) * U}, {x: cols * .7, w: (phone ? 2 : 3.5) * U}, {x: cols * .255, w: 3 * U});
  for(let i = 0, n = phone ? 4 : 11; i < n; i++){ const x = (i + .5 * S()) / n * cols; bush.push({x, w: band * (.1 + .14 * S()), h: band * (.14 + .24 * S()) * (clear(x) ? .55 : phone && Math.abs(x / cols - .52) < .3 ? .45 : 1), c: S() < .6 ? FAR : FARB, br: S() < .5}); }
  const motes = Array.from({length: phone ? 24 : 70}, () => ({x: S(), y: S(), z: .3 + .7 * S(), w: S() * TAU}));
  /* bubbles: two chains that rise from the air stones, slowly at first and faster as they go up, and wobble up a winding path in lanes; each
     loops, so every one is always in view, and the lanes keep them apart so none share a cell (the caption counts them) */
  const NB = Math.round(D.nPart * .08), ston = [0, 1].map(s => { const n = (NB >> 1) + (s && NB & 1 ? 1 : 0), y0 = at(rocks[s].x) - rocks[s].w * .55, top = TOP + 2 * U, Hb = y0 - top;
    const gap = Math.max(2.3, 2.4 * U), slots = Math.max(1, Math.floor(Hb / gap)), m = Math.max(1, Math.ceil(n / slots));
    return {n, x: rocks[s].x, y0, Hb, m, lw: Math.max(2, (phone ? 2 : 2.6) * U)}; });
  /* ---- slow layers (ten times a second, kept in an offscreen canvas): light shafts, haze and specks; far plants, sand, stones, plants, shadows ---- */
  const P0 = {};
  const tick = ticker(.1, tm => { RL.clear(); BL.clear(); ct = tm * .05 * sp;
    beams.forEach((b, i) => { bs[i] = b.s + 7 * U * Math.sin(tm * .05 * sp + b.ph); ba[i] = .5 + .5 * Math.sin(tm * .08 * sp + b.ph * 2.3); });
    for(let qo = 0; qo <= SN + 1; qo++){ let v = 0; for(let i = 0; i < bs.length; i++){ const d = (qo / 2 - bs[i]) / beams[i].w; if(d > -2.5 && d < 2.5) v += ba[i] * Math.exp(-d * d); } ST[qo] = v; }
    const sh = fish.filter(f => f.t).map(f => { pose(f, tm, P0); const hgt = Math.max(0, FLOOR - P0.sy); return [P0.sx + hgt * .2, f.L * P0.k * .5, .75 * Math.exp(-hgt / (rows * .3)) * (f.t > 1 ? 1 : .6)]; });   /* soft shadows on the sand, almost straight below */
    for(let c = 0; c < cols; c++){ const open = phone || c < mg - 1 || c > cols - mg, fl = dune[c];
      let far = fl, cc = 0, cd = 0, cb = false; for(const k of bush){ const d = (c - k.x) / k.w; if(d > -1 && d < 1){ const t = fl - k.h * Math.sqrt(1 - d * d) * (k.br ? .45 + .55 * Math.pow(Math.abs(Math.cos(c * .8 / U + k.x)), .5) : 1 + .12 * Math.sin(c * 1.7 / U + k.x)); if(t < far){ far = t; cc = k.c; cd = d; cb = k.br; } } }
      for(let y = open ? 0 : TOP - 1; y < fl; y++){ const lit = shaft(c, y);
        const b = Math.min(.6, Math.max(0, lit - .3) * 1.1) * (1 - .3 * y / FLOOR) * (phone ? (y < TOP - 1 ? 0 : sstep(0, TOP + 5 * U, y)) * (1 - .85 * sstep(.3, .12, Math.abs(c / cols - .52))) : open ? 1 : sstep(TOP - 1, TOP + 7 * U, y)) * (.75 + .25 * hash2(c, y));
        if(b > .05) RL.put(c, y, b, SHAFT);                                       /* on a phone the caption lies over the rows above the open band: no shaft there */
        const hz = sstep(FLOOR - band * .5, FLOOR + 2 * U, y) * (open || y > TOP + 3 * U ? 1 : 0); if(hz > .05 && (c + y & 1) && b < .1) RL.put(c, y, .1 + .14 * hz * hash2(c, y + 7) * .7, HAZE);   /* teal haze at the back */
        if(y >= far){ const e = (y - far) / U, lum = clamp01(.55 - .5 * cd + (e < 2 ? .4 : 0) - .015 * e), pol = hash2((c / U) >> (cb ? 0 : 1), (y / U) >> 1) > .45 ? 1 : .55;
          BL.put(c, y, (.09 + .26 * lum * pol) * (1 + .6 * lit), cc); } } }
    for(const m of motes){ const x = ((m.x + tm * .0016 * m.z * sp) % 1) * cols, y = TOP + ((m.y + .01 * Math.sin(tm * .13 + m.w)) % 1) * band; RL.put(x + 2 * U * Math.sin(tm * .2 + m.w), y, (.14 + .16 * m.z) * (1 + shaft(x, y)), PAPER); }
    /* sand: grain, ripples, pools of light under the shafts, the net of light and each fish's soft shadow */
    for(let c = 0; c < cols; c++){ let dark = 1; for(const s of sh){ const d = (c - s[0]) / s[1]; dark *= 1 - s[2] * Math.exp(-d * d); }
      const fl = dune[c], pool = .55 + .9 * shaft(c, fl);
      for(let y = Math.ceil(fl); y < rows; y++){ const e = (y - fl) / U, dep = (y - fl) / (rows - FLOOR), cz = caus(c / U, FLOOR / U + e * 2.2) * dark * (.5 + pool), h = hash2(c, y);
        const b = (e < 1 ? .2 : .05 + .06 * h + .035 * Math.sin(c * .5 / U + e * 1.9 + 3 * noise(c * .05 / U, e * .3)) + (h > .96 ? .1 : 0)) * (1 - .4 * dep) * pool * (.25 + .75 * dark) + .55 * cz * (1 - .5 * dep);
        BL.put(c, y, Math.min(.5, b) * (phone ? .75 : 1), cz > .16 ? SHAFT : SAND); } }
    for(const g of grass){ const n = Math.ceil(g.h), base = at(g.x);
      for(let k = 1; k <= n; k++){ const f = k / n; BL.put(g.x + g.lean * f * f + sway * 1.1 * U * Math.sin(TAU * tm / (7 / sp) + g.ph - f) * f, base - k, .16 + .2 * (1 - f), g.c); } }
    for(const w of stems) stem(w, tm);
    for(const w of kelp) blade(BL, w, at(w.x), tm, false);
    for(const r of rocks){ const w = r.w, h = w * .62, base = at(r.x) + 1.5 * U;     /* stones: half ellipsoids lit from above, speckled, the net of light on top */
      for(let c = Math.floor(r.x - w); c <= r.x + w; c++) for(let y = Math.floor(base - h); y <= base; y++){ const nx = (c + .5 - r.x) / w, ny = (y + .5 - base) / h, qo = nx * nx + ny * ny; if(qo >= 1) continue;
        const nz = Math.sqrt(1 - qo), lum = Math.max(0, -.28 * nx - .86 * ny + .42 * nz), cz = caus(c * 1.3 / U, y * 2 / U) * Math.max(0, -ny);
        BL.set(c, y, (.06 + .5 * lum * lum) * (.75 + .25 * hash2(c, y * 3)) + .5 * cz, cz > .16 || lum > .8 ? PAPER : SAND); } }
    const x = off.begin(); RL.draw(x, .9, false, PX < 5 ? 'sq' : 'br'); BL.draw(x, .95, false, 'dot'); });
  const poses = fish.map(() => ({})), bl = [];
  return tm => {
    tick(tm); FL.clear();
    fish.forEach((f, i) => pose(f, tm, poses[i]));
    const ord = fish.map((_, i) => i).sort((a, b) => poses[a].Z - poses[b].Z);
    for(const i of ord) render(fish[i], poses[i], tm);
    stamp();
    blade(FL, front, at(front.x) + 1, tm, true);
    /* bubbles: pass 1 clears a dark cell round each, pass 2 draws them; amber or blue by split, the upper ones with a pale glint */
    bl.length = 0;
    ston.forEach((s, si) => { for(let i = 0; i < s.n; i++){ const j = i % s.m, qo = (i / s.m) | 0, cnt = Math.ceil((s.n - j) / s.m), u = ((tm * sp * 2.4 * U / s.Hb + qo / cnt + j * .37 + si * .21) % 1 + 1) % 1;
      const y = s.y0 - s.Hb * (.45 * u + .55 * u * u), x = s.x + (j - (s.m - 1) / 2) * s.lw * (1 + .25 * u) + U * ((.4 + 1.2 * u) * Math.sin(y * .3 / U + si * 2 + tm * .25) + (phone ? 0 : .5) * Math.sin(y * .7 / U + j * 2.3)), c = hash2(si * 977 + i, p.seed) > D.share ? 1 : 0;
      bl.push([Math.round(x), Math.round(y), u, c]); } });
    for(const [x, y] of bl) for(let dx = -1; dx <= 1; dx++) for(let dy = -1; dy <= 1; dy++){ const X_ = x + dx, k = X_ * rows + y + dy; if(X_ < 0 || X_ >= cols || y + dy < 0 || y + dy >= rows) continue; if(MK[k] || !dx && !dy){ FL.gb[k] = 0; cutCell(k); } }
    for(const [x, y, u, c] of bl) if(u > .55) FL.set(x - 1, y - 1, .2 + .4 * u, c ? GL : KL);            /* glints first, so no glint covers a bubble */
    for(const [x, y, u, c] of bl) FL.set(x, y, .42 + .56 * u, c);
    off.blit();
    if(mk.length){ ax.save(); ax.globalCompositeOperation = 'destination-out'; ax.fillStyle = '#000'; ax.beginPath();   /* an opaque fill, set here: the cut must not take its strength from whatever colour the frame before left on the context */
      for(const k of mk){ ax.rect(((k / rows) | 0) * PX, (k % rows) * PX, PX, PX); MK[k] = 0; } ax.fill(); ax.restore(); mk.length = 0; }
    FL.draw(ax, .95, true, 'dot');
  };
}
/* 12 whale.
   Adapted from ascii.rest piece 'whale' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: the sequence (the whale comes up, blows, rolls its back over, arches and lifts its fluke clear before it slips under),
   the blow itself (a column that opens into a bushy head, lets go from the bottom, hangs, thins and drifts downwind; same formula), water
   streaming off the fluke's trailing edge, the smooth patch left where it went down, and a calm surface with the odd crest over faint swells.
   Rebuilt to read like split-level footage of a humpback and her calf, not like a drawing of one. The waterline crosses the upper part of the
   open band; a thin strip of dusk sky and far sea lies above it, the water column below.
   Anatomy, measured on photographs of Megaptera novaeangliae (a side-view plate for the outline, eye, mouth line, flipper root and dorsal fin;
   an underwater side view of a mother and calf for depth against length, the calf's size and place and the light; an underwater close view
   for the flipper; a fluke seen from below for its planform and pattern). In body lengths (snout to fluke notch): greatest depth 0.20 at
   0.45 to 0.6 of the length, a flat head wider than it is deep, a tail stock 0.03 deep and narrower still; the mouth line runs back
   high on the head and drops under the eye at 0.24; knobs (tubercles) in rows on the upper jaw and along the lower lip; throat pleats from
   the chin to mid-body; flippers 0.30 long from low on the side at 0.37, a long narrow blade with a scalloped leading edge, pale with dark
   mottling above; a small dorsal fin on a hump at 0.70 with knuckles behind it down the tail stock; a fluke 0.31 across, swept, notched, its
   trailing edge ragged, dark above and white below with a black border and middle line. The calf is 0.42 of her length and keeps beside her
   rear flank, a little toward the camera.
   Each whale is a 3D model rendered through a z-buffer every frame. Under water the light comes from above: a lit back with a moving net of
   light when she is shallow, a shaded flank, a belly in shadow (the pale skin there only just shows: countershading), everything fading
   toward the colour of the water with distance. Above the water the skin is wet and dark with glints.
   Motion, from how humpbacks swim: the fluke beats up and down as a wave that grows toward the tail (the fluke sweeps about a fifth of a body
   length, the head a fiftieth), about one beat in four seconds at cruising pace, the calf's faster; she strokes on the way up and glides on
   the way down; the fluke blade trails each stroke; the flippers are held out and trimmed slowly, swept back in a dive. One cycle (40 s): she
   comes up from the far deep toward the camera, passes close under the surface (the static frame, tm = 14), breaks the surface and blows,
   rolls her back over (the dorsal fin shows), arches the tail stock, lifts the fluke clear and slips under, then goes down and away into the
   haze and turns back. The events are timed as in footage at the middle pace (the whole clock runs 0.7 to 1.36 times that, by date and trend); the minutes a real dive lasts are cut to seconds. The calf comes up with her,
   stays near the surface while she is down, breathes more often, and falls in beside her again.
   So that a gliding whale does not shimmer all over, each whale is drawn on the cell grid as a whole (its place is rounded to whole cells) and
   its markings are fixed to the body, so cells change at its edges, where it bends, and where the light net crosses it.
   Data: glints on the far water = tokens (each one is always lit, and flares), their colour = split (the exact UI blue and amber); pace of the
   cycle = 7-day trend (15 percent either way); surface chop = cache miss. The whales, the light, the water and the sky carry no data. */
function tWhale(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, PX = env.P, N = cols * rows, U = 5 / PX, vel = p.speed * (.85 + .3 * D.trendK), chop = .5 + .8 * clamp01(D.jitter * .5);
  /* palette: 0 / 1 the data colours (glints only); 2 deep water; 3-5 dark skin in shadow, in half light, lit; 6-7 pale skin lit and in half light;
     8 water near the surface; 9 light (shafts, the net of light, the skin of the water); 10 wet skin above the water; 11-14 the dusk sky; 15 spray; 16 stars */
  const PW = [BLUE, OR, [48, 62, 112], [64, 94, 140], [96, 142, 168], [154, 202, 208], [224, 238, 230], [150, 188, 204], [56, 124, 150], [122, 206, 214], [92, 106, 128], [240, 186, 146], [214, 128, 134], [120, 104, 176], [66, 70, 128], [242, 236, 218], [214, 222, 240]];
  const DP = 2, SH = 3, MID = 4, LIT = 5, PALE = 6, PMID = 7, SEAC = 8, CYAN = 9, STEEL = 10, PEACH = 11, ROSE = 12, VIO = 13, IND = 14, PAPER = 15, STAR = 16;
  const RL = new Layer(cols, rows, PW, PX), FL = new Layer(cols, rows, PW, PX), PL = new Layer(cols, rows, PW, PX), off = offscreen(env), S = mulberry(mix(p.seed + 12));
  const TOP = phone ? Math.round(10 * U) : Math.round(rows * .48), BOT = rows - (phone ? Math.round(12 * U) : 0), STRIP = Math.round((phone ? 12 : 15) * U);   /* TOP..BOT: the part of the canvas the page leaves open */
  const SEA = TOP + STRIP, HZ = SEA - Math.round(STRIP * .4), DEEP = BOT - SEA, MG = phone ? 0 : Math.max(0, Math.floor((env.W - 1240) / 2 / PX)), inCol = c => c >= MG && c < cols - MG;
  const WL = Math.min(cols * (phone ? .84 : .36), DEEP * 2.3, 150 * U), F = WL * 3.2, X0 = cols * (phone ? .46 : .57 + .02 * p.off), T = 40, CAM = .07 * WL * vel, st = .62;
  /* on a canvas too short for a water column the whales are left out: only the sky, the sea and the waterline are drawn. pos(): a loop step that is
     always positive, whatever the geometry (a share of a length: at least a thousandth; in cells: at least a quarter cell) */
  const LIVE = DEEP >= 14 && WL >= 20 && cols >= 40, pos = v => v > 1e-3 ? v : 1e-3;
  const SUNX = cols * (phone ? .25 : .16 + .08 * S()), yw = new Float32Array(cols), wrap = (v, m) => ((v % m) + m) % m;
  /* ---- the body's outline, hand-measured stations along the length (0 snout .. 1 notch): radius above the axis, below it, half width ---- */
  const PS = [0, .012, .03, .08, .14, .2, .26, .32, .4, .5, .58, .66, .72, .78, .84, .9, .94, .97, 1], PTv = [.005, .02, .034, .052, .066, .076, .082, .086, .09, .094, .096, .096, .086, .06, .04, .024, .014, .012, .01],
    PBv = [.005, .014, .022, .034, .048, .062, .076, .088, .098, .102, .1, .09, .078, .06, .044, .032, .02, .013, .01], PWv = [.006, .024, .04, .062, .078, .09, .097, .101, .104, .104, .1, .088, .07, .048, .03, .018, .012, .01, .008];
  const NP = 240, RT = new Float32Array(NP + 2), RB = new Float32Array(NP + 2), RW = new Float32Array(NP + 2);
  for(let i = 0, j = 0; i <= NP + 1; i++){ const s = Math.min(1, i / NP); while(j < PS.length - 2 && PS[j + 1] <= s) j++; const u = smooth((s - PS[j]) / (PS[j + 1] - PS[j]));
    RT[i] = PTv[j] + (PTv[j + 1] - PTv[j]) * u + .007 * Math.exp(-(((s - .175) / .02) ** 2)) + .006 * Math.exp(-(((s - .7) / .03) ** 2)) + (s > .76 && s < .94 ? .0035 * Math.max(0, Math.sin((s - .76) * TAU / .045)) : 0);   /* blowhole guard, hump, knuckles */
    RB[i] = PBv[j] + (PBv[j + 1] - PBv[j]) * u; RW[i] = PWv[j] + (PWv[j + 1] - PWv[j]) * u; }
  /* ---- the cycle. Columns: time (s; 0 = the static frame), depth of the body's middle below the surface (body lengths), pitch (+ = head up),
     arch of the back, extra bend of the tail stock (+ = down), yaw (+ = head toward us), roll (+ = back toward us), nearness (body lengths),
     shift along the screen, strength of the tail beat, sweep of the flippers ---- */
  const KF = [[-8, .4, .1, 0, 0, .5, .1, -1.5, .3, 1, .5], [-4, .29, .12, 0, 0, .42, .12, -.55, .14, 1, .5], [-1.2, .185, .08, .02, 0, .27, .14, -.02, .01, 0, .4], [0, .165, .07, .03, 0, .26, .14, 0, 0, 0, .35],
    [1, .092, .04, .06, 0, .16, .12, .03, -.01, 0, .2], [2.2, .074, -.05, .28, 0, 0, .1, .02, -.02, 0, .15], [3.6, .08, -.2, .55, 0, -.42, .08, -.03, -.03, 0, .2], [5, .14, -.5, .85, .25, -.85, .05, -.12, -.04, 0, .5],
    [6.2, .3, -.8, .25, -.45, -1.15, 0, -.25, -.05, 0, .8], [7.3, .53, -1, 0, -.2, -1.2, 0, -.4, -.06, 0, .9], [9.5, .66, -.75, 0, 0, -1.1, 0, -.9, -.1, 0, .9], [13, .64, -.25, 0, 0, -.9, -.05, -1.7, -.16, 0, .7],
    [19, .56, -.02, 0, 0, -.4, -.08, -2.4, -.05, .6, .5], [25, .5, .06, 0, 0, .2, 0, -2.3, .2, 1, .5], [32, .4, .1, 0, 0, .5, .1, -1.5, .3, 1, .5]], NK = KF.length;
  const key = (t, j) => { let i = 0; while(i < NK - 2 && KF[i + 1][0] <= t) i++;                                             /* Hermite through the keys, so nothing stops dead */
    const a = KF[i], b = KF[i + 1], qo = KF[i ? i - 1 : NK - 2], r = KF[i + 2 < NK ? i + 2 : 1], dt = b[0] - a[0], u = (t - a[0]) / dt, u2 = u * u, u3 = u2 * u;
    const m1 = (b[j] - qo[j]) / (b[0] - (i ? qo[0] : qo[0] - T)), m2 = (r[j] - a[j]) / ((i + 2 < NK ? r[0] : r[0] + T) - a[0]);
    return (2 * u3 - 3 * u2 + 1) * a[j] + (u3 - 2 * u2 + u) * dt * m1 + (3 * u2 - 2 * u3) * b[j] + (u3 - u2) * dt * m2; };
  const tau = tm => wrap((tm - 14) * vel + 8, T) - 8;
  const BLOW = 1, DOWN = 7.3;                                                                       /* when she blows, when the fluke is under */
  /* her pose at time tm */
  function momPose(tm, o){ const t = tau(tm); o.t = t; o.dep = Math.max(.07, key(t, 1)); o.pitch = key(t, 2); o.arch = key(t, 3); o.lift = key(t, 4); o.yaw = key(t, 5) + .04 * p.tilt; o.roll = key(t, 6) + .08;
    o.zc = key(t, 7) * WL; o.kc = F / (F - o.zc); o.cx = X0 + key(t, 8) * WL * (phone ? .35 : 1); o.cy = SEA + o.dep * WL * o.kc; o.amp = clamp01(key(t, 9)); o.swp = key(t, 10); o.psi = TAU * .24 * (tm - 14) * vel + 1.2; return o; }
  /* the calf: beside her rear flank while she is near the surface; on its own near the surface while she is down, coming up to breathe */
  const CB = [2.4, 13.5, 24.5], MP = {};
  function calfPose(tm, o){ momPose(tm - .3, MP); const t = tau(tm), w = t < 2 ? sstep(-6.5, -2.5, t) : 1 - sstep(2.6, 5.6, t), cy_ = Math.cos(MP.yaw), sy_ = Math.sin(MP.yaw);
    let br = 0; for(const b of CB){ const d = (t - b) / 1.3; br = Math.max(br, Math.exp(-d * d)); }
    const lx = X0 - WL * (phone ? .12 : .3) + WL * .05 * Math.sin(tm * .17), ld = .085 - .045 * br + .012 * Math.sin(tm * .4), lz = .12 * WL;
    const sxp = MP.cx + (.2 * cy_ + .2 * sy_) * WL * MP.kc, szp = MP.zc + (-.2 * sy_ + .2 * cy_) * WL, sdp = Math.max(.05 - .012 * br, MP.dep + .05 - .1 * br);
    o.t = t; o.zc = lz + (szp - lz) * w; o.kc = F / (F - o.zc); o.cx = lx + (sxp - lx) * w; o.dep = ld + (sdp - ld) * w; o.cy = SEA + o.dep * WL * o.kc;
    o.pitch = MP.pitch * w * .6 + .1 * br + .05 * Math.sin(tm * .33 + 1); o.arch = MP.arch * w * .5 + .12 * br; o.lift = 0; o.yaw = MP.yaw * w + (1 - w) * (.2 + .3 * Math.sin(tm * .19 + 2)); o.roll = .2 + .12 * w + (1 - w) * .25 * Math.sin(tm * .23);
    o.amp = (.15 + .65 * sstep(-.1, .5, Math.sin(tm * .55 + 1))) * (1 - .7 * br); o.swp = .3 + .4 * w * MP.swp; o.psi = TAU * .39 * (tm - 14) * vel; o.br = br; return o; }
  const mom = {id: 1, L: WL, qo: 0, gain: phone ? 1.2 : 1.08}, calf = {id: 2, L: WL * .42, qo: 5, gain: phone ? 1.3 : 1.15, pale: .3};
  /* ---- the buffer the whales are rendered into (the method of piece 11): of the samples of one surface that fall in a cell the one nearest
     the cell's centre is kept, so the shade is read at the same spot of every cell and moves with the body ---- */
  const ZZ = new Float32Array(N).fill(-1e9), ZB = new Float32Array(N), ZC = new Uint8Array(N), ZO = new Uint8Array(N), ZD = new Float32Array(N).fill(9), MK = new Uint8Array(N), mk = [];
  let x0 = cols, x1 = -1, y0 = rows, y1 = -1, sx = 0, sy = 0, sz = 0, NX = 0, NY = 0, NZ = 0, NV = 0;
  const op = (b, c, o) => { const x = Math.round(sx), y = Math.round(sy); if(x < 0 || y < 0 || x >= cols || y >= rows) return; if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y;
    const k = x * rows + y, fx = sx - x, fy = sy - y, d = fx * fx + fy * fy, same = ZO[k] === o && sz > ZZ[k] - 2.5 * U;
    if(same ? d < ZD[k] : sz > ZZ[k]){ ZZ[k] = same ? Math.max(sz, ZZ[k]) : sz; ZB[k] = b; ZC[k] = c; ZO[k] = o; ZD[k] = d; } };
  /* rotation: local (x toward the tail, y up, z toward the whale's near side) -> world (x right, y up, z toward us), then a camera that looks a little down */
  let m0 = 1, m1 = 0, m2 = 0, m4 = 1, m5 = 0, m6 = 0, m7 = 0, m8 = 1, OX = 0, OY = 0, OZ = 0, OK = 1;
  const CE = Math.cos(.16), SE = Math.sin(.16);
  const prj = (x, y, z) => { const Xw = x * m0 + y * m1 + z * m2, Yw = y * m4 + z * m5, Zw = x * m6 + y * m7 + z * m8, Zv = Zw * CE + Yw * SE, k = F / (F - OZ - Zv); sx = OX + Xw * k; sy = OY - (Yw * CE - Zw * SE) * k; sz = OZ + Zv; };
  const nrm = (x, y, z) => { const l = 1 / (Math.hypot(x, y, z) || 1); NX = (x * m0 + y * m1 + z * m2) * l; NY = (y * m4 + z * m5) * l; NZ = (x * m6 + y * m7 + z * m8) * l; NV = NZ * CE + NY * SE; };
  /* light: the net of light under the surface (two ridged noise sheets sliding over each other) */
  let ct = 0;
  const caus = (x, y) => { const w = noise(x * .05 + 40, y * .09 - ct), v = 1 - Math.abs(2 * noise(x * .1 + w * 1.6 + ct, y * .21 + w * 1.6 + 3) - 1), qo = v * v * v; return qo * qo * v; };
  const HX = -.3, HY = .62, HZv = .72;                                                             /* above the water: the half vector toward the low sky glow */
  /* shade the sample at (sx, sy) with world normal (NX, NY, NZ). alb: 0 dark skin .. 1 pale skin; ext: added light (marks, edges); u, v: place on
     the body in cells, for the light net. Sets BB (brightness) and CC (colour) */
  let BB = 0, CC = 0, HZE = 0, GAIN = 1, DET = true;
  function shade(alb, ext, u, v){ const xi = Math.max(0, Math.min(cols - 1, Math.round(sx))), dy = sy - yw[xi];
    if(dy < -.4){ const h = Math.max(0, NX * HX + NY * HY + NZ * HZv), h2 = h * h, h4 = h2 * h2, h8 = h4 * h4, spec = h8 * h8 * h8;                 /* out of the water: wet, dark, glinting */
      const b = .2 + .34 * alb + .2 * Math.max(0, NY) + .9 * spec + ext; BB = Math.min(1, b * GAIN * 1.45); CC = spec > .3 ? PEACH : alb > .5 ? (b > .5 ? PAPER : PMID) : b > .42 ? PMID : STEEL; return; }
    const up = .5 + .5 * NY, dep = clamp01(dy / DEEP), near = 1 - HZE; let qo = 0;
    if(NY > .2 && dy < DEEP * .6 && DET) qo = caus(u * .9 - ct * 30, v * 1.6) * NY * (1 - dy / (DEEP * .6));
    let b = (.62 + .38 * alb) * (.2 + .8 * up * Math.pow(up, .3)) * (1 - .3 * dep) + .14 * alb + .8 * qo + ext + .1 * Math.max(0, 1 - Math.abs(NV) * 2.4) * up;
    b = b * (1 - .55 * HZE) + .05 * HZE;
    CC = alb > .5 ? (b > .58 ? PALE : b > .3 ? PMID : SH) : qo > .22 ? (qo > .5 ? PALE : CYAN) : b > .6 ? LIT : b > .4 ? MID : b > .24 ? SH : DP;
    if(HZE > .45) CC = CC === PALE ? PMID : CC === LIT || CC === CYAN ? MID : CC === MID || CC === PMID ? SH : CC; if(HZE > .8 && CC === MID) CC = SH;
    BB = ext <= -1 ? 0 : Math.min(1, (.3 * near + .12 + (.62 - .2 * HZE) * Math.max(0, b)) * GAIN); }
  /* ---- one whale ---- */
  const SN = 80, SX_ = new Float32Array(SN + 1), SY_ = new Float32Array(SN + 1), SA = new Float32Array(SN + 1), drip = new Float32Array(40), R = {x: 0, y: 0, c: 1, s: 0, rt: 0, rb: 0, rw: 0, dr: 0};
  const at = (W, s) => { const f = Math.max(0, Math.min(SN - 1e-4, s * SN)), i = f | 0, u = f - i, a = SA[i] + (SA[i + 1] - SA[i]) * u, g = Math.max(0, Math.min(NP, s * NP)), j = g | 0, w = g - j, L = W.L;
    R.x = SX_[i] + (SX_[i + 1] - SX_[i]) * u; R.y = SY_[i] + (SY_[i + 1] - SY_[i]) * u; R.c = Math.cos(a); R.s = Math.sin(a);
    R.rt = (RT[j] + (RT[j + 1] - RT[j]) * w) * L; R.rb = (RB[j] + (RB[j + 1] - RB[j]) * w) * L; R.rw = (RW[j] + (RW[j + 1] - RW[j]) * w) * L;
    R.dr = (RT[j + 1] + RB[j + 1] + 2 * RW[j + 1] - RT[j] - RB[j] - 2 * RW[j]) / 4 * NP; return R; };
  function whale(W, o, tm, out){
    const L = W.L, kc = o.kc, id = W.id * 8, cr = Math.cos(o.roll), sr = Math.sin(o.roll), cy_ = Math.cos(o.yaw), sy_ = Math.sin(o.yaw);
    m0 = cy_; m1 = sr * sy_; m2 = cr * sy_; m4 = cr; m5 = -sr; m6 = -sy_; m7 = sr * cy_; m8 = cr * cy_;
    OX = Math.round(o.cx); OY = Math.round(o.cy); OZ = o.zc; HZE = clamp01(-o.zc / (2.7 * WL)); DET = L * kc > 34 * U;
    GAIN = W.gain * (1 + Math.round((phone ? .5 : .3) * clamp01((BOT - o.cy) / (BOT - TOP) - .3) * 16) / 16);                                  /* the canvas fades upward: lift what swims high */
    /* the spine, in the whale's own upright plane: the pitch, the arch of the back, the bend of the tail stock, and the beat (a wave that
       grows toward the tail and runs backward; the head only nods) */
    const ds = L / SN, j0 = Math.round(SN * .42), wv = s => o.amp * (.012 + .2 * Math.max(0, s - .3) ** 2) * Math.sin(o.psi - 5.46 * s);
    for(let j = 0; j <= SN; j++){ const s = j / SN, e = Math.max(0, (s - .6) / .4); SA[j] = -o.pitch - o.arch * 1.6 * (s - .42) - o.lift * e * e + (wv(s + .01) - wv(s - .01)) / .02; }
    SX_[j0] = 0; SY_[j0] = 0;
    for(let j = j0 + 1; j <= SN; j++){ const a = (SA[j] + SA[j - 1]) / 2; SX_[j] = SX_[j - 1] + Math.cos(a) * ds; SY_[j] = SY_[j - 1] + Math.sin(a) * ds; }
    for(let j = j0 - 1; j >= 0; j--){ const a = (SA[j] + SA[j + 1]) / 2; SX_[j] = SX_[j + 1] - Math.cos(a) * ds; SY_[j] = SY_[j + 1] - Math.sin(a) * ds; }
    /* body: rings along the spine (closer together where the outline changes fast, so the blunt snout closes), samples round each ring,
       back faces culled. Marks are fixed to the body: the mouth line, the eye, rows of knobs, throat pleats, the pale underside, a faint grain */
    const stp = st / kc > .25 ? st / kc : .25, qn = W.qo; if(!(L > 4)) return out;
    for(let s = 0; s < .966;){ at(W, s); const rt = R.rt, rb = R.rb, rw = R.rw, drs = R.dr, bx = R.x, by = R.y, c_ = R.c, s_ = R.s, rm = (rt + rb + 2 * rw) / 4, n = Math.max(8, Math.ceil(TAU * rm / stp));
      const thm = s < .17 ? 1.2 + 1.3 * s : 1.42 + (s - .17) * (s - .17) * 90, thb = (s < .5 ? 1.72 + .5 * s : 1.97) + .5 * (noise(s * 9 + qn, 2.5) - .5) + (s > .6 ? (s - .6) * 3 : 0), iu = Math.floor(s * L / (1.8 * U)), kn = s < .2 && ((s * L / (3.1 * U)) % 1) < .34;
      for(let j = 0; j < n; j++){ const th = (j + .5) / n * TAU - Math.PI, c = Math.cos(th), si = Math.sin(th), ry = c > 0 ? rt : rb, ay = c / ry * rm, az = si / rw * rm;
        nrm(-drs * c_ - ay * s_, -drs * s_ + ay * c_, az); if(NV < -.1) continue;
        prj(bx - s_ * ry * c, by + c_ * ry * c, rw * si);
        const a = Math.abs(th), ar = a * rm; let alb = Math.max(W.pale || 0, sstep(thb - .1, thb + .1, a)), ext = 0;
        if(DET){ ext = (hash2(iu + W.id * 77, Math.floor(th * rm / (1.8 * U))) - .5) * .07;
          if(s < .56 && a > 1.62 + .3 * s && ((a / .13) % 1) < .45) ext -= .08 + .2 * alb;                                             /* throat pleats */
          if(s < .25 && s > .008 && Math.abs(a - thm) * rm < .62 * U) ext -= .3; else if(s < .22 && a > thm && (a - thm) * rm < 1.7 * U) ext += .06;   /* mouth line, lower lip */
          if(kn && (a * rm < .6 * U || Math.abs(a - .62) * rm < .6 * U || Math.abs(a - thm + .22) * rm < .6 * U || Math.abs(a - thm - .3) * rm < .6 * U)) ext += .22;              /* knobs */
          if(Math.abs(s - .238) * L < .75 * U && Math.abs(a - 1.5) * rm < .75 * U) ext = -1; }                                          /* eye */
        shade(alb, ext, s * L / U + qn * 9, ar / U + qn * 3); op(BB, CC, id + 1); }
      if(s <= .175 && s + stp / L > .175){ prj(bx - s_ * rt, by + c_ * rt, 0); out.bx = sx; out.by = sy; }                              /* the blowholes */
      if(s === 0){ prj(bx, by, 0); out.hx = sx; out.hy = sy; }
      s += pos(stp / L / Math.hypot(1, drs * 1.4)); }
    at(W, 1); prj(R.x, R.y, 0); out.tx = sx; out.ty = sy;
    /* dorsal fin: a low hooked fin on the hump */
    { const H = .022 * L, s0 = .655, s1 = .748; for(let a = 0; a <= 1; a += pos(stp / ((s1 - s0) * L))){ at(W, s0 + (s1 - s0) * a); const hh = H * Math.pow(Math.sin(Math.PI * Math.pow(a, 1.7)), .8);
        for(let h = 0; h <= hh; h += stp){ nrm(0, .25, m8 * CE + m5 * SE > 0 ? 1 : -1); prj(R.x - R.s * (R.rt - .4 + h) + R.c * h * .5, R.y + R.c * (R.rt - .4 + h) + R.s * h * .5, 0); shade(0, hh - h < stp * 1.2 ? .14 : .03, 0, 0); op(BB, CC, id + 2); } } }
    /* flippers: long narrow blades from low on the side, held out and a little back and down, trimmed slowly; a rounded leading edge with
       knobs, pale with dark mottling on the upper face, white below */
    at(W, .37); { const fx = R.x, fy = R.y, c_ = R.c, s_ = R.s, rb = R.rb, rw = R.rw, len = .3 * L;
      for(const sd of [-1, 1]){ const sw = 1 + .45 * o.swp + .07 * Math.sin(tm * .37 + sd + W.qo), dr = .95 - .5 * o.swp + .08 * Math.sin(tm * .29 + 2 * sd + W.qo), tw = .3 + .1 * Math.sin(tm * .23 + sd);
        const dT = Math.sin(sw) * Math.cos(dr), dZ = sd * Math.cos(sw) * Math.cos(dr), dD = -Math.sin(dr);
        let qT = 1 - dT * dT, qD = -dT * dD, qZ = -dT * dZ; const ql = Math.hypot(qT, qD, qZ) || 1; qT /= ql; qD /= ql; qZ /= ql;
        let nT = dD * qZ - dZ * qD, nD = dZ * qT - dT * qZ, nZ = dT * qD - dD * qT; if(nD < 0){ nT = -nT; nD = -nD; nZ = -nZ; }
        const cw = Math.cos(tw), swt = Math.sin(tw) * sd, eT = qT * cw + nT * swt, eD = qD * cw + nD * swt, eZ = qZ * cw + nZ * swt, gT = nT * cw - qT * swt, gD = nD * cw - qD * swt, gZ = nZ * cw - qZ * swt;
        const rT_ = 0, rD = -rb * .55, rZ = sd * rw * .78;
        for(let f = 0; f <= 1; f += pos(stp / len)){ const w = .078 * L * (f < .12 ? .62 + .38 * f / .12 : 1 - .62 * Math.pow((f - .12) / .88, 1.4)) * (f > .95 ? Math.sqrt((1 - f) / .05) : 1), lead = .42 * w + .015 * L * (.35 + .65 * f) * Math.max(0, Math.sin(f * 27 + 1)) ** 2, f2 = f * f * len;
          const pT = rT_ + dT * len * f + .2 * f2, pD = rD + dD * len * f - .03 * f2, pZ = rZ + dZ * len * f;
          for(let c = -lead; c <= .58 * w; c += stp){ const u = (c + lead) / (lead + .58 * w), tl = u < .3 ? -(.3 - u) * 2.4 : (u - .3) * .5, a = pT + eT * c, b = pD + eD * c, z = pZ + eZ * c;
            let n1 = gT + eT * tl, n2 = gD + eD * tl, n3 = gZ + eZ * tl; nrm(n1 * c_ - n2 * s_, n1 * s_ + n2 * c_, n3); const under = NV < 0; if(under){ NX = -NX; NY = -NY; NZ = -NZ; NV = -NV; }
            prj(fx + a * c_ - b * s_, fy + a * s_ + b * c_, z);
            const mt = noise(f * 6 + sd * 7 + W.qo, u * 3.2), dk = f < .06 || mt > (under ? .7 : .58) + .2 * f - .35 * Math.max(0, u - .55);
            shade(dk ? .15 : 1, (u < .12 ? .12 : -.25 * (u - .12)) + (under ? .05 : 0) + .08 * f + (DET ? (mt - .5) * .2 : 0), f * len / U + sd * 40, c / U + 9); op(BB, CC, id + (sd > 0 ? 3 : 4)); } } } }
    /* fluke: a swept, notched blade across the end of the tail stock; it trails each stroke; dark above, white below with a black border and
       middle line; the trailing edge is ragged. Reports where water runs off it while it is out */
    { at(W, .957); const ox = R.x, oy = R.y, e = Math.atan2(R.s, R.c) - o.lift * .7 - .5 * o.amp * Math.cos(o.psi - 5.46), ca = Math.cos(e), sa = Math.sin(e), half = .155 * L; let nd = 0;
      for(const sd of [-1, 1]) for(let qo = 0; qo <= 1; qo += pos(stp / half)){ const le = (.108 * Math.pow(qo, 1.5) - .012) * L; let te = (.075 - .02 * Math.exp(-((qo / .06) ** 2)) + .033 * Math.pow(qo, .8) - .008 * ((qo * 13 + sd) % 1)) * L; if(qo > .88) te = le + (te - le) * Math.sqrt((1 - qo) / .12);
          const fz = -.03 * L * qo * qo * o.amp * Math.sin(o.psi - 5.9);
          for(let x = le; x <= te; x += stp){ const u = (x - le) / (te - le + 1e-6); nrm(-sa, ca, -.12 * sd * qo); const under = NV < 0; if(under){ NX = -NX; NY = -NY; NZ = -NZ; }
            prj(ox + ca * x - sa * fz, oy + sa * x + ca * fz, sd * qo * half);
            const wh = under ? !(u > .84 || u < .08 || qo < .05 || qo > .86 || noise(qo * 5 + sd * 3 + W.qo, u * 3) > .7) : DET && qo > .7 && hash2(Math.floor(qo * 40) + sd, Math.floor(u * 6)) > .8;
            shade(wh ? 1 : 0, u > .9 ? .07 : 0, x / U, qo * half / U + 60); op(BB, CC, id + 5);
            if(W === mom && u > .9 && nd < 40 && sy < yw[Math.max(0, Math.min(cols - 1, sx | 0))] - 1.5 && ((qo * half * 2) | 0) % 2 === 0){ drip[nd++] = sx; drip[nd++] = sy; } } }
      out.nd = nd; }
    return out; }
  /* write the buffer onto the whale layer. Body cells are also cut out of the background so nothing shows through; a dark seam is left where a
     nearer part (a flipper, the calf) lies over a farther one */
  function stamp(){ const yc = TOP;
    for(let x = x0; x <= x1; x++) for(let y = y0; y <= y1; y++){ const k = x * rows + y, o = ZO[k]; if(!o) continue;
      if(y < yc && inCol(x)) continue;                                                              /* never above the band inside the content column (caption line) */
      let gap = false; for(let n = 0; n < 4 && !gap; n++){ const qo = k + (n === 0 ? -rows : n === 1 ? rows : n === 2 ? -1 : 1); if(qo >= 0 && qo < N && ZO[qo] && ZO[qo] !== o && ZZ[qo] > ZZ[k] + 3 * U) gap = true; }
      FL.set(x, y, gap ? 0 : ZB[k], ZC[k]); MK[k] = 1; mk.push(k); } }
  const unbuf = () => { for(let x = x0; x <= x1; x++){ const a = x * rows + y0, b = x * rows + y1 + 1; ZZ.fill(-1e9, a, b); ZB.fill(0, a, b); ZO.fill(0, a, b); ZD.fill(9, a, b); } x0 = cols; x1 = -1; y0 = rows; y1 = -1; };
  /* the blow, after the source: s runs 0..3 over its life; (bx, by) is the blowhole, k its size. Warm where the low light catches its head */
  function blow(bx, by, s, k){ if(!(k > .15)) return; const rh = 1.3 * k, tp = 6.6 * Math.sqrt(Math.min(1, s / .5)), cut = s < .8 ? 0 : (s - .8) * 7, hw = 1 + 3.6 * Math.min(1, s / .8) + 2.4 * Math.max(0, s - .8);
    const hh = 1 + .6 * Math.min(1, s / .8) + .5 * Math.max(0, s - .8), hy0 = tp - .6 - .5 * Math.max(0, s - 1), amp = Math.min(1, s / .2) * (s < 1 ? 1 : Math.exp(-(s - 1) / 1.2));
    for(let y = Math.floor(by - 8.4 * rh); y < by; y++){ const yy = (by - y) / rh, lean = Math.min(1, yy / Math.max(1, tp)), mid = bx / k + 2.6 * s * lean + 1.5 * s * lean * lean;
      for(let c = Math.floor((mid - 12) * k); c <= (mid + 12) * k; c++){ const dx = c / k - mid, dy = (yy - hy0) / hh;
        let d = yy > cut && yy <= tp ? Math.exp(-((dx / (.3 + .17 * yy)) ** 2)) : 0; const hd = amp * Math.exp(-((dx / hw) ** 2) - dy * dy); d = Math.max(d, hd); d *= .8 + .4 * hash2(c * 31 + y, 5);
        if(d > .17 && (y >= TOP || !inCol(c))) PL.put(c, y, Math.min(1, .3 + .9 * d), hd > .3 && dx < -.1 * hw && d > .55 ? PEACH : PAPER); } } }
  /* ---- the slow layer (ten times a second, kept in an offscreen canvas): the dusk sky, the far sea, the water column with its shafts of
     light and the bright rippled skin of the surface seen from below, drifting specks ---- */
  const beams = Array.from({length: phone ? 4 : 9}, (_, i) => ({s: (i + .2 + .6 * S()) / (phone ? 4 : 9), w: (4 + 8 * S()) * U, ph: S() * TAU}));
  const snow = Array.from({length: phone ? 30 : 110}, () => ({x: S(), y: S(), z: S(), w: S() * TAU})), stars = Array.from({length: phone ? 8 : 50}, () => ({x: S(), y: S(), b: S()}));
  const prof = new Float32Array(cols + rows + 2);
  const tick = ticker(.1, tm => { RL.clear(); const t = tm * .3 * p.speed, Wd = cols * 1.7, cam = CAM * tm; prof.fill(0); ct = tm * .05 * p.speed;
    for(const b of beams){ const a = .5 + .5 * Math.sin(tm * .08 * p.speed + b.ph * 2.3), m = wrap(b.s * Wd + cam * .4, Wd) - Wd * .3 + rows;                       /* shafts: one profile across, sheared down the rows */
      for(let i = Math.max(0, Math.floor(m - 2.5 * b.w)); i < prof.length && i < m + 2.5 * b.w; i++){ const d = (i - m) / b.w; prof[i] = Math.min(.6, prof[i] + a * Math.exp(-d * d)); } }
    for(let c = 0; c < cols; c++){ const top = inCol(c) ? TOP : 0, g = Math.exp(-(((c - SUNX) / (cols * (phone ? .3 : .16))) ** 2));                               /* g: where the sun went down */
      for(let y = top; y < HZ; y++){ const h = (HZ - y) / U, d = (Math.exp(-(h - 1) / (3 + 4 * g)) * (.55 + .45 * g) + .05) * (.8 + .4 * noise(c * .07 / U, y * .3 / U));
        if((BAYER[(c & 3) + ((y & 3) << 2)] + .5) / 16 < d) RL.put(c, y, .16 + .26 * g * Math.exp(-(h - 1) / 3), h <= 2 && g > .3 ? PEACH : h <= 4 + 3 * g ? ROSE : h <= 10 ? VIO : IND); }
      if(hash2(c, 77) < .5 + .4 * g) RL.put(c, HZ, .22 + .3 * g, ROSE);
      for(let y = HZ + 1; y < SEA; y++){ const f = (y - HZ) / (SEA - HZ), x = (c - cam * .5 * f) / (.3 + f) / U, v = noise(x * .22, y * 3.1 + t * .3);                    /* far sea: streaks of reflected sky */
        if(g > .2 && hash2(c + Math.floor(t * 3), y) < g * .4 * (1 - f)) RL.put(c, y, .16 + .3 * g * (1 - f), ROSE); else if(v > .62) RL.put(c, y, .1 + .5 * (v - .62) * (1.2 - f), f < .35 ? ROSE : f < .7 ? VIO : SEAC); }
      for(let y = SEA + 1; y < rows; y++){ const dd = y - SEA, d = dd / Math.max(1, DEEP), th = (BAYER[(c & 3) + ((y & 3) << 2)] + .5) / 16, lit = prof[(c - (dd >> 1) + rows) | 0] * (1 - .75 * d);
        const sk = dd < 7 * U ? Math.max(0, noise((c - cam) * .16 / U + 2 * noise(c * .05 / U, t * .5), dd * 1.1 / U + t * .7) - .5) * 3 * (1 - dd / (7 * U)) : 0;                                  /* the skin of the water from below */
        if(sk > .12) RL.put(c, y, Math.min(.7, .2 + sk * .8), sk > .62 ? PALE : CYAN);
        else if(lit > .08 && th < .5 + lit) RL.put(c, y, lit * (.8 + .2 * hash2(c, y)), d < .4 ? CYAN : PMID);
        else if(th < .56 * (1 - .7 * d)) RL.put(c, y, .16 + .2 * (1 - d), d < .3 ? SEAC : d < .65 ? SH : DP); } }
    for(const s of stars){ const c = Math.floor(s.x * cols), y = Math.floor(s.y * s.y * (HZ - 4 * U)); if(y < HZ - 3 * U && (y >= TOP || !inCol(c))) RL.put(c, y, .2 + .45 * s.b * (.7 + .3 * Math.sin(tm * 1.3 + s.x * 40)), STAR); }
    for(const m of snow){ const x = wrap(m.x * cols + cam * (.3 + m.z * .9), cols), y = SEA + 4 * U + m.y * (rows - SEA - 5 * U) + 1.5 * U * Math.sin(tm * .15 + m.w); RL.put(x, y, .16 + .2 * m.z, PMID); if(m.z > .7) RL.put(x + 1, y, .12, PMID); }
    RL.draw(off.begin(), .9, false, 'sq'); });
  const glints = Array.from({length: Math.round(D.nPart * .1)}, () => ({px: X.rnd(), d: X.rnd(), ph: X.rnd() * TAU, r: .2 + X.rnd() * .5, cx: X.rnd() > D.share ? 1 : 0})), GN = glints.length;
  const PM = {}, PC = {}, O1 = {}, O2 = {}, ST = {}, pp = (x, y, b, c) => { if(y >= TOP + .5 || !inCol(Math.round(x))) PL.put(x, y, b, c); };   /* spray never rises into the caption line */
  return tm => {
    tick(tm); FL.clear(); PL.clear(); const t = tm * .3 * p.speed, cam = CAM * tm;
    momPose(tm, PM); calfPose(tm, PC); const tq = PM.t;
    /* the waterline: swell and chop, flat and glossy for a while where the fluke went down */
    const fo = tq > DOWN - .3 && tq < DOWN + 7 ? (tq - DOWN + .3) / 7.3 : -1, fox = PM.cx + WL * .2 + CAM / vel * (tq - DOWN), fw = (4 + WL * .3 * fo) * U;
    for(let c = 0; c < cols; c++){ const x = (c - cam) / U, h = Math.sin(x * .12 - t * 1.4) + .7 * Math.sin(x * .054 + t * .8) * chop, flat = fo >= 0 && Math.abs(c - fox) < fw; yw[c] = SEA + (flat ? 0 : 1.1 * U * chop * h); }
    O1.nd = 0; if(LIVE){ whale(calf, PC, tm, O2); whale(mom, PM, tm, O1); stamp(); }
    /* the waterline lies in front of everything (it is at the lens); white water where a back or the fluke breaks it */
    for(let c = 0; c < cols; c++){ const x = (c - cam) / U, y = Math.round(yw[c]), k = c * rows + y, h = (yw[c] - SEA) / (1.1 * U * chop), flat = fo >= 0 && Math.abs(c - fox) < fw, body = ZO[k] > 0 && ZO[k - 1] > 0;
      if(body){ const end = c < 2 || c > cols - 3 || !ZO[k - 2 * rows] || !ZO[k + 2 * rows]; PL.put(c, y, end ? .95 : .5 + .4 * hash2(c, Math.floor(tm * 6)), PAPER); if(end || hash2(c + 9, Math.floor(tm * 5)) > .6) pp(c, y - 1, .6, PAPER); if(end) PL.put(c, y + 1, .5, PALE); }
      else PL.put(c, y, flat ? (Math.abs(Math.abs(c - fox) - fw) < 1.5 || hash2(c + 40, Math.floor(tm * 4)) > fo ? .62 : .3) : h > 1.15 ? .7 : .4 + .08 * (c & 1), flat || h > 1.15 ? PALE : CYAN); }
    /* her blow and the calf's; their heads stay below the caption line */
    if(LIVE){ const s = (tq - BLOW) / 1.3; if(s > 0 && s < 3){ const by = Math.min(O1.by, yw[Math.max(0, Math.min(cols - 1, O1.bx | 0))]); blow(O1.bx, by, s, Math.min(.19 * WL * PM.kc, by - TOP - 1) / 10.8); }
      for(const b of CB){ const sc = (tq - b) / 1.1; if(sc > 0 && sc < 3){ const by = Math.min(O2.by, yw[Math.max(0, Math.min(cols - 1, O2.bx | 0))]); blow(O2.bx, by, sc, Math.min(.085 * WL * PC.kc, by - TOP - 1) / 10.8); } } }
    /* water streaming off the fluke while it is out, and a burst of white water and bubbles where it goes under */
    for(let i = 0; i < O1.nd; i += 2){ const x = drip[i], y0_ = drip[i + 1], ys = yw[Math.max(0, Math.min(cols - 1, x | 0))];
      for(const lag of [0, .25, .5, .75]){ const qo = (tm * 1.1 + hash2(i, 9) + lag) % 1; pp(x + qo * 1.2 * U, y0_ + qo * qo * (ys - y0_), .75 - .35 * qo, PAPER); } }
    if(LIVE && tq > DOWN - 1.2 && tq < DOWN + 3){ const a = tq - DOWN + 1.2, n = phone ? 26 : 60; for(let i = 0; i < n; i++){ const h1 = hash2(i, 3), h2 = hash2(i, 4), age = a - h1 * 1.6; if(age < 0 || age > 2.4) continue;
        const up = h2 < .4, x = fox + (h1 - .5) * WL * .22 + (h2 - .5) * 6 * U * age, y = up ? SEA - (3.2 * age - 2.2 * age * age) * 3 * U * (.4 + h2) : SEA + (2 + 9 * hash2(i, 5)) * U * Math.min(1, age * 1.4) - age * U;
        if(up && y > SEA) continue; pp(x, y, (.8 - .3 * age) * (up ? 1 : .7), up ? PAPER : PALE); } }
    /* tokens: glints on the far water, nearer ones lower and faster; each stays lit and flares now and then; never under a whale, the blow or
       another glint: slide along, then to the next row */
    const free = (x, y) => !ZO[x * rows + y] && !(PL.gb[x * rows + y] > 0), g0 = HZ + 1, g1 = SEA - 2;
    for(let n = 0; n < GN; n++){ const qo = glints[n], f = Math.pow(qo.d, 1.4), fl = Math.pow(Math.max(0, Math.sin(tm * qo.r + qo.ph)), 6);
      let y = Math.round(g0 + f * (g1 - g0)), x = Math.round(wrap(qo.px * cols + cam * (.1 + .3 * f), cols)) % cols, k = 0;
      while(k < cols * (g1 - g0 + 1) && !free(x, y)){ x = (x + 1) % cols; if(++k % cols === 0) y = y >= g1 ? g0 : y + 1; }
      PL.put(x, y, .42 + .56 * fl * (.6 + .4 * f), qo.cx); }
    ST.tau = tq; ST.head = [O1.hx, O1.hy]; ST.tail = [O1.tx, O1.ty]; ST.chead = [O2.hx, O2.hy]; ST.ctail = [O2.tx, O2.ty]; ST.ox = Math.round(PM.cx); ST.oy = Math.round(PM.cy); ST.amp = PM.amp; ST.kc = PM.kc; ST.L = WL;
    unbuf();
    off.blit();
    if(mk.length){ ax.save(); ax.globalCompositeOperation = 'destination-out'; ax.fillStyle = '#000'; ax.beginPath(); for(const k of mk){ ax.rect(((k / rows) | 0) * PX, (k % rows) * PX, PX, PX); MK[k] = 0; } ax.fill(); ax.restore(); mk.length = 0; }
    FL.draw(ax, .95, false, 'dot'); PL.draw(ax, 1, true, 'sq');
  };
}

/* 13 starlings.
   Adapted from ascii.rest piece 'starlings' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: the subject (a murmuration that wheels about its middle and is cut through by a falcon, which scatters it) and the
   idea that a cell is heavier where birds crowd. Rebuilt to read like footage of a winter roost flight at dusk over a reed bed.
   The source steps a flocking rule (align, cohere, separate) frame by frame; a frame here has to be a function of time alone, so the flock
   is not simulated. It is a moving figure made to the measurements and descriptions of real flocks (reference list kept with the design
   evidence), and the published rule that each bird follows its six or seven nearest neighbours is the reason for the look, not something
   this code runs.
   The flock: a few thousand birds as a broad thin sheet (real flocks are much wider than thick, with a sharp edge) that trails along the
   path its front has flown. The sheet leans from flat to standing like a curtain, its upper part rolls over on itself, sometimes most of
   the way into a tube, and a neck travels back along it so that it bulges, pinches and balloons again. Tone is geometry: every bird adds a
   little darkness to the cells it falls in, more when the flat of its wings faces us, so a part seen face-on is a pale stipple of single
   birds, a part folded double or seen edge-on is near black, and far parts are smaller and denser. One bird in ten keeps outside the edge.
   A second, smaller flock flies the same figure further off, half a cycle behind, so the sky is not empty while the first is in the reeds.
   Waves of agitation: a front of birds that roll and show their wings crosses the whole sheet in under a second as a dark band and
   the sheet pales again behind it; twice as the falcon stoops, twice more in the wheeling with no falcon near.
   The peregrine: comes in low and fast from the near side, tucks its wings and goes through the flock. Round the strike the birds burst
   apart, the flock tears in two along the falcon's line, the parts draw together again. Then the front tips over above the roost and the
   whole flock pours down through that one place into the reeds.
   Near birds: once a cycle a dozen starlings cross low in front of the glow, 10 to 16 cells across the wings: short body, pointed head, short
   tail, pointed triangular wings; each flaps for a burst, glides, shuts its wings. Late singles string out toward the roost.
   Scene: a dusk sky brightest at the horizon where the sun went down, soft layers of broken cloud with lit undersides, a far bank with
   bare trees and the roost reed bed, open water that mirrors sky, trees and the flock (as a soft dark shape) and is crossed by slow
   ripples, near reeds that sway. Everything dark is a silhouette: it thins the lit dots of the sky or water behind it. The piece paints
   its own cells (same dots as the kit) because nearly every cell is lit and the kit's draw lists would be large.
   Data: the number of birds grows with today's tokens (2,400 with none, 6,600 at most; the count the caption gives is the count drawn, on
   any screen, and fewer birds are drawn bolder so the flock keeps its tone). How much of the flock tears off at the strike follows the
   Codex share, held between a fifth and a half; that is not worth a caption. Nothing else carries data. */
function tFlock(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, PX = env.P, NC = cols * rows, LVN = 9;
  const U = 5 / PX, mg = Math.max(0, (env.W - 1240) / 2 / PX), TOP = phone ? Math.round(11 * U) : Math.round(rows * .46), BOT = phone ? Math.round(65 * U) : rows;
  const HZ = phone ? BOT - 13 : rows - 15, BANK = HZ + 2, MIR = p.off < 0 ? -1 : 1, CX = cols / 2, SKYH = HZ - TOP;
  /* palette: 0 / 1 are the kit's data colours (not used here); 2..8 the sky from the gold at the horizon up to indigo; 9 cloud; 10 lit cloud edge */
  const PALS = [BLUE, OR, [240, 200, 134], [230, 160, 104], [208, 120, 106], [160, 102, 132], [116, 96, 148], [80, 94, 144], [54, 66, 114], [124, 96, 124], [244, 212, 160]];
  const CSS = PALS.map(c => `${c[0]},${c[1]},${c[2]}`);
  /* ---------- the still scene: sky, cloud bars, far bank, trees (brightness and colour per cell) ---------- */
  const bB = new Float32Array(NC), bC = new Uint8Array(NC), SUNX = cols * (.5 - MIR * (phone ? .12 : .17) + .04 * p.tilt);
  const RAMP = [0, .07, .2, .37, .56, .76, 1.02], CS = phone ? .55 : 1, CDC = new Float32Array(rows + 4);
  const cden = (x, y) => { const h = (HZ - y) / SKYH; return noise(x / (46 * CS) + 7, y / 9 + 3) * .55 + noise(x / (19 * CS) + 40, y / 4.5) * .3 + noise(x / 7, y / 2.5 + 9) * .15
    + .13 * Math.exp(-(((h - .2) / .12) ** 2)) + .1 * Math.exp(-(((h - .56) / .15) ** 2)) - .64; };
  for(let x = 0; x < cols; x++){ const inCol = x >= mg && x < cols - mg, top = inCol ? TOP : Math.round(rows * .12), dx = (x - SUNX) / (phone ? cols * .9 : cols * .5);
    for(let y = top; y < HZ + 3; y++) CDC[y - top] = cden(x, y);
    for(let y = top; y < HZ; y++){ const k = x * rows + y, h = (HZ - y) / SKYH, he = h * (1 + .5 * dx * dx) + .22 * dx * dx + (dith(x, y) * LVN) * .09;
      let i = 0; while(i < 5 && he > RAMP[i + 1]) i++;
      let b = Math.min(1, (.74 + .2 * Math.exp(-h * 2.2) + .22 * h) * (1 - .14 * Math.min(1, dx * dx))) + .1 * Math.exp(-h * 9) * Math.exp(-dx * dx * 6), c = 2 + i;
      /* cloud: two soft layers of broken stratocumulus. Density feathers out at the edges (cells switch to cloud by chance, more of them
         deeper in), the body is dimmer and greyer than the sky behind, and where the cloud thins downward its underside takes the last light */
      const cd = CDC[y - top], dk = sstep(0, .13, cd);
      if(dk > 0){ const lit = sstep(0, .09, cd - CDC[y - top + 3]) * Math.exp(-h * 2.4) * dk, r = hash2(x * 7 + y, y * 13 + x), r2 = dith(x, y) * LVN + .5;
        b = b * (1 - .15 * dk * (1 - lit)) + .05 * lit; if(r2 < lit * 1.1) c = lit > .75 && h < .28 ? 10 : 3; else if(r < dk * .9) c = 9; }
      b *= sstep(top - 1, top + (inCol ? 7 : 30), y);
      bB[k] = b; bC[k] = c; } }
  /* the far bank: a low dark line, reed tops along it, and bare winter trees: trunk, forks, a haze of twigs */
  const dark = (x, y, f) => { x = Math.round(x); y = Math.round(y); if(x >= 0 && y >= 0 && x < cols && y < rows) bB[x * rows + y] *= f; };
  const R0 = mulberry(mix(p.seed + 131));
  for(let x = 0; x < cols; x++){ const rh = .6 + 1.6 * noise(x / 13 + 90, 5) + 1.2 * noise(x / 3.1, 9); for(let y = HZ - Math.round(rh); y <= BANK; y++) dark(x, y, y < HZ - rh + 1 ? .35 : 0); }
  /* a bare tree at this distance: a trunk, a few boughs, and an oval lace of twigs the sky shows through, ragged at the edge */
  function tree(tx, h, wide){ const rx = h * wide, ry = h * .36, cy = HZ - h * .62, lean = (R0() - .5) * .2, sd = R0() * 50;
    for(let y = Math.floor(cy - ry - 1); y <= HZ; y++) for(let x = Math.floor(tx - rx - 2); x <= tx + rx + 2; x++){ const ex = (x - tx - lean * (HZ - y)) / rx, ey = (y - cy) / ry, e = Math.hypot(ex, ey) + (noise(x / 2.3 + sd, y / 2.3) - .5) * .5;
      if(e < 1) dark(x, y, e < .55 ? .08 + .3 * noise(x / 1.3 + sd, y / 1.3 + 9) : .2 + .7 * noise(x / 1.1 + sd, y / 1.1 + 4) * (e > .85 ? 1.3 : 1)); }
    for(let y = Math.round(cy); y <= HZ; y++){ dark(tx + lean * (HZ - y), y, 0); if(h > 12 && y > HZ - h * .2) dark(tx + lean * (HZ - y) + 1, y, .1); }
    for(let j = 0; j < 5; j++){ const a = (j - 2) * .5 + (R0() - .5) * .3, L = h * (.18 + .12 * R0()), bx = tx + lean * h * .4, by = HZ - h * (.36 + .06 * j % 2); for(let i = 0; i <= L * 2; i++){ const qo = i / 2; dark(bx + Math.sin(a) * qo, by - Math.cos(a) * qo - qo * qo * .02, .05); } } }
  const TREES = phone ? [.08, .88] : [.03, .07, .715, .915, .96];
  for(const f of TREES){ const tx = cols * (MIR > 0 ? f : 1 - f) + (R0() - .5) * 6, th = (phone ? 11 : 14) + 8 * R0(); tree(tx, th, .36 + .12 * R0()); }
  /* ---------- the flock ---------- */
  const F = phone ? 230 : 500, EYE = 1.7, Z0 = 340, AXm = phone ? 30 : 74, AZm = phone ? 90 : 70, YC = phone ? 30 : 19, AY = phone ? 6 : 3;
  const CYC = 38, TA = 12, WD = 33, DD = 5, TS = 30, THERO = 31, TLEN = 6.2, KT = 48, WD0 = phone ? 28 : 36;
  const N = 2400 + 3 * Math.min(1400, D.nPart), NA = Math.round(N * .8), SPL = 1 - 2 * Math.min(.5, Math.max(.2, 1 - D.share));   /* NA birds in the main flock, the rest in a second one half a cycle behind; birds with a > SPL tear off at the strike */
  const bT = new Float32Array(N), bA = new Float32Array(N), bTh = new Float32Array(N), bPh = new Float32Array(N), bG = new Float32Array(N), bS = new Uint8Array(N);
  const TSTAR = 2;
  { const r = mulberry(mix(p.seed + 26)); for(let i = 0; i < N; i++){ const u = r(), a = 2 * r() - 1;
      bT[i] = TLEN * Math.pow(u, 1.25); bA[i] = a; bTh[i] = 2 * r() - 1; bPh[i] = r() * TAU;
      if(r() < (phone ? .2 : .1)){ const k = 1.12 + .5 * r(); bA[i] *= k; bTh[i] *= 2 + 3 * r(); bT[i] = Math.min(TLEN, bT[i] * (1 + .25 * r())); bS[i] = 1; }           /* stragglers: outside the edge, drawn as single birds */
      const dt = (bT[i] - TSTAR) * 12, da = (bA[i] - SPL) * 14; bG[i] = Math.exp(-(dt * dt + da * da) / 220); } }
  const EP = phone ? 12 : 22, RZ = Z0 + 40, RX = -MIR * (phone ? .04 : .1) * cols * RZ / F, W1 = TAU / CYC, W2 = -TAU / 10.5;
  /* the middle of the sheet for a bird whose own clock reads u: it comes in from far off, wheels, then drops into the roost.
     far = the second flock: the same figure further off and on the other side */
  function centre(u, o, far){ const w = u - Math.floor(u / CYC) * CYC, a1 = W1 * w + 1.32, a2 = W2 * w + 1.1;
    let x = MIR * (AXm * Math.sin(a1) + EP * Math.sin(a2)), z = Z0 - AZm * Math.cos(a1) + EP * Math.cos(a2), y = YC + AY * Math.sin(TAU * w / 13.7 + .4) + .4 * AY * Math.sin(TAU * w / 6.1 + 2), cs = 1, vis = 1;
    if(far){ x = -.75 * x + MIR * AXm * .3; z += 170; y += 6; }
    if(w < TA){ const e = 1 - easeS(w / TA), e2 = e * e; x -= MIR * (far ? -1 : 1) * (phone ? 70 : 190) * e2; y += 14 * e2; z += 190 * e2; }
    else if(w > WD){ const s = Math.min(1, (w - WD) / DD), s2 = s * s * (3 - 2 * s), sv = s * s; x += (RX - x) * s2; z += (RZ - z) * s2; y += (1 - y) * (.35 * s2 + .65 * sv * s); cs = 1 - .9 * s2; vis = s > .93 ? (1 - s) / .07 : 1; }
    o[0] = x; o[1] = y; o[2] = z; o[3] = cs; o[4] = vis; return o; }
  const tab = new Float32Array((KT + 1) * 16), tabB = new Float32Array((KT + 1) * 16), c0 = new Float32Array(5), c1 = new Float32Array(5), WV = new Float32Array(12);
  /* ---------- per-frame light: optical depth of everything dark, and the cells it touched ---------- */
  const od = new Float32Array(NC), mark = new Int32Array(NC).fill(-1), dirty = new Int32Array(NC), key = new Uint8Array(NC), ord = new Int32Array(NC), cnt = new Int32Array(PALS.length * LVN + 1); let nd = 0, fid = 0;
  const add = (x, y, v) => { if(x < 0 || y < TOP - 30 || x >= cols || y >= rows) return; const k = x * rows + y; if(mark[k] !== fid){ mark[k] = fid; od[k] = 0; dirty[nd++] = k; } od[k] += v; };
  /* a bird seen from behind: body, and two wings whose tips are up (d > 0), level, or down; closed = wings shut between bursts of flapping */
  function bird(x, y, s, d, closed, v, swept){ x = Math.round(x); y = Math.round(y); add(x, y, v); if(s > 3.4) add(x, y + 1, v * .8);
    if(closed){ if(s > 6) add(x, y - 1, v * .6); return; }
    const hw = Math.max(1, Math.round(s / 2));
    for(let i = 1; i <= hw; i++){ const el = hw * .42, yy = swept ? y - Math.round(Math.min(i, el) * .8 * d) + Math.round(Math.max(0, i - el) * .7) : y - Math.round(d * i * .62), vv = i === hw && s < 2.6 ? v * .5 : v; add(x + i, yy, vv); add(x - i, yy, vv); if(s > 5 && i <= hw / 2){ add(x + i, yy + 1, v * .7); add(x - i, yy + 1, v * .7); } } }
  const tri = (x0, y0, x1, y1, x2, y2, v) => { const ar = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0); if(Math.abs(ar) < .3) return; const sg = ar > 0 ? 1 : -1;
    for(let x = Math.floor(Math.min(x0, x1, x2)); x <= Math.ceil(Math.max(x0, x1, x2)); x++) for(let y = Math.floor(Math.min(y0, y1, y2)); y <= Math.ceil(Math.max(y0, y1, y2)); y++){
      const a = ((x1 - x0) * (y - y0) - (x - x0) * (y1 - y0)) * sg, b = ((x2 - x1) * (y - y1) - (x - x1) * (y2 - y1)) * sg, c = ((x0 - x2) * (y - y2) - (x - x2) * (y0 - y2)) * sg; if(a >= -.12 && b >= -.12 && c >= -.12) add(x, y, v); } };
  /* a starling S cells across the wings, seen from below and a little to one side as it passes (the view of the reference photographs):
     a slim body along its heading (a = climb angle) with a small pointed head and a short square tail, and a pointed wing to each side:
     out and a little forward to the wrist, then swept back to the tip. w = how much of the wing length shows (1 spread, less through the
     beat as the wings rise or fall toward the eye line); the far wing is shorter. glide = both wings held out, narrow; shut = the body alone */
  function star(cx, cy, S, dir, w, shut, a, glide){ cx = Math.round(cx); cy = Math.round(cy); const hx = dir * Math.cos(a), hy = -Math.sin(a), px = -hy * dir, py = hx * dir, L = .52 * S;
    const X = (u, v) => cx + hx * u + px * v, Y = (u, v) => cy + hy * u + py * v, T3 = (u0, v0, u1, v1, u2, v2) => tri(X(u0, v0), Y(u0, v0), X(u1, v1), Y(u1, v1), X(u2, v2), Y(u2, v2), 9);
    for(let i = 0, n = Math.round(L * 1.5); i <= n; i++){ const u = (i / n - .5) * L; add(Math.round(X(u, 0)), Math.round(Y(u, 0)), 9); }              /* spine: tail end to bill */
    const bw = .09 * S; T3(.42 * L, 0, .12 * L, bw, .12 * L, -bw); T3(.12 * L, bw, .12 * L, -bw, -.36 * L, bw * .6); T3(.12 * L, -bw, -.36 * L, bw * .6, -.36 * L, -bw * .6);
    T3(-.36 * L, bw * .6, -.36 * L, -bw * .6, -.5 * L, bw * .75); T3(-.36 * L, -bw * .6, -.5 * L, bw * .75, -.5 * L, -bw * .75);                       /* the short square tail */
    if(shut) return;
    for(const k of [1, -1]){ const len = (k > 0 ? .5 : .43) * S * w, ch = glide ? .14 * S : .2 * S, uf = .16 * L, ur = uf - (glide ? .22 : .28) * S, wu = uf + .03 * S, wv = k * (bw + .42 * len), tu = uf - (glide ? .2 : .2) * S - .06 * S * w, tv = k * (bw + len);
      T3(uf, k * bw * .5, ur, k * bw * .5, wu, wv); T3(ur, k * bw * .5, wu, wv, wu - ch, wv); T3(wu, wv, wu - ch, wv, tu, tv); } }
  /* ---------- painting: the still scene once into an offscreen canvas, the changing cells over it each frame ---------- */
  const off = offscreen(env);
  function paint(c, list, n, bOf, cOf){ cnt.fill(0);
    for(let i = 0; i < n; i++){ const k = list ? list[i] : i, b = bOf(k); if(b < .05){ key[k] = 255; continue; } const qo = cOf(k) * LVN + Math.min(LVN, Math.ceil(b * LVN)) - 1; key[k] = qo; cnt[qo + 1]++; }
    for(let qo = 1; qo < cnt.length; qo++) cnt[qo] += cnt[qo - 1];
    for(let i = 0; i < n; i++){ const k = list ? list[i] : i, qo = key[k]; if(qo !== 255) ord[cnt[qo]++] = k; }
    let a = 0;
    for(let qo = 0; qo < cnt.length - 1; qo++){ const e = cnt[qo]; if(e === a) continue; const f = (qo % LVN + 1) / LVN, r = PX * (.17 + .33 * f);
      c.fillStyle = `rgba(${CSS[(qo / LVN) | 0]},${(.2 + .66 * f).toFixed(3)})`; c.beginPath();
      if(r < 1.45) for(let i = a; i < e; i++){ const k = ord[i]; c.rect(((k / rows) | 0) * PX + PX / 2 - r, (k % rows) * PX + PX / 2 - r, 2 * r, 2 * r); }
      else for(let i = a; i < e; i++){ const k = ord[i], x = ((k / rows) | 0) * PX + PX / 2, y = (k % rows) * PX + PX / 2; c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }
      c.fill(); a = e; } }
  { const c = off.begin(); paint(c, null, NC, k => bB[k] + dith((k / rows) | 0, k % rows), k => bC[k]); }
  /* water: rows under the bank mirror the sky above it, squeezed, dimmer, and broken by slow ripples */
  const WR = Math.max(0, rows - BANK - 1), wB = new Float32Array(cols * WR), wC = new Uint8Array(cols * WR);
  /* near reeds: stems that rise from below the frame at the sides, each with a drooping plume */
  const REEDS = []; { const r = mulberry(mix(p.seed + 77)), nR = phone ? 24 : 150, span = cols * (phone ? .46 : .2);
    for(let i = 0; i < nR; i++){ const s = r(), side = i % 2 ? 1 : -1, e = Math.pow(s, phone ? 1 : 1.5), x = side < 0 ? e * span : cols - 1 - e * span, tall = r() < .22;
      REEDS.push({x, h: ((phone ? 15 : 9) + (phone ? 6 : 8) * noise(x / 7 + 3, 1.5) + (tall ? 5 + 7 * r() : 3 * r())) * (1 - .6 * e * e), ph: r() * TAU, k: .7 + .6 * r(), pl: tall ? 2 + Math.round(2 * r()) : r() < .5 ? 1 : 0, cv: (r() - .35) * 7}); } }
  const WAVES = [[TS - .95, -1], [TS + .15, 1], [14.6, 1], [20.4, -1]];
  /* table along a flock (front to back) at clock T: place, the two axes of the sheet scaled to its half-width there, how far it is curled, thickness */
  function fill(tb, T, far, pack){
    for(let j = 0; j <= KT; j++){ const tau = TLEN * j / KT, u = T - tau, o = j * 16; centre(u, c0, far); centre(u + .12, c1, far);
      let vx = c1[0] - c0[0], vy = c1[1] - c0[1], vz = c1[2] - c0[2]; const vl = Math.hypot(vx, vy, vz) || 1; vx /= vl; vy /= vl; vz /= vl;
      let hx = -vz, hz = vx; const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;                                  /* level, across the line of flight */
      const nx = -vy * vx, ny = 1 - vy * vy, nz = -vy * vz, nl = Math.hypot(nx, ny, nz) || 1;                         /* up, square to the line of flight */
      /* the sheet stands on edge like a curtain for much of the time and lies flat at others; the lean runs back through the birds faster than they fly */
      const f = tau / TLEN, tw = T - .9 * tau, phi = .85 + .7 * Math.sin(TAU * tw / 13.1 + 1.3 + far) + .36 * Math.sin(TAU * tw / 5.3 + .3), cp = Math.cos(phi), sn = Math.sin(phi);
      /* width: a blunt front, widest a third of the way back, a tail; a neck that travels back along it, so it bulges, pinches and balloons */
      const un = ((T / 8.2 + far * .4) % 1) * 1.5 - .25, nk = (f - un) / .13, neck = Math.exp(-nk * nk);
      const half = WD0 * (far ? .6 : 1) * (.24 + .76 * Math.pow(Math.sin(Math.PI * Math.pow(f, .6)), .6)) * (1 + .18 * Math.sin(T / 3.7 + f * 2)) * (1 - .72 * neck) * (1 - pack) * c0[3] / 2;
      /* curl: the top of the curtain rolls over, sometimes most of the way round into a tube; the fold is where two layers lie over each other */
      const kap = Math.max(.08, 1.15 + .95 * Math.sin(TAU * (T / 9.4 - f * .7) + 2 + far * 2) + .5 * neck), thk = (phone ? 2.4 : 2) * (1 - .5 * pack) * c0[3];
      const ewx = hx * cp + nx / nl * sn, ewy = ny / nl * sn, ewz = hz * cp + nz / nl * sn, enx = -hx * sn + nx / nl * cp, eny = ny / nl * cp, enz = -hz * sn + nz / nl * cp;
      tb[o] = c0[0]; tb[o + 1] = c0[1]; tb[o + 2] = c0[2]; tb[o + 3] = ewx * half; tb[o + 4] = ewy * half; tb[o + 5] = ewz * half; tb[o + 6] = enx * half; tb[o + 7] = eny * half; tb[o + 8] = enz * half;
      tb[o + 9] = c0[4] * (1 + pack); tb[o + 10] = kap; tb[o + 14] = thk / Math.max(.5, half); tb[o + 15] = 1 / Math.max(.5, half); } }
  return tm => {
    const T = (tm - 14) * sp + THERO; fid++; nd = 0;
    /* events on the flock's common clock: the strike at TS */
    const cyc = T - Math.floor(T / CYC) * CYC, qs = cyc - TS;
    const flash = qs > 0 ? easeS(qs / .35) * Math.exp(-qs / 1.5) * 1.5 : 0;                                          /* burst apart, then close */
    const split = qs > 0 ? easeS(qs / .9) * (1 - easeS((qs - 2.6) / 3.2)) : 0;                                       /* torn in two, then drawn together */
    const pack = qs > 0 ? .2 * easeS(qs / 1.5) * (1 - easeS((qs - 3) / 3)) : 0;
    /* waves of agitation: a front of rolled birds (dark) crosses the whole sheet in under a second and the sheet recovers behind it.
       Two as the falcon stoops, starting at the end it comes for; two more in the wheeling with no falcon near. Each: where the front is, which way it runs */
    let nw = 0; for(const [t0, dir] of WAVES){ const a = cyc - t0; if(a > 0 && a < 1.9){ WV[nw * 2] = -.12 + 1.3 * a / .85; WV[nw * 2 + 1] = dir; nw++; } }
    fill(tab, T, 0, pack); fill(tabB, T + CYC / 2, 1, 0);
    const SV = split * (phone ? 10 : 15), A0 = 1.15 * Math.sqrt(5700 / N) / (1.43 * 1.43);
    for(let i = 0; i < N; i++){ const far = i >= NA, tb = far ? tabB : tab;
      const tau = Math.min(TLEN, Math.max(0, bT[i] + .16 * Math.sin(T * .9 + bPh[i]))), fj = tau / TLEN * KT, j = Math.min(KT - 1, fj | 0), u = fj - j, o = j * 16, o2 = o + 16, g = far ? 0 : bG[i];
      let a = bA[i]; const side = !far && a > SPL ? 1 : -1; a += side * g * flash * .7; const b = bTh[i] * (1 + g * flash * 3);
      const kp = tb[o + 10] + (tb[o2 + 10] - tb[o + 10]) * u, th = kp * a, sn = Math.sin(th), cs_ = Math.cos(th), rr = tb[o + 14] + (tb[o2 + 14] - tb[o + 14]) * u;
      const lw = sn / kp - b * rr * sn, ln = (1 - cs_) / kp + b * rr * cs_;                                           /* across the curled sheet: along the arc, and off it by the bird's place in the thickness */
      const ewz = tb[o + 5] + (tb[o2 + 5] - tb[o + 5]) * u, enz = tb[o + 8] + (tb[o2 + 8] - tb[o + 8]) * u;
      let x = tb[o] + (tb[o2] - tb[o]) * u + lw * (tb[o + 3] + (tb[o2 + 3] - tb[o + 3]) * u) + ln * (tb[o + 6] + (tb[o2 + 6] - tb[o + 6]) * u);
      let y = tb[o + 1] + (tb[o2 + 1] - tb[o + 1]) * u + lw * (tb[o + 4] + (tb[o2 + 4] - tb[o + 4]) * u) + ln * (tb[o + 7] + (tb[o2 + 7] - tb[o + 7]) * u);
      let z = tb[o + 2] + (tb[o2 + 2] - tb[o + 2]) * u + lw * ewz + ln * enz;
      if(side > 0 && SV){ x += MIR * SV * .7; y += SV * .75; z += SV * .5; }
      if(y < .3) y = .3; const sc = F / z, fx = CX + x * sc, fy = HZ - (y - EYE) * sc, cxp = Math.floor(fx), cyp = Math.floor(fy); let ux = fx - cxp, uy = fy - cyp; ux = clamp01((ux - .5) * 3.2 + .5); uy = clamp01((uy - .5) * 3.2 + .5);
      /* how dark this bird is: its size on screen, how much of the flat of its wings faces us, the wave passing over it */
      let wv = 0; if(!far) for(let n = 0; n < nw; n++){ const qo = tau / TLEN, d = WV[n * 2] - (WV[n * 2 + 1] > 0 ? qo : 1 - qo) - .1 * a; wv += d < 0 ? Math.exp(d / .025) : Math.exp(-d / .12); }
      let v = (.86 + .28 * hash2(i, Math.floor(tm * 10))) * A0 * sc * sc * (.3 + .7 * Math.abs(-sn * ewz + cs_ * enz) * (tb[o + 15] + (tb[o2 + 15] - tb[o + 15]) * u)) * (tb[o + 9] + (tb[o2 + 9] - tb[o + 9]) * u) * (1 + 10 * wv) * (.8 + .2 * Z0 / z);
      if(bS[i] && v < (phone ? .8 : .5)) v = (phone ? .8 : .5) * (tb[o + 9] > .5 ? 1 : tb[o + 9] * 2);
      add(cxp, cyp, v * (1 - ux) * (1 - uy)); add(cxp + 1, cyp, v * ux * (1 - uy)); add(cxp, cyp + 1, v * (1 - ux) * uy); add(cxp + 1, cyp + 1, v * ux * uy); }
    /* the peregrine: low and fast from the near side, wings tucked for the strike, out the far side and up */
    if(qs > -4.2 && qs < 3){ centre(T - qs - TSTAR, c0); const sx0 = c0[0] + MIR * 62, sy0 = 5, sz0 = 46; let x, y, z, s, tuck = 0;
      if(qs < 0){ const e = Math.pow(1 + qs / 4.2, 1.25); x = sx0 + (c0[0] - sx0) * e; y = sy0 + (c0[1] - sy0) * e + 2 * Math.sin(Math.PI * e); z = sz0 + (c0[2] - sz0) * e; tuck = qs > -1.6 ? 1 : 0; }
      else { const e = 1 - Math.exp(-qs / 1.1); x = c0[0] + MIR * 85 * e; y = c0[1] + 34 * e * e; z = c0[2] + 60 * e; }
      s = 1.05 * F / z; const beat = Math.floor(tm * 5) % 2 ? 1.25 : .7;
      bird(CX + x * F / z, HZ - (y - EYE) * F / z, tuck ? Math.max(2, s * .55) : Math.max(2.2, s), tuck ? 1 : beat, false, 7, true); }
    /* late birds: singles and twos that come over the camera and string out toward the roost while the sky is otherwise quiet */
    for(let i = 0, n = phone ? 8 : 16; i < n; i++){ const h1 = hash2(i * 7, p.seed), h2 = hash2(i * 13, p.seed + 5), qo = ((cyc - 35 - 13 * h1) % CYC + CYC) % CYC / 8; if(qo > 1) continue;
      const e = qo * (2 - qo), z = 22 + (RZ - 22) * e, x = (1 - e) * MIR * (phone ? 14 : 34) * (2 * h2 - 1) + e * RX + 4 * Math.sin(qo * 5 + h1 * 9) * (1 - qo), y = 3 + 2 * h1 + (9 + 6 * h2) * Math.sin(Math.PI * Math.min(1, qo * 1.15)) * (1 - .5 * qo) + .5 * Math.sin(qo * 19 + h2 * 20), s = .4 * F / z;
      const st = (Math.floor(tm * 10 + h2 * 40) % 7 + 7) % 7, cl = st >= 5, d = cl ? 0 : st === 4 ? .15 : st % 2 ? -.75 : .95;
      if(s < 1.5) add(Math.round(CX + x * F / z), Math.round(HZ - (y - EYE) * F / z), cl ? .7 : 1.4); else bird(CX + x * F / z, HZ - (y - EYE) * F / z, s, d, cl, 6, false); }
    /* the near party: a dozen starlings cross low in front of the glow, close enough to be birds. Each flaps in a burst, glides, shuts its wings */
    { const q0 = ((cyc < 12 ? cyc + CYC : cyc) - 33) / 6.5; if(q0 > -.5 && q0 < 1.5) for(let i = 0, n = phone ? 7 : 12; i < n; i++){ const h1 = (i + hash2(i * 5 + 1, p.seed + 9)) / n, h2 = hash2(i * 11 + 2, p.seed + 3), h3 = hash2(i * 17 + 3, p.seed + 7);
        const S = (phone ? 8 : 10) + (phone ? 3.5 : 6.5) * h3, qo = q0 * (.9 + .25 * h3) + .62 * (h1 - .5), dir = -MIR;
        const bx = (dir > 0 ? -.12 + 1.24 * qo : 1.12 - 1.24 * qo) * cols, by = HZ - (phone ? 8 : 7) - (phone ? 18 : 30) * ((i * 5 % n + h2) / n) - 4 * Math.sin(qo * 5 + h1 * 12) - 6 * qo;
        const st = ((Math.floor(tm * 10 + h1 * 90) % 14) + 14) % 14;                                                                /* 1.4 s: ten 0.1 s wing poses, a glide, wings shut */
        star(bx, by, S, dir, st < 10 ? [1, .8, .5, .32, .55, .85, 1, .7, .4, .6][st] : st < 12 ? .9 : 0, st >= 12 ? 1 : 0, (h2 - .4) * .5 + .12 * Math.cos(qo * 5 + h1 * 12), st === 10 || st === 11); } }
    /* near reeds, swaying: gusts cross the frame, taller stems bend further */
    for(const r of REEDS){ const gust = noise(r.x / 40 - tm * .22, 3.3), sway = r.cv + (.6 + 2.4 * gust) * (.6 + .4 * Math.sin(tm * r.k * 1.1 + r.ph + r.x * .05)), by = phone ? BOT + 8 : rows + 1, n = Math.round(r.h); let px = 0, py = 0;
      for(let i = 0; i <= n; i++){ const f = i / n; px = Math.round(r.x + sway * f * f); py = by - i; add(px, py, 9); }
      for(let i = 1; i <= r.pl; i++){ const qox = px + Math.round(i * .9 + sway * .2), qy = py - 1 + Math.round(i * i * .3); add(qox, qy, 9); add(qox, qy - 1, 1); } }
    /* paint: still scene, then every touched sky cell again (cleared first), then the water */
    off.blit();
    let ns = 0; ax.globalCompositeOperation = 'destination-out'; ax.fillStyle = '#000'; ax.beginPath();
    for(let i = 0; i < nd; i++){ const k = dirty[i], y = k % rows; if(y > BANK) continue; dirty[ns++] = k; ax.rect(((k / rows) | 0) * PX, y * PX, PX, PX); }
    ax.fill(); ax.globalCompositeOperation = 'source-over';
    paint(ax, dirty, ns, k => bB[k] * Math.exp(-od[k]) + dith((k / rows) | 0, k % rows), k => bC[k]);
    for(let x = 0; x < cols; x++){ const o = x * WR, ko = x * rows + BANK + 1;
      for(let d = 0; d < WR; d++){ const yy = BANK + 1 + d, rp = noise(x / (9 + d * .9) + tm * .05, d * .83 - tm * .16 + 11), rp2 = noise(x / 3.3 - tm * .12, d * 1.7 + 4);
        const ys = HZ - 1 - Math.max(0, Math.round(d * 1.3 + d * d * .26 + (rp - .5) * (2 + d * .6))), xs = Math.min(cols - 1, Math.max(0, x + Math.round((rp2 - .5) * 2.4))), ks = xs * rows + (ys < TOP ? TOP : ys);
        let so = 0; for(let j = -2; j <= 2; j++){ const kj = ks + j * (j & 1 ? rows : 2); if(kj >= 0 && kj < NC && mark[kj] === fid) so += od[kj]; }                 /* the flock mirrored as a soft shape: a few sky cells averaged */
        let b = bB[ks] * Math.exp(-Math.min(2.2, so * .22)) * (.9 - .32 * d / WR) * (.62 + .6 * rp);
        const k = ko + d; if(mark[k] === fid) b *= Math.exp(-od[k]);
        wB[o + d] = b > 0 ? b + dith(x, yy) : 0; wC[o + d] = bC[ks]; } }
    paintW();
  };
  function paintW(){ cnt.fill(0); const n = cols * WR;
    for(let i = 0; i < n; i++){ const b = wB[i]; if(b < .05){ key[i] = 255; continue; } const qo = wC[i] * LVN + Math.min(LVN, Math.ceil(b * LVN)) - 1; key[i] = qo; cnt[qo + 1]++; }
    for(let qo = 1; qo < cnt.length; qo++) cnt[qo] += cnt[qo - 1];
    for(let i = 0; i < n; i++){ const qo = key[i]; if(qo !== 255) ord[cnt[qo]++] = i; }
    let a = 0; const y0 = (BANK + 1) * PX;
    for(let qo = 0; qo < cnt.length - 1; qo++){ const e = cnt[qo]; if(e === a) continue; const f = (qo % LVN + 1) / LVN, r = PX * (.17 + .33 * f);
      ax.fillStyle = `rgba(${CSS[(qo / LVN) | 0]},${(.2 + .66 * f).toFixed(3)})`; ax.beginPath();
      if(r < 1.45) for(let i = a; i < e; i++){ const k = ord[i]; ax.rect(((k / WR) | 0) * PX + PX / 2 - r, y0 + (k % WR) * PX + PX / 2 - r, 2 * r, 2 * r); }
      else for(let i = a; i < e; i++){ const k = ord[i], x = ((k / WR) | 0) * PX + PX / 2, y = y0 + (k % WR) * PX + PX / 2; ax.moveTo(x + r, y); ax.arc(x, y, r, 0, TAU); }
      ax.fill(); a = e; } }
}
/* 14 fireflies.
   Adapted from ascii.rest piece 'fireflies' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: flies wandering on slow waves, each flashing with a quick rise and a slow fade, a flash that starts at one fly and
   runs fly to fly through the others, the short trail where a fly was a moment ago, tufts of blades fanning from one root, a far line of
   trees under a night sky.
   Rebuilt to read like low-light footage of Genji fireflies (Luciola cruciata) over a small woodland stream.
   Place, from photographs: a stream winding away from the camera to a vanishing
   point between banks of ferns and sedge, tree trunks, saplings and branches at three distances, the far ones paler in the mist, a strip of
   dusk sky where the canopy opens over the water, stones in the stream. The picture is a small 3D model seen from a footbridge: every cell
   knows how far away its surface is, what it is made of and which way it faces. All of it is faintly visible in cool dusk light even when
   no fly is lit; the water shows the sky as a smooth sheen in its quiet reaches and as glints where it runs over stones.
   Light: the flies are the only lamps. Each lit fly adds light to the surfaces within about two metres of it (half strength at 0.4 m),
   falling off with distance and with the angle of the surface (leaves also glow when lit from behind), so a flash shows the fronds, bark or
   gravel next to it and nothing else; a fly behind a trunk or a frond is hidden by it; its mirror image shows on water only, as a thin streak
   broken by the ripples. A fly is a small bright core in a soft halo of lit air, a few close to the camera are soft discs several cells
   wide; one that moves leaves a thin short streak, as in slow-shutter video.
   Behaviour, from published work on this species: flying males flash in loose unison, one slow pulse every 2 s (western Japan) to 4 s
   (eastern Japan), lit for about two thirds of the beat (1.3 s of 1.9 s was measured in Kyoto; that share of the beat is used here at
   every pace); females sit in the grass and give single pulses that are not in step. Here a quarter of the fliers keep their own time, and the
   rest fall out of step and back in: the unison starts at one fly and spreads outward through the others, holds for a while, then loosens.
   Flight is a slow wander with spurts and near-hovers; males follow the stream or roam the wood. One fly in five sits on a frond or a blade.
   Data: fireflies = tokens (all of them are in the scene; one that is dark, behind a trunk or past the edge is not seen at that moment);
   the time between pulses = 7-day trend (4 s down to 2 s); how far the flight wanders = cache miss. Colour carries no data. */
function tFly(env, X){
  const PART = 15;                                                                                  /* what is drawn: 1 the flies' own glow, 2 the surfaces they light, 4 their mirror images, 8 water and mist (kept for measuring) */
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, PX = env.P, N = cols * rows, U = 5 / PX;
  const S = mulberry(mix(p.seed + 14)), cl = (v, a, b) => v < a ? a : v > b ? b : v;
  /* palette: 0 / 1 the two data colours (not used here); 2 dusk sky, 3 stars, 4 mist, 5 far mist, 6 ground at night, 7 sky on the water, 8 glints,
     9 stone at night; 10..14 leaves by firefly light; 15..18 bark and stone; 19..22 ground; 23 lit air, 24 the disc of a fly, 25 its core,
     26 the hot centre; 27 / 28 mirror images */
  const PAL = [BLUE, OR, [98, 118, 178], [214, 220, 236], [98, 134, 140], [80, 108, 140], [60, 92, 82], [92, 112, 168], [160, 180, 210], [104, 120, 136],
               [24, 62, 28], [36, 88, 34], [56, 118, 40], [82, 150, 46], [112, 178, 54],
               [50, 58, 34], [78, 92, 44], [108, 126, 54], [138, 158, 68],
               [40, 58, 30], [62, 90, 38], [90, 124, 46], [118, 156, 56],
               [104, 170, 46], [156, 216, 52], [204, 242, 92], [238, 250, 176], [104, 172, 56], [170, 222, 84]];
  const mg = phone ? 0 : Math.max(0, (env.W - 1240) / 2 / PX), TOP = phone ? Math.round(11 * U) : Math.round(rows * .47), BOT = phone ? Math.round(65 * U) : rows;
  /* the camera: 2 m above the water (a footbridge), looking level; yH = the row of the horizon, F = cells per metre at one metre */
  const yH = TOP + Math.round((BOT - TOP) * (phone ? .36 : .42)), hgt = yH - TOP, CAM = 2, F = (BOT - yH) * (phone ? 3.6 : 3.2) / CAM, cx = cols * (phone ? .5 : .56), ZFOG = 28;
  const f1 = 1.2 + .6 * p.off, f2 = S() * TAU, Xc = z => (phone ? .2 : .8) - .02 * z + (phone ? .8 : 1.5) * Math.sqrt(z / 3) * Math.sin(2.6 * Math.log(z) + f1), hw = z => (phone ? 1.2 : 2.1) * (1 + .25 * Math.sin(z * .4 + f2));
  /* the model, per cell: Z distance, ZF = Z / F, AL how much light it returns, NX / NY which way it faces (right, up; on water: place across the
     stream and how broken the surface is), MT what it is (1 leaf, 2 bark, 3 ground, 4 water, 5 stone), WE how close a water cell is to the bank */
  const Z = new Float32Array(N).fill(1e9), ZF = new Float32Array(N), AL = new Float32Array(N), NX = new Float32Array(N), NY = new Float32Array(N), WE = new Float32Array(N);
  const MT = new Uint8Array(N), SB = new Float32Array(N), SC = new Uint8Array(N), WB = new Float32Array(N), WC = new Uint8Array(N), LB = new Float32Array(N), Lb = new Float32Array(N), Lc = new Uint8Array(N);
  const perch = [], gapX = cx + Xc(60) * F / 60;
  /* what the canvas mask leaves of a row (the page fades the canvas out toward its top), and its inverse, to keep the upper band readable */
  const vis = new Float32Array(N);
  for(let x = 0; x < cols; x++){ const inCol = phone || (x >= mg - 1 && x <= cols - mg), ed = TOP + 5 + 5 * noise(x * .09, 61.5); for(let y = 0; y < rows; y++){ const u = 1 - (y + .5) / rows, mk = u < .14 ? 1 : u < .46 ? 1 - .45 * (u - .14) / .32 : .55 * (1 - (u - .46) / .54);
    let v = Math.min(2.1, 1 / Math.max(.05, mk)); if(inCol) v *= y < TOP - 1 ? 0 : y > ed ? 1 : sstep(TOP - 1, ed, y); if(phone) v *= 1 - sstep(BOT - 1, BOT + 7, y); vis[x * rows + y] = v; } }
  /* dusk light. LM = how bright the mist is behind a column (brightest where the stream leaves the wood); every surface is seen through the
     mist in front of it, so far things are pale and near things dark: fog(z) of the mist's light plus the rest of the surface's own */
  const LM = new Float32Array(cols); for(let x = 0; x < cols; x++) LM[x] = .34 + .36 * Math.exp(-(((x - gapX) / (cols * (phone ? .6 : .3))) ** 2));
  const fog = z => 1 - Math.exp(-z / ZFOG), leaf = (x, y, o) => .12 + .76 * (.6 * noise((x + y) * .37 + o, (x - y) * .37 + o * 1.7) + .4 * noise(x * .9 + o, y * .9));
  /* ---- the far backdrop: mist under the canopy, one opening of dusk sky where the canopy parts over the stream, far bushes; every edge is broken into leaves ---- */
  for(let x = 0; x < cols; x++){ const bh = (1.5 + 3.5 * noise(x * .08 + 3, 9.5)) / U;
    for(let y = 0; y <= yH + 1; y++){ const k = x * rows + y, up = yH - y; let c = up > hgt * .5 ? 5 : 4, b = LM[x] * Math.exp(-Math.max(0, up) / (hgt * .8)) * (.85 + .3 * noise(x * .03 + 7, y * .06));
      if(Math.abs(x - gapX) < cols * (phone ? .4 : .15)){ const gy = (up - hgt * .58) / (hgt * .5), gw = cols * (phone ? .2 : .075) * (.55 + .45 * cl(up / hgt, 0, 1.2)), gx = (x - gapX - cols * .012 * Math.sin(up * .11 + f2)) / gw, an = Math.atan2(gy, gx);
        const e = 1 - (gx * gx + gy * gy) * (.75 + .5 * noise(an * 1.3 + 9, 4.5)), ps = cl((e * 1.4 - leaf(x, y, 3) + .3) * 2.2, 0, 1);
        if(ps > 0){ const sk = (.42 + .2 * sstep(hgt, 3, up)) * ps; if(sk > b){ b = sk; c = 2; } if(e > .35 && hash2(x * 7 + 1, y * 13) > .985){ b = .6 + .3 * hash2(x, y * 3); c = 3; } } }
      if(up < bh && noise(x * .6, y * .6 + 2) < .72) b *= .5;
      SB[k] = b; SC[k] = c; } }
  /* ---- the ground plane: water where the stream runs (quiet reaches and broken ones), earth and litter beside it ---- */
  for(let x = 0; x < cols; x++) for(let y = yH + 2; y < rows; y++){ const k = x * rows + y, z = CAM * F / (y - yH), xw = (x - cx) * z / F, xr = xw - Xc(z), e = Math.abs(xr) - hw(z) - .45 * (noise(xw * 1.3 + 11, z * 1.3) - .5), f = fog(z);
    Z[k] = z; ZF[k] = z / F;
    if(e < 0){ MT[k] = 4; AL[k] = .04; WE[k] = sstep(-.45, 0, e); NX[k] = xr; NY[k] = sstep(.5, .68, noise(z * .33 + 20, 3.5 + .15 * xr)); SB[k] = 0; }
    else { const g = noise(xw * 5.2 + 3, z * 5.2), g2 = noise(xw * 1.1, z * 1.1 + 5); MT[k] = 3; AL[k] = (.1 + .3 * g) * (.7 + .5 * g2) + .2 * sstep(.5, 0, e);                 /* paler gravel at the water's edge */
      NX[k] = (noise(xw * 3 + .3, z * 3) - noise(xw * 3 - .3, z * 3)) * 1.6; NY[k] = .86;
      SB[k] = f * LM[x] * .6 + (1 - f) * Math.max(0, g * g2 - .24) * .5 * (.45 + .55 * sstep(0, .7, e)); SC[k] = f > .5 ? 4 : 6; } }
  /* ---- things that stand on the ground, drawn from far to near: trunks and saplings, ferns, sedge, stones. sa = the surface's own dusk light ---- */
  const surf = (x, y, z, m, al, nx, ny, sa, sc) => { x = Math.round(x); y = Math.round(y); if(x < 0 || y < 0 || x >= cols || y >= rows) return; const k = x * rows + y; if(z > Z[k] + .02) return;
    const f = FG; Z[k] = z; ZF[k] = z / F; MT[k] = m; AL[k] = al; NX[k] = nx; NY[k] = ny; SB[k] = f * LM[x] * .85 + (1 - f) * sa; SC[k] = f > .5 ? 4 : sc; WE[k] = 0; };
  const things = []; let FG = 0;                                                                      /* FG: the mist in front of the thing being drawn */
  /* a limb: grows from (x, y) at angle a from upright, bends back toward the light, thins, and forks twice on the way */
  const limb = (x, y, a, len, w, z, dep, id) => { const n = Math.ceil(len), k1 = Math.round(n * (.3 + .2 * hash2(id, 1))), k2 = Math.round(n * (.6 + .25 * hash2(id, 2)));
    for(let qo = 0; qo <= n; qo++){ const u = qo / n, ww = w * (1 - .8 * u); a += (noise(id + qo * .23, id * .7) - .5) * .32 - a * .03; x += Math.sin(a); y -= Math.cos(a);
      for(let d = -Math.floor(ww); d <= Math.floor(ww); d++) surf(x + d * Math.cos(a), y + d * Math.sin(a), z, 2, .4, cl(Math.sin(a) * .5 + d * .2, -.9, .9), .4, .04, 5);
      if(dep > 1 && (qo === k1 || qo === k2) && n > 5) limb(x, y, a + (qo === k1 ? 1 : -1) * (hash2(id, 3) < .5 ? -1 : 1) * (.5 + .5 * hash2(id + qo, 4)), len * (1 - u) * (.6 + .3 * hash2(id + qo, 5)), Math.max(.5, ww * .7), z, dep - 1, id * 1.7 + qo); } };
  const trunk = t => { FG = fog(t.z); const s = F / t.z, yb = yH + CAM * s, r = t.r * s, side = gapX > cx + t.X * s ? 1 : -1, near = t.z < 17, xAtH = h => cx + t.X * s + (t.lean * h + t.bow * .25 * Math.sin(h * .4)) * s;
    for(let y = Math.min(rows - 1, Math.round(yb)); y >= 0; y--){ const h = (yb - y) / s, w = Math.max(.5, r * (1 - Math.min(.6, h * .05)) + r * 1.1 * Math.exp(-h / (t.r * 1.6 + .05))), xc = xAtH(h);
      for(let x = Math.round(xc - w); x <= Math.round(xc + w - .01); x++){ const u = cl((x - xc) / w, -1, 1), fur = near ? noise(u * t.r * 30 + t.id, h * 1.3 + t.id) : .5, rd = 1 - Math.abs(2 * fur - 1), moss = near && h < t.moss * (.4 + 1.2 * noise(x * .23 + t.id, 1.5)) && noise(x * .3 + t.id, y * .3) > .38;
        surf(x, y, t.z - t.r * Math.sqrt(1 - u * u), moss ? 1 : 2, moss ? (.2 + .4 * hash2(x, y)) * (.5 + rd) : .22 + .6 * rd * rd, cl(u * .9 + (fur - .5) * .7, -.98, .98), 0, .02 + (.05 + .2 * rd) * Math.max(0, u * side) + (moss ? .05 : 0), 5); } }
    for(let j = 0; j < t.br; j++){ const h0 = 1.5 + 4.5 * hash2(t.id * 5, j + 2), d = hash2(t.id * 3, j + 5) < .5 ? -1 : 1;
      limb(xAtH(h0) + d * r * .5, yb - h0 * s, d * (.5 + .7 * hash2(t.id * 2, j)), (1 + 2.6 * hash2(t.id, j + 8)) * s, Math.max(.5, r * .4), t.z, t.z < 9 ? 3 : t.z < 20 ? 2 : 1, t.id + j * 7); } };
  const fern = t => { FG = fog(t.z); const s = F / t.z, bx = cx + t.X * s, by = yH + CAM * s, nf = t.n;
    for(let j = 0; j < nf; j++){ const a = ((j + .5) / nf - .5) * 2.7 + (S() - .5) * .3, L = t.size * (.6 + .4 * S()) * s * (.6 + .4 * S()), dr = .3 + .55 * Math.abs(Math.sin(a)) + .2 * S(), st = Math.max(6, Math.ceil(L / .7)), al0 = .25 + .7 * S() * S(), lit = (.5 + .5 * S()) * (t.big ? 1.5 : 1);
      let ox = bx, oy = by;
      for(let i = 1; i <= st; i++){ const qo = i / st, px = bx + L * Math.sin(a) * (qo + .12 * qo * qo), py = by - L * (Math.cos(a) * qo - dr * qo * qo), tx = px - ox, ty = py - oy, tl = Math.hypot(tx, ty) || 1, nx = -ty / tl, ny = tx / tl;
        const pl = L * .2 * Math.min(1, qo * 5) * Math.pow(1 - qo, .6) + .4;
        surf(px, py, t.z - .06, 1, .8 * al0 + .15, nx * .2, .5, (.34 + .3 * qo) * lit, 6);
        if(i % 2 === 0 || L < 9) for(let sd = -1; sd <= 1; sd += 2) for(let d = 1; d <= pl; d++) surf(px + sd * nx * d + tx / tl * d * .45, py + sd * ny * d + ty / tl * d * .45, t.z - .05, 1, al0 * (.35 + .65 * hash2(i * 7 + j, sd + 3)) * (1 - .35 * d / pl), cl(sd * nx * .6, -.9, .9), cl(.35 - sd * ny * .45, -.9, .9), (sd * ny < 0 ? .3 + .26 * qo : .1) * lit * (.6 + .6 * hash2(i + d, j)), 6);
        if(i === Math.round(st * .55) && t.z < 20) perch.push([(px - cx) / s, CAM - (py - yH) / s + .03, t.z - .1]);
        ox = px; oy = py; } } };
  const sedge = t => { FG = fog(t.z); const s = F / t.z, bx = cx + t.X * s, by = yH + CAM * s;
    for(let j = 0; j < t.n; j++){ const ln = (S() - .5) * 2.2 + t.lean, h = t.h * (.55 + .45 * S()) * s, al = .45 + .5 * S(), st = Math.max(3, Math.ceil(h)), o = (S() - .5) * .3 * s;
      for(let i = 0; i <= st; i++){ const qo = i / st, px = bx + o + ln * h * .55 * qo * qo, py = by - h * qo * (1 - .3 * Math.abs(ln) * qo);
        surf(px, py, t.z - .03, 1, al * (.6 + .5 * Math.sin(Math.PI * qo)), cl(ln * .5 * qo, -.9, .9), .3, (.1 + .34 * qo) * al, 6);
        if(i === st && j === 0 && t.z < 20) perch.push([(px - cx) / s, CAM - (py - yH) / s, t.z - .05]); } } };
  const stone = t => { FG = fog(t.z); const s = F / t.z, a = t.r * s, b = a * t.fl, bx = cx + t.X * s, by = yH + CAM * s;
    for(let x = Math.floor(bx - a); x <= bx + a; x++) for(let y = Math.floor(by - b); y <= by + .5; y++){ const u = (x - bx) / a, v = (by - y) / b, d = u * u + v * v; if(d >= 1) continue;
      const top = v > .55 + .2 * noise(x * .3, t.id); surf(x, y, t.z - t.r * Math.sqrt(1 - d) * .6, top && t.moss ? 1 : 5, top && t.moss ? .5 + .3 * hash2(x, y) : .3 + .3 * noise(x * .7 + t.id, y * .7), u * .8, v * .75, .03 + .2 * v * v * (.6 + .4 * hash2(x, y)), 9); }
    for(let x = Math.floor(bx - a * 1.3); x <= bx + a * 1.3; x++) for(let y = Math.round(by + 1); y <= by + 1 + a * .5; y++){ if(x < 0 || x >= cols || y >= rows) continue; const k = x * rows + y; if(MT[k] === 4) NY[k] = Math.max(NY[k], 1 - Math.abs(x - bx) / (a * 1.3)); } };                    /* broken water below a stone */
  { const T = (X_, z, r, lean, br) => things.push({f: trunk, z, X: X_, r, lean: lean === undefined ? (S() - .5) * .1 : lean, bow: S() - .5, id: S() * 90, moss: .3 + .9 * S(), br: br === undefined ? (z < 20 ? 1 + Math.floor(S() * 3) : 0) : br}), xAt = (xs, z) => (xs - cx) * z / F, dry = (X_, z, m) => Math.abs(X_ - Xc(z)) > hw(z) + m;
    const free = (X_, z, gap) => !things.some(t => t.f === trunk && t.z < 17 && Math.abs(t.X * F / t.z - X_ * F / z) < gap * U);
    if(!phone){ T(xAt(Math.max(8, mg * .5), 4.4), 4.4, .3); T(xAt(cols - Math.max(7, mg * .45), 5), 5, .27); }
    T(Xc(4.3) - hw(4.3) - 1, 4.3, phone ? .22 : .42, .05, 2); T(Xc(6.5) + hw(6.5) + 1.2, 6.5, phone ? .2 : .34, -.14, 3);
    for(let i = 0, n = 0; i < 80 && n < (phone ? 2 : 6); i++){ const z = 4 + 3 * S(), X_ = xAt(S() * cols, z), r = .14 + .3 * S() * S(); if(dry(X_, z, r + .8) && free(X_, z, 26)){ T(X_, z, r, (S() - .5) * .3); n++; } }                      /* near */
    for(let i = 0, n = 0; i < 160 && n < (phone ? 5 : 16); i++){ const z = 7.5 + 9 * S(), X_ = xAt(S() * cols, z), r = .07 + .3 * S() * S(); if(dry(X_, z, r + .6) && free(X_, z, 6 + 14 * S())){ T(X_, z, r, (S() - .5) * .34); n++; } }                        /* middle */
    for(let i = 0; i < (phone ? 34 : 130); i++){ const z = 18 + 45 * S(), xs = S() * cols, X_ = xAt(xs, z); if(dry(X_, z, .5) && noise(xs * .05 / U, z * .08) > .25 + .45 * S()) T(X_, z, .05 + .45 * S() * S() * S(), (S() - .5) * .3, S() < .45 ? 1 : 0); }                                         /* far */
    for(let i = 0; i < (phone ? 6 : 22); i++){ const z = 4.5 + 14 * S(), X_ = xAt(S() * cols, z); if(dry(X_, z, .4)) T(X_, z, .025 + .03 * S(), (S() - .5) * .5, 1 + Math.floor(S() * 2)); }                                    /* leaning saplings */
    for(let i = 0, n = 0; i < 2000 && n < (phone ? 34 : 130); i++){ const big = n < (phone ? 4 : 12), z = big ? 3.35 + 2.2 * S() : 4 + 18 * Math.pow(S(), 1.6), bank = big || S() < .4, sd = S() < .5 ? -1 : 1, X_ = bank ? Xc(z) + sd * (hw(z) + (big ? .3 + 2.6 * S() : .5 + 1.5 * S() * S() + z * .03)) : xAt(S() * cols, z);
      if(dry(X_, z, .3)){ things.push({f: fern, z, X: X_, n: big ? 5 + Math.floor(S() * 3) : 6 + Math.floor(S() * 6), size: (big ? 1.1 : .45) + .6 * S(), big}); n++; } }
    for(const sd of [-1, 1]) for(let z = 3.3 + S() * .3; z < 15; z += (.12 + .25 * S()) * (1 + z * .1)) if(S() < .8){ const X_ = Xc(z) + sd * (hw(z) + .25 * S() - .1); things.push({f: sedge, z, X: X_, n: 5 + Math.floor(S() * 7), h: .35 + .7 * S() * S(), lean: -sd * .5}); }
    for(let i = 0; i < (phone ? 5 : 11); i++){ const z = 4 + 16 * S() * S(), inW = i % 4 !== 3, X_ = Xc(z) + (inW ? (S() - .5) * 1.5 * hw(z) : (S() < .5 ? -1 : 1) * (hw(z) + .3 * S())); things.push({f: stone, z, X: X_, r: .18 + .32 * S(), fl: .45 + .3 * S(), id: S() * 50, moss: S() < .6}); }
    things.sort((a, b) => b.z - a.z); for(const t of things) t.f(t);
    for(let x = 0; x < cols; x++){ const cy = hgt * (.32 + .6 * noise(x * .035 + 3, 7.5)); for(let y = 0; y <= yH; y++){ const up = yH - y, k = x * rows + y; if(up > cy - 6 / U && SC[k] !== 2 && SC[k] !== 3 && sstep(cy - 6 / U, cy + 6 / U, up) > leaf(x, y, 9)) SB[k] *= .25; } } }                      /* leaves in front of the upper trunks */
  /* a painter that draws like the kit's round dots, without the kit's per-colour index buffers (one sort buffer for the whole piece) */
  const NK = PAL.length * LV, ord = new Int32Array(N), kb = new Int16Array(N), cnt = new Int32Array(NK + 1), pos = new Int32Array(NK);
  const paint = (c, gb, gc, gain, halo) => { cnt.fill(0);
    for(let k = 0; k < N; k++){ const a = gb[k]; if(a < .05){ kb[k] = -1; continue; } const key = gc[k] * LV + Math.min(LV, Math.ceil(a * LV)) - 1; kb[k] = key; cnt[key + 1]++; }
    for(let i = 0; i < NK; i++){ cnt[i + 1] += cnt[i]; pos[i] = cnt[i]; }
    for(let k = 0; k < N; k++) if(kb[k] >= 0) ord[pos[kb[k]]++] = k;
    for(let key = 0; key < NK; key++){ const a0 = cnt[key], a1 = cnt[key + 1]; if(a1 === a0) continue; const col = PAL[(key / LV) | 0], f = (key % LV + 1) / LV, rgb = `${col[0]},${col[1]},${col[2]}`;
      if(halo && f > .85){ const hs = PX * 2.2; c.fillStyle = `rgba(${rgb},${(.1 * gain).toFixed(3)})`; c.beginPath();
        for(let i = a0; i < a1; i++){ const k = ord[i], x = ((k / rows) | 0) * PX + PX / 2, y = (k % rows) * PX + PX / 2; c.moveTo(x + hs / 2, y); c.arc(x, y, hs / 2, 0, TAU); } c.fill(); }
      const r = PX * (.17 + .33 * f); c.fillStyle = `rgba(${rgb},${((.2 + .66 * f) * gain).toFixed(3)})`; c.beginPath();
      if(r < 1.45) for(let i = a0; i < a1; i++){ const k = ord[i]; c.rect(((k / rows) | 0) * PX + PX / 2 - r, (k % rows) * PX + PX / 2 - r, 2 * r, 2 * r); }
      else for(let i = a0; i < a1; i++){ const k = ord[i], x = ((k / rows) | 0) * PX + PX / 2, y = (k % rows) * PX + PX / 2; c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }
      c.fill(); } };
  /* the still part, painted once: backdrop, night ground, silhouettes. Inside the text column nothing is drawn above the open band. */
  const stat = offscreen(env);
  for(let x = 0; x < cols; x++) for(let y = 0; y < rows; y++){ const k = x * rows + y; SB[k] = SB[k] > .02 ? Math.min(1, Math.max(0, SB[k] * vis[k] + dith(x, y))) : 0; }
  paint(stat.begin(), SB, SC, 1, false);
  /* ---- water and mist, redrawn ten times a second. Quiet reaches mirror the dusk sky as a smooth sheen; broken ones (riffles, below stones)
     are dark with glints that are brightest in the middle and fade toward their ends; the water darkens under the banks ---- */
  const mist = (xw, z, t) => Math.max(0, noise(xw * .22 + t * .035 + 40, z * .3 + 17) - .42) * 1.7;
  let wq = -1e9;
  const water = tq => { wq = tq; WB.fill(0); if(!(PART & 8)) return; const fl = tq * .55 * sp;
    for(let x = 0; x < cols; x++) for(let y = yH + 2; y < rows; y++){ const k = x * rows + y, m = MT[k]; if(m !== 4 && m !== 3) continue; const z = Z[k], xw = (x - cx) * ZF[k], v = Math.min(1.6, vis[k]);
      if(m === 4){ const xr = NX[k], rf = NY[k], f = fog(z), calm = .42 * (.55 + .9 * noise(xr * .8 + 3, z * .9 + fl * .25)), n = noise(xr * 1.7 + 2.2 * noise(z * 1.3 + 5, xr * .9), z * 5 + fl * 2.2), g = n > .52 ? (n - .52) / .48 : 0;
        let b = calm * (1 - rf) + rf * (.07 + .95 * Math.pow(g, 1.3)); b = (f * (LM[x] + .12) + (1 - f) * b) * (1 - .7 * WE[k] * (1 - f));
        WB[k] = Math.min(1, b * v); WC[k] = rf > .4 && g > .45 ? 8 : 7; }
      if(z > 6){ const d = mist(xw, z, tq) * sstep(6, 12, z) * (1 - sstep(40, 60, z)) * LM[x] * .9 * v; if(d > WB[k]){ WB[k] = d; WC[k] = 4; } } }
    for(let k = 0; k < N; k++) if(WB[k] > .02) WB[k] = Math.max(0, WB[k] + dith((k / rows) | 0, k % rows)); };
  /* ---- the fireflies ---- */
  const NF = Math.round(D.nPart * .11), NN = Math.min(7, Math.max(2, Math.round(NF * .06))), CZ = [4.5, 6, 8, 11, 15, 21, 30], nSit = Math.min(perch.length, Math.round(NF * .2)), TB = 4 - 2 * D.trendK, wan = 1 + D.jitter * .35;
  const yTop = z => CAM + (yH - TOP - 5) * z / F;                                                       /* the highest a fly at this distance can be and still be in the open band */
  const flies = Array.from({length: NF}, (_, i) => { const r = () => X.rnd(), sit = i < nSit, near = !sit && i < nSit + NN, roam = !sit && !near && !phone && r() < .22, cz = CZ[Math.floor(r() * CZ.length)], z0 = near ? 2.3 + 1.3 * r() : roam ? 5 + 24 * r() : Math.max(3.8, cz * (1 + .36 * (r() + r() - 1)));               /* a few close to the camera; most gather in loose groups along the stream; some roam the wood */
    const f = {sit, roam, near, z0, za: near ? .5 : 2 + z0 * .06, x0: roam ? (r() * cols - cx) * z0 / F : near ? (r() - .5) * 2.4 : (r() + r() - 1) * 1.1, y0: near ? .8 + .9 * r() : .25 + 1.6 * r() * r(), w: [.1 + .2 * r(), .22 + .25 * r(), .06 + .1 * r(), .25 + .3 * r()], p: [r() * TAU, r() * TAU, r() * TAU, r() * TAU],
      wa: .45 + .4 * r(), ww: .25 + .35 * r(), wp: r() * TAU, o: r() - .5, jit: (r() - .5) * .2, h: r(), per: 2.6 + 2.8 * r()};
    if(sit){ const qo = perch[Math.floor(r() * perch.length)]; f.X = qo[0]; f.Y = qo[1]; f.Z = qo[2]; } return f; });
  const o3 = [0, 0, 0];
  const place = (f, t, o) => { if(f.sit){ o[0] = f.X; o[1] = f.Y; o[2] = f.Z; return; }
    const s = t * sp + f.wa / f.ww * Math.sin(f.ww * t * sp + f.wp), z = Math.max(f.near ? 2 : 3.5, f.z0 + f.za * Math.sin(f.w[2] * s + f.p[2]) + .3 * f.za * Math.sin(f.w[1] * .6 * s + f.p[3]));
    o[2] = z; o[0] = (f.roam ? f.x0 : Xc(z) + f.x0 * (hw(z) + 1.1)) + 1.3 * wan * Math.sin(f.w[0] * s + f.p[0]) + .45 * wan * Math.sin(f.w[1] * s + f.p[1]);
    o[1] = cl(f.y0 + .32 * Math.sin(f.w[3] * s + f.p[3]) + .13 * Math.sin(f.w[0] * 2.3 * s + f.p[1]), .1, yTop(z)); };
  /* the pulse: a rise over the first quarter, then a slow fall; DF of the beat is lit */
  const DF = .68, RISE = .27 * DF, pulse = ph => ph < RISE ? easeS(ph / RISE) : ph < DF ? 1 - easeS((ph - RISE) / (DF - RISE)) : 0;
  /* falling into step: every CYC seconds the unison starts again at one fly (hashed from the round) and a front spreads outward from it; a fly
     the front has passed slides from its own phase to the common beat (a little later the further up the stream it is, so each pulse runs away from the camera as a wave); near the end of the
     round the flies drift back to their own phases. t = 0 (the still frame) is in the middle of the unison, just past the peak. */
  const CYC = 24, U0 = .44, fly = flies.filter(f => !f.sit), sync = new Map();
  const round = c => { let r = sync.get(c); if(r) return r; const a = fly.length ? fly[Math.floor(hash2(c, 71) * fly.length)] : null, d = new Float32Array(NF); let mx = 1;
    if(a) flies.forEach((f, i) => { if(f.sit) return; d[i] = Math.hypot((f.roam ? f.x0 : Xc(f.z0) + f.x0 * (hw(f.z0) + 1.1)) - (a.roam ? a.x0 : Xc(a.z0) + a.x0 * (hw(a.z0) + 1.1)), f.z0 - a.z0); if(d[i] > mx) mx = d[i]; });
    r = {d, mx}; sync.set(c, r); if(sync.size > 4) sync.delete(sync.keys().next().value); return r; };
  const glowAt = (f, i, t) => { if(f.sit){ const u = t / f.per + f.o + .5, ph = u - Math.floor(u), w = .62 / f.per; return hash2(i, Math.floor(u)) < .2 ? 0 : .85 * (ph < w ? Math.sin(Math.PI * ph / w) ** 1.5 : 0); }
    const cu = t / CYC + U0, c = Math.floor(cu), u = cu - c, R = round(c), front = (R.mx + 4) * cl((u - .16) / .25, 0, 1) - 2, lk = f.h > .75 ? 0 : sstep(0, 3, front - R.d[i]) * (1 - sstep(.8 + .1 * f.h, .9 + .1 * f.h, u));
    const qo = t / TB + RISE + .2 - (lk * (.35 * cl((f.z0 - 3) / 30, 0, 1) + .5 * f.jit) + (1 - lk) * f.o), b = Math.floor(qo), a = hash2(i * 31 + 7, b);
    return a < .1 ? 0 : (.66 + .34 * a) * pulse(qo - b); };
  /* per frame: where each fly is, how bright, and its place on screen */
  const FX = new Float32Array(NF), FY = new Float32Array(NF), FZ = new Float32Array(NF), FV = new Float32Array(NF);
  let bx0 = cols, bx1 = -1, by0 = rows, by1 = -1;
  const RW = 1.8, RW2 = RW * RW;
  /* light from one fly onto the surfaces round it */
  const lightOn = (Xf, Yf, Zf, I) => { const s = F / Zf, sx = cx + Xf * s, sy = yH + (CAM - Yf) * s, rs = Math.min(34 / U, RW * F / Math.max(1, Zf - RW * .6)), x0 = Math.max(0, Math.floor(sx - rs)), x1 = Math.min(cols - 1, Math.ceil(sx + rs)), y0 = Math.max(0, Math.floor(sy - rs)), y1 = Math.min(rows - 1, Math.ceil(sy + rs));
    if(x0 < bx0) bx0 = x0; if(x1 > bx1) bx1 = x1; if(y0 < by0) by0 = y0; if(y1 > by1) by1 = y1;
    for(let x = x0; x <= x1; x++){ const xo = x - cx; for(let k = x * rows + y0, y = y0; y <= y1; y++, k++){ const dz = Z[k] - Zf; if(dz > RW || dz < -RW) continue;
      const qo = ZF[k], dx = xo * qo - Xf, dy = CAM - (y - yH) * qo - Yf, d2 = dx * dx + dy * dy + dz * dz; if(d2 >= RW2) continue;
      const m = MT[k], nx = NX[k], ny = NY[k], nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)), nl = (-nx * dx - ny * dy + nz * dz) / Math.sqrt(d2 + .003), e = 1 - d2 / RW2;
      LB[k] += AL[k] * I * e * e / (1 + d2 * 6) * (m === 1 ? .2 + .8 * Math.abs(nl) : .1 + .9 * (nl > 0 ? nl : 0)); } } };
  const RAMP = [0, 10, 15, 19, 19, 15], RN = [0, 5, 4, 4, 4, 4];
  const put = (x, y, b, c) => { const k = x * rows + y; if(b > Lb[k]){ Lb[k] = b > 1 ? 1 : b; Lc[k] = c; } };
  /* the fly itself: a small bright core, a soft halo of lit air (wider in mist and when near), and a thin streak back along its path over the
     last third of a second, fading, as in slow-shutter video */
  const glow = (f, i, t, v) => { const Zf = FZ[i], s = F / Zf, sx = Math.round(cx + FX[i] * s), sy = Math.round(yH + (CAM - FY[i]) * s), dm = Zf < 12 ? 1 : .45 + .55 * 12 / Zf, dim = v * dm;
    const rd = Zf < 7 ? 11 / U / Zf : 0, ra = Math.max(rd * 2.4, cl(1.6 + 8 / Zf, 1.8, 3.4) / U * (.75 + .9 * mist(FX[i], Zf, t))), R = Math.ceil(ra);          /* rd: a near fly is out of focus, a soft disc */
    for(let x = Math.max(0, sx - R); x <= Math.min(cols - 1, sx + R); x++) for(let y = Math.max(0, sy - R); y <= Math.min(rows - 1, sy + R); y++){ const k = x * rows + y; if(Z[k] < Zf) continue;
      const d = Math.hypot(x - sx, y - sy); if(d >= ra) continue; let b = dim * .5 * (1 - d / ra) ** 2, c = 23; if(d < rd + .5){ const e = dim * .56 * cl((rd + .5 - d) / (.6 * rd + .5), 0, 1); if(e > b){ b = e; c = 24; } } b *= Math.min(1.6, vis[k]); if(b > .05) put(x, y, b + dith(x, y), c); }
    const E = .34, nS = f.sit ? 0 : 7; let px = sx, py = sy;
    for(let j = 0; j <= nS; j++){ let x = sx, y = sy, vj = v; if(j){ const tj = t - E * j / nS; place(f, tj, o3); const sj = F / o3[2]; x = Math.round(cx + o3[0] * sj); y = Math.round(yH + (CAM - o3[1]) * sj); vj = glowAt(f, i, tj); if(x === px && y === py) continue; }
      const n = Math.max(1, Math.abs(x - px), Math.abs(y - py));
      for(let qo = j ? 1 : n; qo <= n; qo++){ const xx = Math.round(px + (x - px) * qo / n), yy = Math.round(py + (y - py) * qo / n); if(xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue; const k = xx * rows + yy; if(Z[k] < Zf) continue;
        const b = (j ? vj * Math.pow(1 - j / (nS + 1), 1.6) : vj) * dm * Math.min(1.6, vis[k]); if(b > .05) put(xx, yy, j ? Math.min(.86, .1 + .8 * b) : .12 + .88 * b, !j && b > .8 ? 26 : b > .45 ? 25 : 24); }                /* only the head is bright enough for the painter's halo */
      px = x; py = y; } };
  /* its mirror image: only on water, a thin streak stretched toward the camera and broken by the ripples */
  const mirror = (i, t, v) => { const Zf = FZ[i], s = F / Zf, sx = cx + FX[i] * s, sy = yH + (CAM + FY[i]) * s, len = cl(1.5 + 9 / Zf, 1.5, 4.5) / U, n = Math.ceil(len * 1.8), dm = Zf < 12 ? 1 : .5 + .5 * 12 / Zf;
    for(let j = -n; j <= n; j++){ const y = Math.round(sy + j); if(y < yH + 2 || y >= rows) continue; const zz = CAM * F / (y - yH), g = noise(zz * 7 - t * 1.6 * sp, FX[i] * 3 + 5), x = Math.round(sx + (noise(zz * 5 + t * 1.1 * sp, FX[i] * 3 + 5) - .5) * 3 / U * (.4 + Math.abs(j) / n)); if(x < 0 || x >= cols) continue;
      const k = x * rows + y; if(MT[k] !== 4) continue; const b = v * .8 * Math.exp(-((j / len) ** 2)) * (g < .38 ? .1 : .3 + 1.2 * g) * dm * (1 - .5 * WE[k]) * Math.min(1.5, vis[k]); if(b > .06) put(x, y, b, b > .5 ? 28 : 27); } };
  return tm => { const t = tm - 14, tq = Math.floor(tm * 10) / 10;
    stat.blit(); if(tq !== wq) water(tq);
    for(let x = bx0; x <= bx1; x++) LB.fill(0, x * rows + by0, x * rows + by1 + 1); bx0 = cols; bx1 = -1; by0 = rows; by1 = -1;
    Lb.set(WB); Lc.set(WC);
    for(let i = 0; i < NF; i++){ const f = flies[i], v = FV[i] = glowAt(f, i, t); if(v < .03) continue; place(f, t, o3); FX[i] = o3[0]; FY[i] = o3[1]; FZ[i] = o3[2];
      if(PART & 2) lightOn(o3[0], o3[1], o3[2], v * (f.sit ? 1.6 : f.near ? 2.6 : 1.5)); }
    for(let x = bx0; x <= bx1; x++) for(let y = by0, k = x * rows + by0; y <= by1; y++, k++){ const g = LB[k]; if(g < .012) continue; const v = (1 - Math.exp(-4.2 * g)) * Math.min(1.9, vis[k]); if(v < .05) continue; const m = MT[k], b = v + dith(x, y);
      if(b > Lb[k] || m !== 4){ Lb[k] = b < 0 ? 0 : b; Lc[k] = RAMP[m] + Math.min(RN[m] - 1, Math.floor(v * RN[m] * 1.15)); } }
    for(let i = 0; i < NF; i++){ const v = FV[i]; if(v < .03) continue; if(PART & 4) mirror(i, t, v); if(PART & 1) glow(flies[i], i, t, v); }
    paint(ax, Lb, Lc, 1, true);
  };
}
/* 15 snowfall.
   Adapted from ascii.rest piece 'snowfall' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: snow at several depths (far flakes small and slow across the frame, near ones large and fast), a wind that leans the
   fall, a snow bed with drifts, a fence whose posts wear caps and whose rails carry a ridge of snow.
   Rebuilt to read like night footage of snow falling in a real place. The place is a small 3D model seen from a little above eye level (from an upstairs window on a phone): a trodden lane with footprints leading past a post lamp to a log
   cabin seen three-quarters on (lit gable with door, porch and two windows, a side wall running back, thick snow on the roof with a cornice), snow-laden spruces at several distances, a rail fence, a far line of forest. Every cell knows how far away its
   surface is, what it is made of and which way it faces.
   Light makes the picture. The lamp is hooded and lights a cone downward with a soft edge: its light falls off with the square of the distance, so the snow under it is
   a warm pool that fades into blue night, the boughs that face it are warm and the far side of the tree is dark, posts and trees throw long
   shadows away from it. The windows light the snow in front of them. A flake is only as bright as the light that reaches it: bright and
   crowded close under the lamp, faint at the edge of its light, nearly invisible in the dark, hidden when it passes behind a trunk or a wall.
   Motion: flakes fall at about 0.65 to 1.5 metres a second (field measurements of aggregates and dendrites), each with its own speed, and
   glint as they tumble, two to three times a second. A light wind carries them from right to left; every 10 to 17 seconds (set by the date) a gust front
   crosses the scene, the flakes go nearly level and streak, and the air between them swirls more. Flakes in the lee of the cabin circle in
   its eddy. A few flakes a metre or two from the lens are large, soft, dim and fast. As a gust dies a laden bough of the lit spruce sheds
   its snow: the load drops, breaks into powder that drifts through the lamp light, and the bough springs up and swings before it settles;
   the boughs take turns, and snow gathers on a bare one again cell by cell, from about 8 to 34 seconds after it shed. Chimney smoke rises and is bent over by the wind, flat in the gusts.
   Data: flakes = tokens (all are in the air; one outside the light is nearly invisible at that moment; a phone draws six in ten of them,
   so the small picture stays readable); the steady wind = 7-day trend;
   gust strength and swirl = cache miss. Colour carries no data. */
function tSnow(env, X){
  const PART = 15;                                                                                   /* what is drawn: 1 falling snow, 2 smoke, 4 the shedding bough and its powder, 8 the still scene (kept for measuring) */
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, PX = env.P, N = cols * rows;
  const S = mulberry(mix(p.seed + 15)), cl = (v, a, b) => v < a ? a : v > b ? b : v, hsh = (a, b) => hash2(a | 0, b | 0);
  /* palette: 0 / 1 the two data colours (not used here); 2 night sky, 3 snow haze; 4..9 snow from night blue to lamp-lit cream; 10..12 needles
     (night, half lit, lamp lit); 13..15 timber; 16..18 window glass; 19 smoke; 20..23 flakes from unlit to hot; 24 the lamp glass; 25 bark; 26 iron */
  const PAL = [BLUE, OR, [50, 58, 94], [84, 94, 128], [78, 98, 146], [116, 136, 182], [172, 176, 196], [222, 206, 186], [248, 226, 190], [255, 244, 220],
               [36, 58, 52], [74, 86, 54], [124, 118, 62], [66, 52, 48], [116, 82, 56], [176, 124, 74], [236, 146, 60], [255, 194, 102], [255, 232, 170],
               [112, 118, 140], [150, 166, 204], [224, 210, 190], [255, 236, 196], [255, 250, 236], [255, 220, 146], [60, 52, 54], [46, 50, 60]];
  const mg = phone ? 0 : Math.max(0, (env.W - 1240) / 2 / PX), TOP = phone ? Math.round(rows * .145) : Math.round(rows * .47), BOT = phone ? Math.round(rows * .84) : rows, Hb = BOT - TOP;
  /* the camera: a little above eye level on a desktop, the height of an upstairs window on a phone, looking level; the lamp stands low in the
     picture, below the part the page fades most. yH = the row of the horizon, F = cells per metre at one metre, U = size of this window against
     the 1440 one */
  const Zl = phone ? 10 : 9, sL = Hb * (phone ? .125 : .21), CAM = phone ? 3.2 : 2.2, F = sL * Zl, yH = Math.round((phone ? BOT + 1 : rows - 3) - CAM * sL), cx = cols * .5, U = Hb / 74, Xat = (fx, z) => fx * cx * z / F;
  const Zs = new Float32Array(N).fill(1e9), Lb = new Float32Array(N), Lc = new Uint8Array(N), vis = new Float32Array(N);
  let AL = new Float32Array(N), NX = new Float32Array(N), NY = new Float32Array(N), NZ = new Float32Array(N), MT = new Uint8Array(N), SB = new Float32Array(N), SC = new Uint8Array(N);       /* the model, needed only while the still picture is built */
  /* what the canvas mask leaves of a row (the page fades the canvas out toward its top), inverted, to keep the upper band readable; nothing is
     drawn above the open band inside the text column */
  for(let x = 0; x < cols; x++){ const inCol = phone || (x >= mg - 1 && x <= cols - mg), ed = TOP + 4 + 5 * noise(x * .09, 61.5); for(let y = 0; y < rows; y++){ const u = 1 - (y + .5) / rows, mk = u < .14 ? 1 : u < .46 ? 1 - .45 * (u - .14) / .32 : .55 * (1 - (u - .46) / .54);
    let v = Math.min(2.1, 1 / Math.max(.05, mk)); if(inCol) v *= y < TOP - 1 ? 0 : y > ed ? 1 : sstep(TOP - 1, ed, y); if(phone) v *= 1 - sstep(BOT - 1, BOT + 7, y); vis[x * rows + y] = v; } }
  /* ---- where things stand (metres: X to the right, Y up, Z away from the camera) ---- */
  const Xl = Xat(phone ? -.22 : .16, Zl), Yl = phone ? 3.4 : 3, I0 = phone ? 12 : 10;                                          /* the lamp */
  /* the cabin stands three-quarters on, its gable end toward the camera: cE = the way its ridge runs toward that end, cW = across it */
  const Zc = phone ? 24 : 18.5, Xc = Xat(phone ? -.62 : -.38, phone ? 21 : 15), PHI = -.18, cE = [Math.sin(PHI), -Math.cos(PHI)], cW = [Math.cos(PHI), Math.sin(PHI)], LC = 7, WC = 6, RIDGE = 4.4, EAVE = 2.4, OV = .5;
  const cab = (l, w) => [Xc + cE[0] * l + cW[0] * w, Zc + cE[1] * l + cW[1] * w], wn = (l, w, y, nx, nz) => { const qo = cab(l, w); return {X: qo[0], Y: y, Z: qo[1], nx, nz, l, w}; };
  const WIN = [wn(LC / 2 + .05, -1.9, 1.5, cE[0], cE[1]), wn(LC / 2 + .05, 1.9, 1.5, cE[0], cE[1]), wn(.4, WC / 2 + .05, 1.5, cW[0], cW[1])], IW = 4, chm = cab(-1.6, .7), Xch = chm[0], Zch = chm[1], Ych = RIDGE + 1.05;
  /* the lane: from under the camera past the lamp, then across to the cabin door. laneD gives, for a place on the ground, how far it is from the
     lane, how far along it, and on which side */
  const door = cab(LC / 2 + 2.2, 0), LP = [[Xl - 1.8, 4], [Xl - 2.5, Zl - .3], [(Xl - 2.5 + door[0]) / 2 + .6, (Zl - .3 + door[1]) / 2 + 1.3], door];
  const laneD = (Xw, Z, o) => { let best = 1e9, acc = 0; for(let i = 0; i < LP.length - 1; i++){ const ax_ = LP[i][0], az = LP[i][1], dx = LP[i + 1][0] - ax_, dz = LP[i + 1][1] - az, L = Math.hypot(dx, dz), u = cl(((Xw - ax_) * dx + (Z - az) * dz) / (L * L), 0, 1), px = Xw - ax_ - dx * u, pz = Z - az - dz * u, d = Math.hypot(px, pz);
      if(d < best){ best = d; o[1] = acc + u * L; o[2] = (px * dz - pz * dx) / L; } acc += L; } o[0] = best; };
  const TREES = phone ? [{Z: 11.5, H: 7, R: 3, hero: 1}, {fx: -.55, Z: 26, H: 10, R: 2.8}, {fx: .12, Z: 27, H: 11, R: 3}, {fx: .65, Z: 30, H: 12, R: 3}, {fx: -.98, Z: 13, H: 8, R: 2.5}, {fx: .35, Z: 38, H: 12, R: 3}]
    : [{Z: 10.5, H: 8.5, R: 3.2, hero: 1}, {fx: .05, Z: 17, H: 8.5, R: 2.6}, {fx: .88, Z: 8.5, H: 9, R: 2.6}, {fx: -.92, Z: 9, H: 9.5, R: 2.7}, {fx: -.55, Z: 24, H: 11, R: 3}, {fx: -.2, Z: 26, H: 9.5, R: 2.8},
       {fx: -.38, Z: 29, H: 12, R: 3}, {fx: -.74, Z: 15, H: 7, R: 2.3}, {fx: .62, Z: 15, H: 6.5, R: 2.2}, {fx: .74, Z: 23, H: 11, R: 3}, {fx: .98, Z: 15, H: 8, R: 2.5}, {fx: .22, Z: 27, H: 11, R: 3}, {fx: -.06, Z: 31, H: 12, R: 2.9}, {fx: .5, Z: 31, H: 12, R: 2.9}];
  TREES.forEach((t, i) => { t.X = i ? Xat(t.fx, t.Z) + (S() - .5) * 1.5 : Xl + (phone ? 2.7 : 3); t.H *= .9 + .2 * S(); t.id = mix(p.seed + i * 977); });
  const POSTS = [], PH = 1.3; { let left = 6.5, a = .7; for(let i = 1; i < LP.length - 1 && left > 0; i++){ const ax_ = LP[i][0], az = LP[i][1], dx = LP[i + 1][0] - ax_, dz = LP[i + 1][1] - az, L = Math.hypot(dx, dz), sg = dx < 0 ? 1 : -1;
      for(; a < L && left > 0; a += 1.8, left -= 1.8) POSTS.push({X: ax_ + dx * a / L + sg * dz / L * 1.1, Z: az + dz * a / L - sg * dx / L * 1.1}); a -= L; } }                 /* the fence follows the lane on its far side */
  const OCC = POSTS.map(qo => ({X: qo.X, Z: qo.Z, r: .09, h: PH + .15, cone: 0})).concat(TREES.filter(t => t.Z < 26).map(t => ({X: t.X, Z: t.Z, r: t.R * .8, h: t.H, cone: 1})));
  /* ---- the snow bed: slow swells, wind ripples, the trodden lane with its footprints, hollows under the trees ---- */
  const lo = [0, 0, 0], WELL = TREES.filter(t => t.Z <= 20), hG = (Xw, Z) => { let h = .3 * noise(Xw * .11 + 5, Z * .11) + .13 * noise(Xw * .3 + 9, Z * 1.5 + 3) + .03 * noise(Xw * 2.3, Z * 3.1 + 7);
    if(Z < 22){ laneD(Xw, Z, lo); if(lo[0] < 1.5){ h -= .16 * Math.exp(-lo[0] * lo[0] / .16); const i = Math.round(lo[1] / .36), ex = (lo[2] - (i & 1 ? .14 : -.14)) / .1, ez = (lo[1] - i * .36) / .15; h -= .18 * Math.exp(-(ex * ex + ez * ez)); }
      for(const t of WELL){ const d2 = (Xw - t.X) * (Xw - t.X) + (Z - t.Z) * (Z - t.Z); h -= .3 * Math.exp(-d2 / (t.R * t.R * .3)); } }
    return h; };
  const surf = (x, y, z, m, al, nx, ny, nz) => { x = Math.round(x); y = Math.round(y); if(x < 0 || y < 0 || x >= cols || y >= rows) return; const k = x * rows + y; if(z >= Zs[k]) return;
    Zs[k] = z; MT[k] = m; AL[k] = al; NX[k] = nx; NY[k] = ny; NZ[k] = nz; };
  for(let x = 0; x < cols; x++) for(let y = yH + 1; y < rows; y++){ const z = CAM * F / (y - yH), Xw = (x - cx) * z / F, e = Math.max(.04, z / F * .6), ez = Math.max(.05, z * z / (CAM * F) * .5);
    const hx = (hG(Xw + e, z) - hG(Xw - e, z)) / (2 * e), hz = (hG(Xw, z + ez) - hG(Xw, z - ez)) / (2 * ez), il = 1 / Math.sqrt(1 + 6.8 * (hx * hx + hz * hz));
    laneD(Xw, z, lo); surf(x, y, z, 7, (hsh(x * 3 + 1, y * 7) > .95 ? 1.1 : .86) * (1 - .42 * Math.exp(-lo[0] * lo[0] / .14)), -2.6 * hx * il, il, -2.6 * hz * il); }
  /* ---- a spruce: a stack of skirts of boughs round the trunk. Each bough of a skirt droops outward to its tip under a pad of snow, a fringe
     of needles hangs below the tip, and the skirt above shades the inner part of the one below. Only the half toward the camera is drawn.
     pick = undefined draws every bough except the one that can shed; pick = j draws only that one, lifted by lift, with snow or bare ---- */
  const tier = (t, T, emit, pick, lift, snow) => { const s = F / t.Z, bx = Math.round(cx + t.X * s), by = yH + CAM * s, L = T.L, w0 = Math.ceil(L * 1.15 * s), st = .5 / s;
    for(let dc = -w0; dc <= w0; dc++){ const dx = (dc + .001) / s;
      for(let r = Math.max(st, Math.abs(dx)); r < L * 1.16; r += st){ const az = Math.asin(cl(dx / r, -1, 1)), f = (az / TAU + .5) * T.nb + T.ph, fi = Math.floor(f), j = fi % T.nb, w = (f - fi) * 2 - 1, B = T.b[j], isA = T.act === j;
        if(pick === undefined ? isA : j !== pick) continue;
        const ed = 1 - w * w, rim = L * B.lf * (.66 + .34 * ed), lf = isA ? lift : 0, sn = isA ? snow : 1, qo = r / L, y0 = T.h - B.dr * (1 - .6 * lf) * L * Math.pow(qo, 1.5), z = t.Z - r * Math.cos(az), sa = Math.sin(az), ca = Math.cos(az);
        if(r > rim){ if(r < rim + st * 1.01) for(let v = 0; v < B.nd * (.4 + .6 * ed) * (1 - .3 * lf); v += .8 / s) emit(bx + dc, by - (y0 - v) * s, z, 2, .2 + .3 * hsh(dc * 7 + T.id, v * s * 3 + j), sa * .7, -.3, -ca * .7); continue; }
        const g = noise(az * 3.3 + T.id, r * 2.6 + T.id * .31), on = sn > 0 && g > .24 + .5 * sstep(.8, 1, r / rim) - .25 * sn + .25, ao = .5 + .5 * sstep(.05, .5, qo) ;
        if(on) emit(bx + dc, by - (y0 + sn * B.sn * (.05 + .16 * Math.sqrt(ed))) * s, z, 1, .95 * ao * B.lt * (.62 + .5 * noise(az * 9 + T.id, r * 6)) * (1 - .25 * sstep(.6, 1, r / rim)), sa * (.45 + .25 * qo), .8 - .3 * qo, -ca * (.45 + .25 * qo));
        else emit(bx + dc, by - y0 * s, z, 2, (.2 + .3 * g) * ao, sa * .7, .1, -ca * .7); } } };
  const ACT = [], KA = 4;                                                                              /* the boughs that can shed: on the lit spruce, facing the lamp and the camera */
  const spruce = t => { const s = F / t.Z, bx = Math.round(cx + t.X * s), by = yH + CAM * s, R = mulberry(t.id); t.T = [];
    for(let h = 0; h < t.H - .3; h += .8 / s){ const w = (.15 * (1 - h / t.H) + .02) * s; for(let d = -Math.floor(w); d <= Math.floor(w); d++) surf(bx + d, by - h * s, t.Z, 3, .3, d / (w + 1) * .8, 0, -.6); }
    for(let h = .75 + .4 * R(); h < t.H - .25; ){ const rel = 1 - h / t.H, L = t.R * Math.pow(rel, .85) * (.85 + .3 * R()) + .12, nb = Math.max(3, Math.round(3 + 5 * Math.sqrt(rel))), T = {h, L, nb, ph: R(), id: R() * 900, act: -1, b: []};
      for(let j = 0; j < nb; j++) T.b.push({lf: .78 + .3 * R(), dr: (.16 + .42 * rel) * (.7 + .6 * R()), nd: .12 + .22 * R(), sn: .7 + .6 * R(), lt: .72 + .28 * R()});
      if(t.hero && ACT.length < KA && h > 1 && h < 2.6 && L > 1) for(let j = 0; j < nb; j++){ const az = ((j + .5 - T.ph) / nb - .5) * TAU, a2 = az < -Math.PI ? az + TAU : az; if(a2 > -1.5 && a2 < -.6){ T.act = j; T.b[j].lf = 1.06; T.b[j].dr = Math.max(T.b[j].dr, .4); T.b[j].sn = 1.3; T.b[j].lt = 1; ACT.push({t, T, j, az: a2}); break; } }
      tier(t, T, surf); t.T.push(T); h += (.3 + .2 * R()) * (.7 + .5 * rel) + .06; }
    for(let qo = 0; qo < .55 * s; qo++) surf(bx, by - (t.H - .3) * s - qo, t.Z, qo < .3 * s ? 1 : 2, .8, 0, .5, -.8); };
  TREES.slice().sort((a, b) => b.Z - a.Z).forEach(spruce); ACT.sort((a, b) => Math.abs(a.T.h - 2) - Math.abs(b.T.h - 2));
  /* ---- the far forest: tiers of dark boughs, snow on each tier ---- */
  { const n = phone ? 40 : Math.round(110 * cols / 360);
    for(let i = 0; i < n; i++){ const z = 36 + 60 * S() * S(), s = F / z, H = (11 + 9 * S()) * s, Rr = (2 + 1.6 * S()) * s, bx = S() * cols, by = yH + CAM * s, o = S() * 9;
      for(let hh = 0; hh < H; hh++){ const rel = 1 - hh / H, tier = (hh * (.9 + .5 / U) + o) % 3, w = Rr * Math.pow(rel, .85) * (.55 + .45 * (1 - tier / 3)) + .3;
        for(let d = -Math.round(w); d <= Math.round(w); d++){ const top = tier < 1 && hsh(bx + d * 5, hh * 3 + i) < .75; surf(bx + d, by - hh, z, top ? 1 : 2, top ? .8 : .3, d / (w + 1) * .6, top ? .8 : -.2, -.6); } } } }
  /* ---- the cabin, three-quarters on: the gable wall toward the camera with the door under a porch roof between two lit windows, the long side
     wall with one lit window running away, the roof slope above it under a thick slab of snow that rounds over the eave as a cornice with
     icicles, the snow's edge up both rakes of the gable, a stone chimney. Every face is sampled in metres and projected ---- */
  { const st = .45 * (Zc - 4) / F, P3 = (qo, Y, m, al, nx, ny, nz, dz) => { const z = qo[1] + (dz || 0), s = F / z; surf(cx + qo[0] * s, yH - (Y - CAM) * s, z, m, al, nx, ny, nz); };
    const yr = w => RIDGE - Math.abs(w) * (RIDGE - EAVE) / (WC / 2), th = (l, w) => .5 + .16 * noise(l * 1.1 + 3, w * 1.1 + 8), bw = .45 / (F / Zc);
    const wall = (qo, a, b, Y, nx, nz, dark, gn) => { let e = 0, ci = 0, d = 9; for(const k of WIN) if(Math.abs(k.nx - nx) < .01){ const u = Math.abs((k.nx === cE[0] ? b - k.w : a - k.l)), v = Math.abs(Y - k.Y); if(u < .5 && v < .5){ const bar = u < bw || v < bw; e = bar ? .32 : .8 + .2 * hsh(a * 40 + b * 70, Y * 30) - .3 * v; ci = bar ? 16 : v < .3 && u > .12 ? 18 : 17; } d = Math.min(d, Math.max(u, v) - .5); }
      if(e) P3(qo, Y, 6, e, 0, ci, 0); else if(d < .8 && !dark) P3(qo, Y, 6, .1 + .42 * Math.exp(-d / .3), 0, d < .3 ? 15 : 14, 0);
      else P3(qo, Y, 4, dark ? .13 : (gn || 1) * (.42 + .34 * Math.sin((Y / .27 % 1) * Math.PI)) * (1 - .5 * sstep(EAVE - .5, EAVE, Y)), nx, .05, nz); };
    for(let w = -WC / 2; w <= WC / 2; w += st) for(let Y = 0; Y < yr(w); Y += st) wall(cab(LC / 2, w), 0, w, Y, cE[0], cE[1], Math.abs(w) < .5 && Y < 1.95);        /* gable wall, door */
    for(let l = -LC / 2; l <= LC / 2; l += st) for(let Y = 0; Y < EAVE; Y += st) wall(cab(l, WC / 2), l, 0, Y, cW[0], cW[1], false, 1.9);                              /* side wall */
    const rn = [cW[0] * .59, .81, cW[1] * .59], WE = WC / 2 + OV;
    for(let l = -LC / 2 - OV; l <= LC / 2 + OV; l += st){ const ic = hsh(l * 9, 3) < .4 ? .15 + .55 * hsh(l * 9, 5) : 0, lip = .1 + .3 * noise(l * 1.9, 2.5);
      for(let w = 0; w <= WE; w += st) P3(cab(l, w), yr(w) + th(l, w) * sstep(WE + .1, WE - .35, w), 1, (.5 + .28 * w / WE + .34 * noise(l * .9 + 7, w * 3.6 + 4) + .12 * hsh(l * 31, w * 47)), rn[0] + .5 * (noise(l * 1.7, w * 2.9 + 9) - .5), rn[1], rn[2] + .5 * (noise(l * 1.7 + 5, w * 2.9) - .5));                      /* the slope */
      for(let Y = yr(WE) - lip - ic; Y < yr(WE) + .2; Y += st) P3(cab(l, WE), Y, 1, Y < yr(WE) - lip ? .5 : .8, cW[0] * .8, .35, cW[1] * .8, -.05); }                     /* the cornice and its icicles */
    for(let w = -WC / 2 - OV; w <= WC / 2 + OV; w += st) for(let Y = yr(w) - .12; Y < yr(w) + th(LC / 2 + OV, Math.max(w, 0)) * sstep(WC / 2 + OV + .1, WC / 2 + OV - .35, Math.abs(w)); Y += st) P3(cab(LC / 2 + OV, w), Y, Y < yr(w) ? 4 : 1, Y < yr(w) ? .2 : .86, cE[0] * .8, .4, cE[1] * .8);   /* the rakes */
    for(let a = -.3; a <= .3; a += st) for(let Y = yr(.7) + .2; Y < Ych + .2; Y += st){ const cap = Y > Ych; P3(cab(-1.6 + .3, .7 + a), Y, cap ? 1 : 3, cap ? .9 : .32 + .2 * hsh(a * 50, Y * 20), cE[0], cap ? .8 : 0, cE[1]); P3(cab(-1.6 + a, 1), Y, cap ? 1 : 3, cap ? .9 : .26 + .2 * hsh(a * 50, Y * 20), cW[0], cap ? .8 : 0, cW[1]); }
    for(let w = -1.2; w <= 1.2; w += st){ for(let l = LC / 2; l <= LC / 2 + 1.6; l += st) P3(cab(l, w), 2.5 - .22 * (l - LC / 2) + .3 * sstep(1.25, .95, Math.abs(w)), 1, .88 * (.8 + .25 * noise(l * 3, w * 3)), cE[0] * .3, .9, cE[1] * .3);       /* the porch roof */
      for(let Y = 2.05; Y < 2.45; Y += st) P3(cab(LC / 2 + 1.6, w), Y, Y < 2.15 ? 4 : 1, Y < 2.2 ? .25 : .82, cE[0] * .8, .4, cE[1] * .8); }
    for(const w of [-1.1, 1.1]) for(let Y = 0; Y < 2.1; Y += st) P3(cab(LC / 2 + 1.5, w), Y, 4, .5, cE[0], 0, cE[1]);
    for(const k of WIN) for(let a = -.6; a <= .6; a += st){ const qo = k.nx === cE[0] ? cab(k.l + .1, k.w + a) : cab(k.l + a, k.w + .1); P3(qo, k.Y - .58, 1, .9, k.nx * .4, .9, k.nz * .4); } }                /* snow on the sills */
  /* ---- the fence: posts with caps of snow, two rails with a ridge of snow ---- */
  POSTS.forEach((qo, i) => { const s = F / qo.Z, bx = cx + qo.X * s, by = yH + CAM * s, w = Math.max(1, Math.round(.17 * s));
    for(let Y = 0; Y < PH; Y += .7 / s) for(let d = 0; d < w; d++) surf(bx + d - (w - 1) / 2, by - Y * s, qo.Z, 4, .42, w > 1 ? (d / (w - 1) - .5) * 1.5 : .3, 0, -.65);
    const cr = Math.max(1, .2 * s), ch = Math.max(1, .17 * s * (.8 + .5 * S()));
    for(let dx = -Math.ceil(cr); dx <= Math.ceil(cr); dx++) for(let dy = 0; dy <= Math.ceil(ch); dy++){ const u = dx / (cr + .4), v = dy / (ch + .4); if(u * u + v * v < 1) surf(bx + dx, by - PH * s - dy, qo.Z - .05, 1, .92, u * .7, .45 + .5 * v, -.5); }
    const n = POSTS[i + 1]; if(n){ const s2 = F / n.Z, ex = cx + n.X * s2, ey = yH + CAM * s2, st = Math.ceil(Math.hypot(ex - bx, ey - by) * 1.3);
      for(const rh of [.55, 1.05]) for(let j = 0; j <= st; j++){ const u = j / st, z = qo.Z + (n.Z - qo.Z) * u, sz = F / z, px = bx + (ex - bx) * u, py = by + (ey - by) * u - rh * sz, sag = Math.round(.9 - .9 * Math.abs(2 * u - 1) + .4 * hsh(j, i));
        surf(px, py, z, 4, .36, .3, 0, -.7); if(sz > 4.5) for(let d = 1; d <= (sag > 0 && sz > 8 ? 2 : 1); d++) surf(px, py - d, z - .02, 1, .8, .1, .9, -.4); } } });
  /* ---- the lamp: an iron post, a hooded lantern, snow on its hood ---- */
  const lpx = Math.round(cx + Xl * F / Zl), lpy = Math.round(yH - (Yl - CAM) * F / Zl);
  { const s = F / Zl, by = yH + CAM * s, w = Math.max(1, Math.round(.1 * s)), g = Math.max(1, Math.round(.16 * s));
    for(let Y = 0; Y < Yl - .28; Y += .7 / s) for(let d = 0; d < w; d++) surf(lpx + d - ((w - 1) >> 1), by - Y * s, Zl, 5, .3, .2, 0, -.9);
    for(let dy = -Math.round(.24 * s); dy <= Math.round(.2 * s); dy++) for(let dx = -g; dx <= g; dx++) surf(lpx + dx, lpy + dy, Zl - .05, 6, 1, 0, dx || dy ? 24 : 23, 0);
    const hy = lpy - Math.round(.24 * s) - 1; for(let dx = -g - 1; dx <= g + 1; dx++){ surf(lpx + dx, hy, Zl - .06, 5, .3, 0, 0, -1); for(let d = 1; d <= Math.max(1, Math.round(.14 * s * (1 - Math.abs(dx) / (g + 2)))); d++) surf(lpx + dx, hy - d, Zl - .06, 1, .9, dx * .2, .9, -.4); } }
  /* ---- light. lampE = how much lamp light reaches a point in the air (per unit of surface facing it); winE the same for the windows ---- */
  /* the hood makes a cone: full light within about 49 degrees of straight down, none beyond 62, a soft edge between; a little light leaks
     sideways through the glass, and the air within two metres of the lantern glows */
  const lampE = (Xw, Yw, Z) => { const dx = Xl - Xw, dy = Yl - Yw, dz = Zl - Z, d2 = dx * dx + dy * dy + dz * dz, c = dy / Math.sqrt(d2 + 1e-6);
    return I0 * ((c > .66 ? 1 : c < .47 ? 0 : smooth((c - .47) / .19)) + (c > -.3 ? (phone ? .2 : .22) : 0)) / (d2 + .6) + (d2 < 4 ? I0 * .06 * (1 - d2 / 4) / (d2 + .25) : 0); };
  const winE = (Xw, Yw, Z) => { let e = 0; for(const w of WIN){ const dx = Xw - w.X, dz = Z - w.Z, f = dx * w.nx + dz * w.nz; if(f <= 0) continue; const dy = Yw - w.Y, d2 = dx * dx + dy * dy + dz * dz; e += IW * f / Math.sqrt(d2) / (d2 + .4); } return e; };
  const shad = (Xw, Yw, Z) => { let sh = 1; const ax_ = Xl - Xw, az = Zl - Z, L2 = ax_ * ax_ + az * az + 1e-6;
    for(const o of OCC){ const u = cl(((o.X - Xw) * ax_ + (o.Z - Z) * az) / L2, 0, 1), px = Xw + ax_ * u - o.X, pz = Z + az * u - o.Z, dd = Math.sqrt(px * px + pz * pz), hy = Yw + (Yl - Yw) * u; if(hy > o.h) continue;
      const r = o.cone ? o.r * (1 - hy / o.h) * (.75 + .5 * noise(Math.atan2(pz, px) * 2.2 + o.X, hy * .8)) : o.r; const pen = .08 + .1 * u * Math.sqrt(L2); if(dd < r + pen) sh = Math.min(sh, o.cone ? .12 + .88 * sstep(r * .55, r + pen, dd) : sstep(r * .2 - pen * .3, r + pen, dd)); }                 /* a shadow's edge softens with its length */
    return sh; };
  const tone = (m, b, fw, x, y) => { fw += (hsh(x * 5 + 3, y * 11) - .5) * .08;
    return m === 2 ? (fw < .3 ? 10 : fw < .62 ? 11 : 12) : m === 3 ? (fw < .4 ? 25 : 14) : m === 4 ? (fw < .25 ? 13 : fw < .6 ? 14 : 15) : m === 5 ? 26 : fw < .12 ? (b < .17 ? 4 : 5) : fw < .32 ? 6 : fw < .52 ? 7 : fw < .74 || b < .8 ? 8 : 9; };
  const AMB = .62, HAZE = .14, ZFOG = 75, GS = 1.2;
  const shade = (x, y, z, m, al, nx, ny, nz, out) => { const Xw = (x - cx) * z / F, Yw = CAM - (y - yH) * z / F;
    if(m === 6){ out[0] = al; out[1] = ny; return; }
    const dx = Xl - Xw, dy = Yl - Yw, dz = Zl - z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6; let nl = (nx * dx + ny * dy + nz * dz) / d; nl = m === 7 ? Math.max(0, .9 * nl + .1) : m === 1 ? Math.max(0, .72 * nl + .28) : m === 2 ? Math.max(0, .6 * nl + .4) : Math.max(0, nl);
    let w = lampE(Xw, Yw, z) * nl * (m === 7 ? shad(Xw, Yw, z) : 1);
    for(const qo of WIN){ const qox = Xw - qo.X, qz = z - qo.Z, ff = qox * qo.nx + qz * qo.nz; if(ff <= 0) continue;
      const qy = Yw - qo.Y, q2 = qox * qox + qy * qy + qz * qz, qd = Math.sqrt(q2); w += IW * ff / qd / (q2 + .4) * Math.max(0, -.7 * (nx * qox + ny * qy + nz * qz) / qd + .3); }
    const f = 1 - Math.exp(-z / ZFOG), c = AMB * al * (m === 7 ? .62 : 1) * (.3 + .7 * Math.max(0, -.42 * nx + .8 * ny - .42 * nz)) * (1 - f) + HAZE * f; w *= GS * al * (1 - f); out[0] = c + w; out[1] = tone(m, c + w, w / (c + w + 1e-4), x, y); };
  const o2 = [0, 0], glow = (x, y) => { const r = Math.hypot(x - lpx, y - lpy) / U; return 1.3 * Math.exp(-r / 2.6) + .16 * Math.exp(-r / 10); };
  for(let x = 0; x < cols; x++) for(let y = 0; y < rows; y++){ const k = x * rows + y, z = Zs[k]; let b, c;
    if(z > 1e8){ const up = yH - y; b = .085 + .08 * Math.exp(-Math.max(0, up) / (Hb * .4)); c = 2; }
    else { shade(x, y, z, MT[k], AL[k], NX[k], NY[k], NZ[k], o2); b = o2[0]; c = o2[1]; }
    if(z > Zl && MT[k] !== 6){ const g = glow(x, y); if(g > .02){ if(g > b * .6) c = g > .5 ? 24 : 22; b += g; } }                 /* lit air round the lantern */
    SB[k] = b > .02 ? Math.min(1, Math.max(0, b * vis[k] + dith(x, y))) : 0; SC[k] = c; }
  /* ---- the boughs that can shed, in each of their states: 0 laden, 1..6 bare and swinging (from hanging low to thrown high), 7 thinly covered
     again. They are left out of the still picture and drawn every frame; what stands behind them is kept, to show when they move ---- */
  const POSE = [[0, 1], [-.1, 0], [.25, 0], [.6, 0], [1, 0], [1.35, 0], [1.7, 0], [.83, .17], [.67, .33], [.5, .5], [.33, .67], [.17, .83]], FILL = [4, 7, 8, 9, 10, 11, 0], UM = [];
  ACT.forEach(A => { const cells = new Map(), T = A.T, B = T.b[A.j], poses = POSE.map(ps => { const m = new Map();
      tier(A.t, T, (x, y, z, mt, al, nx, ny, nz) => { x = Math.round(x); y = Math.round(y); if(x < 0 || y < 0 || x >= cols || y >= rows) return; const k = x * rows + y; if(z >= Zs[k]) return; const o = m.get(k); if(o && o[0] <= z) return;
        shade(x, y, z, mt, al, nx, ny, nz, o2); m.set(k, [z, Math.min(1, Math.max(0, o2[0] * vis[k] + dith(x, y))), o2[1]]); }, A.j, ps[0], ps[1]);
      for(const k of m.keys()) cells.set(k, 1); return m; });
    const ks = Int32Array.from(cells.keys()), n = ks.length, pb = poses.map(m => { const a = new Float32Array(n), c = new Uint8Array(n); ks.forEach((k, i) => { const o = m.get(k); a[i] = o ? o[1] : SB[k]; c[i] = o ? o[2] : SC[k]; }); return {a, c}; });
    const sp_ = [.15, .32, .49, .66, .83, 1].map(qo => ({X: A.t.X + Math.sin(A.az) * T.L * qo, Y: T.h - B.dr * T.L * Math.pow(qo, 1.5) + .1, Z: A.t.Z - Math.cos(A.az) * T.L * qo}));
    UM.push({ks, pb, sp: sp_, s: F / A.t.Z, rn: Float32Array.from(ks, k => hsh(k, 71))}); });
  for(const u of UM) for(const k of u.ks) SB[k] = -1;
  /* a painter that draws like the kit's round dots, without the kit's per-colour index buffers (one sort buffer for the whole piece) */
  const NK = PAL.length * LV, ord = new Int32Array(N), kb = new Int16Array(N), cnt = new Int32Array(NK + 1), pos = new Int32Array(NK);
  const paint = (c, gb, gc, halo) => { cnt.fill(0);
    for(let k = 0; k < N; k++){ const a = gb[k]; if(a < .05){ kb[k] = -1; continue; } const key = gc[k] * LV + Math.min(LV, Math.ceil(a * LV)) - 1; kb[k] = key; cnt[key + 1]++; }
    for(let i = 0; i < NK; i++){ cnt[i + 1] += cnt[i]; pos[i] = cnt[i]; }
    for(let k = 0; k < N; k++) if(kb[k] >= 0) ord[pos[kb[k]]++] = k;
    for(let key = 0; key < NK; key++){ const a0 = cnt[key], a1 = cnt[key + 1]; if(a1 === a0) continue; const col = PAL[(key / LV) | 0], f = (key % LV + 1) / LV, rgb = `${col[0]},${col[1]},${col[2]}`;
      if(halo && f > .85){ const hs = PX * 2.2; c.fillStyle = `rgba(${rgb},.1)`; c.beginPath();
        for(let i = a0; i < a1; i++){ const k = ord[i], x = ((k / rows) | 0) * PX + PX / 2, y = (k % rows) * PX + PX / 2; c.moveTo(x + hs / 2, y); c.arc(x, y, hs / 2, 0, TAU); } c.fill(); }
      const r = PX * (.17 + .33 * f); c.fillStyle = `rgba(${rgb},${(.2 + .66 * f).toFixed(3)})`; c.beginPath();
      if(r < 1.45) for(let i = a0; i < a1; i++){ const k = ord[i]; c.rect(((k / rows) | 0) * PX + PX / 2 - r, (k % rows) * PX + PX / 2 - r, 2 * r, 2 * r); }
      else for(let i = a0; i < a1; i++){ const k = ord[i], x = ((k / rows) | 0) * PX + PX / 2, y = (k % rows) * PX + PX / 2; c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }
      c.fill(); } };
  const stat = offscreen(env); if(PART & 8) paint(stat.begin(), SB, SC, true); else stat.begin();
  AL = NX = NY = NZ = MT = SB = SC = null;
  /* ---- wind. A steady wind from the right, and gusts: fronts that cross the scene from right to left, faster than the air they push.
     g1 / g2 = strength of the two gust trains at a moment (0..1), G1 / G2 = how far each has carried a flake so far (their running sums) ---- */
  const U0 = .35 + 1.0 * D.trendK, gk = Math.min(1, D.jitter / 2), UG = 2.8 + 1.6 * gk, UG2 = .9 + .6 * gk, TA = .09 + .07 * gk, CF = 9;
  const Tg = 11.5 + 2.5 * S(), gW = 3.6, Tg2 = Tg * .29, gW2 = 1.5, SHED = 3.5;
  const g1 = s => { const u = s - Math.floor(s / Tg) * Tg; return u < gW ? Math.sin(Math.PI * u / gW) ** 2 : 0; }, g2 = s => { const u = s - Math.floor(s / Tg2) * Tg2; return u < gW2 ? Math.sin(Math.PI * u / gW2) ** 2 : 0; };
  const G1 = s => { const k = Math.floor(s / Tg), u = s - k * Tg; return k * gW * .5 + (u < gW ? u * .5 - gW / (4 * Math.PI) * Math.sin(TAU * u / gW) : gW * .5); };
  const G2 = s => { const k = Math.floor(s / Tg2), u = s - k * Tg2; return k * gW2 * .5 + (u < gW2 ? u * .5 - gW2 / (4 * Math.PI) * Math.sin(TAU * u / gW2) : gW2 * .5); };
  /* ---- the flakes. Four homes: the air round the lamp, the lee of the cabin by its windows, the whole view at every distance, close to the lens.
     A flake lives in a box of air and comes back in at the far side when it leaves; the sides of a box are out of the light ---- */
  const NF = Math.round(Math.min(3600, Math.max(500, Math.round(D.nPart * 2.4))) * (phone ? .6 : 1)), NN = phone ? 5 : 14, wb = cab(LC / 2 + 2.5, .8), fx = new Float32Array(NF), fy = new Float32Array(NF), fz = new Float32Array(NF), fv = new Float32Array(NF), fh = new Float32Array(NF), fp = new Float32Array(NF),
    fq = new Float32Array(NF), fs = new Float32Array(NF), fbw = new Float32Array(NF), fxc = new Float32Array(NF), fyb = new Float32Array(NF), fH = new Float32Array(NF), fc = new Uint8Array(NF);
  for(let i = 0; i < NF; i++){ const r = X.rnd, u = (i * .61803398875) % 1, c = i < NN ? 3 : u < (phone ? .8 : .66) ? 0 : u < (phone ? .85 : .78) ? 1 : 2, big = r() < .25; fc[i] = c;
    const z = c === 0 ? Zl - 4.5 + 10 * r() : c === 1 ? wb[1] - 3 + 6 * r() : c === 2 ? 7 + 37 * Math.sqrt(r()) : .9 + 1.7 * r(); fz[i] = z;
    fbw[i] = c === 0 ? 6 : c === 1 ? 5.5 : c === 2 ? (cx + 8) * z / F + 1 : (phone ? 46 : 100) * z / F; fxc[i] = c === 0 ? Xl : c === 1 ? wb[0] : c === 2 ? 0 : (lpx - cx) * z / F; fx[i] = (r() * 2 - 1) * fbw[i];
    fyb[i] = c === 3 ? CAM - (rows - yH + 3) * z / F : 0; fH[i] = c === 0 ? 5 : c === 1 ? 4.6 : c === 2 ? 10 : (rows - TOP + 8) * z / F; fy[i] = r() * fH[i];
    fv[i] = big ? 1.05 + .45 * r() : .65 + .55 * r(); fh[i] = (c === 1 ? .35 : .62) + .43 * r(); fp[i] = r() * TAU; fq[i] = TAU * (2 + .8 * r()); fs[i] = big ? 1 + .4 * r() : .55 + .4 * r(); }
  const put = (x, y, z, b, c) => { x = Math.round(x); y = Math.round(y); if(x < 0 || y < 0 || x >= cols || y >= rows) return; const k = x * rows + y; if(z > Zs[k]) return; b *= vis[k]; if(b > Lb[k]){ Lb[k] = b > 1 ? 1 : b; Lc[k] = c; } };
  const hero = TREES[0], NP = 170, NS = phone ? 30 : 46, LIFE = 6.4, sCh = (Xch - Xl) / CF, sHe = (hero.X - Xl) / CF;
  const shedOf = k => k === 0 || hsh(k * 13 + 5, p.seed) < .75 ? ((k % UM.length) + UM.length) % UM.length : -1;                     /* the boughs take turns, so each has time to fill again */
  return tm => { const tt = (tm - 14) * sp, s1 = tt + .42 * gW, s2 = tt + 2.2;
    stat.blit(); Lb.fill(0);
    /* the boughs: which state each is in. A bough sheds SHED seconds after a gust front reaches the tree, springs up, swings and settles */
    const kc = Math.floor((s1 + sHe - SHED) / Tg); let evA = -1, evT = 0;
    if(PART & 4 || PART & 8) UM.forEach((u, a) => { let dt = -1; for(let j = 0; j < 7; j++) if(shedOf(kc - j) === a){ dt = s1 + sHe - SHED - (kc - j) * Tg; if(j === 0){ evA = a; evT = dt; } break; }
      let pi = 0, pj = 0, fr = 0; if(dt >= .15 && dt < 34){ const e = dt - .15; if(dt < 8) pi = pj = 1 + Math.round(cl((1 - Math.exp(-e / .5) * Math.cos(TAU * 1.3 * e)) * 3, 0, 5)); else { const f = (dt - 8) / 26 * 6, a = Math.floor(f); pi = FILL[a]; pj = FILL[a + 1]; fr = f - a; } }
      const qo = u.pb[pi], q2 = u.pb[pj]; for(let i = 0; i < u.ks.length; i++){ const o = u.rn[i] < fr ? q2 : qo; Lb[u.ks[i]] = o.a[i]; Lc[u.ks[i]] = o.c[i]; } });                 /* snow comes back cell by cell */
    /* smoke: puffs leave the chimney one after another, rise, slow, spread and thin, and go where the wind has carried them since they left */
    if(PART & 2){ const s = F / Zch, by = yH + CAM * s, gC = s1 + sCh, GA = UG * G1(gC) + UG2 * G2(s2 + sCh);
      for(let i = 0; i < NS; i++){ const ph = tt / LIFE + i / NS, cyc = Math.floor(ph), a = (ph - cyc) * LIFE, h1 = hsh(i * 31 + cyc, 9), h2 = hsh(i * 17 + cyc, 4);
        const dX = -(U0 * a + GA - UG * G1(gC - a) - UG2 * G2(s2 + sCh - a)) * .8 * (1 - .6 * Math.exp(-a / .7)), Xw = Xch + dX + (h1 - .5) * (.2 + .25 * a), Yw = Ych + .1 + 1.5 * (1 - Math.exp(-a / 1.1)) + .16 * a + (h2 - .5) * (.1 + .2 * a) + .12 * Math.sin(a * 1.7 + i);
        const rr = (.2 + .2 * a) * s, bl = .5 * Math.pow(1 - a / LIFE, 1.3) / (1 + .3 * a) * Math.min(1, a / .25), px = cx + Xw * s, py = by - Yw * s, r2 = rr * rr + .3;
        for(let x = Math.round(px - rr); x <= px + rr; x++) for(let y = Math.round(py - rr); y <= py + rr; y++){ if(x < 0 || y < 0 || x >= cols || y >= rows) continue; const k = x * rows + y; if(Zs[k] < Zch - .5) continue;
          const d2 = (x - px) * (x - px) + (y - py) * (y - py); if(d2 < r2){ Lb[k] = Math.min(.6, Lb[k] + bl * (1 - d2 / r2) * vis[k]); Lc[k] = 19; } } } }
    /* the snow that has just left a bough: the load drops as lumps, the rest is powder that the wind takes */
    if(PART & 4 && evA >= 0 && evT < 6){ const u = UM[evA], s = u.s, by = yH + CAM * s, gH = s1 + sHe;
      for(let i = 0; i < NP; i++){ const h1 = hsh(i * 29 + kc, 1), h2 = hsh(i * 13 + kc, 2), h3 = hsh(i * 7 + kc, 3), qo = h1 * 4.999, a = u.sp[qo | 0], b = u.sp[(qo | 0) + 1], w = qo - (qo | 0), low = i % 4 === 1, heavy = i % 3 === 0;
        const dt = evT - (.05 + .28 * (1 - h1) + .25 * h2 * h2 + (low ? .4 : 0)); if(dt <= 0) continue; const life = heavy ? 2 : 2.4 + 2.6 * h3; if(dt > life) continue;
        const vT = heavy ? 4.2 + 1.5 * h2 : .45 + .9 * h2, tau = heavy ? .45 : .14, fall = vT * (dt - tau * (1 - Math.exp(-dt / tau)));
        const wd = heavy ? .25 : .9 * (1 - Math.exp(-dt / .6)), dX = -(U0 * dt + UG * (G1(gH) - G1(gH - dt)) + UG2 * (G2(s2 + sHe) - G2(s2 + sHe - dt))) * wd + (h3 - .5) * (heavy ? .3 : 1.5) * (1 - Math.exp(-dt / .4));
        const Xw = a.X + (b.X - a.X) * w + dX, Yw = a.Y + (b.Y - a.Y) * w - (low ? 1.1 + .6 * h3 : 0) - fall + (heavy ? 0 : .12 * Math.sin(dt * 3 + i)), Z = a.Z + (b.Z - a.Z) * w - .1 - .3 * h2; if(Yw < 0) continue;
        const e = Math.min(1, .2 + 2.2 * lampE(Xw, Yw, Z)) * Math.min(1, dt / .1) * (heavy ? 1 : Math.pow(1 - dt / life, .7)), px = cx + Xw * s, py = by - Yw * s, c = e > .6 ? 22 : 21;
        put(px, py, Z, e, c); if(heavy){ put(px, py - 1, Z, e * .9, c); put(px + 1, py, Z, e * .8, c); if(i % 2) put(px + 1, py - 1, Z, e * .7, c); } else if(dt > .5){ put(px + (h2 < .5 ? 1 : -1), py, Z, e * .5, c); put(px, py + (h3 < .5 ? 1 : -1), Z, e * .4, c); } } }
    /* the falling snow */
    if(PART & 1) for(let i = 0; i < NF; i++){ const c = fc[i], hf = fh[i], bw = fbw[i], b2 = 2 * bw, xc = fxc[i], Z = fz[i];
      const base = fx[i] - hf * U0 * tt; let xa = base - b2 * Math.floor((base + bw) / b2), ar = s1 + (xc + xa - Xl) / CF;
      let x1 = base - hf * (UG * G1(ar) + UG2 * G2(ar + 2.2)); x1 -= b2 * Math.floor((x1 + bw) / b2); ar = s1 + (xc + x1 - Xl) / CF;
      let x = base - hf * (UG * G1(ar) + UG2 * G2(ar + 2.2)); x -= b2 * Math.floor((x + bw) / b2);
      const sf = Math.min(1, (bw - Math.abs(xa)) / 1.5, (bw - Math.abs(x1)) / 1.5, (bw - Math.abs(x)) / 1.5); if(sf <= 0) continue;
      const ga = g1(ar), gb = g2(ar + 2.2), ta = TA * (1 + 2.4 * ga + gb), w1 = .8 * x - 1.3 * tt + .7 * Z, H = fH[i];
      let Xw = xc + x + ta * (Math.sin(w1) + .6 * Math.sin(1.7 * fy[i] + .9 * tt + fp[i])), yy = fy[i] + fv[i] * tt + ta * .6 * Math.cos(w1), vx = -hf * (U0 + UG * ga + UG2 * gb), vy = fv[i];
      if(c === 1){ const R = (.3 + .5 * hf) * (1 + .8 * ga), om = 1.2 + 1.6 * (fq[i] / TAU - 2), an = om * tt + fp[i]; Xw += R * Math.cos(an); yy += R * Math.sin(an); vx -= R * om * Math.sin(an); vy += R * om * Math.cos(an); }
      const Yw = fyb[i] + H - (yy - H * Math.floor(yy / H)), s = F / Z, px = cx + Xw * s, py = yH - (Yw - CAM) * s; if(px < -6 || px > cols + 6 || py < -6 || py > rows + 2) continue;
      const le = c === 3 ? 0 : lampE(Xw, Yw, Z) + (c === 1 || (c === 2 && Math.abs(Xw - Xc) < 10 && Math.abs(Z - Zc) < 9) ? winE(Xw, Yw, Z) : 0), sz = fs[i] * Math.min(1.5, 2.6 / Math.sqrt(Z)), tw = .72 + .4 * Math.sin(fq[i] * tt + fp[i]), dn = .6 + .8 * noise(x * .3 + tt * .5 + 40, Yw * .45 + Z * .3);
      const wl = 1.7 * le, b = (.1 + wl) * sz * tw * dn * sf, col = wl < .06 ? 20 : b > .8 ? 23 : b > .42 ? 22 : 21, lx = vx * .045 * s, ly = vy * .045 * s, ls = Math.sqrt(lx * lx + ly * ly);
      if(c === 3){ const rr = (1.5 + 3 / Z) * U, n = Math.min(3, Math.ceil(ls / rr)), bb = (.28 + .16 * fs[i]) * sf; for(let j = 0; j <= n; j++){ const qox = px - lx * j / (n || 1), qy = py - ly * j / (n || 1);                 /* close to the lens: a large soft disc, lit from the window behind the camera */
          for(let dx = -Math.ceil(rr); dx <= rr; dx++) for(let dy = -Math.ceil(rr); dy <= rr; dy++){ const d = (dx * dx + dy * dy) / (rr * rr); if(d < 1) put(qox + dx, qy + dy, Z, bb * (1 - d) * (1 - d) * (1 - .4 * j / (n + 1)), 21); } } }
      else if(ls < 1.15){ const y0 = Math.floor(py), f = py - y0; put(px, y0, Z, b * (.3 + .7 * (1 - f)), col); put(px, y0 + 1, Z, b * (.3 + .7 * f), col); }
      else { const n = Math.min(7, Math.ceil(ls)), bb = b * 1.25 / (1 + .3 * n); for(let j = 0; j <= n; j++) put(px - lx * j / n, py - ly * j / n, Z, bb * (1 - .55 * j / n), col); } }
    paint(ax, Lb, Lc, true);
  };
}
/* 16 sea swell.
   Adapted from ascii.rest piece 'sea-swell' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: a long trochoidal swell (sharp crests, flat troughs), a second train close to it so that crest heights rise and fall,
   a far horizon that nearer water can hide, and a small boat that rides the water and pitches to the slope under its hull.
   Rebuilt to read like footage of a moonlit sea off a coast, filmed from just above the water.
   The sea is a real surface in metres: nine wave trains (three of swell, 44 to 27 m long, two of wind sea, four of chop down to 1.9 m),
   each a trochoid, each moving at the deep-water speed for its length (omega = sqrt(g k), so long waves pass through short ones and the
   close wavelengths of the swell beat into sets that travel at half the speed of their crests). The swell runs toward the lens a little
   across the view, so its crests curve across the picture. The lens rides the water (it lifts as a swell passes under it) about a metre and a half
   up, lower than the highest crests: a near crest hides the troughs behind it and, in a set, the horizon itself. The picture is built from
   depth slices marched from the lens outward, each column keeping the highest row it has filled, so every wave is a body with a face, a
   crest line and whatever of its back the next crest leaves in view. The static frame is taken as a set is coming in; it arrives a few
   seconds later.
   Light: every cell is shaded from the surface normal. Reflection grows with the angle of view (Fresnel, Schlick's form for water): a face
   that tilts toward the lens is dark and see-through, the flat of a trough and the back of a wave mirror the pale glow low in the sky, and
   where the surface turns away at a crest it lights up as a thin line. The glitter path is made of facets: a cell sparkles when its slope
   is within the roughness of the one slope that would send the moon to the lens, so the path is narrow at the horizon, widens toward the
   lens, breaks where a crest hides the water behind it and dims when thin cloud crosses the moon.
   Whitecaps: a swell crest breaks where it stands highest in a set. White water spills down the front of the crest for a second or two,
   as a ragged patch with holes; what it leaves stays on the water where it was made, a band along the back of the wave that stretches,
   opens into a net of threads round darker cells and is gone in about ten seconds; the white water itself is brightest at its toe, with
   streaks and grey-blue shadow up to the crest. Foam lies on the surface, so nearer crests hide it. Ripples on a wave face catch the moon
   as short glints.
   Around it: a low moon in drifting thin cloud, stars, a far headland with a lighthouse (its beam sweeps round once in 7.5 s and flashes
   as it passes the lens) and the lights of a coast, a small vessel far out with a masthead light and its reflection, and shearwaters that
   skim the troughs on stiff wings and rise over the crests; each bird is placed in metres and hidden by any nearer crest.
   Data: the lights on the far coast = tokens (every one is always lit), their colour = split (the exact UI blue and amber); the height of
   the swell = 7-day trend; how rough the chop is and how often crests break = cache miss. The sea, the sky, the vessel and the birds carry
   no data. */
function tSwell(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, PX = env.P, SCL = phone ? 1 : Math.max(1, rows / 139), U = 5 / PX * SCL, DN = .5 * SCL, N = cols * rows, S = mulberry(mix(p.seed + 16)), LVN = 9;
  /* U: layout unit in cells (grows with the canvas, so a large screen shows the same view larger, with the same number of depth slices) */
  const TOP = phone ? Math.round(10 * U) : Math.round(rows * .48), MG = phone ? 0 : Math.max(0, Math.floor((env.W - 1240) / 2 / PX)), inCol = c => c >= MG && c < cols - MG;
  const HZ = TOP + Math.round((phone ? 17 : 19) * U), NR = rows - HZ, F = (phone ? 250 : 340) * U, CH = 1.45, CX = cols * .5, G = 9.81, YMIN = TOP + 2;
  /* palette: 0 / 1 the data colours; 2 water in shadow; 3-8 the night ramp, dark to moon (indigo, slate, steel, pale blue, silver, white); 9 foam in shade; 10 foam lit; 11 silhouettes; 12 lamp */
  const PA = [BLUE, OR, [46, 76, 132], [58, 88, 146], [78, 110, 166], [108, 140, 190], [150, 176, 210], [198, 214, 232], [244, 246, 242], [150, 170, 204], [248, 250, 246], [28, 32, 46], [255, 206, 140]];
  const DEEP = 2, R0 = 3, RN = 6, FSH = 9, FLT = 10, ROCK = 11, LAMP = 12;
  /* ---- a small grid with its own painter: one index array for all (colour, level) runs (counting sort), so memory does not grow with colours ---- */
  const KEY = new Uint8Array(N), ORD = new Int32Array(N), CNT = new Int32Array(PA.length * LVN + 1);
  const grid = () => ({b: new Float32Array(N), c: new Uint8Array(N)});
  const paint = (g, cx, gain, halo, r0, r1) => { const b = g.b, cc = g.c, k0 = r0 * cols, k1 = r1 * cols; CNT.fill(0);
    for(let k = k0; k < k1; k++){ const a = b[k]; if(a < .05){ KEY[k] = 255; continue; } const key = cc[k] * LVN + (a >= 1 ? LVN : Math.ceil(a * LVN)) - 1; KEY[k] = key; CNT[key + 1]++; }
    for(let i = 1; i < CNT.length; i++) CNT[i] += CNT[i - 1];
    for(let k = k0; k < k1; k++){ const key = KEY[k]; if(key !== 255) ORD[CNT[key]++] = k; }
    let i0 = 0;
    for(let key = 0; key < CNT.length - 1; key++){ const i1 = CNT[key]; if(i1 === i0) continue;
      const col = PA[(key / LVN) | 0], f = (key % LVN + 1) / LVN, rgb = `${col[0]},${col[1]},${col[2]}`;
      if(halo && f > .85){ const hs = PX * 2.2, ho = (PX - hs) / 2; cx.fillStyle = `rgba(${rgb},${(.1 * gain).toFixed(3)})`; cx.beginPath();
        for(let i = i0; i < i1; i++){ const k = ORD[i]; cx.rect((k % cols) * PX + ho, ((k / cols) | 0) * PX + ho, hs, hs); } cx.fill(); }
      const s = PX * (.42 + .5 * f), o = (PX - s) / 2; cx.fillStyle = `rgba(${rgb},${((.2 + .7 * f) * gain).toFixed(3)})`; cx.beginPath();
      for(let i = i0; i < i1; i++){ const k = ORD[i]; cx.rect((k % cols) * PX + o, ((k / cols) | 0) * PX + o, s, s); }
      cx.fill(); i0 = i1; } };
  const SKY = grid(), SEA = grid(), TOPG = grid();
  /* ---- the light: a low moon at azimuth AS, elevation ES (radians). Tables: the glow low in the sky by elevation (GH), how far a column is
     from the moon (SA), a gamma for the dot sizes, exp(-x) ---- */
  const AS = (phone ? -.05 : -.2 + .06 * p.off), ES = .024, MX = CX + AS * F, MY = HZ - ES * F, MR = Math.max(2.3, .0064 * F);
  const GH = new Float32Array(257), SA = new Float32Array(cols), GAM = new Float32Array(257), EX = new Float32Array(257), TXc = new Float32Array(cols);
  for(let i = 0; i <= 256; i++){ GH[i] = Math.exp(-(i / 160) / .35); GAM[i] = Math.pow(i / 256, .8); EX[i] = Math.exp(-i / 32); }
  for(let c = 0; c < cols; c++){ TXc[c] = (c - CX) / F; const da = (TXc[c] - AS) / .5; SA[c] = Math.exp(-da * da); }
  /* thin cloud: a slow field that drifts across the sky; where it lies over the moon it takes some of the light off the water */
  const cloud = (c, y, dr) => sstep(.55, .76, noise(c * .012 / U + dr + 40, y * .3 / U + 7) + .25 * noise(c * .05 / U + dr * 2, y * .8 / U));
  let DR0 = 0; const drift = tm => DR0 + tm * .016 * p.speed, moonLight = tm => 1 - .62 * cloud(MX, MY, drift(tm));
  { let best = -1; for(let i = 0; i < 240; i++){ DR0 = i * .37; const a = cloud(MX, MY, drift(14)), b = cloud(MX, MY, drift(19)), c = cloud(MX, MY, drift(9)), sc = (a < .05 ? 2 : 0) + (b > .3 && b < .9 ? 1 : 0) + (c < .3 ? .5 : 0); if(sc > best){ best = sc; if(sc > 3.4) break; } }
    if(best <= 3.4){ let bi = 0; best = -1; for(let i = 0; i < 240; i++){ DR0 = i * .37; const a = cloud(MX, MY, drift(14)), b = cloud(MX, MY, drift(19)), sc = (a < .05 ? 2 : 0) + (b > .3 && b < .9 ? 1 : 0); if(sc > best){ best = sc; bi = i; } } DR0 = bi * .37; } }   /* start the cloud where the moon is clear at the static frame and a thin cloud reaches it a few seconds later */
  /* ---- waves, in metres and seconds. Deep water: omega = sqrt(g k). Each train is a trochoid (table of height and slope by phase).
     The three swell trains are phased to stand crest on crest 22 m in front of the lens 4.5 s after the static frame: that is the set. ---- */
  const hs = .8 + .4 * D.trendK, ch = .55 + .45 * clamp01(D.jitter * .5), sd = Math.PI - (.34 + .1 * p.tilt), wd = sd + .5, TC = 40, NB = 5; let T0 = TC;
  const WV = [[26, sd, .46 * hs], [21, sd + .4, .32 * hs], [36, sd - .34, .3 * hs], [15, wd, .2 * hs], [10.5, wd - .7, .14 * hs], [6.7, wd + .4, .07 * ch], [4.3, wd - .5, .05 * ch], [2.9, wd + .2, .035 * ch], [1.9, wd - .3, .022 * ch]];
  const NW = WV.length, TN = 1024, TM = TN - 1, TAB = new Float32Array(NW * TN * 2), KX = new Float64Array(NW), KZ = new Float64Array(NW), OM = new Float64Array(NW), PH = new Float64Array(NW), SV = new Float64Array(NW);
  WV.forEach(([lam, dir, amp], i) => { const k = TAU / lam, qo = Math.min(.7, k * amp * (i < 3 ? 4 : 2.6)); KX[i] = k * Math.sin(dir); KZ[i] = k * Math.cos(dir); OM[i] = Math.sqrt(G * k); PH[i] = i < 3 ? OM[i] * (TC - 1) - KZ[i] * 40 : S() * TAU; SV[i] = k * amp * k * amp / 2;
    for(let n = 0; n < TN; n++){ const th = n / TN * TAU; let t0 = th; for(let it = 0; it < 8; it++) t0 = th + qo * Math.sin(t0);
      TAB[(i * TN + n) * 2] = amp * (Math.cos(t0) + qo / 2); TAB[(i * TN + n) * 2 + 1] = -amp * Math.sin(t0) / (1 - qo * Math.cos(t0)); } });
  const hAt = (x, z, t) => { let h = 0; for(let i = 0; i < NB; i++) h += TAB[(i * TN + (((KX[i] * x + KZ[i] * z - OM[i] * t + PH[i]) / TAU % 1 + 1) * TN & TM)) * 2]; return h; };
  const camH = t => CH + .45 * hAt(0, 0, t);
  /* ---- depth slices, near to far, evenly spaced in screen rows over a flat sea (coarser in front of the bottom edge, where only a crest can
     reach the picture); per slice, which trains are still resolved: a train shorter than a few rows of depth is left out and counted as roughness ---- */
  const NS = []; for(let n = NR * 3; n > NR; n -= 5 * DN) NS.push(n); const JB = NS.length; for(let n = NR; n > .3; n -= DN) NS.push(n);
  const NJ = NS.length, ZJ = new Float64Array(NJ), WJ = new Float32Array(NJ * NW), SG = new Float32Array(NJ), CL = new Float32Array(NJ);
  for(let j = 0; j < NJ; j++){ const z = F * CH / NS[j]; ZJ[j] = z; CL[j] = clamp01(1.25 - z / 150); const dzr = z * z / (F * CH); let s2 = .01;
    for(let i = 0; i < NW; i++){ const w = sstep(.7, 2, WV[i][0] / Math.max(.35, Math.abs(Math.cos(WV[i][1]))) / dzr); WJ[j * NW + i] = w; s2 += (1 - w * w) * SV[i]; } SG[j] = s2; }
  const jOf = z => { const n = F * CH / z; return n > NR ? (NR * 3 - n) / (5 * DN) : JB + (NR - n) / DN; };
  /* ---- whitecaps. A crest of the main swell breaks where it stands high on the other trains. Each breaker is one event, hashed from
     (which crest, where along it, which few seconds). While it breaks, white water lies from the crest a little way down its front;
     what the crest leaves behind stays where it was made and ages. Along the crest the patch is widest in the middle of the breaker's
     life and its ends are ragged. Foam is written into a table over (slice, column) and picked up by the march. ---- */
  const BW = 0, bk = TAU / WV[BW][0], bdx = Math.sin(WV[BW][1]), bdz = Math.cos(WV[BW][1]), bc = OM[BW] / bk, LS = 24, TE = 4, TF = 12, ZB = 85;
  const FO = new Float32Array(NJ * cols), RATE = .6 + .4 * clamp01(D.jitter * .5), GT = WV[BW][2] + .16 * hs, EV = [], ZN = ZJ[JB] * .8; let EVE = NaN, FC = 0;
  const foam = (t, cnt) => { if(!cnt) FO.fill(0); FC = 0; const xa = ZN / F, xb = ZB / F; let a0 = 1e9, a1 = -1e9, s0 = 1e9, s1 = -1e9;
    for(const [x, z] of [[-CX * xa, ZN], [(cols - CX) * xa, ZN], [-CX * xb, ZB], [(cols - CX) * xb, ZB]]){ const a = bdx * x + bdz * z, s = -bdz * x + bdx * z; a0 = Math.min(a0, a); a1 = Math.max(a1, a); s0 = Math.min(s0, s); s1 = Math.max(s1, s); }
    const E0 = Math.floor(t / TE);
    if(E0 !== EVE){ EVE = E0; EV.length = 0; const m0 = Math.floor((s0 - 14) / LS), m1 = Math.ceil((s1 + 14) / LS);   /* the breakers alive in this stretch of time: a pure function of E0, kept until it changes */
      for(let e = E0 - 4; e <= E0; e++){ const n0 = Math.floor(((a0 - 30) * bk - OM[BW] * (e + 1) * TE + PH[BW]) / TAU), n1 = Math.ceil(((a1 + 8) * bk - OM[BW] * e * TE + PH[BW]) / TAU);   /* crests that stood in the view while they were born */
       for(let n = n0; n <= n1; n++) for(let m = m0; m <= m1; m++){ const key = Math.imul(n, 73856093) ^ Math.imul(m, 19349663) ^ Math.imul(e, 83492791) ^ p.seed;
        const tb0 = (e + hash2(key, 2)) * TE, Tb = 1 + 1.2 * hash2(key, 3); if(tb0 + Tb + TF < E0 * TE) continue;
        const sc0 = (m + hash2(key, 4)) * LS, Wm = 4 + 7 * hash2(key, 5), ac0 = (TAU * n + OM[BW] * tb0 - PH[BW]) / bk;
        { const ag = ac0 + bc * Tb / 2, tg = tb0 + Tb / 2, x = bdx * ag - bdz * sc0, z = bdz * ag + bdx * sc0; let hg = 0; for(let i = 0; i < NB; i++) hg += WV[i][2] * Math.cos(KX[i] * x + KZ[i] * z - OM[i] * tg + PH[i]); if(hg < GT || (hg < GT + .3 * hs && hash2(key, 1) > RATE)) continue; }   /* the highest crests of a set always break */
        EV.push(n, m, tb0, Tb, sc0, Wm, ac0); } }
      /* the crest the set is built on (crest 0 of the main train, which the three swell trains were phased to) always breaks, right of the moon's path, as it comes in */
      { const tb0 = TC - 1.6, Tb = 3; if(tb0 + Tb + TF >= E0 * TE && tb0 < (E0 + 1) * TE) EV.push(0, 0, tb0, Tb, -bdz * (phone ? 1 : 5) + bdx * 40, phone ? 4 : 9, (OM[BW] * tb0 - PH[BW]) / bk); } }
    for(let qo = 0; qo < EV.length; qo += 7){ const n = EV[qo], m = EV[qo + 1], tb0 = EV[qo + 2], Tb = EV[qo + 3], sc0 = EV[qo + 4], Wm = EV[qo + 5], ac0 = EV[qo + 6], age0 = t - tb0; if(age0 < 0 || age0 > Tb + TF) continue;
      const tb = Math.min(age0, Tb), L = bc * tb, live = age0 <= Tb, FR = live ? 3.4 : 0;
      let zl = 1e9, zh = -1e9, xl = 1e9, xh = -1e9; for(const a of [ac0 - 1, ac0 + L + FR]) for(const s of [sc0 - Wm * 1.3, sc0 + Wm * 1.3]){ const x = bdx * a - bdz * s, z = bdz * a + bdx * s; zl = Math.min(zl, z); zh = Math.max(zh, z); xl = Math.min(xl, x); xh = Math.max(xh, x); }
      if(zh < ZN || zl > ZB) continue; zl = Math.max(zl, ZN);
      let j0 = Math.ceil(jOf(zl)), j1 = Math.min(NJ - 1, Math.floor(jOf(zh))), cov = 1; if(j1 < j0){ j0 = j1 = Math.min(NJ - 1, Math.round(jOf((zl + zh) / 2))); cov = Math.max(.5, Math.min(1, (zh - zl) / (ZJ[j0] * ZJ[j0] / (F * CH) * .5))); } if(j0 < 0) j0 = 0;
      for(let j = j0; j <= j1; j++){ const z = ZJ[j]; if(cnt && !(z > 15 && z < 42)) continue; const fz = F / z, c0 = Math.max(0, Math.ceil(CX + xl * fz)), c1 = Math.min(cols - 1, Math.floor(CX + xh * fz)), far = fz < 5, fq = Math.max(5, fz * .8);
        for(let c = c0; c <= c1; c++){ const x = (c - CX) / fz, a = bdx * x + bdz * z, sw = -bdz * x + bdx * z - sc0, da = cov < 1 ? Math.max(0, Math.min(L, a - ac0)) : a - ac0; if(da < -1 || da > L + FR || cnt && da <= L) continue;
          const rg = noise(sw * .45 + n * 5.1, da * .45 + m * 3.7), tau = da < 0 ? 0 : da > L ? tb : da / bc, age = age0 - tau, wl = Math.sin(Math.PI * Math.min(.93, Math.max(.07, tau / Tb))) * (.75 + .5 * rg), ds = sw / Wm, lat = 1 - ds * ds / (wl * wl); if(lat <= 0) continue;
          let I, front = 0, toe = 0;
          if(da > L){ const fe = FR * (.3 + .42 * noise(sw * .7 + m * 9.1, t * .9 + n * 2.3) + .36 * noise(sw * 3.3 + n * 4.7, t * 1.6 + m)); if(da - L > fe) continue; if(z > 15 && z < 42) FC++; if(cnt) continue; I = 1; front = 1; toe = (da - L) / fe; }                   /* the white water going down the front */
          else { I = (da < 0 ? 1 + da : 1) * (age < .4 ? 1 : Math.exp(-(age - .4) / 3.5)); if(live && L - da < 1.2) front = 1 - (L - da) / 1.2; }
          I *= Math.min(1, lat * 2.2); if(far) I *= (.45 + .5 * rg) * (front > 0 ? 1 : Math.exp(-age / 2.5));   /* far off only fresh white water shows */ if(I < .04) continue; const st = 1 + .22 * age;
          const nz = far ? rg : .3 * noise(da * 1.1 / st + n * 13.1, sw * 1.1 + m * 7.7) + .3 * noise(da * 2.9 / st + m, sw * 2.9 + n * 5.3) + .4 * noise(da * fq / st + n, sw * fq * .6 + m * 3.3);
          /* behind the front the foam is a net: bright threads round darker cells, the threads thinning with age; at the front it is nearly solid */
          const lace = 1 - Math.abs(2 * nz - 1) * (2.4 + 3.2 * clamp01(age / 6)), body = I * (.3 - .22 * clamp01(age / 4) + .8 * Math.max(0, lace)), fr_ = .4 + .62 * toe * toe + .34 * (noise(sw * 1.7 + m, da * .5 - t * 1.5 + n) - .5) - .5 * (nz - .5);   /* the white water: a bright roller at its toe, streaks and shadow up to the crest */
          const f = (body + (fr_ - body) * front) * cov, k = j * cols + c; if(f > FO[k]) FO[k] = f > 1 ? 1 : f; } } } };
  /* the static frame (tm = 14) is taken at the moment, within the arrival of the set, with the most white water going down the front of a crest in the middle distance (15 to 42 m)
     (capped, so a frame is not chosen for being all foam). foam(t, true) only counts that white water: it skips every cell that cannot add to the count */
  { let best = -1; for(let i = 0; i < 24; i++){ const tc = TC - 6 + i * .4; foam(tc, true); const sc = Math.min(FC, cols * 3) + (i === 15 ? 1 : 0); if(sc > best){ best = sc; T0 = tc; } } }
  /* ---- life at natural scale. Shearwaters: stiff-winged birds that skim the troughs and arc up over the crests, banked, with a short
     burst of quick flaps now and then; placed in metres at the distance where the wings span eight to twelve cells, hidden by nearer
     crests. The first crosses the moon's path at the static frame. A vessel far out with a masthead light. ---- */
  const hid = (x, y, z, t, ch) => { for(let f = .2; f < .97; f += .08){ if(hAt(x * f, z * f, t) > ch + (y - ch) * f) return true; } return false; };
  const BD = Array.from({length: phone ? 2 : 4}, (_, i) => { const per = 15 + 8 * S(); return {w: 4 + 2 * S(), per, ph: i === 0 ? .5 : i === 1 ? .5 - 4.5 / per : S(), dir: i % 2 ? -1 : 1, arc: 4.4 + 2 * S(), ap: S() * TAU}; });
  const yt = new Int16Array(cols), ER = [];
  /* things drawn over the sea: far ones (at the horizon) are not drawn where the sea stands in front of them */
  const tput = (x, y, b, c, far) => { x = Math.round(x); y = Math.round(y); if(x < 0 || x >= cols || y < TOP + 1 || y >= rows || (far && y >= yt[x])) return; const k = y * cols + x; if(TOPG.b[k] === 0) ER.push(k); if(b > TOPG.b[k]){ TOPG.b[k] = b; TOPG.c[k] = c; } };
  const birds = (tm, t, ch) => { for(const qo of BD){ const u = ((tm - 14) * p.speed / qo.per + qo.ph) % 1, uu = u < 0 ? u + 1 : u, z = .6 * F / qo.w * (1 + .1 * Math.sin(t * .17 + qo.ap)), x = (AS + qo.dir * (uu * 2 - 1) * (phone ? .2 : .42)) * z;
      const a = t * TAU / qo.arc + qo.ap, up = Math.max(0, Math.sin(a)), y = hAt(x, z, t) + .3 + 1.5 * up * Math.sqrt(up), roll = qo.dir * .4 * Math.cos(a) * (up > 0 ? 1 : .3);
      if(hid(x, y, z, t, ch)) continue; const flap = Math.sin(a + 2.2) > .72 ? .45 * Math.sin(t * TAU * 3.4) : .1, fz = F / z, bx = Math.round(CX + x * fz), by = Math.round(HZ + (ch - y) * fz), W2 = .6 * fz, n = Math.ceil(W2 * 1.5), d = qo.dir;
      for(const sg of [-1, 1]) for(let i = 1; i <= n; i++){ const s_ = i / n, an = (flap + sg * roll) * (.3 + .7 * s_), wx = bx + sg * W2 * s_ * Math.cos(an) - d * .3 * W2 * s_ * s_, wy = by - W2 * s_ * Math.sin(an) - .2 * W2 * Math.sin(Math.PI * Math.min(1, s_ * 1.2));   /* a wing: arched at the wrist, swept back toward the tip */
        tput(wx, wy, .3, ROCK); if(s_ < .3) tput(wx, wy + 1, .3, ROCK); }
      tput(bx, by, .3, ROCK); tput(bx, by + 1, .3, ROCK); tput(bx + d, by, .3, ROCK); tput(bx + 2 * d, by, .3, ROCK); tput(bx - d, by + 1, .3, ROCK); } };
  const boat = (t, ch) => { const z = 420, x = (AS + (phone ? .09 : .14) - (t - TC) * .0013) * z, fz = F / z, hl = 5 * fz, h0 = hAt(x - 4, z, t), h1 = hAt(x + 4, z, t), bx = Math.round(CX + x * fz), by = Math.round(HZ + (ch - (h0 + h1) / 2) * fz) - 1, pt = (h1 - h0) / 8 * fz, mx = Math.round(bx - hl * .15);
    for(let u = -hl; u <= hl; u += .5){ const yy = by + pt * u; tput(bx + u, yy, .3, ROCK, 1); if(u > -hl * .55 && u < hl * .3){ tput(bx + u, yy - 1, .3, ROCK, 1); if(u > -hl * .35 && u < 0) tput(bx + u, yy - 2, .3, ROCK, 1); } }
    for(let w = 1; w <= 2; w++) tput(mx, by - 2 - w, .3, ROCK, 1); tput(mx, by - 5, 1, LAMP, 1);
    for(let r = 1; r <= 5; r++){ const hh = hash2(r + Math.floor(t * 4), 7); if(hh > .75) continue; tput(mx + Math.round((hash2(r, Math.floor(t * 3)) - .5) * (1 + r * .5)), by + r, .85 - .13 * r, LAMP, 1); } };   /* the light on the water under it */
  /* ---- the far coast: a low headland and a higher ridge behind it, in rows above the horizon per column; lights along it = tokens ---- */
  const CS = cols * (phone ? .46 : .6 + .03 * p.off), CO1 = new Float32Array(cols), CO2 = new Float32Array(cols);
  for(let c = 0; c < cols; c++){ const d = (c - CS) / U, e1 = sstep(0, 14, d), e2 = sstep(26, 80, d);
    CO1[c] = e1 * (2.2 + 4.6 * noise(d * .028 + 9, 3.3) + 1.6 * noise(d * .11, 8.1) + (d < 30 ? 1.5 * sstep(30, 6, d) : 0)) * U; CO2[c] = e2 * (5 + 8 * noise(d * .014 + 2, 6.6) + 1.5 * noise(d * .07, 1.4)) * U; }
  const NL = Math.min(40, Math.round(D.nPart * .03)), LT = []; for(let i = 0, g = 0; i < NL && g < NL * 60; g++){ const c = Math.floor(CS + 4 * U + X.rnd() * (cols - CS - 5 * U)), qo = X.rnd(), y = HZ - 1 - Math.floor(qo * qo * Math.max(1, CO1[c] - 1.5)), cx = X.rnd() > D.share ? 1 : 0, ph = X.rnd() * TAU;
    if(c < cols - 1 && CO1[c] >= 1.5 && !LT.some(l => Math.abs(l.c - c) < 2 && Math.abs(l.y - y) < 2)){ LT.push({c, y, cx, ph}); i++; } }
  const LHX = Math.round(CS + 9 * U), LHY = HZ - Math.round(CO1[Math.min(cols - 1, LHX)]) - 2;
  const lamps = tm => { for(const l of LT) tput(l.c, l.y, .6 + .3 * Math.sin(tm * 2.3 + l.ph) * Math.sin(tm * .7 + l.ph * 3), l.cx, 1);
    if(LHX < cols - 2){ const th = TAU * ((tm * p.speed / 7.5) % 1), fc = Math.cos(th), sn = Math.sin(th); tput(LHX, LHY + 1, .3, FSH, 1); tput(LHX, LHY, fc > .955 ? 1 : .4, FLT, 1);   /* the beam goes round; it is a streak to one side, then a flash as it points here, then a streak to the other */
      if(fc > .955){ tput(LHX - 1, LHY, .6, FLT, 1); tput(LHX + 1, LHY, .6, FLT, 1); tput(LHX, LHY - 1, .6, FLT, 1); }
      else if(fc > -.25){ const len = Math.round(14 * U * Math.abs(sn)), sg = sn > 0 ? 1 : -1; for(let i = 1; i <= len; i++) tput(LHX + sg * i, LHY, (.34 + .2 * fc) * (1 - .7 * i / len), R0 + 4, 1); } } };
  /* ---- the slow layer (kept in its own canvas, redrawn a band at a time): the night sky, the moon in thin drifting cloud, stars, the coast ---- */
  const stars = Array.from({length: phone ? 16 : Math.round(90 * SCL)}, () => ({x: S(), y: S(), b: S(), w: S() * TAU}));
  const MK = new Float32Array(rows); for(let r = 0; r < rows; r++) MK[r] = 1 + .5 * clamp01(((rows - r) / rows - .14) / .26);   /* the page fades the canvas toward the top of the band: draw brighter there */
  const wcol = (bb, th) => bb < .28 ? DEEP : R0 + Math.min(RN - 1, ((bb - .28) * 8.2 + th) | 0);
  /* the sky is kept in its own canvas, only as tall as the sky */
  const oc = document.createElement('canvas'), ox = oc.getContext('2d'), OH = HZ * PX; oc.width = Math.round(env.W * env.dpr); oc.height = Math.round(OH * env.dpr);
  const NS_ = HZ * cols, SB0 = new Float32Array(NS_), SH1 = new Float32Array(NS_), SH2 = new Float32Array(NS_), SCO = new Int8Array(NS_), HF = new Float32Array(HZ), CW = (cols >> 2) + 2, CR = (HZ >> 1) + 2, CG = new Float32Array(CW * CR);
  for(let y = 0; y < HZ; y++){ const h = HZ - y; HF[y] = sstep(2 * U, 6 * U, h); for(let c = 0; c < cols; c++){ const k = y * cols + c, dx = c - MX, dy = y - MY, d2 = dx * dx + dy * dy;
      SH1[k] = .34 * Math.exp(-d2 / (MR * MR * 5)) + .13 * Math.exp(-d2 / (MR * MR * 60)); SH2[k] = .16 + .5 * Math.exp(-d2 / (MR * MR * 60)); SB0[k] = .17 + .32 * Math.exp(-h / (7 * U)) * (.6 + .4 * SA[c]);
      SCO[k] = (y < TOP && inCol(c)) ? -1 : h <= CO1[c] ? 2 : h <= CO2[c] ? 1 : d2 < MR * MR ? 3 : 0; } }
  const skyRows = (tm, r0, r1) => { const sb = SKY.b, sc = SKY.c, dr = drift(tm); sb.fill(0, r0 * cols, r1 * cols);
    for(let gy = r0 >> 1; gy <= (r1 >> 1) + 1 && gy < CR; gy++) for(let gx = 0; gx < CW; gx++) CG[gy * CW + gx] = cloud(gx * 4, gy * 2, dr);                 /* the cloud field on a coarse grid, read back smoothly */
    for(let y = r0; y < r1; y++){ const gy = y >> 1, fy = (y & 1) * .5, o0 = gy * CW, o1 = o0 + CW, hf = HF[y], mk = .6 + .4 * MK[y];
      for(let c = 0; c < cols; c++){ const k = y * cols + c, co = SCO[k]; if(co < 0) continue; const th = (BAYER[(c & 3) + ((y & 3) << 2)] + .5) / 16;
        if(co === 2){ sb[k] = .2 + (th - .5) / LVN; sc[k] = ROCK; continue; } if(co === 1){ sb[k] = .13 + (th - .5) / LVN; sc[k] = R0; continue; }
        const gx = c >> 2, fx = (c & 3) * .25, a0 = CG[o0 + gx] + (CG[o0 + gx + 1] - CG[o0 + gx]) * fx, a1 = CG[o1 + gx] + (CG[o1 + gx + 1] - CG[o1 + gx]) * fx, cl = (a0 + (a1 - a0) * fy) * hf;
        let b = SB0[k] + SH1[k] * (1 - .5 * cl); if(cl > 0) b += (SH2[k] - b) * cl * .8; if(co === 3) b = (1 - .45 * cl) * (.9 + .1 * hash2(c, y)); else b *= mk;
        sb[k] = (b > 1 ? 1 : b) + (th - .5) / LVN; sc[k] = wcol(b < .29 ? .29 : b, th); } }
    for(const s of stars){ const c = Math.floor(s.x * cols), y = Math.floor(s.y * s.y * (HZ - 5 * U)), k = y * cols + c; if(y < r0 || y >= r1 || SCO[k] !== 0 || HZ - y <= CO2[c] + 1) continue;
      const v = (.22 + .5 * s.b * s.b) * (.75 + .25 * Math.sin(tm * 1.7 + s.w)) * (1 - cloud(c, y, dr) * HF[y]); if(v > sb[k]){ sb[k] = v; sc[k] = R0 + 4; } }
    ox.setTransform(env.dpr, 0, 0, env.dpr, 0, 0); ox.clearRect(0, r0 * PX, env.W, (r1 - r0) * PX); paint(SKY, ox, .9, false, r0, r1); };
  /* the sky is redrawn one band of rows at a time on a fixed time grid, so that no frame pays for the whole sky and the picture still depends on tm
     alone: step j = floor(tm / 0.2) redraws band j mod 5 for the time j * 0.2, so every band always shows its own latest grid time (the bands
     are at most a second apart in cloud time, which does not show in a soft slow cloud). The first frame and any jump redraw all five. */
  const NB_ = 5, SDT = .2, band = (jb, b) => skyRows(jb * SDT, Math.floor(HZ * b / NB_), Math.floor(HZ * (b + 1) / NB_)); let skyJ = NaN;
  const tick = tm => { const j = Math.floor(tm / SDT); if(j === skyJ) return; const b0 = ((j % NB_) + NB_) % NB_;
    if(j === skyJ + 1) band(j, b0); else for(let i = 0; i < NB_; i++) band(j - i, (((j - i) % NB_) + NB_) % NB_);
    skyJ = j; };
  const pb = new Float32Array(cols), pp = new Float32Array(cols), pf = new Float32Array(cols), py = new Float32Array(cols), hS = new Float32Array(cols), xS = new Float32Array(cols), zS = new Float32Array(cols), xC = new Float32Array(cols), zC = new Float32Array(cols);
  const RIP = .8;                                                                                   /* chop too fine for the rows still tilts the facets near the lens (slope only), so the water glints */
  return tm => {
    tick(tm); const t = (tm - 14) * p.speed + T0, sb = SEA.b, sc = SEA.c, ML = moonLight(tm), ch = camH(t); sb.fill(0, YMIN * cols); yt.fill(rows); py.fill(1e9); foam(t);
    for(let j = 0; j < NJ; j++){ const z = ZJ[j], zf = z / F; hS.fill(0); xS.fill(0); zS.fill(0); xC.fill(0); zC.fill(0);
      for(let i = 0; i < NW; i++){ const w = WJ[j * NW + i], ws = i >= NB ? Math.max(w, RIP * (.45 + .55 * clamp01(1.5 - z / 110))) : w; if(ws <= 0) continue; const kx = KX[i] * ws, kz = KZ[i] * ws, d = KX[i] * zf / TAU * TN, o = i * TN * 2, ax_ = i < NB ? xS : xC, az_ = i < NB ? zS : zC;
        let ph = ((KZ[i] * z - OM[i] * t + PH[i]) / TAU % 1 + 1) * TN - CX * d + 4096 * TN;
        for(let c = 0; c < cols; c++){ const qo = o + ((ph & TM) << 1), s = TAB[qo + 1]; hS[c] += w * TAB[qo]; ax_[c] += s * kx; az_[c] += s * kz; ph += d; } }
      const s2 = SG[j], is2 = 16 / s2, rgh = .25 * Math.sqrt(s2), iz = 1 / z, cl = CL[j];
      for(let c = 0; c < cols; c++){ const h = hS[c], ang = (ch - h) * iz, y = HZ + ang * F, top = yt[c];
        if(y >= top){ if(py[c] < 1e8 && cl > 0){ const k = top * cols + c, v = cl * (.34 + .4 * SA[c] * ML) * (.75 + .5 * hash2(c >> 2, top)); if(v > sb[k] && sc[k] !== FLT){ sb[k] = v; sc[k] = wcol(v, .5); } }   /* the crest line: the last of a wave before the surface drops out of sight */
          py[c] = 1e9; continue; }
        const sx = xS[c] + .8 * xC[c], sz = zS[c] + .8 * zC[c], tx = TXc[c], inv = 1 / Math.sqrt(1 + sx * sx + sz * sz), ci = Math.max(.004, (sx * tx + ang + sz) * inv), f1 = 1 - ci, fr = .04 + .96 * f1 * f1 * f1;
        const e = 2 * ci * inv - ang + rgh, da = tx - 2 * ci * inv * sx - AS, de = e - ES, d2 = de * de + da * da, gh = GH[e <= 0 ? 0 : e >= 1.6 ? 256 : (e * 160) | 0];
        let rp, b = fr * (.2 + .3 * gh * (.4 + .6 * SA[c]) + ML * (.34 * EX[d2 >= .09 ? 256 : (d2 * 2800) | 0] + .13 * EX[d2 >= 1.2 ? 256 : (d2 * 210) | 0])) + (1 - fr) * (.13 + .5 * clamp01(.62 - 2.2 * zS[c] - 3 * zC[c] + .14 * h) + .5 * clamp01(-7 * zC[c] - .12) + .12 * clamp01(1.4 - 1.2 * zS[c]) + .16 * clamp01(h * .8)); rp = cl > 0 ? clamp01(-9 * zC[c] - .35) * cl * ML : 0;
        const gx = xS[c] + xC[c], gz = zS[c] + zC[c], sxn = (tx - AS) / (ES + ang), szn = (ES - ang) / 2 - sxn * tx, ex = gx - sxn, ez = gz - szn, q2 = (ex * ex + ez * ez) * is2, P = q2 >= 256 ? 0 : EX[q2 | 0] * ML;
        b += .4 * P * P; const fo = FO[j * cols + c];
        const y0 = Math.max(YMIN, Math.ceil(y)), yp = py[c];
        for(let r = top - 1; r >= y0; r--){ const k = r * cols + c, th = (BAYER[(c & 3) + ((r & 3) << 2)] + .5) / 16; let bb = b, gg = P, ff = fo;
          if(yp < 1e8 && yp > y + .01){ const w = Math.min(1, (r - y) / (yp - y)); bb += (pb[c] - b) * w; gg += (pp[c] - P) * w; ff += (pf[c] - fo) * w; }
          if(gg > .03 && hash2(k, Math.floor(t * 6 + 9 * hash2(c, r))) < gg * .6) bb = 1;
          else if(rp > .05 && hash2(k >> 1, Math.floor(t * 5 + 7 * hash2(r, c >> 1))) < rp * .13) bb = .55 + .3 * rp;   /* a ripple on a wave face catches the moon for a moment */
          bb *= .55 + .45 * MK[r]; let col = wcol(bb, th);
          if(ff > .12){ const a = Math.min(1, ff * 2.6); bb += (.3 + .78 * ff - bb) * a; if(ff + th * .25 > .26) col = ff > .62 ? FLT : FSH; }
          sb[k] = GAM[bb >= 1 ? 256 : (bb * 256) | 0] + (th - .5) / LVN; sc[k] = col; }
        if(y0 < top) yt[c] = y0; py[c] = y; pb[c] = b; pp[c] = P; pf[c] = fo; } }
    let ym = HZ;
    for(let c = 0; c < cols; c++){ const yc = yt[c]; if(yc < ym) ym = yc;
      if(yc < HZ){ const k = yc * cols + c, v = .45 + .5 * SA[c] * ML; if(v > sb[k] && sc[k] !== FLT){ sb[k] = v; sc[k] = wcol(v, .5); } }                 /* a crest that stands against the sky */
      for(let r = yc - 1; r >= HZ; r--){ const k = r * cols + c, th = (BAYER[(c & 3) + ((r & 3) << 2)] + .5) / 16; sb[k] = GAM[pb[c] >= 1 ? 256 : (pb[c] * 256) | 0] + (th - .5) / LVN; sc[k] = wcol(pb[c], th); } }   /* the last strip of sea under the horizon */
    for(const k of ER) TOPG.b[k] = 0; ER.length = 0; birds(tm, t, ch); boat(t, ch); lamps(tm);
    ax.drawImage(oc, 0, 0, env.W, OH);
    if(ym < HZ){ for(let c = 0; c < cols; c++) if(yt[c] < HZ) ax.clearRect(c * PX, yt[c] * PX, PX, (HZ - yt[c]) * PX); }                                   /* water in front of the sky */
    paint(SEA, ax, .95, true, ym, rows);
    if(ER.length){ for(const k of ER) ax.clearRect((k % cols) * PX, ((k / cols) | 0) * PX, PX, PX); paint(TOPG, ax, 1, true, TOP, rows); }
  };
}
/* 17 pond rain.
   Adapted from ascii.rest piece 'pond-ripples' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: raindrops land at hashed times and places on a pond, each a splash and then rings that spread, thin out and fade
   before the bank; where rings cross they add. Rebuilt to read like footage of rain on a small lotus pond under an overcast sky.
   The water is a surface in metres seen from a lens 0.27 m above it. Each cell is shaded from the slope of the water under it: the slope
   turns the mirror, so the cell shows a higher or lower part of what stands behind the pond (pale sky over dark trees and reeds), and a
   ring is a pair of light and dark crescents, squeezed by the low angle of view.
   Rings follow the dispersion of water waves with surface tension (omega^2 = g k + (sigma / rho) k^3): each wavelength travels at its own
   group speed, so the short capillary ripples are outside, the 4.4 cm waves (the slowest, 0.18 m/s) are last, and inside them the water
   is at rest. Floating pads stop the waves and send part back. A drop is a streak in the air, a crown, a jet that lets go of a bead, then
   rings. Rain comes in showers; wind ruffles the water in patches.
   On the water: lily pads; lotus leaves that dip under drops, gather a pool, tip, pour it and spring back; a flower, a bud and a seed
   pod; reeds and trees on the far bank; a frog that now and then leaps in and later climbs back; koi under the surface. The layout is
   mirrored on some dates.
   Not physical, for the grid: far waves are drawn no shorter than the rows can hold; reflectance stays above 0.62; ring slopes are capped.
   Data: mean drops a minute = tokens (the caption count); how far the showers swing = 7-day trend; wind on the water = cache miss.
   The Claude Code / Codex split is not drawn. */
function tPond(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, PX = env.P, sp = p.speed, N = cols * rows, S = mulberry(mix(p.seed + 17)), LVN = 9, PART = 63;
  const FLP = p.tilt > 0 ? 1 : -1, SD = p.seed & 0xfff, SCL = phone ? 1 : Math.max(1, rows / 139), MG = phone ? 0 : Math.max(0, Math.floor((env.W - 1240) / 2 / PX)), inCol = c => c >= MG && c < cols - MG;
  /* ---- the view. TOP: first row that may be lit inside the text column; WL: the far waterline; HZ: the horizon (hidden behind the far bank) ---- */
  const TOP = phone ? 11 : Math.round(rows * .48), WL = TOP + Math.round((phone ? 6 : 5) * SCL), HZ = WL - Math.round(14 * SCL), CH = phone ? .4 : .27, ZN = phone ? .38 : .45;
  const FC = (rows - HZ) * ZN, F = FC / CH, CX = cols * .5, G = 9.81, ZB = FC / (WL - HZ), EH = rows - WL + Math.round(120 * SCL);
  const ZR = new Float32Array(rows), SAr = new Float32Array(rows), CAr = new Float32Array(rows), MK = new Float32Array(rows);
  for(let r = 0; r < rows; r++){ const d = Math.max(1, r - HZ); ZR[r] = FC / d; const l = Math.hypot(d, F); SAr[r] = d / l; CAr[r] = F / l; MK[r] = 1 + (phone ? 1.3 : .5) * clamp01(((rows - r) / rows - .14) / .26); }
  const colOf = (x, z) => CX + F * x / z, rowOf = (y, z) => HZ + F * (CH - y) / z;
  /* palette: 0 / 1 the data colours (not used); 2-7 water and sky, dark green to silver; 8 white water */
  const PA = [BLUE, OR, [24, 44, 40], [40, 70, 60], [66, 100, 86], [106, 138, 124], [158, 180, 170], [210, 222, 214], [240, 244, 238],
    [34, 80, 58], [62, 122, 82], [112, 164, 108], [172, 204, 148], [158, 184, 84],          /* 9-12 lotus leaf, 13 its underside */
    [40, 88, 46], [80, 136, 60], [138, 178, 84], [128, 84, 60],                                /* 14-16 lily pad, 17 bronze */
    [172, 70, 108], [224, 128, 158], [246, 208, 216], [226, 190, 84],                         /* 18-20 petals, 21 gold */
    [50, 72, 34], [94, 126, 48], [150, 172, 86], [214, 208, 170], [14, 18, 16],               /* 22-24 frog, 25 cream, 26 black */
    [226, 104, 44], [232, 222, 204], [196, 62, 40], [112, 124, 70]];   /* 27-29 koi, 30 reed */
  const W0 = 2, WHT = 8;
  /* ---- one grid, one painter: a counting sort by (colour, level), one path each ---- */
  const FB = new Float32Array(N), FK = new Uint8Array(N), BGB = new Float32Array(N), BGK = new Uint8Array(N), KEY = new Uint16Array(N), ORD = new Int32Array(N), CNT = new Int32Array(PA.length * LVN + 1);
  const paint = () => { CNT.fill(0);
    for(let k = 0; k < N; k++){ const a = FB[k]; if(a < .05){ KEY[k] = 65535; continue; } const key = FK[k] * LVN + (a >= 1 ? LVN : Math.ceil(a * LVN)) - 1; KEY[k] = key; CNT[key + 1]++; }
    for(let i = 1; i < CNT.length; i++) CNT[i] += CNT[i - 1];
    for(let k = 0; k < N; k++){ const key = KEY[k]; if(key !== 65535) ORD[CNT[key]++] = k; }
    let i0 = 0;
    for(let key = 0; key < CNT.length - 1; key++){ const i1 = CNT[key]; if(i1 === i0) continue;
      const col = PA[(key / LVN) | 0], f = (key % LVN + 1) / LVN, s = PX * (.42 + .5 * f), o = (PX - s) / 2; ax.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${(.2 + .7 * f).toFixed(3)})`; ax.beginPath();
      for(let i = i0; i < i1; i++){ const k = ORD[i]; ax.rect((k % cols) * PX + o, ((k / cols) | 0) * PX + o, s, s); }
      ax.fill(); i0 = i1; } };
  const TN = 1024, TM = TN - 1, TK = TN / TAU, SIN = new Float32Array(TN); for(let i = 0; i < TN; i++) SIN[i] = Math.sin(i / TK);
  const BT = Float32Array.from(BAYER, v => (v + .5) / 16), bay = (c, r) => BT[(c & 3) + ((r & 3) << 2)];
  /* ---- what the water mirrors: the far side as (column, rows above the far waterline): bank, reeds, trees with a gap, sky. Upright, the same
     picture is the strip of far bank. ENM is the picture blurred, for water too rough to mirror. ---- */
  const ENB = new Float32Array(cols * EH), ENM = new Float32Array(cols * EH), ENK = new Uint8Array(cols * EH), SK = new Float32Array(cols);
  { const gap = cols * (.5 + FLP * (phone ? .2 : .16 + .05 * p.off)), gw = cols * (phone ? .2 : .1), U = SCL;
    for(let c = 0; c < cols; c++){ const d = (c - gap) / gw; SK[c] = (8 + 30 * noise(c * .011 / U + 3, 1.7) + 9 * noise(c * .05 / U, 9.2)) * U * (1 - .7 * Math.exp(-d * d)) + 34 * U * sstep(.6, .15, FLP > 0 ? c / cols : 1 - c / cols); }
    for(let h = 0; h < EH; h++) for(let c = 0; c < cols; c++){ const k = h * cols + c, e = SK[c] + 9 * U * (noise(c * .09 / U, h * .09 / U) - .5) + 5 * U * (noise(c * .31 / U, h * .31 / U) - .5); let b, col = 255;
      if(h < 2 * U){ b = .1; }
      else if(h < e){ const f = noise(c * .06 / U + 20, h * .05 / U), tr = noise(c * .045 / U + 70, 3.1) > .7 && h < e * .6; b = tr ? .07 : .09 + .1 * f * f + .06 * (h / e); }                                                    /* sky through the leaves */
      else b = Math.min(phone ? .42 : 1, .22 + .78 * Math.pow(h / Math.hypot(h, F), 1.6)) * (.88 + .24 * noise(c * .007 / U, h * .03 / U + 40)) * sstep(e, e + 5 * U, h + 2 * U) + .1;
      ENB[k] = b; ENK[k] = col; }
    const nr = Math.round(cols * (phone ? .5 : .42));                                             /* reeds along the far bank: blades of unequal height, some bent */
    for(let i = 0; i < nr; i++){ const c0 = S() * cols, hh = (5 + 26 * S() * S()) * U * (.5 + noise(c0 * .02 / U, 5.5)), ln = (S() - .5) * .5, b = .2 + .16 * S(), bend = S() < .3 ? .6 + S() : 0;
      for(let h = 0; h < hh; h++){ const u = h / hh, c = Math.round(c0 + ln * h + bend * u * u * 6 * U); if(c < 0 || c >= cols || h >= EH) continue; ENB[h * cols + c] = b * (1 - .3 * u); ENK[h * cols + c] = 30; } }
    for(let c = 0; c < cols; c++){ let s = 0, n = 0; const R = Math.round(11 * U);                 /* a box blur up and down the picture */
      for(let h = -R; h < EH; h++){ if(h + R < EH){ s += ENB[(h + R) * cols + c]; n++; } if(h - R - 1 >= 0){ s -= ENB[(h - R - 1) * cols + c]; n--; } if(h >= 0) ENM[h * cols + c] = s / n; } }
    for(let c = 0; c < cols; c++) for(let r = 0; r < WL; r++){ if(r < TOP && inCol(c)) continue; const h = WL - 1 - r; if(h >= EH) continue; const k = r * cols + c, b = Math.min(1, ENB[h * cols + c] * (ENK[h * cols + c] !== 255 ? 2 : 1.5) * MK[r]);
      BGB[k] = clamp01(b + (bay(c, r) - .5) / LVN); BGK[k] = ENK[h * cols + c] !== 255 ? ENK[h * cols + c] : W0 + Math.min(5, (b * 6.4 + bay(c, r)) | 0); } }
  /* ---- rings. A point disturbance at time 0 shows, at distance r and time t, the waves whose group speed is r / t: one gravity wave and one
     capillary wave for each speed above the minimum. Tables by i = NX sqrt((r / t - XI0) / XR): wavenumber and slope amplitude for both, with
     the damping of short waves by age, for three sizes of source. ---- */
  const SG = 7.4e-5, NX = 160, XR = .5, NBIN = 12, LIFE = 3.4, om = k => Math.sqrt(G * k + SG * k * k * k), cgf = k => (G + 3 * SG * k * k) / (2 * om(k));
  let K0 = 144; for(let i = 0; i < 40; i++){ const a = K0 * .999, b = K0 * 1.001; K0 = cgf(a) < cgf(b) ? a : b; } const XI0 = cgf(K0) * 1.0005;
  const KT = new Float32Array(2 * NX), DXI = new Float32Array(NX), LAL = new Float32Array(2 * NX), PHL = new Float32Array(2 * NX + 2), SRC = [.008, .016, .05], NC = SRC.length, AMP = new Float32Array(NC * NBIN * 2 * NX), IMX = new Int16Array(NC * NBIN);
  { const KK = new Float64Array(2 * NX), W = new Float64Array(2 * NX);
    for(let b = 0; b < 2; b++) for(let i = 0; i < NX; i++){ const xi = XI0 + XR * (i / NX) * (i / NX); let lo = b ? K0 : .5, hi = b ? 2e4 : K0;
        for(let it = 0; it < 50; it++){ const m = (lo + hi) / 2; if((cgf(m) > xi) === (b === 1)) hi = m; else lo = m; }
        const k = (lo + hi) / 2, dk = k * .01, cg1 = Math.abs(cgf(k + dk) - cgf(k - dk)) / (2 * dk); KK[b * NX + i] = k; KT[b * NX + i] = k; DXI[i] = XR * (2 * i + 1) / (NX * NX); W[b * NX + i] = Math.pow(k, 1.5) / Math.sqrt(xi * Math.max(cg1, 2.5e-4)); }
    for(let c = 0; c < NC; c++){ const a = SRC[c]; let mx = 0; const o = c * NBIN * 2 * NX;
      for(let n = 0; n < NBIN; n++) for(let j = 0; j < 2 * NX; j++){ const k = KK[j], ka = k * a, v = W[j] * ka * Math.exp(-ka * ka / 2) * Math.exp(-(2e-6 * 2 + 1.2e-6) * k * k * (n + .5) * LIFE / NBIN); AMP[o + n * 2 * NX + j] = v; if(n === 2 && v > mx) mx = v; }
      for(let n = 0; n < NBIN; n++){ let im = 0; for(let j = 0; j < 2 * NX; j++){ const qo = o + n * 2 * NX + j; AMP[qo] /= mx; if(AMP[qo] > .03 && j % NX > im) im = j % NX; } IMX[c * NBIN + n] = Math.min(NX - 1, im + 1); } } }
  const SX = new Float32Array(N), SZ = new Float32Array(N), S2 = new Float32Array(N), WZr = new Float32Array(rows), XSr = new Float32Array(rows);
  for(let r = 0; r < rows; r++){ XSr[r] = ZR[r] / F; WZr[r] = ZR[r] * ZR[r] / FC; }
  const IDX = NX * NX / XR, PH00 = (K0 * XI0 - om(K0)) * TK;
  const OBS = new Float32Array(40), ring = (dx, dz, age, cls, amp, img) => { if(age < .06 || age >= LIFE) return;
    const bin = Math.min(NBIN - 1, (age / LIFE * NBIN) | 0), o = (cls * NBIN + bin) * 2 * NX, g = amp * Math.min(1 / age, 2.2) * sstep(.06, .3, age) * sstep(LIFE, LIFE * .55, age); let im = IMX[cls * NBIN + bin];
    while(im > 2 && AMP[o + im - 1] * g < .045 && AMP[o + NX + im - 1] * g < .045) im--;                 /* leave out the outer part of the train once it is too faint to see */
    const rin = XI0 * age, rout = (XI0 + XR * (im / NX) * (im / NX)) * age, rin2 = rin * rin, ro2 = rout * rout, ia = IDX / age;
    /* a wave shorter than 2.6 rows of water at the drop's distance is drawn at that length; the phase is the wavenumber summed outward from the still water */
    const km = TAU / (2.6 * dz * dz / FC), p00 = PH00 * Math.min(1, km / K0);
    for(let b = 0; b < 2; b++){ let acc = 0; for(let i = 0; i <= im; i++){ const j = b * NX + i, k = KT[j] < km ? KT[j] : km; PHL[j] = acc * TK + p00; LAL[j] = TAU / k; acc += k * DXI[i]; } }
    /* a floating pad stops the waves (calm water behind it) and sends part back from its edge, as if from a drop mirrored in the edge */
    let no = 0; if(!img && g > .2) for(let i = 0; i < NPD && no < 40; i++){ const P = PADS[i], px = P.x - dx, pz = P.z - dz, dp = Math.hypot(px, pz); if(dp < P.R * 1.05 || dp - P.R > rout) continue; OBS[no++] = px / dp; OBS[no++] = pz / dp; OBS[no++] = dp; OBS[no++] = Math.sqrt(1 - P.R * P.R / (dp * dp)); OBS[no++] = P.R; }
    const r0 = Math.max(WL, Math.ceil(HZ + FC / (dz + rout))), r1 = dz - rout > ZN ? Math.min(rows - 1, Math.floor(HZ + FC / (dz - rout))) : rows - 1;
    for(let r = r0; r <= r1; r++){ const z = ZR[r], zz = z - dz, h2 = ro2 - zz * zz; if(h2 <= 0) continue; const hf = Math.sqrt(h2), xs = XSr[r], wz = WZr[r], c0 = Math.max(0, Math.ceil(CX + (dx - hf) / xs)), c1 = Math.min(cols - 1, Math.floor(CX + (dx + hf) / xs)), kr = r * cols;
      for(let c = c0; c <= c1; c++){ const xx = (c - CX) * xs - dx, r2 = xx * xx + zz * zz; if(r2 <= rin2) continue;
        const rr = Math.sqrt(r2), fi = Math.sqrt((rr - rin) * ia), i = fi | 0; if(i >= im) continue; const f = fi - i, ux = xx / rr, uz = zz / rr, fx = (ux < 0 ? -ux : ux) * xs, fz = (uz < 0 ? -uz : uz) * wz, fp = fx > fz ? fx : fz;
        let s = 0, v = 0, sh = 1;
        for(let qo = 0; qo < no; qo += 5){ const dt = ux * OBS[qo] + uz * OBS[qo + 1], e = OBS[qo + 3] - dt; if(e < .05 && rr > OBS[qo + 2] * OBS[qo + 3]){ const w = (e < 0 ? 1 : 1 - e / .05) * clamp01(1.5 - (rr - OBS[qo + 2]) / (3 * OBS[qo + 4])); if(1 - w < sh) sh = 1 - w; } }
        if(img){ const al = xx * img[0] + zz * img[1], lt = Math.abs(xx * img[1] - zz * img[0]) / img[3]; if(al < img[2] || lt > 1) continue; sh = 1 - lt * lt; }
        if(sh < .02) continue;
        for(let b = 0; b < 2; b++){ const j = b * NX + i; let a = AMP[o + j]; if(a < .01) continue; a *= g * sh; let rs = LAL[j] / fp - 1.5; rs = rs < 0 ? 0 : rs > 1 ? 1 : rs;
          if(rs > 0){ const ph = age * (PHL[j] + f * (PHL[j + 1] - PHL[j])); s += a * rs * SIN[(ph | 0) & TM]; } v += a * a * (1 - rs * rs); }
        const k = kr + c; SX[k] += s * ux; SZ[k] += s * uz; S2[k] += v; } }
    for(let qo = no - 5; qo >= 0; qo -= 5){ const px = OBS[qo], pz = OBS[qo + 1], d = OBS[qo + 2] - OBS[qo + 4], R = OBS[qo + 4]; ring(dx + 2 * d * px, dz + 2 * d * pz, age, cls, amp * .45, [-px, -pz, d, R * 1.6]); } };
  /* ---- rain: one drop per slot of time, kept with the chance the shower gives it; mean RPM a minute ---- */
  const RPM = 40 + Math.round(.4 * Math.min(1500, D.nPart)), SWG = .45 + .4 * D.trendK, DT = 60 / RPM / (1 + SWG), VF = 7, WND = .35 + .65 * clamp01(D.jitter * .6);
  const shower = ts => 1 + SWG * (.65 * Math.sin(TAU * (ts - 3) / 17 + Math.PI / 2) + .35 * Math.sin(TAU * ts / 41 + 1.3));
  const fr = x => x - Math.floor(x), hw = z => CX * z / F;
  /* ---- things on and over the water: surface samples go into a scratch buffer (nearest wins) and are kept as lists of cells, stamped into the
     object buffer; a standing thing also leaves its image on the water under it. ---- */
  const TB = new Float32Array(N), TZ = new Float32Array(N), TC = new Uint8Array(N), TT = new Int32Array(N), OB = new Float32Array(N), OZ = new Float32Array(N), OC = new Uint8Array(N), OT = new Int32Array(N), MB = new Float32Array(N), MC = new Uint8Array(N), MT = new Int32Array(N), UB = new Float32Array(N), UC = new Uint8Array(N), UT = new Int32Array(N);
  let tn = 0, on = 0, mn = 0, un = 0, SK0 = '';
  const RMP = [[9, 10, 11, 12], [14, 15, 16], [22, 23, 24], [20, 19, 18]];                           /* colour ramps, dark to light: lotus leaf, lily pad, frog, petal (base to tip) */
  const spl = (c, r, z, b, col) => { c = Math.round(c); r = Math.round(r); if(c < 0 || c >= cols || r < 0 || r >= rows || (r < TOP && inCol(c))) return; const k = r * cols + c; if(TB[k] === 0) TT[tn++] = k; else if(z >= TZ[k]) return;
    const th = bay(c, r) - .5; if(col >= 100){ const qo = RMP[col - 100], i = Math.floor((b < 0 ? 0 : b > .99 ? .99 : b) * qo.length + th * .9); col = qo[i < 0 ? 0 : i >= qo.length ? qo.length - 1 : i]; } b += th / LVN; TB[k] = b < .07 ? .07 : b > 1 ? 1 : b; TZ[k] = z; TC[k] = col; };
  const harvest = rb => { const L = {k: new Int32Array(tn), b: new Float32Array(tn), z: new Float32Array(tn), c: new Uint8Array(tn), rb: rb || 0}; for(let i = 0; i < tn; i++){ const k = TT[i]; L.k[i] = k; L.b[i] = TB[k]; L.z[i] = TZ[k]; L.c[i] = TC[k]; TB[k] = 0; } tn = 0; return L; };
  const stamp = (L, dk) => { const rb = L.rb; for(let i = 0; i < L.k.length; i++){ const k = L.k[i] + dk; if(k < 0 || k >= N) continue; const z = L.z[i]; if(OB[k] === 0) OT[on++] = k; else if(z >= OZ[k]) continue; OB[k] = L.b[i]; OZ[k] = z; OC[k] = L.c[i];
      if(rb){ const r = (k / cols) | 0, m = (2 * rb - r) * cols + k % cols; if(m >= WL * cols && m < N && r < rb){ if(MB[m] === 0) MT[mn++] = m; MB[m] = L.b[i] * .42 + .03; MC[m] = L.c[i]; } } } };
  /* lily pads: flat discs with a notch, radial veins, a wet sheen and puddles of rain */
  const PADS = (phone ? [[.3, .62, .1, 2.4], [-.6, .68, .085, .6], [.78, .82, .075, 4], [-.2, 1.02, .09, 1.2], [.5, 1.25, .085, 5.2]]
    : [[.5, .57, .115, 2.5], [.82, .5, .075, .8], [.88, .78, .085, 4.1], [.64, .98, .07, 5.5], [-.82, .52, .085, 1.1], [-.6, .72, .07, 3.3], [.2, 1.12, .085, 2], [.42, 1.38, .08, .3], [-.12, 1.55, .09, 4.6]]).map(([u, z, R, a]) => ({x: FLP * u * hw(z), z, R, a: FLP > 0 ? a : Math.PI - a}));
  const NPD = PADS.length; for(let i = 0; i < (phone ? 7 : 16); i++){ const z = 1.6 + S() * .85; PADS.push({x: (S() * 2 - 1) * hw(z), z, R: .06 + .05 * S(), a: S() * TAU}); }
  const padL = PADS.map((P, pi) => { const r0 = Math.max(WL, Math.floor(HZ + FC / (P.z + P.R * 1.1))), r1 = Math.min(rows - 1, Math.ceil(HZ + FC / Math.max(ZN * .5, P.z - P.R * 1.1))), bz = pi % 4 === 3, nv = 14;
    for(let r = r0; r <= r1; r++){ const z = ZR[r], dz = z - P.z, xs = XSr[r]; for(let c = Math.max(0, Math.floor(colOf(P.x - P.R * 1.1, z))); c <= Math.min(cols - 1, Math.ceil(colOf(P.x + P.R * 1.1, z))); c++){ const dx = (c - CX) * xs - P.x, th = Math.atan2(dz, dx), ro = Math.hypot(dx, dz) / (P.R * (1 + .05 * Math.sin(3 * th + pi) + .03 * Math.sin(7 * th)));
        if(ro > 1) continue; let da = Math.abs(fr((th - P.a) / TAU + .5) - .5) * TAU; if(da < .17 && ro > .1) continue;
        const vn = Math.abs(fr(th * nv / TAU + .5) - .5) * TAU / nv * ro * P.R / xs < .5 && ro > .15, pud = noise(dx * 30 + pi * 9, dz * 30) > .78 && ro < .8;
        let b = .56 + .2 * (dz / P.R) + (vn ? .08 : 0) + .05 * (noise(dx * 50 + pi, dz * 50) - .5) + (ro > .9 ? (dz > 0 ? .12 : -.16) : 0), col = bz ? 17 : 101;
        if(pud && pi){ b = .6 + .2 * noise(dx * 90, dz * 90 + pi); col = W0 + 4; }
        spl(c, r, z, b, col); } }
    return harvest(0); });
  /* ---- lotus leaves: a cupped round blade with a wavy rim on a stalk. Rain runs to the centre as beads and gathers into a pool; when it is heavy
     the leaf tips, pours it over the rim and springs back. Each leaf also dips under single drops. ---- */
  const LV_ = (phone ? [[-.5, .95, .13, .14, -.45, -4.2, 13], [.62, 1.1, .12, .15, 2.6, 4.2, 15], [.6, 1.7, .11, .13, .4, 9, 12]]
    : [[-.5, .98, .13, .12, -.5, -4.2, 13], [-.9, .8, .15, .12, -.3, 7.5, 17], [-.24, 1.36, .12, .1, 2.7, 1, 14.5], [.84, 1.1, .14, .12, 3.5, 4.2, 15], [.56, 1.55, .12, .1, .3, 10, 12], [-.985, 1.25, .16, .34, -.2, 12, 19], [.99, 1.6, .15, .36, 3.3, 15, 21]])
    .map(([u, z, R, h, ps, t0, per], id) => ({x: FLP * u * hw(z), z, R, h: id < 5 ? Math.max(.045, Math.min(h, CH - (TOP + 3 - HZ) * (z + R) / F - .36 * R - .26 * R)) : h, ps: FLP > 0 ? ps : Math.PI - ps, t0, per, id, cup: .36 * R, wr: .12 * R, nw: 3 + id % 3, ph: id * 2.1, nv: 20, rt: .2 + .04 * (id % 3), rd: -Math.PI / 2 + FLP * .35 * (id % 2 ? 1 : -1), key: '', list: null, rb: Math.round(rowOf(0, z))}));
  const leafR = (L, tau, psi, pf) => { const m = F / L.z, n1 = Math.ceil(L.R * m / .55), st = Math.sin(tau), ct = Math.cos(tau), cp = Math.cos(psi), sq = Math.sin(psi), rp = .1 + .2 * pf, edge = 1 - 1 / (L.R * m);
    for(let y = 0; y < L.h; y += .6 / m) spl(colOf(L.x, L.z), rowOf(y, L.z), L.z + .004, .26 + .1 * y / L.h, 9);
    for(let i = 0; i < n1; i++){ const ro = (i + .5) / n1, n2 = Math.ceil(TAU * ro * L.R * m / .6) + 6, cup = L.cup * Math.pow(ro, 1.7), dcup = 1.7 * L.cup * Math.pow(ro, .7) / L.R;
      for(let j = 0; j < n2; j++){ const th = (j + .5 * (i & 1)) / n2 * TAU, c_ = Math.cos(th), s_ = Math.sin(th), wv = Math.sin(L.nw * th + L.ph), ly = cup + L.wr * ro * ro * ro * wv, gr = dcup + 3 * L.wr * ro * ro * wv / L.R, gt = L.wr * ro * ro * L.nw * Math.cos(L.nw * th + L.ph) / L.R;
        let lx = L.R * ro * c_, lz = L.R * ro * s_; const s0 = lx * cp + lz * sq, s1 = s0 * ct + ly * st, y1 = ly * ct - s0 * st; lx += (s1 - s0) * cp; lz += (s1 - s0) * sq;
        let nx = -gr * c_ + gt * s_ + st * cp, nz = -gr * s_ - gt * c_ + st * sq, ny = 1; const il = 1 / Math.hypot(nx, ny, nz); nx *= il; ny *= il; nz *= il;
        const wx = L.x + lx, wy = L.h + y1, wz = L.z + lz, vx = -wx, vy = CH - wy, vz = -wz, fc = (nx * vx + ny * vy + nz * vz) / Math.hypot(vx, vy, vz); let b, col;
        if(fc < 0){ b = .44 + .22 * ny + .12 * ro; col = 13; }                                                                           /* the underside, lit through the blade */
        else if(ro < rp){ b = ro > rp - .6 / (L.R * m) ? .2 : .66 + .34 * (s_ > .1 ? 1 : .3); col = b < .5 ? 9 : b > .9 ? WHT : W0 + 5; }     /* the pool: a mirror of the sky with a dark edge */
        else { const vn = Math.abs(fr(th * L.nv / TAU + .5) - .5) * TAU / L.nv * ro * L.R * m < .45 && ro > .12;
          b = .1 + .7 * Math.max(0, -.38 * nx + .8 * ny - .46 * nz) * (.55 + .45 * ro) + .2 * Math.pow(1 - fc, 3) + (vn ? .16 : 0) + (ro > edge ? .16 : 0) + .05 - .12 * Math.exp(-ro * ro * 30); col = 100; }
        spl(colOf(wx, wz), rowOf(wy, wz), wz, b, col); } }
    return harvest(L.rb); };
  /* a point (ro, th) of the tilted blade in the world */
  const leafP = (L, tau, psi, ro, th, o) => { const ly = L.cup * Math.pow(ro, 1.7), lx = L.R * ro * Math.cos(th), lz = L.R * ro * Math.sin(th), cp = Math.cos(psi), sq = Math.sin(psi), s0 = lx * cp + lz * sq, s1 = s0 * Math.cos(tau) + ly * Math.sin(tau);
    o[0] = L.x + lx + (s1 - s0) * cp; o[1] = L.h + ly * Math.cos(tau) - s0 * Math.sin(tau); o[2] = L.z + lz + (s1 - s0) * sq; return o; };
  const TIP = .55, HS = 2.2, PV = [0, 0, 0], LB = [];                                              /* LB: this frame's beads */
  for(const L of LV_){ leafP(L, TIP, L.ps, 1, L.ps, PV); L.tf = Math.sqrt(2 * Math.max(.01, PV[1]) / G); L.fx = PV[0] + .22 * L.tf * Math.cos(L.ps); L.fz = PV[2] + .22 * L.tf * Math.sin(L.ps); }
  const leafS = (L, ts) => { const cy = (ts - L.t0) / L.per, u = (cy - Math.floor(cy)) * L.per; L.u = u;
    const tip = TIP * (sstep(0, .45, u) - sstep(.9, 1.5, u)) - (u > 1.5 && u < 4.5 ? .14 * Math.exp(-(u - 1.5) / .6) * Math.sin(TAU * 1.7 * (u - 1.5)) : 0);
    let tx = tip * Math.cos(L.ps) + L.rt * Math.cos(L.rd), tz = tip * Math.sin(L.ps) + L.rt * Math.sin(L.rd), dip = 0;   /* a drop dips the leaf a cell */ L.pf = u < .5 ? 1 - u * 2 : u < 1.6 ? 0 : (u - 1.6) / (L.per - 1.6);
    for(let i = Math.floor((ts - 1.1) / HS); i <= Math.floor(ts / HS); i++){ const th0 = (i + .8 * hash2(i, L.id * 7 + 3)) * HS, v = ts - th0; if(v < 0 || v > 1.1 || hash2(i, L.id * 7 + 4) * 1.5 > shower(th0)) continue;
      const an = TAU * hash2(i, L.id * 7 + 5); dip += 1.7 * Math.exp(-v / .25) * Math.sin(TAU * 2.5 * v); LB.push(L, .92 - Math.min(1, v / .7) * .8, an, v); }
    L.dip = Math.round(dip); const tq = Math.round(Math.hypot(tx, tz) / .015), pq = tq ? Math.round(Math.atan2(tz, tx) / TAU * 16) : 0, fq = Math.round(L.pf * 6), key = tq + ',' + pq + ',' + fq; L.tau = tq * .015; L.psi = pq / 16 * TAU;
    if(key !== L.key){ L.key = key; L.list = (L.cache || (L.cache = new Map())).get(key); if(!L.list){ L.list = leafR(L, L.tau, L.psi, fq / 6); if(L.cache.size < 20) L.cache.set(key, L.list); } } };
  /* ---- the flower, a bud and a seed pod (they do not move) ---- */
  const FLW = phone ? [.05, .9, .07] : [-.16, .98, .07], FL = (() => { const [u, z, h] = FLW, x = FLP * u * hw(z), m = F / z;
    for(let y = 0; y < h; y += .6 / m) spl(colOf(x + .012 * Math.sin(y * 20), z), rowOf(y, z), z + .003, .3, 10);
    for(let w = 0; w < 3; w++){ const np = w === 2 ? 6 : 7, e0 = [.3, .85, 1.25][w], Lp = [.088, .08, .066][w], Wp = [.03, .028, .024][w];
      for(let qo = 0; qo < np; qo++){ const a = (qo + w * .5) / np * TAU + .3, ca = Math.cos(a), sa = Math.sin(a), ns = Math.ceil(Lp * m / .5); let ro = .012, y = 0;
        for(let i = 0; i <= ns; i++){ const s = i / ns, e = e0 + (.55 - .25 * w) * s, wd = Wp * Math.pow(Math.sin(Math.PI * Math.pow(s, .75)), .7), nw = Math.ceil(wd * m / .5); ro += Lp / ns * Math.cos(e); y += Lp / ns * Math.sin(e);
          for(let j = -nw; j <= nw; j++){ const v = nw ? j / nw : 0, px = x + ro * ca - v * wd * sa, pz = z + ro * sa + v * wd * ca, py = h + y + .012 * v * v * (1 + s), fc = -(Math.sin(e) * sa) * .6 + Math.cos(e) * .5, b = .78 + .12 * s + .16 * fc - .3 * v * v * v * v + (w === 0 ? -.06 : 0) + (qo & 1 ? .05 : -.05);
            spl(colOf(px, pz), rowOf(py, pz), pz, b, s > .9 || (v * v > .8 && s > .5) ? 18 : s > .62 ? 19 : 20); } } } }
    for(let i = 0; i < 40; i++){ const a = i / 40 * TAU, r = .014 * (i % 2 ? 1 : .55); spl(colOf(x + r * Math.cos(a), z), rowOf(h + .03 + .5 * r * Math.sin(a), z), z - .02, .8, 21); }
    const bx = x + FLP * .13, bz = z + .1, bh = h - .02; for(let y = 0; y < bh; y += .6 / m) spl(colOf(bx, bz), rowOf(y, bz), bz + .003, .28, 10);
    for(let i = 0; i < 300; i++){ const s = S(), a = S() * TAU, r = .02 * Math.sin(Math.PI * Math.pow(s, .8)); spl(colOf(bx + r * Math.cos(a), bz), rowOf(bh + s * .07, bz), bz - r * Math.sin(a), .4 + .3 * Math.cos(a - 2.2) + .2 * s, s > .55 ? 19 : 11); }   /* the bud */
    const qox = FLP * (phone ? .66 : .7) * hw(1.32), qz = 1.32, qh = .06; for(let y = 0; y < qh; y += .6 / m) spl(colOf(qox - .01 * Math.sin(y * 15), qz), rowOf(y, qz), qz + .003, .27, 30);
    for(let i = 0; i < 700; i++){ const s = S(), a = S() * TAU, top = S() < .45, r = top ? .042 * Math.sqrt(S()) : .01 + .032 * s, y = top ? qh + .05 + .35 * r * Math.sin(a) : qh + s * .05, hole = top && noise(r * Math.cos(a) * 110 + 3, r * Math.sin(a) * 110) > .62;
      spl(colOf(qox + r * Math.cos(a), qz), rowOf(y, qz), qz - (top ? .05 : r * Math.sin(a)), hole ? .12 : top ? .5 : .28 + .22 * Math.cos(a - 2.2), hole ? 26 : top ? 15 : 30); }   /* the seed pod: a cone with a flat top and its seeds in pits */
    return harvest(Math.round(rowOf(0, z))); })();
  /* ---- the frog: ellipsoids for trunk, head and eyes, chains of spheres for the limbs, in (forward, up, side) body lengths ---- */
  const FLEN = .13, FP = PADS[0], FHX = -.995 * FLP, FHZ = -.1, FPER = 44, FJT = 2, FFLY = .42, FDIST = .36;
  const frogR = (px, py, pz, pit, e, thr, blk, headOnly) => { const m = F / pz, cp = Math.cos(pit), sp_ = Math.sin(pit), L = FLEN;
    const pt = (a, b, c, na, nb, nc, kind, t) => { const a1 = a * cp - b * sp_, b1 = a * sp_ + b * cp, n1 = na * cp - nb * sp_, n2 = na * sp_ + nb * cp, wx = px + (a1 * FHX - c * FHZ) * L, wy = py + b1 * L, wz = pz + (a1 * FHZ + c * FHX) * L, nx = n1 * FHX - nc * FHZ, nz = n1 * FHZ + nc * FHX;
      const vx = -wx, vy = CH - wy, vz = -wz, vl = Math.hypot(vx, vy, vz), fc = (nx * vx + n2 * vy + nz * vz) / vl; if(fc < -.05 || wy < 0) return;
      const d = .5 + .5 * n2, hx = vx / vl, hy = vy / vl + 1, hz = vz / vl, sp2 = Math.pow(Math.max(0, (nx * hx + n2 * hy + nz * hz) / Math.hypot(hx, hy, hz)), 40); let bb = .3 + .45 * d + .5 * sp2, col;
      if(kind === 3){ col = nb > .55 ? 21 : 26; bb = col === 26 ? .12 : .75; if(blk){ col = 23; bb = .3 + .3 * d; } else if(sp2 > .3){ col = WHT; bb = .9; } }
      else if(kind === 1 && nb < -.3){ col = 25; bb = .4 + .5 * d + (thr ? .08 : 0); }
      else { const blot = hash2(Math.floor(a * 7 + 40), Math.floor(c * 7 + 40 + kind * 7)) < .2 || (kind === 2 && Math.sin(t * 5) > .45); if(blot) bb *= .55; if(kind < 2 && nc < .22 && nc > -.22 && nb > .6){ bb += .12; }
        col = sp2 > .45 ? 25 : 102; if(kind === 2){ bb += .1; if(fc < .42) bb = .1; } }   /* limbs: paler, dark where they turn away */
      spl(colOf(wx, wz), rowOf(wy, wz), wz, bb, col); };
    const ell = (a, b, c, ra, rb, rc, kind) => { const n = Math.ceil(Math.PI * Math.max(ra, rb, rc) * L * m / .62) + 2; for(let i = 0; i < n; i++){ const la = (i + .5) / n * Math.PI, sl = Math.sin(la), ub = Math.cos(la), n2 = Math.ceil(2 * n * sl) + 1;
        for(let j = 0; j < n2; j++){ const lo = j / n2 * TAU, ua = sl * Math.cos(lo), uc = sl * Math.sin(lo), tp = kind === 1 && ua > 0 ? 1 - .45 * ua : 1, na = ua / ra, nb = ub / rb, nc = uc / (rc * tp), il = 1 / Math.hypot(na, nb, nc); pt(a + ra * ua, b + rb * ub, c + rc * tp * uc, na * il, nb * il, nc * il, kind, 0); } } };
    const cap = (p, qo, r, kind) => { const n = Math.ceil(Math.hypot(qo[0] - p[0], qo[1] - p[1], qo[2] - p[2]) / (r * .7)) + 1; for(let i = 0; i <= n; i++){ const t = i / n, ns = Math.ceil(Math.PI * r * L * m / .7) + 2, a = p[0] + (qo[0] - p[0]) * t, b = p[1] + (qo[1] - p[1]) * t, c = p[2] + (qo[2] - p[2]) * t, rr = r * (1 - .25 * t);
        for(let u = 0; u < ns; u++){ const la = (u + .5) / ns * Math.PI, sl = Math.sin(la), n2 = Math.ceil(2 * ns * sl) + 1; for(let j = 0; j < n2; j++){ const lo = j / n2 * TAU, ua = sl * Math.cos(lo), ub = Math.cos(la), uc = sl * Math.sin(lo); pt(a + rr * ua, b + rr * ub, c + rr * uc, ua, ub, uc, kind, t + i); } } } };
    const mx = (s, j) => s + (j - s) * e;
    ell(.36, .31 + (thr ? .012 : 0), 0, .21, .125, .19, 1); for(const sd of [-1, 1]) ell(.4, .41, sd * .12, .055, .055, .05, 3);
    if(headOnly) return harvest(0);
    ell(0, .2, 0, .37, .175, .23, 0);
    for(const sd of [-1, 1]){ const hip = [-.28, .13, sd * .16], kn = [mx(.1, -.66), mx(.3, .12), sd * mx(.3, .15)], an = [mx(-.36, -1.05), mx(.06, .1), sd * mx(.28, .12)], toe = [mx(-.02, -1.42), mx(.025, .08), sd * mx(.36, .12)];   /* sitting: knee up beside the back, shin down and back, foot forward */
      cap(hip, kn, .095, 2); cap(kn, an, .07, 2); cap(an, toe, .04, 2);
      const sh = [.24, .16, sd * .17], el = [mx(.2, .02), mx(.07, .08), sd * mx(.25, .2)], hd = [mx(.37, -.14), mx(.012, .06), sd * mx(.23, .19)]; cap(sh, el, .045, 2); cap(el, hd, .034, 2); }
    return harvest(Math.round(rowOf(0, pz))); };
  const FRC = new Map(), frogSeat = (thr, blk) => { const key = thr * 2 + blk; let L = FRC.get(key); if(!L){ L = frogR(FP.x + .012, .006, FP.z - .01, .5, 0, thr, blk, 0); L.rb = 0; FRC.set(key, L); } return L; };
  let FHL = null;
  /* ---- koi: a body that bends in a travelling wave, drawn under the surface where the water lets the eye in ---- */
  const KOI = (phone ? [[0, .78, .3, .05, .2, 0]] : [[-.08, .72, .42, .05, .26, 0], [-.3, 1.05, .4, .1, .22, 1.9]]).map(([u, z, ax, az, L, ph], id) => ({cx: FLP * u * hw(z), cz: z, ax: FLP * ax, az, L, ph, id, w: .26 - .05 * id}));
  const koiAt = (K, ts, o) => { const f = -Math.PI / 2 + K.ph + K.w * ts + .3 * Math.sin(K.w * ts * 2 + K.id), sf = Math.sin(f), cf = Math.cos(f), hl = Math.hypot(K.ax * sf, K.az * cf); o.x = K.cx + K.ax * cf; o.z = K.cz + K.az * sf; o.hx = -K.ax * sf / hl; o.hz = K.az * cf / hl; o.d = .09 + .08 * (.5 + .5 * Math.sin(f * 1.3 + K.id * 2)); o.v = K.w * (1 + .6 * Math.cos(K.w * ts * 2 + K.id)) * hl; return o; };
  const KO = {}, koiR = (K, ts) => { koiAt(K, ts, KO); const {x, z, hx, hz, d} = KO, m = F / z, ns = Math.ceil(K.L * 1.16 * m / .7), bt = ts * TAU * (.9 + 2.2 * KO.v);
    for(let i = 0; i <= ns; i++){ const s = i / ns * 1.16, off = (.012 + .11 * s * s) * K.L * Math.sin(bt - 6.5 * s), tail = s > .9, pec = s > .2 && s < .44 ? .13 * Math.sin(Math.PI * (s - .2) / .24) : 0;
      /* half width: round head, long taper to the tail stalk, forked fan; pectoral fins swept back */
      const wb = tail ? .03 + .1 * (s - .9) / .26 : s < .22 ? .12 * Math.sqrt(s / .22) : .12 - .09 * (s - .22) / .68, wd = (wb + pec) * K.L, nw = Math.ceil(wd * m / .7), ax_ = x - hx * (s - .4) * K.L - hz * off, az_ = z - hz * (s - .4) * K.L + hx * off;
      for(let j = -nw; j <= nw; j++){ const v = nw ? j / nw : 0, av = v < 0 ? -v : v, onfin = av * (wb + pec) > wb; if(tail && s > 1 && av < (s - 1) * 2.2) continue;
        const wx = ax_ - hz * v * wd, wz = az_ + hx * v * wd, c = Math.round(colOf(wx, wz)), r = Math.round(rowOf(-.7 * d, wz)); if(c < 0 || c >= cols || r < WL || r >= rows) continue;
        const k = r * cols + c, b = (.54 - 1.5 * d) * (onfin || tail ? .5 : 1 - .45 * av * av), sr = s + .05 * Math.sin(v * 3 + K.id), red = sr < .17 || (sr > .36 && sr < .58) || (sr > .74 && sr < .86) || (K.id && sr > .5);   /* red in a few large patches: head, saddle, tail stalk */ if(UB[k] === 0) UT[un++] = k; if(b > UB[k]){ UB[k] = b; UC[k] = onfin || tail ? 28 : red ? 29 : 28; } } } };
  /* the surface pass and the picture */
  const FRT = new Float32Array(257); for(let i = 0; i <= 256; i++){ const c = i / 256; FRT[i] = .62 + .38 * Math.pow(1 - c, 3); }
  const AW = [[.42, .35, .01], [.27, -.5, .011], [.17, .15, .01], [.1, -.2, .008]].map(([lam, dir, a]) => { const k = TAU / lam; return {kx: k * Math.sin(dir), kz: k * Math.cos(dir), om: om(k), a, lam}; });
  const AWW = new Float32Array(rows * 4); for(let r = WL; r < rows; r++) for(let j = 0; j < 4; j++) AWW[r * 4 + j] = AW[j].a * clamp01((AW[j].lam / WZr[r] - 2) * .5);
  const F2 = 2 * F, MURK = .11, DR = [], HERO = phone ? [-.1, .66] : [-.12, .7];
  const put = (cc, rr, z, b, col) => { cc = Math.round(cc); rr = Math.round(rr); if(cc < 0 || cc >= cols || rr < 0 || rr >= rows || (rr < TOP && inCol(cc))) return; const k = rr * cols + cc; if(OB[k] > 0 && OZ[k] < z) return; if(b > FB[k] || col !== WHT){ FB[k] = b; FK[k] = col; } };
  const onLeaf = (x, z) => { for(let i = 0; i < PADS.length; i++){ const P = PADS[i], dx = x - P.x, dz = z - P.z; if(dx * dx + dz * dz < P.R * P.R * 1.1) return 1; } for(const L of LV_){ const dx = x - L.x, dz = z - L.z; if(dx * dx + dz * dz < L.R * L.R) return 1; } return 0; };
  return tm => {
    const ts = (tm - 14) * sp, t = ts + 600;
    FB.set(BGB); FK.set(BGK); SX.fill(0, WL * cols); SZ.fill(0, WL * cols); S2.fill(0, WL * cols);
    for(let i = 0; i < un; i++) UB[UT[i]] = 0; un = 0; DR.length = 0; LB.length = 0;
    /* this frame's disturbances: x, z, age, source class, strength, kind */
    for(let i = Math.floor((t - LIFE) / DT) - 1; i <= Math.floor(t / DT) + Math.ceil(.5 / DT); i++){ const t0 = (i + hash2(i, SD)) * DT, age = t - t0; if(age < -.45 || age >= LIFE) continue; if(hash2(i, SD + 1) * (1 + SWG) > shower(t0 - 600)) continue;
      const z = Math.sqrt(ZN * ZN * .8 + hash2(i, SD + 2) * (ZB * ZB - ZN * ZN * .8)), x = (hash2(i, SD + 3) - .5) * 2.1 * hw(z), big = hash2(i, SD + 4) < .22 ? 1 : 0;
      DR.push(x, z, age, big, (big ? .6 : .42) * (.75 + .5 * hash2(i, SD + 5)), onLeaf(x, z) ? 2 : 0); }
    { const a = ts + 1.25, hz = HERO[1], hx = FLP * HERO[0] * hw(hz); if(a > -.45 && a < LIFE) DR.push(hx, hz, a, 1, .7, 0); }                              /* the drop the still frame is built round */
    for(const L of LV_){ leafS(L, ts); const a = L.u - .4 - L.tf; if(a > 0 && a < LIFE + .8){ DR.push(L.fx, L.fz, a, 2, .62, 1, L.fx + .02, L.fz, a - .3, 1, .5, 1, L.fx - .02, L.fz + .02, a - .62, 1, .4, 1); } }
    const fu = ((ts - FJT) % FPER + FPER) % FPER, fx1 = FP.x + FHX * FDIST, fz1 = FP.z + FHZ * FDIST, fsx = FP.x + FHX * .19, fsz = FP.z + FHZ * .19 - .02;
    if(PART & 8){ if(fu < LIFE) DR.push(FP.x, FP.z, fu, 2, .35, 1); const a = fu - FFLY; if(a > 0 && a < LIFE + .5) DR.push(fx1, fz1, a, 2, .95, 1, fx1, fz1, a - .28, 2, .6, 1);
      if(fu > 13 && fu < 13 + LIFE) DR.push(fsx, fsz, fu - 13, 1, .4, 1); if(fu > 25 && fu < 25 + LIFE) DR.push(fsx, fsz, fu - 25, 2, .5, 1); }
    if(PART & 16) for(const K of KOI){ const qo = Math.floor((ts + K.id * 3) / 9), tq = qo * 9 + 2 + 5 * hash2(qo, K.id + 90) - K.id * 3, a = ts - tq; if(a > 0 && a < LIFE){ koiAt(K, tq, KO); DR.push(KO.x, KO.z, a, 1, .32, 1); } }
    if(PART & 1) for(let qo = 0; qo < DR.length; qo += 6) if(DR[qo + 2] > 0 && DR[qo + 5] !== 2) ring(DR[qo], DR[qo + 1], DR[qo + 2], DR[qo + 3], DR[qo + 4]);
    /* objects */
    const bob = fu < 2.5 ? Math.round(1.7 * Math.exp(-fu / .6) * Math.cos(TAU * 1.5 * fu + .5)) : fu > 25 && fu < 27 ? Math.round(1.3 * Math.exp(-(fu - 25) / .5) * Math.cos(TAU * 1.5 * (fu - 25))) : 0;
    /* stamped again only when a pose has changed */
    const q4 = Math.floor(ts / 4.3), v4 = ts - (q4 + .7 * hash2(q4, 55)) * 4.3, thr = Math.sin(ts * TAU * 1.5) > .35 ? 1 : 0, blk = v4 > 0 && v4 < .2 ? 1 : 0, wh = fu > FPER - .25 ? (fu - FPER + .25) / .25 : 0;
    let sk = PART + ',' + bob + ',' + (fu < FFLY || (fu >= 25 && fu < 25.4) || wh ? fu : fu <= 13 ? 'u' : fu < 25 ? 'h' : thr * 2 + blk); for(const L of LV_) sk += L.key + L.dip;
    if(sk !== SK0){ SK0 = sk; for(let i = 0; i < on; i++) OB[OT[i]] = 0; for(let i = 0; i < mn; i++) MB[MT[i]] = 0; on = mn = 0;
      if(PART & 4){ for(let i = 0; i < padL.length; i++) stamp(padL[i], i === 0 ? bob * cols : 0); stamp(FL, 0); for(const L of LV_) stamp(L.list, L.dip * cols); }
      if(PART & 8){
        if(fu < FFLY){ const u = fu / FFLY; stamp(frogR(FP.x + FHX * FDIST * u, .02 + .4 * u * (1 - u), FP.z + FHZ * FDIST * u, .75 - 1.5 * u, Math.min(1, fu / .1), 0, 0, 0), 0); }
        else if(fu > 13 && fu < 25){ if(!FHL) FHL = frogR(fsx, -.036, fsz, .1, 0, 0, 0, 1); stamp(FHL, 0); }
        else if(fu >= 25 && fu < 25.4){ const u = (fu - 25) / .4; stamp(frogR(fsx + (FP.x - fsx) * u, .01 + .2 * u * (1 - u), fsz + (FP.z - fsz) * u, .5 - .2 * u, 1 - u, 0, 0, 0), 0); }
        else if(fu >= 25.4){ if(wh) stamp(frogR(FP.x + .012, .006 - .004 * wh, FP.z - .01, .36 - .2 * wh, 0, 0, 0, 0), 0); else stamp(frogSeat(thr, blk), bob * cols); } } }
    if(PART & 16) for(const K of KOI){ koiR(K, ts); if(KO.d < .1){ const m = F / KO.z, c0 = Math.round(colOf(KO.x, KO.z)), r0 = Math.round(rowOf(0, KO.z)), w = Math.ceil(.09 * m), a = (.1 - KO.d) * 9;   /* a back near the surface lifts it a little */
        for(let r = r0 - 3; r <= r0 + 3; r++) for(let c = c0 - w; c <= c0 + w; c++){ if(c < 0 || c >= cols || r < WL || r >= rows) continue; const u = (c - c0) / w, v = (r - r0) / 3, g = Math.exp(-2.5 * (u * u + v * v)); SZ[r * cols + c] += a * v * g; SX[r * cols + c] += .5 * a * u * g; } } }
    /* water */
    for(let r = WL; r < rows; r++){ const z = ZR[r], xs = XSr[r], sa = SAr[r], ca = CAr[r], mk = .72 + .28 * MK[r], hb = r - WL + .5, kr = r * cols, ob = phone ? Math.min(1.6, mk) : 1, r4 = (r & 3) << 2;
      const w0 = AWW[r * 4] * WND, w1 = AWW[r * 4 + 1] * WND, w2 = AWW[r * 4 + 2] * WND, w3 = AWW[r * 4 + 3] * WND;
      let p0 = (AW[0].kz * z - AW[0].om * t - AW[0].kx * CX * xs) * TK, p1 = (AW[1].kz * z - AW[1].om * t - AW[1].kx * CX * xs) * TK, p2 = (AW[2].kz * z - AW[2].om * t - AW[2].kx * CX * xs) * TK, p3 = (AW[3].kz * z - AW[3].om * t - AW[3].kx * CX * xs) * TK;
      const d0 = AW[0].kx * xs * TK, d1 = AW[1].kx * xs * TK, d2 = AW[2].kx * xs * TK, d3 = AW[3].kx * xs * TK, rb = .0006 + .5 * (AW[3].a * WND) ** 2 * (1 - (w3 / (AW[3].a * WND + 1e-9)) ** 2), mb = Math.min(1, rb * 260);
      let pg = (.9 * z - .25 * t - 1.3 * CX * xs) * TK; const dg = 1.3 * xs * TK;
      for(let c = 0, a = 0; c < cols; c++){ const k = kr + c;
        if(!(c & 1)){ let gu = SIN[(pg | 0) & TM] - .2; gu = gu < 0 ? 0 : gu * gu; a = gu ? gu * (w0 * SIN[(p0 | 0) & TM] + w1 * SIN[(p1 | 0) & TM] + w2 * SIN[(p2 | 0) & TM] + w3 * SIN[(p3 | 0) & TM]) : 0; }   /* wind in patches, calm between; one sample for two cells */
        pg += dg; p0 += d0; p1 += d1; p2 += d2; p3 += d3;
        if(OB[k] > 0){ FB[k] = OB[k] * ob; FK[k] = OC[k]; continue; }
        const th = BT[(c & 3) + r4];
        const sz = SZ[k] + a, sx = SX[k] + .3 * a, s2 = S2[k], dc = (F2 * sa * sx) | 0;
        let h = (hb + F2 * sz) | 0, cc = c + dc; if(cc < 0) cc = 0; else if(cc >= cols) cc = cols - 1;
        let e, ci = sa + sz * ca, col = 0; ci = ci < 0 ? 0 : ci > 1 ? 1 : ci; let R = FRT[(ci * 256) | 0];
        if(h < 0) e = .1; else { if(h >= EH) h = EH - 1; const qo = h * cols + cc; e = ENB[qo]; if(mb > .02) e += (ENM[qo] - e) * mb; if(ENK[qo] !== 255) col = ENK[qo]; }
        let km = k + 2 * dc + ((F2 * sz * .5) | 0) * cols; if(km >= 0 && km < N && MB[km] > 0 && noise(c * .06, r * .8) < .6){ e += (MB[km] - e) * .55; if(th < .55) col = MC[km]; }   /* an image on the water: paler, in strips */
        let b = R * e + (1 - R) * MURK;
        if(s2 > 2e-4){ const A = Math.sqrt(s2) * .85; let bs = 0;                                  /* waves finer than this cell: the mean of the two extremes of their slope */
          for(let w = -1; w <= 1; w += 2){ const s1 = sz + w * A; ci = sa + s1 * ca; ci = ci < 0 ? 0 : ci > 1 ? 1 : ci; R = FRT[(ci * 256) | 0]; h = (hb + F2 * s1) | 0; bs += R * (h < 0 ? .1 : ENB[(h >= EH ? EH - 1 : h) * cols + cc]) + (1 - R) * MURK; }
          b = bs * .5; col = 0; }
        if(un){ const ku = k + ((sx * 14) | 0) + ((sz * 9) | 0) * cols; if(ku >= 0 && ku < N && UB[ku] > 0){ const tb = UB[ku] * (.3 + .5 * ci); if(th * (tb + .5 * b) < tb) col = UC[ku]; b = b * (1 - .5 * tb) + tb * .55; }   /* the fish is mixed into the mirror cell by cell: pale under sky, clear under trees */ }
        b *= mk * 1.45;
        FB[k] = (b > 1 ? 1 : b) + (th - .5) / LVN; FK[k] = col || W0 + (b > .82 ? 5 : (b * 6.2 + th) | 0); } }
    if(PART & 4){ /* beads running to the pool; the pour and the white water where it lands */
      for(let qo = 0; qo < LB.length; qo += 4){ const L = LB[qo]; leafP(L, L.tau, L.psi, LB[qo + 1], LB[qo + 2], PV); put(colOf(PV[0], PV[2]), rowOf(PV[1], PV[2]), PV[2] - .01, LB[qo + 3] < .12 ? 1 : .8, WHT); }
      for(const L of LV_){ const u = L.u; if(u < .4 || u > 1.3) continue; leafP(L, L.tau, L.psi, 1, L.ps, PV); const m = F / PV[2];
        for(let a = Math.max(0, u - 1.05); a < Math.min(u - .4, L.tf + .001); a += .4 / (m * (.3 + G * a))){ const x = PV[0] + .22 * a * Math.cos(L.ps), z = PV[2] + .22 * a * Math.sin(L.ps), y = PV[1] - .5 * G * a * a, c = colOf(x, z), r = rowOf(Math.max(0, y), z), th = hash2(Math.floor(a * 60), Math.floor(t * 12)); put(c, r, z, .7 + .3 * th, WHT); if(th > .4) put(c + 1, r, z, .6, W0 + 5); }
        if(u > .4 + L.tf && u < 1.3 + L.tf) for(let i = 0; i < 16; i++){ const h1 = hash2(i, Math.floor(t * 9)), h2 = hash2(i + 40, Math.floor(t * 9)); put(colOf(L.fx, L.fz) + (h1 - .5) * .12 * m, rowOf(h2 * h2 * .05, L.fz) + (h1 - .5) * 2, L.fz, .6 + .4 * h2, WHT); } }
      const a = fu - FFLY; if((PART & 8) && a > 0 && a < .45){ const m = F / fz1, u = a / .45; for(let i = 0; i < 46; i++){ const an = i / 46 * TAU, h1 = hash2(i, 7), rr = (.03 + .09 * u) * (.7 + .6 * h1), y = (.03 + .16 * h1) * Math.sin(Math.PI * Math.min(1, u * 1.2)) * (1 - .5 * u); put(colOf(fx1 + rr * Math.cos(an), fz1 + rr * Math.sin(an)), rowOf(y, fz1 + rr * Math.sin(an)), fz1 - .2, .65 + .35 * h1, WHT); } } }
    /* rain in the air and the splash of each drop */
    if(PART & 2){ for(let qo = 0; qo < DR.length; qo += 6){ if(DR[qo + 5] === 1) continue; const x = DR[qo], z = DR[qo + 1], age = DR[qo + 2], m = F / z, c = Math.round(colOf(x, z)), r0 = rowOf(0, z), big = DR[qo + 3];
        if(age < 0){ const y = -age * VF, len = Math.max(2, .1 * m), ra = rowOf(y, z); for(let j = 0; j < len; j++) put(c - j * .1, ra - j, z, .16 + .16 * clamp01(m / 180), W0 + 5); continue; }
        if(DR[qo + 5] === 2){ if(age < .2) put(c, r0, 0, .9, WHT); continue; }
        const sz = Math.max(1, .011 * m * (big ? 1.4 : 1));
        if(age < .14){ put(c, r0 - sz * .4, z, 1, WHT); if(sz > 1.4){ put(c - sz, r0 - 1, z, .8, WHT); put(c + sz, r0 - 1, z, .8, WHT); put(c - sz * .6, r0, z, .6, WHT); put(c + sz * .6, r0, z, .6, WHT); if(sz > 2.4){ put(c - sz * .5, r0 - 2, z, .7, WHT); put(c + sz * .5, r0 - 2, z, .7, WHT); } } }
        else if(age < .5){ const u = (age - .14) / .36, hj = Math.sin(Math.PI * Math.min(1, u * 1.15)) * .03 * m * (big ? 1.5 : 1), hd = (u * 1.6 - u * u * 1.57) * .11 * m * (big ? 1.4 : 1);
          for(let j = 0; j <= hj; j++) put(c, r0 - j, z, .85 - .3 * j / (hj + 1), WHT); if(u > .28 && hd > hj + 1) put(c, r0 - hd, z, .95, WHT); if(m < 60) put(c, r0, z, .7 * (1 - u), WHT); } }
      /* rain near the lens: faint slanted streaks, new every twentieth of a second */
      const I0 = shower(ts), q0 = Math.floor(t * 20), nk = Math.round((phone ? 7 : 22) * I0 * SCL);
      for(let j = 0; j < nk; j++){ const c0 = hash2(j + q0 * 37, 21) * cols, z = .3 + 1.6 * hash2(j, q0), len = Math.min(34, .13 * F / z) * SCL, r0 = TOP + hash2(j + q0 * 53, 23) * (rows - TOP), b = .1 + .1 * hash2(j, q0 + 5);
        for(let i = 0; i < len; i++){ const c = Math.round(c0 - i * .14), r = Math.round(r0 - i); if(r < 0 || r >= rows || c < 0 || c >= cols || (r < TOP && inCol(c))) continue; const k = r * cols + c; if(b > FB[k]){ FB[k] = b; FK[k] = W0 + 4; } } }
      /* drops too small to follow: specks that last a tenth of a second */
      const ns = Math.round(cols * (rows - WL) * .0007 * I0);
      for(let j = 0; j < ns; j++){ const qo = Math.floor(t / .13 + hash2(j, 3)), h1 = hash2(j * 31 + qo, 5), r = WL + Math.floor(h1 * h1 * (rows - WL)), c = Math.floor(hash2(j * 17 + qo, 9) * cols), k = r * cols + c; if(OB[k] > 0) continue; const b = .3 + .25 * hash2(j, qo); if(b > FB[k]){ FB[k] = b; FK[k] = W0 + 3; } } }
    for(let i = 0; i < on; i++){ const k = OT[i]; if(k < WL * cols){ FB[k] = OB[k]; FK[k] = OC[k]; } }
    paint();
  };
}
/* 18 black hole.
   Adapted from ascii.rest piece 'black-hole' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: light paths found once by integrating the orbit equation of a photon round a non-spinning (Schwarzschild) hole with RK4
   and stored as a table over impact parameter; each ray's own plane and its crossings of the disc plane; the disc seen again through itself;
   gas on Kepler orbits; the Doppler side brighter. Rebuilt here: everything else.
   Units: the hole's mass is 1 (horizon at 2, photon sphere at 3, innermost stable orbit at 6, shadow edge at impact parameter sqrt(27)).
   Every cell is one ray from a camera that hovers at radius D0, a few degrees over the plane of a thin, opaque disc of gas that reaches from
   the innermost stable orbit to ROUT. The ray's path r(angle) is read from the table, so the picture is what the equations give: the near
   side of the disc crossing in front of the shadow, the far side lifted over the top of it, the underside of the far side bent up below it, the
   thin second image hugging the shadow and the photon ring inside that. A ray that meets the disc stops there.
   Light: the disc's surface flux by radius is the standard thin-disc (Novikov-Thorne / Page-Thorne) profile for a non-spinning hole: zero at the
   innermost orbit, a peak near 9.5, then falling as r^-3. What the camera receives is that times g^3 (the law for intensity at one frequency), where g = sqrt(1 - 3/r) / (1 - Omega Lz)
   is the ratio of received to emitted frequency (gravitational redshift and the Doppler shift of gas on a circular orbit; Lz is the ray's
   angular momentum about the disc's axis), so the side coming toward the camera is much brighter. Colour is the black-body colour of the
   local temperature (flux^(1/4)) times g: blue-white inside on the approaching side, orange and red outside and on the receding side.
   Gas: a map of streaks and knots carried round at each radius' own Kepler speed. The shear this builds up is reset radius by radius (two
   copies of the map half a life apart, cross-faded), so streaks lean over into trailing arcs, fade and re-form and never wind up into noise.
   Now and then a flare: a hot spot near the inner edge that brightens in under a second, goes round a few times, is drawn out into an arc by
   the shear and fades. Its second image runs round the shadow's edge on the other side.
   Stars are points at infinity. Each has two images, found from the table's deflection angle: one outside the Einstein ring and one inside it
   on the opposite side of the hole; near the ring both are stretched along it and brighten (a star of finite size keeps its surface
   brightness). The camera drifts slowly in azimuth and height, so the star field slides behind the hole, the images outside the ring flow
   round it and those inside loop the other way. When a star passes almost exactly behind the hole its two images sweep round the ring and
   join for a moment. Nothing twinkles: there is no air.
   Not modelled: spin, the thickness of the disc, light from the gas falling inside the innermost orbit, the camera's own motion (aberration).
   The picture is an equidistant (fisheye) projection: distance from the hole's centre on screen is proportional to angle at the camera.
   Liberties: the innermost orbit is given a period of 6.5 s and the camera drifts on its own slow clock; brightness is compressed for the
   screen; the photon ring (light that went round more than once) is drawn as one thin line of fixed strength, not traced.
   Data: the counted stars = tokens, their colour = split (the exact UI blue and amber); trend and cache are not shown.
   A few hundred fainter white stars and the one that passes behind the hole are not counted. */
const BH18 = (() => { const memo = {}; return D0 => { if(memo[D0]) return memo[D0];
  const f = u => 3 * u * u - u, BC = Math.sqrt(27), KB = .25, SB = 40, J0 = Math.floor(SB * Math.asinh((BC - .02) / KB)), KF = Math.sqrt(1 - 2 / D0), BMX = D0 / KF * .9995;
  const NB = J0 + Math.ceil(SB * Math.asinh((BMX - BC) / KB)), NBD = Math.min(NB, J0 + Math.ceil(SB * Math.asinh(62 / KB))), DPH = .025, NPH = Math.ceil(2 * Math.PI / DPH) + 3, H = DPH / 2;
  const U2 = new Float32Array(NBD * NPH), FI = new Float32Array(NB), BJ = new Float32Array(NB);
  for(let j = 0; j < NB; j++){ const b = j < NB - 1 ? BC + KB * Math.sinh((j - J0) / SB) : BMX; BJ[j] = b; let u = 1 / D0, w = Math.sqrt(Math.max(0, 1 / (b * b) - u * u * (1 - 2 * u))), end = 0, o = j * NPH; FI[j] = 99;
    if(j < NBD) U2[o] = u;
    for(let i = 1; i < 2 * NPH + 600; i++){ const k1 = w, l1 = f(u), k2 = w + H / 2 * l1, l2 = f(u + H / 2 * k1), k3 = w + H / 2 * l2, l3 = f(u + H / 2 * k2), k4 = w + H * l3, l4 = f(u + H * k3), u0 = u;
      u += H / 6 * (k1 + 2 * k2 + 2 * k3 + k4); w += H / 6 * (l1 + 2 * l2 + 2 * l3 + l4);
      if(u <= 0){ FI[j] = (i - 1) * H + H * u0 / (u0 - u); end = -1; } else if(u >= .5) end = 9;      /* gone to infinity (at that angle) or into the hole */
      if(j < NBD && !(i & 1) && i / 2 < NPH) U2[o + i / 2] = end || u;
      if(end){ if(j < NBD) for(let qo = (i >> 1) + 1; qo < NPH; qo++) U2[o + qo] = end; break; } } }
  return memo[D0] = {BC, KB, SB, J0, KF, NB, NBD, DPH, NPH, U2, FI, BJ}; }; })();
function tHole(env, X){
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, PX = env.P, N = cols * rows, sp = p.speed, LVN = 9, RD = Math.PI / 180, PI = Math.PI, S = mulberry(mix(p.seed + 18));
  const U = rows / (phone ? 97 : 139), TOP = Math.round((phone ? 12 : 64) * U), MG = phone ? 0 : Math.max(0, Math.floor((env.W - 1240) / 2 / PX));
  const D0 = phone ? 45 : 120, RIN = 6, ROUT = phone ? 26 : 50, SC = (phone ? .3 : .23) / Math.min(U, 1.2), G = BH18(D0), {BC, KB, SB, J0, KF, NB, NBD, DPH, NPH, U2, FI, BJ} = G, KANG = SC * KF / D0, BK = D0 / KF, IDPH = 1 / DPH, IKB = 1 / KB;
  const side = p.tilt < 0 ? -1 : 1, CX = cols * (phone ? .5 : .5 + side * (.1 + .04 * p.off)), CY = (phone ? 49 : 103) * U, ROLL = side * (phone ? 5 : 7 + 3 * Math.abs(p.tilt)) * RD, CR = Math.cos(ROLL), SR = Math.sin(ROLL);
  /* palette: 0 / 1 the data colours (counted stars only); 2-14 black-body colours from about 1000 K to 12000 K; 15 a white star */
  const PA = [BLUE, OR, [128, 20, 8], [176, 34, 8], [218, 56, 8], [244, 84, 10], [255, 112, 14], [255, 134, 20], [255, 156, 30], [255, 178, 46], [255, 200, 72], [255, 222, 112], [255, 242, 176], [232, 240, 255], [198, 214, 255], [232, 236, 246]];
  const TP = 2, NTC = 13, STARC = 15;
  const GV = new Float32Array(N), GC = new Uint8Array(N), TAG = new Uint8Array(N), KEY = new Uint8Array(N), ORD = new Int32Array(N), CNT = new Int32Array(PA.length * LVN + 1);
  /* painter: one index array for all (colour, level) runs (counting sort), so memory does not grow with the number of colours */
  const paint = (r0, r1) => { const k0 = r0 * cols, k1 = r1 * cols; CNT.fill(0);
    for(let k = k0; k < k1; k++){ const a = GV[k]; if(a < .05){ KEY[k] = 255; continue; } const key = GC[k] * LVN + (a >= 1 ? LVN : Math.ceil(a * LVN)) - 1; KEY[k] = key; CNT[key + 1]++; }
    for(let i = 1; i < CNT.length; i++) CNT[i] += CNT[i - 1];
    for(let k = k0; k < k1; k++){ const key = KEY[k]; if(key !== 255) ORD[CNT[key]++] = k; }
    let i0 = 0;
    for(let key = 0; key < CNT.length - 1; key++){ const i1 = CNT[key]; if(i1 === i0) continue;
      const col = PA[(key / LVN) | 0], f = (key % LVN + 1) / LVN, s = PX * (.36 + .58 * f), o = (PX - s) / 2;
      ax.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${(.14 + .8 * f).toFixed(3)})`; ax.beginPath();
      for(let i = i0; i < i1; i++){ const k = ORD[i]; ax.rect((k % cols) * PX + o, ((k / cols) | 0) * PX + o, s, s); }
      ax.fill(); i0 = i1; } };
  const at2 = (y, x) => { const ax_ = x < 0 ? -x : x, ay = y < 0 ? -y : y, a = (ax_ < ay ? ax_ : ay) / ((ax_ > ay ? ax_ : ay) + 1e-12), s = a * a; let r = ((-.0464964749 * s + .15931422) * s - .327622764) * s * a + a;
    if(ay > ax_) r = 1.57079637 - r; if(x < 0) r = 3.14159274 - r; return y < 0 ? -r : r; };
  /* ---- the disc by radius: flux (Page-Thorne, non-spinning), temperature, redshift at rest on the orbit, orbital frequency, edge opacity ---- */
  const NR = 1024, RI = (NR - 1) / (ROUT - RIN), FT = new Float32Array(NR), TQ = new Float32Array(NR), GR = new Float32Array(NR), OM = new Float32Array(NR), AL = new Float32Array(NR), FD = new Float32Array(NR), LRV = new Float32Array(NR), NV = 128, NW = 512;
  { const q3 = Math.sqrt(3), x0 = Math.sqrt(6), fl = r => { const x = Math.sqrt(r); return r <= 6 ? 0 : (x - x0 + q3 / 2 * Math.log((x + q3) * (x0 - q3) / ((x - q3) * (x0 + q3)))) / (x * x * x * x * x * (x * x - 3)); };
    let mx = 0; for(let r = 6; r < 30; r += .01) mx = Math.max(mx, fl(r));
    for(let i = 0; i < NR; i++){ const r = RIN + i / RI, F = fl(r) / mx; FT[i] = F; TQ[i] = Math.pow(F, .25); GR[i] = Math.sqrt(1 - 3 / r); OM[i] = Math.pow(r, -1.5);
      AL[i] = 1 - sstep(ROUT * .72, ROUT, r); LRV[i] = Math.log(r / RIN) / Math.log(ROUT / RIN) * (NV - 1.001); } }
  /* lanes: the disc's brightness by radius is broken into rings with dark gaps (the same for both gas maps, so they stay sharp); what is drawn is flux^0.6, lanes included.
     On the near side, seen at a grazing angle, one cell spans several lanes: there the lanes are averaged (FS) instead of sampled */
  const NL = 2048, LPT = new Float32Array(NL), LBT = new Float32Array(NL), LSPAN = Math.log(ROUT / RIN), LK = (NL - 1) / (NV - 1.001), LPER = .135 / LSPAN * NL;
  { const R = mulberry(mix(p.seed + 183)), V = new Float32Array(96).map(() => R()), n1 = x => { const i = Math.floor(x), f = x - i, qo = f * f * (3 - 2 * f); return V[i % 96] + (V[(i + 1) % 96] - V[i % 96]) * qo; };
    for(let i = 0; i < NL; i++){ const l = i / (NL - 1) * LSPAN; LPT[i] = (.5 + .5 * Math.sin(TAU * (l * 7.4 + 1.3 * n1(l * 5 + 11)))) * (.6 + .7 * n1(l * 9)); LBT[i] = .72 + .56 * n1(l * 30 + 40); }
    for(let i = 0; i < NR; i++) FD[i] = Math.pow(FT[i], .6); }
  /* a slow field that pushes the lanes in and out; it rides with the gas and is sheared and cross-faded like the streak map, so lanes wander, pinch, fork and trail */
  const DISP = new Float32Array(NV * NW); { const R = mulberry(mix(p.seed + 184)); let lo = 1e9, hi = -1e9;
    for(const [nv, nw, amp] of [[4, 3, 1], [8, 7, .7], [15, 12, .35]]){ const L = new Float32Array((nv + 1) * nw).map(() => R());
      for(let v = 0; v < NV; v++){ const fv = v / NV * nv, v0 = fv | 0, tv = fv - v0, sv = tv * tv * (3 - 2 * tv);
        for(let w = 0; w < NW; w++){ const fw = w / NW * nw, w0 = fw | 0, tw = fw - w0, sw = tw * tw * (3 - 2 * tw), w1 = (w0 + 1) % nw; DISP[v * NW + w] += amp * ((L[v0 * nw + w0] + (L[v0 * nw + w1] - L[v0 * nw + w0]) * sw) * (1 - sv) + (L[(v0 + 1) * nw + w0] + (L[(v0 + 1) * nw + w1] - L[(v0 + 1) * nw + w0]) * sw) * sv); } } }
    for(let i = 0; i < DISP.length; i++){ lo = Math.min(lo, DISP[i]); hi = Math.max(hi, DISP[i]); } for(let i = 0; i < DISP.length; i++) DISP[i] = (DISP[i] - lo) / (hi - lo) - .5; }
  /* ---- the gas map: streaks long in azimuth (several octaves of value noise, wrapped), a few bright knots; read twice, at two different turns ---- */
  const mkTex = seed => { const R = mulberry(seed), T = new Float32Array(NV * NW), OC = [[6, 3, .6], [11, 5, .8], [21, 8, 1], [38, 13, 1], [56, 30, .55]]; let lo = 1e9, hi = -1e9;
    for(const [nv, nw, amp] of OC){ const L = new Float32Array((nv + 1) * nw).map(() => R());
      for(let v = 0; v < NV; v++){ const fv = v / NV * nv, v0 = fv | 0, tv = fv - v0, sv = tv * tv * (3 - 2 * tv);
        for(let w = 0; w < NW; w++){ const fw = w / NW * nw, w0 = fw | 0, tw = fw - w0, sw = tw * tw * (3 - 2 * tw), w1 = (w0 + 1) % nw, a = L[v0 * nw + w0], b = L[v0 * nw + w1], c = L[(v0 + 1) * nw + w0], d = L[(v0 + 1) * nw + w1];
          T[v * NW + w] += amp * ((a + (b - a) * sw) * (1 - sv) + (c + (d - c) * sw) * sv); } } }
    for(let i = 0; i < T.length; i++){ lo = Math.min(lo, T[i]); hi = Math.max(hi, T[i]); }
    const kv = 46, kw = 72, KL = new Float32Array((kv + 1) * kw).map(() => R());
    for(let v = 0; v < NV; v++){ const fv = v / NV * kv, v0 = fv | 0, tv = fv - v0, sv = tv * tv * (3 - 2 * tv);
      for(let w = 0; w < NW; w++){ const fw = w / NW * kw, w0 = fw | 0, tw = fw - w0, sw = tw * tw * (3 - 2 * tw), w1 = (w0 + 1) % kw, kn = (KL[v0 * kw + w0] + (KL[v0 * kw + w1] - KL[v0 * kw + w0]) * sw) * (1 - sv) + (KL[(v0 + 1) * kw + w0] + (KL[(v0 + 1) * kw + w1] - KL[(v0 + 1) * kw + w0]) * sw) * sv;
        const qo = (T[v * NW + w] - lo) / (hi - lo), k = clamp01((kn - .8) / .2); T[v * NW + w] = .07 + 2.1 * Math.pow(qo, 2.6) + 2.8 * k * k * (.3 + qo); } }   /* dark lanes, bright lanes, knots */
    return T; };
  const TXA = mkTex(mix(p.seed + 181)), TXB = TXA, HA = new Float32Array(256).map(() => S() * TAU);
  /* ---- clocks: the innermost orbit takes T6 seconds; the shear between neighbouring radii is let grow to KS radians per unit radius, then reset ---- */
  const T6 = 5.5, OMS = TAU / T6 * Math.pow(6, 1.5), KS = 1.3, CP = KS / (1.5 * OMS), IPK = 1 / CP;
  const I0 = ((phone ? 86.2 : 87.2) - .6 * (D.trendK - .5)) * RD, DI = .7 * RD, DA = .09, WI = TAU / 67, WA = TAU / 83, PHI_I = .6, PHA = -.35;
  const incl = t => I0 + DI * Math.sin(WI * t + PHI_I), azim = t => p.yaw + DA * Math.sin(WA * t + PHA);
  /* ---- stars: unit vectors on the sky, given by where they would be seen at the static frame if the hole bent no light ---- */
  const cam = t => { const i = incl(t), a = azim(t) - PI / 2, si = Math.sin(i), ci = Math.cos(i), ca = Math.cos(a), sa = Math.sin(a); return [si * ca, si * sa, ci, -sa, ca, 0, -ci * ca, -ci * sa, si]; };
  const sky = (dx, dy, t, lens) => { const c = cam(t), sx = dx * CR + dy * SR, sy = -dx * SR + dy * CR, rho = Math.hypot(sx, sy) || 1e-6, ex = sx / rho, ey = sy / rho; let be = rho * KANG;
    if(lens && be < 1.5){ const jf = J0 + SB * Math.asinh((BK * Math.sin(be) - BC) / KB), j = Math.min(NB - 2, jf | 0); be = PI - (FI[j] + (FI[j + 1] - FI[j]) * (jf - j)); }      /* the place on the sky whose outer image is seen at this cell */
    const cb = Math.cos(be), sb = Math.sin(be); return [-c[0] * cb + sb * (ex * c[3] + ey * c[6]), -c[1] * cb + sb * (ex * c[4] + ey * c[7]), -c[2] * cb + sb * (ex * c[5] + ey * c[8])]; };
  let JC = 0; while(FI[JC] > 90) JC++;
  let JE = JC; while(FI[JE] > PI) JE++; const RE = Math.asin(BJ[JE] / BK) / KANG;                                             /* the Einstein ring, in cells from the hole's centre */
  /* on wide screens each counted star is put where its outer image is seen at the static frame (anywhere in the open band outside the ring); on a phone
     most of the band lies inside the ring, so there the stars are spread over the sky and most of their images fall outside the frame */
  const NTOK = Math.round(D.nPart * .12), NEX = Math.round((phone ? 40 : 70) * U * U), NS = NTOK + NEX + 1, SX = new Float32Array(NS), SY = new Float32Array(NS), SZ = new Float32Array(NS), SB_ = new Float32Array(NS), SCO = new Uint8Array(NS);
  { const mx = DA / KANG + 6, my = DI / KANG + 4, Y0s = phone ? TOP : Math.min(TOP, rows * .08);
    for(let i = 0; i < NS - 1; i++){ const tk = i < NTOK && !phone; let x, y, v;
      for(let tr = 0; tr < 60; tr++){ if(tk){ x = X.rnd() * cols; y = TOP + 3 + X.rnd() * (rows - TOP - 5); } else { x = -mx + X.rnd() * (cols + 2 * mx); y = Y0s - my + X.rnd() * (rows - Y0s + 2 * my); }
        const rho = Math.hypot(x - CX, CY - y), al = rho * KANG; if(phone || al >= 1.5) break; if(rho < RE + 1.5) continue;
        const jf = J0 + SB * Math.asinh((BK * Math.sin(al) - BC) / KB), j = Math.min(NB - 2, jf | 0), be = PI - (FI[j] + (FI[j + 1] - FI[j]) * (jf - j)), A = al / be * (BJ[j + 1] - BJ[j]) / (FI[j] - FI[j + 1]) / (BK * Math.cos(al));
        if(X.rnd() * A < 1) break; }                                                      /* thinned by the magnification there, so the sky itself is evenly strewn */
      const u = X.rnd(), qo = X.rnd(); v = sky(x - CX, CY - y, 0, !phone); SX[i] = v[0]; SY[i] = v[1]; SZ[i] = v[2];
      if(i < NTOK){ SB_[i] = .5 + .5 * u * u; SCO[i] = qo < D.share ? 0 : 1; } else { SB_[i] = .34 + .5 * u * u * u; SCO[i] = STARC; } }
    /* one bright white star (not counted) stands where the line from the camera through the hole will point a few seconds after the static frame */
    const tc = 4.2, c = cam(tc), o = .15 * KANG; SX[NS - 1] = -c[0] + o * c[6]; SY[NS - 1] = -c[1] + o * c[7]; SZ[NS - 1] = -c[2] + o * c[8]; SB_[NS - 1] = 1; SCO[NS - 1] = STARC; }
  /* the table's deflection: at which impact parameter does a ray end up at angle a from the camera's direction? (falls with b; binary search) */
  const bOf = a => { if(a >= FI[JC]) return -JC; if(a <= FI[NB - 1]) return 0; let lo = JC, hi = NB - 1; while(hi - lo > 1){ const m = (lo + hi) >> 1; if(FI[m] >= a) lo = m; else hi = m; } return lo + (FI[lo] - a) / (FI[lo] - FI[hi]); };
  const ROWG = new Float32Array(rows), FADE = new Float32Array(rows), Y0 = MG > 0 ? Math.round(rows * .08) : TOP;
  for(let y = 0; y < rows; y++){ ROWG[y] = 1 + (phone ? .5 : .45) * clamp01((TOP + (phone ? 50 : 34) * U - y) / ((phone ? 50 : 34) * U)); FADE[y] = sstep(TOP - 1, TOP + 10 * U, y); }
  const TH = new Float32Array(N); for(let k = 0; k < N; k++){ const x = k % cols, y = (k / cols) | 0, a = 52.9829189 * ((.06711056 * x + .00583715 * y) % 1); TH[k] = a - Math.floor(a); }   /* dither thresholds without a grid pattern */
  const GAM = new Float32Array(513); for(let i = 0; i <= 512; i++) GAM[i] = Math.pow(1 - Math.exp(-3.6 * i / 175), .64);
  const UIN = 1 / RIN, UOUT = 1 / ROUT, RB = (ROUT + 3) / SC, XA = Math.max(0, Math.floor(CX - RB)), XB = Math.min(cols, Math.ceil(CX + RB)), RV = 13.5 / SC + RB * Math.abs(SR), YA = Math.max(Y0, Math.floor(CY - RV)), YB = Math.min(rows, Math.ceil(CY + RV));
  const RHOC = Math.asin(BC / BK) / KANG, SS0 = RHOC - 1.6, SS1 = Math.asin((BC + 1.6) / BK) / KANG, RHOR = Math.asin((BC + .025) / BK) / KANG;
  const NRT = Math.ceil((RB + 3) * 8), BT = new Float32Array(NRT), JT = new Float32Array(NRT), YT = new Float32Array(NRT);        /* by distance from the centre in eighths of a cell: impact parameter, its table index, how far off the disc's line light can still come from */
  for(let i = 0; i < NRT; i++){ const b = BK * Math.sin(Math.min(1.57, i / 8 * KANG)); BT[i] = b; JT[i] = J0 + SB * Math.asinh((b - BC) * IKB); YT[i] = b > 20 ? 2.6 * ROUT / b / SC + 2 : 1e9; }
  const FL0 = 2.75, NSP = 9, SPK = new Float32Array(NSP * 8);
  return tm => {
    const t = (tm - 14) * sp, inc = incl(t), si = Math.sin(inc), ci = Math.cos(inc), AZ = azim(t), SCI = SC / ci, YC = ROUT * ci * 1.5 / SC, tOm = t * OMS, tP = t * IPK;
    /* flares alive now: [radius, angle of the middle now, age, strength, radial half width, half length] */
    let nsp = 0, nfl = 0;
    for(let i = 0; i < NSP; i++){ const kn = i > 1, per = kn ? 19 + 3.7 * i : i ? 149 : 97, tt = kn ? t + 400 + 7.3 * i : i ? t + 61 : t + 2.6, e = Math.floor(tt / per), age = tt - e * per, rh = kn ? 6.7 + 11 * hash2(e, i + 3) * hash2(e, i + 4) + (i - 2) * .9 : 6.9 + 1.4 * hash2(e, i + 3), orb = T6 * Math.pow(rh / 6, 1.5), life = kn ? Math.min(per, orb * (1.5 + hash2(e, i + 5))) : orb * (2.4 + 1.2 * hash2(e, i + 5));
      if(age > life || !kn && (e !== 0 || i) && hash2(e, i + 7) < .55) continue; const o = nsp++ * 8;
      SPK[o] = rh; SPK[o + 1] = (e === 0 && !i ? azim(0) + FL0 - TAU / orb * 2.6 : TAU * hash2(e, i + 9)) + TAU / orb * age; SPK[o + 2] = age; SPK[o + 4] = kn ? .3 : .42; SPK[o + 5] = kn ? .5 : .75; SPK[o + 6] = TAU / orb; SPK[o + 7] = Math.pow(rh, 1.5);
      SPK[o + 3] = kn ? (.5 + .5 * hash2(e, i + 11)) * sstep(0, 1.5, age) * (1 - sstep(life - 2.5, life, age)) : (1.3 + .9 * hash2(e, i + 11)) * sstep(0, .7, age) * Math.pow(1 - age / life, 1.5) + 2.5 * sstep(0, .3, age) * (1 - sstep(.5, 3, age)); if(!kn) nfl = nsp; }
    GV.fill(0, Y0 * cols); TAG.fill(0, Y0 * cols);
    for(let y = YA; y < YB; y++){ const dy = CY - y, full = y >= TOP, rg = ROWG[y], rgc = rg * FADE[y];
      for(let x = XA; x < XB; x++){ if(!full && x >= MG && x < cols - MG){ x = cols - MG - 1; continue; }
        const dx = x - CX, sx = dx * CR + dy * SR, sy = -dx * SR + dy * CR, rho = Math.sqrt(sx * sx + sy * sy); if(rho < .02 || rho > RB || (sy < 0 ? -sy : sy) > YT[(rho * 8) | 0] + YC) continue;
        const cps = sx / rho, sps = sy / rho, a0 = -sps * si, h = Math.sqrt(a0 * a0 + ci * ci), c0 = a0 / h, s0 = ci / h, ph0 = at2(ci, a0), LZ = cps * si, ns = rho > SS0 && rho < SS1 ? 2 : 1;
        let I = 0, TS = 0, T2 = 0, tag = 0, hot = 0;
        for(let s = 0; s < ns; s++){ const rq = (ns === 1 ? rho : rho + s * .5 - .25) * 8, r0 = rq | 0, rf_ = rq - r0, b = BT[r0] + (BT[r0 + 1] - BT[r0]) * rf_, jf = JT[r0] + (JT[r0 + 1] - JT[r0]) * rf_; if(jf >= NBD - 1 || jf < 0) continue;
          const j = jf | 0, fj = jf - j; let T = 1;
          for(let n = 0, nm = b > 17 ? 1 : 2; n < nm; n++){ const qo = (ph0 + n * PI) * IDPH, qi = qo | 0, fq = qo - qi, o = j * NPH + qi, u00 = U2[o], u01 = U2[o + 1], u10 = U2[o + NPH], u11 = U2[o + NPH + 1];
            const v0 = u00 > 0 && u01 > 0 && u00 < 1 && u01 < 1, v1 = u10 > 0 && u11 > 0 && u10 < 1 && u11 < 1; let u;
            if(v0 && v1) u = (u00 + (u01 - u00) * fq) * (1 - fj) + (u10 + (u11 - u10) * fq) * fj; else if(v0 && fj < .5) u = u00 + (u01 - u00) * fq; else if(v1 && fj >= .5) u = u10 + (u11 - u10) * fq; else break;   /* never mix a path with one that has ended */
            if(u >= UIN || u <= UOUT) continue;
            const r = 1 / u, ir = ((r - RIN) * RI) | 0, sg = n ? -1 : 1, cph = sg * c0, sph = sg * s0, yu = -cph * si + sph * sps * ci, th = at2(yu, sph * cps) + AZ, g = GR[ir] / (1 + OM[ir] * b * LZ), g2 = g * g;
            const om = 1 / (r * Math.sqrt(r)), se = tP / (r * r * Math.sqrt(r)), ea = Math.floor(se), fa = se - ea, eb = Math.floor(se + .5), tri = fa < .5 ? 2 * fa : 2 - 2 * fa, wa = tri * tri * (3 - 2 * tri), wb = 1 - wa, base = th - tOm * om, v0i = (LRV[ir] + .5) | 0;
            let qa = (base - KS * ea * r + HA[ea & 255]) * (NW / TAU); qa -= Math.floor(qa / NW) * NW; let qb = (base - KS * (eb - .5) * r + HA[(eb + 97) & 255]) * (NW / TAU); qb -= Math.floor(qb / NW) * NW;
            const a_ = qa | 0, fa_ = qa - a_, a1 = (a_ + 1) & (NW - 1), oa = v0i * NW, b_ = qb | 0, fb_ = qb - b_, b1 = (b_ + 1) & (NW - 1);
            const va = TXA[oa + a_] + (TXA[oa + a1] - TXA[oa + a_]) * fa_, vb = TXB[oa + b_] + (TXB[oa + b1] - TXB[oa + b_]) * fb_;
            const nrm = 1 / Math.sqrt(wa * wa + wb * wb), tx = .5 + (wa * (va - .5) + wb * (vb - .5)) * nrm, txc = tx < .04 ? .04 : tx, lw = n || yu > 0 ? 0 : clamp01(-yu * SCI / r * 9 - .45);
            let li = (LRV[ir] * LK + 1.35 * LPER * (wa * DISP[oa + a_] + wb * DISP[oa + b_]) * nrm) | 0; li = li < 0 ? 0 : li >= NL ? NL - 1 : li;
            let lx = (LPT[li] * (.55 + (txc > 1.2 ? 1.2 : txc) * .9) - .16) * 2.94; lx = lx < 0 ? 0 : lx > 1 ? 1 : lx; const lane = .12 + .88 * lx * lx * (3 - 2 * lx) * LBT[li];
            let em = FD[ir] * (lane + (.5 - lane) * lw) * txc, tq = TQ[ir], fl = 0, ff = 0;
            for(let i = 0; i < nsp; i++){ const o6 = i * 8, dr = r - SPK[o6]; if(dr > 1.3 || dr < -1.3) continue; let da = th - SPK[o6 + 1] - (om * SPK[o6 + 7] - 1) * SPK[o6 + 6] * SPK[o6 + 2]; da -= TAU * Math.round(da / TAU);
              const dl = da * r / SPK[o6 + 5], dq = dr / SPK[o6 + 4], e = dl * dl + dq * dq; if(e < 9){ const v = SPK[o6 + 3] * Math.exp(-e); fl += v; if(i < nfl) ff += v; } }
            if(fl > 0){ em += fl; tq += .5 * Math.min(1, ff) + .12 * Math.min(1, fl); }
            const al = AL[ir], c = T * al * em * g2 * g; I += c; TS += c * g * tq; if(ff > em * .5) hot += c; if(n) T2 += c; T *= 1 - al; if(T < .02) break; }
          if(T > .02 && ns > 1){ const d = (rho - RHOR); if(d < 1 && d > -1){ const g = .76 / (1 + .054 * BC * LZ), c = T * .5 * (1 - (d < 0 ? -d : d)) * g * g * g; I += c; TS += c * g * .95; T2 += c; } } }
        if(I <= 0) continue; const k = y * cols + x, th_ = TH[k]; TAG[k] = 6;
        const bq = I / ns * 175, bv = GAM[bq >= 512 ? 512 : bq | 0] * (x >= MG && x < cols - MG ? rgc : rg); if(bv < .04) continue;
        const tn = TS / I, cm = bv * 12.5 - 2.5 + (hot > 0 ? 3 : 0), cq0 = (tn - .36) * 10.4, cq = (cq0 < cm ? cq0 : cm) + th_;       /* a pale colour only where it is also bright: pale and dim would read as grey */ GV[k] = bv + (th_ - .5) * .09; GC[k] = TP + (cq < 0 ? 0 : cq > NTC - 1 ? NTC - 1 : cq | 0); TAG[k] = hot > I * .4 ? 5 : T2 > I * .5 ? 2 : 1; } }
    /* stars: both images of each, as short arcs round the hole's centre */
    const c = cam(t);
    for(let i = 0; i < NS; i++){ const sx_ = SX[i], sy_ = SY[i], sz_ = SZ[i], zc = -(sx_ * c[0] + sy_ * c[1] + sz_ * c[2]), xr = sx_ * c[3] + sy_ * c[4] + sz_ * c[5], yu = sx_ * c[6] + sy_ * c[7] + sz_ * c[8], hp = Math.sqrt(xr * xr + yu * yu) + 1e-9, be = Math.atan2(hp, zc), ex = xr / hp, ey = yu / hp, bc = be / KANG;
      const half = bc > .25 ? Math.asin(.25 / bc) : PI / 2;
      for(let m = 0; m < 2; m++){ const jf = bOf(m ? PI + be : PI - be); let rho, rf, e = m ? -1 : 1;
        if(jf <= 0){ if(m || jf < 0) continue; rho = bc; rf = 1; } else { const j = Math.min(NB - 2, jf | 0), b = BJ[j] + (BJ[j + 1] - BJ[j]) * (jf - j), al = Math.asin(Math.min(1, b / BK)); rho = al / KANG; rf = (BJ[j + 1] - BJ[j]) / (FI[j] - FI[j + 1]) / (BK * Math.cos(al) + 1e-6); }
        const tl = rho / (bc + 1e-6), w = Math.min(1.25, rf) * (tl < 4 ? tl : 4), bb = Math.min(1, SB_[i] * Math.sqrt(w)); if(bb < .1) continue;
        const hf = i < NS - 1 && half * rho > 1.2 ? 1.2 / rho : half, len = 2 * hf * rho, na = len < 1.5 ? 1 : Math.ceil(len / .5) + 1, bv2 = na > 1 ? Math.max(bb, .52) : bb, st = na > 1 ? 2 * hf / (na - 1) : 0, an0 = Math.atan2(e * ey, e * ex) - (na > 1 ? hf : 0);
        for(let a = 0; a < na; a++){ const an = an0 + a * st, ux = rho * Math.cos(an), uy = rho * Math.sin(an), x = Math.round(CX + ux * CR - uy * SR), y = Math.round(CY - (ux * SR + uy * CR));
          if(x < 0 || x >= cols || y < Y0 || y >= rows || (y < TOP && x >= MG && x < cols - MG)) continue; const k = y * cols + x, v = bv2 * ROWG[y];
          if(TAG[k] && TAG[k] !== 4) continue; if(v > GV[k]){ GV[k] = v; GC[k] = SCO[i]; TAG[k] = 4; } } } }
    paint(Y0, rows);
  };
}
/* 19 moon: the Moon low over a wooded ridge through a very long lens. The disc is larger than the frame is tall: it is cut by the ridge below
   and by the top of the band above, and passes through the frame once every few minutes.
   Adapted from ascii.rest piece 'moon-phases' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: the idea (the near side of the Moon as a lit sphere showing its phase), the light model (mostly Lommel-Seeliger with a
   little Lambert, so the ball still reads as round), earthshine on the night side at thin phases. Rebuilt: everything else.
   The surface is real: MOON_ALB is the near side of the Clementine 750 nm albedo mosaic (USGS, public domain), 1.5 degrees a sample, so the
   maria, the ray craters and the bright highlands are where they are on the Moon. Relief is modelled, not measured: the large named craters at
   their catalogue positions and sizes, a population of smaller ones on the bright (old) ground, mountain arcs on the mare shores, and the maria
   set lower than the highlands; crater depth and rim height follow Pike's 1977 fits, drawn deeper, and slopes are drawn steeper where the sun
   is low, as a lunar photographer's contrast would: the terminator is ragged, crater floors fill with shadow, rims and peaks catch light.
   The phase is the real one for the page's date: Sun and Moon longitudes from the low-precision series of the Astronomical Almanac (good to a
   fraction of a degree), at 21:00 UT. Under 7 degrees from the Sun the crescent is drawn at 7 degrees (it cannot be seen closer: Danjon limit).
   The view is the one from mid northern latitudes: a waxing Moon is seen in the west going down to the right with its lit limb toward the sun
   below the horizon; a full or waning one comes up in the east. It moves at about its real speed (its own width in two minutes), in half-cell
   steps; after it has gone its glow stays over the ridge for a few seconds while the next pass begins. Libration is the optical libration of the date.
   Close to the ridge the disc is warmer and a little dimmer and its edge ripples in the heated air; higher up it is cream to neutral.
   Stars = tokens, blue-white and amber stars = the split. Nothing else carries data. Cloud, trees and birds are scenery. */
const MOON_ALB = 'mZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmYmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZqqmZqZmZmZmZmZmqqpmamZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmpmZmImZmJmZmZmZmZmZmZmZmZmYiIiZmZmZmpmZiJmpmZmZmZmaqqqpmZqqmZmZmZqpqqqamaqqqqqqqqmaqqqZmZmZqpmZmZmZmZmZmpmZmZmZmZmZmqqZmJmZmZqqmYiZmqqZmZmZqqqqqqqqqqqqqqq7qqqquru7u7u7u6qrqqqZmZmqmZmZmaqpqqqqqqqpmZmZmYmpqqmaqpiJmYmZqqh5qqq7qZqZmqqqqqu7uqq7u7uryru8y83czLu7zLu7u7u6qpmZqZmqmIiamqqZqqqqq5maqqqpqpmqqpqpiIiIiZqZiIiZqqq6qru7u7u7qqvMqqqru7vKzu3t3e27y7q7uqqqqqmZmZmZmqqpiZmZqqqZmqqru6qqqru6mrm6qpmqmZqZqqqrq7u8u7u7uqq7y6mqzKqqu7zM3e3t3d7b7dy7uqqZmZmZmYiZmaqqqqqqm7u7qquqqrmqurvLu7u6mqqZmaqZmZqqmqvN7d3MzKrLqqmaqqqru8zMzd3e7u3sy7uqu7qqqqmpmZmZmpqaqqqrqru8vMzdzMzM3N3d3My5q6qrqpmqmqmquru83d3cvLq7qqqqqqqaq6q8u8y8zN3MzLqqqqqZmZmZmZmZmZmaqqqru7vMzMzd3d7dzN3LzMzMqqmaq6m6mqy7qqu7q7q8vLy7u6qZqZqqmpqrq7uru7vNzLu6qompmJmZmZupmYqpqrzMu7vM3dzcze7+7szN3u3tyqqpmqqqqqq7u6qrzMu7y7u6qqqpmZmamZmZmYqZqrurzLqpmZiJmZmZmYipmImamqq7u7vN3cve7------t3--c3KqaqJmqqqq7u7u7zMzMu7qqmamZmIiIiZiIiHeIiImZmqqZiZmIipmIiJmZmZmZmZmavc3d3cvM3t3e--3u-----eqZqpqZqpmaq7u7qbururuqqZmZiIiId3eIeHZmZ3eIiZmZmImIibmIiIiJmbqZqru7zN3M3MzN3cvM3f-97--+3u+ryqqamrqZqqqquqqqqrqqmZiIiIeHd2dmVVZmZmZ3dmd4iId3d4iHh3iImqmZqrvMzcu7u7u6u7u6us7u3e7u-u75m7y6mZqZiZmZqqqqmaqqmYiIeId3d3ZlVVVlZmVmZVVmd4h3d3eHd4iIiJmJmaq7zdzMu7qZmqu7u7uqvMzN7u-+maqaqZmIiZmZmZqrqZmZmIiHiHdndndmZmVlVWZVZVVWZmZ3d2ZmZ3d3Z3d3iIm7vNy7u6u6mZmau7mHeJqrvM3u6JmZqYiIiIiIeIiImZmImId3d2VVZmZ2Z3ZWZVZmZ2ZVZmZmZndmZmZmZmZmeIiau7y6qrmqqpmZqphmZ3iJu9zd7oiImZmYiHiIdVZmeIiIiHdmZmVVVVVodnZmZlZoh3d3d3ZmZmZmZmVWZVVVVVd4mqu7uqqaqamZmZmGZmiImrvM3NeYiJmIiIiId1RUVoh4h2ZlVmZ2ZWd4h2d3ZneIh3dmd4hmZmZmVVVVVVVVVVVneJmZqrl3iamKmZmImYeZqqurzL2JiJmYmpiHh3VERVZmZmVFVEVodniHd3d2ZnZoiHRGd4i_Z2ZnZVZlZmVVVVVneImZmZqYiZmYqpiIirqryqu7zczIiIiZmamId3dVVVVlVVVEM0RWZ3iId3dndmZUVnZEZneJiHdmdmeHdmVWVmZneIiZiYiZmpmYmpmImZmquqqqq8zeiIiZqph3d3ZURVVVVVVUQzRFVniIiHZmZ1VURFVWVmd3iJh3ZmZ3dmZmZ2ZniIiJiJmIiImImamIiIiJqqqZmqzN6amYmImYd3dkREREVUVUVURVZ4h4h3ZmZmRERERlVEVneIiHdmZmZmd2d2Znh4iImYmYh3eIiZqYmYmImZqpmazMzImYiImIdnZURERERERFRFVGZ4d3h1RERFQzNERFVVRVV_eIh3d2Z3iHZmZmd3iIiIibiHd3iJmJmaqZiZqaqqq7u8mZiJqYd2ZlQzMzRERERERDRmd3d3VEREQyMzRERERERVdoiId3eZd4dmd2d2aHd4iKmHd3Z4mIiKmZmJqqq6qru7yJiIiIh3dmU0NDMzNEREMzM0ZmZndUM0QyIiM0RERERFVYiIh4iIh3d2Znd3dnd3iIiHiIh3iFaJmZmqqqqpqqvLuomYh4d3d2ZlUzMzMzM0MzMzRmZmZ1QzMyMiIzNERERFVVd3iYiId3dmZmd3Z3d3d4iYeJm_eIeImpqqq7qqqqmsu6iaiId3d3ZmdjMzMzMzMzMzM1ZmZlRDIiIjMzMzREREVVZnl3iIZ4d2VVZmZmZniIiZd3ipiJiImKu6qpqqqqqqvMuJmZh3d3ZlREMzMzMzNEMzMzVVVWQzMzMiIiIzNERERVZmZ3iZh3d3dVVVZmVWeIiIiIiJmZmIiImqqqqqqZmqur3ZqqmYiHd1UzNDMzMzMzMyMzNFRVRDMzMiIiIzM0RERFVVVWeIhlRWZlRVVVVUaIh3iIiZmaqIiIiIiZmauqqqu6rNmpiYiJiGZUMzMzMzNDMzMzMzRERDMzMzMyIjMzNEM0RVVVVodUMzRVZURFVUV_iImJiJmaqYiId4iImpq7qqqau86ZmZiYiHZUQyMzMzMzMzMjMzMzNDMzMzMzIiIzMzMzRFVWVVd0NDNERENEZVVWZ5mZmIiKu5mIiIiIiJmqqqqqqqvJiZiIh4ZUMiIzREMzMzMzM0MzMzMzMzMyMiIjMzMzM0RFVFVlMzMzM0QzVnVnd4mZmYmZmpmIh5iZmZqqmZqqqZq6iIiHh3d2UyMzM0MiIiMzMzM0MzRDMzMzIiIzMzMzM0VVVVVVQyIzMzQzNndneImYmqiJmZmId3iaqJmambqrqpmZmImZiHd2VDNENDMzIiIiMzNERDMzM0MzMzMzIzMzM0VVVVVURDMzMzMzMkV3iImZqamZmamIh4iZmZqZqZu7uqqZh5iJuZd3UzRFVEQzMiIiIzM0RENDM0RDIzMzMjMzQ0VVVVZWVDMzMzMzMiNGeJiImZq5mZmJmYmYmZqpqqqqu6qZl3iImpiYdUNFM0REMyIiIjMzVUREMzQzMzMzMyMzVUVWZVVFdUMzIzMzMzIjV5mZiYiqiZd3iZiJmImZmqu7yqqHiWaImZmph2U0Q0VDMiIiIiMzRWREQzMzIzIjMzIzM0NFVmVUVlMiIjMzMzMiNnipiIeHh4iHd3d4eImYmaqrupmmd5l5maqpmYZUREVVQjMjIiIzNGpURDMzIzMyMzMzMzMzRWVlZnUyIiMjMyIyJFZ4iIh2d2d4d2ZWl4eJiZqqqpmqh4iIqZu5mYd3VUVkMzMzIiIjNEVURDMyMzNEMzM0MzMzMzRWd2ZCIiIjQyIjIkZmZnh2d3d2ZUREVmV3iJmqmZl5mYmHiYmqmZmHdlRFMzJFMiIiIjMzM0QzMzNEREM0MzMzMzM1Z2VUMiIiMzIiMiNWZUa_eHd2REREM0VWd4iZmZmpiZiIiJiZqZrJiIZUMzIjMiIiIiIzMzNEMzMzRDRDNDRDNEM1ZmVUMzMyIzIiIiNFVER_iIiIZEMzMyMkZniYmYiYiIiHiImJmpmqiId2QzMiMyEiIiIiIiMzQzMzRERUQ0RERENFZmZERDM0MiIiIiIjRDQzV5qphkMzMzIyNneYd3dVd5q_d4eHiJmamIh3ZUQyMiIiIiIiIjIjREQyNEZVVUVVVURVVVVDMzREM2UzMiIiIzMyNmeMuHQzMzIjM1eIdmh0R_eYh3iIeImZmYmHdlQzIiIiIiEiIiIiIzRTNERlVWVlVVVENFRDMzN_QzVUMiMiIiIyIlZnmnZDMzIiNFWIhlZmREVVZ3eIiImZmYiId3VFUzIiIiIiEiIjMjNEQzRWZlZ2ZWVUQzIzMzMjRDREMhEiIiISIiRmaJlkMzMyJ_ZoiIZVZDNERVZ3eIiqmIiIh3d2RDMyIiIiIiIiIjM0RTM0ZnZndlVVRDMiMyIiIzNFMhIhIiIhESEjVni_ZDMzM2h2eHeHdUQzQ0Rnd4iamIiIiIiIdmVTIiIiIiIiIiIzVVQzRmZomnVVVDMyNEQyIjNVVCIhEiISIiIiM0aIh2VFVmd3dnd4h2ZlVVVWZ3mJmIeImImZiHdmQyIiIiIiIiI0VmZDREVmeIZVVUMzRVVUQzNWVUIRIiIiIiIiJFVWiHd2d2Z2VWZ4iHd1VlZmZnepmIiIiImaqZh2ZUMiMyIiIiIjRWZlRERFZVVUREMiNGVmVVVVZmQyIiIiIiIiJERER_eHd3Z_Y0Vnh4h3ZWZ4d2d6mpiIiJiZqYiId3UzIiIiIiIiI0VmRERVVVVEMzM$I0ZmVnZWd2ZDIzIiIiIjMzNFVEVnd3eHZFVWd4mYd2Znd2Z3qaqamYmJmYeYiIdkMiIiIiIiIjM1U0REVVVUQzMzIjRVZnd3i_ZlQyIiIjMzMzNFVUMzZnd3dlZnh3iId3VFVmZ3e5mZmZiIiJiIiIiHQzIiIiIiIiIzRDRENFVWRDMzMzM0RWd3iZhmZTIiMjMzMzNEVEMzI1VWZ1Vmdmd2h2ZEQ1d3iamYmYiIiHh4mHeHZDIiIiIiIiIjMzMzRERFVlQzMzRERFV4iJmHdlQyMzM0ZkM0RDMzMiIzVWRGd2Zmd2VTMzR3eImZmZiZiIh3iIeIdUMiIiIiIiIiIiIzMzRERFVEM0RVVEVoiIiYeGZUMzMzWHZlVDMzMyIjNVVEVmdmZ2VEMzNGiHeZmZmZmId3d2aIhmRDIiEiIiIiEiIiMzM0MzRFRERVZmVniIiIiId3dmQzR3Z3ZTMzQzMzNEVlZmZ2d3ZkRERFeId6qpmamYh3h3Z4hlhlQiIiIyIiEiIiIzNEMzNFVUVmZ3Z3d4iHiIeImIdUNHdndlQzMzMzNERWd2d3d3dlVERWVnh4mqmpqZmIiHh4hTNmVTMiIiIiIiIiIzM0QzNEVVRGh3eHd3iIeHeImphkRFd3ZmZUMzMzNERFVmZmZ3d3ZVVWZ3eHiqqpmZmYiIiIiEI3h1QyIiIyIiIjIjM0RDM0RVVDV3d4d3eImYiHmqh1REV3d3ZUQzMzM0RFZmZmZndnZ1REZnd4iKqqqqmYiYmZh4ZWiHVEMiIiIiIiMiI0ZUIjNFZTNFZnd3d4iqiIiJmGZVRWd4mHVEMyM0RWiYd3Z3d3d3dmV3iIiHqqqpmqmJiJiHiHeHdlQzMiIjIiIyIjNVMiMzRlMzRmZmZ3iJiIiIiZh3ZVZ3h4dlUzMzRVeJl3d3d4d4h3d4iJiIjLy7uZm_iYiIiIiIh3ZUM0QjMiNDIjMzMiIzM1ZDNVd2Znd4iIiKqamZl1dUVWeJVUNDREVoh3d3d3d3iIh3iIiIiNzMq6mZd4mIiIiIiImHUzVDNEM1QzIjMzIjMzRkM1Znd3d3h4iImIiZmod2VEVohlVURURVZmd3d3Znd4h4iIiIiHu7qKqGmIeYiJh4h3iadlVURFRFVUMzIzNFM0Q1Q0REd3d3h3iHeIiJyph2VERWh3ZnZmRFVmZnZnZnd3iImYiYmIe6mJqpiZiIiJiIeHd3d2ZlRVVVVlREMiNFYzRDQzRVV3d3d3iIiIh4mqqnVERFeIhmd3ZERmVWdmZnh3eIiZmZmIeIZ4eJmImYiIiIh1eId3ZnVVVlZlU0M0I1VTM0M0MzRniHiIiZqId4iJnKhlRERph_dlVVVWZVVmZmh3iIicmZmpiIVGdneaeJiJiHiIeJmHdmZWZnZ2RTMyREVUMzMzMzNneJiJmHiIeHiImaqGVEQ1h1dmVVVlZ2VmZmZ4iZiquZmZqpl1ZUaKyomZmZiZmZmZiHdmdolkMiIjRVVURUQzM0NHiIh3iId4h3iIiYmZh2VFVmdmdURYmIdmd3Z3iJmYeJmYiZqZZUR5q4mamYmaqqqqqYd2d3dlMyIiNGVFVGQzMzM0Z4h3h4h4iIiId4iZm_V3h2Z3ZmVViZh2Z3d3eImZd4iIiImamGQ3m7q7uZmYmau7u6mYh3h1QzMiIkVENERDNDMzV_iYiIh4iZmYd3iJqod4iHV4d4h3eImYd3d3d4iIl3iJiImZmph3mru6qqmZiZq8y7qpmYd5ZDMyIiNFQ1VEMzMzNFaIiZmImZmZiHiJqph4iHd4iImJh4iIiId4h4h4iYeImYiYiLqqq7vMqqmZmZmqzMuqmZmWdkRDMjNEVkNUQzIzM0WJiKqYmrqpiIiJu6mZmIh4mJmZqoiJmpiJl3d3iJiIiIiIiIeImrvLu7qamZmJmqqpmZm5h2REMzNFVVREVDMzNEVomaqqmaupiIiZmZmZqZiIiZmaqrqqqqqZmYd3eJuqh3iIiIeYeau6q7qpmZmZiJmqmIqcqYh1U0REZlRFV1RFVWd5qqu7uqqZmIiKqYmJmYiJmJiJu7vLqqqZmqh3eJiqq_iIeId6qqurqqqqmYmIiJmJmYiZupmHVkVlZmNWZoh2dleZq6m7u7qpiIiKqYiZmZiJmZmJmrzcy7uom7mYd3iJqaiId3d3iIqamqqqqZiZiJmJiJiJmruph2Zld1Q0VVipmImrzMzcqruqqpiKqpmqmIiIiqmYmazuzN25m6qYiImoiHiHZGZ3eYm6qqqqqpmIiImZmYlniIiZhnd3Z3VUZVaauomavM7-yry6qqmZupmZmYiIiJmZmZq9zM3sqrqZiIial4dmdURnd5mruqqqmamIiamIiImYiYiIh2Vnd3d2Z3iIiruqzNzu27u8qqqpmZmJiYiJiImZmZqru8zMqZmYmIiZh3dkVmZmZmiqqpmqqZqZiImIiIeqmIiJmHZVh3Z4iHiYmJurrN3e7cu6uqu6mImImIiIiImZmZmZq8u7qZmYiYiJmYd3ZlVVVVWZmZmZmqmZmJiZmYeLuYd3Z3d2Z4iIiIiZmZmrvN3d3dzMu7qqmZqpmImZmpmZmImZm7uqq5mYmZiIiIZmZlVVZmZZmZmYmZqZmZmJmZmImZh3d3eId4iIiIZ3mJqbzM3M3c3czMu6mZmZqZmqmZmZmZmKqbuoiamYiImIh3dWZnZVRVZmiImZmZmZmamZmZm6mph3d4iImImJmpmZiZqrzMvMzN3cy7urqpmrmaqamYiZqqqqqqqpiIiIiId3iId2VVZVVFZmaJiZqamZmqmamZmZqZh1Voh3d3iZmZmZmamau7vN3MzdzLu7uqqrupq7mJiZmauqqqqpiIiIh3h3d4h2ZmZlZUVldoh4iZmZmZmZuZmYmZmHZniId3d4iZqZmYqaq8zN-7zNzLy8zLmpqpiamYmJmpmru7qpmIiIiIiYiHdVZmZ2ZVRFZniHiKqqmamJmpmZiJmZh3hnd2Z3iJmZmZiZu7zMvMvMzLvLu7qZiJmJmZmqu6maq7uqqYiHiIiJiJhmZnhmdmVVVmeJh4iJmZmZmZmpmZmJmJiHh3d3d4iJmpiZmqrMzMzMzczMy6uqmImZiYmaqqu7u9y6mYiIeIiYmIiGR_d2Z3Z3dmZ4mZmImYmJmZmaqqiYmJmIiHdmd3iImZmZmJmsvM3cvNzcy7vKqqmZmJiZmZqqq7uqiIiIiImqiYh2VFd3Z_Znd2ZnmIl5mZmZmZmquZmIiIiHh3d3d3d4iZmYmZmsu9zczN7cvMzKq7qpqZmZmZmZmampmZmImpmbp4d2ZlZnZDR_dmd2eph3mZqJmYmaqpmIiIiJmIh3Znh4iJiYmaq9yrzdzLzcqczLqrqamZmZmaqpqqqqmZmYmrmph3Z4dmVUZlRVd3d3d5mZiZmZmZmZmqmYh4mJmZiGdmeIiZiJmZqruqzd3NzMy7vcu6qpmZqqqqmpmqmaqqmIiIiIiHdnl0RWVndndmeJhnmZmZmaqZmJmZmYmZiJmZiHZmZ4mZiYmZmruqvMzLy7uqq7qaqamZqqqpmZmZq6mZmph4iYiZh3eGVFVVZWdnd4d3iZiImZmZmZmZmZmYiImJmZl3d3iIiImZqrqpqqu6q6u7qqq6qpmZmaqqqZmqqqqZmJmqmIiImYiIiHZVeId2eHiHd5mYiZqZmZmZmaqZmZiZmaqZiIiJiZmZmqqpmrzbq7vKupmrqqqZqqqqmZmZmZmYmZmamYmJmqmIiZdWeKmHZnd3d2mZmZmompmaqruqmZmZmqu6qqqqmZmImqmqqrzdzM3LuqqqqauqqqqpmZmZmqmqmZmYmamamqqZmauYiId3ZmVnZWeqqqmpmJmaqsurqaqpmrqqqqqqqpqZmqqqqqvN3LzcqqmZmYqqq6qqqaqZmZmZqZmqmZmqqZmqmZnLqYhmZ3Z3d4Z5iYmqmpmZmpqpmZmaqqq6zbu6uqmaqpq7upq97e7cqqqqmquqqqqqqZqqmZmpmZmpqZq6qpmZiImamZiId2ZmZ3eIqImYeIiZmZmZqqqqqru7qqmqmaqqqZmaqpqpzdzMy6qrqqmaqaqampqaqYeKqaqqqqq6qqqpmImauoeIh2VYd3d4iIipmaqYmZmZqqqqq6mrqqmqu7qqqZmaqqzdzNy7vLu7zLu7qrmrqZmZmrupqqqqq6rLu8q7qqmqqqqYi_d3d3ipmYibuqqqqZmZmqqqqqqqu6q6qpmrqaqpqry7q83cqqzLqamZmZuqu6qpmJiqqaqpqauqzLu7qqqaqZmZiIiIh4iKqZh4mrq6qYmqmaqrq6q7y7u7qruZuqmZmqrLu8u7zcvMu7q8y5qru6qqvLuZqpqqqrurq7u8upmHd5mZd5h4d4d4iJiZmYiHeIiLuqqqqr3d3dzLupqpmaqqmImZm6vLvMuZmZqqrKqqrMqbu8zKqqq6qqqrupl3iKupmYmZmImYd3iGd3d3dUV5mImHmrvLu7vM3d3cuqu6qqqqmZmau9y7qqvLvMy5m_mZqqu7u6q7q7uru6qanLvLqIiZmZd2aIh4iHd2d3d3h4h4mZiJh3h5q7urvNzLuqqqq6upiZmYm7u5u6qrzMzKqrrMy9qYrcu6yqu5q7mYiJu7qpmZmJu7qIeKiHh3ZWZ3eZiYeIm6qZmZh3ipiIiaqqupqZmbuqqZq5ibu7y7mHeJqpebqJvLq5q7u7q7qavMy6qoiYiYd5qZmJmYiImJh3Znh5mZqqmZq7qqqZdneIiJqImamZmZmqmYh4iZiYeJqruqmrupvLqrury4mIqpm6mImph4qaqaqZiIiJh4mamYmqqpmZmZiId3dmeJmZmYiIh3Z4mIiaqpiZqpmZmZiaqqmJq7u7i8uauqqYm8u6qJupqqmZmqqpiHZ2d4qqmZqpmZqpm_iIh4d3d3iId2Z4mYiZmZmYiIh3eId3d4iZmZmaqampmZmZmZupm6m7qZuqq6qqqqqqmZmZmJmJiHZ4mZmYmJmqqpiHd4iIiYiJmZmYiImZmZmJmZmZiIiIiJmYiZiIiJmZmYmZiZmJqZmZmZmZmZqZmZiIiIiZmZmqmZmIiZmZmZmIiIiIiImZmZmZmZmZmZiIiImJmYiJmZmIiJmZmYmZmZiIiZmZmIiIiZmYmZmZmZmZmZiIiIiIiIiImZmZmJmZmZiIiIiJmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZkA';
/* named craters: longitude east, latitude north (degrees), diameter (km) */
const MOON_CR = [-11.4, -43.3, 85, -20.1, 9.6, 93, -38, 8.1, 31, -47.4, 23.7, 40, -9.3, 51.6, 101, -14.4, -58.4, 225, -1.8, -9.2, 153, -2.8, -13.4, 119, -1.9, -18.2, 97,
  26.4, -11.4, 100, 24, -13.2, 98, 23.6, -18, 100, 60.9, -8.9, 132, 60.4, -25.3, 177, 61.8, -16.3, 147, 60.4, -36.3, 125, -68.6, -5.2, 172, -39.9, -17.5, 110,
  -54.6, -44.4, 227, -21.7, -49.5, 145, -6.2, -50, 163, 4.1, -11.2, 129, 4.8, -5.5, 150, -4, 29.7, 83, 1.2, 33.9, 55, -11.3, 14.5, 58, 17.4, 50.2, 87, 16.3, 44.3, 67,
  29.9, 31.8, 95, 44.4, 46.7, 87, 39.1, 46.7, 69, 56.5, 53.6, 125, 55.5, 27.7, 126, 46, 21.3, 64, 33, -21.2, 124, 32.2, -29.7, 88, 14, -41.8, 114, 6, -41.1, 126,
  .7, -33, 140, -1.9, -25.5, 118, -1, -28.4, 124, -22.2, -20.7, 61, -62.8, 63.5, 130, -42, 62, 165, 40.8, -45, 190, 33, -54.6, 125, -69, -66.8, 300, -27.8, -60.5, 110,
  -21.5, -63.6, 105, -5.5, -70.6, 114, 26.8, -67.7, 98, -67.3, 2.2, 106, -74.3, -3, 146, -42.4, -10.6, 119, -13.5, -29.8, 97, -57.3, -52.9, 114];
/* mountain arcs on the mare shores: from (lon, lat) to (lon, lat), height km. Apennines, Caucasus, Alps, Jura (the rim of Sinus Iridum), Altai scarp, Carpathians */
const MOON_MT = [-9, 15, -3, 20, 4.5, -3, 20, 5, 27, 4.2, 9, 33, 12, 40, 3, -6, 45, 4, 49, 2.6, -37, 43, -33, 48, 2.6, -33, 48, -26, 47, 2.4, 23, -22, 26, -27, 2, -30, 14, -20, 15.5, 1.8];
let MOON_G = null;
/* the Moon itself (the same on every date): albedo and heights on a half degree grid, lon -100..100, lat 90..-90. Heights in lunar radii, drawn 2.2x. */
function moonGrid(){
  const AX = 133, AY = 121, raw = new Float32Array(AX * AY), CH = 'ABCDEFGHIJKLMNOPQRSTUVW_YZabcdefghijklmnopqrstuvw$yz0123456789+-', ix = {}; for(let i = 0; i < 64; i++) ix[CH[i]] = i;
  for(let i = 0, k = 0; i < MOON_ALB.length; i += 2){ const n = ix[MOON_ALB[i]] << 6 | ix[MOON_ALB[i + 1]]; raw[k++] = (n >> 8) / 15; if(k < raw.length) raw[k++] = (n >> 4 & 15) / 15; if(k < raw.length) raw[k++] = (n & 15) / 15; }
  const MX = 401, MY = 361, A = new Float32Array(MX * MY), H = new Float32Array(MX * MY), KM = 2.2 / 1737.4, rad = Math.PI / 180;
  const hv = (i, j) => mix(Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ 0x2f6b) / 4294967296;
  const nz = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), u = x - xi, v = y - yi, a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v); return (hv(xi, yi) * (1 - a) + hv(xi + 1, yi) * a) * (1 - b) + (hv(xi, yi + 1) * (1 - a) + hv(xi + 1, yi + 1) * a) * b; };
  for(let j = 0; j < MY; j++) for(let i = 0; i < MX; i++){ const fx = Math.min(AX - 1.001, Math.max(0, (i / 2 - 1) / 1.5)), fy = j / 3 * .99999, x0 = fx | 0, y0 = fy | 0, u = fx - x0, v = fy - y0, o = y0 * AX + x0, o1 = Math.min(AY - 1, y0 + 1) * AX + x0;
    const a0 = (raw[o] * (1 - u) + raw[o + 1] * u) * (1 - v) + (raw[o1] * (1 - u) + raw[o1 + 1] * u) * v, hl = sstep(.3, .56, a0), k = j * MX + i;
    A[k] = Math.max(0, Math.min(1, a0 + hl * .05 * (nz(i * .45, j * .45) + nz(i * .9 + 3, j * .9) - 1)));          /* finer than the map: the speckle of small craters on the highlands */
    H[k] = (-1.3 * (1 - hl) + hl * (2 * (nz(i * .055, j * .055) - .5) + 1.3 * (nz(i * .16 + 7, j * .16) - .5))) * KM; }
  const crater = (lo, la, Dk) => { const a = Dk / 30.32, d = 1.044 * Math.pow(Dk, .301) * KM, hr = .236 * Math.pow(Dk, .399) * KM * 1.6, cs = Math.max(.15, Math.cos(la * rad)), ry = Math.ceil(a * 1.9), rx = Math.ceil(a * 1.9 / cs), ci = Math.round(lo * 2 + 200), cj = Math.round(180 - la * 2);
    for(let j = Math.max(0, cj - ry); j <= Math.min(MY - 1, cj + ry); j++) for(let i = Math.max(0, ci - rx); i <= Math.min(MX - 1, ci + rx); i++){ const r = Math.hypot((i - 200 - lo * 2) * cs, 180 - j - la * 2) / a; if(r > 1.9) continue; const k = j * MX + i;
      H[k] = H[k] * sstep(.75, 1.5, r) + (r < 1 ? -d + (d + hr) * sstep(.5, 1, r) + (Dk > 60 ? .3 * d * Math.exp(-((r / .16) ** 2)) : 0) : hr / (r * r * r)) * (1 - sstep(1.3, 1.9, r)); } };
  const R = mulberry(1969);
  for(let n = 0; n < 2400; n++){ const lo = R() * 200 - 100, la = Math.asin(R() * 2 - 1) / rad, Dk = 40 * Math.pow(R(), -1 / 1.7), a = A[Math.round(180 - la * 2) * MX + Math.round(lo * 2 + 200)]; if(Dk < 210 && sstep(.3, .6, a) > R() * .95) crater(lo, la, Dk); }
  for(let i = 0; i < MOON_MT.length; i += 5){ const [x0, y0, x1, y1, hk] = MOON_MT.slice(i, i + 5), n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 3);
    for(let qo = 0; qo <= n; qo++){ const lo = x0 + (x1 - x0) * qo / n, la = y0 + (y1 - y0) * qo / n; for(let dj = -3; dj <= 3; dj++) for(let di = -3; di <= 3; di++){ const i2 = Math.round(lo * 2 + 200) + di, j2 = Math.round(180 - la * 2) + dj, e = Math.exp(-(((i2 / 2 - 100 - lo) ** 2 + (90 - j2 / 2 - la) ** 2) / .8)) * hk * KM * (.6 + .8 * hv(qo, i)); if(e > H[j2 * MX + i2]) H[j2 * MX + i2] = e; } } }
  for(let i = 0; i < MOON_CR.length; i += 3) crater(MOON_CR[i], MOON_CR[i + 1], MOON_CR[i + 2]);
  return {A, H, MX, MY};
}
function tMoon(env, X){
  const {cols, rows, ax, phone} = env, PX = env.P, D = X.D, p = X.p, sp = p.speed, N = cols * rows, rad = Math.PI / 180, cl = (v, a, b) => v < a ? a : v > b ? b : v;
  const PART = 31;                                                                        /* what is drawn: 1 the Moon, 2 cloud, 4 stars, 8 birds, 16 sky, haze and ridge (kept for measuring) */
  const G = MOON_G || (MOON_G = moonGrid()), {A: GA, H: GH, MX, MY} = G;
  const samp = (F, lon, lat) => { const fx = cl(lon * 2 + 200, 0, MX - 1.001), fy = cl(180 - lat * 2, 0, MY - 1.001), x0 = fx | 0, y0 = fy | 0, u = fx - x0, v = fy - y0, o = y0 * MX + x0; return (F[o] * (1 - u) + F[o + 1] * u) * (1 - v) + (F[o + MX] * (1 - u) + F[o + MX + 1] * u) * v; };

  /* ---- the date: elongation of the Moon from the Sun, libration ---- */
  const dd = dayOf(String(p.ymd).replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3')) - 10957.5 + .875, T = dd / 36525, sn = a => Math.sin(a * rad), gs = 357.528 + .9856003 * dd;
  const eqc = 6.29 * sn(135 + 477198.87 * T) - 1.27 * sn(259.3 - 413335.36 * T) + .66 * sn(235.7 + 890534.22 * T) + .21 * sn(269.9 + 954397.74 * T) - .19 * sn(357.5 + 35999.05 * T) - .11 * sn(186.5 + 966404.03 * T);
  const beta = 5.13 * sn(93.3 + 483202.02 * T) + .28 * sn(228.2 + 960400.89 * T) - .28 * sn(318.3 + 6003.15 * T) - .17 * sn(217.6 - 407332.21 * T);
  const el = cl((((218.32 + 481267.881 * T + eqc) - (280.46 + .9856474 * dd + 1.915 * sn(gs) + .02 * sn(2 * gs))) % 360 + 360) % 360, 7, 353), elF = el > 180 ? 360 - el : el;
  const rising = el >= 165, dir = rising ? 1 : -1, kI = (1 - Math.cos(el * rad)) / 2, es = cl((95 - elF) / 50, 0, 1), lit = .25 + .75 * Math.pow(kI, .7);
  const Sx = Math.sin((180 - el) * rad), Sz = Math.cos((180 - el) * rad), libL = -eqc, libB = -1.3 * beta, chi = dir * (42 + 6 * p.tilt) * rad, cc = Math.cos(chi), sc = Math.sin(chi);

  /* ---- the frame ---- */
  const mg = phone ? 0 : Math.max(0, (env.W - 1240) / 2 / PX), TOP = phone ? Math.round(rows * .145) : Math.ceil(rows * .47) + 1;      /* nothing is drawn above TOP (the caption line; the page fades the canvas out up there) */
  const R = phone ? Math.round(cols * .58) : Math.round(rows * .43), u = R / 60, FL = .95, vR = R * FL, yCrest = phone ? Math.round(rows * .74) : rows - Math.round(rows * .075), yHor = yCrest + Math.round(4 * u);
  const go = (1 - kI) * .85, gr = .32 + .68 * kI, gx = Sx * cc * go, gy = Sx * sc * go;                 /* the lit part: its middle (in radii from the disc's centre) and its reach */
  const cx0 = cols * (.5 + (phone ? 0 : .05 * p.off)) - gx * R * .8, cyH = TOP + (yCrest - TOP) * .58 + gy * vR * .8, cA = TOP - .35 * vR, cB = yCrest + 6 * u + vR + 3;
  const vy = u * sp, vx = vy * (phone ? .2 : 1), TP = (cB - cA) / vy, HOLD = 4, LOOP = TP + HOLD, tauH = (rising ? cB - cyH : cyH - cA) / vy;
  /* where the Moon is at time t: [centre x, centre y, how much of its glow reaches the frame, seconds since the hero frame of this pass, which pass,
     how strong the glow over the ridge is where it went down or is about to come up]. The picture is never without light: after a setting the
     afterglow stays into the next pass, before a rising the sky over the ridge brightens first, a thin crescent keeps the dusk glow of the
     sun it follows, and at the top of the band (which the page fades out) the disc comes in or leaves over a few seconds. */
  const where = t => { const qo = t + tauH, pass = Math.floor(qo / LOOP), pos = qo - pass * LOOP, pp = Math.min(pos, TP), cy = rising ? cB - vy * pp : cA + vy * pp;
    const low = sstep(yCrest - .9 * vR, yCrest + .3 * vR, cy);
    return [cx0 + (pp - tauH) * vx, cy, rising ? sstep(0, HOLD, LOOP - pos) : sstep(0, 3, pos), pos - tauH, pass, Math.max(low, dusk * .85, rising ? sstep(LOOP - HOLD, LOOP, pos) : 1 - sstep(0, 6, pos))]; };
  const xH = cx0 + ((rising ? 0 : TP) - tauH) * vx, HR = new Float32Array(rows); for(let y = 0; y < rows; y++) HR[y] = Math.exp(-Math.max(0, yHor - y) / (.3 * R));
  const MK = new Float32Array(rows), HUE = new Float32Array(rows), EXT = new Float32Array(rows), RP = new Int8Array(rows), AT = new Float32Array(1024);
  for(let y = 0; y < rows; y++){ const m = 1 - (y + .5) / rows, mk = m < .14 ? 1 : m < .46 ? 1 - .45 * (m - .14) / .32 : .55 * (1 - (m - .46) / .54), f = (yHor - y) / R;
    MK[y] = Math.min(1.4, Math.pow(Math.max(.05, mk), -.8)); HUE[y] = 4 * Math.pow(sstep(.02, .5, f), .8); EXT[y] = .74 + .26 * sstep(0, .4, f); }
  for(let i = 0; i < 1024; i++){ const e = i / 64 / u * 1.7; AT[i] = lit * (.13 * Math.exp(-e / .12) + .1 * Math.exp(-e / .8) + .04 * Math.exp(-e / 3.2)); }
  /* palette: 0, 1 stars (the two data colours); 2..6 the Moon from the ridge up (orange, amber, pale gold, cream, neutral); 8 earthshine; 9..12 sky from far to next to the Moon; 13..15 cloud; 16, 17 far ridge in haze; 19 white star; 20 dusk */
  const PAL = [BLUE, OR, [222, 116, 56], [236, 164, 96], [240, 204, 150], [238, 226, 198], [228, 228, 224], [228, 228, 224], [112, 126, 164], [52, 62, 110], [80, 82, 124], [128, 104, 112], [190, 146, 106],
    [98, 106, 134], [172, 150, 140], [238, 208, 162], [56, 70, 100], [86, 98, 124], [168, 128, 92], [228, 232, 242], [196, 108, 70]];

  /* ---- light on the Moon for this date, on the half degree grid: phase, relief, cast shadows ---- */
  const LG = new Float32Array(MX * MY), Vx = Math.cos(libB * rad) * Math.sin(libL * rad), Vy = Math.sin(libB * rad), Vz = Math.cos(libB * rad) * Math.cos(libL * rad), SL = new Float32Array(MX), CL = new Float32Array(MX), H2 = .5 * rad;
  for(let i = 0; i < MX; i++){ SL[i] = Math.sin((i / 2 - 100) * rad); CL[i] = Math.cos((i / 2 - 100) * rad); }
  for(let j = 1; j < MY - 1; j++){ const la = (90 - j / 2) * rad, sf = Math.sin(la), cf = Math.cos(la);
    for(let i = 1; i < MX - 1; i++){ const sl = SL[i], c0 = CL[i], nx = cf * sl, nz = cf * c0, mu = nx * Vx + sf * Vy + nz * Vz, mu0 = nx * Sx + nz * Sz; if(mu < -.03 || mu0 < -.1) continue;
      const k = j * MX + i, h = GH[k], kr = 1 + 1.8 * Math.exp(-Math.max(0, mu0) / .22), gE = kr * (GH[k + 1] - GH[k - 1]) / (2 * H2) / Math.max(.2, cf), gN = kr * (GH[k - MX] - GH[k + MX]) / (2 * H2);
      const qox = nx - gE * c0 + gN * sf * sl, qy = sf - gN * cf, qz = nz + gE * sl + gN * sf * c0, m0 = (qox * Sx + qz * Sz) / Math.hypot(qox, qy, qz);
      if(m0 <= 0 || mu0 < -Math.sqrt(2 * Math.max(0, h)) * .8) continue;
      let sh = 1;
      if(mu0 < .3){ const r0 = 1 + h; for(let qo = 1; qo <= 9 && sh > 0; qo++){ const t = qo * .006 * (1 + qo * .14), x = nx * r0 + t * Sx, y = sf * r0, z = nz * r0 + t * Sz, r = Math.hypot(x, y, z); sh = Math.min(sh, cl((r - 1 - samp(GH, Math.atan2(x, z) / rad, Math.asin(y / r) / rad)) / .0004 + .25, 0, 1)); } }
      LG[k] = 2.05 * Math.pow(.3 + .7 * Math.pow(GA[k], 1.1), 1.85) * Math.pow((.3 * m0 + .7 * 2 * m0 / (m0 + Math.max(.4, mu))) * sh, .62) * (.84 + .16 * Math.sqrt(Math.max(0, mu))); } }      /* the light term is gamma-encoded as a camera would, the albedo is stretched: the maria must stay dark */
  /* the disc as it is seen, at two samples a cell, built once: the Moon then moves in half-cell steps by reading this at an offset */
  const TH = 2 * (R + 1), TW = 2 * TH, TL = new Float32Array(TW * TW), TE = new Float32Array(TW * TW), TC = new Uint8Array(TW * TW);
  { const cb = Math.cos(libB * rad), sb = Math.sin(libB * rad);
    for(let a = 0; a < TW; a++) for(let b = 0; b < TW; b++){ const X0 = (a + .5 - TH) / 2 / R, Y0 = -(b + .5 - TH) / 2 / vR, d = X0 * X0 + Y0 * Y0; if(d >= 1) continue; const z = Math.sqrt(1 - d), mx = X0 * cc + Y0 * sc, my = Y0 * cc - X0 * sc, y1 = my * cb + z * sb, z1 = z * cb - my * sb, lo = Math.atan2(mx, z1) / rad + libL, la = Math.asin(cl(y1, -1, 1)) / rad, o = a * TW + b;
      TC[o] = 1; TL[o] = samp(LG, lo, la); TE[o] = samp(GA, lo, la) * (.5 + .5 * z); } }

  /* ---- foreground: a far ridge in haze, a near ridge with a few large conifers and a dead tree in silhouette (cover 0..1), built once ---- */
  const FG = new Float32Array(N), FB = new Float32Array(N), FCc = new Uint8Array(N), SKY = new Float32Array(N), SKc = new Uint8Array(N), CN = new Float32Array(N), CF = new Float32Array(N);
  const yN = x => yCrest + u * (5 * Math.exp(-(((x - cx0) / (1.2 * R)) ** 2)) + 9 * (noise(x * .011 / u, 3.1) - .5) + 3 * (noise(x * .05 / u, 5.7) - .5) + 1.2 * (noise(x * .21 / u, 8.2) - .5));
  const yF = x => yCrest - u * (5 + 12 * noise(x * .007 / u + 40, 9.7) + 3 * noise(x * .03 / u, 12.2));
  for(let x = 0; x < cols; x++){ const a = yN(x), b = yF(x); for(let y = Math.max(0, Math.floor(Math.min(a, b)) - 2); y < rows; y++){ const k = x * rows + y; CN[k] = cl(y + .5 - a - (hash2(x, 71) < .3 ? -1 : 0), 0, 1); } }
  const stick = (C, x0, y0, x1, y1, w0, w1) => { const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1;
    for(let x = Math.max(0, Math.floor(Math.min(x0, x1) - 1)); x <= Math.min(cols - 1, Math.ceil(Math.max(x0, x1) + 1)); x++) for(let y = Math.max(0, Math.floor(Math.min(y0, y1) - 1)); y <= Math.min(rows - 1, Math.ceil(Math.max(y0, y1) + 1)); y++){ const t = cl(((x + .5 - x0) * dx + (y + .5 - y0) * dy) / l2, 0, 1), c = cl((w0 + (w1 - w0) * t) / 2 + .5 - Math.hypot(x + .5 - x0 - t * dx, y + .5 - y0 - t * dy), 0, 1), k = x * rows + y; if(c > C[k]) C[k] = c; } };
  /* a conifer: a leader, tiers of drooping branches that widen downward, each tier with its own reach on either side and sky between the
     tiers at their tips, a bare trunk below */
  const pine = (C, xc, base, hg, sd, slim) => { const nt = Math.max(3, Math.round(hg / (2.7 + 1.5 * hash2(sd, 1)))), lean = (hash2(sd, 2) - .5) * .09, bare = .05 + .09 * hash2(sd, 3), top = base - hg;
    for(let y = Math.floor(top); y <= base + 1; y++){ const rel = (y + .5 - top) / hg; if(rel < 0) continue; const xm = xc + lean * (base - y), qo = cl(rel / (1 - bare), 0, 1), tn = qo * nt, ti = Math.floor(tn), tf = tn - ti;
      const full = hg * slim * Math.pow(qo, .8), w = rel > 1 - bare ? 0 : full * (.38 + .62 * tf), wl = w * (.6 + .6 * hash2(sd + ti, 4)), wr = w * (.6 + .6 * hash2(sd + ti, 5)), tk = Math.min(1.6, .35 + .035 * hg + .6 * rel);
      for(let x = Math.floor(xm - wl - 1); x <= Math.ceil(xm + wr + 1); x++){ const dx = x + .5 - xm, e = dx < 0 ? wl + dx : wr - dx, c = Math.max(cl(tk / 2 + .5 - Math.abs(dx), 0, 1), cl(e + .4, 0, 1) * (tf < .34 && Math.abs(dx) > full * .4 && hash2(x + sd, y) < .5 ? 0 : 1)); if(x >= 0 && x < cols && y >= 0 && y < rows && c > C[x * rows + y]) C[x * rows + y] = c; } } };
  /* a dead tree: a tapering trunk broken off at the top, a few bare limbs that rise and fork */
  const snag = (xc, base, hg, sd) => { const lean = (hash2(sd, 2) - .5) * .12 * hg; stick(CN, xc, base + 1, xc + lean, base - hg, 2.4 * u + .4, .8);
    for(let i = 0; i < 6; i++){ const f = .3 + .11 * i + .05 * hash2(sd, 20 + i), sgn = i % 2 ? 1 : -1, bx = xc + lean * f, by = base - hg * f, len = hg * (.34 - .035 * i) * (.7 + .6 * hash2(sd, 30 + i)), ex = bx + sgn * len * .8, ey = by - len * (.35 + .4 * hash2(sd, 40 + i));
      stick(CN, bx, by, ex, ey, 1.3, .5); stick(CN, bx + (ex - bx) * .55, by + (ey - by) * .55, bx + (ex - bx) * .75, ey - len * .3, .7, .35); } };
  { const S = mulberry(mix(p.seed ^ 0x19)), big = [[-.62, 27, 0], [-.48, 19, 0], [.1, 21, 1], [.55, 30, 0], [.7, 22, 0], [-.2, 12, 0]]; let x = -2;
    for(const [fx, hg, dead] of big){ const xx = cx0 + fx * R + (S() - .5) * 6 * u, h = hg * u * (phone ? .85 : 1) * (.85 + .3 * S()); dead ? snag(xx, yN(xx) + 1, h, (S() * 1e6) | 0) : pine(CN, xx, yN(xx) + 1.5, h, (S() * 1e6) | 0, .2 + .06 * S()); }
    while(x < cols + 2){ const cluster = noise(x * .016 / u, 21.3), hg = u * (8 + 9 * S() * S() + 10 * cl(cluster * 2.4 - .9, 0, 1)); if(cluster > .4 || S() < .3){ S() < .06 ? snag(x, yN(x) + 1, hg * 1.1, (S() * 1e6) | 0) : pine(CN, x + S() - .5, yN(x) + 1.5, hg, (S() * 1e6) | 0, .19 + .09 * S()); }
      x += u * (4 + 11 * S() * (cluster > .5 ? .5 : 1.5)); }
 }
  for(let k = 0; k < N; k++){ const cn = CN[k], cf = CF[k]; FG[k] = Math.max(cn, cf); if(cn < 1 && cf > 0){ const x = (k / rows) | 0, y = k % rows, dp = (y - yF(x)) / (9 * u); FB[k] = (1 - cn) * cf * (.06 + .11 * cl(dp, 0, 1.4) + .05 * noise(x * .13, y * .4 + 3)); FCc[k] = dp > .6 + dith(x, y) * 4 ? 17 : 16; } }
  /* sky with no Moon: darker overhead, a little lighter (dusk-coloured at thin phases, when the sun is not far below) toward the horizon */
  const dusk = cl((60 - elF) / 45, 0, 1);
  for(let x = 0; x < cols; x++) for(let y = TOP; y < rows; y++){ const k = x * rows + y, a = cl((yHor - y) / (rows * .3), 0, 3), g = Math.exp(-a * 1.6);
    SKY[k] = (.062 + .1 * g + .16 * dusk * g * g) * (.85 + .3 * noise(x * .07, y * .12 + 60)); SKc[k] = dusk * g * g > .35 + dith(x, y) * 3 ? 20 : g > .55 + dith(x, y) * 3 ? 10 : 9; }

  /* ---- stars: fixed in the sky, which turns with the Moon; brighter ones are few ---- */
  const NS0 = Math.round(D.nPart * .2), NS = NS0 ? NS0 + 1 : 0, SH = Math.round(yCrest - 9 * u) - TOP, stars = Array.from({length: NS0}, () => ({x: X.rnd() * cols, y: X.rnd() * SH, ph: X.rnd() * 40, m: .4 + .6 * Math.pow(X.rnd(), 2.6), c: X.rnd() > D.share ? 1 : X.rnd() < .25 ? 19 : 0}));
  /* one bright star just off the Moon's leading (left) limb: a place on the limb that is in the frame and clear of the trees round the hero frame */
  { let best = null; for(const th of [170, 190, 150, 205, 135, 220, 120, 235, 105]){ const ox = Math.round(Math.cos(th * rad) * (R + 1.6)), oy = Math.round(-Math.sin(th * rad) * (vR + 1.6)); let ok = true;
      for(let qo = -5; qo <= 2 && ok; qo++){ const x = Math.round(cx0 + qo * vx + ox), y = Math.round(cyH - dir * qo * vy + oy); ok = x > 2 && x < cols - 3 && y >= TOP + 3 && y < rows && FG[x * rows + y] < .4; }
      if(ok){ best = [ox, oy]; break; } }
    stars.push({rel: best || [0, -rows * 9], ph: 7.7, m: 1, c: 19}); }
  const SK = PAL.map(c => Array.from({length: LV}, (_, i) => `rgba(${c[0]},${c[1]},${c[2]},${(.2 + .66 * (i + 1) / LV).toFixed(3)})`));

  /* ---- the painter: round dots like the kit's, one sort buffer for the whole piece instead of an index buffer per colour ---- */
  const Lb = new Float32Array(N), Lc = new Uint8Array(N), NK = PAL.length * LV, ord = new Int32Array(N), kb = new Int16Array(N), cnt = new Int32Array(NK + 1), pos = new Int32Array(NK), off = offscreen(env);
  const paint = c => { cnt.fill(0); for(let k = 0; k < N; k++){ const a = Lb[k]; if(a < .05){ kb[k] = -1; continue; } const key = Lc[k] * LV + Math.min(LV, Math.ceil(a * LV)) - 1; kb[k] = key; cnt[key + 1]++; }
    for(let i = 0; i < NK; i++){ cnt[i + 1] += cnt[i]; pos[i] = cnt[i]; } for(let k = 0; k < N; k++) if(kb[k] >= 0) ord[pos[kb[k]]++] = k;
    for(let key = 0; key < NK; key++){ const a0 = cnt[key], a1 = cnt[key + 1]; if(a1 === a0) continue; const f = (key % LV + 1) / LV, r = PX * (.17 + .33 * f); c.fillStyle = SK[(key / LV) | 0][key % LV]; c.beginPath();
      if(r < 1.45) for(let i = a0; i < a1; i++){ const k = ord[i]; c.rect(((k / rows) | 0) * PX + PX / 2 - r, (k % rows) * PX + PX / 2 - r, 2 * r, 2 * r); }
      else for(let i = a0; i < a1; i++){ const k = ord[i], x = ((k / rows) | 0) * PX + PX / 2, y = (k % rows) * PX + PX / 2; c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }
      c.fill(); } };

  /* ---- thin cloud in long streaks, each band at its own height and speed; tau = how much light it stops ---- */
  const AUR = new Float32Array(N), CT = new Float32Array(N), BC = new Float32Array(N), bl = [];
  const NB = phone ? 4 : 6, bands = Array.from({length: NB}, (_, i) => { const h = i === 0 ? .5 : hash2(i, p.seed & 255); return {y: i === 0 ? TOP + (yCrest - TOP) * .55 : TOP + 4 + (yCrest - TOP - 6) * ((i - .5 + .6 * h) / (NB - 1)), w: u * (1.6 + 3 * hash2(i, 7)), v: (1.6 + 3.2 * hash2(i, 8)) * u * sp * (p.tilt > -.4 ? 1 : -1), ns: (.011 + .012 * hash2(i, 9)) / u, th: .36 + .22 * hash2(i, 10), o: 31.7 * i}; });
  const cloud = t => { CT.fill(0); if(!(PART & 2)) return;
    for(const b of bands){ let pn = 0, pw = 0; for(let x = 0; x <= cols; x += 2){ const sx = (x - b.v * t) * b.ns + b.o, n = .62 * noise(sx, b.o) + .38 * noise(sx * 2.7, b.o + 9), wv = (noise(sx * .31 + 5, b.o + 3) - .5) * 12 * u;
        for(let qo = 0; qo < 2 && x + qo - 1 >= 0; qo++){ const xx = x + qo - 1; if(xx >= cols) continue; const nn = qo ? n : (n + pn) / 2, ww = qo ? wv : (wv + pw) / 2, dn = sstep(b.th, b.th + .34, nn); if(dn <= 0) continue; const w = b.w * (.55 + .9 * nn), yc = b.y + ww, y0 = Math.max(TOP, Math.floor(yc - 2 * w)), y1 = Math.min(rows - 1, Math.ceil(yc + 2 * w));
          for(let y = y0, k = xx * rows + y0; y <= y1; y++, k++){ const g = (y - yc) / w; CT[k] += 1.5 * dn * Math.exp(-g * g); } }
        pn = n; pw = wv; } } };

  /* ---- cranes across the disc: body, long neck ahead, legs trailing, wings beating about 2.6 times a second ---- */
  const seg = (x0, y0, x1, y1, w0, w1) => { const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1;
    for(let x = Math.max(0, Math.floor(Math.min(x0, x1) - 1)); x <= Math.min(cols - 1, Math.ceil(Math.max(x0, x1) + 1)); x++) for(let y = Math.max(TOP, Math.floor(Math.min(y0, y1) - 1)); y <= Math.min(rows - 1, Math.ceil(Math.max(y0, y1) + 1)); y++){ const t = cl(((x - x0) * dx + (y - y0) * dy) / l2, 0, 1), c = cl((w0 + (w1 - w0) * t) / 2 + .5 - Math.hypot(x - x0 - t * dx, y - y0 - t * dy), 0, 1); if(c > 0){ const k = x * rows + y; if(BC[k] === 0) bl.push(k); if(c > BC[k]) BC[k] = c; } } };
  const BPER = 34, BT0 = 2.6, BDUR = 5;
  const birds = (tau, pass, cx, cy) => { for(const k of bl) BC[k] = 0; bl.length = 0; if(!(PART & 8)) return false; const n = Math.floor((tau - BT0 + 3) / BPER), tb = tau - BT0 - n * BPER; if(tb < 0 || tb > BDUR || cy < TOP - .3 * R || cy > yCrest + .5 * R) return false;
    const ev = pass * 64 + n, h2 = hash2(ev, 302), d = hash2(ev, 301) < .5 ? 1 : -1, nb = 2 + Math.floor(h2 * 2), ub = u * 2.4, al = (.75 + .25 * h2) * d, v = 62 * u, sl = (hash2(ev, 303) - .5) * .12, x0 = cx - d * (R * 1.15 - v * tb), ym = (Math.max(TOP, cy - vR) + yCrest) / 2 - u * (2 + 12 * hash2(ev, 304)), y0 = ym + sl * (x0 - cx);
    for(let i = 0; i < nb; i++){ const a = Math.ceil(i / 2), sd = i % 2 ? 1 : -.6, jx = hash2(ev * 16 + i, 305), bx = x0 - d * a * ub * (8.5 + 2 * jx), by = y0 + sd * a * ub * 3.2 - sl * d * a * 8 + .5 * Math.sin(tb * 1.7 + i), f = (tb * 2.6 + jx * 3 + i * .37) * TAU, th = .15 + .95 * Math.sin(f), L = 5.2 * ub, ty = L * Math.sin(th), fs = Math.cos(th) * Math.sin(al) * d * L * .45, bob = -.4 * ub * Math.sin(f), y = by + bob;
      seg(bx - d * 1.4 * ub, y, bx + d * 1.4 * ub, y, 1.6 * ub, 1.3 * ub); seg(bx + d * 1.4 * ub, y, bx + d * 4 * ub, y - .5 * ub, .8 * ub, .5 * ub); seg(bx - d * 1.4 * ub, y, bx - d * 4.2 * ub, y + .4 * ub, .5 * ub, .3 * ub);
      seg(bx + d * .4 * ub, y, bx - d * .9 * ub + fs, y - ty, 1.7 * ub, .5 * ub); seg(bx + d * .7 * ub, y, bx + d * .5 * ub - fs, y - ty * .8, 1.3 * ub, .4 * ub); }
    return true; };

  /* ---- one picture: sky and glow, the Moon (read from the disc at a half-cell offset, each row nudged by the heated air), cloud, then the ridges ---- */
  let lastQ = NaN, mcx = 0, mcy = 0, CX2 = 0, CY2 = 0;
  const gM = 1 + .3 * (1 - kI), HZ = new Float32Array(cols);
  const compose = t => { const [cxf, cyf, glow, , , hzw] = where(t), mOn = PART & 1, sOn = PART & 16, tR = t * 2.3 * sp; CX2 = Math.round(2 * cxf); CY2 = Math.round(2 * cyf); mcx = CX2 / 2; mcy = CY2 / 2;
    cloud(t); for(let y = TOP; y < rows; y++) RP[y] = Math.round(2 * u * (.1 + 1.5 * Math.exp(-Math.max(0, yHor - y) / (7 * u))) * (noise(y * .43, tR + 40) + .5 * noise(y * 1.3, tR * 1.7 + 80) - .75) * 1.5);
    for(let x = 0; x < cols; x++){ const dx = (x + .5 - mcx) / R - gx, a0 = 2 * x - CX2 + TH; HZ[x] = .6 + .7 * lit * glow * Math.exp(-Math.abs(x - mcx) / (2 * R)); const hg = hzw * (.55 + .45 * lit) * 1.3 * Math.exp(-(((x - xH) / (.9 * R)) ** 2));
      for(let y = TOP, k = x * rows + y; y < rows; y++, k++){ const f = FG[k]; if(f >= 1 && FB[k] === 0){ Lb[k] = 0; AUR[k] = 0; continue; }
        const dy = (mcy - y - .5) / vR - gy, e = Math.sqrt(dx * dx + dy * dy) - gr, au = glow * AT[e <= 0 ? 0 : e >= 15.9 ? 1023 : (e * 64) | 0] + hg * HR[y]; AUR[k] = au;
        let b = sOn ? SKY[k] + au * MK[y] : 0, c = au > .62 + dith(x, y) * 2 ? 4 : au > .3 + dith(x, y) * 1.5 ? 12 : au > .13 + dith(x, y) * 1.2 ? 11 : au > .06 + dith(x, y) ? 10 : SKc[k], mb = 0;
        const a = a0 - RP[y], bb = 2 * y - CY2 + TH;
        if(mOn && a >= 0 && a < TW - 1 && bb >= 0 && bb < TW - 1){ const o = a * TW + bb, cv = (TC[o] + TC[o + 1] + TC[o + TW] + TC[o + TW + 1]) / 4 * glow;
          if(cv > 0){ const m = (TL[o] + TL[o + 1] + TL[o + TW] + TL[o + TW + 1]) / 4; mb = Math.pow(m, .8) * gM * EXT[y] * MK[y] * glow;
            if(mb > .045){ b = b * (1 - cv) + mb; c = 2 + cl(Math.round(HUE[y] + dith(x, y) * 5), 0, 4); }
            else { const ea = (TE[o] + TE[o + 1] + TE[o + TW] + TE[o + TW + 1]) / 4 * es * .2 * MK[y] * glow, sk = sOn ? SKY[k] * .5 + au * .2 * MK[y] : 0; b = b * (1 - cv) + cv * sk + ea + mb; if(ea > sk * .5) c = 8; } } }
        const tau = CT[k]; if(tau > .02){ const tr = Math.exp(-tau), g = (1 - tr) * (tau > 1 ? Math.exp(-.55 * (tau - 1)) : 1) * (.04 + (mb > .08 ? .5 : 1.25) * au * MK[y] + .2 * mb); b = b * tr + g; if(mb <= .08 && g > b * .45) c = au > .2 ? 15 : au > .07 ? 14 : 13; }
        if(f > 0){ b = b * (1 - f) + (sOn ? FB[k] * HZ[x] : 0); if(f > .6 && FB[k] > 0) c = FCc[k]; }
        Lb[k] = b < .05 ? 0 : Math.min(1, b + dith(x, y) * .8); Lc[k] = c; } }
    paint(off.begin()); };

  return tm => { const t = tm - 14, qo = Math.floor(tm * 10) / 10;
    if(qo !== lastQ){ compose(qo - 14); lastQ = qo; }
    off.blit();
    const [, , , tau, pass] = where(t);
    /* the birds are cut out of the picture: their cells are cleared and drawn again as much darker as the bird covers them */
    if(birds(tau, pass, mcx, mcy)) for(const k of bl){ const x = (k / rows) | 0, y = k % rows, b = Lb[k] * (1 - BC[k]); ax.clearRect(x * PX, y * PX, PX, PX); if(b < .05) continue; const lv = Math.min(LV, Math.ceil(b * LV)), r = PX * (.17 + .33 * lv / LV); ax.fillStyle = SK[Lc[k]][lv - 1]; ax.beginPath(); ax.arc(x * PX + PX / 2, y * PX + PX / 2, r, 0, TAU); ax.fill(); }
    if(!(PART & 4)) return;
    /* stars: they twinkle more the lower they are, drown in the glow near the Moon and behind cloud, and go out at the limb */
    const ox = t * vx, oy = -dir * t * vy;
    for(let n = 0; n < NS; n++){ const qo = stars[n]; if(qo.rel && tau > 1.8) continue;                                  /* the star at the limb: there until the Moon's leading edge reaches it, then gone at once */
      const x = qo.rel ? Math.round(mcx + qo.rel[0]) : Math.floor(((qo.x + ox) % cols + cols) % cols), y = qo.rel ? Math.round(mcy + qo.rel[1]) : TOP + Math.floor(((qo.y + oy) % SH + SH) % SH); if(x < 0 || x >= cols || y < TOP || y >= rows) continue; const k = x * rows + y; if(FG[k] > .4) continue;
      const dx = (x + .5 - mcx) / R, dy = (y + .5 - mcy) / vR; if(!qo.rel && dx * dx + dy * dy < 1.02) continue;
      const low = Math.exp(-Math.max(0, yHor - y) / (rows * .22)), tw = noise(qo.ph, tm * (2.2 + 3 * low)) - .5, b = qo.rel ? .9 + .2 * tw : qo.m * (1 + tw * (.5 + 1.3 * low)) * (1 - .45 * low) * Math.exp(-1.6 * CT[k]) * (1 - Math.min(.92, AUR[k] * 3)) * (1 - BC[k]); if(b < .06) continue;
      const lv = Math.min(LV, Math.ceil(b * LV)), f = lv / LV, r = PX * (.17 + .33 * f); ax.fillStyle = SK[qo.c][lv - 1]; if(r < 1.45) ax.fillRect(x * PX + PX / 2 - r, y * PX + PX / 2 - r, 2 * r, 2 * r); else { ax.beginPath(); ax.arc(x * PX + PX / 2, y * PX + PX / 2, r, 0, TAU); ax.fill(); } } };
}
/* 20 lantern lake.
   Adapted from ascii.rest piece 'lantern-lake' (github.com/bas3line/ascii, MIT, Copyright (c) 2026 bas3line)
   Kept from the source: a still lake at night under a far wooded shore and ranges, lanterns let go by the hundred, each one's size, speed and
   drift following from its distance (far ones crawl as sparks, near ones pass large), lights on the far shore, a boat with a lamp on its
   bow, a person who lets a lantern go on a fixed cycle and then takes up the next, flames that gutter, the lake carrying every light as a
   broken strip, and a lantern starting again only where it cannot be seen.
   Rebuilt to read like footage of a lantern floating (toro nagashi) at the end of dusk; the source's lanterns fly, these are set on the water.
   Place, from photographs: the camera is 0.8 m above the water at the bank, reeds in
   the near left corner. A low float lies on the left, nine metres out, with a row of people on it, some holding lit lanterns, a child, and
   one squatting at its end; a far shore of trees with lamps whose reflections run down the water, a few people with lamps beside a torii
   that stands in the shallows where the last light of the sky sits between the hills; thin mist on the far water, warm where lanterns lie
   under it. The water shows the sky far out and carries fine ripples close to the camera.
   Lanterns, at their real size (0.30 m square, 0.38 m tall): a paper box on a small raft with a candle inside, seen three-quarter on, so two
   faces and the open top show. The paper is nearly white next to the flame and amber toward the top and the corners; corner posts, top rim
   and the brush strokes on the paper are dark; the box swings slowly a little either way; far ones are two cells, then one. Each flame
   flickers on its own clock. Most are plain paper, a few red or green.
   Behaviour: the squatting person takes a lantern up, lights it, lowers it to the water and lets it go (the lantern's own clock, so it
   leaves the hand where the hand is); it is pushed off, slows, and is carried toward the camera and away to the right. Lanterns further out
   lie in loose groups that turn slowly about their middle; the nearer groups hold their place, the far ones drift to the right. A gust
   crosses the water every so often: flames gutter and lean in the order the gust reaches them and the reflections break up; as it arrives it
   tips a lantern, which flares, goes dark and floats on unlit. A rowing boat crosses beyond the float, surging at each stroke, and leaves a
   streak of broken water.
   Light: each lantern lights the water round it and throws a strip toward the camera that wavers, widens and is cut into dashes by the
   ripples. People are dim shapes in the last of the dusk (pale cloth, darker trousers and hair) and warm on the side a lantern is on.
   Data: lanterns = tokens (each one is afloat, in the squatting person's hands, or past the edge of the picture; the lanterns held by the
   people standing and the boat's lamp are not counted); how fast the far groups drift = 7-day trend; how long and broken the reflections
   are = cache miss. Colour carries no data. */
function tLantern(env, X){
  const PART = 15;                                                                                  /* what is drawn: 1 lanterns, 2 their light on the water, 4 water, lamps and mist, 8 people and boat (kept for measuring) */
  const {cols, rows, ax, phone} = env, D = X.D, p = X.p, sp = p.speed, PX = env.P, N = cols * rows, U = 5 / PX;
  const S = mulberry(mix(p.seed + 20)), cl = (v, a, b) => v < a ? a : v > b ? b : v;
  /* palette: 0 / 1 the two data colours (not used); 2 sky, 3 last light, 4 hills, 5 stars, 6 sky on the water, 7 glints, 8 shore lamps, 9 mist,
     10 wood, 11 unlit paper; 12..19 candle light from ember to flame; 20..23 red paper; 24..27 green paper; 28 skin in the dusk, 29 dark cloth */
  const PAL = [BLUE, OR, [50, 62, 118], [78, 104, 168], [58, 70, 112], [206, 214, 236], [58, 80, 136], [128, 152, 200], [186, 226, 208], [88, 100, 138], [92, 74, 62], [118, 118, 128],
               [124, 44, 20], [178, 72, 26], [222, 106, 32], [244, 144, 46], [252, 180, 72], [255, 208, 114], [255, 232, 170], [255, 246, 216],
               [122, 28, 26], [192, 50, 38], [236, 86, 58], [250, 144, 100], [40, 86, 54], [86, 152, 86], [150, 208, 128], [214, 240, 182], [156, 126, 110], [74, 84, 120]];
  const mg = phone ? 0 : Math.max(0, (env.W - 1240) / 2 / PX), TOP = phone ? Math.round(11 * U) : Math.round(rows * .47), BOT = phone ? Math.round(65 * U) : rows;
  /* the camera: CAM metres above the water, looking level; yH = the row of the far waterline, F = cells per metre at one metre */
  const yH = TOP + Math.round((BOT - TOP) * (phone ? .3 : .34)), hgt = yH - TOP, CAM = .8, F = (BOT - yH) * 2.75, cx = cols * .5;
  const SB = new Float32Array(N), SC = new Uint8Array(N), WB = new Float32Array(N), WC = new Uint8Array(N), Lb = new Float32Array(N), Lc = new Uint8Array(N), OCC = new Float32Array(N).fill(1e9), vis = new Float32Array(N);
  /* what the canvas mask leaves of a row (the page fades the canvas out toward its top), and its inverse, to keep the upper band readable */
  for(let x = 0; x < cols; x++){ const inCol = phone || (x >= mg - 1 && x <= cols - mg), ed = TOP + 4 + 4 * noise(x * .09, 61.5); for(let y = 0; y < rows; y++){ const u = 1 - (y + .5) / rows, mk = u < .14 ? 1 : u < .46 ? 1 - .45 * (u - .14) / .32 : .55 * (1 - (u - .46) / .54);
    let v = Math.min(2.1, 1 / Math.max(.05, mk)); if(inCol) v *= y < TOP - 1 ? 0 : y > ed ? 1 : sstep(TOP - 1, ed, y); if(phone) v *= 1 - .7 * sstep(BOT - 1, BOT + 7, y); else if(!inCol) v *= 1 - .6 * sstep(0, Math.max(30, mg * .6), x < mg ? mg - x : x - cols + mg) * sstep(TOP + hgt, rows * .8, y); vis[x * rows + y] = v; } }
  /* ---- the still part above the waterline: sky, stars, hills, the wooded shore, the torii ---- */
  const gx = cols * (phone ? .7 : .665 + .03 * p.off), LH = new Float32Array(cols), TR = new Float32Array(cols);
  const zT = 75, sT = F / zT, tH = 10 * sT, tyb = Math.round(yH + CAM * sT);                           /* the torii: 10 m tall, 75 m out */
  for(let x = 0; x < cols; x++){ const g = Math.exp(-(((x - gx) / (cols * (phone ? .5 : .2))) ** 2)), dip = 1 - .92 * Math.exp(-(((x - gx) / (cols * (phone ? .2 : .075))) ** 2));
    LH[x] = .36 + .42 * g;
    const h1 = hgt * (.22 + .5 * noise(x * .013 / U + 5, 2.5) + .08 * noise(x * .07 / U, 8.5)) * (.25 + .75 * dip), h2 = Math.max(.7, (1.6 + 4.6 * noise(x * .045 / U + 2, 7.5) + 1.6 * noise(x * .33 / U, 3.3)) / U * (.12 + .88 * dip));
    TR[x] = h2;
    for(let y = 0; y <= yH; y++){ const k = x * rows + y, up = yH - y; let b = LH[x] * (.4 + .6 * Math.exp(-up / (hgt * .5))) * (.82 + .36 * noise(x * .02 / U + 7, y * .22 / U)), c = up < hgt * .34 ? 3 : 2;
      if(noise(x * .016 / U + 3, y * .3 / U + 11) > .62 && up > hgt * .16) b *= .4;                    /* bars of cloud */
      if(up > hgt * .3 && hash2(x * 7 + 1, y * 13) > .989){ b = .3 + .4 * hash2(x, y * 3); c = 5; }
      if(up < h1){ b = LH[x] * .42 * (.8 + .4 * noise(x * .1, y * .2)); c = 4; }
      if(up < h2) b = up > h2 - 1.2 && noise(x * .7, y * .7) > .6 ? .05 : 0;
      SB[k] = b; SC[k] = c; } }
  { const pt = (x, y, b) => { x = Math.round(x); y = Math.round(y); if(x >= 0 && x < cols && y >= 0 && y < rows){ SB[x * rows + y] = b; SC[x * rows + y] = 4; } };
    const hw = 3.9 * sT, kw = 6.1 * sT, pw = Math.max(1, Math.round(.55 * sT)), yt = tyb - tH;
    for(let y = Math.round(yt); y <= tyb; y++){ const v = (tyb - y) / tH, o = hw * (1 + .06 * (1 - v)); for(let d = 0; d < pw; d++){ pt(gx - o + d - pw / 2 + .5, y, 0); pt(gx + o + d - pw / 2 + .5, y, 0); } }
    for(let d = -kw; d <= kw; d++){ const e = Math.abs(d) / kw, lift = Math.round(1.6 * U * e * e * e); pt(gx + d, yt - lift, .1); pt(gx + d, yt - lift + 1, 0); if(e < .93) pt(gx + d, yt + 2, 0); if(e < .8){ pt(gx + d, yt + Math.round(2.2 * sT) + 1, 0); if(sT > 2.2) pt(gx + d, yt + Math.round(2.2 * sT) + 2, 0); } }
    for(let y = yt + 2; y <= yt + 2.2 * sT + 1; y++){ pt(gx - .5, y, 0); pt(gx + .5, y, 0); } }
  /* a painter that draws like the kit's round dots, without the kit's per-colour index buffers (one sort buffer for the whole piece) */
  const NK = PAL.length * LV, ord = new Int32Array(N), kb = new Int16Array(N), cnt = new Int32Array(NK + 1), pos = new Int32Array(NK);
  const paint = (c, gb, gc, gain, halo) => { cnt.fill(0);
    for(let k = 0; k < N; k++){ const a = gb[k]; if(a < .05){ kb[k] = -1; continue; } const key = gc[k] * LV + Math.min(LV, Math.ceil(a * LV)) - 1; kb[k] = key; cnt[key + 1]++; }
    for(let i = 0; i < NK; i++){ cnt[i + 1] += cnt[i]; pos[i] = cnt[i]; }
    for(let k = 0; k < N; k++) if(kb[k] >= 0) ord[pos[kb[k]]++] = k;
    for(let key = 0; key < NK; key++){ const a0 = cnt[key], a1 = cnt[key + 1]; if(a1 === a0) continue; const col = PAL[(key / LV) | 0], f = (key % LV + 1) / LV, rgb = `${col[0]},${col[1]},${col[2]}`;
      if(halo && f > .85 && key >= 12 * LV){ const hs = PX * 2.4; c.fillStyle = `rgba(${rgb},${(.1 * gain).toFixed(3)})`; c.beginPath();
        for(let i = a0; i < a1; i++){ const k = ord[i], x = ((k / rows) | 0) * PX + PX / 2, y = (k % rows) * PX + PX / 2; c.moveTo(x + hs / 2, y); c.arc(x, y, hs / 2, 0, TAU); } c.fill(); }
      const r = PX * (.17 + .33 * f); c.fillStyle = `rgba(${rgb},${((.2 + .66 * f) * gain).toFixed(3)})`; c.beginPath();
      if(r < 1.45) for(let i = a0; i < a1; i++){ const k = ord[i]; c.rect(((k / rows) | 0) * PX + PX / 2 - r, (k % rows) * PX + PX / 2 - r, 2 * r, 2 * r); }
      else for(let i = a0; i < a1; i++){ const k = ord[i], x = ((k / rows) | 0) * PX + PX / 2, y = (k % rows) * PX + PX / 2; c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }
      c.fill(); } };
  const stat = offscreen(env);
  for(let x = 0; x < cols; x++) for(let y = 0; y < rows; y++){ const k = x * rows + y; SB[k] = SB[k] > .02 ? Math.min(1, Math.max(0, SB[k] * vis[k] + dith(x, y))) : 0; }
  paint(stat.begin(), SB, SC, 1, false);
  /* ---- the float: a low deck on the left, 0.15 m above the water, its right end at column xE; kept as cells laid over the water ---- */
  const zS0 = phone ? 9.6 : 9.2, zS1 = zS0 + .9, zS = zS0 + .45, sS = F / zS, XE = (cols * (phone ? .46 : .36) - cx) * zS0 / F, DK = .15, stage = [];
  for(let x = 0; x < cols; x++) for(let y = yH + 1; y < rows; y++){ const dy = y - yH, k = x * rows + y; let z = (CAM - DK) * F / dy, Xw = (x - cx) * z / F, m = 0;
    if(z >= zS0 && z <= zS1 && Xw < XE) m = 1;                                                        /* the deck */
    else { z = zS0; Xw = (x - cx) * z / F; const Y = CAM - dy * z / F; if(Xw < XE && Y >= -.02 && Y < DK) m = 2;        /* its front */
      else if(x < cx){ z = XE * F / (x - cx); const Y2 = CAM - dy * z / F; if(z >= zS0 && z <= zS1 && Y2 >= -.02 && Y2 < DK) m = 3; } }   /* its end */
    if(m){ OCC[k] = z; stage.push(k, m, Xw, z); } }
  /* ---- water, lamps and mist, redrawn ten times a second. The sky shows on the water only far out; a gust is a band of finer, brighter ripples ---- */
  const rip = .75 + .2 * D.jitter, lamps = [], Tg = 12, vg = 3.4;
  { const n = phone ? 7 : 17; for(let i = 0; i < n; i++){ const x = Math.round(cols * ((i + S()) / n)); if(Math.abs(x - gx) > cols * (phone ? .16 : .06)) lamps.push({x, b: .6 + .4 * S(), ph: S() * TAU, warm: S() < .25, len: (9 + 17 * S()) / U}); } }
  /* a gust: a front that crosses the water left to right at vg metres a second, every Tg seconds; returns how hard it blows at (X, z) */
  const gust = (Xw, z, t) => { let g = 0; for(let j = 0; j < 2; j++){ const w = Math.floor((t + .2) / Tg) - j, st = w ? .35 + .65 * hash2(w, 5) : 1, s = (-9 + vg * (t + .2 - w * Tg) - Xw - .12 * z) / 7; if(s > 0) g += st * (s < .12 ? s / .12 : Math.exp(-(s - .12) * 1.5)); } return Math.min(1, g); };
  /* reeds in the near left corner: dark blades in front of everything, a little sky on their upper edges */
  const reed = []; { const n = phone ? 16 : 30; for(let i = 0; i < n; i++){ let x = S() * S() * cols * (phone ? .34 : .13), y = rows - 1, a = (S() - .35) * .5; const len = (16 + 30 * S() * (1 - x / (cols * .4))) / U, w = S() < .3 ? 2 : 1, bend = (S() - .2) * .03;
      for(let qo = 0; qo < len; qo++){ a += bend; x += Math.sin(a); y -= Math.cos(a); for(let d = 0; d < (qo > len * .6 ? 1 : w); d++){ const xi = Math.round(x) + d, yi = Math.round(y); if(xi >= 0 && xi < cols && yi > yH + 6 && yi < rows){ OCC[xi * rows + yi] = 1; reed.push(xi * rows + yi, d === 0 && a > .1 ? .2 : .07); } }
        if(qo > len - 5 && w === 2){ const xi = Math.round(x) + 1, yi = Math.round(y); if(xi < cols && yi > yH + 6){ OCC[xi * rows + yi] = 1; reed.push(xi * rows + yi, .12); } } } } }
  /* people with lamps on the far shore, either side of the torii */
  const folk = Array.from({length: phone ? 4 : 7}, (_, i) => ({x: gx + (i % 2 ? 1 : -1) * (5.5 + 3.2 * (i >> 1) + 2 * S()) * sT, ph: S() * TAU, v: .2 + .5 * S()}));
  const FD = new Float32Array(cols), o3 = {X: 0, z: 0};
  const fpos = (f, t) => { const a = f.a + f.om * t; let Xw = f.Xc + f.v * t + f.r * Math.cos(a); o3.X = ((Xw + f.span) % (2 * f.span) + 2 * f.span) % (2 * f.span) - f.span; o3.z = f.z + f.r * Math.sin(a) * .8; return o3; };
  let wq = NaN;                                                                                      /* the tenth of a second the water was last drawn for */
  const water = t => { WB.fill(0); WC.fill(0); if(!(PART & 4)) return; const fl = t * .5;
    for(let x = 0; x < cols; x++){ const tr = TR[x] * 1.25 + 1; for(let y = yH + 1; y < rows; y++){ const k = x * rows + y, dy = y - yH - .5, z = CAM * F / dy, Xw = (x - cx) * z / F, g = gust(Xw, z, t);
      const a = Xw / (.22 + .03 * z), n1 = noise(a * 1.2 + fl * .3, 9 * Math.log(z) + fl * .7 + 2 * noise(a * .5, z * .2 + 4)), n2 = noise(a * 3.1 - fl, 31 * Math.log(z) - fl * 2.2);
      const far = Math.exp(-dy / (hgt * .5)), cr = Math.max(0, n1 - .44) * 1.8;
      let b = LH[x] * far * (.3 + 1.5 * cr * cr + .5 * n2) * (dy < tr ? .3 + .7 * sstep(tr * .5, tr, dy + 2 * n1) : 1) + (.05 * cr * cr + (n2 > .58 ? (n2 - .58) * .5 * (.4 + n1) : 0)) * rip + g * .22 * (n2 > .56 ? 1 : .1) * (.4 + far);
      if(Math.abs(x - gx) < 4.4 * sT && Math.abs(Math.abs(x - gx) - 3.9 * sT) < .8 && y > tyb && y < tyb + tH * .8 && n2 < .6) b *= .25;       /* the torii's posts, upside down */
      WB[k] = b; WC[k] = b > .5 || (g > .2 && n2 > .56) ? 7 : 6; } }
    for(const qo of lamps){ const tw = .8 + .2 * Math.sin(t * 2.3 + qo.ph); for(let j = -1; j < qo.len; j++){ const y = yH + j, f = j < 1 ? 1 : .8 * Math.pow(1 - j / qo.len, .7); if(j > 0 && noise(qo.x * .9, j * .8 - t * 1.4 + qo.ph) < .34 + .2 * j / qo.len) continue;
        const x = qo.x + (j > 1 ? Math.round(1.3 * (noise(j * .5, t * .9 + qo.ph) - .5)) : 0), k = x * rows + y; if(x >= 0 && x < cols){ WB[k] = Math.max(WB[k], qo.b * tw * f); WC[k] = qo.warm ? 15 : 8; } } }
    for(const qo of folk){ const x = Math.round(qo.x + 1.5 * Math.sin(t * .07 * qo.v + qo.ph)), tw = .7 + .25 * noise(t * 1.9 + qo.ph, 5.5); if(x < 1 || x >= cols - 1) continue; WB[x * rows + tyb - 1] = tw; WC[x * rows + tyb - 1] = 16; WB[x * rows + tyb - 2] = .3; WC[x * rows + tyb - 2] = 14; for(let j = 1; j < 5; j++) if(noise(x * .7, j - t * 1.3) > .4){ WB[x * rows + tyb + j] = tw * .55 * (1 - j / 5); WC[x * rows + tyb + j] = 14; } }
    /* mist low on the water, warm where lanterns lie under it */
    FD.fill(0); for(const f of field){ if(f.z < 24) continue; fpos(f, t); const xs = Math.round(cx + o3.X * F / o3.z), w = Math.round(5 / U + 60 / o3.z); for(let d = -w; d <= w; d++){ const x = xs + d; if(x >= 0 && x < cols) FD[x] += .5 * (1 - Math.abs(d) / (w + 1)); } }
    for(let x = 0; x < cols; x++){ const fd = Math.min(1.6, FD[x]); for(let j = -4; j < 6; j++){ const y = yH + j, k = x * rows + y, m = Math.max(0, noise(x * .035 / U + t * .02 + 40, j * .4 + 17) - .42 + .05 * fd) * 1.3 * (1 - Math.abs(j - .5) / 5.5) * (.5 + LH[x] + .25 * fd) * (fd > .45 ? .6 : 1); if(m > WB[k] && WC[k] < 12){ WB[k] = Math.min(fd > .45 ? .3 : .6, m); WC[k] = fd > .45 ? 13 : 9; } } }
    for(let i = 0; i < reed.length; i += 2){ WB[reed[i]] = reed[i + 1]; WC[reed[i]] = 9; }
    for(let i = 0; i < stage.length; i += 4){ const k = stage[i], m = stage[i + 1]; const dr = stage[i + 2] / 1.3 - Math.floor(stage[i + 2] / 1.3); WB[k] = m === 1 ? .4 + .08 * hash2(k, 3) : m === 2 ? (dr < .72 ? .2 - .5 * (dr - .36) * (dr - .36) : 0) : .24; WC[k] = m === 1 ? 11 : 9; } };
  /* ---- the lanterns. A lantern's light: I (0..1) picks the colour from ember to flame; paper kinds: 0 plain, 1 red, 2 green ---- */
  const lp = (k, b, c) => { if(b > Lb[k]){ Lb[k] = b; Lc[k] = c; } };
  const warm = (I, kind) => kind && I < .9 ? 16 + kind * 4 + (I < .3 ? 0 : I < .5 ? 1 : I < .72 ? 2 : 3) : 12 + Math.min(7, (I * 8.2) | 0);
  /* draw one lantern standing on the water at screen (xs, yb = the row of its raft), hs cells tall, seen from distance z: its light on the
     water first, then the box. I: the flame; th: how far it has turned; lean: cells of sideways shift per row (tipping, rocking); gu: gust on it */
  const lantern = (xs, ys, z, hs, I, th, lean, kind, id, t, gu, air) => { const x0 = Math.round(xs), yb = Math.round(ys); if(x0 < -30 || x0 > cols + 30 || yb < 0) return;
    const ws = hs * .79, ph = id * 2.399, lit = I > .03;
    if(lit && !air && (PART & 2)){
      /* the pool of lit water round it */
      const rx = .9 * F / z, ry = Math.max(1, rx * CAM / z * 1.5);
      if(rx >= 1.5) for(let dy = -Math.ceil(ry); dy <= Math.ceil(ry * 1.6); dy++){ const y = yb + 1 + dy; if(y <= yH || y >= rows) continue; for(let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++){ const x = x0 + dx; if(x < 0 || x >= cols) continue;
        const k = x * rows + y; if(OCC[k] < z) continue; const d = (dx / rx) ** 2 + (dy / (dy < 0 ? ry : ry * 1.6)) ** 2; if(d > 1) continue;
        const e = I * .4 / (1 + 9 * d) * (.25 + 1.3 * noise(x * .45 + ph, y * 1.3 - t * 1.2)) - .05; if(e > 0) lp(k, e, warm(e * 1.5, kind)); } }
      /* the strip of light toward the camera: it wavers, and the ripples cut it into dashes; a gust cuts it shorter and finer */
      const Lr = Math.min(phone ? BOT - 3 - yb : 1e9, Math.max(2, hs * (1.8 + 1.2 * rip) + 2)), wr = Math.max(1, ws * (hs < 5.5 ? 1 : 1.38)), thr = .36 + .08 * rip + .2 * gu;
      for(let j = 1; j <= Lr; j++){ const y = yb + 1 + j; if(y >= rows) break; const qo = j / Lr, gn = noise(x0 * .21 + ph, y * .7 - t * (1.1 + .8 * gu)); if(gn < thr * (.6 + .6 * qo)) continue;
        const sh = (.4 + hs * .13) * (1 + 1.5 * gu) * (.25 + 1.2 * qo) * Math.sin(j * .7 - t * 2.1 + ph) - lean * j * .3, b = I * .8 * Math.pow(1 - qo, .9) * (.35 + 1.1 * gn), w2 = wr * (.35 + 1.25 * noise(y * .9 + ph, t * 1.3 + ph)) * (1 - .25 * qo), xa = Math.round(x0 + sh - w2 / 2), xb = Math.max(xa, Math.round(x0 + sh + w2 / 2) - 1);
        for(let x = xa; x <= xb; x++){ if(x < 0 || x >= cols) continue; const k = x * rows + y; if(OCC[k] < z) continue; const e = b * (x === xa || x === xb ? .6 : 1); lp(k, e, warm(e * .8, kind)); } } }
    if(!(PART & 1)) return;
    const st = (x, y, b, c) => { if(x < 0 || x >= cols || y < 0 || y >= rows) return; const k = x * rows + y; if(!air && OCC[k] < z) return; Lb[k] = b; Lc[k] = c; };
    const far = Math.min(1, .5 + 3.5 / (1 + z * .06) / 3.5 + .0), Id = lit ? I : 0;
    if(hs < 1.25){ st(x0, yb, lit ? (.4 + .5 * I) * (.55 + .45 * Math.min(1, hs)) * far : .07, lit ? warm(I * .8, kind) : 11); return; }
    if(hs < 2.6){ st(x0, yb, lit ? .5 + .5 * I : .1, lit ? warm(I, kind) : 11); st(x0, yb - 1, lit ? .34 + .4 * I : .08, lit ? warm(I * .7, kind) : 11); if(ws > 1.5){ st(x0 + 1, yb, lit ? .42 + .4 * I : .1, lit ? warm(I * .85, kind) : 11); st(x0 + 1, yb - 1, lit ? .28 + .32 * I : .08, lit ? warm(I * .6, kind) : 11); } return; }
    const H = Math.round(hs), big = hs >= 8.5, tq = Math.PI / 4 + .34 * Math.sin(th), c0 = Math.cos(tq), s0 = Math.sin(tq), wA = hs < 5.5 ? ws : ws * c0, wB = hs < 5.5 ? 0 : ws * s0, Wt = Math.max(2, Math.round(wA + wB)), xL = x0 - (Wt >> 1), xc = wA * Wt / (wA + wB);
    const gl = lit ? .12 * gu : 0, vf = .3 + .05 * Math.sin(t * 5.1 + ph * 3);
    /* the raft */
    for(let d = -1 - (big ? 1 : 0); d <= Wt + (big ? 1 : 0); d++){ const e = Math.abs((d + .5) / Wt - .5) * 2; st(xL + d, yb, lit ? I * (e > 1 ? .34 : .6) : .16, lit ? 13 + (e > 1 ? 0 : 2) : 10); }
    for(let r = 0; r < H; r++){ const y = yb - 1 - r, v = (r + .5) / H, off = Math.round(lean * r);
      for(let d = 0; d < Wt; d++){ const inA = d + .5 < xc || wB < .6, u = inA ? (d + .5) / Math.max(.5, xc) : (d + .5 - xc) / Math.max(.5, Wt - xc);
        const post = big && (d === 0 || d === Wt - 1 || (wB > 1.6 && wA > 1.6 && d === Math.round(xc - .5))), rim = r === H - 1 || (big && r === 0);
        const q2 = (u - .5 - gl * 2) ** 2 + ((v - vf) * 1.27) ** 2;
        let L = (.36 + .64 / (1 + 3 * q2)) * (inA ? 1 : .84);
        if(big && Math.abs(u - .56) * (inA ? wA : wB) < .55 && v > .42 && v < .9 && hash2(id * 31 + r, inA ? 7 : 8) < .6) L *= .45;       /* brush strokes on the front */
        if(post) L *= .16; else if(rim) L *= .42; else if(!big && (d === 0 || d === Wt - 1) && Wt > 2) L *= .72;
        const e = Math.min(1, L * (.52 + .52 * Id)); st(xL + d + off, y, lit ? .16 + .84 * L * Math.sqrt(Id) : post ? .08 : .24 + .1 * L, lit ? (post || (rim && r === 0) ? 12 + Math.min(2, (e * 9) | 0) : warm(e, kind)) : 11); } }
    /* the open top, seen a little from above: the lit inside of the far wall */
    if(lit && hs >= 6){ const ct = Math.max(1, Math.round(Wt * .9 * (CAM - .38) / z)), off = Math.round(lean * H); for(let r = 0; r < ct; r++) for(let d = 1 + r; d < Wt - 1 - r; d++) st(xL + d + off, yb - 1 - H - r, .3 + .7 * I * (.95 - .15 * r), warm(I * (.86 - .12 * r), kind)); }
    /* a breath of lit air round the paper */
    if(lit) for(let r = -1; r <= H + 1; r++){ const y = yb - 1 - r; if(y < 0 || y >= rows) continue; const e = I * .2 * (1 - Math.abs(r / H - .35)); for(const x of [xL - 1 + Math.round(lean * r), xL + Wt + Math.round(lean * r)]) if(x >= 0 && x < cols && e > .05 && (air || OCC[x * rows + y] >= z)) lp(x * rows + y, e, 13); } };
  /* each flame on its own clock: a slow wander, a quick tremble, and the gust on top */
  const flame = (id, t, gu) => cl((.8 + .26 * noise(t * 1.7 + id * 13.7, id * 3.1) + .06 * Math.sin(t * 7.3 + id * 5.1)) * (1 - gu * (.42 + .3 * Math.sin(t * 9.4 + id))), .12, 1);
  const zb = phone ? 14 : 11.8, sb = F / zb, Ts = 2.7, vb = .95, Tb = 74, bHw = cols / 2 / sb + 4, bT0 = (bHw - (cols * (phone ? .62 : .545) - cx) / sb) / vb;
  /* ---- the far groups: lanterns that drift to the right in loose groups, each group turning slowly about its middle ---- */
  const NL = Math.round(D.nPart * .14), KM = phone ? 4 : 8, KS = Math.min(KM, Math.round(NL * .3)), Tl = phone ? 30 : 16, LAP = KM * Tl, field = [], drift = (.035 + .075 * D.trendK) * sp;
  { let left = NL - KS, j = 0; const g0 = S();
    while(left > 0){ const u = (j * .618 + g0) % 1, z = phone ? 20 * Math.exp(Math.pow(u, .8) * Math.log(7.5)) : 15.5 * Math.exp(Math.pow(u, .8) * Math.log(8.6)), m = Math.min(left, NL < 40 ? 1 : 1 + Math.floor(S() * S() * (z > 20 ? 9 : 5))), span = (cols / 2 + 16) * z / F + 2, stay = z < 22, Xc = stay ? XE * z / zS0 + 1.4 + S() * (cols / 2 * z / F - XE * z / zS0 - 2) : (S() * 2 - 1) * (span - 2) * .96, rc = .3 + .34 * Math.sqrt(m) + z * .012, v = stay ? 0 : drift * (.7 + .6 * S()), om = (S() < .5 ? -1 : 1) * (.02 + .05 * S());
      for(let i = 0; i < m; i++){ const r = rc * Math.sqrt(S()), a = S() * TAU; field.push({id: field.length + 20, z, Xc, span, v, om, r, a, th: S() * TAU, w: (S() < .5 ? -1 : 1) * (.04 + .14 * S()), kind: S() < .82 ? 0 : S() < .6 ? 1 : 2}); }
      left -= m; j++; }
    field.sort((a, b) => b.z - a.z); }
  /* ---- the lanterns let go from the float: slot j is let go every LAP seconds; age < 0 = still in the hands ---- */
  const zN = j => phone ? 3.3 + .5 * hash2(j, 31) : 2.95 + 1.5 * hash2(j, 31), born = (j, lap) => (lap * KM + j) * Tl - 2.6 + 3 * (hash2(j * 7 + 3, lap) - .5);
  const lapOf = (j, t) => { let lap = Math.floor((t + 9.1 - j * Tl) / LAP); if(t - born(j, lap) < -5.2) lap--; return lap; };
  const o1 = {X: 0, z: 0}, afloat = (j, a, o) => { const v = .1 * (.85 + .3 * hash2(j, 33)), u = v * Math.max(0, a - 1.5) + .5 * (1 - Math.exp(-a / 1.4)), zn = zN(j);
    o.X = XE + .32 + (cols / 2 * zn / F + 1.5 - XE - .32) / 9.5 * u; o.z = zn + (zS - .1 - zn) * (1 - sstep(.3, 6, u)); return o; };
  let tipJ = -1, tipLap = 0, tipA = 1e9;                                                            /* the lantern the gust tips while the page is first watched: the one nearest 37 s afloat at that moment */
  for(let i = 0; i < KS; i++){ const j = Math.floor(i * KM / KS), lap = lapOf(j, 3.3), a = 3.3 - born(j, lap); if(Math.abs(a - 37) < Math.abs(tipA - 37)){ tipJ = j; tipLap = lap; tipA = a; } }
  if(Math.abs(tipA - 37) > 14) tipJ = -1; else { afloat(tipJ, tipA, o1); tipA += (o1.X + .12 * o1.z + 9) / vg - .2 + .2 - 3.3; }
  const slotAt = (j, t) => { const lap = lapOf(j, t), a = t - born(j, lap); return {a, tip: j === tipJ && lap === tipLap ? tipA : hash2(j * 13 + 1, lap + 9) < .16 ? 30 + 30 * hash2(j, lap + 77) : 1e9}; };
  const near = Array.from({length: KS}, (_, i) => Math.floor(i * KM / KS)).map(j => ({j, id: j, kind: [0, 0, 0, 1, 0, 0, 2, 0][(j + (p.seed & 7)) & 7], th: hash2(j, 37) * TAU, w: (hash2(j, 38) < .5 ? -1 : 1) * (.06 + .12 * hash2(j, 39)), z: 0}));
  /* ---- people and the boat: bodies are tapered capsules in a plane facing the camera (metres: x to the right, y up from the water), each
     of one stuff: 0 dark cloth and hair, 1 pale cloth, 2 skin, 3 wood. Dark cloth is a silhouette (it shows against lit water and against
     pale cloth); pale cloth and skin are dim in the dusk; all of it is warm on the side a lantern is on ---- */
  const PA = new Float32Array(7 * 96), LT = new Float32Array(4 * 12), era = new Int32Array(N >> 2); let np = 0, nl = 0, ne = 0;
  const part = (x1, y1, r1, x2, y2, r2, m) => { const o = np++ * 7; PA[o] = x1; PA[o + 1] = y1; PA[o + 2] = r1; PA[o + 3] = x2; PA[o + 4] = y2; PA[o + 5] = r2; PA[o + 6] = m; };
  const light = (x, y, z, I) => { if(nl < 12){ const o = nl++ * 4; LT[o] = x; LT[o + 1] = y; LT[o + 2] = z; LT[o + 3] = I; } };
  /* an arm of two bones from shoulder to hand, the elbow dropping; L = the length of one bone */
  const arm = (sx, sy, hx, hy, L, r, m) => { const dx = hx - sx, dy = hy - sy, d = Math.min(2 * L - .001, Math.hypot(dx, dy)) || .01, h = Math.sqrt(L * L - d * d / 4), sg = dx < 0 ? -1 : 1, ex = sx + dx / 2 * (d / Math.hypot(dx, dy)) - dy / d * h * sg * .6, ey = sy + dy / 2 - Math.abs(dx) / d * h;
    part(sx, sy, r * 1.15, ex, ey, r, m); part(ex, ey, r, hx, hy, r * .8, m); part(hx, hy, r * .9, hx, hy, r * .9, 2); };
  const fig = (sc, zf) => { for(let i = 0; i < np; i++){ const o = i * 7, x1 = PA[o], y1 = PA[o + 1], r1 = PA[o + 2], ddx = PA[o + 3] - x1, ddy = PA[o + 4] - y1, r2 = PA[o + 5], m = PA[o + 6], L2 = ddx * ddx + ddy * ddy || 1e-9, rm = Math.max(r1, r2);
      const xa = Math.max(0, Math.floor(cx + (Math.min(x1, x1 + ddx) - rm) * sc)), xb = Math.min(cols - 1, Math.ceil(cx + (Math.max(x1, x1 + ddx) + rm) * sc)), ya = Math.max(0, Math.floor(yH + (CAM - Math.max(y1, y1 + ddy) - rm) * sc)), yb = Math.min(rows - 1, Math.ceil(yH + (CAM - Math.min(y1, y1 + ddy) + rm) * sc)), thin = rm * sc < .75;
      for(let x = xa; x <= xb; x++) for(let y = ya; y <= yb; y++){ const px = (x - cx) / sc, py = CAM - (y - yH) / sc, u = cl(((px - x1) * ddx + (py - y1) * ddy) / L2, 0, 1), qox = px - x1 - ddx * u, qy = py - y1 - ddy * u, r = thin ? .55 / sc : r1 + (r2 - r1) * u, d2 = qox * qox + qy * qy; if(d2 > r * r) continue;
        const k = x * rows + y; if(OCC[k] < zf) continue; const nx = qox / r, ny = qy / r, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)); let e = 0;
        for(let j = 0; j < nl * 4; j += 4){ const lx = LT[j] - px, ly = LT[j + 1] - py, lz = LT[j + 2], d = lx * lx + ly * ly + lz * lz, df = (nx * lx + ny * ly + nz * lz) / Math.sqrt(d); if(df > -.3) e += LT[j + 3] * (.25 + .75 * Math.max(0, df)) * .2 / (.1 + d + .25 * Math.sqrt(d)); }
        e = Math.min(.66, e * (m === 0 ? .4 : m === 3 ? .7 : 1) * (.85 + .3 * hash2(x, y)));
        const am = m === 1 ? .27 + .12 * nz + .08 * ny : m === 2 ? .36 + .1 * nz : m === 3 ? .3 : .3 + .08 * ny;
        if(e > am * .7 && e > .08){ Lb[k] = .1 + .9 * e; Lc[k] = warm(e * .95, 0); } else { Lb[k] = am; Lc[k] = m === 1 ? 11 : m === 2 ? 28 : m === 3 ? 11 : 29; }
        if(y <= yH && ne < era.length) era[ne++] = k; } } np = 0; };
  /* a person standing on the float, facing us: H tall (the head is H / 7.5); kind 0 shirt and trousers, 1 a long pale robe, 2 all dark.
     hold > 0: both hands hold a lantern in front of the waist; pt: an arm raised to point (the child) */
  const Y0 = DK, zP = zS0 - .02;
  const stand = (X_, H, kind, hold, pt, sway) => { const hip = Y0 + .5 * H, sh = Y0 + .81 * H, xs = X_ + sway * H, top = kind === 2 ? 0 : 1;
    if(kind === 1) part(X_, Y0 + .03 * H, .075 * H, X_, hip, .1 * H, 1);
    else { part(X_ - .075 * H, Y0 + .02 * H, .03 * H, X_ - .045 * H, hip, .052 * H, 0); part(X_ + .075 * H, Y0 + .02 * H, .03 * H, X_ + .045 * H, hip, .052 * H, 0); }
    part(X_, hip, .09 * H, xs, sh - .09 * H, .1 * H, top); part(xs - .075 * H, sh - .045 * H, .05 * H, xs + .075 * H, sh - .045 * H, .05 * H, top);
    part(xs, sh, .028 * H, xs, sh + .04 * H, .028 * H, 2); part(xs, Y0 + .925 * H, .064 * H, xs, Y0 + .935 * H, .064 * H, 2); part(xs - .01 * H, Y0 + .965 * H, .055 * H, xs + .01 * H, Y0 + .97 * H, .055 * H, 0);
    const hy = hold ? Y0 + .6 * H : Y0 + .45 * H, hx = hold ? .05 * H : .13 * H;
    arm(xs - .125 * H, sh - .05 * H, X_ - hx, hy, .17 * H, .027 * H, top);
    if(pt > 0) arm(xs + .125 * H, sh - .05 * H, xs + (.13 + .2 * pt) * H, hy + .42 * pt * H, .17 * H, .027 * H, top); else arm(xs + .125 * H, sh - .05 * H, X_ + hx, hy, .17 * H, .027 * H, top); };
  /* who stands where, right to left from the float's end: [metres left of the end, height, kind, holds a lantern] */
  const CREW = [[1.05, 1.13, 0, 0], [1.85, 1.7, 0, 1], [2.75, 1.6, 1, 1], [3.6, 1.74, 2, 0], [4.45, 1.66, 0, 1], [5.5, 1.6, 1, 0]];
  /* the kneeling one's lantern while it is in the hands (a = seconds before it is let go): taken up dark, lit, lowered to the water */
  const held = (a, o) => { const k = sstep(-3.3, -1, a); o.X = XE + .04 + .28 * k; o.Y = (Y0 + .42) * (1 - k); o.I = sstep(-4.3, -3.5, a) * (1 + .35 * Math.exp(-(((a + 3.9) / .22) ** 2))); return o; };
  const o2 = {X: 0, Y: 0, I: 0};
  const people = (t, hl) => { const sc = sS, hs = .38 * sc;
    for(let i = 0; i < CREW.length; i++){ const c = CREW[i]; if(c[3]) light(XE - c[0], Y0 + .56 * c[1] + .1, .35, .6 + .15 * noise(t * 1.3 + i * 7, 8.5)); }
    for(let i = CREW.length - 1; i >= 0; i--){ const c = CREW[i], sway = .012 * Math.sin(t * .45 + i * 2.1) + .02 * (sstep(.5, .8, noise(t * .09 + i * 5, 4.5)) - .5), pt = i === 0 && hl ? sstep(.4, 1.4, hl.a) * (1 - sstep(4, 6, hl.a)) : 0;
      stand(XE - c[0], c[1], c[2], c[3], pt, sway); }
    /* squatting at the end, side on: shin, thigh, the body bending down to the water as the lantern is lowered, the arms on the lantern */
    const a = hl ? hl.a : 9, lam = .38 + .85 * sstep(-3.2, -1, a) * (1 - sstep(.6, 2.6, a)), hx = XE - .5, hy = Y0 + .34, shx = hx + .5 * Math.sin(lam), shy = hy + .5 * Math.cos(lam), hd = lam + .3, hdx = shx + .2 * Math.sin(hd), hdy = shy + .2 * Math.cos(hd);
    part(XE - .36, Y0 + .04, .05, XE - .22, Y0 + .04, .04, 0); part(XE - .32, Y0 + .05, .05, XE - .1, Y0 + .44, .06, 0); part(XE - .1, Y0 + .44, .07, hx, hy, .1, 0);
    part(hx, hy, .11, shx, shy, .115, 1); part(shx + .08 * Math.sin(hd), shy + .08 * Math.cos(hd), .035, hdx, hdy, .1, 2); part(hdx - .04, hdy + .06, .075, hdx - .05, hdy + .05, .075, 0);
    let gxh = XE - .08, gyh = Y0 + .5; if(hl && hl.a < 1.2){ const rl = sstep(0, 1.2, hl.a); gxh = hl.hX - .12 + (gxh - hl.hX + .12) * rl; gyh = hl.hY + .22 + (gyh - hl.hY - .22) * rl; }
    arm(shx + .03, shy - .06, gxh, gyh, .29, .05, 1);
    fig(sc, zP);
    for(let i = 0; i < CREW.length; i++){ const c = CREW[i]; if(c[3]) lantern(cx + (XE - c[0]) * sc, yH + (CAM - Y0 - .41 * c[1]) * sc, zS, hs, flame(90 + i, t, 0), 1 + i, 0, 0, 90 + i, t, 0, true); } };
  /* the float's deck where the lanterns light it */
  const deck = () => { for(let i = 0; i < stage.length; i += 4){ if(stage[i + 1] !== 1) continue; const k = stage[i], X_ = stage[i + 2]; let e = 0; for(let j = 0; j < nl * 4; j += 4){ const dx = LT[j] - X_, dy = LT[j + 1] - Y0; e += LT[j + 3] * .08 * dy / Math.pow(.05 + dx * dx + dy * dy, 1.5); }
      e = Math.min(.6, e) * (.6 + .6 * hash2(k, 5)); if(e > Lb[k]){ Lb[k] = e; Lc[k] = warm(e * .8, 0); } } };
  /* the rowing boat: zb metres out, moving left; a stroke every Ts seconds, the hull surging on the pull and slowing on the reach */
  const bX = tau => bHw - vb * tau + .15 * Math.sin(TAU * (tau / Ts + .08));
  const boat = t => { const tau = ((t + bT0) % Tb + Tb) % Tb, Xb = bX(tau); if(Xb < -bHw - 3) return 1e9; const phi = tau / Ts - Math.floor(tau / Ts), dr = phi < .33 ? phi / .33 : 1 - (phi - .33) / .67, pull = phi < .33 ? easeS(phi / .33) : 1 - easeS((phi - .33) / .67);
    const yw = Math.round(yH + CAM * sb), x0 = Math.round(cx + Xb * sb), hl = 1.8 * sb, lI = .7 + .2 * noise(t * 2.1, 3.5), bowX = Xb - 1.55, bowY = .66;
    /* broken water behind the stern, and the rings each stroke leaves */
    for(let d = hl; d < 24 * sb; d++){ const x = x0 + Math.round(d), f = Math.exp(-d / (9 * sb)); if(x < 0 || x >= cols) continue; for(let r = -1; r <= 1 + d / (14 * sb); r++){ const n = noise(d * .33 + tau * vb * sb * .33, r * 1.7 + t * .5), y = yw + r; if(n > .5 && y < rows) lp(x * rows + y, .5 * f * (n - .3) * 2, 7); } }
    for(let i = 0; i < 6; i++){ const st = (Math.floor(tau / Ts) - i) * Ts, ag = tau - st - .3 * Ts; if(ag < 0 || st < 0) continue; const xp = Math.round(cx + (bX(st + .15 * Ts) - .5) * sb), w = 1 + ag * .9, f = .5 * Math.exp(-ag / 3);
      for(let d = -Math.round(w); d <= Math.round(w); d++){ if(ag > 1.6 && Math.abs(d) < w - 1.2) continue; for(const y of [yw + 2, yw - 1]){ const x = xp + d; if(x >= 0 && x < cols && y < rows) lp(x * rows + y, f * (y > yw ? 1 : .6), 7); } } }
    /* the hull, bow to the left */
    for(let d = -Math.round(hl); d <= Math.round(hl); d++){ const u = d / hl, top = .3 + .15 * Math.pow(Math.abs(u), 2.2) + (u < 0 ? .08 * u * u : 0), bot = u < -.72 ? .3 * Math.pow((-u - .72) / .28, 1.4) : u > .93 ? .1 * (u - .93) / .07 : 0, x = x0 + d; if(x < 0 || x >= cols) continue;
      const y1 = Math.round(yw - top * sb), y2 = Math.round(yw - bot * sb); for(let y = y1; y <= y2; y++){ const k = x * rows + y, e = Math.min(.5, lI * .03 / (.05 + ((d / sb + 1.45) ** 2))) * (y === y1 ? 1 : .6); Lb[k] = e > .14 ? e : y === y1 ? .56 : .24; Lc[k] = e > .14 ? warm(e, 0) : y === y1 ? 11 : 29; if(y <= yH && ne < era.length) era[ne++] = k; }
      const n = noise(d * .4 + tau * 2, 6.5); if(n > .42) lp(x * rows + yw + 1, (.16 + .3 * (u < -.6 ? 1 : .3)) * n * 1.6, 7); }
    /* the rower, back to the bow: reaches toward the stern, pulls, and swings back; lit from behind by the bow lamp */
    const la = .5 - .85 * pull, sx = Xb + .15, shx = sx + .55 * Math.sin(la), shy = .3 + .55 * Math.cos(la), hdx = sx + .78 * Math.sin(la * .8), hdy = .3 + .78 * Math.cos(la * .8), hx = sx + .68 - .45 * pull, hy = .52 + .06 * pull;
    nl = 0; light(bowX + .1, bowY + .1, .2, lI * 3);
    part(sx + .55, .34, .06, sx, .3, .1, 0); part(sx, .3, .12, shx, shy, .13, 1); part(shx, shy + .1, .04, hdx, hdy, .1, 2); part(hdx - .03, hdy + .05, .08, hdx - .05, hdy + .04, .08, 0); arm(shx, shy - .05, hx, hy, .3, .05, 1);
    /* the near oar: from the hands through the gunwale to the blade; the blade is in the water on the pull */
    const ox = sx + .42, oy = .36, ang = -.62 + 1.2 * pull, bx = ox - 1.5 * Math.sin(ang) * -1 * -1, by = phi < .33 ? -.04 : .16 * Math.sin(Math.PI * (phi - .33) / .67) + .02;
    part(hx, hy, .014, ox, oy, .014, 3); part(ox, oy, .014, ox + 1.45 * Math.sin(ang), by, .014, 3); part(ox + 1.2 * Math.sin(ang), oy + (by - oy) * .83, .05, ox + 1.45 * Math.sin(ang), by, .05, 3);
    fig(sb, zb);
    if(phi < .4){ const xs = Math.round(cx + (ox + 1.45 * Math.sin(ang)) * sb); for(let d = -1; d <= 1; d++) if(xs + d >= 0 && xs + d < cols) lp((xs + d) * rows + yw + 1, .55 * (1 - phi / .4), 7); }
    /* the lamp on the bow, and its strip on the water */
    const xl = Math.round(cx + bowX * sb), yl = Math.round(yw - bowY * sb), lh = Math.max(2, Math.round(.3 * sb));
    for(let r = 0; r < lh; r++) for(let d = 0; d < 2; d++){ const x = xl + d, y = yl - r; if(x < 0 || x >= cols) continue; const k = x * rows + y, e = lI * (r === 0 ? .9 : .7); Lb[k] = .3 + .7 * e; Lc[k] = warm(e, 0); if(y <= yH && ne < era.length) era[ne++] = k; }
    for(let j = 2; j < 3 + 7 * rip; j++){ const y = yw + j; if(y >= rows) break; const n = noise(xl * .3, y * .8 - t * 1.2); if(n < .42) continue; const x = xl + Math.round(Math.sin(j * .8 - t * 2 ) * j * .12); if(x >= 0 && x < cols) lp(x * rows + y, lI * .6 * (1 - j / (3 + 7 * rip)) * (.5 + n), 14); }
    return Xb; };
  return tm => { const t = (tm - 14) * sp; ne = 0; nl = 0;
    const wj = Math.floor(t * 10); if(wj !== wq){ wq = wj; water(wj / 10); } Lb.set(WB); Lc.set(WC);
    let Xb = 1e9, done = !(PART & 8);
    for(const f of field){ if(!done && f.z < zb){ Xb = boat(t); done = true; }
      fpos(f, t); const Xw = o3.X, z = o3.z;
      const gu = gust(Xw, z, t), s = F / z, wk = Xw > Xb && Xw - Xb < 22 && Math.abs(z - zb) < 4.5 ? Math.exp(-(Xw - Xb) / 6) : 0;
      lantern(cx + Xw * s, yH + CAM * s, z, .38 * s, flame(f.id, t, gu), f.th + f.w * t, (gu * .05 + wk * .22) * Math.sin(t * 3.6 + f.id), f.kind, f.id, t, Math.min(1, gu + wk)); }
    if(!done) boat(t);
    let hl = null; nl = 0;
    for(const qo of near){ const sl = slotAt(qo.j, t); qo.a = sl.a; qo.tip = sl.tip; qo.Y = 0; qo.I = 1;
      if(sl.a >= 0){ afloat(qo.j, sl.a, o1); qo.X = o1.X; qo.z = o1.z; if(sl.a < 3) hl = qo; } else { held(sl.a, o2); qo.X = o2.X; qo.Y = o2.Y; qo.I = o2.I; qo.z = zS - .1; hl = qo; }
      if(hl === qo){ qo.hX = qo.X; qo.hY = qo.Y; } }
    near.sort((a, b) => b.z - a.z || a.j - b.j);
    for(const qo of near){ const d = qo.a - qo.tip; qo.gu = gust(qo.X, qo.z, t); let I = flame(qo.id, t, qo.gu) * qo.I, lean = qo.a < 0 ? 0 : qo.gu * .06 * Math.sin(t * 3.1 + qo.id);
      if(d > 0){ lean = .5 * sstep(0, 1.3, d) * (1 - .35 * sstep(2, 5, d)); I = d < 1 ? Math.min(1, I + .5 * d) : d < 1.5 ? (1 - (d - 1) / .5) : d < 3 ? .1 * (1 - (d - 1.5) / 1.5) : 0; }
      qo.F = I; qo.ln = lean; if(I > .05 && qo.z > zS - 2.6 && Math.abs(qo.X - XE) < 3) light(qo.X, qo.Y + .2, zS - .1 - qo.z + .35, I); }
    if(PART & 8){ people(t, hl); deck(); }
    for(const qo of near) lantern(cx + qo.X * F / qo.z, yH + (CAM - qo.Y) * F / qo.z, qo.z, .38 * F / qo.z, qo.F, qo.th + qo.w * Math.max(0, qo.a), qo.ln, qo.kind, qo.id, t, qo.gu, qo.a < -1);
    for(let k = 0; k < N; k++){ const b = Lb[k]; if(b > .02) Lb[k] = Math.max(0, Math.min(1, b * vis[k]) + dith((k / rows) | 0, k % rows)); }
    stat.blit();
    if(ne){ ax.globalCompositeOperation = 'destination-out'; ax.fillStyle = '#000'; ax.beginPath(); for(let i = 0; i < ne; i++){ const k = era[i]; ax.rect(((k / rows) | 0) * PX, (k % rows) * PX, PX, PX); } ax.fill(); ax.globalCompositeOperation = 'source-over'; }
    paint(ax, Lb, Lc, 1, true);
  };
}
/* ================= library =================
   id, source piece (ascii.rest slug, credited in the caption), cell style, factory, and the count the caption reports (the particle budget the
   template actually spends). Names and captions live in web/i18n.js under art.name.NN / art.legend.NN / art.enc.NN (and art.legendS.NN, the legend for
   narrow screens, where a piece draws fewer items there).
   split: true marks the pieces whose data elements are drawn in the two interface colours (blue = Claude Code, amber = Codex), so the page
   shows the split line under them; the others carry no split and the line is hidden. */
const TPL = [
  {id: 1, style: 'sq', cell: 4, make: tTerrain, n: () => Math.round(D.nPart * .05)},
  {id: 2, split: true, style: 'sq', cell: 4, make: tTorus, n: () => Math.round(D.nPart * 1.5)},
  {id: 3, style: 'dot', cell: 4, make: tFlow, n: () => Math.round(150 - 90 * Math.min(1, D.nPart / 1100))},
  {id: 4, style: 'sq', cell: 4, make: tRipple, n: () => 40 + Math.round(.3 * Math.min(1500, D.nPart))},
  {id: 5, style: 'sq', cell: 4, make: tRoad, n: () => Math.min(9, Math.round(D.nPart / 120))},
  {id: 6, style: 'sq', cell: 4, make: tTopo, n: () => Math.round(40 + 60 * Math.pow(Math.min(1, D.nPart / 1100), .6))},
  {id: 7, style: 'dot', cell: 4, make: tPlanet, n: () => 3600 + Math.round(D.nPart * 3.5)},
  {id: 8, style: 'dot', cell: 4, make: tGalaxy, n: () => Math.round(D.nPart * .25)},
  {id: 10, src: 'jellyfish', split: true, style: 'dot', cell: 4, make: tJelly, n: () => Math.round(D.nPart * .3)},
  {id: 11, src: 'aquarium', split: true, style: 'dot', cell: 4, make: tFish, n: () => Math.round(D.nPart * .08)},
  {id: 12, src: 'whale', split: true, style: 'dot', cell: 4, make: tWhale, n: () => Math.round(D.nPart * .1)},
  {id: 13, src: 'starlings', style: 'dot', cell: 4, make: tFlock, n: () => 2400 + 3 * Math.min(1400, D.nPart)},
  {id: 14, src: 'fireflies', style: 'dot', cell: 4, make: tFly, n: () => Math.round(D.nPart * .11)},
  {id: 15, src: 'snowfall', style: 'dot', cell: 4, make: tSnow, n: () => Math.min(3600, Math.max(500, Math.round(D.nPart * 2.4)))},
  {id: 16, src: 'sea-swell', split: true, style: 'sq', cell: 4, make: tSwell, n: () => Math.min(40, Math.round(D.nPart * .03))},
  {id: 17, src: 'pond-ripples', style: 'sq', cell: 4, make: tPond, n: () => 40 + Math.round(.4 * Math.min(1500, D.nPart))},
  {id: 18, src: 'black-hole', split: true, style: 'dot', cell: 4, make: tHole, n: () => Math.round(D.nPart * .12)},
  {id: 19, src: 'moon-phases', style: 'dot', cell: 4, make: tMoon, n: () => Math.round(D.nPart * .2)},
  {id: 20, src: 'lantern-lake', style: 'dot', cell: 4, make: tLantern, n: () => Math.round(D.nPart * .14)}
];
const BY_ID = new Map(TPL.map(t => [t.id, t])), DIM = .8;
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
  /* panels cover the canvas except at the end of the page, where the band under the caption is open: keep the art a fifth dimmer until then */
  const dim = () => { const d = document.documentElement.scrollHeight - innerHeight - scrollY; cv.style.opacity = (DIM + (1 - DIM) * clamp01(1 - d / (innerHeight * .3))).toFixed(2); };
  addEventListener('scroll', dim, {passive: true}); addEventListener('resize', dim); dim();
  function layout(){ draw = null; const W = cv.clientWidth, H = cv.clientHeight; if(!W || !H) return;
    /* very large canvases: one device pixel per CSS pixel above three million CSS pixels, and a coarser grid above 150,000 cells, so the cost and
       the memory of a frame stay bounded on 4K and ultra-wide screens */
    const dpr = W * H > 3e6 ? 1 : Math.min(devicePixelRatio || 1, 2); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    let cell = t.cell || P; while(Math.floor(W / cell) * Math.floor(H / cell) > 150000) cell++;
    env = {cv, ax, W, H, dpr, cols: Math.floor(W / cell), rows: Math.floor(H / cell), P: cell, phone: W < 640};
    /* a canvas too small for a scene (a phone on its side, a very short window): no art, rather than a piece working outside the sizes it was built for */
    if(env.cols < 60 || env.rows < 48){ draw = () => {}; return; }
    D = data; nT = data.curve.length;
    try{ draw = t.make(env, {D: data, p: pr, rnd: mulberry(pr.ymd)}); }catch(e){ broken = true; console.error('art', id, e); } }      /* particles: own stream, so data changes never move the camera */
  return {id, auto, src: t.src || '', n: t.n(), split: !!t.split, ymd: pr.ymd,
    draw(tm){ if(broken) return; if(!draw) layout(); if(!draw) return;
      ax.setTransform(env.dpr, 0, 0, env.dpr, 0, 0); ax.clearRect(0, 0, env.W, env.H);
      try{ draw(tm); }catch(e){ broken = true; console.error('art', id, e); } },
    relayout(){ draw = null; }};
}
window.GLASSBOX_ART = {ENABLED, create, pick: date => pickDay(dayOf(date))};
})();
