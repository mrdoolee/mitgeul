import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAction } from '../src/core/actions';
import type { Rubric } from '../src/core/prompts';
import type { AppData, Provider } from '../src/core/schema';
import { LlmService } from '../src/main/llm';
import { ProviderError } from '../src/main/providers';
import { baseData } from './fixtures';

const rubric: Rubric = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../resources/rubrics/2026-middle-rubric-v1.json'), 'utf8'));
const styleGuide = fs.readFileSync(path.resolve(__dirname, '../resources/prompts/polish-style.md'), 'utf8');
const FAKE_CLI = path.resolve(__dirname, 'fake-cli.mjs');

interface Seen {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}
const seen: Seen[] = [];
let mode: 'ok' | 'fourCandidates' | 'error500' | 'slow' | 'expand503once' | 'negative' = 'ok';
let server: http.Server;
let base = '';
let release: (() => void) | null = null;

function candidatesJson(itemIds: string[], n = 5) {
  return JSON.stringify({ items: itemIds.map((itemId) => ({ itemId, candidates: Array.from({ length: n }, (_, i) => `관찰 행동 ${i + 1}을 보임.`) })) });
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      seen.push({ url: req.url ?? '', headers: req.headers, body });
      // 가짜 CLI가 보낸 { args, system, user, model }. 응답은 { text } 하나로 주고, 가짜 CLI가 각 CLI 출력 형식으로 바꾼다.
      // Gemini는 HTTP API 형식으로 답한다.
      const reply = (text: string, model?: string) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url?.includes(':generateContent')) return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], modelVersion: 'gemini-test' }));
        res.end(JSON.stringify({ text, model }));
      };
      if (mode === 'error500') {
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: '김민준 관련 내부 오류' } }));
      }
      if (mode === 'slow') await new Promise<void>((r) => (release = r));
      if (mode === 'expand503once' && body.includes('[분량 늘리기 요청]')) {
        mode = 'ok';
        res.writeHead(503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'overloaded' } }));
      }
      const isPolish = body.includes('최종 윤문 과제') || body.includes('분량 늘리기 과제');
      if (mode === 'negative' && isPolish) {
        // 첫 윤문은 부정적 표현을 남기고, 교육적 관점 보정 요청에는 개선 방향으로 고친 본문을 준다(둘 다 300자 범위 안)
        const neg = '수업 태도가 산만하고 과제를 늦게 제출하는 일이 많음. 모둠 활동에는 소극적임. '.repeat(7).trim();
        const pos = '과제 일정을 스스로 점검하는 습관을 기르면 학습의 완성도가 더욱 높아질 것으로 기대됨. 관심 있는 주제에서 질문하며 참여함. '.repeat(4).trim();
        const text = body.includes('[교육적 관점 보정 요청]') ? pos : neg;
        return reply(JSON.stringify({ text, suggestions: [] }));
      }
      const ids = [...body.matchAll(/항목ID: ([A-Za-z0-9_-]+)/g)].map((m) => m[1]!);
      const longText = '규칙을 지키고 친구의 의견을 경청하는 태도가 학급 생활 전반에서 꾸준히 드러남. '.repeat(6) + '학급 회의에서도 차분히 의견을 나눔.';
      const payload = isPolish ? JSON.stringify({ text: body.includes('[분량 늘리기 요청]') ? longText : '규칙을 지키고 친구의 의견을 경청함.', suggestions: ['근거 부족'] }) : candidatesJson(ids, mode === 'fourCandidates' ? 4 : 5);
      reply(payload);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(() => server.close());

function setup(provider: Provider) {
  let d: AppData = baseData('middle');
  d.settings.provider = provider;
  d.settings.models = { gemini: 'gemini-test', openai: 'gpt-test', anthropic: 'claude-opus-5-5' };
  d.students[2]!.aliases = ['하늘쌤'];
  const act = (name: string, p: unknown) => {
    const r = applyAction(d, name, p);
    d = r.data;
    return r.result as string;
  };
  const recordId = act('record.ensure', { studentId: 's1', workId: 'w-home', area: 'behavior', semester: 1 });
  act('record.setObservations', {
    recordId,
    context: '학급 회의에서 이서연과 의견을 나눔',
    observations: [
      { itemId: 'behavior-01', score: 4, example: '김민준은 민준이라고 불리며 하늘쌤과 함께 규칙을 정함' },
      { itemId: 'behavior-08', score: 3, example: '' },
    ],
  });
  const svc = new LlmService({
    getData: () => d,
    commit: async (m) => {
      const c = structuredClone(d);
      m(c);
      d = c;
    },
    rubric,
    styleGuide,
    apiKey: async () => 'test-key-abcdefghijklmnop',
    resolveModel: async (_p, chosen) => ({ model: chosen || 'auto-model', auto: !chosen }),
    cli: { override: { anthropic: FAKE_CLI, openai: FAKE_CLI }, extraEnv: { MITGEUL_FAKE_CLI_BASE: base }, baseUrlOverride: base },
  });
  return { get d() {
    return d;
  }, act, recordId, svc };
}

