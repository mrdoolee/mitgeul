import { charCount, measure } from '../../core/bytes';
import { clubTypeNote, type Finding } from '../../core/rules';
import { EVENT_PRESETS, eventLabel } from '../../core/events';
import { FREE_ITEM_ID, type Area, type EventArea, type EventObs, type Observation, type RecordEntry, type Student, type Target, TARGETS } from '../../core/schema';
import { polishRange } from '../../core/prompts';
import { liveCheck } from '../live';
import { alertToast, append, banner, busyToast, chip, clear, field, h, icon, modal, select, toast } from '../dom';
import { act, AREA_NAME, data, refreshView, run, S, STATE_LABEL, useTabs, type Prepared } from '../state';
import { allWorks, AREAS_BY_KIND, inputSemesterOf, rosterOfWork, semesterText } from '../works';


/** 저장 전 관찰 입력(화면 다시 그리기에도 유지) */
const obsDraft = new Map<string, { observations: Observation[]; context: string; eventObs: EventObs[]; freeNote: string }>();
function isDirty(r: RecordEntry) {
  const x = obsDraft.get(r.id);
  return !!x && (JSON.stringify(x.observations) !== JSON.stringify(r.observations) || x.context !== r.context || x.freeNote !== r.freeNote || JSON.stringify(x.eventObs) !== JSON.stringify(r.eventObs));
}
const candChecks = new Map<string, Set<number>>();

function areaFullName(area: Area, grade: number) {
  return area === 'autonomy' ? (grade === 3 ? '자율활동' : '자율·자치활동') : area === 'club' ? '동아리활동' : area === 'career' ? '진로활동' : area === 'subject' ? '과목별 세부능력 및 특기사항' : '행동특성 및 종합의견';
}

export async function renderWrite(el: HTMLElement) {
  const d = data();
  const sel = S.sel;
  if (!d.students.length || !d.works.length) {
    el.append(banner('info', '먼저 명단·작업에서 학생과 작업을 만드세요.'));
    return;
  }
  // 선택 순서: 작업 → 영역 → 학생. 학기는 초안 작성 초기 설정에서 정한 값을 보여 주기만 한다.
  const works = allWorks();
  if (!works.some((x) => x.w.id === sel.workId)) sel.workId = works[0]?.w.id ?? '';
  const cur = works.find((x) => x.w.id === sel.workId);
  const work = cur?.w;
  const areas = work ? AREAS_BY_KIND[work.kind] : [];
  if (!areas.includes(sel.area as Area)) sel.area = areas[0] ?? '';
  const semInfo = cur && sel.area ? inputSemesterOf(cur, sel.area as Area) : { semester: 1 as const, annual: false };
  if (sel.semester !== semInfo.semester) {
    sel.semester = semInfo.semester;
    S.recordId = '';
  }
  const roster = work ? rosterOfWork(work.id) : [];
  if (!roster.some((s) => s.id === sel.studentId)) sel.studentId = roster[0]?.id ?? '';
  const idx = roster.findIndex((s) => s.id === sel.studentId);
  const step = (delta: number) => {
    const next = roster[idx + delta];
    if (!next) return;
    sel.studentId = next.id;
    S.recordId = '';
    S.render();
  };
  const reselect = () => {
    S.recordId = '';
    S.render();
  };
  const stateOf = (sid: string) => {
    const r = d.records.find((x) => x.studentId === sid && x.workId === sel.workId && x.area === sel.area && x.semester === sel.semester);
    return r?.mode === 'excluded' ? ' · 기재 제외' : r?.review ? ' ✓' : r && (r.finalText || r.draft || r.observations.length || r.freeNote) ? ' …' : '';
  };
  el.append(
    h('div', { class: 'card selector' },
      h('div', { class: 'sel-grid' },
        field('① 작업', works.length ? select(works.map((x) => ({ value: x.w.id, label: x.label })), sel.workId, (v) => {
          sel.workId = v;
          reselect();
        }, { 'aria-label': '작업' }) : h('p', { class: 'hint' }, '작업이 없습니다.')),
        field('② 영역', h('div', { class: 'seg' }, areas.map((a) => h('button', { class: `seg-btn ${sel.area === a ? 'on' : ''}`, onclick: () => {
          sel.area = a;
          reselect();
        } }, AREA_NAME[a])))),
        field('학기', h('div', { class: 'sem-show' }, chip(semesterText(semInfo), 'ok'))),
        field('③ 학생', roster.length ? h('div', { class: 'inline' },
          select(roster.map((s) => ({ value: s.id, label: `${s.number}번 ${s.name}${stateOf(s.id)}` })), sel.studentId, (v) => {
            sel.studentId = v;
            reselect();
          }, { 'aria-label': '학생' }),
          h('button', { class: 'icon-btn', 'aria-label': '이전 학생', disabled: idx <= 0, onclick: () => step(-1) }, icon('up', 16)),
          h('button', { class: 'icon-btn', 'aria-label': '다음 학생', disabled: idx >= roster.length - 1, onclick: () => step(1) }, icon('down', 16)),
        ) : h('p', { class: 'hint' }, '이 작업에 배정된 학생이 없습니다. 학생 배정에서 연결하세요.')),
      ),
    ),
  );
  if (!sel.studentId || !sel.workId || !sel.area) return;
  if (!S.recordId) {
    const id = (await act('record.ensure', { studentId: sel.studentId, workId: sel.workId, area: sel.area, semester: sel.semester })) as string | undefined;
    if (!id) return;
    S.recordId = id;
  }
  await refreshView();
  const r = data().records.find((x) => x.id === S.recordId);
  if (!r || !S.view) return;
  const st = d.students.find((s) => s.id === r.studentId)!;
  const normal = r.mode === 'normal';
  const nCand = r.candidates.length;
  const tab = useTabs([
    { id: 'obs', label: '관찰 기록' },
    ...(normal
      ? [
          { id: 'cands', label: 'AI 후보', badge: nCand ? String(nCand) : undefined },
          { id: 'comp', label: '항목별 조합', badge: r.compositions.length ? String(r.compositions.length) : undefined },
          { id: 'draft', label: '영역 취합' },
          { id: 'polish', label: '최종 윤문' },
        ]
      : []),
    ...(r.mode !== 'excluded' ? [{ id: 'final', label: '최종 본문·검토', badge: S.view.reviewValid ? '✓' : undefined }] : []),
  ]);
  append(el, [
    h('div', { class: 'record-head' },
      h('h2', null, `${st.grade}학년 ${st.classNo}반 ${st.number}번 ${st.name}`),
      h('span', { class: 'muted' }, `${r.semester}학기 · ${areaFullName(r.area, st.grade)}`),
      chip(STATE_LABEL[S.view.state], S.view.state === 'reviewed' || S.view.state === 'reason' ? 'ok' : S.view.state === 'empty' ? 'danger' : 'warn'),
    ),
    tab === 'obs' ? observationCard(r, st) : null,
    tab === 'cands' ? candidatesCard(r) : null,
    tab === 'comp' ? compositionCard(r) : null,
    tab === 'draft' ? draftCard(r) : null,
    tab === 'polish' ? polishCard(r) : null,
    tab === 'final' ? finalCard(r, st) : null,
  ]);
}

function findingsList(list: Finding[], empty = '') {
  if (!list.length) return empty ? h('p', { class: 'hint ok-text' }, empty) : null;
  return h('ul', { class: 'findings' }, list.map((f) => h('li', { class: f.severity }, chip(f.severity === 'block' ? '차단' : '확인', f.severity === 'block' ? 'danger' : 'warn'), h('b', null, `"${f.match}" `), `${f.category}: ${f.message} `, h('span', { class: 'muted' }, `(${f.source})`))));
}

