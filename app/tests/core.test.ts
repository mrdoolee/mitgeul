import { describe, expect, it } from 'vitest';
import { anonymizeFields, residualNames, resolveTokens } from '../src/core/anonymize';
import { charCount, measure, neisBytes } from '../src/core/bytes';
import { makeBackup, readBackup } from '../src/core/crypto';
import { planExport } from '../src/core/exportRows';
import { aggregationStatus, checkContext, evidenceItemIds, finalGate, generationGate, newRecord, recordState, reviewGate, reviewValid } from '../src/core/model';
import { parseCandidates, parsePolish } from '../src/core/responses';
import { parseRosterTable, previewRoster } from '../src/core/roster';
import { checkText, hasBlocking, type CheckContext } from '../src/core/rules';
import { AppDataSchema, integrityErrors } from '../src/core/schema';
import { addSubject, baseData, hangul, markReviewed, rec, student } from './fixtures';

const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({ level: 'middle', area: 'behavior', curriculum: '2022', rosterFullNames: [], rosterPartialNames: [], ...over });

describe('Byte 계산', () => {
  it('한글 3, 영문·숫자·공백 1, 엔터 1(CRLF 하나)', () => {
    expect(neisBytes('가나다')).toBe(9);
    expect(neisBytes('ABC 123')).toBe(7);
    expect(neisBytes('가\r\n나')).toBe(7);
    expect(neisBytes('가\n나')).toBe(7);
    expect(neisBytes('가\r나')).toBe(7);
  });
  it('500자=1500Byte, 300자=900Byte', () => {
    expect(neisBytes(hangul(500))).toBe(1500);
    expect(neisBytes(hangul(300))).toBe(900);
  });
  it('규정에 없는 문자는 보수적으로 세고 경고 목록에 넣는다', () => {
    const m = measure('자율·자치 😀');
    expect(m.uncertain.map((u) => u.char)).toEqual(['·', '😀']);
    expect(m.bytes).toBe(4 * 3 + 3 + 1 + 4);
  });
  it('목표 글자 수는 공백 포함, 줄바꿈 제외', () => {
    expect(charCount('가 나\n다')).toBe(4);
  });
});

describe('금지 규칙', () => {
  it('공인어학시험은 모든 학교급 차단', () => {
    expect(hasBlocking(checkText('TOEIC 900점을 받음.', ctx()))).toBe(true);
  });
  it('모의고사는 고등학교만 차단', () => {
    expect(hasBlocking(checkText('모의고사 성적이 오름.', ctx({ level: 'high' })))).toBe(true);
    expect(checkText('모의고사 성적이 오름.', ctx()).some((f) => f.ruleId === 'mock-exam')).toBe(false);
  });
  it('고등학교 학교명·축제명은 교사 지정 기재 금지 문구로 차단', () => {
    const f = checkText('한빛축제에서 사회를 봄.', ctx({ level: 'high', customBans: ['한빛축제'] }));
    expect(f.some((x) => x.ruleId === 'custom-ban' && x.severity === 'block')).toBe(true);
  });
  it('방과후학교는 세특·행특 차단, 창체 경고', () => {
    expect(hasBlocking(checkText('방과후학교 수업에 참여함.', ctx({ area: 'subject' })))).toBe(true);
    expect(hasBlocking(checkText('방과후학교 수업에 참여함.', ctx({ area: 'behavior' })))).toBe(true);
    const a = checkText('방과후학교 수업에 참여함.', ctx({ area: 'autonomy' }));
    expect(a.length).toBeGreaterThan(0);
    expect(hasBlocking(a)).toBe(false);
  });
  it('연구보고서: 중학교 세특 차단, 고1·2 윤리문제 탐구 경고, 고3 윤리문제 탐구 차단', () => {
    expect(hasBlocking(checkText('소논문을 작성함.', ctx({ area: 'subject' })))).toBe(true);
    expect(hasBlocking(checkText('연구 보고서를 작성함.', ctx({ level: 'high', area: 'subject', subjectName: '윤리문제 탐구', curriculum: '2022' })))).toBe(false);
    expect(hasBlocking(checkText('연구 보고서를 작성함.', ctx({ level: 'high', area: 'subject', subjectName: '윤리문제 탐구', curriculum: '2015' })))).toBe(true);
  });
  it('대회는 경고(문맥 확인), 장학금·자격증은 차단', () => {
    const f = checkText('학급 대회에서 협력함.', ctx());
    expect(f[0]?.severity).toBe('warn');
    expect(hasBlocking(checkText('장학생으로 선정됨.', ctx()))).toBe(true);
    expect(hasBlocking(checkText('자격증을 취득함.', ctx()))).toBe(true);
  });
  it('학생 성명은 차단, 이름만 겹치면 경고', () => {
    expect(hasBlocking(checkText('김민준과 협력함.', ctx({ rosterFullNames: ['김민준'], rosterPartialNames: ['민준'] })))).toBe(true);
    const f = checkText('하늘을 관찰함.', ctx({ rosterFullNames: ['박하늘'], rosterPartialNames: ['하늘'] }));
    expect(f.length).toBe(1);
    expect(hasBlocking(f)).toBe(false);
  });
});

