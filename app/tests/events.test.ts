import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAction } from '../src/core/actions';
import { eventLabel } from '../src/core/events';
import { generationGate, recordState } from '../src/core/model';
import type { Rubric } from '../src/core/prompts';
import { integrityErrors, type AppData } from '../src/core/schema';
import { LlmService } from '../src/main/llm';
import { baseData } from './fixtures';

const rubric: Rubric = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../resources/rubrics/2026-middle-rubric-v1.json'), 'utf8'));
const styleGuide = fs.readFileSync(path.resolve(__dirname, '../resources/prompts/polish-style.md'), 'utf8');

let server: http.Server;
let base = '';
let lastBody = '';
let hold: Promise<void> | null = null;
let release: () => void = () => {};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      lastBody = body;
      if (hold) await hold;
      const ids = [...body.matchAll(/항목ID: ([A-Za-z0-9_-]+)/g)].map((m) => m[1]!);
      const payload = JSON.stringify({ items: ids.map((itemId) => ({ itemId, candidates: [1, 2, 3, 4, 5].map((n) => `행사 문장 ${n}.`) })) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: payload }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

function setup() {
  let d: AppData = baseData('middle');
  d.settings.provider = 'anthropic';
  d.settings.models.anthropic = 'claude-test';
  const act = (name: string, p: unknown) => {
    const r = applyAction(d, name, p);
    d = r.data;
    return r.result as any;
  };
  const svc = new LlmService({
    getData: () => d,
    commit: async (m) => {
      const c = structuredClone(d);
      m(c);
      d = c;
    },
    rubric,
    styleGuide,
    resolveModel: async (_p, c) => ({ model: c || 'auto', auto: !c }),
    cli: { override: { anthropic: path.resolve(__dirname, 'fake-cli.mjs') }, extraEnv: { MITGEUL_FAKE_CLI_BASE: base } },
  });
  return { get d() {
    return d;
  }, act, svc };
}

describe('행사·활동', () => {
  it('행사 만들기·학급 전체 참여·사용 중 삭제는 선택·후보까지 함께 정리', () => {
    const s = setup();
    const ev = s.act('event.create', { workId: 'w-home', area: 'autonomy', semester: 1, name: '학교폭력예방교육', period: '2026.03.12.', quantity: '2시간', description: '사례 중심 토의' });
    expect(eventLabel(s.d.events[0]!)).toBe('학교폭력예방교육(2026.03.12./2시간)');
    expect(s.act('event.create', { workId: 'w-home', area: 'autonomy', semester: 1, name: '학교폭력예방교육', period: '2026.03.12.', quantity: '', description: '' })).toBe(ev);
    expect(s.act('event.applyToAll', { eventId: ev, selected: true })).toBe(2);
    const recs = s.d.records.filter((r) => r.area === 'autonomy');
    expect(recs.length).toBe(2);
    expect(recs.every((r) => r.eventObs.some((e) => e.eventId === ev))).toBe(true);
    expect(recordState(s.d, recs[0])).toBe('drafting');
    expect(s.act('event.applyToAll', { eventId: ev, selected: false })).toBe(2);
    expect(s.d.records.every((r) => !r.eventObs.length)).toBe(true);
    s.act('event.applyToAll', { eventId: ev, selected: true });
    s.act('event.delete', { id: ev });
    expect(s.d.events.length).toBe(0);
    expect(s.d.records.every((r) => !r.eventObs.length && !r.itemOrder.includes(ev))).toBe(true);
    expect(integrityErrors(s.d)).toEqual([]);
  });

  it('다른 영역·학기·삭제된 행사 선택은 오류 없이 빠지고, 동아리 작업에는 만들 수 없다', () => {
    const s = setup();
    const ev = s.act('event.create', { workId: 'w-home', area: 'career', semester: 2, name: '직업인 초청 강연', period: '', quantity: '', description: '' });
    const rid = s.act('record.ensure', { studentId: 's1', workId: 'w-home', area: 'autonomy', semester: 1 });
    s.act('record.setObservations', { recordId: rid, observations: [], context: '', eventObs: [{ eventId: ev, note: '' }, { eventId: 'evt-deleted', note: '' }] });
    expect(s.d.records.find((r) => r.id === rid)!.eventObs).toEqual([]);
    s.d.clubs.push({ id: 'cl', schoolLevel: 'middle', schoolYear: 2026, name: '과학반', clubType: 'regular', studentIds: ['s1'] });
    s.d.works.push({ id: 'wc', kind: 'club', refId: 'cl', excludedStudentIds: [] });
    expect(() => s.act('event.create', { workId: 'wc', area: 'autonomy', semester: 1, name: 'x', period: '', quantity: '', description: '' })).toThrow('담임 작업');
  });

  it('행사만 고른 기록도 후보를 요청하고, 사례 없는 행사는 창작 금지 지시가 들어간다', async () => {
    const s = setup();
    const ev = s.act('event.create', { workId: 'w-home', area: 'career', semester: 1, name: '직업인 초청 강연', period: '2026.05.20.', quantity: '', description: '지역 직업인 3명의 직무 소개' });
    const rid = s.act('record.ensure', { studentId: 's1', workId: 'w-home', area: 'career', semester: 1 });
    s.act('record.setObservations', { recordId: rid, observations: [], context: '', eventObs: [{ eventId: ev, note: '' }] });
    expect(generationGate(s.d, s.d.records.find((r) => r.id === rid)!).ok).toBe(true);
    const prep = await s.svc.prepareCandidates(rid);
    expect(prep.preview).toContain('[행사·활동]');
    expect(prep.preview).toContain('직업인 초청 강연(2026.05.20.)');
    expect(prep.preview).toContain('없음(참여 사실만');
    const out = await s.svc.send(prep.requestId);
    expect(out.applied).toEqual([ev]);
    expect(s.d.records.find((r) => r.id === rid)!.candidates[0]!.itemId).toBe(ev);
  });

  it('요청 뒤 행사 내용이 바뀌면 늦은 응답을 적용하지 않는다', async () => {
    const s = setup();
    const ev = s.act('event.create', { workId: 'w-home', area: 'autonomy', semester: 1, name: '체육한마당', period: '', quantity: '', description: '' });
    const rid = s.act('record.ensure', { studentId: 's1', workId: 'w-home', area: 'autonomy', semester: 1 });
    s.act('record.setObservations', { recordId: rid, observations: [], context: '', eventObs: [{ eventId: ev, note: '학급 응원 도구를 준비함' }] });
    const prep = await s.svc.prepareCandidates(rid);
    expect(lastBody).toBe(lastBody);
    hold = new Promise<void>((r) => (release = r));
    const pending = s.svc.send(prep.requestId);
    await new Promise((r) => setTimeout(r, 600));
    s.act('event.update', { id: ev, name: '체육한마당', period: '2026.10.02.', quantity: '', description: '학급 대항 줄다리기' });
    release();
    hold = null;
    const out = await pending;
    expect(out.applied).toEqual([]);
    expect(out.discarded).toEqual([ev]);
    expect(lastBody).toContain('학급 응원 도구를 준비함');
    expect(lastBody).not.toContain('김민준');
  });

  it('행사 내용의 금지 표현이 있어도 후보 생성은 막지 않는다(최종 본문에서 차단, 2026-11-16)', () => {
    const s = setup();
    const ev = s.act('event.create', { workId: 'w-home', area: 'career', semester: 1, name: '진로 특강', period: '', quantity: '', description: 'TOEIC 설명회' });
    const rid = s.act('record.ensure', { studentId: 's1', workId: 'w-home', area: 'career', semester: 1 });
    s.act('record.setObservations', { recordId: rid, observations: [], context: '', eventObs: [{ eventId: ev, note: '' }] });
    expect(generationGate(s.d, s.d.records.find((r) => r.id === rid)!).ok).toBe(true);
  });
});
