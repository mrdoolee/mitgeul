import { _electron as electron, expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { menu, tab } from './helpers';

/**
 * 패키지된 앱 + 실제 구독 CLI 시험(선택). 이 PC에 Claude Code·Codex가 설치·로그인되어 있어야 한다.
 * 학생 자료 없이 상태 확인과 모델 연결 시험 문장만 보낸다. 실행: LIVE_CLI=1 npx playwright test tests/e2e/packaged-cli.live.spec.ts
 */
const { productName } = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')).build as { productName: string };
const exe = path.resolve(__dirname, `../../release/win-unpacked/${productName}.exe`);
test.skip(!process.env.LIVE_CLI || !fs.existsSync(exe), 'LIVE_CLI=1과 패키지가 필요함');

test('패키지된 앱이 PATH의 실제 Claude Code·Codex CLI를 찾아 상태 확인·모델 테스트를 한다', async () => {
  test.setTimeout(420_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sgb-cli-'));
  const env = { ...process.env, MITGEUL_USER_DATA: userData } as Record<string, string>;
  for (const k of ['MITGEUL_CLI_CLAUDE', 'MITGEUL_CLI_CODEX', 'MITGEUL_FAKE_CLI_BASE']) delete env[k];
  const app = await electron.launch({ executablePath: exe, env });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await expect(page.getByText('처음 사용하시나요?')).toBeVisible({ timeout: 60_000 });
  await menu(page, /기본설정/);
  await tab(page, 'AI 연결');
  // 기본 제공자는 Gemini(API 키)라 Claude로 바꾼다
  await page.locator('select').filter({ has: page.locator('option[value="anthropic"]') }).selectOption('anthropic');
  await expect(page.getByTestId('cli-status')).toContainText('로그인됨', { timeout: 30_000 });
  await page.getByRole('button', { name: '모델 테스트' }).click();
  await expect(page.getByText(/claude-sonnet-5-5 \(자동 선택\) 모델이 정상 응답했습니다/)).toBeVisible({ timeout: 120_000 });
  console.log('claude', await page.locator('.status-slot').innerText());
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'ChatGPT' }) }).selectOption('openai');
  await expect(page.getByTestId('cli-status')).toContainText('로그인됨', { timeout: 30_000 });
  await page.getByRole('button', { name: '모델 목록 불러오기' }).click();
  await expect(page.getByText(/사용 가능한 모델 \d+개를 불러왔습니다/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: '모델 테스트' }).click();
  // 성공 또는 오류 배너가 뜰 때까지 기다리고, 실패하면 오류 문구를 그대로 남긴다
  await expect(page.locator('.status-slot .banner, .status-slot [class*=banner]').filter({ hasText: /정상 응답했습니다|사용할 수 없습니다/ })).toBeVisible({ timeout: 150_000 });
  console.log('codex status:', await page.locator('.status-slot').innerText());
  await expect(page.getByText(/모델이 정상 응답했습니다/)).toBeVisible();
  console.log('codex', await page.locator('.status-slot').innerText());
  expect(errors).toEqual([]);
  await app.close();
});
