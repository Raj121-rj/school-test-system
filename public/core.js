'use strict';
/* ===== helpers ===== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ACT = {}; // click handlers   <button data-act="name">
const FORM = {}; // form handlers   <form data-form="name">
const CHG = {}; // change handlers  <select data-change="name">
let PAGE = {}; // per-page hooks: input(e), after()
const S = { user: null, school: '', session: null };

const DAYS = ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'];
const ROLE_HI = { admin: 'एडमिन', teacher: 'शिक्षक', student: 'विद्यार्थी' };
const STATUS_HI = { Scheduled: 'निर्धारित', Completed: 'पूर्ण', Postponed: 'स्थगित', Cancelled: 'रद्द' };
const TREND = { improving: ['सुधार ↑', 'ok'], stable: ['स्थिर →', 'gray'], declining: ['गिरावट ↓', 'dn'], insufficient: ['डेटा कम', 'na'] };
const fmtDate = (d) => (d ? d.split('-').reverse().join('-') : '');
const dayName = (d) => DAYS[new Date(d + 'T00:00:00Z').getUTCDay()];
const dateLabel = (d) => (d ? `${fmtDate(d)} (${dayName(d)})` : '');
const fmtDT = (s) => {
  if (!s) return '';
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : String(s).replace(' ', 'T') + 'Z');
  return isNaN(d) ? String(s) : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
};
const pctTxt = (v) => (v == null || v === '' ? '—' : v + '%');
const num = (v) => (v == null || v === '' ? '—' : v);
const chip = (t, cls = '') => `<span class="chip ${cls}">${esc(t)}</span>`;
const statusChip = (t) => chip(STATUS_HI[t.status] || t.status, t.status) + (t.marks_locked ? ' ' + chip('🔒 लॉक', 'gray') : '');
const trendChip = (k) => { const x = TREND[k] || TREND.insufficient; return chip(x[0], x[1]); };
const bar = (p) => `<div class="bar ${p < 40 ? 'low' : p < 60 ? 'mid' : ''}"><i style="width:${Math.max(0, Math.min(100, Number(p) || 0))}%"></i></div>`;
const kpi = (label, value, cls = '') => `<div class="kpi ${cls}"><small>${esc(label)}</small><b>${value}</b></div>`;
const spark = (arr) => {
  if (!arr || arr.length < 2) return '';
  const pts = arr.map((v, i) => `${((i * 100) / (arr.length - 1)).toFixed(1)},${(29 - v * 0.28).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke" points="${pts}"/></svg>`;
};
function table(head, rows, cls = '') {
  const body = rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${head.length}" class="mut">कोई रिकॉर्ड नहीं</td></tr>`;
  return `<div class="tw"><table class="${cls}"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}
const options = (items, sel, first) => (first != null ? `<option value="">${esc(first)}</option>` : '') + items.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`).join('');

let toastTimer;
function toast(msg, bad) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 4200);
}
function openModal(inner, wide) {
  $('#modal').innerHTML = `<div class="mback" data-act="closeModal"></div><div class="mbox ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${inner}</div>`;
  $('#modal').hidden = false;
}
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }
ACT.closeModal = closeModal;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'sts' }, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : null;
  if (!res.ok) {
    const e = new Error((data && data.error) || 'कुछ गलत हुआ, दोबारा कोशिश करें');
    e.status = res.status;
    e.data = data;
    if (res.status === 401 && S.user) { S.user = null; $('#app').innerHTML = ''; history.replaceState(null, '', '/login'); render(); }
    throw e;
  }
  return data;
}
// button helper: runs fn, shows errors as toast
async function safe(fn) { try { return await fn(); } catch (e) { toast(e.message, true); return null; } }

function readFileB64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('फ़ाइल पढ़ी नहीं जा सकी'));
    r.readAsDataURL(file);
  });
}
function downloadCsv(name, columns, rows) {
  const cell = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const blob = new Blob(['\uFEFF' + [columns, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
// one-time credentials dialog
function showCreds(title, rows) {
  openModal(`<h2>${esc(title)}</h2><p class="warn card">यह पासवर्ड सिर्फ़ अभी दिखेगा। इसे सुरक्षित लिख लें या डाउनलोड करें। पहले लॉगिन पर नया पासवर्ड बनाना होगा।</p>
    ${table(['नाम', 'यूज़रनेम', 'पासवर्ड'], rows.map((r) => [esc(r.name || ''), `<span class="cred">${esc(r.username)}</span>`, `<span class="cred">${esc(r.password)}</span>`]))}
    <div class="row end noprint" style="margin-top:12px"><button class="btn" data-act="dlCreds">CSV डाउनलोड</button><button class="btn" data-act="printCreds">प्रिंट</button><button class="btn pri" data-act="closeModal">ठीक है</button></div>`, true);
  PAGE.creds = rows;
}
ACT.dlCreds = () => downloadCsv('login_credentials.csv', ['Name', 'Class', 'Roll No.', 'Student ID', 'Username', 'Password'], (PAGE.creds || []).map((r) => [r.name || '', r.class || '', r.roll_no || '', r.student_code || '', r.username, r.password]));
ACT.printCreds = () => window.print();

/* ===== router ===== */
const ROUTES = [];
function route(pattern, fn) { ROUTES.push({ parts: pattern.split('/').filter(Boolean), fn }); }
function matchRoute(path) {
  const segs = path.split('/').filter(Boolean);
  for (const r of ROUTES) {
    if (r.parts.length !== segs.length) continue;
    const params = {};
    let ok = true;
    r.parts.forEach((x, i) => { if (x[0] === ':') params[x.slice(1)] = decodeURIComponent(segs[i]); else if (x !== segs[i]) ok = false; });
    if (ok) return { fn: r.fn, params };
  }
  return null;
}
async function go(path, replace) {
  if (replace) history.replaceState(null, '', path); else history.pushState(null, '', path);
  await render();
}
window.addEventListener('popstate', () => render());

