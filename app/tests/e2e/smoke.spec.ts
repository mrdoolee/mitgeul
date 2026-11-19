import { _electron as electron, expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { menu, setupHomeroom, tab } from './helpers';

const SHOTS = process.env.SHOTS_DIR;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

test('가상 자료로 기본설정 → 명단 일괄 입력 → 담임 설정 → 관찰 → 직접 작성 → 검토 → 출력 계획', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sgb-e2e-'));
  const app = await electron.launch({ args: [path.resolve(__dirname, '../../dist/main/main.js')], env: { ...process.env, MITGEUL_USER_DATA: userData } });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.setViewportSize({ width: 1440, height: 920 });

  // 시작 화면 없이 바로 기본설정
  await expect(page.getByText('처음 사용하시나요?')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('nav.menu .menu-item')).toHaveCount(7);
  // 사이드바: [설정] 1~5, [생기부 작성 및 확인] 6~7
  await expect(page.locator('nav.menu .menu-group')).toHaveCount(2);
  await expect(page.locator('nav.menu .menu-group').nth(0).locator('.menu-group-label')).toHaveText('설정');
  await expect(page.locator('nav.menu .menu-group').nth(0).locator('.menu-item')).toHaveCount(5);
  await expect(page.locator('nav.menu .menu-group').nth(0).locator('.menu-item').last()).toContainText('초안 작성 초기 설정');
  await expect(page.locator('nav.menu .menu-group').nth(1).locator('.menu-group-label')).toHaveText('생기부 작성 및 확인');
  await expect(page.locator('nav.menu .menu-group').nth(1).locator('.menu-item')).toHaveCount(2);
  // 사이드바 [지금 자동 백업]: 빈 자료는 저장하지 않는다(기존 백업 보호)
  await page.locator('.sidebar').getByRole('button', { name: '지금 자동 백업' }).click();
  await expect(page.getByText(/빈 자료는 백업하지 않습니다/)).toBeVisible();
  // 사이드바는 스크롤 없이 한 화면에 들어간다(기본 창 크기)
  expect(await page.locator('.sidebar').evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1100, height: 700 });
  expect(await page.locator('.sidebar').evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(0);
  await shot(page, '00-sidebar-min');
  await page.setViewportSize({ width: 1440, height: 920 });
  // 사용 가이드: 설명 문구 없이 버튼 하나. 첫 줄 원작 안내와 원글 링크, 첫 내용은 '꼭 기억해 주세요'
  await expect(page.locator('.side-guide')).toHaveText('사용 가이드');
  await page.locator('.sidebar').getByRole('button', { name: '사용 가이드' }).click();
  await expect(page.locator('.guide-sec').first().locator('h3')).toHaveText('꼭 기억해 주세요');
  await expect(page.locator('.guide-sec').first()).toContainText('보조 도구');
  await expect(page.locator('.brand-title')).toHaveText('밑글');
  await expect(page.locator('.brand-sub')).toHaveText('생활기록부 초안 작성 도우미');
  await expect(page).toHaveTitle('밑글 — 생활기록부 초안 작성 도우미');
  await expect(page.locator('.guide-credit')).toContainText('밑글(MITGEUL)은 Dorms의 @Tachyon 선생님의 생기부 작성 도우미 LITE를 기반으로 제작되었습니다.');
  await expect(page.locator('.guide-credit a')).toHaveAttribute('href', 'https://dorms.school/apps/6a94b4dc-040e-4b49-8ecd-b909ea6ef01a');
  await shot(page, '02-guide');
  await page.keyboard.press('Escape');
  await page.locator('.app-footer').getByRole('button', { name: '개인정보처리방침' }).click();
  await expect(page.locator('.privacy h3').first()).toHaveText('제1조(총칙과 데이터 처리 구조)');
  await expect(page.locator('.privacy')).toContainText('시행일: 2026년 11월 19일');
  await expect(page.locator('.privacy')).toContainText('[[학생A]]');
  await expect(page.locator('.privacy')).toContainText('제9조의2(자동 수집 장치의 설치·운영과 거부)');
  await expect(page.locator('.privacy')).toContainText('경찰청 사이버수사국: 182');
  // 방침 안의 주소는 main이 허용한 블로그 링크만 누를 수 있다(주소 뒤 괄호는 주소에 넣지 않음).
  await expect(page.locator('.privacy a.ext-link')).toHaveCount(1);
  await expect(page.locator('.privacy a.ext-link')).toHaveText('https://blog.naver.com/trdoolee');
  await shot(page, '02-privacy');
  await page.keyboard.press('Escape');
  await expect(page.locator('.privacy')).toHaveCount(0);
  await expect(page.locator('.modal-back')).toHaveCount(0);
  // 푸터 제작자 안내: 배경 스크롤 잠금, ESC·배경·닫기 버튼으로 닫힘
  await expect(page.locator('.app-footer')).toContainText('© 2026 Designed & Developed by 두리쌤. All rights reserved.');
  await page.locator('.app-footer').getByRole('button', { name: '두리쌤' }).click();
  const dlg = page.getByRole('dialog', { name: '제작자 안내' });
  await expect(dlg).toHaveAttribute('aria-modal', 'true');
  await expect(dlg).toContainText('✨ 제작: 두리쌤');
  await expect(dlg.locator('.credit-card')).toHaveCount(2);
  await expect(dlg.getByRole('link', { name: 'trdoolee', exact: true })).toHaveAttribute('href', 'https://www.instagram.com/trdoolee');
  await expect(dlg.getByRole('link', { name: 'blog.naver.com/trdoolee' })).toHaveAttribute('target', '_blank');
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
  await shot(page, '02-credit');
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).not.toBe('hidden');
  await page.locator('.app-footer').getByRole('button', { name: '두리쌤' }).click();
  await page.locator('.modal-back').click({ position: { x: 5, y: 5 } });
  await expect(dlg).toHaveCount(0);
  await page.locator('.app-footer').getByRole('button', { name: '두리쌤' }).click();
  await dlg.getByRole('button', { name: '닫기' }).click();
  await expect(dlg).toHaveCount(0);
  await shot(page, '01-settings');

  // 고등학교면 기재 금지 문구 탭의 [추가] 위에 학교명 기재 금지 안내(출처 포함)를 띄운다
  await page.locator('.field', { hasText: '학교급' }).locator('select').selectOption({ label: '고등학교' });
  await page.getByRole('button', { name: '학교 정보 저장' }).click();
  await expect(page.getByText('학교 정보를 저장했습니다.')).toBeVisible();
  await tab(page, '기재 금지 문구');
  const schoolBan = page.locator('.banner', { hasText: '학교명 기재 금지(고등학교)' });
  await expect(schoolBan).toContainText('학교 축제명');
  await expect(schoolBan).toContainText('출처: 2026학년도 학교생활기록부 기재요령(고등학교)');
  expect(await schoolBan.evaluate((b) => b.compareDocumentPosition(document.querySelector('[aria-label="기재 금지 문구 입력"]')!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await shot(page, '01b-high-ban-notice');
  await tab(page, '학교 정보');
  await page.locator('.field', { hasText: '학교급' }).locator('select').selectOption({ label: '중학교' });
  await page.getByRole('button', { name: '학교 정보 저장' }).click();

  // 기재 금지 문구 등록(중학교는 학교명 안내 없음)
  await tab(page, '기재 금지 문구');
  await expect(page.locator('.banner', { hasText: '학교명 기재 금지' })).toHaveCount(0);
  // 기재요령 예시가 미리 들어 있다
  await expect(page.locator('.ban-chip', { hasText: 'UNESCO' })).toBeVisible();
  await page.getByLabel('기재 금지 문구 입력').fill('가상기관A, 가상기관B');
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await expect(page.getByText('기재 금지 문구를 저장했습니다.')).toBeVisible();
  await expect(page.locator('.ban-chip', { hasText: '가상기관B' })).toBeVisible();

  // 학생 명단 일괄 입력(붙여 넣기) → 학급 자동 생성
  await menu(page, /학급 및 학생 명단 입력/);
  expect(await page.locator('nav.subtabs [role=tab]').allTextContents()).toEqual([expect.stringContaining('명단 일괄 입력'), expect.stringContaining('학급'), expect.stringContaining('학생 명단')]);
  await expect(page.getByRole('button', { name: '샘플 양식 다운로드' })).toBeVisible();
  await expect(page.getByRole('button', { name: '명단 XLSX 업로드' })).toBeVisible();
  await page.getByRole('button', { name: '엑셀에서 붙여 넣기' }).click();
  await page.locator('.modal textarea').fill('학년\t반\t번호\t이름\n1\t3\t1\t김민준\n1\t3\t2\t이서연\n1\t3\t3\t박하늘');
  await page.getByRole('button', { name: '붙여 넣은 명단 미리 보기' }).click();
  await expect(page.getByText('새 학생 3')).toBeVisible();
  await shot(page, '02-roster-import');
  await page.getByRole('button', { name: '가져오기 적용' }).click();
  await expect(page.getByText('학생 3명을 반영했습니다.')).toBeVisible();
  // 잘못 만든 학급 삭제
  await tab(page, /^학급/);
  await page.locator('.content input[type=number]').nth(1).fill('9');
  await page.getByRole('button', { name: '학급 만들기', exact: true }).click();
  await expect(page.getByText('1학년 9반')).toBeVisible();
  page.once('dialog', (dl) => void dl.accept());
  await page.locator('tr', { hasText: '1학년 9반' }).getByRole('button', { name: '학급 삭제' }).click();
  await expect(page.getByText('학급을 삭제했습니다.')).toBeVisible();
  await expect(page.getByText('1학년 9반')).toHaveCount(0);
  await tab(page, /학생 명단/);
  await expect(page.getByText('학생 명단 (3명)')).toBeVisible();
  await shot(page, '03-roster');

  // 교사 정보 설정: 자동 생성된 학급의 담임 작업 켜기
  await menu(page, /교사 정보 설정/);
  // 담임 학급 설정에는 학급 만들기 입력이 없다(메뉴2에서 처리)
  await expect(page.locator('.content input[type=number]')).toHaveCount(0);
  await page.getByRole('button', { name: '담임 작업 켜기' }).click();
  await expect(page.locator('.chip.ok', { hasText: '담임' })).toBeVisible();
  // 과목 추가 → 삭제
  await tab(page, '교과 과목 설정');
  await page.getByPlaceholder('예: 국어, 과학').fill('국어');
  await page.getByRole('button', { name: '과목 추가' }).click();
  const blk = page.locator('.subject-block', { hasText: '국어' });
  await expect(blk).toBeVisible();
  // 과목 아래에서 수업하는 반을 고르면 그 학급 학생이 자동으로 배정된다
  await blk.locator('.chip.pick').first().click();
  await blk.getByRole('button', { name: '고른 반 추가' }).click();
  await expect(page.getByText(/수업 반 1개를 추가하고 학급 학생 3명을 배정했습니다/)).toBeVisible();
  await expect(page.locator('.subject-block', { hasText: '국어' }).locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('.subject-block', { hasText: '국어' }).locator('tbody tr').first()).toContainText('3명');
  // 학기에서 [학기 구분 없음]을 고를 수 있다
  await page.locator('.subject-block', { hasText: '국어' }).locator('.add-group select').nth(1).selectOption({ label: '학기 구분 없음' });
  await page.locator('.subject-block', { hasText: '국어' }).locator('.chip.pick').first().click();
  await page.locator('.subject-block', { hasText: '국어' }).getByRole('button', { name: '고른 반 추가' }).click();
  await expect(page.locator('.subject-block', { hasText: '국어' }).locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('.subject-block', { hasText: '국어' }).locator('tbody')).toContainText('1학년 학기 구분 없음');
  await menu(page, /초안 작성 초기 설정/);
  await expect(page.locator('.card', { hasText: '입력 학기 한 번에 바꾸기' })).toHaveCount(0);
  await tab(page, '교과 수업 반');
  await expect(page.locator('.setup-work', { hasText: '학기 구분 없음' }).locator('.setup-mode')).toContainText('학기 구분 없음');
  await expect(page.locator('.setup-work', { hasText: '학기 구분 없음' }).getByText('② 입력 학기')).toHaveCount(0);
  await menu(page, /교사 정보 설정/);
  await tab(page, '교과 과목 설정');
  await shot(page, '03b-subjects');
  page.once('dialog', (dl) => void dl.accept());
  await page.locator('.subject-block', { hasText: '국어' }).getByRole('button', { name: '과목 삭제' }).click();
  await expect(page.getByText('과목을 삭제했습니다.')).toBeVisible();
  await expect(page.locator('.subject-block')).toHaveCount(0);

  await menu(page, /작성 내용 확인 및 출력/);
  await expect(page.getByText('작업별 현황')).toBeVisible();
  await shot(page, '04-dashboard');

  // 관찰: 작업 → 영역 → 학생 순서. 학기는 초기 설정 값을 보여 주기만 한다.
  await menu(page, /관찰 기록 및 초안 작성/);
  await expect(page.locator('.sel-grid .field > label')).toHaveCount(4);
  const labels = await page.locator('.sel-grid .field > label').allTextContents();
  expect(labels.map((l) => l.slice(0, 4))).toEqual(['① 작업', '② 영역', '학기', '③ 학생']);
  await expect(page.locator('.sel-grid').getByRole('button', { name: /^[12]학기$|학기 구분 없음/ })).toHaveCount(0);
  await expect(page.locator('.sem-show .chip')).toHaveText('1학기');
  await expect(page.getByRole('button', { name: '기재 제외 일괄 처리' })).toHaveCount(0);
  await page.getByRole('button', { name: '행특' }).click();
  // 마지막 탭(최종 본문·검토)에서는 [다음] 단추가 없다
  await tab(page, /최종 본문/);
  await expect(page.locator('.page-nav')).not.toContainText('다음:');
  await expect(page.locator('.page-nav')).toContainText('이전: 최종 윤문');
  await tab(page, '관찰 기록');
  await expect(page.getByRole('heading', { name: '관찰 기록', exact: true })).toBeVisible();
  // 자율 작성이 첫 입력 상자이며 금지 문구를 실시간으로 표시
  const free = page.locator('.free-box textarea');
  await expect(page.locator('.card textarea').first()).toHaveAttribute('data-focus', /^free-/);
  await free.fill('유네스코 학교 행사에서 안내를 맡음.');
  await expect(page.locator('.free-box .live-chip.ban')).toContainText('유네스코');
  await free.fill('학급 회의 결과를 게시판에 정리해 붙임.');
  await expect(page.locator('.free-box .live-chip')).toHaveCount(0);
  await page.getByLabel('규칙 준수 선택').check();
  // 항목을 눌러도 스크롤이 맨 위로 튀지 않는다
  // 누를 점수 단추가 화면 안에 오도록 먼저 스크롤해 두고(클릭 전 자동 스크롤 배제) 그 위치가 유지되는지 본다
  await page.getByRole('radio', { name: /4 잘함/ }).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);
  await page.getByRole('radio', { name: /4 잘함/ }).first().click();
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  await page.getByRole('button', { name: '관찰 저장' }).click();
  await expect(page.getByText('관찰을 저장했습니다.')).toBeVisible();
  await shot(page, '05-observe');

  // 직접 작성 → 검토
  await tab(page, /최종 본문/);
  const final = page.locator('.card.final textarea');
  await final.fill('학급 규칙을 스스로 확인하고 지키며, 안내를 받은 뒤 행동을 조정함.');
  await final.blur();
  await page.locator('.card.final').getByLabel(/관찰 근거와 사실을 확인/).check();
  await page.locator('.card.final').getByRole('button', { name: '검토 완료' }).click();
  await expect(page.getByText(/검토 완료 ·/)).toBeVisible();
  await expect(page.getByRole('button', { name: '최종 본문 복사' })).toBeEnabled();
  await page.getByRole('button', { name: '최종 본문 복사' }).click();
  const clip = await app.evaluate(({ clipboard }) => clipboard.readText());
  expect(clip).toBe('학급 규칙을 스스로 확인하고 지키며, 안내를 받은 뒤 행동을 조정함.');
  await shot(page, '06-review');

  // 수정하면 검토 해제, 금지 표현 차단(공통 규칙·교사 지정 문구)
  await final.fill('TOEIC 900점을 받음.');
  await final.blur();
  await expect(page.getByText('검토 후 관련 내용이 바뀌어')).toBeVisible();
  await expect(page.getByRole('button', { name: '최종 본문 복사' })).toBeDisabled();
  await expect(page.getByText('공인어학시험').first()).toBeVisible();
  await final.fill('UNESCO 행사에서 안내를 맡음.');
  await final.blur();
  await expect(page.getByText('교사 지정 기재 금지').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '최종 본문 복사' })).toBeDisabled();
  await final.fill('학급 규칙을 스스로 확인하고 지키며, 안내를 받은 뒤 행동을 조정함.');
  await final.blur();

  await menu(page, /작성 내용 확인 및 출력/);
  await tab(page, '작업별 출력');
  await expect(page.getByText(/전원 입력 대상입니다/)).toBeVisible();
  await shot(page, '07-export');
  await menu(page, /기본설정/);
  await tab(page, 'AI 연결');
  await expect(page.getByText('AI 제공자')).toBeVisible();
  await expect(page.getByLabel('AI 요청마다 전송 문안 확인 창 띄우기')).not.toBeChecked();
  await shot(page, '08-settings');

  expect(errors).toEqual([]);
  await app.close();

  // 재시작 후 자료 유지, 시작 화면 없이 작성 현황으로
  const app2 = await electron.launch({ args: [path.resolve(__dirname, '../../dist/main/main.js')], env: { ...process.env, MITGEUL_USER_DATA: userData } });
  const p2 = await app2.firstWindow();
  await expect(p2.getByText('작업별 현황')).toBeVisible({ timeout: 20000 });
  await expect(p2.getByText('1학년 3반 담임').first()).toBeVisible();
  const files = fs.readdirSync(path.join(userData, 'store'));
  expect(files).toContain('data.json');
  const raw = fs.readFileSync(path.join(userData, 'store', 'data.json'), 'utf8');
  expect(raw).not.toContain('김민준');
  await app2.close();
});

