import { openDb } from './db.js';
import { createApp } from './app.js';
import { seed } from './seed.js';

const db = openDb();
if (db.prepare('SELECT COUNT(*) n FROM users').get().n === 0 && process.env.SEED !== '0') {
  seed(db);
  console.log('Empty database — loaded demo data. See README for demo logins. Change these before real use.');
}
const port = Number(process.env.PORT || 3000);
createApp(db).listen(port, () => console.log(`Dempo Learn running at http://localhost:${port}`));