const NAV = {
  admin: [['', 'डैशबोर्ड'], ['students', 'विद्यार्थी'], ['teachers', 'शिक्षक'], ['classes', 'कक्षाएँ'], ['subjects', 'विषय'], ['calendar', 'टेस्ट कैलेंडर'], ['marks', 'अंक'], ['analysis', 'विश्लेषण'], ['reports', 'रिपोर्ट'], ['import', 'विद्यार्थी इम्पोर्ट'], ['settings', 'सेटिंग्स'], ['audit', 'ऑडिट लॉग']],
  teacher: [['', 'डैशबोर्ड'], ['classes', 'मेरी कक्षाएँ'], ['subjects', 'मेरे विषय'], ['tests', 'निर्धारित टेस्ट'], ['marks', 'अंक प्रविष्टि'], ['performance', 'विद्यार्थी प्रदर्शन'], ['analysis', 'कक्षा विश्लेषण'], ['reports', 'रिपोर्ट']],
  student: [['', 'डैशबोर्ड'], ['tests', 'मेरे टेस्ट'], ['marks', 'मेरे अंक'], ['subjects', 'विषयवार प्रदर्शन'], ['chapters', 'अध्यायवार प्रदर्शन'], ['improvement', 'सुधार'], ['reports', 'रिपोर्ट']],
};
function buildShell() {
  const u = S.user;
  $('#app').innerHTML = `<header class="top"><button class="icon menu" data-act="menu" aria-label="मेन्यू">☰</button>
    <div class="brand"><b>${esc(S.school || 'विद्यालय')}</b><small>टेस्ट एवं विश्लेषण · सत्र ${esc(S.session ? S.session.name : '')}</small></div>
    <div class="who"><span>${esc(u.full_name)}</span><small>${ROLE_HI[u.role]}</small></div>
    <button class="btn sm" data-act="logout">लॉग-आउट</button></header>
    <nav class="side" id="nav" aria-label="मुख्य मेन्यू"></nav><main id="view"></main>`;
}
function renderNav(path) {
  const base = '/' + S.user.role;
  $('#nav').innerHTML = NAV[S.user.role].map(([p, l]) => {
    const href = p ? `${base}/${p}` : base;
    const on = p ? path === href || path.startsWith(href + '/') : path === base;
    return `<a data-link href="${href}" class="${on ? 'on' : ''}">${l}</a>`;
  }).join('') + `<a data-link href="${base}/password" class="${path.endsWith('/password') ? 'on' : ''}">पासवर्ड बदलें</a>`;
}
ACT.menu = () => $('#nav').classList.toggle('open');
ACT.logout = async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) { /* ignore */ }
  S.user = null;
  $('#app').innerHTML = '';
  history.replaceState(null, '', '/login');
  render();
};

