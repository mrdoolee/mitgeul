// 시험 전용 가짜 CLI: Claude Code(`claude -p`)와 Codex(`codex exec`)의 입출력 형식을 흉내 낸다.
// 받은 인수·시스템 지시·표준입력을 MITGEUL_FAKE_CLI_BASE의 모의 서버로 보내고, 서버가 준 { text } 또는 오류를 CLI 출력 형식으로 바꿔 내보낸다.
// 앱은 개발 실행(app.isPackaged=false)에서만 MITGEUL_CLI_CLAUDE / MITGEUL_CLI_CODEX로 이 파일을 쓴다.
// 로그인 시험: MITGEUL_FAKE_CLI_STATE(폴더)가 있으면 그 안의 claude-login·codex-login 파일로 로그인 상태를 흉내 낸다.
//   `auth login`(Claude)은 표준입력으로 코드 good-code#state를 받으면 로그인, 다른 코드는 거절한다.
//   `app-server`(Codex)는 JSON-RPC로 로그인 주소·기기 코드를 준다. MITGEUL_FAKE_LOGIN_AUTO=1이면 브라우저 승인을 흉내 내 0.6초 뒤 로그인을 마친다.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
const base = process.env.MITGEUL_FAKE_CLI_BASE;
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const readStdin = () =>
  new Promise((ok) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
  });

async function ask(cli, body) {
  if (!base) return { status: 0, error: 'MITGEUL_FAKE_CLI_BASE not set' };
  const res = await fetch(`${base}/${cli}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { status: res.status, error: j?.error?.message ?? 'error' };
  return { text: String(j.text ?? ''), model: j.model };
}

const stateDir = process.env.MITGEUL_FAKE_CLI_STATE;
const loginFile = (cli) => path.join(stateDir, `${cli}-login`);
const loggedIn = (cli) => (stateDir ? fs.existsSync(loginFile(cli)) : !process.env.MITGEUL_FAKE_LOGGED_OUT);
const setLogin = (cli, on) => {
  if (!stateDir) return;
  if (on) fs.writeFileSync(loginFile(cli), 'fake');
  else fs.rmSync(loginFile(cli), { force: true });
};
// 브라우저 승인 흉내: 환경 변수 또는 상태 폴더의 auto 파일(시험 중간에 켤 수 있음)
const auto = process.env.MITGEUL_FAKE_LOGIN_AUTO === '1' || (!!stateDir && fs.existsSync(path.join(stateDir, 'auto')));

function claudeLogin() {
  return new Promise((ok) => {
    const url = 'https://claude.com/cai/oauth/authorize?code=true&fake=1';
    // 실제 CLI처럼 터미널 하이퍼링크(OSC 8)로 감싼 주소를 낸다.
    process.stdout.write(`Opening browser to sign in…\nIf the browser didn't open, visit: \x1b]8;;${url}\x07${url}\x1b]8;;\x07\nPaste code here if prompted > `);
    const done = (code) => ok(code);
    if (auto) setTimeout(() => (setLogin('claude', true), process.stdout.write('\nLogin successful.\n'), done(0)), 600);
    readline.createInterface({ input: process.stdin }).on('line', (line) => {
      if (line.trim() === 'good-code#state') {
        setLogin('claude', true);
        process.stdout.write('\nLogin successful.\n');
        return done(0);
      }
      process.stderr.write("Couldn't log in: That code wasn't accepted. It may be incomplete, expired, already used, or from an earlier sign-in attempt. Sign in again to get a new code.\n");
      done(1);
    });
  });
}

