import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { activeStudentIds, areasForWork, semestersFor, assembleDraft, compositionHash, newRecord, nowIso, reviewGate, reviewHash, workRefs } from './model';
import { RULES_VERSION } from './rules';
import {
  FREE_ITEM_ID,
  AREAS,
  CLUB_TYPES,
  COMMON_GROUPS,
  defaultCurriculum,
  EVENT_AREAS,
  EventObsSchema,
  FragmentSchema,
  ObservationSchema,
  PROVIDERS,
  SCHOOL_LEVELS,
  SUBJECT_KINDS,
  TargetSchema,
  type AppData,
  type RecordEntry,
} from './schema';

export class ActionError extends Error {}

function removeWork(d: AppData, workId: string) {
  d.records = d.records.filter((r) => r.workId !== workId);
  d.events = d.events.filter((e) => e.workId !== workId);
  d.works = d.works.filter((w) => w.id !== workId);
}

function deleteGroup(d: AppData, groupId: string) {
  for (const w of d.works.filter((x) => x.kind === 'subject' && x.refId === groupId)) removeWork(d, w.id);
  d.courseGroups = d.courseGroups.filter((x) => x.id !== groupId);
}

const id = z.string().min(1).max(64);
const grade = z.number().int().min(1).max(3);
const sem = z.union([z.literal(1), z.literal(2)]);
const newId = (p: string) => `${p}-${randomUUID().slice(0, 12)}`;

function rec(d: AppData, recordId: string): RecordEntry {
  const r = d.records.find((x) => x.id === recordId);
  if (!r) throw new ActionError('기록을 찾을 수 없습니다.');
  return r;
}
function touch(r: RecordEntry) {
  r.updatedAt = nowIso();
}
function ensureStudents(d: AppData, ids: string[]) {
  for (const s of ids) if (!d.students.some((x) => x.id === s)) throw new ActionError(`없는 학생입니다: ${s}`);
}

const RosterDecision = z.object({
  name: z.string().min(1).max(40),
  grade,
  classNo: z.number().int().min(0).max(99),
  number: z.number().int().min(1).max(999),
  action: z.enum(['new', 'link', 'skip', 'update']),
  studentId: id.optional(),
});

