import { EFFORTS, type AppData, type Effort, type Provider } from '../../core/schema';
import { BAN_PRESETS } from '../../core/banPresets';
import { go } from '../app';
import { banner, confirmText, field, h, icon, promptPassword, select, toast } from '../dom';
import { act, data, run, S, useTabs } from '../state';
import { openKeyGuide } from '../keyGuide';
import { loginButtons, loginPanel } from '../cliLoginPanel';
import { RECOMMENDED_MODEL } from '../../core/recommended';
import { openModelCompare } from '../modelCompare';
import { openPrivacy } from '../privacy';

const EFFORT_LABEL: Record<Effort, string> = { low: '낮음', medium: '보통', high: '높음', xhigh: '매우 높음', max: '최대' };

export async function renderSettings(el: HTMLElement) {
  const d = data();
  const tab = useTabs([
    { id: 'school', label: '학교 정보' },
    { id: 'ai', label: 'AI 연결' },
    { id: 'bans', label: '기재 금지 문구', badge: d.settings.bannedTerms.length ? String(d.settings.bannedTerms.length) : undefined },
    { id: 'backup', label: '백업·보안' },
    { id: 'about', label: '정보' },
  ]);
  if (tab === 'school') return schoolCard(el);
  if (tab === 'bans') return bansCard(el);
  if (tab === 'ai') return aiCard(el);
  if (tab === 'backup') return backupCard(el);
  return aboutCard(el);
}

function schoolCard(el: HTMLElement) {
  const d = data();
  const st = { level: d.settings.schoolLevel, grade: d.settings.defaultGrade };
  const locked = d.students.length > 0;
  if (!d.students.length)
    el.append(
      h('div', { class: 'card welcome' },
        h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('spark', 24)), h('div', null, h('h2', null, '처음 사용하시나요?'), h('p', null, '왼쪽 메뉴 순서대로 진행하면 되고, 자세한 사용법은 왼쪽 아래 [사용 가이드]에 있습니다.\n먼저 이 화면에서 학교급·학년을 확인하고, [AI 연결] 탭에서 Gemini API 키를 등록하거나 Claude·ChatGPT 구독으로 로그인하세요.'))),
        h('ol', { class: 'steps' },
          h('li', null, h('b', null, '기본설정'), ' — 학교급·기본 학년, AI 연결, 기재 금지 문구'),
          h('li', null, h('b', null, '학급 및 학생 명단 입력'), ' — 양식 XLSX로 명단을 한 번에 올리기'),
          h('li', null, h('b', null, '교사 정보 설정'), ' — 담임 학급, 맡은 교과·수강집단, 동아리'),
          h('li', null, h('b', null, '학생 배정'), ' — 수강집단·동아리에 학생 연결'),
          h('li', null, h('b', null, '초안 작성 초기 설정'), ' — 작업별 입력 학기, 기재 제외 일괄 처리'),
          h('li', null, h('b', null, '관찰 기록 및 초안 작성'), ' — 관찰 → AI 후보 → 조합 → 윤문 → 검토'),
          h('li', null, h('b', null, '작성 내용 확인 및 출력'), ' — 현황 확인, XLSX·HWPX 출력'),
        ),
      ),
    );
  el.append(
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('settings', 24)), h('div', null, h('h2', null, '학교 정보'), h('p', null, '학교급·학년도·기본 학년과 적용 교육과정을 확인합니다.'))),
      h('div', { class: 'grid-3' },
        field('학교급', select([{ value: 'middle', label: '중학교' }, { value: 'high', label: '고등학교' }], st.level, (v) => {
          st.level = v as 'middle' | 'high';
        }, { disabled: locked }), locked ? '학생 명단이 있으면 바꿀 수 없습니다.' : undefined),
        field('학년도', h('input', { class: 'input', value: '2026', disabled: true }), '2026학년도 규칙만 지원합니다.'),
        field('기본 학년', select([1, 2, 3].map((g) => ({ value: g, label: `${g}학년` })), st.grade, (v) => (st.grade = v))),
      ),
      banner('info', '적용 교육과정', '2026학년도 기본값은 1·2학년 2022 개정, 3학년 2015 개정입니다. 복학·편입 등 예외 학생은 명단에서 학생별로 바꿉니다.'),
      h('div', { class: 'btn-row left' },
        h('button', { class: 'btn primary', onclick: async () => {
          const ok = await act('settings.update', {
            setupDone: true,
            ...(locked ? {} : { schoolLevel: st.level }),
            defaultGrade: st.grade,
          }, '학교 정보를 저장했습니다.');
          if (ok) S.render();
        } }, '학교 정보 저장'),
      ),
    ),
  );
}

