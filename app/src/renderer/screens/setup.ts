import type { Area, Student } from '../../core/schema';
import { banner, chip, h, icon, modal, toast } from '../dom';
import { act, AREA_NAME, data, S, useTabs } from '../state';
import { allWorks, AREAS_BY_KIND, inputSemesterOf, rosterOfWork, semesterText, type WorkItem } from '../works';

const KIND_TABS = [
  { kind: 'homeroom', id: 'homeroom', label: '담임 학급' },
  { kind: 'subject', id: 'subject', label: '교과 수업 반' },
  { kind: 'club', id: 'club', label: '동아리' },
] as const;

/** 5단계: 초안 작성 초기 설정. 작업별 입력 학기·학기 구분·기재 제외를 정하면 관찰 기록 및 초안 작성에 그대로 반영된다. */
export function renderSetup(el: HTMLElement) {
  const d = data();
  const works = allWorks();
  if (!works.length) {
    el.append(banner('info', '아직 작업이 없습니다.', '교사 정보 설정에서 담임 학급·교과 수업 반·동아리를 먼저 만드세요.'));
    return;
  }
  const kinds = KIND_TABS.filter((k) => works.some((x) => x.w.kind === k.kind));
  const tab = useTabs(kinds.map((k) => ({ id: k.id, label: k.label, badge: String(works.filter((x) => x.w.kind === k.kind).length) })));
  const list = works.filter((x) => x.w.kind === tab);
  el.append(
    banner('info', '여기서 정한 대로 관찰 기록 및 초안 작성 화면이 열립니다.',
      h('span', { class: 'lines' },
        h('span', null, '작업마다 ① 학기 구분(학기별/학기 구분 없음)을 먼저 고르고, 학기별이면 ② 입력 학기(1·2학기)를 고르세요. 행특처럼 한 영역만 1년에 한 번 쓰려면 아래 표에서 그 영역만 [학기 구분 없음]으로 바꿉니다.'),
        h('span', null, '기재하지 않을 학생은 [기재 제외 일괄 처리]로 한 번에 뺍니다. 관찰 기록 화면에서는 학기를 바꿀 수 없고 여기서 정한 학기만 보여 줍니다.'),
      )),
  );
  el.append(...list.map(workCard));
}

