import { _electron as electron, expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as { version: string; build: { productName: string } };
const { productName } = pkg.build;
const exe = path.resolve(__dirname, `../../release/win-unpacked/${productName}.exe`);
test.skip(!fs.existsSync(exe), '패키지가 없음');

test('패키지된 앱: 시작·설정·HWPX 모듈·고지 파일', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sgb-pkg-'));
  const app = await electron.launch({ executablePath: exe, env: { ...process.env, MITGEUL_USER_DATA: userData } });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await expect(page.getByText('처음 사용하시나요?')).toBeVisible({ timeout: 30000 });
  await page.locator('nav.menu').getByRole('button', { name: /교사 정보 설정/ }).click();
  await expect(page.getByRole('heading', { name: '담임 학급 설정' })).toBeVisible();
  const info = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion() }));
  expect(info.packaged).toBe(true);
  expect(info.version).toBe(pkg.version);
  const notices = path.join(path.dirname(exe), 'resources', 'app.asar.unpacked', 'resources', 'THIRD_PARTY_NOTICES.txt');
  expect(fs.existsSync(notices)).toBe(true);
  // renderer에서 외부 요청 차단 확인
  const blocked = await page.evaluate(async () => {
    try {
      await fetch('https://example.com');
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
  // 노드 API 비노출
  expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
  expect(await page.evaluate(() => Object.keys((window as any).sgb).length)).toBeGreaterThan(10);
  expect(errors.filter((e) => !e.includes('example.com') && !e.includes('Content Security Policy'))).toEqual([]);
  await app.close();
});
