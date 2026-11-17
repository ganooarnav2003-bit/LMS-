// Dempo Learn API. Plain node:http, no framework. Every route checks role + ownership server-side.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword, verifyPassword, token } from './db.js';
import { parseCsv, toCsv } from './csv.js';
import { computeGradebook } from './gradebook.js';

const PUBLIC = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const SESSION_MS = 1000 * 60 * 60 * 12;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m), forbidden = (m = 'You do not have access to this.') => new HttpError(403, m), notFound = (m = 'Not found.') => new HttpError(404, m);
const nowIso = () => new Date().toISOString();
const str = (v, max = 5000) => String(v ?? '').trim().slice(0, max);
const need = (v, label, max) => { const s = str(v, max); if (!s) throw bad(`${label} is required.`); return s; };
const int = (v, label, min = 0, max = 1e6) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} must be a whole number between ${min} and ${max}.`); return n; };
const safeLink = (v) => { const s = str(v, 2000); if (!s) return ''; if (!/^https?:\/\//i.test(s)) throw bad('Links must start with http:// or https://'); return s; };
const isoOrNull = (v, label) => { if (!v) return null; const d = new Date(v); if (isNaN(d)) throw bad(`${label} is not a valid date.`); return d.toISOString(); };

export function createApp(db) {
  const q = (sql, ...p) => db.prepare(sql).all(...p);
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const audit = (actor, action, detail = '') => run('INSERT INTO audit(actor_id,action,detail) VALUES(?,?,?)', actor?.id ?? null, action, detail);
  const notify = (userId, text, link = '') => run('INSERT INTO notifications(user_id,text,link) VALUES(?,?,?)', userId, text, link);
  const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, roll_no: u.roll_no, consent_at: u.consent_at, must_change: !!u.must_change });

  // ---------- access helpers ----------
  const role = (u, ...roles) => { if (!roles.includes(u.role)) throw forbidden(); };
  function course(u, id, { manage = false } = {}) {
    const c = one('SELECT c.*, t.name AS teacher_name FROM courses c JOIN users t ON t.id=c.teacher_id WHERE c.id=?', Number(id));
    if (!c) throw notFound('That course does not exist.');
    const isOwner = u.role === 'admin' || c.teacher_id === u.id;
    if (manage) { if (!isOwner) throw forbidden('Only the course teacher can do this.'); return c; }
    if (isOwner || (u.role === 'student' && one('SELECT 1 x FROM enrolments WHERE course_id=? AND user_id=?', c.id, u.id))) return c;
    throw forbidden('You are not enrolled in this course.');
  }
  const examWindow = (e) => { const n = Date.now(); return n < Date.parse(e.opens_at) ? 'upcoming' : n > Date.parse(e.closes_at) ? 'closed' : 'open'; };

  // ---------- exam engine (server is the only clock) ----------
  function finalize(attempt, exam) {
    if (attempt.submitted_at) return attempt;
    const qs = q('SELECT id, answer, points FROM questions WHERE exam_id=?', exam.id);
    const ans = JSON.parse(attempt.answers || '{}');
    const score = qs.reduce((s, x) => s + (ans[x.id] === x.answer ? x.points : 0), 0);
    const at = new Date(Math.min(Date.now(), Date.parse(attempt.deadline_at))).toISOString();
    run('UPDATE attempts SET submitted_at=?, score=? WHERE id=? AND submitted_at IS NULL', at, score, attempt.id);
    return one('SELECT * FROM attempts WHERE id=?', attempt.id);
  }
  const settleExpired = (examId) => {
    const exam = one('SELECT * FROM exams WHERE id=?', examId);
    for (const a of q('SELECT * FROM attempts WHERE exam_id=? AND submitted_at IS NULL AND deadline_at<=?', examId, nowIso())) finalize(a, exam);
  };

  // ---------- roster import ----------
  function importRoster(actor, csvText, dryRun) {
    const rows = parseCsv(csvText);
    if (!rows.length) throw bad('The file is empty.');
    const header = rows[0].map((h) => h.trim().toLowerCase());
    for (const col of ['email', 'name']) if (!header.includes(col)) throw bad(`Missing required column "${col}". Expected columns: email, name, roll_no (optional), course_codes (optional, separated by ;).`);
    const idx = (n) => header.indexOf(n);
    const report = { dryRun, created: [], existing: [], rejected: [], enrolments: 0, total: rows.length - 1 };
    const seen = new Set();
    const courseByCode = new Map(q('SELECT id, code FROM courses').map((c) => [c.code.toUpperCase(), c.id]));
    const work = () => {
      rows.slice(1).forEach((r, i) => {
        const line = i + 2;
        if (r.every((c) => !c.trim())) { report.total--; return; }
        const email = str(r[idx('email')]).toLowerCase(), name = str(r[idx('name')], 120);
        const roll = idx('roll_no') >= 0 ? str(r[idx('roll_no')], 40) : '';
        const codes = idx('course_codes') >= 0 ? str(r[idx('course_codes')]).split(/[;|]/).map((s) => s.trim().toUpperCase()).filter(Boolean) : [];
        const fail = (reason) => report.rejected.push({ line, email, reason });
        if (!EMAIL.test(email)) return fail('Email address is not valid.');
        if (!name) return fail('Name is missing.');
        if (seen.has(email)) return fail('Duplicate of an earlier row in this file.');
        seen.add(email);
        const unknown = codes.find((c) => !courseByCode.has(c));
        if (unknown) return fail(`Course code "${unknown}" does not exist.`);
        let user = one('SELECT * FROM users WHERE email=?', email), temp = null;
        if (user) {
          if (user.role !== 'student') return fail('This email belongs to a staff account.');
          report.existing.push({ line, email });
        } else {
          temp = token(6);
          const res = run('INSERT INTO users(email,name,role,roll_no,pass_hash,must_change) VALUES(?,?,?,?,?,1)', email, name, 'student', roll || null, hashPassword(temp));
          user = { id: Number(res.lastInsertRowid) };
          report.created.push({ line, email, name, roll_no: roll, temp_password: temp });
        }
        for (const c of codes) report.enrolments += run('INSERT OR IGNORE INTO enrolments(course_id,user_id) VALUES(?,?)', courseByCode.get(c), user.id).changes;
      });
      if (dryRun) throw Object.assign(new Error('rollback'), { rollback: true });
    };
    try { tx(work); } catch (e) { if (!e.rollback) throw e; }
    if (!dryRun) audit(actor, 'roster.import', `${report.created.length} created, ${report.existing.length} existing, ${report.rejected.length} rejected`);
    return report;
  }

  // ---------- routes ----------
  const routes = [];
  const add = (method, path, auth, fn) => routes.push({ method, re: new RegExp('^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), auth, fn });

  const loginAttempts = new Map();
  add('POST', '/api/login', false, ({ body, res, req }) => {
    const email = str(body.email).toLowerCase(), key = `${req.socket.remoteAddress}|${email}`;
    const a = loginAttempts.get(key) || { n: 0, until: 0 };
    if (a.until > Date.now()) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
    const u = one('SELECT * FROM users WHERE email=?', email);
    if (!u || !verifyPassword(str(body.password, 200), u.pass_hash)) {
      a.n++; if (a.n >= 8) { a.until = Date.now() + 5 * 60_000; a.n = 0; } loginAttempts.set(key, a);
      throw new HttpError(401, 'That email and password do not match. Check both and try again.');
    }
    loginAttempts.delete(key);
    const t = token(); run('INSERT INTO sessions VALUES(?,?,?)', t, u.id, Date.now() + SESSION_MS);
    res.setHeader('Set-Cookie', `sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
    return { user: publicUser(u) };
  });
  add('POST', '/api/logout', true, ({ req, res }) => {
    run('DELETE FROM sessions WHERE token=?', req.sid);
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return { ok: true };
  });
  add('GET', '/api/me', true, ({ user }) => ({ user: publicUser(user), unread: one('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0', user.id).n }));
  add('POST', '/api/consent', true, ({ user }) => { run('UPDATE users SET consent_at=? WHERE id=?', nowIso(), user.id); audit(user, 'consent.given'); return { ok: true }; });
  add('POST', '/api/password', true, ({ user, body }) => {
    const pw = str(body.password, 200);
    if (pw.length < 8) throw bad('Choose a password with at least 8 characters.');
    run('UPDATE users SET pass_hash=?, must_change=0 WHERE id=?', hashPassword(pw), user.id);
    audit(user, 'password.changed'); return { ok: true };
  });

  // courses
  add('GET', '/api/courses', true, ({ user }) => {
    const sel = `SELECT c.id,c.code,c.title,c.description,c.join_code,t.name AS teacher_name,
      (SELECT COUNT(*) FROM enrolments e WHERE e.course_id=c.id) AS students,
      (SELECT COUNT(*) FROM assignments a WHERE a.course_id=c.id AND a.due_at > ?) AS upcoming
      FROM courses c JOIN users t ON t.id=c.teacher_id`;
    const rows = user.role === 'admin' ? q(sel + ' ORDER BY c.code', nowIso())
      : user.role === 'teacher' ? q(sel + ' WHERE c.teacher_id=? ORDER BY c.code', nowIso(), user.id)
      : q(sel + ' WHERE c.id IN (SELECT course_id FROM enrolments WHERE user_id=?) ORDER BY c.code', nowIso(), user.id);
    if (user.role === 'student') rows.forEach((r) => delete r.join_code);
    return { courses: rows };
  });
  add('POST', '/api/courses', true, ({ user, body }) => {
    role(user, 'teacher', 'admin');
    const code = need(body.code, 'Course code', 20).toUpperCase();
    if (one('SELECT 1 x FROM courses WHERE code=?', code)) throw bad(`A course with code ${code} already exists.`);
    const teacher = user.role === 'admin' && body.teacher_id ? Number(body.teacher_id) : user.id;
    const r = run('INSERT INTO courses(code,title,description,teacher_id,join_code,internal_weight) VALUES(?,?,?,?,?,?)',
      code, need(body.title, 'Title', 150), str(body.description, 1000), teacher, token(4).toUpperCase().replace(/[-_]/g, 'X'), int(body.internal_weight ?? 40, 'Internal weight', 0, 100));
    audit(user, 'course.create', code); return { id: Number(r.lastInsertRowid) };
  });
  add('POST', '/api/courses/join', true, ({ user, body }) => {
    role(user, 'student');
    const c = one('SELECT * FROM courses WHERE join_code=?', str(body.code, 20).toUpperCase());
    if (!c) throw notFound('That join code does not match any course. Check it with your teacher.');
    run('INSERT OR IGNORE INTO enrolments VALUES(?,?)', c.id, user.id);
    return { id: c.id };
  });
  add('GET', '/api/courses/:id', true, ({ user, params }) => {
    const c = course(user, params.id), staff = user.role !== 'student';
    if (!staff) delete c.join_code;
    const posts = q('SELECT p.*, u.name AS author FROM posts p JOIN users u ON u.id=p.author_id WHERE course_id=? ORDER BY p.id DESC', c.id);
    const assignments = q('SELECT * FROM assignments WHERE course_id=? ORDER BY COALESCE(due_at,\'9999\')', c.id).map((a) => {
      if (staff) return { ...a, submitted: one('SELECT COUNT(*) n FROM submissions WHERE assignment_id=?', a.id).n, graded: one('SELECT COUNT(*) n FROM submissions WHERE assignment_id=? AND grade IS NOT NULL', a.id).n };
      const s = one('SELECT submitted_at,late,grade FROM submissions WHERE assignment_id=? AND student_id=?', a.id, user.id);
      return { ...a, mine: s || null };
    });
    const exams = q('SELECT * FROM exams WHERE course_id=? ORDER BY opens_at', c.id).map((e) => {
      const base = { ...e, state: examWindow(e), question_count: one('SELECT COUNT(*) n FROM questions WHERE exam_id=?', e.id).n, total_points: one('SELECT COALESCE(SUM(points),0) n FROM questions WHERE exam_id=?', e.id).n };
      if (!staff) { settleExpired(e.id); const a = one('SELECT submitted_at,score FROM attempts WHERE exam_id=? AND student_id=?', e.id, user.id); base.mine = a || null; }
      return base;
    });
    const people = staff ? q('SELECT u.id,u.name,u.email,u.roll_no FROM enrolments e JOIN users u ON u.id=e.user_id WHERE e.course_id=? ORDER BY u.name', c.id) : null;
    return { course: c, posts, assignments, exams, people };
  });
  add('POST', '/api/courses/:id/posts', true, ({ user, params, body }) => {
    const c = course(user, params.id, { manage: true });
    const kind = body.kind === 'material' ? 'material' : 'announcement';
    const title = need(body.title, 'Title', 150);
    const r = run('INSERT INTO posts(course_id,author_id,kind,title,body,link) VALUES(?,?,?,?,?,?)', c.id, user.id, kind, title, str(body.body), safeLink(body.link));
    for (const s of q('SELECT user_id FROM enrolments WHERE course_id=?', c.id)) notify(s.user_id, `${c.code}: ${kind === 'material' ? 'New material' : 'Announcement'} — ${title}`, `#/course/${c.id}`);
    return { id: Number(r.lastInsertRowid) };
  });

  // assignments
  add('POST', '/api/courses/:id/assignments', true, ({ user, params, body }) => {
    const c = course(user, params.id, { manage: true });
    const title = need(body.title, 'Title', 150), category = body.category === 'external' ? 'external' : 'internal';
    const r = run('INSERT INTO assignments(course_id,title,instructions,points,due_at,category,allow_resubmit) VALUES(?,?,?,?,?,?,?)',
      c.id, title, str(body.instructions), int(body.points ?? 100, 'Points', 1, 1000), isoOrNull(body.due_at, 'Due date'), category, body.allow_resubmit === false ? 0 : 1);
    for (const s of q('SELECT user_id FROM enrolments WHERE course_id=?', c.id)) notify(s.user_id, `${c.code}: New assignment — ${title}`, `#/assignment/${r.lastInsertRowid}`);
    return { id: Number(r.lastInsertRowid) };
  });
  const assignment = (u, id, manage) => {
    const a = one('SELECT * FROM assignments WHERE id=?', Number(id));
    if (!a) throw notFound('That assignment does not exist.');
    return { a, c: course(u, a.course_id, { manage }) };
  };
  add('GET', '/api/assignments/:id', true, ({ user, params }) => {
    const { a, c } = assignment(user, params.id, false);
    if (user.role === 'student') return { assignment: a, course: { id: c.id, code: c.code, title: c.title }, mine: one('SELECT * FROM submissions WHERE assignment_id=? AND student_id=?', a.id, user.id) || null };
    const subs = q(`SELECT u.id AS student_id, u.name, u.roll_no, s.id, s.text, s.link, s.submitted_at, s.late, s.attempts, s.grade, s.feedback
      FROM enrolments e JOIN users u ON u.id=e.user_id LEFT JOIN submissions s ON s.student_id=u.id AND s.assignment_id=? WHERE e.course_id=? ORDER BY u.name`, a.id, c.id);
    return { assignment: a, course: { id: c.id, code: c.code, title: c.title }, submissions: subs };
  });
  add('POST', '/api/assignments/:id/submit', true, ({ user, params, body }) => {
    role(user, 'student');
    const { a, c } = assignment(user, params.id, false);
    const text = str(body.text, 20000), link = safeLink(body.link);
    if (!text && !link) throw bad('Add some text or a link before submitting.');
    const prev = one('SELECT * FROM submissions WHERE assignment_id=? AND student_id=?', a.id, user.id);
    if (prev && !a.allow_resubmit) throw bad('This assignment does not accept resubmission.');
    if (prev?.grade != null) throw bad('This work has already been graded. Ask your teacher to reopen it if you need to resubmit.');
    const late = a.due_at && Date.now() > Date.parse(a.due_at) ? 1 : 0;
    if (prev) run('UPDATE submissions SET text=?,link=?,submitted_at=?,late=?,attempts=attempts+1 WHERE id=?', text, link, nowIso(), late, prev.id);
    else run('INSERT INTO submissions(assignment_id,student_id,text,link,submitted_at,late) VALUES(?,?,?,?,?,?)', a.id, user.id, text, link, nowIso(), late);
    notify(c.teacher_id, `${c.code}: ${user.name} submitted "${a.title}"${late ? ' (late)' : ''}`, `#/assignment/${a.id}`);
    return { ok: true, late: !!late };
  });
  add('POST', '/api/assignments/:id/grade', true, ({ user, params, body }) => {
    const { a, c } = assignment(user, params.id, true);
    const sid = int(body.student_id, 'Student');
    const s = one('SELECT * FROM submissions WHERE assignment_id=? AND student_id=?', a.id, sid);
    if (!s) throw bad('This student has not submitted yet.');
    const grade = body.grade === '' || body.grade == null ? null : Number(body.grade);
    if (grade != null && (!(grade >= 0) || grade > a.points)) throw bad(`Marks must be between 0 and ${a.points}.`);
    run('UPDATE submissions SET grade=?, feedback=?, graded_at=? WHERE id=?', grade, str(body.feedback, 3000), grade == null ? null : nowIso(), s.id);
    if (grade != null) notify(sid, `${c.code}: "${a.title}" was graded — ${grade}/${a.points}`, `#/assignment/${a.id}`);
    audit(user, 'grade.set', `assignment ${a.id} student ${sid}`);
    return { ok: true };
  });

  // exams
  add('POST', '/api/courses/:id/exams', true, ({ user, params, body }) => {
    const c = course(user, params.id, { manage: true });
    const qs = Array.isArray(body.questions) ? body.questions : [];
    if (!qs.length) throw bad('Add at least one question.');
    const opens = isoOrNull(body.opens_at, 'Opening time'), closes = isoOrNull(body.closes_at, 'Closing time');
    if (!opens || !closes || Date.parse(closes) <= Date.parse(opens)) throw bad('The exam must close after it opens.');
    return tx(() => {
      const r = run('INSERT INTO exams(course_id,title,duration_min,opens_at,closes_at,category) VALUES(?,?,?,?,?,?)',
        c.id, need(body.title, 'Title', 150), int(body.duration_min, 'Duration (minutes)', 1, 600), opens, closes, body.category === 'external' ? 'external' : 'internal');
      qs.forEach((x, i) => {
        const opts = Array.isArray(x.options) ? x.options.map((o) => str(o, 300)).filter(Boolean) : [];
        if (opts.length < 2) throw bad(`Question ${i + 1} needs at least two options.`);
        run('INSERT INTO questions(exam_id,text,options,answer,points) VALUES(?,?,?,?,?)', r.lastInsertRowid, need(x.text, `Question ${i + 1} text`, 1000), JSON.stringify(opts), int(x.answer, `Question ${i + 1} answer`, 0, opts.length - 1), int(x.points ?? 1, 'Points', 1, 100));
      });
      for (const s of q('SELECT user_id FROM enrolments WHERE course_id=?', c.id)) notify(s.user_id, `${c.code}: Exam scheduled — ${str(body.title)}`, `#/exam/${r.lastInsertRowid}`);
      return { id: Number(r.lastInsertRowid) };
    });
  });
  const exam = (u, id, manage) => {
    const e = one('SELECT * FROM exams WHERE id=?', Number(id));
    if (!e) throw notFound('That exam does not exist.');
    return { e, c: course(u, e.course_id, { manage }) };
  };
  const attemptView = (a, e) => ({ started_at: a.started_at, deadline_at: a.deadline_at, submitted_at: a.submitted_at, score: a.submitted_at ? a.score : null, answers: JSON.parse(a.answers), last_saved_at: a.last_saved_at });
  add('GET', '/api/exams/:id', true, ({ user, params }) => {
    const { e, c } = exam(user, params.id, false);
    const base = { exam: { ...e, state: examWindow(e) }, course: { id: c.id, code: c.code, title: c.title }, server_time: nowIso() };
    if (user.role === 'student') {
      settleExpired(e.id);
      const a = one('SELECT * FROM attempts WHERE exam_id=? AND student_id=?', e.id, user.id);
      base.total_points = one('SELECT COALESCE(SUM(points),0) n FROM questions WHERE exam_id=?', e.id).n;
      base.question_count = one('SELECT COUNT(*) n FROM questions WHERE exam_id=?', e.id).n;
      base.attempt = a ? attemptView(a, e) : null;
      // questions are only sent once the student has started, and never with the answer key
      if (a && !a.submitted_at) base.questions = q('SELECT id,text,options,points FROM questions WHERE exam_id=? ORDER BY id', e.id).map((x) => ({ ...x, options: JSON.parse(x.options) }));
      return base;
    }
    settleExpired(e.id);
    base.questions = q('SELECT id,text,options,answer,points FROM questions WHERE exam_id=? ORDER BY id', e.id).map((x) => ({ ...x, options: JSON.parse(x.options) }));
    base.results = q(`SELECT u.id AS student_id,u.name,u.roll_no,a.started_at,a.submitted_at,a.score,a.saves FROM enrolments en JOIN users u ON u.id=en.user_id
      LEFT JOIN attempts a ON a.student_id=u.id AND a.exam_id=? WHERE en.course_id=? ORDER BY u.name`, e.id, c.id);
    return base;
  });
  add('POST', '/api/exams/:id/start', true, ({ user, params }) => {
    role(user, 'student');
    const { e } = exam(user, params.id, false);
    let a = one('SELECT * FROM attempts WHERE exam_id=? AND student_id=?', e.id, user.id);
    if (!a) { // first start: the server fixes the deadline once. Reloads and reconnects never reset it.
      const st = examWindow(e);
      if (st === 'upcoming') throw bad('This exam has not opened yet.');
      if (st === 'closed') throw bad('This exam has closed.');
      const deadline = new Date(Math.min(Date.now() + e.duration_min * 60_000, Date.parse(e.closes_at))).toISOString();
      run('INSERT INTO attempts(exam_id,student_id,started_at,deadline_at) VALUES(?,?,?,?)', e.id, user.id, nowIso(), deadline);
      audit(user, 'exam.start', `exam ${e.id}`);
    }
    return { ok: true };
  });
  add('PUT', '/api/exams/:id/answers', true, ({ user, params, body }) => {
    role(user, 'student');
    const { e } = exam(user, params.id, false);
    const a = one('SELECT * FROM attempts WHERE exam_id=? AND student_id=?', e.id, user.id);
    if (!a) throw bad('Start the exam first.');
    if (a.submitted_at) return { saved: false, closed: true, server_time: nowIso() };
    if (Date.now() > Date.parse(a.deadline_at)) { finalize(a, e); return { saved: false, closed: true, server_time: nowIso() }; }
    const valid = new Set(q('SELECT id FROM questions WHERE exam_id=?', e.id).map((x) => x.id)), merged = JSON.parse(a.answers);
    for (const [k, v] of Object.entries(body.answers || {})) if (valid.has(Number(k)) && Number.isInteger(v)) merged[k] = v;
    run('UPDATE attempts SET answers=?, saves=saves+1, last_saved_at=? WHERE id=?', JSON.stringify(merged), nowIso(), a.id);
    return { saved: true, server_time: nowIso(), deadline_at: a.deadline_at };
  });
  add('POST', '/api/exams/:id/submit', true, ({ user, params, body }) => {
    role(user, 'student');
    const { e } = exam(user, params.id, false);
    let a = one('SELECT * FROM attempts WHERE exam_id=? AND student_id=?', e.id, user.id);
    if (!a) throw bad('Start the exam first.');
    if (!a.submitted_at && body.answers && Date.now() <= Date.parse(a.deadline_at)) {
      const valid = new Set(q('SELECT id FROM questions WHERE exam_id=?', e.id).map((x) => x.id)), merged = JSON.parse(a.answers);
      for (const [k, v] of Object.entries(body.answers)) if (valid.has(Number(k)) && Number.isInteger(v)) merged[k] = v;
      run('UPDATE attempts SET answers=? WHERE id=?', JSON.stringify(merged), a.id); a = one('SELECT * FROM attempts WHERE id=?', a.id);
    }
    a = finalize(a, e);
    return { submitted_at: a.submitted_at, score: a.score };
  });

  // gradebook + records
  add('GET', '/api/courses/:id/gradebook', true, ({ user, params }) => {
    const c = course(user, params.id);
    settleCourseExams(c.id);
    const gb = computeGradebook(db, c, user.role === 'student' ? user.id : null);
    return gb;
  });
  const settleCourseExams = (cid) => q('SELECT id FROM exams WHERE course_id=?', cid).forEach((e) => settleExpired(e.id));
  add('GET', '/api/courses/:id/gradebook.csv', true, ({ user, params, res }) => {
    role(user, 'teacher', 'admin');
    const c = course(user, params.id, { manage: true });
    settleCourseExams(c.id);
    const gb = computeGradebook(db, c, null);
    const head = ['Roll no', 'Name', 'Email', ...gb.items.map((i) => `${i.title} (${i.category}, /${i.max})`), 'Internal %', 'External %', 'Final %', 'Grade', 'Attendance %'];
    const rows = gb.students.map((s) => [s.roll_no ?? '', s.name, s.email, ...gb.items.map((i) => s.scores[i.key] ?? ''), s.internal_pct ?? '', s.external_pct ?? '', s.final_pct ?? '', s.grade, s.attendance_pct ?? '']);
    audit(user, 'gradebook.export', c.code);
    res.setHeader('Content-Disposition', `attachment; filename="${c.code}-marks.csv"`);
    return { __raw: toCsv([head, ...rows]), type: 'text/csv; charset=utf-8' };
  });
  add('GET', '/api/courses/:id/attendance', true, ({ user, params, query }) => {
    const c = course(user, params.id);
    if (user.role === 'student') return { records: q('SELECT day,status FROM attendance WHERE course_id=? AND user_id=? ORDER BY day DESC', c.id, user.id) };
    const day = str(query.day, 10) || new Date().toISOString().slice(0, 10);
    const students = q('SELECT u.id,u.name,u.roll_no, a.status FROM enrolments e JOIN users u ON u.id=e.user_id LEFT JOIN attendance a ON a.user_id=u.id AND a.course_id=e.course_id AND a.day=? WHERE e.course_id=? ORDER BY u.name', day, c.id);
    return { day, students, days: q('SELECT day, SUM(status!=\'absent\') AS present, COUNT(*) AS total FROM attendance WHERE course_id=? GROUP BY day ORDER BY day DESC LIMIT 14', c.id) };
  });
  add('POST', '/api/courses/:id/attendance', true, ({ user, params, body }) => {
    const c = course(user, params.id, { manage: true });
    const day = need(body.day, 'Date', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw bad('Date must look like 2026-11-17.');
    tx(() => {
      for (const [sid, st] of Object.entries(body.marks || {})) {
        if (!['present', 'absent', 'late'].includes(st)) continue;
        if (!one('SELECT 1 x FROM enrolments WHERE course_id=? AND user_id=?', c.id, Number(sid))) continue;
        run('INSERT INTO attendance VALUES(?,?,?,?) ON CONFLICT(course_id,day,user_id) DO UPDATE SET status=excluded.status', c.id, day, Number(sid), st);
      }
    });
    return { ok: true };
  });

  // notifications
  add('GET', '/api/notifications', true, ({ user }) => ({ notifications: q('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50', user.id) }));
  add('POST', '/api/notifications/read', true, ({ user }) => { run('UPDATE notifications SET read=1 WHERE user_id=?', user.id); return { ok: true }; });

  // DPDP: a student can download everything held about them
  add('GET', '/api/me/export', true, ({ user, res }) => {
    const data = {
      generated_at: nowIso(), profile: publicUser(user),
      enrolments: q('SELECT c.code,c.title FROM enrolments e JOIN courses c ON c.id=e.course_id WHERE e.user_id=?', user.id),
      submissions: q('SELECT assignment_id,text,link,submitted_at,late,grade,feedback FROM submissions WHERE student_id=?', user.id),
      exam_attempts: q('SELECT exam_id,started_at,submitted_at,score,answers FROM attempts WHERE student_id=?', user.id),
      attendance: q('SELECT course_id,day,status FROM attendance WHERE user_id=?', user.id),
    };
    res.setHeader('Content-Disposition', 'attachment; filename="my-dempo-learn-data.json"');
    return data;
  });

  // admin
  add('GET', '/api/admin/summary', true, ({ user }) => {
    role(user, 'admin');
    return { users: q('SELECT role, COUNT(*) n FROM users GROUP BY role'), courses: one('SELECT COUNT(*) n FROM courses').n, consented: one("SELECT COUNT(*) n FROM users WHERE consent_at IS NOT NULL AND role='student'").n, students: one("SELECT COUNT(*) n FROM users WHERE role='student'").n };
  });
  add('GET', '/api/admin/users', true, ({ user, query }) => {
    role(user, 'admin');
    const s = `%${str(query.q, 60)}%`;
    return { users: q('SELECT id,email,name,role,roll_no,consent_at,must_change FROM users WHERE name LIKE ? OR email LIKE ? OR roll_no LIKE ? ORDER BY role,name LIMIT 200', s, s, s) };
  });
  add('POST', '/api/admin/users', true, ({ user, body }) => {
    role(user, 'admin');
    const email = str(body.email).toLowerCase(); if (!EMAIL.test(email)) throw bad('Enter a valid email address.');
    const r = ['teacher', 'student', 'admin'].includes(body.role) ? body.role : 'student';
    if (one('SELECT 1 x FROM users WHERE email=?', email)) throw bad('An account with that email already exists.');
    const temp = token(6);
    run('INSERT INTO users(email,name,role,roll_no,pass_hash,must_change) VALUES(?,?,?,?,?,1)', email, need(body.name, 'Name', 120), r, str(body.roll_no, 40) || null, hashPassword(temp));
    audit(user, 'user.create', `${r} ${email}`);
    return { temp_password: temp };
  });
  add('POST', '/api/admin/import', true, ({ user, body }) => { role(user, 'admin'); return importRoster(user, str(body.csv, 5_000_000), body.dryRun !== false); });
  add('GET', '/api/admin/audit', true, ({ user }) => { role(user, 'admin'); return { audit: q('SELECT a.id,a.at,a.action,a.detail,u.name AS actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100') }; });

  // ---------- server plumbing ----------
  const parseCookies = (h = '') => Object.fromEntries(h.split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));
  async function readBody(req) {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > 6_000_000) throw new HttpError(413, 'That file is too large.'); chunks.push(c); }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw bad('The request was not valid JSON.'); }
  }
  const secure = (res) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); res.setHeader('X-Frame-Options', 'DENY');
  };
  const send = (res, status, data, type = 'application/json; charset=utf-8') => { res.statusCode = status; res.setHeader('Content-Type', type); res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data)); };

  async function handle(req, res) {
    secure(res);
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);
    try {
      const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
      if (!route) throw notFound('Unknown endpoint.');
      let user = null;
      req.sid = parseCookies(req.headers.cookie).sid;
      if (route.auth) {
        const s = req.sid && one('SELECT * FROM sessions WHERE token=? AND expires_at>?', req.sid, Date.now());
        user = s && one('SELECT * FROM users WHERE id=?', s.user_id);
        if (!user) throw new HttpError(401, 'Your session has ended. Please sign in again.');
      }
      let body = {};
      if (req.method !== 'GET') {
        if (!(req.headers['content-type'] || '').startsWith('application/json') && Number(req.headers['content-length'] || 0) > 0) throw new HttpError(415, 'Unsupported content type.');
        body = await readBody(req);
      }
      const params = url.pathname.match(route.re).groups || {};
      const out = route.fn({ req, res, user, body, params, query: Object.fromEntries(url.searchParams) });
      if (out?.__raw !== undefined) return send(res, 200, out.__raw, out.type);
      send(res, 200, out);
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      send(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong on our side. Your work is safe — please try again in a moment.' });
    }
  }
  async function serveStatic(pathname, res) {
    let rel = pathname === '/' ? '/index.html' : pathname;
    const file = normalize(join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain');
    try {
      const buf = await readFile(file);
      res.setHeader('Cache-Control', 'no-cache');
      send(res, 200, buf, MIME[extname(file)] || 'application/octet-stream');
    } catch { send(res, 404, 'Not found', 'text/plain'); }
  }
  const server = createServer(handle); server.handler = handle; return server;
}
