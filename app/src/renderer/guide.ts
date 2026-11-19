import { APP_NAME, APP_NAME_EN, BACKUP_DIR_NAME } from '../core/brand';
import { h, modal, toast } from './dom';
import { run, S } from './state';

/** 사이드바 [지금 자동 백업]: 문서 폴더의 백업 폴더에 바로 저장한다. */
export async function backupNow() {
  const r = await run(window.sgb.backupAutoNow());
  if (!r) return;
  toast(
    r === 'saved' ? '자동 백업을 지금 저장했습니다.' : r === 'empty' ? '기존 백업을 지키기 위해 학생·기록이 없는 빈 자료는 백업하지 않습니다.' : '마지막 백업 뒤로 바뀐 내용이 없어 새로 저장하지 않았습니다.',
    r === 'saved' ? 'ok' : 'info',
  );
  if (S.screen === 'settings' && S.sub.settings === 'backup') S.render();
}

/** 외부 링크: 앱 안에서 이동하지 않고 기본 브라우저(새 창)로 연다. 주소는 main 프로세스의 허용 목록에 있다. */
function extLink(id: string, href: string, label: string) {
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: 'ext-link', onclick: (e: Event) => {
    e.preventDefault();
    void run(window.sgb.openGuideLink(id));
  } }, label);
}

interface GuideSection {
  title: string;
  /** 맨 위에 강조해서 보여 줄 안내 */
  important?: boolean;
  steps?: { title: string; items: string[] }[];
  items?: string[];
}

/** 사용 가이드 본문. 문장은 짧게, 한 줄에 한 가지씩 적는다. */
const GUIDE: GuideSection[] = [
  {
    title: '꼭 기억해 주세요',
    important: true,
    items: [
      '이 앱은 생활기록부 작성을 돕는 보조 도구이며, 기록을 쓰고 책임지는 사람은 선생님입니다.',
      'AI가 만든 문장은 초안입니다. 관찰한 사실과 맞는지, 부풀리거나 빠뜨린 내용은 없는지 선생님이 직접 확인해 주세요.',
      '무엇을 어떻게 기재할지는 선생님이 최종 판단합니다. 앱의 검사와 경고는 참고용이며 기재 금지 사항을 모두 잡아내지는 못합니다.',
      '학교생활기록부 기재요령과 학교의 학업성적관리규정·지침을 먼저 따라 주세요.',
      '교육정보시스템(NEIS)에 넣기 전에 Byte와 내용을 한 번 더 확인해 주세요.',
      '학생 이름은 보내기 전에 자동으로 가립니다. 그래도 주소·가족 사항처럼 학생을 알아볼 수 있는 내용은 관찰 기록에 적지 마세요.',
    ],
  },
  {
    title: '전체 흐름',
    items: [
      '사이드바 위쪽 [설정] 1~5단계를 먼저 한 번 마칩니다.',
      '그다음 아래쪽 [생기부 작성 및 확인] 6~7단계에서 학생별 문장을 쓰고 출력합니다.',
    ],
  },
  {
    title: '설정',
    steps: [
      { title: '1. 기본설정', items: [
        '학교급(중학교·고등학교)과 기본 학년을 고릅니다. 학년도는 2026학년도로 정해져 있습니다.',
        '[AI 연결]에서 쓸 AI 제공자를 고릅니다. Gemini는 API 키를 등록하고(이 PC에 암호화해 저장), Claude·ChatGPT는 이 PC에 Claude Code·Codex CLI를 설치한 뒤 [Claude 로그인]·[ChatGPT 로그인]을 눌러 브라우저에서 구독 계정으로 로그인합니다. 로그인 정보는 각 CLI가 저장하고 이 앱은 보관하지 않습니다.',
        '[기재 금지 문구]에 학교에서 쓰지 않는 표현을 등록합니다. 입력하는 동안 바로 표시되고, 최종 본문에서는 막힙니다.',
      ] },
      { title: '2. 학급 및 학생 명단 입력', items: ['학급을 만든 뒤 엑셀 파일이나 붙여넣기로 명단을 한 번에 넣습니다.'] },
      { title: '3. 교사 정보 설정', items: ['담임 학급, 맡은 교과 과목, 맡은 동아리를 정합니다.'] },
      { title: '4. 학생 배정', items: ['교과 수업 반과 동아리에 학생을 연결합니다.', '작업에서 뺄 학생도 여기서 고릅니다.'] },
      { title: '5. 초안 작성 초기 설정', items: [
        '작업마다 지금 입력할 학기를 정합니다.',
        '행동특성 및 종합의견처럼 1년에 한 번만 쓰는 영역은 [학기 구분 없음]으로 바꿉니다.',
        '기재하지 않을 학생은 [기재 제외 일괄 처리]로 한 번에 뺍니다.',
      ] },
    ],
  },
  {
    title: '생기부 작성 및 확인',
    steps: [
      { title: '6. 관찰 기록 및 초안 작성', items: [
        '작업, 영역, 학생 순서로 고릅니다. 학기는 5단계에서 정한 학기로 열립니다.',
        '[관찰 기록]: 맨 위 자유 작성란에 관찰한 내용을 적고, 해당하는 루브릭 항목과 학생이 참여한 행사를 고릅니다.',
        '[AI 후보]: 항목별 후보 문장을 받습니다. 학생 이름은 보내기 전에 자동으로 가립니다.',
        '[항목별 조합]: 알맞은 문장을 골라 항목마다 정리합니다.',
        '[영역 취합]·[최종 윤문]: 조합한 문장을 하나로 모은 뒤 목표 분량(150자·300자·500자)에 맞게 다듬습니다.',
        '[최종 본문·검토]: 사실과 맞는지 확인하고 [검토 완료]를 누릅니다.',
      ] },
      { title: '7. 작성 내용 확인 및 출력', items: [
        '[작성 현황]에서 작업·영역별 진행 상황을 봅니다. 학생 이름을 누르면 그 기록으로 갑니다.',
        '작업별 또는 학생별로 XLSX·HWPX 파일을 저장합니다.',
      ] },
    ],
  },
  {
    title: '백업',
    items: [
      `자동 백업은 문서 폴더의 "${BACKUP_DIR_NAME}"에 저장됩니다.`,
      '사이드바 아래 [지금 자동 백업]을 누르면 바로 저장합니다.',
      '다른 PC로 옮길 때는 기본설정 > 백업·보안에서 이동용 백업을 만드세요.',
    ],
  },
];

