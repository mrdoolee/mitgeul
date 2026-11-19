import { expect, type Page } from '@playwright/test';
import path from 'node:path';

/** 사이드바 단계 메뉴 */
export async function menu(page: Page, name: RegExp) {
  await page.locator('nav.menu').getByRole('button', { name }).click();
}

/** 상단 sticky 서브 메뉴 탭 */
export async function tab(page: Page, name: string | RegExp) {
  await page.locator('nav.subtabs').getByRole('tab', { name }).click();
}

/** 첫 실행 → 메뉴2 명단 일괄 입력(붙여 넣기, 학급 자동 생성) → 메뉴3 담임 작업 켜기. 학생 추가는 메뉴2에서만 한다. */
export async function setupHomeroom(page: Page, classNo: number, tsv: string) {
  await expect(page.getByText('처음 사용하시나요?')).toBeVisible({ timeout: 30000 });
  await menu(page, /학급 및 학생 명단 입력/);
  await tab(page, '명단 일괄 입력');
  const [head, ...rows] = tsv.trim().split('\n');
  const full = [`학년\t반\t${head}`, ...rows.map((r) => `1\t${classNo}\t${r}`)].join('\n');
  await page.getByRole('button', { name: '엑셀에서 붙여 넣기' }).click();
  await page.locator('.modal-back textarea').fill(full);
  await page.getByRole('button', { name: '붙여 넣은 명단 미리 보기' }).click();
  await page.getByRole('button', { name: '가져오기 적용' }).click();
  await expect(page.getByText(/학생 \d+명을 반영했습니다/)).toBeVisible();
  await menu(page, /교사 정보 설정/);
  await page.getByRole('button', { name: '담임 작업 켜기' }).click();
  await expect(page.getByText('담임 작업을 켰습니다.')).toBeVisible();
}

/** 시험 전용 가짜 CLI(tests/fake-cli.mjs)를 Claude Code·Codex 자리에 넣는 실행 환경 */
export function fakeCliEnv(base: string): Record<string, string> {
  const fake = path.resolve(__dirname, '..', 'fake-cli.mjs');
  return { MITGEUL_CLI_CLAUDE: fake, MITGEUL_CLI_CODEX: fake, MITGEUL_FAKE_CLI_BASE: base };
}

/** Gemini는 API 키를 저장한다. */
export async function saveKey(page: Page, key: string) {
  await menu(page, /기본설정/);
  await tab(page, 'AI 연결');
  await page.getByPlaceholder('API 키 입력').fill(key);
  await page.getByRole('button', { name: '저장', exact: true }).first().click();
  await expect(page.getByText('Google Gemini (API 키) 연결 준비')).toBeVisible();
}

/** 제공자를 Claude로 바꾸고 구독 CLI 상태를 확인한다(가짜 CLI는 로그인된 상태로 답한다). */
export async function connectCli(page: Page) {
  await menu(page, /기본설정/);
  await tab(page, 'AI 연결');
  await page.locator('select').filter({ has: page.locator('option[value="anthropic"]') }).selectOption('anthropic');
  await expect(page.getByTestId('cli-status')).toBeVisible();
  await page.getByRole('button', { name: '상태 다시 확인' }).click();
  await expect(page.getByTestId('cli-status')).toContainText('로그인됨');
  await expect(page.getByText('Claude (Claude Code 구독) 연결 준비')).toBeVisible();
}