function bansCard(el: HTMLElement) {
  const d = data();
  const terms = [...d.settings.bannedTerms];
  const inp = h('input', { class: 'input', placeholder: '예: UN, UNESCO, 유네스코 (쉼표로 여러 개)', 'aria-label': '기재 금지 문구 입력' });
  const save = async (next: string[]) => {
    if (await act('settings.update', { bannedTerms: next }, '기재 금지 문구를 저장했습니다.')) S.render();
  };
  const add = () => {
    const more = inp.value.split(',').map((x) => x.trim()).filter(Boolean);
    if (!more.length) return toast('추가할 문구를 입력하세요.', 'warn');
    void save([...terms, ...more]);
  };
  inp.addEventListener('keydown', (e) => e.key === 'Enter' && add());
  el.append(
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('alert', 24)), h('div', null, h('h2', null, '교사 지정 기재 금지 문구'), h('p', null, '기관·단체명처럼 쓰지 않을 표현을 직접 등록합니다. AI 요청에는 "쓰지 말 것"으로 넘기고, 관찰·조합·초안·최종 본문을 입력하는 동안 실시간으로 유의 표시합니다.'))),
      // 고등학교만: 학교명 입력란이 없으므로 학교를 알 수 있는 이름은 여기에 등록하도록 안내한다(2026-11-18 사용자 결정).
      d.settings.schoolLevel === 'high'
        ? banner('warn', '학교명 기재 금지(고등학교)',
            "학생이 재학(또는 졸업 예정)한 고등학교를 알 수 있는 내용(학교명, 재단명, 학교 축제명, 학교 별칭 등 학교를 알 수 있는 내용 일체)은 '인적·학적사항', 수상경력의 '수여기관', 봉사활동 실적의 '장소 또는 주관기관명'을 제외한 어떠한 항목에도 기재할 수 없습니다.\n우리 학교 이름·줄임말·재단명·축제명을 아래에 추가하면 최종 본문에서 막습니다.",
            h('span', { class: 'ban-source' }, '\n출처: 2026학년도 학교생활기록부 기재요령(고등학교) Ⅱ. 01 학교생활기록부 작성 시 유의사항 4.'))
        : null,
      h('div', { class: 'inline' }, inp, h('button', { class: 'btn', onclick: add }, icon('plus', 16), '추가'),
        BAN_PRESETS.some((g) => g.terms.some((t) => !terms.includes(t)))
          ? h('button', { class: 'btn secondary', title: '지운 기본 문구를 다시 넣습니다(직접 추가한 문구는 그대로 둠)', onclick: () => save([...terms, ...BAN_PRESETS.flatMap((g) => g.terms)]) }, '기본 목록 복원')
          : null,
        terms.length ? h('button', { class: 'btn ghost', onclick: () => window.confirm('등록한 기재 금지 문구를 모두 지울까요?') && save([]) }, '모두 지우기') : null),
      h('details', { class: 'replaced' }, h('summary', null, '기본 목록과 근거 보기'),
        h('p', { class: 'hint' }, '처음부터 아래 기본 목록이 들어 있습니다. 필요 없는 문구는 ×로 지우고 학교에서 더 막을 표현은 위에서 추가하세요.\n기본 목록은 2026 학교생활기록부 기재요령의 "어떠한 항목에도 기재할 수 없음" 조항(공인어학시험·교내외 대회·교외상·인증시험·논문·도서출간·지식재산권·해외 활동·부모 지위·장학금), 대회 용어 제한, 영재교육기관 수상, 기관명·상호명 금지 범주에서 뽑은 대표 표현입니다. 공개 라이선스로 배포된 생기부 금지어 목록은 찾지 못해 기재요령에서 직접 만들었습니다. 공인어학시험(TOEIC 등)·모의고사 같은 공식 금지 범주는 앱이 따로 검사합니다.'),
        h('ul', null, BAN_PRESETS.map((g) => h('li', null, h('b', null, g.group), ` — ${g.terms.join(', ')}`)))),
      terms.length
        ? h('div', { class: 'chips' }, terms.map((t) => h('span', { class: 'chip ban-chip' }, t, h('button', { class: 'icon-btn xs', 'aria-label': `${t} 삭제`, onclick: () => save(terms.filter((x) => x !== t)) }, icon('x', 12)))))
        : h('p', { class: 'empty' }, '등록한 문구가 없습니다.'),
      h('p', { class: 'hint' }, '영문은 대소문자를 구분하지 않고 단어 단위로 찾습니다(UN은 UNIT에 걸리지 않음), 한글은 부분 일치로 찾습니다.\n관찰 입력 단계에서는 경고만 하고, 최종 본문에 남아 있으면 검토 완료·출력을 막습니다. 공식 기재요령의 금지 범주(대회·어학시험 등)는 앱이 따로 검사합니다.'),
    ),
  );
}

