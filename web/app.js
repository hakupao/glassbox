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
function store(k, v){ try{ if(v === undefined) return localStorage.getItem(k); if(v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); }catch(e){ return null; } return null; }
/* Language preference: 'auto' (default: follow the browser) or a fixed language. A fixed choice is
   kept in localStorage; ?lang=zh|ja|en sets it, ?lang=auto clears it. */
const PREFS = ['auto', 'zh', 'en', 'ja'];
function browserLang(){
  for(const l of (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ''])){
    const p = String(l).toLowerCase().slice(0, 2);
    if(LANGS.includes(p)) return p;
  }
  return 'en';
}
function pickPref(){
  const q = (Q.get('lang') || '').toLowerCase();
  if(q === 'auto'){ store('gb.lang', null); return 'auto'; }
  if(LANGS.includes(q)){ store('gb.lang', q); return q; }
  const s = store('gb.lang');
  return LANGS.includes(s) ? s : 'auto';
}
G.pref = pickPref();
G.lang = G.pref === 'auto' ? browserLang() : G.pref;
const t = G.t = (key, vars) => {
  let s = (DICT[G.lang] || {})[key];
  if(s === undefined){ missing.add(G.lang + ':' + key); s = (DICT.en || {})[key]; if(s === undefined) s = key; }
  if(vars) s = s.replace(/\{(\w+)\}/g, (m, k) => vars[k] === undefined ? m : vars[k]);
  return s;
};
G.has = key => (DICT[G.lang] || {})[key] !== undefined;
/* the switcher: a trigger (globe, current choice, the language in effect when AUTO) and a menu */
function langSwitcher(){
  const open = !!($('lang-menu') && !$('lang-menu').hidden);
  const cur = G.pref === 'auto' ? `<span>${esc(t('lang.auto'))}</span><small>${esc(t('lang.' + G.lang))}</small>` : `<span>${esc(t('lang.' + G.pref))}</span>`;
  $('lang').innerHTML = `<button type="button" class="lang-btn" id="lang-btn" aria-haspopup="menu" aria-expanded="${open}" aria-controls="lang-menu" aria-label="${esc(t('lang.aria'))}">${G.uicon('globe', 14)}${cur}<i class="caret" aria-hidden="true"></i></button>
    <div class="lang-menu" id="lang-menu" role="menu" aria-label="${esc(t('lang.aria'))}"${open ? '' : ' hidden'}><div class="lm-h" aria-hidden="true">${esc(t('lang.aria'))}</div>` +
    PREFS.map(p => `<button type="button" role="menuitemradio" aria-checked="${p === G.pref}" data-lang="${p}" tabindex="-1"${p === 'auto' ? '' : ` lang="${LOCALE[p]}"`}><span class="lm-n">${esc(t('lang.name.' + p))}</span>` +
      `<small>${esc(p === 'auto' ? t('lang.now', {l: t('lang.name.' + G.lang)}) : t('lang.' + p))}</small><i class="lm-c" aria-hidden="true"></i></button>`).join('') + `</div>`;
}
function applyStatic(){
  document.documentElement.lang = LOCALE[G.lang];
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  langSwitcher();
}
function langMenu(open, focus){
  const m = $('lang-menu'), b = $('lang-btn'); if(!m || !b) return;
  m.hidden = !open; b.setAttribute('aria-expanded', String(open));
  if(open && focus){ const items = [...m.querySelectorAll('[data-lang]')]; (items.find(i => i.getAttribute('aria-checked') === 'true') || items[0]).focus(); }
  if(!open && focus) b.focus();
}
G.setLang = pref => {
  if(!PREFS.includes(pref)) return;
  const before = G.lang;
  G.pref = pref; G.lang = pref === 'auto' ? browserLang() : pref;
  store('gb.lang', pref === 'auto' ? null : pref);
  if(Q.has('lang')){ Q.set('lang', pref); history.replaceState(null, '', '?' + Q.toString() + location.hash); }
  if(G.lang !== before){ makeFormatters(); applyStatic(); G.render(true); } else applyStatic();
  langMenu(false, true);
};
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('#lang-btn');
  if(b){ langMenu($('lang-menu').hidden, false); return; }
  if(!(e.target.closest && e.target.closest('#lang-menu'))) langMenu(false, false);
}, true);
document.addEventListener('keydown', e => {
  const m = $('lang-menu'); if(!m) return;
  if(e.key === 'Escape' && !m.hidden && (e.target.id === 'lang-btn' || m.contains(e.target))){ e.preventDefault(); langMenu(false, true); return; }
  if(e.target.id === 'lang-btn' && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); langMenu(true, true); return; }
  if(m.hidden || !m.contains(e.target)) return;
  const items = [...m.querySelectorAll('[data-lang]')], i = items.indexOf(e.target);
  if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus(); }
  else if(e.key === 'Home' || e.key === 'End'){ e.preventDefault(); items[e.key === 'Home' ? 0 : items.length - 1].focus(); }
  else if(e.key === 'Tab') langMenu(false, false);
});

