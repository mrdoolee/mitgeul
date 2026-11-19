import type { Provider } from '../core/schema';
import { banner, h, modal } from './dom';
import { run } from './state';

/** 공식 사이트만 연다(주 프로세스에서도 같은 목록으로 다시 확인한다). */
export const GUIDE_LINKS = {
  geminiKey: 'https://aistudio.google.com/apikey',
  geminiPricing: 'https://ai.google.dev/gemini-api/docs/pricing',
  claudeSetup: 'https://code.claude.com/docs/en/setup',
  claudeLegal: 'https://code.claude.com/docs/en/legal-and-compliance',
  claudePricing: 'https://claude.com/pricing',
  codexSetup: 'https://developers.openai.com/codex/cli',
  codexPricing: 'https://chatgpt.com/pricing',
} as const;
export type GuideLink = keyof typeof GUIDE_LINKS;

const link = (id: GuideLink, text: string) => h('button', { class: 'link-btn', onclick: () => run(window.sgb.openGuideLink(id)) }, `${text} ↗`);
const code = (s: string) => h('code', null, s);

interface Guide {
  name: string;
  site: Node;
  steps: (string | Node)[];
  cost: string[];
  pricing: GuideLink;
}

const GUIDES: Partial<Record<Provider, () => Guide>> = {
  gemini: () => ({
    name: 'Google Gemini (API 키)',
    site: link('geminiKey', 'Google AI Studio 키 발급 페이지'),
    steps: [
      'Google 계정으로 Google AI Studio에 로그인합니다.',
      '왼쪽 메뉴 또는 상단의 [Get API key]를 누릅니다.',
      '[API 키 만들기(Create API key)]를 누르고 프로젝트를 고르거나 새로 만듭니다.',
      '만들어진 키(AIza로 시작)를 복사해 이 앱의 API 키 칸에 붙여 넣고 [저장]을 누릅니다.',
    ],
    cost: [
      '무료 등급이 있어 결제 정보 없이 바로 쓸 수 있지만, 분당·하루 요청 수 제한이 있습니다. 한 학급을 연달아 작성하면 "요청 한도 초과(429)"가 날 수 있으니 잠시 뒤 다시 시도하세요.',
      '무료 등급에서 보낸 내용은 Google 서비스 개선에 쓰일 수 있다고 안내되어 있습니다. 이 앱은 학생 이름을 임시 기호로 바꿔 보내지만, 관찰 내용 자체는 전송된다는 점을 학교 방침과 함께 확인하세요.',
      'Google Cloud 결제 계정을 연결하면 유료 등급이 되어 한도가 커지고, 쓴 만큼 요금이 나옵니다.',
      '키는 Windows 계정 보호 저장소에 암호화해 보관하고 백업에 넣지 않습니다. 키가 노출됐다고 생각되면 발급 사이트에서 삭제하고 새로 만드세요.',
    ],
    pricing: 'geminiPricing',
  }),
  anthropic: () => ({
    name: 'Claude (Claude Code)',
    site: link('claudeSetup', 'Claude Code 설치 안내(공식)'),
    steps: [
      '공식 안내 페이지의 Windows 설치 명령으로 Claude Code를 설치합니다(설치 위치: 사용자 폴더\\.local\\bin\\claude.exe).',
      '이 앱의 기본설정 > AI 연결에서 제공자를 Claude로 고르고 [상태 다시 확인]을 누르면 [Claude 로그인] 버튼이 생깁니다.',
      '[Claude 로그인]을 누르면 기본 브라우저에 Claude 로그인 화면이 열립니다. Claude 구독 계정으로 로그인하고 [승인]을 누르면 자동으로 "로그인됨"이 됩니다.',
      '브라우저에 코드가 나오면 코드 전체를 복사해 앱의 코드 칸에 붙여 넣고 [코드 넣기]를 누릅니다. 브라우저가 열리지 않았으면 [로그인 화면 다시 열기]를 누릅니다.',
      '[모델 테스트]로 실제 응답을 확인한 뒤 [모델 저장]을 누릅니다. 권장 모델은 claude-sonnet-5-5입니다.',
      h('span', null, '로그아웃은 같은 자리의 [로그아웃]으로 합니다. 이 PC의 Claude Code 로그인이 풀리므로 터미널에서 쓰는 Claude Code도 함께 로그아웃됩니다. 터미널에서 ', code('claude auth login'), '으로 로그인해도 앱에서 그대로 쓸 수 있습니다.'),
    ],
    cost: [
      'Claude Pro·Max 등 구독 요금제의 사용 한도 안에서 쓰입니다. API 크레딧은 쓰지 않습니다.',
      '윤문 한 건에 분량·어조 보정으로 최대 6번 요청합니다. 한 학급을 연달아 작성하면 구독 한도에 걸릴 수 있습니다.',
    ],
    pricing: 'claudePricing',
  }),
  openai: () => ({
    name: 'ChatGPT (Codex CLI)',
    site: link('codexSetup', 'Codex CLI 설치 안내(공식)'),
    steps: [
      '공식 안내 페이지에 따라 Codex CLI를 설치합니다(Windows 설치본: 사용자 폴더\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe).',
      '이 앱의 기본설정 > AI 연결에서 제공자를 ChatGPT로 고르고 [상태 다시 확인]을 누르면 [ChatGPT 로그인] 버튼이 생깁니다.',
      '[ChatGPT 로그인]을 누르면 기본 브라우저에 ChatGPT 로그인 화면이 열립니다. ChatGPT 계정으로 로그인하고 허용을 누르면 자동으로 "로그인됨"이 됩니다. 기본 브라우저에 이미 로그인된 ChatGPT 계정이 쓰이므로, 다른 계정을 쓰려면 그 브라우저에서 계정을 바꾼 뒤 로그인합니다.',
      '브라우저 로그인이 잘 안 되면 [코드로 로그인]을 누릅니다. 앱에 나온 코드를 [코드 입력 화면 열기]로 연 브라우저 화면(또는 다른 기기의 브라우저)에 입력하면 연결됩니다. 코드 입력 화면에 "보안 설정에서 기기 코드 로그인을 활성화"하라는 안내가 나오면 ChatGPT 설정 > 보안에서 Codex 기기 코드 로그인을 켜거나, [다시 로그인]으로 브라우저 로그인을 씁니다.',
      '[모델 목록 불러오기]로 쓸 수 있는 모델을 확인하고 [모델 테스트]로 실제 응답을 확인한 뒤 [모델 저장]을 누릅니다.',
      h('span', null, '로그아웃은 같은 자리의 [로그아웃]으로 합니다. 터미널에서 쓰는 Codex도 함께 로그아웃됩니다. 터미널에서 ', code('codex login'), '으로 로그인해도 앱에서 그대로 쓸 수 있습니다.'),
    ],
    cost: [
      'ChatGPT Plus·Pro 등 요금제의 Codex 사용 한도 안에서 쓰입니다. API 크레딧은 쓰지 않습니다. 한도가 적은 계정은 [모델 테스트]에서 "구독 사용 한도에 걸렸습니다"가 나올 수 있으니, 안내된 시각 뒤에 다시 하거나 다른 계정으로 로그인하세요.',
      'ChatGPT 계정의 Codex는 Codex 전용 모델만 쓸 수 있습니다(gpt-5.4-mini 같은 API 모델은 거부됨).',
      'Codex는 요청마다 자체 지시·도구 설명이 함께 갑니다. 앱이 글쓰기에 필요 없는 도구·스킬 설명을 빼서 줄였지만(시험 문장 기준 약 11,500 → 6,250토큰), 여전히 Claude보다 한도 소모가 큽니다.',
    ],
    pricing: 'codexPricing',
  }),
};

