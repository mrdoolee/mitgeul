import { CLUB_TYPE_LABEL, clubTypeNote } from '../../core/rules';
import { COMMON_GROUPS, type ClubType, type Student, type SubjectKind } from '../../core/schema';
import { append, banner, chip, clear, confirmText, field, h, icon, modal, select, toast } from '../dom';
import { go } from '../app';
import { act, data, run, S, useTabs } from '../state';
import { groupTermText } from '../works';

type ListKind = 'class' | 'courseGroup' | 'club';

const KIND_LABEL: Record<SubjectKind, string> = {
  general: '일반 과목',
  common: '공통과목 1·2(합산)',
  yearlong: '학년제 과목(고3, 1·2학기 합산)',
  majorPractice: '전공실무(미지원)',
  unsupported: '별도 경로 과목(미지원)',
};

function studentLabel(s: Student) {
  return `${s.grade}-${s.classNo} ${s.number}번 ${s.name}`;
}
function sortStudents(list: Student[]) {
  return [...list].sort((a, b) => a.grade - b.grade || a.classNo - b.classNo || a.number - b.number);
}

/** 2단계: 학급 및 학생 명단 입력 */
export function renderStudents(el: HTMLElement) {
  const d = data();
  const tab = useTabs([
    { id: 'bulk', label: '명단 일괄 입력' },
    { id: 'classes', label: '학급', badge: String(d.classes.length) },
    { id: 'list', label: '학생 명단', badge: String(d.students.length) },
  ]);
  if (tab === 'bulk') el.append(bulkCard());
  else if (tab === 'list') el.append(studentsCard());
  else el.append(classesCard('students'));
}

/** 3단계: 교사 정보 설정(담임 학급·교과 과목·동아리) */
export function renderTeacher(el: HTMLElement) {
  const d = data();
  const level = d.settings.schoolLevel;
  const tab = useTabs([
    { id: 'homeroom', label: '담임 학급 설정' },
    { id: 'subjects', label: '교과 과목 설정', badge: d.subjects.length ? String(d.subjects.length) : undefined },
    { id: 'clubs', label: '동아리 설정', badge: d.clubs.length ? String(d.clubs.length) : undefined },
  ]);
  el.append(tab === 'homeroom' ? classesCard('teacher') : tab === 'subjects' ? subjectsCard(level) : clubsCard(level));
}

/** 4단계: 학생 배정(수강집단·동아리·학급 구성원, 작업 제외) */
export function renderAssign(el: HTMLElement) {
  const d = data();
  const tab = useTabs([
    { id: 'groups', label: '교과 수업 반', badge: d.courseGroups.length ? String(d.courseGroups.length) : undefined },
    { id: 'clubs', label: '동아리', badge: d.clubs.length ? String(d.clubs.length) : undefined },
    { id: 'homeroom', label: '담임 학급' },
  ]);
  el.append(tab === 'groups' ? groupsAssignCard() : tab === 'clubs' ? clubsAssignCard() : classesCard('assign'));
}


function recordCount(pred: (workId: string) => boolean) {
  const d = data();
  return d.records.filter((r) => pred(r.workId) && (r.finalText.trim() || r.draft.trim() || r.observations.length || r.freeNote.trim() || r.eventObs.length)).length;
}

async function confirmDelete(what: string, n: number, extra = '') {
  return window.confirm(`${what}을(를) 삭제합니다.${n ? ` 작성 중이거나 작성한 기록 ${n}건도 함께 지워집니다.` : ''}${extra} 학생 명단은 지우지 않습니다. 삭제할까요?`);
}

async function homeroomOff(classId: string) {
  const d = data();
  const w = d.works.find((x) => x.kind === 'homeroom' && x.refId === classId);
  if (!w || !(await confirmDelete('담임 작업', recordCount((id) => id === w.id), ' 이 학급의 행사 목록도 지워집니다.'))) return;
  if (await act('homeroom.set', { classId, on: false }, '담임 작업을 껐습니다.')) S.render();
}

async function deleteClass(classId: string) {
  const d = data();
  const c = d.classes.find((x) => x.id === classId)!;
  const w = d.works.find((x) => x.kind === 'homeroom' && x.refId === classId);
  if (!(await confirmDelete(`${c.grade}학년 ${c.classNo}반 학급`, w ? recordCount((id) => id === w.id) : 0))) return;
  if (await act('class.delete', { id: classId }, '학급을 삭제했습니다.')) S.render();
}

async function deleteSubject(subjectId: string) {
  const d = data();
  const s = d.subjects.find((x) => x.id === subjectId)!;
  const groups = d.courseGroups.filter((g) => g.subjectId === subjectId).map((g) => g.id);
  const works = d.works.filter((w) => w.kind === 'subject' && groups.includes(w.refId)).map((w) => w.id);
  if (!(await confirmDelete(`과목 "${s.name}"`, recordCount((id) => works.includes(id)), groups.length ? ` 수강집단 ${groups.length}개도 지워집니다.` : ''))) return;
  if (await act('subject.delete', { id: subjectId }, '과목을 삭제했습니다.')) S.render();
}