async function aiCard(el: HTMLElement) {
  const d = data();
  const app = S.app!;
  const prov = d.settings.provider;
  // AI 제공자·키·모델 (참고: 아르봇 교사 콘솔의 "자동 선택 + 목록 불러오기 + 모델 테스트" 방식)
  const label = app.providers.find((p) => p.id === prov)!.label;
  const saved = d.settings.models[prov] ?? '';
  const cli = app.cliStatus?.[prov];
  // Gemini는 API 키, Claude·ChatGPT는 구독 CLI
  const isCli = prov !== 'gemini';
  const keyInput = h('input', { class: 'input', type: 'password', placeholder: app.keyStatus[prov] ? '등록됨 — 바꾸려면 새 키 입력' : 'API 키 입력', autocomplete: 'off' });
  const modelSel = h('select', { class: 'select', 'aria-label': 'AI 모델' });
  const fillModels = (models: string[], auto: string | null) => {
    const keep = modelSel.value || saved;
    modelSel.replaceChildren(
      h('option', { value: '' }, auto ? `자동 선택 (권장) → 현재 ${auto}` : '자동 선택 (권장)'),
      ...models.map((m) => h('option', { value: m }, `${m}${m === RECOMMENDED_MODEL[prov] ? ' ★ 권장' : ''}${m === auto ? ' (자동 선택 결과)' : ''}`)),
    );
    if (keep && !models.includes(keep)) modelSel.append(h('option', { value: keep }, `${keep} (저장된 모델 — 목록에 없음)`));
    modelSel.value = keep;
  };
  fillModels([], null);
  // 추론 강도(CLI 제공자만). 빈 값이면 CLI 기본값을 쓴다.
  const savedEffort = isCli ? (d.settings.efforts?.[prov as 'anthropic' | 'openai'] ?? '') : '';
  const effortSel = h('select', { class: 'select', 'aria-label': '추론 강도', 'data-testid': 'effort-select' },
    h('option', { value: '' }, 'CLI 기본값'),
    ...EFFORTS.map((e) => h('option', { value: e }, `${EFFORT_LABEL[e]} (${e})`)),
  );
  effortSel.value = savedEffort;
  const status = h('div', { class: 'status-slot' });
  const setStatus = (kind: 'ok' | 'err' | 'info' | 'warn', title: string, sub = '') => status.replaceChildren(banner(kind, title, sub));
  const noKey = !app.keyStatus[prov];
  const loadBtn = h('button', { class: 'btn secondary', disabled: noKey, onclick: async () => {
    loadBtn.disabled = true;
    setStatus('info', '사용 가능한 모델을 확인하는 중…');
    const r = await window.sgb.listModels(prov);
    loadBtn.disabled = false;
    if (!r.ok) return setStatus('err', '모델 목록을 불러오지 못했습니다', r.error);
    fillModels(r.value.models, r.value.auto);
    setStatus('ok', `사용 가능한 모델 ${r.value.models.length}개를 불러왔습니다`, '모델을 고른 뒤 [모델 테스트]로 실제 응답을 확인하고 [모델 저장]을 누르세요.');
  } }, icon('book', 16), '모델 목록 불러오기');
  const testBtn = h('button', { class: 'btn secondary', disabled: noKey, onclick: async () => {
    testBtn.disabled = true;
    setStatus('info', '모델이 응답하는지 확인하는 중… (학생 자료 없이 시험 문장 한 번만 보냅니다)');
    const r = await window.sgb.testModel(prov, modelSel.value, isCli ? effortSel.value : undefined);
    testBtn.disabled = false;
    if (!r.ok) return setStatus('err', '이 모델은 지금 사용할 수 없습니다', r.error);
    setStatus(r.value.ms > 30000 ? 'warn' : 'ok', `${r.value.model}${r.value.auto ? ' (자동 선택)' : ''} 모델이 정상 응답했습니다`, `${isCli ? `추론 강도 ${effortSel.value || 'CLI 기본값'} · ` : ''}응답 시간 ${(r.value.ms / 1000).toFixed(1)}초${isCli ? '(CLI 시작 시간 포함)' : ''}${r.value.ms > 30000 ? ' — 느립니다. 더 가벼운 모델을 고려하세요.' : ''} · [모델 저장]을 눌러야 작성에 반영됩니다.`);
  } }, icon('spark', 16), '모델 테스트');
  el.append(
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('spark', 24)), h('div', null, h('h2', null, 'AI 제공자와 모델'), h('p', null, 'Gemini는 API 키로, Claude·ChatGPT는 이 PC의 구독 CLI(Claude Code·Codex)를 화면 없이 실행해 요청합니다. 학생 이름은 임시 기호로 바꾸고, 이름이 남아 있으면 보내지 않습니다.'))),
      field('제공자', select(app.providers.map((p) => ({ value: p.id, label: `${p.label}${app.keyStatus[p.id] ? (p.id === 'gemini' ? ' (키 등록됨)' : ' (로그인됨)') : ''}` })), prov, async (v) => {
        await act('settings.update', { provider: v as Provider });
        S.render();
      })),
      h('div', { class: 'btn-row left tight' }, h('button', { class: 'btn secondary sm', onclick: () => openKeyGuide(prov) }, icon('book', 14), isCli ? '설치·로그인 안내' : 'API 키 발급 방법·요금 안내'), h('span', { class: 'muted' }, isCli ? 'CLI 설치, 로그인, 구독 한도, 함께 보내지는 정보' : '키 받는 법, 무료·유료, 월 구독과 API의 차이')),
      !isCli ? field(`${label} API 키`, h('div', { class: 'inline' }, keyInput,
        h('button', { class: 'btn', onclick: async () => {
          const st = await run(window.sgb.setKey(prov, keyInput.value), 'API 키를 Windows 계정 보호 저장소에 저장했습니다.');
          if (st) {
            app.keyStatus = st;
            keyInput.value = '';
            S.render();
          }
        } }, '저장'),
        app.keyStatus[prov] ? h('button', { class: 'btn ghost', onclick: async () => {
          const st = await run(window.sgb.removeKey(prov), '키를 삭제했습니다.');
          if (st) {
            app.keyStatus = st;
            S.render();
          }
        } }, '삭제') : '',
      ), '키는 업무 데이터·백업에 포함되지 않으며 화면에 다시 표시하지 않습니다. 다른 PC로 옮기면 다시 입력합니다.') : field(`${label} 상태`, h('div', { class: 'inline' },
        h('span', { class: `chip ${cli?.loggedIn ? 'ok' : 'warn'}`, 'data-testid': 'cli-status' }, cli ? (cli.installed ? cli.detail : 'CLI 미설치') : '확인 전'),
        h('button', { class: 'btn secondary', onclick: async () => {
          const st = await run(window.sgb.cliStatus(), 'CLI 상태를 다시 확인했습니다.');
          if (st) {
            app.keyStatus = st.keyStatus;
            app.cliStatus = st.cliStatus;
            S.render();
          }
        } }, '상태 다시 확인'),
        ...loginButtons(prov as 'anthropic' | 'openai', !!cli?.installed, !!cli?.loggedIn),
      ), prov === 'anthropic'
        ? '[Claude 로그인]을 누르면 Claude Code가 브라우저에 로그인 화면을 엽니다. 로그인 정보는 Claude Code가 저장하고, 이 앱은 읽거나 보관하지 않습니다.'
        : '[ChatGPT 로그인]을 누르면 Codex CLI가 준 로그인 화면을 브라우저로 엽니다. 로그인 정보는 Codex CLI가 저장하고, 이 앱은 읽거나 보관하지 않습니다.'),
      isCli ? loginPanel(prov as 'anthropic' | 'openai') : '',
      field('AI 모델', h('div', { class: 'inline' }, modelSel, loadBtn, testBtn), undefined, '선택 · 기본은 자동'),
      isCli ? field('추론 강도', effortSel, '높을수록 더 오래 생각해 느려지고 구독 한도를 더 씁니다. CLI 기본값은 모델마다 다릅니다. [모델 테스트]는 고른 강도로 시험하고, [모델 저장]을 눌러야 작성에 반영됩니다.', '선택 · 기본은 CLI 기본값') : '',
      banner('info', RECOMMENDED_MODEL[prov] ? `권장 모델: ${RECOMMENDED_MODEL[prov]}` : '권장 모델: 자동(Codex가 돌려준 목록의 첫 모델)', prov === 'anthropic' ? 'Claude는 Sonnet 5.5를 권장합니다. 품질과 속도·구독 한도 소모의 균형이 좋습니다(Opus는 느리고 한도를 많이 씁니다).' : prov === 'openai' ? 'ChatGPT 계정의 Codex는 Codex 전용 모델만 허용합니다. 비워 두면 Codex가 돌려준 목록의 첫 모델을 씁니다. Codex는 요청마다 CLI 자체 지시가 함께 갑니다. 앱이 필요 없는 도구 설명을 빼서 줄였지만 Claude보다 한도 소모가 큽니다.' : 'Gemini는 gemini-3.5-flash를 권장합니다. 이름에 lite가 붙은 모델은 빠르고 무료 한도에 유리하지만 윤문 분량이 들쭉날쭉했습니다.\nGemini Flash는 제공자 쪽이 혼잡하면 짧은 요청도 1~2분 걸릴 수 있습니다(lite는 보통 몇 초). 급할 때는 lite 모델이나 다른 제공자를 고르세요.'),
      h('div', { class: 'btn-row left tight' }, h('button', { class: 'btn secondary sm', 'aria-haspopup': 'dialog', onclick: () => void openModelCompare(prov) }, icon('spark', 14), 'AI 모델별 결과 비교 보기')),
      h('p', { class: 'hint' }, '비워 두면(자동) 목록에 권장 모델이 있으면 그것을, 없으면 비슷한 급의 최신 정식 모델을 고르며, 미리 보기·실험 모델은 자동으로 고르지 않습니다.\n제공자가 모델을 종료·교체해 응답이 오지 않으면 [모델 목록 불러오기]에서 지금 쓸 수 있는 모델을 골라 [모델 테스트] 후 저장하세요. 어떤 모델로 보냈는지는 후보·윤문 결과에 표시됩니다.'),
      noKey && !isCli ? banner('warn', `${label} API 키를 먼저 저장해야 모델 목록·테스트를 쓸 수 있습니다.`) : '',
      noKey && isCli ? banner('warn', cli?.installed ? `${label}에 로그인되어 있지 않습니다.` : `${label} CLI를 찾지 못했습니다.`, cli?.installed ? `위의 [${prov === 'anthropic' ? 'Claude' : 'ChatGPT'} 로그인]을 누르세요. 로그인해야 모델 목록·테스트를 쓸 수 있습니다.` : '[설치·로그인 안내]를 따라 CLI를 설치한 뒤 [상태 다시 확인]을 누르세요. 설치되면 이 화면에서 로그인할 수 있습니다.') : '',
      status,
      h('div', { class: 'btn-row left' }, h('button', { class: 'btn', onclick: async () => {
        const what = `${modelSel.value || '자동 선택'}${isCli ? ` · 추론 강도 ${effortSel.value || 'CLI 기본값'}` : ''}`;
        if (await act('settings.update', { models: { [prov]: modelSel.value }, ...(isCli ? { efforts: { [prov]: effortSel.value } } : {}) }, `${what}(으)로 저장했습니다.`)) S.render();
      } }, '모델 저장'), h('span', { class: 'muted' }, `현재 저장: ${saved || '자동 선택'}${isCli ? ` · 추론 강도 ${savedEffort || 'CLI 기본값'}` : ''}`)),
      h('hr'),
      h('label', { class: 'check strong' }, (() => {
        const cb = h('input', { type: 'checkbox', checked: d.settings.confirmBeforeSend });
        cb.addEventListener('change', async () => (await act('settings.update', { confirmBeforeSend: cb.checked }, cb.checked ? '전송 전 문안 확인 창을 켰습니다.' : '전송 전 문안 확인 창을 껐습니다.')) && S.render());
        return cb;
      })(), ' AI 요청마다 전송 문안 확인 창 띄우기'),
      h('p', { class: 'hint' }, '기본은 꺼짐입니다. 켜면 요청마다 실제로 보낼 문안(익명화 결과)을 보여 주고 확인을 받은 뒤 보냅니다. 꺼져 있어도 익명화·이름 잔존 검사는 똑같이 합니다.'),
    ),
  );
}

