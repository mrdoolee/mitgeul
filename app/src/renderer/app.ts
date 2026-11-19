import { APP_NAME, APP_TAGLINE, APP_TITLE, BACKUP_DIR_NAME } from '../core/brand';
import { banner, confirmText, field, h, icon, modal, promptPassword, toast } from './dom';
import { renderReview } from './screens/review';
import { renderAssign, renderStudents, renderTeacher } from './screens/roster';
import { renderSettings } from './screens/settings';
import { renderSetup } from './screens/setup';
import { backupNow, openCredit, openGuide } from './guide';
import { openPrivacy } from './privacy';
import { renderWrite } from './screens/write';
import { run, S, type Screen } from './state';

const root = document.getElementById('root')!;
document.title = APP_TITLE;

/** 작업 순서대로 배치한 사이드바. [설정] 1~5단계, [생기부 작성 및 확인] 6~7단계로 묶는다. */
const MENU: { id: Screen; title: string; sub: string; ico: string; group: 'setup' | 'write' }[] = [
  { id: 'settings', title: '기본설정', sub: '학교 정보·AI 연결·기재 금지 문구', ico: 'settings', group: 'setup' },
  { id: 'students', title: '학급 및 학생 명단 입력', sub: '학급 만들기·명단 일괄 입력', ico: 'users', group: 'setup' },
  { id: 'teacher', title: '교사 정보 설정', sub: '담임 학급·교과 과목·동아리', ico: 'book', group: 'setup' },
  { id: 'assign', title: '학생 배정', sub: '수업 반·동아리 구성원·작업 제외', ico: 'check', group: 'setup' },
  { id: 'setup', title: '초안 작성 초기 설정', sub: '작업별 입력 학기·기재 제외', ico: 'settings', group: 'setup' },
  { id: 'write', title: '관찰 기록 및 초안 작성', sub: '작업 → 영역 → 학생', ico: 'edit', group: 'write' },
  { id: 'review', title: '작성 내용 확인 및 출력', sub: '작성 현황·XLSX·HWPX', ico: 'download', group: 'write' },
];
const MENU_GROUPS = [
  { id: 'setup', label: '설정' },
  { id: 'write', label: '생기부 작성 및 확인' },
] as const;

export function go(screen: Screen) {
  S.screen = screen;
  S.scrollTop = true;
  void render();
}

let renderSeq = 0;

/**
 * 화면을 새로 만든 뒤 한 번에 바꿔 끼운다. 작업 중 다시 그려도 스크롤 위치를 유지한다(맨 위로 튀지 않게).
 * 화면·탭을 옮길 때만 맨 위로 올린다.
 */
