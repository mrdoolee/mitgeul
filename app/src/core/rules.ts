import type { Area, ClubType, SchoolLevel } from './schema';

/**
 * 앱 규칙 버전. 공식 2026 기재요령(중·고) 조항을 바탕으로 독자적으로 작성한 검사 규칙이다.
 * 탐지는 보조 수단이며 공식 적합성 판정이 아니다. 문맥·예외 판단이 필요한 표현은 경고로만 둔다.
 */
export const RULES_VERSION = '2026-rules-v1';

export const AREA_LIMIT: Record<Area, number> = {
  autonomy: 1500,
  club: 1500,
  career: 1500,
  subject: 1500,
  behavior: 900,
};

export function areaLabel(area: Area, grade: number): string {
  switch (area) {
    case 'autonomy':
      return grade === 3 ? '자율활동' : '자율·자치활동';
    case 'club':
      return '동아리활동';
    case 'career':
      return '진로활동';
    case 'subject':
      return '과목별 세부능력 및 특기사항';
    case 'behavior':
      return '행동특성 및 종합의견';
  }
}

export const AREA_SHORT: Record<Area, string> = {
  autonomy: '자율·자치',
  club: '동아리',
  career: '진로',
  subject: '과목세특',
  behavior: '행특',
};

export const CLUB_TYPE_LABEL: Record<ClubType, string> = {
  regular: '정규교육과정 동아리',
  sportsRegular: '정규교육과정 내 학교스포츠클럽',
  autonomous: '자율동아리',
  youth: '청소년단체',
  sportsAfterSchool: '정규교육과정 밖 학교스포츠클럽',
};

/** 특기사항 문장을 만들 수 있는 동아리 유형. 근거: 중 316·318·2250행, 고 2368행. */
export function clubAllowsNarrative(t: ClubType): boolean {
  return t === 'regular' || t === 'sportsRegular';
}

export function clubTypeNote(t: ClubType, level: SchoolLevel): string {
  switch (t) {
    case 'regular':
    case 'sportsRegular':
      return '특기사항 작성 대상';
    case 'autonomous':
      return level === 'high'
        ? '자율동아리는 동아리명(필요 시 소개 30자 이내)만 입력하며 특기사항을 작성하지 않습니다(고 2368행). 이 앱은 소개 입력을 지원하지 않습니다.'
        : '자율동아리는 동아리명만 입력하며 특기사항을 작성하지 않습니다(중 2250행 입력 예시).';
    case 'youth':
      return level === 'high'
        ? '고등학교 청소년단체는 단체명과 특기사항을 모두 입력하지 않습니다(고 370행, 중 318행).'
        : '중학교 청소년단체는 단체명만 입력하고 특기사항을 입력하지 않습니다(중 318행).';
    case 'sportsAfterSchool':
      return '정규교육과정 밖 학교스포츠클럽은 특기사항을 입력하지 않습니다(중 316행).';
  }
}

/** 고등학교 연구보고서(소논문) 예외 허용 과목. 고1·2(2022): 고 3475행, 고3(2015): 고 4524~4526행. */
const RESEARCH_2022 = ['수학과제 탐구', '사회문제 탐구', '융합과학 탐구', '과학과제 연구', '사회과제 연구', '윤리문제 탐구'];
const RESEARCH_2015 = ['수학과제 탐구', '사회문제 탐구', '융합과학 탐구', '과학과제 연구', '사회과제 연구'];
export function researchReportAllowed(level: SchoolLevel, curriculum: '2015' | '2022', subjectName: string | undefined): boolean {
  if (level !== 'high' || !subjectName) return false;
  const norm = subjectName.replace(/\s+/g, '');
  const list = curriculum === '2022' ? RESEARCH_2022 : RESEARCH_2015;
  return list.some((s) => s.replace(/\s+/g, '') === norm);
}

export type Severity = 'block' | 'warn';
export interface Finding {
  ruleId: string;
  severity: Severity;
  category: string;
  message: string;
  source: string;
  match: string;
  index: number;
}

export interface CheckContext {
  level: SchoolLevel;
  area: Area;
  curriculum: '2015' | '2022';
  subjectName?: string;
  /** 교사가 설정에서 입력한 기재 금지 문구 */
  customBans?: string[];
  /** 로컬 명단의 학생 성명 전체. 본문에 들어가면 차단. */
  rosterFullNames: string[];
  /** 성을 뺀 이름·별칭. 일반 단어와 겹칠 수 있어 경고. */
  rosterPartialNames: string[];
}

