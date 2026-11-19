import JSZip from 'jszip';

/**
 * 명단 XLSX 읽기 전용 최소 파서. 외부에서 받은 파일을 읽으므로 알려진 취약점이 있는 SheetJS 0.18 읽기 경로 대신
 * ZIP 안의 첫 시트 XML에서 셀 값만 꺼낸다(수식·서식·매크로 무시). 크기·행·열을 제한한다.
 */
const MAX_UNCOMPRESSED = 20 * 1024 * 1024;
const MAX_ROWS = 5000;
const MAX_COLS = 60;

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

function texts(xml: string): string {
  return [...xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => decode(m[1]!)).join('');
}

function colIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function entry(zip: JSZip, name: string): Promise<string | null> {
  const f = zip.file(name);
  if (!f) return null;
  const size = (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
  if (size > MAX_UNCOMPRESSED) throw new Error('XLSX 파일이 너무 큽니다.');
  return f.async('string');
}

export async function readXlsxFirstSheet(buf: Buffer): Promise<string[][]> {
  if (buf.length > MAX_UNCOMPRESSED) throw new Error('XLSX 파일이 너무 큽니다.');
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new Error('XLSX 형식이 아닙니다. 엑셀에서 "Excel 통합 문서(*.xlsx)"로 저장해 주세요.');
  }
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = await entry(zip, 'xl/workbook.xml');
  const rels = await entry(zip, 'xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const rid = wb.match(/<(?:\w+:)?sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
    const target = rid ? rels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1] : undefined;
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheet = await entry(zip, sheetPath);
  if (!sheet) throw new Error('첫 시트를 찾을 수 없습니다.');
  const sstXml = (await entry(zip, 'xl/sharedStrings.xml')) ?? '';
  const shared = [...sstXml.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => texts(m[1]!));
  const out: string[][] = [];
  for (const rm of sheet.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const rAttr = rm[1]!.match(/\br="(\d+)"/)?.[1];
    const rowIdx = rAttr ? Number(rAttr) - 1 : out.length;
    if (rowIdx >= MAX_ROWS) break;
    const row: string[] = [];
    for (const cm of rm[2]!.matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const attrs = cm[1]!;
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const ci = ref ? colIndex(ref) : row.length;
      if (ci >= MAX_COLS) continue;
      const t = attrs.match(/\bt="(\w+)"/)?.[1];
      const inner = cm[2] ?? '';
      const v = inner.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
      let val = '';
      if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = texts(inner);
      else if (v !== undefined) val = decode(v);
      row[ci] = val.trim();
    }
    out[rowIdx] = Array.from(row, (x) => x ?? '');
  }
  return Array.from(out, (r) => r ?? []);
}