describe('합산 단위', () => {
  it('공통수학1 900Byte + 공통수학2 700Byte는 합산 초과(다른 학년이어도)', () => {
    const d = baseData('high');
    addSubject(d, { id: 'cm1', name: '공통수학1', curriculum: '2022', kind: 'common', commonGroup: '공통수학', commonPart: 1 }, [{ id: 'g1', semester: 1, grade: 1, studentIds: ['s1'] }]);
    addSubject(d, { id: 'cm2', name: '공통수학2', curriculum: '2022', kind: 'common', commonGroup: '공통수학', commonPart: 2 }, [{ id: 'g2', semester: 2, grade: 2, studentIds: ['s1'] }]);
    const a = rec(d, 'r1', 's1', 'w-g1', 'subject', 1, hangul(300));
    rec(d, 'r2', 's1', 'w-g2', 'subject', 2, hangul(233) + 'A');
    const st = aggregationStatus(d, a);
    expect(st.total).toBe(900 + 700);
    expect(st.over).toBe(true);
    expect(reviewGate(d, a).ok).toBe(false);
  });
  it('공통과목 다른 쪽 기록이 없으면 확인 불가(0Byte로 보지 않음), 교사가 입력하면 해소', () => {
    const d = baseData('high');
    addSubject(d, { id: 'cm2', name: '공통수학2', curriculum: '2022', kind: 'common', commonGroup: '공통수학', commonPart: 2 }, [{ id: 'g2', semester: 1, studentIds: ['s1'] }]);
    const a = rec(d, 'r1', 's1', 'w-g2', 'subject', 1, hangul(100));
    expect(aggregationStatus(d, a).unknownPrior.length).toBe(1);
    expect(reviewGate(d, a).ok).toBe(false);
    d.priorBytes.push({ id: 'p1', studentId: 's1', key: 's1|common:공통수학|part:1', bytes: 1300, note: '1학년 기록' });
    const st = aggregationStatus(d, a);
    expect(st.unknownPrior.length).toBe(0);
    expect(st.total).toBe(1600);
    expect(st.over).toBe(true);
  });
  it('이름에 숫자가 있는 일반 선택과목은 공통과목으로 합치지 않음', () => {
    const d = baseData('high');
    addSubject(d, { id: 'x1', name: '대수1', curriculum: '2022', kind: 'general', commonGroup: null, commonPart: null }, [{ id: 'gx', semester: 1, studentIds: ['s1'] }]);
    const a = rec(d, 'r1', 's1', 'w-gx', 'subject', 1, hangul(100));
    expect(aggregationStatus(d, a).info.priorKeys.length).toBe(0);
  });
  it('고1·2 일반 과목은 학기별, 고3 학년제는 연간 합산', () => {
    const d = baseData('high');
    d.students.push(student('s9', '정다은', 3, 1, 1, 'high'));
    addSubject(d, { id: 'y1', name: '물리학Ⅱ', curriculum: '2015', kind: 'yearlong', commonGroup: null, commonPart: null }, [
      { id: 'y1a', semester: 1, grade: 3, studentIds: ['s9'] },
      { id: 'y1b', semester: 2, grade: 3, studentIds: ['s9'] },
    ]);
    const a = rec(d, 'ra', 's9', 'w-y1a', 'subject', 1, hangul(250));
    rec(d, 'rb', 's9', 'w-y1b', 'subject', 2, hangul(250));
    const st = aggregationStatus(d, a);
    expect(st.total).toBe(1500 + 2 * 9 + 1); // 학년제 연간 합산 + 자동 표기 보수 가산
    expect(st.over).toBe(true);
    const d2 = baseData('high');
    addSubject(d2, { id: 'gen', name: '대수', curriculum: '2022', kind: 'general', commonGroup: null, commonPart: null }, [
      { id: 'ga', semester: 1, studentIds: ['s1'] },
      { id: 'gb', semester: 2, studentIds: ['s1'] },
    ]);
    const b = rec(d2, 'x1', 's1', 'w-ga', 'subject', 1, hangul(400));
    rec(d2, 'x2', 's1', 'w-gb', 'subject', 2, hangul(400));
    expect(aggregationStatus(d2, b).total).toBe(1200);
  });
  it('중학교 동일 과목은 학기 합산 + 자동 학기 표기 보수 가산', () => {
    const d = baseData('middle');
    addSubject(d, { id: 'kor', name: '국어', curriculum: '2022', kind: 'general', commonGroup: null, commonPart: null }, [
      { id: 'k1', semester: 1, studentIds: ['s1'] },
      { id: 'k2', semester: 2, studentIds: ['s1'] },
    ]);
    const a = rec(d, 'r1', 's1', 'w-k1', 'subject', 1, hangul(240));
    rec(d, 'r2', 's1', 'w-k2', 'subject', 2, hangul(240));
    const st = aggregationStatus(d, a);
    expect(st.total).toBe(1440 + 2 * 9 + 1);
    expect(st.over).toBe(false);
  });
  it('작업을 나눠도 창체 영역 한도는 학년 단위로 하나', () => {
    const d = baseData('middle');
    d.clubs.push({ id: 'cl1', schoolLevel: 'middle', schoolYear: 2026, name: '과학반', clubType: 'regular', studentIds: ['s1'] }, { id: 'cl2', schoolLevel: 'middle', schoolYear: 2026, name: '독서반', clubType: 'regular', studentIds: ['s1'] });
    d.works.push({ id: 'wc1', kind: 'club', refId: 'cl1', excludedStudentIds: [] }, { id: 'wc2', kind: 'club', refId: 'cl2', excludedStudentIds: [] });
    const a = rec(d, 'r1', 's1', 'wc1', 'club', 1, hangul(300));
    rec(d, 'r2', 's1', 'wc2', 'club', 1, hangul(250));
    expect(aggregationStatus(d, a).over).toBe(true);
  });
});