async function deleteGroup(groupId: string) {
  const d = data();
  const g = d.courseGroups.find((x) => x.id === groupId)!;
  const w = d.works.find((x) => x.kind === 'subject' && x.refId === groupId);
  if (!(await confirmDelete(`수강집단 "${g.name}"`, w ? recordCount((id) => id === w.id) : 0))) return;
  if (await act('courseGroup.delete', { id: groupId }, '수강집단을 삭제했습니다.')) S.render();
}

async function deleteClub(clubId: string) {
  const d = data();
  const c = d.clubs.find((x) => x.id === clubId)!;
  const w = d.works.find((x) => x.kind === 'club' && x.refId === clubId);
  if (!(await confirmDelete(`동아리 "${c.name}"`, w ? recordCount((id) => id === w.id) : 0))) return;
  if (await act('club.delete', { id: clubId }, '동아리를 삭제했습니다.')) S.render();
}

function groupsAssignCard() {
  const d = data();
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('book', 24)), h('div', null, h('h2', null, '교과 수업 반 학생 배정'), h('p', null, '수업 반(수강집단)마다 [구성원 선택]으로 듣는 학생을 넣습니다. 여러 학급 학생이 섞여도 되며, 학급을 골라 만든 수업 반에는 그 학급 학생이 미리 들어 있습니다.\n수업 반은 교사 정보 설정 > 교과 과목 설정에서 만듭니다.'))),
    d.courseGroups.length
      ? h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, '과목'), h('th', null, '수업 반'), h('th', null, '학년·학기'), h('th', null, '학생'), h('th', null, ''))),
          h('tbody', null, d.courseGroups.map((g) => {
            const s = d.subjects.find((x) => x.id === g.subjectId);
            return h('tr', null, h('td', null, s?.name ?? '?'), h('td', null, g.name), h('td', null, `${g.grade}학년 ${groupTermText(g.id)}${g.termType === 'free' ? ' · 자유학기' : ''}`), h('td', null, g.studentIds.length ? `${g.studentIds.length}명` : chip('미배정', 'warn')), h('td', null, listActions('courseGroup', g.id, { grade: g.grade })));
          })))
      : h('p', { class: 'empty' }, '수업 반이 없습니다. 교사 정보 설정 > 교과 과목 설정에서 과목과 수업 반을 추가하세요.'),
  );
}

function clubsAssignCard() {
  const d = data();
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('users', 24)), h('div', null, h('h2', null, '동아리 학생 배정'), h('p', null, '동아리는 교사 정보 설정 > 동아리 설정에서 만듭니다.'))),
    d.clubs.length
      ? h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, '동아리'), h('th', null, '유형'), h('th', null, '학생'), h('th', null, ''))),
          h('tbody', null, d.clubs.map((c) => h('tr', null, h('td', null, c.name), h('td', null, CLUB_TYPE_LABEL[c.clubType]), h('td', null, c.studentIds.length ? `${c.studentIds.length}명` : chip('미배정', 'warn')), h('td', null, listActions('club', c.id, {}))))))
      : h('p', { class: 'empty' }, '동아리가 없습니다.'),
  );
}

/** 학생 명단 일괄 입력: 양식 내려받기 → 작성 → 업로드(또는 붙여 넣기) */
function bulkCard() {
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('download', 24)), h('div', null, h('h2', null, '명단 일괄 입력'), h('p', null, '샘플 양식(XLSX)을 내려받아 학년·반·번호·이름을 채운 뒤 업로드하세요. 학년·반에 맞는 학급은 자동으로 만들어집니다.'))),
    h('div', { class: 'btn-row left' },
      h('button', { class: 'btn secondary', onclick: async () => {
        const p = await run(window.sgb.rosterSample());
        if (p) toast(`양식을 저장했습니다: ${p}`, 'ok');
      } }, icon('download', 16), '샘플 양식 다운로드'),
      h('button', { class: 'btn', onclick: () => importRoster(null, '', {}, true) }, icon('up', 16), '명단 XLSX 업로드'),
      h('button', { class: 'btn ghost', onclick: () => importRoster(null, '', {}) }, '엑셀에서 붙여 넣기'),
    ),
  );
}

function workOf(kind: ListKind, id: string) {
  const d = data();
  const wk = kind === 'class' ? 'homeroom' : kind === 'courseGroup' ? 'subject' : 'club';
  return d.works.find((w) => w.kind === wk && w.refId === id);
}

