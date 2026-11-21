import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EFFORTS, type Effort, type Provider } from '../core/schema';
import { RECOMMENDED_MODEL } from '../core/recommended';

/**
 * 단일 LLM 전송 경계.
 * - Gemini는 API 키 방식(HTTP)이다. 전송은 guardedFetch(허용 호스트, 헤더 키, 확인 문안·이름 잔존 검사)를 지난다.
 * - Claude는 Claude Code `claude -p`, ChatGPT는 Codex `codex exec`를 이 PC에 로그인한 교사 본인 계정으로 실행한다.
 * - API 키는 쓰지 않는다. 자격 증명 파일을 읽거나 복사하지 않는다. 로그인은 설정 화면 버튼이 각 CLI의 로그인 기능을 실행해 한다(cliLogin.ts).
 * - CLI에 넘기는 시스템 지시·요청 본문이 교사가 확인한 문안 그대로인지, 명단 이름이 남지 않았는지 실행 전에 검사한다(guardCliPayload).
 * - CLI는 빈 임시 폴더에서 도구·사용자 설정·MCP·세션 저장 없이 실행한다.
 *   그래도 CLI가 계정·환경 정보(작업 폴더, OS, 날짜, CLI 지침 등)를 덧붙여 보내는 것은 막을 수 없다(설정 화면에서 안내).
 * - 자동 재시도 없음. 오류 메시지는 종류와 정제된 요약만 남긴다.
 */

export const PROVIDER_LABEL: Record<Provider, string> = {
  gemini: 'Google Gemini (API 키)',
  openai: 'ChatGPT (Codex CLI 구독)',
  anthropic: 'Claude (Claude Code 구독)',
};
export const CLI_COMMAND: Record<Provider, string> = { gemini: '', openai: 'codex', anthropic: 'claude' };
/** CLI는 프로세스 시작 시간이 더해져 Gemini(API)보다 길게 기다린다 */
export const DEFAULT_TIMEOUT_MS = 180_000;
/**
 * Codex는 요청마다 코딩용 도구 정의·스킬 목록·에이전트 지시를 덧붙인다(시험 문장 기준 입력 약 11,500토큰). 글쓰기에는 필요 없는 도구를 꺼
 * 약 6,250토큰으로 줄인다(Codex 0.169.0, 2026-11-19 실측). 모르는 이름은 Codex가 무시하고 경고만 낸다.
 * 스킬 목록 일부와 에이전트 도구는 끄는 정식 설정이 없어 남는다(개발 중 기능 omit_skill_descriptions는 불안정 경고가 있어 쓰지 않는다).
 */
export const CODEX_LEAN_CONFIG = [
  ...['shell_tool', 'unified_exec', 'image_generation', 'apps', 'plugins', 'multi_agent', 'goals', 'sleep_tool', 'tool_suggest', 'browser_use', 'computer_use', 'skill_search', 'hooks'].map((f) => `features.${f}=false`),
  'skills.bundled.enabled=false',
  'tools.web_search=false',
];
export const GEMINI_TIMEOUT_MS = 120_000;
/** 구독 CLI로 부르는 제공자(Claude·ChatGPT). Gemini는 API 키로 부른다. */
export const usesCli = (p: Provider): boolean => p === 'anthropic' || p === 'openai';

/** Claude Code는 모델 목록 명령이 없어 앱이 아는 별칭·모델을 보여 준다. 설정에서 직접 입력한 모델도 그대로 쓴다. */
export const CLAUDE_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'];

export function pickAutoModel(provider: Provider, models: string[]): string | null {
  if (RECOMMENDED_MODEL[provider] && models.includes(RECOMMENDED_MODEL[provider])) return RECOMMENDED_MODEL[provider];
  if (provider === 'gemini') {
    // 최신 정식 Flash → Flash-Lite. 미리 보기·실험·음성·이미지 모델은 자동 선택에서 뺀다.
    const ver = (m: string) => (m.match(/(\d+(?:\.\d+)?)/)?.[1] ? Number(m.match(/(\d+(?:\.\d+)?)/)![1]) : 0);
    const newest = (list: string[]) => [...list].sort((a, b) => ver(b) - ver(a) || a.localeCompare(b))[0] ?? null;
    const bad = /(preview|exp|tts|image|audio|live|embedding|omni|robotics|computer|native|thinking|realtime|transcribe|search|codex|nano|instruct)/i;
    const ok = models.filter((m) => /^gemini-\d/.test(m) && !bad.test(m));
    return newest(ok.filter((m) => /-flash$/.test(m))) ?? newest(ok.filter((m) => /-flash-lite$/.test(m))) ?? newest(ok);
  }
  if (provider === 'anthropic') return models.find((m) => /^claude-sonnet/.test(m)) ?? models[0] ?? null;
  // Codex: CLI가 돌려준 순서(우선순위)의 첫 모델
  return models[0] ?? null;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: 'auth' | 'rate' | 'blocked' | 'format' | 'network' | 'server' | 'request' | 'guard' | 'cancelled' | 'truncated' | 'timeout' | 'model' | 'cli',
    readonly status?: number,
  ) {
    super(message);
  }
}

