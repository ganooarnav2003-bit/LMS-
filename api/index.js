// Vercel entry point. DEMO ONLY: Vercel's filesystem is ephemeral, so the SQLite file lives in /tmp,
// is reseeded on cold start, and is not shared between instances. Use a persistent host for real use.
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seed } from '../server/seed.js';

let handler;
export default function (req, res) {
  if (!handler) {
    const db = openDb(process.env.DB_PATH || '/tmp/lms.db');
    if (db.prepare('SELECT COUNT(*) n FROM users').get().n === 0) seed(db);
    handler = createApp(db).handler;
  }
  return handler(req, res);
}