function listActions(kind: ListKind, id: string, _defaults: { grade?: number; classNo?: number }) {
  const w = workOf(kind, id);
  return h('div', { class: 'btn-row left tight' },
    h('button', { class: 'btn sm', onclick: () => pickMembers(kind, id) }, '구성원 선택'),
    w ? h('button', { class: 'btn ghost sm', onclick: () => manageExclusions(w.id) }, `작업 제외 관리${w.excludedStudentIds.length ? ` (${w.excludedStudentIds.length})` : ''}`) : null,
  );
}

function classesCard(mode: 'students' | 'teacher' | 'assign') {
  const d = data();
  const g = h('input', { class: 'input', type: 'number', min: '1', max: '3', value: String(d.settings.defaultGrade) });
  const c = h('input', { class: 'input', type: 'number', min: '1', max: '99' });
  const home = h('input', { type: 'checkbox', checked: false });
  const title = mode === 'teacher' ? '담임 학급 설정' : mode === 'assign' ? '담임 학급 구성원' : '학급(원적 학급)';
  const desc = mode === 'teacher' ? '학급은 [학급 및 학생 명단 입력]에서 만들고, 여기서는 담임을 맡은 학급의 담임 작업을 켭니다. 담임 작업은 자율·자치(3학년 자율), 진로, 행특을 다룹니다.' : mode === 'assign' ? '학급 구성원을 확인·조정하고, 작성 대상에서 뺄 학생은 작업 제외로 관리합니다.' : '학생 명단의 학년·반으로 학급이 자동으로 만들어지고, 같은 학급 명단을 교과·동아리에서도 같은 학생 ID로 씁니다.';
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('users', 24)), h('div', null, h('h2', null, title), h('p', null, desc))),
    mode === 'students' ? h('div', { class: 'grid-3' }, field('학년', g), field('반', c), h('div')) : null,
    mode === 'students' ? h('div', { class: 'btn-row left' }, h('button', { class: 'btn', onclick: async () => {
      if (!Number(c.value)) return toast('반을 입력하세요.', 'warn');
      if (await act('class.create', { grade: Number(g.value), classNo: Number(c.value), homeroom: home.checked }, '학급을 만들었습니다.')) S.render();
    } }, '학급 만들기')) : null,
    d.classes.length
      ? h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, '학급'), h('th', null, '학생'), h('th', null, '담임 작업'), h('th', null, ''))),
          h('tbody', null, [...d.classes].sort((a, b) => a.grade - b.grade || a.classNo - b.classNo).map((cl) => h('tr', null,
            h('td', null, `${cl.grade}학년 ${cl.classNo}반`),
            h('td', null, `${cl.studentIds.length}명`),
            h('td', null, workOf('class', cl.id)
              ? h('div', { class: 'inline' }, chip('담임', 'ok'), mode === 'teacher' ? h('button', { class: 'btn ghost sm', onclick: () => homeroomOff(cl.id) }, '담임 작업 끄기') : null)
              : mode === 'assign'
                ? h('span', { class: 'muted' }, '담임 아님(교사 정보 설정에서 지정)')
                : h('button', { class: 'btn ghost sm', onclick: async () => (await act('homeroom.set', { classId: cl.id, on: true }, '담임 작업을 켰습니다.')) && S.render() }, '담임 작업 켜기')),
            h('td', null, mode === 'teacher' ? null : mode === 'students' ? h('button', { class: 'btn ghost sm danger-text', onclick: () => deleteClass(cl.id) }, '학급 삭제') : listActions('class', cl.id, { grade: cl.grade, classNo: cl.classNo })),
          ))))
      : h('p', { class: 'empty' }, '학급이 없습니다. 학생 명단을 올리면 자동으로 만들어집니다.'),
  );
}

