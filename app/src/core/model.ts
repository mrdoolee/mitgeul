import { createHash } from 'node:crypto';
import { measure, neisBytes } from './bytes';
import { AREA_LIMIT, RULES_VERSION, checkText, clubAllowsNarrative, hasBlocking, toneFindings, type CheckContext, type Finding } from './rules';
import { FREE_ITEM_ID } from './schema';
import type { AppData, Area, Club, CourseGroup, RecordEntry, SchoolLevel, Student, Subject, Work } from './schema';

export function sha(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

export function areasForWork(kind: Work['kind']): Area[] {
  if (kind === 'homeroom') return ['autonomy', 'career', 'behavior'];
  if (kind === 'subject') return ['subject'];
  return ['club'];
}

export interface WorkRefs {
  work: Work;
  courseGroup?: CourseGroup;
  subject?: Subject;
  club?: Club;
  studentIds: string[];
  label: string;
}

export function workRefs(d: AppData, workId: string): WorkRefs | undefined {
  const work = d.works.find((w) => w.id === workId);
  if (!work) return undefined;
  if (work.kind === 'homeroom') {
    const c = d.classes.find((x) => x.id === work.refId);
    if (!c) return undefined;
    return { work, studentIds: c.studentIds, label: `${c.grade}학년 ${c.classNo}반 담임` };
  }
  if (work.kind === 'subject') {
    const g = d.courseGroups.find((x) => x.id === work.refId);
    const s = g && d.subjects.find((x) => x.id === g.subjectId);
    if (!g || !s) return undefined;
    return { work, courseGroup: g, subject: s, studentIds: g.studentIds, label: `${s.name} · ${g.name} (${work.annualAreas?.includes('subject') ? '학기 구분 없음' : `${g.semester}학기`}${g.termType === 'free' ? '·자유학기' : ''})` };
  }
  const club = d.clubs.find((x) => x.id === work.refId);
  if (!club) return undefined;
  return { work, club, studentIds: club.studentIds, label: `${club.name} 동아리` };
}

/** 작업·영역에서 작성하는 학기. 수강집단은 그 학기, 학기 구분 없음(연간)은 1학기 칸만, 그 밖은 1·2학기. */
export function semestersFor(d: AppData, workId: string, area: Area): (1 | 2)[] {
  const refs = workRefs(d, workId);
  if (refs?.courseGroup) return [refs.courseGroup.semester];
  if (refs?.work.annualAreas?.includes(area)) return [1];
  return [1, 2];
}

/** 관찰 기록 및 초안 작성에서 쓰는 학기: 교과는 수강집단 학기, 연간 영역은 1학기 칸, 그 밖은 초기 설정의 입력 학기. */
export function inputSemester(d: AppData, workId: string, area: Area): 1 | 2 {
  const refs = workRefs(d, workId);
  if (refs?.courseGroup) return refs.courseGroup.semester;
  if (refs?.work.annualAreas?.includes(area)) return 1;
  return refs?.work.activeSemester ?? 1;
}

export function isAnnual(d: AppData, workId: string, area: Area): boolean {
  return !!d.works.find((w) => w.id === workId)?.annualAreas?.includes(area);
}

export function activeStudentIds(d: AppData, workId: string): string[] {
  const r = workRefs(d, workId);
  if (!r) return [];
  return r.studentIds.filter((s) => !r.work.excludedStudentIds.includes(s));
}

export function studentOf(d: AppData, id: string): Student | undefined {
  return d.students.find((s) => s.id === id);
}

export function rosterNameSets(d: AppData): { full: string[]; partial: string[] } {
  const full: string[] = [];
  const partial: string[] = [];
  for (const s of d.students) {
    full.push(s.name);
    // 성 뺀 이름·별칭 경고는 일반 단어와 겹쳐 오작동하므로 하지 않는다(2026-11-16).
    void partial;
  }
  return { full, partial };
}

/** 한국식 성명에서 성을 뺀 이름. 3~4자 이름은 첫 글자를 성으로 본다(복성은 별칭으로 보완). */
export function givenName(name: string): string | null {
  const n = name.trim();
  if (n.length >= 3 && /^[가-힣]+$/.test(n)) return n.slice(1);
  return null;
}

export function checkContext(d: AppData, rec: Pick<RecordEntry, 'studentId' | 'workId' | 'area'>): CheckContext {
  const st = studentOf(d, rec.studentId);
  const refs = workRefs(d, rec.workId);
  const names = rosterNameSets(d);
  return {
    level: st?.schoolLevel ?? d.settings.schoolLevel,
    area: rec.area,
    curriculum: refs?.subject?.curriculum ?? st?.curriculum ?? '2022',
    subjectName: refs?.subject?.name,
    customBans: d.settings.bannedTerms ?? [],
    rosterFullNames: names.full,
    rosterPartialNames: names.partial,
  };
}

export function findingsFor(d: AppData, rec: RecordEntry, text: string): Finding[] {
  return [...checkText(text, checkContext(d, rec)), ...toneFindings(text)].sort((a, b) => a.index - b.index);
}

/** 출력 본문. 행특 학기 구분 표기 '(1학기)'는 교사가 최종 본문에 직접 입력한다(중 3323행, 고 4909행; 자동 표기 버튼은 2026-11-18 삭제). */
export function outputText(rec: RecordEntry): string {
  return rec.finalText.trim();
}

export interface AggregationInfo {
  key: string;
  limit: number;
  label: string;
  supported: boolean;
  /** 세특 자동 학기 표기 등 Byte 산입이 확인되지 않은 보수적 가산값 */
  overhead: number;
  notes: string[];
  /** 앱 밖 기록이 필요한 키(공통과목의 다른 쪽 등) */
  priorKeys: string[];
}

const AUTO_SEMESTER_LABEL_BYTES = neisBytes('(1학기)');

export function aggregationInfo(d: AppData, rec: RecordEntry): AggregationInfo {
  const st = studentOf(d, rec.studentId);
  const year = d.settings.schoolYear;
  const grade = st?.grade ?? d.settings.defaultGrade;
  const level: SchoolLevel = st?.schoolLevel ?? d.settings.schoolLevel;
  if (rec.area !== 'subject') {
    return {
      key: `${rec.studentId}|${year}|${grade}|${rec.area}`,
      limit: AREA_LIMIT[rec.area],
      label: `${grade}학년 연간 합계`,
      supported: true,
      overhead: 0,
      notes: [],
      priorKeys: [],
    };
  }
  const refs = workRefs(d, rec.workId);
  const subj = refs?.subject;
  const g = refs?.courseGroup;
  if (!subj || !g) return { key: `${rec.studentId}|missing|${rec.workId}`, limit: 1500, label: '과목 정보 없음', supported: false, overhead: 0, notes: ['과목·수강집단 연결을 확인하세요.'], priorKeys: [] };
  if (level === 'middle') {
    return {
      key: `${rec.studentId}|${year}|${grade}|subj:${subj.id}`,
      limit: 1500,
      label: `${subj.name} 연간 합계`,
      supported: true,
      overhead: 0,
      notes: ['중학교 동일 과목 연간 합산은 2973행에 근거한 해석입니다(확인 필요).'],
      priorKeys: [],
    };
  }
  switch (subj.kind) {
    case 'common': {
      const group = subj.commonGroup ?? subj.name;
      const other = subj.commonPart === 1 ? 2 : 1;
      return {
        key: `${rec.studentId}|common:${group}`,
        limit: 1500,
        label: `${group}1·2 합산`,
        supported: true,
        overhead: 0,
        notes: ['공통과목 1·2는 다른 학년이어도 합산합니다(고 6238행, 공식 보충 답변).'],
        priorKeys: [`${rec.studentId}|common:${group}|part:${other}`],
      };
    }
    case 'yearlong':
      return { key: `${rec.studentId}|${year}|subj:${subj.id}`, limit: 1500, label: `${subj.name} 학년제 연간 합계`, supported: true, overhead: 0, notes: ['고3 학년제 과목은 1·2학기를 합산합니다(공식 보충 답변 2026-06-26).'], priorKeys: [] };
    case 'general':
      return { key: `${rec.studentId}|${year}|subj:${subj.id}|sem:${g.semester}`, limit: 1500, label: `${subj.name} ${g.semester}학기`, supported: true, overhead: 0, notes: [], priorKeys: [] };
    case 'majorPractice':
      return { key: `${rec.studentId}|${year}|subj:${subj.id}|sem:${g.semester}`, limit: 1500, label: '전공실무 학기별', supported: false, overhead: 0, notes: ['전공실무과목(능력단위)은 이 앱에서 지원하지 않습니다.'], priorKeys: [] };
    case 'unsupported':
      return { key: `${rec.studentId}|unsupported|${subj.id}`, limit: 1500, label: '미지원 과목', supported: false, overhead: 0, notes: ['별도 작성 경로가 필요한 과목은 이 앱에서 생성·최종 출력하지 않습니다.'], priorKeys: [] };
  }
}

export interface AggregationStatus {
  info: AggregationInfo;
  members: RecordEntry[];
  usedBytes: number;
  priorBytes: number;
  unknownPrior: string[];
  total: number;
  remaining: number;
  over: boolean;
}

export function aggregationStatus(d: AppData, rec: RecordEntry): AggregationStatus {
  const info = aggregationInfo(d, rec);
  const members = d.records.filter((r) => r.studentId === rec.studentId && r.mode !== 'excluded' && aggregationInfo(d, r).key === info.key);
  if (!members.some((m) => m.id === rec.id)) members.push(rec);
  members.sort((a, b) => a.semester - b.semester || a.id.localeCompare(b.id));
  const texts = members.map((m) => (m.id === rec.id ? rec : m)).map(outputText).filter((t) => t.length > 0);
  let used = texts.reduce((n, t) => n + neisBytes(t), 0);
  let overhead = 0;
  if (texts.length > 1) {
    if (rec.area === 'subject') {
      // 세특: 같은 과목을 학기별로 입력하면 '(1학기)'·'(2학기)' 자동 표기와 2학기 줄바꿈이 붙는다(중 2973행, 고 4460행).
      // Byte 산입 여부 확인 전까지 보수적으로 포함. 공통과목 1·2처럼 서로 다른 과목이면 가산하지 않는다.
      const bySubject = new Map<string, number>();
      members.filter((m) => outputText(m.id === rec.id ? rec : m)).forEach((m) => {
        const sid = workRefs(d, m.workId)?.subject?.id ?? m.workId;
        bySubject.set(sid, (bySubject.get(sid) ?? 0) + 1);
      });
      for (const n of bySubject.values()) if (n > 1) overhead += n * AUTO_SEMESTER_LABEL_BYTES + (n - 1);
    } else {
      overhead = texts.length - 1; // 학기 사이 줄바꿈 하나(앱 기본값)
    }
  }
  used += overhead;
  let prior = 0;
  const unknownPrior: string[] = [];
  for (const k of info.priorKeys) {
    const presentPart = members.some((m) => {
      const s = workRefs(d, m.workId)?.subject;
      return s && k.endsWith(`part:${s.commonPart}`);
    });
    if (presentPart) continue;
    const p = d.priorBytes.find((x) => x.studentId === rec.studentId && x.key === k);
    if (!p || p.bytes === null) unknownPrior.push(k);
    else prior += p.bytes;
  }
  const total = used + prior;
  return { info: { ...info, overhead }, members, usedBytes: used, priorBytes: prior, unknownPrior, total, remaining: info.limit - total, over: total > info.limit };
}

/** 항목(루브릭 항목 또는 행사)의 근거 해시. 행사는 행사 정의(이름·기간·횟수·내용)와 학생 사례를 포함한다. */
export function evidenceHash(d: AppData, rec: RecordEntry, itemId: string): string {
  if (itemId === FREE_ITEM_ID) return sha({ free: rec.freeNote, context: rec.context }).slice(0, 16);
  const o = rec.observations.find((x) => x.itemId === itemId);
  const e = rec.eventObs.find((x) => x.eventId === itemId);
  const def = e ? d.events.find((x) => x.id === itemId) : undefined;
  return sha({ o, e, def: def ? { n: def.name, p: def.period, q: def.quantity, d: def.description } : null, context: rec.context }).slice(0, 16);
}

/** 기록에서 생성 대상이 되는 항목 ID(루브릭 항목 + 선택한 행사) */
export function evidenceItemIds(rec: RecordEntry): string[] {
  return [...(rec.freeNote.trim() ? [FREE_ITEM_ID] : []), ...rec.observations.map((o) => o.itemId), ...rec.eventObs.map((e) => e.eventId)];
}

/** 금지 규칙 검사 대상인 교사 입력(맥락·사례·선택한 행사의 정의와 학생 사례) */
export function inputTexts(d: AppData, rec: RecordEntry): string[] {
  const ev = rec.eventObs.flatMap((e) => {
    const def = d.events.find((x) => x.id === e.eventId);
    return [def?.name ?? '', def?.description ?? '', e.note];
  });
  return [rec.context, rec.freeNote, ...rec.observations.map((o) => o.example), ...ev].filter(Boolean);
}

/** 검토 해시: 본문·목표·규칙 버전·같은 합산 단위의 다른 본문·이전 Byte·학교급/교육과정/과목 설정이 바뀌면 달라진다. */
export function reviewHash(d: AppData, rec: RecordEntry): string {
  const agg = aggregationStatus(d, rec);
  const st = studentOf(d, rec.studentId);
  const refs = workRefs(d, rec.workId);
  return sha({
    text: outputText(rec),
    mode: rec.mode,
    // 125·250자를 150·300자로 옮긴 뒤에도 기존 검토가 풀리지 않게 이전 값으로 해시한다(일대일 대응이라 목표 변경은 여전히 구분된다).
    target: rec.target === 150 ? 125 : rec.target === 300 ? 250 : rec.target,
    rules: RULES_VERSION,
    level: st?.schoolLevel,
    grade: st?.grade,
    curriculum: st?.curriculum,
    subject: refs?.subject ?? null,
    courseGroup: refs?.courseGroup ? { ...refs.courseGroup, studentIds: undefined } : null,
    clubType: refs?.club?.clubType ?? null,
    key: agg.info.key,
    others: agg.members.filter((m) => m.id !== rec.id).map((m) => sha(outputText(m))),
    prior: agg.info.priorKeys.map((k) => d.priorBytes.find((p) => p.studentId === rec.studentId && p.key === k)?.bytes ?? 'unknown'),
    schoolNames: [d.settings.schoolName, ...d.settings.schoolAliases],
    bans: d.settings.bannedTerms ?? [],
  });
}

export function reviewValid(d: AppData, rec: RecordEntry): boolean {
  return !!rec.review && rec.review.rulesVersion === RULES_VERSION && rec.review.hash === reviewHash(d, rec);
}

export type RecordState = 'empty' | 'drafting' | 'reviewed' | 'reason' | 'excluded';

export function recordState(d: AppData, rec: RecordEntry | undefined): RecordState {
  if (!rec) return 'empty';
  if (rec.mode === 'excluded') return 'excluded';
  if (reviewValid(d, rec)) return rec.mode === 'reason' ? 'reason' : 'reviewed';
  if (rec.finalText.trim() || rec.draft.trim() || rec.freeNote.trim() || rec.observations.length || rec.eventObs.length) return 'drafting';
  return 'empty';
}

export interface Gate {
  ok: boolean;
  reasons: string[];
}

export function narrativeBlockers(d: AppData, rec: Pick<RecordEntry, 'workId' | 'area' | 'studentId'>): string[] {
  const refs = workRefs(d, rec.workId);
  const out: string[] = [];
  if (!refs) return ['작업 연결을 찾을 수 없습니다.'];
  if (refs.club && !clubAllowsNarrative(refs.club.clubType)) out.push('이 동아리 유형은 특기사항 작성 대상이 아닙니다.');
  if (refs.subject && (refs.subject.kind === 'unsupported' || refs.subject.kind === 'majorPractice')) out.push('이 과목 유형은 앱에서 지원하지 않는 별도 작성 경로입니다.');
  if (!refs.studentIds.includes(rec.studentId)) out.push('학생이 이 작업 명단에 없습니다.');
  return out;
}

/** 검토 완료로 표시할 수 있는지(교사 확인 전 단계의 자동 조건). */
export function reviewGate(d: AppData, rec: RecordEntry): Gate {
  const reasons: string[] = [];
  if (rec.mode === 'excluded') reasons.push('기재 제외 기록입니다.');
  reasons.push(...narrativeBlockers(d, rec).filter(() => rec.mode === 'normal'));
  const text = outputText(rec);
  if (!text) reasons.push('최종 본문이 비어 있습니다.');
  if (/\{\{학생:[^}]+\}\}/.test(text)) reasons.push('본문에 학생 참조가 남아 있습니다. 주어를 생략하도록 고치세요.');
  if (hasBlocking(findingsFor(d, rec, text))) reasons.push('차단 규칙에 걸린 표현이 있습니다.');
  const agg = aggregationStatus(d, rec);
  if (!agg.info.supported) reasons.push(...agg.info.notes);
  if (agg.unknownPrior.length) reasons.push('합산 대상의 이전 기록 사용 Byte가 확인되지 않았습니다.');
  if (agg.over) reasons.push(`${agg.info.label} 한도 ${agg.info.limit}Byte를 ${agg.total - agg.info.limit}Byte 초과합니다.`);
  if (measure(text).uncertain.length) {
    // 경고만: 불명확 문자는 검토를 막지 않지만 화면에서 확인을 요구한다.
  }
  return { ok: reasons.length === 0, reasons };
}

