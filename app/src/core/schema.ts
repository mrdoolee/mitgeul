import { BAN_PRESET_TERMS } from './banPresets';
import { z } from 'zod';

export const AREAS = ['autonomy', 'club', 'career', 'subject', 'behavior'] as const;
export type Area = (typeof AREAS)[number];
export const SCHOOL_LEVELS = ['middle', 'high'] as const;
export type SchoolLevel = (typeof SCHOOL_LEVELS)[number];
export const PROVIDERS = ['gemini', 'openai', 'anthropic'] as const;
export type Provider = (typeof PROVIDERS)[number];
/** 구독 CLI(Claude Code·Codex) 추론 강도. 빈 값은 CLI 기본값(옵션을 넘기지 않음). Gemini는 쓰지 않는다. */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];
export const EffortSettingSchema = z.enum(['', ...EFFORTS]);
export type EffortSetting = z.infer<typeof EffortSettingSchema>;
export const TARGETS = [150, 300, 500] as const;
export type Target = (typeof TARGETS)[number];
/** 이전 형식의 목표 125·250자를 150·300자로 옮긴다(2026-11-18 사용자 결정). 500자는 그대로다. */
const LEGACY_TARGET: Record<number, Target> = { 125: 150, 250: 300 };
export const TargetSchema = z.preprocess((v) => (typeof v === 'number' && LEGACY_TARGET[v] ? LEGACY_TARGET[v] : v), z.union([z.literal(150), z.literal(300), z.literal(500)]));

const id = z.string().min(1).max(64);
const shortText = z.string().max(200);
const longText = z.string().max(20000);
const grade = z.number().int().min(1).max(3);
const semester = z.union([z.literal(1), z.literal(2)]);
const curriculum = z.enum(['2015', '2022']);

export const StudentSchema = z.object({
  id,
  name: z.string().min(1).max(40),
  schoolLevel: z.enum(SCHOOL_LEVELS),
  schoolYear: z.number().int(),
  grade,
  classNo: z.number().int().min(0).max(99),
  number: z.number().int().min(0).max(999),
  aliases: z.array(z.string().min(1).max(40)).max(10),
  curriculum,
});
export type Student = z.infer<typeof StudentSchema>;

export const ClassRosterSchema = z.object({
  id,
  schoolLevel: z.enum(SCHOOL_LEVELS),
  schoolYear: z.number().int(),
  grade,
  classNo: z.number().int().min(0).max(99),
  studentIds: z.array(id),
});
export type ClassRoster = z.infer<typeof ClassRosterSchema>;

/**
 * general: 고1·2(2022) 학기 단위 과목 / 중학교 과목
 * common: 고1·2 공통과목 1·2 (합산 그룹)
 * yearlong: 고3(2015) 학년제 과목 — 1·2학기 합산
 * majorPractice: 전공실무 — 학기별 한도(미지원 경로와 함께 생성 차단, 상태만 표시)
 * unsupported: 별도 작성 경로가 필요한 과목(학교 밖 교육, 미이수·온라인 콘텐츠 등)
 */
export const SUBJECT_KINDS = ['general', 'common', 'yearlong', 'majorPractice', 'unsupported'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];
export const COMMON_GROUPS = ['공통국어', '공통수학', '공통영어', '통합사회', '통합과학', '한국사', '과학탐구실험'] as const;

export const SubjectSchema = z.object({
  id,
  name: z.string().min(1).max(60),
  schoolLevel: z.enum(SCHOOL_LEVELS),
  curriculum,
  kind: z.enum(SUBJECT_KINDS),
  commonGroup: z.enum(COMMON_GROUPS).nullable(),
  commonPart: z.union([z.literal(1), z.literal(2)]).nullable(),
});
export type Subject = z.infer<typeof SubjectSchema>;

export const CourseGroupSchema = z.object({
  id,
  subjectId: id,
  schoolYear: z.number().int(),
  grade,
  semester,
  termType: z.enum(['regular', 'free']),
  name: z.string().min(1).max(60),
  studentIds: z.array(id),
});
export type CourseGroup = z.infer<typeof CourseGroupSchema>;

