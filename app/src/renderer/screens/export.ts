import type { Area } from '../../core/schema';
import { banner, chip, clear, field, h, icon, select, toast } from '../dom';
import { AREA_NAME, data, run, STATE_LABEL } from '../state';

const AREAS_BY_KIND: Record<'homeroom' | 'subject' | 'club', Area[]> = { homeroom: ['autonomy', 'career', 'behavior'], subject: ['subject'], club: ['club'] };
const st = { workId: '', area: '' as Area | '', sems: [1] as (1 | 2)[] };

/** 화면 머리글에는 제목에 없는 정보만 보여 준다(작업·영역·과목·수강집단은 제목에 있음). 파일에는 전체 정보를 넣는다. */
const SCREEN_META = ['학교급', '학년도', '학기'];

export async function renderExport(el: HTMLElement) {
  const d = data();
  const dash = (await run(window.sgb.dashboard())) ?? [];
  if (!dash.length) return void el.append(banner('info', '출력할 작업이 없습니다.'));
  if (!dash.some((w) => w.workId === st.workId)) st.workId = dash[0]!.workId;
  const w = d.works.find((x) => x.id === st.workId)!;
  const areas = AREAS_BY_KIND[w.kind];
  if (!areas.includes(st.area as Area)) st.area = areas[0]!;
  const group = w.kind === 'subject' ? d.courseGroups.find((g) => g.id === w.refId) : undefined;
  if (group) st.sems = [group.semester];
  const annual = !!w.annualAreas?.includes(st.area as Area);
  if (annual) st.sems = [1];
  const out = h('div');
  const rerender = () => {
    clear(el);
    void renderExport(el);
  };
  el.append(
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('download', 24)), h('div', null, h('h2', null, '출력 대상'), h('p', null, '선택한 작업·영역의 검토 완료 기록만 파일에 담으며, 실명은 이 PC에서만 결합합니다.\n교육정보시스템이 자동 표시하는 학기명·과목명은 넣지 않습니다.'))),
      h('div', { class: 'grid-3' },
        field('작업', select(dash.map((x) => ({ value: x.workId, label: x.label })), st.workId, (v) => {
          st.workId = v;
          rerender();
        })),
        field('영역', select(areas.map((a) => ({ value: a, label: AREA_NAME[a] })), st.area as Area, (v) => {
          st.area = v;
          rerender();
        })),
        field('학기', annual ? h('p', { class: 'hint' }, '연간(학기 구분 없음)') : group ? h('p', { class: 'hint' }, `${group.semester}학기(수강집단 학기)`) : h('div', { class: 'seg' }, [[1], [2], [1, 2]].map((s) => h('button', { class: `seg-btn ${JSON.stringify(st.sems) === JSON.stringify(s) ? 'on' : ''}`, onclick: () => {
          st.sems = s as (1 | 2)[];
          rerender();
        } }, s.length === 2 ? '1·2학기 연결' : `${s[0]}학기`))), group ? undefined : '여러 학기를 고르면 학기순으로 줄바꿈 하나로 잇습니다(창체 앱 기본값). 행특 학기 표기는 기록에서 켭니다.'),
      ),
    ),
    out,
  );
  const plan = await run(window.sgb.exportPlan(st.workId, st.area as Area, st.sems));
  if (!plan) return;
  const s = plan.summary as Record<keyof typeof STATE_LABEL, number>;
  out.append(
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('dashboard', 24)), h('div', null, h('h2', null, plan.title), h('p', null, plan.meta.filter((m: any) => SCREEN_META.includes(m.label)).map((m: any) => `${m.label}: ${m.value}`).join(' · '))),
        h('div', { class: 'right btn-row tight' },
          h('button', { class: 'btn', disabled: !plan.rows.length, onclick: () => save('xlsx') }, 'XLSX 저장'),
          h('button', { class: 'btn secondary', disabled: !plan.rows.length, onclick: () => save('hwpx') }, 'HWPX 저장'))),
      h('div', { class: 'chips' }, (Object.keys(STATE_LABEL) as (keyof typeof STATE_LABEL)[]).map((k) => chip(`${STATE_LABEL[k]} ${s[k]}`, k === 'reviewed' || k === 'reason' ? 'ok' : k === 'empty' ? 'danger' : ''))),
      plan.allStudentsRequired && plan.skipped.length ? banner('warn', `전원 입력 대상입니다. 출력하지 않는 학생 ${plan.skipped.length}명이 있습니다.`, '부분 출력은 전원 작성 완료를 뜻하지 않으니 아래 사유를 확인하세요.') : null,
      plan.skipped.length ? h('details', { class: 'skipped', open: plan.skipped.length <= 8 }, h('summary', null, `출력 제외 ${plan.skipped.length}명`), h('ul', null, plan.skipped.map((x: any) => h('li', null, `${x.name}: ${x.reason}`)))) : null,
      plan.rows.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, '반'), h('th', null, '번호'), h('th', null, '이름'), h('th', null, '본문'), h('th', null, 'Byte'))), h('tbody', null, plan.rows.map((r: any) => h('tr', null, h('td', null, String(r.classNo)), h('td', null, String(r.number)), h('td', null, r.name), h('td', { class: 'pre' }, r.text), h('td', null, String(r.bytes)))))))
        : h('p', { class: 'empty' }, '검토 완료 기록이 없습니다.'),
    ),
  );
  async function save(format: 'xlsx' | 'hwpx') {
    const r = await run(window.sgb.exportFile(st.workId, st.area as Area, st.sems, format));
    if (r) toast(`${r.rows}명을 저장했습니다${r.skipped ? ` (제외 ${r.skipped}명)` : ''}: ${r.path}`, 'ok');
  }
}