test('전체 자료 삭제 뒤 앱 잠금 비밀번호를 묻지 않고 기본설정으로 돌아온다', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sgb-wipe-'));
  const app = await electron.launch({ args: [path.resolve(__dirname, '../../dist/main/main.js')], env: { ...process.env, MITGEUL_USER_DATA: userData } });
  const page = await app.firstWindow();
  await expect(page.getByText('처음 사용하시나요?')).toBeVisible({ timeout: 20000 });
  await tab(page, /^정보$/);
  await page.getByRole('button', { name: '개인정보처리방침 보기' }).click();
  await expect(page.locator('.privacy h3').first()).toHaveText('제1조(총칙과 데이터 처리 구조)');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '전체 자료 삭제' }).click();
  await page.locator('.modal input').fill('전체 삭제');
  await page.locator('.modal').getByRole('button', { name: '확인' }).click();
  await expect(page.getByText('처음 사용하시나요?')).toBeVisible();
  await expect(page.getByText('앱 잠금 비밀번호')).toHaveCount(0);
  await app.close();
});

test('앱 비밀번호를 잊으면 초기화 뒤 자동 백업으로 복원한다', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sgb-forgot-'));
  const launch = () => electron.launch({ args: [path.resolve(__dirname, '../../dist/main/main.js')], env: { ...process.env, MITGEUL_USER_DATA: userData } });
  let app = await launch();
  let page = await app.firstWindow();
  await setupHomeroom(page, 3, '번호\t이름\n1\t가나다\n2\t라마바');
  await menu(page, /기본설정/);
  await tab(page, '백업·보안');
  await page.locator('.content').getByRole('button', { name: '지금 자동 백업' }).click();
  await expect(page.locator('.backup-list')).toContainText('자동(이 PC 전용)');
  // 앱 잠금: 경고 문장에 체크해야 확인이 눌린다
  await page.getByRole('button', { name: '앱 잠금 켜기' }).click();
  const dlg = page.locator('.modal-back');
  await expect(dlg).toContainText('비밀번호를 잊으면 앱 자료를 열 수 없습니다');
  await shot(page, '18-lock-warning');
  await dlg.locator('input[type=password]').nth(0).fill('lock-pass-1');
  await dlg.locator('input[type=password]').nth(1).fill('lock-pass-1');
  await expect(dlg.getByRole('button', { name: '확인' })).toBeDisabled();
  await dlg.locator('label.ack input').check();
  await dlg.getByRole('button', { name: '확인' }).click();
  await expect(page.getByText('앱 잠금을 켰습니다.')).toBeVisible();
  await app.close();
  // 다시 열면 잠금 화면 → 비밀번호를 잊었어요 → 초기화 → 자동 백업으로 복원
  app = await launch();
  page = await app.firstWindow();
  await expect(page.getByRole('button', { name: '잠금 해제' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: '비밀번호를 잊었어요' }).click();
  await page.locator('.modal-back input').fill('초기화');
  await page.locator('.modal-back').getByRole('button', { name: '확인' }).click();
  await expect(page.locator('.modal-back')).toContainText('최근 자동 백업');
  await shot(page, '19-restore-offer');
  await page.getByRole('button', { name: '이 백업으로 복원' }).click();
  await expect(page.getByText('백업에서 복원했습니다.')).toBeVisible();
  await menu(page, /학급 및 학생 명단 입력/);
  await tab(page, /학생 명단/);
  await expect(page.locator('.content')).toContainText('가나다');
  await app.close();
  // 다시 열어도 잠금 화면 없이 열린다(복원 뒤 앱 잠금은 꺼짐)
  app = await launch();
  page = await app.firstWindow();
  await expect(page.getByRole('button', { name: '잠금 해제' })).toHaveCount(0);
  await app.close();
});