function workCard(item: WorkItem) {
  const d = data();
  const w = item.w;
  const roster = rosterOfWork(w.id);
  const sem = w.activeSemester ?? 1;
  // ① 학기 구분(학기별/학기 구분 없음)을 먼저 고르고, 학기별 영역이 있으면 ② 입력 학기(1·2학기)를 고른다.
  const areas = AREAS_BY_KIND[w.kind];
  const nAnnual = item.fixedSemester ? 0 : areas.filter((a) => inputSemesterOf(item, a).annual).length;
  const subjAnnual = !!item.fixedSemester && inputSemesterOf(item, 'subject').annual;
  const mode: 'term' | 'annual' | 'mixed' =nAnnual === 0 ? 'term' : nAnnual === areas.length ? 'annual' : 'mixed';
  const modeBtn = (m: 'term' | 'annual', label: string, title: string) =>
    h('button', { class: `seg-btn ${mode === m ? 'on' : ''}`, 'aria-pressed': mode === m ? 'true' : 'false', title, onclick: () => mode !== m && void setAnnualAll(item, m === 'annual') }, label);
  return h('div', { class: 'card setup-work' },
    h('div', { class: 'card-head' },
      h('div', { class: 'tile' }, icon(w.kind === 'homeroom' ? 'users' : w.kind === 'subject' ? 'book' : 'spark', 24)),
      h('div', null, h('h2', null, item.label), h('p', null, `작성 대상 ${roster.length}명`)),
    ),
    h('div', { class: 'setup-sem setup-mode' },
      h('span', { class: 'setup-label' }, '① 학기 구분'),
      item.fixedSemester
        ? h('span', { class: 'inline' }, chip(subjAnnual ? '학기 구분 없음' : '학기별', 'ok'), h('span', { class: 'muted' }, '교과는 교사 정보 설정에서 수업 반을 만들 때 정한 학기를 따릅니다.'))
        : h('span', { class: 'inline' },
            h('div', { class: 'seg' }, modeBtn('term', '학기별', '1·2학기를 나눠 작성'), modeBtn('annual', '학기 구분 없음', '1년에 한 번만 작성(예: 행특)')),
            mode === 'mixed' ? chip('영역마다 다름 · 아래 표 참고', 'warn') : null,
            h('span', { class: 'muted' }, '이 작업의 모든 영역에 적용하며, 영역마다 다르게 하려면 아래 표에서 바꿉니다.'),
          ),
    ),
    mode === 'annual' || subjAnnual ? null : h('div', { class: 'setup-sem' },
      h('span', { class: 'setup-label' }, '② 입력 학기'),
      item.fixedSemester
        ? h('span', { class: 'inline' }, chip(`${item.fixedSemester}학기`, 'ok'), h('span', { class: 'muted' }, '수강집단 학기로 정해지며, 바꾸려면 교사 정보 설정에서 수업 반을 고칩니다.'))
        : h('span', { class: 'inline' },
            h('div', { class: 'seg' }, ...[1, 2].map((n) => h('button', { class: `seg-btn ${sem === n ? 'on' : ''}`, 'aria-pressed': sem === n ? 'true' : 'false', onclick: async () => {
              if (sem === n) return;
              if (await act('work.setSemester', { workId: w.id, semester: n }, `${item.label}: 입력 학기를 ${n}학기로 바꿨습니다.`)) {
                S.recordId = '';
                S.render();
              }
            } }, `${n}학기`))),
            mode === 'mixed' ? h('span', { class: 'muted' }, '학기별 영역에만 적용합니다.') : null,
          ),
    ),
    h('div', { class: 'setup-areas' },
      h('div', { class: 'setup-area head' }, h('span', null, '영역'), h('span', null, '영역별 학기 구분'), h('span', null, '관찰 기록에서 쓰는 학기'), h('span', null, '기재 제외'), h('span')),
      AREAS_BY_KIND[w.kind].map((area) => {
        const s = inputSemesterOf(item, area);
        const excluded = roster.filter((st) => d.records.some((r) => r.studentId === st.id && r.workId === w.id && r.area === area && r.semester === s.semester && r.mode === 'excluded')).length;
        return h('div', { class: 'setup-area' },
          h('b', null, AREA_NAME[area]),
          item.fixedSemester
            ? h('span', { class: 'muted' }, subjAnnual ? '학기 구분 없음' : '학기별')
            : h('div', { class: 'seg' },
                h('button', { class: `seg-btn ${!s.annual ? 'on' : ''}`, 'aria-pressed': !s.annual ? 'true' : 'false', onclick: () => s.annual && void setAnnual(item, area, false) }, '학기별'),
                h('button', { class: `seg-btn ${s.annual ? 'on' : ''}`, 'aria-pressed': s.annual ? 'true' : 'false', title: '1년에 한 번만 작성(예: 행특)', onclick: () => !s.annual && void setAnnual(item, area, true) }, '학기 구분 없음'),
              ),
          chip(semesterText(s), s.annual ? '' : 'ok'),
          h('span', { class: excluded ? '' : 'muted' }, excluded ? `${excluded}명 제외` : '없음'),
          h('button', { class: 'btn ghost sm', disabled: !roster.length, onclick: () => bulkExclude(w.id, area, s.semester, roster, `${item.label} · ${s.annual ? '연간' : `${s.semester}학기`} · ${AREA_NAME[area]}`) }, '기재 제외 일괄 처리'),
        );
      }),
    ),
    roster.length ? null : h('p', { class: 'hint' }, '이 작업에 배정된 학생이 없습니다. 학생 배정에서 연결하세요.'),
  );
}