function observationCard(r: RecordEntry, st: Student) {
  const d = data();
  const app = S.app!;
  const v = S.view!;
  const items = app.rubric.areas[r.area].items;
  const draft = obsDraft.get(r.id) ?? { observations: structuredClone(r.observations), context: r.context, eventObs: structuredClone(r.eventObs), freeNote: r.freeNote };
  obsDraft.set(r.id, draft);
  draft.eventObs = draft.eventObs.filter((x) => d.events.some((e) => e.id === x.eventId && e.workId === r.workId && e.area === r.area && e.semester === r.semester));
  const dirty = () => isDirty(r);
  const work = d.works.find((w) => w.id === r.workId)!;
  const club = work.kind === 'club' ? d.clubs.find((c) => c.id === work.refId) : undefined;
  const notes: Node[] = [];
  if (club) notes.push(banner(['regular', 'sportsRegular'].includes(club.clubType) ? 'info' : 'warn', clubTypeNote(club.clubType, st.schoolLevel)));
  if (st.schoolLevel === 'high' && r.area !== 'subject' && r.area !== 'behavior') notes.push(banner('info', '창체 이수시간 인정과 실제 참여는 다릅니다.', '출석인정 결석(결과) 등으로 시간만 인정된 활동에는 참여·성과 문장을 만들지 마세요(고 2316~2339행).'));
  if (r.area === 'subject') notes.push(banner('info', '과목 맥락(성취기준·수업/평가 장면·실제 수행)을 적으면 과목에 맞는 문장이 됩니다. 비워도 후보는 만들어집니다.', st.schoolLevel === 'high' ? '고등학교는 모든 학생 입력이 원칙입니다. 관찰이 없으면 문장을 만들지 말고 사유 입력·기재 제외를 구분하세요.' : '일반 학기는 학교 심의로 정한 대상, 자유학기는 모든 학생 대상입니다.'));
  if (st.schoolLevel === 'high') notes.push(h('p', { class: 'hint' }, '루브릭 5종은 중학교 확정본(2026-middle-rubric-v1)입니다. 고등학교 적용은 관찰 보조로만 쓰고 학생별 근거를 확인하세요.'));

  const ctx = h('textarea', { class: 'textarea', rows: '2', placeholder: r.area === 'subject' ? '예: 설명문 쓰기 성취기준, 개요 작성 수행평가에서 근거 자료를 비교함' : '예: 학급 회의 안건 정리 활동, 진로 체험 후 소감 발표' }, draft.context);
  ctx.addEventListener('input', () => {
    draft.context = ctx.value;
    saveBtn.disabled = !dirty();
  });
  const free = h('textarea', { class: 'textarea', rows: '3', 'data-focus': `free-${r.id}`, placeholder: '아래 항목에 해당하지 않는 관찰을 자유롭게 적으세요.\n예: 모둠 발표 자료를 스스로 다시 정리해 친구들에게 나눠 줌.' }, draft.freeNote);
  free.addEventListener('input', () => {
    draft.freeNote = free.value;
    saveBtn.disabled = !dirty();
  });
  const saveBtn = h('button', { class: 'btn primary', disabled: !dirty(), onclick: async () => {
    const ok = await act('record.setObservations', { recordId: r.id, observations: draft.observations, context: draft.context, eventObs: draft.eventObs, freeNote: draft.freeNote }, '관찰을 저장했습니다.');
    if (ok) {
      obsDraft.delete(r.id);
      S.render();
    }
  } }, '관찰 저장');

  const cats = [...new Set(items.map((i) => i.category))];
  const itemBox = h('div', { class: 'rubric' }, cats.map((cat) =>
    h('div', { class: 'rubric-cat' }, h('div', { class: 'cat-title' }, cat), items.filter((i) => i.category === cat).map((it) => {
      const o = draft.observations.find((x) => x.itemId === it.id);
      const row = h('div', { class: `rubric-item ${o ? 'on' : ''}` });
      const toggle = h('input', { type: 'checkbox', checked: !!o, 'aria-label': `${it.name} 선택` });
      toggle.addEventListener('change', () => {
        if (toggle.checked) draft.observations.push({ itemId: it.id, score: 3, example: '' });
        else draft.observations = draft.observations.filter((x) => x.itemId !== it.id);
        S.render();
      });
      row.append(h('label', { class: 'rubric-name' }, toggle, h('span', null, h('b', null, it.name), h('br'), h('small', null, it.lookFor))));
      if (o) {
        const ex = h('textarea', { class: 'textarea sm', rows: '2', placeholder: '구체적 사례(선택). 비워 두면 사건·수치·성과를 만들지 않습니다.' }, o.example);
        ex.addEventListener('input', () => {
          o.example = ex.value;
          saveBtn.disabled = !dirty();
        });
        const exCheck = liveCheck(ex, r.area);
        row.append(
          h('div', { class: 'scores', role: 'radiogroup', 'aria-label': `${it.name} 점수` }, [1, 2, 3, 4, 5].map((n) => h('button', { class: `score ${o.score === n ? 'on' : ''}`, role: 'radio', 'aria-checked': o.score === n ? 'true' : 'false', title: it.levels[n - 1], onclick: () => {
            o.score = n;
            S.render();
          } }, `${n} ${app.rubric.scale[n - 1]}`))),
          h('p', { class: 'level-meaning' }, `${o.score}점 의미: ${it.levels[o.score - 1]}`),
          ex,
          exCheck,
        );
      }
      return row;
    })),
  ));

  const modeSel = select([{ value: 'normal', label: '일반 작성' }, { value: 'reason', label: '사유 입력(미참여·관찰 불가 등)' }, { value: 'excluded', label: '기재 제외' }], r.mode, async (m) => {
    let reasonText: string | undefined;
    if (m === 'reason') {
      reasonText = await modal<string>('사유 입력', (close) => {
        const t = h('textarea', { class: 'textarea', rows: '3', placeholder: '예: 장기결석으로 특이사항 없음.' }, r.finalText);
        return h('div', null, h('p', { class: 'hint' }, '사유 문장도 최종 본문으로 검사·검토합니다. 행특은 담임이 직접 관찰할 수 없는 경우 사유를 입력할 수 있습니다.'), t, h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: () => close() }, '취소'), h('button', { class: 'btn primary', onclick: () => close(t.value) }, '저장')));
      });
      if (reasonText === undefined) return S.render();
    }
    if (await act('record.setMode', { recordId: r.id, mode: m, reasonText })) S.render();
  });

  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('edit', 24)), h('div', null, h('h2', null, '관찰 기록'), h('p', null, '자율 작성란에 자유롭게 적거나 필요한 항목만 골라 1~5점과 선택적 사례를 적습니다. 고르지 않은 항목은 낮은 점수가 아니며 요청에 넣지 않습니다.')), h('div', { class: 'right' }, modeSel)),
    ...notes,
    r.mode === 'excluded' ? banner('warn', '기재 제외 기록입니다.', '출력하지 않고 작성 현황에서 따로 셉니다.') : null,
    r.mode === 'normal' ? h('div', null,
      h('div', { class: 'free-box' }, field('자율 작성', free, '루브릭·행사에 없는 관찰도 적을 수 있습니다. 적은 내용은 "자율 작성" 항목으로 AI 후보를 만들며, 적힌 사실만 쓰고 새 사실은 더하지 않습니다.', '선택'), liveCheck(free, r.area)),
      field(r.area === 'subject' ? '과목 맥락: 성취기준·수업/평가 장면·실제 수행' : '교사가 확인한 활동 맥락', ctx, r.area === 'subject' ? '비워도 후보를 만들 수 있고, 적으면 과목 장면에 맞는 문장이 됩니다.' : undefined, '선택'),
      liveCheck(ctx, r.area),
      (['autonomy', 'career', 'behavior'] as Area[]).includes(r.area) ? eventsBox(r, draft, () => (saveBtn.disabled = !dirty())) : null,
      itemBox,
      findingsList(v.findings.inputs),
      h('div', { class: 'btn-row obs-save' }, dirty() ? h('span', { class: 'muted' }, '저장하지 않은 변경이 있습니다.') : null, saveBtn),
    ) : null,
  );
}