// 성명 전체만 익명화한다(성 뺀 이름은 일반 단어와 겹쳐 치환하지 않음, 2026-11-16).
const NAMES = ['김민준', '이서연', '박하늘'];

describe.each(['gemini', 'openai', 'anthropic'] as Provider[])('%s 제공자', (provider) => {
  it('익명화된 확인 문안만 보내고 실명·키를 본문·주소에 넣지 않는다(Gemini: API, Claude·ChatGPT: 구독 CLI·도구와 사용자 설정 끔·API 키 환경 변수 제외)', async () => {
    mode = 'ok';
    seen.length = 0;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-should-not-pass';
    process.env.OPENAI_API_KEY = 'sk-test-should-not-pass';
    const s = setup(provider);
    const prep = await s.svc.prepareCandidates(s.recordId);
    for (const n of NAMES) expect(prep.preview).not.toContain(n);
    expect(prep.replaced.length).toBeGreaterThan(0);
    const out = await s.svc.send(prep.requestId);
    expect(out.applied.sort()).toEqual(['behavior-01', 'behavior-08']);
    expect(seen.length).toBe(1);
    const req = seen[0]!;
    for (const n of NAMES) {
      expect(req.body).not.toContain(n);
      expect(req.url).not.toContain(n);
    }
    if (provider === 'gemini') {
      // API 키 방식: 키는 헤더로만, 주소에는 넣지 않는다
      expect(req.url).toContain(':generateContent');
      expect(req.url).not.toContain('test-key');
      expect(JSON.stringify(req.headers)).toContain('test-key-abcdefghijklmnop');
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      const r0 = s.d.records.find((x) => x.id === s.recordId)!;
      expect(r0.candidates.find((c) => c.itemId === 'behavior-01')?.texts.length).toBe(5);
      return;
    }
    const sent = JSON.parse(req.body) as { args: string[]; system: string; user: string; env: Record<string, string | null> };
    // CLI에 넘긴 시스템 지시·요청 본문은 미리 보기(교사가 확인할 문안)와 같다
    expect(prep.preview).toContain(sent.system.slice(0, 200));
    expect(prep.preview).toContain(sent.user.slice(-200));
    expect(Object.values(sent.env).every((v) => v === null)).toBe(true);
    if (provider === 'anthropic') {
      expect(req.url).toBe('/claude');
      expect(sent.args).toEqual(expect.arrayContaining(['-p', '--tools', '--setting-sources', '--strict-mcp-config', '--no-session-persistence', '--json-schema', '--system-prompt-file']));
      expect(sent.args[sent.args.indexOf('--tools') + 1]).toBe('');
      expect(sent.args[sent.args.indexOf('--setting-sources') + 1]).toBe('');
    } else {
      expect(req.url).toBe('/codex');
      expect(sent.args).toEqual(expect.arrayContaining(['exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--output-schema', '-s', 'read-only', 'features.shell_tool=false', 'skills.bundled.enabled=false', 'tools.web_search=false']));
    }
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const r = s.d.records.find((x) => x.id === s.recordId)!;
    expect(r.candidates.find((c) => c.itemId === 'behavior-01')?.texts.length).toBe(5);
  });

  it('후보가 4개만 와도 실패로 버리지 않고 저장한다(2026-11-16)', async () => {
    mode = 'fourCandidates';
    const s = setup(provider);
    const prep = await s.svc.prepareCandidates(s.recordId);
    const out = await s.svc.send(prep.requestId);
    expect(out.applied.length).toBe(2);
    expect(Object.keys(out.failed).length).toBe(0);
    mode = 'ok';
  });

  it('서버 오류 메시지의 이름을 가리고 실패를 알린다', async () => {
    mode = 'error500';
    const s = setup(provider);
    const prep = await s.svc.prepareCandidates(s.recordId);
    const err = await s.svc.send(prep.requestId).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(String(err.message)).not.toContain('김민준');
    expect(s.d.records.find((x) => x.id === s.recordId)!.candidates.length).toBe(0);
    mode = 'ok';
  });
});