export const CLUB_TYPES = ['regular', 'sportsRegular', 'autonomous', 'youth', 'sportsAfterSchool'] as const;
export type ClubType = (typeof CLUB_TYPES)[number];
export const ClubSchema = z.object({
  id,
  schoolLevel: z.enum(SCHOOL_LEVELS),
  schoolYear: z.number().int(),
  name: z.string().min(1).max(60),
  clubType: z.enum(CLUB_TYPES),
  studentIds: z.array(id),
});
export type Club = z.infer<typeof ClubSchema>;

export const WorkSchema = z.object({
  id,
  kind: z.enum(['homeroom', 'subject', 'club']),
  refId: id,
  excludedStudentIds: z.array(id),
  /** 학기 구분 없이 연간 한 번만 쓰는 영역(예: 행특). 1학기 칸에 쓰고 2학기는 작성·출력 대상에서 뺀다. */
  annualAreas: z.array(z.enum(AREAS)).optional(),
  /** 초안 작성 초기 설정에서 정한 입력 학기(담임·동아리). 교과는 수강집단 학기를 쓰고, 없으면 1학기. */
  activeSemester: semester.optional(),
});
export type Work = z.infer<typeof WorkSchema>;

/** 행사·활동이 있는 영역(담임 작업). 근거: 창체 특기사항은 활동 내용을 종합해 개별 특성이 드러나게, 횟수·시간은 정량 기재 가능(중 2203~2206행, 고 2329~2333행). */
export const EVENT_AREAS = ['autonomy', 'career', 'behavior'] as const;
export type EventArea = (typeof EVENT_AREAS)[number];

/** 작업·영역·학기별 행사 정의(학급 공통). 학생별 참여는 기록의 eventObs로 고른다. */
export const EventDefSchema = z.object({
  id,
  workId: id,
  area: z.enum(EVENT_AREAS),
  semester,
  name: z.string().min(1).max(60),
  /** 날짜·기간(선택). 예: 2026.03.12. 또는 2026.03.04.-2026.07.08. */
  period: z.string().max(40),
  /** 횟수·시간(선택). 예: 5회, 4시간 */
  quantity: z.string().max(20),
  /** 교사가 확인한 행사 내용(선택) */
  description: z.string().max(1000),
});
export type EventDef = z.infer<typeof EventDefSchema>;

/** 학생별 행사 참여 선택과 학생 사례(선택). 선택은 교사가 참여를 확인했다는 뜻이다. */
export const EventObsSchema = z.object({ eventId: id, note: longText });
export type EventObs = z.infer<typeof EventObsSchema>;

/** 자율 작성 관찰의 후보 항목 ID */
export const FREE_ITEM_ID = 'free';

export const ObservationSchema = z.object({
  itemId: id,
  score: z.number().int().min(1).max(5),
  example: longText,
});
export type Observation = z.infer<typeof ObservationSchema>;

export const CandidateSetSchema = z.object({
  itemId: id,
  texts: z.array(longText),
  evidenceHash: z.string(),
  provider: z.enum(PROVIDERS),
  model: shortText,
  createdAt: z.string(),
});
export type CandidateSet = z.infer<typeof CandidateSetSchema>;

export const FragmentSchema = z.object({
  id,
  text: longText,
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('candidate'), itemId: id, index: z.number().int().min(0).max(9), evidenceHash: z.string(), partial: z.boolean() }),
    z.object({ kind: z.literal('manual') }),
  ]),
});
export type Fragment = z.infer<typeof FragmentSchema>;

export const CompositionSchema = z.object({
  itemId: id,
  fragments: z.array(FragmentSchema),
  text: longText,
});
export type Composition = z.infer<typeof CompositionSchema>;

export const PolishSchema = z.object({
  sourceText: longText,
  resultText: longText,
  suggestions: z.array(longText),
  target: TargetSchema,
  provider: z.enum(PROVIDERS),
  model: shortText,
  createdAt: z.string(),
  /** 윤문에 보낸 글: 영역 초안(draft) 또는 최종 본문·검토 단계의 최종 본문(final). 이전 형식은 초안으로 읽는다. */
  basis: z.enum(['draft', 'final']).default('draft'),
});
export type Polish = z.infer<typeof PolishSchema>;
export type PolishSource = Polish['basis'];