function subjectsCard(level: 'middle' | 'high') {
  const d = data();
  const name = h('input', { class: 'input', placeholder: level === 'high' ? '예: 공통수학1, 대수, 물리학Ⅱ' : '예: 국어, 과학' });
  const st = { kind: 'general' as SubjectKind, curriculum: '2022' as '2015' | '2022', group: '공통수학' as (typeof COMMON_GROUPS)[number], part: 1 as 1 | 2 };
  const highOpts = h('div', { class: 'grid-3' });
  const drawHigh = () => {
    clear(highOpts);
    if (level !== 'high') return;
    highOpts.append(
      field('과목 유형', select((Object.keys(KIND_LABEL) as SubjectKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] })), st.kind, (v) => {
        st.kind = v;
        drawHigh();
      })),
      field('적용 교육과정', select([{ value: '2022', label: '2022 개정(2026 고1·2)' }, { value: '2015', label: '2015 개정(2026 고3)' }], st.curriculum, (v) => (st.curriculum = v))),
      st.kind === 'common'
        ? field('합산 그룹', h('div', { class: 'inline' }, select(COMMON_GROUPS.map((g) => ({ value: g, label: g })), st.group, (v) => (st.group = v)), select([{ value: 1, label: '1' }, { value: 2, label: '2' }], st.part, (v) => (st.part = v))), '이름의 숫자로 추정하지 않고 여기서 지정합니다.')
        : h('div'),
    );
  };
  drawHigh();
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('book', 24)), h('div', null, h('h2', null, '교과 과목과 수업 반'), h('p', null, '① 가르치는 과목을 추가하고 ② 과목마다 수업하는 반을 추가합니다. 학급을 골라 만든 수업 반에는 그 학급 학생이 자동으로 배정됩니다.'))),
    h('div', { class: 'step-box' },
      h('h3', null, h('span', { class: 'step-num' }, '1'), '과목 추가'),
      h('div', { class: 'grid-3' }, field('과목명', name)),
      highOpts,
      h('div', { class: 'btn-row left' }, h('button', { class: 'btn', onclick: async () => {
        if (!name.value.trim()) return toast('과목명을 입력하세요.', 'warn');
        if (d.subjects.some((x) => x.name === name.value.trim())) return toast('같은 이름의 과목이 이미 있습니다.', 'warn');
        const ok = await act('subject.create', { name: name.value.trim(), kind: level === 'high' ? st.kind : 'general', curriculum: level === 'high' ? st.curriculum : '2022', commonGroup: st.kind === 'common' ? st.group : null, commonPart: st.kind === 'common' ? st.part : null }, '과목을 추가했습니다. 아래에서 수업 반을 추가하세요.');
        if (ok) S.render();
      } }, icon('plus', 16), '과목 추가')),
    ),
    h('div', { class: 'step-box' },
      h('h3', null, h('span', { class: 'step-num' }, '2'), '과목별 수업 반 추가'),
      h('p', { class: 'hint' }, '수업 반(수강집단)은 이 과목을 함께 듣는 학생 묶음으로, 보통 학급 단위(예: 1학년 3반)입니다. 선택과목처럼 여러 반 학생이 섞이면 이름을 직접 정합니다(예: 2학년 물리 A반).\n과목 세특은 수업 반·학기마다 따로 작성하며, 1년에 한 번만 쓰는 과목은 학기에서 [학기 구분 없음]을 고릅니다.'),
      d.subjects.length ? h('div', { class: 'subject-list' }, d.subjects.map((s) => subjectBlock(s.id, level))) : h('p', { class: 'empty' }, '위에서 과목을 먼저 추가하세요.'),
    ),
  );
}

