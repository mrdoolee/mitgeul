import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  // 개인정보 처리방침은 앱과 같은 원문(../app/PRIVACY.md)을 읽는다.
  server: { fs: { allow: [resolve(import.meta.dirname, "..")] } },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        privacy: resolve(import.meta.dirname, "privacy.html"),
      },
    },
  },
});
