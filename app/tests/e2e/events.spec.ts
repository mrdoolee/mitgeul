import { _electron as electron, expect, test } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fakeCliEnv, menu, saveKey, setupHomeroom, tab } from './helpers';

const SHOTS = process.env.SHOTS_DIR;

test('자율·자치 행사: 빠른 추가 → 학급 전체 참여 → 학생 사례 → 행사 후보 생성', async () => {
  const bodies: string[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      bodies.push(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      const ids = [...body.matchAll(/항목ID: ([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
      const text = JSON.stringify({ items: ids.map((id) => ({ itemId: id, candidates: [1, 2, 3, 4, 5].map((n) => `학교폭력예방교육(2026.03.12.)에 참여해 상황극에서 피해 학생 역할을 맡아 대처 방법을 발표함 ${n}.`) })) });
      // Gemini는 API 키 방식(HTTP generateContent)이다
      if (req.method === 'GET') return res.end(JSON.stringify({ models: [{ name: 'models/gemini-9.9-flash-lite', supportedGenerationMethods: ['generateContent'] }] }));
      if (req.url?.includes(':generateContent')) return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }));
      res.end(JSON.stringify({ text }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'sgb-ev-'));
  const app = await electron.launch({ args: [path.resolve(__dirname, '../../dist/main/main.js')], env: { ...process.env, MITGEUL_USER_DATA: userData, ...fakeCliEnv(base), MITGEUL_LLM_BASE: base } });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize({ width: 1440, height: 920 });

  await setupHomeroom(page, 1, '번호\t이름\n1\t한가람\n2\t공지원\n3\t서누리');
  await saveKey(page, 'test-key-abcdefghijk');

  await menu(page, /관찰 기록 및 초안 작성/);
  await page.getByRole('button', { name: '자율·자치' }).click();
  await expect(page.getByText('참여한 행사·활동 선택')).toBeVisible();
  await page.getByRole('button', { name: '학교폭력예방교육' }).click();
  await expect(page.getByLabel('학교폭력예방교육 참여 선택')).toBeChecked();
  await page.locator('.event-item').first().getByRole('button', { name: '수정' }).click();
  await page.locator('.modal input').nth(1).fill('2026.03.12.');
  await page.locator('.modal').getByRole('button', { name: '저장' }).click();
  await page.locator('.event-item').first().getByRole('button', { name: '학급 전체 참여' }).click();
  await expect(page.getByText(/명에게 참여로 추가했습니다/)).toBeVisible();
  // 잘못 눌렀으면 학급 전체 해제
  await page.locator('.event-item').first().getByRole('button', { name: '학급 전체 해제' }).click();
  await expect(page.getByText(/명의 참여 선택을 해제했습니다/)).toBeVisible();
  await expect(page.getByLabel('학교폭력예방교육 참여 선택')).not.toBeChecked();
  await page.locator('.event-item').first().getByRole('button', { name: '학급 전체 참여' }).click();
  await expect(page.getByText(/명에게 참여로 추가했습니다/)).toBeVisible();
  await page.getByLabel('학교폭력예방교육 참여 선택').check();
  await page.getByLabel('학교폭력예방교육 학생 사례').fill('상황극에서 피해 학생 역할을 맡아 대처 방법을 발표하고 모둠 친구들을 지원함');
  await page.getByRole('button', { name: '관찰 저장' }).click();
  await expect(page.getByText('관찰을 저장했습니다.')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '14-events.png') });

  // 전송 문안 확인 창 기본 꺼짐: 바로 전송된다.
  await tab(page, /AI 후보/);
  await page.getByRole('button', { name: '후보 생성 요청' }).click();
  await expect(page.getByText('후보 저장 1개 항목')).toBeVisible();
  await expect(page.locator('pre.preview')).toHaveCount(0);
  const sent = bodies.filter((b) => b.includes('[행사·활동]'));
  expect(sent.length).toBe(1);
  expect(sent[0]).toContain('학교폭력예방교육(2026.03.12.)');
  expect(sent[0]).not.toContain('한가람');
  // 학생 '공지원'이 있어도 일반 단어 '지원함'은 그대로 보내고 막지 않는다
  expect(sent[0]).toContain('지원함');
  await expect(page.locator('.cand-head b').first()).toHaveText('행사 · 학교폭력예방교육(2026.03.12.)');
  await page.locator('.cand-block').first().getByLabel('후보 2 선택').check();
  await page.locator('.cand-block').first().getByRole('button', { name: '체크한 문장 추가' }).click();
  await tab(page, /항목별 조합/);
  await expect(page.locator('.comp-block .frag')).toHaveCount(1);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '15-event-candidates.png'), fullPage: true });

  // 다음 학생도 학급 전체 참여로 선택되어 있음
  await page.getByRole('button', { name: '다음 학생' }).click();
  await tab(page, '관찰 기록');
  await expect(page.getByLabel('학교폭력예방교육 참여 선택')).toBeChecked();
  // 선택한 학생이 있어도 확인 후 행사 삭제([수정] 옆 [삭제] 버튼)
  page.once('dialog', (dl) => void dl.dismiss());
  await page.locator('.event-item').first().getByRole('button', { name: /행사 삭제$/ }).click();
  await expect(page.locator('.event-item')).toHaveCount(1);
  page.once('dialog', (dl) => void dl.accept());
  await page.locator('.event-item').first().getByRole('button', { name: /행사 삭제$/ }).click();
  await expect(page.getByText('행사를 삭제했습니다.')).toBeVisible();
  await expect(page.locator('.event-item')).toHaveCount(0);
  expect(errors).toEqual([]);
  await app.close();
  server.close();
});
