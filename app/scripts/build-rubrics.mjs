// Converts the confirmed rubric tables (2026-middle-rubric-v1) in the repository root
// into an app resource. Wording is copied verbatim; only table structure is parsed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// 원본 표(Markdown)는 저장소 밖에 있다. RUBRIC_SRC로 폴더를 지정하고, 없으면 저장소에 들어 있는 JSON을 그대로 쓴다.
const root = process.env.RUBRIC_SRC ? path.resolve(process.env.RUBRIC_SRC) : path.resolve(import.meta.dirname, '../../..');
const out = path.resolve(import.meta.dirname, '../resources/rubrics/2026-middle-rubric-v1.json');
const sources = [
  { area: 'behavior', file: '행특_관찰항목_재분류_초안.md' },
  { area: 'autonomy', file: '자율자치_관찰항목_초안.md' },
  { area: 'club', file: '동아리_관찰항목_초안.md' },
  { area: 'career', file: '진로_관찰항목_초안.md' },
  { area: 'subject', file: '과목세특_관찰항목_초안.md' },
];

function section(md, startHeading, endPrefix) {
  const lines = md.split(/\r?\n/);
  const s = lines.findIndex((l) => l.startsWith(startHeading));
  if (s < 0) throw new Error(`missing ${startHeading}`);
  let e = lines.findIndex((l, i) => i > s && l.startsWith(endPrefix));
  if (e < 0) e = lines.length;
  return lines.slice(s + 1, e);
}
function rows(lines) {
  return lines
    .filter((l) => l.startsWith('|') && !/^\|\s*-+/.test(l))
    .map((l) => l.slice(1, l.lastIndexOf('|')).split('|').map((c) => c.trim()));
}

const missing = sources.filter(({ file }) => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  if (!fs.existsSync(out)) throw new Error(`rubric sources not found in ${root}: ${missing.map((m) => m.file).join(', ')}`);
  console.log('rubric sources not found; keeping', path.relative(process.cwd(), out));
  process.exit(0);
}

const areas = {};
for (const { area, file } of sources) {
  const md = fs.readFileSync(path.join(root, file), 'utf8');
  const itemRows = rows(section(md, '## 확정 항목표', '## '));
  const header = itemRows.shift();
  if (header[0] !== '분류' || header[1] !== '세부 항목') throw new Error(`${file}: unexpected item header`);
  const levelLines = section(md, '## 항목별 점수 단계 의미', '## 점수 항목에서');
  const levelRows = rows(levelLines).filter((r) => r[0] !== '세부 항목');
  const levels = new Map(levelRows.map((r) => [r[0], r.slice(1, 6)]));
  const items = itemRows.map((r, i) => {
    const lv = levels.get(r[1]);
    if (!lv || lv.length !== 5 || lv.some((x) => !x)) throw new Error(`${file}: levels missing for ${r[1]}`);
    return { id: `${area}-${String(i + 1).padStart(2, '0')}`, category: r[0], name: r[1], lookFor: r[2], levels: lv };
  });
  if (levels.size !== items.length) throw new Error(`${file}: item/level count mismatch ${items.length}/${levels.size}`);
  areas[area] = { sourceFile: file, items };
}
const body = { version: '2026-middle-rubric-v1', scale: ['매우부족', '부족', '보통', '잘함', '매우잘함'], areas };
const json = JSON.stringify(body, null, 2);
fs.writeFileSync(out, json + '\n');
const counts = Object.fromEntries(Object.entries(areas).map(([k, v]) => [k, v.items.length]));
console.log('written', out, counts, crypto.createHash('sha256').update(json).digest('hex').slice(0, 12));
