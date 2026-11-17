// The Indian-style gradebook: internal (continuous assessment) and external (end-semester) components,
// each as a percentage, combined by the course's internal weight. Rules are deliberately explicit:
//  - an assignment counts once graded; past its due date with no submission it counts as 0 ("missing")
//  - an exam counts once submitted (or auto-submitted at its deadline); closed with no attempt counts as 0
export const BANDS = [[90, 'O'], [80, 'A+'], [70, 'A'], [60, 'B+'], [50, 'B'], [40, 'C'], [0, 'F']];
export const letter = (pct) => (pct == null ? '—' : BANDS.find(([min]) => pct >= min)[1]);
const r1 = (n) => Math.round(n * 10) / 10;

export function computeGradebook(db, course, onlyStudent) {
  const q = (sql, ...p) => db.prepare(sql).all(...p);
  const now = Date.now();
  const items = [
    ...q('SELECT id,title,points AS max,category,due_at AS at FROM assignments WHERE course_id=?', course.id).map((a) => ({ ...a, key: 'a' + a.id, kind: 'assignment' })),
    ...q('SELECT e.id,e.title,e.category,e.closes_at AS at,(SELECT COALESCE(SUM(points),0) FROM questions WHERE exam_id=e.id) AS max FROM exams e WHERE course_id=?', course.id).map((e) => ({ ...e, key: 'e' + e.id, kind: 'exam' })),
  ];
  let students = q('SELECT u.id,u.name,u.email,u.roll_no FROM enrolments en JOIN users u ON u.id=en.user_id WHERE en.course_id=? ORDER BY u.name', course.id);
  if (onlyStudent) students = students.filter((s) => s.id === onlyStudent);
  const subs = new Map(q('SELECT s.assignment_id,s.student_id,s.grade,s.late FROM submissions s JOIN assignments a ON a.id=s.assignment_id WHERE a.course_id=?', course.id).map((s) => [`${s.assignment_id}:${s.student_id}`, s]));
  const atts = new Map(q('SELECT a.exam_id,a.student_id,a.score,a.submitted_at FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE e.course_id=?', course.id).map((a) => [`${a.exam_id}:${a.student_id}`, a]));
  const att = new Map(q('SELECT user_id, COUNT(*) total, SUM(status!=\'absent\') present FROM attendance WHERE course_id=? GROUP BY user_id', course.id).map((a) => [a.user_id, a]));

  const out = students.map((s) => {
    const scores = {}, status = {}, earned = { internal: 0, external: 0 }, max = { internal: 0, external: 0 };
    for (const it of items) {
      let v;
      if (it.kind === 'assignment') {
        const sub = subs.get(`${it.id}:${s.id}`);
        if (sub?.grade != null) v = sub.grade; else if (!sub && it.at && now > Date.parse(it.at)) { v = 0; status[it.key] = 'missing'; } else status[it.key] = sub ? 'awaiting grade' : 'not due';
      } else {
        const a = atts.get(`${it.id}:${s.id}`);
        if (a?.submitted_at) v = a.score; else if (!a && now > Date.parse(it.at)) { v = 0; status[it.key] = 'missing'; } else status[it.key] = a ? 'in progress' : 'not taken';
      }
      if (v !== undefined) { scores[it.key] = v; earned[it.category] += v; max[it.category] += it.max; }
    }
    const pct = (c) => (max[c] ? r1((earned[c] / max[c]) * 100) : null);
    const internal_pct = pct('internal'), external_pct = pct('external'), w = course.internal_weight;
    let final_pct = null;
    if (internal_pct != null && external_pct != null) final_pct = r1((internal_pct * w + external_pct * (100 - w)) / 100);
    else final_pct = internal_pct ?? external_pct;
    const a = att.get(s.id);
    return { ...s, scores, status, internal_pct, external_pct, final_pct, grade: letter(final_pct), partial: internal_pct == null || external_pct == null, attendance_pct: a?.total ? r1((a.present / a.total) * 100) : null };
  });
  return { course: { id: course.id, code: course.code, title: course.title, internal_weight: course.internal_weight }, items, students: out, bands: BANDS };
}
