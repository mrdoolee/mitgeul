# 밑글 (MITGEUL)

생활기록부 초안 작성 도우미. 학생에 대한 관찰 내용을 짧게 넣으면 AI가 후보 문장을 제안하고, 선생님이 고르고 다듬어 중·고등학교 생활기록부 초안을 쓰는 Windows 앱입니다.

- 버전: 0.1.1
- 소개·내려받기: https://mitgeul-trdoolee.vercel.app
- 실행 파일: [GitHub 릴리스](https://github.com/mrdoolee/mitgeul/releases/latest)에서 `MITGEUL-0.1.1-portable.exe`를 내려받습니다.
- 실행 환경: Windows 64비트, 설치 없는 portable 실행 파일(`MITGEUL-0.1.1-portable.exe`)
- 대상: 2026학년도 중학교·고등학교 학교생활기록부

## 주요 기능

- **지원 영역**: 자율·자치활동, 동아리활동, 진로활동, 과목별 세부능력 및 특기사항, 행동특성 및 종합의견
- **작성 흐름**: 관찰 기록 → AI 후보 5개 → 항목별 조합(AI 미사용) → 영역 취합 → 최종 윤문(150·300·500자) → 최종 본문·검토
- **글자 수와 Byte**: 공백 포함 글자 수와 NEIS 기준 Byte를 함께 보여 주고, 연간 합계 한도를 확인합니다.
- **내보내기**: 검토를 마친 본문만 복사하거나 XLSX·HWPX 파일로 내보냅니다.
- **명단 관리**: 담임 학급, 수업 반, 동아리를 나눠 관리하고 샘플 양식 XLSX로 명단을 한꺼번에 올립니다.
- **기재 검사**: 기재요령을 바탕으로 한 검사 규칙과 학교별 기재 금지 문구를 확인합니다. 검사는 참고용이며 최종 판단은 선생님이 합니다.

## AI 연결

아래 셋 가운데 하나를 연결합니다. 연결하지 않아도 관찰 내용과 본문은 직접 쓸 수 있습니다.

| 제공자 | 필요한 것 |
| --- | --- |
| Gemini | Google AI Studio에서 받은 API 키 |
| Claude | Claude Pro·Max 등 구독과 [Claude Code](https://code.claude.com/docs/en/setup) 설치 |
| ChatGPT | ChatGPT Plus·Pro 등 구독과 [Codex CLI](https://developers.openai.com/codex/cli) 설치 |

Claude·ChatGPT 로그인은 앱의 [Claude 로그인]·[ChatGPT 로그인] 버튼으로 합니다. 로그인 정보는 각 CLI가 저장하며 앱은 읽거나 보관하지 않습니다.

## 개인정보 보호

- 학생 정보와 작성 내용은 선생님 PC에만 암호화해 저장합니다. 제작자는 서버를 운영하지 않고 사용 통계도 모으지 않습니다.
- AI를 부를 때 명단의 성명과 등록한 별칭을 `[[학생A]]` 같은 표식으로 바꿔 보내고, 이름이 남아 있으면 전송을 막습니다.
- 비밀번호로 앱을 잠글 수 있고, 문서 폴더에 하루 한 개씩 최근 14일치 자동 백업을 남깁니다.
- Claude Code와 Codex는 앱이 넘긴 글에 계정 이메일, OS, 날짜 같은 자체 정보를 덧붙여 보낼 수 있습니다.

자세한 내용은 [개인정보 처리방침](app/PRIVACY.md)을 확인해 주세요.

## 저장소 구성

```
app/       Electron 앱 (TypeScript, esbuild, electron-builder)
landing/   배포용 랜딩 페이지 (Vite, React, Tailwind CSS)
```

## 개발

Node.js 22 이상이 필요합니다.

```bash
cd app
npm ci
npm start            # 빌드 후 개발 실행
npm run typecheck    # 타입 검사
npm test             # 단위 시험 (vitest)
npm run e2e          # 화면 시험 (Playwright + Electron)
npm run dist         # Windows portable 패키징 → app/release/
```

실제 AI 호출 시험(`npm run test:live`, `*.live.*`)은 비용과 네트워크가 들어 기본 실행에서 빠집니다.

랜딩 페이지:

```bash
cd landing
npm ci
npm run dev
npm run build        # → landing/dist/
```

## 알아 두세요

- 이 앱은 공식 기재요령과 선생님의 최종 판단을 대신하지 않습니다.
- 교육정보시스템(NEIS)에 자동으로 입력하지 않습니다.
- Claude·ChatGPT 연결은 선생님 본인 PC에서 본인 구독 계정으로 쓰세요.

## 만든 사람

- 제작: 두리쌤 · [Instagram](https://www.instagram.com/trdoolee) · [Blog](https://blog.naver.com/trdoolee)
- Dorms의 @Tachyon 선생님이 만든 [생기부 작성 도우미 LITE](https://dorms.school/apps/6a94b4dc-040e-4b49-8ecd-b909ea6ef01a)를 기반으로 제작했습니다.

## 라이선스

[MIT License](LICENCE.md)로 배포합니다. 사용·복사·수정·재배포가 자유롭고, 배포할 때 저작권 표시와 라이선스 전문을 함께 넣어 주세요. 앱은 아무런 보증 없이 "있는 그대로" 제공됩니다.

- 윤문 지침(`app/resources/prompts/polish-style.md`)은 [im-not-ai](https://github.com/epoko77-ai/im-not-ai)(MIT License, Copyright (c) 2026 epoko77-ai)의 일부를 학교생활기록부 문체에 맞게 요약·재구성했습니다.
- 앱에 포함된 오픈소스 구성요소는 각자의 라이선스를 따릅니다. 전체 고지는 빌드할 때 `app/resources/THIRD_PARTY_NOTICES.txt`로 만들어져 앱과 함께 배포됩니다.
