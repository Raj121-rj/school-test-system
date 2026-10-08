'use strict';
/* ===== shared page components (used by admin / teacher / student pages) ===== */

// Enter moves to the next marks box (fast entry)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.classList || !e.target.classList.contains('mi')) return;
  e.preventDefault();
  const all = $$('#mt tr[data-sid]').filter((r) => r.style.display !== 'none').map((r) => $('.mi', r)).filter((i) => !i.disabled);
  const nxt = all[all.indexOf(e.target) + 1];
  if (nxt) { nxt.focus(); nxt.select(); }
});
const printHead = (title) => `<div class="print-head"><h1>${esc(S.school)}</h1><div>${esc(title)} · सत्र ${esc(S.session ? S.session.name : '')} · ${fmtDate(new Date().toISOString().slice(0, 10))}</div><hr></div>`;
const downloadLinks = (url) => `<a class="btn sm" href="${url}${url.includes('?') ? '&' : '?'}format=xlsx">Excel</a> <a class="btn sm" href="${url}${url.includes('?') ? '&' : '?'}format=csv">CSV</a> <button class="btn sm" data-act="print">प्रिंट / PDF</button>`;
ACT.print = () => window.print();

/* ---------- tests list (cards + filters) ---------- */
function testCard(t, href) {
  return `<div class="card tcard" data-act="openTest" data-href="${esc(href)}">
    <div class="top2"><b>${dateLabel(t.test_date)}${t.test_date !== t.original_date ? ' <small class="warn">(पहले ' + fmtDate(t.original_date) + ')</small>' : ''}</b><span>${statusChip(t)}</span></div>
    <div>कक्षा ${t.grade} · ${esc(t.subject_name)} · टेस्ट ${t.test_no} <small>(${esc(t.test_type)})</small></div>
    <div class="clamp">${esc(t.syllabus)}</div>
    <small>पूर्णांक: ${t.max_marks ?? '—'} · समय: ${t.duration_min ? t.duration_min + ' मिनट' : '—'} · अंक दर्ज: ${t.entered}/${t.enrolled}</small></div>`;
}
ACT.openTest = (el) => go(el.dataset.href);

async function testsListPage(o) {
  const F = { class_id: '', subject_id: '', status: '', date: '', pending: '', ...(o.defaults || {}) };
  const [cl, sb] = await Promise.all([api('/api/classes'), api('/api/subjects')]);
  let lim = 40;
  let today = '';
  const filters = () => {
    const subs = sb.subjects.filter((s) => !F.class_id || String(s.class_id) === String(F.class_id));
    return `<div class="card"><div class="flt">
      <label>कक्षा<select data-change="tflt" data-k="class_id">${options(cl.classes.map((c) => [c.id, c.name]), F.class_id, 'सभी कक्षाएँ')}</select></label>
      <label>विषय<select data-change="tflt" data-k="subject_id">${options(subs.map((s) => [s.id, F.class_id ? s.name : `${s.grade} · ${s.name}`]), F.subject_id, 'सभी विषय')}</select></label>
      <label>स्थिति<select data-change="tflt" data-k="status">${options(Object.entries(STATUS_HI), F.status, 'सभी')}</select></label>
      <label>तारीख<input type="date" data-change="tflt" data-k="date" value="${esc(F.date)}"></label></div>
      <div class="row"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-change="tflt" data-k="pending" ${F.pending ? 'checked' : ''}> सिर्फ़ अंक-प्रविष्टि बाकी वाले</label>
      <span class="sp"></span><button class="btn sm" data-act="tToday">आज के टेस्ट</button><button class="btn sm" data-act="tClear">फ़िल्टर हटाएँ</button></div></div>`;
  };
  const draw = async () => {
    const p = new URLSearchParams();
    for (const k of ['class_id', 'subject_id', 'status', 'date', 'pending']) if (F[k]) p.set(k, F[k]);
    const d = await safe(() => api('/api/tests?' + p));
    if (!d) return;
    today = d.today;
    $('#tl').innerHTML = `<p class="mut">${d.tests.length} टेस्ट</p>` + d.tests.slice(0, lim).map((t) => testCard(t, o.link(t))).join('') +
      (d.tests.length > lim ? '<button class="btn full" data-act="tMore">और दिखाएँ</button>' : '') + (d.tests.length ? '' : '<div class="card mut">कोई टेस्ट नहीं मिला।</div>');
  };
  CHG.tflt = (el) => {
    F[el.dataset.k] = el.type === 'checkbox' ? (el.checked ? '1' : '') : el.value;
    if (el.dataset.k === 'class_id') F.subject_id = '';
    lim = 40;
    $('#tf').innerHTML = filters();
    draw();
  };
  ACT.tMore = () => { lim += 40; draw(); };
  ACT.tToday = () => { F.date = today; $('#tf').innerHTML = filters(); draw(); };
  ACT.tClear = () => { Object.assign(F, { class_id: '', subject_id: '', status: '', date: '', pending: '' }); $('#tf').innerHTML = filters(); draw(); };
  PAGE.after = draw;
  return `<h1>${esc(o.title)}</h1>${o.intro ? `<p class="mut">${o.intro}</p>` : ''}${o.top || ''}<div id="tf">${filters()}</div><div id="tl"><div class="loading">लोड हो रहा है…</div></div>`;
}