export interface Confirmed {
  system: string;
  user: string;
  /** 전송 직전 본문에 남으면 안 되는 이름 목록(명단 전체) */
  forbidden: string[];
}

export interface CliRuntime {
  /** 개발·시험 전용: 실제 CLI 대신 실행할 파일(.js/.mjs는 Node로 실행). 패키징된 앱에서는 main이 넘기지 않는다. */
  override?: Partial<Record<Provider, string>>;
  /** 개발·시험 전용: CLI 프로세스에 더할 환경 변수 */
  extraEnv?: Record<string, string>;
  /** 개발·시험 전용(Gemini): 모의 서버 주소. 패키징된 앱에서는 main이 넘기지 않는다. */
  baseUrlOverride?: string;
  fetchImpl?: typeof fetch;
}

export interface CallOptions extends CliRuntime {
  /** Gemini 전용 API 키(CLI 제공자는 쓰지 않는다) */
  apiKey?: string;
  provider: Provider;
  model: string;
  /** CLI 제공자 추론 강도. 없으면 CLI 기본값. Gemini는 무시한다. */
  effort?: Effort;
  confirmed: Confirmed;
  schema: Record<string, unknown>;
  schemaName: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface CallResult {
  text: string;
  model: string;
}

function stripCounts(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripCounts);
  if (schema && typeof schema === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === 'minItems' || k === 'maxItems') continue;
      out[k] = stripCounts(v);
    }
    if (out.type === 'object' && !('additionalProperties' in out)) out.additionalProperties = false;
    return out;
  }
  return schema;
}

/**
 * 실행 직전 검사: CLI에 넘길 시스템 지시·요청 본문이 확인한 문안과 같은지, 넘기는 모든 값(인수·파일·표준입력)에 명단 이름이 없는지 본다.
 */
export function guardCliPayload(confirmed: Confirmed, payload: { system: string; user: string; extra: string[] }): void {
  if (payload.system !== confirmed.system || payload.user !== confirmed.user) throw new ProviderError('전송 본문이 확인한 문안과 달라 전송을 막았습니다.', 'guard');
  const all = [payload.system, payload.user, ...payload.extra].join('\n');
  const leaked = confirmed.forbidden.filter((n) => n.length >= 2 && all.includes(n));
  if (leaked.length) throw new ProviderError('전송 본문에 명단의 이름이 남아 있어 전송을 막았습니다.', 'guard');
}

