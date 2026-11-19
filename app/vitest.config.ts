import { defineConfig } from 'vitest/config';
// 실제 제공자 호출 시험(tests/live.test.ts, tests/class.live.test.ts)은 비용·네트워크가 들어 기본 실행에서 뺀다.
// 실행: npm run test:live / LIVE_CLASS=1 LIVE_PROVIDER=openai npx vitest run tests/class.live.test.ts
const live = ['tests/live.test.ts', 'tests/class.live.test.ts'];
export default defineConfig({
  test: {
    include: process.env.LIVE ? ['tests/live.test.ts'] : process.env.LIVE_CLASS ? ['tests/class.live.test.ts'] : ['tests/*.test.ts'],
    exclude: process.env.LIVE || process.env.LIVE_CLASS ? [] : live,
    testTimeout: 30000,
  },
});
