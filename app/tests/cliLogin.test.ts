import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { allowedLoginUrl, CliLogin, findUrl, type LoginView } from '../src/main/cliLogin';
import { cliStatus, type CliRuntime } from '../src/main/providers';

/** 앱 버튼 로그인: 가짜 CLI(tests/fake-cli.mjs)로 Claude Code `auth login`과 Codex `app-server` 로그인 흐름을 확인한다. */
const FAKE = path.resolve(__dirname, 'fake-cli.mjs');
const made: { dir: string; login: CliLogin }[] = [];
afterEach(() => {
  for (const m of made.splice(0)) {
    m.login.cancelAll();
    fs.rmSync(m.dir, { recursive: true, force: true });
  }
});

function setup(o: { auto?: boolean; timeoutMs?: number } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitgeul-login-test-'));
  const rt: CliRuntime = { override: { anthropic: FAKE, openai: FAKE }, extraEnv: { MITGEUL_FAKE_CLI_STATE: dir, ...(o.auto ? { MITGEUL_FAKE_LOGIN_AUTO: '1' } : {}) } };
  const opened: string[] = [];
  const changes: string[] = [];
  const login = new CliLogin({ rt, openExternal: (u) => opened.push(u), onChange: (p) => changes.push(p), appVersion: '0.1.0', timeoutMs: o.timeoutMs });
  made.push({ dir, login });
  return { rt, login, opened, changes };
}

async function until(login: CliLogin, p: 'anthropic' | 'openai', pred: (v: LoginView) => boolean, ms = 10_000): Promise<LoginView> {
  const t0 = Date.now();
  for (;;) {
    const v = login.state(p);
    if (v && pred(v)) return v;
    if (Date.now() - t0 > ms) throw new Error(`시간 초과: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('구독 로그인 주소 검사', () => {
  it('공식 https 주소만 허용하고, 터미널 하이퍼링크 표시를 걷어 낸다', () => {
    expect(allowedLoginUrl('anthropic', 'https://claude.com/cai/oauth/authorize?x=1')).toContain('claude.com');
    expect(allowedLoginUrl('anthropic', 'http://claude.com/x')).toBeUndefined();
    expect(allowedLoginUrl('anthropic', 'https://evil.example/claude.com')).toBeUndefined();
    expect(allowedLoginUrl('openai', 'https://auth.openai.com/oauth/authorize')).toContain('auth.openai.com');
    expect(allowedLoginUrl('openai', 'https://claude.com/x')).toBeUndefined();
    expect(findUrl("visit: \x1b]8;;https://claude.com/a?b=1\x07https://claude.com/a?b=1\x1b]8;;\x07\nPaste")).toBe('https://claude.com/a?b=1');
  });
});

describe('Claude Code 로그인(claude auth login)', () => {
  it('브라우저 승인으로 끝나면 로그인 상태가 되고, 로그아웃하면 풀린다', async () => {
    const { rt, login, changes } = setup({ auto: true });
    expect((await cliStatus('anthropic', rt)).loggedIn).toBe(false);
    const v = login.start('anthropic', 'browser');
    expect(v).toMatchObject({ provider: 'anthropic', phase: 'waiting', acceptsCode: true });
    expect((await until(login, 'anthropic', (x) => x.phase !== 'waiting')).phase).toBe('done');
    expect((await cliStatus('anthropic', rt)).loggedIn).toBe(true);
    await login.logout('anthropic');
    expect((await cliStatus('anthropic', rt)).loggedIn).toBe(false);
    expect(changes).toEqual(['anthropic', 'anthropic']);
  });

  it('브라우저에 나온 코드를 앱에서 넣으면 CLI 표준입력으로 넘겨 로그인한다', async () => {
    const { rt, login } = setup();
    login.start('anthropic', 'browser');
    const w = await until(login, 'anthropic', (x) => !!x.url);
    expect(w.url).toBe('https://claude.com/cai/oauth/authorize?code=true&fake=1');
    expect(() => login.submitCode('anthropic', 'abc def')).toThrow('공백');
    expect(login.submitCode('anthropic', ' good-code#state ').codeSent).toBe(true);
    expect((await until(login, 'anthropic', (x) => x.phase !== 'waiting')).phase).toBe('done');
    expect((await cliStatus('anthropic', rt)).loggedIn).toBe(true);
  });

  it('틀린 코드는 한국어 안내와 함께 실패하고 로그인 상태는 그대로다', async () => {
    const { rt, login } = setup();
    login.start('anthropic', 'browser');
    await until(login, 'anthropic', (x) => !!x.url);
    login.submitCode('anthropic', 'wrong#code');
    const v = await until(login, 'anthropic', (x) => x.phase !== 'waiting');
    expect(v.phase).toBe('failed');
    expect(v.message).toContain('코드가 받아들여지지 않았습니다');
    expect((await cliStatus('anthropic', rt)).loggedIn).toBe(false);
    expect(() => login.submitCode('anthropic', 'again')).toThrow('진행 중이 아닙니다');
  });

  it('제한 시간이 지나면 멈추고, 취소하면 취소 상태가 된다', async () => {
    const { login } = setup({ timeoutMs: 400 });
    login.start('anthropic', 'browser');
    expect((await until(login, 'anthropic', (x) => x.phase !== 'waiting')).message).toContain('시간');
    const { login: l2 } = setup();
    l2.start('anthropic', 'browser');
    l2.cancel('anthropic');
    expect(l2.state('anthropic')?.phase).toBe('cancelled');
  });
});

describe('Codex 로그인(codex app-server)', () => {
  it('받은 로그인 주소를 브라우저로 열고, 완료 알림이 오면 로그인 상태가 된다', async () => {
    const { rt, login, opened } = setup({ auto: true });
    expect((await cliStatus('openai', rt)).loggedIn).toBe(false);
    login.start('openai', 'browser');
    const v = await until(login, 'openai', (x) => x.phase !== 'waiting');
    expect(v.phase).toBe('done');
    expect(opened).toEqual(['https://auth.openai.com/oauth/authorize?fake=1']);
    expect((await cliStatus('openai', rt)).loggedIn).toBe(true);
    await login.logout('openai');
    expect((await cliStatus('openai', rt)).loggedIn).toBe(false);
  });

  it('기기 코드 방식은 코드·주소를 보여 주고 브라우저는 열지 않으며, 취소하면 앱 서버에 취소를 보낸다', async () => {
    const { rt, login, opened } = setup();
    login.start('openai', 'device');
    const v = await until(login, 'openai', (x) => !!x.userCode);
    expect(v).toMatchObject({ method: 'device', userCode: 'FAKE-1234', url: 'https://auth.openai.com/codex/device' });
    expect(opened).toEqual([]);
    login.openUrl('openai');
    expect(opened).toEqual(['https://auth.openai.com/codex/device']);
    login.cancel('openai');
    expect(login.state('openai')?.phase).toBe('cancelled');
    expect((await cliStatus('openai', rt)).loggedIn).toBe(false);
  });
});