export function sanitize(msg: unknown, forbidden: string[]): string {
  let s = String(msg ?? '').slice(0, 300);
  for (const n of forbidden) if (n.length >= 2) s = s.split(n).join('[이름]');
  return s
    .replace(/(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]+/g, '$1…')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[이메일]')
    .replace(/[A-Za-z]:\\Users\\[^\\\s"]+/gi, 'C:\\Users\\…');
}

const LOGIN_HINT: Record<Provider, string> = {
  anthropic: '설정 > AI 연결에서 [Claude 로그인]을 눌러 다시 로그인한 뒤 다시 시도하세요.',
  openai: '설정 > AI 연결에서 [ChatGPT 로그인]을 눌러 다시 로그인한 뒤 다시 시도하세요.',
  gemini: '',
};

function classify(provider: Provider, status: number | undefined, detail: string): ProviderError {
  const d = detail;
  if (/not logged in|please (run )?(\/)?log ?in|login required|unauthori[sz]ed|authenticat|credential|401|403/i.test(d) || status === 401 || status === 403) {
    return new ProviderError(`CLI 로그인이 필요하거나 만료되었습니다. ${LOGIN_HINT[provider]} ${d}`.trim(), 'auth', status);
  }
  if (status === 404 || /unrecognized_model|not supported|model.*(not found|does not exist|issue with the selected model)|invalid model/i.test(d)) {
    return new ProviderError(`이 모델을 지금 쓸 수 없습니다. 설정 > AI 제공자에서 [모델 목록 불러오기]로 다른 모델을 고르고 [모델 테스트] 후 저장하세요. ${d}`.trim(), 'model', status);
  }
  if (status === 429 || /rate.?limit|usage limit|too many requests|quota|limit reached|hit your limit/i.test(d)) {
    return new ProviderError(`구독 사용 한도에 걸렸습니다${status ? `(${status})` : ''}. 잠시 뒤 다시 시도하거나 요금제 한도를 확인하세요. ${d}`.trim(), 'rate', status);
  }
  if (status === 529 || status === 503 || /overloaded|busy|unavailable/i.test(d)) {
    return new ProviderError(`모델이 혼잡합니다${status ? `(${status})` : ''}. 잠시 뒤 다시 요청하거나 설정에서 다른 모델·다른 제공자를 고르세요. ${d}`.trim(), 'server', status);
  }
  if (status && status >= 500) return new ProviderError(`제공자 서버 오류(${status}). ${d}`.trim(), 'server', status);
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|network|connection|fetch failed|stream disconnected/i.test(d)) return new ProviderError(`네트워크 연결 오류입니다. ${d}`.trim(), 'network', status);
  return new ProviderError(`CLI 요청 오류${status ? `(${status})` : ''}: ${d || '알 수 없는 오류'}`, 'request', status);
}

// ── Gemini(API 키, HTTP) ─────────────────────────────

const GEMINI_HOST = 'https://generativelanguage.googleapis.com';

/** JSON 문자열 안에 그대로 들어간 형태(따옴표 제외)로 직렬화 */
function jsonFragment(s: string): string {
  return JSON.stringify(s).slice(1, -1);
}

function hostOf(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}`;
}

export function makeGuardedFetch(opts: { confirmed: Confirmed; baseUrlOverride?: string; fetchImpl?: typeof fetch }, onSend?: (info: { url: string; body: string }) => void): typeof fetch {
  const allowed = opts.baseUrlOverride ? hostOf(opts.baseUrlOverride) : GEMINI_HOST;
  const base = opts.fetchImpl ?? fetch;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (hostOf(url) !== allowed) throw new ProviderError('허용되지 않은 주소로의 전송을 막았습니다.', 'guard');
    if (/[?&](key|api_key|apikey)=/i.test(url)) throw new ProviderError('API 키를 주소에 넣는 요청을 막았습니다.', 'guard');
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'POST') {
      const body = typeof init?.body === 'string' ? init.body : init?.body ? new TextDecoder().decode(init.body as ArrayBuffer) : '';
      if (!body.includes(jsonFragment(opts.confirmed.user)) || !body.includes(jsonFragment(opts.confirmed.system))) {
        throw new ProviderError('전송 본문이 확인한 문안과 달라 전송을 막았습니다.', 'guard');
      }
      const leaked = opts.confirmed.forbidden.filter((n) => n.length >= 2 && body.includes(n));
      if (leaked.length) throw new ProviderError('전송 본문에 명단의 이름이 남아 있어 전송을 막았습니다.', 'guard');
      onSend?.({ url, body });
    }
    return base(input as RequestInfo, init);
  }) as typeof fetch;
}

function statusError(status: number, detail: string): ProviderError {
  if (status === 404 || /no longer available|not found|does not exist|deprecated/i.test(detail)) return new ProviderError(`이 모델을 지금 쓸 수 없습니다(${status}). 설정 > AI 제공자에서 [모델 목록 불러오기]로 지금 쓸 수 있는 모델을 고르고 [모델 테스트] 후 저장하세요. ${detail}`, 'model', status);
  if (status === 503) return new ProviderError(`모델이 혼잡합니다(503). 제공자 쪽 일시 현상일 수 있습니다. 잠시 뒤 다시 요청하거나, 설정에서 다른 모델·다른 제공자를 고르세요.`, 'server', status);
  if (status === 401 || status === 403) return new ProviderError(`인증 실패(${status}): API 키와 권한을 확인하세요. ${detail}`, 'auth', status);
  if (status === 429) return new ProviderError(`요청 한도 초과(429): 잠시 뒤 다시 시도하거나 요금제·한도를 확인하세요. ${detail}`, 'rate', status);
  if (status >= 500) return new ProviderError(`제공자 서버 오류(${status}). ${detail}`, 'server', status);
  return new ProviderError(`요청 오류(${status}): ${detail}`, 'request', status);
}

async function readJson(res: Response, forbidden: string[]): Promise<any> {
  const text = await res.text();
  if (!res.ok) {
    let detail = '';
    try {
      const j = JSON.parse(text);
      detail = j?.error?.message ?? j?.error?.status ?? '';
    } catch {
      detail = '';
    }
    throw statusError(res.status, sanitize(detail, forbidden));
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError('제공자 응답을 해석할 수 없습니다.', 'format');
  }
}

async function callGemini(o: CallOptions): Promise<CallResult> {
  if (!o.apiKey) throw new ProviderError('API 키가 등록되지 않았습니다.', 'auth');
  if (!o.model) throw new ProviderError('모델이 선택되지 않았습니다.', 'request');
  const gf = makeGuardedFetch(o);
  const schema = stripCounts(o.schema) as Record<string, unknown>;
  const ms = o.timeoutMs ?? GEMINI_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(ms);
  const signal = o.signal ? AbortSignal.any([o.signal, timeout]) : timeout;
  const base = o.baseUrlOverride ?? GEMINI_HOST;
  const forbidden = o.confirmed.forbidden;
  try {
    const res = await gf(`${base}/v1beta/models/${encodeURIComponent(o.model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': o.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: o.confirmed.system }] },
        contents: [{ role: 'user', parts: [{ text: o.confirmed.user }] }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema },
      }),
      signal,
    });
    const j = await readJson(res, forbidden);
    if (j?.promptFeedback?.blockReason) throw new ProviderError(`제공자가 요청을 차단했습니다(${j.promptFeedback.blockReason}).`, 'blocked');
    const c = j?.candidates?.[0];
    if (!c) throw new ProviderError('응답에 결과가 없습니다.', 'format');
    if (c.finishReason && c.finishReason !== 'STOP') {
      throw new ProviderError(c.finishReason === 'MAX_TOKENS' ? '응답이 길이 제한으로 잘렸습니다.' : `응답이 완료되지 않았습니다(${c.finishReason}).`, c.finishReason === 'MAX_TOKENS' ? 'truncated' : 'blocked');
    }
    const text = (c.content?.parts ?? []).filter((p: any) => typeof p.text === 'string' && !p.thought).map((p: any) => p.text).join('');
    return { text, model: j.modelVersion ?? o.model };
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (timeout.aborted && !o.signal?.aborted) throw new ProviderError(`응답이 ${Math.round(ms / 1000)}초 안에 오지 않았습니다. 모델이 혼잡하거나 느립니다. 다시 요청하거나 설정에서 다른 모델을 고르세요.`, 'timeout');
    if ((e as Error)?.name === 'AbortError') throw new ProviderError('요청을 취소했습니다.', 'cancelled');
    throw new ProviderError(`네트워크 연결 오류입니다. ${sanitize((e as Error)?.message, forbidden)}`, 'network');
  }
}