function codexAppServer() {
  return new Promise((ok) => {
    const out = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
    let loginId = null;
    readline.createInterface({ input: process.stdin }).on('line', (line) => {
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.method === 'initialize') return out({ id: m.id, result: { userAgent: 'fake-codex' } });
      if (m.method === 'account/login/start') {
        loginId = `login-${Date.now()}`;
        if (m.params?.type === 'chatgptDeviceCode') out({ id: m.id, result: { type: 'chatgptDeviceCode', loginId, userCode: 'FAKE-1234', verificationUrl: 'https://auth.openai.com/codex/device' } });
        else out({ id: m.id, result: { type: 'chatgpt', loginId, authUrl: 'https://auth.openai.com/oauth/authorize?fake=1' } });
        if (auto) setTimeout(() => (setLogin('codex', true), out({ method: 'account/login/completed', params: { loginId, success: true, error: null } })), 600);
        return;
      }
      if (m.method === 'account/login/cancel') {
        out({ id: m.id, result: { status: 'canceled' } });
        out({ method: 'account/login/completed', params: { loginId, success: false, error: 'Login was not completed' } });
      }
    });
    process.stdin.on('end', () => ok(0));
  });
}

async function main() {
  if (args[0] === 'auth' && args[1] === 'status') {
    process.stdout.write(JSON.stringify({ loggedIn: loggedIn('claude'), authMethod: loggedIn('claude') ? 'claude.ai' : 'none', apiProvider: 'firstParty' }));
    return loggedIn('claude') ? 0 : 1;
  }
  if (args[0] === 'auth' && args[1] === 'login') return claudeLogin();
  if (args[0] === 'auth' && args[1] === 'logout') {
    setLogin('claude', false);
    process.stdout.write('Successfully logged out from your Anthropic account.\n');
    return 0;
  }
  if (args[0] === 'app-server') return codexAppServer();
  if (args[0] === 'logout') {
    const was = loggedIn('codex');
    setLogin('codex', false);
    process.stderr.write(was ? 'Successfully logged out\n' : 'Not logged in\n');
    return was ? 0 : 1;
  }
  if (args[0] === 'login' && args[1] === 'status') {
    if (!loggedIn('codex')) {
      process.stderr.write('Not logged in\n');
      return 1;
    }
    process.stderr.write('Logged in using ChatGPT\n');
    return 0;
  }
  if (args[0] === 'debug' && args[1] === 'models') {
    process.stdout.write(JSON.stringify({ models: [{ slug: 'codex-test-b', visibility: 'list', priority: 2 }, { slug: 'codex-test-a', visibility: 'list', priority: 1 }, { slug: 'gpt-reserve', visibility: 'hide', priority: 3 }] }));
    return 0;
  }
  const user = await readStdin();
  if (args[0] === '-p') {
    const sysFile = opt('--system-prompt-file');
    const system = sysFile ? fs.readFileSync(sysFile, 'utf8') : '';
    const model = opt('--model') ?? 'claude-default';
    const r = await ask('claude', { args, system, user, model, schema: JSON.parse(opt('--json-schema') ?? '{}'), env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? null } });
    if (r.error !== undefined) {
      process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, api_error_status: r.status || null, result: r.error, modelUsage: {} }));
      return 1;
    }
    let structured = null;
    try {
      structured = JSON.parse(r.text);
    } catch {
      structured = null;
    }
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: r.text, structured_output: structured, stop_reason: 'tool_use', modelUsage: { [r.model ?? model]: {} } }));
    return 0;
  }
  if (args[0] === 'exec') {
    const cfg = args[args.indexOf('-c') + 1] ?? '';
    const sysPath = JSON.parse(cfg.replace(/^model_instructions_file=/, '') || '""');
    const system = sysPath ? fs.readFileSync(sysPath, 'utf8') : '';
    const model = opt('-m') ?? 'codex-default';
    const r = await ask('codex', { args, system, user, model, schema: JSON.parse(fs.readFileSync(opt('--output-schema'), 'utf8')), env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? null } });
    const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
    out({ type: 'thread.started', thread_id: 'fake' });
    out({ type: 'turn.started' });
    if (r.error !== undefined) {
      const message = r.status ? `${r.status} ${r.error}` : r.error;
      out({ type: 'error', message });
      out({ type: 'turn.failed', error: { message } });
      return 1;
    }
    fs.writeFileSync(opt('-o'), r.text, 'utf8');
    out({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: r.text } });
    out({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
    return 0;
  }
  process.stderr.write(`fake-cli: unknown args ${args.join(' ')}\n`);
  return 2;
}

main().then((code) => process.exit(code), (e) => {
  process.stderr.write(String(e?.stack ?? e));
  process.exit(3);
});