const restored = (r: { data: AppData; kept: string } | null | undefined) => {
  if (!r) return;
  S.app!.data = r.data;
  S.recordId = '';
  toast('복원했습니다. 복원 전 자료는 앱 폴더에 보관했습니다.\n다른 PC라면 Gemini API 키를 다시 등록하거나 그 PC에서 CLI에 다시 로그인하세요.', 'ok');
  S.render();
};

const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`;
};

/** 백업 폴더 상태·자동 백업·이동용 백업·복원 */
function backupPanel() {
  const box = h('div', { class: 'backup-panel' }, h('p', { class: 'muted' }, '백업 폴더를 확인하는 중…'));
  void (async () => {
    const st = await run(window.sgb.backupStatus());
    if (!st) return;
    const moves = st.files.filter((f) => f.kind === 'move');
    const lastMove = moves[0];
    const stale = !lastMove || Date.now() - Date.parse(lastMove.at) > 14 * 86400000;
    const restoreBtn = (f: (typeof st.files)[number]) => h('button', { class: 'btn ghost sm', onclick: async () => {
      if (f.kind === 'auto') {
        if (!(await confirmText('자동 백업에서 복원', `${f.name}의 내용으로 현재 자료 전체를 바꿉니다. 바꾸기 전 현재 자료는 앱 폴더에 보관합니다.`, '복원'))) return;
        restored(await run(window.sgb.backupRestoreNamed(f.name)));
      } else {
        const pw = await promptPassword('이동용 백업 복원', `${f.name}을 만들 때 정한 비밀번호를 입력하세요.\n현재 자료 전체를 백업 내용으로 바꾸며, 바꾸기 전 현재 자료는 앱 폴더에 보관합니다.`);
        if (!pw) return;
        restored(await run(window.sgb.backupRestoreNamed(f.name, pw)));
      }
    } }, '복원');
    box.replaceChildren(
      st.lastError
        ? banner('err', '자동 백업 실패', `${st.lastError} — 백업 폴더를 확인하세요.`)
        : banner('ok', `자동 백업 켜짐 · ${st.intervalMin}분마다, 앱을 닫을 때`, `마지막 자동 백업: ${st.lastAutoAt ? ago(st.lastAutoAt) : '이번 실행에서는 아직 없음(내용이 바뀌면 저장)'}. 자동 백업은 비밀번호 없이 이 PC·이 Windows 계정에서만 열리고, 최근 14일치를 하루 1개씩 보관합니다.`),
      stale ? banner('warn', lastMove ? `마지막 이동용 백업이 ${ago(lastMove.at)}입니다.` : '이동용 백업이 아직 없습니다.', 'PC 고장·교체에 대비하려면 [이동용 백업 만들기]로 비밀번호 백업을 만들고 USB나 학교 드라이브에 복사해 두세요.') : '',
      h('p', { class: 'hint' }, '백업 폴더: ', h('code', null, st.dir)),
      h('div', { class: 'btn-row left' },
        h('button', { class: 'btn', onclick: async () => {
          const pw = await promptPassword('이동용 백업 비밀번호', '다른 PC에서 복원할 때 이 비밀번호가 필요합니다. 앱은 비밀번호를 저장하지 않으니 잊지 않게 적어 두세요(8자 이상).', true);
          if (!pw) return;
          const p = await run(window.sgb.backupCreate(pw));
          if (p) {
            toast(`이동용 백업을 백업 폴더에 저장했습니다: ${p}`, 'ok');
            S.render();
          }
        } }, '이동용 백업 만들기'),
        h('button', { class: 'btn secondary', onclick: async () => {
          const r = await run(window.sgb.backupAutoNow());
          if (r) toast(r === 'saved' ? '자동 백업을 지금 저장했습니다.' : r === 'empty' ? '학생·기록이 없는 빈 자료는 자동 백업하지 않습니다(기존 백업을 지키기 위해).' : '바뀐 내용이 없어 저장하지 않았습니다.', 'ok');
          S.render();
        } }, '지금 자동 백업'),
        h('button', { class: 'btn secondary', onclick: () => run(window.sgb.backupOpenFolder()) }, '백업 폴더 열기'),
        h('button', { class: 'btn ghost', onclick: async () => {
          const pw = await promptPassword('다른 위치의 백업에서 복원', 'USB 등에 있는 이동용 백업(.sgbak)의 비밀번호를 입력하세요. 자동 백업(.sgauto)을 고를 때는 아무 글자나 넣어도 됩니다.\n현재 자료 전체를 바꾸며, 바꾸기 전 현재 자료는 앱 폴더에 보관합니다.');
          if (!pw) return;
          restored(await run(window.sgb.backupRestore(pw)));
        } }, '다른 위치에서 복원'),
      ),
      st.files.length
        ? h('table', { class: 'table backup-list' },
            h('thead', null, h('tr', null, h('th', null, '파일'), h('th', null, '종류'), h('th', null, '저장 시각'), h('th', null, ''))),
            h('tbody', null, st.files.slice(0, 20).map((f) => h('tr', null,
              h('td', null, f.name),
              h('td', null, f.kind === 'auto' ? '자동(이 PC 전용)' : '이동용(비밀번호)'),
              h('td', null, new Date(f.at).toLocaleString('ko-KR')),
              h('td', null, restoreBtn(f)),
            ))),
          )
        : h('p', { class: 'muted' }, '백업 폴더에 아직 백업이 없습니다.'),
    );
  })();
  return box;
}

function backupCard(el: HTMLElement) {
  const app = S.app!;
  el.append(
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('lock', 24)), h('div', null, h('h2', null, '백업·복원·잠금'), h('p', null, '백업에는 학생 ID·명단·작업 연결·관찰·후보·조각 출처·편집본·검토 상태가 들어가고 API 키와 CLI 로그인 정보는 들어가지 않습니다.'))),
      backupPanel(),
      h('hr'),
      app.lockMode === 'password'
        ? h('div', null, banner('ok', '앱 잠금 사용 중', '시작할 때 비밀번호를 묻습니다. 비밀번호를 잊으면 잠긴 자료를 복구할 수 없습니다.'), h('div', { class: 'btn-row left' }, h('button', { class: 'btn ghost', onclick: async () => {
          if (await run(window.sgb.lockDisable(), '앱 잠금을 껐습니다.')) {
            app.lockMode = 'os';
            S.render();
          }
        } }, '앱 잠금 끄기')))
        : h('div', null, h('p', { class: 'hint' }, '지금은 Windows 계정 보호로 저장 키를 감싸지만, 같은 계정의 다른 프로그램까지 막지는 못합니다. 앱 잠금을 켜면 시작할 때 비밀번호가 필요합니다.'), h('div', { class: 'btn-row left' }, h('button', { class: 'btn secondary', onclick: async () => {
          const pw = await promptPassword(
            '앱 잠금 비밀번호 설정',
            '이 비밀번호를 잊으면 앱 안의 자료를 열 수 없습니다. 누구도 대신 풀어 줄 수 없으니 반드시 따로 적어 두세요.\n잊었을 때는 잠금 화면의 [비밀번호를 잊었어요]로 앱 자료를 초기화한 뒤, 같은 PC에서는 자동 백업(비밀번호 없음)으로, 다른 PC에서는 이동용 백업으로 복원할 수 있습니다. 백업 이후의 작업은 되돌릴 수 없습니다.',
            true,
            '이 비밀번호를 잊으면 앱 자료를 열 수 없다는 것을 이해했고 비밀번호를 따로 적어 두었습니다.',
          );
          if (!pw) return;
          if ((await window.sgb.lockEnable(pw)).ok) {
            toast('앱 잠금을 켰습니다.', 'ok');
            app.lockMode = 'password';
            S.render();
          }
        } }, '앱 잠금 켜기'))),
    ),
  );
}

function aboutCard(el: HTMLElement) {
  const app = S.app!;
  el.append(
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('info', 24)), h('div', null, h('h2', null, '정보'), h('p', null, `앱 ${app.versions.app} · 규칙 ${app.versions.rules} · 루브릭 ${app.versions.rubric} · 프롬프트 ${app.versions.prompt}`))),
      h('p', { class: 'hint' }, '이 앱은 공식 교육정보시스템이나 기재요령을 대신하지 않습니다. 규칙 검사는 보조 수단이며 통과 표시가 공식 적합성을 뜻하지 않습니다.\n윤문 지침 일부는 im-not-ai(MIT)를 바탕으로 재구성했습니다.'),
      h('div', { class: 'btn-row left' },
        h('button', { class: 'btn ghost', onclick: () => void openPrivacy() }, '개인정보처리방침 보기'),
        h('button', { class: 'btn ghost', onclick: () => run(window.sgb.openLicenses()) }, '오픈소스 고지 보기'),
        h('button', { class: 'btn danger', onclick: async () => {
          if (!(await confirmText('전체 자료 삭제', '이 PC의 모든 학생·기록·저장 키를 지웁니다. 따로 저장한 백업·출력 파일은 지워지지 않습니다.', '전체 삭제'))) return;
          const r = await run(window.sgb.wipe('전체 삭제'), '전체 자료를 삭제했습니다.');
          if (r) {
            S.app = r;
            S.render();
          }
        } }, '전체 자료 삭제'),
      ),
    ),
  );
}