describe('검토 유효성', () => {
  it('본문·같은 합산 단위 다른 본문·이전 Byte 변경 시 검토가 무효가 된다', () => {
    const d = baseData('high');
    addSubject(d, { id: 'cm1', name: '공통수학1', curriculum: '2022', kind: 'common', commonGroup: '공통수학', commonPart: 1 }, [{ id: 'g1', semester: 1, studentIds: ['s1'] }]);
    const a = rec(d, 'r1', 's1', 'w-g1', 'subject', 1, '수식의 규칙을 찾아 설명함.');
    d.priorBytes.push({ id: 'p', studentId: 's1', key: 's1|common:공통수학|part:2', bytes: 0, note: '아직 작성 전' });
    expect(reviewGate(d, a).ok).toBe(true);
    markReviewed(d, a);
    expect(reviewValid(d, a)).toBe(true);
    expect(finalGate(d, a).ok).toBe(true);
    d.priorBytes[0]!.bytes = 30;
    expect(reviewValid(d, a)).toBe(false);
    d.priorBytes[0]!.bytes = 0;
    expect(reviewValid(d, a)).toBe(true);
    a.finalText += ' ';
    a.finalText = a.finalText.trim() + '추가함.';
    expect(reviewValid(d, a)).toBe(false);
  });
  it('이전 저장본의 행특 학기 표기(켬)는 읽을 때 본문 앞으로 옮기고 검토를 유지한다', () => {
    const d = baseData();
    const a = rec(d, 'r1', 's1', 'w-home', 'behavior', 1, '규칙을 지킴.');
    a.semesterLabel = true;
    // 이전 형식 출력 본문('(1학기) 규칙을 지킴.')으로 검토한 상태를 흉내 낸다
    a.finalText = '(1학기) 규칙을 지킴.';
    markReviewed(d, a);
    a.finalText = '규칙을 지킴.';
    const m = AppDataSchema.parse(JSON.parse(JSON.stringify(d)));
    const b = m.records[0]!;
    expect(b.semesterLabel).toBe(false);
    expect(b.finalText).toBe('(1학기) 규칙을 지킴.');
    expect(reviewValid(m, b)).toBe(true);
    expect(aggregationStatus(m, b).usedBytes).toBe(neisBytes('(1학기) 규칙을 지킴.'));
  });
  it('이전 목표 125·250자는 150·300자로 읽고 검토를 유지한다', () => {
    const d = baseData();
    const a = rec(d, 'r1', 's1', 'w-home', 'behavior', 1, '규칙을 지킴.');
    const raw = JSON.parse(JSON.stringify(d));
    raw.records[0].target = 250;
    raw.records[0].polish = { sourceText: '', resultText: '', suggestions: [], target: 125, provider: 'gemini', model: '', createdAt: '' };
    // 이전 형식 해시는 목표 250으로 만들어졌다
    a.target = 300;
    markReviewed(d, a);
    raw.records[0].review = a.review;
    const m = AppDataSchema.parse(raw);
    expect(m.records[0]!.target).toBe(300);
    expect(m.records[0]!.polish!.target).toBe(150);
    expect(reviewValid(m, m.records[0]!)).toBe(true);
  });
  it('검토 전 기록은 최종 출력 불가, 미작성 상태 집계', () => {
    const d = baseData();
    rec(d, 'r1', 's1', 'w-home', 'behavior', 1, '규칙을 지킴.');
    const p = planExport(d, 'w-home', 'behavior', [1]);
    expect(p.rows.length).toBe(0);
    expect(p.skipped.length).toBe(2);
    expect(p.summary.empty).toBe(1);
    expect(p.summary.drafting).toBe(1);
    expect(p.allStudentsRequired).toBe(true);
  });
  it('자율동아리: 후보 생성은 막지 않고(2026-11-16) 검토·출력에서 막는다', () => {
    const d = baseData();
    d.clubs.push({ id: 'cl', schoolLevel: 'middle', schoolYear: 2026, name: '로봇반', clubType: 'autonomous', studentIds: ['s1'] });
    d.works.push({ id: 'wc', kind: 'club', refId: 'cl', excludedStudentIds: [] });
    const a = rec(d, 'r1', 's1', 'wc', 'club', 1, '로봇을 조립함.');
    a.observations.push({ itemId: 'club-01', score: 3, example: '' });
    expect(generationGate(d, a).ok).toBe(true);
    expect(reviewGate(d, a).ok).toBe(false);
  });
  it('세특은 과목 맥락 없이도 후보를 만들 수 있다(2026-11-15 사용자 결정)', () => {
    const d = baseData();
    addSubject(d, { id: 'kor', name: '국어', curriculum: '2022', kind: 'general', commonGroup: null, commonPart: null }, [{ id: 'k1', semester: 1, studentIds: ['s1'] }]);
    const a = newRecord('r', 's1', 'w-k1', 'subject', 1);
    expect(generationGate(d, a).ok).toBe(false);
    a.observations.push({ itemId: 'subject-01', score: 4, example: '' });
    expect(generationGate(d, a).ok).toBe(true);
  });
  it('자율 작성 관찰만으로 후보를 만들 수 있고 생성 항목에 포함된다', () => {
    const d = baseData();
    const a = newRecord('r', 's1', 'w-home', 'behavior', 1);
    a.freeNote = '모둠 발표 자료를 다시 정리해 나눠 줌.';
    expect(generationGate(d, a).ok).toBe(true);
    expect(evidenceItemIds(a)[0]).toBe('free');
    expect(recordState(d, a)).toBe('drafting');
  });
  it('교사 지정 기재 금지 문구: 영문은 단어 단위·대소문자 무시, 입력은 생성 차단 안 함, 최종 본문은 차단', () => {
    const d = baseData();
    d.settings.bannedTerms = ['UN', '유네스코'];
    const ctx = checkContext(d, { studentId: 's1', workId: 'w-home', area: 'behavior' });
    expect(checkText('un 모의총회에 참여함.', ctx).some((f) => f.ruleId === 'custom-ban')).toBe(true);
    expect(checkText('UNIT 활동을 함.', ctx).some((f) => f.ruleId === 'custom-ban')).toBe(false);
    expect(checkText('유네스코 학교 활동', ctx).some((f) => f.ruleId === 'custom-ban')).toBe(true);
    const a = newRecord('r', 's1', 'w-home', 'behavior', 1);
    a.freeNote = 'UN 관련 토론에서 의견을 정리함.';
    expect(generationGate(d, a).ok).toBe(true);
    a.finalText = 'UN 관련 토론에서 의견을 정리함.';
    expect(hasBlocking(checkText(a.finalText, ctx))).toBe(true);
  });
  it('작업 제외는 기록을 지우지 않는다', () => {
    const d = baseData();
    rec(d, 'r1', 's1', 'w-home', 'behavior', 1, '규칙을 지킴.');
    d.works[0]!.excludedStudentIds.push('s1');
    expect(d.records.length).toBe(1);
    expect(planExport(d, 'w-home', 'behavior', [1]).skipped.some((s) => s.name.includes('김민준'))).toBe(false);
    expect(recordState(d, d.records[0])).toBe('drafting');
  });
});