export const ReviewSchema = z.object({ hash: z.string(), rulesVersion: z.string(), reviewedAt: z.string() });
export type Review = z.infer<typeof ReviewSchema>;

export const RecordSchema = z.object({
  id,
  studentId: id,
  workId: id,
  area: z.enum(AREAS),
  semester,
  mode: z.enum(['normal', 'reason', 'excluded']),
  observations: z.array(ObservationSchema),
  eventObs: z.array(EventObsSchema).default([]),
  /** 루브릭·행사에 해당하지 않는 교사 자율 작성 관찰(후보 생성 항목 ID 'free') */
  freeNote: longText.default(''),
  context: longText,
  candidates: z.array(CandidateSetSchema),
  compositions: z.array(CompositionSchema),
  itemOrder: z.array(id),
  draft: longText,
  draftSourceHash: z.string(),
  target: TargetSchema.nullable(),
  polish: PolishSchema.nullable(),
  finalText: longText,
  /** 이전 형식에서 쓰던 행특 학기 구분 표기 켬 상태. 버튼을 없앴으므로(2026-11-18) 읽을 때 표기를 본문 앞에 옮기고 끈다. */
  semesterLabel: z.boolean(),
  review: ReviewSchema.nullable(),
  updatedAt: z.string(),
}).transform((r) => {
  if (!r.semesterLabel) return r;
  const body = r.finalText.trim();
  // 이전 출력 본문과 같은 문자열을 만들어 검토 해시가 그대로 유지되게 한다.
  return { ...r, finalText: r.area === 'behavior' && body ? `(${r.semester}학기) ${body}` : r.finalText, semesterLabel: false };
});
export type RecordEntry = z.infer<typeof RecordSchema>;

/** 앱 밖 기록(이전 학년 공통과목 등)의 사용 Byte. null은 '확인 불가'. 0은 교사가 명시적으로 '없음/작성 전'을 확인한 값. */
export const PriorBytesSchema = z.object({
  id,
  studentId: id,
  key: z.string().max(200),
  bytes: z.number().int().min(0).max(100000).nullable(),
  note: shortText,
});
export type PriorBytes = z.infer<typeof PriorBytesSchema>;

