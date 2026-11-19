import { banner, h, icon, toast } from './dom';
import { run, S, type LoginView } from './state';

/**
 * 구독 로그인 칸(기본설정 > AI 연결). [로그인]을 누르면 주 프로세스가 CLI 로그인을 시작하고,
 * 이 칸은 1초마다 진행 상황을 물어 브라우저 안내·코드 입력·결과를 보여 준다. 화면을 옮겨도 로그인은 계속되고 돌아오면 이어서 보인다.
 */
type LoginProvider = 'anthropic' | 'openai';
const views = new Map<LoginProvider, LoginView>();
const NAME: Record<LoginProvider, { vendor: string; cli: string }> = {
  anthropic: { vendor: 'Claude', cli: 'Claude Code' },
  openai: { vendor: 'ChatGPT', cli: 'Codex CLI' },
};

function applyStatus(r: { keyStatus: Record<string, boolean>; cliStatus: Record<string, any> }) {
  const app = S.app!;
  app.keyStatus = r.keyStatus as typeof app.keyStatus;
  app.cliStatus = r.cliStatus as typeof app.cliStatus;
}

/** 로그인·로그아웃 버튼(상태 칩 옆) */
export function loginButtons(prov: LoginProvider, installed: boolean, loggedIn: boolean): Node[] {
  if (!installed) return [];
  const waiting = views.get(prov)?.phase === 'waiting';
  if (loggedIn && !waiting)
    return [h('button', { class: 'btn ghost', onclick: async (e: Event) => {
      if (!window.confirm(`${NAME[prov].vendor} 로그아웃할까요?\n이 PC의 ${NAME[prov].cli} 로그인이 풀립니다(터미널에서 쓰는 ${NAME[prov].cli}도 함께 로그아웃됩니다).`)) return;
      (e.currentTarget as HTMLButtonElement).disabled = true;
      const r = await run(window.sgb.logout(prov));
      if (r) {
        applyStatus(r);
        views.delete(prov);
        toast(r.cliStatus[prov]?.loggedIn ? '로그아웃 뒤에도 로그인 상태로 확인됩니다. [상태 다시 확인]을 눌러 보세요.' : `${NAME[prov].vendor} 로그아웃했습니다.`, r.cliStatus[prov]?.loggedIn ? 'warn' : 'ok');
      }
      S.render();
    } }, '로그아웃')];
  if (waiting) return [];
  return [h('button', { class: 'btn primary', onclick: () => void start(prov, 'browser') }, `${NAME[prov].vendor} 로그인`)];
}

async function start(prov: LoginProvider, method: 'browser' | 'device') {
  const r = await window.sgb.loginStart(prov, method);
  if (!r.ok) return void toast(r.error, 'err');
  views.set(prov, r.value);
  S.render();
}

