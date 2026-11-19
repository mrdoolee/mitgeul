import fs from 'node:fs';
import JSZip from 'jszip';
import init, { HwpDocument } from '@rhwp/core';
await init({ module_or_path: fs.readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm') });
async function run(label, opts, resize) {
  const doc = HwpDocument.createEmpty();
  doc.createBlankDocument();
  const T = JSON.parse(doc.createTableEx(JSON.stringify({ sectionIdx: 0, paraIdx: 0, charOffset: 0, rowCount: 2, colCount: 3, ...opts })));
  if (resize) console.log(doc.resizeTableCells(0, T.paraIdx, T.controlIdx, JSON.stringify(resize)));
  const z = await JSZip.loadAsync(doc.exportHwpx());
  const sec = await z.file('Contents/section0.xml').async('string');
  console.log(label, [...sec.matchAll(/<hp:cellSz width="(\d+)"/g)].map(m=>m[1]).join(','), (sec.match(/<hp:sz width="\d+"[^>]*>/)||[''])[0]);
}
await run('plain', {});
await run('colWidths', { colWidths: [3000, 30000, 9000] });
await run('colWidths+treatAsChar', { colWidths: [3000, 30000, 9000], treatAsChar: true });
await run('resize', {}, [{ cellIdx: 0, widthDelta: -8000 }, { cellIdx: 1, widthDelta: 12000 }, { cellIdx: 2, widthDelta: -4000 }]);