async function listGeminiModels(apiKey: string, rt: CliRuntime): Promise<string[]> {
  if (!apiKey) throw new ProviderError('API 키가 등록되지 않았습니다.', 'auth');
  const gf = makeGuardedFetch({ confirmed: { system: '', user: '', forbidden: [] }, baseUrlOverride: rt.baseUrlOverride, fetchImpl: rt.fetchImpl });
  const base = rt.baseUrlOverride ?? GEMINI_HOST;
  try {
    const j = await readJson(await gf(`${base}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } }), []);
    return (j.models ?? [])
      .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m: any) => String(m.name).replace(/^models\//, ''))
      .filter((n: string) => n.startsWith('gemini'))
      .sort();
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError('모델 목록을 가져오지 못했습니다(네트워크).', 'network');
  }
}

// ── CLI 실행 ──────────────────────────────────────────

const KNOWN_PATHS: Record<Provider, () => string[]> = {
  anthropic: () => [path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')],
  openai: () => (process.platform === 'win32' && process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe')] : []),
  gemini: () => [],
};

/** CLI 실행 파일 찾기: PATH의 실행 파일(Windows는 .exe만) → 알려진 설치 위치. npm 설치본(.cmd)은 셸을 거쳐야 해서 쓰지 않는다. */
export function findCli(provider: Provider, rt: CliRuntime = {}): string | null {
  const o = rt.override?.[provider];
  if (o) return o;
  const name = CLI_COMMAND[provider];
  if (!name) return null;
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  for (const dir of (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir.replace(/^"|"$/g, ''), exe);
    if (existsSync(p)) return p;
  }
  return KNOWN_PATHS[provider]().find((p) => existsSync(p)) ?? null;
}

export function cliMissing(provider: Provider): ProviderError {
  return new ProviderError(
    provider === 'anthropic'
      ? 'Claude Code(claude.exe)를 찾지 못했습니다. 설정 > AI 제공자의 [설치·로그인 안내]를 따라 Claude Code를 설치하고 로그인하세요.'
      : 'Codex CLI(codex.exe)를 찾지 못했습니다. 설정 > AI 제공자의 [설치·로그인 안내]를 따라 Codex CLI를 설치하고 로그인하세요.',
    'cli',
  );
}

/** 자식 프로세스 환경: API 키 변수는 빼서 항상 교사가 로그인한 구독 계정으로 실행하고, 앱을 다른 CLI 안에서 띄운 경우의 중첩 표시도 뺀다. */
export function childEnv(rt: CliRuntime): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'ELECTRON_RUN_AS_NODE']) delete env[k];
  return { ...env, ...(rt.extraEnv ?? {}) };
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function killTree(pid: number | undefined) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => undefined);
    } catch {
      /* 무시 */
    }
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* 무시 */
    }
  }
}

export async function runCli(file: string, args: string[], o: { stdin?: string; cwd?: string; signal?: AbortSignal; timeoutMs: number; rt: CliRuntime }): Promise<RunResult> {
  const script = /\.(c|m)?js$/i.test(file);
  const env = childEnv(o.rt);
  if (script) env.ELECTRON_RUN_AS_NODE = '1';
  const cmd = script ? process.execPath : file;
  const argv = script ? [file, ...args] : args;
  return new Promise<RunResult>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const child = spawn(cmd, argv, { cwd: o.cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (b: Buffer) => out.push(b));
    child.stderr.on('data', (b: Buffer) => err.push(b));
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, o.timeoutMs);
    const onAbort = () => killTree(child.pid);
    o.signal?.addEventListener('abort', onAbort, { once: true });
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    child.on('error', (e) => done(() => reject(new ProviderError(`CLI를 실행하지 못했습니다. ${(e as Error).message}`, 'cli'))));
    child.on('close', (code) =>
      done(() => {
        if (o.signal?.aborted) return reject(new ProviderError('요청을 취소했습니다.', 'cancelled'));
        if (timedOut) return reject(new ProviderError(`응답이 ${Math.round(o.timeoutMs / 1000)}초 안에 오지 않았습니다. 모델이 혼잡하거나 느립니다. 다시 요청하거나 설정에서 다른 모델을 고르세요.`, 'timeout'));
        resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
      }),
    );
    child.stdin.on('error', () => undefined);
    if (o.stdin !== undefined) child.stdin.end(o.stdin, 'utf8');
    else child.stdin.end();
  });
}

/** 슬래시 경로(Codex 설정 값은 역슬래시 경로를 읽지 못한다, 2026-11-17 시험) */
const slash = (p: string) => p.replace(/\\/g, '/');

function lastJson(stdout: string): any {
  const t = stdout.trim();
  try {
    return JSON.parse(t);
  } catch {
    const lines = t.split(/\r?\n/).reverse();
    for (const l of lines) {
      try {
        return JSON.parse(l);
      } catch {
        /* 다음 줄 */
      }
    }
  }
  return null;
}

async function withTemp<T>(fn: (dir: { root: string; work: string }) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mitgeul-cli-'));
  const work = path.join(root, 'work');
  await fs.mkdir(work);
  try {
    return await fn({ root, work });
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function callProvider(o: CallOptions): Promise<CallResult> {
  if (o.provider === 'gemini') return callGemini(o);
  const file = findCli(o.provider, o);
  if (!file) throw cliMissing(o.provider);
  const schema = stripCounts(o.schema) as Record<string, unknown>;
  const schemaText = JSON.stringify(schema);
  const forbidden = o.confirmed.forbidden;
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (o.signal?.aborted) throw new ProviderError('요청을 취소했습니다.', 'cancelled');
  if (o.effort !== undefined && !EFFORTS.includes(o.effort)) throw new ProviderError(`알 수 없는 추론 강도입니다: ${String(o.effort)}`, 'request');
  return withTemp(async ({ root, work }) => {
    const sysFile = path.join(root, 'system.txt');
    const system = o.confirmed.system;
    const user = o.confirmed.user;
    if (o.provider === 'anthropic') {
      const args = ['-p', '--output-format', 'json', '--system-prompt-file', sysFile, '--json-schema', schemaText, '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands', ...(o.model ? ['--model', o.model] : []), ...(o.effort ? ['--effort', o.effort] : [])];
      guardCliPayload(o.confirmed, { system, user, extra: args });
      await fs.writeFile(sysFile, system, 'utf8');
      const r = await runCli(file, args, { stdin: user, cwd: work, signal: o.signal, timeoutMs, rt: o });
      const j = lastJson(r.stdout);
      if (!j || typeof j !== 'object') {
        if (r.code !== 0) throw classify(o.provider, undefined, sanitize(r.stderr || r.stdout, forbidden));
        throw new ProviderError('CLI 응답을 해석할 수 없습니다.', 'format');
      }
      if (j.is_error || r.code !== 0) {
        throw classify(o.provider, typeof j.api_error_status === 'number' ? j.api_error_status : undefined, sanitize(`${j.result ?? ''} ${r.stderr ?? ''}`.trim(), forbidden));
      }
      if (j.subtype && j.subtype !== 'success') throw new ProviderError(`응답이 완료되지 않았습니다(${j.subtype}).`, j.subtype === 'error_max_turns' ? 'format' : 'request');
      if (j.stop_reason === 'refusal') throw new ProviderError('제공자가 요청을 거절했습니다.', 'blocked');
      if (j.stop_reason === 'max_tokens') throw new ProviderError('응답이 길이 제한으로 잘렸습니다.', 'truncated');
      const text = j.structured_output != null ? JSON.stringify(j.structured_output) : String(j.result ?? '');
      const used = Object.keys(j.modelUsage ?? {})[0];
      return { text, model: used || o.model || 'claude' };
    }
    // Codex
    const schemaFile = path.join(root, 'schema.json');
    // 글쓰기에 필요 없는 Codex 도구·스킬 설명을 빼 요청마다 붙는 입력을 줄인다(시험 문장 기준 약 11,500 → 6,250토큰).
    const outFile = path.join(root, 'out.txt');
    const args = [
      'exec', '--ephemeral', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '-s', 'read-only', '--color', 'never',
      '-C', slash(work), '-c', `model_instructions_file=${JSON.stringify(slash(sysFile))}`,
      ...CODEX_LEAN_CONFIG.flatMap((c) => ['-c', c]),
      ...(o.effort ? ['-c', `model_reasoning_effort=${JSON.stringify(o.effort)}`] : []),
      '--output-schema', slash(schemaFile), '-o', slash(outFile), '--json',
      ...(o.model ? ['-m', o.model] : []), '-',
    ];
    guardCliPayload(o.confirmed, { system, user, extra: [...args, schemaText] });
    await fs.writeFile(sysFile, system, 'utf8');
    await fs.writeFile(schemaFile, schemaText, 'utf8');
    const r = await runCli(file, args, { stdin: user, cwd: work, signal: o.signal, timeoutMs, rt: o });
    const events = r.stdout.split(/\r?\n/).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean) as any[];
    const failed = events.find((e) => e.type === 'turn.failed');
    const errEv = events.filter((e) => e.type === 'error').map((e) => String(e.message ?? ''));
    if (failed || r.code !== 0) {
      const msg = String(failed?.error?.message ?? errEv.at(-1) ?? r.stderr ?? '');
      const st = Number(msg.match(/\b(4\d\d|5\d\d)\b/)?.[1]) || undefined;
      throw classify(o.provider, st, sanitize(msg, forbidden));
    }
    let text = '';
    try {
      text = await fs.readFile(outFile, 'utf8');
    } catch {
      const last = [...events].reverse().find((e) => e.type === 'item.completed' && e.item?.type === 'agent_message');
      text = String(last?.item?.text ?? '');
    }
    if (!text.trim()) throw new ProviderError('응답에 결과가 없습니다.', 'format');
    return { text: text.trim(), model: o.model || 'codex' };
  });
}

/** 모델 목록. Gemini는 API, Claude는 앱이 아는 목록, Codex는 `codex debug models`가 돌려준 목록(숨김 모델 제외, 우선순위 순). */
export async function listModels(provider: Provider, rt: CliRuntime & { apiKey?: string } = {}): Promise<string[]> {
  if (provider === 'gemini') return listGeminiModels(rt.apiKey ?? '', rt);
  if (provider === 'anthropic') return [...CLAUDE_MODELS];
  const file = findCli(provider, rt);
  if (!file) throw cliMissing(provider);
  const r = await runCli(file, ['debug', 'models'], { timeoutMs: 30_000, rt, cwd: os.tmpdir() });
  if (r.code !== 0) throw new ProviderError('Codex 모델 목록을 가져오지 못했습니다.', 'cli');
  const j = lastJson(r.stdout);
  const list = (Array.isArray(j?.models) ? j.models : []) as { slug?: string; visibility?: string; priority?: number }[];
  return list
    .filter((m) => typeof m.slug === 'string' && m.visibility !== 'hide' && !/review/i.test(m.slug!))
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    .map((m) => m.slug!);
}

export interface CliStatus {
  installed: boolean;
  loggedIn: boolean;
  /** 화면 안내용 한 줄(계정 이메일·토큰은 담지 않는다) */
  detail: string;
}

/** CLI 설치·로그인 상태. 상태 확인 명령만 실행하고 자격 증명 파일은 읽지 않는다. */
export async function cliStatus(provider: Provider, rt: CliRuntime = {}): Promise<CliStatus> {
  if (!usesCli(provider)) return { installed: false, loggedIn: false, detail: 'API 키 방식 제공자' };
  const file = findCli(provider, rt);
  if (!file) return { installed: false, loggedIn: false, detail: `${CLI_COMMAND[provider]} 실행 파일을 찾지 못했습니다.` };
  try {
    if (provider === 'anthropic') {
      const r = await runCli(file, ['auth', 'status'], { timeoutMs: 20_000, rt, cwd: os.tmpdir() });
      const j = lastJson(r.stdout);
      const ok = !!j?.loggedIn;
      const method = typeof j?.authMethod === 'string' ? j.authMethod : '';
      return { installed: true, loggedIn: ok, detail: ok ? `로그인됨${method ? ` (${method === 'claude.ai' ? '구독 계정' : method})` : ''}` : '로그인되어 있지 않습니다.' };
    }
    const r = await runCli(file, ['login', 'status'], { timeoutMs: 20_000, rt, cwd: os.tmpdir() });
    const text = `${r.stdout}\n${r.stderr}`;
    const ok = r.code === 0 && /logged in/i.test(text) && !/not logged in/i.test(text);
    return { installed: true, loggedIn: ok, detail: ok ? (/chatgpt/i.test(text) ? '로그인됨 (ChatGPT 계정)' : '로그인됨') : '로그인되어 있지 않습니다.' };
  } catch (e) {
    return { installed: true, loggedIn: false, detail: `상태 확인 실패: ${sanitize((e as Error).message, [])}` };
  }
}

/** 모델 테스트: 학생 자료 없는 고정 문장으로 한 번 호출해 응답 여부와 시간을 확인한다. */
export const MODEL_TEST_SYSTEM = '연결 시험이다. 지정된 JSON 형식으로만 답한다.';
export const MODEL_TEST_USER = '이 요청은 학생 자료가 없는 모델 연결 시험입니다. {"ok":true}로 답하세요.';
export async function testModel(provider: Provider, model: string, rt: CliRuntime & { apiKey?: string; effort?: Effort } = {}): Promise<{ model: string; ms: number }> {
  const t0 = Date.now();
  const r = await callProvider({
    provider,
    model,
    effort: provider === 'gemini' ? undefined : rt.effort,
    confirmed: { system: MODEL_TEST_SYSTEM, user: MODEL_TEST_USER, forbidden: [] },
    schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    schemaName: 'connection_test',
    timeoutMs: provider === 'gemini' ? 60_000 : 90_000,
    ...rt,
  });
  if (!/"ok"\s*:\s*true/.test(r.text)) throw new ProviderError('모델이 응답했지만 지정한 JSON 형식을 지키지 않았습니다. 다른 모델을 고르세요.', 'format');
  return { model: r.model || model, ms: Date.now() - t0 };
}
