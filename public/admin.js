'use strict';
/* ===== ADMIN pages ===== */
const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const GENDER_OPTS = [['M', 'M (पुरुष)'], ['F', 'F (महिला)'], ['O', 'अन्य']];

/* ---------- dashboard ---------- */
route('/admin', async () => {
  const d = await api('/api/dashboard/admin');
  const c = d.counts;
  const trow = (t) => `<div class="r2" style="padding:4px 0"><span>${dateLabel(t.test_date)} · कक्षा ${t.grade} · ${esc(t.subject_name)} · टेस्ट ${t.test_no}</span><span>${statusChip(t)} <a data-link href="/admin/marks/${t.id}">अंक</a></span></div>`;
  return `<h1>एडमिन डैशबोर्ड</h1>
  ${c.no_max ? `<div class="card warn"><b>${c.no_max} टेस्ट में पूर्णांक (Maximum Marks) सेट नहीं है।</b> अंक भरने से पहले <a data-link href="/admin/calendar">टेस्ट कैलेंडर</a> में एक साथ सेट करें।</div>` : ''}
  ${c.students === 0 ? '<div class="card warn">अभी कोई विद्यार्थी नहीं है। <a data-link href="/admin/import">Excel से विद्यार्थी इम्पोर्ट करें</a>।</div>' : ''}
  <div class="grid">${kpi('विद्यार्थी', c.students)}${kpi('शिक्षक', c.teachers)}${kpi('कुल टेस्ट', c.tests)}${kpi('अंक लॉक', `${c.locked}/${c.tests}`)}${kpi('प्रविष्टि बाकी', c.pending, c.pending ? 'warn' : '')}</div>
  <div class="card"><h2>आज के टेस्ट · ${dateLabel(d.today)}</h2>${d.today_tests.length ? d.today_tests.map(trow).join('') : '<p class="mut">आज कोई टेस्ट निर्धारित नहीं है।</p>'}</div>
  <div class="card"><h2>आने वाले टेस्ट</h2>${d.upcoming.length ? d.upcoming.map(trow).join('') : '<p class="mut">कोई नहीं।</p>'}</div>
  <div class="card"><h2>कक्षाएँ</h2>${table(['कक्षा', 'विद्यार्थी'], d.classes.map((x) => [esc(x.name), x.students]))}</div>
  <div class="card"><h2>हाल की गतिविधि</h2>${table(['समय', 'उपयोगकर्ता', 'कार्य'], d.audit.map((a) => [fmtDT(a.created_at), esc(a.username || '—'), esc(a.action)]))}<p><a data-link href="/admin/audit">पूरा ऑडिट लॉग →</a></p></div>`;
});

