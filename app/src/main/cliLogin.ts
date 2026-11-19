import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import os from 'node:os';
import type { Provider } from '../core/schema';
import { childEnv, cliMissing, findCli, killTree, runCli, sanitize, type CliRuntime } from './providers';

/**
 * 앱 버튼으로 구독 CLI 로그인·로그아웃.
 * - Claude: 이 PC의 Claude Code에서 `claude auth login --claudeai`를 화면 없이 실행한다. CLI가 기본 브라우저에 로그인 화면을 연다.
 *   브라우저에 코드가 나오면 교사가 앱 입력란에 붙여 넣고, 앱은 그 코드를 CLI 표준입력으로 넘긴다.
 * - ChatGPT: 이 PC의 Codex CLI 앱 서버(`codex app-server`, JSON-RPC)에 `account/login/start`를 보내 받은 로그인 주소를 기본 브라우저로 연다.
 *   브라우저 로그인이 어려우면 기기 코드 방식(`chatgptDeviceCode`)으로 코드와 주소를 앱에 보여 준다.
 * 로그인 정보는 각 CLI가 저장한다. 앱은 토큰·자격 증명 파일을 읽거나 보관하지 않고, 로그인 주소·기기 코드만 화면에 보여 준다.
 */

export type LoginProvider = 'anthropic' | 'openai';
export type LoginMethod = 'browser' | 'device';
export type LoginPhase = 'waiting' | 'done' | 'failed' | 'cancelled';

export interface LoginView {
  provider: LoginProvider;
  method: LoginMethod;
  phase: LoginPhase;
  /** 브라우저가 열리지 않을 때 직접 열 로그인 주소(허용한 공식 주소만) */
  url?: string;
  /** ChatGPT 기기 코드 방식에서 브라우저에 입력할 일회용 코드 */
  userCode?: string;
  /** Claude: 브라우저에 나온 코드를 받을 수 있는 상태 */
  acceptsCode?: boolean;
  /** 코드를 넣은 뒤 확인 중 */
  codeSent?: boolean;
  message?: string;
}

export const LOGIN_TIMEOUT_MS = 10 * 60_000;