describe('익명화', () => {
  const st = [student('s1', '김민준', 1, 3, 1), student('s2', '이서연', 1, 3, 2), { ...student('s3', '박하늘', 1, 4, 7), aliases: ['하늘쌤'] }];
  it('성명 전체만 치환하고 성 뺀 이름(일반 단어와 겹침)은 그대로 둔다(2026-11-16)', () => {
    const r = anonymizeFields(['김민준은 친구 활동을 지원함. 이서연과 토론함. 민준이가 발표함.'], st, 's1');
    expect(r.texts[0]).not.toMatch(/김민준|이서연/);
    expect(r.texts[0]).toContain('지원함');
    expect(r.texts[0]).toContain('민준이가');
    expect(r.map.get('[[학생A]]')).toBe('s1');
    expect(residualNames(r.texts[0]!, st)).toEqual([]);
  });
  it('동명이인이어도 요청을 막지 않고 작성 중인 학생으로 본다', () => {
    const dup = [...st, student('s4', '김민준', 1, 5, 1)];
    const r = anonymizeFields(['김민준이 발표함.'], dup, 's4');
    expect(r.texts[0]).toBe('[[학생A]]이 발표함.');
    expect(r.map.get('[[학생A]]')).toBe('s4');
  });
  it('응답 기호는 학생 참조로 바꾸고 모르는 기호는 거부', () => {
    const m = new Map([['[[학생A]]', 's1']]);
    expect(resolveTokens('[[학생A]]가 발표함.', m)).toEqual({ ok: true, text: '{{학생:s1}}가 발표함.' });
    expect(resolveTokens('[[학생B]]가 발표함.', m).ok).toBe(false);
  });
});

