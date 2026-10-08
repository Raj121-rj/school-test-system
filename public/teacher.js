'use strict';
/* ===== TEACHER pages (only assigned classes/subjects are ever returned by the server) ===== */
route('/teacher', async () => {
  const d = await api('/api/dashboard/teacher');
  if (!d.subjects.length) return '<h1>नमस्ते</h1><div class="card warn">अभी आपको कोई कक्षा/विषय नहीं सौंपा गया है। कृपया एडमिन से संपर्क करें।</div>';
  const trow = (t, label) => `<div class="r2" style="padding:5px 0"><span>${dateLabel(t.test_date)} · कक्षा ${t.grade} · ${esc(t.subject_name)} · टेस्ट ${t.test_no} <small>(${t.entered}/${t.enrolled})</small></span><a class="btn sm ${label ? 'pri' : ''}" data-link href="/teacher/marks/${t.id}">${label || 'खोलें'}</a></div>`;
  return `<h1>नमस्ते, ${esc(S.user.full_name)}</h1>
  <div class="card"><h2>आज के टेस्ट · ${dateLabel(d.today)}</h2>${d.today_tests.length ? d.today_tests.map((t) => trow(t, t.marks_locked ? 'देखें' : 'अंक भरें')).join('') : '<p class="mut">आज आपका कोई टेस्ट नहीं है।</p>'}</div>
  <div class="card"><h2>अंक-प्रविष्टि बाकी</h2>${d.pending.length ? d.pending.map((t) => trow(t, 'अंक भरें')).join('') : '<p class="ok">सब टेस्ट के अंक भरे जा चुके हैं।</p>'}</div>
  <div class="card"><h2>आने वाले टेस्ट</h2>${d.upcoming.length ? d.upcoming.map((t) => trow(t)).join('') : '<p class="mut">कोई नहीं।</p>'}</div>
  <div class="card"><h2>मेरी कक्षा / विषय</h2>${d.subjects.map((s) => chip(`${s.class_name} · ${s.subject}`, 'gray')).join(' ')}</div>`;
});

route('/teacher/classes', async () => {
  const d = await api('/api/me/teacher');
  const by = {};
  d.subjects.forEach((s) => { (by[s.class_id] = by[s.class_id] || { name: s.class_name, id: s.class_id, students: s.students, subs: [] }).subs.push(s); });
  ACT.tStudents = async (el) => {
    const r = await safe(() => api('/api/students?class_id=' + el.dataset.id));
    if (!r) return;
    PAGE.input = (e) => {
      if (e.target.dataset.msearch === undefined) return;
      const v = e.target.value.trim().toLowerCase();
      $$('#msl tbody tr').forEach((tr) => { tr.style.display = tr.textContent.toLowerCase().includes(v) ? '' : 'none'; });
    };
    openModal(`<h2>${esc(el.dataset.name)} — विद्यार्थी</h2><input data-msearch placeholder="नाम, रोल या ID से खोजें" aria-label="खोजें" style="margin-bottom:8px"><div class="tw" id="msl" style="max-height:60vh">${table(['रोल', 'नाम', 'ID'], r.students.map((s) => [s.roll_no, esc(s.name), esc(s.code)]))}</div><div class="row end" style="margin-top:10px"><button class="btn" data-act="closeModal">बंद करें</button></div>`);
  };
  return `<h1>मेरी कक्षाएँ</h1>` + (Object.values(by).map((c) => `<div class="card"><div class="row"><h2 style="margin:0">${esc(c.name)}</h2><span class="sp"></span><small>${c.students} विद्यार्थी</small></div>
    <div style="margin:8px 0">${c.subs.map((s) => chip(s.subject, 'gray')).join(' ')}</div><div class="row"><button class="btn sm" data-act="tStudents" data-id="${c.id}" data-name="${esc(c.name)}">विद्यार्थी सूची</button><a data-link class="btn sm" href="/teacher/analysis">कक्षा विश्लेषण</a><a data-link class="btn sm" href="/teacher/performance">विद्यार्थी प्रदर्शन</a></div></div>`).join('') || '<div class="card mut">कोई कक्षा नहीं सौंपी गई।</div>');
});

route('/teacher/subjects', async () => {
  const d = await api('/api/me/teacher');
  return `<h1>मेरे विषय</h1>` + (d.subjects.map((s) => `<div class="card"><div class="row"><h2 style="margin:0">${esc(s.class_name)} · ${esc(s.subject)}</h2></div>
    <div class="grid" style="margin-top:8px">${kpi('कुल टेस्ट', s.tests)}${kpi('अंक लॉक', s.locked)}${kpi('प्रविष्टि बाकी', s.pending, s.pending ? 'warn' : '')}${kpi('विद्यार्थी', s.students)}</div>
    <div class="row"><a data-link class="btn sm" href="/teacher/tests?class_id=${s.class_id}&subject_id=${s.subject_id}">सभी टेस्ट</a><a data-link class="btn sm" href="/teacher/marks?class_id=${s.class_id}&subject_id=${s.subject_id}&pending=1">अंक भरें</a></div></div>`).join('') || '<div class="card mut">कोई विषय नहीं सौंपा गया।</div>');
});

const qs = () => Object.fromEntries(new URLSearchParams(location.search));
route('/teacher/tests', async () => testsListPage({ title: 'निर्धारित टेस्ट', link: (t) => '/teacher/marks/' + t.id, defaults: qs(), intro: 'सिर्फ़ आपके सौंपे गए विषयों के टेस्ट। सिलेबस हर टेस्ट पर दिखता है; टेस्ट पर दबाकर अंक भरें।' }));
route('/teacher/marks', async () => testsListPage({ title: 'अंक प्रविष्टि', link: (t) => '/teacher/marks/' + t.id, defaults: { pending: '1', ...qs() }, intro: 'जिस टेस्ट के अंक भरने हैं उस पर दबाएँ। शुरू में सिर्फ़ वही टेस्ट दिख रहे हैं जिनके अंक बाकी हैं।' }));
route('/teacher/marks/:id', async (p) => marksPage(p.id, 'teacher'));
route('/teacher/performance', async () => {
  const cl = await api('/api/classes');
  return '<h1>विद्यार्थी प्रदर्शन</h1>' + (await analysisPicker({ mode: 'student', classes: cl.classes, subjects: [], title: 'विद्यार्थी प्रदर्शन' }));
});
route('/teacher/analysis', async () => {
  const [cl, sb] = await Promise.all([api('/api/classes'), api('/api/subjects')]);
  return '<h1>कक्षा विश्लेषण</h1>' + (await analysisPicker({ mode: 'class', classes: cl.classes, subjects: sb.subjects, title: 'कक्षा विश्लेषण' }));
});
route('/teacher/reports', async () => reportsPage('teacher'));