/** 과목 하나: 수업 반 목록 + 반 추가(학급 고르기 또는 이름 직접 입력) */
function subjectBlock(subjectId: string, level: 'middle' | 'high') {
  const d = data();
  const s = d.subjects.find((x) => x.id === subjectId)!;
  const groups = d.courseGroups.filter((g) => g.subjectId === subjectId).sort((a, b) => a.grade - b.grade || a.semester - b.semester || a.name.localeCompare(b.name, 'ko'));
  const f = { grade: d.settings.defaultGrade, semester: 1 as 1 | 2, annual: false, termType: 'regular' as 'regular' | 'free' };
  const termOf = (g: { id: string }) => groupTermText(g.id);
  const fTerm = () => (f.annual ? '학기 구분 없음' : `${f.semester}학기`);
  const picked = new Set<string>();
  const classBox = h('div', { class: 'chips' });
  const drawClasses = () => {
    picked.clear();
    const list = d.classes.filter((c) => c.grade === f.grade).sort((a, b) => a.classNo - b.classNo);
    classBox.replaceChildren(...(list.length
      ? list.map((c) => {
          const label = `${c.grade}학년 ${c.classNo}반`;
          const exists = groups.some((g) => g.grade === f.grade && termOf(g) === fTerm() && g.name === label);
          const b = h('button', { class: `chip pick ${exists ? 'done' : ''}`, disabled: exists, title: exists ? '이미 추가한 반' : `눌러서 선택 · ${c.studentIds.length}명` }, exists ? `${label} ✓` : `${label} (${c.studentIds.length}명)`);
          b.addEventListener('click', () => {
            if (picked.has(label)) picked.delete(label);
            else picked.add(label);
            b.classList.toggle('on', picked.has(label));
          });
          return b;
        })
      : [h('span', { class: 'muted' }, `${f.grade}학년 학급이 없습니다. 아래에 이름을 직접 입력하세요.`)]));
  };
  drawClasses();
  const custom = h('input', { class: 'input', placeholder: '예: 2학년 물리 A반 (여러 반이 섞인 경우)' });
  // 학급을 골라 만든 수업 반에는 그 학급 학생을 자동으로 배정한다. 이름을 직접 입력한 반은 [학생 배정]에서 넣는다.
  const create = async (names: string[], fromClass: boolean) => {
    const fresh = names.filter((n) => !groups.some((g) => g.grade === f.grade && termOf(g) === fTerm() && g.name === n));
    if (!fresh.length) return toast('추가할 반을 고르거나 이름을 입력하세요.', 'warn');
    let assigned = 0;
    for (const n of fresh) {
      const cl = fromClass ? d.classes.find((c) => c.grade === f.grade && `${c.grade}학년 ${c.classNo}반` === n) : undefined;
      const studentIds = cl ? [...cl.studentIds] : [];
      assigned += studentIds.length;
      if (!(await act('courseGroup.create', { subjectId, grade: f.grade, semester: f.semester, annual: f.annual, termType: f.termType, name: n, studentIds }))) return S.render();
    }
    toast(fromClass ? `${s.name}: 수업 반 ${fresh.length}개를 추가하고 학급 학생 ${assigned}명을 배정했습니다. 빼거나 더할 학생은 [학생 배정]에서 고칩니다.` : `${s.name}: 수업 반을 추가했습니다. 학생은 [학생 배정]에서 넣습니다.`, 'ok');
    S.render();
  };
  return h('div', { class: 'subject-block' },
    h('div', { class: 'subject-head' }, h('b', null, s.name), h('span', { class: 'muted' }, KIND_LABEL[s.kind] + (s.kind === 'common' ? ` (${s.commonGroup}${s.commonPart})` : '')), h('span', { class: 'spacer' }),
      h('button', { class: 'btn ghost sm danger-text', onclick: () => deleteSubject(s.id) }, '과목 삭제')),
    groups.length
      ? h('table', { class: 'table compact' }, h('thead', null, h('tr', null, h('th', null, '수업 반'), h('th', null, '학년·학기'), h('th', null, '학생'), h('th', null, ''))),
          h('tbody', null, groups.map((g) => h('tr', null, h('td', null, g.name), h('td', null, `${g.grade}학년 ${termOf(g)}${g.termType === 'free' ? ' · 자유학기' : ''}`), h('td', null, g.studentIds.length ? `${g.studentIds.length}명` : chip('학생 배정 전', 'warn')), h('td', null, h('button', { class: 'btn ghost sm danger-text', onclick: () => deleteGroup(g.id) }, '삭제'))))))
      : h('p', { class: 'muted' }, '아직 수업 반이 없습니다. 아래에서 추가하세요.'),
    h('div', { class: 'add-group' },
      h('div', { class: 'grid-4' },
        field('학년', select([1, 2, 3].map((x) => ({ value: x, label: `${x}학년` })), f.grade, (v) => {
          f.grade = v;
          drawClasses();
        })),
        field('학기', select([{ value: '1', label: '1학기' }, { value: '2', label: '2학기' }, { value: 'annual', label: '학기 구분 없음' }], '1', (v) => {
          f.annual = v === 'annual';
          f.semester = v === '2' ? 2 : 1;
          drawClasses();
        })),
        level === 'middle' ? field('학기 유형', select([{ value: 'regular', label: '일반 학기' }, { value: 'free', label: '자유학기(전원 입력)' }], f.termType, (v) => (f.termType = v as 'regular' | 'free'))) : h('div'),
        h('div'),
      ),
      field('수업하는 반 고르기', classBox, '여러 반을 한 번에 고를 수 있습니다. 고른 학급의 학생이 이 수업 반에 자동으로 배정됩니다.'),
      h('div', { class: 'btn-row left tight' }, h('button', { class: 'btn', onclick: () => create([...picked], true) }, icon('plus', 16), '고른 반 추가')),
      field('또는 이름 직접 입력', h('div', { class: 'inline' }, custom, h('button', { class: 'btn secondary', onclick: () => (custom.value.trim() ? create([custom.value.trim()], false) : toast('이름을 입력하세요.', 'warn')) }, '추가')), '여러 반 학생이 섞인 반은 [학생 배정]에서 학생을 넣습니다.'),
    ),
  );
}

/** 동아리 유형 선택지: 특기사항을 쓰는 두 유형만. 예전에 다른 유형으로 만든 동아리는 그 값도 보여 준다. */
const CLUB_CHOICES: ClubType[] = ['regular', 'sportsRegular'];
const clubTypeOptions = (cur?: ClubType) => [...CLUB_CHOICES, ...(cur && !CLUB_CHOICES.includes(cur) ? [cur] : [])].map((t) => ({ value: t, label: CLUB_TYPE_LABEL[t] }));

