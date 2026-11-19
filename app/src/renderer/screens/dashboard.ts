import { charCount, measure } from '../../core/bytes';
import { banner, h, icon } from '../dom';
import { go } from '../app';
import { act, AREA_NAME, data, run, S, type DashboardWork } from '../state';

const KIND_LABEL = { homeroom: '담임', subject: '교과', club: '동아리' } as const;

export async function renderDashboard(el: HTMLElement) {
  const works = (await run(window.sgb.dashboard())) ?? [];
  const d = data();
  const totals = { empty: 0, drafting: 0, reviewed: 0, reason: 0, excluded: 0 };
  works.forEach((w) => w.cells.forEach((c) => Object.entries(c.counts).forEach(([k, v]) => (totals[k as keyof typeof totals] += v))));
  const kpi = (label: string, value: number | string, sub: string, kind = '') => h('div', { class: `kpi ${kind}` }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, String(value)), h('div', { class: 'kpi-sub' }, sub));
  el.append(
    h('div', { class: 'kpi-row' },
      kpi('학생', d.students.length, `작업 ${works.length}개`),
      kpi('검토 완료', totals.reviewed + totals.reason, '최종 출력 가능 기록', 'ok'),
      kpi('작성 중', totals.drafting, '검토 전 또는 검토 후 변경', 'warn'),
      kpi('미작성', totals.empty, '전원 입력 대상 확인 필요', 'danger'),
    ),
  );
  if (!works.length) {
    el.append(
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('users', 24)), h('div', null, h('h2', null, '작업이 아직 없습니다'), h('p', null, '교사 정보 설정에서 담임 학급, 교과 수강집단, 동아리를 만드세요.'))),
        h('div', { class: 'btn-row left' }, h('button', { class: 'btn primary', onclick: () => go('teacher') }, '교사 정보 설정으로 이동')),
      ),
    );
    return;
  }
  if (!S.app!.keyStatus[d.settings.provider]) el.append(banner('warn', 'AI 제공자가 연결되지 않았습니다.', '설정 > AI 연결에서 Gemini API 키를 등록하거나, Claude Code·Codex CLI를 설치한 뒤 [Claude 로그인]·[ChatGPT 로그인]으로 로그인해야 후보 생성·윤문을 요청할 수 있습니다. 관찰 입력과 직접 작성은 지금도 가능합니다.'));
  el.append(
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('dashboard', 24)), h('div', null, h('h2', null, '작업별 현황'), h('p', null, '칸을 누르면 아래에 학생별 진행 상황이 펼쳐지고, 학생 이름을 누르면 관찰 기록 및 초안 작성으로 이동합니다.\n창체·행특은 두 학교급 모두 모든 학생 입력 대상입니다.'))),
      h('div', { class: 'work-grid' }, works.map(workCard)),
    ),
  );
}

function workCard(w: DashboardWork) {
  return h('div', { class: 'work-card' },
    h('div', { class: 'work-head' }, h('span', { class: `chip kind-${w.kind}` }, KIND_LABEL[w.kind]), h('b', null, w.label), h('span', { class: 'muted' }, `${w.studentCount}명${w.excludedCount ? ` · 제외 ${w.excludedCount}` : ''}`)),
    w.clubType && !['regular', 'sportsRegular'].includes(w.clubType) ? h('p', { class: 'hint' }, '특기사항 작성 대상이 아닌 동아리 유형입니다.') : null,
    w.subjectKind && ['unsupported', 'majorPractice'].includes(w.subjectKind) ? h('p', { class: 'hint' }, '앱에서 지원하지 않는 과목 유형입니다(생성·최종 출력 불가).') : null,
    // 영역·학기 칸은 한 줄에 하나씩 나열하고, 펼친 학생별 진행은 누른 칸 바로 아래에 붙인다.
    h('div', { class: 'cells' }, w.cells.flatMap((c) => {
      const total = Object.values(c.counts).reduce((a, b) => a + b, 0) - c.counts.excluded;
      const done = c.counts.reviewed + c.counts.reason;
      const pct = total ? Math.round((done / total) * 100) : 0;
      const key = `${w.workId}:${c.area}:${c.semester}`;
      return [h('button', { class: `cell ${openCell === key ? 'on' : ''}`, 'aria-expanded': openCell === key ? 'true' : 'false', onclick: () => {
        openCell = openCell === key ? '' : key;
        S.render();
      } },
        h('span', { class: 'cell-name' }, `${AREA_NAME[c.area]} · ${c.annual ? '연간' : `${c.semester}학기`}`),
        h('div', { class: 'bar' }, h('span', { class: 'bar-ok', style: `width:${pct}%` }), h('span', { class: 'bar-mid', style: `width:${total ? Math.round((c.counts.drafting / total) * 100) : 0}%` })),
        h('b', { class: 'cell-count' }, `${done}/${total}`),
        h('span', { class: 'cell-sub' }, `작성 중 ${c.counts.drafting} · 미작성 ${c.counts.empty}`),
      ), openCell === key ? studentList(w, c) : null];
    })),
  );
}