/** 최종 본문 복사·파일 출력 직전 검사. 검토 유효성까지 요구한다. */
export function finalGate(d: AppData, rec: RecordEntry): Gate {
  const g = reviewGate(d, rec);
  const reasons = [...g.reasons];
  if (!reviewValid(d, rec)) reasons.push('교사 검토가 완료되지 않았거나 검토 후 관련 내용이 바뀌었습니다.');
  return { ok: reasons.length === 0, reasons };
}

/**
 * AI 후보 생성 조건. 작업을 막지 않도록 최소 조건(일반 작성 모드, 입력 하나 이상)만 본다(2026-11-16 사용자 결정).
 * 금지 표현·동아리 유형·미지원 과목 등은 프롬프트로 제외를 지시하고, 최종 본문의 검토·출력 단계(reviewGate·finalGate)에서 막는다.
 */
export function generationGate(d: AppData, rec: RecordEntry): Gate {
  void d;
  const reasons: string[] = [];
  if (rec.mode !== 'normal') reasons.push('사유 입력·기재 제외 기록은 생성하지 않습니다.');
  if (!rec.freeNote.trim() && !rec.observations.length && !rec.eventObs.length) reasons.push('자율 작성 관찰을 적거나 관찰 항목·참여한 행사를 하나 이상 선택하세요.');
  return { ok: reasons.length === 0, reasons };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newRecord(id: string, studentId: string, workId: string, area: Area, semester: 1 | 2): RecordEntry {
  return {
    id,
    studentId,
    workId,
    area,
    semester,
    mode: 'normal',
    observations: [],
    eventObs: [],
    freeNote: '',
    context: '',
    candidates: [],
    compositions: [],
    itemOrder: [],
    draft: '',
    draftSourceHash: '',
    target: null,
    polish: null,
    finalText: '',
    semesterLabel: false,
    review: null,
    updatedAt: nowIso(),
  };
}

/** 항목별 조합 문장을 itemOrder 순서로 공백 하나로 잇는다. */
export function assembleDraft(rec: RecordEntry, separator = ' '): string {
  const order = rec.itemOrder.length ? rec.itemOrder : rec.compositions.map((c) => c.itemId);
  return order
    .map((id) => rec.compositions.find((c) => c.itemId === id)?.text.trim() ?? '')
    .filter(Boolean)
    .join(separator);
}

export function compositionHash(rec: RecordEntry): string {
  return sha(rec.compositions.map((c) => [c.itemId, c.text])).slice(0, 16);
}

/** 영역 초안이 항목 조합보다 오래되었는지 */
export function draftStale(rec: RecordEntry): boolean {
  return !!rec.draft && rec.draftSourceHash !== compositionHash(rec);
}