async function llmFlow(prepare: () => Promise<{ ok: true; value: Prepared } | { ok: false; error: string }>, label: string) {
  const app = S.app!;
  if (!app.keyStatus[data().settings.provider]) return toast(data().settings.provider === 'gemini' ? '설정에서 API 키를 먼저 등록하세요.' : '설정 > AI 연결에서 먼저 로그인하세요.', 'warn');
  const prep = await run(prepare());
  if (!prep) return;
  const ok = !data().settings.confirmBeforeSend || await modal<boolean>('전송 문안 확인', (close) => {
    const cb = h('input', { type: 'checkbox' });
    const sendBtn = h('button', { class: 'btn primary', disabled: true, onclick: () => close(true) }, '이 문안으로 전송');
    cb.addEventListener('change', () => (sendBtn.disabled = !cb.checked));
    return h('div', null,
      banner('info', `${app.providers.find((p) => p.id === prep.provider)?.label} · ${prep.model}${prep.autoModel ? ' (자동 선택)' : ''}`, '아래 문안 그대로만 전송되며, 학생 이름은 임시 기호로 바뀌었습니다.\n이름이나 간접 식별 단서가 남아 있으면 취소하고 입력을 고치세요.'),
      prep.replaced.length ? h('details', { class: 'replaced' }, h('summary', null, `이 PC에서만 보이는 치환 목록 (${prep.replaced.length})`), h('ul', null, [...new Map(prep.replaced.map((x) => [x.from, x])).values()].map((x) => h('li', null, `${x.from} → ${x.token}`)))) : null,
      h('pre', { class: 'preview' }, prep.preview),
      h('p', { class: 'hint' }, `전송 크기 약 ${(prep.bytes / 1024).toFixed(1)}KB. 자동 재시도는 하지 않습니다.`),
      h('label', { class: 'check strong' }, cb, ' 전송 문안을 확인했습니다'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: () => close(false) }, '취소'), sendBtn),
    );
  }, true);
  if (!ok) {
    await window.sgb.cancel(prep.requestId);
    return;
  }
  S.busy = label;
  S.pendingRequestId = prep.requestId;
  const wait = busyToast(`${label} 요청 중…`, `${prep.model} 응답을 기다리고 있습니다. 다른 화면을 보셔도 됩니다. 응답은 요청한 기록에만 적용되며, 그 사이 근거·초안이 바뀌면 적용하지 않습니다.`, async () => {
    const id = S.pendingRequestId;
    S.busy = '';
    S.pendingRequestId = '';
    wait.close();
    if (id) await window.sgb.cancel(id);
    toast('요청을 취소했습니다. 이미 전송된 요청의 과금은 되돌려지지 않습니다.', 'info');
    S.render();
  });
  S.render();
  const res = await window.sgb.send(prep.requestId);
  wait.close();
  if (S.pendingRequestId !== prep.requestId) return;
  S.busy = '';
  S.pendingRequestId = '';
  if (!res.ok) {
    const cause = ERROR_CAUSE[res.code ?? ''];
    alertToast('err', `${label} 실패${cause ? ` · ${cause}` : ''}`, res.error, '입력한 관찰·초안은 그대로 남아 있습니다. 원인을 해결한 뒤 다시 요청하세요.');
  } else {
    S.app!.data = res.value.data;
    const failed = Object.entries(res.value.failed);
    if (failed.length) {
      alertToast('warn', `${label}: 일부 결과를 받지 못했습니다`, res.value.message, ...failed.map(([k, v]) => `· ${k === 'polish' ? '윤문' : itemName(k)}: ${v}`), '받지 못한 결과는 같은 단추로 다시 요청하세요.');
    } else toast(res.value.message, res.value.discarded.length ? 'warn' : 'ok');
  }
  S.render();
}

/** AI 요청 오류 종류(ProviderError.code)별 한 줄 원인. 자세한 해결 안내는 오류 메시지에 들어 있다. */
const ERROR_CAUSE: Record<string, string> = {
  auth: '인증 문제(API 키·CLI 로그인)',
  rate: '요청 한도 초과',
  server: '제공자 서버 혼잡·오류',
  network: '인터넷 연결 문제',
  timeout: '응답 시간 초과',
  model: '모델을 쓸 수 없음',
  blocked: '제공자가 응답을 막음',
  format: '응답 형식 오류',
  truncated: '응답이 잘림',
  guard: '전송 안전 검사에서 막음',
  request: '요청 오류',
  cli: 'CLI 실행 문제(설치·경로)',
};

function itemName(itemId: string) {
  if (itemId === FREE_ITEM_ID) return '자율 작성';
  const ev = data().events.find((e) => e.id === itemId);
  if (ev) return `행사 · ${eventLabel(ev)}`;
  for (const a of Object.values(S.app!.rubric.areas)) {
    const it = a.items.find((i) => i.id === itemId);
    if (it) return it.name;
  }
  return itemId;
}

/** 저장하지 않은 관찰이 있으면 먼저 저장한 뒤 후보를 요청한다(관찰 서술이 요청에 빠지지 않게). */
async function saveDraftThen(r: RecordEntry, go: () => void) {
  const draft = obsDraft.get(r.id);
  if (draft && isDirty(r)) {
    const ok = await act('record.setObservations', { recordId: r.id, observations: draft.observations, context: draft.context, eventObs: draft.eventObs, freeNote: draft.freeNote }, '관찰을 저장했습니다.');
    if (!ok) return;
    obsDraft.delete(r.id);
  }
  go();
}

function candidatesCard(r: RecordEntry) {
  const v = S.view!;
  const gate = v.generationGate;
  const unsaved = false;
  const order = r.itemOrder.filter((id) => (id === FREE_ITEM_ID && !!r.freeNote.trim()) || r.observations.some((o) => o.itemId === id) || r.eventObs.some((e) => e.eventId === id));
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('spark', 24)), h('div', null, h('h2', null, 'AI 후보 생성'), h('p', null, '선택 항목마다 후보 5개를 받습니다. 후보는 조합 재료이며 길이 목표를 적용하지 않습니다.')),
      h('div', { class: 'right' }, h('button', { class: 'btn', disabled: !gate.ok || unsaved || !!S.busy, onclick: () => saveDraftThen(r, () => llmFlow(() => window.sgb.prepareCandidates(r.id), '후보 생성')) }, icon('spark', 16), '후보 생성 요청'))),
    !gate.ok ? banner('warn', '아직 생성할 수 없습니다.', ...gate.reasons.map((x) => h('div', null, x))) : null,
    isDirty(r) ? banner('info', '저장하지 않은 관찰이 있습니다.', '후보를 요청하면 관찰을 먼저 저장한 뒤 그 내용으로 요청합니다.') : null,
    v.staleCandidates.length ? banner('warn', `관찰이 바뀐 뒤 받은 적 없는 후보가 ${v.staleCandidates.length}개 항목에 있습니다.`, '지금 보이는 후보는 바뀌기 전 관찰로 만든 것입니다.', h('button', { class: 'btn secondary sm', disabled: !gate.ok || !!S.busy, onclick: () => saveDraftThen(r, () => llmFlow(() => window.sgb.prepareCandidates(r.id, v.staleCandidates), '바뀐 항목 후보 재생성')) }, '바뀐 항목만 다시 요청')) : null,
    order.map((itemId) => {
      const set = r.candidates.find((c) => c.itemId === itemId);
      const checks = candChecks.get(`${r.id}:${itemId}`) ?? new Set<number>();
      candChecks.set(`${r.id}:${itemId}`, checks);
      const stale = v.staleCandidates.includes(itemId);
      const fs = v.findings.candidates[itemId] ?? [];
      return h('div', { class: 'cand-block' },
        h('div', { class: 'cand-head' }, h('b', null, itemName(itemId)), set ? h('span', { class: 'muted' }, `${set.provider} · ${set.model}`) : h('span', { class: 'muted' }, '후보 없음'), stale ? chip('근거 변경됨 — 다시 요청 권장', 'warn') : null,
          h('button', { class: 'btn ghost sm', disabled: !gate.ok || unsaved || !!S.busy, onclick: () => saveDraftThen(r, () => llmFlow(() => window.sgb.prepareCandidates(r.id, [itemId]), '항목 후보 재생성')) }, '이 항목만 다시 요청')),
        set ? h('ol', { class: 'cands' }, set.texts.map((t, i) => {
          const cb = h('input', { type: 'checkbox', checked: checks.has(i), 'aria-label': `후보 ${i + 1} 선택` });
          cb.addEventListener('change', () => (cb.checked ? checks.add(i) : checks.delete(i)));
          const f = fs[i] ?? [];
          return h('li', { class: 'cand' }, cb, h('span', { class: 'cand-text', 'data-item': itemId, 'data-index': String(i) }, displayText(t)), f.length ? chip(`${f.some((x) => x.severity === 'block') ? '차단' : '확인'} ${f.length}`, f.some((x) => x.severity === 'block') ? 'danger' : 'warn') : null,
            h('button', { class: 'icon-btn', title: '편집용 복사', 'aria-label': '편집용 복사', onclick: () => run(window.sgb.copyEdit(displayText(t)), '편집용으로 복사했습니다(최종 본문 아님).') }, icon('copy', 15)));
        })) : null,
        set ? h('div', { class: 'btn-row left tight' },
          h('button', { class: 'btn secondary sm', onclick: async () => {
            if (!checks.size) return toast('추가할 후보를 체크하세요.', 'warn');
            const frags = [...checks].sort().map((i) => ({ text: set.texts[i]!, source: { kind: 'candidate', itemId, index: i, evidenceHash: set.evidenceHash, partial: false } }));
            const msg = await act('composition.add', { recordId: r.id, itemId, fragments: frags });
            if (msg !== undefined) {
              if (msg) toast(String(msg), 'warn');
              S.render();
            }
          } }, '체크한 문장 추가'),
          h('button', { class: 'btn secondary sm', onclick: async () => {
            const sel = window.getSelection();
            const text = sel?.toString().trim() ?? '';
            const node = sel?.anchorNode ? (sel.anchorNode.nodeType === 1 ? (sel.anchorNode as Element) : sel.anchorNode.parentElement) : null;
            const host = node?.closest('.cand-text') as HTMLElement | null;
            if (!text || !host || host.dataset.item !== itemId) return toast('이 항목의 후보 문장에서 넣을 부분을 마우스로 선택하세요.', 'warn');
            const i = Number(host.dataset.index);
            const msg = await act('composition.add', { recordId: r.id, itemId, fragments: [{ text, source: { kind: 'candidate', itemId, index: i, evidenceHash: set.evidenceHash, partial: true } }] });
            if (msg !== undefined) {
              toast(msg ? String(msg) : '선택 부분을 추가했습니다. 부정어·조건·수치가 바뀌지 않았는지 확인하세요.', msg ? 'warn' : 'ok');
              S.render();
            }
          } }, '선택한 부분만 추가'),
        ) : null,
      );
    }),
    order.some((id) => r.candidates.some((c) => c.itemId === id)) ? h('div', { class: 'btn-row obs-save' },
      h('span', { class: 'muted' }, '여러 항목에서 체크한 후보를 한 번에 항목별 조합으로 보냅니다.'),
      h('button', { class: 'btn primary', disabled: !!S.busy, onclick: async () => {
        let n = 0;
        const warns: string[] = [];
        for (const itemId of order) {
          const set = r.candidates.find((c) => c.itemId === itemId);
          const checks = candChecks.get(`${r.id}:${itemId}`);
          if (!set || !checks?.size) continue;
          const frags = [...checks].sort((a, b) => a - b).map((i) => ({ text: set.texts[i]!, source: { kind: 'candidate', itemId, index: i, evidenceHash: set.evidenceHash, partial: false } }));
          const msg = await act('composition.add', { recordId: r.id, itemId, fragments: frags });
          if (msg === undefined) return S.render();
          if (msg) warns.push(String(msg));
          n += frags.length;
          checks.clear();
        }
        if (!n) return toast('추가할 후보를 체크하세요.', 'warn');
        toast(warns.length ? warns.join(' / ') : `체크한 문장 ${n}개를 항목별 조합에 추가했습니다.`, warns.length ? 'warn' : 'ok');
        S.render();
      } }, '체크한 문장 일괄 추가')) : null,
  );
}