async function render() {
  const seq = ++renderSeq;
  const app = S.app;
  if (!app) return;
  const y = window.scrollY;
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.focus;
  if (!app.open) {
    // 앱 잠금(비밀번호)을 켠 경우에만 비밀번호를 묻는다. 그 밖(전체 삭제 직후 등)은 Windows 계정 보호로 바로 다시 연다.
    if (app.lockMode === 'password') return void root.replaceChildren(lockScreen());
    const o = await window.sgb.openOs();
    if (!o.ok) return void (/\[저장 키 열기 실패\]/.test(o.error) ? root.replaceChildren(keyFailScreen(o.error)) : toast(o.error, 'err'));
    S.app = o.value;
    startScreen();
    S.scrollTop = true;
    return void render();
  }
  const d = app.data!;
  const provider = d.settings.provider;
  const keyOk = app.keyStatus[provider];
  const content = h('div', { class: 'content', id: 'main-content' });
  const tabSlot = h('nav', { class: 'subtabs', role: 'tablist', 'aria-label': '하위 작업' });
  S.tabSlot = tabSlot;
  const cur = MENU.find((m) => m.id === S.screen)!;
  const shell = h(
    'div',
    { class: 'app' },
    h(
      'aside',
      { class: 'sidebar' },
      h('div', { class: 'brand' }, h('img', { class: 'brand-logo', src: 'logo.png', alt: '' }), h('div', null, h('div', { class: 'brand-title' }, APP_NAME), h('div', { class: 'brand-sub' }, APP_TAGLINE))),
      h('div', { class: `conn-pill ${keyOk ? 'ok' : ''}` }, h('span', { class: 'dot' }), keyOk ? `${app.providers.find((p) => p.id === provider)?.label} 연결 준비` : (provider === 'gemini' ? 'AI 키 미등록' : 'AI CLI 미연결')),
      h('div', { class: 'menu-label' }, `${d.settings.schoolYear}학년도 ${d.settings.schoolLevel === 'high' ? '고등학교' : '중학교'}`),
      h(
        'nav',
        { class: 'menu', 'aria-label': '작업 단계' },
        MENU_GROUPS.map((g) =>
          h('div', { class: 'menu-group', role: 'group', 'aria-label': g.label },
            h('div', { class: 'menu-group-label' }, g.label),
            MENU.filter((m) => m.group === g.id).map((m) =>
              h('button', { class: `menu-item ${S.screen === m.id ? 'active' : ''}`, onclick: () => go(m.id), 'aria-current': S.screen === m.id ? 'page' : undefined },
                h('span', { class: 'num' }, String(MENU.indexOf(m) + 1)),
                h('span', null, h('span', { class: 't' }, m.title), h('br'), h('span', { class: 's' }, m.sub)),
              ),
            ),
          ),
        ),
      ),
      h('div', { class: 'sidebar-spacer' }),
      h('button', { class: 'side-btn', onclick: backupNow }, icon('download', 16), '지금 자동 백업'),
      h('button', { class: 'side-guide', onclick: () => void openGuide(), 'aria-haspopup': 'dialog' }, icon('book', 18), '사용 가이드'),
      h('div', { class: 'side-note' }, 'AI 문장은 초안입니다.', h('br'), '사실 확인과 최종 기재 판단은 교사가 합니다.'),
      h('div', { class: 'side-foot' }, h('span', null, `v${app.versions.app}`), h('span', null, app.versions.rules)),
    ),
    h(
      'main',
      { class: 'main' },
      h('header', { class: 'topbar' },
        h('div', { class: 'topbar-row' }, h('span', { class: 'crumb' }, `${MENU.indexOf(cur) + 1}단계`), h('h1', { class: 'page-title' }, cur.title), h('span', { class: 'spacer' }), h('span', { class: 'saved-chip' }, h('span', { class: 'dot' }), '암호화 저장됨')),
        tabSlot,
      ),
      app.recovered ? h('div', { class: 'content-banner' }, banner('warn', '마지막 저장 파일을 열 수 없어 직전 정상본으로 복구했습니다.', '최근 변경 일부가 빠졌을 수 있습니다.')) : null,
      content,
      h('footer', { class: 'app-footer' },
        '© 2026 Designed & Developed by ',
        h('button', { type: 'button', class: 'credit-link', onclick: () => void openCredit(), 'aria-haspopup': 'dialog' }, '두리쌤'),
        '. All rights reserved. · ',
        h('button', { type: 'button', class: 'credit-link', onclick: () => void openPrivacy(), 'aria-haspopup': 'dialog' }, '개인정보처리방침'),
      ),
    ),
  );
  tabSlot.hidden = true;
  S.curTabs = null;
  const screens: Record<Screen, (el: HTMLElement) => Promise<void> | void> = {
    settings: renderSettings,
    students: renderStudents,
    teacher: renderTeacher,
    assign: renderAssign,
    setup: renderSetup,
    write: renderWrite,
    review: renderReview,
  };
  await screens[S.screen](content);
  if (seq !== renderSeq) return; // 더 최근 렌더가 있으면 버린다
  content.append(pageNav());
  root.replaceChildren(shell);
  if (S.scrollTop) {
    S.scrollTop = false;
    window.scrollTo(0, 0);
  } else window.scrollTo(0, y);
  if (focusKey) (root.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
}
S.render = () => void render();

/**
 * 페이지 하단 이전/다음: 상단 탭 순서를 따르고, 첫 탭·마지막 탭에서는 앞뒤 메뉴로 넘어간다.
 * 앞 메뉴로 갈 때는 그 메뉴의 마지막 탭이 아니라 처음 화면으로 간다(메뉴마다 탭 구성이 상황에 따라 달라서).
 */
function pageNav() {
  const i = MENU.findIndex((m) => m.id === S.screen);
  const t = S.curTabs && S.curTabs.ids.length > 1 ? S.curTabs : null;
  const ti = t ? t.ids.indexOf(t.active) : -1;
  const toTab = (id: string) => () => {
    S.sub[S.screen] = id;
    S.scrollTop = true;
    void render();
  };
  const toMenu = (k: number) => () => {
    S.sub[MENU[k]!.id] = undefined;
    go(MENU[k]!.id);
  };
  let prev: { label: string; fn: () => void } | null = null;
  let next: { label: string; fn: () => void } | null = null;
  if (t && ti > 0) prev = { label: t.labels[ti - 1]!, fn: toTab(t.ids[ti - 1]!) };
  else if (i > 0) prev = { label: MENU[i - 1]!.title, fn: toMenu(i - 1) };
  if (t && ti >= 0 && ti < t.ids.length - 1) next = { label: t.labels[ti + 1]!, fn: toTab(t.ids[ti + 1]!) };
  // 6단계 마지막 탭(최종 본문·검토)에서는 다음 학생을 이어 쓰므로 [다음] 단추를 두지 않는다.
  else if (i < MENU.length - 1 && S.screen !== 'write') next = { label: MENU[i + 1]!.title, fn: toMenu(i + 1) };
  return h('nav', { class: 'page-nav', 'aria-label': '이전·다음 단계' },
    prev ? h('button', { class: 'btn ghost', onclick: prev.fn }, icon('left', 16), `이전: ${prev.label}`) : h('span'),
    next ? h('button', { class: 'btn', onclick: next.fn }, `다음: ${next.label}`, icon('right', 16)) : h('span'),
  );
}

function lockScreen() {
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', 'aria-label': '앱 잠금 비밀번호' });
  const unlock = async () => {
    const r = await run(window.sgb.unlock(pw.value));
    if (r) {
      S.app = r;
      startScreen();
      void render();
    }
  };
  pw.addEventListener('keydown', (e) => e.key === 'Enter' && void unlock());
  return h(
    'div',
    { class: 'center-screen' },
    h(
      'div',
      { class: 'card narrow' },
      h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('lock', 24)), h('div', null, h('h2', null, APP_NAME), h('p', null, APP_TAGLINE))),
      field('앱 잠금 비밀번호', pw),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: forgotPassword }, '비밀번호를 잊었어요'), h('button', { class: 'btn primary', onclick: unlock }, '잠금 해제')),
    ),
  );
}

