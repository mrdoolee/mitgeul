/**
 * 앱 이름과 사용자에게 보이는 이름 문구. 이름을 바꿀 때는 이 파일과 package.json(productName 등),
 * src/renderer/index.html의 <title>, scripts/notices.mjs의 고지 첫 줄을 함께 고친다.
 *
 * 사용자 자료 폴더 이름과 암호화·백업 형식 식별자(mitgeul-*)는 바꾸면 그 전 자료와 백업을 열 수 없다. 배포 뒤에는 바꾸지 않는다.
 */
export const APP_NAME = '밑글';
export const APP_NAME_EN = 'MITGEUL';
export const APP_TAGLINE = '생활기록부 초안 작성 도우미';
export const APP_TITLE = `${APP_NAME} — ${APP_TAGLINE}`;

/** 문서 폴더 안 백업 폴더 이름 */
export const BACKUP_DIR_NAME = `${APP_NAME} 백업`;

/** 사용자 자료 폴더(%APPDATA% 아래) */
export const USER_DATA_DIR_NAME = APP_NAME_EN;