function clubsCard(level: 'middle' | 'high') {
  const d = data();
  const name = h('input', { class: 'input', placeholder: '예: 과학탐구반' });
  let type: ClubType = 'regular';
  const note = h('p', { class: 'hint' }, clubTypeNote(type, level));
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('users', 24)), h('div', null, h('h2', null, '동아리'), h('p', null, '① 맡은 동아리를 만들고 ② 만든 동아리와 유형을 확인합니다. 학생은 다음 단계 [학생 배정]에서 연결합니다.'))),
    h('div', { class: 'step-box' },
      h('h3', null, h('span', { class: 'step-num' }, '1'), '동아리 만들기'),
      h('div', { class: 'grid-3' }, field('동아리명', name), field('유형', select(clubTypeOptions(), type, (v) => {
        type = v;
        note.textContent = clubTypeNote(v, level);
      }))),
      note,
      h('div', { class: 'btn-row left' }, h('button', { class: 'btn', onclick: async () => {
        if (!name.value.trim()) return toast('동아리명을 입력하세요.', 'warn');
        if (await act('club.create', { name: name.value.trim(), clubType: type, studentIds: [] }, '동아리를 만들었습니다. 학생은 [학생 배정]에서 넣습니다.')) S.render();
      } }, icon('plus', 16), '동아리 만들기')),
    ),
    h('div', { class: 'step-box' },
      h('h3', null, h('span', { class: 'step-num' }, '2'), '만든 동아리 확인'),
      h('p', { class: 'hint' }, '유형을 바꾸면 그 동아리 기록은 다시 검토해야 합니다.'),
      d.clubs.length
        ? h('table', { class: 'table compact' }, h('thead', null, h('tr', null, h('th', null, '동아리'), h('th', null, '유형'), h('th', null, '학생'), h('th', null, ''))),
            h('tbody', null, d.clubs.map((c) => h('tr', null, h('td', null, c.name), h('td', null, select(clubTypeOptions(c.clubType), c.clubType, async (v) => (await act('club.setType', { clubId: c.id, clubType: v }, '유형을 바꿨습니다. 관련 검토가 다시 필요합니다.')) && S.render(), { class: 'select sm' })), h('td', null, c.studentIds.length ? `${c.studentIds.length}명` : chip('학생 배정 전', 'warn')), h('td', null, h('div', { class: 'btn-row left tight' }, h('button', { class: 'btn ghost sm danger-text', onclick: () => deleteClub(c.id) }, '삭제')))))))
        : h('p', { class: 'empty' }, '위에서 동아리를 먼저 만드세요.'),
    ),
  );
}

function studentsCard() {
  const d = data();
  const q = h('input', { class: 'input', placeholder: '이름·반 검색' });
  const body = h('tbody');
  const draw = () => {
    clear(body);
    const term = q.value.trim();
    sortStudents(d.students)
      .filter((s) => !term || studentLabel(s).includes(term) || s.aliases.some((a) => a.includes(term)))
      .forEach((s) => body.append(h('tr', null, h('td', null, `${s.grade}학년 ${s.classNo}반 ${s.number}번`), h('td', null, s.name), h('td', null, s.aliases.join(', ') || '—'), h('td', null, `${s.curriculum} 개정`), h('td', null, h('div', { class: 'btn-row left tight' }, h('button', { class: 'btn ghost sm', onclick: () => editStudent(s) }, '수정'), h('button', { class: 'btn ghost sm danger-text', onclick: () => deleteStudent(s) }, '영구 삭제'))))));
  };
  q.addEventListener('input', draw);
  draw();
  const add = { name: h('input', { class: 'input' }), grade: h('input', { class: 'input', type: 'number', min: '1', max: '3', value: String(d.settings.defaultGrade) }), cls: h('input', { class: 'input', type: 'number', min: '0' }), num: h('input', { class: 'input', type: 'number', min: '1' }) };
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('users', 24)), h('div', null, h('h2', null, `학생 명단 (${d.students.length}명)`), h('p', null, '학생 ID는 이름·반·번호를 바꿔도 유지되고, 동명이인은 자동 병합하지 않습니다. 별칭은 익명화 대상에 추가됩니다.'))),
    h('div', { class: 'grid-5' }, field('이름', add.name), field('학년', add.grade), field('반', add.cls), field('번호', add.num), field(' ', h('button', { class: 'btn', onclick: async () => {
      if (!add.name.value.trim() || !Number(add.num.value)) return toast('이름과 번호를 입력하세요.', 'warn');
      if (await act('student.add', { name: add.name.value.trim(), grade: Number(add.grade.value), classNo: Number(add.cls.value || 0), number: Number(add.num.value) }, '학생을 추가했습니다.')) S.render();
    } }, '학생 추가'))),
    h('div', { class: 'field' }, q),
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, '학적'), h('th', null, '이름'), h('th', null, '별칭'), h('th', null, '교육과정'), h('th', null, ''))), body)),
  );
}