/** 진행 중·끝난 로그인 안내 칸. 진행 중이면 1초마다 상태를 묻고, 끝나면 상태를 갱신해 화면을 다시 그린다. */
export function loginPanel(prov: LoginProvider): Node | null {
  const v = views.get(prov);
  if (!v) return null;
  const box = h('div', { class: 'login-panel', 'data-testid': 'login-panel' });
  const name = NAME[prov];
  const draw = (view: LoginView) => {
    if (view.phase === 'done') return box.replaceChildren(banner('ok', view.message ?? '로그인했습니다.', '[모델 테스트]로 응답을 확인한 뒤 [모델 저장]을 누르세요.'));
    if (view.phase !== 'waiting')
      return box.replaceChildren(
        banner(view.phase === 'cancelled' ? 'info' : 'err', view.phase === 'cancelled' ? '로그인을 취소했습니다.' : '로그인하지 못했습니다', view.phase === 'cancelled' ? '' : view.message ?? ''),
        h('div', { class: 'btn-row left tight' },
          h('button', { class: 'btn primary sm', onclick: () => void start(prov, 'browser') }, '다시 로그인'),
          prov === 'openai' ? h('button', { class: 'btn secondary sm', onclick: () => void start(prov, 'device') }, '코드로 로그인') : null,
          h('button', { class: 'btn ghost sm', onclick: () => (views.delete(prov), S.render()) }, '닫기')),
      );
    const cancel = h('button', { class: 'btn ghost sm', onclick: async () => {
      const r = await window.sgb.loginCancel(prov);
      if (r.ok) {
        applyStatus(r.value);
        if (r.value.view) views.set(prov, r.value.view);
      }
      S.render();
    } }, '취소');
    const openUrl = view.url ? h('button', { class: 'btn secondary sm', onclick: () => run(window.sgb.loginOpenUrl(prov)) }, icon('book', 14), view.method === 'device' ? '코드 입력 화면 열기' : '로그인 화면 다시 열기') : null;
    if (view.method === 'device')
      return box.replaceChildren(
        banner('info', 'ChatGPT 코드로 로그인', '아래 [코드 입력 화면 열기]를 누르거나 다른 기기의 브라우저에서 주소를 열고, ChatGPT 계정으로 로그인한 뒤 이 코드를 입력하세요. 입력이 끝나면 자동으로 연결됩니다. 기기 코드 로그인을 활성화하라는 안내가 나오면 ChatGPT 설정 > 보안에서 켜거나 [취소] 뒤 [다시 로그인]으로 브라우저 로그인을 쓰세요.'),
        h('div', { class: 'device-code' }, h('span', { class: 'muted' }, '코드'), h('b', { 'data-testid': 'device-code' }, view.userCode ?? ''),
          h('button', { class: 'btn ghost sm', onclick: () => run(window.sgb.copyEdit(view.userCode ?? ''), '코드를 복사했습니다.') }, icon('copy', 14), '복사')),
        view.url ? h('p', { class: 'hint' }, `주소: ${view.url}`) : '',
        h('div', { class: 'btn-row left tight' }, openUrl, cancel),
      );
    const steps: Node[] = [
      banner('info', `브라우저에서 ${name.vendor} 로그인을 마치세요`,
        prov === 'anthropic'
          ? '기본 브라우저에 Claude 로그인 화면이 열렸습니다. Claude 구독 계정으로 로그인하고 [승인]을 누르면 자동으로 연결됩니다. 10분 안에 마치지 않으면 멈춥니다.'
          : '기본 브라우저에 ChatGPT 로그인 화면이 열렸습니다. ChatGPT 계정으로 로그인하고 허용을 누르면 자동으로 연결됩니다. 10분 안에 마치지 않으면 멈춥니다.'),
    ];
    if (prov === 'anthropic') {
      const inp = h('input', { class: 'input', placeholder: '브라우저에 나온 코드를 붙여 넣기', autocomplete: 'off', spellcheck: false, 'aria-label': 'Claude 로그인 코드', disabled: !view.acceptsCode });
      const sendCode = async () => {
        const r = await window.sgb.loginCode(prov, inp.value);
        if (!r.ok) return void toast(r.error, 'err');
        views.set(prov, r.value);
        draw(r.value);
      };
      inp.addEventListener('keydown', (e) => e.key === 'Enter' && void sendCode());
      steps.push(
        h('p', { class: 'hint' }, view.codeSent ? '코드를 확인하는 중입니다…' : '브라우저에 "코드를 복사해 붙여 넣으세요" 화면이 나오면 코드 전체를 복사해 아래에 붙여 넣고 [코드 넣기]를 누르세요.'),
        ...(view.codeSent ? [] : [h('div', { class: 'inline' }, inp, h('button', { class: 'btn sm', onclick: () => void sendCode() }, '코드 넣기'))]),
      );
    }
    steps.push(h('div', { class: 'btn-row left tight' }, openUrl,
      prov === 'openai' ? h('button', { class: 'btn secondary sm', title: '브라우저 로그인이 안 될 때: 화면의 코드를 브라우저에 입력해 로그인합니다', onclick: () => void start(prov, 'device') }, '코드로 로그인') : null,
      cancel));
    box.replaceChildren(...steps);
  };
  draw(v);
  // 끝난 결과는 한 번만 보여 준다(다른 화면에 갔다 오면 지운다).
  if (v.phase === 'done') views.delete(prov);
  if (v.phase === 'waiting') {
    let last = JSON.stringify(v);
    const timer = window.setInterval(async () => {
      if (!box.isConnected) return window.clearInterval(timer);
      const r = await window.sgb.loginState(prov);
      if (!r.ok || !r.value.view) return;
      views.set(prov, r.value.view);
      if (r.value.view.phase !== 'waiting') {
        window.clearInterval(timer);
        applyStatus(r.value);
        return S.render();
      }
      const now = JSON.stringify(r.value.view);
      // 입력 중인 코드 칸을 지우지 않도록 내용이 바뀔 때만 다시 그린다.
      if (now !== last) {
        last = now;
        draw(r.value.view);
      }
    }, 1000);
  }
  return box;
}