/** 저장된 학생 참조 표식을 화면에서만 이름으로 보여 준다. */
function displayText(t: string) {
  const d = data();
  return t.replace(/\{\{학생:([^}]+)\}\}/g, (_m, id) => `[${d.students.find((s) => s.id === id)?.name ?? '알 수 없는 학생'}]`);
}

/** 항목 블록 끌어 놓기: 손잡이에서 끌어 다른 항목 블록 위에 놓으면 그 자리로 옮긴다. */
let dragItem = '';
function dragBlock(block: HTMLElement, itemId: string, onDrop: (fromItem: string) => void) {
  const handle = block.querySelector('.drag-handle') as HTMLElement;
  handle.addEventListener('dragstart', (e) => {
    dragItem = itemId;
    e.dataTransfer?.setData('text/plain', `item:${itemId}`);
    e.dataTransfer?.setDragImage(block, 20, 20);
    block.classList.add('dragging');
  });
  handle.addEventListener('dragend', () => {
    dragItem = '';
    block.classList.remove('dragging');
  });
  block.addEventListener('dragover', (e) => {
    if (!dragItem || dragItem === itemId) return;
    e.preventDefault();
    block.classList.add('drop-on');
  });
  block.addEventListener('dragleave', () => block.classList.remove('drop-on'));
  block.addEventListener('drop', (e) => {
    block.classList.remove('drop-on');
    if (!dragItem || dragItem === itemId) return;
    e.preventDefault();
    const from = dragItem;
    dragItem = '';
    onDrop(from);
  });
}

/** 조각 끌어 놓기: 같은 항목 안에서만 순서를 바꾼다. key = 항목ID|조각ID */
let dragFragKey = '';
function dragFrag(el: HTMLElement, key: string, onDrop: (fromFragId: string) => void) {
  const item = key.split('|')[0]!;
  el.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    dragFragKey = key;
    e.dataTransfer?.setData('text/plain', `frag:${key}`);
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', () => {
    dragFragKey = '';
    el.classList.remove('dragging');
  });
  el.addEventListener('dragover', (e) => {
    if (!dragFragKey || dragFragKey === key || dragFragKey.split('|')[0] !== item) return;
    e.preventDefault();
    e.stopPropagation();
    el.classList.add('drop-on');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-on'));
  el.addEventListener('drop', (e) => {
    el.classList.remove('drop-on');
    if (!dragFragKey || dragFragKey === key || dragFragKey.split('|')[0] !== item) return;
    e.preventDefault();
    e.stopPropagation();
    const from = dragFragKey.split('|')[1]!;
    dragFragKey = '';
    onDrop(from);
  });
  return el;
}

function compositionCard(r: RecordEntry) {
  const order = r.itemOrder.filter((id) => r.compositions.some((c) => c.itemId === id));
  const move = async (i: number, dlt: number) => {
    const o = [...r.itemOrder];
    const a = o.indexOf(order[i]!);
    const b = o.indexOf(order[i + dlt]!);
    if (a < 0 || b < 0) return;
    [o[a], o[b]] = [o[b]!, o[a]!];
    if (await act('record.setItemOrder', { recordId: r.id, itemOrder: o })) S.render();
  };
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('edit', 24)), h('div', null, h('h2', null, '항목별 조합'), h('p', null, '후보 전체·일부를 모아 항목 문장을 만듭니다. 체크 해제·후보 재생성은 이 칸을 지우지 않으며, 이 단계에서는 AI를 호출하지 않습니다.'))),
    order.length ? h('div', { class: 'btn-row tight' }, h('button', { class: 'btn ghost sm danger-text', onclick: async () => {
      if (!window.confirm(`항목별 조합 ${order.length}개 항목을 모두 지웁니다.\nAI 후보·관찰 기록·영역 초안은 그대로 둡니다.\n계속할까요?`)) return;
      if (await act('composition.clear', { recordId: r.id }, '항목별 조합을 모두 지웠습니다. AI 후보에서 다시 추가하세요.')) S.render();
    } }, '조합 전체 삭제')) : null,
    order.length ? banner('info', '추가한 후보 문장을 살펴보고 항목 문장을 직접 고치세요.', '겹치는 표현을 지우고 사실과 다르거나 과장된 부분을 바로잡습니다. 순서를 정리한 뒤 아래 [항목 문장 취합]을 누르면 영역 초안이 만들어집니다.') : null,
    !order.length ? h('p', { class: 'empty' }, '[AI 후보] 탭에서 후보를 추가하면 여기에 항목별 조합 칸이 생깁니다. 직접 쓰려면 [최종 본문·검토] 탭에 바로 입력해도 됩니다.') : null,
    order.map((itemId, i) => {
      const c = r.compositions.find((x) => x.itemId === itemId)!;
      const ta = h('textarea', { class: 'textarea', rows: '3' }, c.text);
      const save = async () => {
        if (ta.value !== c.text && (await act('composition.update', { recordId: r.id, itemId, text: ta.value }))) S.render();
      };
      ta.addEventListener('blur', save);
      const taCheck = liveCheck(ta, r.area);
      const block = h('div', { class: 'comp-block', 'data-item': itemId },
        h('div', { class: 'cand-head' }, h('span', { class: 'drag-handle', title: '끌어서 항목 순서 바꾸기', draggable: 'true' }, '⋮⋮'), h('b', null, itemName(itemId)), h('span', { class: 'spacer' }),
          h('button', { class: 'icon-btn', 'aria-label': '항목 위로', disabled: i === 0, onclick: () => move(i, -1) }, icon('up', 15)),
          h('button', { class: 'icon-btn', 'aria-label': '항목 아래로', disabled: i === order.length - 1, onclick: () => move(i, 1) }, icon('down', 15)),
          h('button', { class: 'icon-btn', 'aria-label': '이 항목 조합 삭제', title: '이 항목 조합 삭제', onclick: async () => {
            if (!window.confirm(`"${itemName(itemId)}" 조합을 지웁니다. 계속할까요?`)) return;
            if (await act('composition.clear', { recordId: r.id, itemId }, '항목 조합을 지웠습니다.')) S.render();
          } }, icon('x', 15))),
        h('div', { class: 'frags' }, c.fragments.map((f, fi) => dragFrag(h('span', { class: `frag ${f.source.kind === 'manual' ? 'manual' : f.source.partial ? 'partial' : ''}`, draggable: 'true', title: '끌어서 조각 순서 바꾸기' },
          h('small', null, f.source.kind === 'manual' ? '직접 입력/출처 확인 필요' : `후보 ${f.source.index + 1}${f.source.partial ? ' 일부' : ''}`), ' ', displayText(f.text),
          h('button', { class: 'icon-btn xs', 'aria-label': '조각 앞으로', disabled: fi === 0, onclick: async () => {
            const ids = c.fragments.map((x) => x.id);
            [ids[fi - 1], ids[fi]] = [ids[fi]!, ids[fi - 1]!];
            if (await act('composition.update', { recordId: r.id, itemId, text: c.text, fragmentOrder: ids })) S.render();
          } }, icon('up', 12)),
          h('button', { class: 'icon-btn xs', 'aria-label': '조각 제거(본문은 유지)', onclick: async () => (await act('composition.update', { recordId: r.id, itemId, text: c.text, removeFragmentIds: [f.id] })) && S.render() }, icon('x', 12)),
        ), `${itemId}|${f.id}`, async (fromId) => {
          const ids = c.fragments.map((x) => x.id);
          const from = ids.indexOf(fromId);
          if (from < 0 || from === fi) return;
          ids.splice(from, 1);
          ids.splice(fi, 0, fromId);
          if (await act('composition.update', { recordId: r.id, itemId, text: c.text, fragmentOrder: ids })) S.render();
        }))),
        ta,
        taCheck,
      );
      dragBlock(block, itemId, async (fromItem) => {
        const o = r.itemOrder.filter((x) => x !== fromItem);
        o.splice(o.indexOf(itemId), 0, fromItem);
        if (await act('record.setItemOrder', { recordId: r.id, itemOrder: o })) S.render();
      });
      return block;
    }),
    order.length ? h('div', { class: 'btn-row obs-save' },
      h('span', { class: 'muted' }, '항목 문장을 정한 순서대로 이어 영역 초안을 만듭니다.'),
      h('button', { class: 'btn primary', disabled: !!S.busy, onclick: async () => {
        (document.activeElement as HTMLElement | null)?.blur?.();
        await new Promise((res) => setTimeout(res, 0));
        const cur = data().records.find((x) => x.id === r.id) ?? r;
        const preview = cur.itemOrder.map((id) => cur.compositions.find((c) => c.itemId === id)?.text.trim() ?? '').filter(Boolean).join(' ');
        if (cur.draft.trim() && cur.draft !== preview && !window.confirm('이미 있는 영역 초안을 항목 문장 취합본으로 바꿉니다.\n계속할까요?')) return;
        if (await act('record.assemble', { recordId: r.id }, '영역 초안을 만들었습니다.')) {
          S.sub.write = 'draft';
          S.render();
        }
      } }, '항목 문장 취합')) : null,
  );
}