export const SettingsSchema = z.object({
  setupDone: z.boolean(),
  schoolLevel: z.enum(SCHOOL_LEVELS),
  schoolYear: z.number().int().min(2026).max(2026),
  defaultGrade: grade,
  schoolName: z.string().max(60),
  schoolAliases: z.array(z.string().min(1).max(60)).max(20),
  provider: z.enum(PROVIDERS),
  models: z.object({ gemini: shortText, openai: shortText, anthropic: shortText }),
  /** CLI 제공자별 추론 강도. 이전 형식(필드 없음)은 CLI 기본값으로 읽는다. */
  efforts: z.object({ openai: EffortSettingSchema, anthropic: EffortSettingSchema }).default(() => ({ openai: '' as const, anthropic: '' as const })),
  /** 교사가 직접 입력한 기재 금지 문구(예: UN, UNESCO). 프롬프트에 넘기고 입력·본문에서 실시간 검사한다. */
  bannedTerms: z.array(z.string().min(1).max(60)).max(200).default(() => [...BAN_PRESET_TERMS]),
  /** AI 전송 전 문안 확인 창. 기본 꺼짐(익명화·이름 잔존 검사는 항상 수행). */
  confirmBeforeSend: z.boolean().default(false),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const AppDataSchema = z.object({
  schemaVersion: z.literal(1),
  settings: SettingsSchema,
  students: z.array(StudentSchema),
  classes: z.array(ClassRosterSchema),
  subjects: z.array(SubjectSchema),
  courseGroups: z.array(CourseGroupSchema),
  clubs: z.array(ClubSchema),
  works: z.array(WorkSchema),
  events: z.array(EventDefSchema).default([]),
  records: z.array(RecordSchema),
  priorBytes: z.array(PriorBytesSchema),
});
export type AppData = z.infer<typeof AppDataSchema>;

export function emptyAppData(): AppData {
  return {
    schemaVersion: 1,
    settings: {
      setupDone: false,
      schoolLevel: 'middle',
      schoolYear: 2026,
      defaultGrade: 1,
      schoolName: '',
      schoolAliases: [],
      provider: 'gemini',
      models: { gemini: '', openai: '', anthropic: '' },
      efforts: { openai: '', anthropic: '' },
      bannedTerms: [...BAN_PRESET_TERMS],
      confirmBeforeSend: false,
    },
    students: [],
    classes: [],
    subjects: [],
    courseGroups: [],
    clubs: [],
    works: [],
    events: [],
    records: [],
    priorBytes: [],
  };
}

/** 2026학년도 기본 적용 교육과정(고1·2 2022 개정, 고3 2015 개정; 중1·2 2022 개정, 중3 2015 개정). 복학·편입 등은 학생별로 바꾼다. */
export function defaultCurriculum(level: SchoolLevel, g: number): '2015' | '2022' {
  void level;
  return g <= 2 ? '2022' : '2015';
}

/** 참조 무결성 검사. 오류 목록이 비어 있어야 저장·복원한다. */
export function integrityErrors(d: AppData): string[] {
  const errs: string[] = [];
  const ids = (xs: { id: string }[], label: string) => {
    const s = new Set<string>();
    for (const x of xs) {
      if (s.has(x.id)) errs.push(`${label} ID 중복: ${x.id}`);
      s.add(x.id);
    }
    return s;
  };
  const students = ids(d.students, '학생');
  const classes = ids(d.classes, '학급');
  const subjects = ids(d.subjects, '과목');
  const groups = ids(d.courseGroups, '수강집단');
  const clubs = ids(d.clubs, '동아리');
  const works = ids(d.works, '작업');
  const events = ids(d.events, '행사');
  ids(d.records, '기록');
  d.events.forEach((e) => works.has(e.workId) || errs.push(`행사 ${e.id}: 없는 작업 ${e.workId}`));
  ids(d.priorBytes, '이전 Byte');
  const refStudents = (list: string[], where: string) => list.forEach((s) => students.has(s) || errs.push(`${where}: 없는 학생 ${s}`));
  d.classes.forEach((c) => refStudents(c.studentIds, `학급 ${c.id}`));
  d.courseGroups.forEach((g) => {
    refStudents(g.studentIds, `수강집단 ${g.id}`);
    if (!subjects.has(g.subjectId)) errs.push(`수강집단 ${g.id}: 없는 과목 ${g.subjectId}`);
  });
  d.clubs.forEach((c) => refStudents(c.studentIds, `동아리 ${c.id}`));
  d.works.forEach((w) => {
    const ok = w.kind === 'homeroom' ? classes.has(w.refId) : w.kind === 'subject' ? groups.has(w.refId) : clubs.has(w.refId);
    if (!ok) errs.push(`작업 ${w.id}: 없는 연결 대상 ${w.refId}`);
    refStudents(w.excludedStudentIds, `작업 ${w.id}`);
  });
  const tokenRe = /\[\[학생[A-Z]{1,2}\]\]/;
  d.records.forEach((r) => {
    if (!students.has(r.studentId)) errs.push(`기록 ${r.id}: 없는 학생 ${r.studentId}`);
    if (!works.has(r.workId)) errs.push(`기록 ${r.id}: 없는 작업 ${r.workId}`);
    r.eventObs.forEach((e) => events.has(e.eventId) || errs.push(`기록 ${r.id}: 없는 행사 ${e.eventId}`));
    const texts = [r.finalText, r.draft, ...r.candidates.flatMap((c) => c.texts), ...r.compositions.map((c) => c.text)];
    if (texts.some((t) => tokenRe.test(t))) errs.push(`기록 ${r.id}: 해소되지 않은 임시 익명 기호`);
  });
  d.priorBytes.forEach((p) => students.has(p.studentId) || errs.push(`이전 Byte ${p.id}: 없는 학생`));
  return errs;
}
