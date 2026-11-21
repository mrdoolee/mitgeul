import { randomUUID } from 'node:crypto';
import { anonymizeFields, AnonymizationError, nameVariants, residualNames } from '../core/anonymize';
import { eventLabel } from '../core/events';
import { areaLabel, toneFindings } from '../core/rules';
import { aggregationStatus, checkContext, evidenceHash, evidenceItemIds, generationGate, isAnnual, nowIso, sha, studentOf, workRefs } from '../core/model';
import {
  CANDIDATE_SCHEMA,
  candidateSystemPrompt,
  candidateUserPrompt,
  expandInstruction,
  shrinkInstruction,
  toneInstruction,
  expandSystemPrompt,
  POLISH_SCHEMA,
  polishRange,
  polishSystemPrompt,
  polishUserPrompt,
  previewText,
  type Rubric,
} from '../core/prompts';
import { extractJson, parseCandidates, parsePolish } from '../core/responses';
import { FREE_ITEM_ID, type AppData, type Effort, type PolishSource, type Provider, type RecordEntry, type Target } from '../core/schema';
import { callProvider, ProviderError, type CallOptions, type CliRuntime } from './providers';

/** 윤문 결과를 적용해도 되는지 판단하는 기준(초안·목표·관찰·행사·맥락, 최종 본문 재윤문이면 최종 본문도) */
function polishBasis(d: AppData, r: RecordEntry, source: PolishSource = 'draft'): string {
  const ev = r.eventObs.map((e) => ({ e, def: d.events.find((x) => x.id === e.eventId) }));
  return sha({ draft: r.draft, target: r.target, obs: r.observations, ev, ctx: r.context, free: r.freeNote, ...(source === 'final' ? { final: r.finalText } : {}) });
}
/** 윤문에 보내는 글 */
const polishSourceText = (r: RecordEntry, source: PolishSource) => (source === 'final' ? r.finalText : r.draft);

/** 저장된 학생 참조 표식({{학생:ID}})을 이름으로 되돌린 뒤 익명화한다. 영구 학생 ID가 외부로 나가지 않게 한다. */
function markersToNames(text: string, d: AppData): string {
  return text.replace(/\{\{학생:([^}]+)\}\}/g, (_m, id) => d.students.find((s) => s.id === id)?.name ?? '학생');
}

/** 대기 요청: 교사가 확인할 실제 전송 문안과, 응답을 원래 기록에 묶을 정보. 임시 대응표는 메모리에만 있다. */
interface Pending {
  id: string;
  kind: 'candidates' | 'polish';
  recordId: string;
  studentId: string;
  itemIds: string[];
  /** 요청 안에서만 쓰는 항목ID → 실제 항목ID(행사는 event-1 같은 짧은 ID로 보낸다) */
  idMap: Record<string, string>;
  evidence: Record<string, string>;
  polishBasis?: string;
  /** 윤문에 보낸 글(초안 또는 최종 본문) */
  polishSource?: PolishSource;
  target?: Target;
  /** 윤문 분량 범위(공백 포함 글자 수). 하한에 못 미치면 자동으로 늘리기 요청을 한다. */
  range?: { min: number; max: number };
  /** 분량 자동 보정이 오류로 중단된 경우 안내 */
  correctionNote?: string;
  expandBase?: string;
  expandSystem?: string;
  system: string;
  user: string;
  tokenMap: Map<string, string>;
  provider: Provider;
  model: string;
  /** 준비 시점 설정의 추론 강도(CLI 제공자만). 없으면 CLI 기본값. */
  effort?: Effort;
  createdAt: number;
  state: 'waiting' | 'sending' | 'cancelled';
  controller?: AbortController;
}

function polishRawText(raw: string): string {
  try {
    const j = extractJson(raw) as { text?: unknown };
    return typeof j?.text === 'string' ? j.text : '';
  } catch {
    return '';
  }
}
/** 응답 본문 글자 수(공백 포함). 해석 실패는 -1. */
function polishLen(raw: string): number {
  const t = polishRawText(raw);
  return t ? [...t].length : -1;
}

