/* glassbox pages: #/ overview (c-v9), #/usage, #/code, #/machines, #/services. All interface text goes
   through t() (web/i18n.js); data text (project names, commit titles, model names) is shown as is. */
(function(){
'use strict';
const G = window.GLASSBOX_APP, D = G.D, P = G.pages, F = G.F, t = G.t, esc = G.esc, T = G.T, bd = G.bd, C = G.C;
const sum = G.sum, max = G.max;
const PUBLIC = D.view === 'public';
const AGENTS = ['claude-code', 'codex'];

/* ================================================================== shared pieces */
const totals = () => D.trend.map(d => d.cc + d.cx);
function avgLast(xs, n){ const s = xs.slice(-n); return s.length ? sum(s) / s.length : 0; }
const byAgent = list => Object.fromEntries(list.map(a => [a.agent, a]));
const machineIds = () => D.machines.map(m => m.id);

function kpi(labKey, valHtml, sub, cls = ''){
  return `<div><p class="lab">${esc(t(labKey))}</p><div class="val ${cls}">${valHtml}</div><div class="sub">${sub || '&nbsp;'}</div></div>`;
}
function costDelta(cost, avg){
  if(!(avg > 0)) return '';
  const dv = cost / avg - 1, cls = dv > 0.2 ? 'c-warn' : dv < -0.2 ? 'c-ok' : '';
  return `<span class="${cls}">${dv >= 0 ? '▲' : '▼'} ${F.pct(Math.abs(dv))}</span> ${esc(t('kpi.vsAvg', {v: F.usd(avg)}))}`;
}

/* quota windows */
function quotaArticle(q, i, multi){
  const P_ = G.pace(q, D.T0), f = q.usedPct / 100, cls = G.lvlCls(f);
  return `<article><div class="qh"><b>${G.agTag(q.agent)} ${G.lbl('win.', q.window)}${multi ? ' ' + G.code(q.account) : ''}</b><span class="val ${cls}" style="font-size:22px">${F.pctN(q.usedPct).replace(/[.,]0(?=\D*$)/, '')}</span></div>
    ${G.fit('qb-' + i, w => qbar(q, w))}
    <div class="qf"><span>${esc(t('quota.reset', {t: F.when(q.resetsAt)}))} · <span data-cd="${esc(q.resetsAt || '')}">${isFinite(P_.reset) ? F.cd(P_.reset - D.T0) : '—'}</span></span>${bd(esc(t(P_.hot ? 'quota.hot' : 'quota.calm')), P_.hot ? 'c-warn' : 'c-ok')}</div>
    <div class="qf" style="margin-top:3px"><span>${esc(P_.txt)}</span><span>${esc(t('quota.sample', {t: F.ago(q.sampledAt)}))}</span></div></article>`;
}
function qbar(q, w){
  const P_ = G.pace(q, D.T0), p = 5, nc = Math.max(1, Math.floor(w / p)), u = Math.round(q.usedPct / 100 * nc), m = Math.min(nc - 1, Math.round(P_.e * nc));
  const li = G.lvlIdx(q.usedPct / 100);
  return `<div class="qbar">${G.cells(nc, 3, c => { if(c === m && isFinite(P_.reset)) return [1, 1, 'qmark']; return c < u ? [0.55 + 0.4 * (c / nc), li] : [0.1, 0]; }, {pitch: p, px: 4})}</div>`;
}
function quotaPanel(id, withMore){
  const multi = G.multiAcct();
  const right = esc(t('quota.paceMark')) + (withMore ? ' ' + G.more('#/usage?sec=quota') : '');
  return G.pn(id, G.ph(id, 'gauge', 'or', esc(t('quota.title')), esc(t('quota.windows', {n: D.quota.length})), right) +
    (D.quota.length ? `<div class="qs">${D.quota.map((q, i) => quotaArticle(q, i, multi)).join('')}</div>` : G.empty()));
}

/* machines, one per line */
function probeBadge(m){
  return m.probeLastReport ? bd(esc(t('mach.probe', {t: F.ago(m.probeLastReport)})), (D.T0 - Date.parse(m.probeLastReport)) > 9e5 ? 'c-warn' : 'c-ok') : bd(esc(t('mach.noProbe')), 'c-dim');
}
function metrics(s){
  if(!s) return [];
  const pct = (a, b) => b ? a / b : 0;
  return [['mach.cpu', s.cpuPct / 100, F.pctN(s.cpuPct)],
    ['mach.mem', pct(s.memUsed, s.memTotal), `${F.bytes(s.memUsed)} / ${F.bytes(s.memTotal)}`],
    ['mach.disk', pct(s.diskUsed, s.diskTotal), `${F.bytes(s.diskUsed)} · ${F.pct(pct(s.diskUsed, s.diskTotal))}`]];
}
function metricHtml([k, f, v]){
  return `<div class="metric"><div class="lab"><span>${esc(t(k))}</span><b class="${f >= 0.75 ? G.lvlCls(f) : ''}">${esc(v)}</b></div>${G.bar(f, G.lvlIdx(f))}</div>`;
}
function liveAgents(id){
  return D.runtimes.filter(r => r.machine === id && r.activeSessions > 0 && !r.stale).map(r => bd(`${G.AG(r.agent)} ${F.n(r.activeSessions)}`, G.agCls(r.agent), true, '', true)).join(' ');
}
function machineLine(m, i){
  const s = m.system, met = metrics(s), ag = liveAgents(m.id);
  const side = m.online ? (s && s.uptimeSec != null ? esc(t('mach.uptime', {d: F.dur(s.uptimeSec)})) : '') : esc(t('mach.offlineFor', {t: F.ago(m.lastSeen)}));
  return `<div class="mline${m.online ? '' : ' off'}">
    <div class="id"><div class="mh">${G.mc(m.id)}<b>${T(m.label)}</b></div>
      <div class="bds">${bd(esc(t(m.online ? 'mach.online' : 'mach.offline')), m.online ? 'c-ok' : 'c-bad', true, '', m.online)}${m.os ? bd(G.OS(m.os), 'c-dim') : ''}${m.role ? bd(G.lbl('role.', m.role), 'c-vio') : ''}</div></div>
    ${met.length ? met.map(metricHtml).join('') : `<div class="nodata" style="grid-column:span 3">${esc(t('mach.noSystem'))}</div>`}
    <div class="spark" title="${esc(t('mach.cpu24'))}">${G.fit('sp-' + i, (w, el) => spark(m.history.map(h => h.cpuPct), w, +(el.dataset.k || 0)))}<span class="rp" title="${esc(t('mach.replayTip'))}" hidden>${esc(t('mach.replay'))}</span></div>
    <div class="side"><span>${side}</span><div class="bds" style="justify-content:flex-end">${probeBadge(m)}${ag ? ' ' + ag : ''}</div></div>
  </div>`;
}
function spark(vals, w, k = 0){
  vals = vals.filter(v => v != null); const n = vals.length;
  if(!n) return `<span class="nodata">${esc(t('mach.noHistory'))}</span>`;
  const NR = 9, mx = Math.max(20, ...vals), full = Math.min(Math.floor(w / 3), Math.max(1, Math.floor(w / 3 / n)) * n);   /* scale and width of the full chart */
  const win = k ? replayWindow(n, k) : {start: 0, len: n}, per = Math.max(1, Math.floor(full / win.len)), nc = Math.min(Math.floor(w / 3), per * win.len);
  return G.cells(nc, NR, (c, r) => { const d = win.start + Math.min(win.len - 1, Math.floor(c / per)), v = vals[d] / mx * NR, rb = NR - 1 - r; return rb + 0.5 <= v ? [0.5 + 0.45 * rb / NR, 0] : [0.06, 0]; }, {pitch: 3, px: 2.4});
}

/* replay of the 24h CPU sparks (B2). Step 0 is the full chart: the default, the static frame (?t=, reduced motion) and what the tooltip
   describes. While a spark is on screen, steps 1.. show a window of half the history that slides one sample per second from the oldest
   start to the newest end, holds the newest window for PAUSE seconds, then starts over. Off screen it returns to step 0. The "replay" mark
   shows only while replaying. One timer; it stops itself when a render replaces the list. */
const PAUSE = 2;
function replayWindow(n, k){ const len = Math.max(2, Math.floor(n / 2)), last = n - len; return {start: Math.min(k - 1, last), len}; }
const replaySteps = n => n - Math.max(2, Math.floor(n / 2)) + 1 + PAUSE;      /* steps per cycle, k = 1 .. replaySteps */
let rpTimer = 0, rpObs = null;
function replaySparks(){
  clearInterval(rpTimer); if(rpObs) rpObs.disconnect(); rpObs = null;
  const els = [...document.querySelectorAll('.mline .spark')].map(el => ({el, f: el.querySelector('[id^="sp-"]'), rp: el.querySelector('.rp')}))
    .filter(x => x.f && x.f.querySelector('svg'));
  if(G.STATIC || !els.length || !('IntersectionObserver' in window)) return;
  const byEl = new Map(els.map(x => [x.el, x])), seen = new Set();
  const vals = x => { const m = D.machines[+x.f.id.slice(3)]; return m ? m.history.map(h => h.cpuPct) : []; };
  const show = (x, k) => { const w = x.f.clientWidth; if(!w) return false; x.f.dataset.k = k; x.f.innerHTML = spark(vals(x), w, k); if(x.rp) x.rp.hidden = !k; return true; };
  rpObs = new IntersectionObserver(es => es.forEach(e => { const x = byEl.get(e.target); if(e.isIntersecting) seen.add(e.target);
    else { seen.delete(e.target); if(x && +x.f.dataset.k) show(x, 0); } }));
  els.forEach(x => rpObs.observe(x.el));
  rpTimer = setInterval(() => {
    if(!els[0].el.isConnected){ clearInterval(rpTimer); if(rpObs) rpObs.disconnect(); rpObs = null; return; }
    if(document.hidden) return;
    els.forEach(x => { if(!seen.has(x.el)) return; const n = vals(x).filter(v => v != null).length; if(n < 4) return;
      show(x, (+x.f.dataset.k || 0) % replaySteps(n) + 1); });
  }, 1000);
}

/* commit heatmap */
function heat(w, days, mobileWeeks){
  if(!days.length) return G.empty();
  const W = Math.ceil(days.length / 7), WN = w < 600 ? Math.min(W, mobileWeeks) : W, C0 = W - WN;
  const p = Math.max(5, Math.min(24, Math.floor((w - 22) / WN))), px = Math.max(4, Math.round(p * 0.74));
  const lvl = v => v === 0 ? 0 : v < 4 ? 1 : v < 10 ? 2 : v < 20 ? 3 : 4, AL = [0.07, 0.3, 0.52, 0.78, 1];
  const rects = [];
  for(let c = 0; c < WN; c++) for(let r = 0; r < 7; r++){
    const d = days[(C0 + c) * 7 + r]; if(!d) continue; const l = lvl(d.count);
    rects.push(`<rect x="${(c * p + (p - px) / 2).toFixed(1)}" y="${(r * p + (p - px) / 2).toFixed(1)}" width="${px}" height="${px}" fill="${l === 4 ? C.HI : C.BLUE}" fill-opacity="${AL[l]}" data-tip="${esc(t('heat.tip', {d: F.dfull(d.date), n: F.n(d.count)}))}"/>`);
  }
  let lab = '', last = -9;
  for(let k = 0; k < WN; k++){ const d = days[(C0 + k) * 7]; if(!d || !d.date) continue; const dd = parseInt(d.date.slice(8, 10), 10);
    if(dd <= 7 && k - last >= Math.ceil(34 / p)){ last = k; lab += `<span class="ml" style="left:${k * p}px">${esc(F.mon(d.date))}</span>`; } }
  const wl = [1, 3, 5].map(d => `<span class="wl" style="top:${(d + 0.5) * p}px">${esc(F.wkn(d))}</span>`).join('');
  return `<div class="heat">${lab}${wl}<svg width="${WN * p}" height="${7 * p}" viewBox="0 0 ${WN * p} ${7 * p}" role="img" aria-label="${esc(t('heat.aria'))}">${rects.join('')}</svg></div>`;
}
const heatLegend = () => esc(t('heat.less')) + ' ' + [0.07, 0.3, 0.52, 0.78, 1].map((a, i) => `<i style="background:${i === 4 ? C.HI : C.BLUE};opacity:${Math.max(a, 0.16)}"></i>`).join('') + ' ' + esc(t('heat.more'));
function streaks(days){
  const counts = days.map(d => d.count); let cur = 0, best = 0, run = 0;
  for(let i = counts.length - 1; i >= 0 && counts[i] > 0; i--) cur++;
  for(const c of counts){ run = c > 0 ? run + 1 : 0; best = Math.max(best, run); }
  return {active: counts.filter(v => v > 0).length, cur, best, peak: max(counts)};
}

/* commits / activity: compact timeline cards (S17 activity design B), shared by #/ and #/code. Collapsed: title,
   repo tag, unpushed badge, short hash, file count; the card head opens a drawer with author, branch, hash, source,
   machine, files and the diff link. author / files / nFiles are optional (S17 R09) and only drawn when present. */
const SRC = {github: ['src.github', 'c-dim'], gitea: ['src.gitea', 'c-vio'], local: ['src.local', 'c-fg']};
function srcBadge(s){ const [k, c] = SRC[s] || [null, 'c-dim']; return bd(k ? esc(t(k)) : esc(s), c); }
let commitN = 0, fxNext = false, fxTimer = 0;
const nFiles = a => a.nFiles ?? (a.files ? a.files.length : null);   /* nFiles wins: the list may be truncated */
const nCommits = n => t(n === 1 ? 'code.oneCommit' : 'code.nCommits', {n: F.n(n)});
/* a path never wraps: the directory gives way first (ellipsis in the middle), the file name stays */
function filePath(p){ const i = p.lastIndexOf('/');
  return `<span class="fp" title="${esc(p)}"><span class="dir">${esc(p.slice(0, i + 1))}</span><span class="base">${esc(p.slice(i + 1))}</span></span>`; }
const fileRow = f => `<li><span class="fs fs-${f.s}" title="${esc(t('commit.fs.' + f.s))}">${f.s}</span>${filePath(f.p)}</li>`;
function filesBlock(a, key){
  const n = nFiles(a); if(n == null) return '';
  /* paths only for a public, pushed repo (BACKLOG B4); otherwise the count alone */
  if(!a.files || !a.files.length || !a.public || !a.pushed) return `<div class="nf">${esc(t(n === 1 ? 'commit.oneFile' : 'commit.nFiles', {n: F.n(n)}))}</div>`;
  const rest = a.files.slice(3);
  return `<ul class="files">${a.files.slice(0, 3).map(fileRow).join('')}</ul>` + (rest.length ? `<div class="fold" id="cf-${key}"><div><ul class="files">${rest.map(fileRow).join('')}</ul></div></div>
    <button class="fmore" type="button" aria-expanded="false" aria-controls="cf-${key}" data-n="${rest.length}">${esc(t('commit.moreFiles', {n: F.n(rest.length)}))}</button>` : '');
}
function commitCard(a, i, fx){
  const key = 'cm' + (commitN++), n = nFiles(a), url = G.safeLink(a.url), cut = PUBLIC && !a.public && a.t,   /* export cuts private commit times to the hour: show the hour only */
    hm = !a.t ? '\u2014' : cut ? t('time.hourOnly', {h: F.hm(a.t).split(':')[0].replace(/^24$/, '00')}) : F.hm(a.t);
  const hue = a.public && typeof a.repo === 'string' ? G.hue(a.repo) : 'var(--ink-3)';
  const facts = [a.author && ['commit.author', esc(a.author), 'tx'], a.branch && ['commit.branch', esc(a.branch)], a.hash && ['commit.hash', esc(a.hash)],
    ['commit.source', srcBadge(a.source), 'vis'], a.machine && ['commit.machine', G.mc(a.machine), 'vis']].filter(Boolean);
  return `<li class="cm${a.pushed ? '' : ' un'}${fx ? ' enter' : ''}" style="--c:${hue};--i:${i}"><time class="tm" datetime="${esc(a.t || '')}" title="${esc(cut ? F.md(a.t) + ' ' + hm : F.full(a.t))}">${esc(hm)}</time><span class="ring" aria-hidden="true"></span>
    <article class="card"><button class="hd" type="button" aria-expanded="false" aria-controls="cd-${key}">
      <span class="ttl">${G.ttl(a.title)}</span>
      <span class="cm-m">${G.repoTag(a.repo)}${a.pushed ? '' : bd(esc(t('commit.unpushed')), 'c-warn')}${a.hash ? `<span class="hash">${esc(a.hash.slice(0, 7))}</span>` : ''}<span class="tt">${esc(hm)}</span></span>
      <span class="side">${n != null ? `<span class="nf">${esc(t(n === 1 ? 'commit.oneFile' : 'commit.nFiles', {n: F.n(n)}))}</span>` : ''}<i class="chev" aria-hidden="true"></i></span>
    </button><div class="dr" id="cd-${key}"><div><div class="dri">
      <dl class="facts">${facts.map(([k, v, c]) => `<dt>${esc(t(k))}</dt><dd${c ? ` class="${c}"` : ''}>${v}</dd>`).join('')}</dl>
      ${n != null ? `<div>${filesBlock(a, key)}</div>` : ''}${url ? `<div><a class="ext dl" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(t('commit.diff'))}</a></div>` : ''}
    </div></div></div></article></li>`;
}
/* day groups: "Today · 6 commits"; dayCounts come from the whole filtered list, so a paged list still shows the day total */
function timeline(shown, all, id){
  const fx = fxNext; fxNext = false;
  const dayOf = c => c.t ? F.localDate(c.t) : '', per = new Map();
  all.forEach(c => { const d = dayOf(c); per.set(d, (per.get(d) || 0) + 1); });
  const today = F.localDate(D.generatedAt), yest = D.generatedAt ? F.localDate(new Date(D.T0 - 864e5).toISOString()) : '';
  let h = '', last = null, i = 0;
  for(const c of shown){ const d = dayOf(c);
    if(d !== last){ last = d;
      const lab = !d ? '\u2014' : d === today ? t('code.today') : d === yest ? t('code.yesterday') : F.dfull(d);
      h += `<li class="day${fx ? ' enter' : ''}" style="--i:${i++}"><h3${d ? ` title="${esc(F.dfull(d))}"` : ''}>${esc(lab)} <span class="dn">\u00b7 ${esc(nCommits(per.get(d)))}</span></h3></li>`; }
    h += commitCard(c, i++, fx); }
  return `<ol class="tl"${id ? ` id="${id}"` : ''}>${h}</ol>`;
}
document.addEventListener('click', e => {
  const el = e.target.closest && e.target.closest('.cm .hd, .fmore, .segb a');
  if(!el) return;
  if(el.matches('.hd')){ const card = el.parentElement, open = !card.classList.contains('open');
    card.classList.toggle('open', open); el.setAttribute('aria-expanded', String(open)); return; }
  if(el.matches('.fmore')){ const f = G.$(el.getAttribute('aria-controls')); if(!f) return; const open = !f.classList.contains('open');
    f.classList.toggle('open', open); el.setAttribute('aria-expanded', String(open));
    el.textContent = t(open ? 'commit.fold' : 'commit.moreFiles', {n: F.n(+el.dataset.n)}); return; }
  /* filter switch: fade the list out, then render the new filter with a staggered rise; static mode just follows the link */
  const tl = G.$('c-tl');
  if(G.STATIC || !tl || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault(); const href = el.getAttribute('href'), from = location.hash; tl.classList.add('out');
  /* one pending switch at a time: a second click replaces the first, and a navigation in between cancels it */
  clearTimeout(fxTimer);
  fxTimer = setTimeout(() => { if(location.hash !== from || !G.$('c-tl')) return; history.pushState(null, '', href); fxNext = true; G.render(true); fxNext = false; }, 110);
});

/* service rows */
const ST_CLS = {up: 'c-ok', down: 'c-bad', pending: 'c-warn', maintenance: 'c-vio', paused: 'c-warn', unknown: 'c-dim'};
const stBadge = s => bd(G.lbl('st.', s), ST_CLS[s] || 'c-dim', true, '', s === 'up');
const upCls = u => u == null ? '' : u >= 99.9 ? 'c-ok' : u >= 99 ? '' : u >= 97 ? 'c-warn' : 'c-bad';
const pctOr = v => v == null ? '—' : F.pctN(v);
let svcN = 0;
function serviceRows(list, full){
  const head = `<tr><th>${esc(t('svc.name'))}</th><th>${esc(t('svc.status'))}</th><th class="hide-s">${esc(t('svc.machine'))}</th><th class="v">${esc(t('svc.up24'))}</th><th class="v hide-s">${esc(t('svc.cpu'))}</th><th class="v">${esc(t('svc.mem'))}</th></tr>`;
  return head + list.map(r => {
    const key = 's' + (svcN++);
    G.detail(key, () => `<div class="box"><dl class="facts">${[
      ['svc.name', T(r.name)], ['svc.kind', G.lbl('kind.', r.kind)], ['svc.kindHint', esc(t('kindHint.' + (r.kind || 'unknown')))],
      ['svc.status', stBadge(r.status)], ['svc.machine', r.machine ? G.mc(r.machine) : esc(t('svc.noMachine'))],
      ['svc.up24', pctOr(r.uptimePct24h)], ['svc.cpu', pctOr(r.cpuPct)], ['svc.mem', r.memBytes == null ? '—' : esc(F.bytes(r.memBytes))]
    ].map(([k, v]) => `<dt>${esc(t(k))}</dt><dd>${v}</dd>`).join('')}</dl></div>`);
    return `<tr ${G.xattrs(key)}><td class="n"><span class="tw">▸</span>${T(r.name)} <span class="rel">${G.lbl('kind.', r.kind)}</span></td><td>${stBadge(r.status)}</td><td class="k hide-s">${r.machine ? G.mc(r.machine) : '—'}</td>
      <td class="v ${upCls(r.uptimePct24h)}">${pctOr(r.uptimePct24h)}</td><td class="v hide-s">${pctOr(r.cpuPct)}</td><td class="v">${r.memBytes == null ? '—' : esc(F.bytes(r.memBytes))}</td></tr>
      <tr class="xd" id="xd-${key}" hidden><td colspan="6" data-slot></td></tr>`;
  }).join('');
}
const STATUS_ORDER = {down: 0, paused: 1, pending: 2, maintenance: 3, unknown: 4, up: 5};
const svcSort = (a, b) => (STATUS_ORDER[a.status] ?? 4) - (STATUS_ORDER[b.status] ?? 4) || G.Tplain(a.name).localeCompare(G.Tplain(b.name));

function runtimeRows(list, withMachine = true){
  if(!list.length) return `<tr><td class="k">${esc(t('none'))}</td></tr>`;
  return `<tr>${withMachine ? `<th>${esc(t('rt.machine'))}</th>` : ''}<th>${esc(t('rt.agent'))}</th><th class="v">${esc(t('rt.version'))}</th><th class="v">${esc(t('rt.processes'))}</th><th class="v">${esc(t('rt.active'))}</th></tr>` +
    list.map(r => `<tr${r.stale ? ' style="opacity:.45" title="' + esc(t('rt.stale')) + '"' : ''}>${withMachine ? `<td class="k">${G.mc(r.machine)}</td>` : ''}<td class="n">${G.agTag(r.agent)}</td><td class="v">${bd('v' + esc(r.version || '?'), 'c-dim')}</td><td class="v">${F.n(r.processes)}</td><td class="v ${r.activeSessions ? 'c-ok' : ''}">${r.activeSessions && !r.stale ? '<span class="st live" style="width:6px;height:6px;background:var(--sig-ok);margin-right:6px"></span>' : ''}${F.n(r.activeSessions)}</td></tr>`).join('');
}
function jobRows(list, full, withMachine = true){
  if(!list.length) return `<tr><td class="k">${esc(t('none'))}</td></tr>`;
  const head = full ? `<tr><th>${esc(t('job.name'))}</th><th>${esc(t('job.result'))}</th>${withMachine ? `<th>${esc(t('job.machine'))}</th>` : ''}<th class="v">${esc(t('job.lastRun'))}</th><th class="v">${esc(t('job.lastSuccess'))}</th></tr>` : '';
  return head + list.map(j => `<tr><td class="n">${T(j.name)}</td><td>${bd(esc(t(j.ok ? 'job.ok' : 'job.fail')), j.ok ? 'c-ok' : 'c-bad', true)}</td>${withMachine ? `<td class="k">${j.machine ? G.mc(j.machine) : '—'}</td>` : ''}${full ? `<td class="v" title="${esc(F.full(j.lastRun))}">${esc(F.ago(j.lastRun))}</td>` : ''}<td class="v" title="${esc(F.full(j.lastSuccess))}">${j.lastSuccess ? esc(F.ago(j.lastSuccess)) : esc(t('job.never'))}</td></tr>`).join('');
}

/* stacked daily cell chart: days [{date, parts:{key:value}}], series [{key,label,color}] bottom-up */
function stackChart(w, days, series, fmt, o = {}){
  const n = days.length; if(!n) return G.empty();
  const avail = w - 44, p = Math.max(2, Math.min(5, Math.floor(avail / n))), per = Math.max(1, Math.floor(avail / p / n)), nc = per * n, NR = Math.round((o.rows || (w < 500 ? 18 : 24)) * 5 / p), gapCol = per >= 3 ? per - 1 : -1;
  const tot = days.map(d => sum(series.map(s => d.parts[s.key] || 0))), mx = max(tot) || 1;
  const cum = days.map(d => { let acc = 0; return series.map(s => (acc += (d.parts[s.key] || 0)) / mx * NR); });
  const svg = G.cells(nc, NR, (c, r) => {
    const d = Math.floor(c / per); if(c % per === gapCol) return null;
    const f = tot[d] / mx * NR, rb = NR - 1 - r;
    if(rb + 0.55 <= f && tot[d] > 0){
      let si = cum[d].findIndex(v => v >= rb + 0.5); if(si < 0) si = series.length - 1;
      const top = f - rb <= 1.55;
      return [Math.min(1, top ? 1 : 0.42 + 0.42 * rb / f), series[si].color];
    }
    return [0.05, 0];
  }, {pitch: p, px: p >= 5 ? 4 : p * 0.75, overlay: (pp, W, H) => days.map((d, i) => {
    const lines = [F.dfull(d.date) + '  ' + fmt(tot[i])].concat(series.filter(s => d.parts[s.key]).slice().reverse().map(s => `  ${s.label}  ${fmt(d.parts[s.key])}`));
    return `<rect class="ov" x="${i * per * pp}" y="0" width="${per * pp}" height="${H}" data-tip="${esc(lines.join('\n'))}"/>`; }).join('')});
  const ys = [mx, mx / 2, 0].map((v, i) => `<span class="yl" style="top:${i === 0 ? 0 : i === 1 ? (NR * p / 2 - 7) : (NR * p - 12)}px">${esc(fmt === F.usd ? F.usd0(v) : F.tok(v))}</span>`).join('');
  return svg + ys;
}
function xLabels(dates, flat){
  if(!dates.length) return '';
  const idx = dates.length < 3 ? dates.map((_, i) => i) : [0, Math.floor((dates.length - 1) / 2), dates.length - 1];
  return `<div class="xl${flat ? ' flat' : ''}">${idx.map(k => `<span>${esc(F.dmd(dates[k]))}</span>`).join('')}</div>`;
}
/* series: label is plain text (tooltips); html, when given, is the legend markup */
const legend = series => `<span class="leg">${series.map(s => `<span><i style="background:${s.color}"></i>${s.html || esc(s.label)}</span>`).join('')}</span>`;

/* ================================================================== #/ overview */
P.overview = () => {
  commitN = 0; svcN = 0;
  const TD = D.today, TK = TD.tokens, tot = G.totTok(TK), tr = totals(), avg7 = avgLast(tr, 7), byA = byAgent(TD.byAgent);
  const active = sum(D.runtimes.filter(r => !r.stale).map(r => r.activeSessions));
  const todayN = esc(t('today.models', {n: TD.byModel.length})) + ' · ' + (TD.unpricedRequests ? `<span class="c-warn">${esc(t('today.unpriced', {n: F.n(TD.unpricedRequests)}))}</span>` : `<span class="c-ok">${esc(t('today.allPriced'))}</span>`);
  let h = G.grpH('01', 'grp.today');
  h += G.pn('h-today', G.ph('h-today', 'bolt', 'fg', esc(t('today.title')), todayN, esc(t('today.note')) + ' ' + G.more('#/usage')) + `<div class="kpis">
      ${kpi('kpi.requests', G.roll(TD.requests, 'n'), `<span class="c-fg">Claude ${F.n((byA['claude-code'] || {}).requests)}</span> · <span class="c-or">Codex ${F.n((byA.codex || {}).requests)}</span>`, 'c')}
      ${kpi('kpi.cost', G.roll(TD.costUsd, 'usd'), costDelta(TD.costUsd, avg7), 'g')}
      ${kpi('kpi.tokens', G.roll(tot, 'tok'), `↓${F.tok(TK.input)} · ↑${F.tok(TK.output)} · <span class="c-vio">⚡${F.tok(TK.reasoning)}</span>`)}
      ${kpi('kpi.hit', G.roll(TD.cacheHitRate, 'pct1'), esc(t('kpi.hitSub', {r: F.tok(TK.cacheRead), w: F.tok(TK.cacheWrite)})), 'v')}
      ${kpi('kpi.sessions', G.roll(TD.sessions, 'n'), esc(t('kpi.perSession', {n: F.n(TD.requests / Math.max(1, TD.sessions))})) + ` · <span class="c-ok">● ${esc(t('kpi.active', {n: F.n(active)}))}</span>`, 'w')}
    </div>`, 'hero');
  h += quotaPanel('h-quota', true);

  h += G.grpH('02', 'grp.machines');
  const online = D.machines.filter(m => m.online).length;
  h += G.pn('h-mach', G.ph('h-mach', 'server', 'ok', esc(t('mach.title')), esc(t('mach.onlineN', {a: online, b: D.machines.length})), esc(t('mach.src')) + ' ' + G.more('#/machines')) +
    (D.machines.length ? `<div class="mlist">${D.machines.map(machineLine).join('')}</div>` : G.empty()));
  G.after(replaySparks);

  h += G.grpH('03', 'grp.code');
  const st = streaks(D.contributions.days);
  h += G.pn('h-heat', G.ph('h-heat', 'grid', 'ok', esc(t('heat.title')), esc(t('heat.count', {n: F.n(D.contributions.total)})), esc(t('heat.range')) + ' ' + G.more('#/code')) +
    G.fit('heat', w => heat(w, D.contributions.days, 26)) +
    `<div class="hfoot"><span>${esc(t('heat.stat', {a: F.n(st.active), s: F.n(st.cur), m: F.n(st.peak)}))}</span><span class="hleg">${heatLegend()}</span></div>`);
  const ACT = D.activity.slice(0, 12);
  h += G.pn('h-act', G.ph('h-act', 'branch', 'bad', esc(t('act.title')), esc(t('act.count', {n: D.activity.length})),
      bd(esc(t('act.private', {n: D.activity.filter(a => !a.public).length})), 'c-dim') + ' ' + bd(esc(t('act.unpushed', {n: D.activity.filter(a => !a.pushed).length})), 'c-warn') + ' ' + G.more('#/code')) +
    (ACT.length ? timeline(ACT, D.activity) : G.empty()));

  h += G.grpH('04', 'grp.spend');
  h += `<div class="grid2">` + G.pn('h-trend', G.ph('h-trend', 'bars', 'or', esc(t('trend.title', {n: D.trend.length})), '',
      legend([{label: 'Claude Code', color: C.BLUE}, {label: 'Codex', color: C.OR}]) + ' ' + G.more('#/usage')) +
    `<div class="chart">${G.fit('trend', w => stackChart(w, D.trend.map(d => ({date: d.date, parts: {cx: d.cx, cc: d.cc}})), [{key: 'cx', label: 'Codex', color: C.OR}, {key: 'cc', label: 'Claude Code', color: C.BLUE}], F.usd, {rows: w < 500 ? 18 : 22}))}</div>` +
    xLabels(D.trend.map(d => d.date)) + trendStats(tr) + `<div class="sep"></div><table class="tb">${trendAgents()}</table><div class="sep"></div>
      <div class="lab" style="margin-bottom:6px">${esc(t('trend.weekday'))}</div>${G.fit('weekday', w => weekday(w, D.trend.map(d => ({date: d.date, v: d.cc + d.cx}))))}`) +
    G.pn('h-tok', G.ph('h-tok', 'pie', 'vio', esc(t('comp.title')), '', esc(t('comp.sub')) + ' ' + G.more('#/usage')) +
      `<table class="tb">${tokenRows(TK)}</table><div class="sep"></div><table class="tb">${modelRows(TD.byModel, false)}</table><div class="sep"></div><table class="tb">${projectRows(TD.byProject, false)}</table>`) + `</div>`;

  h += G.grpH('05', 'grp.ops');
  const svc = D.services.slice().sort(svcSort), bad = svc.filter(r => r.status === 'down').length;
  h += `<div class="grid2">` + G.pn('h-svc', G.ph('h-svc', 'box', 'ok', esc(t('svc.title')), esc(t('svc.count', {n: svc.length})),
      (D.hidden.has('services') ? '' : bad ? bd(esc(t('svc.bad', {n: bad})), 'c-bad', true) : bd(esc(t('svc.allOk')), 'c-ok', true)) + ' ' + G.more('#/services')) +
    (D.hidden.has('services') ? `<div class="hiddenpn">${esc(t('hidden.online'))}</div>` : svc.length ? `<table class="tb">${serviceRows(svc.slice(0, 12))}</table>${svc.length > 12 ? `<div class="hfoot"><span>${esc(t('svc.moreN', {n: svc.length - 12}))}</span></div>` : ''}` : G.empty()));
  const TN = D.tailnet;
  h += G.pn('h-rt', G.ph('h-rt', 'term', 'vio', esc(t('rt.title')), esc(t('rt.sum', {a: F.n(active), p: F.n(sum(D.runtimes.map(r => r.processes)))})), G.more('#/machines')) +
    `<table class="tb">${runtimeRows(D.runtimes)}</table><div class="sep"></div>
     <div class="ph sm"><h3>${esc(t('job.title'))}</h3><span class="r">${G.more('#/services?sec=jobs')}</span></div><table class="tb">${jobRows(D.jobs, false)}</table><div class="sep"></div>
     <div class="ph sm"><h3>${esc(t('tn.title'))}</h3><span class="r">${D.hidden.has('tailnet') ? '' : esc(t('tn.onlineN', {a: TN.filter(d => d.online).length, b: TN.length}))}</span></div>` +
    (D.hidden.has('tailnet') ? `<div class="hiddenpn">${esc(t('hidden.online'))}</div>` : TN.length ? `<div class="bds">${TN.map(d => bd(`${T(d.name)} <span style="opacity:.7">${esc(d.os || '')}</span>`, d.online ? 'c-ok' : 'c-dim', true)).join('')}</div>` : G.empty())) + `</div>`;
  return h;
};
function trendStats(tr){
  const s = sum(tr), cs = sum(D.trend.map(d => d.cx)), mx = max(tr), mi = tr.indexOf(mx);
  const it = (l, v, sub = '') => `<div><p class="lab">${esc(l)}</p><div class="val">${v}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  return `<div class="stats">${it(t('trend.total', {n: tr.length}), F.usd(s))}${it(t('trend.avg7'), F.usd(avgLast(tr, 7)))}${it(t('trend.peak'), F.usd(mx), mi >= 0 && D.trend[mi] ? esc(F.dmd(D.trend[mi].date)) : '')}${it(t('trend.codexShare'), s > 0 ? F.pct(cs / s) : '—')}</div>`;
}
function trendAgents(){
  const tot = sum(D.trend.map(d => d.cc + d.cx));
  return AGENTS.map(a => { const v = sum(D.trend.map(d => a === 'codex' ? d.cx : d.cc)), n = D.trend.filter(d => (a === 'codex' ? d.cx : d.cc) > 0).length;
    return `<tr><td class="n">${G.agTag(a)}</td><td class="bar">${G.bar(tot ? v / tot : 0, a === 'codex' ? 2 : 0)}</td><td class="v">${F.usd(v)}</td><td class="p">${esc(t('trend.daysUsed', {n}))}</td></tr>`; }).join('');
}
function weekday(w, rows){
  const acc = Array(7).fill(0), n = Array(7).fill(0);
  rows.forEach(d => { if(!d.date) return; const k = new Date(d.date + 'T00:00:00Z').getUTCDay(); acc[k] += d.v; n[k]++; });
  const avg = acc.map((v, i) => n[i] ? v / n[i] : 0), mx = max(avg), order = [1, 2, 3, 4, 5, 6, 0];
  const cw = Math.floor((w - 6 * 8) / 7);
  return `<div class="cols7">` + order.map(k => { const f = mx ? avg[k] / mx : 0, NR = 8, nc = Math.max(3, Math.floor(cw / 5));
    return `<div data-tip="${esc(F.wk(k) + '  ' + F.usd(avg[k]))}">${G.cells(nc, NR, (c, r) => NR - 1 - r + 0.5 <= f * NR ? [0.45 + 0.5 * f, k === 0 || k === 6 ? 6 : 0] : [0.06, 0], {pitch: 5, px: 4})}
      <div class="mf"><span>${esc(F.wk(k))}</span><span>${esc(F.usd0(avg[k]))}</span></div></div>`; }).join('') + '</div>';
}
function tokenRows(TK){
  const tot = G.totTok(TK) || 1;
  return [['tok.input', TK.input], ['tok.output', TK.output], ['tok.cacheRead', TK.cacheRead], ['tok.cacheWrite', TK.cacheWrite], ['tok.reasoning', TK.reasoning]]
    .map(([k, v]) => `<tr><td class="n">${esc(t(k))}</td><td class="bar">${G.bar(v / tot, 0)}</td><td class="v">${F.tok(v)}</td><td class="p">${F.pct1(v / tot)}</td></tr>`).join('');
}
function modelRows(list, detail, days){
  if(!list.length) return `<tr><td class="k">${esc(t('none'))}</td></tr>`;
  const mx = max(list.map(m => m.costUsd || 0)) || 1;
  return list.map((m, i) => {
    const key = detail ? 'm' + i : null;
    if(key) G.detail(key, w => seriesDetail(w, days, d => { const x = d.byModel.find(y => y.model === m.model && y.agent === m.agent); return x ? x.costUsd || 0 : 0; }, m.agent === 'codex' ? C.OR : C.BLUE, m.tokens, m.unpricedRequests));
    return `<tr${key ? ' ' + G.xattrs(key) : ''}><td class="n">${key ? '<span class="tw">▸</span>' : ''}${bd(esc(m.model), G.agCls(m.agent), true)}</td><td class="bar">${G.bar((m.costUsd || 0) / mx, m.agent === 'codex' ? 2 : 0)}</td><td class="v">${m.costUsd == null ? `<span class="c-warn">${esc(t('model.unpriced'))}</span>` : F.usd(m.costUsd)}</td><td class="p">${esc(t('req.n', {n: F.n(m.requests)}))}</td></tr>` +
      (key ? `<tr class="xd" id="xd-${key}" hidden><td colspan="4"><div class="box" data-slot></div></td></tr>` : '');
  }).join('');
}
function projectRows(list, detail, days){
  if(!list.length) return `<tr><td class="k">${esc(t('none'))}</td></tr>`;
  const BP = list.slice().sort((a, b) => b.costUsd - a.costUsd), mx = max(BP.map(p => p.costUsd)) || 1;
  return BP.map((p, i) => {
    const key = detail ? 'p' + i : null, pk = G.Tkey(p.project);
    if(key) G.detail(key, w => seriesDetail(w, days, d => { const x = d.byProject.find(y => G.Tkey(y.project) === pk); return x ? x.costUsd : 0; }, C.VIO, null, p.unpricedRequests, p.sessions));
    return `<tr${key ? ' ' + G.xattrs(key) : ''}><td class="n">${key ? '<span class="tw">▸</span>' : ''}${G.repoTag(p.project)}</td><td class="bar">${G.bar(p.costUsd / mx, 6)}</td><td class="v">${F.usd(p.costUsd)}</td><td class="p">${esc(t('req.n', {n: F.n(p.requests)}))}</td></tr>` +
      (key ? `<tr class="xd" id="xd-${key}" hidden><td colspan="4"><div class="box" data-slot></div></td></tr>` : '');
  }).join('');
}
/* expanded row of a model / project / agent: its daily cost over the selected range */
function seriesDetail(w, days, pick, color, tokens, unpriced, sessions){
  const vals = days.map(pick), act = vals.filter(v => v > 0).length;
  let h = `<div class="lab">${esc(t('detail.daily', {n: days.length}))}</div>` + miniBars(w, days.map(d => d.date), vals, color, F.usd) + xLabels(days.map(d => d.date), true);
  const facts = [['detail.activeDays', F.n(act)], ['detail.avgActive', act ? F.usd(sum(vals) / act) : '—']];
  if(sessions != null) facts.push(['kpi.sessions', F.n(sessions)]);
  if(unpriced) facts.push(['detail.unpriced', F.n(unpriced)]);
  if(tokens) facts.push(['tok.input', F.tok(tokens.input)], ['tok.output', F.tok(tokens.output)], ['tok.cacheRead', F.tok(tokens.cacheRead)], ['tok.cacheWrite', F.tok(tokens.cacheWrite)]);
  return h + `<div class="sep" style="height:8px"></div><dl class="facts">${facts.map(([k, v]) => `<dt>${esc(t(k))}</dt><dd>${v}</dd>`).join('')}</dl>`;
}
function miniBars(w, dates, vals, color, fmt, NR = 8){
  const n = vals.length; if(!n) return '';
  const p = Math.max(2, Math.min(4, Math.floor(w / n))), per = Math.max(1, Math.floor(w / p / n)), nc = per * n, mx = max(vals) || 1;
  NR = Math.round(NR * 4 / p);
  return G.cells(nc, NR, (c, r) => { const d = Math.floor(c / per); if(per >= 3 && c % per === per - 1) return null; const f = vals[d] / mx * NR, rb = NR - 1 - r;
    return rb + 0.5 <= f && vals[d] > 0 ? [0.5 + 0.45 * rb / NR, color] : [0.05, 0]; }, {pitch: p, px: p * 0.8,
    overlay: (pp, W, H) => vals.map((v, i) => `<rect class="ov" x="${i * per * pp}" y="0" width="${per * pp}" height="${H}" data-tip="${esc(F.dfull(dates[i]) + '  ' + fmt(v))}"/>`).join('')});
}

/* ================================================================== #/usage */
const MODEL_COLORS = ['#6c97d6', '#dba843', '#a48ee0', '#79b98a', '#5fb7b0', '#e07a8a', '#c68fd0', '#e3894d'];
function aggregate(days){
  const tot = {requests: 0, sessions: 0, unpriced: 0, cost: 0, tokens: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0}};
  const ag = new Map(), mo = new Map(), pr = new Map(), ma = new Map();
  for(const d of days){
    tot.requests += d.requests; tot.sessions += d.sessions; tot.unpriced += d.unpricedRequests; tot.cost += d.costUsd;
    for(const k in tot.tokens) tot.tokens[k] += d.tokens[k];
    for(const a of d.byAgent){ const x = ag.get(a.agent) || {agent: a.agent, requests: 0, sessions: 0, costUsd: 0, tokens: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0}};
      x.requests += a.requests; x.sessions += a.sessions; x.costUsd += a.costUsd; for(const k in x.tokens) x.tokens[k] += a.tokens[k]; ag.set(a.agent, x); }
    for(const m of d.byModel){ const key = m.model + '\u0000' + m.agent, x = mo.get(key) || {model: m.model, agent: m.agent, requests: 0, unpricedRequests: 0, costUsd: null, tokens: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0}};
      x.requests += m.requests; x.unpricedRequests += m.unpricedRequests; if(m.costUsd != null) x.costUsd = (x.costUsd || 0) + m.costUsd; for(const k in x.tokens) x.tokens[k] += m.tokens[k]; mo.set(key, x); }
    for(const p of d.byProject){ const key = G.Tkey(p.project), x = pr.get(key) || {project: p.project, public: p.public, requests: 0, sessions: 0, unpricedRequests: 0, costUsd: 0};
      x.requests += p.requests; x.sessions += p.sessions; x.unpricedRequests += p.unpricedRequests; x.costUsd += p.costUsd; pr.set(key, x); }
    for(const m of d.byMachine){ const x = ma.get(m.machine) || {machine: m.machine, requests: 0, sessions: 0, unpricedRequests: 0, costUsd: 0, tokens: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0}};
      x.requests += m.requests; x.sessions += m.sessions; x.unpricedRequests += m.unpricedRequests; x.costUsd += m.costUsd; for(const k in x.tokens) x.tokens[k] += m.tokens[k]; ma.set(m.machine, x); }
  }
  const byCost = (a, b) => (b.costUsd || 0) - (a.costUsd || 0) || b.requests - a.requests;
  return {tot, agents: [...ag.values()].sort(byCost), models: [...mo.values()].sort(byCost), projects: [...pr.values()].sort(byCost), machines: [...ma.values()].sort(byCost)};
}
function seg(items, cur, mk, cls = ''){
  return `<span class="seg${cls ? ' ' + cls : ''}" role="group">${items.map(([v, label]) => `<a href="${mk(v)}" aria-current="${String(v) === String(cur)}">${label}</a>`).join('')}</span>`;
}
P.usage = params => {
  const full = D.usageDays && D.usageDays.length;
  const ranges = full ? [7, 30, 90] : [7, 30];
  let range = parseInt(params.get('range') || '30', 10); if(!ranges.includes(range)) range = 30;
  const dims = full ? ['agent', 'model', 'project', 'machine'] : ['agent'];
  let dim = params.get('by') || 'agent'; if(!dims.includes(dim)) dim = 'agent';
  const metric = full && params.get('m') === 'requests' ? 'requests' : 'cost';
  const link = o => G.href('usage', {range, by: dim, m: metric === 'cost' ? null : metric, ...o});
  let h = '';
  const ctrl = `<div class="bar-f"><span class="flab">${esc(t('usage.range'))}</span>${seg(ranges.map(r => [r, esc(t('usage.days', {n: r}))]), range, v => link({range: v}))}</div>`;

  if(full){
    const days = D.usageDays.slice(-range), A = aggregate(days), tt = A.tot, totTok = G.totTok(tt.tokens), den = tt.tokens.input + tt.tokens.cacheRead + tt.tokens.cacheWrite;
    const activeDays = days.filter(d => d.requests > 0).length;
    h += G.grpH('01', 'usage.grpSummary');
    h += G.pn('u-sum', G.ph('u-sum', 'bolt', 'fg', esc(t('usage.summary')), esc(t('usage.days', {n: range})), esc(t('today.note'))) + ctrl + `<div class="kpis" style="--n:6">
      ${kpi('kpi.requests', G.roll(tt.requests, 'n'), esc(t('usage.perDay', {v: F.n(tt.requests / Math.max(1, activeDays))})), 'c')}
      ${kpi('kpi.cost', G.roll(tt.cost, 'usd'), esc(t('usage.perDay', {v: F.usd(tt.cost / Math.max(1, activeDays))})), 'g')}
      ${kpi('kpi.tokens', G.roll(totTok, 'tok'), `↓${F.tok(tt.tokens.input)} · ↑${F.tok(tt.tokens.output)}`)}
      ${kpi('kpi.hit', G.roll(den ? tt.tokens.cacheRead / den : 0, 'pct1'), esc(t('kpi.hitSub', {r: F.tok(tt.tokens.cacheRead), w: F.tok(tt.tokens.cacheWrite)})), 'v')}
      ${kpi('kpi.sessions', G.roll(tt.sessions, 'n'), esc(t('kpi.perSession', {n: F.n(tt.requests / Math.max(1, tt.sessions))})), 'w')}
      ${kpi('usage.activeDays', G.roll(activeDays, 'n'), tt.unpriced ? `<span class="c-warn">${esc(t('today.unpriced', {n: F.n(tt.unpriced)}))}</span>` : `<span class="c-ok">${esc(t('today.allPriced'))}</span>`)}
    </div>`, 'hero');

    /* stacked daily chart */
    let series, partOf;
    const val = x => metric === 'cost' ? (x.costUsd || 0) : x.requests;
    if(dim === 'agent'){
      series = [{key: 'codex', label: 'Codex', color: C.OR}, {key: 'claude-code', label: 'Claude Code', color: C.BLUE}];
      partOf = d => Object.fromEntries(d.byAgent.map(a => [a.agent, val(a)]));
    }else if(dim === 'machine'){
      const top = A.machines.slice(0, 7), keys = new Set(top.map(x => x.machine));
      series = top.map(x => ({key: x.machine, label: x.machine, html: G.mc(x.machine), color: G.mhex(x.machine)}));
      if(A.machines.length > top.length) series.push({key: '\u0000rest', label: t('usage.other'), color: C.DIM});
      series.reverse();
      partOf = d => { const o = {}; for(const x of d.byMachine){ const k = keys.has(x.machine) ? x.machine : '\u0000rest'; o[k] = (o[k] || 0) + val(x); } return o; };
    }else{
      const top = (dim === 'model' ? A.models : A.projects).slice(0, 7), keyOf = x => dim === 'model' ? x.model + '\u0000' + x.agent : G.Tkey(x.project);
      const keys = new Set(top.map(keyOf));
      series = top.map((x, i) => ({key: keyOf(x), label: dim === 'model' ? x.model : G.Tplain(x.project), html: dim === 'model' ? esc(x.model) : T(x.project), color: dim === 'model' ? MODEL_COLORS[i % MODEL_COLORS.length] : (typeof x.project === 'string' ? G.hueHex(x.project) : C.DIM)}));
      const rest = (dim === 'model' ? A.models : A.projects).length > top.length;
      if(rest) series.push({key: '\u0000rest', label: t('usage.other'), color: C.DIM});
      series.reverse();
      partOf = d => { const o = {}; for(const x of (dim === 'model' ? d.byModel : d.byProject)){ const k = keys.has(keyOf(x)) ? keyOf(x) : '\u0000rest'; o[k] = (o[k] || 0) + val(x); } return o; };
    }
    const fmt = metric === 'cost' ? F.usd : F.n;
    h += G.grpH('02', 'usage.grpDaily');
    h += G.pn('u-daily', G.ph('u-daily', 'bars', 'or', esc(t(metric === 'cost' ? 'usage.dailyCost' : 'usage.dailyReq')), esc(t('usage.days', {n: range})), legend(series.slice().reverse())) +
      `<div class="bar-f"><span class="flab">${esc(t('usage.by'))}</span>${seg(dims.map(d => [d, esc(t('usage.by.' + d))]), dim, v => link({by: v}))}
        <span class="flab">${esc(t('usage.metric'))}</span>${seg([['cost', esc(t('kpi.cost'))], ['requests', esc(t('kpi.requests'))]], metric, v => link({m: v === 'cost' ? null : v}))}</div>` +
      `<div class="chart">${G.fit('u-chart', w => stackChart(w, days.map(d => ({date: d.date, parts: partOf(d)})), series, fmt))}</div>` + xLabels(days.map(d => d.date)));

    h += G.grpH('03', 'usage.grpBreakdown');
    h += `<div class="grid2 even">` + G.pn('u-agent', G.ph('u-agent', 'term', 'vio', esc(t('usage.byAgent')), esc(t('usage.days', {n: range})), '') + `<table class="tb">${agentRows(A.agents, tt.cost, days)}</table>`) +
      G.pn('u-tok', G.ph('u-tok', 'pie', 'vio', esc(t('usage.tokens')), esc(t('usage.days', {n: range})), '') + `<table class="tb">${tokenRows(tt.tokens)}</table>`) + `</div>`;
    h += `<div class="grid2 even">` + G.pn('u-model', G.ph('u-model', 'chip', 'fg', esc(t('usage.byModel')), esc(t('usage.nModels', {n: A.models.length})), esc(t('detail.hint'))) + `<table class="tb">${modelRows(A.models, true, days)}</table>`) +
      G.pn('u-proj', G.ph('u-proj', 'list', 'ok', esc(t('usage.byProject')), esc(t('usage.nProjects', {n: A.projects.length})), esc(t('detail.hint'))) + `<table class="tb">${projectRows(A.projects, true, days)}</table>`) + `</div>`;
    h += G.pn('u-mach', G.ph('u-mach', 'server', 'ok', esc(t('usage.byMachine')), esc(t('usage.nMachines', {n: A.machines.length})), esc(t('detail.hint'))) + `<table class="tb">${machineRows(A.machines, tt.cost, days)}</table>`);
  }else{
    /* public snapshot: only the 30-day cost by agent and today's breakdown exist */
    const tr = D.trend.slice(-range);
    h += G.grpH('01', 'usage.grpDaily');
    h += G.pn('u-daily', G.ph('u-daily', 'bars', 'or', esc(t('usage.dailyCost')), esc(t('usage.days', {n: tr.length})), legend([{label: 'Claude Code', color: C.BLUE}, {label: 'Codex', color: C.OR}])) + ctrl +
      `<div class="chart">${G.fit('u-chart', w => stackChart(w, tr.map(d => ({date: d.date, parts: {cx: d.cx, cc: d.cc}})), [{key: 'cx', label: 'Codex', color: C.OR}, {key: 'cc', label: 'Claude Code', color: C.BLUE}], F.usd))}</div>` + xLabels(tr.map(d => d.date)) + trendStats(tr.map(d => d.cc + d.cx)));
    h += G.grpH('02', 'usage.grpToday');
    h += `<div class="grid2 even">` + G.pn('u-model', G.ph('u-model', 'chip', 'fg', esc(t('usage.todayModel')), esc(t('usage.nModels', {n: D.today.byModel.length})), '') + `<table class="tb">${modelRows(D.today.byModel, false)}</table>`) +
      G.pn('u-proj', G.ph('u-proj', 'list', 'ok', esc(t('usage.todayProject')), '', '') + `<table class="tb">${projectRows(D.today.byProject, false)}</table>`) + `</div>`;
  }

  /* today by hour (private only) */
  const n0 = full ? 4 : 3;
  if(D.today.hourly && D.today.hourly.length){
    const hr = D.today.hourly.slice().sort((a, b) => a.hour - b.hour), reqs = hr.map(x => x.requests), cost = hr.map(x => x.costUsd);
    const peak = max(reqs), pk = reqs.indexOf(peak);
    h += G.grpH('0' + n0, 'usage.grpHourly');
    h += G.pn('u-hour', G.ph('u-hour', 'clock', 'fg', esc(t('usage.hourly')), esc(t('usage.hourPeak', {h: peak ? String(hr[pk].hour).padStart(2, '0') + ':00' : '—'})), legend([{label: t('kpi.requests'), color: C.BLUE}])) +
      `<div class="chart">${G.fit('u-hourc', w => hourChart(w, hr))}</div><div class="xl">${[0, 6, 12, 18, 23].map(x => `<span>${String(x).padStart(2, '0')}</span>`).join('')}</div>` +
      `<div class="stats">${[['usage.hourBusy', F.n(reqs.filter(v => v > 0).length)], ['kpi.requests', F.n(sum(reqs))], ['kpi.cost', F.usd(sum(cost))], ['usage.hourMaxCost', F.usd(max(cost))]].map(([k, v]) => `<div><p class="lab">${esc(t(k))}</p><div class="val">${v}</div></div>`).join('')}</div>`);
  }

  /* quota history */
  h += G.grpH('0' + (n0 + (D.today.hourly && D.today.hourly.length ? 1 : 0)), 'usage.grpQuota');
  h += `<div id="sec-quota"></div>` + quotaPanel('u-quota', false);
  if(D.quota.length){
    const multi = G.multiAcct();
    h += `<div class="grid2 even">` + D.quota.map((q, i) => G.pn('u-qh' + i, G.ph('u-qh' + i, 'gauge', 'or', `${G.agTag(q.agent)} ${G.lbl('win.', q.window)}${multi ? ' ' + G.code(q.account) : ''}`, esc(t('quota.samples', {n: q.history.length})), legend([{label: t('quota.used'), color: C.BLUE}, {label: t('quota.pace'), color: C.HI}]), 'h3') +
      G.fit('u-qc' + i, w => quotaChart(w, q)) + `<div class="xl flat"><span>${esc(F.when(isFinite(Date.parse(q.resetsAt)) ? new Date(Date.parse(q.resetsAt) - (G.WMS[q.window] || 0)).toISOString() : null))}</span><span>${esc(F.when(q.resetsAt))}</span></div>`)).join('') + `</div>`;
  }

  /* daily table */
  if(full){
    const days = D.usageDays.slice(-range).slice().reverse();
    h += G.grpH('0' + (n0 + 1 + (D.today.hourly && D.today.hourly.length ? 1 : 0)), 'usage.grpDays');
    h += G.pn('u-days', G.ph('u-days', 'list', 'fg', esc(t('usage.dayTable')), esc(t('usage.days', {n: range})), esc(t('detail.hint'))) + `<div class="tbw"><table class="tb">
      <tr><th>${esc(t('usage.date'))}</th><th class="v">${esc(t('kpi.requests'))}</th><th class="v hide-s">${esc(t('kpi.sessions'))}</th><th class="v hide-s">${esc(t('kpi.tokens'))}</th><th class="v hide-m">${esc(t('kpi.hit'))}</th><th class="v">${esc(t('kpi.cost'))}</th><th class="bar hide-s"></th></tr>
      ${dayRows(days)}</table></div>`);
  }
  if(params.get('sec') === 'quota') G.after(() => { const el = G.$('sec-quota'); if(el) el.scrollIntoView({block: 'start'}); });
  return h;
};
function agentRows(list, totCost, days){
  if(!list.length) return `<tr><td class="k">${esc(t('none'))}</td></tr>`;
  return `<tr><th>${esc(t('rt.agent'))}</th><th class="bar"></th><th class="v">${esc(t('kpi.cost'))}</th><th class="v hide-s">${esc(t('kpi.requests'))}</th><th class="v hide-s">${esc(t('kpi.sessions'))}</th></tr>` + list.map((a, i) => {
    const key = 'a' + i;
    G.detail(key, w => seriesDetail(w, days, d => { const x = d.byAgent.find(y => y.agent === a.agent); return x ? x.costUsd : 0; }, G.agCol(a.agent), a.tokens));
    return `<tr ${G.xattrs(key)}><td class="n"><span class="tw">▸</span>${G.agTag(a.agent)}</td><td class="bar">${G.bar(totCost ? a.costUsd / totCost : 0, a.agent === 'codex' ? 2 : 0)}</td><td class="v">${F.usd(a.costUsd)}</td><td class="v hide-s">${F.n(a.requests)}</td><td class="v hide-s">${F.n(a.sessions)}</td></tr>
      <tr class="xd" id="xd-${key}" hidden><td colspan="5"><div class="box" data-slot></div></td></tr>`;
  }).join('');
}
function machineRows(list, totCost, days){
  if(!list.length) return `<tr><td class="k">${esc(t('none'))}</td></tr>`;
  if(!days) return list.map(m => `<tr><td class="n">${G.mc(m.machine)}</td><td class="bar">${G.bar(totCost ? m.costUsd / totCost : 0, G.mhex(m.machine))}</td><td class="v">${F.usd(m.costUsd)}</td><td class="p">${esc(t('req.n', {n: F.n(m.requests)}))}</td></tr>`).join('');
  return `<tr><th>${esc(t('svc.machine'))}</th><th class="bar"></th><th class="v">${esc(t('kpi.cost'))}</th><th class="v hide-s">${esc(t('kpi.requests'))}</th><th class="v hide-s">${esc(t('kpi.sessions'))}</th></tr>` + list.map((m, i) => {
    const key = 'mc' + i;
    G.detail(key, w => seriesDetail(w, days, d => { const x = d.byMachine.find(y => y.machine === m.machine); return x ? x.costUsd : 0; }, G.mhex(m.machine), m.tokens, m.unpricedRequests, m.sessions));
    return `<tr ${G.xattrs(key)}><td class="n"><span class="tw">▸</span>${G.mc(m.machine)}</td><td class="bar">${G.bar(totCost ? m.costUsd / totCost : 0, G.mhex(m.machine))}</td><td class="v">${F.usd(m.costUsd)}</td><td class="v hide-s">${F.n(m.requests)}</td><td class="v hide-s">${F.n(m.sessions)}</td></tr>
      <tr class="xd" id="xd-${key}" hidden><td colspan="5"><div class="box" data-slot></div></td></tr>`;
  }).join('');
}
function dayRows(days){
  const mx = max(days.map(d => d.costUsd)) || 1;
  return days.map((d, i) => {
    const key = 'd' + i, tot = G.totTok(d.tokens);
    if(d.requests > 0) G.detail(key, () => `<div class="xd-grid grid"><div><div class="lab">${esc(t('usage.byModel'))}</div><table class="tb">${modelRows(d.byModel, false)}</table></div><div><div class="lab">${esc(t('usage.byProject'))}</div><table class="tb">${projectRows(d.byProject, false)}</table></div><div><div class="lab">${esc(t('usage.byMachine'))}</div><table class="tb">${machineRows(d.byMachine, d.costUsd, null)}</table></div></div>`);
    const attrs = d.requests > 0 ? G.xattrs(key) : '';
    return `<tr ${attrs}${d.requests ? '' : ' style="opacity:.45"'}><td class="k">${d.requests ? '<span class="tw">▸</span>' : '<span class="tw"></span>'}${esc(F.dfull(d.date))}</td><td class="v">${F.n(d.requests)}</td><td class="v hide-s">${F.n(d.sessions)}</td><td class="v hide-s">${F.tok(tot)}</td><td class="v hide-m">${d.requests ? F.pct1(d.cacheHitRate) : '—'}</td><td class="v">${F.usd(d.costUsd)}</td><td class="bar hide-s">${G.bar(d.costUsd / mx, 4)}</td></tr>` +
      (d.requests > 0 ? `<tr class="xd" id="xd-${key}" hidden><td colspan="7"><div class="box" data-slot></div></td></tr>` : '');
  }).join('');
}
function hourChart(w, hr){
  const n = 24, p = 5, per = Math.max(1, Math.floor((w - 44) / p / n)), nc = per * n, NR = w < 500 ? 12 : 16;
  const byH = Array(24).fill(null).map((_, i) => hr.find(x => x.hour === i) || {hour: i, requests: 0, costUsd: 0});
  const mx = max(byH.map(x => x.requests)) || 1;
  const svg = G.cells(nc, NR, (c, r) => { const d = Math.floor(c / per); if(per >= 3 && c % per === per - 1) return null; const f = byH[d].requests / mx * NR, rb = NR - 1 - r;
    return rb + 0.55 <= f && byH[d].requests > 0 ? [f - rb <= 1.55 ? 1 : 0.42 + 0.42 * rb / f, 0] : [0.05, 0]; }, {pitch: p, px: 4,
    overlay: (pp, W, H) => byH.map((x, i) => `<rect class="ov" x="${i * per * pp}" y="0" width="${per * pp}" height="${H}" data-tip="${esc(String(i).padStart(2, '0') + ':00  ' + t('req.n', {n: F.n(x.requests)}) + '  ' + F.usd(x.costUsd))}"/>`).join('')});
  return svg + [mx, mx / 2, 0].map((v, i) => `<span class="yl" style="top:${i === 0 ? 0 : i === 1 ? (NR * p / 2 - 7) : (NR * p - 12)}px">${esc(F.tok(v))}</span>`).join('');
}
function quotaChart(w, q){
  const reset = Date.parse(q.resetsAt || ''), W = G.WMS[q.window] || 7 * 864e5, t0 = reset - W;
  if(!isFinite(reset)) return G.empty();
  const p = 5, nc = Math.max(10, Math.floor(w / p)), NR = 14, now = D.T0;
  const hs = q.history.map(h => ({t: Date.parse(h.t), v: h.usedPct})).filter(h => isFinite(h.t)).sort((a, b) => a.t - b.t);
  const colT = c => t0 + (c + 0.5) / nc * W;
  const valAt = tm => { let v = null; for(const h of hs){ if(h.t <= tm) v = h.v; else break; } return v; };
  const lastSample = hs.length ? hs[hs.length - 1].t : -Infinity;
  const svg = G.cells(nc, NR, (c, r) => {
    const tm = colT(c), rb = NR - 1 - r, paceRow = (c + 0.5) / nc * NR;
    if(Math.abs(rb + 0.5 - paceRow) < 0.5) return [0.55, 1];
    if(tm > Math.max(now, lastSample)) return [0.04, 0];
    const v = valAt(tm); if(v == null) return [0.05, 0];
    const f = v / 100 * NR;
    return rb + 0.5 <= f ? [0.45 + 0.5 * rb / NR, G.lvlIdx(v / 100)] : [0.07, 0];
  }, {pitch: p, px: 4, overlay: (pp, Wd, H) => {
    const segs = 24, sw = Wd / segs;
    return Array.from({length: segs}, (_, i) => { const tm = t0 + (i + 1) / segs * W, v = tm > Math.max(now, lastSample) ? null : valAt(tm);
      return `<rect class="ov" x="${(i * sw).toFixed(1)}" y="0" width="${sw.toFixed(1)}" height="${H}" data-tip="${esc(F.when(new Date(tm).toISOString()) + '  ' + (v == null ? '—' : F.pctN(v)))}"/>`; }).join('');
  }});
  return svg;
}

/* ================================================================== #/code */
P.code = params => {
  commitN = 0; clearTimeout(fxTimer);
  const days = D.contributions.days, st = streaks(days);
  const commits = D.commits || D.activity, repos = D.repos;
  const unpushed = repos ? sum(repos.map(r => r.unpushed)) : commits.filter(c => !c.pushed).length;
  let h = G.grpH('01', 'code.grpYear');
  const n = D.contributions.official != null ? 6 : 5;
  h += G.pn('c-sum', G.ph('c-sum', 'grid', 'ok', esc(t('heat.title')), esc(t('heat.count', {n: F.n(D.contributions.total)})), esc(t('heat.range'))) + `<div class="kpis sm" style="--n:${n}">
    ${kpi('code.commitsYear', G.roll(D.contributions.total, 'n'), esc(t('code.dedup')), 'c')}
    ${D.contributions.official != null ? kpi('code.official', G.roll(D.contributions.official, 'n'), esc(t('code.officialSub'))) : ''}
    ${kpi('code.activeDays', G.roll(st.active, 'n'), esc(t('code.ofDays', {n: F.n(days.length)})), 'g')}
    ${kpi('code.streak', G.roll(st.cur, 'n'), esc(t('code.best', {n: F.n(st.best)})), 'w')}
    ${kpi(repos ? 'code.repos' : 'code.peak', G.roll(repos ? repos.length : st.peak, 'n'), repos ? esc(t('code.unpushedN', {n: F.n(unpushed)})) : '', 'v')}
  </div><div class="sep"></div>` + G.fit('c-heat', w => heat(w, days, 26)) + `<div class="hfoot"><span>${esc(t('heat.stat', {a: F.n(st.active), s: F.n(st.cur), m: F.n(st.peak)}))}</span><span class="hleg">${heatLegend()}</span></div>`, 'hero');

  /* rhythm: weekday (year) and hour of day (commit list) */
  const hours = Array(24).fill(0); commits.forEach(c => { const hh = c.t ? F.localHour(c.t) : null; if(hh !== null) hours[hh]++; });
  h += `<div class="grid2 even">` + G.pn('c-wk', G.ph('c-wk', 'bars', 'or', esc(t('code.byWeekday')), esc(t('code.yearAvg')), '') + G.fit('c-wkc', w => weekdayCount(w, days))) +
    G.pn('c-hr', G.ph('c-hr', 'clock', 'fg', esc(t('code.byHour')), esc(nCommits(commits.length)), '') + G.fit('c-hrc', w => hourCount(w, hours)) + `<div class="xl flat">${[0, 6, 12, 18, 23].map(x => `<span>${String(x).padStart(2, '0')}</span>`).join('')}</div>`) + `</div>`;

  /* repos */
  const repoF = params.get('repo');
  if(repos){
    h += G.grpH('02', 'code.grpRepos');
    const mx = max(repos.map(r => r.commits)) || 1;
    h += G.pn('c-repos', G.ph('c-repos', 'box', 'vio', esc(t('code.repos')), esc(t('code.nRepos', {n: repos.length})), esc(t('detail.hint'))) + (repos.length ? `<div class="tbw"><table class="tb">
      <tr><th>${esc(t('code.repo'))}</th><th class="hide-s">${esc(t('code.sources'))}</th><th class="bar hide-s"></th><th class="v">${esc(t('code.commits'))}</th><th class="v">${esc(t('code.unpushed'))}</th><th class="hide-m">${esc(t('code.machines'))}</th><th class="v">${esc(t('code.last'))}</th></tr>
      ${repos.map((r, i) => {
        const key = 'r' + i, name = typeof r.repo === 'string' ? r.repo : null;
        G.detail(key, () => { const list = name ? commits.filter(c => c.repo === name).slice(0, 8) : [];
          return `<div class="box"><dl class="facts"><dt>${esc(t('code.sources'))}</dt><dd>${r.sources.map(srcBadge).join(' ') || '—'}</dd><dt>${esc(t('code.machines'))}</dt><dd>${r.machines.map(m => G.mc(m)).join(' ') || '—'}</dd><dt>${esc(t('code.last'))}</dt><dd>${esc(F.full(r.lastCommit))}</dd><dt>${esc(t('commit.visibility'))}</dt><dd>${esc(t(r.public ? 'commit.public' : 'commit.private'))}</dd></dl>` +
            (list.length ? `<div class="sep" style="height:10px"></div><div class="lab">${esc(t('code.recent'))}</div><ul class="act">${list.map(c => `<li><time>${esc(F.when(c.t))}</time><span class="p bds">${srcBadge(c.source)}${c.pushed ? '' : ' ' + bd(esc(t('commit.unpushed')), 'c-warn', true)}</span><span class="d"><span>${esc(c.title)}</span><span class="rel">${esc(F.ago(c.t))}</span></span></li>`).join('')}</ul>` +
              `<div class="hfoot"><a class="more" href="${G.href('code', {repo: name})}">${esc(t('code.onlyRepo'))}</a></div>` : '') + `</div>`; });
        return `<tr ${G.xattrs(key)}><td class="n"><span class="tw">▸</span>${G.repoTag(r.repo)}</td><td class="hide-s"><span class="bds">${r.sources.map(srcBadge).join('')}</span></td><td class="bar hide-s">${G.bar(r.commits / mx, 0)}</td><td class="v">${F.n(r.commits)}</td><td class="v ${r.unpushed ? 'c-warn' : ''}">${r.unpushed ? F.n(r.unpushed) : '—'}</td><td class="k hide-m">${r.machines.map(m => G.mc(m)).join(' ')}</td><td class="v" title="${esc(F.full(r.lastCommit))}">${esc(F.ago(r.lastCommit))}</td></tr>
          <tr class="xd" id="xd-${key}" hidden><td colspan="7" data-slot></td></tr>`;
      }).join('')}</table></div>` : G.empty()));
  }

  /* commit list with filters: all / pushed / unpushed / public / private (src=; older values such as github count as all) */
  const FILT = {all: () => true, pushed: c => c.pushed, unpushed: c => !c.pushed, public: c => c.public, private: c => !c.public};
  let src = params.get('src') || 'all'; if(!Object.hasOwn(FILT, src)) src = 'all';
  const q = (params.get('q') || '').toLowerCase();
  let base = commits;
  if(repoF) base = base.filter(c => c.repo === repoF);
  if(q) base = base.filter(c => (c.title + ' ' + (typeof c.repo === 'string' ? c.repo : '') + ' ' + (c.branch || '') + ' ' + (c.hash || '')).toLowerCase().includes(q));
  const counts = Object.fromEntries(Object.keys(FILT).map(k => [k, base.filter(FILT[k]).length]));
  const list = base.filter(FILT[src]);
  const lk = o => G.href('code', {src: src === 'all' ? null : src, repo: repoF, q: q || null, n: null, ...o});
  h += G.grpH(repos ? '03' : '02', 'code.grpCommits');
  const LIMIT = Math.max(50, Math.min(500, parseInt(params.get('n') || '50', 10) || 50)), shown = list.slice(0, LIMIT);
  h += G.pn('c-list', G.ph('c-list', 'branch', 'bad', esc(t(D.commits ? 'code.commitList' : 'act.title')), esc(nCommits(list.length)), D.commits ? esc(t('code.listRange')) : '') +
    `<div class="bar-f">${seg(Object.keys(FILT).map(s => [s, `<span class="sl">${esc(t('code.f.' + s))}</span><small>${F.n(counts[s])}</small>`]), src, v => lk({src: v === 'all' ? null : v}), 'segb')}
      <input class="search" id="c-q" type="search" value="${esc(params.get('q') || '')}" placeholder="${esc(t('code.search'))}" aria-label="${esc(t('code.search'))}">
      ${repoF ? `<span class="bds">${G.repoTag(repoF)} <a class="clear" href="${lk({repo: null})}">${esc(t('filter.clear'))}</a></span>` : ''}</div>` +
    (shown.length ? timeline(shown, list, 'c-tl') + (list.length > LIMIT ? `<div class="hfoot"><span>${esc(t('code.limited', {n: F.n(LIMIT), m: F.n(list.length)}))}</span><a class="more" href="${lk({n: LIMIT + 100})}">${esc(t('code.showMore'))}</a></div>` : '') : G.empty('filter.none')));
  G.after(() => { const el = G.$('c-q'); if(!el) return; let tm;
    el.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { const pos = el.selectionStart; history.replaceState(null, '', lk({q: el.value || null})); G.render(true); const n2 = G.$('c-q'); if(n2){ n2.focus(); try{ n2.setSelectionRange(pos, pos); }catch(e){} } }, 250); }); });
  return h;
};
function weekdayCount(w, days){
  const acc = Array(7).fill(0), n = Array(7).fill(0);
  days.forEach(d => { if(!d.date) return; const k = new Date(d.date + 'T00:00:00Z').getUTCDay(); acc[k] += d.count; n[k]++; });
  const avg = acc.map((v, i) => n[i] ? v / n[i] : 0), mx = max(avg), order = [1, 2, 3, 4, 5, 6, 0], cw = Math.floor((w - 6 * 8) / 7);
  return `<div class="cols7">` + order.map(k => { const f = mx ? avg[k] / mx : 0, NR = 10, nc = Math.max(3, Math.floor(cw / 5));
    return `<div data-tip="${esc(F.wk(k) + '  ' + t('code.avgN', {n: F.n1(avg[k])}))}">${G.cells(nc, NR, (c, r) => NR - 1 - r + 0.5 <= f * NR ? [0.45 + 0.5 * f, k === 0 || k === 6 ? 6 : 4] : [0.06, 0], {pitch: 5, px: 4})}
      <div class="mf"><span>${esc(F.wk(k))}</span><span>${esc(F.n1(avg[k]))}</span></div></div>`; }).join('') + '</div>';
}
function hourCount(w, hours){
  const p = 5, per = Math.max(1, Math.floor(w / p / 24)), nc = per * 24, NR = 10, mx = max(hours) || 1;
  return G.cells(nc, NR, (c, r) => { const d = Math.floor(c / per); if(per >= 3 && c % per === per - 1) return null; const f = hours[d] / mx * NR, rb = NR - 1 - r;
    return rb + 0.5 <= f && hours[d] ? [0.45 + 0.5 * rb / NR, d < 7 || d >= 22 ? 6 : 0] : [0.05, 0]; }, {pitch: p, px: 4,
    overlay: (pp, W, H) => hours.map((v, i) => `<rect class="ov" x="${i * per * pp}" y="0" width="${per * pp}" height="${H}" data-tip="${esc(String(i).padStart(2, '0') + ':00  ' + nCommits(v))}"/>`).join('')});
}

/* ================================================================== #/machines */
/* per-machine roll-ups shared by the summary table, the header badges and the sections */
function machineFacts(m){
  const rts = D.runtimes.filter(r => r.machine === m.id), live = rts.filter(r => !r.stale);
  const svcs = D.services.filter(x => x.machine === m.id), jobs = D.jobs.filter(j => j.machine === m.id);
  const tba = m.todayByAgent;                         /* null when the field is absent (public snapshot) */
  return {rts, svcs, jobs, tba,
    agents: rts.length, proc: sum(rts.map(r => r.processes)), active: sum(live.map(r => r.activeSessions)),
    req: tba && tba.length ? sum(tba.map(a => a.requests)) : null, cost: tba && tba.length ? sum(tba.map(a => a.costUsd)) : null,
    up: svcs.filter(x => x.status === 'up').length, down: svcs.filter(x => x.status === 'down').length};
}
const HID = k => D.hidden.has(k);
const dash = '—';
function agentSection(m, f){
  if(HID('runtimes')) return `<div class="hiddenpn">${esc(t('hidden.online'))}</div>`;
  const by = new Map();
  f.rts.forEach(r => by.set(r.agent, {agent: r.agent, rt: r, today: null}));
  (f.tba || []).forEach(a => { const x = by.get(a.agent) || {agent: a.agent, rt: null, today: null}; x.today = a; by.set(a.agent, x); });
  const rows = [...by.values()].sort((x, y) => (AGENTS.indexOf(x.agent) + 9) % 9 - (AGENTS.indexOf(y.agent) + 9) % 9);
  if(!rows.length) return G.empty('mach.noAgent');
  const today = f.tba !== null;
  return `<div class="tbw"><table class="tb"><tr><th>${esc(t('rt.agent'))}</th><th class="v hide-s">${esc(t('rt.version'))}</th><th class="v">${esc(t('rt.processes'))}</th><th class="v">${esc(t('rt.active'))}</th><th>${esc(t('rt.state'))}</th>` +
    (today ? `<th class="v hide-s">${esc(t('mach.todayReq'))}</th><th class="v hide-s">${esc(t('mach.todaySes'))}</th><th class="v">${esc(t('mach.todayCost'))}</th>` : '') + `</tr>` +
    rows.map(({agent, rt, today: a}) => `<tr${rt && rt.stale ? ' style="opacity:.55"' : ''}><td class="n">${G.agTag(agent)}</td>
      <td class="v hide-s">${rt ? bd('v' + esc(rt.version || '?'), 'c-dim') : dash}</td><td class="v">${rt ? F.n(rt.processes) : dash}</td>
      <td class="v ${rt && rt.activeSessions && !rt.stale ? 'c-ok' : ''}">${rt ? (rt.activeSessions && !rt.stale ? '<span class="st live" style="width:6px;height:6px;background:var(--sig-ok);margin-right:6px"></span>' : '') + F.n(rt.activeSessions) : dash}</td>
      <td>${rt ? `<span${rt.stale ? ` title="${esc(t('rt.stale'))}"` : ''}>${bd(esc(t(rt.stale ? 'rt.staleShort' : 'rt.fresh')), rt.stale ? 'c-warn' : 'c-ok', true)}</span>` : bd(esc(t('rt.noRuntime')), 'c-dim')}</td>` +
      (today ? `<td class="v hide-s">${a ? F.n(a.requests) : dash}</td><td class="v hide-s">${a ? F.n(a.sessions) : dash}</td><td class="v">${a ? F.usd(a.costUsd) + (a.unpricedRequests ? ` <span class="c-warn" title="${esc(t('today.unpriced', {n: F.n(a.unpricedRequests)}))}">*</span>` : '') : dash}</td>` : '') + `</tr>`).join('') + `</table></div>`;
}
function taskSection(m, f){
  let h = HID('jobs') ? `<div class="hiddenpn">${esc(t('hidden.online'))}</div>` : `<table class="tb">${jobRows(f.jobs, true, false)}</table>`;
  h += `<div class="sep" style="height:12px"></div><div class="ph sm"><h3>${esc(t('mach.svcSec'))}</h3><span class="r">${!HID('services') && f.svcs.length ? `<a class="more" href="${G.href('services', {machine: m.id})}">${esc(t('mach.viewSvc'))}</a>` : ''}</span></div>`;
  if(HID('services')) return h + `<div class="hiddenpn">${esc(t('hidden.online'))}</div>`;
  if(!f.svcs.length) return h + G.empty('mach.noSvc');
  const kinds = k => f.svcs.filter(x => x.kind === k || (k === 'container' && x.kind === 'both')).length;
  return h + `<div class="bds">${bd(esc(t('svc.count', {n: f.svcs.length})), 'c-hi')}${bd(esc(t('mach.svcUp', {n: f.up})), 'c-ok', true)}${f.down ? bd(esc(t('svc.bad', {n: f.down})), 'c-bad', true) : ''}${f.svcs.length - f.up - f.down ? bd(esc(t('mach.svcOther', {n: f.svcs.length - f.up - f.down})), 'c-warn', true) : ''}${bd(esc(t('mach.svcContainers', {n: kinds('container')})), 'c-dim')}${bd(esc(t('mach.svcMonitors', {n: f.svcs.filter(x => x.kind === 'monitor' || x.kind === 'both').length})), 'c-dim')}</div>`;
}
function summaryTable(){
  const today = D.machines.some(m => m.todayByAgent !== null);
  const cell = (hid, v) => hid ? `<span class="c-dim">${dash}</span>` : v;
  return `<div class="tbw"><table class="tb"><tr><th>${esc(t('svc.machine'))}</th><th class="v">${esc(t('mach.colAgents'))}</th><th class="v hide-s">${esc(t('rt.processes'))}</th><th class="v">${esc(t('rt.active'))}</th>` +
    (today ? `<th class="v hide-s">${esc(t('mach.todayReq'))}</th><th class="v">${esc(t('mach.todayCost'))}</th>` : '') + `<th class="v">${esc(t('mach.colJobs'))}</th><th class="v">${esc(t('mach.colSvc'))}</th></tr>` +
    D.machines.map(m => { const f = machineFacts(m);
      return `<tr><td class="n"><a class="mlink" href="${G.href('machines', {m: m.id})}">${G.mc(m.id)} ${T(m.label)}</a></td>
        <td class="v">${cell(HID('runtimes'), f.agents ? F.n(f.agents) : dash)}</td><td class="v hide-s">${cell(HID('runtimes'), f.agents ? F.n(f.proc) : dash)}</td><td class="v ${f.active ? 'c-ok' : ''}">${cell(HID('runtimes'), f.agents ? F.n(f.active) : dash)}</td>` +
        (today ? `<td class="v hide-s">${f.req == null ? dash : F.n(f.req)}</td><td class="v">${f.cost == null ? dash : F.usd(f.cost)}</td>` : '') +
        `<td class="v">${cell(HID('jobs'), f.jobs.length ? F.n(f.jobs.length) : dash)}</td><td class="v ${f.down ? 'c-bad' : ''}">${cell(HID('services'), f.svcs.length ? `<a class="more nomark" href="${G.href('services', {machine: m.id})}">${F.n(f.svcs.length)}</a>` + (f.down ? ` <span class="c-bad">(${F.n(f.down)})</span>` : '') : dash)}</td></tr>`; }).join('') + `</table></div>`;
}
function machineBadges(f){
  const out = [];
  if(!HID('runtimes')) out.push(f.agents ? bd(esc(t('mach.badgeAgents', {a: F.n(f.agents), p: F.n(f.proc), s: F.n(f.active)})), f.active ? 'c-fg' : 'c-dim', true, '', f.active > 0) : bd(esc(t('mach.noAgent')), 'c-dim'));
  const parts = [];
  if(!HID('jobs')) parts.push(t('mach.nJobs', {n: F.n(f.jobs.length)}));
  if(!HID('services')) parts.push(t('mach.nSvc', {n: F.n(f.svcs.length)}));
  if(parts.length) out.push(bd(esc(parts.join(' · ')), f.down || f.jobs.some(j => !j.ok) ? 'c-warn' : 'c-vio'));
  return out.join('');
}

P.machines = params => {
  const online = D.machines.filter(m => m.online).length, live = D.runtimes.filter(r => !r.stale);
  const withSys = D.machines.filter(m => m.system);
  const fresh = D.machines.filter(m => m.probeLastReport && D.T0 - Date.parse(m.probeLastReport) <= 9e5).length, probes = D.machines.filter(m => m.probeLastReport).length;
  let h = G.grpH('01', 'mach.grpSummary');
  h += G.pn('m-sum', G.ph('m-sum', 'server', 'ok', esc(t('mach.title')), esc(t('mach.onlineN', {a: online, b: D.machines.length})), esc(t('mach.src'))) + `<div class="kpis sm" style="--n:5">
    ${kpi('mach.kOnline', `${G.roll(online, 'n')}<span class="c-dim" style="font-size:.6em"> / ${F.n(D.machines.length)}</span>`, D.machines.filter(m => !m.online).map(m => esc(m.id)).join(' ') ? esc(t('mach.offlineIds', {ids: D.machines.filter(m => !m.online).map(m => m.id).join(' ')})) : esc(t('mach.allOnline')), 'g')}
    ${kpi('mach.kCpu', withSys.length ? G.roll(sum(withSys.map(m => m.system.cpuPct)) / withSys.length / 100, 'pct1') : dash, esc(t('mach.ofN', {n: withSys.length})), 'c')}
    ${HID('runtimes') ? kpi('mach.kActive', dash, esc(t('hidden.online'))) : kpi('mach.kActive', G.roll(sum(live.map(r => r.activeSessions)), 'n'), esc(t('mach.kProc', {n: F.n(sum(live.map(r => r.processes)))})), 'w')}
    ${kpi('mach.kProbes', `${G.roll(fresh, 'n')}<span class="c-dim" style="font-size:.6em"> / ${F.n(probes)}</span>`, esc(t('mach.freshHint')), fresh < probes ? 'w' : 'v')}
    ${HID('services') ? kpi('mach.kServices', dash, esc(t('hidden.online'))) : kpi('mach.kServices', G.roll(D.services.length, 'n'), esc(t('svc.bad', {n: D.services.filter(s => s.status === 'down').length})), D.services.some(s => s.status === 'down') ? 'b' : '')}
  </div>` + (D.machines.length ? `<div class="sep"></div><div class="ph sm"><h3>${esc(t('mach.byMachine'))}</h3><span class="r">${D.machines.some(m => m.todayByAgent !== null) ? esc(t('mach.todayNote')) : ''}</span></div>` + summaryTable() : ''), 'hero');
  h += G.grpH('02', 'mach.grpEach');
  if(!D.machines.length) h += G.pn('m-none', G.ph('m-none', 'server', 'ok', esc(t('mach.title')), '', '') + G.empty());
  D.machines.forEach((m, i) => {
    const s = m.system, f = machineFacts(m);
    const id = 'm-' + i;
    const head = `${G.mc(m.id, true)} ${T(m.label)}`;
    const right = `<span class="bds">${bd(esc(t(m.online ? 'mach.online' : 'mach.offline')), m.online ? 'c-ok' : 'c-bad', true, '', m.online)}${m.os ? bd(G.OS(m.os), 'c-dim') : ''}${m.role ? bd(G.lbl('role.', m.role), 'c-vio') : ''}${probeBadge(m)}</span>`;
    const facts = [['mach.lastSeen', m.lastSeen ? `${esc(F.full(m.lastSeen))} <span class="rel">${esc(F.ago(m.lastSeen))}</span>` : dash],
      ['mach.probeLast', m.probeLastReport ? `${esc(F.full(m.probeLastReport))} <span class="rel">${esc(F.ago(m.probeLastReport))}</span>` : esc(t('mach.noProbe'))],
      ['mach.uptimeK', s && s.uptimeSec != null ? esc(F.dur(s.uptimeSec)) : dash]];
    const hist = m.history;
    const chart = (key, k) => { const vals = hist.map(x => x[k]); const last = [...vals].reverse().find(v => v != null);
      return `<div class="chart3"><div class="lab"><span>${esc(t(key))}</span><span>${last == null ? dash : esc(t('mach.nowMax', {v: F.pctN(last), m: F.pctN(max(vals.filter(v => v != null)))}))}</span></div><div class="stretch">${G.fit(`${id}-${k}`, w => histChart(w, hist, k))}</div></div>`; };
    h += `<div id="mach-${esc(m.id)}"></div>` + G.pn(id, G.ph(id, '', '', head + ' ' + `<span class="bds">${machineBadges(f)}</span>`, '', right) + `<div class="mdet">
        <div class="metrics">${s ? metrics(s).map(metricHtml).join('') : `<div class="nodata">${esc(t('mach.noSystem'))}</div>`}
          <dl class="facts">${facts.map(([k, v]) => `<dt>${esc(t(k))}</dt><dd>${v}</dd>`).join('')}</dl></div>
        <div class="charts">${hist.length ? chart('mach.cpu24', 'cpuPct') + chart('mach.mem24', 'memPct') + (hist.some(x => x.diskPct != null) ? chart('mach.disk24', 'diskPct') : '') : `<div class="nodata">${esc(t('mach.noHistory'))}</div>`}
          ${hist.length ? `<div class="xl flat"><span>${esc(F.when(hist[0].t))}</span><span>${esc(F.when(hist[hist.length - 1].t))}</span></div>` : ''}</div>
      </div><div class="sep"></div>
      <div class="msec"><div><div class="ph sm"><h3>${G.ic('term', 'vio')}${esc(t('mach.agentSec'))}</h3><span class="r"></span></div>${agentSection(m, f)}</div>
      <div><div class="ph sm"><h3>${G.ic('clock', 'or')}${esc(t('mach.taskSec'))}</h3><span class="r"></span></div>${taskSection(m, f)}</div></div>`, m.online ? '' : 'offpn');
  });
  const ids = new Set(machineIds()), orphan = D.runtimes.filter(r => !ids.has(r.machine));
  if(orphan.length && !HID('runtimes')) h += G.pn('m-orph', G.ph('m-orph', 'term', 'vio', esc(t('mach.otherRt')), '', '') + `<table class="tb">${runtimeRows(orphan)}</table>`);
  const jump = params && params.get('m');
  if(jump) G.after(() => { const el = G.$('mach-' + jump); if(el) el.scrollIntoView({block: 'start'}); });
  return h;
};
function histChart(w, hist, k){
  const vals = hist.map(x => x[k]), n = vals.length; if(!n) return '';
  const p = 4, per = Math.max(1, Math.floor(w / p / n)), nc = Math.min(Math.floor(w / p), per * n), NR = 10;
  return G.cells(nc, NR, (c, r) => { const d = Math.min(n - 1, Math.floor(c / per)), v = vals[d]; if(v == null) return [0.04, 0];
    const f = v / 100 * NR, rb = NR - 1 - r; return rb + 0.5 <= Math.max(0.6, f) ? [0.45 + 0.5 * rb / NR, v >= 75 ? G.lvlIdx(v / 100) : 0] : [0.06, 0]; }, {pitch: p, px: 3.2,
    overlay: (pp, W, H) => hist.map((x, i) => `<rect class="ov" x="${i * per * pp}" y="0" width="${per * pp}" height="${H}" data-tip="${esc(F.when(x.t) + '  ' + (x[k] == null ? '—' : F.pctN(x[k])))}"/>`).join('')});
}

/* ================================================================== #/services */
P.services = params => {
  svcN = 0;
  const all = D.services.slice().sort(svcSort);
  const STS = ['all', 'up', 'down', 'other'];
  let stF = params.get('st') || 'all'; if(!STS.includes(stF)) stF = 'all';
  const machF = params.get('machine'), q = (params.get('q') || '').toLowerCase();
  let sort = params.get('sort') || 'status'; if(!['status', 'name', 'mem', 'cpu', 'up'].includes(sort)) sort = 'status';
  const isOther = s => s.status !== 'up' && s.status !== 'down';
  const counts = {all: all.length, up: all.filter(s => s.status === 'up').length, down: all.filter(s => s.status === 'down').length, other: all.filter(isOther).length};
  let list = all.filter(s => stF === 'all' || (stF === 'other' ? isOther(s) : s.status === stF));
  const NOM = '-';                                  /* machine=- : services without a machine */
  const mkey = s => s.machine || NOM;
  if(machF) list = list.filter(s => mkey(s) === machF);
  if(q) list = list.filter(s => typeof s.name === 'string' && s.name.toLowerCase().includes(q));
  const num0 = v => v == null ? -1 : v;
  if(sort === 'name') list.sort((a, b) => G.Tplain(a.name).localeCompare(G.Tplain(b.name)));
  if(sort === 'mem') list.sort((a, b) => num0(b.memBytes) - num0(a.memBytes));
  if(sort === 'cpu') list.sort((a, b) => num0(b.cpuPct) - num0(a.cpuPct));
  if(sort === 'up') list.sort((a, b) => (a.uptimePct24h == null ? 101 : a.uptimePct24h) - (b.uptimePct24h == null ? 101 : b.uptimePct24h));
  const ups = all.map(s => s.uptimePct24h).filter(v => v != null);
  const lk = o => G.href('services', {st: stF === 'all' ? null : stF, machine: machF, q: q || null, sort: sort === 'status' ? null : sort, ...o});
  let h = G.grpH('01', 'svc.grpSummary');
  const HID = D.hidden.has('services');           /* not in this snapshot: say so instead of "0 services, all up" */
  if(HID) h += G.pn('s-sum', G.ph('s-sum', 'box', 'ok', esc(t('svc.title')), '', '') + `<div class="hiddenpn">${esc(t('hidden.online'))}</div>`);
  else{
    h += G.pn('s-sum', G.ph('s-sum', 'box', 'ok', esc(t('svc.title')), esc(t('svc.count', {n: all.length})), counts.down ? bd(esc(t('svc.bad', {n: counts.down})), 'c-bad', true) : bd(esc(t('svc.allOk')), 'c-ok', true)) + `<div class="kpis sm" style="--n:5">
      ${kpi('svc.kTotal', G.roll(all.length, 'n'), esc(t('svc.kinds', {c: all.filter(s => s.kind === 'container').length, m: all.filter(s => s.kind === 'monitor').length, b: all.filter(s => s.kind === 'both').length})))}
      ${kpi('st.up', G.roll(counts.up, 'n'), esc(t('svc.ofAll', {p: all.length ? F.pct(counts.up / all.length) : '—'})), 'g')}
      ${kpi('st.down', G.roll(counts.down, 'n'), counts.down ? all.filter(s => s.status === 'down').slice(0, 3).map(s => G.Tplain(s.name)).map(esc).join(' · ') : esc(t('svc.allOk')), counts.down ? 'b' : '')}
      ${kpi('svc.kUp', ups.length ? G.roll(sum(ups) / ups.length / 100, 'pct1') : '—', esc(t('svc.monitored', {n: ups.length})), 'v')}
      ${kpi('svc.kMem', G.roll(sum(all.map(s => s.memBytes || 0)), 'bytes'), esc(t('svc.memOf', {n: all.filter(s => s.memBytes != null).length})), 'w')}
    </div>`, 'hero');

    h += G.grpH('02', 'svc.grpList');
    const machines = [...new Set(all.map(mkey))].sort();
    h += G.pn('s-list', G.ph('s-list', 'box', 'ok', esc(t('svc.all')), esc(t('svc.shown', {n: list.length, m: all.length})), esc(t('detail.hint'))) +
      `<div class="bar-f">${seg(STS.filter(s => s === 'all' || counts[s]).map(s => [s, esc(t(s === 'all' ? 'filter.all' : s === 'other' ? 'svc.other' : 'st.' + s)) + `<small>${F.n(counts[s])}</small>`]), stF, v => lk({st: v === 'all' ? null : v}))}
        ${machines.length > 1 ? `<span class="flab">${esc(t('svc.machine'))}</span>${seg([['\u0000all', esc(t('filter.all'))]].concat(machines.map(m => [m, m === NOM ? esc(t('svc.noMachine')) : esc(m)])), machF || '\u0000all', v => lk({machine: v === '\u0000all' ? null : v}))}` : ''}
        ${machF ? `<span class="bds" id="s-mf">${machF === NOM ? bd(esc(t('svc.noMachine')), 'c-dim') : G.mc(machF)} <a class="clear" href="${lk({machine: null})}">\u2715 ${esc(t('filter.clear'))}</a></span>` : ''}
        <span class="flab">${esc(t('filter.sort'))}</span>${seg(['status', 'name', 'up', 'cpu', 'mem'].map(s => [s, esc(t('sort.' + s))]), sort, v => lk({sort: v === 'status' ? null : v}))}
        <input class="search" id="s-q" type="search" value="${esc(params.get('q') || '')}" placeholder="${esc(t('svc.search'))}" aria-label="${esc(t('svc.search'))}"></div>` +
      (list.length ? `<table class="tb">${serviceRows(list)}</table>` : G.empty('filter.none')));
    G.after(() => { const el = G.$('s-q'); if(!el) return; let tm;
      el.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { const pos = el.selectionStart; history.replaceState(null, '', lk({q: el.value || null})); G.render(true); const n2 = G.$('s-q'); if(n2){ n2.focus(); try{ n2.setSelectionRange(pos, pos); }catch(e){} } }, 250); }); });
  }
  h += G.grpH(HID ? '02' : '03', 'svc.grpOps');
  const TN = D.tailnet, showTn = !D.hidden.has('tailnet');
  const jobsPn = G.pn('s-jobs', G.ph('s-jobs', 'clock', 'or', esc(t('job.title')), esc(t('job.count', {n: D.jobs.length})), D.jobs.some(j => !j.ok) ? bd(esc(t('job.failN', {n: D.jobs.filter(j => !j.ok).length})), 'c-bad', true) : '') + `<div id="sec-jobs"></div><table class="tb">${jobRows(D.jobs, true)}</table>`);
  const tnPn = showTn ? G.pn('s-tn', G.ph('s-tn', 'net', 'fg', esc(t('tn.title')), esc(t('tn.onlineN', {a: TN.filter(d => d.online).length, b: TN.length})), '') + (TN.length ? `<table class="tb"><tr><th>${esc(t('tn.device'))}</th><th>${esc(t('tn.os'))}</th><th>${esc(t('svc.status'))}</th><th class="v">${esc(t('mach.lastSeen'))}</th></tr>` +
    TN.slice().sort((a, b) => (b.online - a.online) || G.Tplain(a.name).localeCompare(G.Tplain(b.name))).map(d => `<tr><td class="n">${T(d.name)}</td><td class="k">${esc(d.os || '—')}</td><td>${bd(esc(t(d.online ? 'mach.online' : 'mach.offline')), d.online ? 'c-ok' : 'c-dim', true, '', d.online)}</td><td class="v" title="${esc(F.full(d.lastSeen))}">${d.online ? esc(t('time.now')) : esc(F.ago(d.lastSeen))}</td></tr>`).join('') + `</table>` : G.empty())) : '';
  h += tnPn ? `<div class="grid2 even">${jobsPn}${tnPn}</div>` : jobsPn;

  if(D.warnings){
    h += G.pn('s-warn', G.ph('s-warn', 'alert', D.warnings.length ? 'warn' : 'ok', esc(t('warn.title')), esc(t('warn.count', {n: D.warnings.length})), esc(t('warn.range'))) +
      (D.warnings.length ? `<table class="tb"><tr><th>${esc(t('warn.time'))}</th><th>${esc(t('warn.kind'))}</th><th class="hide-s">${esc(t('svc.machine'))}</th><th>${esc(t('warn.detail'))}</th></tr>` +
        D.warnings.map(w => `<tr><td class="k">${w.t ? esc(F.when(w.t)) : '—'}</td><td>${bd(G.lbl('wk.', w.kind), 'c-warn', true)}</td><td class="k hide-s">${w.machine ? G.mc(w.machine) : '—'}</td><td class="t m" style="font-size:11.5px">${esc(w.detail)}</td></tr>`).join('') + `</table>` : G.empty('warn.none')));
  }
  if(params.get('sec') === 'jobs') G.after(() => { const el = G.$('s-jobs'); if(el) el.scrollIntoView({block: 'start'}); });
  return h;
};

G.boot();
})();
