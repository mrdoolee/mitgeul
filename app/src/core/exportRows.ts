import { neisBytes } from './bytes';
import { activeStudentIds, areasForWork, semestersFor, finalGate, outputText, recordState, studentOf, workRefs } from './model';
import { areaLabel } from './rules';
import type { AppData, Area } from './schema';

export interface ExportRow {
  studentId: string;
  grade: number;
  classNo: number;
  number: number;
  name: string;
  text: string;
  bytes: number;
}

export interface ExportPlan {
  title: string;
  meta: { label: string; value: string }[];
  rows: ExportRow[];
  skipped: { name: string; reason: string }[];
  summary: Record<'empty' | 'drafting' | 'reviewed' | 'reason' | 'excluded', number>;
  /** 전원 입력 대상 여부(두 학교급 창체·행특, 고등학교 세특, 중학교 자유학기 세특) */
  allStudentsRequired: boolean;
}

export function allStudentsRequired(d: AppData, workId: string, area: Area): boolean {
  if (area !== 'subject') return true;
  const refs = workRefs(d, workId);
  const level = d.settings.schoolLevel;
  if (level === 'high') return true;
  return refs?.courseGroup?.termType === 'free';
}

/**
 * 선택한 작업·영역·학기의 출력 계획. 최종 검사를 통과한 기록만 rows에 넣는다.
 * 여러 학기를 고르면 학기순으로 줄바꿈 하나로 잇는다(세특은 수강집단이 학기별이므로 한 학기만 해당).
 */
export function planExport(d: AppData, workId: string, area: Area, semesters: (1 | 2)[]): ExportPlan {
  const refs = workRefs(d, workId);
  if (!refs) throw new Error('작업을 찾을 수 없습니다.');
  const ids = activeStudentIds(d, workId);
  const rows: ExportRow[] = [];
  const skipped: ExportPlan['skipped'] = [];
  const summary: ExportPlan['summary'] = { empty: 0, drafting: 0, reviewed: 0, reason: 0, excluded: 0 };
  // 학기 구분 없음(연간) 영역은 1학기 칸만 출력한다.
  const allowed = semestersFor(d, workId, area);
  const sems = [...new Set(semesters)].sort().filter((s) => allowed.includes(s));
  const students = ids.map((id) => studentOf(d, id)!).filter(Boolean).sort((a, b) => a.grade - b.grade || a.classNo - b.classNo || a.number - b.number);
  for (const st of students) {
    const parts: string[] = [];
    let blocked = '';
    for (const sem of sems) {
      const rec = d.records.find((r) => r.studentId === st.id && r.workId === workId && r.area === area && r.semester === sem);
      const state = recordState(d, rec);
      summary[state]++;
      if (!rec || state === 'empty') {
        blocked ||= `${sem}학기 미작성`;
        continue;
      }
      if (state === 'excluded') continue;
      const g = finalGate(d, rec);
      if (!g.ok) {
        blocked ||= `${sem}학기: ${g.reasons[0]}`;
        continue;
      }
      parts.push(outputText(rec));
    }
    if (blocked) {
      skipped.push({ name: `${st.classNo}반 ${st.number}번 ${st.name}`, reason: blocked });
      continue;
    }
    if (!parts.length) continue;
    const text = parts.join('\n');
    rows.push({ studentId: st.id, grade: st.grade, classNo: st.classNo, number: st.number, name: st.name, text, bytes: neisBytes(text) });
  }
  const grade = students[0]?.grade ?? d.settings.defaultGrade;
  const meta = [
    { label: '학교급', value: d.settings.schoolLevel === 'high' ? '고등학교' : '중학교' },
    { label: '학년도', value: String(d.settings.schoolYear) },
    { label: '작업', value: refs.label },
    { label: '영역', value: areaLabel(area, grade) },
    { label: '학기', value: refs.work.annualAreas?.includes(area) ? '연간(학기 구분 없음)' : sems.map((s) => `${s}학기`).join(', ') },
  ];
  if (refs.subject) meta.push({ label: '과목', value: refs.subject.name }, { label: '수강집단', value: refs.courseGroup!.name });
  return { title: `${refs.label} - ${areaLabel(area, grade)}`, meta, rows, skipped, summary, allStudentsRequired: allStudentsRequired(d, workId, area) };
}

export interface StudentExportRow {
  area: string;
  work: string;
  semester: string;
  text: string;
  bytes: number;
}

export interface StudentExportPlan {
  title: string;
  meta: { label: string; value: string }[];
  rows: StudentExportRow[];
  skipped: { name: string; reason: string }[];
}

const AREA_ORDER: Area[] = ['autonomy', 'club', 'career', 'subject', 'behavior'];

/**
 * 학생별 출력 계획: 한 학생이 속한 모든 작업(담임·교과·동아리)의 영역·학기 기록 중 최종 검사를 통과한 것만 담는다.
 * 미작성·검토 전·차단 기록은 skipped에 사유와 함께 남긴다. 작업에서 제외된 학생의 그 작업 기록은 넣지 않는다.
 */
export function planStudentExport(d: AppData, studentId: string): StudentExportPlan {
  const st = studentOf(d, studentId);
  if (!st) throw new Error('학생을 찾을 수 없습니다.');
  const rows: (StudentExportRow & { order: number })[] = [];
  const skipped: StudentExportPlan['skipped'] = [];
  for (const w of d.works) {
    if (!activeStudentIds(d, w.id).includes(studentId)) continue;
    const refs = workRefs(d, w.id)!;
    for (const area of areasForWork(w.kind)) {
      for (const sem of semestersFor(d, w.id, area)) {
        const annual = !!w.annualAreas?.includes(area);
        const label = `${areaLabel(area, st.grade)} · ${refs.label} · ${annual ? '연간' : `${sem}학기`}`;
        const rec = d.records.find((r) => r.studentId === studentId && r.workId === w.id && r.area === area && r.semester === sem);
        const state = recordState(d, rec);
        if (!rec || state === 'empty') {
          skipped.push({ name: label, reason: '미작성' });
          continue;
        }
        if (state === 'excluded') continue;
        const g = finalGate(d, rec);
        if (!g.ok) {
          skipped.push({ name: label, reason: g.reasons[0] ?? '검토 전' });
          continue;
        }
        const text = outputText(rec);
        rows.push({ area: areaLabel(area, st.grade), work: refs.label, semester: annual ? '연간' : `${sem}학기`, text, bytes: neisBytes(text), order: AREA_ORDER.indexOf(area) * 10 + sem });
      }
    }
  }
  rows.sort((a, b) => a.order - b.order || a.work.localeCompare(b.work, 'ko'));
  const meta = [
    { label: '학교급', value: d.settings.schoolLevel === 'high' ? '고등학교' : '중학교' },
    { label: '학년도', value: String(d.settings.schoolYear) },
    { label: '학생', value: `${st.grade}학년 ${st.classNo}반 ${st.number}번 ${st.name}` },
  ];
  return { title: `${st.grade}학년 ${st.classNo}반 ${st.number}번 ${st.name} 생활기록부 문장`, meta, rows: rows.map(({ order: _o, ...r }) => r), skipped };
}
