import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/core/actions';
import { recordState } from '../src/core/model';
import type { Rubric } from '../src/core/prompts';
import type { AppData, Provider } from '../src/core/schema';
import { LlmService } from '../src/main/llm';
import { cliStatus, listModels, pickAutoModel } from '../src/main/providers';
import { baseData } from './fixtures';

/**
 * 한 학급 전체 흐름 실제 호출 시험(선택, 가상 학생만 전송). 기본 실행에서 빠진다.
 * Gemini는 .env의 GEMINI_API_KEY(API 키), Claude·ChatGPT는 로그인된 구독 CLI를 쓴다.
 * 실행: LIVE_CLASS=1 LIVE_PROVIDER=gemini|anthropic|openai [LIVE_AREAS=behavior,subject,club] npx vitest run tests/class.live.test.ts
 */
function envKey(name: string): string {
  // 개발용 키 파일: MITGEUL_ENV_FILE 또는 저장소 루트의 .env(저장소에는 올리지 않음)
  const p = process.env.MITGEUL_ENV_FILE ? path.resolve(process.env.MITGEUL_ENV_FILE) : path.resolve(__dirname, '../../.env');
  if (!fs.existsSync(p)) return '';
  const line = fs.readFileSync(p, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : '';
}
const provider = (process.env.LIVE_PROVIDER ?? 'gemini') as Provider;
const GEMINI_KEY = envKey('GEMINI_API_KEY');
const KEY = !process.env.LIVE_CLASS ? false : provider === 'gemini' ? !!GEMINI_KEY : (await cliStatus(provider)).loggedIn;
const rubric: Rubric = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../resources/rubrics/2026-middle-rubric-v1.json'), 'utf8'));
const styleGuide = fs.readFileSync(path.resolve(__dirname, '../resources/prompts/polish-style.md'), 'utf8');

type Obs = { itemId: string; score: number; example: string };
type Row = { name: string; free: string; obs: Obs[]; event?: string; target: 150 | 300 | 500; context?: string };
const NAMES = ['공지원', '김하늘', '이도윤', '박서준', '최유나', '정민서', '한예준', '오시우', '윤채원', '장하린'];

/** 영역별 가상 관찰: 자율 작성만·항목만·사례 없음·다른 학생 이름·"지원" 같은 일반 단어·금지 문구 포함 */
const PLANS: Record<'behavior' | 'subject' | 'club', Row[]> = {
  behavior: [
    { name: '공지원', free: '학급 신문 편집부에 지원해 기사 배치를 맡음.', obs: [{ itemId: 'behavior-01', score: 4, example: '청소 당번표를 직접 고쳐 게시함' }], event: '줄넘기 박자를 세어 줌', target: 500 },
    { name: '김하늘', free: '', obs: [{ itemId: 'behavior-08', score: 5, example: '모둠 토의에서 소수 의견을 정리해 발표함' }, { itemId: 'behavior-01', score: 3, example: '' }], target: 300 },
    { name: '이도윤', free: '쉬는 시간마다 전학 온 친구에게 학교 안내를 해 줌.', obs: [], target: 300 },
    { name: '박서준', free: '', obs: [{ itemId: 'behavior-01', score: 2, example: '' }], target: 150 },
    { name: '최유나', free: '과학 실험 뒤 정리 순서를 칠판에 적어 모둠원과 공유함.', obs: [{ itemId: 'behavior-08', score: 4, example: '' }], event: '이어달리기 바통 연습을 제안함', target: 500 },
    { name: '정민서', free: '김하늘과 함께 학급 문고 대출 장부를 정리함.', obs: [], target: 300 },
    { name: '한예준', free: '교내 토론 대회 준비를 도움.', obs: [{ itemId: 'behavior-01', score: 4, example: '지각 없이 등교함' }], target: 300 },
    { name: '오시우', free: '', obs: [], event: '', target: 150 },
    { name: '윤채원', free: '', obs: [{ itemId: 'behavior-08', score: 3, example: '친구 갈등을 담임에게 알려 중재를 도움' }], target: 500 },
    { name: '장하린', free: '수업 중 발표를 꺼렸으나 손을 들어 질문하기 시작함.', obs: [{ itemId: 'behavior-01', score: 5, example: '' }, { itemId: 'behavior-08', score: 4, example: '' }], target: 500 },
  ],
  subject: [
    { name: '공지원', context: '물질의 상태 변화 단원, 실험 보고서 수행평가', free: '증발 실험에서 온도 기록표를 스스로 만들어 측정값을 정리함.', obs: [{ itemId: 'subject-04', score: 4, example: '가열 시간과 온도 그래프에서 끓는점 구간을 찾아 설명함' }], target: 500 },
    { name: '김하늘', free: '', obs: [{ itemId: 'subject-03', score: 5, example: '얼음이 녹는 속도에 영향을 주는 요인을 질문으로 세워 변인을 정함' }, { itemId: 'subject-09', score: 4, example: '' }], target: 500 },
    { name: '이도윤', free: '실험 안전 수칙을 모둠원에게 다시 안내함.', obs: [], target: 300 },
    { name: '박서준', free: '', obs: [{ itemId: 'subject-01', score: 2, example: '' }], target: 150 },
    { name: '최유나', context: '빛과 파동 단원', free: '', obs: [{ itemId: 'subject-07', score: 4, example: '굴절 실험 결과를 그림으로 설명함' }, { itemId: 'subject-10', score: 4, example: '피드백을 받아 보고서 결론을 고침' }], target: 500 },
    { name: '정민서', free: '모둠 보고서 작성을 지원하는 역할을 맡아 표를 정리함.', obs: [], target: 300 },
    { name: '한예준', free: '과학 탐구 대회에 나갈 주제를 정함.', obs: [{ itemId: 'subject-06', score: 3, example: '' }], target: 300 },
    { name: '오시우', free: '', obs: [{ itemId: 'subject-08', score: 3, example: '' }], target: 150 },
    { name: '윤채원', free: '', obs: [{ itemId: 'subject-05', score: 4, example: '두 모둠의 측정값 차이의 원인을 실험 조건에서 찾음' }], target: 300 },
    { name: '장하린', free: '수업 시간 질문이 늘어남.', obs: [{ itemId: 'subject-11', score: 4, example: '' }, { itemId: 'subject-12', score: 3, example: '' }], target: 500 },
  ],
  club: [
    { name: '공지원', free: '방송부 신입 부원 모집에 지원해 홍보 영상 촬영을 맡음.', obs: [{ itemId: 'club-07', score: 4, example: '촬영 일정표를 만들어 부원과 공유함' }], target: 500 },
    { name: '김하늘', free: '', obs: [{ itemId: 'club-05', score: 5, example: '점심 방송 진행 대본을 직접 써서 진행함' }, { itemId: 'club-08', score: 4, example: '' }], target: 300 },
    { name: '이도윤', free: '장비 사용법을 정리한 안내문을 만듦.', obs: [], target: 300 },
    { name: '박서준', free: '', obs: [{ itemId: 'club-03', score: 2, example: '' }], target: 150 },
    { name: '최유나', free: '영상 편집 프로그램 사용법을 스스로 익힘.', obs: [{ itemId: 'club-04', score: 4, example: '' }, { itemId: 'club-10', score: 3, example: '' }], target: 500 },
    { name: '정민서', free: '김하늘과 함께 방송 순서를 점검함.', obs: [], target: 300 },
    { name: '한예준', free: '청소년 영상 공모전 수상 작품을 분석함.', obs: [{ itemId: 'club-02', score: 4, example: '' }], target: 300 },
    { name: '오시우', free: '', obs: [{ itemId: 'club-09', score: 3, example: '' }], target: 150 },
    { name: '윤채원', free: '', obs: [{ itemId: 'club-06', score: 4, example: '음향 잡음이 생기자 마이크 위치를 바꿔 해결함' }], target: 500 },
    { name: '장하린', free: '', obs: [{ itemId: 'club-01', score: 4, example: '' }, { itemId: 'club-07', score: 4, example: '' }], target: 300 },
  ],
};
const AREAS = (process.env.LIVE_AREAS ?? 'behavior,subject,club').split(',') as (keyof typeof PLANS)[];

describe.each(AREAS)('한 학급 전체 흐름(실제 호출): %s', (area) => {
  const CLASS = PLANS[area];
  it.skipIf(!KEY)(`${provider}: 10명 관찰 → 후보 → 조합 → 취합 → 윤문 → 채택 → 검토`, async () => {
    const model = pickAutoModel(provider, await listModels(provider, { apiKey: GEMINI_KEY }))!;
    let d: AppData = baseData('middle');
    d.students = d.students.filter((s) => s.classNo !== 3);
    d.classes[0]!.studentIds = [];
    const ids = CLASS.map((_, i) => `k${i + 1}`);
    CLASS.forEach((c, i) => {
      d.students.push({ ...structuredClone(baseData('middle').students[0]!), id: ids[i]!, name: c.name, number: i + 1 });
      d.classes[0]!.studentIds.push(ids[i]!);
    });
    d.settings.provider = provider;
    d.settings.models = { gemini: '', openai: '', anthropic: '', [provider]: model } as AppData['settings']['models'];
    const act = (n: string, p: unknown) => {
      const r = applyAction(d, n, p);
      d = r.data;
      return r.result as string;
    };
    let workId = 'w-home';
    if (area === 'subject') {
      const subjectId = act('subject.create', { name: '과학', kind: 'general', curriculum: '2022', commonGroup: null, commonPart: null });
      act('courseGroup.create', { subjectId, grade: 1, semester: 1, termType: 'regular', name: '과학 1-3', studentIds: ids });
      workId = d.works.find((w) => w.kind === 'subject')!.id;
    }
    if (area === 'club') {
      act('club.create', { name: '방송부', clubType: 'regular', studentIds: ids });
      workId = d.works.find((w) => w.kind === 'club')!.id;
    }
    const svc = new LlmService({ getData: () => d, commit: async (m) => { const c = structuredClone(d); m(c); d = c; }, rubric, styleGuide, apiKey: async () => GEMINI_KEY, resolveModel: async (_p, c) => ({ model: c || model, auto: !c }) });
    const ev = area === 'behavior' ? act('event.create', { workId, area, semester: 1, name: '체육한마당', period: '2026.05.08.', quantity: '', description: '학급 대항 단체 줄넘기와 이어달리기' }) : '';
    const rows: string[] = [];
    const problems: string[] = [];
    const t0 = Date.now();
    for (const [i, c] of CLASS.entries()) {
      const sid = ids[i]!;
      const rid = act('record.ensure', { studentId: sid, workId, area, semester: 1 });
      act('record.setObservations', { recordId: rid, context: c.context ?? '', freeNote: c.free, observations: c.obs, eventObs: ev && c.event !== undefined ? [{ eventId: ev, note: c.event }] : [] });
      const row: Record<string, string | number> = { 학생: c.name, 목표: c.target };
      try {
        const prep = await svc.prepareCandidates(rid);
        for (const n of NAMES) if (prep.preview.includes(n)) problems.push(`${c.name}: 전송 문안에 실명 ${n}`);
        const out = await svc.send(prep.requestId);
        let r = d.records.find((x) => x.id === rid)!;
        row.후보 = `${out.applied.length}/${r.itemOrder.length}`;
        if (Object.keys(out.failed).length) problems.push(`${c.name}: 후보 실패 ${JSON.stringify(out.failed)}`);
        for (const set of r.candidates) act('composition.add', { recordId: rid, itemId: set.itemId, fragments: [0, 1].map((k) => ({ text: set.texts[k]!, source: { kind: 'candidate', itemId: set.itemId, index: k, evidenceHash: set.evidenceHash, partial: false } })) });
        act('record.assemble', { recordId: rid });
        act('record.setTarget', { recordId: rid, target: c.target });
        r = d.records.find((x) => x.id === rid)!;
        row.초안 = [...r.draft].length;
        const po = await svc.send((await svc.preparePolish(rid)).requestId);
        if (!po.applied.length) problems.push(`${c.name}: 윤문 실패 ${po.message}`);
        act('record.adoptPolish', { recordId: rid });
        r = d.records.find((x) => x.id === rid)!;
        const len = [...r.finalText].length;
        row.윤문 = len;
        row.범위 = len >= c.target * 0.9 && len <= c.target * 1.1 ? 'OK' : len < c.target * 0.9 ? '짧음' : '김';
        try {
          act('record.review', { recordId: rid, confirmed: true });
        } catch (e) {
          problems.push(`${c.name}: 검토 차단 ${(e as Error).message}`);
        }
        row.상태 = recordState(d, d.records.find((x) => x.id === rid));
        if (NAMES.some((n) => r.finalText.includes(n))) problems.push(`${c.name}: 본문에 학생 이름`);
        console.log(`--- ${area} ${c.name} (${len}자)\n${r.finalText}`);
      } catch (e) {
        row.오류 = (e as Error).message.slice(0, 120);
        problems.push(`${c.name}: ${(e as Error).message.slice(0, 120)}`);
      }
      rows.push(JSON.stringify(row));
    }
    console.log(`\n=== ${area} ${provider} ${model} · ${Math.round((Date.now() - t0) / 1000)}초\n${rows.join('\n')}\n=== 문제\n${problems.join('\n') || '없음'}`);
    expect(rows.length).toBe(10);
  }, 1_200_000);
});