const sst = { classKey: '', studentId: '' };

/** 학생별 출력: 학급 → 학생을 고르면 그 학생의 모든 영역·작업 기록(검토 완료)을 한 파일로 저장한다. */
export async function renderStudentExport(el: HTMLElement) {
  const d = data();
  if (!d.students.length) return void el.append(banner('info', '학생이 없습니다.'));
  const sorted = [...d.students].sort((a, b) => a.grade - b.grade || a.classNo - b.classNo || a.number - b.number);
  const classes = [...new Set(sorted.map((s) => `${s.grade}-${s.classNo}`))];
  if (!classes.includes(sst.classKey)) sst.classKey = classes[0]!;
  const inClass = sorted.filter((s) => `${s.grade}-${s.classNo}` === sst.classKey);
  if (!inClass.some((s) => s.id === sst.studentId)) sst.studentId = inClass[0]!.id;
  const idx = inClass.findIndex((s) => s.id === sst.studentId);
  const rerender = () => {
    clear(el);
    void renderStudentExport(el);
  };
  const out = h('div');
  el.append(
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('users', 24)), h('div', null, h('h2', null, '학생별 출력'), h('p', null, '한 학생의 자율·동아리·진로·과목 세특·행특 가운데 검토 완료한 기록을 한 파일로 모읍니다. 학생 상담·점검용이며, 교육정보시스템 입력은 작업별 출력을 쓰세요.'))),
      h('div', { class: 'grid-3' },
        field('학급', select(classes.map((k) => ({ value: k, label: `${k.split('-')[0]}학년 ${k.split('-')[1]}반` })), sst.classKey, (v) => {
          sst.classKey = v;
          sst.studentId = '';
          rerender();
        })),
        field('학생', h('div', { class: 'inline' },
          select(inClass.map((s) => ({ value: s.id, label: `${s.number}번 ${s.name}` })), sst.studentId, (v) => {
            sst.studentId = v;
            rerender();
          }),
          h('button', { class: 'icon-btn', 'aria-label': '이전 학생', disabled: idx <= 0, onclick: () => ((sst.studentId = inClass[idx - 1]!.id), rerender()) }, icon('up', 16)),
          h('button', { class: 'icon-btn', 'aria-label': '다음 학생', disabled: idx >= inClass.length - 1, onclick: () => ((sst.studentId = inClass[idx + 1]!.id), rerender()) }, icon('down', 16)),
        )),
      ),
    ),
    out,
  );
  const plan = await run(window.sgb.studentExportPlan(sst.studentId));
  if (!plan) return;
  out.append(
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('dashboard', 24)), h('div', null, h('h2', null, plan.title), h('p', null, `검토 완료 ${plan.rows.length}건 · 출력 제외 ${plan.skipped.length}건`)),
        h('div', { class: 'right btn-row tight' },
          h('button', { class: 'btn', disabled: !plan.rows.length, onclick: () => save('xlsx') }, 'XLSX 저장'),
          h('button', { class: 'btn secondary', disabled: !plan.rows.length, onclick: () => save('hwpx') }, 'HWPX 저장'))),
      plan.skipped.length ? h('details', { class: 'skipped', open: false }, h('summary', null, `출력 제외 ${plan.skipped.length}건(미작성·검토 전)`), h('ul', null, plan.skipped.map((x) => h('li', null, `${x.name}: ${x.reason}`)))) : null,
      plan.rows.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'table student-export' }, h('thead', null, h('tr', null, h('th', null, '영역'), h('th', null, '작업'), h('th', null, '학기'), h('th', null, '본문'), h('th', null, 'Byte'))), h('tbody', null, plan.rows.map((r) => h('tr', null, h('td', null, r.area), h('td', null, r.work), h('td', null, r.semester), h('td', { class: 'pre' }, r.text), h('td', null, String(r.bytes)))))))
        : h('p', { class: 'empty' }, '이 학생의 검토 완료 기록이 없습니다.'),
    ),
  );
  async function save(format: 'xlsx' | 'hwpx') {
    const r = await run(window.sgb.studentExportFile(sst.studentId, format));
    if (r) toast(`${r.rows}건을 저장했습니다: ${r.path}`, 'ok');
  }
}
