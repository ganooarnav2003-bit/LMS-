# Dempo Learn

An LMS for a ~2,000-student Indian college, built from the *Dempo Learn LMS Takeover Brief*. It covers the brief's eight core LMS jobs and its four reasons a college would pick this over Google Classroom.

**Stack:** Node ≥ 22.13 (built-in `node:sqlite`), plain `node:http`, vanilla-JS front end. **Zero npm dependencies, no build step.**

## Run it

```bash
npm start            # http://localhost:3000 — seeds demo data on first run
npm test             # API tests (permissions, exam clock, import, gradebook)
npm run seed         # wipe and reseed demo data
```
Env vars: `PORT` (3000), `DB_PATH` (`data/lms.db`), `SEED=0` (skip demo data).

**Demo logins** (password `dempo-demo-1` for all — demo data only, never deploy it): `admin@dempo.edu`, `priya.kamat@dempo.edu` (teacher), `demo.student@student.dempo.edu`.

## The brief's eight jobs → where they live

| Job | What exists | Where |
|---|---|---|
| Roster & enrolment | Admin CSV import with dry-run, line-numbered rejections, partial success, one-time temp passwords; course join codes | `server/app.js` `importRoster`, `#/admin/import` |
| Content delivery | Per-course stream: announcements and study material with links | course → Stream |
| Assignment lifecycle | Create, due dates, submit, late flag, resubmit until graded | course → Classwork |
| Grading & feedback | Marks validated against max, feedback, student notified | `#/assignment/:id` |
| Communication | Announcements + in-app notifications | Updates |
| Roles & permissions | admin / teacher / student, enforced server-side per route and per course | `server/app.js` (`role`, `course`) |
| Records & reporting | Weighted gradebook, CSV export (formula-injection safe), attendance, audit log | `server/gradebook.js` |
| Integrity & accessibility | See below | |

## The four commercial premises

1. **Exam-grade reliability.** The server sets each attempt's deadline once and is the only clock; reloads can't reset it. Answers autosave per click, are kept in `localStorage` when offline and sync on reconnect; saves after the deadline are refused and expired attempts auto-submit and score. Students never receive the answer key.
2. **Data residency & DPDP.** One SQLite file, no third-party scripts/fonts/analytics (strict CSP), consent gate for students, self-service data export, audit log, privacy-notice template.
3. **A real gradebook.** Internal/external split with per-course weights, explicit missing/pending rules, letter bands, CSV export.
4. **Ownership.** Design tokens live in one `:root` block in `public/styles.css`; shared components are CSS classes, not per-screen styles.

## Design notes
Teal + saffron identity, serif headings/system sans body (no web fonts, by design), 4.5:1 contrast on text pairs, visible focus, skip link, labelled forms, status always carried by text as well as colour, tables become labelled cards at 360px, reduced-motion respected. Dark mode intentionally not included.

## Known gaps (be honest before you sell it)
- **TODO — unverified:** formal WCAG audit and screen-reader test; only automated browser checks were run.
- No file uploads (students paste text or a share link), only MCQ exams, no password-reset email (admin resets), no email/SMS/push notifications.
- Exam answers are not shuffled; no proctoring (and the brief says not to build that first).
- Single process, SQLite: fine for 2,000 students, not for multiple servers. Back up `data/`.
- Rate-limiting is in-memory; put it behind HTTPS and a reverse proxy in production (cookies are `HttpOnly; SameSite=Strict`, add `Secure` behind TLS).
- Privacy notice has `TODO` placeholders (retention period, grievance officer) the college must fill.

## Deploying to Vercel (demo only)
Import the repo in Vercel (framework preset: *Other*, no build command). `api/index.js` + `vercel.json` serve the API as a function and `public/` as static files. **Data is ephemeral** (SQLite in `/tmp`, reseeded on cold starts, not shared across instances), so use it for demos only. For real use run `npm start` on a persistent server in India, which is what the data-residency promise depends on.