/** 글 길이에 맞춰 textarea 높이를 늘려 스크롤 없이 한 상자에 다 보이게 한다. */
function autoGrow(ta: HTMLTextAreaElement) {
  const fit = () => {
    if (!ta.isConnected) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight + 2}px`;
  };
  ta.addEventListener('input', fit);
  const wait = () => (ta.isConnected ? fit() : requestAnimationFrame(wait));
  requestAnimationFrame(wait);
  window.addEventListener('resize', fit);
}

function meter(text: string, limitLabel?: string) {
  const m = measure(text);
  return h('span', { class: 'meter' }, `공백 포함 ${charCount(text)}자 · ${m.bytes}Byte${limitLabel ? ` ${limitLabel}` : ''}`, m.uncertain.length ? chip(`불명확 문자 ${m.uncertain.length}`, 'warn') : null);
}

function draftCard(r: RecordEntry) {
  const v = S.view!;
  const ta = h('textarea', { class: 'textarea autogrow', rows: '5', placeholder: '항목 문장을 취합하면 여기에 영역 초안이 만들어집니다.' }, r.draft);
  const m = h('span', null, meter(r.draft));
  autoGrow(ta);
  // 고친 내용은 입력을 멈추면 곧바로 저장해 [최종 윤문]의 초안에 실시간으로 이어지게 한다.
  let saved = r.draft;
  let changed = false;
  let timer: number | undefined;
  const save = async (rerender: boolean) => {
    window.clearTimeout(timer);
    if (ta.value !== saved) {
      const value = ta.value;
      if (!(await act('record.setDraft', { recordId: r.id, draft: value }))) return;
      saved = value;
      changed = true;
    }
    if (rerender && changed) S.render();
  };
  ta.addEventListener('input', () => {
    m.replaceChildren(meter(ta.value));
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void save(false), 500);
  });
  ta.addEventListener('blur', () => void save(true));
  const preview = r.itemOrder.map((id) => r.compositions.find((c) => c.itemId === id)?.text.trim() ?? '').filter(Boolean).join(' ');
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('book', 24)), h('div', null, h('h2', null, '영역 취합'), h('p', null, '항목 문장을 정한 순서대로 공백 하나로 잇고, 다른 영역·학생과 섞지 않습니다.')),
      h('div', { class: 'right' }, h('button', { class: 'btn secondary', disabled: !r.compositions.length, onclick: async () => {
        if (r.draft.trim() && !v.draftStale && r.draft !== preview && !window.confirm('편집한 초안을 항목 문장 취합본으로 바꿉니다. 계속할까요?')) return;
        if (await act('record.assemble', { recordId: r.id }, '영역 초안을 만들었습니다.')) S.render();
      } }, r.draft ? '다시 취합' : '항목 문장 취합'))),
    r.draft.trim() ? banner('info', '여기서 선생님이 먼저 문장을 직접 고칠 수 있습니다(1차 수정).', '이어지는 문장을 다듬고, 겹치는 표현을 지우고, 사실과 다른 부분을 바로잡으세요. 고친 내용은 바로 저장되어 [최종 윤문] 탭의 초안에 그대로 반영되고, 윤문을 요청하면 이 초안이 전송됩니다.') : null,
    v.draftStale ? banner('warn', '취합 뒤 항목 문장이 바뀌었지만 초안은 자동으로 바꾸지 않았습니다.', h('div', null, `재취합 미리 보기: ${displayText(preview)}`), h('button', { class: 'btn ghost sm', onclick: async () => (await act('record.assemble', { recordId: r.id }, '재취합을 적용했습니다.')) && S.render() }, '재취합 적용')) : null,
    ta,
    liveCheck(ta, r.area),
    h('div', { class: 'meter-row' }, m),
    findingsList(v.findings.draft),
  );
}

function polishCard(r: RecordEntry) {
  const v = S.view!;
  // 최종 본문·검토 단계에서 받은 재윤문은 그 탭에서 보여 준다.
  const finalBased = r.polish?.basis === 'final';
  const p = finalBased ? null : r.polish;
  // 남은 Byte로 쓸 수 있는 글자 수(한글 1자 3Byte 기준). 행특은 연간 900Byte(약 300자)라 500자 목표를 쓸 수 없다.
  const remaining = Math.max(0, v.aggregation.remaining + measure(v.output.text).bytes);
  const cap = Math.floor(remaining / 3);
  const tooBig = (t: number) => Math.round(t * 0.9) > cap;
  const targetSel = h('div', { class: 'seg' }, ([...TARGETS] as Target[]).map((t) => h('button', { class: `seg-btn ${r.target === t ? 'on' : ''}`, disabled: tooBig(t) && r.target !== t, title: tooBig(t) ? `${v.aggregation.label} 기준 남은 ${remaining}Byte로는 약 ${cap}자까지만 쓸 수 있습니다.` : '', onclick: async () => (await act('record.setTarget', { recordId: r.id, target: t })) && S.render() }, `${t}자`)));
  const basisChanged = p && p.sourceText !== r.draft;
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('spark', 24)), h('div', null, h('h2', null, '최종 윤문'), h('p', null, '목표 글자 수(공백 포함)는 영역 초안 전체에 적용합니다. AI는 근거 안에서 풀어 쓰거나 압축하며 사실을 더하지 않고, 사실 보존과 Byte 한도가 목표보다 우선합니다.'))),
    h('div', { class: 'inline' }, h('span', { class: 'muted' }, '목표'), targetSel, h('span', { class: 'spacer' }), h('span', { class: 'muted' }, `남은 Byte ${Math.max(0, v.aggregation.remaining + measure(v.output.text).bytes)} (${v.aggregation.label})`),
      h('button', { class: 'btn', disabled: !r.draft.trim() || !r.target || !!S.busy, onclick: () => llmFlow(() => window.sgb.preparePolish(r.id), '최종 윤문') }, icon('spark', 16), '윤문 요청')),
    finalBased ? banner('info', '최종 본문·검토 탭에서 받은 재윤문 제안이 있습니다.', '여기서 [윤문 요청]을 누르면 그 제안 대신 지금 초안으로 새 윤문을 받습니다.') : null,
    r.target && tooBig(r.target) ? banner('warn', `목표 ${r.target}자는 남은 Byte로 쓸 수 없습니다.`, `${v.aggregation.label} 기준 남은 ${remaining}Byte(한글 약 ${cap}자)가 한도라서, 윤문은 목표 대신 이 한도(약 ${polishRange(r.target, remaining).min}~${polishRange(r.target, remaining).max}자)에 맞춥니다.\n행특은 기재요령상 연간 300자(900Byte)라 500자 목표를 쓸 수 없으니 더 작은 목표를 고르세요.`) : null,
    !p ? h('div', { class: 'compare single' },
      h('div', null, h('div', { class: 'compare-title' }, '초안 · 영역 취합에서 고친 내용이 바로 반영됩니다'), h('div', { class: 'compare-text draft-live' }, r.draft.trim() ? displayText(r.draft) : '아직 초안이 없습니다. [영역 취합] 탭에서 항목 문장을 취합하세요.'), r.draft.trim() ? meter(r.draft) : null),
    ) : null,
    p ? h('div', null,
      basisChanged ? banner('warn', '윤문을 요청한 뒤 초안이 바뀌었습니다.', '왼쪽은 지금 초안입니다. 오른쪽 제안은 이전 초안으로 만든 것이니 [윤문 요청]으로 다시 받으세요.') : null,
      h('div', { class: 'compare' },
        h('div', null, h('div', { class: 'compare-title' }, basisChanged ? '지금 초안 · 영역 취합에서 바뀜' : '초안 · 영역 취합에서 고친 내용이 바로 반영됩니다'), h('div', { class: 'compare-text draft-live' }, displayText(r.draft)), meter(r.draft),
          basisChanged ? h('details', { class: 'hint' }, h('summary', null, '윤문에 보낸 이전 초안 보기'), h('div', { class: 'compare-text' }, displayText(p.sourceText))) : null),
        h('div', null, h('div', { class: 'compare-title' }, `윤문 제안 · 목표 ${p.target}자`), h('div', { class: 'compare-text' }, displayText(p.resultText)), meter(p.resultText), h('span', { class: `chip ${Math.abs(charCount(p.resultText) - p.target) <= p.target * 0.15 ? 'ok' : 'warn'}` }, `목표 대비 ${charCount(p.resultText) - p.target >= 0 ? '+' : ''}${charCount(p.resultText) - p.target}자`)),
      ),
      (() => {
        const n = charCount(p.resultText);
        // 실제 요청 범위(Byte 한도로 줄어든 범위 포함)로 판단한다.
        const rg = polishRange(p.target, remaining);
        const lo = rg.min;
        const hi = rg.max;
        if (basisChanged || (n >= lo && n <= hi)) return null;
        const lite = /lite/i.test(p.model ?? '');
        return banner('warn', `윤문 결과가 ${n}자로 목표 범위(${lo}~${hi}자)를 벗어났습니다.`, n < lo && lite ? `지금 모델(${p.model})은 가볍고 빠른 대신 분량 맞추기가 불안정합니다(같은 초안으로 시험했을 때 180~540자로 들쭉날쭉). 기본설정 > AI 연결에서 이름에 lite가 없는 모델(예: gemini-3.5-flash)을 고르면 목표에 더 잘 맞습니다. ` : '', n < lo ? `관찰 근거가 적어 ${n}자에서 멈췄습니다. 근거에 없는 사실은 만들지 않기 때문입니다.\n관찰 기록에 항목·사례·자율 작성을 더 적은 뒤 후보와 윤문을 다시 받으면 길어지고, 지금 근거로 한 번 더 늘려 볼 수도 있습니다(요청 1회 추가).` : '중복·수식을 덜어 다시 맞출 수 있습니다(요청 1회 추가).', h('div', { class: 'btn-row left tight' }, h('button', { class: 'btn secondary sm', disabled: !!S.busy, onclick: () => llmFlow(() => window.sgb.preparePolish(r.id, true), '분량 보정') }, icon('spark', 14), `분량 맞춰 다시 윤문 (${n < lo ? `+${lo - n}` : `-${n - hi}`}자)`)));
      })(),
      p.suggestions.length ? h('div', null, h('b', null, 'AI 검토 제안(공식 판정 아님)'), h('ul', { class: 'suggest' }, p.suggestions.map((s) => h('li', null, displayText(s))))) : null,
      findingsList(v.findings.polish),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: async () => (await act('record.useDraftAsFinal', { recordId: r.id }, '초안을 최종 본문으로 옮겼습니다.')) && toFinalTab() }, '초안을 그대로 최종 본문으로'),
        h('button', { class: 'btn', onclick: async () => (await act('record.adoptPolish', { recordId: r.id }, '윤문 제안을 최종 본문으로 옮겼습니다. 검토가 다시 필요합니다.')) && toFinalTab() }, '윤문 제안 채택'),
      ),
    ) : r.draft.trim() ? h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: async () => (await act('record.useDraftAsFinal', { recordId: r.id }, '초안을 최종 본문으로 옮겼습니다.')) && toFinalTab() }, '윤문 없이 초안을 최종 본문으로')) : null,
  );
}

/** 최종 본문으로 옮긴 뒤 다음 탭(최종 본문·검토)으로 넘어간다. */
function toFinalTab() {
  S.sub[S.screen] = 'final';
  S.scrollTop = true;
  S.render();
}

function finalCard(r: RecordEntry, st: Student) {
  const v = S.view!;
  const ta = h('textarea', { class: 'textarea', rows: '6', placeholder: r.mode === 'reason' ? '사유 문장' : '최종 본문. 직접 입력·수정할 수 있으며 수정하면 검토가 해제됩니다.' }, r.finalText);
  const m = h('span', null, meter(ta.value));
  ta.addEventListener('input', () => m.replaceChildren(meter(ta.value)));
  ta.addEventListener('blur', async () => {
    if (ta.value !== r.finalText && (await act('record.setFinal', { recordId: r.id, finalText: ta.value }))) S.render();
  });
  const a = v.aggregation;
  const pct = Math.min(100, Math.round((a.total / a.limit) * 100));
  const confirmCb = h('input', { type: 'checkbox' });
  const reviewBtn = h('button', { class: 'btn primary', disabled: true, onclick: async () => {
    if (await act('record.review', { recordId: r.id, confirmed: true }, '검토 완료로 표시했습니다.')) S.render();
  } }, icon('check', 16), '검토 완료');
  confirmCb.addEventListener('change', () => (reviewBtn.disabled = !confirmCb.checked || !v.reviewGate.ok));
  const priorBox = a.unknownPrior.length
    ? h('div', { class: 'prior' }, banner('warn', '합산 대상의 다른 기록 사용 Byte를 확인해야 합니다.', '이전 학년 등 앱 밖 기록이면 사용 Byte를 입력하세요. 없으면 0이 아니라 "아직 작성 전"을 명시해야 합니다.'), a.unknownPrior.map((key) => {
        const inp = h('input', { class: 'input sm', type: 'number', min: '0', placeholder: 'Byte' });
        return h('div', { class: 'inline' }, h('span', { class: 'muted' }, key.split('|').slice(1).join(' ')), inp,
          h('button', { class: 'btn ghost sm', onclick: async () => inp.value !== '' && (await act('priorBytes.set', { studentId: st.id, key, bytes: Number(inp.value), note: '교사 입력' }, '저장했습니다.')) && S.render() }, '사용 Byte 저장'),
          h('button', { class: 'btn ghost sm', onclick: async () => (await act('priorBytes.set', { studentId: st.id, key, bytes: 0, note: '아직 작성 전(교사 확인)' }, '저장했습니다.')) && S.render() }, '아직 작성 전(0)'));
      }))
    : null;
  return h('div', { class: 'card final' },
    h('div', { class: 'card-head' }, h('div', { class: 'tile' }, icon('check', 24)), h('div', null, h('h2', null, '최종 본문과 교사 검토'), h('p', null, '최종 본문 복사·파일 출력은 검토 완료이면서 최종 검사를 통과한 기록만 가능하고, 편집용 복사는 언제든 됩니다.'))),
    ta,
    liveCheck(ta, r.area),
    h('div', { class: 'meter-row' }, m, r.target ? h('span', { class: 'muted' }, ` · 목표 ${r.target}자`) : null),
    r.mode === 'normal' ? finalPolishPanel(r, ta) : null,
    h('div', { class: 'agg' },
      h('div', { class: 'agg-top' }, h('b', null, `${a.label}: ${a.total} / ${a.limit} Byte`), a.over ? chip(`${a.total - a.limit}Byte 초과`, 'danger') : chip(`남음 ${a.remaining}`, 'ok')),
      h('div', { class: 'bar big' }, h('span', { class: a.over ? 'bar-danger' : 'bar-ok', style: `width:${pct}%` })),
      h('div', { class: 'hint' }, [a.members.length ? `같은 합산 단위의 다른 기록 ${a.members.length}건 포함` : '', a.overhead ? `자동 학기 표기·줄바꿈 보수 가산 ${a.overhead}Byte(산입 여부 확인 필요)` : '', a.prior ? `앱 밖 기록 ${a.prior}Byte` : '', ...a.notes].filter(Boolean).join(' · ')),
      priorBox,
    ),
    v.output.uncertain.length ? banner('warn', `규정에 없는 문자 ${v.output.uncertain.length}개를 보수적으로 계산했습니다.`, [...new Set(v.output.uncertain.map((u) => u.char))].join(' ')) : null,
    findingsList(v.findings.final, outputHasText(v) ? '금지 규칙에 걸린 표현이 없습니다(공식 적합성 판정은 아님).' : ''),
    !v.reviewGate.ok ? banner('warn', '검토 완료 전 해결할 점', ...v.reviewGate.reasons.map((x) => h('div', null, x))) : null,
    h('div', { class: 'review-row' },
      v.reviewValid ? chip(`검토 완료 · ${new Date(r.review!.reviewedAt).toLocaleString('ko-KR')}`, 'ok') : r.review ? chip('검토 후 관련 내용이 바뀌어 다시 검토가 필요합니다', 'warn') : chip('검토 전', 'warn'),
      h('span', { class: 'spacer' }),
      !v.reviewValid ? h('label', { class: 'check' }, confirmCb, ' 관찰 근거와 사실을 확인했고 AI 문장을 그대로 쓰지 않았습니다') : null,
      !v.reviewValid ? reviewBtn : h('button', { class: 'btn ghost', onclick: async () => (await act('record.unreview', { recordId: r.id })) && S.render() }, '검토 해제'),
      h('button', { class: 'btn ghost', onclick: () => run(window.sgb.copyEdit(displayText(ta.value)), '편집용으로 복사했습니다(최종 본문 아님).') }, '편집용 복사'),
      h('button', { class: 'btn', disabled: !v.finalGate.ok, title: v.finalGate.ok ? '' : v.finalGate.reasons.join(' / '), onclick: () => run(window.sgb.copyFinal(r.id), '최종 본문을 복사했습니다.') }, icon('copy', 16), '최종 본문 복사'),
    ),
  );
}

/** 최종 본문·검토 단계 재윤문: 교사가 고친 최종 본문을 한 번 더 다듬어 받고, 비교해 채택하거나 닫는다. */
function finalPolishPanel(r: RecordEntry, ta: HTMLTextAreaElement) {
  const v = S.view!;
  const p = r.polish?.basis === 'final' ? r.polish : null;
  // 입력 중인 본문을 먼저 저장한 뒤 보낸다(입력란을 벗어나기 전에 단추를 눌러도 지금 글로 윤문한다).
  const send = async (refine: boolean) => {
    const cur = data().records.find((x) => x.id === r.id);
    if (cur && ta.value !== cur.finalText && !(await act('record.setFinal', { recordId: r.id, finalText: ta.value }))) return;
    await llmFlow(() => window.sgb.preparePolish(r.id, refine, 'final'), refine ? '분량 보정' : '최종 본문 재윤문');
  };
  const canSend = !!r.finalText.trim() && !!r.target && !S.busy;
  const head = h('div', { class: 'inline' },
    h('button', { class: 'btn secondary', disabled: !canSend, 'data-testid': 'final-repolish', onclick: () => void send(false) }, icon('spark', 16), p ? '최종 본문 다시 윤문' : '최종 본문 한 번 더 윤문'),
    h('span', { class: 'muted' }, !r.target ? '목표 글자 수를 [최종 윤문] 탭에서 먼저 고르세요.' : !r.finalText.trim() ? '최종 본문을 먼저 입력하세요.' : '고친 표현·사실은 살리고 문장만 다시 다듬어 제안합니다. 채택하기 전에는 본문이 바뀌지 않습니다.'),
  );
  if (!p) return h('div', { class: 'final-repolish' }, head);
  if (r.finalText === p.resultText) return h('div', { class: 'final-repolish' }, head, h('p', { class: 'hint ok-text' }, p.sourceText === r.finalText ? '재윤문 제안이 지금 최종 본문과 같습니다(고칠 곳을 찾지 못함).' : '재윤문 제안을 최종 본문에 채택했습니다.'));
  const stale = p.sourceText !== r.finalText;
  const n = charCount(p.resultText);
  const remaining = Math.max(0, v.aggregation.remaining + measure(v.output.text).bytes);
  const rg = polishRange(p.target, remaining);
  return h('div', { class: 'final-repolish' },
    head,
    stale ? banner('warn', '재윤문을 요청한 뒤 최종 본문이 바뀌었습니다.', '오른쪽 제안은 이전 본문으로 만든 것입니다. 채택하면 지금 고친 내용이 사라지니 [최종 본문 다시 윤문]으로 새로 받으세요.') : null,
    h('div', { class: 'compare' },
      h('div', null, h('div', { class: 'compare-title' }, stale ? '지금 최종 본문 · 요청 뒤 바뀜' : '지금 최종 본문'), h('div', { class: 'compare-text' }, displayText(r.finalText)), meter(r.finalText)),
      h('div', null, h('div', { class: 'compare-title' }, `재윤문 제안 · 목표 ${p.target}자`), h('div', { class: 'compare-text', 'data-testid': 'final-repolish-result' }, displayText(p.resultText)), meter(p.resultText),
        h('span', { class: `chip ${n >= rg.min && n <= rg.max ? 'ok' : 'warn'}` }, `목표 대비 ${n - p.target >= 0 ? '+' : ''}${n - p.target}자`)),
    ),
    !stale && (n < rg.min || n > rg.max) ? banner('warn', `재윤문 결과가 ${n}자로 목표 범위(${rg.min}~${rg.max}자)를 벗어났습니다.`, '같은 본문으로 분량을 맞춰 다시 받을 수 있습니다(요청 1회 추가).',
      h('div', { class: 'btn-row left tight' }, h('button', { class: 'btn secondary sm', disabled: !!S.busy, onclick: () => void send(true) }, icon('spark', 14), `분량 맞춰 다시 윤문 (${n < rg.min ? `+${rg.min - n}` : `-${n - rg.max}`}자)`))) : null,
    p.suggestions.length ? h('div', null, h('b', null, 'AI 검토 제안(공식 판정 아님)'), h('ul', { class: 'suggest' }, p.suggestions.map((s) => h('li', null, displayText(s))))) : null,
    findingsList(v.findings.polish),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn ghost', onclick: async () => (await act('record.dismissPolish', { recordId: r.id }, '재윤문 제안을 닫았습니다. 최종 본문은 그대로입니다.')) && S.render() }, '제안 닫기'),
      h('button', { class: 'btn', onclick: async () => {
        if (stale && !(await modal<boolean>('이전 본문으로 만든 제안입니다', (close) => h('div', null, h('p', null, '채택하면 재윤문을 요청한 뒤 최종 본문에서 고친 내용이 사라집니다. 그래도 채택할까요?'), h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', onclick: () => close(false) }, '취소'), h('button', { class: 'btn', onclick: () => close(true) }, '채택')))))) return;
        if (await act('record.adoptPolish', { recordId: r.id }, '재윤문 제안을 최종 본문으로 옮겼습니다. 검토가 다시 필요합니다.')) S.render();
      } }, '재윤문 제안 채택'),
    ),
  );
}

function outputHasText(v: NonNullable<typeof S.view>) {
  return !!v.output.text.trim();
}
void clear;

/**
 * 행사·활동 선택(자율·자치, 진로, 행특). 행사 정의는 담임 작업·영역·학기 공통이고, 학생별로 참여한 행사를 고른다.
 * 초기 앱의 '자율활동 내용 선택' 빠른 선택·직접 입력·편집·삭제 흐름을 이어 쓴다.
 */
function eventsBox(r: RecordEntry, draft: { eventObs: EventObs[] }, onChange: () => void) {
  const d = data();
  const area = r.area as EventArea;
  const defs = d.events.filter((e) => e.workId === r.workId && e.area === area && e.semester === r.semester);
  const st = d.students.find((s) => s.id === r.studentId)!;
  const toggle = (eventId: string, on: boolean) => {
    if (on && !draft.eventObs.some((e) => e.eventId === eventId)) draft.eventObs.push({ eventId, note: '' });
    if (!on) draft.eventObs = draft.eventObs.filter((e) => e.eventId !== eventId);
    S.render();
  };
  const createEvent = async (name: string, extra?: { period: string; quantity: string; description: string }) => {
    const id = (await act('event.create', { workId: r.workId, area, semester: r.semester, name, period: extra?.period ?? '', quantity: extra?.quantity ?? '', description: extra?.description ?? '' })) as string | undefined;
    if (id) toggle(id, true);
  };
  const presetRow = h('div', { class: 'chips' }, EVENT_PRESETS[area].filter((p) => !defs.some((x) => x.name === p)).map((p) =>
    h('button', { class: 'chip-btn', onclick: () => createEvent(p), title: '이 학기 행사 목록에 추가하고 이 학생을 참여로 선택' }, icon('plus', 12), p)));
  const custom = {
    name: h('input', { class: 'input sm', placeholder: '행사명 직접 입력', 'aria-label': '행사명' }),
    period: h('input', { class: 'input sm', placeholder: '날짜·기간(선택) 예: 2026.03.12.', 'aria-label': '행사 날짜·기간' }),
    quantity: h('input', { class: 'input sm', placeholder: '횟수·시간(선택) 예: 5회', 'aria-label': '행사 횟수·시간' }),
    description: h('input', { class: 'input sm', placeholder: '행사 내용(선택)', 'aria-label': '행사 내용' }),
  };
  return h('div', { class: 'events-box' },
    h('div', { class: 'cat-title' }, `${area === 'behavior' ? '행동을 관찰한' : '참여한'} 행사·활동 선택`),
    h('p', { class: 'hint' }, '행사 목록은 이 담임 작업의 같은 영역·학기 학생이 함께 씁니다. 학생마다 실제로 참여한 행사만 고르고, 역할·사례가 있으면 적으세요. 사례가 없으면 참여 사실과 행사 내용만으로 문장을 만듭니다.\n횟수·시간은 정량적으로 적을 수 있습니다(중 2203~2206행, 고 2329~2333행). 단순 나열보다 학생 개별 특성이 드러나게 사례를 적는 것이 좋습니다.'),
    st.schoolLevel === 'high' && area !== 'behavior' ? h('p', { class: 'hint warn-text' }, '고등학교: 출석인정 결석 등으로 시간만 인정된 행사는 참여로 고르지 마세요.') : null,
    defs.length
      ? h('div', { class: 'event-list' }, defs.map((e) => {
          const sel = draft.eventObs.find((x) => x.eventId === e.id);
          const cb = h('input', { type: 'checkbox', checked: !!sel, 'aria-label': `${e.name} 참여 선택` });
          cb.addEventListener('change', () => toggle(e.id, cb.checked));
          const note = sel ? h('textarea', { class: 'textarea sm', rows: '2', placeholder: '이 학생의 역할·사례(선택). 비워 두면 소감·변화를 만들지 않습니다.', 'aria-label': `${e.name} 학생 사례` }, sel.note) : null;
          note?.addEventListener('input', () => {
            sel!.note = note.value;
            onChange();
          });
          const noteCheck = note ? liveCheck(note, r.area) : null;
          return h('div', { class: `event-item ${sel ? 'on' : ''}` },
            h('div', { class: 'event-row' },
              h('label', { class: 'check strong' }, cb, ` ${eventLabel(e)}`),
              e.description ? h('span', { class: 'muted' }, e.description) : null,
              h('span', { class: 'spacer' }),
              h('button', { class: 'btn ghost sm', title: '이 작업의 모든 학생을 참여로 선택(사례는 비워 둠)', onclick: async () => {
                const n = await act('event.applyToAll', { eventId: e.id, selected: true });
                if (n !== undefined) {
                  obsDraft.delete(r.id);
                  toast(`${n}명에게 참여로 추가했습니다. 불참·시간만 인정된 학생은 해제하세요.`, 'ok');
                  S.render();
                }
              } }, '학급 전체 참여'),
              h('button', { class: 'btn ghost sm', title: '이 작업의 모든 학생에서 참여 선택을 해제(학생 사례를 적은 학생은 유지)', onclick: async () => {
                const n = await act('event.applyToAll', { eventId: e.id, selected: false });
                if (n !== undefined) {
                  obsDraft.delete(r.id);
                  toast(`${n}명의 참여 선택을 해제했습니다. 사례를 적은 학생은 그대로 두었습니다.`, 'ok');
                  S.render();
                }
              } }, '학급 전체 해제'),
              h('button', { class: 'btn ghost sm', onclick: () => editEvent(e.id) }, '수정'),
              h('button', { class: 'btn ghost sm danger-text', 'aria-label': `${e.name} 행사 삭제`, onclick: () => void deleteEvent(e.id) }, '삭제'),
            ),
            note,
            noteCheck,
          );
        }))
      : h('p', { class: 'empty' }, '아직 이 학기 행사가 없습니다. 아래에서 고르거나 직접 추가하세요.'),
    h('div', { class: 'preset-row' }, h('span', { class: 'muted' }, '빠른 추가'), presetRow),
    h('div', { class: 'inline' }, custom.name, custom.period, custom.quantity, custom.description, h('button', { class: 'btn secondary sm', onclick: () => {
      if (!custom.name.value.trim()) return toast('행사명을 입력하세요.', 'warn');
      void createEvent(custom.name.value.trim(), { period: custom.period.value, quantity: custom.quantity.value, description: custom.description.value });
    } }, '행사 추가')),
  );
}

/** 행사 삭제. 고른 학생이 있으면 함께 지워지는 내용을 알리고, 없어도 한 번 확인한다. */
async function deleteEvent(eventId: string): Promise<boolean> {
  const e = data().events.find((x) => x.id === eventId);
  if (!e) return false;
  const used = data().records.filter((x) => x.eventObs.some((o) => o.eventId === e.id)).length;
  const msg = used
    ? `학생 ${used}명이 '${e.name}' 행사를 선택했습니다.\n삭제하면 그 학생들의 선택·사례와 이 행사로 만든 후보·조합 칸도 함께 지워집니다.\n\n삭제할까요?`
    : `'${e.name}' 행사를 삭제할까요?`;
  if (!window.confirm(msg)) return false;
  if (!(await act('event.delete', { id: e.id }, '행사를 삭제했습니다.'))) return false;
  obsDraft.clear();
  S.render();
  return true;
}

async function editEvent(eventId: string) {
  const e = data().events.find((x) => x.id === eventId);
  if (!e) return;
  await modal('행사 수정', (close) => {
    const name = h('input', { class: 'input', value: e.name });
    const period = h('input', { class: 'input', value: e.period, placeholder: '예: 2026.03.12. 또는 2026.03.04.-2026.07.08.' });
    const quantity = h('input', { class: 'input', value: e.quantity, placeholder: '예: 5회, 4시간' });
    const description = h('textarea', { class: 'textarea', rows: '3', placeholder: '교사가 확인한 행사 내용' }, e.description);
    return h('div', null,
      banner('info', '이 행사를 고른 모든 학생에게 적용됩니다.', '바꾸면 해당 학생들의 후보는 "근거 변경됨"으로 표시되고, 관련 검토가 다시 필요할 수 있습니다.'),
      h('div', { class: 'grid-2' }, field('행사명', name), field('날짜·기간', period, undefined, '선택'), field('횟수·시간', quantity, undefined, '선택')),
      field('행사 내용', description, '대학·기관·상호·강사명, 대회·수상 등 기재 금지 내용은 쓰지 마세요.', '선택'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost danger-text', onclick: async () => {
          if (await deleteEvent(e.id)) close();
        } }, '삭제'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn ghost', onclick: () => close() }, '취소'),
        h('button', { class: 'btn primary', onclick: async () => {
          if (await act('event.update', { id: e.id, name: name.value, period: period.value, quantity: quantity.value, description: description.value }, '행사를 수정했습니다.')) {
            close();
            S.render();
          }
        } }, '저장'),
      ),
    );
  });
}