export const ACTIONS = {
  'settings.update': {
    schema: z.object({
      setupDone: z.boolean().optional(),
      schoolLevel: z.enum(SCHOOL_LEVELS).optional(),
      defaultGrade: grade.optional(),
      schoolName: z.string().max(60).optional(),
      schoolAliases: z.array(z.string().min(1).max(60)).max(20).optional(),
      provider: z.enum(PROVIDERS).optional(),
      models: z.object({ gemini: z.string().max(200), openai: z.string().max(200), anthropic: z.string().max(200) }).partial().optional(),
      bannedTerms: z.array(z.string().min(1).max(60)).max(200).optional(),
      confirmBeforeSend: z.boolean().optional(),
    }),
    run(d: AppData, p: any) {
      const { models, ...rest } = p;
      if (rest.bannedTerms) rest.bannedTerms = [...new Set((rest.bannedTerms as string[]).map((t) => t.trim()).filter(Boolean))];
      if (rest.schoolLevel && rest.schoolLevel !== d.settings.schoolLevel && d.students.length) throw new ActionError('학생 명단이 있으면 학교급을 바꿀 수 없습니다.');
      Object.assign(d.settings, rest);
      if (models) Object.assign(d.settings.models, models);
    },
  },
  'class.create': {
    schema: z.object({ grade, classNo: z.number().int().min(0).max(99), homeroom: z.boolean() }),
    run(d: AppData, p: { grade: number; classNo: number; homeroom: boolean }) {
      let c = d.classes.find((x) => x.schoolLevel === d.settings.schoolLevel && x.schoolYear === d.settings.schoolYear && x.grade === p.grade && x.classNo === p.classNo);
      if (!c) {
        c = { id: newId('class'), schoolLevel: d.settings.schoolLevel, schoolYear: d.settings.schoolYear, grade: p.grade, classNo: p.classNo, studentIds: [] };
        d.classes.push(c);
      }
      if (p.homeroom && !d.works.some((w) => w.kind === 'homeroom' && w.refId === c!.id)) d.works.push({ id: newId('work'), kind: 'homeroom', refId: c.id, excludedStudentIds: [] });
      return c.id;
    },
  },
  'subject.create': {
    schema: z.object({
      name: z.string().min(1).max(60),
      kind: z.enum(SUBJECT_KINDS),
      curriculum: z.enum(['2015', '2022']),
      commonGroup: z.enum(COMMON_GROUPS).nullable(),
      commonPart: z.union([z.literal(1), z.literal(2)]).nullable(),
    }),
    run(d: AppData, p: any) {
      if (p.kind === 'common' && (!p.commonGroup || !p.commonPart)) throw new ActionError('공통과목은 합산 그룹과 1·2 구분을 지정해야 합니다.');
      if (p.kind !== 'common') {
        p.commonGroup = null;
        p.commonPart = null;
      }
      if (d.settings.schoolLevel === 'middle') p.kind = p.kind === 'unsupported' ? 'unsupported' : 'general';
      const s = { id: newId('subj'), schoolLevel: d.settings.schoolLevel, ...p };
      d.subjects.push(s);
      return s.id;
    },
  },
  'courseGroup.create': {
    schema: z.object({ subjectId: id, grade, semester: sem, termType: z.enum(['regular', 'free']), name: z.string().min(1).max(60), studentIds: z.array(id), annual: z.boolean().optional() }),
    run(d: AppData, p: any) {
      if (!d.subjects.some((s) => s.id === p.subjectId)) throw new ActionError('과목을 찾을 수 없습니다.');
      ensureStudents(d, p.studentIds);
      if (d.settings.schoolLevel === 'high') p.termType = 'regular';
      // 학기 구분 없음(연간): 1학기 칸에 쓰고 작업의 연간 영역으로 표시한다.
      const { annual, ...rest } = p;
      if (annual) rest.semester = 1;
      const g = { id: newId('group'), schoolYear: d.settings.schoolYear, ...rest };
      d.courseGroups.push(g);
      d.works.push({ id: newId('work'), kind: 'subject', refId: g.id, excludedStudentIds: [], ...(annual ? { annualAreas: ['subject'] } : {}) });
      return g.id;
    },
  },
  'club.create': {
    schema: z.object({ name: z.string().min(1).max(60), clubType: z.enum(CLUB_TYPES), studentIds: z.array(id) }),
    run(d: AppData, p: any) {
      ensureStudents(d, p.studentIds);
      const c = { id: newId('club'), schoolLevel: d.settings.schoolLevel, schoolYear: d.settings.schoolYear, ...p };
      d.clubs.push(c);
      d.works.push({ id: newId('work'), kind: 'club', refId: c.id, excludedStudentIds: [] });
      return c.id;
    },
  },
  /** 담임 작업 켜기·끄기. 끄면 그 작업의 기록·행사를 지운다(화면에서 확인을 받는다). */
  'homeroom.set': {
    schema: z.object({ classId: id, on: z.boolean() }),
    run(d: AppData, p: { classId: string; on: boolean }) {
      const c = d.classes.find((x) => x.id === p.classId);
      if (!c) throw new ActionError('학급을 찾을 수 없습니다.');
      const w = d.works.find((x) => x.kind === 'homeroom' && x.refId === c.id);
      if (p.on && !w) d.works.push({ id: newId('work'), kind: 'homeroom', refId: c.id, excludedStudentIds: [] });
      if (!p.on && w) removeWork(d, w.id);
    },
  },
  /** 학급 삭제: 학급과 담임 작업(기록·행사 포함)을 지운다. 학생은 지우지 않는다. */
  'class.delete': {
    schema: z.object({ id }),
    run(d: AppData, p: { id: string }) {
      if (!d.classes.some((x) => x.id === p.id)) throw new ActionError('학급을 찾을 수 없습니다.');
      for (const w of d.works.filter((x) => x.kind === 'homeroom' && x.refId === p.id)) removeWork(d, w.id);
      d.classes = d.classes.filter((x) => x.id !== p.id);
    },
  },
  /** 과목 삭제: 과목과 그 수강집단·교과 작업·기록을 지운다. */
  'subject.delete': {
    schema: z.object({ id }),
    run(d: AppData, p: { id: string }) {
      if (!d.subjects.some((x) => x.id === p.id)) throw new ActionError('과목을 찾을 수 없습니다.');
      for (const g of d.courseGroups.filter((x) => x.subjectId === p.id)) deleteGroup(d, g.id);
      d.subjects = d.subjects.filter((x) => x.id !== p.id);
    },
  },
  'courseGroup.delete': {
    schema: z.object({ id }),
    run(d: AppData, p: { id: string }) {
      if (!d.courseGroups.some((x) => x.id === p.id)) throw new ActionError('수강집단을 찾을 수 없습니다.');
      deleteGroup(d, p.id);
    },
  },
  'club.delete': {
    schema: z.object({ id }),
    run(d: AppData, p: { id: string }) {
      if (!d.clubs.some((x) => x.id === p.id)) throw new ActionError('동아리를 찾을 수 없습니다.');
      for (const w of d.works.filter((x) => x.kind === 'club' && x.refId === p.id)) removeWork(d, w.id);
      d.clubs = d.clubs.filter((x) => x.id !== p.id);
    },
  },
  'club.setType': {
    schema: z.object({ clubId: id, clubType: z.enum(CLUB_TYPES) }),
    run(d: AppData, p: any) {
      const c = d.clubs.find((x) => x.id === p.clubId);
      if (!c) throw new ActionError('동아리를 찾을 수 없습니다.');
      c.clubType = p.clubType;
    },
  },
  'members.set': {
    schema: z.object({ kind: z.enum(['class', 'courseGroup', 'club']), id, studentIds: z.array(id) }),
    run(d: AppData, p: any) {
      ensureStudents(d, p.studentIds);
      const list = p.kind === 'class' ? d.classes : p.kind === 'courseGroup' ? d.courseGroups : d.clubs;
      const t = (list as { id: string; studentIds: string[] }[]).find((x) => x.id === p.id);
      if (!t) throw new ActionError('명단을 찾을 수 없습니다.');
      t.studentIds = [...new Set(p.studentIds as string[])];
    },
  },
  'roster.apply': {
    schema: z.object({ target: z.object({ kind: z.enum(['class', 'courseGroup', 'club']), id }).optional(), decisions: z.array(RosterDecision).max(2000) }),
    /** target이 없으면 학생 명단 일괄 입력: 학생을 만들고 학년·반에 맞는 원적 학급을 자동으로 만들어 연결한다(담임 작업은 만들지 않음). */
    run(d: AppData, p: { target?: { kind: 'class' | 'courseGroup' | 'club'; id: string }; decisions: z.infer<typeof RosterDecision>[] }) {
      let t: { id: string; studentIds: string[] } | undefined;
      if (p.target) {
        const list = p.target.kind === 'class' ? d.classes : p.target.kind === 'courseGroup' ? d.courseGroups : d.clubs;
        t = (list as { id: string; studentIds: string[] }[]).find((x) => x.id === p.target!.id);
        if (!t) throw new ActionError('대상 명단을 찾을 수 없습니다.');
      }
      const homeOf = (grade: number, classNo: number) => {
        let c = d.classes.find((x) => x.schoolLevel === d.settings.schoolLevel && x.schoolYear === d.settings.schoolYear && x.grade === grade && x.classNo === classNo);
        if (!c && !p.target && classNo > 0) {
          c = { id: newId('class'), schoolLevel: d.settings.schoolLevel, schoolYear: d.settings.schoolYear, grade, classNo, studentIds: [] };
          d.classes.push(c);
        }
        return c;
      };
      let added = 0;
      for (const r of p.decisions) {
        if (r.action === 'skip') continue;
        let sid = r.studentId;
        if (r.action === 'new') {
          sid = newId('stu');
          d.students.push({ id: sid, name: r.name, schoolLevel: d.settings.schoolLevel, schoolYear: d.settings.schoolYear, grade: r.grade, classNo: r.classNo, number: r.number, aliases: [], curriculum: defaultCurriculum(d.settings.schoolLevel, r.grade) });
          const home = homeOf(r.grade, r.classNo);
          if (home && !home.studentIds.includes(sid)) home.studentIds.push(sid);
        } else {
          const s = d.students.find((x) => x.id === sid);
          if (!s) throw new ActionError(`연결할 학생을 찾을 수 없습니다: ${r.name}`);
          if (r.action === 'update') Object.assign(s, { name: r.name, grade: r.grade, classNo: r.classNo, number: r.number });
          if (!p.target) {
            const home = homeOf(s.grade, s.classNo);
            if (home && !home.studentIds.includes(s.id)) home.studentIds.push(s.id);
          }
        }
        if (t && !t.studentIds.includes(sid!)) t.studentIds.push(sid!);
        added++;
      }
      return added;
    },
  },
  'student.add': {
    schema: z.object({ name: z.string().min(1).max(40), grade, classNo: z.number().int().min(0).max(99), number: z.number().int().min(1).max(999), targetKind: z.enum(['class', 'courseGroup', 'club']).optional(), targetId: id.optional() }),
    run(d: AppData, p: any) {
      const clash = d.students.find((s) => s.schoolYear === d.settings.schoolYear && s.grade === p.grade && s.classNo === p.classNo && s.number === p.number);
      if (clash) throw new ActionError(`${p.grade}학년 ${p.classNo}반 ${p.number}번에는 이미 ${clash.name} 학생이 있습니다.`);
      const sid = newId('stu');
      d.students.push({ id: sid, name: p.name, schoolLevel: d.settings.schoolLevel, schoolYear: d.settings.schoolYear, grade: p.grade, classNo: p.classNo, number: p.number, aliases: [], curriculum: defaultCurriculum(d.settings.schoolLevel, p.grade) });
      const home = d.classes.find((c) => c.schoolYear === d.settings.schoolYear && c.grade === p.grade && c.classNo === p.classNo);
      if (home) home.studentIds.push(sid);
      if (p.targetKind && p.targetId) {
        const list = p.targetKind === 'class' ? d.classes : p.targetKind === 'courseGroup' ? d.courseGroups : d.clubs;
        const t = (list as { id: string; studentIds: string[] }[]).find((x) => x.id === p.targetId);
        if (t && !t.studentIds.includes(sid)) t.studentIds.push(sid);
      }
      return sid;
    },
  },
  'student.update': {
    schema: z.object({
      id,
      name: z.string().min(1).max(40).optional(),
      grade: grade.optional(),
      classNo: z.number().int().min(0).max(99).optional(),
      number: z.number().int().min(1).max(999).optional(),
      aliases: z.array(z.string().min(1).max(40)).max(10).optional(),
      curriculum: z.enum(['2015', '2022']).optional(),
    }),
    run(d: AppData, p: any) {
      const s = d.students.find((x) => x.id === p.id);
      if (!s) throw new ActionError('학생을 찾을 수 없습니다.');
      const { id: _id, ...rest } = p;
      Object.assign(s, rest);
    },
  },
  'student.delete': {
    schema: z.object({ id, confirmName: z.string() }),
    run(d: AppData, p: { id: string; confirmName: string }) {
      const s = d.students.find((x) => x.id === p.id);
      if (!s) throw new ActionError('학생을 찾을 수 없습니다.');
      if (p.confirmName !== s.name) throw new ActionError('확인용 이름이 일치하지 않습니다.');
      const marker = `{{학생:${s.id}}}`;
      const refs = d.records.filter((r) => r.studentId !== s.id && [r.finalText, r.draft, ...r.compositions.map((c) => c.text)].some((t) => t.includes(marker)));
      if (refs.length) throw new ActionError(`다른 학생 기록 ${refs.length}건이 이 학생을 참조합니다. 참조를 먼저 고친 뒤 삭제하세요.`);
      d.records = d.records.filter((r) => r.studentId !== s.id);
      d.priorBytes = d.priorBytes.filter((x) => x.studentId !== s.id);
      for (const l of [...d.classes, ...d.courseGroups, ...d.clubs]) l.studentIds = l.studentIds.filter((x) => x !== s.id);
      for (const w of d.works) w.excludedStudentIds = w.excludedStudentIds.filter((x) => x !== s.id);
      d.students = d.students.filter((x) => x.id !== s.id);
      return 'purge';
    },
  },
  'work.exclude': {
    schema: z.object({ workId: id, studentId: id, excluded: z.boolean() }),
    run(d: AppData, p: any) {
      const w = d.works.find((x) => x.id === p.workId);
      if (!w) throw new ActionError('작업을 찾을 수 없습니다.');
      w.excludedStudentIds = w.excludedStudentIds.filter((x) => x !== p.studentId);
      if (p.excluded) w.excludedStudentIds.push(p.studentId);
    },
  },
  'record.ensure': {
    schema: z.object({ studentId: id, workId: id, area: z.enum(AREAS), semester: sem }),
    run(d: AppData, p: any) {
      const refs = workRefs(d, p.workId);
      if (!refs) throw new ActionError('작업을 찾을 수 없습니다.');
      if (!areasForWork(refs.work.kind).includes(p.area)) throw new ActionError('이 작업에서 다룰 수 없는 영역입니다.');
      if (!refs.studentIds.includes(p.studentId)) throw new ActionError('학생이 이 작업 명단에 없습니다.');
      if (refs.courseGroup && refs.courseGroup.semester !== p.semester) throw new ActionError('수강집단의 학기와 다릅니다.');
      if (!semestersFor(d, p.workId, p.area).includes(p.semester)) throw new ActionError('학기 구분 없이(연간) 쓰는 영역입니다. 1학기 칸에 작성하세요.');
      const found = d.records.find((r) => r.studentId === p.studentId && r.workId === p.workId && r.area === p.area && r.semester === p.semester);
      if (found) return found.id;
      const r = newRecord(newId('rec'), p.studentId, p.workId, p.area, p.semester);
      d.records.push(r);
      return r.id;
    },
  },
  'record.setObservations': {
    schema: z.object({ recordId: id, observations: z.array(ObservationSchema).max(30), context: z.string().max(5000), eventObs: z.array(EventObsSchema).max(40).optional(), freeNote: z.string().max(5000).optional() }),
    run(d: AppData, p: any) {
      const r = rec(d, p.recordId);
      const ids = p.observations.map((o: { itemId: string }) => o.itemId);
      if (new Set(ids).size !== ids.length) throw new ActionError('같은 항목이 중복되었습니다.');
      r.observations = p.observations;
      r.context = p.context;
      if (typeof p.freeNote === 'string') r.freeNote = p.freeNote;
      if (p.eventObs) {
        const evIds = p.eventObs.map((e: { eventId: string }) => e.eventId);
        p.eventObs = p.eventObs.filter((e: { eventId: string }, i: number) => evIds.indexOf(e.eventId) === i);
        // 삭제됐거나 다른 작업·영역·학기의 행사 선택은 오류 대신 조용히 뺀다(오래된 화면 상태 방지).
        const ok = (eid: string) => {
          const def = d.events.find((e) => e.id === eid);
          return !!def && def.workId === r.workId && def.area === r.area && def.semester === r.semester;
        };
        r.eventObs = p.eventObs.filter((e: { eventId: string }) => ok(e.eventId));
        ids.push(...r.eventObs.map((e) => e.eventId));
      }
      for (const itemId of ids) if (!r.itemOrder.includes(itemId)) r.itemOrder.push(itemId);
      if (r.freeNote.trim() && !r.itemOrder.includes(FREE_ITEM_ID)) r.itemOrder.unshift(FREE_ITEM_ID);
      touch(r);
    },
  },
  'work.setAnnual': {
    schema: z.object({ workId: id, area: z.enum(AREAS), annual: z.boolean() }),
    run(d: AppData, p: any) {
      const w = d.works.find((x) => x.id === p.workId);
      if (!w) throw new ActionError('작업을 찾을 수 없습니다.');
      if (w.kind === 'subject') throw new ActionError('교과 세특은 수강집단 학기로 정해집니다.');
      if (!areasForWork(w.kind).includes(p.area)) throw new ActionError('이 작업에서 다룰 수 없는 영역입니다.');
      const set = new Set(w.annualAreas ?? []);
      if (p.annual) set.add(p.area);
      else set.delete(p.area);
      w.annualAreas = [...set];
    },
  },
  'work.setSemester': {
    schema: z.object({ workId: id, semester: sem }),
    run(d: AppData, p: any) {
      const w = d.works.find((x) => x.id === p.workId);
      if (!w) throw new ActionError('작업을 찾을 수 없습니다.');
      if (w.kind === 'subject') throw new ActionError('교과 세특은 수강집단 학기로 정해집니다.');
      w.activeSemester = p.semester;
    },
  },
  'record.bulkExclude': {
    schema: z.object({ workId: id, area: z.enum(AREAS), semester: sem, excludeIds: z.array(id), includeIds: z.array(id) }),
    run(d: AppData, p: any) {
      const refs = workRefs(d, p.workId);
      if (!refs) throw new ActionError('작업을 찾을 수 없습니다.');
      if (!semestersFor(d, p.workId, p.area).includes(p.semester)) throw new ActionError('이 작업에서 작성하지 않는 학기입니다.');
      let n = 0;
      for (const sid of p.excludeIds as string[]) {
        if (!refs.studentIds.includes(sid)) continue;
        let r = d.records.find((x) => x.studentId === sid && x.workId === p.workId && x.area === p.area && x.semester === p.semester);
        if (!r) {
          r = newRecord(newId('rec'), sid, p.workId, p.area, p.semester);
          d.records.push(r);
        }
        if (r.mode !== 'excluded') {
          r.mode = 'excluded';
          touch(r);
          n++;
        }
      }
      for (const sid of p.includeIds as string[]) {
        const r = d.records.find((x) => x.studentId === sid && x.workId === p.workId && x.area === p.area && x.semester === p.semester);
        if (r?.mode === 'excluded') {
          r.mode = 'normal';
          touch(r);
          n++;
        }
      }
      return n;
    },
  },
  'record.setMode': {
    schema: z.object({ recordId: id, mode: z.enum(['normal', 'reason', 'excluded']), reasonText: z.string().max(2000).optional() }),
    run(d: AppData, p: any) {
      const r = rec(d, p.recordId);
      r.mode = p.mode;
      if (p.mode === 'reason') r.finalText = (p.reasonText ?? '').trim();
      touch(r);
    },
  },
  'event.create': {
    schema: z.object({ workId: id, area: z.enum(EVENT_AREAS), semester: sem, name: z.string().trim().min(1).max(60), period: z.string().max(40), quantity: z.string().max(20), description: z.string().max(1000) }),
    run(d: AppData, p: any) {
      const w = d.works.find((x) => x.id === p.workId);
      if (!w || w.kind !== 'homeroom') throw new ActionError('행사는 담임 작업의 자율·자치, 진로, 행특에서 관리합니다.');
      const dup = d.events.find((e) => e.workId === p.workId && e.area === p.area && e.semester === p.semester && e.name === p.name.trim() && e.period === p.period.trim());
      if (dup) return dup.id;
      const e = { id: newId('evt'), ...p, name: p.name.trim(), period: p.period.trim(), quantity: p.quantity.trim(), description: p.description.trim() };
      d.events.push(e);
      return e.id;
    },
  },
  'event.update': {
    schema: z.object({ id, name: z.string().trim().min(1).max(60), period: z.string().max(40), quantity: z.string().max(20), description: z.string().max(1000) }),
    run(d: AppData, p: any) {
      const e = d.events.find((x) => x.id === p.id);
      if (!e) throw new ActionError('행사를 찾을 수 없습니다.');
      Object.assign(e, { name: p.name.trim(), period: p.period.trim(), quantity: p.quantity.trim(), description: p.description.trim() });
    },
  },
  'event.delete': {
    schema: z.object({ id }),
    run(d: AppData, p: any) {
      // 학생별 선택·후보·조합에서도 빼고 지운다(화면에서 선택 학생 수를 보여 주고 확인을 받는다).
      for (const r of d.records) {
        if (!r.eventObs.some((e) => e.eventId === p.id) && !r.itemOrder.includes(p.id)) continue;
        r.eventObs = r.eventObs.filter((e) => e.eventId !== p.id);
        r.candidates = r.candidates.filter((c) => c.itemId !== p.id);
        r.compositions = r.compositions.filter((c) => c.itemId !== p.id);
        r.itemOrder = r.itemOrder.filter((x) => x !== p.id);
        touch(r);
      }
      d.events = d.events.filter((e) => e.id !== p.id);
    },
  },
  'event.applyToAll': {
    schema: z.object({ eventId: id, selected: z.boolean() }),
    run(d: AppData, p: any) {
      const def = d.events.find((e) => e.id === p.eventId);
      if (!def) throw new ActionError('행사를 찾을 수 없습니다.');
      let n = 0;
      for (const sid of activeStudentIds(d, def.workId)) {
        let r = d.records.find((x) => x.studentId === sid && x.workId === def.workId && x.area === def.area && x.semester === def.semester);
        if (!r && p.selected) {
          r = newRecord(newId('rec'), sid, def.workId, def.area, def.semester);
          d.records.push(r);
        }
        if (!r || r.mode !== 'normal') continue;
        const has = r.eventObs.some((e) => e.eventId === def.id);
        if (p.selected && !has) {
          r.eventObs.push({ eventId: def.id, note: '' });
          if (!r.itemOrder.includes(def.id)) r.itemOrder.push(def.id);
          touch(r);
          n++;
        } else if (!p.selected && has && !r.eventObs.find((e) => e.eventId === def.id)!.note.trim()) {
          r.eventObs = r.eventObs.filter((e) => e.eventId !== def.id);
          touch(r);
          n++;
        }
      }
      return n;
    },
  },
  'composition.add': {
    schema: z.object({ recordId: id, itemId: id, fragments: z.array(FragmentSchema.omit({ id: true })).min(1).max(10) }),
    run(d: AppData, p: any) {
      const r = rec(d, p.recordId);
      let c = r.compositions.find((x) => x.itemId === p.itemId);
      if (!c) {
        c = { itemId: p.itemId, fragments: [], text: '' };
        r.compositions.push(c);
        if (!r.itemOrder.includes(p.itemId)) r.itemOrder.push(p.itemId);
      }
      const dup: string[] = [];
      for (const f of p.fragments) {
        const text = String(f.text).replace(/\s+/g, ' ').trim();
        if (!text) continue;
        if (c.fragments.some((x) => x.text === text)) dup.push(text);
        c.fragments.push({ id: newId('frag'), text, source: f.source });
        c.text = c.text.trim() ? `${c.text.trim()} ${text}` : text;
      }
      touch(r);
      return dup.length ? `같은 조각을 다시 추가했습니다(${dup.length}개). 확인하세요.` : '';
    },
  },
  'composition.update': {
    schema: z.object({ recordId: id, itemId: id, text: z.string().max(5000), fragmentOrder: z.array(id).optional(), removeFragmentIds: z.array(id).optional() }),
    run(d: AppData, p: any) {
      const r = rec(d, p.recordId);
      const c = r.compositions.find((x) => x.itemId === p.itemId);
      if (!c) throw new ActionError('조합 칸을 찾을 수 없습니다.');
      if (p.removeFragmentIds) c.fragments = c.fragments.filter((f) => !p.removeFragmentIds.includes(f.id));
      if (p.fragmentOrder) {
        const map = new Map(c.fragments.map((f) => [f.id, f]));
        const ordered = p.fragmentOrder.map((fid: string) => map.get(fid)).filter(Boolean);
        c.fragments = [...ordered, ...c.fragments.filter((f) => !p.fragmentOrder.includes(f.id))];
      }
      c.text = p.text;
      touch(r);
    },
  },
  'composition.clear': {
    schema: z.object({ recordId: id, itemId: id.optional() }),
    run(d: AppData, p: any) {
      const r = rec(d, p.recordId);
      r.compositions = p.itemId ? r.compositions.filter((c) => c.itemId !== p.itemId) : [];
      touch(r);
    },
  },
  'record.setItemOrder': {
    schema: z.object({ recordId: id, itemOrder: z.array(id) }),
    run(d: AppData, p: any) {
      const r = rec(d, p.recordId);
      r.itemOrder = [...new Set(p.itemOrder as string[])];
      touch(r);
    },
  },
  'record.assemble': {
    schema: z.object({ recordId: id }),
    run(d: AppData, p: any) {
      const r = rec(d, p.recordId);
      r.draft = assembleDraft(r);
      r.draftSourceHash = compositionHash(r);
      touch(r);
    },
  },
  'record.setDraft': {
    schema: z.object({ recordId: id, draft: z.string().max(10000) }),
    run(d: AppData, p: any) {
      const r = rec(d, p.recordId);
      r.draft = p.draft;
      touch(r);
    },
  },
  'record.setTarget': {
    schema: z.object({ recordId: id, target: TargetSchema.nullable() }),
    run(d: AppData, p: any) {
      const r = rec(d, p.recordId);
      r.target = p.target;
      touch(r);
    },
  },
  'record.adoptPolish': {
    schema: z.object({ recordId: id }),
    run(d: AppData, p: any) {
      const r = rec(d, p.recordId);
      if (!r.polish) throw new ActionError('윤문 결과가 없습니다.');
      r.finalText = r.polish.resultText;
      touch(r);
    },
  },
  'record.useDraftAsFinal': {
    schema: z.object({ recordId: id }),
    run(d: AppData, p: any) {
      const r = rec(d, p.recordId);
      r.finalText = r.draft;
      touch(r);
    },
  },
  'record.setFinal': {
    schema: z.object({ recordId: id, finalText: z.string().max(10000) }),
    run(d: AppData, p: any) {
      const r = rec(d, p.recordId);
      r.finalText = p.finalText;
      touch(r);
    },
  },
  'record.review': {
    schema: z.object({ recordId: id, confirmed: z.literal(true) }),
    run(d: AppData, p: any) {
      const r = rec(d, p.recordId);
      const g = reviewGate(d, r);
      if (!g.ok) throw new ActionError(`검토 완료로 표시할 수 없습니다: ${g.reasons.join(' / ')}`);
      r.review = { hash: reviewHash(d, r), rulesVersion: RULES_VERSION, reviewedAt: nowIso() };
    },
  },
  'record.unreview': {
    schema: z.object({ recordId: id }),
    run(d: AppData, p: any) {
      rec(d, p.recordId).review = null;
    },
  },
  'priorBytes.set': {
    schema: z.object({ studentId: id, key: z.string().max(200), bytes: z.number().int().min(0).max(100000).nullable(), note: z.string().max(200) }),
    run(d: AppData, p: any) {
      ensureStudents(d, [p.studentId]);
      const ex = d.priorBytes.find((x) => x.studentId === p.studentId && x.key === p.key);
      if (ex) Object.assign(ex, { bytes: p.bytes, note: p.note });
      else d.priorBytes.push({ id: newId('prior'), ...p });
    },
  },
} as const;

export type ActionName = keyof typeof ACTIONS;
export const ACTION_NAMES = Object.keys(ACTIONS) as ActionName[];

/** 검증 → 복제본에 적용 → 결과 데이터 반환. 실패 시 원본은 그대로다. */
export function applyAction(d: AppData, name: string, payload: unknown): { data: AppData; result: unknown } {
  const a = (ACTIONS as Record<string, { schema: z.ZodTypeAny; run: (d: AppData, p: any) => unknown }>)[name];
  if (!a) throw new ActionError(`알 수 없는 명령: ${name}`);
  const parsed = a.schema.safeParse(payload);
  if (!parsed.success) throw new ActionError(`입력 값이 올바르지 않습니다: ${parsed.error.issues[0]?.message ?? ''}`);
  const copy = structuredClone(d);
  const result = a.run(copy, parsed.data);
  return { data: copy, result };
}