/* ---------- students ---------- */
route('/admin/students', async () => {
  const [cls, st] = await Promise.all([api('/api/classes'), api('/api/settings')]);
  const F = { class_id: cls.classes[0] ? cls.classes[0].id : '', q: '', inactive: '' };
  let list = [];
  const form = (s = {}) => `<form class="form" data-form="stuSave" data-id="${s.id || ''}"><h2>${s.id ? 'विद्यार्थी सुधारें' : 'नया विद्यार्थी'}</h2>
    <div class="two"><label>कक्षा<select name="class_id">${options(cls.classes.map((c) => [c.id, c.name]), s.class_id || F.class_id)}</select></label><label>रोल नं.<input name="roll_no" type="number" min="1" required value="${esc(s.roll_no || '')}"></label></div>
    <label>नाम<input name="name" required maxlength="100" value="${esc(s.name || '')}"></label>
    <div class="two"><label>पिता का नाम<input name="father_name" value="${esc(s.father_name || '')}"></label><label>माता का नाम<input name="mother_name" value="${esc(s.mother_name || '')}"></label></div>
    <div class="two"><label>जन्मतिथि<input name="dob" type="date" value="${esc(s.dob || '')}"></label><label>लिंग<select name="gender">${options(GENDER_OPTS, s.gender, '—')}</select></label></div>
    <div class="row end"><button type="button" class="btn" data-act="closeModal">रद्द</button><button class="btn pri" type="submit">सेव करें</button></div></form>`;
  const draw = async () => {
    const p = new URLSearchParams();
    if (F.class_id) p.set('class_id', F.class_id);
    if (F.q) p.set('q', F.q);
    if (F.inactive) p.set('inactive', '1');
    const r = await safe(() => api('/api/students?' + p));
    if (!r) return;
    list = r.students;
    $('#sl').innerHTML = `<p class="mut">${list.length} विद्यार्थी</p>` + table(['रोल', 'नाम / ID', 'पिता', 'जन्मतिथि', ''], list.map((s) => [s.roll_no,
      `<b>${esc(s.name)}</b>${s.is_demo ? ' ' + chip('डेमो', 'warn') : ''}${s.active ? '' : ' ' + chip('निष्क्रिय', 'bad')}<br><small>${esc(s.code)} · ${esc(s.username || '')}</small>`,
      esc(s.father_name || ''), s.dob ? fmtDate(s.dob) : '',
      `<div class="row"><button class="btn sm" data-act="stuEdit" data-id="${s.id}">सुधारें</button><button class="btn sm" data-act="stuHist" data-id="${s.id}">इतिहास</button><button class="btn sm" data-act="stuReset" data-uid="${s.user_id}" data-name="${esc(s.name)}">पासवर्ड रीसेट</button><button class="btn sm ${s.active ? 'bad' : ''}" data-act="stuActive" data-id="${s.id}" data-on="${s.active ? 0 : 1}">${s.active ? 'निष्क्रिय करें' : 'सक्रिय करें'}</button></div>`]));
  };
  CHG.stuCls = (el) => { F.class_id = el.value; draw(); };
  CHG.stuInactive = (el) => { F.inactive = el.checked ? '1' : ''; draw(); };
  const dq = debounce(() => draw());
  PAGE.input = (e) => { if (e.target.dataset.sq !== undefined) { F.q = e.target.value.trim(); dq(); } };
  PAGE.after = draw;
  ACT.stuNew = () => openModal(form());
  ACT.stuEdit = (el) => openModal(form(list.find((s) => String(s.id) === el.dataset.id)));
  FORM.stuSave = async (d, f) => {
    const id = f.dataset.id;
    const body = { ...d, class_id: Number(d.class_id), roll_no: Number(d.roll_no) };
    const r = await safe(() => api(id ? '/api/students/' + id : '/api/students', { method: id ? 'PUT' : 'POST', body }));
    if (!r) return;
    closeModal();
    if (r.credentials) showCreds('विद्यार्थी जोड़ा गया', [{ name: d.name, username: r.credentials.username, password: r.credentials.password, student_code: r.credentials.student_code, roll_no: d.roll_no }]);
    else toast('सेव हो गया');
    draw();
  };
  ACT.stuActive = async (el) => {
    const on = el.dataset.on === '1';
    if (!on && !confirm('विद्यार्थी को निष्क्रिय करने पर उसका लॉगिन बंद हो जाएगा (अंक सुरक्षित रहेंगे)। जारी रखें?')) return;
    if (await safe(() => api(`/api/students/${el.dataset.id}/active`, { method: 'PATCH', body: { active: on } }))) { toast('अपडेट हो गया'); draw(); }
  };
  ACT.stuReset = async (el) => {
    if (!confirm(`${el.dataset.name} का पासवर्ड रीसेट करें?`)) return;
    const r = await safe(() => api(`/api/users/${el.dataset.uid}/reset-password`, { method: 'POST' }));
    if (r) showCreds('नया अस्थायी पासवर्ड', [{ name: el.dataset.name, username: r.username, password: r.password }]);
  };
  ACT.stuHist = async (el) => {
    const r = await safe(() => api(`/api/students/${el.dataset.id}/history`));
    if (r) openModal(`<h2>कक्षा / सत्र इतिहास</h2>${table(['सत्र', 'कक्षा', 'रोल', 'स्थिति'], r.history.map((h) => [esc(h.session), esc(h.class_name), h.roll_no, esc(h.status)]))}<div class="row end" style="margin-top:10px"><button class="btn" data-act="closeModal">बंद करें</button></div>`);
  };
  ACT.stuPromote = () => {
    const others = st.sessions.filter((s) => !s.is_current);
    if (!others.length) return openModal('<h2>प्रमोशन</h2><p>पहले <a data-link href="/admin/settings">सेटिंग्स</a> में नया सत्र (जैसे 2027-28) जोड़ें।</p><div class="row end"><button class="btn" data-act="closeModal">बंद करें</button></div>');
    if (!list.length) return toast('पहले कक्षा चुनें जिसमें विद्यार्थी हों', true);
    openModal(`<form class="form" data-form="promote"><h2>प्रमोशन (अगले सत्र में भेजें)</h2><p class="mut">चुनी हुई कक्षा के विद्यार्थियों का नया सत्र/कक्षा में नामांकन बनेगा। पुराने अंक और इतिहास उसी Student ID से जुड़े रहते हैं।</p>
      <div class="two"><label>नया सत्र<select name="to_session_id">${options(others.map((s) => [s.id, s.name]), '')}</select></label><label>नई कक्षा<select name="class_id">${options(cls.classes.map((c) => [c.id, c.name]), F.class_id)}</select></label></div>
      <div class="tw" style="max-height:46vh">${table(['चुनें', 'नाम', 'नया रोल'], list.filter((s) => s.active).map((s) => [`<input type="checkbox" name="sel_${s.id}" checked>`, esc(s.name), `<input name="roll_${s.id}" type="number" min="1" value="${s.roll_no}" style="width:80px">`]))}</div>
      <div class="row end"><button type="button" class="btn" data-act="closeModal">रद्द</button><button class="btn pri" type="submit">प्रमोट करें</button></div></form>`, true);
  };
  FORM.promote = async (d) => {
    const items = list.filter((s) => d['sel_' + s.id] !== undefined).map((s) => ({ student_id: s.id, class_id: Number(d.class_id), roll_no: Number(d['roll_' + s.id]) }));
    if (!items.length) return toast('कोई विद्यार्थी नहीं चुना', true);
    const r = await safe(() => api('/api/students/promote', { method: 'POST', body: { to_session_id: Number(d.to_session_id), items } }));
    if (r) { closeModal(); toast(`${r.promoted} विद्यार्थी प्रमोट हुए`); }
  };
  return `<h1>विद्यार्थी</h1><div class="card"><div class="flt"><label>कक्षा<select data-change="stuCls">${options(cls.classes.map((c) => [c.id, c.name]), F.class_id)}</select></label>
    <label>खोजें<input data-sq placeholder="नाम, रोल या Student ID"></label></div>
    <div class="row"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-change="stuInactive"> निष्क्रिय भी दिखाएँ</label><span class="sp"></span>
    <button class="btn pri" data-act="stuNew">+ नया विद्यार्थी</button><a data-link class="btn" href="/admin/import">Excel इम्पोर्ट</a><button class="btn" data-act="stuPromote">प्रमोशन</button>
    <a class="btn" href="/api/students/export?format=xlsx">Excel एक्सपोर्ट</a><a class="btn" href="/api/students/export?format=csv">CSV</a></div></div><div id="sl" class="card"><div class="loading">लोड हो रहा है…</div></div>`;
});