/* ------------------------------------------------------------------ data */
const num = v => typeof v === 'number' && isFinite(v) ? v : 0;
const numOrNull = v => typeof v === 'number' && isFinite(v) ? v : null;
const arr = v => Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [];
const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const str = v => typeof v === 'string' ? v : null;
const tok = v => { v = obj(v); return {input: num(v.input), output: num(v.output), cacheRead: num(v.cacheRead), cacheWrite: num(v.cacheWrite), reasoning: num(v.reasoning)}; };
G.totTok = k => k.input + k.output + k.cacheRead + k.cacheWrite;
/* machine icons: Phosphor duotone paths from web/icons.js (window.GLASSBOX_ICONS); the names are the
   closed list of CONTRACT §2.1; anything else is treated as unset and gets the default */
const MICON = (window.GLASSBOX_ICONS || {}).machine || {}, UICON = (window.GLASSBOX_ICONS || {}).ui || {};
const MCOLOR = {blue: '#6c97d6', green: '#79b98a', paper: '#efeadd', violet: '#a48ee0', orange: '#e3894d', cyan: '#5fb7b0', yellow: '#dba843', red: '#e0645a'};
const MCOLORS = ['blue', 'green', 'paper', 'violet', 'orange', 'cyan', 'yellow', 'red'];
const defIcon = (role, os) => role === 'dev' || role === 'work' ? (os === 'macos' || os === null || role === 'work' ? 'laptop' : 'desktop')
  : role === 'deploy' ? ({macos: 'mini', linux: 'vm'}[os] || 'server') : role === 'gitea' ? (os === 'macos' ? 'nas' : 'server') : 'server';
