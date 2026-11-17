// Dempo Learn front end: one small module, hash router, no build step.
// All dynamic text goes through html`` which escapes by default.
const app = document.getElementById('app'), live = document.getElementById('live');
const state = { user: null, unread: 0 };

// ---------- tiny helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const raw = (s) => ({ __html: s });
const html = (strings, ...vals) => raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? render(vals[i]) : ''), ''));
const render = (v) => (v == null || v === false ? '' : Array.isArray(v) ? v.map(render).join('') : v?.__html !== undefined ? v.__html : esc(v));
const $ = (sel, root = document) => root.querySelector(sel), $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const fmtDate = (iso, opts) => (iso ? new Date(iso).toLocaleString('en-IN', opts || { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const fmtDay = (iso) => fmtDate(iso, { day: 'numeric', month: 'short', year: 'numeric' });
const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const announce = (t) => { live.textContent = ''; setTimeout(() => (live.textContent = t), 50); };
function toast(msg, kind = '') {
  $$('.toast').forEach((t) => t.remove());
  const el = document.createElement('div'); el.className = 'toast ' + kind; el.setAttribute('role', kind === 'err' ? 'alert' : 'status'); el.textContent = msg;
  document.body.append(el); setTimeout(() => el.remove(), 5000);
}
const P = { // lucide-style icon paths
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5', bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8', clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2', users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', check: 'M20 6 9 17l-5-5', alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z', download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3', plus: 'M12 5v14M5 12h14', out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12', wifi: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01M2 9a15 15 0 0 1 20 0',
};
const icon = (n) => raw(`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[n]}"/></svg>`);
const pill = (kind, text) => html`<span class="pill ${kind}">${text}</span>`;
const notice = (kind, body, title) => html`<div class="notice ${kind}" role="${kind === 'err' ? 'alert' : 'note'}">${icon(kind === 'ok' ? 'check' : kind === 'info' ? 'shield' : 'alert')}<div>${title ? html`<strong>${title}</strong><br>` : ''}${body}</div></div>`;
const empty = (ic, title, body, action) => html`<div class="empty">${icon(ic)}<h3>${title}</h3><p>${body}</p>${action || ''}</div>`;

async function api(method, path, body) {
  let r;
  try { r = await fetch('/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' }); }
  catch { throw Object.assign(new Error("We can't reach the server right now. Check your connection — nothing you've done is lost."), { offline: true }); }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (r.status === 401 && path !== '/login') { state.user = null; location.hash = '#/login'; throw Object.assign(new Error(data.error), { auth: true }); }
  if (!r.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: r.status });
  return data;
}
const GET = (p) => api('GET', p), POST = (p, b) => api('POST', p, b || {});
const formData = (form) => Object.fromEntries(new FormData(form).entries());
// submit helper: disables the button, shows errors inline, never swallows them
function onSubmit(form, fn) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form), label = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = 'Working…'; }
    $('.form-error', form)?.remove();
    try { await fn(formData(form), form); }
    catch (err) { const n = document.createElement('div'); n.className = 'form-error'; n.innerHTML = notice('err', err.message).__html; form.prepend(n); n.scrollIntoView({ block: 'nearest' }); }
    finally { if (btn?.isConnected) { btn.disabled = false; btn.textContent = label; } }
  });
}

// ---------- layout ----------
function shell(content, { crumbs = '', wide = false } = {}) {
  const u = state.user, admin = u.role === 'admin';
  app.innerHTML = html`
  <header class="topbar"><div class="inner">
    <a class="brand" href="#/"><svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#fff"/><path d="M8 22V10h6.2c4 0 6.3 2.3 6.3 6s-2.3 6-6.3 6H8zm3-2.7h3c2 0 3.2-1.2 3.2-3.3s-1.2-3.3-3.2-3.3h-3v6.6z" fill="#07404a"/><circle cx="24" cy="9" r="2.5" fill="#e8892f"/></svg>Dempo Learn</a>
    <nav aria-label="Main">
      <a href="#/" ${active('')}>${icon('book')}Courses</a>
      ${admin ? html`<a href="#/admin" ${active('admin')}>${icon('users')}Admin</a>` : ''}
      <a href="#/notifications" ${active('notifications')}>${icon('bell')}Updates ${state.unread ? html`<span class="badge-n" aria-label="${state.unread} unread">${state.unread}</span>` : ''}</a>
      <a href="#/privacy" ${active('privacy')}>${icon('shield')}Privacy</a>
      <a href="#/account" ${active('account')}>${u.name.split(' ')[0]}</a>
      <button id="logout">${icon('out')}Sign out</button>
    </nav>
  </div></header>
  <main id="main" tabindex="-1">${crumbs ? html`<div class="crumbs">${crumbs}</div>` : ''}${content}</main>`.__html;
  $('#logout').onclick = async () => { await POST('/logout'); state.user = null; location.hash = '#/login'; };
}
const active = (name) => raw((location.hash.split('/')[1] || '') === name ? 'aria-current="page"' : '');
function mount(content, opts) { shell(content, opts); const h = $('main h1'); (h || $('#main')).setAttribute('tabindex', '-1'); (h || $('#main')).focus({ preventScroll: true }); document.title = (h ? h.textContent + ' · ' : '') + 'Dempo Learn'; window.scrollTo(0, 0); $$('[data-w]').forEach((e) => (e.style.width = e.dataset.w + '%')); }

// ---------- screens ----------
async function loginScreen() {
  document.title = 'Sign in · Dempo Learn';
  app.innerHTML = html`<div class="login-wrap">
    <section class="login-side" aria-label="About Dempo Learn">
      <div class="brand"><svg width="36" height="36" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#fff"/><path d="M8 22V10h6.2c4 0 6.3 2.3 6.3 6s-2.3 6-6.3 6H8zm3-2.7h3c2 0 3.2-1.2 3.2-3.3s-1.2-3.3-3.2-3.3h-3v6.6z" fill="#07404a"/><circle cx="24" cy="9" r="2.5" fill="#e8892f"/></svg>Dempo Learn</div>
      <h1>Coursework, exams and marks — in one place.</h1>
      <p>Built for how your college actually works: internal and external marks, exams that survive a dropped connection, and student data that stays in India.</p>
      <ul><li>Exam clock kept by the server, answers saved as you go</li><li>Gradebook that matches your university's marking scheme</li><li>Your data, hosted by your college</li></ul>
    </section>
    <main class="login-form" id="main"><div class="card stack">
      <h2>Sign in</h2>
      <form id="f" novalidate>
        <div class="field"><label for="email">College email</label><input id="email" name="email" type="email" autocomplete="username" required placeholder="name@student.dempo.edu"></div>
        <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn" type="submit">Sign in</button>
      </form>
      <details class="small"><summary>Trying the demo?</summary><p class="muted">Demo accounts (every password is <code>dempo-demo-1</code>): <code>demo.student@student.dempo.edu</code>, <code>priya.kamat@dempo.edu</code> (teacher), <code>admin@dempo.edu</code>.</p></details>
      <p class="small muted">Forgot your password? Ask the registrar's office to reset it.</p>
    </div></main></div>`.__html;
  const f = $('#f'); $('#email').focus();
  onSubmit(f, async (d) => { const r = await POST('/login', d); state.user = r.user; location.hash = '#/'; route(); });
}