/* ---------- Excel import ---------- */
route('/admin/import', async () => {
  const cls = (await api('/api/classes')).classes;
  let cid = cls[0] ? cls[0].id : '';
  let prev = null;
  const draw = () => {
    let h = `<div class="card"><h2>चरण 1: कक्षा चुनें और टेम्पलेट डाउनलोड करें</h2><div class="row"><label style="min-width:180px">कक्षा<select data-change="impCls">${options(cls.map((c) => [c.id, c.name]), cid)}</select></label><a class="btn" href="/api/import/template">टेम्पलेट डाउनलोड (Excel)</a></div>
      <p class="mut">कॉलम: Roll No., Student Name, Father Name, Mother Name, DOB, Gender। Roll No. और नाम ज़रूरी हैं।</p></div>
      <div class="card"><h2>चरण 2: भरी हुई फ़ाइल अपलोड करें</h2><input type="file" accept=".xlsx" data-change="impFile"><p class="mut">अपलोड के बाद पहले जाँच (Preview) दिखेगी; आपके "पुष्टि" करने तक कुछ भी सेव नहीं होता।</p></div>`;
    if (prev) {
      const s = prev.summary;
      h += `<div class="card"><h2>चरण 3: जाँच परिणाम</h2><div class="grid">${kpi('कुल रिकॉर्ड', s.total)}${kpi('सही', s.valid)}${kpi('गलत', s.invalid, s.invalid ? 'warn' : '')}${kpi('दोहराए रोल', s.duplicateRolls)}${kpi('खाली नाम', s.blankNames)}${kpi('गलत मान', s.invalidValues)}</div>
        ${prev.errors.length ? `<h3>गलतियाँ (पंक्ति संख्या सहित)</h3>${table(['Excel पंक्ति', 'समस्या'], prev.errors.map((e) => [e.row, `<span class="err">${esc(e.message)}</span>`]))}<p class="mut">Excel में ये पंक्तियाँ ठीक करके दोबारा अपलोड करें, या नीचे सिर्फ़ सही रिकॉर्ड जोड़ें।</p>` : '<p class="ok">कोई गलती नहीं मिली।</p>'}
        ${prev.sample.length ? `<h3>सही रिकॉर्ड (पहले ${prev.sample.length})</h3>${table(['रोल', 'नाम', 'पिता', 'माता', 'जन्मतिथि', 'लिंग'], prev.sample.map((r) => [r.roll_no, esc(r.name), esc(r.father_name || ''), esc(r.mother_name || ''), r.dob ? fmtDate(r.dob) : '', esc(r.gender || '')]))}` : ''}
        <div class="row end" style="margin-top:12px"><button class="btn" data-act="impReset">रद्द करें</button><button class="btn pri" data-act="impConfirm" ${s.valid ? '' : 'disabled'}>${s.valid} सही रिकॉर्ड जोड़ें</button></div></div>`;
    }
    $('#imp').innerHTML = h;
  };
  CHG.impCls = (el) => { cid = el.value; prev = null; draw(); };
  CHG.impFile = async (el) => {
    const f = el.files[0];
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) { toast('सिर्फ़ .xlsx फ़ाइल चुनें', true); return; }
    const data = await safe(() => readFileB64(f));
    const r = data && (await safe(() => api('/api/import/preview', { method: 'POST', body: { class_id: Number(cid), filename: f.name, data } })));
    if (r) { prev = r; draw(); }
  };
  ACT.impReset = () => { prev = null; draw(); };
  ACT.impConfirm = async (el) => {
    if (!confirm(`${prev.summary.valid} विद्यार्थी जोड़ें?`)) return;
    el.disabled = true;
    const r = await safe(() => api(`/api/import/${prev.import_id}/confirm`, { method: 'POST' }));
    el.disabled = false;
    if (!r) return;
    prev = null;
    draw();
    toast(`${r.created} विद्यार्थी जोड़े गए`);
    showCreds(`${r.created} विद्यार्थियों के लॉगिन`, r.credentials);
  };
  PAGE.after = draw;
  return '<h1>विद्यार्थी Excel इम्पोर्ट</h1><div id="imp"></div>';
});

