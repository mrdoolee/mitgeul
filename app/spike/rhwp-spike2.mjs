import fs from 'node:fs';
import init, { HwpDocument } from '@rhwp/core';
await init({ module_or_path: fs.readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm') });
const doc = HwpDocument.createEmpty();
doc.createBlankDocument();
doc.insertText(0, 0, 0, '2026학년도 1학년 3반 행동특성 및 종합의견');
doc.splitParagraph(0, 0, '2026학년도 1학년 3반 행동특성 및 종합의견'.length);
doc.createTable(0, 1, 0, 2, 3);
function cellText(cell, text) {
  const lines = text.split('\n');
  let para = 0;
  lines.forEach((line, i) => {
    if (i > 0) { doc.splitParagraphInCell(0, 1, 0, cell, para, [...lines[i-1]].length); para++; }
    if (line) doc.insertTextInCell(0, 1, 0, cell, para, 0, line);
  });
}
['번호','이름','본문'].forEach((t,i)=>cellText(i,t));
cellText(3,'1'); cellText(4,'홍길동'); cellText(5,'(1학기) 규칙을 지키며 학급 활동에 참여함.\n(2학기) 친구의 의견을 경청하고 조율함.');
const out = doc.exportHwpxWithReport();
console.log(out.contentLoss());
fs.writeFileSync('spike/out/rhwp2.hwpx', out.takeBytes());
