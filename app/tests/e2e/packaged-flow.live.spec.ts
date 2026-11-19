import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { menu, saveKey, setupHomeroom, tab } from './helpers';

/**
 * 패키지된 앱 + 실제 AI 세 곳(Gemini API 키, Claude Code, Codex) 전체 흐름 시험(선택).
 * 가상의 학생 3명에게 제공자를 하나씩 맡겨 관찰 입력 → 후보 생성 → 조합 → 취합 → 최종 윤문 → 채택 → 검토 완료 →
 * 앱 다시 열기(저장 유지) → 작업별 출력 XLSX 저장까지 확인한다. Claude·ChatGPT는 이 PC의 실제 CLI 로그인을 그대로 쓴다(로그아웃하지 않음).
 * Gemini 키는 저장소 밖 개발용 .env의 GEMINI_API_KEY를 읽어 앱에 넣기만 하고 출력하지 않는다.
 * 실행: LIVE_FLOW=1 npx playwright test tests/e2e/packaged-flow.live.spec.ts  (LIVE_FLOW_OUT=결과 JSON 경로)
 */
const { productName } = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')).build as { productName: string };
const exe = path.resolve(__dirname, `../../release/win-unpacked/${productName}.exe`);
const envFile = path.resolve(__dirname, '../../../../.env');
const geminiKey = fs.existsSync(envFile) ? (fs.readFileSync(envFile, 'utf8').match(/^GEMINI_API_KEY=(.+)$/m)?.[1] ?? '').trim() : '';
test.skip(!process.env.LIVE_FLOW || !fs.existsSync(exe) || !geminiKey, 'LIVE_FLOW=1, 패키지, 개발용 .env의 GEMINI_API_KEY가 필요함');

const STUDENTS = [
  { name: '박지호', provider: 'anthropic', obs: ['박지호가 체육 시간 장비 정리 규칙을 지키며 공을 제자리에 두고 빠진 물품을 담당 교사에게 알림', '학급 행사 준비 회의에서 박지호가 말이 적은 친구에게 먼저 의견을 묻고 끝까지 들은 뒤 계획에 반영함'] },
  { name: '이도윤', provider: 'openai', obs: ['이도윤이 급식 줄서기 규칙을 지키고 새치기를 본 친구에게 순서를 차분히 설명함', '과학 실험 모둠에서 이도윤이 역할 분담을 두고 다툼이 생기자 각자 원하는 역할을 듣고 순서를 바꿔 맡자고 제안함'] },
  { name: '한서윤', provider: 'gemini', obs: ['한서윤이 학급 회의에서 정한 청소 당번 규칙을 스스로 확인하고, 당번을 잊은 친구에게 차분히 알려 줌', '모둠 토의에서 의견이 갈리자 한서윤이 두 의견을 칠판에 나눠 적고 공통점을 찾아 정리함'] },
] as const;
type Prov = (typeof STUDENTS)[number]['provider'];

interface Result { student: string; provider: Prov; model: string; candidates: string[]; finalText: string; chars: number; ms: { candidates: number; polish: number }; retries: number }