async function loadMe() {
  try {
    const d = await api('/api/auth/me');
    S.user = d.user; S.school = d.school_name || ''; S.session = d.session || null;
  } catch (_) { S.user = null; }
}
let renderToken = 0;
async function render() {
  const token = ++renderToken;
  let path = location.pathname.replace(/\/+$/, '') || '/';
  if (!S.user) await loadMe();
  if (token !== renderToken) return;
  if (!S.user) {
    if (path !== '/login') history.replaceState(null, '', '/login');
    return showLogin();
  }
  if (S.user.must_change_password) return showChangePw(true);
  const home = '/' + S.user.role;
  if (path === '/' || path === '/login' || !(path === home || path.startsWith(home + '/'))) { history.replaceState(null, '', home); path = home; }
  if (!$('#nav')) buildShell();
  renderNav(path);
  $('#nav').classList.remove('open');
  PAGE = {};
  const m = matchRoute(path);
  const view = $('#view');
  view.innerHTML = '<div class="loading">लोड हो रहा है…</div>';
  try {
    const html = m ? await m.fn(m.params) : '<div class="card">यह पेज नहीं मिला।</div>';
    if (token !== renderToken) return;
    view.innerHTML = html;
    if (PAGE.after) PAGE.after();
  } catch (e) {
    if (token === renderToken) view.innerHTML = `<div class="card err">${esc(e.message)}</div>`;
  }
  window.scrollTo(0, 0);
}
// re-render the current page (shell stays); reloadShell also refreshes the header (school name / session)
const refresh = () => render();
async function reloadShell() { await loadMe(); $('#app').innerHTML = ''; await render(); }

/* ===== global event delegation (CSP-safe: no inline handlers) ===== */
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-link]');
  if (link && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); go(link.getAttribute('href')); return; }
  const el = e.target.closest('[data-act]');
  if (el && ACT[el.dataset.act]) { e.preventDefault(); ACT[el.dataset.act](el, e); }
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  if (FORM[f.dataset.form]) FORM[f.dataset.form](Object.fromEntries(new FormData(f)), f);
});
document.addEventListener('input', (e) => { if (PAGE.input) PAGE.input(e); });
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el && CHG[el.dataset.change]) CHG[el.dataset.change](el, e);
});

/* ===== login & password pages ===== */
function showLogin() {
  $('#app').innerHTML = `<div class="login"><form class="card" data-form="login" autocomplete="on">
    <div><h1>टेस्ट एवं विश्लेषण प्रणाली</h1><p class="mut" style="margin:0">सत्र 2026–27 · एडमिन / शिक्षक / विद्यार्थी लॉगिन</p></div>
    <label>यूज़रनेम / Student ID<input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
    <label>पासवर्ड<input name="password" type="password" autocomplete="current-password" required></label>
    <button class="btn pri full" type="submit">लॉगिन</button><p class="err" id="lerr" role="alert" style="margin:0"></p></form></div>`;
  const u = $('input[name=username]');
  if (u) u.focus();
}
FORM.login = async (d, f) => {
  const b = $('button', f);
  b.disabled = true;
  try {
    await api('/api/auth/login', { method: 'POST', body: d });
    S.user = null;
    await loadMe();
    $('#app').innerHTML = '';
    go('/' + (S.user ? S.user.role : ''), true);
  } catch (e) { $('#lerr').textContent = e.message; b.disabled = false; }
};
function showChangePw(forced) {
  const inner = `<form class="card form" data-form="changePw" style="max-width:420px">
    <h2>${forced ? 'पहले अपना नया पासवर्ड बनाएँ' : 'पासवर्ड बदलें'}</h2>
    ${forced ? '<p class="mut" style="margin:0">सुरक्षा के लिए पहले लॉगिन पर पासवर्ड बदलना ज़रूरी है।</p>' : ''}
    <label>वर्तमान पासवर्ड<input name="current_password" type="password" autocomplete="current-password" required></label>
    <label>नया पासवर्ड (कम से कम 8 अक्षर, अक्षर + अंक)<input name="new_password" type="password" autocomplete="new-password" minlength="8" required></label>
    <label>नया पासवर्ड दोबारा<input name="again" type="password" autocomplete="new-password" required></label>
    <button class="btn pri" type="submit">पासवर्ड सेव करें</button>${forced ? '<button class="btn" type="button" data-act="logout">लॉग-आउट</button>' : ''}<p class="err" id="perr" role="alert" style="margin:0"></p></form>`;
  if (forced) $('#app').innerHTML = `<div class="login">${inner}</div>`;
  return inner;
}
FORM.changePw = async (d) => {
  if (d.new_password !== d.again) { $('#perr').textContent = 'दोनों नए पासवर्ड एक जैसे नहीं हैं'; return; }
  try {
    await api('/api/auth/change-password', { method: 'POST', body: { current_password: d.current_password, new_password: d.new_password } });
    toast('पासवर्ड बदल गया');
    await loadMe();
    $('#app').innerHTML = '';
    go('/' + S.user.role, true);
  } catch (e) { $('#perr').textContent = e.message; }
};
['admin', 'teacher', 'student'].forEach((r) => route('/' + r + '/password', async () => showChangePw(false)));
