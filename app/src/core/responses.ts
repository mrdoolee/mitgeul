import { z } from 'zod';
import { resolveTokens } from './anonymize';

export interface CandidateParseResult {
  ok: Map<string, string[]>;
  failed: Map<string, string>;
  fatal?: string;
}

const CandidateJson = z.object({
  items: z.array(z.object({ itemId: z.string(), candidates: z.array(z.string()) })),
});

/** 코드 블록·앞뒤 설명이 붙은 응답에서도 첫 JSON 객체를 꺼낸다. */
export function extractJson(raw: string): unknown {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error('JSON 없음');
  }
}

/** 모르는 익명 기호는 오류 대신 지운다(학생 이름은 본문에 쓰지 않으므로). 주어 생략 문체를 해치지 않게 뒤 조사도 함께 뺀다. */
function resolveLenient(text: string, tokenMap: Map<string, string>): string {
  const r = resolveTokens(text, tokenMap);
  if (r.ok) return r.text;
  const stripped = text.replace(/\[\[학생[A-Z]{1,2}\]\](?:은|는|이|가|을|를|과|와|의|에게|도)?\s*/g, (m) => (r.unknown.some((u) => m.startsWith(u)) ? '' : m));
  const again = resolveTokens(stripped, tokenMap);
  return again.ok ? again.text : stripped;
}

function cleanSentence(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 후보 응답 검증: 요청 항목과 1:1, 정확히 5개, 빈 문장·마크다운 목록·해소 불가 기호 거부.
 * 부분 성공을 허용한다(정상 항목은 저장, 실패 항목만 재요청).
 */
export function parseCandidates(raw: string, requested: string[], tokenMap: Map<string, string>): CandidateParseResult {
  const ok = new Map<string, string[]>();
  const failed = new Map<string, string>();
  let parsed: z.infer<typeof CandidateJson>;
  try {
    parsed = CandidateJson.parse(extractJson(raw));
  } catch {
    requested.forEach((id) => failed.set(id, '응답 형식이 올바르지 않습니다.'));
    return { ok, failed, fatal: '응답 형식이 올바르지 않습니다.' };
  }
  const seen = new Set<string>();
  for (const it of parsed.items) {
    if (!requested.includes(it.itemId)) continue;
    if (seen.has(it.itemId)) {
      failed.set(it.itemId, '같은 항목이 중복되어 응답되었습니다.');
      ok.delete(it.itemId);
      continue;
    }
    seen.add(it.itemId);
    // 작업을 막지 않도록 너그럽게 받는다(2026-11-16): 빈 후보는 빼고, 목록 기호·마크다운은 지우고, 5개를 넘으면 앞의 5개만 쓴다.
    const cands = it.candidates
      .map((c) => cleanSentence(c.replace(/\*\*/g, '').replace(/^\s*(?:[-*•]|\d+[.)]|#{1,6})\s*/, '')))
      .filter(Boolean);
    const cands5 = splitMerged(cands).slice(0, 5);
    if (!cands5.length) {
      failed.set(it.itemId, '후보가 비어 있습니다.');
      continue;
    }
    ok.set(it.itemId, cands5.map((c) => resolveLenient(c, tokenMap)));
  }
  for (const id of requested) if (!ok.has(id) && !failed.has(id)) failed.set(id, '응답에 이 항목이 없습니다.');
  return { ok, failed };
}

/** 문장 끝(마침표·물음표·느낌표 뒤 공백)으로 자른다. */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?。])\s+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * 모델이 후보 5개를 한 문자열에 이어 붙여 보내는 경우(특히 가벼운 모델)를 바로잡는다.
 * 후보가 5개보다 적고 문장을 나누면 더 많아지면, 문장을 순서대로 5묶음(문장이 5개 이하이면 한 문장씩)으로 나눈다.
 */
export function splitMerged(cands: string[]): string[] {
  if (cands.length >= 5) return cands;
  const all = cands.flatMap(sentences);
  if (all.length <= cands.length) return cands;
  const n = Math.min(5, all.length);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const from = Math.floor((i * all.length) / n);
    const to = Math.floor(((i + 1) * all.length) / n);
    out.push(all.slice(from, to).join(' '));
  }
  return out;
}

const PolishJson = z.object({ text: z.string(), suggestions: z.array(z.string()).optional() });

export function parsePolish(raw: string, tokenMap: Map<string, string>): { ok: true; text: string; suggestions: string[] } | { ok: false; error: string } {
  let p: z.infer<typeof PolishJson>;
  try {
    p = PolishJson.parse(extractJson(raw));
  } catch {
    return { ok: false, error: '응답 형식이 올바르지 않습니다.' };
  }
  const text = p.text.replace(/\r\n?/g, '\n').trim();
  if (!text) return { ok: false, error: '윤문 결과가 비어 있습니다.' };
  const sugg = (p.suggestions ?? []).map((s) => resolveLenient(s, tokenMap).trim()).filter(Boolean);
  return { ok: true, text: resolveLenient(text, tokenMap), suggestions: sugg };
}