/* ---------- marks entry ---------- */
async function marksPage(id, role) {
  const d = await api('/api/tests/' + id);
  const t = d.test;
  const isAdmin = role === 'admin';
  const locked = !!t.marks_locked;
  const mm = Number(t.max_marks) || 0;
  const dr = {};
  d.students.forEach((s) => { dr[s.id] = { m: s.status === 'present' ? String(s.marks) : '', a: s.status === 'absent' }; });
  const bad = (x) => !x.a && x.m !== '' && (!/^\d+(\.\d{1,2})?$/.test(x.m) || Number(x.m) > mm);
  const ro = !d.can_edit;
  const upd = () => {
    let e = 0, a = 0, bl = 0, b = 0;
    $$('#mt tr[data-sid]').forEach((r) => {
      const x = dr[r.dataset.sid];
      const bd = bad(x);
      r.classList.toggle('bad', bd);
      r.classList.toggle('abs', x.a);
      $('.mi', r).disabled = ro || x.a;
      if (bd) b++; else if (x.a) a++; else if (x.m === '') bl++; else e++;
    });
    const c = $('#cnt');
    if (c) c.innerHTML = `दर्ज <b>${e}</b> · अनुपस्थित <b>${a}</b> · खाली <b>${bl}</b>${b ? ` · <span class="err">गलत ${b}</span>` : ''} <small>(कुल ${d.students.length})</small>`;
  };
  PAGE.input = (ev) => {
    const el = ev.target;
    if (el.dataset.search !== undefined) {
      const v = el.value.trim().toLowerCase();
      $$('#mt tr[data-q]').forEach((r) => { r.style.display = r.dataset.q.includes(v) ? '' : 'none'; });
      return;
    }
    const sid = el.dataset.sid;
    if (!sid || !dr[sid]) return;
    if (el.classList.contains('ab')) { dr[sid].a = el.checked; if (el.checked) { dr[sid].m = ''; $('.mi', el.closest('tr')).value = ''; } } else dr[sid].m = el.value.trim();
    upd();
  };
  PAGE.after = upd;
  ACT.saveMarks = async (el) => {
    const lock = el.dataset.lock === '1';
    const nbad = d.students.filter((s) => bad(dr[s.id])).length;
    if (nbad) return toast(`${nbad} विद्यार्थियों के अंक गलत हैं (0 से ${mm} के बीच संख्या लिखें)`, true);
    const blank = d.students.filter((s) => !dr[s.id].a && dr[s.id].m === '').length;
    if (lock && blank) return toast(`${blank} विद्यार्थियों के अंक या अनुपस्थिति बाकी है`, true);
    const reason = $('#reason') ? $('#reason').value.trim() : '';
    if (locked && !reason) return toast('सुधार का कारण लिखें', true);
    if (lock && !confirm('अंतिम जमा करने के बाद शिक्षक अंक नहीं बदल पाएँगे। जारी रखें?')) return;
    el.disabled = true;
    const r = await safe(() => api(`/api/tests/${id}/marks`, { method: 'PUT', body: { entries: d.students.map((s) => ({ student_id: s.id, marks: dr[s.id].m, absent: dr[s.id].a })), lock, reason } }));
    el.disabled = false;
    if (!r) return;
    toast(r.saved ? `${r.saved} बदलाव सेव हुए` : 'कोई नया बदलाव नहीं था');
    if (lock || locked) refresh();
  };
  ACT.unlockMarks = async () => {
    const reason = $('#reason').value.trim();
    if (!reason) return toast('अनलॉक का कारण लिखें', true);
    if (!confirm('अंक अनलॉक करने पर टेस्ट फिर से "निर्धारित" हो जाएगा। जारी रखें?')) return;
    if (await safe(() => api(`/api/tests/${id}/unlock`, { method: 'POST', body: { reason } }))) { toast('अनलॉक हो गया'); refresh(); }
  };
  ACT.hist = async () => {
    const r = await safe(() => api(`/api/tests/${id}/history`));
    if (!r) return;
    const val = (m, s) => (s === 'absent' ? 'अनुपस्थित' : m == null ? '—' : m);
    $('#hist').innerHTML = `<div class="card"><h2>अंकों का इतिहास</h2>` + table(['समय', 'विद्यार्थी', 'पुराना', 'नया', 'किसने', 'कारण'], r.history.map((h) => [fmtDT(h.changed_at), esc(h.student), val(h.old_marks, h.old_status), val(h.new_marks, h.new_status), esc(h.changed_by || ''), esc(h.reason || '')])) + '</div>';
  };
  const base = '/' + role;
  const chapters = d.chapters.length ? d.chapters.map((c) => chip(`${c.chapter_no}. ${c.title}`, 'gray')).join(' ') : (t.full_syllabus ? chip('पूरा पाठ्यक्रम', 'gray') : '');
  const rows = d.students.map((s) => `<tr data-sid="${s.id}" data-q="${esc((s.roll_no + ' ' + s.name + ' ' + s.code).toLowerCase())}">
      <td>${s.roll_no}</td><td>${esc(s.name)}<br><small>${esc(s.code)}</small></td>
      <td><input class="mi" inputmode="decimal" autocomplete="off" aria-label="${esc(s.name)} के अंक" data-sid="${s.id}" value="${esc(dr[s.id].m)}" ${ro ? 'disabled' : ''}></td>
      <td><input type="checkbox" class="ab" aria-label="${esc(s.name)} अनुपस्थित" data-sid="${s.id}" ${dr[s.id].a ? 'checked' : ''} ${ro ? 'disabled' : ''}></td></tr>`).join('');
  let actions = '';
  if (d.can_edit && !locked) actions = `<div class="row noprint" style="margin-top:12px"><button class="btn" data-act="saveMarks" data-lock="0">सेव (प्रगति)</button><button class="btn pri" data-act="saveMarks" data-lock="1">अंतिम जमा + लॉक</button></div>`;
  if (d.can_edit && locked && isAdmin) actions = `<div class="row noprint" style="margin-top:12px"><input id="reason" placeholder="सुधार / अनलॉक का कारण (ज़रूरी)" maxlength="300" style="flex:1 1 220px"><button class="btn" data-act="saveMarks" data-lock="0">सुधार सेव करें</button><button class="btn bad" data-act="unlockMarks">अनलॉक</button></div>`;
  return `${printHead('अंक सूची')}<div class="noprint row"><a data-link class="btn sm" href="${base}/marks">← वापस</a>${isAdmin ? `<a data-link class="btn sm" href="/admin/calendar/${id}">शेड्यूल बदलें</a>` : ''}<span class="sp"></span><button class="btn sm" data-act="hist">इतिहास</button><button class="btn sm" data-act="print">प्रिंट</button></div>
  <div class="card" style="margin-top:10px"><div class="top2 row"><h2 style="margin:0">कक्षा ${t.grade} · ${esc(t.subject_name)} · टेस्ट ${t.test_no}</h2><span class="sp"></span>${statusChip(t)}</div>
    <div>${dateLabel(t.test_date)} · ${esc(t.test_type)} · ${esc(t.test_code)}</div>
    <div class="full-text" style="margin:6px 0">${esc(t.syllabus)}</div><div>${chapters}</div>
    <div style="margin-top:8px">पूर्णांक: <b>${mm || '—'}</b> · समय: <b>${t.duration_min ? t.duration_min + ' मिनट' : '—'}</b></div></div>
  ${d.block_reason ? `<div class="card warn">${esc(d.block_reason)}</div>` : ''}
  ${d.students.length ? `<div class="card"><div class="noprint"><input data-search placeholder="नाम, रोल नं. या Student ID से खोजें" aria-label="खोजें"></div><div class="row" style="margin:8px 0"><span id="cnt"></span><span class="sp"></span><small>पूर्णांक ${mm || '—'} · Enter दबाने पर अगला विद्यार्थी</small></div>
    <div class="tw"><table id="mt"><thead><tr><th>रोल</th><th>विद्यार्थी</th><th>अंक (/${mm || '—'})</th><th>अनु.</th></tr></thead><tbody>${rows}</tbody></table></div>${actions}</div>` : '<div class="card warn">इस कक्षा में अभी कोई विद्यार्थी नहीं है।</div>'}
  <div id="hist" class="noprint"></div>`;
}

