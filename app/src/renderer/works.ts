import type { Area, Student, Work } from '../core/schema';
import { data } from './state';

export const AREAS_BY_KIND: Record<Work['kind'], Area[]> = { homeroom: ['autonomy', 'career', 'behavior'], subject: ['subject'], club: ['club'] };

export interface WorkItem {
  w: Work;
  label: string;
  /** 교과는 수강집단 학기로 고정, 담임·동아리는 null */
  fixedSemester: 1 | 2 | null;
}

/** 모든 작업(학생과 무관). 교과는 수강집단 학기로 고정한다. */
export function allWorks(): WorkItem[] {
  const d = data();
  return d.works
    .map((w) => {
      if (w.kind === 'homeroom') {
        const c = d.classes.find((x) => x.id === w.refId);
        return c ? { w, label: `담임 · ${c.grade}학년 ${c.classNo}반`, fixedSemester: null } : null;
      }
      if (w.kind === 'subject') {
        const g = d.courseGroups.find((x) => x.id === w.refId);
        const sj = g && d.subjects.find((x) => x.id === g.subjectId);
        return g && sj ? { w, label: `교과 · ${sj.name} (${g.name}, ${w.annualAreas?.includes('subject') ? '학기 구분 없음' : `${g.semester}학기`})`, fixedSemester: g.semester } : null;
      }
      const c = d.clubs.find((x) => x.id === w.refId);
      return c ? { w, label: `동아리 · ${c.name}`, fixedSemester: null } : null;
    })
    .filter(Boolean) as WorkItem[];
}

/** 작업 명단(작업에서 뺀 학생 제외), 반·번호 순 */
export function rosterOfWork(workId: string): Student[] {
  const d = data();
  const w = d.works.find((x) => x.id === workId);
  if (!w) return [];
  const ids = w.kind === 'homeroom' ? d.classes.find((c) => c.id === w.refId)?.studentIds : w.kind === 'subject' ? d.courseGroups.find((g) => g.id === w.refId)?.studentIds : d.clubs.find((c) => c.id === w.refId)?.studentIds;
  return (ids ?? [])
    .filter((id) => !w.excludedStudentIds.includes(id))
    .map((id) => d.students.find((s) => s.id === id)!)
    .filter(Boolean)
    .sort((a, b) => a.classNo - b.classNo || a.number - b.number);
}

/** 초기 설정에서 정한 이 작업·영역의 입력 학기와 연간 여부 */
export function inputSemesterOf(item: WorkItem, area: Area): { semester: 1 | 2; annual: boolean } {
  if (item.w.annualAreas?.includes(area)) return { semester: 1, annual: true };
  if (item.fixedSemester) return { semester: item.fixedSemester, annual: false };
  return { semester: item.w.activeSemester ?? 1, annual: false };
}

export function semesterText(s: { semester: 1 | 2; annual: boolean }) {
  return s.annual ? '학기 구분 없음(연간)' : `${s.semester}학기`;
}

/** 수업 반의 학기 표기: 학기 구분 없음(연간)이면 그 문구, 아니면 n학기 */
export function groupTermText(groupId: string): string {
  const d = data();
  const g = d.courseGroups.find((x) => x.id === groupId);
  if (!g) return '';
  return d.works.some((w) => w.kind === 'subject' && w.refId === groupId && w.annualAreas?.includes('subject')) ? '학기 구분 없음' : `${g.semester}학기`;
}