/** 로그인 주소로 허용하는 공식 호스트(https만) */
const LOGIN_HOSTS: Record<LoginProvider, RegExp> = {
  anthropic: /^(claude\.com|claude\.ai|platform\.claude\.com|console\.anthropic\.com)$/i,
  openai: /^(auth\.openai\.com|chatgpt\.com)$/i,
};
export function allowedLoginUrl(provider: LoginProvider, raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && LOGIN_HOSTS[provider].test(u.hostname) ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** 터미널 하이퍼링크(OSC 8)·색 코드를 걷어 내고 첫 https 주소를 찾는다. */
export function findUrl(text: string): string | undefined {
  const plain = text.replace(/\x1b\]8;[^;]*;([^\x07\x1b]*)(\x07|\x1b\\)/g, ' $1 ').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  return plain.match(/https:\/\/[^\s\x07\x1b"'<>]+/)?.[0];
}

/** CLI 오류 문구를 교사용 한국어로 */
function loginError(provider: LoginProvider, raw: string): string {
  const t = raw.trim();
  if (/code wasn.t accepted|invalid code|incomplete, expired/i.test(t)) return '코드가 받아들여지지 않았습니다. 코드가 덜 복사됐거나, 만료됐거나, 이전 로그인 시도의 코드입니다. [다시 로그인]을 눌러 새로 시작하세요.';
  if (/timed? ?out|expired/i.test(t)) return '로그인 시간이 지났습니다. [다시 로그인]을 눌러 새로 시작하세요.';
  if (/network|ENOTFOUND|ECONNREFUSED|fetch failed/i.test(t)) return '네트워크 연결 오류로 로그인하지 못했습니다. 인터넷 연결을 확인하고 다시 시도하세요.';
  const label = provider === 'anthropic' ? 'Claude Code' : 'Codex';
  return `${label} 로그인이 끝나지 않았습니다.${t ? ` (${sanitize(t, []).slice(0, 200)})` : ''} [다시 로그인]을 눌러 새로 시작하세요.`;
}

interface Session {
  view: LoginView;
  child: ChildProcessWithoutNullStreams;
  timer: NodeJS.Timeout;
  /** 끝났을 때 한 번 */
  finish: (phase: LoginPhase, message?: string) => void;
  sendCode?: (code: string) => void;
  cancel: () => void;
}

export interface LoginDeps {
  rt: CliRuntime;
  /** 기본 브라우저로 열기(주 프로세스의 shell.openExternal). 시험에서는 기록만 한다. */
  openExternal: (url: string) => void;
  /** 로그인·로그아웃이 끝나면(상태 캐시 갱신용) */
  onChange: (provider: LoginProvider) => void;
  appVersion: string;
  timeoutMs?: number;
}

function spawnCli(file: string, args: string[], rt: CliRuntime): ChildProcessWithoutNullStreams {
  const script = /\.(c|m)?js$/i.test(file);
  const env = childEnv(rt);
  if (script) env.ELECTRON_RUN_AS_NODE = '1';
  // 작업 폴더는 임시 폴더: 앱을 띄운 폴더의 프로젝트 설정이 끼어들지 않게 한다.
  return spawn(script ? process.execPath : file, script ? [file, ...args] : args, { cwd: os.tmpdir(), env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
}

export class CliLogin {
  private sessions = new Map<LoginProvider, Session>();
  constructor(private deps: LoginDeps) {}

  state(provider: LoginProvider): LoginView | null {
    const s = this.sessions.get(provider);
    return s ? { ...s.view } : null;
  }

  /** 진행 중인 로그인을 끝낸다(앱 종료·새 로그인 시작). */
  cancel(provider: LoginProvider) {
    const s = this.sessions.get(provider);
    if (s && s.view.phase === 'waiting') s.cancel();
  }
  cancelAll() {
    for (const p of [...this.sessions.keys()]) this.cancel(p);
  }

  start(provider: LoginProvider, method: LoginMethod): LoginView {
    const file = findCli(provider, this.deps.rt);
    if (!file) throw cliMissing(provider);
    this.cancel(provider);
    const s = provider === 'anthropic' ? this.startClaude(file) : this.startCodex(file, method);
    this.sessions.set(provider, s);
    return { ...s.view };
  }

  submitCode(provider: LoginProvider, code: string): LoginView {
    const s = this.sessions.get(provider);
    if (!s || s.view.phase !== 'waiting' || !s.sendCode) throw new Error('코드를 받을 로그인이 진행 중이 아닙니다. [로그인]을 다시 누르세요.');
    const c = String(code ?? '').trim();
    if (!c || c.length > 1000 || /[\r\n\s]/.test(c)) throw new Error('브라우저에 나온 코드 전체를 그대로 붙여 넣으세요(공백·줄바꿈 없이).');
    s.sendCode(c);
    return { ...s.view };
  }

  openUrl(provider: LoginProvider) {
    const s = this.sessions.get(provider);
    const url = allowedLoginUrl(provider, s?.view.url);
    if (!url) throw new Error('열 수 있는 로그인 주소가 없습니다. [로그인]을 다시 누르세요.');
    this.deps.openExternal(url);
  }

  async logout(provider: LoginProvider): Promise<void> {
    this.cancel(provider);
    const file = findCli(provider, this.deps.rt);
    if (!file) throw cliMissing(provider);
    const args = provider === 'anthropic' ? ['auth', 'logout'] : ['logout'];
    try {
      const r = await runCli(file, args, { timeoutMs: 20_000, rt: this.deps.rt, cwd: os.tmpdir() });
      // Codex는 이미 로그아웃 상태면 0이 아닌 코드로 끝날 수 있어 상태 확인으로 판단한다(호출한 쪽에서 다시 확인).
      if (r.code !== 0 && provider === 'anthropic') throw new Error(`Claude Code 로그아웃이 실패했습니다. ${sanitize(r.stderr || r.stdout, []).slice(0, 200)}`);
    } finally {
      this.deps.onChange(provider);
    }
  }

  private session(provider: LoginProvider, method: LoginMethod, child: ChildProcessWithoutNullStreams, onCancel?: () => void): Session {
    const view: LoginView = { provider, method, phase: 'waiting' };
    const s: Session = {
      view,
      child,
      timer: setTimeout(() => s.finish('failed', '로그인 시간(10분)이 지나 멈췄습니다. [다시 로그인]을 눌러 새로 시작하세요.'), this.deps.timeoutMs ?? LOGIN_TIMEOUT_MS),
      finish: (phase, message) => {
        if (view.phase !== 'waiting') return;
        view.phase = phase;
        view.message = message;
        view.acceptsCode = false;
        clearTimeout(s.timer);
        killTree(child.pid);
        this.deps.onChange(provider);
      },
      cancel: () => {
        onCancel?.();
        s.finish('cancelled', '로그인을 취소했습니다.');
      },
    };
    s.timer.unref?.();
    child.on('error', (e) => s.finish('failed', `CLI를 실행하지 못했습니다. ${e.message}`));
    child.stdin.on('error', () => undefined);
    return s;
  }

  private startClaude(file: string): Session {
    const child = spawnCli(file, ['auth', 'login', '--claudeai'], this.deps.rt);
    const s = this.session('anthropic', 'browser', child);
    s.view.acceptsCode = true;
    let out = '';
    let err = '';
    child.stdout.on('data', (b: Buffer) => {
      out += b.toString('utf8');
      if (!s.view.url) s.view.url = allowedLoginUrl('anthropic', findUrl(out));
    });
    child.stderr.on('data', (b: Buffer) => (err += b.toString('utf8')));
    child.on('close', (code) => {
      if (code === 0) s.finish('done', 'Claude 구독 계정으로 로그인했습니다.');
      else s.finish('failed', loginError('anthropic', err.replace(/^.*?Couldn't log in:\s*/s, '') || out.split(/\r?\n/).filter(Boolean).at(-1) || ''));
    });
    s.sendCode = (code) => {
      s.view.codeSent = true;
      s.view.acceptsCode = false;
      child.stdin.write(`${code}\n`);
    };
    return s;
  }

  private startCodex(file: string, method: LoginMethod): Session {
    const child = spawnCli(file, ['app-server'], this.deps.rt);
    let loginId: string | undefined;
    let nextId = 1;
    const send = (m: object) => {
      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
      } catch {
        /* 끝난 프로세스 */
      }
    };
    const s = this.session('openai', method, child, () => loginId && send({ id: nextId++, method: 'account/login/cancel', params: { loginId } }));
    let buf = '';
    let stderr = '';
    child.stderr.on('data', (b: Buffer) => (stderr = (stderr + b.toString('utf8')).slice(-2000)));
    child.stdout.on('data', (b: Buffer) => {
      buf += b.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let m: any;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.id === 1) {
          if (m.error) return s.finish('failed', loginError('openai', String(m.error?.message ?? '')));
          send({ method: 'initialized' });
          send({ id: 2, method: 'account/login/start', params: { type: method === 'device' ? 'chatgptDeviceCode' : 'chatgpt' } });
          nextId = 3;
        } else if (m.id === 2) {
          if (m.error) return s.finish('failed', loginError('openai', String(m.error?.message ?? '')));
          const r = m.result ?? {};
          loginId = r.loginId;
          if (method === 'device') {
            s.view.url = allowedLoginUrl('openai', r.verificationUrl);
            s.view.userCode = typeof r.userCode === 'string' && /^[A-Za-z0-9-]{4,20}$/.test(r.userCode) ? r.userCode : undefined;
            if (!s.view.url || !s.view.userCode) return s.finish('failed', '기기 코드를 받지 못했습니다. 브라우저 로그인으로 다시 시도하세요.');
          } else {
            s.view.url = allowedLoginUrl('openai', r.authUrl);
            if (!s.view.url) return s.finish('failed', '로그인 주소를 받지 못했습니다. 다시 시도하세요.');
            this.deps.openExternal(s.view.url);
          }
        } else if (m.method === 'account/login/completed') {
          const p = m.params ?? {};
          if (loginId && p.loginId && p.loginId !== loginId) continue;
          if (p.success) s.finish('done', 'ChatGPT 계정으로 로그인했습니다.');
          else if (s.view.phase === 'waiting') s.finish('failed', loginError('openai', String(p.error ?? '')));
        }
      }
    });
    child.on('close', () => s.finish('failed', loginError('openai', stderr.split(/\r?\n/).filter(Boolean).at(-1) ?? '')));
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'mitgeul', title: 'MITGEUL', version: this.deps.appVersion } } });
    return s;
  }
}

export const isLoginProvider = (p: unknown): p is LoginProvider => p === 'anthropic' || p === 'openai';
export type { Provider };
