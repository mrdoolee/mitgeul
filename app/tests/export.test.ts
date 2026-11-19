import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import XLSX from 'xlsx-js-style';
import { planExport } from '../src/core/exportRows';
import { buildHwpx, buildXlsx, initHwp } from '../src/main/exporters';
import { readXlsxFirstSheet } from '../src/main/xlsxRead';
import { baseData, markReviewed, rec } from './fixtures';

function samplePlan() {
  const d = baseData();
  const a = rec(d, 'r1', 's1', 'w-home', 'behavior', 1, '(1학기) 규칙을 지키며 =SUM(A1) 같은 수식처럼 보이는 문자열도 텍스트로 둠.');
  markReviewed(d, a);
  const b = rec(d, 'r2', 's2', 'w-home', 'behavior', 1, '첫 줄.\n둘째 줄에서 친구의 의견을 경청함.');
  markReviewed(d, b);
  return planExport(d, 'w-home', 'behavior', [1]);
}

describe('출력 파일', () => {
  it('XLSX: 검토 완료 행·Byte·문자열 셀', () => {
    const plan = samplePlan();
    expect(plan.rows.length).toBe(2);
    const buf = buildXlsx(plan);
    const wb = XLSX.read(buf, { type: 'buffer' });
    const ws = wb.Sheets['기록']!;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
    const body = rows.find((r) => String(r[3]) === '김민준')!;
    expect(String(body[4])).toBe('(1학기) 규칙을 지키며 =SUM(A1) 같은 수식처럼 보이는 문자열도 텍스트로 둠.');
    expect(Object.values(ws).some((c: any) => c && c.f)).toBe(false);
    expect(wb.SheetNames).toContain('출력 현황');
  });
  it('명단 XLSX 읽기(자체 파서): 공유 문자열·숫자·빈 칸·첫 시트', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['학년', '반', '번호', '이름'], [1, 3, 1, '김민준'], [1, 3, 2, 'A&B <test>'], [], [1, 4, 10, '박하늘']]), '명단');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['다른 시트']]), '기타');
    const t = await readXlsxFirstSheet(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer);
    expect(t[0]).toEqual(['학년', '반', '번호', '이름']);
    expect(t[1]).toEqual(['1', '3', '1', '김민준']);
    expect(t[2]![3]).toBe('A&B <test>');
    expect(t[4]).toEqual(['1', '4', '10', '박하늘']);
    await expect(readXlsxFirstSheet(Buffer.from('not a zip'))).rejects.toThrow('XLSX');
  });
  it('HWPX: 유효한 ZIP, 본문·줄바꿈 문단 포함', async () => {
    initHwp(fs.readFileSync(path.resolve(__dirname, '../node_modules/@rhwp/core/rhwp_bg.wasm')));
    const plan = samplePlan();
    const buf = buildHwpx(plan);
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files);
    expect(names.some((n) => /section0\.xml$/i.test(n))).toBe(true);
    const sec = await zip.file(names.find((n) => /section0\.xml$/i.test(n))!)!.async('string');
    expect(sec).toContain('둘째 줄에서 친구의 의견을 경청함.');
    expect(sec).toContain('김민준');
    if (process.env.HWPX_OUT) fs.writeFileSync(process.env.HWPX_OUT, buf);
  });
});

import { rosterSampleXlsx } from '../src/main/exporters';
import { parseRosterTable } from '../src/core/roster';
describe('명단 양식 XLSX', () => {
  it('앱의 명단 읽기 경로로 다시 읽힌다(머리글·예시 3줄)', async () => {
    const table = await readXlsxFirstSheet(rosterSampleXlsx(2));
    expect(table[0]).toEqual(['학년', '반', '번호', '이름']);
    const parsed = parseRosterTable(table, {});
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.map((r) => `${r.grade}-${r.classNo}-${r.number}`)).toEqual(['2-1-1', '2-1-2', '2-2-1']);
  });
});
