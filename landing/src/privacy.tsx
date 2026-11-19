import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import policy from "../../app/PRIVACY.md?raw";
import { SiteFooter } from "@/components/landing/sections";
import { APP_NAME } from "@/site";

/** 앱과 같은 PRIVACY.md를 그대로 보여 준다. 제목(#, ##), 목록(-), 문단만 쓰므로 그만큼만 해석한다. */
function renderMarkdown(md: string): ReactNode[] {
  const out: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s,)]+)/g).map((part, i) =>
      part.startsWith("**") ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : /^https?:\/\//.test(part) ? (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-accent-foreground underline underline-offset-4">
          {part}
        </a>
      ) : (
        part
      ),
    );
  const flush = () => {
    if (para.length) {
      out.push(<p key={out.length} className="mt-4 leading-[1.8] text-ink-2">{inline(para.join(" "))}</p>);
      para = [];
    }
    if (list.length) {
      out.push(
        <ul key={out.length} className="mt-4 list-disc space-y-2 pl-5 leading-[1.75] text-ink-2">
          {list.map((li, i) => <li key={i}>{inline(li)}</li>)}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    if (line.startsWith("# ")) { flush(); out.push(<h1 key={out.length} className="font-serif text-3xl font-bold text-navy sm:text-[2.2rem]">{line.slice(2)}</h1>); continue; }
    if (line.startsWith("## ")) { flush(); out.push(<h2 key={out.length} className="mt-10 font-serif text-xl font-bold text-navy">{line.slice(3)}</h2>); continue; }
    if (line.startsWith("### ")) { flush(); out.push(<h3 key={out.length} className="mt-6 text-base font-semibold text-ink">{line.slice(4)}</h3>); continue; }
    if (/^\s*[-*] /.test(line)) { if (para.length) { const l = list; list = []; flush(); list = l; } list.push(line.replace(/^\s*[-*] /, "")); continue; }
    if (list.length) flush();
    para.push(line.trim());
  }
  flush();
  return out;
}

function PrivacyPage() {
  return (
    <>
      <header className="border-b bg-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-2.5 px-4 sm:px-6">
          <a href="./" className="flex items-center gap-2.5">
            <img src="./logo.png" alt="" width={30} height={30} className="rounded-lg border" />
            <span className="font-bold text-navy">{APP_NAME}</span>
          </a>
          <a href="./" className="ml-auto text-sm font-medium text-accent-foreground underline-offset-4 hover:underline">처음 화면으로</a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12 text-[15px] sm:px-6 sm:py-16">{renderMarkdown(policy)}</main>
      <SiteFooter />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PrivacyPage />
  </StrictMode>,
);