describe('응답 검증', () => {
  const five = ['가함.', '나함.', '다함.', '라함.', '3회 발표함.'];
  it('너그러운 후보 검증: 4개·목록 기호·코드 블록·모르는 기호도 받고, 누락만 실패', () => {
    const raw = JSON.stringify({ items: [{ itemId: 'a', candidates: [...five, '여섯째함.'] }, { itemId: 'b', candidates: ['- 가함.', '1. 나함.', '', '[[학생Q]]는 다함.', '**라**함.'] }, { itemId: 'zzz', candidates: five }] });
    const r = parseCandidates('설명:\n```json\n' + raw + '\n```', ['a', 'b', 'c'], new Map());
    expect(r.ok.get('a')).toEqual(five);
    expect(r.ok.get('b')).toEqual(['가함.', '나함.', '다함.', '라함.']);
    expect(r.failed.get('c')).toContain('없습니다');
  });
  it('형식 오류는 전체 실패', () => {
    expect(parseCandidates('설명문입니다', ['a'], new Map()).fatal).toBeTruthy();
  });
  it('윤문 응답 검증', () => {
    expect(parsePolish('{"text":"  다듬은 본문.  ","suggestions":["근거 부족"]}', new Map())).toEqual({ ok: true, text: '다듬은 본문.', suggestions: ['근거 부족'] });
    expect(parsePolish('{"text":""}', new Map()).ok).toBe(false);
    expect(parsePolish('{"text":"다듬은 본문."}', new Map())).toEqual({ ok: true, text: '다듬은 본문.', suggestions: [] });
  });
});