const defColor = code => MCOLORS[[...String(code)].reduce((a, c) => a + c.charCodeAt(0), 0) % MCOLORS.length];
const text = v => (v && typeof v === 'object') ? (v.masked ? v : null) : (v === undefined || v === null ? null : String(v));
const nonEmpty = xs => xs.length ? xs : null;
function normCommit(a){
  return {t: str(a.t), source: str(a.source) || 'local', repo: text(a.repo), public: a.public === true, title: str(a.title) || '',
    branch: str(a.branch), hash: str(a.hash), url: str(a.url), machine: str(a.machine), pushed: a.pushed !== false,
    /* optional (S17 R09): author, files [{s: M|A|R|D, p: path}] or a bare count nFiles; null when absent */
    author: str(a.author) || null,
    files: Array.isArray(a.files) ? nonEmpty(arr(a.files).filter(f => typeof f.s === 'string' && f.s.length === 1 && 'MARD'.includes(f.s) && typeof f.p === 'string' && f.p).map(f => ({s: f.s, p: f.p}))) : null,
    nFiles: Number.isInteger(a.nFiles) && a.nFiles >= 0 ? a.nFiles : null};
}
function normDay(u){
  return {date: str(u.date) || '', requests: num(u.requests), sessions: num(u.sessions), unpricedRequests: num(u.unpricedRequests),
    tokens: tok(u.tokens), cacheHitRate: num(u.cacheHitRate), costUsd: num(u.costUsd),
    byAgent: arr(u.byAgent).map(a => ({agent: str(a.agent) || 'other', requests: num(a.requests), sessions: num(a.sessions), tokens: tok(a.tokens), costUsd: num(a.costUsd)})),
    byModel: arr(u.byModel).map(m => ({model: str(m.model) || 'other', agent: str(m.agent), requests: num(m.requests), unpricedRequests: num(m.unpricedRequests), tokens: tok(m.tokens), costUsd: numOrNull(m.costUsd)})),
    byProject: arr(u.byProject).map(p => ({project: text(p.project), public: p.public === true, requests: num(p.requests), sessions: num(p.sessions), unpricedRequests: num(p.unpricedRequests), costUsd: num(p.costUsd)})),
    byMachine: arr(u.byMachine).map(m => ({machine: str(m.machine) || '?', requests: num(m.requests), sessions: num(m.sessions), unpricedRequests: num(m.unpricedRequests), tokens: tok(m.tokens), costUsd: num(m.costUsd)}))};
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
        /* own keys only: "constructor" or "toString" are not icons */
        icon: typeof m.icon === 'string' && Object.hasOwn(MICON, m.icon) ? m.icon : null,
        color: typeof m.color === 'string' && Object.hasOwn(MCOLOR, m.color) ? m.color : null,
        lastSeen: str(m.lastSeen), probeLastReport: str(m.probeLastReport),
        system: s ? {cpuPct: num(s.cpuPct), memUsed: num(s.memUsed), memTotal: num(s.memTotal), diskUsed: num(s.diskUsed), diskTotal: num(s.diskTotal), uptimeSec: numOrNull(s.uptimeSec)} : null,
        history: arr(m.history).map(h => ({t: str(h.t), cpuPct: numOrNull(h.cpuPct), memPct: numOrNull(h.memPct), diskPct: numOrNull(h.diskPct)})).filter(h => h.t),
        /* provisional (CONTRACT §2.2): null when absent, e.g. in the public snapshot */
        todayByAgent: Array.isArray(m.todayByAgent) ? arr(m.todayByAgent).map(a => ({agent: str(a.agent) || 'other', requests: num(a.requests),
          unpricedRequests: num(a.unpricedRequests), costUsd: num(a.costUsd), sessions: num(a.sessions)})) : null};
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
  /* token counts read the same in every language: 1.2K / 128.3M / 1.5B, never CJK myriad units (owner 2026-11-18) */
  const cmp = new Intl.NumberFormat('en', {notation: 'compact', maximumSignificantDigits: 4});
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
  /* every date formatter shows a dash for a missing or unparsable value instead of throwing */
  const at = v => { if(v === null || v === undefined || v === '') return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; };
  const day = s => at(typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00Z' : null);
  const fmt = (f, d) => d ? f.format(d) : '\u2014';
  const units = [['terabyte', 1e12], ['gigabyte', 1e9], ['megabyte', 1e6], ['kilobyte', 1e3]];
  const unitF = {};
  Object.assign(F, {
    n: v => n0.format(num(v)),
    n1: v => n1.format(num(v)),
    tok: v => { v = num(v); return v < 1e4 ? n0.format(v) : cmp.format(v); },
    usd: v => usd.format(num(v)),
    usd0: v => usd0.format(num(v)),
    pct: f => pct0.format(num(f)),
    pct1: f => pct1.format(num(f)),
    pctN: p => pct1.format(num(p) / 100),
    bytes: b => { b = num(b); for(const [u, k] of units){ if(b >= k * 0.95 || u === 'kilobyte'){ const key = u; unitF[key] = unitF[key] || new Intl.NumberFormat(L, {style: 'unit', unit: key, unitDisplay: 'short', maximumFractionDigits: b / k >= 100 ? 0 : 1}); return unitF[key].format(b / k); } } return n0.format(b); },
    md: iso => fmt(md, at(iso)),
    hm: iso => fmt(hm, at(iso)),
    when: iso => { const d = at(iso); return d ? md.format(d) + ' ' + hm.format(d) : '\u2014'; },
    full: iso => fmt(full, at(iso)),
    clock: ms => fmt(hms, at(ms)),
    dmd: s => fmt(dmd, day(s)),
    dfull: s => { const d = day(s); return d ? dymd.format(d) + ' ' + dwk.format(d) : '\u2014'; },
    mon: s => fmt(dmon, day(s)),
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
    cd: ms => { if(!isFinite(ms)) return '\u2014'; ms = Math.max(0, ms); const d = Math.floor(ms / 864e5); ms -= d * 864e5; const h = Math.floor(ms / 36e5); ms -= h * 36e5; const m = Math.floor(ms / 6e4);
      const z = x => String(x).padStart(2, '0'); return d ? t('dur.cdD', {d, hm: z(h) + ':' + z(m)}) : z(h) + ':' + z(m); },
  });
  const ld = new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'});
  const lh = new Intl.DateTimeFormat('en-GB', {timeZone: TZ, hour: '2-digit', hour12: false});
  F.localDate = iso => { const d = at(iso); return d ? ld.format(d) : ''; };             /* YYYY-MM-DD in the page zone */
  F.localHour = iso => { const d = at(iso); return d ? parseInt(lh.format(d), 10) % 24 : null; };
}
makeFormatters();