let openCell = '';
const STATE_LABEL = { empty: '미작성', drafting: '작성 중', reviewed: '검토 완료', reason: '사유 입력', excluded: '기재 제외' } as const;
const STATE_PCT = { empty: 0, drafting: 50, reviewed: 100, reason: 100, excluded: 100 } as const;

/** 작업·영역·학기 칸을 펼친 학생별 진행 목록. 이름을 누르면 그 학생 기록으로 이동한다. */
function studentList(w: DashboardWork, c: DashboardWork['cells'][number]) {
  const d = data();
  const students = w.studentIds.map((id) => d.students.find((s) => s.id === id)!).filter(Boolean).sort((a, b) => a.grade - b.grade || a.classNo - b.classNo || a.number - b.number);
  return h('div', { class: 'stu-progress' },
    h('div', { class: 'stu-progress-head' }, h('b', null, `${AREA_NAME[c.area]} · ${c.annual ? '연간' : `${c.semester}학기`} 학생별 진행`), h('span', { class: 'muted' }, `${students.length}명`)),
    h('ul', { class: 'stu-rows' }, students.map((s) => {
      const st = c.states[s.id] ?? 'empty';
      const r = d.records.find((x) => x.studentId === s.id && x.workId === w.workId && x.area === c.area && x.semester === c.semester);
      const text = r ? r.finalText.trim() || r.draft.trim() : '';
      const len = charCount(text);
      const step = !r ? '시작 전' : st === 'reviewed' || st === 'reason' ? '검토 완료' : r.finalText.trim() ? '최종 본문 작성' : r.polish ? '윤문 받음' : r.draft.trim() ? '초안 취합' : r.compositions.length ? '항목 조합' : r.candidates.length ? 'AI 후보 받음' : st === 'excluded' ? '기재 제외' : '관찰 입력';
      return h('li', { class: `stu-row st-${st}` },
        h('button', { class: 'link-btn', onclick: () => void jumpTo(w.workId, c.area, c.semester, s.id) }, `${s.classNo}반 ${s.number}번 ${s.name}`),
        h('div', { class: 'bar sm', 'aria-label': `${STATE_LABEL[st]} ${STATE_PCT[st]}%` }, h('span', { class: st === 'drafting' ? 'bar-mid' : 'bar-ok', style: `width:${STATE_PCT[st]}%` })),
        h('span', { class: `chip ${st === 'reviewed' || st === 'reason' ? 'ok' : st === 'drafting' ? 'warn' : st === 'empty' ? 'danger' : ''}` }, STATE_LABEL[st]),
        h('span', { class: 'muted' }, `${step}${len ? ` · ${len}자(${measure(text).bytes}Byte)` : ''}`),
      );
    })),
  );
}

/** 학생 기록으로 이동. 그 칸의 학기가 초기 설정의 입력 학기와 다르면 입력 학기를 바꿀지 먼저 묻는다(관찰 기록 화면은 학기를 바꾸지 않는다). */
async function jumpTo(workId: string, area: DashboardWork['cells'][number]['area'], semester: 1 | 2, studentId: string) {
  const w = data().works.find((x) => x.id === workId);
  if (w && w.kind !== 'subject' && !w.annualAreas?.includes(area) && (w.activeSemester ?? 1) !== semester) {
    if (!window.confirm(`이 작업의 입력 학기는 ${w.activeSemester ?? 1}학기입니다.\n${semester}학기 기록을 열려면 입력 학기를 ${semester}학기로 바꿔야 합니다.\n\n입력 학기를 바꾸고 이동할까요?`)) return;
    if (!(await act('work.setSemester', { workId, semester }))) return;
  }
  S.sel = { studentId, semester, workId, area };
  S.recordId = '';
  S.sub.write = 'obs';
  go('write');
}