/* ---------- analysis views ---------- */
function studentHead(a) {
  const st = a.student;
  return `<div class="card"><div class="row"><h2 style="margin:0">${esc(st.name)}</h2><span class="sp"></span><small>${esc(st.class_name)} · रोल ${st.roll_no} · ${esc(st.code)}</small></div></div>`;
}
function studentKpis(s) {
  return `<div class="grid">${kpi('हुए टेस्ट', s.held)}${kpi('दिए टेस्ट', s.given)}${kpi('अनुपस्थित', s.absent)}${kpi('औसत', pctTxt(s.avg))}${kpi('सर्वोच्च', pctTxt(s.highest))}${kpi('न्यूनतम', pctTxt(s.lowest))}</div>`;
}
function trendBlock(a) {
  const s = a.summary;
  const ps = a.timeline.filter((t) => t.status === 'present').map((t) => t.pct);
  const note = s.trend === 'insufficient' ? 'प्रवृत्ति बताने के लिए कम से कम 4 टेस्ट चाहिए।' : `हाल के टेस्ट बनाम उससे पहले के टेस्ट: <b>${s.improvement > 0 ? '+' : ''}${s.improvement} प्रतिशत-अंक</b>`;
  return `<div class="card"><h2>सुधार / प्रवृत्ति</h2><div class="row">${trendChip(s.trend)}<span>${note}</span></div>${spark(ps)}
    <div class="row">${s.best ? `<span>सबसे अच्छा विषय: <b>${esc(s.best.subject)}</b> (${s.best.avg}%)</span>` : ''}${s.weakest ? `<span>कमज़ोर विषय: <b>${esc(s.weakest.subject)}</b> (${s.weakest.avg}%)</span>` : ''}</div></div>`;
}
function subjectsBlock(s) {
  return `<div class="card"><h2>विषयवार प्रदर्शन</h2>${s.subjects.length ? s.subjects.map((x) => `<div class="r2"><span><b>${esc(x.subject)}</b> <small>(${x.tests} टेस्ट · सर्वोच्च ${x.highest}% · न्यूनतम ${x.lowest}%)</small></span><span>${trendChip(x.trend)} <b>${x.avg}%</b></span></div>${bar(x.avg)}`).join('') : '<p class="mut">अभी डेटा नहीं है।</p>'}</div>`;
}
function chaptersBlock(a) {
  if (!a.chapters.length) return '<div class="card"><h2>अध्यायवार प्रदर्शन</h2><p class="mut">अभी अध्याय-आधारित टेस्ट का डेटा नहीं है।</p></div>';
  return `<div class="card"><h2>अध्यायवार प्रदर्शन</h2><p class="mut">हर अध्याय का स्कोर = उन सभी टेस्ट का औसत जिनमें वह अध्याय शामिल था।</p></div>` + a.chapters.map((g) => `<div class="card"><h3 style="margin-top:0">${esc(g.subject)}</h3>${g.chapters.map((c) => `<div class="r2"><span>${c.chapter_no}. ${esc(c.title)} <small>(${c.tests} टेस्ट)</small></span><b>${c.avg}%</b></div>${bar(c.avg)}`).join('')}</div>`).join('');
}
const recentBlock = (s) => `<div class="card"><h2>पिछले 5 टेस्ट</h2>${table(['तारीख', 'विषय', 'अंक', '%'], s.recent.map((r) => [fmtDate(r.date), esc(r.subject), `${r.marks}/${r.max}`, `<b>${r.pct}%</b>`]))}</div>`;
const timelineBlock = (a) => `<div class="card"><h2>सभी टेस्ट</h2>${table(['तारीख', 'टेस्ट', 'विषय', 'अंक', '%'], a.timeline.map((t) => [fmtDate(t.date), esc(t.test_code), esc(t.subject), t.status === 'absent' ? chip('अनुपस्थित', 'warn') : `${t.marks}/${t.max}`, t.status === 'absent' ? '—' : `<b>${t.pct}%</b>`]))}</div>`;
function studentView(a, parts) {
  const s = a.summary;
  if (!s.given && !s.absent) return studentHead(a) + '<div class="card">इस सत्र में अभी कोई अंक दर्ज नहीं हैं।</div>';
  const all = { kpi: studentKpis(s), trend: trendBlock(a), subjects: subjectsBlock(s), chapters: chaptersBlock(a), recent: recentBlock(s), timeline: timelineBlock(a) };
  return studentHead(a) + (parts || ['kpi', 'trend', 'subjects', 'recent', 'chapters', 'timeline']).map((k) => all[k]).join('');
}