async function gate() { // consent (DPDP) and forced password change before anything else
  if (state.user.must_change) {
    mount(html`<h1>Set your own password</h1><div class="card"><p>You're using a temporary password. Choose one only you know (at least 8 characters).</p>
      <form id="pw"><div class="field"><label for="p">New password</label><input id="p" name="password" type="password" minlength="8" autocomplete="new-password" required></div><button class="btn" type="submit">Save password</button></form></div>`);
    onSubmit($('#pw'), async (d) => { await POST('/password', d); state.user.must_change = false; toast('Password saved.'); route(); });
    return true;
  }
  if (state.user.role === 'student' && !state.user.consent_at) {
    mount(html`<h1>Before you start</h1><div class="card stack"><p>Dempo Learn keeps your name, college email, roll number, coursework, marks and attendance so your teachers can teach and grade you. It is stored on servers in India run by your college. It is not sold or used for advertising.</p>
      <ul><li>You can download everything we hold about you at any time (Privacy page).</li><li>Records are kept for your enrolment plus the retention period in the <a href="#/privacy">privacy notice</a>.</li></ul>
      <form id="c"><label class="row"><input type="checkbox" name="ok" required> <span>I have read the privacy notice and agree to my data being processed as described.</span></label><div class="row"><button class="btn" type="submit">Continue</button><a class="btn secondary" href="#/privacy">Read the notice</a></div></form></div>`);
    onSubmit($('#c'), async () => { await POST('/consent'); state.user.consent_at = new Date().toISOString(); route(); });
    return true;
  }
  return false;
}

async function dashboard() {
  const { courses } = await GET('/courses'), u = state.user, teaching = u.role !== 'student';
  mount(html`<div class="row spread"><h1>${teaching ? 'Your courses' : `Hello, ${u.name.split(' ')[0]}`}</h1>
      ${teaching ? html`<button class="btn" id="newc">${icon('plus')}New course</button>` : ''}</div>
    ${teaching ? html`<form id="cf" class="card stack" hidden><h2>New course</h2><div class="form-grid">
      <div class="field"><label for="code">Course code</label><input id="code" name="code" required placeholder="CS301"></div>
      <div class="field"><label for="title">Title</label><input id="title" name="title" required></div>
      <div class="field"><label for="iw">Internal marks weight (%)</label><input id="iw" name="internal_weight" type="number" min="0" max="100" value="40"><div class="hint">The rest is the external (end-semester) weight.</div></div></div>
      <div class="field"><label for="desc">Description</label><textarea id="desc" name="description"></textarea></div><button class="btn" type="submit">Create course</button></form>` : ''}
    ${courses.length ? html`<div class="grid">${courses.map((c) => html`<a class="card" href="#/course/${c.id}"><span class="pill info">${c.code}</span><h2>${c.title}</h2>
        <p class="muted small">${c.teacher_name} · ${c.students} student${c.students === 1 ? '' : 's'}</p>
        <p class="small">${c.upcoming ? pill('warn', `${c.upcoming} assignment${c.upcoming === 1 ? '' : 's'} coming up`) : pill('plain', 'Nothing due')}</p></a>`)}</div>`
    : empty('book', teaching ? 'No courses yet' : "You're not in any courses yet", teaching ? 'Create your first course, then share its join code with students — or ask the registrar to import your class list.' : 'Ask your teacher for a join code, or wait for the registrar to add you. Your courses will appear here.')}
    ${u.role === 'student' ? html`<h2 style="margin-top:32px">Join a course</h2><form id="jf" class="card row"><div class="field" style="margin:0;flex:1;min-width:200px"><label for="jc">Join code</label><input id="jc" name="code" required autocomplete="off"></div><button class="btn" type="submit" style="align-self:end">Join</button></form>` : ''}`);
  if (teaching) { $('#newc').onclick = () => { const f = $('#cf'); f.hidden = !f.hidden; if (!f.hidden) $('#code').focus(); }; onSubmit($('#cf'), async (d) => { const r = await POST('/courses', d); location.hash = '#/course/' + r.id; }); }
  if ($('#jf')) onSubmit($('#jf'), async (d) => { const r = await POST('/courses/join', d); toast('You joined the course.'); location.hash = '#/course/' + r.id; });
}

const tabsFor = (id, current, staff) => html`<nav class="tabs" aria-label="Course sections">${[['stream', 'Stream'], ['classwork', 'Classwork'], ['exams', 'Exams'], ['grades', 'Grades'], ['attendance', 'Attendance'], ...(staff ? [['people', 'People']] : [])].map(([k, l]) => html`<a href="#/course/${id}/${k}" ${raw(k === current ? 'aria-current="page"' : '')}>${l}</a>`)}</nav>`;
const dueBadge = (a) => { if (!a.due_at) return pill('plain', 'No due date'); const late = Date.now() > Date.parse(a.due_at); return late ? pill('err', 'Past due ' + fmtDate(a.due_at)) : pill('warn', 'Due ' + fmtDate(a.due_at)); };