export interface PreparedRequest {
  requestId: string;
  kind: Pending['kind'];
  provider: Provider;
  model: string;
  autoModel: boolean;
  preview: string;
  replaced: { from: string; token: string }[];
  bytes: number;
}

export interface LlmDeps {
  getData(): AppData;
  commit(mutate: (d: AppData) => void): Promise<void>;
  rubric: Rubric;
  styleGuide: string;
  /** Gemini(API 키 방식) 키. CLI 제공자(Claude·ChatGPT)는 쓰지 않는다. */
  apiKey?(p: Provider): Promise<string>;
  /** 교사가 고른 모델, 비어 있으면 자동 선택 결과. 미리 보기에 그대로 보여 준다. */
  resolveModel(p: Provider, chosen: string): Promise<{ model: string; auto: boolean }>;
  /** 개발·시험 전용 CLI 대체 실행 파일·환경(패키징된 앱에서는 넘기지 않는다) */
  cli?: CliRuntime;
}

export class LlmService {
  private pending = new Map<string, Pending>();
  constructor(private deps: LlmDeps) {}

  private record(d: AppData, recordId: string): RecordEntry {
    const r = d.records.find((x) => x.id === recordId);
    if (!r) throw new Error('기록을 찾을 수 없습니다.');
    return r;
  }