function studentRows(list, withReason = true) {
  return table(['रोल', 'नाम', 'दिए', 'औसत', 'प्रवृत्ति'].concat(withReason ? ['कारण'] : []), list.map((r) => [r.roll_no, `<a href="#" data-act="pickStudent" data-id="${r.student_id}">${esc(r.name)}</a>`, r.given, pctTxt(r.avg), trendChip(r.trend)].concat(withReason ? [esc((r.reasons || []).join('; '))] : [])));
}
function classView(c) {
  const sm = c.summary;
  if (!sm.held) return `<div class="card">कक्षा ${esc(c.class.name)} के अंक अभी दर्ज नहीं हैं।</div>`;
  const maxC = Math.max(1, ...c.distribution.map((x) => x.count));
  return `<div class="grid">${kpi('विद्यार्थी', sm.students)}${kpi('हुए टेस्ट', sm.held)}${kpi('कक्षा औसत', pctTxt(sm.avg))}${kpi('ध्यान चाहिए', sm.attention, sm.attention ? 'warn' : '')}</div>
  <div class="card"><h2>विद्यार्थियों का औसत (वितरण)</h2>${c.distribution.map((x) => `<div class="r2"><span>${x.label}%</span><b>${x.count}</b></div><div class="bar"><i style="width:${(x.count / maxC) * 100}%"></i></div>`).join('')}</div>
  <div class="card"><h2>विषयवार औसत</h2>${c.subjects.map((x) => `<div class="r2"><span>${esc(x.subject)} <small>(${x.tests} टेस्ट)</small></span><b>${x.avg}%</b></div>${bar(x.avg)}`).join('') || '<p class="mut">—</p>'}</div>
  <div class="card"><h2>ध्यान चाहिए (Attention Required)</h2><p class="mut">औसत ${c.threshold}% से कम, तेज़ गिरावट, या बार-बार अनुपस्थिति।</p>${c.attention.length ? studentRows(c.attention) : '<p class="ok">अभी कोई विद्यार्थी इस सूची में नहीं है।</p>'}</div>
  <div class="card"><h2>शीर्ष प्रदर्शन (Top Performers)</h2>${c.top.length ? studentRows(c.top) : '<p class="mut">रैंकिंग के लिए पर्याप्त टेस्ट नहीं हुए।</p>'}</div>
  <div class="card"><h2>कमज़ोर अध्याय</h2><p class="mut">सबसे कम कक्षा-औसत वाले अध्याय — दोहराने योग्य।</p>${table(['विषय', 'अध्याय', 'औसत'], c.weak_chapters.map((w) => [esc(w.subject), `${w.chapter_no}. ${esc(w.title)}`, `<b>${w.avg}%</b>`]))}</div>
  <div class="card"><h2>टेस्टवार परिणाम</h2>${table(['तारीख', 'विषय', 'सिलेबस', 'औसत', 'सर्वोच्च', 'न्यूनतम', 'दिए/अनु.'], c.perTest.map((t) => [fmtDate(t.date), esc(t.subject), `<div class="clamp">${esc(t.syllabus)}</div>`, pctTxt(t.avg), pctTxt(t.highest), pctTxt(t.lowest), `${t.given}/${t.absent}`]))}</div>
  <div class="card"><h2>सभी विद्यार्थी</h2>${studentRows(c.students, false)}</div>`;
}
function schoolView(a) {
  return `<div class="grid">${kpi('विद्यार्थी', a.totals.students)}${kpi('विद्यालय औसत', pctTxt(a.totals.avg))}${kpi('ध्यान चाहिए', a.totals.attention, a.totals.attention ? 'warn' : '')}</div>
  <div class="card"><h2>कक्षावार स्थिति</h2>${table(['कक्षा', 'विद्यार्थी', 'हुए टेस्ट', 'औसत', 'ध्यान चाहिए', 'अंक-प्रविष्टि', 'बाकी टेस्ट'], a.classes.map((c) => [esc(c.name), c.students, c.held, pctTxt(c.avg), c.attention, c.entry_pct == null ? '—' : c.entry_pct + '%', c.pending_tests ? chip(c.pending_tests, 'warn') : '0']))}</div>
  <div class="card"><h2>विषयवार औसत (कक्षा सहित)</h2>${a.subjects.map((s) => `<div class="r2"><span>${esc(s.class_name)} · ${esc(s.subject)}</span><b>${s.avg}%</b></div>${bar(s.avg)}`).join('') || '<p class="mut">अभी डेटा नहीं है।</p>'}</div>
  <div class="card"><h2>शीर्ष 10 विद्यार्थी</h2>${table(['कक्षा', 'रोल', 'नाम', 'औसत'], a.top.map((r) => [esc(r.class_name), r.roll_no, esc(r.name), `<b>${r.avg}%</b>`]))}</div>
  <div class="card"><h2>ध्यान चाहिए</h2>${table(['कक्षा', 'रोल', 'नाम', 'औसत', 'कारण'], a.attention.map((r) => [esc(r.class_name), r.roll_no, esc(r.name), pctTxt(r.avg), esc(r.reasons.join('; '))]))}</div>`;
}

