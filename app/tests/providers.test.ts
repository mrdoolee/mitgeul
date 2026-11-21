import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callProvider, cliStatus, findCli, guardCliPayload, listModels, ProviderError, testModel, type CliRuntime } from '../src/main/providers';

const FAKE = path.resolve(__dirname, 'fake-cli.mjs');
let server: http.Server;
let base = '';
let reply: (body: any) => { status?: number; text?: string; error?: string; delayMs?: number } = () => ({ text: '{"ok":true}' });
const bodies: any[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const body = JSON.parse(raw);
      bodies.push({ url: req.url, ...body });
      const r = reply(body);
      if (r.delayMs) await new Promise((ok) => setTimeout(ok, r.delayMs));
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.error !== undefined ? { error: { message: r.error } } : { text: r.text }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

const rt = (): CliRuntime => ({ override: { anthropic: FAKE, openai: FAKE }, extraEnv: { MITGEUL_FAKE_CLI_BASE: base } });
const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };

describe('구독 CLI 전송 경계', () => {
  it('실행 전 검사: 확인 문안과 다르거나 명단 이름이 인수에 있으면 막는다', () => {
    const c = { system: 'S', user: 'U', forbidden: ['김민준'] };
    expect(() => guardCliPayload(c, { system: 'S', user: 'U', extra: ['--model', 'x'] })).not.toThrow();
    expect(() => guardCliPayload(c, { system: 'S2', user: 'U', extra: [] })).toThrow('확인한 문안');
    expect(() => guardCliPayload(c, { system: 'S', user: 'U', extra: ['김민준'] })).toThrow('이름');
  });

  it('요청 본문에 이름이 남아 있으면 CLI를 실행하지 않는다', async () => {
    const before = bodies.length;
    const err = await callProvider({ provider: 'anthropic', model: 'm', confirmed: { system: 'S', user: '김민준 관찰', forbidden: ['김민준'] }, schema, schemaName: 't', ...rt() }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe('guard');
    expect(bodies.length).toBe(before);
  });

  it.each(['anthropic', 'openai'] as const)('%s: 스키마 JSON 응답과 사용 모델을 돌려주고 임시 폴더를 지운다', async (provider) => {
    reply = () => ({ text: '{"ok":true}' });
    const r = await callProvider({ provider, model: 'model-x', confirmed: { system: '시스템 지시', user: '요청 본문', forbidden: [] }, schema, schemaName: 't', ...rt() });
    expect(JSON.parse(r.text)).toEqual({ ok: true });
    expect(r.model).toBe('model-x');
    const last = bodies.at(-1);
    expect(last.system).toBe('시스템 지시');
    expect(last.user).toBe('요청 본문');
    expect(last.schema.additionalProperties).toBe(false);
    // 이 호출이 쓴 임시 폴더(시스템 지시 파일이 있던 곳)는 끝나면 지운다
    const args: string[] = last.args;
    const sys = provider === 'anthropic' ? args[args.indexOf('--system-prompt-file') + 1]! : JSON.parse(args[args.indexOf('-c') + 1]!.replace(/^model_instructions_file=/, ''));
    expect(path.basename(path.dirname(sys))).toMatch(/^mitgeul-cli-/);
    expect(fs.existsSync(path.dirname(sys))).toBe(false);
  });

  it.each([
    [401, 'Not logged in · Please run /login', 'auth'],
    [429, 'You have hit your usage limit', 'rate'],
    [404, "There's an issue with the selected model", 'model'],
    [529, 'Overloaded', 'server'],
  ] as const)('Claude 오류 %s → %s 분류', async (status, error, code) => {
    reply = () => ({ status, error });
    const err = await callProvider({ provider: 'anthropic', model: 'm', confirmed: { system: 'S', user: 'U', forbidden: [] }, schema, schemaName: 't', ...rt() }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe(code);
  });

  it('Codex 오류(ChatGPT 계정 미지원 모델)는 model로 분류하고 오류의 이름을 가린다', async () => {
    reply = () => ({ status: 400, error: "The 'gpt-5.4-mini' model is not supported when using Codex with a ChatGPT account. 김민준" });
    const err = await callProvider({ provider: 'openai', model: 'gpt-5.4-mini', confirmed: { system: 'S', user: 'U', forbidden: ['김민준'] }, schema, schemaName: 't', ...rt() }).catch((e) => e);
    expect(err.code).toBe('model');
    expect(String(err.message)).not.toContain('김민준');
  });

  it('시간 초과와 취소는 CLI 프로세스를 끝내고 timeout·cancelled로 알린다', async () => {
    reply = () => ({ text: '{"ok":true}', delayMs: 4000 });
    const t = await callProvider({ provider: 'anthropic', model: 'm', confirmed: { system: 'S', user: 'U', forbidden: [] }, schema, schemaName: 't', timeoutMs: 800, ...rt() }).catch((e) => e);
    expect(t.code).toBe('timeout');
    const ac = new AbortController();
    const p = callProvider({ provider: 'openai', model: 'm', confirmed: { system: 'S', user: 'U', forbidden: [] }, schema, schemaName: 't', signal: ac.signal, ...rt() }).catch((e) => e);
    setTimeout(() => ac.abort(), 500);
    expect((await p).code).toBe('cancelled');
  }, 15_000);

  it('CLI가 없으면 cli 오류로 설치 안내를 준다', async () => {
    const err = await callProvider({ provider: 'anthropic', model: 'm', confirmed: { system: 'S', user: 'U', forbidden: [] }, schema, schemaName: 't', override: { anthropic: path.join(os.tmpdir(), 'no-such-claude.exe') } }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe('cli');
  });

  it('Gemini는 CLI를 쓰지 않고 API 키 방식을 유지한다(키 없으면 auth, 이름이 남으면 guard)', async () => {
    const before = bodies.length;
    const noKey = await callProvider({ provider: 'gemini', model: 'm', confirmed: { system: 'S', user: 'U', forbidden: [] }, schema, schemaName: 't', ...rt() }).catch((e) => e);
    expect(noKey.code).toBe('auth');
    const seen: string[] = [];
    const fake = (async (url: string) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }], modelVersion: 'gemini-x' }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await callProvider({ provider: 'gemini', apiKey: 'AIza-test-key-123456', model: 'gemini-x', confirmed: { system: 'S', user: 'U', forbidden: [] }, schema, schemaName: 't', fetchImpl: fake });
    expect(r).toEqual({ text: '{"ok":true}', model: 'gemini-x' });
    expect(seen[0]).toMatch(/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-x:generateContent$/);
    const bad = await callProvider({ provider: 'gemini', apiKey: 'AIza-test-key-123456', model: 'gemini-x', confirmed: { system: 'S', user: '김민준 관찰', forbidden: ['김민준'] }, schema, schemaName: 't', fetchImpl: fake }).catch((e) => e);
    expect(bad.code).toBe('guard');
    expect(bodies.length).toBe(before); // 가짜 CLI는 실행되지 않음
  });

  it('추론 강도: Claude는 --effort, Codex는 model_reasoning_effort로 넘기고, 없으면 넘기지 않으며 알 수 없는 값은 실행 전에 막는다', async () => {
    reply = () => ({ text: '{"ok":true}' });
    const c = { system: 'S', user: 'U', forbidden: [] };
    await callProvider({ provider: 'anthropic', model: 'm', effort: 'xhigh', confirmed: c, schema, schemaName: 't', ...rt() });
    let args: string[] = bodies.at(-1).args;
    expect(args[args.indexOf('--effort') + 1]).toBe('xhigh');
    await callProvider({ provider: 'openai', model: 'm', effort: 'medium', confirmed: c, schema, schemaName: 't', ...rt() });
    args = bodies.at(-1).args;
    expect(args[args.indexOf('model_reasoning_effort="medium"') - 1]).toBe('-c');
    await callProvider({ provider: 'anthropic', model: 'm', confirmed: c, schema, schemaName: 't', ...rt() });
    expect(bodies.at(-1).args).not.toContain('--effort');
    await testModel('openai', 'm', { ...rt(), effort: 'low' });
    expect(bodies.at(-1).args).toContain('model_reasoning_effort="low"');
    const before = bodies.length;
    const bad = await callProvider({ provider: 'openai', model: 'm', effort: 'ultra' as never, confirmed: c, schema, schemaName: 't', ...rt() }).catch((e) => e);
    expect(bad).toBeInstanceOf(ProviderError);
    expect(bad.code).toBe('request');
    expect(bodies.length).toBe(before);
  });

  it('상태 확인·모델 목록·모델 테스트', async () => {
    expect(await cliStatus('anthropic', rt())).toMatchObject({ installed: true, loggedIn: true });
    expect(await cliStatus('openai', rt())).toMatchObject({ installed: true, loggedIn: true });
    const out = await cliStatus('openai', { ...rt(), extraEnv: { ...rt().extraEnv, MITGEUL_FAKE_LOGGED_OUT: '1' } });
    expect(out.loggedIn).toBe(false);
    expect(await listModels('openai', rt())).toEqual(['codex-test-a', 'codex-test-b']);
    expect((await listModels('anthropic', rt()))[0]).toBe('claude-sonnet-5-5');
    reply = () => ({ text: '{"ok":true}' });
    expect((await testModel('anthropic', 'claude-sonnet-5-5', rt())).model).toBe('claude-sonnet-5-5');
    expect(findCli('anthropic', rt())).toBe(FAKE);
  });
});
