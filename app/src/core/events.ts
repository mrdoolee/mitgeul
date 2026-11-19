import type { EventArea } from './schema';

/**
 * 행사·활동 빠른 선택 목록. 원작(생기부 작성 도우미 LITE)의 자율·진로 목록을 이어 쓰되 이식 검토에 따라 정리했다.
 * - '나의꿈발표대회'는 대회 명칭이라 제외(중 472·3012행, 대회를 행사로 이름만 바꾸는 것도 불가).
 * - '정부반장선거'는 '정·부반장 선거'로 바로잡음.
 * 목록은 편의용이며 학교교육계획에 실제로 편성된 행사인지와 학생의 실제 참여는 교사가 확인한다.
 */
export const EVENT_PRESETS: Record<EventArea, string[]> = {
  autonomy: ['정·부반장 선거', '학급자치활동', '학교폭력예방교육', '장애인식개선교육', '체육한마당', '흡연예방교육', '사이버폭력예방교육', '약물오남용예방교육', '생명존중교육', '다문화이해교육'],
  career: ['진로심리검사', '진로적성검사', '직업인 초청 강연', '직업인과의 만남', '전공학과 체험', '진로융합체험', '현장직업체험', '진로체험의 날', '진로독서활동'],
  behavior: ['체육한마당', '학급자치활동', '학교폭력예방교육', '현장체험학습', '학급 봉사활동', '학교 행사 준비'],
};

/** 출력·프롬프트용 행사 표기: 이름(기간/횟수) — 중 2206행·고 2333행 예시 형식 */
export function eventLabel(e: { name: string; period: string; quantity: string }): string {
  const extra = [e.period.trim(), e.quantity.trim()].filter(Boolean).join('/');
  return extra ? `${e.name.trim()}(${extra})` : e.name.trim();
}
