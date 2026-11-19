import { newRecord, nowIso, reviewHash } from '../src/core/model';
import { RULES_VERSION } from '../src/core/rules';
import { emptyAppData, type AppData, type RecordEntry, type Student, type Subject } from '../src/core/schema';

export function student(id: string, name: string, grade: number, classNo: number, number: number, level: 'middle' | 'high' = 'middle'): Student {
  return { id, name, schoolLevel: level, schoolYear: 2026, grade, classNo, number, aliases: [], curriculum: grade <= 2 ? '2022' : '2015' };
}

export function baseData(level: 'middle' | 'high' = 'middle'): AppData {
  const d = emptyAppData();
  d.settings.setupDone = true;
  d.settings.schoolLevel = level;
  d.students.push(student('s1', '김민준', 1, 3, 1, level), student('s2', '이서연', 1, 3, 2, level), student('s3', '박하늘', 1, 4, 7, level));
  d.classes.push({ id: 'c13', schoolLevel: level, schoolYear: 2026, grade: 1, classNo: 3, studentIds: ['s1', 's2'] });
  d.works.push({ id: 'w-home', kind: 'homeroom', refId: 'c13', excludedStudentIds: [] });
  return d;
}

export function addSubject(d: AppData, s: Omit<Subject, 'schoolLevel'> & { schoolLevel?: Subject['schoolLevel'] }, groups: { id: string; semester: 1 | 2; grade?: number; studentIds: string[]; termType?: 'regular' | 'free' }[]) {
  d.subjects.push({ schoolLevel: d.settings.schoolLevel, ...s });
  for (const g of groups) {
    d.courseGroups.push({ id: g.id, subjectId: s.id, schoolYear: 2026, grade: g.grade ?? 1, semester: g.semester, termType: g.termType ?? 'regular', name: `${s.name} ${g.id}`, studentIds: g.studentIds });
    d.works.push({ id: `w-${g.id}`, kind: 'subject', refId: g.id, excludedStudentIds: [] });
  }
}

export function rec(d: AppData, id: string, studentId: string, workId: string, area: RecordEntry['area'], semester: 1 | 2, finalText: string): RecordEntry {
  const r = newRecord(id, studentId, workId, area, semester);
  r.finalText = finalText;
  d.records.push(r);
  return r;
}

export function markReviewed(d: AppData, r: RecordEntry) {
  r.review = { hash: reviewHash(d, r), rulesVersion: RULES_VERSION, reviewedAt: nowIso() };
}

export const hangul = (n: number) => '가'.repeat(n);