async function launch(userData: string) {
  const env = { ...process.env, MITGEUL_USER_DATA: userData } as Record<string, string>;
  for (const k of ['MITGEUL_CLI_CLAUDE', 'MITGEUL_CLI_CODEX', 'MITGEUL_FAKE_CLI_BASE', 'MITGEUL_FAKE_CLI_STATE', 'MITGEUL_NO_BROWSER', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME']) delete env[k];
  const app = await electron.launch({ executablePath: exe, env });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => void d.accept());
  await page.setViewportSize({ width: 1440, height: 920 });
  return { app, page, errors };
}

/** AI 요청 결과: 성공 문구 또는 오류 토스트 중 먼저 나온 쪽. 오류면 문구를 남기고 실패시킨다. */
async function waitAi(page: Page, ok: string, timeout: number) {
  const done = page.getByText(ok).or(page.locator('#alert-toast'));
  try {
    await expect(done.first()).toBeVisible({ timeout });
  } catch (e) {
    const shots = process.env.SHOTS_DIR;
    if (shots) await page.screenshot({ path: path.join(shots, `40-live-flow-stuck-${Date.now()}.png`) }).catch(() => {});
    const busy = await page.locator('#busy-toast').innerText().catch(() => '(대기 토스트 없음)');
    const banners = await page.locator('.banner').allInnerTexts().catch(() => []);
    console.log('stuck busy:', busy.replace(/\n+/g, ' | '));
    console.log('stuck banners:', banners.map((x) => x.replace(/\n+/g, ' ')).join(' || ').slice(0, 1500));
    throw e;
  }
  if (await page.locator('#alert-toast').count()) throw new Error(`AI 요청 실패: ${(await page.locator('#alert-toast').innerText()).replace(/\n+/g, ' | ')}`);
}

/** 교사처럼 요청하고, 제공자 혼잡(503·429·시간 초과)이면 오류 토스트를 닫고 30초 뒤 다시 누른다(최대 3번). 다시 시도한 횟수를 돌려준다. */
async function askAi(page: Page, button: string, ok: string, timeout: number): Promise<number> {
  for (let i = 0; ; i++) {
    await page.getByRole('button', { name: button }).click();
    try {
      await waitAi(page, ok, timeout);
      return i;
    } catch (e) {
      const msg = String((e as Error).message);
      if (i >= 3 || !/503|429|혼잡|한도|초 안에/.test(msg)) throw e;
      console.log(`  재시도 ${i + 1}: ${msg.slice(0, 120)}`);
      await page.locator('#alert-toast').getByRole('button', { name: '닫기' }).click();
      await page.waitForTimeout(30_000);
    }
  }
}

async function useProvider(page: Page, p: Prov) {
  await menu(page, /기본설정/);
  await tab(page, 'AI 연결');
  await page.locator('select').filter({ has: page.locator('option[value="anthropic"]') }).selectOption(p);
  if (p !== 'gemini') await expect(page.getByTestId('cli-status')).toContainText('로그인됨', { timeout: 30_000 });
  await expect(page.getByText(/연결 준비/)).toBeVisible({ timeout: 30_000 });
  // LIVE_FLOW_GEMINI_MODEL=lite면 Flash가 혼잡할 때 쓰는 가벼운 모델(이름이 -flash-lite로 끝나는 최신 모델)을 골라 저장한다
  if (p === 'gemini' && process.env.LIVE_FLOW_GEMINI_MODEL === 'lite') {
    await page.getByRole('button', { name: '모델 목록 불러오기' }).click();
    const slot = page.locator('.status-slot');
    await expect(slot).toContainText(/불러왔습니다|불러오지 못했습니다/, { timeout: 90_000 });
    console.log('gemini models:', (await slot.innerText()).replace(/\n+/g, ' | ').slice(0, 200));
    await expect(slot).toContainText('불러왔습니다');
    const sel = page.getByLabel('AI 모델');
    const lite = await sel.evaluate((el: HTMLSelectElement) => [...el.options].map((o) => o.value).filter((v) => /^gemini-[\d.]+-flash-lite$/.test(v)).sort().at(-1) ?? '');
    expect(lite).not.toBe('');
    await sel.selectOption(lite);
    await page.getByRole('button', { name: '모델 저장' }).click();
    await expect(page.getByText(`현재 저장: ${lite}`)).toBeVisible();
  }
}

async function writeOne(page: Page, s: (typeof STUDENTS)[number]): Promise<Result> {
  await useProvider(page, s.provider);
  await menu(page, /관찰 기록 및 초안 작성/);
  const stuSel = page.getByLabel('학생', { exact: true });
  const value = await stuSel.evaluate((el: HTMLSelectElement, name) => [...el.options].find((o) => o.text.includes(name))?.value ?? '', s.name);
  await stuSel.selectOption(value);
  await page.locator('.sel-grid').getByRole('button', { name: '행특' }).click();
  await expect(page.locator('.record-head h2')).toContainText(s.name);
  await tab(page, '관찰 기록');
  await page.getByLabel('규칙 준수 선택').check();
  await page.getByLabel('경청·의견 조율 선택').check();
  await page.locator('.rubric-item.on textarea').nth(0).fill(s.obs[0]);
  await page.locator('.rubric-item.on textarea').nth(1).fill(s.obs[1]);
  await page.getByRole('button', { name: '관찰 저장' }).click();
  await expect(page.getByText('관찰을 저장했습니다.')).toBeVisible();

  await tab(page, /AI 후보/);
  let t0 = Date.now();
  const candRetry = await askAi(page, '후보 생성 요청', '후보 저장 2개 항목', 300_000);
  const candMs = Date.now() - t0;
  const blocks = page.locator('.cand-block');
  await expect(blocks).toHaveCount(2);
  const model = (await blocks.first().locator('.cand-head .muted').first().innerText()).trim();
  const candidates = (await page.locator('.cand-block .cand-text').allInnerTexts()).map((x) => x.trim());
  console.log(`[${s.provider}] ${s.name} 후보 ${candidates.length}개 (${model}, ${(candMs / 1000).toFixed(1)}초)`);
  await blocks.nth(0).getByLabel('후보 1 선택').check();
  await blocks.nth(0).getByLabel('후보 2 선택').check();
  await blocks.nth(1).getByLabel('후보 1 선택').check();
  await page.getByRole('button', { name: '체크한 문장 일괄 추가' }).click();
  await expect(page.getByText('체크한 문장 3개를 항목별 조합에 추가했습니다.')).toBeVisible();

  await tab(page, /항목별 조합/);
  await page.locator('.obs-save').getByRole('button', { name: '항목 문장 취합' }).click();
  await expect(page.getByText('영역 초안을 만들었습니다.')).toBeVisible();
  await tab(page, '최종 윤문');
  await page.getByRole('button', { name: '300자' }).click();
  t0 = Date.now();
  const polishRetry = await askAi(page, '윤문 요청', '윤문 제안을 받았습니다', 300_000);
  // 분량이 범위를 벗어나면 앱이 이어서 보정 요청을 보낼 수 있다
  await expect(page.locator('#busy-toast')).toHaveCount(0, { timeout: 300_000 });
  if (await page.locator('#alert-toast').count()) throw new Error(`AI 요청 실패: ${await page.locator('#alert-toast').innerText()}`);
  const polishMs = Date.now() - t0;
  await page.getByRole('button', { name: '윤문 제안 채택' }).click();
  await expect(page.locator('.subtab.on')).toContainText('최종 본문');
  const final = page.locator('.card.final');
  const finalText = (await final.locator('textarea').first().inputValue()).trim();
  expect(finalText.length).toBeGreaterThan(80);
  await final.getByLabel(/관찰 근거와 사실을 확인/).check();
  await final.getByRole('button', { name: '검토 완료' }).click();
  await expect(page.getByRole('button', { name: '최종 본문 복사' })).toBeEnabled();
  console.log(`[${s.provider}] ${s.name} 최종 ${finalText.length}자 (윤문 ${(polishMs / 1000).toFixed(1)}초): ${finalText}`);
  return { student: s.name, provider: s.provider, model, candidates, finalText, chars: finalText.length, ms: { candidates: candMs, polish: polishMs }, retries: candRetry + polishRetry };
}

async function exportXlsx(app: ElectronApplication, page: Page, file: string) {
  await app.evaluate(({ dialog }, f) => {
    (dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: f });
  }, file);
  await menu(page, /작성 내용 확인 및 출력/);
  await tab(page, '작업별 출력');
  await page.locator('.content select').nth(1).selectOption('behavior');
  await expect(page.locator('table.table tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: 'XLSX 저장' }).click();
  await expect.poll(() => fs.existsSync(file), { timeout: 30_000 }).toBe(true);
}

test('실제 Gemini·Claude·ChatGPT로 학생 3명 행특 작성 → 저장 유지 → XLSX 출력', async () => {
  test.setTimeout(1_800_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sgb-live-flow-'));
  const xlsx = path.join(userData, '행특_출력.xlsx');
  const results: Result[] = [];
  let { app, page, errors } = await launch(userData);
  try {
    await setupHomeroom(page, 3, `번호\t이름\n${STUDENTS.map((s, i) => `${i + 1}\t${s.name}`).join('\n')}`);
    await saveKey(page, geminiKey);
    for (const s of STUDENTS) results.push(await writeOne(page, s));

    // 작성 현황: 세 명 모두 검토 완료
    await menu(page, /작성 내용 확인 및 출력/);
    await page.locator('.cell', { hasText: '행특 · 1학기' }).click();
    for (const s of STUDENTS) await expect(page.locator('.stu-row', { hasText: s.name })).toContainText('검토 완료');
    expect(errors).toEqual([]);
    await app.close();

    // 앱을 다시 열어도 최종 본문·검토 상태가 남아 있고, XLSX에 그대로 나간다
    ({ app, page, errors } = await launch(userData));
    await expect(page.locator('nav.menu')).toBeVisible({ timeout: 60_000 });
    await menu(page, /작성 내용 확인 및 출력/);
    await page.locator('.cell', { hasText: '행특 · 1학기' }).click();
    for (const s of STUDENTS) await expect(page.locator('.stu-row', { hasText: s.name })).toContainText(/검토 완료 · \d+자\(\d+Byte\)/);
    await exportXlsx(app, page, xlsx);
    const zip = await JSZip.loadAsync(fs.readFileSync(xlsx));
    const xml = (await Promise.all(Object.keys(zip.files).filter((f) => /sharedStrings|sheet\d*\.xml$/.test(f)).map((f) => zip.file(f)!.async('string')))).join('\n');
    const plain = xml.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    for (const r of results) {
      expect(plain).toContain(r.student);
      expect(plain).toContain(r.finalText.slice(0, 40));
    }
    console.log('xlsx', fs.statSync(xlsx).size, 'Byte, 학생 3명 최종 본문 포함');
    expect(errors).toEqual([]);
  } finally {
    if (process.env.LIVE_FLOW_OUT) fs.writeFileSync(process.env.LIVE_FLOW_OUT, JSON.stringify(results, null, 2), 'utf8');
    await app.close().catch(() => {});
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