async function editStudent(s: Student) {
  await modal('학생 정보 수정', (close) => {
    const name = h('input', { class: 'input', value: s.name });
    const grade = h('input', { class: 'input', type: 'number', value: String(s.grade) });
    const cls = h('input', { class: 'input', type: 'number', value: String(s.classNo) });
    const num = h('input', { class: 'input', type: 'number', value: String(s.number) });
    const aliases = h('input', { class: 'input', value: s.aliases.join(', '), placeholder: '예: 민준이, 준이' });
    let cur = s.curriculum;
    return h('div', null,
      h('div', { class: 'grid-2' }, field('이름', name), field('별칭(익명화 대상)', aliases, '쉼표로 구분'), field('학년', grade), field('반', cls), field('번호', num), field('적용 교육과정', select([{ value: '2022', label: '2022 개정' }, { value: '2015', label: '2015 개정' }], cur, (v) => (cur = v)), '복학·편입 등 예외 학생만 바꿉니다.')),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: () => close() }, '취소'), h('button', { class: 'btn primary', onclick: async () => {
        const ok = await act('student.update', { id: s.id, name: name.value.trim(), grade: Number(grade.value), classNo: Number(cls.value), number: Number(num.value), aliases: aliases.value.split(',').map((x) => x.trim()).filter(Boolean), curriculum: cur }, '저장했습니다.');
        if (ok) {
          close();
          S.render();
        }
      } }, '저장')),
    );
  });
}

async function deleteStudent(s: Student) {
  const d = data();
  const n = d.records.filter((r) => r.studentId === s.id).length;
  const ok = await confirmText('학생 영구 삭제', `${studentLabel(s)} 학생과 기록 ${n}건(관찰·후보·조각·검토 이력)을 지웁니다. 앱이 관리하는 이전 저장본에서도 지웁니다.\n이미 따로 저장한 백업·출력 파일은 직접 지워야 합니다.\n작업에서만 빼려면 '작업 제외'를 쓰세요.`, s.name);
  if (!ok) return;
  if (await act('student.delete', { id: s.id, confirmName: s.name }, '삭제했습니다.')) S.render();
}

async function pickMembers(kind: ListKind, id: string) {
  const d = data();
  const list = kind === 'class' ? d.classes : kind === 'courseGroup' ? d.courseGroups : d.clubs;
  const target = (list as { id: string; studentIds: string[] }[]).find((x) => x.id === id);
  if (!target) return;
  const chosen = new Set(target.studentIds);
  await modal('구성원 선택', (close) => {
    const q = h('input', { class: 'input', placeholder: '이름·반 검색' });
    const box = h('div', { class: 'pick-list' });
    const draw = () => {
      const keep = box.scrollTop;
      queueMicrotask(() => (box.scrollTop = keep));
      clear(box);
      const term = q.value.trim();
      const groups = new Map<string, Student[]>();
      sortStudents(d.students).filter((s) => !term || studentLabel(s).includes(term)).forEach((s) => {
        const k = `${s.grade}학년 ${s.classNo}반`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(s);
      });
      for (const [k, arr] of groups) {
        const all = h('input', { type: 'checkbox', checked: arr.every((s) => chosen.has(s.id)) });
        all.addEventListener('change', () => {
          arr.forEach((s) => (all.checked ? chosen.add(s.id) : chosen.delete(s.id)));
          draw();
        });
        box.append(h('div', { class: 'pick-group' }, h('label', { class: 'check strong' }, all, ` ${k} 전체`), h('div', { class: 'pick-items' }, arr.map((s) => {
          const cb = h('input', { type: 'checkbox', checked: chosen.has(s.id) });
          cb.addEventListener('change', () => (cb.checked ? chosen.add(s.id) : chosen.delete(s.id)));
          return h('label', { class: 'check' }, cb, ` ${s.number}번 ${s.name}`);
        }))));
      }
      if (!groups.size) box.append(h('p', { class: 'empty' }, '학생이 없습니다. 학생 명단에 먼저 추가하거나 명단을 가져오세요.'));
    };
    q.addEventListener('input', draw);
    draw();
    return h('div', null, q, box, h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: () => close() }, '취소'), h('button', { class: 'btn primary', onclick: async () => {
      if (await act('members.set', { kind, id, studentIds: [...chosen] }, '구성원을 저장했습니다.')) {
        close();
        S.render();
      }
    } }, `저장 (${chosen.size}명)`)));
  }, true);
}

async function manageExclusions(workId: string) {
  const d = data();
  const w = d.works.find((x) => x.id === workId)!;
  const list = w.kind === 'homeroom' ? d.classes.find((c) => c.id === w.refId)?.studentIds : w.kind === 'subject' ? d.courseGroups.find((g) => g.id === w.refId)?.studentIds : d.clubs.find((c) => c.id === w.refId)?.studentIds;
  await modal('작업 제외 관리', () =>
    h('div', null,
      banner('info', '작업 제외는 연결만 끄고 기록을 지우지 않습니다.', '다시 포함하면 이전 기록이 그대로 보입니다.'),
      h('div', { class: 'pick-items col' }, sortStudents((list ?? []).map((id) => d.students.find((s) => s.id === id)!).filter(Boolean)).map((s) => {
        const cb = h('input', { type: 'checkbox', checked: w.excludedStudentIds.includes(s.id) });
        cb.addEventListener('change', async () => {
          await act('work.exclude', { workId, studentId: s.id, excluded: cb.checked });
        });
        return h('label', { class: 'check' }, cb, ` ${studentLabel(s)} 제외`);
      })),
    ),
  );
  S.render();
}

