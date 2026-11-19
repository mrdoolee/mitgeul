import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/core/actions';
import type { Rubric } from '../src/core/prompts';
import type { AppData, Provider } from '../src/core/schema';
import { LlmService } from '../src/main/llm';
import { cliStatus, listModels, pickAutoModel, testModel } from '../src/main/providers';
import { baseData } from './fixtures';

/**
 * 실제 호출 시험(선택, 가상 학생 자료만 전송).
 * - Gemini: 저장소 루트 .env의 GEMINI_API_KEY가 있을 때(API 키 방식)
 * - Claude·ChatGPT: 이 PC에 Claude Code·Codex CLI가 설치·로그인되어 있을 때(구독 CLI)
 * 실행: npm run test:live (또는 LIVE_PROVIDERS=gemini,anthropic npm run test:live)
 */
function envKey(name: string): string {
  // 개발용 키 파일: MITGEUL_ENV_FILE 또는 저장소 루트의 .env(저장소에는 올리지 않음)
  const p = process.env.MITGEUL_ENV_FILE ? path.resolve(process.env.MITGEUL_ENV_FILE) : path.resolve(__dirname, '../../.env');
  if (!fs.existsSync(p)) return '';
  const line = fs.readFileSync(p, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : '';
}
const GEMINI_KEY = envKey('GEMINI_API_KEY');
const WANT = (process.env.LIVE_PROVIDERS ?? 'gemini,anthropic,openai').split(',') as Provider[];
const READY: Record<Provider, boolean> = {
  gemini: WANT.includes('gemini') && !!GEMINI_KEY,
  anthropic: WANT.includes('anthropic') && (await cliStatus('anthropic')).loggedIn,
  openai: WANT.includes('openai') && (await cliStatus('openai')).loggedIn,
};
const rubric: Rubric = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../resources/rubrics/2026-middle-rubric-v1.json'), 'utf8'));
const styleGuide = fs.readFileSync(path.resolve(__dirname, '../resources/prompts/polish-style.md'), 'utf8');

describe.each(['gemini', 'anthropic', 'openai'] as Provider[])('실제 호출: %s', (provider) => {
  it.skipIf(!READY[provider])('모델 목록 → 모델 테스트 → 후보 생성 → 윤문(150/300/500) → 분량 보정', async () => {
    const env = { apiKey: provider === 'gemini' ? GEMINI_KEY : undefined };
    const models = await listModels(provider, env);
    expect(models.length).toBeGreaterThan(0);
    // LIVE_GEMINI_MODEL: 권장 모델이 제공자 쪽 한도·혼잡(429/503)일 때 다른 Gemini 모델로 시험
    const model = (provider === 'gemini' && process.env.LIVE_GEMINI_MODEL) || pickAutoModel(provider, models)!;
    const t = await testModel(provider, model, env);
    console.log(provider, 'auto model', model, 'test ms', t.ms);
    let d: AppData = baseData('middle');
    d.settings.provider = provider;
    d.settings.models = { gemini: '', openai: '', anthropic: '', [provider]: model } as AppData['settings']['models'];
    const act = (n: string, p: unknown) => {
      const r = applyAction(d, n, p);
      d = r.data;
      return r.result as string;
    };
    const recordId = act('record.ensure', { studentId: 's1', workId: 'w-home', area: 'behavior', semester: 1 });
    const ev = act('event.create', { workId: 'w-home', area: 'behavior', semester: 1, name: '체육한마당', period: '2026.05.08.', quantity: '', description: '학급 대항 단체 줄넘기와 이어달리기' });
    act('record.setObservations', { recordId, context: '학급 회의 안건 정리', observations: [{ itemId: 'behavior-01', score: 4, example: '김민준이 학급 규칙 개정안을 정리해 발표함' }, { itemId: 'behavior-08', score: 3, example: '' }], eventObs: [{ eventId: ev, note: '단체 줄넘기에서 박자를 세며 줄 돌리는 친구와 속도를 맞춤' }] });
    const svc = new LlmService({ getData: () => d, commit: async (m) => { const c = structuredClone(d); m(c); d = c; }, rubric, styleGuide, apiKey: async () => GEMINI_KEY, resolveModel: async (_p, c) => ({ model: c || model, auto: !c }) });
    const prep = await svc.prepareCandidates(recordId);
    expect(prep.preview).not.toContain('김민준');
    const out = await svc.send(prep.requestId);
    console.log(provider, model, out.message, JSON.stringify(out.failed));
    expect(out.applied.length).toBe(3);
    const r = d.records.find((x) => x.id === recordId)!;
    console.log(r.candidates.map((c) => `${c.itemId}: ${c.texts[0]}`).join('\n'));
    act('composition.add', { recordId, itemId: 'behavior-01', fragments: r.candidates[0]!.texts.slice(0, 2).map((t, i) => ({ text: t, source: { kind: 'candidate', itemId: r.candidates[0]!.itemId, index: i, evidenceHash: r.candidates[0]!.evidenceHash, partial: false } })) });
    act('record.assemble', { recordId });
    act('record.setTarget', { recordId, target: 500 });
    const pp = await svc.preparePolish(recordId);
    const po = await svc.send(pp.requestId);
    const rec2 = d.records.find((x) => x.id === recordId)!;
    console.log(provider, po.message, 'draft', [...rec2.draft].length, '자 → result', [...(rec2.polish?.resultText ?? '')].length, '자 (목표 500, 자동 늘리기 포함)', rec2.polish?.resultText);
    expect(po.applied).toEqual(['polish']);
    for (const t of [150, 300] as const) {
      act('record.setTarget', { recordId, target: t });
      const q = await svc.preparePolish(recordId);
      await svc.send(q.requestId);
      console.log(provider, `목표 ${t} → result`, [...(d.records.find((x) => x.id === recordId)!.polish?.resultText ?? '')].length, '자');
    }
    act('record.setTarget', { recordId, target: 500 });
    await svc.send((await svc.preparePolish(recordId)).requestId);
    const pr = await svc.preparePolish(recordId, true);
    expect(pr.preview).toContain('[분량 보정 요청]');
    const pro = await svc.send(pr.requestId);
    console.log(provider, 'refine msg', pro.message, JSON.stringify(pro.failed));
    const rec3 = d.records.find((x) => x.id === recordId)!;
    console.log(provider, '분량 보정 → result', [...(rec3.polish?.resultText ?? '')].length, '자 (목표 500)');
  }, 1_200_000);
});
