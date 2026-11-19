import type { Student } from './schema';

/**
 * 요청별 익명화. 로컬 전체 명단의 성명·이름(성 제외)·이름+'이' 형태·별칭을 임시 기호로 바꾼다.
 * 일반 단어와 겹쳐도 치환을 우선한다(누락보다 과치환). 기호 → 학생 ID 대응표는 요청 처리 동안만 쓴다.
 */
export interface Anonymized {
  text: string;
  /** 임시 기호 → 학생 ID */
  map: Map<string, string>;
  /** 이 요청에서 실제 치환된 표현(화면 표시용, 전송하지 않음) */
  replaced: { from: string; token: string }[];
}

export function tokenFor(i: number): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const a = letters[i % 26]!;
  const b = i >= 26 ? letters[Math.floor(i / 26) - 1]! : '';
  return `[[학생${b}${a}]]`;
}

export const TOKEN_RE = /\[\[학생[A-Z]{1,2}\]\]/g;

interface Variant {
  text: string;
  studentId: string;
}

export function nameVariants(students: Student[]): { variants: Variant[]; ambiguous: string[] } {
  const byText = new Map<string, Set<string>>();
  const add = (t: string, id: string) => {
    const k = t.trim();
    if (k.length < 2) return;
    if (!byText.has(k)) byText.set(k, new Set());
    byText.get(k)!.add(id);
  };
  for (const s of students) {
    // 성명 전체와 교사가 등록한 별칭만 쓴다. 성을 뺀 이름(지원·하늘 등)은 일반 단어와 겹쳐 오작동하므로 쓰지 않는다(2026-11-16 사용자 결정).
    add(s.name, s.id);
    s.aliases.forEach((a) => add(a, s.id));
  }
  const variants: Variant[] = [];
  const ambiguous: string[] = [];
  for (const [text, ids] of byText) {
    if (ids.size > 1) ambiguous.push(text);
    variants.push({ text, studentId: [...ids][0]! });
  }
  variants.sort((a, b) => b.text.length - a.text.length);
  return { variants, ambiguous };
}

export class AnonymizationError extends Error {}

/**
 * fields의 모든 문자열을 같은 대응표로 익명화한다. 대상 학생은 항상 첫 기호를 받는다.
 * 동명이인 등으로 대응이 모호한 표현이 실제 입력에 있으면 오류를 던진다.
 */
export function anonymizeFields(fields: string[], students: Student[], targetStudentId: string): { texts: string[]; map: Map<string, string>; replaced: Anonymized['replaced'] } {
  const { variants, ambiguous } = nameVariants(students);
  const joined = fields.join('\n');
  void ambiguous;
  void joined;
  const idToToken = new Map<string, string>();
  const map = new Map<string, string>();
  const assign = (id: string) => {
    if (!idToToken.has(id)) {
      const t = tokenFor(idToToken.size);
      idToToken.set(id, t);
      map.set(t, id);
    }
    return idToToken.get(id)!;
  };
  assign(targetStudentId);
  const replaced: Anonymized['replaced'] = [];
  const texts = fields.map((f) => {
    let out = f;
    for (const v of variants) {
      if (!out.includes(v.text)) continue;
      // 동명이인이면 지금 작성 중인 학생으로 본다(요청을 막지 않음).
      const same = students.filter((s) => s.name === v.text || s.aliases.includes(v.text));
      const token = assign(same.some((s) => s.id === targetStudentId) ? targetStudentId : v.studentId);
      out = out.split(v.text).join(token);
      replaced.push({ from: v.text, token });
    }
    return out;
  });
  return { texts, map, replaced };
}

/** 전송 직전 최종 문안 검사: 명단 이름이 남아 있으면 전송하지 않는다. */
export function residualNames(payload: string, students: Student[]): string[] {
  const { variants } = nameVariants(students);
  return [...new Set(variants.filter((v) => payload.includes(v.text)).map((v) => v.text))];
}

/** 응답의 임시 기호를 영구 학생 참조 표식으로 바꾼다. 모르는 기호가 있으면 실패. */
export function resolveTokens(text: string, map: Map<string, string>): { ok: true; text: string } | { ok: false; unknown: string[] } {
  const unknown: string[] = [];
  const out = text.replace(TOKEN_RE, (t) => {
    const id = map.get(t);
    if (!id) {
      unknown.push(t);
      return t;
    }
    return `{{학생:${id}}}`;
  });
  return unknown.length ? { ok: false, unknown } : { ok: true, text: out };
}
