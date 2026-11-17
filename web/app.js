/* glassbox front end core: i18n, data normalisation, formatters, shared components, background, router.
   Reads the page data only (glassbox.page/1, schema/CONTRACT.md §2). Every key may be missing or null. */
(function(){
'use strict';
const G = window.GLASSBOX_APP = {pages: {}};
const Q = new URLSearchParams(location.search);
const FROZEN = Q.has('t') && isFinite(parseFloat(Q.get('t'))) ? parseFloat(Q.get('t')) : null;
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
G.STATIC = FROZEN !== null || REDUCE;
const $ = G.$ = id => document.getElementById(id);

/* ------------------------------------------------------------------ i18n */
const DICT = window.GLASSBOX_I18N || {};
const LANGS = ['zh', 'ja', 'en'], LOCALE = {zh: 'zh-CN', ja: 'ja-JP', en: 'en-US'};
const missing = window.GLASSBOX_I18N_MISSING = new Set();
function store(k, v){ try{ if(v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); }catch(e){ return null; } return null; }
function pickLang(){
  const q = (Q.get('lang') || '').toLowerCase();
  if(LANGS.includes(q)){ store('gb.lang', q); return q; }
  const s = store('gb.lang');
  if(LANGS.includes(s)) return s;
  for(const l of (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''])){
    const p = String(l).toLowerCase().slice(0, 2);
    if(LANGS.includes(p)) return p;
  }
  return 'en';
}
G.lang = pickLang();
const t = G.t = (key, vars) => {
  let s = (DICT[G.lang] || {})[key];
  if(s === undefined){ missing.add(G.lang + ':' + key); s = (DICT.en || {})[key]; if(s === undefined) s = key; }
  if(vars) s = s.replace(/\{(\w+)\}/g, (m, k) => vars[k] === undefined ? m : vars[k]);
  return s;
};
G.has = key => (DICT[G.lang] || {})[key] !== undefined;
function applyStatic(){
  document.documentElement.lang = LOCALE[G.lang];
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  $('lang').innerHTML = LANGS.map(l => `<button type="button" data-lang="${l}" aria-pressed="${l === G.lang}">${t('lang.' + l)}</button>`).join('');
}
G.setLang = l => {
  if(!LANGS.includes(l) || l === G.lang) return;
  G.lang = l; store('gb.lang', l);
  if(Q.has('lang')){ Q.set('lang', l); history.replaceState(null, '', '?' + Q.toString() + location.hash); }
  makeFormatters(); applyStatic(); G.render(true);
};

/* ------------------------------------------------------------------ data */
const num = v => typeof v === 'number' && isFinite(v) ? v : 0;
const numOrNull = v => typeof v === 'number' && isFinite(v) ? v : null;
const arr = v => Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [];
const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const str = v => typeof v === 'string' ? v : null;
const tok = v => { v = obj(v); return {input: num(v.input), output: num(v.output), cacheRead: num(v.cacheRead), cacheWrite: num(v.cacheWrite), reasoning: num(v.reasoning)}; };
G.totTok = k => k.input + k.output + k.cacheRead + k.cacheWrite;
const text = v => (v && typeof v === 'object') ? (v.masked ? v : null) : (v === undefined || v === null ? null : String(v));
function normCommit(a){
  return {t: str(a.t), source: str(a.source) || 'local', repo: text(a.repo), public: a.public === true, title: str(a.title) || '',
    branch: str(a.branch), hash: str(a.hash), url: str(a.url), machine: str(a.machine), pushed: a.pushed !== false};
}
function normDay(u){
  return {date: str(u.date) || '', requests: num(u.requests), sessions: num(u.sessions), unpricedRequests: num(u.unpricedRequests),
    tokens: tok(u.tokens), cacheHitRate: num(u.cacheHitRate), costUsd: num(u.costUsd),
    byAgent: arr(u.byAgent).map(a => ({agent: str(a.agent) || 'other', requests: num(a.requests), sessions: num(a.sessions), tokens: tok(a.tokens), costUsd: num(a.costUsd)})),
    byModel: arr(u.byModel).map(m => ({model: str(m.model) || 'other', agent: str(m.agent), requests: num(m.requests), unpricedRequests: num(m.unpricedRequests), tokens: tok(m.tokens), costUsd: numOrNull(m.costUsd)})),
    byProject: arr(u.byProject).map(p => ({project: text(p.project), public: p.public === true, requests: num(p.requests), sessions: num(p.sessions), unpricedRequests: num(p.unpricedRequests), costUsd: num(p.costUsd)}))};
}
function normalize(raw){
  const g = obj(raw), td = obj(g.today), c = obj(g.contributions), code = g.code && typeof g.code === 'object' ? g.code : null;
  const D = {
    ok: !!raw && typeof raw === 'object',
    view: g.view === 'public' ? 'public' : 'private',
    generatedAt: str(g.generatedAt), tz: str(g.tz), pricingVersion: str(g.pricingVersion),
    hidden: new Set(Array.isArray(g.hidden) ? g.hidden : []),
    today: {...normDay({...td, date: ''}), hourly: Array.isArray(td.hourly) ? arr(td.hourly).map(h => ({hour: num(h.hour), requests: num(h.requests), costUsd: num(h.costUsd)})) : null},
    trend: arr(g.trend).map(d => { const cu = obj(d.costUsd); return {date: str(d.date) || '', cc: num(cu['claude-code']), cx: num(cu.codex)}; }),
    quota: arr(g.quota).map(q => ({account: q.account == null ? '' : String(q.account), agent: str(q.agent) || 'claude-code', window: str(q.window) || '7d',
      usedPct: num(q.usedPct), resetsAt: str(q.resetsAt), sampledAt: str(q.sampledAt), history: arr(q.history).map(h => ({t: str(h.t), usedPct: num(h.usedPct)})).filter(h => h.t)})),
    contributions: {total: num(c.total), days: arr(c.days).map(d => ({date: str(d.date) || '', count: num(d.count)})), official: numOrNull(c.githubOfficialTotal)},
    activity: arr(g.activity).map(normCommit),
    machines: arr(g.machines).map(m => {
      const s = m.system && typeof m.system === 'object' ? m.system : null;
      return {id: m.id == null ? '?' : String(m.id), label: text(m.label), role: str(m.role), os: str(m.os), online: m.online === true,
        lastSeen: str(m.lastSeen), probeLastReport: str(m.probeLastReport),
        system: s ? {cpuPct: num(s.cpuPct), memUsed: num(s.memUsed), memTotal: num(s.memTotal), diskUsed: num(s.diskUsed), diskTotal: num(s.diskTotal), uptimeSec: numOrNull(s.uptimeSec)} : null,
        history: arr(m.history).map(h => ({t: str(h.t), cpuPct: numOrNull(h.cpuPct), memPct: numOrNull(h.memPct), diskPct: numOrNull(h.diskPct)})).filter(h => h.t)};
    }),
    services: arr(g.services).map(s => ({name: text(s.name), kind: str(s.kind), machine: str(s.machine), status: str(s.status) || 'unknown',
      uptimePct24h: numOrNull(s.uptimePct24h), cpuPct: numOrNull(s.cpuPct), memBytes: numOrNull(s.memBytes)})),
    runtimes: arr(g.runtimes).map(r => ({machine: r.machine == null ? '?' : String(r.machine), agent: str(r.agent) || 'other', version: str(r.version),
      processes: num(r.processes), activeSessions: num(r.activeSessions), stale: r.stale === true})),
    tailnet: arr(g.tailnet).map(d => ({name: text(d.name), os: str(d.os), online: d.online === true, lastSeen: str(d.lastSeen)})),
    jobs: arr(g.jobs).map(j => ({name: text(j.name), machine: str(j.machine), lastRun: str(j.lastRun), lastSuccess: str(j.lastSuccess), ok: j.ok === true})),
    /* provisional detail blocks (CONTRACT §2.2): null when absent, e.g. in the public snapshot */
    usageDays: Array.isArray(g.usageDays) ? arr(g.usageDays).map(normDay) : null,
    repos: code && Array.isArray(code.repos) ? arr(code.repos).map(r => ({repo: text(r.repo), public: r.public === true,
      sources: Array.isArray(r.sources) ? r.sources.filter(x => typeof x === 'string') : [], commits: num(r.commits), unpushed: num(r.unpushed),
      machines: Array.isArray(r.machines) ? r.machines.map(String) : [], lastCommit: str(r.lastCommit)})) : null,
    commits: code && Array.isArray(code.commits) ? arr(code.commits).map(normCommit) : null,
    warnings: Array.isArray(g.warnings) ? arr(g.warnings).map(w => ({t: str(w.t), machine: str(w.machine), kind: str(w.kind) || '', detail: w.detail == null ? '' : String(w.detail)})) : null,
  };
  D.T0 = Date.parse(D.generatedAt || '') || Date.now();
  if(!D.trend.length && D.ok){
    const today = D.generatedAt ? D.generatedAt.slice(0, 10) : '';
    const ba = Object.fromEntries(D.today.byAgent.map(a => [a.agent, a.costUsd]));
    D.trend = [{date: today, cc: num(ba['claude-code']), cx: num(ba.codex)}];
  }
  return D;
}
G.D = normalize(window.GB);
const D = G.D;

/* ------------------------------------------------------------------ formatters (per language) */
let TZ = 'UTC';
try{ if(D.tz){ new Intl.DateTimeFormat('en-US', {timeZone: D.tz}); TZ = D.tz; } }catch(e){ TZ = 'UTC'; }
G.TZ = TZ;
const F = G.F = {};
function makeFormatters(){
  const L = LOCALE[G.lang];
  const n0 = new Intl.NumberFormat(L, {maximumFractionDigits: 0});
  const n1 = new Intl.NumberFormat(L, {maximumFractionDigits: 1, minimumFractionDigits: 1});
  const cmp = new Intl.NumberFormat(L, {notation: 'compact', maximumSignificantDigits: 4});
  const cmp2 = cmp;
  const usd = new Intl.NumberFormat(L, {style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2});
  const usd0 = new Intl.NumberFormat(L, {style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0});
  const pct0 = new Intl.NumberFormat(L, {style: 'percent', maximumFractionDigits: 0});
  const pct1 = new Intl.NumberFormat(L, {style: 'percent', maximumFractionDigits: 1, minimumFractionDigits: 1});
  const dtf = o => new Intl.DateTimeFormat(L, {timeZone: TZ, ...o});
  const md = dtf({month: '2-digit', day: '2-digit'}), hm = dtf({hour: '2-digit', minute: '2-digit', hour12: false});
  const hms = dtf({hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short'});
  const full = dtf({year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false});
  const dUTC = o => new Intl.DateTimeFormat(L, {timeZone: 'UTC', ...o});
  const dmd = dUTC({month: '2-digit', day: '2-digit'}), dymd = dUTC({year: 'numeric', month: '2-digit', day: '2-digit'});
  const dmon = dUTC({month: 'short'}), dwk = dUTC({weekday: 'short'}), dwkn = dUTC({weekday: 'narrow'});
  const rtf = new Intl.RelativeTimeFormat(L, {numeric: 'auto', style: 'short'});
  const day = s => new Date(s + 'T00:00:00Z');
  const units = [['terabyte', 1e12], ['gigabyte', 1e9], ['megabyte', 1e6], ['kilobyte', 1e3]];
  const unitF = {};
  Object.assign(F, {
    n: v => n0.format(num(v)),
    n1: v => n1.format(num(v)),
    tok: v => { v = num(v); return v < 1e4 ? n0.format(v) : (v < 1e6 ? cmp : cmp2).format(v); },
    usd: v => usd.format(num(v)),
    usd0: v => usd0.format(num(v)),
    pct: f => pct0.format(num(f)),
    pct1: f => pct1.format(num(f)),
    pctN: p => pct1.format(num(p) / 100),
    bytes: b => { b = num(b); for(const [u, k] of units){ if(b >= k * 0.95 || u === 'kilobyte'){ const key = u; unitF[key] = unitF[key] || new Intl.NumberFormat(L, {style: 'unit', unit: key, unitDisplay: 'short', maximumFractionDigits: b / k >= 100 ? 0 : 1}); return unitF[key].format(b / k); } } return n0.format(b); },
    md: iso => iso ? md.format(new Date(iso)) : '—',
    hm: iso => iso ? hm.format(new Date(iso)) : '—',
    when: iso => iso ? md.format(new Date(iso)) + ' ' + hm.format(new Date(iso)) : '—',
    full: iso => iso ? full.format(new Date(iso)) : '—',
    clock: ms => hms.format(new Date(ms)),
    dmd: s => s ? dmd.format(day(s)) : '—',
    dfull: s => s ? dymd.format(day(s)) + ' ' + dwk.format(day(s)) : '—',
    mon: s => dmon.format(day(s)),
    wk: i => dwk.format(new Date(Date.UTC(2026, 10, 15 + i))),       /* 2026-11-15 is a Sunday: i = 0..6, Sunday first */
    wkn: i => dwkn.format(new Date(Date.UTC(2026, 10, 15 + i))),
    ago: iso => {
      if(!iso) return '—';
      const s = (D.T0 - Date.parse(iso)) / 1e3;
      if(!isFinite(s)) return '—';
      if(Math.abs(s) < 90) return t('time.now');
      if(Math.abs(s) < 5400) return rtf.format(-Math.round(s / 60), 'minute');
      if(Math.abs(s) < 172800) return rtf.format(-Math.round(s / 3600), 'hour');
      return rtf.format(-Math.round(s / 86400), 'day');
    },
    dur: sec => { sec = num(sec); const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60);
      return d ? t('dur.dh', {d, h}) : h ? t('dur.hm', {h, m}) : t('dur.m', {m}); },
    cd: ms => { ms = Math.max(0, ms); const d = Math.floor(ms / 864e5); ms -= d * 864e5; const h = Math.floor(ms / 36e5); ms -= h * 36e5; const m = Math.floor(ms / 6e4);
      const z = x => String(x).padStart(2, '0'); return d ? t('dur.cdD', {d, hm: z(h) + ':' + z(m)}) : z(h) + ':' + z(m); },
  });
  const ld = new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'});
  const lh = new Intl.DateTimeFormat('en-GB', {timeZone: TZ, hour: '2-digit', hour12: false});
  F.localDate = iso => ld.format(new Date(iso));                    /* YYYY-MM-DD in the page zone */
  F.localHour = iso => parseInt(lh.format(new Date(iso)), 10) % 24;
}
makeFormatters();

/* ------------------------------------------------------------------ html helpers */
const esc = G.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const MASK = '█'.repeat(8);
/* Text (CONTRACT §0.1): plain / masked placeholder (fixed 8 cells, blurred) / merged group */
G.T = v => v && typeof v === 'object'
  ? (v.group === 'private' ? `<span class="grp">${esc(t('text.private'))}</span>` : `<span class="mask" role="img" aria-label="${esc(t('text.masked'))}">${MASK}</span>`)
  : esc(v == null ? '—' : v);
G.Tplain = v => v && typeof v === 'object' ? (v.group === 'private' ? t('text.private') : t('text.masked')) : (v == null ? '—' : String(v));
G.Tkey = v => v && typeof v === 'object' ? (v.group === 'private' ? '\u0000private' : '\u0000masked') : String(v == null ? '' : v);
G.safeLink = u => typeof u === 'string' && /^https:[/][/][^\s"'<>]+$/.test(u) ? u : null;
const BLUE = '#6c97d6', HI = '#efeadd', OR = '#dba843', BAD = '#e0645a', OK = '#79b98a', WARN = '#e3894d', VIO = '#a48ee0', DIM = '#a6a297';
G.C = {BLUE, HI, OR, BAD, OK, WARN, VIO, DIM};
const COL = G.COL = [BLUE, HI, OR, BAD, OK, WARN, VIO, DIM];
G.lvlCls = f => f >= 0.9 ? 'c-bad' : f >= 0.75 ? 'c-warn' : 'c-ok';
G.lvlIdx = f => f >= 0.9 ? 3 : f >= 0.75 ? 5 : 4;
const TAGS = ['#e07a8a', '#7fa8e8', '#79b98a', '#d9a441', '#a48ee0', '#5fb7b0', '#e3894d', '#c68fd0'];
G.hue = s => { let h = 0; for(const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return TAGS[h % TAGS.length]; };
const bd = G.bd = (txt, cls = '', dot = false, style = '', live = false) => `<span class="bd ${cls}${dot ? ' dot' : ''}${live ? ' live' : ''}"${style ? ` style="${style}"` : ''}>${txt}</span>`;
G.repoTag = r => typeof r === 'string' ? bd(esc(r), '', true, `color:${G.hue(r)}`)
  : (r && r.group === 'private' ? `<span class="grp">${esc(t('text.private'))}</span>` : bd(`<span class="mask" role="img" aria-label="${esc(t('text.masked'))}">${MASK}</span>`, 'c-dim', true));
G.AG = a => a === 'claude-code' ? 'Claude Code' : a === 'codex' ? 'Codex' : esc(a);
G.agCls = a => a === 'codex' ? 'c-or' : 'c-fg';
G.agCol = a => a === 'codex' ? OR : BLUE;
G.agTag = a => bd(G.AG(a), G.agCls(a), true);
G.code = id => `<span class="code" title="${esc(id)}">${esc(id)}</span>`;
G.lbl = (prefix, v) => v == null ? '—' : G.has(prefix + v) ? esc(t(prefix + v)) : esc(v);
G.OS = v => v === 'macos' ? 'macOS' : v === 'windows' ? 'Windows' : v === 'linux' ? 'Linux' : esc(v || '—');

/* 5x5 pixel icons: the same cell language as the page */
const GLYPH = {bolt: ['00110', '01100', '11111', '00110', '01100'], gauge: ['01110', '10001', '10101', '10011', '11111'],
  server: ['11111', '10001', '11111', '10001', '11111'], grid: ['10101', '01010', '10101', '01010', '10101'], bars: ['00001', '00101', '10101', '10101', '11111'],
  pie: ['01110', '11011', '11001', '11111', '01110'], box: ['11111', '10001', '10101', '10001', '11111'], term: ['10000', '01000', '00100', '01000', '10011'],
  branch: ['10001', '10001', '11010', '10100', '10000'], clock: ['01110', '10101', '10111', '10001', '01110'], net: ['00100', '01110', '10101', '00100', '01110'],
  alert: ['00100', '01110', '01010', '11111', '11011'], list: ['10111', '00000', '10111', '00000', '10111'], chip: ['01010', '11111', '01010', '11111', '01010']};
const ICOLOR = {fg: BLUE, or: OR, ok: OK, vio: VIO, bad: BAD, warn: WARN, hi: HI};
G.ic = (g, c) => { const rows = GLYPH[g] || GLYPH.box, col = ICOLOR[c] || HI;
  return `<i class="ic" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 15 15">${rows.flatMap((row, r) => [...row].map((v, k) => v === '1' ? `<rect x="${k * 3}" y="${r * 3}" width="2.4" height="2.4" fill="${col}"/>` : '')).join('')}</svg></i>`; };
G.cnt = s => `<span class="cnt">${s}</span>`;
G.more = (href, key = 'more.all') => `<a class="more" href="${href}">${esc(t(key))}</a>`;
/* panel header: icon, title, count badge, right side */
G.ph = (id, icon, color, title, count, right, tag = 'h2') =>
  `<div class="ph"><${tag} id="${id}">${G.ic(icon, color)}${title}${count != null && count !== '' ? G.cnt(count) : ''}</${tag}><span class="r">${right || ''}</span></div>`;
G.grpH = (n, key) => `<div class="grp-h"><b>${n}</b>${esc(t(key))}</div>`;
let panelI = 0;
G.pn = (id, inner, cls = '') => `<section class="pn ${cls}" style="--i:${panelI++}" aria-labelledby="${id}">${inner}</section>`;
G.resetPanels = () => { panelI = 0; barN = 0; };
G.empty = (key = 'empty') => `<div class="empty">${esc(t(key))}</div>`;

/* fixed-pitch square cell grids */
G.cells = function(nc, nr, level, o = {}){
  const p = o.pitch || 6, px = o.px || Math.round(p * 0.72 * 10) / 10, half = px / 2, out = [];
  for(let c = 0; c < nc; c++) for(let r = 0; r < nr; r++){
    const v = level(c, r); if(!v) continue;
    const col = typeof v[1] === 'string' ? v[1] : COL[v[1] || 0];
    out.push(`<rect x="${(c * p + p / 2 - half).toFixed(2)}" y="${(r * p + p / 2 - half).toFixed(2)}" width="${px}" height="${px}" fill="${col}" fill-opacity="${v[0].toFixed(3)}"${v[2] ? ` class="${v[2]}"` : ''}/>`);
  }
  const w = nc * p, h = nr * p;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${out.join('')}${o.overlay ? o.overlay(p, w, h) : ''}</svg>`;
};
let barN = 0;
G.bar = (frac, ci) => { frac = isFinite(frac) ? frac : 0; const col = typeof ci === 'string' ? ci : COL[ci || 0];
  return `<svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="6" fill="${BLUE}" fill-opacity=".08"/><rect class="growbar" style="--d:${(barN++ % 12) * 40}ms" width="${Math.max(0.8, Math.min(1, Math.max(0, frac)) * 100).toFixed(2)}" height="6" fill="${col}" fill-opacity=".85"/></svg>`; };
G.max = (xs, floor = 0) => xs.reduce((a, b) => b > a ? b : a, floor);
G.sum = xs => xs.reduce((a, b) => a + (b || 0), 0);

/* width-dependent blocks: rendered after the view is in the DOM and again on resize */
let fits = [];
G.fit = (id, fn) => { fits.push({id, fn}); return `<div id="${id}"></div>`; };
G.runFits = () => fits.forEach(({id, fn}) => { const el = $(id); if(!el) return; const w = el.clientWidth; if(w) el.innerHTML = fn(w, el); });
let afters = [];
G.after = fn => afters.push(fn);

/* expandable rows: [data-x] toggles the detail row/item with id xd-<key>; content is built on first open */
const details = new Map();
G.detail = (key, fn) => { details.set(key, fn); return key; };
G.xattrs = key => `class="xr" data-x="${key}" tabindex="0" role="button" aria-expanded="false" aria-controls="xd-${key}"`;
function toggle(row){
  const key = row.dataset.x, d = $('xd-' + key); if(!d) return;
  const open = row.getAttribute('aria-expanded') !== 'true';
  row.setAttribute('aria-expanded', String(open));
  d.hidden = !open;
  if(open && !d.dataset.filled){
    const fn = details.get(key), slot = d.querySelector('[data-slot]') || d;
    if(fn){ slot.innerHTML = fn(slot.clientWidth || 600); }
    d.dataset.filled = '1';
  }
}
document.addEventListener('click', e => {
  const l = e.target.closest('[data-lang]'); if(l){ G.setLang(l.dataset.lang); return; }
  if(e.target.closest('a,input,button')) return;
  const r = e.target.closest('[data-x]'); if(r) toggle(r);
});
document.addEventListener('keydown', e => {
  if((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-x]')){ e.preventDefault(); toggle(e.target); }
});

/* tooltips: any element with data-tip */
const tip = $('tip');
document.addEventListener('mousemove', e => {
  const el = e.target.closest && e.target.closest('[data-tip]');
  if(!el){ tip.style.opacity = 0; return; }
  tip.textContent = el.getAttribute('data-tip');
  const x = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8);
  tip.style.left = Math.max(4, x) + 'px'; tip.style.top = Math.max(4, e.clientY - tip.offsetHeight - 10) + 'px'; tip.style.opacity = 1;
});
document.addEventListener('mouseleave', () => { tip.style.opacity = 0; });

/* KPI numbers roll from 0 through their own formatter */
G.roll = (v, fmt) => `<span data-roll="${num(v)}" data-fmt="${fmt}">${F[fmt](v)}</span>`;
function rollAll(){
  if(G.STATIC) return;
  document.querySelectorAll('#view [data-roll]').forEach(el => {
    const target = parseFloat(el.dataset.roll), f = F[el.dataset.fmt] || F.n, t0 = performance.now(), Dms = 900;
    const step = now => { const k = Math.min(1, (now - t0) / Dms), e = 1 - Math.pow(1 - k, 3); el.textContent = f(target * e); if(k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

/* quota pace (shared by overview and usage) */
G.WMS = {'7d': 7 * 864e5, '5h': 5 * 36e5};
G.pace = (q, now) => {
  const reset = Date.parse(q.resetsAt || ''), W = G.WMS[q.window] || 7 * 864e5;
  if(!isFinite(reset)) return {e: 0, reset: NaN, hot: false, txt: ''};
  const e = Math.min(1, Math.max(0.001, (now - (reset - W)) / W)), diff = q.usedPct / 100 / e - 1;
  if(diff <= 0 || q.usedPct <= 0) return {e, reset, hot: false, txt: t('quota.slower', {p: Math.round(-Math.max(-1, diff) * 100)})};
  const el = e * W, tEx = (100 - q.usedPct) / (q.usedPct / el), early = (reset - now) - tEx;
  return {e, reset, hot: early > 0, txt: early > 0 ? t('quota.faster', {p: Math.round(diff * 100), d: F.dur(early / 1e3)}) : t('quota.fasterOk', {p: Math.round(diff * 100)})};
};
G.multiAcct = () => new Set(D.quota.map(q => q.agent + '\u0000' + q.account)).size > new Set(D.quota.map(q => q.agent)).size;

/* ------------------------------------------------------------------ background: today's piece */
function art(){
  const cv = $('art'), ax = cv.getContext && cv.getContext('2d'); if(!ax) return () => {};
  const TD = D.today, totTok = G.totTok(TD.tokens);
  const totals = D.trend.map(d => d.cc + d.cx), nT = Math.max(1, totals.length), maxT = G.max(totals) || 1;
  const seedDate = (D.generatedAt || '2026-01-01').slice(0, 10).replace(/-/g, ''), seed = parseInt(seedDate, 10) || 1;
  const ccReq = (TD.byAgent.find(a => a.agent === 'claude-code') || {}).requests || 0;
  const shareCC = TD.requests ? ccReq / TD.requests : 1;
  const nParticles = Math.min(4000, Math.round(totTok / 1e6 * 38));
  G.capText = () => {
    $('cap0').textContent = t('art.cap', {n: seedDate});
    $('capMid').innerHTML = `<span style="color:${BLUE}">■</span> Claude Code ${F.pct(shareCC)}&emsp;<span style="color:${OR}">■</span> Codex ${F.pct(1 - shareCC)}`;
    $('cap1').textContent = t('art.legend', {n: F.n(nParticles), tok: F.tok(totTok)});
  };
  function mulberry(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; }; }
  const rnd0 = mulberry(seed ^ 0x9e3779b9), perm = new Float32Array(65536); for(let i = 0; i < perm.length; i++) perm[i] = rnd0();
  function noise(x, y){ const s_ = v => v * v * (3 - 2 * v);
    const xi = Math.floor(x), yi = Math.floor(y), xf = s_(x - xi), yf = s_(y - yi), x0 = xi & 255, x1 = (xi + 1) & 255, y0 = (yi & 255) << 8, y1 = ((yi + 1) & 255) << 8;
    const a = perm[y0 | x0], b = perm[y0 | x1], c = perm[y1 | x0], d = perm[y1 | x1]; return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf; }
  const smooth = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const sstep = (a, b, x) => smooth((x - a) / (b - a));
  const trMean = G.sum(totals) / nT;
  function ridge(xn){ if(totals.length < 2) return (totals[0] || 0) / maxT; const f = (xn * .5 + .5) * (nT - 1), i = Math.max(0, Math.min(nT - 2, Math.floor(f))), u = f - i, s = (1 - Math.cos(u * Math.PI)) / 2; return (totals[i] + (totals[i + 1] - totals[i]) * s) / maxT; }
  const prnd = mulberry(seed);
  const PART = Array.from({length: nParticles}, () => ({bx: prnd() * 2 - 1, by: prnd(), bz: prnd(), ph: prnd() * 6.283, cx: prnd() > shareCC}));
  const LV = 9, ART = [[108, 151, 214], [219, 168, 67]], jitter = (1 - TD.cacheHitRate) * 4;
  const NZ = 120, zs = Array.from({length: NZ}, (_, i) => 1.1 * Math.pow(15 / 1.1, i / (NZ - 1)));
  let L = null, Gr = null;
  function layout(){ const W = cv.clientWidth, H = cv.clientHeight; if(!W || !H){ L = null; return; }
    const dpr = Math.min(devicePixelRatio || 1, 2); cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    L = {W, H, dpr, p: 5, cols: Math.floor(W / 5), rows: Math.floor(H / 5)}; }
  function draw(tm){
    if(!L) layout(); if(!L) return;
    const {W, H, dpr, cols, rows} = L, P = L.p;
    if(!Gr || Gr.n !== cols * rows) Gr = {n: cols * rows, gb: new Float32Array(cols * rows), gc: new Uint8Array(cols * rows), bk: Array.from({length: 2 * LV}, () => new Int32Array(cols * rows)), bc: new Int32Array(2 * LV)};
    const {gb, gc, bk, bc} = Gr, PN = W < 640 ? Math.round(PART.length * .5) : PART.length;
    gb.fill(0);
    const hy = rows * .42, focal = rows * .95, kx = .62 * cols / rows;
    const A = 2.2 + .5 * Math.sin(tm * .33), camH = 2.0 + .08 * Math.sin(tm * .21), trav = tm * .16, ymin = new Float32Array(cols).fill(rows);
    for(let c = 0; c < cols; c++){
      const xn = (c + .5) / cols * 2 - 1;
      for(let i = 0; i < NZ; i++){
        const z = zs[i], wx = xn * z * kx, zz = z + trav, far = sstep(5, 13, z), amp = A * (.3 + .7 * sstep(2, 8, z));
        const Hf = (x, q) => (noise(x * .42 + 7, q * .42) - .5) * amp + (noise(x * 1.15 + 31, q * 1.15 + 5) - .5) * jitter * .55;
        const hc = Hf(wx, zz), ys = hy + (camH - (hc + (ridge(xn) - trMean / maxT) * far * 3.2 + .3)) / z * focal;
        if(ys >= ymin[c]) continue;
        const slope = -(Hf(wx, zz + .3) - hc) / .3 * .6 + (Hf(wx + .3, zz) - hc) / .3 * .35, fog = Math.exp(-(z - 1.1) * .12);
        const b = Math.max(.2, Math.min(1, .26 + slope * 2.6)) * (.4 + .6 * fog) * .95;
        for(let y = Math.max(0, Math.ceil(ys)), y1 = Math.min(rows, Math.ceil(ymin[c])); y < y1; y++){ const k = c * rows + y; gb[k] = Math.min(1, b + (y === Math.ceil(ys) ? .12 * fog : 0)); gc[k] = 0; }
        ymin[c] = ys;
      }
    }
    for(let n = 0; n < PN; n++){
      const p = PART[n], u = (p.bz + tm * .011) % 1, z = 2.2 + u * 12, life = Math.sin(u * Math.PI);
      const wx = p.bx * z * kx + Math.sin(tm * .22 + p.ph) * .5 + Math.sin(tm * .13 + p.by * 5) * .4, wy = .9 + p.by * 3.6 + Math.sin(tm * .3 + p.bx * 4 + p.ph) * .3 + Math.sin(tm * .17 + z) * .2;
      const sx = ((wx / (z * kx)) * .5 + .5) * cols, sy = hy + (camH - wy) / z * focal, cx = sx | 0, cy = sy | 0;
      if(cx < 0 || cx >= cols || cy < 0 || cy >= rows || sy >= ymin[cx] - 1) continue;
      const b = life * (.35 + .65 * Math.exp(-(z - 2) * .12)) * (.75 + .25 * Math.sin(tm * .7 + p.ph)) * .95, k = cx * rows + cy;
      if(b > gb[k]){ gb[k] = b; gc[k] = p.cx ? 1 : 0; }
    }
    bc.fill(0);
    for(let k = 0; k < gb.length; k++){ const a = gb[k]; if(a < .05) continue; const key = gc[k] * LV + Math.min(LV, Math.ceil(a * LV)) - 1; bk[key][bc[key]++] = k; }
    ax.setTransform(dpr, 0, 0, dpr, 0, 0); ax.clearRect(0, 0, W, H);
    for(let key = 0; key < 2 * LV; key++){
      const n = bc[key]; if(!n) continue;
      const ci = (key / LV) | 0, f = (key % LV + 1) / LV, col = ART[ci], s = P * (.3 + .6 * f), off = (P - s) / 2, a = bk[key];
      ax.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${(.14 + .66 * f).toFixed(3)})`;
      if(f > 0.85){ ax.shadowColor = `rgba(${col[0]},${col[1]},${col[2]},.7)`; ax.shadowBlur = 6; } else ax.shadowBlur = 0;
      ax.beginPath(); for(let i = 0; i < n; i++){ const k = a[i]; ax.rect(((k / rows) | 0) * P + off, (k % rows) * P + off, s, s); } ax.fill();
    }
    ax.shadowBlur = 0;
  }
  return {draw, relayout: () => { L = null; }};
}

/* ------------------------------------------------------------------ header, clock, router */
function header(){
  $('viewChip').textContent = t(D.view === 'public' ? 'view.public' : 'view.private');
  $('stamp').textContent = t('stamp', {t: F.when(D.generatedAt)});
  document.title = t('app.title');
}
let lastSec = -1;
function tick(Tm, force){
  const now = D.T0 + Tm * 1000, sec = Math.floor(Tm); if(sec === lastSec && !force) return; lastSec = sec;
  document.querySelectorAll('[data-cd]').forEach(el => { el.textContent = F.cd(Date.parse(el.dataset.cd) - now); });
  $('clock').textContent = F.clock(now);
}
const ROUTES = ['overview', 'usage', 'code', 'machines', 'services'];
G.route = () => {
  const h = location.hash.replace(/^#\/?/, ''), [p, qs] = h.split('?');
  const name = p === '' ? 'overview' : p;
  return {name: ROUTES.includes(name) ? name : 'overview', params: new URLSearchParams(qs || '')};
};
G.href = (name, params) => { const qs = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString() : '';
  return '#/' + (name === 'overview' ? '' : name) + (qs ? '?' + qs : ''); };
let lastRoute = null;
G.render = (keep) => {
  const r = G.route(), view = $('view');
  fits = []; afters = []; details.clear(); G.resetPanels();
  document.querySelectorAll('#nav a').forEach(a => a.toggleAttribute('aria-current', false));
  const cur = document.querySelector(`#nav a[data-route="${r.name}"]`); if(cur) cur.setAttribute('aria-current', 'page');
  header();
  if(G.capText) G.capText();
  if(!D.ok){ view.innerHTML = `<div class="nogb">${esc(t('nodata'))}</div>`; return; }
  const sameRoute = lastRoute === r.name;
  const y = scrollY;
  view.innerHTML = G.pages[r.name](r.params);
  G.runFits();
  afters.forEach(f => f());
  if(!G.STATIC && !sameRoute && !keep){ document.body.classList.remove('anim'); void document.body.offsetWidth; document.body.classList.add('anim'); rollAll(); }
  if(!sameRoute && !keep) scrollTo(0, 0); else scrollTo(0, y);
  lastRoute = r.name;
  tick(G.STATIC ? (FROZEN || 0) : (performance.now() - start) / 1000, true);
};
let start = performance.now();
G.boot = () => {
  applyStatic();
  const A = D.ok ? art() : null;
  if(!G.STATIC) document.body.classList.add('anim');
  G.render();
  addEventListener('hashchange', () => G.render());
  const drawAll = (Tm, force) => { if(A && A.draw) A.draw(Tm + 6); tick(Tm, force); };
  let lastF = 0;
  function frame(ts){ requestAnimationFrame(frame); if(document.hidden || ts - lastF < 40) return; lastF = ts; drawAll((performance.now() - start) / 1000); }
  if(FROZEN !== null) drawAll(FROZEN, true); else if(REDUCE) drawAll(8, true); else { drawAll(0, true); requestAnimationFrame(frame); }
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { G.runFits(); if(A && A.relayout) A.relayout(); if(G.STATIC) drawAll(FROZEN !== null ? FROZEN : 8, true); }, 120); });
};
})();