/* ------------------------------------------------------------------ html helpers */
const esc = G.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
/* masked text: a small pixel matrix in the page's own cell language (like the heatmap and the
   background), drawn as SVG so it does not depend on fonts. The patterns are fixed and rotate per
   placeholder; they never depend on the hidden value (CONTRACT §0.1). Digits are cell shades 0-3. */
const MASK_ROWS = [['3213012320312302', '1302321031203213'], ['2031203213021320', '3120312023130231'],
                   ['1230321302312031', '2302130231203123'], ['3021320312031230', '1320230121302312']];
const MASK_OP = [0.12, 0.38, 0.62, 0.9];
const MASKS = MASK_ROWS.map(rows => `<svg width="63" height="7" viewBox="0 0 63 7" aria-hidden="true">${
  rows.map((r, y) => [...r].map((v, x) => `<rect x="${x * 4}" y="${y * 4}" width="3" height="3" opacity="${MASK_OP[+v]}"/>`).join('')).join('')}</svg>`);
let maskI = 0;
const MASK_NEXT = () => MASKS[maskI++ % MASKS.length];
/* the same matrix, 8 cells wide, for the "******" that export puts in place of scrubbed words in titles */
const MASKS_SHORT = MASK_ROWS.map(rows => `<svg width="31" height="7" viewBox="0 0 31 7" aria-hidden="true">${
  rows.map((r, y) => [...r.slice(0, 8)].map((v, x) => `<rect x="${x * 4}" y="${y * 4}" width="3" height="3" opacity="${MASK_OP[+v]}"/>`).join('')).join('')}</svg>`);
/* Text (CONTRACT §0.1): plain / masked placeholder (fixed 8 cells, blurred) / merged group */
G.T = v => v && typeof v === 'object'
  ? (v.group === 'private' ? `<span class="grp">${esc(t('text.private'))}</span>` : `<span class="mask" role="img" aria-label="${esc(t('text.masked'))}">${MASK_NEXT()}</span>`)
  : esc(v == null ? '—' : v);