async function coursePage(id, tab = 'stream') {
  const d = await GET(`/courses/${id}`), c = d.course, staff = state.user.role !== 'student';
  let body = '';
  if (tab === 'stream') body = html`
    ${staff ? html`<form id="pf" class="card stack"><h2>Post to your class</h2><div class="form-grid"><div class="field"><label for="pt">Title</label><input id="pt" name="title" required></div>
      <div class="field"><label for="pk">Type</label><select id="pk" name="kind"><option value="announcement">Announcement</option><option value="material">Study material</option></select></div></div>
      <div class="field"><label for="pb">Message</label><textarea id="pb" name="body"></textarea></div><div class="field"><label for="pl">Link (optional)</label><input id="pl" name="link" type="url" placeholder="https://"></div>
      <button class="btn" type="submit">Post</button></form>` : ''}
    ${d.posts.length ? d.posts.map((p) => html`<article class="card post ${p.kind}" style="margin-top:16px"><div class="row spread"><h3>${p.title}</h3>${pill(p.kind === 'material' ? 'warn' : 'info', p.kind === 'material' ? 'Material' : 'Announcement')}</div>
      <p class="small muted">${p.author} · ${fmtDay(p.created_at + (p.created_at.endsWith('Z') ? '' : 'Z'))}</p>${p.body ? html`<p style="white-space:pre-wrap">${p.body}</p>` : ''}${p.link ? html`<p><a href="${p.link}" target="_blank" rel="noopener noreferrer">${p.link}</a></p>` : ''}</article>`)
    : empty('inbox', 'Nothing posted yet', staff ? 'Post a welcome note or your first reading — students are notified straight away.' : 'Your teacher has not posted anything yet. New material and announcements will show up here.')}`;
  if (tab === 'classwork') body = html`${staff ? html`<details class="card"><summary><strong>Create assignment</strong></summary><form id="af" class="stack" style="margin-top:16px"><div class="form-grid">
      <div class="field"><label for="at">Title</label><input id="at" name="title" required></div><div class="field"><label for="ap">Marks</label><input id="ap" name="points" type="number" min="1" value="20" required></div>
      <div class="field"><label for="ad">Due</label><input id="ad" name="due_at" type="datetime-local"></div>
      <div class="field"><label for="ac">Counts towards</label><select id="ac" name="category"><option value="internal">Internal marks</option><option value="external">External marks</option></select></div></div>
      <div class="field"><label for="ai">Instructions</label><textarea id="ai" name="instructions"></textarea></div><button class="btn" type="submit">Publish assignment</button></form></details>` : ''}
    <div class="stack" style="margin-top:16px">${d.assignments.length ? d.assignments.map((a) => html`<a class="card" href="#/assignment/${a.id}"><div class="row spread"><h3>${a.title}</h3><span class="row">${dueBadge(a)}${a.mine ? (a.mine.grade != null ? pill('ok', `${a.mine.grade}/${a.points}`) : pill('info', a.mine.late ? 'Submitted late' : 'Submitted')) : !staff && a.due_at && Date.now() > Date.parse(a.due_at) ? pill('err', 'Missing') : ''}</span></div>
      <p class="small muted">${a.points} marks · ${a.category}${staff ? ` · ${a.submitted} submitted, ${a.graded} graded` : ''}</p></a>`)
      : empty('file', 'No assignments yet', staff ? 'Create an assignment above and students will be notified.' : 'Nothing to hand in right now. Enjoy it while it lasts.')}</div>`;
  if (tab === 'exams') body = html`${staff ? html`<p><a class="btn" href="#/exam-new/${c.id}">${icon('plus')}Schedule an exam</a></p>` : ''}
    <div class="stack">${d.exams.length ? d.exams.map((e) => html`<a class="card" href="#/exam/${e.id}"><div class="row spread"><h3>${e.title}</h3>${e.mine?.submitted_at ? pill('ok', `Done — ${e.mine.score}/${e.total_points}`) : e.state === 'open' ? pill('warn', 'Open now') : e.state === 'upcoming' ? pill('info', 'Opens ' + fmtDate(e.opens_at)) : pill('plain', 'Closed')}</div>
      <p class="small muted">${e.question_count} questions · ${e.total_points} marks · ${e.duration_min} minutes · ${e.category} · window ${fmtDate(e.opens_at)} – ${fmtDate(e.closes_at)}</p></a>`)
      : empty('clock', 'No exams scheduled', staff ? 'Schedule an exam: the server keeps the clock and saves answers as students go.' : 'No exams are scheduled. You will get an update when one is.')}</div>`;
  if (tab === 'people' && staff) body = html`<div class="card"><h2>Join code</h2><p>Students can enter <strong style="font-size:1.25rem;letter-spacing:.08em">${c.join_code}</strong> on their Courses page.</p></div>
    <h2 style="margin-top:24px">${d.people.length} enrolled</h2>${d.people.length ? html`<div class="table-wrap"><table class="cards"><thead><tr><th>Roll no</th><th>Name</th><th>Email</th></tr></thead><tbody>${d.people.map((p) => html`<tr><td data-label="Roll no">${p.roll_no || '—'}</td><td data-label="Name">${p.name}</td><td data-label="Email">${p.email}</td></tr>`)}</tbody></table></div>` : empty('users', 'No students yet', 'Share the join code above, or ask the registrar to import your class list.')}`;
  mount(html`<h1>${c.title}</h1><p class="muted">${c.code} · ${c.teacher_name}</p>${tabsFor(c.id, tab, staff)}${tab === 'grades' || tab === 'attendance' ? html`<div id="lazy"></div>` : body}`, { crumbs: html`<a href="#/">Courses</a> / ${c.code}` });
  if (tab === 'grades') return gradesTab(c, staff);
  if (tab === 'attendance') return attendanceTab(c, staff);
  if ($('#pf')) onSubmit($('#pf'), async (f) => { await POST(`/courses/${id}/posts`, f); toast('Posted.'); route(); });
  if ($('#af')) onSubmit($('#af'), async (f) => { await POST(`/courses/${id}/assignments`, { ...f, points: Number(f.points) }); toast('Assignment published.'); route(); });
}

