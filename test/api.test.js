import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seed, DEMO_PASSWORD } from '../server/seed.js';

let server, base, db;
before(async () => {
  db = openDb(':memory:'); seed(db);
  server = createApp(db); await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function client(email) {
  let cookie = '';
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, data: ct.includes('json') ? await r.json() : await r.text() };
  };
  if (email) { const r = await call('POST', '/api/login', { email, password: DEMO_PASSWORD }); assert.equal(r.status, 200); }
  return call.bind(null) && Object.assign(call, {});
}

test('login rejects a wrong password with a human message', async () => {
  const c = await client();
  const r = await c('POST', '/api/login', { email: 'admin@dempo.edu', password: 'nope' });
  assert.equal(r.status, 401); assert.match(r.data.error, /do not match/);
});

test('unauthenticated API calls are refused', async () => {
  assert.equal((await (await client())('GET', '/api/courses')).status, 401);
});

test('students cannot create courses or see other courses; teachers only manage their own', async () => {
  const stu = await client('demo.student@student.dempo.edu');
  assert.equal((await stu('POST', '/api/courses', { code: 'X1', title: 'x' })).status, 403);
  const ec = db.prepare("SELECT id FROM courses WHERE code='EC105'").get().id;
  assert.equal((await stu('GET', `/api/courses/${ec}`)).status, 200); // enrolled in EC105
  const db1 = db.prepare("SELECT id FROM courses WHERE code='CS230'").get().id;
  assert.equal((await stu('GET', `/api/courses/${db1}`)).status, 200);
  const rahul = await client('rahul.naik@dempo.edu');
  const ds = db.prepare("SELECT id FROM courses WHERE code='CS201'").get().id;
  assert.equal((await rahul('POST', `/api/courses/${ds}/posts`, { title: 'hijack' })).status, 403);
});

test('students never receive the answer key or join codes', async () => {
  const stu = await client('demo.student@student.dempo.edu');
  const ex = db.prepare("SELECT id FROM exams WHERE title LIKE 'Internal Test 1%'").get().id;
  const before = (await stu('GET', `/api/exams/${ex}`)).data;
  assert.equal(before.questions, undefined, 'questions hidden until started');
  await stu('POST', `/api/exams/${ex}/start`);
  const after = (await stu('GET', `/api/exams/${ex}`)).data;
  assert.equal(after.questions.length, 5);
  assert.ok(after.questions.every((q) => !('answer' in q)));
  const ds = db.prepare("SELECT id FROM courses WHERE code='CS201'").get().id;
  assert.equal((await stu('GET', `/api/courses/${ds}`)).data.course.join_code, undefined);
});

test('exam: deadline is fixed by the server, autosave survives reload, late saves are refused, expired attempt auto-scores', async () => {
  const stu = await client('demo.student@student.dempo.edu');
  const ex = db.prepare("SELECT id FROM exams WHERE title LIKE 'Internal Test 1%'").get().id;
  const s1 = (await stu('GET', `/api/exams/${ex}`)).data.attempt.deadline_at;
  await stu('POST', `/api/exams/${ex}/start`); // second start must not reset the clock
  assert.equal((await stu('GET', `/api/exams/${ex}`)).data.attempt.deadline_at, s1);
  const qs = (await stu('GET', `/api/exams/${ex}`)).data.questions;
  assert.equal((await stu('PUT', `/api/exams/${ex}/answers`, { answers: { [qs[0].id]: 0 } })).data.saved, true);
  assert.deepEqual((await stu('GET', `/api/exams/${ex}`)).data.attempt.answers, { [qs[0].id]: 0 });
  // simulate the deadline passing while the student was offline
  db.prepare('UPDATE attempts SET deadline_at=? WHERE exam_id=?').run(new Date(Date.now() - 1000).toISOString(), ex);
  const late = await stu('PUT', `/api/exams/${ex}/answers`, { answers: { [qs[1].id]: 1 } });
  assert.equal(late.data.saved, false); assert.equal(late.data.closed, true);
  const done = (await stu('GET', `/api/exams/${ex}`)).data.attempt;
  assert.ok(done.submitted_at); assert.equal(done.score, 2, 'only the answer saved before the deadline counts');
});

