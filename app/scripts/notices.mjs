// 앱 자체의 MIT 라이선스(저장소 루트 LICENCE.md)와 번들에 포함된 패키지·윤문 지침 출처의 라이선스 고지를 모은다. Electron/Chromium 고지는 electron-builder가 함께 배포한다.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkgs = JSON.parse(fs.readFileSync(path.join(root, 'dist/bundled-packages.json'), 'utf8'));
const out = [
  '밑글(MITGEUL) 생활기록부 초안 작성 도우미 — 오픈소스 고지',
  '',
  '='.repeat(78),
  '밑글(MITGEUL) 본체',
  '',
  fs.readFileSync(path.join(root, '..', 'LICENCE.md'), 'utf8').trim(),
  '',
  '이 앱은 아래 오픈소스 구성요소를 포함합니다. 각 구성요소의 라이선스 원문을 그대로 싣습니다.',
  '',
];
function licenseFiles(dir) {
  return fs.readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)/i.test(f)).map((f) => path.join(dir, f)).filter((f) => fs.statSync(f).isFile());
}
for (const name of pkgs) {
  const dir = path.join(root, 'node_modules', name);
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  out.push('='.repeat(78), `${pj.name} ${pj.version} — ${typeof pj.license === 'string' ? pj.license : JSON.stringify(pj.license)}`, pj.homepage ?? (typeof pj.repository === 'string' ? pj.repository : pj.repository?.url ?? ''), '');
  const files = licenseFiles(dir);
  if (!files.length) out.push(`(패키지에 라이선스 파일이 없어 package.json의 표기 "${pj.license}"를 따릅니다.)`);
  for (const f of files) out.push(fs.readFileSync(f, 'utf8').trim(), '');
  const nd = path.join(dir, 'notices');
  if (fs.existsSync(nd)) {
    // rhwp의 고지 폴더(글꼴·벤더 라이선스 포함)는 원본 그대로 resources/licenses/에 동봉하고 목록 문서만 본문에 싣는다.
    const dest = path.join(root, 'resources/licenses', name.replace('/', '__') + '-notices');
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(nd, dest, { recursive: true });
    const list = path.join(nd, 'THIRD_PARTY_LICENSES.md');
    if (fs.existsSync(list)) out.push(`--- ${name}/notices/THIRD_PARTY_LICENSES.md (전체 고지 폴더: resources/licenses/${path.basename(dest)}) ---`, fs.readFileSync(list, 'utf8').trim(), '');
  }
}
out.push('='.repeat(78), 'im-not-ai (https://github.com/epoko77-ai/im-not-ai) — MIT', '윤문 지침(resources/prompts/polish-style.md)은 이 프로젝트의 quick-rules 일부를 학교생활기록부 문체에 맞게 요약·재구성했습니다.', '', fs.readFileSync(path.join(root, 'resources/licenses/im-not-ai-LICENSE.txt'), 'utf8').trim(), '');
fs.writeFileSync(path.join(root, 'resources/THIRD_PARTY_NOTICES.txt'), out.join('\n'));
console.log('notices ok', pkgs.length + 1, 'components');
