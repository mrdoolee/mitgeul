/**
 * 교육정보시스템 Byte 계산.
 * 규정(중 4423행, 고 6240행): 한글 1자 3Byte, 영문·숫자 1자 1Byte, 엔터 1Byte.
 * 앱 설계 판단: CRLF·CR은 줄바꿈 하나로 정규화하고, ASCII 공백·기본 기호는 1Byte로 센다.
 * 규정에 없는 문자는 3Byte와 UTF-8 길이 중 큰 값으로 보수적으로 계산하고 경고한다.
 */
export interface ByteResult {
  bytes: number;
  chars: number;
  charsNoSpace: number;
  uncertain: { char: string; index: number; counted: number }[];
}

const HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/;

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export function measure(text: string): ByteResult {
  const t = normalizeNewlines(text);
  let bytes = 0;
  let chars = 0;
  let charsNoSpace = 0;
  const uncertain: ByteResult['uncertain'] = [];
  let index = 0;
  for (const ch of t) {
    const cp = ch.codePointAt(0)!;
    chars++;
    if (!/\s/.test(ch)) charsNoSpace++;
    if (ch === '\n') bytes += 1;
    else if (cp <= 0x7f) bytes += 1;
    else if (HANGUL.test(ch)) bytes += 3;
    else {
      const utf8 = cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
      const counted = Math.max(3, utf8);
      bytes += counted;
      uncertain.push({ char: ch, index, counted });
    }
    index += ch.length;
  }
  return { bytes, chars, charsNoSpace, uncertain };
}

export function neisBytes(text: string): number {
  return measure(text).bytes;
}

/** 공백 포함 글자 수(목표 150/300/500자 비교용). 줄바꿈은 글자 수에 넣지 않는다. */
export function charCount(text: string): number {
  return [...normalizeNewlines(text).replace(/\n/g, '')].length;
}
