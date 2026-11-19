// 빌드(esbuild)는 .md 파일을 문자열로 넣는다(scripts/build.mjs의 loader).
declare module '*.md' {
  const text: string;
  export default text;
}
