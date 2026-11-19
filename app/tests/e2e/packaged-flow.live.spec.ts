import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { menu, saveKey, setupHomeroom, tab } from './helpers';

/**
 * 패키지된 앱 + 실제 AI 세 곳(Gemini API 키, Claude Code, Codex) 전체 흐름 시험(선택).
 * 가상의 학생 3명에게 제공자를 하나씩 맡겨 관찰 입력 → 후보 생성 → 조합 → 취합 → 최종 윤문 → 채택 → 검토 완료 →
 * 앱 다시 열기(저장 유지) → 작업별 출력 XLSX·HWPX 저장 → 이동용·자동 백업 만들기 → 새 PC(빈 자료)에서 백업 복원까지 확인한다. Claude·ChatGPT는 이 PC의 실제 CLI 로그인을 그대로 쓴다(로그아웃하지 않음).
 * Gemini 키는 저장소 밖 개발용 .env의 GEMINI_API_KEY를 읽어 앱에 넣기만 하고 출력하지 않는다.
 * 실행: LIVE_FLOW=1 npx playwright test tests/e2e/packaged-flow.live.spec.ts  (LIVE_FLOW_OUT=결과 JSON 경로)
 */
const { productName } = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')).build as { productName: string };
const exe = path.resolve(__dirname, `../../release/win-unpacked/${productName}.exe`);
// 개발용 키 파일: MITGEUL_ENV_FILE 또는 저장소 루트의 .env(저장소에는 올리지 않음)
const envFile = process.env.MITGEUL_ENV_FILE ? path.resolve(process.env.MITGEUL_ENV_FILE) : path.resolve(__dirname, '../../../.env');
const geminiKey = fs.existsSync(envFile) ? (fs.readFileSync(envFile, 'utf8').match(/^GEMINI_API_KEY=(.+)$/m)?.[1] ?? '').trim() : '';
test.skip(!process.env.LIVE_FLOW || !fs.existsSync(exe) || !geminiKey, 'LIVE_FLOW=1, 패키지, 개발용 .env의 GEMINI_API_KEY가 필요함');

const STUDENTS = [
  { name: '박지호', provider: 'anthropic', obs: ['박지호가 체육 시간 장비 정리 규칙을 지키며 공을 제자리에 두고 빠진 물품을 담당 교사에게 알림', '학급 행사 준비 회의에서 박지호가 말이 적은 친구에게 먼저 의견을 묻고 끝까지 들은 뒤 계획에 반영함'] },
  { name: '이도윤', provider: 'openai', obs: ['이도윤이 급식 줄서기 규칙을 지키고 새치기를 본 친구에게 순서를 차분히 설명함', '과학 실험 모둠에서 이도윤이 역할 분담을 두고 다툼이 생기자 각자 원하는 역할을 듣고 순서를 바꿔 맡자고 제안함'] },
  { name: '한서윤', provider: 'gemini', obs: ['한서윤이 학급 회의에서 정한 청소 당번 규칙을 스스로 확인하고, 당번을 잊은 친구에게 차분히 알려 줌', '모둠 토의에서 의견이 갈리자 한서윤이 두 의견을 칠판에 나눠 적고 공통점을 찾아 정리함'] },
] as const;
type Prov = (typeof STUDENTS)[number]['provider'];
const BACKUP_PW = 'mitgeul-backup-test-2026';

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
  // 이전 제공자의 "연결 준비"에 걸리지 않게 고른 제공자 이름까지 확인한다
  const label = { gemini: 'Google Gemini (API 키)', openai: 'ChatGPT (Codex CLI 구독)', anthropic: 'Claude (Claude Code 구독)' }[p];
  await expect(page.locator('.conn-pill')).toHaveText(`${label} 연결 준비`, { timeout: 30_000 });
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
  // 영역을 먼저 고르고 화면이 다시 그려진 뒤 학생을 고른다(연달아 누르면 앞 화면 갱신과 겹친다)
  await page.locator('.sel-grid').getByRole('button', { name: '행특' }).click();
  await expect(page.locator('.sel-grid').getByRole('button', { name: '행특' })).toHaveClass(/\bon\b/);
  await expect(page.locator('.record-head h2')).toBeVisible();
  const stuSel = page.getByLabel('학생', { exact: true });
  const value = await stuSel.evaluate((el: HTMLSelectElement, name) => [...el.options].find((o) => o.text.includes(name))?.value ?? '', s.name);
  await stuSel.selectOption(value);
  await expect(page.locator('.record-head h2')).toContainText(s.name, { timeout: 15_000 });
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