async function importRoster(kind: ListKind | null, id: string, defaults: { grade?: number; classNo?: number }, openFile = false) {
  await modal(kind ? '명단 가져오기' : '학생 명단 일괄 입력', (close) => {
    const text = h('textarea', { class: 'textarea', rows: '8', placeholder: '학년\t반\t번호\t이름\n1\t3\t1\t김민준\n… (엑셀에서 복사해 붙여 넣거나 XLSX 파일을 고르세요)' });
    const out = h('div');
    let preview: any = null;
    const decisions = new Map<number, { action: 'new' | 'link' | 'skip' | 'update'; studentId?: string }>();
    const show = (pv: any) => {
      preview = pv;
      decisions.clear();
      clear(out);
      if (pv.errors?.length) out.append(banner('err', '가져오기 전에 고칠 점', ...pv.errors.slice(0, 8).map((e: string) => h('div', null, e))));
      const d = data();
      pv.add.forEach((r: any) => decisions.set(r.row, { action: 'new' }));
      pv.same.forEach((x: any) => decisions.set(x.row.row, { action: 'link', studentId: x.studentId }));
      pv.conflicts.forEach((x: any) => decisions.set(x.row.row, { action: 'skip' }));
      append(out, [
        h('p', { class: 'hint' }, `새 학생 ${pv.add.length} · 기존 학생과 일치 ${pv.same.length} · 확인 필요 ${pv.conflicts.length}. 확인 필요 항목은 자동 병합하지 않습니다.`),
        pv.conflicts.length
          ? h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, '행'), h('th', null, '명단'), h('th', null, '사유'), h('th', null, '처리'))),
              h('tbody', null, pv.conflicts.map((x: any) => h('tr', null, h('td', null, String(x.row.row)), h('td', null, `${x.row.grade}-${x.row.classNo} ${x.row.number}번 ${x.row.name}`), h('td', null, x.reason), h('td', null, select(
                [{ value: 'skip', label: '건너뛰기' }, { value: 'new', label: '새 학생으로 추가(동명이인)' }, ...x.studentIds.flatMap((sid: string) => {
                  const s = d.students.find((y) => y.id === sid)!;
                  return [{ value: `link:${sid}`, label: `기존 ${studentLabel(s)}에 연결` }, { value: `update:${sid}`, label: `기존 ${studentLabel(s)} 정보를 이 행으로 수정 후 연결` }];
                })],
                'skip',
                (v: string) => {
                  const [a, sid] = v.split(':');
                  decisions.set(x.row.row, { action: a as 'new' | 'link' | 'skip' | 'update', studentId: sid });
                },
              ))))))
          : null,
      ]);
    };
    if (openFile)
      queueMicrotask(async () => {
        const pv = await run(window.sgb.rosterOpenXlsx(defaults));
        if (pv) show(pv);
      });
    return h('div', null,
      field('붙여 넣기', text, '첫 줄은 머리글(학년·반·번호·이름)입니다. 반·학년 열이 없으면 이 명단의 학년·반을 씁니다.'),
      h('div', { class: 'btn-row left' },
        h('button', { class: 'btn secondary', onclick: async () => {
          const pv = await run(window.sgb.rosterPreviewText(text.value, defaults));
          if (pv) show(pv);
        } }, '붙여 넣은 명단 미리 보기'),
        h('button', { class: 'btn secondary', onclick: async () => {
          const pv = await run(window.sgb.rosterOpenXlsx(defaults));
          if (pv) show(pv);
        } }, 'XLSX 파일 고르기'),
      ),
      out,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: () => close() }, '닫기'), h('button', { class: 'btn primary', onclick: async () => {
        if (!preview) return toast('먼저 미리 보기를 확인하세요.', 'warn');
        if (preview.errors?.length) return toast('명단 오류를 고친 뒤 다시 미리 보기 하세요.', 'warn');
        const rows = preview.rows as any[];
        const payload = rows.map((r) => ({ name: r.name, grade: r.grade, classNo: r.classNo, number: r.number, ...(decisions.get(r.row) ?? { action: 'skip' }) }));
        const n = await act('roster.apply', { ...(kind ? { target: { kind, id } } : {}), decisions: payload });
        if (n !== undefined) {
          toast(kind ? `명단에 ${n}명을 연결했습니다.` : `학생 ${n}명을 반영했습니다.`, 'ok');
          close();
          S.render();
        }
      } }, '가져오기 적용')),
    );
  }, true);
}