describe('요청 묶음과 늦은 응답', () => {
  it('요청 뒤 근거가 바뀌면 늦은 응답을 적용하지 않는다', async () => {
    mode = 'slow';
    const s = setup('anthropic');
    const prep = await s.svc.prepareCandidates(s.recordId);
    const pending = s.svc.send(prep.requestId);
    await new Promise((r) => setTimeout(r, 600));
    s.act('record.setObservations', { recordId: s.recordId, context: '맥락 변경', observations: [{ itemId: 'behavior-01', score: 5, example: '' }] });
    release?.();
    const out = await pending;
    expect(out.applied).toEqual([]);
    expect(out.discarded).toContain('behavior-01');
    mode = 'ok';
  });

  it('취소한 요청은 응답이 와도 적용하지 않는다', async () => {
    mode = 'slow';
    const s = setup('openai');
    const prep = await s.svc.prepareCandidates(s.recordId);
    const pending = s.svc.send(prep.requestId);
    await new Promise((r) => setTimeout(r, 600));
    s.svc.cancel(prep.requestId);
    release?.();
    const out = await pending;
    expect(out.applied).toEqual([]);
    expect(s.d.records.find((x) => x.id === s.recordId)!.candidates.length).toBe(0);
    mode = 'ok';
  });

  it('같은 요청은 두 번 보낼 수 없고 재시도는 새 확인이 필요하다', async () => {
    const s = setup('openai');
    const prep = await s.svc.prepareCandidates(s.recordId);
    await s.svc.send(prep.requestId);
    await expect(s.svc.send(prep.requestId)).rejects.toThrow('다시 요청');
  });

  it('윤문: 목표·남은 Byte가 문안에 들어가고, 초안이 바뀌면 결과를 버린다', async () => {
    const s = setup('anthropic');
    s.act('composition.add', { recordId: s.recordId, itemId: 'behavior-01', fragments: [{ text: '규칙을 지킴.', source: { kind: 'manual' } }] });
    s.act('record.assemble', { recordId: s.recordId });
    await expect(s.svc.preparePolish(s.recordId)).rejects.toThrow('목표');
    s.act('record.setTarget', { recordId: s.recordId, target: 300 });
    const prep = await s.svc.preparePolish(s.recordId);
    expect(prep.preview).toContain('공백 포함 약 300자');
    expect(prep.preview).toContain('남은 Byte: 900');
    const out = await s.svc.send(prep.requestId);
    expect(out.applied).toEqual(['polish']);
    const r = s.d.records.find((x) => x.id === s.recordId)!;
    expect(r.polish?.resultText).toContain('경청');
    // 첫 응답이 하한(270자)보다 짧아 문장별 늘리기 요청을 자동으로 한 번 더 보냈다
    expect(seen.at(-1)!.body).toContain('[분량 늘리기 요청]');
    expect([...r.polish!.resultText].length).toBeGreaterThan(200);
    expect(r.finalText).toBe(''); // 자동 채택하지 않음
    mode = 'slow';
    const prep2 = await s.svc.preparePolish(s.recordId);
    const p2 = s.svc.send(prep2.requestId);
    await new Promise((r2) => setTimeout(r2, 600));
    s.act('record.setDraft', { recordId: s.recordId, draft: '교사가 고친 초안.' });
    release?.();
    const out2 = await p2;
    expect(out2.discarded).toEqual(['polish']);
    expect(s.d.records.find((x) => x.id === s.recordId)!.draft).toBe('교사가 고친 초안.');
    mode = 'ok';
  });

  it('윤문 결과에 부정적 표현이 남으면 교육적 관점 보정을 한 번 더 요청해 바꾼 결과를 받는다', async () => {
    const s = setup('anthropic');
    s.act('composition.add', { recordId: s.recordId, itemId: 'behavior-01', fragments: [{ text: '규칙을 지킴.', source: { kind: 'manual' } }] });
    s.act('record.assemble', { recordId: s.recordId });
    s.act('record.setTarget', { recordId: s.recordId, target: 300 });
    mode = 'negative';
    const prep = await s.svc.preparePolish(s.recordId);
    expect(prep.preview).toContain('[교육적 관점 서술');
    const before = seen.length;
    const out = await s.svc.send(prep.requestId);
    expect(out.applied).toEqual(['polish']);
    const fix = seen.slice(before).find((x) => x.body.includes('[교육적 관점 보정 요청]'));
    expect(fix?.body).toContain('산만');
    const text = s.d.records.find((x) => x.id === s.recordId)!.polish!.resultText;
    expect(text).toContain('기대됨');
    expect(text).not.toContain('산만');
    mode = 'ok';
  });

  it('분량 늘리기 중 일시 오류(503)가 나면 잠시 뒤 다시 시도해 늘린 결과를 받는다', async () => {
    const s = setup('anthropic');
    s.act('composition.add', { recordId: s.recordId, itemId: 'behavior-01', fragments: [{ text: '규칙을 지킴.', source: { kind: 'manual' } }] });
    s.act('record.assemble', { recordId: s.recordId });
    s.act('record.setTarget', { recordId: s.recordId, target: 300 });
    mode = 'expand503once';
    const prep = await s.svc.preparePolish(s.recordId);
    const out = await s.svc.send(prep.requestId);
    expect(out.applied).toEqual(['polish']);
    expect([...s.d.records.find((x) => x.id === s.recordId)!.polish!.resultText].length).toBeGreaterThan(200);
    expect(out.message).not.toContain('오류로 멈췄습니다');
    mode = 'ok';
  }, 20_000);

  it('동명이인 성명이 있어도 요청 준비를 멈추지 않고 실명을 보내지 않는다', async () => {
    const s = setup('openai');
    s.d.students.push({ ...s.d.students[0]!, id: 's9', name: '김민준', classNo: 9 });
    const prep = await s.svc.prepareCandidates(s.recordId);
    expect(prep.preview).not.toContain('김민준');
  });
});

