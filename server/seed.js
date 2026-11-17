// Demo data. Runs only on an empty database (or `npm run seed`, which resets).
import { hashPassword } from './db.js';
import { openDb } from './db.js';
import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEMO_PASSWORD = 'dempo-demo-1';
const DAY = 86400_000;
const iso = (offsetDays, hour) => { const d = new Date(Date.now() + offsetDays * DAY); if (hour != null) d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };

const NAMES = ['Aarav Naik', 'Diya Fernandes', 'Rohan Gaonkar', 'Sneha Kamat', 'Ishaan Dessai', 'Anaya D\'Souza', 'Vihaan Shirodkar', 'Meera Prabhu', 'Kabir Borkar', 'Tara Pereira', 'Arjun Sawant', 'Riya Kakodkar', 'Neel Volvoikar', 'Zoya Shaikh', 'Aditya Parab', 'Kavya Rane', 'Dev Gawde', 'Sanya Mandrekar', 'Yash Bandodkar', 'Pooja Chodankar'];

export function seed(db) {
  const hash = hashPassword(DEMO_PASSWORD);
  const user = (email, name, role, roll) => Number(db.prepare('INSERT INTO users(email,name,role,roll_no,pass_hash,consent_at) VALUES(?,?,?,?,?,?)').run(email, name, role, roll, hash, role === 'student' ? null : iso(-30)).lastInsertRowid);
  user('admin@dempo.edu', 'Registrar Office', 'admin', null);
  const t1 = user('priya.kamat@dempo.edu', 'Dr. Priya Kamat', 'teacher', null);
  const t2 = user('rahul.naik@dempo.edu', 'Prof. Rahul Naik', 'teacher', null);
  const students = NAMES.map((n, i) => user(`${n.toLowerCase().replace(/[^a-z]+/g, '.')}@student.dempo.edu`, n, 'student', `24CS${String(i + 1).padStart(3, '0')}`));
  user('demo.student@student.dempo.edu', 'Demo Student', 'student', '24CS999');

  const course = (code, title, desc, teacher, w) => Number(db.prepare('INSERT INTO courses(code,title,description,teacher_id,join_code,internal_weight) VALUES(?,?,?,?,?,?)').run(code, title, desc, teacher, code.replace(/\W/g, '') + '1', w).lastInsertRowid);
  const ds = course('CS201', 'Data Structures', 'Arrays, linked lists, trees, graphs and the habit of measuring complexity.', t1, 40);
  const db1 = course('CS230', 'Database Systems', 'Relational model, SQL, normalisation and transactions.', t1, 30);
  const ec = course('EC105', 'Digital Electronics', 'Boolean algebra, combinational and sequential logic.', t2, 40);
  const all = [...students, db.prepare("SELECT id FROM users WHERE email='demo.student@student.dempo.edu'").get().id];
  const enrol = (c, list) => list.forEach((s) => db.prepare('INSERT OR IGNORE INTO enrolments VALUES(?,?)').run(c, s));
  enrol(ds, all); enrol(db1, all.slice(0, 14).concat(all.slice(-1))); enrol(ec, all.slice(5));

  const post = (c, a, kind, title, body, link, d) => db.prepare('INSERT INTO posts(course_id,author_id,kind,title,body,link,created_at) VALUES(?,?,?,?,?,?,?)').run(c, a, kind, title, body, link, iso(d));
  post(ds, t1, 'announcement', 'Welcome to Data Structures', 'Lectures are Mon/Wed/Fri. Lab batches are posted on the notice board. Bring your lab record to the first session.', '', -20);
  post(ds, t1, 'material', 'Week 3 — Linked lists (slides)', 'Read before Wednesday. We will implement insertion and deletion live.', 'https://example.com/ds/week3-linked-lists', -9);
  post(ds, t1, 'announcement', 'Internal test on Friday', 'The in-class quiz (online) covers weeks 1–3. It is open for two days and you get 20 minutes once you start.', '', -2);
  post(db1, t1, 'material', 'SQL practice sheet', 'Questions 1–15. We will review them in the next class.', 'https://example.com/dbms/sql-practice', -6);
  post(ec, t2, 'announcement', 'Lab safety reminder', 'Closed footwear is mandatory in the lab from this week.', '', -4);

  const asg = (c, title, ins, pts, due, cat) => Number(db.prepare('INSERT INTO assignments(course_id,title,instructions,points,due_at,category) VALUES(?,?,?,?,?,?)').run(c, title, ins, pts, due, cat).lastInsertRowid);
  const a1 = asg(ds, 'Lab 1 — Array utilities', 'Implement reverse, rotate and binary search. Submit a link to your repository or paste your code.', 20, iso(-12, 12), 'internal');
  const a2 = asg(ds, 'Assignment 2 — Linked list report', 'Write a one-page comparison of arrays and linked lists with two worked examples.', 25, iso(-3, 12), 'internal');
  asg(ds, 'Assignment 3 — Binary trees', 'Draw the tree for the given insertion order and list its traversals.', 25, iso(6, 12), 'internal');
  asg(db1, 'Lab 1 — ER diagram', 'Model the college library as an ER diagram.', 20, iso(4, 12), 'internal');

  const sub = db.prepare('INSERT INTO submissions(assignment_id,student_id,text,link,submitted_at,late,grade,feedback,graded_at) VALUES(?,?,?,?,?,?,?,?,?)');
  students.forEach((s, i) => {
    if (i % 9 !== 8) sub.run(a1, s, 'Solution attached in repository.', 'https://example.com/repo/' + s, iso(-13), 0, 12 + ((i * 7) % 9), i % 4 === 0 ? 'Good edge-case handling. Comment your rotate logic.' : '', iso(-10));
    if (i % 5 !== 4) sub.run(a2, s, 'Array vs linked list: access is O(1) vs O(n)…', '', iso(i % 6 === 0 ? -2 : -4, 10 + (i % 5)), i % 6 === 0 ? 0 : 0, i < 8 ? 15 + (i % 10) : null, '', i < 8 ? iso(-1) : null);
  });

  const ex = Number(db.prepare('INSERT INTO exams(course_id,title,duration_min,opens_at,closes_at,category) VALUES(?,?,?,?,?,?)').run(ds, 'Internal Test 1 — Weeks 1–3', 20, iso(-1), iso(3), 'internal').lastInsertRowid);
  const Q = [
    ['What is the time complexity of accessing the i-th element of an array?', ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'], 0],
    ['Which structure gives O(1) insertion at the head without shifting elements?', ['Array', 'Singly linked list', 'Sorted array', 'Binary heap'], 1],
    ['Binary search requires the input to be…', ['Unique', 'Sorted', 'Of fixed length', 'Stored in a list'], 1],
    ['A stack follows which order?', ['FIFO', 'LIFO', 'Random', 'Priority'], 1],
    ['The worst-case time to search an unsorted array of n items is…', ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], 2],
  ];
  Q.forEach(([t, o, a]) => db.prepare('INSERT INTO questions(exam_id,text,options,answer,points) VALUES(?,?,?,?,?)').run(ex, t, JSON.stringify(o), a, 2));
  const ex0 = Number(db.prepare('INSERT INTO exams(course_id,title,duration_min,opens_at,closes_at,category) VALUES(?,?,?,?,?,?)').run(ds, 'Unit Quiz 0 — Basics', 15, iso(-14), iso(-12), 'internal').lastInsertRowid);
  Q.slice(0, 3).forEach(([t, o, a]) => db.prepare('INSERT INTO questions(exam_id,text,options,answer,points) VALUES(?,?,?,?,?)').run(ex0, t, JSON.stringify(o), a, 2));
  students.forEach((s, i) => { if (i % 7 !== 6) db.prepare('INSERT INTO attempts(exam_id,student_id,started_at,deadline_at,submitted_at,answers,score) VALUES(?,?,?,?,?,?,?)').run(ex0, s, iso(-13), iso(-13), iso(-13), '{}', 2 * (1 + (i % 3))); });

  const att = db.prepare('INSERT OR IGNORE INTO attendance VALUES(?,?,?,?)');
  for (let d = 1; d <= 8; d++) {
    const day = new Date(Date.now() - d * DAY).toISOString().slice(0, 10);
    students.forEach((s, i) => att.run(ds, day, s, (i * 3 + d * 5) % 11 === 0 ? 'absent' : (i + d) % 13 === 0 ? 'late' : 'present'));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.env.DB_PATH || 'data/lms.db';
  if (process.argv.includes('--reset')) for (const f of [path, path + '-wal', path + '-shm']) if (existsSync(f)) rmSync(f);
  const db = openDb(path);
  seed(db);
  console.log(`Seeded ${path}. Demo password for every account: ${DEMO_PASSWORD}`);
}