describe('백업 암호화', () => {
  const cost = { N: 2 ** 10, r: 8, p: 1 };
  it('왕복·잘못된 비밀번호·손상 거부', async () => {
    const b = await makeBackup('{"a":1}', 'correct horse', cost);
    expect(await readBackup(JSON.stringify(b), 'correct horse')).toBe('{"a":1}');
    await expect(readBackup(JSON.stringify(b), 'wrong password')).rejects.toThrow('비밀번호');
    const t = { ...b, payload: { ...b.payload, data: Buffer.from('tampered!').toString('base64') } };
    await expect(readBackup(JSON.stringify(t), 'correct horse')).rejects.toThrow();
    expect(JSON.stringify(b)).not.toContain('"a"');
  });
});

describe('명단 가져오기', () => {
  it('필수 열·중복 번호 검사, 추가·충돌 분류(자동 병합 없음)', () => {
    const t = [
      ['학년', '반', '번호', '이름'],
      [1, 3, 1, '김민준'],
      [1, 3, 2, '홍길동'],
      [1, 3, 2, '중복'],
      [1, 5, 9, '이서연'],
      [1, 3, 3, '새학생'],
    ];
    const p = parseRosterTable(t, {});
    expect(p.errors.some((e) => e.includes('중복'))).toBe(true);
    const pv = previewRoster(p.rows, baseData().students, 'middle', 2026);
    expect(pv.same.map((x) => x.row.name)).toEqual(['김민준']);
    expect(pv.conflicts.map((x) => x.row.name).sort()).toEqual(['이서연', '홍길동']);
    expect(pv.add.map((x) => x.name)).toEqual(['새학생']);
  });
  it('수강집단에서 다른 반 같은 번호는 중복 아님', () => {
    const p = parseRosterTable([['학년', '반', '번호', '이름'], [1, 1, 5, '가'], [1, 2, 5, '나']], {});
    expect(p.errors).toEqual([]);
  });
});

describe('무결성', () => {
  it('임시 기호가 남은 본문과 끊어진 참조를 거부', () => {
    const d = baseData();
    rec(d, 'r1', 's1', 'w-home', 'behavior', 1, '[[학생A]]가 발표함.');
    expect(integrityErrors(d).some((e) => e.includes('임시 익명 기호'))).toBe(true);
    d.records[0]!.finalText = '발표함.';
    d.records[0]!.studentId = 'ghost';
    expect(integrityErrors(d).some((e) => e.includes('없는 학생'))).toBe(true);
  });
});

describe('명령 목록', () => {
  it('preload 명령 목록이 actions와 일치', async () => {
    const { ACTION_NAMES } = await import('../src/core/actionNames');
    const { ACTION_NAMES: real } = await import('../src/core/actions');
    expect([...ACTION_NAMES].sort()).toEqual([...real].sort());
  });
});

import { candidateSystemPrompt, candidateUserPrompt, polishRange, polishSystemPrompt, polishUserPrompt } from '../src/core/prompts';
describe('프롬프트 v2', () => {
  it('윤문: 분량 범위·확장 배수를 숫자로 주고 "근거 부족이면 짧게"로 빠져나가지 않게 한다', () => {
    const u = polishUserPrompt({ level: 'middle', grade: 1, area: 'behavior', semester: 1, target: 500, remainingBytes: 1500, limitLabel: '행특', draft: '가'.repeat(110), evidence: ['규칙 준수: 4/5'] });
    expect(u).toContain('분량 범위: 공백 포함 450~500자');
    expect(u).toContain('약 4.5배로 늘려야 함');
    const s = polishSystemPrompt('middle', '', ['UNESCO']);
    expect(s).toContain('확장 방법');
    expect(s).not.toContain('억지로 늘리지 말고 짧게 두며');
    expect(s).toContain('"UNESCO"');
    expect(polishRange(500, 900)).toEqual({ min: 300, max: 300 });
  });
  it('후보: 자율 작성 항목과 금지 문구를 넘긴다', () => {
    const u = candidateUserPrompt({ level: 'high', grade: 2, area: 'career', semester: 1, context: '', items: [], free: { requestItemId: 'free', note: '진로 탐색 보고서를 고쳐 씀' } });
    expect(u).toContain('[자율 작성 관찰]');
    expect(u).toContain('각각 후보 5개를 답한다: free');
    expect(candidateSystemPrompt('high', ['UN'])).toContain('교사 지정 기재 금지 문구');
  });
});

