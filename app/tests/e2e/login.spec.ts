import { _electron as electron, expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { menu, tab } from './helpers';

/**
 * 앱 버튼 로그인: 가짜 CLI(tests/fake-cli.mjs)로 기본설정 > AI 연결의 [Claude 로그인]·[ChatGPT 로그인]·[로그아웃]을 확인한다.
 * 브라우저는 열지 않고(MITGEUL_NO_BROWSER) 열려던 주소만 기록한다.
 */
const SHOTS = process.env.SHOTS_DIR;

test('Claude 코드 붙여 넣기 로그인, ChatGPT 브라우저·코드 로그인, 로그아웃', async () => {
  test.setTimeout(120_000);
  const fake = path.resolve(__dirname, '..', 'fake-cli.mjs');
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'sgb-login-state-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sgb-login-'));
  const app = await electron.launch({
    args: [path.resolve(__dirname, '../../dist/main/main.js')],
    env: { ...process.env, MITGEUL_USER_DATA: userData, MITGEUL_CLI_CLAUDE: fake, MITGEUL_CLI_CODEX: fake, MITGEUL_FAKE_CLI_STATE: state, MITGEUL_NO_BROWSER: '1' },
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => void d.accept());
  await page.setViewportSize({ width: 1440, height: 920 });
  await expect(page.getByText('처음 사용하시나요?')).toBeVisible({ timeout: 30_000 });
  await menu(page, /기본설정/);
  await tab(page, 'AI 연결');

  // ── Claude: 로그아웃 상태 → [Claude 로그인] → 틀린 코드 → 다시 → 맞는 코드 → 로그인됨 → 로그아웃
  await page.locator('select').filter({ has: page.locator('option[value="anthropic"]') }).selectOption('anthropic');
  await expect(page.getByTestId('cli-status')).toContainText('로그인되어 있지 않습니다');
  await expect(page.getByText('위의 [Claude 로그인]을 누르세요.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Claude 로그인' }).click();
  const panel = page.getByTestId('login-panel');
  await expect(panel).toContainText('브라우저에서 Claude 로그인을 마치세요');
  await expect(panel.getByRole('button', { name: '로그인 화면 다시 열기' })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '20-claude-login.png') });
  await panel.getByLabel('Claude 로그인 코드').fill('wrong#code');
  await panel.getByRole('button', { name: '코드 넣기' }).click();
  await expect(panel).toContainText('코드가 받아들여지지 않았습니다');
  await expect(page.getByTestId('cli-status')).toContainText('로그인되어 있지 않습니다');
  await panel.getByRole('button', { name: '다시 로그인' }).click();
  await expect(panel.getByLabel('Claude 로그인 코드')).toBeEnabled();
  await panel.getByLabel('Claude 로그인 코드').fill('good-code#state');
  await panel.getByLabel('Claude 로그인 코드').press('Enter');
  await expect(panel).toContainText('Claude 구독 계정으로 로그인했습니다.');
  await expect(page.getByTestId('cli-status')).toContainText('로그인됨');
  await expect(page.getByText('Claude (Claude Code 구독) 연결 준비')).toBeVisible();
  await page.getByRole('button', { name: '모델 목록 불러오기' }).click();
  await expect(page.getByText('사용 가능한 모델 4개를 불러왔습니다')).toBeVisible();
  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page.getByText('Claude 로그아웃했습니다.')).toBeVisible();
  await expect(page.getByTestId('cli-status')).toContainText('로그인되어 있지 않습니다');
  await expect(page.getByRole('button', { name: 'Claude 로그인' })).toBeVisible();

  // ── ChatGPT: [ChatGPT 로그인]은 Codex 앱 서버가 준 주소를 브라우저로 연다 → [코드로 로그인] → 취소 → 승인 흉내로 완료 → 로그아웃
  await page.locator('select').filter({ has: page.locator('option[value="openai"]') }).selectOption('openai');
  await expect(page.getByTestId('cli-status')).toContainText('로그인되어 있지 않습니다');
  await page.getByRole('button', { name: 'ChatGPT 로그인' }).click();
  await expect(panel).toContainText('브라우저에서 ChatGPT 로그인을 마치세요');
  await expect.poll(() => app.evaluate(() => (globalThis as any).__mitgeulOpenedLoginUrls as string[])).toEqual(['https://auth.openai.com/oauth/authorize?fake=1']);
  await panel.getByRole('button', { name: '코드로 로그인' }).click();
  await expect(panel.getByTestId('device-code')).toHaveText('FAKE-1234');
  await expect(panel).toContainText('주소: https://auth.openai.com/codex/device');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '21-chatgpt-device.png') });
  await panel.getByRole('button', { name: '코드 입력 화면 열기' }).click();
  await expect.poll(() => app.evaluate(() => ((globalThis as any).__mitgeulOpenedLoginUrls as string[]).at(-1))).toBe('https://auth.openai.com/codex/device');
  await panel.getByRole('button', { name: '취소' }).click();
  await expect(panel).toContainText('로그인을 취소했습니다.');
  fs.writeFileSync(path.join(state, 'auto'), '1');
  await panel.getByRole('button', { name: '다시 로그인' }).click();
  await expect(page.getByText('ChatGPT 계정으로 로그인했습니다.')).toBeVisible();
  await expect(page.getByTestId('cli-status')).toContainText('로그인됨 (ChatGPT 계정)');
  await expect(page.getByRole('button', { name: '로그아웃' })).toBeVisible();
  await page.getByRole('button', { name: '로그아웃' }).click();
  await expect(page.getByText('ChatGPT 로그아웃했습니다.')).toBeVisible();
  await expect(page.getByTestId('cli-status')).toContainText('로그인되어 있지 않습니다');

  // 안내 창: 앱 로그인 순서를 안내한다
  await page.getByRole('button', { name: '설치·로그인 안내' }).click();
  await expect(page.locator('.key-guide')).toContainText('[ChatGPT 로그인]을 누르면');
  await page.getByRole('button', { name: '닫기' }).click();

  expect(errors).toEqual([]);
  await app.close();
  fs.rmSync(state, { recursive: true, force: true });
});