async function gradesTab(c, staff) {
  const g = await GET(`/courses/${c.id}/gradebook`), w = g.course.internal_weight;
  const cell = (s, it) => s.scores[it.key] !== undefined ? html`${s.scores[it.key]}${s.status[it.key] === 'missing' ? html` ${pill('err', 'missing')}` : ''}` : html`<span class="muted">${s.status[it.key] || '—'}</span>`;
  const pc = (v) => (v == null ? '—' : v + '%');
  $('#lazy').innerHTML = html`
    ${notice('info', `Final = internal × ${w}% + external × ${100 - w}%. Assignments count once graded (0 if past due and not submitted); exams count once submitted. If a component has no marks yet, the final shows that component alone.`, 'How marks are calculated')}
    ${staff ? html`<p><a class="btn secondary" href="/api/courses/${c.id}/gradebook.csv" download>${icon('download')}Export marks (CSV)</a></p>` : ''}
    ${!g.students.length ? empty('users', 'No students to grade', 'Marks appear here once students are enrolled.') : !g.items.length ? empty('file', 'No graded work yet', 'Create an assignment or exam and marks will build up here.') :
    staff ? html`<div class="table-wrap"><table class="cards"><thead><tr><th>Student</th>${g.items.map((i) => html`<th class="num">${i.title}<br><span class="muted small">/${i.max} · ${i.category}</span></th>`)}<th class="num">Internal</th><th class="num">External</th><th class="num">Final</th><th>Grade</th></tr></thead><tbody>
      ${g.students.map((s) => html`<tr><td data-label="Student"><strong>${s.name}</strong><br><span class="muted small">${s.roll_no || ''}</span></td>${g.items.map((i) => html`<td class="num" data-label="${i.title}">${cell(s, i)}</td>`)}<td class="num" data-label="Internal">${pc(s.internal_pct)}</td><td class="num" data-label="External">${pc(s.external_pct)}</td><td class="num" data-label="Final"><strong>${pc(s.final_pct)}</strong></td><td data-label="Grade">${pill(s.grade === 'F' ? 'err' : 'info', s.grade)}</td></tr>`)}</tbody></table></div>`
    : (() => { const s = g.students[0]; return html`<div class="stats"><div class="card"><div class="stat">${pc(s.final_pct)}</div><div class="muted small">Final so far</div></div><div class="card"><div class="stat">${s.grade}</div><div class="muted small">Grade</div></div><div class="card"><div class="stat">${pc(s.internal_pct)}</div><div class="muted small">Internal</div></div><div class="card"><div class="stat">${pc(s.external_pct)}</div><div class="muted small">External</div></div></div>
      <div class="table-wrap" style="margin-top:16px"><table class="cards"><thead><tr><th>Item</th><th>Counts towards</th><th class="num">Marks</th></tr></thead><tbody>${g.items.map((i) => html`<tr><td data-label="Item">${i.title}</td><td data-label="Counts towards">${i.category}</td><td class="num" data-label="Marks">${cell(s, i)} / ${i.max}</td></tr>`)}</tbody></table></div>`; })()}`.__html;
}

async function attendanceTab(c, staff) {
  if (!staff) {
    const { records } = await GET(`/courses/${c.id}/attendance`), pres = records.filter((r) => r.status !== 'absent').length, pct = records.length ? Math.round((pres / records.length) * 100) : null;
    $('#lazy').innerHTML = html`${records.length ? html`<div class="card"><div class="stat">${pct}%</div><p class="muted">present across ${records.length} classes</p><div class="meter" role="img" aria-label="${pct}% attendance"><span data-w="${pct}"></span></div>${pct < 75 ? notice('warn', 'Below the usual 75% requirement. Talk to your teacher early.') : ''}</div>
      <div class="table-wrap" style="margin-top:16px"><table class="cards"><thead><tr><th>Date</th><th>Status</th></tr></thead><tbody>${records.map((r) => html`<tr><td data-label="Date">${fmtDay(r.day)}</td><td data-label="Status">${pill(r.status === 'absent' ? 'err' : r.status === 'late' ? 'warn' : 'ok', r.status)}</td></tr>`)}</tbody></table></div>` : empty('clock', 'No attendance recorded yet', 'Your teacher will mark attendance after each class.')}`.__html;
    $$('[data-w]').forEach((e) => (e.style.width = e.dataset.w + '%')); return;
  }
  const day = new URLSearchParams(location.hash.split('?')[1] || '').get('day') || new Date().toISOString().slice(0, 10);
  const a = await GET(`/courses/${c.id}/attendance?day=${day}`);
  $('#lazy').innerHTML = html`<form id="att" class="stack"><div class="row"><div class="field" style="margin:0"><label for="day">Date</label><input id="day" type="date" name="day" value="${a.day}" required></div><button class="btn secondary" type="button" id="all" style="align-self:end">Mark everyone present</button></div>
    ${a.students.length ? html`<div class="table-wrap"><table class="cards"><thead><tr><th>Student</th><th>Status</th></tr></thead><tbody>${a.students.map((s) => html`<tr><td data-label="Student">${s.name} <span class="muted small">${s.roll_no || ''}</span></td><td data-label="Status"><select name="m${s.id}" aria-label="Attendance for ${s.name}" style="width:auto"><option value="">Not marked</option>${['present', 'absent', 'late'].map((o) => html`<option value="${o}" ${raw(s.status === o ? 'selected' : '')}>${o[0].toUpperCase() + o.slice(1)}</option>`)}</select></td></tr>`)}</tbody></table></div><button class="btn" type="submit">Save attendance</button>` : empty('users', 'No students enrolled', 'Enrol students first.')}</form>`.__html;
  const f = $('#att'); if (!f) return;
  $('#day').onchange = (e) => { location.hash = `#/course/${c.id}/attendance?day=${e.target.value}`; };
  $('#all').onclick = () => $$('select[name^=m]', f).forEach((s) => (s.value = 'present'));
  onSubmit(f, async (d) => { const marks = {}; for (const [k, v] of Object.entries(d)) if (k.startsWith('m') && v) marks[k.slice(1)] = v; await POST(`/courses/${c.id}/attendance`, { day: d.day, marks }); toast('Attendance saved.'); });
}