/** 저장 키를 풀 수 없을 때: 이유를 보여 주고 비밀번호 분실과 같은 "초기화 후 백업에서 복원"으로 빠져나가게 한다. */
function keyFailScreen(message: string) {
  return h('div', { class: 'center-screen' },
    h('div', { class: 'card narrow' },
      h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('lock', 24)), h('div', null, h('h2', null, '앱 자료를 열 수 없습니다'), h('p', null, APP_NAME))),
      banner('err', '저장 키를 풀 수 없습니다', message.replace('[저장 키 열기 실패] ', '')),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: () => void resetAndRestore('저장 키를 풀 수 없어요') }, '초기화 후 백업에서 복원')),
    ),
  );
}

/** 비밀번호를 잊은 경우: 앱 자료를 초기화하고, 백업 폴더에 백업이 있으면 바로 복원을 제안한다. */
async function forgotPassword() {
  return resetAndRestore('비밀번호를 잊었어요');
}

async function resetAndRestore(title: string) {
  const ok = await confirmText(
    title,
    `지금 앱 안의 자료를 열 수 없습니다. 초기화하면 이 PC의 앱 자료(학생·기록·저장 키)를 지우고 새로 시작하며, 문서 폴더의 "${BACKUP_DIR_NAME}"은 지우지 않습니다.\n초기화 뒤 자동 백업(이 PC에서 만든 것은 비밀번호 없음)이나 이동용 백업(백업 비밀번호)으로 복원할 수 있습니다. 마지막 백업 이후의 작업은 되돌릴 수 없습니다.`,
    '초기화',
  );
  if (!ok) return;
  const w = await run(window.sgb.wipe('전체 삭제'));
  if (!w) return;
  const o = await run(window.sgb.openOs());
  if (!o) return;
  S.app = o;
  startScreen();
  await render();
  await offerRestore();
}