/** 제공자별 안내: 제목을 누르면 아래로 펼쳐지는 상자. 지금 고른 제공자만 처음부터 펼친다. */
function providerSection(p: Provider, open: boolean) {
  const g = GUIDES[p]?.();
  if (!g) return null;
  return h('details', { class: 'guide-acc', open },
    h('summary', null, h('b', null, g.name), h('span', { class: 'muted' }, p === 'gemini' ? '키 발급 방법' : '설치·로그인 방법')),
    h('p', null, g.site),
    h('h4', null, '순서'),
    h('ol', null, g.steps.map((s) => h('li', null, s))),
    h('h4', null, p === 'gemini' ? '무료·유료' : '사용 한도'),
    h('ul', null, g.cost.map((s) => h('li', null, s))),
    h('p', { class: 'hint' }, '요금제: ', link(g.pricing, '공식 요금 안내')),
  );
}

/** AI 연결 안내: Gemini API 키 발급, 구독 CLI 설치·로그인·주의 */
export function openKeyGuide(current: Provider) {
  const order: Provider[] = ['gemini', 'anthropic', 'openai'];
  void modal('AI 연결 안내', () =>
    h('div', { class: 'key-guide' },
      banner('info', 'Gemini는 API 키로, Claude·ChatGPT는 이 PC에 설치한 구독 CLI로 부릅니다.', 'Gemini는 Google AI Studio에서 받은 API 키로 요청합니다. Claude는 Claude Code(claude -p), ChatGPT는 Codex CLI(codex exec)를 이 앱이 화면 없이 실행합니다. 로그인은 기본설정 > AI 연결의 [Claude 로그인]·[ChatGPT 로그인] 버튼으로 하며, 로그인 정보는 각 CLI가 저장하고 이 앱은 읽거나 보관하지 않습니다.'),
      h('section', { class: 'guide-sec' },
        h('h3', null, '제공자별 연결 방법'),
        h('p', { class: 'hint' }, '제공자 이름을 누르면 순서와 요금 안내가 펼쳐집니다.'),
        ...order.map((p) => providerSection(p, p === current)),
      ),
      h('section', { class: 'guide-sec' },
        h('h3', null, '구독 CLI가 함께 보내는 정보'),
        h('ul', null,
          h('li', null, '이 앱은 학생 이름을 임시 기호로 바꾼 문안만 CLI에 넘기고, 이름이 남아 있으면 실행하지 않습니다.'),
          h('li', null, '그러나 CLI는 자체 지시와 함께 계정 정보(Claude는 계정 이메일), 작업 폴더·OS, 날짜 같은 환경 정보를 덧붙여 보냅니다. Codex는 이 PC에 설치한 Codex 스킬 이름도 함께 보냅니다. 이 부분은 앱이 확인하거나 막을 수 없습니다.'),
          h('li', null, '앱은 CLI를 빈 임시 폴더에서 도구·사용자 설정·MCP·세션 저장 없이 실행하고, 끝나면 임시 폴더를 지웁니다.'),
        ),
      ),
    ), true);
}