async function assignmentPage(id) {
  const d = await GET(`/assignments/${id}`), a = d.assignment, staff = state.user.role !== 'student';
  const head = html`<h1>${a.title}</h1><p class="row">${dueBadge(a)}${pill('plain', a.points + ' marks')}${pill('plain', a.category)}</p>${a.instructions ? html`<div class="card"><p style="white-space:pre-wrap;margin:0">${a.instructions}</p></div>` : ''}`;
  const crumbs = html`<a href="#/">Courses</a> / <a href="#/course/${d.course.id}/classwork">${d.course.code}</a> / ${a.title}`;
  if (staff) {
    mount(html`${head}<h2 style="margin-top:24px">Submissions</h2>${d.submissions.length ? html`<div class="table-wrap"><table class="cards"><thead><tr><th>Student</th><th>Work</th><th>Status</th><th>Marks (/${a.points})</th><th>Feedback</th><th></th></tr></thead><tbody>
      ${d.submissions.map((s) => html`<tr><td data-label="Student">${s.name}<br><span class="muted small">${s.roll_no || ''}</span></td>
        <td data-label="Work">${s.id ? html`<details><summary>View</summary><p style="white-space:pre-wrap;text-align:left">${s.text}</p>${s.link ? html`<a href="${s.link}" target="_blank" rel="noopener noreferrer">Open link</a>` : ''}</details>` : '—'}</td>
        <td data-label="Status">${!s.id ? pill(Date.now() > Date.parse(a.due_at || '9999') ? 'err' : 'plain', 'Not submitted') : s.late ? pill('warn', 'Late') : pill('info', 'On time')}${s.attempts > 1 ? html` <span class="muted small">v${s.attempts}</span>` : ''}</td>
        ${s.id ? html`<td data-label="Marks"><form class="gf" data-sid="${s.student_id}"><label class="sr-only" for="g${s.student_id}">Marks for ${s.name}</label><input id="g${s.student_id}" name="grade" type="number" min="0" max="${a.points}" step="0.5" value="${s.grade ?? ''}" style="width:90px"></td>
        <td data-label="Feedback"><label class="sr-only" for="f${s.student_id}">Feedback for ${s.name}</label><input id="f${s.student_id}" name="feedback" value="${s.feedback}" placeholder="Optional"></td><td><button class="btn sm" type="submit">Save</button></form></td>` : html`<td></td><td></td><td></td>`}</tr>`)}</tbody></table></div>` : empty('users', 'No students enrolled', 'Enrol students to collect submissions.')}`, { crumbs });
    $$('.gf').forEach((f) => { f.closest('tr').addEventListener('submit', (e) => e.preventDefault()); f.addEventListener('submit', (e) => e.preventDefault()); const btn = $('button', f); btn.onclick = async (e) => { e.preventDefault(); try { await POST(`/assignments/${id}/grade`, { student_id: f.dataset.sid, grade: $('[name=grade]', f).value, feedback: $('[name=feedback]', f).value }); toast('Saved.'); } catch (err) { toast(err.message, 'err'); } }; });
    return;
  }
  const m = d.mine;
  mount(html`${head}${m?.grade != null ? html`<div class="card" style="margin-top:16px"><h2>Your result</h2><div class="stat">${m.grade}<span class="muted small"> / ${a.points}</span></div>${m.feedback ? html`<p><strong>Feedback:</strong> ${m.feedback}</p>` : ''}</div>` : ''}
    <div class="card stack" style="margin-top:16px"><h2>${m ? 'Your submission' : 'Hand in your work'}</h2>
    ${m ? notice(m.late ? 'warn' : 'ok', `Submitted ${fmtDate(m.submitted_at)}${m.late ? ' — marked late' : ''}${m.attempts > 1 ? ` (version ${m.attempts})` : ''}.`) : a.due_at && Date.now() > Date.parse(a.due_at) ? notice('warn', 'The due date has passed. You can still submit; it will be marked late.') : ''}
    ${m?.grade != null ? html`<p class="muted">This work has been graded and is locked.</p>` : html`<form id="sf"><div class="field"><label for="st">Your answer</label><textarea id="st" name="text">${m?.text || ''}</textarea></div><div class="field"><label for="sl">Link to your file or repository (optional)</label><input id="sl" name="link" type="url" placeholder="https://" value="${m?.link || ''}"><div class="hint">Upload to your college drive and paste a share link.</div></div><button class="btn" type="submit">${m ? 'Resubmit' : 'Submit'}</button></form>`}</div>`, { crumbs });
  if ($('#sf')) onSubmit($('#sf'), async (f) => { const r = await POST(`/assignments/${id}/submit`, f); toast(r.late ? 'Submitted — marked late.' : 'Submitted. Well done.'); route(); });
}

// ---------- exams ----------
async function examNew(courseId) {
  const open = new Date(), close = new Date(Date.now() + 2 * 864e5);
  mount(html`<h1>Schedule an exam</h1><form id="ef" class="stack"><div class="card"><div class="form-grid"><div class="field"><label for="et">Title</label><input id="et" name="title" required></div>
    <div class="field"><label for="ed">Time allowed once started (minutes)</label><input id="ed" name="duration_min" type="number" min="1" value="30" required></div>
    <div class="field"><label for="eo">Opens</label><input id="eo" name="opens_at" type="datetime-local" value="${toLocalInput(open)}" required></div>
    <div class="field"><label for="ec">Closes</label><input id="ec" name="closes_at" type="datetime-local" value="${toLocalInput(close)}" required></div>
    <div class="field"><label for="ek">Counts towards</label><select id="ek" name="category"><option value="internal">Internal marks</option><option value="external">External marks</option></select></div></div></div>
    <div id="qs" class="stack"></div><div class="row"><button class="btn secondary" type="button" id="addq">${icon('plus')}Add question</button><button class="btn" type="submit">Publish exam</button></div></form>`, { crumbs: html`<a href="#/course/${courseId}/exams">Exams</a> / New` });
  let n = 0;
  const addQ = () => { n++; const d = document.createElement('div'); d.className = 'card'; d.innerHTML = html`<fieldset style="border:0;padding:0;margin:0"><legend><h3>Question ${n}</h3></legend><div class="field"><label for="q${n}">Question</label><textarea id="q${n}" data-f="text" required></textarea></div>
    ${[0, 1, 2, 3].map((i) => html`<div class="row" style="margin-bottom:8px"><input type="radio" name="ans${n}" value="${i}" aria-label="Option ${i + 1} is correct" ${raw(i === 0 ? 'checked' : '')}><input data-f="opt" aria-label="Option ${i + 1} text" placeholder="Option ${i + 1}" style="flex:1" ${raw(i < 2 ? 'required' : '')}></div>`)}<p class="hint">Select the radio button next to the correct option. Leave unused options blank.</p>
    <div class="field" style="max-width:140px"><label for="p${n}">Marks</label><input id="p${n}" data-f="points" type="number" min="1" value="1"></div></fieldset>`.__html; $('#qs').append(d); };
  addQ(); $('#addq').onclick = () => { addQ(); $$('#qs textarea').pop().focus(); };
  onSubmit($('#ef'), async (d) => {
    const questions = $$('#qs > .card').map((card) => { const opts = $$('[data-f=opt]', card), sel = Number($('input[type=radio]:checked', card).value); const options = [], map = []; opts.forEach((o, i) => { if (o.value.trim()) { map[i] = options.length; options.push(o.value.trim()); } });
      if (map[sel] === undefined) throw new Error('A question has its correct answer set on a blank option.'); return { text: $('[data-f=text]', card).value, options, answer: map[sel], points: Number($('[data-f=points]', card).value) }; });
    await POST(`/courses/${courseId}/exams`, { ...d, duration_min: Number(d.duration_min), opens_at: new Date(d.opens_at).toISOString(), closes_at: new Date(d.closes_at).toISOString(), questions });
    toast('Exam scheduled and students notified.'); location.hash = `#/course/${courseId}/exams`;
  });
}

