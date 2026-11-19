import { checkText, type Finding } from '../core/rules';
import type { Area } from '../core/schema';
import { h } from './dom';
import { data } from './state';

/**
 * 입력 중 실시간 유의 표시. 교사 지정 기재 금지 문구와 공통 금지 규칙(대회·어학시험·기관명 등)을 타이핑하는 동안 바로 보여 준다.
 * 저장·검토 차단은 기존 검사(main)가 맡고, 여기서는 알림만 한다.
 */
export function liveCheck(control: HTMLTextAreaElement | HTMLInputElement, area: Area | 'any' = 'any'): HTMLElement {
  const box = h('div', { class: 'live-check', 'aria-live': 'polite' });
  let timer: number | undefined;
  const run = () => {
    const d = data();
    const list: Finding[] = checkText(control.value, {
      level: d.settings.schoolLevel,
      area: area === 'any' ? 'behavior' : area,
      curriculum: '2022',
      customBans: d.settings.bannedTerms ?? [],
      rosterFullNames: [],
      rosterPartialNames: [],
    });
    const seen = new Map<string, Finding>();
    for (const f of list) if (!seen.has(`${f.category}|${f.match}`)) seen.set(`${f.category}|${f.match}`, f);
    control.classList.toggle('has-warn', seen.size > 0);
    box.replaceChildren(
      ...[...seen.values()].slice(0, 6).map((f) =>
        h('span', { class: `live-chip ${f.ruleId === 'custom-ban' ? 'ban' : ''}`, title: f.message }, h('b', null, `“${f.match}”`), ` ${f.category}`),
      ),
    );
  };
  control.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(run, 120);
  });
  run();
  return box;
}