/* commit title: escaped text, with each scrubbed run ("******", hub/export.py RED) drawn as a short matrix */
G.ttl = v => esc(v).replace(/\*{6}/g, () => `<span class="mask redact" role="img" aria-label="${esc(t('text.masked'))}">${MASKS_SHORT[maskI++ % MASKS_SHORT.length]}</span>`);
G.Tplain = v => v && typeof v === 'object' ? (v.group === 'private' ? t('text.private') : t('text.masked')) : (v == null ? '—' : String(v));
G.Tkey = v => v && typeof v === 'object' ? (v.group === 'private' ? '\u0000private' : '\u0000masked') : String(v == null ? '' : v);
G.safeLink = u => typeof u === 'string' && /^https:[/][/][^\s"'<>]+$/.test(u) ? u : null;
const BLUE = '#6c97d6', HI = '#efeadd', OR = '#dba843', BAD = '#e0645a', OK = '#79b98a', WARN = '#e3894d', VIO = '#a48ee0', DIM = '#a6a297';
G.C = {BLUE, HI, OR, BAD, OK, WARN, VIO, DIM};
const COL = G.COL = [BLUE, HI, OR, BAD, OK, WARN, VIO, DIM];
G.lvlCls = f => f >= 0.9 ? 'c-bad' : f >= 0.75 ? 'c-warn' : 'c-ok';
G.lvlIdx = f => f >= 0.9 ? 3 : f >= 0.75 ? 5 : 4;
/* repo tag colours: :root --tag-1..8 for CSS (inline style); SVG fill attributes need the hex, same order */
const TAGS = ['#e07a8a', '#7fa8e8', '#79b98a', '#d9a441', '#a48ee0', '#5fb7b0', '#e3894d', '#c68fd0'];
const tagI = s => { let h = 0; for(const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % TAGS.length; };
G.hue = s => `var(--tag-${tagI(s) + 1})`;
G.hueHex = s => TAGS[tagI(s)];
const bd = G.bd = (txt, cls = '', dot = false, style = '', live = false) => `<span class="bd ${cls}${dot ? ' dot' : ''}${live ? ' live' : ''}"${style ? ` style="${style}"` : ''}>${txt}</span>`;
G.repoTag = r => typeof r === 'string' ? bd(esc(r), '', true, `color:${G.hue(r)}`)
  : (r && r.group === 'private' ? `<span class="grp">${esc(t('text.private'))}</span>` : bd(`<span class="mask" role="img" aria-label="${esc(t('text.masked'))}">${MASK_NEXT()}</span>`, 'c-dim', true));
G.AG = a => a === 'claude-code' ? 'Claude Code' : a === 'codex' ? 'Codex' : esc(a);
G.agCls = a => a === 'codex' ? 'c-or' : 'c-fg';
G.agCol = a => a === 'codex' ? OR : BLUE;
G.agTag = a => bd(G.AG(a), G.agCls(a), true);
G.code = id => `<span class="code" title="${esc(id)}">${esc(id)}</span>`;
/* machine chip: the code in the machine's colour with its icon; unknown ids get the defaults */
G.mlook = id => { const m = D.machines.find(x => x.id === id);
  return {icon: (m && m.icon) || defIcon(m ? m.role : null, m ? m.os : null), color: (m && m.color) || defColor(id), online: !!(m && m.online)}; };
G.mhex = id => MCOLOR[G.mlook(id).color];
G.uicon = (name, size) => { const ic = UICON[name]; if(!ic) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="${ic.fill}" opacity="0.2"/><path d="${ic.line}"/></svg>`; };
G.micon = (name, size) => { const ic = MICON[name] || MICON.server; if(!ic) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="${ic.fill}" opacity="0.25"/><path d="${ic.line}"/></svg>`; };
/* machine tile: the icon on a tinted rounded square in the machine's colour, its code as a corner tag;
   codes longer than 2 characters (e.g. "host-macmini-m4") turn the tile into a pill, icon then code */
G.mc = (id, big) => { const L = G.mlook(id), col = G.mhex(id), long = [...String(id)].length > 2;
  return `<span class="mt${big ? ' big' : ''}${long ? ' long' : ''}" style="--mc:${col}" title="${esc(id)} \u00b7 ${esc(t('micon.' + L.icon))}${L.online ? ' \u00b7 ' + esc(t('mach.online')) : ''}">${G.micon(L.icon, big ? 24 : 13)}<b>${esc(id)}</b>${L.online ? '<i class="on" aria-hidden="true"></i>' : ''}</span>`; };
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
/* phone tab bar icons (S17 activity B): 5x5 cells, drawn in currentColor so the active tab lights up */
const TABGLYPH = {overview: '1101111011000001101111011', usage: '0000100101101011010111111', code: '0101010100101000010101010',
  machines: '1111110001100011111100100', services: '1111100000111110000011111'};
const tabIcons = () => document.querySelectorAll('[data-tab-ic]').forEach(el => { const g = TABGLYPH[el.dataset.tabIc] || '';
  el.innerHTML = `<svg width="20" height="20" viewBox="0 0 25 25" fill="currentColor" aria-hidden="true">${[...g].map((v, i) => v === '1' ? `<rect x="${i % 5 * 5}" y="${Math.floor(i / 5) * 5}" width="4" height="4"/>` : '').join('')}</svg>`; });
G.cnt = s => `<span class="cnt">${s}</span>`;
G.more = (href, key = 'more.all') => `<a class="more" href="${href}">${esc(t(key))}</a>`;
/* panel header: icon, title, count badge, right side */
G.ph = (id, icon, color, title, count, right, tag = 'h2') =>
  `<div class="ph"><${tag} id="${id}">${icon ? G.ic(icon, color) : ''}${title}${count != null && count !== '' ? G.cnt(count) : ''}</${tag}><span class="r">${right || ''}</span></div>`;
G.grpH = (n, key) => `<div class="grp-h">${esc(t(key))}</div>`;   /* n kept for call sites; no numbering (owner 2026-11-18) */
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

/* ------------------------------------------------------------------ background: today's piece (web/art.js) */
/* Inputs: today's tokens, the Claude Code share of Claude Code + Codex requests, the 30-day cost trend, the cache hit rate.
   The template rotates by the local date of generatedAt in the page zone, so a snapshot always shows the same piece; ?art=N previews one. */
function art(){
  const lib = window.GLASSBOX_ART, cv = $('art'); if(!lib || !cv) return null;
  const TD = D.today, totTok = G.totTok(TD.tokens), req = a => (TD.byAgent.find(x => x.agent === a) || {}).requests || 0;
  const cc = req('claude-code'), cx = req('codex'), share = cc + cx ? cc / (cc + cx) : 1;
  const date = F.localDate(D.generatedAt) || (/^\d{4}-\d{2}-\d{2}/.test(D.generatedAt || '') ? D.generatedAt.slice(0, 10) : '');
  const qa = Q.get('art'), pick = /^\d{1,2}$/.test(qa || '') && lib.ENABLED.includes(+qa) ? +qa : null;
  const A = lib.create(cv, {tok: totTok, share, trend: D.trend.map(d => d.cc + d.cx), cache: totTok > 0 ? TD.cacheHitRate : 1}, {date, art: pick});
  if(!A) return null;
  const nn = String(A.id).padStart(2, '0');
  G.capText = () => {
    const name = t('art.name.' + nn);
    $('cap0').textContent = t('art.cap', {n: A.ymd, id: nn, name}) + (A.src ? ' · ' + t('art.credit', {src: A.src}) : '') + (A.id !== A.auto ? ' · ' + t('art.preview') : '');
    /* the split line only under pieces that draw their data in the two interface colours */
    $('capMid').innerHTML = A.split ? `<span style="color:${BLUE}">■</span> Claude Code ${F.pct(share)}&emsp;<span style="color:${OR}">■</span> Codex ${F.pct(1 - share)}` : '';
    /* narrow screens (the art's own phone breakpoint) use a shorter legend where the drawn count differs from the full one */
    const lk = cv.clientWidth < 640 && G.has('art.legendS.' + nn) ? 'art.legendS.' + nn : 'art.legend.' + nn;
    $('cap1').textContent = t(lk, {n: F.n(A.n), tok: F.tok(totTok)});
    cv.setAttribute('aria-label', t('art.aria', {name, enc: t('art.enc.' + nn)}));
  };
  G.art = A;
  return A;
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
  document.querySelectorAll('#nav a, #tabs a').forEach(a => { if(a.dataset.route === r.name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  header();
  if(G.capText) G.capText();
  if(!D.ok){ view.innerHTML = `<div class="nogb">${esc(t('nodata'))}</div>`; return; }
  const sameRoute = lastRoute === r.name;
  const y = scrollY;
  view.innerHTML = G.pages[r.name](r.params);
  G.runFits();
  if(!G.STATIC && !sameRoute && !keep){ document.body.classList.remove('anim'); void document.body.offsetWidth; document.body.classList.add('anim'); rollAll(); }
  if(!sameRoute && !keep) scrollTo(0, 0); else scrollTo(0, y);
  afters.forEach(f => f());                     /* after the scroll reset, so a section jump (sec=) is kept */
  lastRoute = r.name;
  tick(G.STATIC ? (FROZEN || 0) : (performance.now() - start) / 1000, true);
};
let start = performance.now();
G.boot = () => {
  applyStatic(); tabIcons();
  const A = D.ok ? art() : null;
  if(!A) $('art').setAttribute('aria-hidden', 'true');
  if(!G.STATIC) document.body.classList.add('anim');
  G.render();
  addEventListener('hashchange', () => G.render());
  const drawAll = (Tm, force) => { if(A && A.draw) A.draw(Tm + 6); tick(Tm, force); };
  /* about 25 frames a second; after a slow frame wait longer, so drawing never takes more than about a third of the main thread */
  let lastF = 0, gap = 40;
  function frame(ts){ requestAnimationFrame(frame); if(document.hidden || ts - lastF < gap) return; lastF = ts;
    const t0 = performance.now(); drawAll((t0 - start) / 1000); gap = Math.max(40, Math.min(500, (performance.now() - t0) * 3)); }
  if(FROZEN !== null) drawAll(FROZEN, true); else if(REDUCE) drawAll(8, true); else { drawAll(0, true); requestAnimationFrame(frame); }
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { G.runFits(); if(G.capText) G.capText(); if(A && A.relayout) A.relayout(); if(G.STATIC) drawAll(FROZEN !== null ? FROZEN : 8, true); }, 120); });
};
})();
