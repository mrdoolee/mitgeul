import { _electron as electron, expect, test } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { connectCli, fakeCliEnv, menu, saveKey, setupHomeroom, tab } from './helpers';

const SHOTS = process.env.SHOTS_DIR;

test('가짜 Claude Code CLI로 후보 생성 → 복수·부분 조합 → 취합 → 윤문 → 채택 → 검토 → 출력 계획', async () => {
  const requests: { method: string; url: string; headers: string; body: string }[] = [];
  let failNext = false;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: JSON.stringify(req.headers), body });
      if (failNext && req.method === 'POST') {
        failNext = false;
        res.writeHead(503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'The model is overloaded.' } }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      if (body.includes('모델 연결 시험')) return res.end(JSON.stringify({ text: '{"ok":true}' }));
      const polish = body.includes('최종 윤문 과제') || body.includes('분량 늘리기 과제');
      const ids = [...body.matchAll(/항목ID: ([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
      const text = polish
        ? JSON.stringify({ text: '학급 규칙을 스스로 확인하고 지키며 어긋난 행동을 안내 뒤 바로 조정함. 의견이 다른 친구의 말을 끝까지 듣고 차이를 정리함.', suggestions: ['근거 부족: 구체 장면이 적음'] })
        : JSON.stringify({ items: ids.map((id) => ({ itemId: id, candidates: [1, 2, 3, 4, 5].map((n) => `${id} 관찰 문장 ${n}번으로 행동을 보임.`) })) });
      // 응답 대기 토스트를 볼 수 있게 조금 늦게 답한다
      setTimeout(() => res.end(JSON.stringify({ text })), 700);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sgb-ai-'));
  const app = await electron.launch({ args: [path.resolve(__dirname, '../../dist/main/main.js')], env: { ...process.env, MITGEUL_USER_DATA: userData, ...fakeCliEnv(base) } });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1440, height: 920 });

  await setupHomeroom(page, 2, '번호\t이름\n1\t정다은\n2\t최하준');
  await menu(page, /기본설정/);
  await tab(page, 'AI 연결');
  // 기본 제공자는 Gemini(API 키)다
  await expect(page.getByPlaceholder('API 키 입력')).toBeVisible();
  await page.getByRole('button', { name: /API 키 발급 방법/ }).click();
  await expect(page.getByText('Gemini는 API 키로, Claude·ChatGPT는 이 PC에 설치한 구독 CLI로 부릅니다.')).toBeVisible();
  // 제공자별 연결 방법은 펼침 상자, 지금 고른 제공자(Gemini)만 펼쳐 둔다
  await expect(page.locator('.key-guide .guide-acc summary b')).toHaveText(['Google Gemini (API 키)', 'Claude (Claude Code)', 'ChatGPT (Codex CLI)']);
  await expect(page.locator('.key-guide .guide-acc', { hasText: 'Google Gemini' })).toHaveAttribute('open', '');
  await expect(page.locator('.key-guide')).toContainText('AIza로 시작');
  await expect(page.locator('.key-guide .guide-acc[open]')).toHaveCount(1);
  await page.locator('.key-guide .guide-acc summary', { hasText: 'ChatGPT (Codex CLI)' }).click();
  await expect(page.locator('.key-guide .guide-acc', { hasText: 'ChatGPT (Codex CLI)' })).toHaveAttribute('open', '');
  await expect(page.locator('.key-guide')).toContainText('[ChatGPT 로그인]을 누르면');
  await expect(page.locator('.key-guide')).toContainText('[코드로 로그인]');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '08-cli-guide.png') });
  await page.getByRole('button', { name: '닫기' }).click();
  // Gemini API 키 저장은 그대로 동작하고, 키 파일은 따로 암호화해 둔다
  await saveKey(page, 'AIzaTEST-KEY-1234567890');
  await connectCli(page);
  // 전송 문안 확인은 기본 꺼짐. 이 시험은 미리 보기를 검사하려고 켠다.
  await page.getByLabel('AI 요청마다 전송 문안 확인 창 띄우기').check();
  await expect(page.getByText('전송 전 문안 확인 창을 켰습니다.')).toBeVisible();
  await page.getByRole('button', { name: '모델 목록 불러오기' }).click();
  await expect(page.getByText('사용 가능한 모델 4개를 불러왔습니다')).toBeVisible();
  await page.getByLabel('AI 모델').selectOption('claude-haiku-5-5');
  // 추론 강도: 기본은 CLI 기본값(옵션을 넘기지 않음), 고르면 모델 테스트도 그 강도로 보낸다
  await expect(page.getByLabel('추론 강도')).toHaveValue('');
  await page.getByLabel('추론 강도').selectOption('low');
  await page.getByRole('button', { name: '모델 테스트' }).click();
  await expect(page.getByText('claude-haiku-5-5 모델이 정상 응답했습니다')).toBeVisible();
  await expect(page.getByText(/추론 강도 low · 응답 시간/)).toBeVisible();
  {
    const t = JSON.parse(requests.filter((r) => r.body.includes('모델 연결 시험')).at(-1)!.body) as { args: string[] };
    expect(t.args[t.args.indexOf('--effort') + 1]).toBe('low');
  }
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '09-model-settings.png') });
  // 모델별 결과 비교 안내 창: 저장된 시험 결과만 보여 주고 요청은 보내지 않는다
  const before = requests.length;
  await page.getByRole('button', { name: 'AI 모델별 결과 비교 보기' }).click();
  const cmp = page.getByRole('dialog', { name: 'AI 모델별 결과 비교' });
  await expect(cmp.locator('.mcmp-card')).toHaveCount(6);
  for (const m of ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gpt-5.4-mini', 'gpt-5.4-nano', 'claude-sonnet-5-5', 'claude-haiku-5-5']) await expect(cmp.locator('.mcmp-head b', { hasText: new RegExp(`^${m}$`) })).toHaveCount(1);
  await expect(cmp.locator('.mcmp-prov').first().locator('h3')).toContainText('Anthropic Claude');
  await expect(cmp).toContainText('모델마다 API로 직접 받은 결과입니다.');
  // 관찰 기록 하나와 모델별 후보 5개만 보여 준다
  await expect(cmp.locator('.mcmp-input')).toContainText('배려·도움 4/5');
  for (const card of await cmp.locator('.mcmp-card').all()) await expect(card.locator('.mcmp-list li')).toHaveCount(5);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '09b-model-compare.png') });
  await page.keyboard.press('Escape');
  await expect(cmp).toHaveCount(0);
  expect(requests.length).toBe(before);
  await page.getByRole('button', { name: '모델 저장' }).click();
  await expect(page.getByText('현재 저장: claude-haiku-5-5 · 추론 강도 low')).toBeVisible();

  await menu(page, /관찰 기록 및 초안 작성/);
  await page.getByRole('button', { name: '행특' }).click();
  await page.getByLabel('규칙 준수 선택').check();
  await page.getByLabel('경청·의견 조율 선택').check();
  await page.locator('.rubric-item.on textarea').first().fill('정다은이 최하준과 함께 학급 규칙 개정안을 정리함');
  await page.getByRole('button', { name: '관찰 저장' }).click();
  await expect(page.getByText('관찰을 저장했습니다.')).toBeVisible();
  await tab(page, /AI 후보/);
  await page.getByRole('button', { name: '후보 생성 요청' }).click();
  const pre = page.locator('pre.preview');
  await expect(pre).toBeVisible();
  const previewText = (await pre.textContent()) ?? '';
  expect(previewText).not.toContain('정다은');
  expect(previewText).not.toContain('최하준');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '10-preview.png') });
  await expect(page.getByRole('button', { name: '이 문안으로 전송' })).toBeDisabled();
  await page.getByLabel('전송 문안을 확인했습니다').check();
  await page.getByRole('button', { name: '이 문안으로 전송' }).click();
  // 응답을 기다리는 동안 오른쪽 아래 진한 토스트(닫기 버튼 없음, 경과 시간 표시), 응답이 오면 사라진다
  await expect(page.locator('#busy-toast')).toContainText('후보 생성 요청 중');
  await expect(page.locator('#busy-toast .busy-elapsed')).toContainText(/경과 \d+초/);
  await expect(page.locator('#busy-toast').getByRole('button')).toHaveText(['요청 취소']);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '10b-busy-toast.png') });
  await expect(page.getByText('후보 저장 2개 항목')).toBeVisible();
  await expect(page.locator('#busy-toast')).toHaveCount(0);
  const posted = requests.filter((r) => r.method === 'POST' && !r.body.includes('모델 연결 시험'));
  // 저장한 추론 강도로 실제 요청을 보낸다
  for (const r of posted) {
    const a = (JSON.parse(r.body) as { args: string[] }).args;
    expect(a[a.indexOf('--effort') + 1]).toBe('low');
  }
  expect(posted.length).toBe(1);
  expect(posted[0]!.url).toBe('/claude');
  const sent = JSON.parse(posted[0]!.body) as { model: string; args: string[]; system: string; user: string };
  expect(sent.model).toBe('claude-haiku-5-5');
  expect(sent.args).toEqual(expect.arrayContaining(['--tools', '--setting-sources', '--strict-mcp-config', '--no-session-persistence']));
  expect(posted[0]!.body).not.toContain('정다은');
  expect(posted[0]!.body).not.toContain('최하준');
  // 교사가 확인한 미리 보기와 CLI에 넘긴 문안이 같다
  expect(previewText).toContain(sent.user.trim().slice(-120));

  const block = page.locator('.cand-block').first();
  await block.getByLabel('후보 1 선택').check();
  await block.getByLabel('후보 3 선택').check();
  await page.locator('.cand-block').nth(1).getByLabel('후보 2 선택').check();
  // 여러 항목에서 체크한 후보를 한 번에 추가
  await page.getByRole('button', { name: '체크한 문장 일괄 추가' }).click();
  await expect(page.getByText('체크한 문장 3개를 항목별 조합에 추가했습니다.')).toBeVisible();
  await expect(page.locator('nav.subtabs').getByRole('tab', { name: /항목별 조합/ })).toContainText('2');
  await page.evaluate(() => {
    const el = document.querySelectorAll('.cand-block')[0]!.querySelectorAll('.cand-text')[4]!;
    const range = document.createRange();
    range.setStart(el.firstChild!, 0);
    range.setEnd(el.firstChild!, 10);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.locator('.cand-block').first().getByRole('button', { name: '선택한 부분만 추가' }).click();
  await tab(page, /항목별 조합/);
  await expect(page.locator('.comp-block .frag')).toHaveCount(4);
  await expect(page.getByText('추가한 후보 문장을 살펴보고 항목 문장을 직접 고치세요.')).toBeVisible();
  await expect(page.locator('.comp-block .frag.partial')).toHaveCount(1);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '11-compose.png'), fullPage: true });
  // 끌어 놓기: 같은 항목 안 조각 순서, 항목 블록 순서
  const firstBlock = page.locator('.comp-block').first();
  const secondFrag = await firstBlock.locator('.frag').nth(1).innerText();
  await firstBlock.locator('.frag').nth(1).dragTo(firstBlock.locator('.frag').nth(0));
  await expect(firstBlock.locator('.frag').first()).toHaveText(secondFrag);
  const secondName = await page.locator('.comp-block').nth(1).locator('.cand-head b').innerText();
  await page.locator('.comp-block').nth(1).locator('.drag-handle').dragTo(page.locator('.comp-block').first());
  await expect(page.locator('.comp-block').first().locator('.cand-head b')).toHaveText(secondName);

  // 항목별 조합 맨 아래 [항목 문장 취합] → 영역 취합 탭으로 이동
  await page.locator('.obs-save').getByRole('button', { name: '항목 문장 취합' }).click();
  await expect(page.getByText('영역 초안을 만들었습니다.')).toBeVisible();
  await expect(page.locator('nav.subtabs .subtab.on')).toHaveText(/영역 취합/);
  // 영역 취합 칸은 스크롤 없이 내용 전체가 보인다
  const fits = await page.locator('textarea.autogrow').evaluate((t: HTMLTextAreaElement) => t.scrollHeight <= t.clientHeight + 2);
  expect(fits).toBe(true);
  // 영역 취합에서 교사가 1차로 고친 내용은 [최종 윤문]의 초안에 바로 반영된다
  await expect(page.locator('.banner', { hasText: '1차 수정' })).toBeVisible();
  await page.locator('textarea.autogrow').press('End');
  await page.locator('textarea.autogrow').pressSequentially(' 교사가 고친 문장임.');
  await page.waitForTimeout(800);
  await tab(page, '최종 윤문');
  await expect(page.locator('.draft-live')).toContainText('교사가 고친 문장임.');
  // 행특은 연간 900Byte(약 300자)라 500자 목표를 고를 수 없다
  await expect(page.getByRole('button', { name: '500자' })).toBeDisabled();
  await page.getByRole('button', { name: '300자' }).click();
  // AI 요청 오류는 원인과 함께 닫을 때까지 남는 안내 토스트로 알린다
  failNext = true;
  await page.getByRole('button', { name: '윤문 요청' }).click();
  await page.getByLabel('전송 문안을 확인했습니다').check();
  await page.getByRole('button', { name: '이 문안으로 전송' }).click();
  await expect(page.locator('#alert-toast')).toContainText('최종 윤문 실패 · 제공자 서버 혼잡·오류');
  await expect(page.locator('#alert-toast')).toContainText('503');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '10c-error-toast.png') });
  await page.locator('#alert-toast').getByRole('button', { name: '닫기' }).click();
  await expect(page.locator('#alert-toast')).toHaveCount(0);
  await page.getByRole('button', { name: '윤문 요청' }).click();
  await expect(pre).toContainText('공백 포함 약 300자');
  // 행특 900Byte(약 300자) 한도라 상한이 300자로 줄어든다
  await expect(pre).toContainText('분량 범위: 공백 포함 270~300자');
  await page.getByLabel('전송 문안을 확인했습니다').check();
  await page.getByRole('button', { name: '이 문안으로 전송' }).click();
  await expect(page.getByText('윤문 제안을 받았습니다')).toBeVisible();
  // 목표 범위를 벗어나면 분량 보정 요청(직전 결과·부족 글자 수 전달)
  await page.getByRole('button', { name: /분량 맞춰 다시 윤문/ }).click();
  await expect(pre).toContainText('[분량 보정 요청]');
  await expect(pre).toContainText('[직전 윤문 결과]');
  await page.getByLabel('전송 문안을 확인했습니다').check();
  await page.getByRole('button', { name: '이 문안으로 전송' }).click();
  await expect(page.getByText('윤문 제안을 받았습니다')).toBeVisible();
  // 분량 보정은 자동 재요청이 이어질 수 있어 대기 토스트가 사라질 때까지 기다린다
  const t0 = Date.now();
  await expect(page.locator('#busy-toast')).toHaveCount(0, { timeout: 30000 });
  console.log('correction wait ms', Date.now() - t0);
  await page.getByRole('button', { name: '윤문 제안 채택' }).click();
  // 채택하면 다음 탭(최종 본문·검토)으로 바로 넘어간다
  await expect(page.locator('.subtab.on')).toContainText('최종 본문');
  await expect(page.locator('.card.final')).toBeVisible();
  // 행특 학기 구분 표기 넣기 체크는 없다(교사가 본문에 직접 입력)
  await expect(page.getByText('학기 구분 표기')).toHaveCount(0);
  // 최종 본문 재윤문: 교사가 고친 본문을 입력란을 벗어나기 전에 바로 보내도 지금 글로 윤문한다
  const finalTa = page.locator('.card.final textarea').first();
  await finalTa.fill('학급 규칙을 스스로 지키며 친구 말을 끝까지 들음. 교사가 고친 문장임.');
  await page.getByRole('button', { name: '최종 본문 한 번 더 윤문' }).click();
  await expect(pre).toContainText('[교사가 검토·수정한 최종 본문]');
  await expect(pre).toContainText('교사가 고친 문장임.');
  await expect(pre).toContainText('[최종 본문 재윤문 요청]');
  await page.getByLabel('전송 문안을 확인했습니다').check();
  await page.getByRole('button', { name: '이 문안으로 전송' }).click();
  await expect(page.getByText('윤문 제안을 받았습니다')).toBeVisible();
  await expect(page.locator('#busy-toast')).toHaveCount(0, { timeout: 30000 });
  // 채택 전에는 최종 본문이 그대로다
  await expect(page.getByTestId('final-repolish-result')).toBeVisible();
  await expect(finalTa).toHaveValue('학급 규칙을 스스로 지키며 친구 말을 끝까지 들음. 교사가 고친 문장임.');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '11b-final-repolish.png'), fullPage: true });
  const proposal = (await page.getByTestId('final-repolish-result').textContent()) ?? '';
  // 최종 윤문 탭은 재윤문 제안을 초안 윤문으로 보여 주지 않는다
  await tab(page, '최종 윤문');
  await expect(page.getByText('최종 본문·검토 탭에서 받은 재윤문 제안이 있습니다.')).toBeVisible();
  await tab(page, /최종 본문/);
  await page.getByRole('button', { name: '재윤문 제안 채택' }).click();
  await expect(page.getByText('재윤문 제안을 최종 본문으로 옮겼습니다.')).toBeVisible();
  await expect(finalTa).toHaveValue(proposal);
  // 채택한 제안은 닫힌다(채택 뒤 본문을 고쳐도 옛 제안이 '요청 뒤 바뀜'으로 다시 나오지 않게)
  await expect(page.getByTestId('final-repolish-result')).toHaveCount(0);
  await page.locator('.card.final').getByLabel(/관찰 근거와 사실을 확인/).check();
  await page.locator('.card.final').getByRole('button', { name: '검토 완료' }).click();
  await expect(page.getByRole('button', { name: '최종 본문 복사' })).toBeEnabled();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '12-polish-review.png'), fullPage: true });
  // 검토 완료 뒤 다시 고치면 입력란을 벗어나지 않아도 합산 Byte·저장·검토 상태가 바로 바뀐다
  const aggTop = page.locator('.card.final .agg-top b');
  const aggBefore = (await aggTop.textContent()) ?? '';
  await finalTa.focus();
  await page.keyboard.press('End');
  await page.keyboard.type(' 덧붙임.');
  await expect(aggTop).not.toHaveText(aggBefore);
  await expect(page.getByTestId('final-save-state')).toHaveText('저장됨');
  await expect(page.getByText('검토 후 관련 내용이 바뀌어')).toBeVisible();
  await expect(page.getByRole('button', { name: '최종 본문 복사' })).toBeDisabled();
  await expect(finalTa).toBeFocused();
  // 저장 단추는 언제든 누를 수 있다
  await page.keyboard.type(' 한 번 더.');
  await expect(page.getByTestId('final-save')).toBeEnabled();
  await page.getByTestId('final-save').click();
  await expect(page.getByText('최종 본문을 저장했습니다.')).toBeVisible();
  await expect(finalTa).toHaveValue(/덧붙임\. 한 번 더\.$/);
  await expect(page.getByTestId('final-save-state')).toHaveText('저장됨');
  await page.locator('.card.final').getByLabel(/관찰 근거와 사실을 확인/).check();
  await page.locator('.card.final').getByRole('button', { name: '검토 완료' }).click();
  await expect(page.getByRole('button', { name: '최종 본문 복사' })).toBeEnabled();
  // 항목별 조합 전체 삭제(확인 창 수락)
  await tab(page, /항목별 조합/);
  await page.evaluate(() => (window.confirm = () => true));
  await page.getByRole('button', { name: '조합 전체 삭제' }).click();
  await expect(page.getByText('항목별 조합을 모두 지웠습니다.')).toBeVisible();
  await expect(page.locator('.comp-block')).toHaveCount(0);

  await menu(page, /작성 내용 확인 및 출력/);
  // 작업 현황 칸을 누르면 학생별 진행이 펼쳐지고, 이름을 누르면 관찰 기록으로 이동
  await page.locator('.cell', { hasText: '행특 · 1학기' }).click();
  await expect(page.locator('.stu-row')).toHaveCount(2);
  await expect(page.locator('.stu-row', { hasText: '정다은' })).toContainText('검토 완료');
  // 검토 완료 옆에는 글자 수와 Byte를 함께 보여 준다
  await expect(page.locator('.stu-row', { hasText: '정다은' })).toContainText(/검토 완료 · \d+자\(\d+Byte\)/);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '12b-status.png'), fullPage: true });
  await expect(page.locator('.stu-row', { hasText: '최하준' })).toContainText('미작성');
  await page.getByRole('button', { name: /최하준/ }).click();
  await expect(page.locator('.record-head h2')).toContainText('최하준');
  // 학생별 출력: 한 학생의 검토 완료 기록 모음
  await menu(page, /작성 내용 확인 및 출력/);
  await tab(page, '학생별 출력');
  await page.locator('.content select').nth(1).selectOption({ label: '1번 정다은' });
  await expect(page.locator('table.student-export tbody tr')).toHaveCount(1);
  await expect(page.locator('table.student-export')).toContainText('행동특성 및 종합의견');
  await expect(page.getByRole('button', { name: 'XLSX 저장' })).toBeEnabled();
  await menu(page, /작성 내용 확인 및 출력/);
  await tab(page, '작업별 출력');
  await page.locator('.content select').nth(1).selectOption('behavior');
  await expect(page.locator('table.table tbody tr')).toHaveCount(1);
  // 출력 머리글은 제목에 없는 학교급·학년도·학기만 보여 준다(작업·영역은 제목에 있음)
  await expect(page.locator('.card', { hasText: 'XLSX 저장' }).locator('.card-head p')).toHaveText('학교급: 중학교 · 학년도: 2026 · 학기: 1학기');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '13-export.png') });
  // 메뉴5 초안 작성 초기 설정: 입력 학기 2학기 → 진로 기재 제외 일괄 처리, 행특을 학기 구분 없음(연간)으로
  await menu(page, /초안 작성 초기 설정/);
  const work = page.locator('.setup-work').first();
  await work.locator('.setup-sem').getByRole('button', { name: '2학기' }).click();
  await expect(page.getByText(/입력 학기를 2학기로 바꿨습니다/)).toBeVisible();
  await work.locator('.setup-area', { hasText: '진로' }).getByRole('button', { name: '기재 제외 일괄 처리' }).click();
  await page.locator('.modal-back').getByRole('button', { name: '전체 선택' }).click();
  await page.locator('.modal-back').getByRole('button', { name: '적용' }).click();
  await expect(page.getByText(/기재 제외 상태를 2명 바꿨습니다/)).toBeVisible();
  await expect(work.locator('.setup-area', { hasText: '진로' })).toContainText('2명 제외');
  await page.evaluate(() => (window.confirm = () => true));
  await work.locator('.setup-area', { hasText: '행특' }).getByRole('button', { name: '학기 구분 없음' }).click();
  await expect(page.getByText('행특: 학기 구분 없음(연간)으로 바꿨습니다.')).toBeVisible();
  await expect(work.locator('.setup-area', { hasText: '행특' }).getByRole('button', { name: '학기 구분 없음' })).toHaveClass(/on/);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '14-setup.png') });
  // 관찰 기록 화면은 초기 설정의 학기를 보여 주기만 한다
  await menu(page, /관찰 기록 및 초안 작성/);
  await page.locator('.sel-grid').getByRole('button', { name: '진로' }).click();
  await expect(page.locator('.sem-show .chip')).toHaveText('2학기');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '15-write-semester.png') });
  await page.locator('.sel-grid').getByRole('button', { name: '행특' }).click();
  await expect(page.locator('.sem-show .chip')).toHaveText('학기 구분 없음(연간)');
  // 6단계에서는 학기를 바꿀 수 없다(바꾸기 단추 없음)
  await expect(page.locator('.sem-show button')).toHaveCount(0);
  // 5단계: ① 학기 구분이 먼저, 학기별이면 ② 입력 학기(1·2학기)가 보인다
  await menu(page, /초안 작성 초기 설정/);
  const mode = work.locator('.setup-mode');
  await expect(mode).toContainText('① 학기 구분');
  await expect(mode).toContainText('영역마다 다름');
  await mode.getByRole('button', { name: '학기 구분 없음' }).click();
  await expect(page.getByText(/모든 영역을 학기 구분 없음\(연간\)으로 바꿨습니다/)).toBeVisible();
  await expect(work.getByText('② 입력 학기')).toHaveCount(0);
  await mode.getByRole('button', { name: '학기별' }).click();
  await expect(work.getByText('② 입력 학기')).toBeVisible();
  await expect(work.locator('.setup-sem').nth(1).getByRole('button', { name: '2학기' })).toHaveClass(/on/);
  await work.locator('.setup-area', { hasText: '행특' }).getByRole('button', { name: '학기 구분 없음' }).click();
  await expect(work.locator('.setup-area', { hasText: '행특' }).getByRole('button', { name: '학기 구분 없음' })).toHaveClass(/on/);
  await menu(page, /작성 내용 확인 및 출력/);
  await tab(page, '작성 현황');
  await expect(page.locator('.cell', { hasText: '행특 · 연간' })).toBeVisible();
  await expect(page.locator('.cell', { hasText: '행특 · 2학기' })).toHaveCount(0);
  // 메뉴4 담임 학급 탭에는 담임 작업 켜기·끄기가 없다
  await menu(page, /학생 배정/);
  await tab(page, '담임 학급');
  await expect(page.locator('.content').getByRole('button', { name: /담임 작업 (켜기|끄기)/ })).toHaveCount(0);
  // 메뉴3은 만들기·유형만(구성원 선택 없음), 동아리 유형은 정규 2종만, 메뉴4는 구성원 선택만
  await menu(page, /교사 정보 설정/);
  await tab(page, '동아리 설정');
  // 동아리 설정도 교과처럼 단계 상자로 나뉜다
  await expect(page.locator('.content .step-box h3')).toHaveText(['1동아리 만들기', '2만든 동아리 확인']);
  await expect(page.locator('.content select').first().locator('option')).toHaveCount(2);
  await expect(page.locator('.content').getByRole('button', { name: '구성원 선택' })).toHaveCount(0);
  await menu(page, /학생 배정/);
  await tab(page, '담임 학급');
  await expect(page.locator('.content').getByRole('button', { name: '명단 가져오기' })).toHaveCount(0);
  await expect(page.locator('.content').getByRole('button', { name: '구성원 선택' })).toHaveCount(1);
  // 하단 이전/다음: 탭 순서를 따르고 끝에서 앞뒤 메뉴로 넘어간다
  await expect(page.locator('.page-nav')).toContainText('이전: 동아리');
  await expect(page.locator('.page-nav')).toContainText('다음: 초안 작성 초기 설정');
  await page.locator('.page-nav').getByRole('button', { name: /이전: 동아리/ }).click();
  await expect(page.locator('nav.subtabs .subtab.on')).toHaveText(/동아리/);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '17-page-nav.png'), fullPage: true });
  // 백업: 지금 자동 백업 → 이동용 백업(비밀번호) → 백업 폴더 목록 → 자동 백업에서 복원
  await menu(page, /기본설정/);
  await tab(page, '백업·보안');
  await expect(page.locator('.backup-panel')).toContainText('자동 백업 켜짐');
  await page.locator('.content').getByRole('button', { name: '지금 자동 백업' }).click();
  await expect(page.locator('.backup-list')).toContainText('자동(이 PC 전용)');
  await page.getByRole('button', { name: '이동용 백업 만들기' }).click();
  await page.locator('.modal-back input[type=password]').nth(0).fill('backup-pass-1');
  await page.locator('.modal-back input[type=password]').nth(1).fill('backup-pass-1');
  await page.locator('.modal-back').getByRole('button', { name: '확인' }).click();
  await expect(page.locator('.backup-list')).toContainText('이동용(비밀번호)');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '16-backup.png') });
  await page.locator('.backup-list tr', { hasText: '자동(이 PC 전용)' }).getByRole('button', { name: '복원' }).click();
  await page.locator('.modal-back input.input').fill('복원');
  await page.locator('.modal-back').getByRole('button', { name: '확인' }).click();
  await expect(page.locator('#toast')).toContainText('복원했습니다');
  const bdir = path.join(userData, 'backups');
  const bfiles = fs.readdirSync(bdir);
  expect(bfiles.some((f) => f.startsWith('mitgeul_backup_') && f.endsWith('.sgauto'))).toBe(true);
  expect(bfiles.some((f) => f.startsWith('이동용백업_') && f.endsWith('.sgbak'))).toBe(true);
  for (const f of bfiles) expect(fs.readFileSync(path.join(bdir, f), 'utf8')).not.toContain('정다은');
  expect(errors).toEqual([]);
  await app.close();
  server.close();
  // 앱을 닫을 때도 자동 백업이 남는다
  expect(fs.readdirSync(bdir).some((f) => f.endsWith('.sgauto'))).toBe(true);
  // Gemini 키 파일은 평문 키를 담지 않는다(Windows 계정 보호로 암호화)
  const keys = fs.readFileSync(path.join(userData, 'keys.json'), 'utf8');
  expect(keys).not.toContain('AIzaTEST');
});
