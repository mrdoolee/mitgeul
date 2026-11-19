import type { Provider } from './schema';

/**
 * 제공자별 권장 모델(2026-11-16 결정). 자동 선택은 목록에 있으면 이 모델을 고른다.
 * - Claude: Sonnet 5.5(사용자 지정 권장)
 * - OpenAI: gpt-5.4-mini(같은 급에서 조금 가벼운 모델, 한 학급 실호출 시험 통과)
 * - Gemini: gemini-3.5-flash(flash-lite는 윤문 분량이 183~540자로 들쭉날쭉, flash는 449~499자로 안정)
 */
export const RECOMMENDED_MODEL: Record<Provider, string> = {
  gemini: 'gemini-3.5-flash',
  // ChatGPT 계정의 Codex는 Codex 전용 모델만 허용한다. 권장 모델을 정하지 않고 CLI가 돌려준 목록의 첫 모델을 자동 선택한다.
  openai: '',
  anthropic: 'claude-sonnet-5-5',
};