/* ---------- teachers ---------- */
route('/admin/teachers', async () => {
  const [tr, sb] = await Promise.all([api('/api/teachers'), api('/api/subjects')]);
  const teachers = tr.teachers;
  const form = (t = {}) => `<form class="form" data-form="tSave" data-id="${t.id || ''}"><h2>${t.id ? 'शिक्षक सुधारें' : 'नया शिक्षक'}</h2>
    <label>नाम<input name="full_name" required maxlength="100" value="${esc(t.full_name || '')}"></label>
    ${t.id ? '' : '<label>यूज़रनेम (a-z, 0-9, . _ -)<input name="username" required pattern="[a-zA-Z0-9._-]{3,30}" autocapitalize="none"></label>'}
    <div class="two"><label>फ़ोन<input name="phone" value="${esc(t.phone || '')}"></label><label>ईमेल<input name="email" type="email" value="${esc(t.email || '')}"></label></div>
    ${t.id ? `<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="active" ${t.active ? 'checked' : ''}> सक्रिय</label>` : ''}
    <div class="row end"><button type="button" class="btn" data-act="closeModal">रद्द</button><button class="btn pri" type="submit">सेव करें</button></div></form>`;
  ACT.tNew = () => openModal(form());
  ACT.tEdit = (el) => openModal(form(teachers.find((t) => String(t.id) === el.dataset.id)));
  FORM.tSave = async (d, f) => {
    const id = f.dataset.id;
    const body = id ? { full_name: d.full_name, phone: d.phone, email: d.email, active: d.active !== undefined } : d;
    const r = await safe(() => api(id ? '/api/teachers/' + id : '/api/teachers', { method: id ? 'PUT' : 'POST', body }));
    if (!r) return;
    closeModal();
    if (r.credentials) showCreds('शिक्षक जोड़ा गया', [{ name: d.full_name, username: r.credentials.username, password: r.credentials.password }]);
    else toast('सेव हो गया');
    refresh();
  };
  ACT.tAssign = (el) => {
    const t = teachers.find((x) => String(x.id) === el.dataset.id);
    const have = new Set(t.assignments.map((a) => a.subject_id));
    const groups = {};
    sb.subjects.forEach((s) => { (groups[s.class_name] = groups[s.class_name] || []).push(s); });
    openModal(`<form class="form" data-form="tAssign" data-id="${t.id}"><h2>${esc(t.full_name)} — कक्षा / विषय सौंपें</h2>
      ${Object.entries(groups).map(([cn, list]) => `<div><b>${esc(cn)}</b><div class="row">${list.map((s) => `<label style="display:flex;gap:5px;align-items:center;color:var(--ink)"><input type="checkbox" name="s_${s.id}" ${have.has(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}</div></div>`).join('')}
      <div class="row end"><button type="button" class="btn" data-act="closeModal">रद्द</button><button class="btn pri" type="submit">सेव करें</button></div></form>`, true);
  };
  FORM.tAssign = async (d, f) => {
    const ids = Object.keys(d).filter((k) => k.startsWith('s_')).map((k) => Number(k.slice(2)));
    if (await safe(() => api(`/api/teachers/${f.dataset.id}/assignments`, { method: 'PUT', body: { subject_ids: ids } }))) { closeModal(); toast('सेव हो गया'); refresh(); }
  };
  ACT.tReset = async (el) => {
    if (!confirm('इस शिक्षक का पासवर्ड रीसेट करें?')) return;
    const r = await safe(() => api(`/api/users/${el.dataset.uid}/reset-password`, { method: 'POST' }));
    if (r) showCreds('नया अस्थायी पासवर्ड', [{ name: el.dataset.name, username: r.username, password: r.password }]);
  };
  return `<h1>शिक्षक</h1><div class="row" style="margin-bottom:10px"><button class="btn pri" data-act="tNew">+ नया शिक्षक</button></div>` + (teachers.map((t) => `<div class="card"><div class="row"><b>${esc(t.full_name)}</b>${t.is_demo ? chip('डेमो', 'warn') : ''}${t.active ? '' : chip('निष्क्रिय', 'bad')}<span class="sp"></span><small>${esc(t.username)}${t.phone ? ' · ' + esc(t.phone) : ''}${t.last_login ? ' · आख़िरी लॉगिन ' + fmtDT(t.last_login) : ''}</small></div>
    <div style="margin:8px 0">${t.assignments.length ? t.assignments.map((a) => chip(`${a.class_name} · ${a.subject}`, 'gray')).join(' ') : '<span class="mut">अभी कोई कक्षा/विषय नहीं सौंपा गया</span>'}</div>
    <div class="row"><button class="btn sm" data-act="tAssign" data-id="${t.id}">कक्षा / विषय सौंपें</button><button class="btn sm" data-act="tEdit" data-id="${t.id}">सुधारें</button><button class="btn sm" data-act="tReset" data-uid="${t.user_id}" data-name="${esc(t.full_name)}">पासवर्ड रीसेट</button></div></div>`).join('') || '<div class="card mut">अभी कोई शिक्षक नहीं है।</div>');
});

/* ---------- classes & subjects ---------- */
route('/admin/classes', async () => {
  const d = await api('/api/classes');
  FORM.clsAdd = async (f) => { if (await safe(() => api('/api/classes', { method: 'POST', body: { grade: Number(f.grade), name: f.name } }))) { toast('कक्षा जुड़ गई'); refresh(); } };
  return `<h1>कक्षाएँ</h1><div class="card">${table(['कक्षा', 'विद्यार्थी', 'विषय', ''], d.classes.map((c) => [esc(c.name), c.students, c.subjects, `<a data-link href="/admin/students">विद्यार्थी</a> · <a data-link href="/admin/analysis/class">विश्लेषण</a>`]))}</div>
  <form class="card form" data-form="clsAdd"><h2>नई कक्षा जोड़ें (प्रमोशन के लिए)</h2><p class="mut">टेस्ट केवल कक्षा 5, 8, 10, 12 के लिए निर्धारित हैं। प्रमोशन में अगली कक्षाएँ (जैसे 6, 9, 11) चाहिए हों तो यहाँ जोड़ें।</p>
  <div class="two"><label>कक्षा संख्या (1-12)<input name="grade" type="number" min="1" max="12" required></label><label>नाम (वैकल्पिक)<input name="name" placeholder="कक्षा 6"></label></div><button class="btn pri" type="submit">जोड़ें</button></form>`;
});
route('/admin/subjects', async () => {
  const [sb, cl] = await Promise.all([api('/api/subjects'), api('/api/classes')]);
  const groups = {};
  sb.subjects.forEach((s) => { (groups[s.class_name] = groups[s.class_name] || []).push(s); });
  ACT.chapters = async (el) => {
    const box = $('#ch' + el.dataset.id);
    if (box.innerHTML) { box.innerHTML = ''; return; }
    const r = await safe(() => api(`/api/subjects/${el.dataset.id}/chapters`));
    if (r) box.innerHTML = `<ol class="full-text" style="margin:6px 0 10px 20px;padding:0">${r.chapters.map((c) => `<li>${esc(c.title)}</li>`).join('')}</ol>`;
  };
  FORM.subAdd = async (f) => { if (await safe(() => api('/api/subjects', { method: 'POST', body: { class_id: Number(f.class_id), name: f.name } }))) { toast('विषय जुड़ गया'); refresh(); } };
  return `<h1>विषय</h1>` + Object.entries(groups).map(([cn, list]) => `<div class="card"><h2>${esc(cn)}</h2>${list.map((s) => `<div class="row" style="padding:3px 0"><b>${esc(s.name)}</b><small>${s.chapters} अध्याय · ${s.tests} टेस्ट</small><span class="sp"></span><button class="btn sm" data-act="chapters" data-id="${s.id}">अध्याय सूची</button></div><div id="ch${s.id}"></div>`).join('')}</div>`).join('') +
    `<form class="card form" data-form="subAdd"><h2>नया विषय जोड़ें</h2><p class="mut">सूची के बाहर का विषय तभी जोड़ें जब ज़रूरी हो।</p><div class="two"><label>कक्षा<select name="class_id">${options(cl.classes.map((c) => [c.id, c.name]), '')}</select></label><label>विषय का नाम<input name="name" required></label></div><button class="btn pri" type="submit">जोड़ें</button></form>`;
});

/* ---------- test calendar ---------- */
const calTabs = (on) => `<div class="seg noprint"><a data-link class="btn ${on === 'list' ? 'on' : ''}" href="/admin/calendar">सूची</a><a data-link class="btn ${on === 'month' ? 'on' : ''}" href="/admin/calendar/month">कैलेंडर</a></div>`;
route('/admin/calendar', async () => {
  const cl = await api('/api/classes');
  FORM.defaults = async (d) => {
    const body = { max_marks: d.max_marks || null, duration_min: d.duration_min || null, overwrite: d.overwrite !== undefined, class_id: d.class_id || null };
    if (!body.max_marks && !body.duration_min) return toast('पूर्णांक या समय भरें', true);
    if (body.overwrite && !confirm('पहले से भरे पूर्णांक/समय भी बदल जाएँगे। जारी रखें?')) return;
    const r = await safe(() => api('/api/tests/defaults', { method: 'POST', body }));
    if (r) { toast(`${r.updated} जगह अपडेट हुआ`); refresh(); }
  };
  CHG.calFile = async (el) => {
    const f = el.files[0];
    if (!f) return;
    const data = await safe(() => readFileB64(f));
    if (!data) return;
    try {
      const r = await api('/api/calendar/import', { method: 'POST', body: { filename: f.name, data } });
      openModal(`<h2>कैलेंडर इम्पोर्ट पूरा</h2><p>${r.inserted} नए टेस्ट, ${r.updated} अपडेट।</p>${r.warnings.length ? `<h3>चेतावनियाँ</h3><ul>${r.warnings.map((w) => `<li>${esc(w.message)}</li>`).join('')}</ul>` : ''}<div class="row end"><button class="btn pri" data-act="closeModal">ठीक है</button></div>`);
      refresh();
    } catch (e) {
      openModal(`<h2>कैलेंडर इम्पोर्ट नहीं हुआ</h2><p class="err">${esc(e.message)}</p>${e.data && e.data.errors ? `<ul>${e.data.errors.map((x) => `<li>${x.row ? 'पंक्ति ' + x.row + ': ' : ''}${esc(x.message)}</li>`).join('')}</ul>` : ''}<div class="row end"><button class="btn" data-act="closeModal">बंद करें</button></div>`);
    }
    el.value = '';
  };
  const top = `${calTabs('list')}<div class="card"><h2>पूर्णांक और समय सेट करें</h2><p class="mut">मास्टर कैलेंडर फ़ाइल में पूर्णांक/समय नहीं हैं, इसलिए पहले यहाँ भरें। बाद में हर टेस्ट अलग से बदला जा सकता है।</p>
    <form data-form="defaults"><div class="flt"><label>पूर्णांक (Max Marks)<input name="max_marks" type="number" step="0.5" min="1"></label><label>समय (मिनट)<input name="duration_min" type="number" min="1"></label>
    <label>कक्षा<select name="class_id">${options(cl.classes.map((c) => [c.id, c.name]), '', 'सभी कक्षाएँ')}</select></label></div>
    <div class="row"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="overwrite"> पहले से भरे मान भी बदलें</label><span class="sp"></span><button class="btn pri" type="submit">लागू करें</button></div></form></div>
    <div class="card"><h2>मास्टर कैलेंडर Excel</h2><div class="row"><a class="btn" href="/api/calendar/export?format=xlsx">Excel डाउनलोड</a><a class="btn" href="/api/calendar/export?format=csv">CSV</a><span class="sp"></span>
    <label class="btn" style="margin:0">संशोधित कैलेंडर इम्पोर्ट करें<input type="file" accept=".xlsx" data-change="calFile" hidden></label></div>
    <p class="mut">इम्पोर्ट में वही कॉलम हों: क्रम, तारीख, दिन, कक्षा, टेस्ट नं., विषय, सिलेबस/अध्याय, टेस्ट प्रकार। दर्ज अंक नहीं बदलते।</p></div>`;
  return testsListPage({ title: 'टेस्ट कैलेंडर (Master Calendar)', link: (t) => '/admin/calendar/' + t.id, top, intro: '192 निर्धारित टेस्ट। किसी टेस्ट पर दबाकर तारीख, पूर्णांक, समय या स्थिति बदलें।' });
});
route('/admin/calendar/month', async () => {
  const [td, hd] = await Promise.all([api('/api/tests'), api('/api/holidays')]);
  const tests = td.tests;
  const byDate = {};
  tests.forEach((t) => { (byDate[t.test_date] = byDate[t.test_date] || []).push(t); });
  const dates = Object.keys(byDate).sort();
  let ym = dates.length ? dates[0].slice(0, 7) : td.today.slice(0, 7);
  let sel = '';
  const isHol = (d) => hd.holidays.some((h) => d >= h.start_date && d <= h.end_date);
  const draw = () => {
    const [y, m] = ym.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let cells = DAYS.map((d) => `<div class="h">${d}</div>`).join('') + '<div></div>'.repeat(first.getUTCDay());
    for (let i = 1; i <= days; i++) {
      const ds = `${ym}-${String(i).padStart(2, '0')}`;
      const ts = byDate[ds] || [];
      cells += `<div class="d ${ts.length ? '' : 'off'} ${isHol(ds) ? 'hol' : ''} ${sel === ds ? 'sel' : ''}" ${ts.length ? `data-act="calDay" data-d="${ds}"` : ''}><b>${i}</b>${ts.map((t) => `<span class="t ${t.status}">${t.grade}</span>`).join('')}${isHol(ds) ? '<small>अवकाश</small>' : ''}</div>`;
    }
    const mn = first.toLocaleDateString('hi-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    $('#cal').innerHTML = `<div class="card"><div class="row"><button class="btn sm" data-act="calPrev" ${ym <= dates[0].slice(0, 7) ? 'disabled' : ''}>←</button><b class="sp" style="text-align:center">${mn}</b><button class="btn sm" data-act="calNext" ${ym >= dates[dates.length - 1].slice(0, 7) ? 'disabled' : ''}>→</button></div><div class="cal" style="margin-top:8px">${cells}</div><p class="mut">अंक = कक्षा संख्या। पीला = अवकाश। तारीख पर दबाएँ।</p></div>` +
      (sel ? `<h3>${dateLabel(sel)}</h3>` + (byDate[sel] || []).map((t) => testCard(t, '/admin/calendar/' + t.id)).join('') : '');
  };
  const shift = (n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); ym = d.toISOString().slice(0, 7); sel = ''; draw(); };
  ACT.calPrev = () => shift(-1);
  ACT.calNext = () => shift(1);
  ACT.calDay = (el) => { sel = el.dataset.d; draw(); };
  PAGE.after = draw;
  return `<h1>टेस्ट कैलेंडर</h1>${calTabs('month')}<div id="cal"></div>`;
});
route('/admin/calendar/:id', async (p) => {
  const d = await api('/api/tests/' + p.id);
  const t = d.test;
  const send = async (body) => {
    try {
      await api('/api/tests/' + p.id, { method: 'PUT', body });
      toast('शेड्यूल सेव हो गया');
      refresh();
    } catch (e) {
      if (e.status === 409 && e.data && e.data.needs_force) {
        if (confirm('चेतावनी:\n• ' + e.data.warnings.join('\n• ') + '\n\nफिर भी यह तारीख रखें?')) send({ ...body, force: true });
      } else toast(e.message, true);
    }
  };
  FORM.sched = (f) => send({ test_date: f.test_date, max_marks: f.max_marks, duration_min: f.duration_min, status: f.status || 'Completed' });
  const statuses = t.marks_locked ? [['Completed', 'पूर्ण (अंक लॉक)']] : [['Scheduled', 'निर्धारित'], ['Postponed', 'स्थगित'], ['Cancelled', 'रद्द']];
  return `<div class="row"><a data-link class="btn sm" href="/admin/calendar">← कैलेंडर</a></div><div class="card" style="margin-top:10px"><div class="row"><h2 style="margin:0">कक्षा ${t.grade} · ${esc(t.subject_name)} · टेस्ट ${t.test_no}</h2><span class="sp"></span>${statusChip(t)}</div>
    <div>${esc(t.test_code)} · ${esc(t.test_type)} · मूल तारीख ${dateLabel(t.original_date)}</div><div class="full-text" style="margin:6px 0">${esc(t.syllabus)}</div>
    <div>${d.chapters.map((c) => chip(`${c.chapter_no}. ${c.title}`, 'gray')).join(' ')}${t.full_syllabus ? chip('पूरा पाठ्यक्रम', 'gray') : ''}</div></div>
  <form class="card form" data-form="sched"><h2>शेड्यूल बदलें</h2><p class="mut">तारीख बदलने पर यदि वह सोम/बुध/शुक्र नहीं है या अवकाश में है, तो चेतावनी दिखेगी।</p>
    <div class="two"><label>तारीख<input name="test_date" type="date" required value="${esc(t.test_date)}"></label><label>स्थिति<select name="status" ${t.marks_locked ? 'disabled' : ''}>${options(statuses, t.status)}</select></label></div>
    <div class="two"><label>पूर्णांक (Max Marks)<input name="max_marks" type="number" step="0.5" min="1" value="${esc(t.max_marks ?? '')}"></label><label>समय (मिनट)<input name="duration_min" type="number" min="1" value="${esc(t.duration_min ?? '')}"></label></div>
    <button class="btn pri" type="submit">सेव करें</button></form>
  <div class="card"><div class="row"><span>अंक दर्ज: <b>${t.entered}/${t.enrolled}</b></span><span class="sp"></span><a data-link class="btn" href="/admin/marks/${t.id}">अंक देखें / भरें</a></div></div>`;
});

/* ---------- marks, analysis, reports ---------- */
route('/admin/marks', async () => testsListPage({ title: 'अंक', link: (t) => '/admin/marks/' + t.id, defaults: { pending: '1', ...Object.fromEntries(new URLSearchParams(location.search)) }, intro: 'जिस टेस्ट के अंक भरने/सुधारने हैं उस पर दबाएँ। शुरू में सिर्फ़ वही टेस्ट दिख रहे हैं जिनकी अंक-प्रविष्टि बाकी है।' }));
route('/admin/marks/:id', async (p) => marksPage(p.id, 'admin'));
const anTabs = (on) => `<div class="seg noprint">${[['', 'विद्यालय'], ['class', 'कक्षा'], ['student', 'विद्यार्थी']].map(([k, l]) => `<a data-link class="btn ${on === k ? 'on' : ''}" href="/admin/analysis${k ? '/' + k : ''}">${l}</a>`).join('')}</div>`;
route('/admin/analysis', async () => {
  const a = await api('/api/analysis/school');
  return `<h1>विश्लेषण</h1>${anTabs('')}<div class="row noprint" style="margin-bottom:8px"><span class="sp"></span>${downloadLinks('/api/reports/school')}</div>${printHead('विद्यालय विश्लेषण')}${schoolView(a)}`;
});
route('/admin/analysis/class', async () => {
  const [cl, sb] = await Promise.all([api('/api/classes'), api('/api/subjects')]);
  return `<h1>विश्लेषण</h1>${anTabs('class')}` + (await analysisPicker({ mode: 'class', classes: cl.classes, subjects: sb.subjects, title: 'कक्षा विश्लेषण' }));
});
route('/admin/analysis/student', async () => {
  const cl = await api('/api/classes');
  return `<h1>विश्लेषण</h1>${anTabs('student')}` + (await analysisPicker({ mode: 'student', classes: cl.classes, subjects: [], title: 'विद्यार्थी विश्लेषण' }));
});
route('/admin/reports', async () => reportsPage('admin'));

/* ---------- settings ---------- */
route('/admin/settings', async () => {
  const d = await api('/api/settings');
  const s = d.settings;
  FORM.setSave = async (f) => { if (await safe(() => api('/api/settings', { method: 'PUT', body: { school_name: f.school_name, attention_below_pct: f.attention_below_pct, ranking_min_tests: f.ranking_min_tests, restrict_future_entry: f.restrict_future_entry !== undefined } }))) { toast('सेटिंग्स सेव हुईं'); await reloadShell(); } };
  FORM.sesAdd = async (f) => { if (await safe(() => api('/api/sessions', { method: 'POST', body: { name: f.name } }))) { toast('सत्र जुड़ गया'); refresh(); } };
  ACT.sesCur = async (el) => { if (confirm('इस सत्र को चालू करें? सभी सूचियाँ/विश्लेषण इसी सत्र के दिखेंगे।') && (await safe(() => api(`/api/sessions/${el.dataset.id}/current`, { method: 'POST' })))) { toast('चालू सत्र बदला'); await reloadShell(); } };
  FORM.holAdd = async (f) => { if (await safe(() => api('/api/holidays', { method: 'POST', body: f }))) { toast('अवकाश जुड़ गया'); refresh(); } };
  ACT.holDel = async (el) => { if (confirm('यह अवकाश हटाएँ?') && (await safe(() => api('/api/holidays/' + el.dataset.id, { method: 'DELETE' })))) refresh(); };
  FORM.demoDel = async (f) => { if (await safe(() => api('/api/settings/delete-demo', { method: 'POST', body: { confirm: f.confirm } }))) { toast('डेमो डेटा हट गया'); refresh(); } };
  return `<h1>सेटिंग्स</h1>
  <form class="card form" data-form="setSave"><h2>विद्यालय और विश्लेषण</h2><label>विद्यालय का नाम<input name="school_name" required maxlength="100" value="${esc(s.school_name)}"></label>
    <div class="two"><label>"ध्यान चाहिए" का औसत (%)<input name="attention_below_pct" type="number" min="1" max="100" value="${esc(s.attention_below_pct)}"></label><label>रैंकिंग के लिए न्यूनतम टेस्ट<input name="ranking_min_tests" type="number" min="1" max="50" value="${esc(s.ranking_min_tests)}"></label></div>
    <label style="display:flex;gap:6px;align-items:center;color:var(--ink)"><input type="checkbox" name="restrict_future_entry" ${s.restrict_future_entry === 'true' ? 'checked' : ''}> शिक्षक टेस्ट की तारीख से पहले अंक दर्ज न कर सकें</label><button class="btn pri" type="submit">सेव करें</button></form>
  <div class="card"><h2>सत्र</h2>${table(['सत्र', ''], d.sessions.map((x) => [esc(x.name), x.is_current ? chip('चालू', '') : `<button class="btn sm" data-act="sesCur" data-id="${x.id}">चालू करें</button>`]))}
    <form class="row" data-form="sesAdd" style="margin-top:10px"><input name="name" placeholder="2027-28" pattern="\\d{4}-\\d{2}" required style="max-width:160px"><button class="btn" type="submit">नया सत्र जोड़ें</button></form></div>
  <div class="card"><h2>अवकाश (टेस्ट इन तारीखों पर नहीं होंगे)</h2>${table(['से', 'तक', 'विवरण', ''], d.holidays.map((h) => [fmtDate(h.start_date), fmtDate(h.end_date), esc(h.note), `<button class="btn sm bad" data-act="holDel" data-id="${h.id}">हटाएँ</button>`]))}
    <form class="flt" data-form="holAdd" style="margin-top:10px"><label>से<input type="date" name="start_date" required></label><label>तक<input type="date" name="end_date"></label><label>विवरण<input name="note"></label><button class="btn" type="submit" style="align-self:end">अवकाश जोड़ें</button></form></div>
  <div class="card"><h2>अपना पासवर्ड</h2><a data-link class="btn" href="/admin/password">पासवर्ड बदलें</a></div>
  ${d.demo_students ? `<form class="card form" data-form="demoDel"><h2>डेमो डेटा हटाएँ</h2><p class="mut">${d.demo_students} डेमो विद्यार्थी, डेमो शिक्षक और उनके अंक हटेंगे। असली डेटा सुरक्षित रहेगा। असली उपयोग शुरू करने से पहले यह करें।</p><label>पुष्टि के लिए DELETE लिखें<input name="confirm" required autocomplete="off"></label><button class="btn bad" type="submit">डेमो डेटा हटाएँ</button></form>` : ''}`;
});

/* ---------- audit log ---------- */
route('/admin/audit', async () => {
  const F = { action: '', user: '', from: '', to: '' };
  let offset = 0;
  const load = async (append) => {
    const p = new URLSearchParams({ limit: 100, offset });
    Object.entries(F).forEach(([k, v]) => v && p.set(k, v));
    const r = await safe(() => api('/api/audit?' + p));
    if (!r) return;
    const rows = r.rows.map((a) => [fmtDT(a.created_at), esc(a.username || '—'), `<b>${esc(a.action)}</b>`, esc([a.entity, a.entity_id].filter(Boolean).join(' ')), `<small>${esc(a.details || '')}</small>`]);
    const body = rows.map((x) => `<tr>${x.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
    if (append) $('#ab').insertAdjacentHTML('beforeend', body); else $('#ab').innerHTML = body || '<tr><td colspan="5" class="mut">कोई रिकॉर्ड नहीं</td></tr>';
    $('#am').innerHTML = `<small>${r.total} रिकॉर्ड</small>${offset + r.rows.length < r.total ? ' <button class="btn sm" data-act="auMore">और दिखाएँ</button>' : ''}`;
    offset += r.rows.length;
  };
  const reload = debounce(() => { offset = 0; load(false); });
  PAGE.input = (e) => { if (e.target.dataset.af) { F[e.target.dataset.af] = e.target.value.trim(); reload(); } };
  ACT.auMore = () => load(true);
  PAGE.after = () => load(false);
  return `<h1>ऑडिट लॉग</h1><div class="card"><div class="flt"><label>कार्य<input data-af="action" placeholder="जैसे marks, login"></label><label>उपयोगकर्ता<input data-af="user"></label><label>से<input type="date" data-af="from"></label><label>तक<input type="date" data-af="to"></label></div><div id="am"></div></div>
  <div class="card"><div class="tw"><table><thead><tr><th>समय</th><th>उपयोगकर्ता</th><th>कार्य</th><th>विषय-वस्तु</th><th>विवरण</th></tr></thead><tbody id="ab"></tbody></table></div></div>`;
});