describe('윤문 분량 늘리기 지시(2026-11-16)', () => {
  it('문장마다 현재 길이와 늘릴 길이를 적고 범위를 다시 알린다', async () => {
    const { expandInstruction } = await import('../src/core/prompts');
    const t = expandInstruction('규칙을 지킴. 친구를 도움.', { min: 450, max: 550 });
    expect(t).toContain('[분량 늘리기 요청]');
    expect(t).toContain('450~550자');
    expect(t).toMatch(/1\. \(지금 7자 → \d+자 이상\) 규칙을 지킴\./);
    expect(t).toMatch(/2\. \(지금 7자 → \d+자 이상\) 친구를 도움\./);
  });
  it('후보 지시는 교사 서술을 모든 후보에 담게 한다', async () => {
    const { candidateSystemPrompt } = await import('../src/core/prompts');
    expect(candidateSystemPrompt('middle')).toContain('5개 후보 모두 그 서술의 구체적 행동');
  });
});


describe('학기 구분 없음(연간)·기재 제외 일괄', () => {
  it('행특을 연간으로 바꾸면 1학기 칸만 작성·출력하고 2학기는 대상에서 빠진다', async () => {
    const { applyAction } = await import('../src/core/actions');
    const { semestersFor } = await import('../src/core/model');
    let d = baseData();
    d = applyAction(d, 'work.setAnnual', { workId: 'w-home', area: 'behavior', annual: true }).data;
    expect(semestersFor(d, 'w-home', 'behavior')).toEqual([1]);
    expect(semestersFor(d, 'w-home', 'career')).toEqual([1, 2]);
    expect(() => applyAction(d, 'record.ensure', { studentId: 's1', workId: 'w-home', area: 'behavior', semester: 2 })).toThrow(/연간/);
    const a = rec(d, 'r1', 's1', 'w-home', 'behavior', 1, '규칙을 지킴.');
    markReviewed(d, a);
    const b = rec(d, 'r2', 's2', 'w-home', 'behavior', 1, '친구를 도움.');
    markReviewed(d, b);
    const p = planExport(d, 'w-home', 'behavior', [1, 2]);
    expect(p.rows.length).toBe(2);
    expect(p.skipped.length).toBe(0);
    expect(p.meta.find((m) => m.label === '학기')!.value).toContain('연간');
  });
  it('초안 작성 초기 설정의 입력 학기: 담임·동아리는 설정 값, 연간은 1학기, 교과는 수강집단 학기', async () => {
    const { applyAction } = await import('../src/core/actions');
    const { inputSemester } = await import('../src/core/model');
    let d = baseData();
    expect(inputSemester(d, 'w-home', 'career')).toBe(1);
    d = applyAction(d, 'work.setSemester', { workId: 'w-home', semester: 2 }).data;
    expect(d.works.find((w) => w.id === 'w-home')!.activeSemester).toBe(2);
    expect(inputSemester(d, 'w-home', 'career')).toBe(2);
    d = applyAction(d, 'work.setAnnual', { workId: 'w-home', area: 'behavior', annual: true }).data;
    expect(inputSemester(d, 'w-home', 'behavior')).toBe(1);
    expect(() => applyAction(d, 'work.setSemester', { workId: 'w-home', semester: 3 })).toThrow();
    addSubject(d, { id: 'sj-x', name: '국어', kind: 'general', curriculum: '2022', commonGroup: null, commonPart: null }, [{ id: 'g-x', semester: 2, studentIds: ['s1'] }]);
    expect(inputSemester(d, 'w-g-x', 'subject')).toBe(2);
    expect(() => applyAction(d, 'work.setSemester', { workId: 'w-g-x', semester: 1 })).toThrow(/수강집단/);
  });
  it('기재 제외 일괄: 체크한 학생은 제외, 푼 학생은 다시 작성 대상', async () => {
    const { applyAction } = await import('../src/core/actions');
    let d = baseData();
    let r = applyAction(d, 'record.bulkExclude', { workId: 'w-home', area: 'career', semester: 2, excludeIds: ['s1', 's2'], includeIds: [] });
    d = r.data;
    expect(r.result).toBe(2);
    expect(d.records.filter((x) => x.area === 'career' && x.semester === 2).every((x) => recordState(d, x) === 'excluded')).toBe(true);
    r = applyAction(d, 'record.bulkExclude', { workId: 'w-home', area: 'career', semester: 2, excludeIds: ['s1'], includeIds: ['s2'] });
    d = r.data;
    expect(recordState(d, d.records.find((x) => x.studentId === 's2' && x.area === 'career')!)).toBe('empty');
    expect(planExport(d, 'w-home', 'career', [2]).summary.excluded).toBe(1);
  });
});