let examTimer = null;
let retryTimer = null, onlineHandler = null;
const stopExam = () => { clearInterval(examTimer); clearInterval(retryTimer); examTimer = null; retryTimer = null; if (onlineHandler) { removeEventListener('online', onlineHandler); onlineHandler = null; } };
async function examPage(id) {
  stopExam();
  const d = await GET(`/exams/${id}`), e = d.exam, crumbs = html`<a href="#/">Courses</a> / <a href="#/course/${d.course.id}/exams">${d.course.code}</a> / ${e.title}`;
  if (state.user.role !== 'student') {
    mount(html`<h1>${e.title}</h1><p class="row">${pill('info', e.duration_min + ' minutes')}${pill('plain', `Opens ${fmtDate(e.opens_at)}`)}${pill('plain', `Closes ${fmtDate(e.closes_at)}`)}</p>
      <h2>Results</h2><div class="table-wrap"><table class="cards"><thead><tr><th>Student</th><th>Status</th><th class="num">Score (/${d.questions.reduce((s, q) => s + q.points, 0)})</th><th class="num">Auto-saves</th></tr></thead><tbody>${d.results.map((r) => html`<tr><td data-label="Student">${r.name}<br><span class="muted small">${r.roll_no || ''}</span></td><td data-label="Status">${r.submitted_at ? pill('ok', 'Submitted ' + fmtDate(r.submitted_at)) : r.started_at ? pill('warn', 'In progress') : pill('plain', 'Not started')}</td><td class="num" data-label="Score">${r.score ?? '—'}</td><td class="num" data-label="Auto-saves">${r.saves ?? '—'}</td></tr>`)}</tbody></table></div>
      <h2 style="margin-top:24px">Questions (answer key)</h2><ol>${d.questions.map((q) => html`<li><p>${q.text} <span class="muted small">(${q.points} mark${q.points > 1 ? 's' : ''})</span></p><ul>${q.options.map((o, i) => html`<li>${o}${i === q.answer ? pill('ok', 'correct') : ''}</li>`)}</ul></li>`)}</ol>`, { crumbs });
    return;
  }
  const a = d.attempt;
  if (a?.submitted_at) return mount(html`<h1>${e.title}</h1>${notice('ok', html`Your exam was submitted ${fmtDate(a.submitted_at)}. You scored <strong>${a.score} / ${d.total_points}</strong>.`, 'All done')}<a class="btn secondary" href="#/course/${d.course.id}/exams">Back to exams</a>`, { crumbs });
  if (!a) {
    return mount(html`<h1>${e.title}</h1><div class="card stack"><p>${d.question_count} questions · ${d.total_points} marks · <strong>${e.duration_min} minutes</strong> from the moment you start.</p>
      ${e.state === 'upcoming' ? notice('info', `This exam opens ${fmtDate(e.opens_at)}.`) : e.state === 'closed' ? notice('err', 'This exam has closed. If you missed it, speak to your teacher.') : html`
      ${notice('info', html`<ul style="margin:0;padding-left:20px"><li>The timer runs on our server, not your phone. Closing the tab or losing WiFi does <strong>not</strong> pause it.</li><li>Answers are saved automatically as you choose them. If your connection drops, keep going — we'll sync when it's back.</li><li>You can reopen the exam and carry on from where you stopped, until time runs out.</li></ul>`, 'Before you begin')}
      <button class="btn" id="go">Start exam</button>`}</div>`, { crumbs }), $('#go')?.addEventListener('click', async (ev) => { ev.target.disabled = true; try { await POST(`/exams/${id}/start`); examPage(id); } catch (er) { toast(er.message, 'err'); ev.target.disabled = false; } });
  }
  takeExam(id, d);
}

