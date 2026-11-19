import type { SchoolLevel, Student } from './schema';

/** 명단 가져오기 미리 보기. 표 형태(첫 행 머리글)를 받아 추가·수정·충돌을 분류한다. 자동 병합하지 않는다. */
export interface RosterRow {
  row: number;
  grade: number;
  classNo: number;
  number: number;
  name: string;
}

export interface RosterPreview {
  rows: RosterRow[];
  errors: string[];
  add: RosterRow[];
  same: { row: RosterRow; studentId: string }[];
  conflicts: { row: RosterRow; reason: string; studentIds: string[] }[];
}

const COLS = {
  grade: ['학년'],
  classNo: ['반', '학급'],
  number: ['번호', '번'],
  name: ['이름', '성명', '학생명'],
};

function findCol(header: string[], names: string[]): number {
  return header.findIndex((h) => names.includes(String(h ?? '').replace(/\s+/g, '')));
}

export function parseRosterTable(table: unknown[][], defaults: { grade?: number; classNo?: number }): { rows: RosterRow[]; errors: string[] } {
  const errors: string[] = [];
  const rows: RosterRow[] = [];
  if (!table.length) return { rows, errors: ['빈 표입니다.'] };
  const header = (table[0] ?? []).map((x) => String(x ?? '').trim());
  const ci = { grade: findCol(header, COLS.grade), classNo: findCol(header, COLS.classNo), number: findCol(header, COLS.number), name: findCol(header, COLS.name) };
  if (ci.name < 0) errors.push('필수 열 "이름"(또는 성명)이 없습니다.');
  if (ci.number < 0) errors.push('필수 열 "번호"가 없습니다.');
  if (ci.grade < 0 && !defaults.grade) errors.push('"학년" 열이 없고 기본 학년도 지정되지 않았습니다.');
  if (ci.classNo < 0 && defaults.classNo === undefined) errors.push('"반" 열이 없고 기본 반도 지정되지 않았습니다.');
  if (errors.length) return { rows, errors };
  const seen = new Map<string, number>();
  table.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const cell = (c: number) => (c >= 0 ? String(r[c] ?? '').trim() : '');
    const name = cell(ci.name);
    if (!name && !cell(ci.number)) return;
    const grade = ci.grade >= 0 ? Number(cell(ci.grade).replace(/[^0-9]/g, '')) : defaults.grade!;
    const classNo = ci.classNo >= 0 ? Number(cell(ci.classNo).replace(/[^0-9]/g, '')) : defaults.classNo!;
    const number = Number(cell(ci.number).replace(/[^0-9]/g, ''));
    if (!name) return errors.push(`${rowNo}행: 이름이 비어 있습니다.`);
    if (!(grade >= 1 && grade <= 3)) return errors.push(`${rowNo}행: 학년이 올바르지 않습니다.`);
    if (!(classNo >= 0 && classNo <= 99)) return errors.push(`${rowNo}행: 반이 올바르지 않습니다.`);
    if (!(number >= 1 && number <= 999)) return errors.push(`${rowNo}행: 번호가 올바르지 않습니다.`);
    const k = `${grade}-${classNo}-${number}`;
    if (seen.has(k)) return errors.push(`${rowNo}행: ${grade}학년 ${classNo}반 ${number}번이 ${seen.get(k)}행과 중복됩니다.`);
    seen.set(k, rowNo);
    rows.push({ row: rowNo, grade, classNo, number, name });
  });
  return { rows, errors };
}

export function previewRoster(rows: RosterRow[], existing: Student[], level: SchoolLevel, year: number): RosterPreview {
  const pool = existing.filter((s) => s.schoolLevel === level && s.schoolYear === year);
  const add: RosterRow[] = [];
  const same: RosterPreview['same'] = [];
  const conflicts: RosterPreview['conflicts'] = [];
  for (const r of rows) {
    const atSeat = pool.filter((s) => s.grade === r.grade && s.classNo === r.classNo && s.number === r.number);
    const sameName = pool.filter((s) => s.name === r.name);
    const exact = atSeat.find((s) => s.name === r.name);
    if (exact) {
      same.push({ row: r, studentId: exact.id });
      continue;
    }
    if (atSeat.length) {
      conflicts.push({ row: r, reason: `같은 학년·반·번호에 다른 이름(${atSeat.map((s) => s.name).join(', ')})이 등록되어 있습니다.`, studentIds: atSeat.map((s) => s.id) });
      continue;
    }
    if (sameName.length) {
      conflicts.push({ row: r, reason: `같은 이름의 학생이 다른 학급·번호로 등록되어 있습니다(동명이인 또는 반·번호 변경).`, studentIds: sameName.map((s) => s.id) });
      continue;
    }
    add.push(r);
  }
  return { rows, errors: [], add, same, conflicts };
}