interface Rule {
  id: string;
  levels: SchoolLevel[];
  areas: Area[] | 'all';
  severity: Severity | ((ctx: CheckContext) => Severity | null);
  category: string;
  pattern: RegExp;
  message: string | ((ctx: CheckContext) => string);
  source: string;
}

const ALL: SchoolLevel[] = ['middle', 'high'];

const RULES: Rule[] = [
  {
    id: 'lang-test',
    levels: ALL,
    areas: 'all',
    severity: 'block',
    category: '공인어학시험',
    pattern: /TOEIC|토익|TOEFL|토플|TEPS|텝스|HSK|JLPT|JPT|DELF|DALF|TESTDAF|TestDaF|TORFL|DELE|한자능력검정|상공회의소\s*한자|실용한자|한자급수|상무한검|한자자격검정|어학\s*성적/g,
    message: '공인어학시험 참여 사실·성적·수상은 어떤 항목에도 기재할 수 없습니다.',
    source: '중 466행, 고 538행',
  },
  {
    id: 'contest',
    levels: ALL,
    areas: 'all',
    severity: 'warn',
    category: '대회',
    pattern: /대회|경시|경연|올림피아드|공모전/g,
    message: '교내·외 대회 참여 사실·성적·수상 실적은 기재할 수 없습니다. 대회를 단순 행사로 바꿔 쓰는 것도 불가합니다. 정규 교육활동인지 확인하세요.',
    source: '중 472·3012행, 고 544행',
  },
  {
    id: 'award',
    levels: ALL,
    areas: 'all',
    severity: 'warn',
    category: '수상',
    pattern: /수상|입상|금상|은상|동상|장려상|최우수상|우수상|표창|감사장|공로상/g,
    message: '수상 실적·교외상은 특기사항에 기재할 수 없습니다(교내 수상은 수상경력 항목에만).',
    source: '중 472·476행, 고 544·548행',
  },
  {
    id: 'cert-test',
    levels: ALL,
    areas: 'all',
    severity: 'warn',
    category: '인증시험',
    pattern: /인증\s*시험|검정\s*시험|급수\s*시험/g,
    message: '교내·외 인증시험 참여 사실이나 성적은 기재할 수 없습니다.',
    source: '중 477행, 고 549행',
  },
  {
    id: 'mock-exam',
    levels: ['high'],
    areas: 'all',
    severity: 'block',
    category: '모의고사 성적',
    pattern: /모의고사|모의\s*평가|전국연합학력평가|학력평가/g,
    message: '모의고사·전국연합학력평가 성적과 관련 수상은 기재할 수 없습니다.',
    source: '고 550행',
  },
  {
    id: 'paper',
    levels: ALL,
    areas: 'all',
    severity: 'warn',
    category: '논문',
    pattern: /학회|학술지|투고|등재|논문\s*발표/g,
    message: '논문을 학회지 등에 투고·등재하거나 학회에서 발표한 사실은 기재할 수 없습니다.',
    source: '중 479행, 고 551행',
  },
  {
    id: 'publish',
    levels: ALL,
    areas: 'all',
    severity: 'warn',
    category: '도서출간',
    pattern: /출간|출판|저서/g,
    message: '도서출간 사실은 기재할 수 없습니다.',
    source: '중 480행, 고 552행',
  },
  {
    id: 'ip-filed',
    levels: ALL,
    areas: 'all',
    severity: 'block',
    category: '지식재산권',
    pattern: /(특허|실용신안|상표|디자인|지식재산권)[^.\n]{0,12}(출원|등록)/g,
    message: '지식재산권 출원·등록 사실은 기재할 수 없습니다.',
    source: '중 481행, 고 553행',
  },
  {
    id: 'ip-word',
    levels: ALL,
    areas: 'all',
    severity: 'warn',
    category: '지식재산권',
    pattern: /특허|실용신안|지식재산권/g,
    message: '지식재산권 관련 표현입니다. 출원·등록 사실이 아닌 학습 내용인지 확인하세요.',
    source: '중 481행, 고 553행',
  },
  {
    id: 'overseas',
    levels: ALL,
    areas: 'all',
    severity: 'warn',
    category: '해외 활동',
    pattern: /해외|어학연수|국외\s*(활동|봉사|연수)|유학/g,
    message: '어학연수·봉사활동 등 해외 활동실적과 관련 내용은 기재할 수 없습니다.',
    source: '중 482행, 고 554행',
  },
  {
    id: 'family-status',
    levels: ALL,
    areas: 'all',
    severity: 'warn',
    category: '부모 지위',
    pattern: /(아버지|어머니|부모님?|아빠|엄마|삼촌|이모|고모|외삼촌|할아버지|할머니|친척)[^.\n]{0,15}(직업|직장|회사|근무|운영|의사|교수|변호사|공무원|사장|대표|원장|직위)/g,
    message: '부모(친인척 포함)의 사회·경제적 지위를 암시하는 내용은 기재할 수 없습니다.',
    source: '중 483행, 고 555행',
  },
  {
    id: 'scholarship',
    levels: ALL,
    areas: 'all',
    severity: 'block',
    category: '장학금',
    pattern: /장학금|장학생/g,
    message: '장학생·장학금 관련 내용은 기재할 수 없습니다.',
    source: '중 484행, 고 556행',
  },
  {
    id: 'institution',
    levels: ALL,
    areas: 'all',
    severity: 'warn',
    category: '대학·기관·상호·강사명',
    pattern: /[가-힣A-Za-z]{1,12}대학교|KAIST|카이스트|POSTECH|포스텍|㈜|\(주\)|주식회사|[가-힣]{1,10}(재단|연구소|연구원|협회)/g,
    message: '구체적인 대학명·기관명·상호명·강사명은 기재할 수 없습니다. 교육관련기관 등 예외에 해당하는지 원문을 확인하세요.',
    source: '중 495행, 고 571행',
  },
  {
    id: 'certificate',
    levels: ALL,
    areas: 'all',
    severity: 'block',
    category: '자격증',
    pattern: /자격증|자격\s*(을\s*)?취득/g,
    message: '자격증 명칭 및 취득 사실은 기재할 수 없습니다(고등학교는 별도 항목에만).',
    source: '중 497행, 고 575행',
  },
  {
    id: 'mooc',
    levels: ALL,
    areas: ['subject'],
    severity: 'block',
    category: 'MOOC',
    pattern: /K-?MOOC|MOOC|KOCW/gi,
    message: '과목세특에는 K-MOOC·MOOC·KOCW 관련 사항을 입력할 수 없습니다.',
    source: '중 3012행, 고 3475·4518행',
  },
  {
    id: 'after-school',
    levels: ALL,
    areas: 'all',
    severity: (ctx) => (ctx.area === 'subject' || ctx.area === 'behavior' ? 'block' : 'warn'),
    category: '방과후학교',
    pattern: /방과\s*후\s*학교|방과후/g,
    message: '방과후학교 활동은 과목세특·행특에 입력할 수 없고, 다른 항목에 입력할 수 없는 내용을 행특으로 옮길 수 없습니다.',
    source: '중 3012·3323행, 고 3475·4520·4909행',
  },
  {
    id: 'research-report',
    levels: ALL,
    areas: 'all',
    severity: (ctx) => {
      if (ctx.area !== 'subject') return 'warn';
      if (ctx.level === 'middle') return 'block';
      return researchReportAllowed(ctx.level, ctx.curriculum, ctx.subjectName) ? 'warn' : 'block';
    },
    category: '연구보고서(소논문)',
    pattern: /소논문|연구\s*보고서/g,
    message: (ctx) =>
      ctx.area === 'subject' && researchReportAllowed(ctx.level, ctx.curriculum, ctx.subjectName)
        ? '허용 과목의 성취기준에 따른 수업 중 활동만 가능합니다. 실적의 제목·연구 주제·참여인원·소요시간은 제외하세요.'
        : '연구보고서(소논문) 작성 관련 사항은 이 영역·과목에 입력할 수 없습니다.',
    source: '중 3012행, 고 3475·4522~4526행',
  },
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 영문·숫자 금지어는 대소문자 구분 없이 단어 경계로(UN이 UNIT에 걸리지 않게), 한글은 부분 일치로 찾는다. */
export function banPattern(term: string): RegExp {
  const e = escapeRe(term);
  return /^[A-Za-z0-9 .&-]+$/.test(term) ? new RegExp(`(?<![A-Za-z0-9])${e}(?![A-Za-z0-9])`, 'gi') : new RegExp(e, 'g');
}

export function checkText(text: string, ctx: CheckContext): Finding[] {
  const out: Finding[] = [];
  for (const r of RULES) {
    if (!r.levels.includes(ctx.level)) continue;
    if (r.areas !== 'all' && !r.areas.includes(ctx.area)) continue;
    const severity = typeof r.severity === 'function' ? r.severity(ctx) : r.severity;
    if (!severity) continue;
    const message = typeof r.message === 'function' ? r.message(ctx) : r.message;
    for (const m of text.matchAll(new RegExp(r.pattern.source, r.pattern.flags.includes('g') ? r.pattern.flags : r.pattern.flags + 'g'))) {
      out.push({ ruleId: r.id, severity, category: r.category, message, source: r.source, match: m[0], index: m.index ?? 0 });
    }
  }
  // 고등학교 학교 식별정보(고 575행)는 학교명 입력란 없이 AI 지시와 교사 지정 기재 금지 문구로 다룬다(2026-11-18 사용자 결정).
  for (const term of [...new Set((ctx.customBans ?? []).map((t) => t.trim()).filter(Boolean))]) {
    for (const m of text.matchAll(banPattern(term))) {
      out.push({ ruleId: 'custom-ban', severity: 'block', category: '교사 지정 기재 금지', message: '설정의 기재 금지 문구입니다. 다른 표현으로 바꾸거나 빼세요.', source: '교사 설정', match: m[0], index: m.index ?? 0 });
    }
  }
  const pushNames = (list: string[], severity: Severity, message: string) => {
    for (const name of [...new Set(list.map((n) => n.trim()).filter((n) => n.length >= 2))]) {
      for (const m of text.matchAll(new RegExp(escapeRe(name), 'g'))) {
        out.push({ ruleId: 'student-name', severity, category: '학생 이름', message, source: '앱 개인정보 원칙', match: m[0], index: m.index ?? 0 });
      }
    }
  };
  pushNames(ctx.rosterFullNames, 'block', '본문에 명단의 학생 성명이 들어 있습니다. 기록 문장에는 이름을 쓰지 않습니다.');
  pushNames(ctx.rosterPartialNames, 'warn', '명단 학생의 이름·별칭과 같은 표현이 있습니다. 이름이 아닌 일반 단어인지 확인하세요.');
  return out.sort((a, b) => a.index - b.index);
}

/**
 * 부정적 서술 경고(2026-11-17 사용자 결정). 기재요령 제16조①(중 3304행, 고 4896행)의 "학생의 성장을 지원하는 교육적 관점"에 따라
 * AI 결과·최종 본문에 남은 부정적 평가어를 알린다. 교사의 관찰 입력에는 쓰지 않는다(입력은 사실 기록이라 부정 표현이 있을 수 있음).
 * 문맥상 괜찮은 경우("부족한 부분을 보완함")도 있어 차단하지 않고 경고만 한다.
 */
export const NEGATIVE_TONE = /부족(?:함|하다|한 편|하여|해서|하고)|미흡|산만|불성실|소극적|무관심|무책임|태만|게으[르름]|게을리|서툶|서툴|서투르|못함|하지 못하|참여하지 않|제출하지 않|떨어짐|떨어지는 편|낮음|낮은 편|문제 행동|반항|공격적|이기적|불량|엎드|누워 있|딴짓|떠들|장난을 치|집중하지 못|화를 내|화를 냄|(?:공|물건|물병|책|의자|필통)을 (?:던지|던짐|던져)|늦게 제출|제출이 늦|늦은 경우|포기하(?!지 않)|포기함|쉽게 포기|말하지 않|지각/g;

export function toneFindings(text: string): Finding[] {
  return [...text.matchAll(NEGATIVE_TONE)].map((m) => ({
    ruleId: 'negative-tone',
    severity: 'warn' as const,
    category: '부정적 서술',
    message: '학생의 성장을 지원하는 교육적 관점에서 쓰세요. 부정적인 내용은 개선의 방향이나 긍정어로 바꿔 쓰세요.',
    source: '기재요령 제16조① · 중 3304행, 고 4896행',
    match: m[0],
    index: m.index ?? 0,
  }));
}

export function hasBlocking(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === 'block');
}
