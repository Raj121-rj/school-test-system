'use strict';
/* ===== STUDENT pages (the server only ever returns the logged-in student's own, finalized marks) ===== */
const myAnalysis = () => api('/api/analysis/student/me');
const noData = '<div class="card">अभी आपके अंक उपलब्ध नहीं हैं। टेस्ट के अंक शिक्षक द्वारा अंतिम रूप से जमा करने के बाद यहाँ दिखेंगे।</div>';

route('/student', async () => {
  const [d, a] = await Promise.all([api('/api/dashboard/student'), myAnalysis().catch(() => null)]);
  if (!d.enrolled) return '<h1>नमस्ते</h1><div class="card warn">इस सत्र में आपका नामांकन नहीं मिला। कृपया विद्यालय से संपर्क करें।</div>';
  const s = a && a.summary;
  return `<h1>नमस्ते, ${esc(d.student.name)}</h1><p class="mut">${esc(d.student.class_name)} · रोल ${d.student.roll_no} · ${esc(d.student.code)}</p>
  ${s && (s.given || s.absent) ? studentKpis(s) + trendBlock(a) : noData}
  <div class="card"><h2>आने वाले टेस्ट</h2>${d.upcoming.length ? d.upcoming.map((t) => `<div style="padding:6px 0;border-bottom:1px solid var(--line)"><div class="r2"><b>${dateLabel(t.test_date)} · ${esc(t.subject_name)}</b><small>${t.max_marks ? 'पूर्णांक ' + t.max_marks : ''}${t.duration_min ? ' · ' + t.duration_min + ' मिनट' : ''}</small></div><div class="full-text">${esc(t.syllabus)}</div></div>`).join('') : '<p class="mut">कोई टेस्ट निर्धारित नहीं है।</p>'}<p><a data-link href="/student/tests">सभी टेस्ट देखें →</a></p></div>
  ${s && s.recent.length ? recentBlock(s) : ''}`;
});

route('/student/tests', async () => {
  const d = await api('/api/my/tests');
  const row = (t) => `<div class="card"><div class="row"><b>${dateLabel(t.test_date)}</b><span class="sp"></span>${t.marks_locked ? (t.mark_status === 'absent' ? chip('अनुपस्थित', 'warn') : t.marks != null ? chip(`${t.marks}/${t.max_marks} · ${t.pct}%`, '') : '') : ''}${chip(STATUS_HI[t.status] || t.status, t.status)}</div>
    <div>${esc(t.subject_name)} · टेस्ट ${t.test_no} <small>(${esc(t.test_type)})</small></div><div class="full-text">${esc(t.syllabus)}</div><small>${t.max_marks ? 'पूर्णांक ' + t.max_marks : ''}${t.duration_min ? ' · समय ' + t.duration_min + ' मिनट' : ''}</small></div>`;
  const up = d.tests.filter((t) => t.test_date >= d.today && t.status !== 'Cancelled');
  const past = d.tests.filter((t) => t.test_date < d.today).reverse();
  return `<h1>मेरे टेस्ट</h1><h2>आने वाले (${up.length})</h2>${up.map(row).join('') || '<div class="card mut">कोई नहीं</div>'}<h2>हो चुके (${past.length})</h2>${past.map(row).join('') || '<div class="card mut">कोई नहीं</div>'}`;
});

route('/student/marks', async () => {
  const a = await myAnalysis();
  if (!a.timeline.length) return '<h1>मेरे अंक</h1>' + noData;
  return `<h1>मेरे अंक</h1>${studentKpis(a.summary)}${timelineBlock(a)}`;
});
route('/student/subjects', async () => {
  const a = await myAnalysis();
  return '<h1>विषयवार प्रदर्शन</h1>' + (a.summary.given ? subjectsBlock(a.summary) : noData);
});
route('/student/chapters', async () => {
  const a = await myAnalysis();
  return '<h1>अध्यायवार प्रदर्शन</h1>' + (a.summary.given ? chaptersBlock(a) : noData);
});
route('/student/improvement', async () => {
  const a = await myAnalysis();
  return '<h1>सुधार</h1>' + (a.summary.given ? trendBlock(a) + subjectsBlock(a.summary) + recentBlock(a.summary) : noData);
});
route('/student/reports', async () => {
  const r = await api('/api/reports/student/me');
  return '<h1 class="noprint">मेरी रिपोर्ट</h1><p class="mut noprint">"प्रिंट / PDF" दबाकर रिपोर्ट प्रिंट करें या PDF के रूप में सेव करें।</p>' + renderReport(r, '/api/reports/student/me');
});