  private async finalizePrepare(p: Omit<Pending, 'id' | 'createdAt' | 'state' | 'model' | 'effort'>, replaced: PreparedRequest['replaced']): Promise<PreparedRequest> {
    const d = this.deps.getData();
    const payload = `${p.system}\n${p.user}`;
    if (/\{\{학생:/.test(payload)) throw new AnonymizationError('전송 문안에 학생 참조 표식이 남아 있습니다.');
    if (d.students.some((s) => s.id.length >= 6 && payload.includes(s.id))) throw new AnonymizationError('전송 문안에 학생 내부 ID가 들어 있습니다.');
    const leftovers = residualNames(payload, d.students);
    if (leftovers.length) throw new AnonymizationError(`전송 문안에 명단 이름이 남아 있습니다: ${leftovers.join(', ')}`);
    const chosen = d.settings.models[p.provider] ?? '';
    const { model, auto } = await this.deps.resolveModel(p.provider, chosen);
    const effort = p.provider === 'gemini' ? undefined : d.settings.efforts?.[p.provider] || undefined;
    const id = randomUUID();
    // 같은 기록의 이전 대기 요청은 폐기한다.
    for (const [k, v] of this.pending) if (v.recordId === p.recordId && v.kind === p.kind && v.state === 'waiting') this.pending.delete(k);
    this.pending.set(id, { ...p, model, effort, id, createdAt: Date.now(), state: 'waiting' });
    const preview = previewText(p.system, p.user);
    return { requestId: id, kind: p.kind, provider: p.provider, model, autoModel: auto, preview, replaced, bytes: Buffer.byteLength(preview, 'utf8') };
  }

  async prepareCandidates(recordId: string, onlyItemIds?: string[]): Promise<PreparedRequest> {
    const d = this.deps.getData();
    const r = this.record(d, recordId);
    const gate = generationGate(d, r);
    if (!gate.ok) throw new Error(gate.reasons.join(' / '));
    const st = studentOf(d, r.studentId)!;
    const refs = workRefs(d, r.workId)!;
    const items = this.deps.rubric.areas[r.area].items;
    const obs = r.observations.filter((o) => !onlyItemIds || onlyItemIds.includes(o.itemId));
    const evs = r.eventObs.filter((e) => !onlyItemIds || onlyItemIds.includes(e.eventId));
    const free = r.freeNote.trim() && (!onlyItemIds || onlyItemIds.includes(FREE_ITEM_ID)) ? r.freeNote : '';
    if (!obs.length && !evs.length && !free) throw new Error('요청할 항목이 없습니다.');
    const input = {
      level: st.schoolLevel,
      grade: st.grade,
      area: r.area,
      semester: r.semester,
      annual: isAnnual(d, r.workId, r.area),
      subjectName: refs.subject?.name,
      termType: refs.courseGroup?.termType,
      clubType: refs.club?.clubType,
      context: markersToNames(r.context, d),
      items: obs.map((o) => {
        const it = items.find((x) => x.id === o.itemId);
        if (!it) throw new Error(`루브릭 항목을 찾을 수 없습니다: ${o.itemId}`);
        return {
          requestItemId: o.itemId,
          category: it.category,
          name: it.name,
          lookFor: it.lookFor,
          score: o.score,
          scoreLabel: this.deps.rubric.scale[o.score - 1]!,
          levelMeaning: it.levels[o.score - 1]!,
          example: markersToNames(o.example, d),
        };
      }),
      events: evs.map((e) => {
        const def = d.events.find((x) => x.id === e.eventId);
        if (!def) throw new Error('선택한 행사를 찾을 수 없습니다.');
        return { requestItemId: `event-${evs.indexOf(e) + 1}`, label: eventLabel(def), description: markersToNames(def.description, d), note: markersToNames(e.note, d) };
      }),
      free: free ? { requestItemId: FREE_ITEM_ID, note: markersToNames(free, d) } : undefined,
    };
    const freeIds = free ? [FREE_ITEM_ID] : [];
    const s = this.deps.getData().settings;
    // 시스템 지시와 요청 본문 전체를 같은 대응표로 익명화한다(루브릭 문구에 이름과 같은 단어가 있어도 남지 않게).
    const anon = anonymizeFields([candidateSystemPrompt(st.schoolLevel, d.settings.bannedTerms), candidateUserPrompt(input)], d.students, r.studentId);
    return this.finalizePrepare(
      {
        kind: 'candidates',
        recordId,
        studentId: r.studentId,
        itemIds: [...freeIds, ...obs.map((o) => o.itemId), ...evs.map((e) => e.eventId)],
        idMap: Object.fromEntries([...freeIds.map((x) => [x, x]), ...obs.map((o) => [o.itemId, o.itemId]), ...evs.map((e, i) => [`event-${i + 1}`, e.eventId])]),
        evidence: Object.fromEntries([...freeIds, ...obs.map((o) => o.itemId), ...evs.map((e) => e.eventId)].map((id) => [id, evidenceHash(d, r, id)])),
        system: anon.texts[0]!,
        user: anon.texts[1]!,
        tokenMap: anon.map,
        provider: s.provider,
      },
      anon.replaced,
    );
  }

  /**
   * refine: 직전 윤문 결과가 분량 범위를 벗어났을 때 교사가 요청하는 분량 보정(직전 결과와 부족·초과 글자 수를 함께 보낸다).
   * source: 'draft'는 영역 초안을, 'final'은 최종 본문·검토 단계에서 교사가 고친 최종 본문을 다시 윤문한다.
   */
  async preparePolish(recordId: string, refine = false, source: PolishSource = 'draft'): Promise<PreparedRequest> {
    const d = this.deps.getData();
    const r = this.record(d, recordId);
    if (r.mode !== 'normal') throw new Error('사유 입력·기재 제외 기록은 윤문하지 않습니다.');
    const text = polishSourceText(r, source);
    if (!text.trim()) throw new Error(source === 'final' ? '최종 본문이 비어 있습니다.' : '영역 초안을 먼저 취합하세요.');
    if (!r.target) throw new Error(source === 'final' ? '목표 글자 수(150/300/500자)를 [최종 윤문] 탭에서 먼저 고르세요.' : '목표 글자 수(150/300/500자)를 선택하세요.');
    const st = studentOf(d, r.studentId)!;
    const refs = workRefs(d, r.workId)!;
    const items = this.deps.rubric.areas[r.area].items;
    const evidence = r.observations.map((o) => {
      const it = items.find((x) => x.id === o.itemId);
      const meaning = it ? ` — 살펴본 행동: ${it.lookFor} — 점수 의미: ${it.levels[o.score - 1]}` : '';
      return `${it?.name ?? o.itemId}: ${o.score}/5(${this.deps.rubric.scale[o.score - 1]})${meaning}${o.example.trim() ? ` — 교사 사례: ${o.example.trim()}` : ' — 교사 사례 없음(구체적 사건을 만들지 말 것)'}`;
    });
    if (r.freeNote.trim()) evidence.unshift(`자율 작성 관찰: ${r.freeNote.trim()}`);
    for (const e of r.eventObs) {
      const def = d.events.find((x) => x.id === e.eventId);
      if (def) evidence.push(`행사 ${eventLabel(def)}${def.description.trim() ? ` — 내용: ${def.description.trim()}` : ''}${e.note.trim() ? ` — 학생 사례: ${e.note.trim()}` : ' — 학생 사례 없음(참여 사실만)'}`);
    }
    if (r.context.trim()) evidence.unshift(`활동/과목 맥락: ${r.context.trim()}`);
    // 남은 Byte: 이 기록을 비운 상태의 합산 기준으로 계산
    const agg = aggregationStatus(d, { ...r, finalText: '' });
    const remaining = Math.max(0, agg.remaining);
    const s = d.settings;
    const user = polishUserPrompt({
      level: st.schoolLevel,
      grade: st.grade,
      area: r.area,
      semester: r.semester,
      annual: isAnnual(d, r.workId, r.area),
      subjectName: refs.subject?.name,
      target: r.target,
      remainingBytes: remaining,
      limitLabel: agg.info.label,
      draft: markersToNames(text, d),
      previous: refine && r.polish && r.polish.basis === source && r.polish.sourceText === text && r.polish.target === r.target ? markersToNames(r.polish.resultText, d) : undefined,
      fromFinal: source === 'final',
      evidence: evidence.map((e) => markersToNames(e, d)),
    });
    // 늘리기 요청용 자료: 초안 없이 근거만 준다(초안이 있으면 모델이 직전 결과를 그대로 되풀이하기 쉽다)
    const expandBase = ['<자료>', `영역: ${areaLabel(r.area, st.grade)}`, '[사용한 관찰 근거]', ...evidence.map((e) => `- ${markersToNames(e, d)}`), '</자료>'].join('\n');
    const anon = anonymizeFields([polishSystemPrompt(st.schoolLevel, this.deps.styleGuide, d.settings.bannedTerms), user, expandBase, expandSystemPrompt(st.schoolLevel, d.settings.bannedTerms)], d.students, r.studentId);
    return this.finalizePrepare(
      {
        kind: 'polish',
        recordId,
        studentId: r.studentId,
        itemIds: [],
        idMap: {},
        evidence: {},
        polishBasis: polishBasis(d, r, source),
        polishSource: source,
        target: r.target,
        range: polishRange(r.target, remaining),
        expandBase: anon.texts[2]!,
        expandSystem: anon.texts[3]!,
        system: anon.texts[0]!,
        user: anon.texts[1]!,
        tokenMap: anon.map,
        provider: s.provider,
      },
      anon.replaced,
    );
  }

  cancel(requestId: string): void {
    const p = this.pending.get(requestId);
    if (!p) return;
    p.state = 'cancelled';
    p.controller?.abort();
    this.pending.delete(requestId);
  }

  /** 교사가 확인한 요청만 같은 문안으로 전송한다. 응답 적용 전 기록·근거가 바뀌었으면 적용하지 않는다. */
  async send(requestId: string): Promise<{ applied: string[]; failed: Record<string, string>; discarded: string[]; message: string }> {
    const p = this.pending.get(requestId);
    if (!p || p.state !== 'waiting') throw new Error('확인할 요청이 없거나 이미 처리되었습니다. 다시 요청하세요.');
    p.state = 'sending';
    p.controller = new AbortController();
    const d0 = this.deps.getData();
    const forbidden = nameVariants(d0.students).variants.map((v) => v.text);
    const opts: CallOptions = {
      provider: p.provider,
      apiKey: p.provider === 'gemini' ? ((await this.deps.apiKey?.(p.provider)) ?? '') : undefined,
      model: p.model,
      effort: p.effort,
      confirmed: { system: p.system, user: p.user, forbidden },
      schema: (p.kind === 'candidates' ? CANDIDATE_SCHEMA : POLISH_SCHEMA) as unknown as Record<string, unknown>,
      schemaName: p.kind === 'candidates' ? 'candidates' : 'polish',
      signal: p.controller.signal,
      ...(this.deps.cli ?? {}),
    };
    try {
      let res = await callProvider(opts);
      // 윤문이 범위를 벗어나면 자동으로 다시 요청한다. 짧으면 문장별 늘리기(최대 3번), 길면 줄이기(최대 2번).
      if (p.kind === 'polish' && p.range) {
        const range = p.range;
        const off = (n: number) => (n < 0 ? Infinity : n < range.min ? range.min - n : n > range.max ? n - range.max : 0);
        let best = res;
        let bestLen = polishLen(res.text);
        let shrinks = 0;
        let retries = 0;
        // 가벼운 모델은 한 번에 맞추지 못하는 일이 많아 최대 4번 보정한다(2026-11-16 재현: flash-lite 첫 결과 183~330자).
        for (let i = 0; i < 4 && bestLen >= 0 && off(bestLen) > 0; i++) {
          const longer = bestLen > range.max;
          if (longer && ++shrinks > 2) break;
          if (p.state !== 'sending' || !this.pending.has(requestId)) break;
          const cur = this.deps.getData().records.find((x) => x.id === p.recordId);
          if (!cur || polishBasis(this.deps.getData(), cur, p.polishSource) !== p.polishBasis) break;
          const prev = polishRawText(best.text);
          const user = `${p.expandBase ?? p.user}\n\n${longer ? shrinkInstruction(prev, range) : expandInstruction(prev, range)}`;
          try {
            const next = await callProvider({ ...opts, confirmed: { ...opts.confirmed, system: longer ? opts.confirmed.system : (p.expandSystem ?? opts.confirmed.system), user } });
            const n = polishLen(next.text);
            if (process.env.SGB_DEBUG) console.log("expand step", i + 1, bestLen, "->", n);
            if (off(n) < off(bestLen)) {
              best = next;
              bestLen = n;
            }
          } catch (e) {
            if (e instanceof ProviderError && e.code === 'cancelled') throw e;
            // 혼잡(503)·한도(429)·네트워크·시간 초과는 잠시 쉬었다가 같은 단계를 다시 시도한다(최대 2번). 그 밖의 오류는 멈춘다.
            const transient = e instanceof ProviderError && ['server', 'rate', 'network', 'timeout'].includes(e.code);
            if (!transient || retries >= 2) {
              p.correctionNote = '분량 자동 보정 중 AI 응답 오류로 멈췄습니다.';
              break;
            }
            retries++;
            i--;
            await new Promise((ok) => setTimeout(ok, 2500 * retries));
          }
        }
        res = best;
      }
      // 교육적 관점 자동 보정(2026-11-17 사용자 결정): 윤문 결과에 부정적 표현이 남으면 한 번 더 고쳐 쓰게 한다.
      // 남은 표현이 줄고 분량이 범위에서 크게 벗어나지 않을 때만 바꾼다. 그래도 남으면 검토 화면에 경고가 뜬다.
      if (p.kind === 'polish' && p.state === 'sending' && this.pending.has(requestId)) {
        const prev = polishRawText(res.text);
        const hits = toneFindings(prev).map((f) => f.match);
        const cur = this.deps.getData().records.find((x) => x.id === p.recordId);
        if (hits.length && cur && polishBasis(this.deps.getData(), cur, p.polishSource) === p.polishBasis) {
          try {
            const next = await callProvider({ ...opts, confirmed: { ...opts.confirmed, user: `${p.expandBase ?? p.user}\n\n${toneInstruction(prev, hits, p.range)}` } });
            const nextText = polishRawText(next.text);
            const n = polishLen(next.text);
            const r = p.range;
            // 분량은 직전 결과보다 범위에서 크게(상한의 10% 넘게) 더 벗어나지 않으면 된다(직전 결과가 이미 짧은 경우가 많다).
            const off = (x: number) => (!r ? 0 : x < r.min ? r.min - x : x > r.max ? x - r.max : 0);
            const lenOk = n >= 0 && (!r || off(n) <= off(polishLen(res.text)) + Math.round(r.max * 0.1));
            if (lenOk && toneFindings(nextText).length < hits.length) res = next;
          } catch (e) {
            if (e instanceof ProviderError && e.code === 'cancelled') throw e;
          }
        }
      }
      if (p.state !== 'sending' || !this.pending.has(requestId)) {
        return { applied: [], failed: {}, discarded: p.itemIds, message: '취소된 요청의 늦은 응답을 버렸습니다.' };
      }
      return await this.apply(p, res.text, res.model);
    } catch (e) {
      if (e instanceof ProviderError && e.code === 'cancelled') return { applied: [], failed: {}, discarded: p.itemIds, message: '요청을 취소했습니다.' };
      throw e;
    } finally {
      this.pending.delete(requestId);
    }
  }

  private async apply(p: Pending, raw: string, model: string) {
    const applied: string[] = [];
    const discarded: string[] = [];
    let failed: Record<string, string> = {};
    let message = '';
    if (p.kind === 'candidates') {
      const parsed = parseCandidates(raw, Object.keys(p.idMap), p.tokenMap);
      const real = (k: string) => p.idMap[k] ?? k;
      failed = Object.fromEntries([...parsed.failed].map(([k, v]) => [real(k), v]));
      await this.deps.commit((d) => {
        const r = d.records.find((x) => x.id === p.recordId);
        if (!r) {
          discarded.push(...p.itemIds);
          return;
        }
        for (const [reqId, texts] of parsed.ok) {
          const itemId = real(reqId);
          if (!evidenceItemIds(r).includes(itemId) || evidenceHash(d, r, itemId) !== p.evidence[itemId]) {
            discarded.push(itemId);
            continue;
          }
          r.candidates = r.candidates.filter((c) => c.itemId !== itemId);
          r.candidates.push({ itemId, texts, evidenceHash: p.evidence[itemId]!, provider: p.provider, model, createdAt: nowIso() });
          applied.push(itemId);
        }
        r.updatedAt = nowIso();
      });
      message = `후보 저장 ${applied.length}개 항목` + (Object.keys(failed).length ? `, 실패 ${Object.keys(failed).length}개` : '') + (discarded.length ? `, 근거가 바뀌어 버린 항목 ${discarded.length}개` : '');
    } else {
      const parsed = parsePolish(raw, p.tokenMap);
      if (!parsed.ok) return { applied, failed: { polish: parsed.error }, discarded, message: parsed.error };
      await this.deps.commit((d) => {
        const r = d.records.find((x) => x.id === p.recordId);
        if (!r || polishBasis(d, r, p.polishSource) !== p.polishBasis) {
          discarded.push('polish');
          return;
        }
        const source = p.polishSource ?? 'draft';
        r.polish = { sourceText: polishSourceText(r, source), resultText: parsed.text, suggestions: parsed.suggestions, target: p.target!, provider: p.provider, model, createdAt: nowIso(), basis: source };
        r.updatedAt = nowIso();
        applied.push('polish');
      });
      message = discarded.length ? `요청 뒤 ${p.polishSource === 'final' ? '최종 본문·' : ''}초안·목표·근거가 바뀌어 윤문 결과를 적용하지 않았습니다. 다시 요청하세요.` : `윤문 제안을 받았습니다. 비교 후 채택하세요.${p.correctionNote ? ` ${p.correctionNote}` : ''}`;
    }
    return { applied, failed, discarded, message };
  }

  /** 시험·화면용: 이 요청이 사용할 금지 이름 수 */
  forbiddenCount(): number {
    return nameVariants(this.deps.getData().students).variants.length;
  }

  checkContextFor(recordId: string) {
    const d = this.deps.getData();
    return checkContext(d, this.record(d, recordId));
  }
}
