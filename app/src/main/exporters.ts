import XLSX from 'xlsx-js-style';
import { initSync, HwpDocument } from '@rhwp/core';
import type { ExportPlan, StudentExportPlan } from '../core/exportRows';

const border = { style: 'thin', color: { rgb: 'B7C1CC' } };
const borders = { top: border, bottom: border, left: border, right: border };

/** 공통 표: 머리 정보·머리글·데이터 행. wrapCol 열은 왼쪽 정렬·줄바꿈. */
interface Sheet {
  meta: { label: string; value: string }[];
  header: string[];
  rows: (string | number)[][];
  wrapCol: number;
  widths: number[];
  skipped: { name: string; reason: string }[];
}

function sheetXlsx(s: Sheet): Buffer {
  const wb = XLSX.utils.book_new();
  const metaRows = s.meta.map((m) => [m.label, m.value]);
  const ws = XLSX.utils.aoa_to_sheet([...metaRows, [], s.header, ...s.rows]);
  const headerRow = metaRows.length + 1;
  const range = XLSX.utils.decode_range(ws['!ref']!);
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const ref = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[ref];
      if (!cell) continue;
      if (typeof cell.v === 'string') {
        cell.t = 's';
        cell.z = '@';
      }
      if (R < metaRows.length) cell.s = { font: { bold: C === 0, name: '맑은 고딕', sz: 10 }, alignment: { vertical: 'center' } };
      else if (R === headerRow) cell.s = { font: { bold: true, name: '맑은 고딕', sz: 10, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '12304F' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: borders };
      else if (R > headerRow) cell.s = { font: { name: '맑은 고딕', sz: 10 }, alignment: { vertical: 'top', horizontal: C === s.wrapCol ? 'left' : 'center', wrapText: C === s.wrapCol }, border: borders };
    }
  }
  ws['!cols'] = s.widths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, '기록');
  const status = XLSX.utils.aoa_to_sheet([['구분', '건수'], ['검토 완료(출력)', s.rows.length], ['출력 제외', s.skipped.length], ...s.skipped.map((k) => [k.name, k.reason])]);
  status['!cols'] = [{ wch: 40 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, status, '출력 현황');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** 학생별 출력: 영역·작업·학기별 최종 본문 */
export function buildStudentXlsx(plan: StudentExportPlan): Buffer {
  return sheetXlsx({ meta: plan.meta, header: ['영역', '작업', '학기', '본문', 'Byte'], rows: plan.rows.map((r) => [r.area, r.work, r.semester, r.text, r.bytes]), wrapCol: 3, widths: [22, 22, 7, 90, 8], skipped: plan.skipped });
}

export function buildStudentHwpx(plan: StudentExportPlan): Buffer {
  return tableHwpx(plan.title, plan.meta, ['영역', '작업', '학기', '본문', 'Byte'], plan.rows.map((r) => [r.area, r.work, r.semester, r.text, String(r.bytes)]), [6500, 6500, 3000, 21500, 4000]);
}

/** XLSX: 초기 앱의 서식(열 너비·테두리·줄바꿈·머리글)을 이어 쓰되 검토 완료 데이터로 main에서 만든다. 모든 셀은 문자열·숫자 형식으로 명시한다. */
export function buildXlsx(plan: ExportPlan): Buffer {
  const wb = XLSX.utils.book_new();
  const metaRows = plan.meta.map((m) => [m.label, m.value]);
  const header = ['학년', '반', '번호', '이름', '본문', 'Byte'];
  const aoa: (string | number)[][] = [...metaRows, [], header, ...plan.rows.map((r) => [r.grade, r.classNo, r.number, r.name, r.text, r.bytes])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const headerRow = metaRows.length + 1;
  const range = XLSX.utils.decode_range(ws['!ref']!);
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const ref = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[ref];
      if (!cell) continue;
      if (typeof cell.v === 'string') {
        cell.t = 's';
        cell.z = '@';
      }
      if (R < metaRows.length) {
        cell.s = { font: { bold: C === 0, name: '맑은 고딕', sz: 10 }, alignment: { vertical: 'center' } };
      } else if (R === headerRow) {
        cell.s = { font: { bold: true, name: '맑은 고딕', sz: 10, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '12304F' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: borders };
      } else if (R > headerRow) {
        cell.s = { font: { name: '맑은 고딕', sz: 10 }, alignment: { vertical: 'top', horizontal: C === 4 ? 'left' : 'center', wrapText: C === 4 }, border: borders };
      }
    }
  }
  ws['!cols'] = [{ wch: 6 }, { wch: 5 }, { wch: 6 }, { wch: 10 }, { wch: 90 }, { wch: 8 }];
  XLSX.utils.book_append_sheet(wb, ws, '기록');
  const status = XLSX.utils.aoa_to_sheet([
    ['구분', '건수'],
    ['검토 완료(출력)', plan.rows.length],
    ['출력 제외', plan.skipped.length],
    ...plan.skipped.map((s) => [s.name, s.reason]),
  ]);
  status['!cols'] = [{ wch: 24 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, status, '출력 현황');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

let wasmReady = false;
export function initHwp(wasm: Buffer) {
  if (!wasmReady) {
    initSync({ module: wasm });
    wasmReady = true;
  }
}

function ok(json: string) {
  const r = JSON.parse(json);
  if (!r.ok) throw new Error(`HWPX 생성 실패: ${json.slice(0, 200)}`);
  return r;
}

/** HWPX: rhwp로 제목·구분 정보 문단과 학생별 표를 만든다. 셀 안 줄바꿈은 문단 분할로 넣는다. */
export function buildHwpx(plan: ExportPlan): Buffer {
  return tableHwpx(plan.title, plan.meta, ['반', '번호', '이름', '본문', 'Byte'], plan.rows.map((r) => [String(r.classNo), String(r.number), r.name, r.text, String(r.bytes)]), [3000, 3000, 6000, 25500, 4500]);
}

function tableHwpx(title: string, meta: { label: string; value: string }[], cols: string[], rows: string[][], colWidths: number[]): Buffer {
  if (!wasmReady) throw new Error('HWPX 모듈이 초기화되지 않았습니다.');
  const doc = HwpDocument.createEmpty();
  doc.createBlankDocument();
  const lines = [title, meta.map((m) => `${m.label}: ${m.value}`).join(' / ')];
  let para = 0;
  lines.forEach((line, i) => {
    if (i > 0) {
      ok(doc.splitParagraph(0, para, [...lines[i - 1]!].length));
      para++;
    }
    ok(doc.insertText(0, para, 0, line));
  });
  ok(doc.splitParagraph(0, para, [...lines[lines.length - 1]!].length));
  para++;
  const t = ok(doc.createTableEx(JSON.stringify({ sectionIdx: 0, paraIdx: para, charOffset: 0, rowCount: rows.length + 1, colCount: cols.length, treatAsChar: true, colWidths })));
  const tablePara: number = t.paraIdx ?? para;
  const ctrl: number = t.controlIdx ?? 0;
  const cellText = (cell: number, text: string) => {
    const parts = text.replace(/\r\n?/g, '\n').split('\n');
    let cp = 0;
    parts.forEach((line, i) => {
      if (i > 0) {
        ok(doc.splitParagraphInCell(0, tablePara, ctrl, cell, cp, [...parts[i - 1]!].length));
        cp++;
      }
      if (line) ok(doc.insertTextInCell(0, tablePara, ctrl, cell, cp, 0, line));
    });
  };
  [cols, ...rows].forEach((row, r) => row.forEach((v, c) => cellText(r * cols.length + c, v)));
  const out = doc.exportHwpxWithReport();
  const loss = JSON.parse(out.contentLoss());
  if (loss.count > 0) throw new Error(`HWPX 변환 중 손실이 보고되었습니다(${loss.count}건).`);
  return Buffer.from(out.takeBytes());
}

/** 학생 명단 일괄 입력 양식. 첫 줄 머리글(학년·반·번호·이름)과 가상 예시 3줄, 안내 시트. */
export function rosterSampleXlsx(grade: number): Buffer {
  const wb = XLSX.utils.book_new();
  const head = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '12304F' } }, alignment: { horizontal: 'center' } };
  const ws = XLSX.utils.aoa_to_sheet([
    ['학년', '반', '번호', '이름'],
    [grade, 1, 1, '가나다'],
    [grade, 1, 2, '라마바'],
    [grade, 2, 1, '사아자'],
  ]);
  for (const c of ['A1', 'B1', 'C1', 'D1']) (ws[c] as { s?: unknown }).s = head;
  ws['!cols'] = [{ wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, '명단');
  const guide = XLSX.utils.aoa_to_sheet([
    ['작성 안내'],
    ['1. [명단] 시트의 예시 3줄(가상 이름)을 지우고 학생을 한 줄에 한 명씩 입력합니다.'],
    ['2. 머리글(학년·반·번호·이름)은 지우지 마세요. 학년·반·번호는 숫자만 씁니다.'],
    ['3. 앱의 [학급 및 학생 명단 입력 > 학생 명단]에서 [명단 XLSX 업로드]로 올리면 미리 보기 후 반영됩니다.'],
    ['4. 학년·반에 맞는 학급이 없으면 자동으로 만듭니다. 동명이인·기존 학생과 겹치는 행은 자동 병합하지 않고 확인을 받습니다.'],
  ]);
  guide['!cols'] = [{ wch: 100 }];
  XLSX.utils.book_append_sheet(wb, guide, '안내');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
