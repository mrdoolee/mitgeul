import { _electron as electron, expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { menu, tab } from './helpers';

/**
 * 패키지된 앱 + 실제 Claude Code·Codex 로그인 시험(선택).
 * 이 PC의 실제 로그인을 건드리지 않도록 CLAUDE_CONFIG_DIR·CODEX_HOME을 빈 임시 폴더로 바꿔 실행한다. 실제 브라우저에 로그인 탭이 열린다.
 * - LIVE_LOGIN=1: 로그인 시작(브라우저 열기·로그인 주소), Claude 틀린 코드 거절(실제 Anthropic 응답), Codex 기기 코드 발급, 취소, 로그아웃.
 * - LIVE_LOGIN_COMPLETE=1을 더하면 교사가 브라우저에서 승인할 때까지(최대 8분씩) 기다려 로그인 완료 → 모델 테스트 → 로그아웃까지 확인한다.
 * - LIVE_LOGIN_ONLY=anthropic 또는 openai로 한쪽만 시험한다.
 * 실행: LIVE_LOGIN=1 npx playwright test tests/e2e/packaged-login.live.spec.ts
 */
const { productName } = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')).build as { productName: string };
const exe = path.resolve(__dirname, `../../release/win-unpacked/${productName}.exe`);
const COMPLETE = !!process.env.LIVE_LOGIN_COMPLETE;
const ONLY = process.env.LIVE_LOGIN_ONLY;
test.skip(!process.env.LIVE_LOGIN || !fs.existsSync(exe), 'LIVE_LOGIN=1과 패키지가 필요함');

/** [모델 테스트]를 누르고 성공·실패 어느 쪽이든 결과 문구를 남긴 뒤 성공인지 확인한다. */
async function modelTest(page: Page, label: string, timeout: number) {
  console.log(`${label} selects:`, await page.evaluate(() => [...document.querySelectorAll('select')].map((s) => `${s.value}[${s.options.length}]`).join(', ')));
  await page.getByRole('button', { name: '모델 테스트' }).click();
  const slot = page.locator('.status-slot');
  await expect(slot).toContainText(/정상 응답했습니다|사용할 수 없습니다/, { timeout });
  console.log(`${label} model test:`, (await slot.innerText()).replace(/\n+/g, ' | '));
  await expect(slot).toContainText('정상 응답했습니다');
}

test('패키지된 앱의 [Claude 로그인]·[ChatGPT 로그인]이 실제 CLI 로그인을 시작·취소·완료한다', async () => {
  test.setTimeout(COMPLETE ? 1_500_000 : 300_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sgb-live-login-'));
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgb-live-claude-'));
  const codexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgb-live-codex-'));
  const env = { ...process.env, MITGEUL_USER_DATA: userData, CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: codexDir } as Record<string, string>;
  for (const k of ['MITGEUL_CLI_CLAUDE', 'MITGEUL_CLI_CODEX', 'MITGEUL_FAKE_CLI_BASE', 'MITGEUL_FAKE_CLI_STATE', 'MITGEUL_NO_BROWSER']) delete env[k];
  const app = await electron.launch({ executablePath: exe, env });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => void d.accept());
  const shots = process.env.SHOTS_DIR;
  try {
    await expect(page.getByText('처음 사용하시나요?')).toBeVisible({ timeout: 60_000 });
    await menu(page, /기본설정/);
    await tab(page, 'AI 연결');
    const panel = page.getByTestId('login-panel');

    // ── Claude Code
    if (ONLY !== 'openai') {
      await page.locator('select').filter({ has: page.locator('option[value="anthropic"]') }).selectOption('anthropic');
      await expect(page.getByTestId('cli-status')).toContainText('로그인되어 있지 않습니다', { timeout: 30_000 });
      await page.getByRole('button', { name: 'Claude 로그인' }).click();
      await expect(panel.getByRole('button', { name: '로그인 화면 다시 열기' })).toBeVisible({ timeout: 30_000 });
      if (shots) await page.screenshot({ path: path.join(shots, '30-live-claude-login.png') });
      await panel.getByLabel('Claude 로그인 코드').fill('mitgeul-test-invalid#code');
      await panel.getByRole('button', { name: '코드 넣기' }).click();
      await expect(panel).toContainText(/코드가 받아들여지지 않았습니다|로그인이 끝나지 않았습니다/, { timeout: 60_000 });
      console.log('claude wrong code:', (await panel.innerText()).replace(/\n+/g, ' | '));
      await expect(page.getByTestId('cli-status')).toContainText('로그인되어 있지 않습니다');
      if (COMPLETE) {
        await panel.getByRole('button', { name: '다시 로그인' }).click();
        console.log('>>> 브라우저의 Claude 로그인 화면에서 승인하세요(최대 8분)');
        await expect(page.getByText('Claude 구독 계정으로 로그인했습니다.')).toBeVisible({ timeout: 480_000 });
        await expect(page.getByTestId('cli-status')).toContainText('로그인됨');
        await modelTest(page, 'claude', 120_000);
        await page.getByRole('button', { name: '로그아웃' }).click();
        await expect(page.getByText('Claude 로그아웃했습니다.')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('cli-status')).toContainText('로그인되어 있지 않습니다');
      }
    }

    // ── Codex
    if (ONLY !== 'anthropic') {
      await page.locator('select').filter({ has: page.locator('option[value="openai"]') }).selectOption('openai');
      await expect(page.getByTestId('cli-status')).toContainText('로그인되어 있지 않습니다', { timeout: 30_000 });
      await page.getByRole('button', { name: 'ChatGPT 로그인' }).click();
      await expect(panel.getByRole('button', { name: '로그인 화면 다시 열기' })).toBeVisible({ timeout: 30_000 });
      await panel.getByRole('button', { name: '코드로 로그인' }).click();
      await expect(panel.getByTestId('device-code')).toHaveText(/^[A-Z0-9]{3,10}-[A-Z0-9]{3,10}$/, { timeout: 30_000 });
      await expect(panel).toContainText('주소: https://auth.openai.com/');
      if (shots) await page.screenshot({ path: path.join(shots, '31-live-codex-device.png') });
      console.log('codex device:', (await panel.innerText()).replace(/\n+/g, ' | '));
      await panel.getByRole('button', { name: '취소' }).click();
      await expect(panel).toContainText('로그인을 취소했습니다.');
      if (COMPLETE) {
        await panel.getByRole('button', { name: '다시 로그인' }).click();
        console.log('>>> 브라우저의 ChatGPT 로그인 화면에서 승인하세요(최대 8분)');
        await expect(page.getByText('ChatGPT 계정으로 로그인했습니다.')).toBeVisible({ timeout: 480_000 });
        await expect(page.getByTestId('cli-status')).toContainText('로그인됨');
        console.log('codex login: 완료');
        await modelTest(page, 'codex', 200_000);
        await page.getByRole('button', { name: '로그아웃' }).click();
        await expect(page.getByText('ChatGPT 로그아웃했습니다.')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('cli-status')).toContainText('로그인되어 있지 않습니다');
      }
    }
    expect(errors).toEqual([]);
  } catch (e) {
    if (shots) await page.screenshot({ path: path.join(shots, '39-live-login-fail.png') }).catch(() => {});
    console.log('fail status:', (await page.locator('.status-slot').innerText().catch(() => '?')).replace(/\n+/g, ' | '));
    // 실패해도 임시 폴더의 로그인은 지운다(아래 rmSync). 남은 로그인 프로세스가 없도록 앱을 닫는다.
    throw e;
  } finally {
    await app.close();
    for (const d of [claudeDir, codexDir, userData]) fs.rmSync(d, { recursive: true, force: true });
  }
});
