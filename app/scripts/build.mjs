// esbuild 번들: main·preload(CJS, node), renderer(IIFE, browser). 런타임 의존성은 번들에 포함한다.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--dev');
fs.rmSync(dist, { recursive: true, force: true });

// .md는 문자열로 넣는다(개인정보처리방침 PRIVACY.md).
const common = { loader: { '.md': 'text' }, bundle: true, sourcemap: watch ? 'inline' : false, minify: !watch, legalComments: 'eof', logLevel: 'warning', target: 'es2023' };
const mainResult = await build({ ...common, metafile: true, entryPoints: [path.join(root, 'src/main/main.ts')], outfile: path.join(dist, 'main/main.js'), platform: 'node', format: 'cjs', external: ['electron'] });
await build({ ...common, entryPoints: [path.join(root, 'src/preload/preload.ts')], outfile: path.join(dist, 'preload/preload.js'), platform: 'node', format: 'cjs', external: ['electron'] });
const rendererResult = await build({ ...common, metafile: true, entryPoints: [path.join(root, 'src/renderer/app.ts')], outfile: path.join(dist, 'renderer/app.js'), platform: 'browser', format: 'iife' });
// 번들에 들어간 외부 패키지 목록(라이선스 고지용)
const pkgs = new Set();
for (const r of [mainResult, rendererResult]) {
  for (const f of Object.keys(r.metafile.inputs)) {
    const m = f.split(path.sep).join('/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
    if (m) pkgs.add(m[1]);
  }
}
fs.writeFileSync(path.join(root, 'dist/bundled-packages.json'), JSON.stringify([...pkgs].sort(), null, 2));
for (const f of ['index.html', 'styles.css', 'logo.png']) fs.copyFileSync(path.join(root, 'src/renderer', f), path.join(dist, 'renderer', f));

// rhwp WASM은 resources/wasm에 복사(앱 자산)
fs.mkdirSync(path.join(root, 'resources/wasm'), { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules/@rhwp/core/rhwp_bg.wasm'), path.join(root, 'resources/wasm/rhwp_bg.wasm'));
console.log('build ok');