describe('교육적 관점 서술(부정 표현 전환)', () => {
  it('모든 생성·윤문 지시에 교육적 관점 규칙이 들어가고, 윤문은 부정 표현을 그대로 두지 않게 한다', async () => {
    const { candidateSystemPrompt, polishSystemPrompt, expandSystemPrompt, EDUCATIONAL_VIEW } = await import('../src/core/prompts');
    for (const p of [candidateSystemPrompt('middle'), polishSystemPrompt('high', ''), expandSystemPrompt('middle')]) {
      expect(p).toContain(EDUCATIONAL_VIEW);
      expect(p).toContain('개선의 방향이나 긍정어로');
    }
    const polish = polishSystemPrompt('middle', '');
    expect(polish).toContain('부정 표현 전환');
    expect(polish).not.toContain('부정/조건 표현을 바꾸지 않는다');
  });

  it('최종 본문의 부정적 평가어는 경고(차단 아님)하고, 긍정 뜻의 부정문은 잡지 않는다', async () => {
    const { toneFindings } = await import('../src/core/rules');
    expect(toneFindings('수업 태도가 산만하고 끈기가 부족함. 과제를 제출하지 않음.').map((f) => f.match)).toEqual(['산만', '부족함', '제출하지 않']);
    expect(toneFindings('어려운 문제도 끝까지 포기하지 않음. 친구를 먼저 도움.')).toEqual([]);
    const d = baseData();
    const r = rec(d, 'r1', 's1', 'w-home', 'behavior', 1, '');
    const { findingsFor } = await import('../src/core/model');
    const f = findingsFor(d, r, '모둠 활동에 소극적임.');
    expect(f.some((x) => x.ruleId === 'negative-tone' && x.severity === 'warn')).toBe(true);
    expect(hasBlocking(f)).toBe(false);
  });
});

describe('교과 학기 구분 없음', () => {
  it('학기 구분 없음으로 만든 수업 반은 1학기 칸에 쓰고 연간으로 표시한다', async () => {
    const { applyAction } = await import('../src/core/actions');
    const { semestersFor, workRefs } = await import('../src/core/model');
    let d = baseData('middle');
    const subj = applyAction(d, 'subject.create', { name: '음악', kind: 'general', curriculum: '2022', commonGroup: null, commonPart: null });
    d = subj.data;
    const g = applyAction(d, 'courseGroup.create', { subjectId: subj.result as string, grade: 1, semester: 2, annual: true, termType: 'regular', name: '1학년 3반', studentIds: ['s1'] });
    d = g.data;
    const grp = d.courseGroups.find((x) => x.id === g.result)!;
    const w = d.works.find((x) => x.refId === grp.id)!;
    expect(grp.semester).toBe(1);
    expect(grp.studentIds).toEqual(['s1']);
    expect(w.annualAreas).toEqual(['subject']);
    expect(semestersFor(d, w.id, 'subject')).toEqual([1]);
    expect(workRefs(d, w.id)!.label).toContain('학기 구분 없음');
    expect('annual' in grp).toBe(false);
  });
});