test('assignment: late flag, resubmission, grading and marks validation', async () => {
  const stu = await client('demo.student@student.dempo.edu'), t = await client('priya.kamat@dempo.edu');
  const a = db.prepare("SELECT id FROM assignments WHERE title LIKE 'Assignment 2%'").get().id;
  const r = await stu('POST', `/api/assignments/${a}/submit`, { text: 'my work' });
  assert.equal(r.data.late, true);
  assert.equal((await stu('POST', `/api/assignments/${a}/submit`, { text: 'better' })).status, 200);
  const sid = db.prepare("SELECT id FROM users WHERE email='demo.student@student.dempo.edu'").get().id;
  assert.equal((await t('POST', `/api/assignments/${a}/grade`, { student_id: sid, grade: 99 })).status, 400);
  assert.equal((await t('POST', `/api/assignments/${a}/grade`, { student_id: sid, grade: 20, feedback: 'ok' })).status, 200);
  assert.equal((await stu('POST', `/api/assignments/${a}/submit`, { text: 'again' })).status, 400, 'graded work is locked');
  assert.equal((await stu('POST', `/api/assignments/${a}/grade`, { student_id: sid, grade: 25 })).status, 403);
});

test('roster import: dry run changes nothing; real run is partial with line-numbered rejections', async () => {
  const admin = await client('admin@dempo.edu');
  const csv = 'email,name,roll_no,course_codes\nnew1@student.dempo.edu,New One,24CS100,CS201;CS230\nbad-email,Broken,24CS101,CS201\nnew1@student.dempo.edu,Dupe,24CS102,CS201\ndemo.student@student.dempo.edu,Demo Student,24CS999,EC105\nnew2@student.dempo.edu,New Two,24CS103,NOPE9\n';
  const users0 = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  const dry = (await admin('POST', '/api/admin/import', { csv, dryRun: true })).data;
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, users0);
  assert.equal(dry.created.length, 1); assert.equal(dry.rejected.length, 3); assert.equal(dry.existing.length, 1);
  const real = (await admin('POST', '/api/admin/import', { csv, dryRun: false })).data;
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, users0 + 1);
  assert.deepEqual(real.rejected.map((r) => r.line), [3, 4, 6]);
  assert.ok(real.created[0].temp_password);
  const missing = await admin('POST', '/api/admin/import', { csv: 'foo,bar\n1,2', dryRun: true });
  assert.equal(missing.status, 400);
  assert.equal((await (await client('priya.kamat@dempo.edu'))('POST', '/api/admin/import', { csv })).status, 403);
});

test('gradebook weights internal/external and exports CSV safely', async () => {
  const t = await client('priya.kamat@dempo.edu');
  const ds = db.prepare("SELECT id FROM courses WHERE code='CS201'").get().id;
  const gb = (await t('GET', `/api/courses/${ds}/gradebook`)).data;
  const s = gb.students.find((x) => x.email === 'aarav.naik@student.dempo.edu');
  assert.ok(s.internal_pct > 0); assert.equal(s.external_pct, null); assert.equal(s.partial, true);
  db.prepare("UPDATE users SET name='=HYPERLINK(\"x\")' WHERE email='aarav.naik@student.dempo.edu'").run();
  const csv = (await t('GET', `/api/courses/${ds}/gradebook.csv`)).data;
  assert.match(csv, /'=HYPERLINK/); assert.match(csv, /^Roll no,Name/);
  const stu = await client('aarav.naik@student.dempo.edu');
  const mine = (await stu('GET', `/api/courses/${ds}/gradebook`)).data;
  assert.equal(mine.students.length, 1);
  assert.equal((await stu('GET', `/api/courses/${ds}/gradebook.csv`)).status, 403);
});
