import policy from '../../PRIVACY.md';
import { h, modal } from './dom';
import { run } from './state';

/**
 * 개인정보처리방침 창. 본문은 origin/app/PRIVACY.md 하나만 원본으로 두고 빌드할 때 그대로 넣는다.
 * 쓰는 Markdown은 제목(#, ##), 목록(-), 문단뿐이다. 주소는 main이 허용한 링크만 기본 브라우저로 연다.
 */
const LINK_IDS: Record<string, string> = {
  'https://www.instagram.com/trdoolee': 'instagram',
  'https://blog.naver.com/trdoolee': 'blog',
};

function inline(text: string): (Node | string)[] {
  // 주소 뒤의 쉼표·닫는 괄호는 주소에 넣지 않는다.
  return text.split(/(https:\/\/[^\s,)]+)/).map((part) => {
    const id = LINK_IDS[part];
    if (!id) return part;
    return h('a', { href: part, class: 'ext-link', onclick: (e: Event) => {
      e.preventDefault();
      void run(window.sgb.openGuideLink(id));
    } }, part);
  });
}

/** PRIVACY.md를 화면 요소로 바꾼다. 첫 줄 제목(#)은 창 제목으로 쓰므로 본문에서 뺀다. */
export function renderPolicy(md: string): HTMLElement {
  const out = h('div', { class: 'guide privacy' });
  let list: HTMLElement | null = null;
  for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('- ')) list = null;
    if (!line || line.startsWith('# ')) continue;
    if (line.startsWith('## ')) out.append(h('h3', null, line.slice(3)));
    else if (line.startsWith('- ')) {
      if (!list) out.append((list = h('ul', { class: 'plain-list' })));
      list.append(h('li', null, ...inline(line.slice(2))));
    } else out.append(h('p', null, ...inline(line)));
  }
  return out;
}

export function openPrivacy() {
  return modal('개인정보처리방침', () => renderPolicy(policy), true, { backdropClose: true });
}