function takeExam(id, d) {
  const e = d.exam, key = `dempo-exam-${id}-${state.user.id}`;
  let offset = Date.parse(d.server_time) - Date.now(), deadline = Date.parse(d.attempt.deadline_at), finished = false, online = true, saving = false;
  let answers = { ...d.attempt.answers }, dirty = {};
  try { const local = JSON.parse(localStorage.getItem(key) || '{}'); for (const [k, v] of Object.entries(local)) if (answers[k] !== v) { answers[k] = v; dirty[k] = v; } } catch {}
  const persistLocal = () => { try { localStorage.setItem(key, JSON.stringify(answers)); } catch {} };
  mount(html`<div class="exam-bar"><div class="inner"><div><strong>${e.title}</strong><div class="small muted" id="savestate" aria-hidden="true">Answers save automatically</div></div>
    <div class="row"><div class="timer" id="timer" aria-hidden="true">--:--</div><button class="btn" id="submit">Submit exam</button></div></div></div>
    <div id="conn"></div><p class="sr-only" id="a11y-timer">Time remaining announcements will appear here.</p>
    <div class="stack"><nav aria-label="Question navigator" class="qnav">${d.questions.map((q, i) => html`<a href="#q${q.id}" data-qn="${q.id}" aria-label="Go to question ${i + 1}">${i + 1}</a>`)}</nav>
    ${d.questions.map((q, i) => html`<fieldset class="card" id="q${q.id}" style="margin:0"><legend><h2 style="margin:0;padding:0 4px">Question ${i + 1} <span class="muted small">(${q.points} mark${q.points > 1 ? 's' : ''})</span></h2></legend><p>${q.text}</p>
      ${q.options.map((o, oi) => html`<label class="option"><input type="radio" name="q${q.id}" value="${oi}" ${raw(answers[q.id] === oi ? 'checked' : '')}><span>${o}</span></label>`)}</fieldset>`)}</div>`);
  // exam page must not navigate away on hash anchors; use scrollIntoView
  $$('[data-qn]').forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); const t = $('#q' + a.dataset.qn); t.scrollIntoView({ behavior: 'smooth' }); $('input', t).focus(); }));
  const refreshNav = () => $$('[data-qn]').forEach((a) => a.classList.toggle('done', answers[a.dataset.qn] !== undefined));
  const setState = (t) => { const s = $('#savestate'); if (s) s.textContent = t; };
  const conn = (on) => { $('#conn').innerHTML = on ? '' : notice('warn', "We can't reach the server. Keep answering — your choices are kept on this device and will sync automatically. The timer is still running.", 'Connection lost').__html; };
  async function flush() {
    if (saving || finished || !Object.keys(dirty).length) return; saving = true;
    const batch = { ...dirty };
    try { const r = await api('PUT', `/exams/${id}/answers`, { answers: batch }); for (const k of Object.keys(batch)) if (dirty[k] === batch[k]) delete dirty[k]; if (r.closed) return finish(); online = true; conn(true); setState('Saved ' + new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', second: '2-digit' })); }
    catch (er) { if (er.offline) { online = false; conn(false); setState('Not saved yet — will retry'); } else if (er.auth) { /* session ended: keep local copy */ } else toast(er.message, 'err'); }
    finally { saving = false; }
  }
  async function finish() {
    if (finished) return; finished = true; stopExam();
    try { await flush(); const r = await POST(`/exams/${id}/submit`, { answers: dirty }); try { localStorage.removeItem(key); } catch {} toast(`Submitted. You scored ${r.score}.`); location.hash = `#/exam/${id}`; examPage(id); }
    catch (er) { finished = false; examTimer = setInterval(tick, 1000); toast(er.message, 'err'); }
  }
  d.questions.forEach((q) => $$(`input[name=q${q.id}]`).forEach((r) => r.addEventListener('change', () => { answers[q.id] = Number(r.value); dirty[q.id] = answers[q.id]; persistLocal(); refreshNav(); setState('Saving…'); clearTimeout(takeExam.t); takeExam.t = setTimeout(flush, 400); })));
  refreshNav(); if (Object.keys(dirty).length) flush();
  $('#submit').onclick = () => { const left = d.questions.filter((q) => answers[q.id] === undefined).length; if (confirm(left ? `You have ${left} unanswered question${left > 1 ? 's' : ''}. Submit anyway?` : 'Submit your exam now? You cannot change answers afterwards.')) finish(); };
  let said = {};
  function tick() {
    const left = Math.max(0, deadline - (Date.now() + offset)), s = Math.ceil(left / 1000), t = $('#timer'); if (!t) return stopExam();
    t.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; t.classList.toggle('low', s <= 60);
    for (const m of [600, 300, 60, 30]) if (s <= m && !said[m]) { said[m] = 1; announce(`${m >= 60 ? m / 60 + ' minute' + (m > 60 ? 's' : '') : m + ' seconds'} remaining.`); }
    if (s <= 0) { toast('Time is up — submitting your answers.'); finish(); }
  }
  tick(); examTimer = setInterval(tick, 1000);
  retryTimer = setInterval(flush, 10000);
  onlineHandler = flush; addEventListener('online', onlineHandler);
}

// ---------- admin ----------
async function adminPage(tab = 'overview') {
  if (state.user.role !== 'admin') return mount(html`<h1>Not available</h1>${notice('err', 'This area is for administrators.')}`);
  const nav = html`<nav class="tabs" aria-label="Admin sections">${[['overview', 'Overview'], ['import', 'Import students'], ['users', 'People'], ['audit', 'Audit log']].map(([k, l]) => html`<a href="#/admin/${k}" ${raw(k === tab ? 'aria-current="page"' : '')}>${l}</a>`)}</nav>`;
  if (tab === 'overview') { const s = await GET('/admin/summary'); const n = (r) => s.users.find((u) => u.role === r)?.n || 0;
    return mount(html`<h1>Administration</h1>${nav}<div class="stats"><div class="card"><div class="stat">${n('student')}</div><div class="muted small">Students</div></div><div class="card"><div class="stat">${n('teacher')}</div><div class="muted small">Teachers</div></div><div class="card"><div class="stat">${s.courses}</div><div class="muted small">Courses</div></div><div class="card"><div class="stat">${s.students ? Math.round((s.consented / s.students) * 100) : 0}%</div><div class="muted small">Students who gave consent</div></div></div>
    <div class="card" style="margin-top:16px"><h2>Where your data lives</h2><p>One database file on the server you run Dempo Learn on. There are no third-party scripts, fonts or analytics. If the server is in India, so is the data.</p></div>`); }
  if (tab === 'import') {
    mount(html`<h1>Import students</h1>${nav}<div class="card stack"><p>Upload a CSV with a header row. Columns: <code>email</code>, <code>name</code> (required); <code>roll_no</code>, <code>course_codes</code> (optional, separate several with <code>;</code>).</p>
      <ul class="small"><li>New emails create student accounts with a one-time temporary password.</li><li>Emails that already exist are not changed; they are only enrolled in the listed courses.</li><li>A bad row is skipped and reported with its line number. Good rows still import.</li></ul>
      <form id="imp"><div class="field"><label for="file">CSV file</label><input id="file" type="file" accept=".csv,text/csv" required></div><div class="row"><button class="btn secondary" type="submit" data-mode="dry">Check file (no changes)</button><button class="btn" type="button" id="real" disabled>${icon('upload')}Import</button></div></form><div id="out"></div></div>
      <p class="small"><a href="data:text/csv;charset=utf-8,email%2Cname%2Croll_no%2Ccourse_codes%0Aasha%40student.dempo.edu%2CAsha%20Naik%2C24CS201%2CCS201%3BCS230" download="roster-template.csv">Download a template</a></p>`);
    let csv = '';
    const show = (r) => { $('#out').innerHTML = html`<div class="stack" style="margin-top:16px">${notice(r.dryRun ? 'info' : 'ok', `${r.created.length} new, ${r.existing.length} already existed, ${r.enrolments} enrolments, ${r.rejected.length} rejected of ${r.total} rows.`, r.dryRun ? 'Preview — nothing has been saved' : 'Import complete')}
      ${r.rejected.length ? html`<div class="table-wrap"><table class="cards"><thead><tr><th>Line</th><th>Email</th><th>Problem</th></tr></thead><tbody>${r.rejected.map((x) => html`<tr><td data-label="Line">${x.line}</td><td data-label="Email">${x.email || '—'}</td><td data-label="Problem">${x.reason}</td></tr>`)}</tbody></table></div>` : ''}
      ${!r.dryRun && r.created.length ? html`${notice('warn', 'Temporary passwords are shown once. Download the sheet now and hand them out securely; students must change them at first sign-in.')}<button class="btn secondary" id="dl">${icon('download')}Download login sheet</button>` : ''}</div>`.__html;
      $('#dl')?.addEventListener('click', () => { const rows = [['email', 'name', 'roll_no', 'temporary_password'], ...r.created.map((c) => [c.email, c.name, c.roll_no, c.temp_password])]; const b = new Blob([rows.map((x) => x.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'login-sheet.csv'; a.click(); });
      $('#real').disabled = !(r.dryRun && (r.created.length || r.enrolments)); };
    onSubmit($('#imp'), async () => { const file = $('#file').files[0]; if (!file) throw new Error('Choose a CSV file first.'); csv = await file.text(); show(await POST('/admin/import', { csv, dryRun: true })); });
    $('#real').onclick = async (ev) => { ev.target.disabled = true; try { show(await POST('/admin/import', { csv, dryRun: false })); } catch (er) { toast(er.message, 'err'); } };
    return;
  }
  if (tab === 'users') {
    const { users } = await GET('/admin/users');
    mount(html`<h1>People</h1>${nav}<details class="card"><summary><strong>Add one person</strong></summary><form id="uf" class="stack" style="margin-top:16px"><div class="form-grid"><div class="field"><label for="un">Name</label><input id="un" name="name" required></div><div class="field"><label for="ue">Email</label><input id="ue" name="email" type="email" required></div>
      <div class="field"><label for="ur">Role</label><select id="ur" name="role"><option value="student">Student</option><option value="teacher">Teacher</option><option value="admin">Admin</option></select></div><div class="field"><label for="uro">Roll no (students)</label><input id="uro" name="roll_no"></div></div><button class="btn" type="submit">Create account</button></form></details>
      <div class="table-wrap" style="margin-top:16px"><table class="cards"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Roll no</th><th>Consent</th></tr></thead><tbody>${users.map((u) => html`<tr><td data-label="Name">${u.name}</td><td data-label="Email">${u.email}</td><td data-label="Role">${u.role}</td><td data-label="Roll no">${u.roll_no || '—'}</td><td data-label="Consent">${u.role !== 'student' ? '—' : u.consent_at ? pill('ok', 'Given') : pill('warn', 'Pending')}</td></tr>`)}</tbody></table></div>${users.length >= 200 ? '<p class="muted small">Showing the first 200.</p>' : ''}`);
    onSubmit($('#uf'), async (d) => { const r = await POST('/admin/users', d); alert(`Account created.\n\nTemporary password (shown once): ${r.temp_password}`); route(); });
    return;
  }
  const { audit } = await GET('/admin/audit');
  mount(html`<h1>Audit log</h1>${nav}<p class="muted">The 100 most recent sensitive actions: who did what, and when.</p>${audit.length ? html`<div class="table-wrap"><table class="cards"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>${audit.map((a) => html`<tr><td data-label="When">${fmtDate(a.at + 'Z')}</td><td data-label="Who">${a.actor || '—'}</td><td data-label="Action">${a.action}</td><td data-label="Detail">${a.detail}</td></tr>`)}</tbody></table></div>` : empty('shield', 'Nothing logged yet', 'Imports, grade changes, exports and exam starts will appear here.')}`);
}

async function notificationsPage() {
  const { notifications } = await GET('/notifications'); await POST('/notifications/read'); state.unread = 0;
  mount(html`<h1>Updates</h1>${notifications.length ? html`<div class="stack">${notifications.map((n) => html`<a class="card tight" href="${n.link || '#/'}"><div class="row spread"><span>${n.text}</span><span class="muted small">${fmtDate(n.created_at + 'Z')}</span></div>${n.read ? '' : pill('info', 'New')}</a>`)}</div>` : empty('bell', "You're all caught up", 'New announcements, due dates and grades will appear here.')}`);
}
function privacyPage() {
  mount(html`<h1>Privacy notice</h1><div class="card stack" style="max-width:760px"><p class="muted small">Template — have your college's counsel review before go-live. Written for the Digital Personal Data Protection Act, 2023.</p>
    <h2>What we hold</h2><p>Name, college email, roll number, course enrolments, submissions, marks, attendance, exam answers, and a log of sensitive actions (such as grade changes).</p>
    <h2>Why</h2><p>Only to run teaching, assessment and records for your college. No advertising, no selling, no third-party analytics, fonts or trackers load in this app.</p>
    <h2>Where</h2><p>On servers operated by or for your college in India. No data leaves the deployment unless the college exports it.</p>
    <h2>How long</h2><p>Records are kept while you are enrolled and for the academic-record period the college sets (default: <strong>TODO — college to confirm</strong>). Afterwards they are erased or anonymised.</p>
    <h2>Your rights</h2><ul><li>Access: download everything we hold below.</li><li>Correction and erasure: ask the registrar's office.</li><li>Grievance: contact the college's data protection officer — <strong>TODO — name and email</strong>.</li></ul>
    ${state.user.role === 'student' ? html`<a class="btn secondary" href="/api/me/export" download>${icon('download')}Download my data</a>` : ''}</div>`);
}
function accountPage() {
  const u = state.user;
  mount(html`<h1>Your account</h1><div class="card stack" style="max-width:560px"><p><strong>${u.name}</strong><br><span class="muted">${u.email} · ${u.role}${u.roll_no ? ' · ' + u.roll_no : ''}</span></p>
    <form id="pw"><h2>Change password</h2><div class="field"><label for="np">New password</label><input id="np" name="password" type="password" minlength="8" autocomplete="new-password" required><div class="hint">At least 8 characters.</div></div><button class="btn" type="submit">Update password</button></form></div>`);
  onSubmit($('#pw'), async (d, f) => { await POST('/password', d); f.reset(); toast('Password updated.'); });
}

// ---------- router ----------
async function route() {
  stopExam();
  const [path, ...rest] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  try {
    if (!state.user) { try { const m = await GET('/me'); state.user = m.user; state.unread = m.unread; } catch (e) { if (!e.auth) throw e; } }
    if (!state.user) { if (path !== 'login') location.hash = '#/login'; return loginScreen(); }
    if (path === 'login') { location.hash = '#/'; return; }
    if (await gate()) return;
    GET('/me').then((m) => { if (m.unread !== state.unread) { state.unread = m.unread; const b = $('.badge-n'); if (!b && m.unread) route(); } }).catch(() => {});
    if (path === '' ) return await dashboard();
    if (path === 'course') return await coursePage(rest[0], rest[1]);
    if (path === 'assignment') return await assignmentPage(rest[0]);
    if (path === 'exam') return await examPage(rest[0]);
    if (path === 'exam-new') return await examNew(rest[0]);
    if (path === 'admin') return await adminPage(rest[0]);
    if (path === 'notifications') return await notificationsPage();
    if (path === 'privacy') return privacyPage();
    if (path === 'account') return accountPage();
    mount(html`<h1>Page not found</h1><p>That page doesn't exist. <a href="#/">Go to your courses</a>.</p>`);
  } catch (e) {
    if (e.auth) return;
    if (state.user) mount(html`<h1>Something didn't load</h1>${notice('err', e.message)}<p><button class="btn" id="retry">Try again</button> <a class="btn secondary" href="#/">Back to courses</a></p>`), $('#retry').onclick = route;
    else app.innerHTML = html`<main id="main" style="padding:32px">${notice('err', e.message)}<button class="btn" onclick="location.reload()">Reload</button></main>`.__html;
  }
}
addEventListener('hashchange', route);
route();