/** 작업의 모든 영역을 학기별 또는 학기 구분 없음으로 한 번에 바꾼다. */
async function setAnnualAll(item: WorkItem, on: boolean) {
  const targets = AREAS_BY_KIND[item.w.kind].filter((a) => inputSemesterOf(item, a).annual !== on);
  if (!targets.length) return;
  const ok = on
    ? window.confirm(`${item.label}의 모든 영역을 1년에 한 번만 작성합니다.\n\n· 1학기 칸에 씁니다.\n· 2학기는 작성·현황·출력 대상에서 빠집니다.\n· 2학기에 이미 쓴 내용은 지우지 않고 숨깁니다.\n\n계속할까요?`)
    : window.confirm(`${item.label}의 모든 영역을 다시 1·2학기로 나눠 작성합니다.\n지금까지 쓴 연간 내용은 1학기 칸에 남습니다.\n\n계속할까요?`);
  if (!ok) return;
  for (const area of targets) if (!(await act('work.setAnnual', { workId: item.w.id, area, annual: on }))) return S.render();
  toast(on ? `${item.label}: 모든 영역을 학기 구분 없음(연간)으로 바꿨습니다.` : `${item.label}: 모든 영역을 학기별로 바꿨습니다. 입력 학기를 고르세요.`, 'ok');
  S.recordId = '';
  S.render();
}

async function setAnnual(item: WorkItem, area: Area, on: boolean) {
  const name = AREA_NAME[area];
  const ok = on
    ? window.confirm(`${item.label}의 ${name}을(를) 1년에 한 번만 작성합니다.\n\n· 1학기 칸에 씁니다.\n· 2학기는 작성·현황·출력 대상에서 빠집니다.\n· 2학기에 이미 쓴 내용은 지우지 않고 숨깁니다.\n\n계속할까요?`)
    : window.confirm(`${name}을(를) 다시 1·2학기로 나눠 작성합니다.\n지금까지 쓴 연간 내용은 1학기 칸에 남습니다.\n\n계속할까요?`);
  if (!ok) return;
  if (await act('work.setAnnual', { workId: item.w.id, area, annual: on }, on ? `${name}: 학기 구분 없음(연간)으로 바꿨습니다.` : `${name}: 1·2학기 구분으로 바꿨습니다.`)) {
    S.recordId = '';
    S.render();
  }
}

/** 기재 제외 일괄 처리: 작업·학기·영역의 학생 명단에서 제외할 학생을 한 번에 고른다. */
export async function bulkExclude(workId: string, area: Area, semester: 1 | 2, roster: Student[], label: string) {
  const d = data();
  const isEx = (sid: string) => d.records.some((x) => x.studentId === sid && x.workId === workId && x.area === area && x.semester === semester && x.mode === 'excluded');
  const boxes = new Map<string, HTMLInputElement>();
  const res = await modal<boolean>('기재 제외 일괄 처리', (close) => {
    const list = h('div', { class: 'bulk-list' }, roster.map((s) => {
      const cb = h('input', { type: 'checkbox', checked: isEx(s.id) });
      boxes.set(s.id, cb);
      return h('label', { class: 'check' }, cb, ` ${s.number}번 ${s.name}`);
    }));
    const all = (v: boolean) => boxes.forEach((cb) => (cb.checked = v));
    return h('div', null,
      h('p', null, h('b', null, label)),
      h('ul', { class: 'plain-list' },
        h('li', null, '체크한 학생은 기재 제외로 바뀝니다(작성·출력 대상 아님).'),
        h('li', null, '체크를 푼 학생은 다시 작성 대상이 됩니다.'),
        h('li', null, '이미 쓴 내용은 지우지 않습니다.'),
      ),
      h('div', { class: 'btn-row left tight' }, h('button', { class: 'btn ghost sm', onclick: () => all(true) }, '전체 선택'), h('button', { class: 'btn ghost sm', onclick: () => all(false) }, '전체 해제')),
      list,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: () => close(false) }, '취소'), h('button', { class: 'btn primary', onclick: () => close(true) }, '적용')),
    );
  });
  if (!res) return;
  const excludeIds = [...boxes].filter(([, cb]) => cb.checked).map(([id]) => id);
  const includeIds = [...boxes].filter(([, cb]) => !cb.checked).map(([id]) => id);
  const n = await act('record.bulkExclude', { workId, area, semester, excludeIds, includeIds });
  if (n !== undefined) {
    toast(`기재 제외 상태를 ${n}명 바꿨습니다. (제외 ${excludeIds.length}명)`, 'ok');
    S.recordId = '';
    S.render();
  }
}