// Class + student pickers used by admin analysis and teacher pages. mode: 'class' | 'student'
async function analysisPicker({ mode, classes, subjects, title }) {
  const st = { class_id: classes[0] ? classes[0].id : '', subject_id: '', student_id: '' };
  let students = [];
  const loadStudents = async () => { students = st.class_id ? (await api('/api/students?class_id=' + st.class_id)).students : []; };
  if (mode === 'student') await loadStudents();
  const controls = () => {
    const subs = subjects.filter((s) => String(s.class_id) === String(st.class_id));
    return `<div class="card noprint"><div class="flt"><label>कक्षा<select data-change="anCls">${options(classes.map((c) => [c.id, c.name]), st.class_id)}</select></label>
      ${mode === 'class' ? `<label>विषय<select data-change="anSub">${options(subs.map((s) => [s.id, s.name]), st.subject_id, 'सभी विषय')}</select></label>` : `<label>विद्यार्थी<select data-change="anStu">${options(students.map((s) => [s.id, `${s.roll_no}. ${s.name}`]), st.student_id, 'विद्यार्थी चुनें')}</select></label>`}</div></div>`;
  };
  const show = async () => {
    const box = $('#anr');
    box.innerHTML = '<div class="loading">लोड हो रहा है…</div>';
    try {
      if (mode === 'class') {
        if (!st.class_id) { box.innerHTML = '<div class="card">कोई कक्षा उपलब्ध नहीं।</div>'; return; }
        const c = await api(`/api/analysis/class/${st.class_id}${st.subject_id ? '?subject_id=' + st.subject_id : ''}`);
        box.innerHTML = `<div class="row noprint" style="margin-bottom:8px"><span class="sp"></span>${downloadLinks(`/api/reports/class?class_id=${st.class_id}${st.subject_id ? '&subject_id=' + st.subject_id : ''}`)}</div>${printHead(title)}${classView(c)}`;
      } else if (!st.student_id) box.innerHTML = '<div class="card mut">ऊपर से विद्यार्थी चुनें।</div>';
      else {
        const a = await api('/api/analysis/student/' + st.student_id);
        box.innerHTML = `<div class="row noprint" style="margin-bottom:8px"><span class="sp"></span>${downloadLinks('/api/reports/student/' + st.student_id)}</div>${printHead(title)}${studentView(a)}`;
      }
    } catch (e) { box.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
  };
  CHG.anCls = async (el) => { st.class_id = el.value; st.subject_id = ''; st.student_id = ''; if (mode === 'student') await loadStudents(); $('#anc').innerHTML = controls(); show(); };
  CHG.anSub = (el) => { st.subject_id = el.value; show(); };
  CHG.anStu = (el) => { st.student_id = el.value; show(); };
  ACT.pickStudent = async (el) => {
    st.student_id = el.dataset.id;
    if (mode === 'class') { /* open student's analysis inline */ const a = await safe(() => api('/api/analysis/student/' + st.student_id)); if (a) $('#anr').innerHTML = `<div class="row noprint"><button class="btn sm" data-act="backClass">← कक्षा विश्लेषण</button></div>${studentView(a)}`; }
  };
  ACT.backClass = show;
  PAGE.after = show;
  return `<div id="anc">${controls()}</div><div id="anr"></div>`;
}

/* ---------- reports ---------- */
function renderReport(res, url) {
  const m = res.meta || {};
  let head = '';
  if (m.summary) head = `<div class="grid">${kpi('हुए टेस्ट', m.summary.held)}${kpi('दिए', m.summary.given)}${kpi('औसत', pctTxt(m.summary.avg))}${kpi('प्रवृत्ति', esc(m.summary.trend))}</div>`;
  else if (m.avg != null || m.held != null) head = `<div class="grid">${m.held != null ? kpi('हुए टेस्ट', m.held) : ''}${m.given != null ? kpi('दिए', m.given) : ''}${kpi('औसत', pctTxt(m.avg))}${m.highest != null ? kpi('सर्वोच्च', pctTxt(m.highest)) : ''}</div>`;
  const sub = m.student ? `${esc(m.student.name)} · ${esc(m.student.class_name)} · रोल ${m.student.roll_no} · ${esc(m.student.code)}` : [m.class, m.subject, m.test, m.date ? fmtDate(m.date) : ''].filter(Boolean).map(esc).join(' · ');
  return `<div class="row noprint" style="margin-bottom:8px"><span class="sp"></span>${downloadLinks(url)}</div>${printHead(res.title)}
    <div class="card"><h2>${esc(res.title)}</h2>${sub ? `<p class="mut">${sub}</p>` : ''}${head}${table(res.columns.map(esc), res.rows.map((r) => r.map((c) => esc(c))))}</div>`;
}
async function reportsPage(role) {
  const cl = await api('/api/classes');
  const sb = await api('/api/subjects');
  const R = { type: 'class', class_id: cl.classes[0] ? cl.classes[0].id : '', subject_id: '', student_id: '', test_id: '' };
  let students = [], tests = [];
  const types = [['class', 'कक्षा रिपोर्ट'], ['student', 'विद्यार्थी रिपोर्ट'], ['test', 'टेस्ट अंक सूची']].concat(role === 'admin' ? [['entry', 'अंक-प्रविष्टि बाकी'], ['school', 'विद्यालय सारांश']] : []);
  const needLists = async () => {
    students = R.type === 'student' && R.class_id ? (await api('/api/students?class_id=' + R.class_id)).students : [];
    tests = R.type === 'test' && R.class_id ? (await api(`/api/tests?class_id=${R.class_id}${R.subject_id ? '&subject_id=' + R.subject_id : ''}`)).tests.filter((t) => t.entered > 0) : [];
  };
  const controls = () => {
    const subs = sb.subjects.filter((s) => String(s.class_id) === String(R.class_id));
    const classSel = `<label>कक्षा<select data-change="rpC">${options(cl.classes.map((c) => [c.id, c.name]), R.class_id)}</select></label>`;
    const subSel = `<label>विषय${R.type === 'class' ? ' (वैकल्पिक)' : ''}<select data-change="rpS">${options(subs.map((s) => [s.id, s.name]), R.subject_id, R.type === 'class' ? 'सभी विषय' : 'सभी')}</select></label>`;
    let extra = '';
    if (['class', 'student', 'test'].includes(R.type)) extra += classSel;
    if (R.type === 'class' || R.type === 'test') extra += subSel;
    if (R.type === 'student') extra += `<label>विद्यार्थी<select data-change="rpSt">${options(students.map((s) => [s.id, `${s.roll_no}. ${s.name}`]), R.student_id, 'चुनें')}</select></label>`;
    if (R.type === 'test') extra += `<label>टेस्ट<select data-change="rpT">${options(tests.map((t) => [t.id, `${fmtDate(t.test_date)} · ${t.subject_name} · टेस्ट ${t.test_no}`]), R.test_id, 'चुनें')}</select></label>`;
    return `<div class="card noprint"><div class="flt"><label>रिपोर्ट का प्रकार<select data-change="rpType">${options(types, R.type)}</select></label>${extra}</div><button class="btn pri" data-act="rpGo">रिपोर्ट दिखाएँ</button></div>`;
  };
  const urlOf = () => {
    if (R.type === 'class') return `/api/reports/class?class_id=${R.class_id}${R.subject_id ? '&subject_id=' + R.subject_id : ''}`;
    if (R.type === 'student') return `/api/reports/student/${R.student_id}`;
    if (R.type === 'test') return `/api/reports/test/${R.test_id}`;
    return R.type === 'entry' ? '/api/reports/entry-status' : '/api/reports/school';
  };
  const redraw = async () => { await needLists(); $('#rpc').innerHTML = controls(); };
  CHG.rpType = (el) => { R.type = el.value; R.student_id = ''; R.test_id = ''; redraw(); };
  CHG.rpC = (el) => { R.class_id = el.value; R.subject_id = ''; R.student_id = ''; R.test_id = ''; redraw(); };
  CHG.rpS = (el) => { R.subject_id = el.value; R.test_id = ''; redraw(); };
  CHG.rpSt = (el) => { R.student_id = el.value; };
  CHG.rpT = (el) => { R.test_id = el.value; };
  ACT.rpGo = async () => {
    if ((R.type === 'student' && !R.student_id) || (R.type === 'test' && !R.test_id)) return toast('पहले ऊपर से चुनाव पूरा करें', true);
    const res = await safe(() => api(urlOf()));
    if (res) $('#rpr').innerHTML = renderReport(res, urlOf());
  };
  return `<h1 class="noprint">रिपोर्ट</h1><p class="mut noprint">रिपोर्ट स्क्रीन पर देखें, Excel / CSV डाउनलोड करें, या "प्रिंट / PDF" दबाकर प्रिंट करें या PDF के रूप में सेव करें।</p><div id="rpc">${controls()}</div><div id="rpr"></div>`;
}