async function exportFile(app: ElectronApplication, page: Page, file: string, format: 'XLSX' | 'HWPX') {
  await app.evaluate(({ dialog }, f) => {
    (dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: f });
  }, file);
  await menu(page, /작성 내용 확인 및 출력/);
  await tab(page, '작업별 출력');
  await page.locator('.content select').nth(1).selectOption('behavior');
  await expect(page.locator('table.table tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: `${format} 저장` }).click();
  await expect.poll(() => fs.existsSync(file) && fs.statSync(file).size > 0, { timeout: 60_000 }).toBe(true);
}

/** 압축 파일(XLSX·HWPX) 안 XML의 글자만 모은다. */
async function zipText(file: string, pattern: RegExp) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const xml = (await Promise.all(Object.keys(zip.files).filter((f) => pattern.test(f)).map((f) => zip.file(f)!.async('string')))).join('\n');
  return xml.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** 작성 현황에서 세 학생이 모두 검토 완료인지 */
async function expectAllReviewed(page: Page) {
  await menu(page, /작성 내용 확인 및 출력/);
  await page.locator('.cell', { hasText: '행특 · 1학기' }).click();
  for (const s of STUDENTS) await expect(page.locator('.stu-row', { hasText: s.name })).toContainText(/검토 완료 · \d+자\(\d+Byte\)/);
}

async function backupTab(page: Page) {
  await menu(page, /기본설정/);
  await tab(page, '백업·보안');
  await expect(page.locator('.backup-panel')).not.toContainText('백업 폴더를 확인하는 중');
}

async function fillPassword(page: Page, pw: string, twice: boolean) {
  const inputs = page.locator('.modal-back input[type=password]');
  await inputs.nth(0).fill(pw);
  if (twice) await inputs.nth(1).fill(pw);
  await page.locator('.modal-back').getByRole('button', { name: '확인' }).click();
}

test('실제 Gemini·Claude·ChatGPT로 학생 3명 행특 작성 → 저장 유지 → XLSX·HWPX 출력 → 백업·복원', async () => {
  test.setTimeout(1_800_000);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sgb-live-flow-'));
  const userData2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sgb-live-restore-'));
  const xlsx = path.join(userData, '행특_출력.xlsx');
  const hwpx = path.join(userData, '행특_출력.hwpx');
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
    await expectAllReviewed(page);
    await exportFile(app, page, xlsx, 'XLSX');
    const xlsxText = await zipText(xlsx, /sharedStrings|sheet\d*\.xml$/);
    for (const r of results) {
      expect(xlsxText).toContain(r.student);
      expect(xlsxText).toContain(r.finalText.slice(0, 40));
    }
    console.log('xlsx', fs.statSync(xlsx).size, 'Byte, 학생 3명 최종 본문 포함');

    // HWPX: 한글 문서(압축 XML)에 학생 3명의 최종 본문이 들어간다
    await exportFile(app, page, hwpx, 'HWPX');
    const hwpxZip = await JSZip.loadAsync(fs.readFileSync(hwpx));
    const hwpxFiles = Object.keys(hwpxZip.files);
    console.log('hwpx files:', hwpxFiles.join(', '));
    expect(hwpxFiles).toContain('mimetype');
    expect((await hwpxZip.file('mimetype')!.async('string')).trim()).toBe('application/hwp+zip');
    const hwpxText = (await zipText(hwpx, /^Contents\/section\d+\.xml$/)).replace(/\s+/g, '');
    for (const r of results) expect(hwpxText).toContain(r.finalText.slice(0, 40).replace(/\s+/g, ''));
    console.log('hwpx', fs.statSync(hwpx).size, 'Byte, 학생 3명 최종 본문 포함');

    // 백업: 이동용(비밀번호) 백업과 자동 백업을 만든다
    await backupTab(page);
    await page.getByRole('button', { name: '이동용 백업 만들기' }).click();
    await fillPassword(page, BACKUP_PW, true);
    await expect(page.getByText(/이동용 백업을 백업 폴더에 저장했습니다/)).toBeVisible({ timeout: 30_000 });
    await page.locator('.content').getByRole('button', { name: '지금 자동 백업' }).click();
    await expect(page.locator('.backup-list')).toContainText('이동용(비밀번호)');
    await expect(page.locator('.backup-list')).toContainText('자동(이 PC 전용)');
    const backupDir = path.join(userData, 'backups');
    const moveFile = fs.readdirSync(backupDir).filter((f) => f.endsWith('.sgbak')).map((f) => path.join(backupDir, f))[0]!;
    const autoFiles = fs.readdirSync(backupDir).filter((f) => f.endsWith('.sgauto'));
    expect(moveFile).toBeTruthy();
    expect(autoFiles.length).toBeGreaterThan(0);
    // 백업 파일은 암호화되어 학생 이름·본문이 그대로 보이지 않는다
    const moveRaw = fs.readFileSync(moveFile, 'utf8');
    for (const r of results) {
      expect(moveRaw).not.toContain(r.student);
      expect(moveRaw).not.toContain(r.finalText.slice(0, 20));
    }
    console.log('backup', path.basename(moveFile), fs.statSync(moveFile).size, 'Byte · 자동', autoFiles.join(', '));
    expect(errors).toEqual([]);
    await app.close();

    // 새 PC(빈 자료)에서 이동용 백업 복원: 틀린 비밀번호는 거절하고, 맞는 비밀번호면 3명 검토 완료 본문이 그대로 돌아온다
    ({ app, page, errors } = await launch(userData2));
    await expect(page.getByText('처음 사용하시나요?')).toBeVisible({ timeout: 60_000 });
    await app.evaluate(({ dialog }, f) => {
      (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
    }, moveFile);
    await backupTab(page);
    await page.getByRole('button', { name: '다른 위치에서 복원' }).click();
    await fillPassword(page, 'wrong-password-1234', false);
    await expect(page.locator('#toast.err.on')).toBeVisible({ timeout: 30_000 });
    console.log('wrong password:', (await page.locator('#toast').innerText()).replace(/\n+/g, ' '));
    await page.getByRole('button', { name: '다른 위치에서 복원' }).click();
    await fillPassword(page, BACKUP_PW, false);
    await expect(page.getByText(/복원했습니다/).first()).toBeVisible({ timeout: 30_000 });
    await expectAllReviewed(page);
    const restoredXlsx = path.join(userData2, '복원_행특_출력.xlsx');
    await exportFile(app, page, restoredXlsx, 'XLSX');
    const restoredText = await zipText(restoredXlsx, /sharedStrings|sheet\d*\.xml$/);
    for (const r of results) expect(restoredText).toContain(r.finalText.slice(0, 40));
    console.log('restore ok: 새 자료에서 학생 3명 검토 완료 본문 복원·출력');
    expect(errors).toEqual([]);
  } finally {
    if (process.env.LIVE_FLOW_OUT) fs.writeFileSync(process.env.LIVE_FLOW_OUT, JSON.stringify(results, null, 2), 'utf8');
    await app.close().catch(() => {});
    if (process.env.LIVE_FLOW_KEEP) console.log('kept:', userData, userData2);
    else for (const d of [userData, userData2]) fs.rmSync(d, { recursive: true, force: true });
  }
});