async function offerRestore() {
  const st = await window.sgb.backupStatus();
  if (!st.ok || !st.value.files.length) return void toast('초기화했습니다. 백업 폴더에 백업이 없어 새로 시작합니다.', 'info');
  const auto = st.value.files.find((f) => f.kind === 'auto');
  const latest = auto ?? st.value.files[0]!;
  const when = new Date(latest.at).toLocaleString('ko-KR');
  const choice = await modal<'restore' | 'list'>('백업에서 복원', (close) =>
    h('div', null,
      h('p', null, `초기화했습니다. 백업 폴더에서 ${auto ? '최근 자동 백업' : '백업'}을 찾았습니다.`),
      h('p', null, h('b', null, latest.name), ` (${when})`),
      h('p', { class: 'hint' }, auto ? '자동 백업은 이 PC·이 Windows 계정에서 만든 것이면 비밀번호 없이 복원됩니다.' : '이동용 백업은 그 파일을 만들 때 정한 백업 비밀번호가 필요합니다.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', onclick: () => close() }, '새로 시작'),
        h('button', { class: 'btn secondary', onclick: () => close('list') }, '다른 백업 고르기'),
        h('button', { class: 'btn primary', onclick: () => close('restore') }, '이 백업으로 복원'),
      ),
    ));
  if (choice === 'list') {
    S.screen = 'settings';
    S.sub.settings = 'backup';
    S.scrollTop = true;
    return void render();
  }
  if (choice !== 'restore') return;
  let pw: string | undefined;
  if (latest.kind === 'move') {
    pw = await promptPassword('이동용 백업 복원', `${latest.name}을 만들 때 정한 백업 비밀번호를 입력하세요.`);
    if (!pw) return;
  }
  const r = await run(window.sgb.backupRestoreNamed(latest.name, pw));
  if (!r) return;
  S.app!.data = r.data;
  S.recordId = '';
  startScreen();
  toast('백업에서 복원했습니다. 앱 잠금은 꺼진 상태이니 필요하면 다시 켜세요.', 'ok');
  void render();
}

/** 첫 실행(명단 없음)은 기본설정, 그 뒤로는 작성 현황에서 시작한다. 별도 시작 화면은 두지 않는다. */
function startScreen() {
  const d = S.app?.data;
  if (!d) return;
  S.screen = d.students.length && d.works.length ? 'review' : 'settings';
  S.sub = {};
}

async function boot() {
  const r = await window.sgb.state();
  if (!r.ok) {
    root.textContent = r.error;
    return;
  }
  S.app = r.value;
  if (!S.app.open && S.app.lockMode !== 'password') {
    const o = await window.sgb.openOs();
    if (o.ok) S.app = o.value;
    else if (/\[저장 키 열기 실패\]/.test(o.error)) return void root.replaceChildren(keyFailScreen(o.error));
    else toast(o.error, 'err');
  }
  startScreen();
  void render();
}

window.addEventListener('error', (e) => toast(`화면 오류: ${e.message}`, 'err'));
window.addEventListener('unhandledrejection', (e) => toast(`처리 오류: ${String((e as PromiseRejectionEvent).reason?.message ?? e.reason)}`, 'err'));
void boot();
