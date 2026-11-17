// SQLite via Node's built-in node:sqlite. One file on disk = data residency is simply "where you run it".
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function openDb(path = process.env.DB_PATH || 'data/lms.db') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
  CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','teacher','student')),
    roll_no TEXT, pass_hash TEXT NOT NULL, must_change INTEGER DEFAULT 0,
    consent_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS courses(
    id INTEGER PRIMARY KEY, code TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT DEFAULT '',
    teacher_id INTEGER NOT NULL REFERENCES users(id), join_code TEXT UNIQUE NOT NULL,
    internal_weight INTEGER NOT NULL DEFAULT 40, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS enrolments(course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(course_id,user_id));
  CREATE TABLE IF NOT EXISTS posts(
    id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL CHECK(kind IN ('announcement','material')),
    title TEXT NOT NULL, body TEXT DEFAULT '', link TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS assignments(
    id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL, instructions TEXT DEFAULT '', points INTEGER NOT NULL DEFAULT 100,
    due_at TEXT, category TEXT NOT NULL DEFAULT 'internal' CHECK(category IN ('internal','external')),
    allow_resubmit INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS submissions(
    id INTEGER PRIMARY KEY, assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, text TEXT DEFAULT '', link TEXT DEFAULT '',
    submitted_at TEXT NOT NULL, late INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 1,
    grade REAL, feedback TEXT DEFAULT '', graded_at TEXT, UNIQUE(assignment_id, student_id));
  CREATE TABLE IF NOT EXISTS exams(
    id INTEGER PRIMARY KEY, course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL, duration_min INTEGER NOT NULL, opens_at TEXT NOT NULL, closes_at TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'internal' CHECK(category IN ('internal','external')), created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS questions(
    id INTEGER PRIMARY KEY, exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    text TEXT NOT NULL, options TEXT NOT NULL, answer INTEGER NOT NULL, points INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS attempts(
    id INTEGER PRIMARY KEY, exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, started_at TEXT NOT NULL, deadline_at TEXT NOT NULL,
    submitted_at TEXT, answers TEXT NOT NULL DEFAULT '{}', saves INTEGER NOT NULL DEFAULT 0, last_saved_at TEXT,
    score REAL, UNIQUE(exam_id, student_id));
  CREATE TABLE IF NOT EXISTS attendance(
    course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE, day TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL CHECK(status IN ('present','absent','late')),
    PRIMARY KEY(course_id, day, user_id));
  CREATE TABLE IF NOT EXISTS notifications(
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL, link TEXT DEFAULT '', read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now')), actor_id INTEGER, action TEXT NOT NULL, detail TEXT DEFAULT '');
  `);
  return db;
}

export function hashPassword(pw) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(pw, salt, 32).toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const a = scryptSync(pw, Buffer.from(salt, 'hex'), 32), b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
export const token = (n = 24) => randomBytes(n).toString('base64url');