describe('학생 참조 표식', () => {
  it('초안의 {{학생:ID}} 표식은 이름 → 임시 기호로 바뀌고 내부 ID가 전송 문안에 없다', async () => {
    const s = setup('openai');
    s.act('composition.add', { recordId: s.recordId, itemId: 'behavior-01', fragments: [{ text: '{{학생:s2}}와 함께 규칙을 정함.', source: { kind: 'manual' } }] });
    s.act('record.assemble', { recordId: s.recordId });
    s.act('record.setTarget', { recordId: s.recordId, target: 150 });
    const prep = await s.svc.preparePolish(s.recordId);
    expect(prep.preview).not.toContain('{{학생');
    expect(prep.preview).not.toMatch(/\bs2\b/);
    expect(prep.preview).not.toContain('이서연');
    expect(prep.preview).toMatch(/\[\[학생[A-Z]\]\]와 함께/);
  });
});

describe('모델 자동 선택', () => {
  it('Gemini는 권장 gemini-3.5-flash 또는 최신 정식 Flash. Claude는 권장 claude-sonnet-5-5, Codex는 CLI가 돌려준 순서의 첫 모델', async () => {
    const { pickAutoModel } = await import('../src/main/providers');
    const gem = ['gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-lite-preview', 'gemini-3.1-flash-image'];
    expect(pickAutoModel('gemini', gem)).toBe('gemini-3.5-flash');
    expect(pickAutoModel('gemini', ['gemini-3.1-flash', 'gemini-3.4-flash', 'gemini-3.4-flash-lite', 'gemini-3.9-flash-preview'])).toBe('gemini-3.4-flash');
    expect(pickAutoModel('gemini', [])).toBeNull();
    expect(pickAutoModel('anthropic', ['claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5'])).toBe('claude-sonnet-5-5');
    expect(pickAutoModel('anthropic', ['claude-opus-5-5', 'claude-sonnet-5'])).toBe('claude-sonnet-5');
    expect(pickAutoModel('openai', ['gpt-6.2-sol', 'gpt-6-luna'])).toBe('gpt-6.2-sol');
    expect(pickAutoModel('openai', [])).toBeNull();
  });
});