test('저장 키를 풀 수 없으면 한국어 안내 뒤 초기화하고 자동 백업으로 복원한다', async () => {
  // 처음 실행 직후 강제 종료·정전으로 Windows 보호 비밀값(Local State)이 저장되지 못한 경우를 key.json의 감싼 키를 바꿔 재현한다.
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sgb-keyfail-'));
  const launch = () => electron.launch({ args: [path.resolve(__dirname, '../../dist/main/main.js')], env: { ...process.env, MITGEUL_USER_DATA: userData } });
  let app = await launch();
  let page = await app.firstWindow();
  await setupHomeroom(page, 4, '번호\t이름\n1\t사아자\n2\t차카타');
  await menu(page, /기본설정/);
  await tab(page, '백업·보안');
  await page.locator('.content').getByRole('button', { name: '지금 자동 백업' }).click();
  await expect(page.locator('.backup-list')).toContainText('자동(이 PC 전용)');
  await app.close();
  const keyFile = path.join(userData, 'store', 'key.json');
  const kf = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  expect(kf.mode).toBe('os');
  kf.wrapped = Buffer.from('not-a-valid-protected-key-0123456789').toString('base64');
  fs.writeFileSync(keyFile, JSON.stringify(kf));
  const dataBefore = fs.readFileSync(path.join(userData, 'store', 'data.json'), 'utf8');
  app = await launch();
  page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await expect(page.getByRole('heading', { name: '앱 자료를 열 수 없습니다' })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('body')).toContainText('처음 실행 직후 앱이 강제로 꺼졌거나');
  await expect(page.locator('body')).not.toContainText('safeStorage');
  // 자료를 덮어쓰지 않았다
  expect(fs.readFileSync(path.join(userData, 'store', 'data.json'), 'utf8')).toBe(dataBefore);
  await shot(page, '20-key-fail');
  await page.getByRole('button', { name: '초기화 후 백업에서 복원' }).click();
  await page.locator('.modal-back input').fill('초기화');
  await page.locator('.modal-back').getByRole('button', { name: '확인' }).click();
  await expect(page.locator('.modal-back')).toContainText('최근 자동 백업');
  await page.getByRole('button', { name: '이 백업으로 복원' }).click();
  await expect(page.getByText('백업에서 복원했습니다.')).toBeVisible();
  await menu(page, /학급 및 학생 명단 입력/);
  await tab(page, /학생 명단/);
  await expect(page.locator('.content')).toContainText('사아자');
  expect(errors).toEqual([]);
  await app.close();
});