export function openGuide() {
  return modal('사용 가이드', () =>
    h('div', { class: 'guide' },
      h('p', { class: 'guide-credit' },
        `${APP_NAME}(${APP_NAME_EN})은 Dorms의 @Tachyon 선생님의 생기부 작성 도우미 LITE를 기반으로 제작되었습니다.`,
        h('br'),
        extLink('original', 'https://dorms.school/apps/6a94b4dc-040e-4b49-8ecd-b909ea6ef01a', '원글 보기 (dorms.school)'),
      ),
      GUIDE.map((sec) =>
        h('section', { class: `guide-sec ${sec.important ? 'guide-important' : ''}` },
          h('h3', null, sec.title),
          sec.items ? h('ul', { class: 'plain-list' }, sec.items.map((t) => h('li', null, t))) : null,
          sec.steps?.map((st) => h('div', { class: 'guide-step' }, h('h4', null, st.title), h('ul', { class: 'plain-list' }, st.items.map((t) => h('li', null, t))))),
        ),
      ),
    ), true, { backdropClose: true });
}

/** 푸터 "두리쌤" 제작자 안내. 표시만 하는 창이라 앱 자료에는 손대지 않는다. */
export function openCredit() {
  return modal('제작자 안내', () =>
    h('div', { class: 'credit' },
      h('section', { class: 'card credit-card' },
        h('h2', null, '✨ 제작: 두리쌤'),
        h('h3', null, '📌 라이선스 (MIT License)'),
        h('ul', { class: 'plain-list' },
          h('li', null, '누구나 자유롭게 사용·복사·수정·재배포할 수 있습니다.'),
          h('li', null, '배포할 때는 저작권 표시(Copyright (c) 2026 두리쌤)와 MIT 라이선스 전문을 함께 넣어주세요.'),
          h('li', null, '앱은 아무런 보증 없이 "있는 그대로" 제공되며, 기록의 최종 확인과 책임은 사용자에게 있습니다.'),
          h('li', null, 'MIT 라이선스 전문은 앱에 함께 들어 있는 오픈소스 고지 파일(THIRD_PARTY_NOTICES.txt) 맨 앞에 있습니다.'),
        ),
      ),
      h('section', { class: 'card credit-card' },
        h('h3', null, '📷 문의'),
        h('ul', { class: 'plain-list' },
          h('li', null, 'Instagram: ', extLink('instagram', 'https://www.instagram.com/trdoolee', 'trdoolee')),
          h('li', null, 'Blog: ', extLink('blog', 'https://blog.naver.com/trdoolee', 'blog.naver.com/trdoolee')),
        ),
        h('p', { class: 'credit-note' }, '간단한 질문 위주로 답변드리며, 답변이 늦어질 수 있습니다.'),
      ),
    ), false, { backdropClose: true, className: 'credit-modal' });
}

