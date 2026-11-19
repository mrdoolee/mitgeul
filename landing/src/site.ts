/**
 * 랜딩 페이지에서 바뀌는 값. 배포 전에 DOWNLOAD_URL을 실제 내려받기 주소로 채운다.
 * 비어 있으면 내려받기 버튼은 페이지 아래 [내려받기] 안내로 이동한다.
 */
export const APP_NAME = "밑글";
export const APP_NAME_EN = "MITGEUL";
export const APP_TAGLINE = "생활기록부 초안 작성 도우미";
export const APP_VERSION = "0.1.0";
export const DOWNLOAD_FILE = `MITGEUL-${APP_VERSION}-portable.exe`;
export const DOWNLOAD_URL = "";
export const PRIVACY_URL = "./privacy.html";
/** 앱의 AI 연결 안내(keyGuide.ts GUIDE_LINKS)와 같은 공식 주소 */
export const CLAUDE_SETUP_URL = "https://code.claude.com/docs/en/setup";
export const CODEX_SETUP_URL = "https://developers.openai.com/codex/cli";
