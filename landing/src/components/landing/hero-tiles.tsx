import type { ReactNode } from "react";
import { Check, Copy, Pencil, Sparkles } from "lucide-react";

/*
 * 히어로 오른쪽 그림. 실제 앱의 [6단계 관찰 기록 및 초안 작성] 화면을 캡처해 단순화했다.
 * 남색 사이드바, 상단 서브 탭, 그리고 세 카드(자율 작성 → AI 후보 생성 → 최종 본문과 교사 검토)를
 * 앱 styles.css의 색·모서리·테두리 그대로 그린다. 학생과 문장은 가상 예시다.
 */

const candidates = [
  { text: "역할 분담이 늦어지자 일정표를 먼저 제안해 모둠의 협의를 이끎.", picked: true },
  { text: "친구들의 의견을 모아 과제 진행 순서를 정리함.", picked: false },
  { text: "발표 자료 정리를 맡아 마감 전날까지 고치며 책임 있게 마무리함.", picked: true },
  { text: "맡은 일을 끝까지 해내려는 꾸준한 태도를 보임.", picked: false },
  { text: "머뭇거리는 모둠원에게 할 일을 나누어 활동이 이어지도록 도움.", picked: false },
];

const tabs = ["관찰 기록", "AI 후보", "항목별 조합", "영역 취합", "최종 윤문", "최종 본문·검토"];

function Card({ icon, title, desc, right, children, className = "" }: {
  icon: ReactNode;
  title: string;
  desc?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col rounded-[11px] border bg-white p-3.5 shadow-[0_3px_10px_rgba(18,48,79,.05)] ${className}`}>
      <div className="mb-3 flex items-start gap-2.5">
        <span className="grid size-[30px] shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-[18px] font-semibold text-ink">{title}</p>
          {desc && <p className="mt-0.5 text-[10.5px] leading-[15px] text-ink-2">{desc}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function ObservationCard() {
  return (
    <Card icon={<Pencil className="size-3.5" />} title="관찰 기록" desc="본 것을 짧게 적으면 됩니다.">
      <div className="rounded-[9px] border border-teal/45 bg-teal/[.04] p-2.5">
        <p className="mb-1.5 text-[11px] font-semibold text-ink">
          자율 작성 <span className="font-normal text-muted-foreground">선택</span>
        </p>
        <p className="rounded-md border-[1.5px] border-border bg-white px-2 py-1.5 text-[11.5px] leading-[18px] text-ink">
          모둠 과제에서 역할을 못 정해 머뭇거리는 친구들에게 먼저 일정표를 제안함. 발표 자료 정리를 맡아 마감 전날까지 고침.
        </p>
        <p className="mt-1.5 text-[10px] leading-[14px] text-muted-foreground">적힌 사실만 쓰고 새 사실은 더하지 않습니다.</p>
      </div>
    </Card>
  );
}

function CandidatesCard() {
  let order = 0;
  return (
    <Card
      className="h-full"
      icon={<Sparkles className="size-3.5" />}
      title="AI 후보 생성"
      desc="항목마다 후보 5개를 받습니다."
    >
      <div className="rounded-[9px] border px-2 pt-2 pb-1">
        <p className="mb-1 px-1 text-[11px] font-semibold text-ink">
          자율 작성 <span className="font-normal text-muted-foreground">gemini-3.5-flash</span>
        </p>
        <ul className="flex flex-col">
          {candidates.map((c) => {
            const delay = c.picked ? `${0.5 + 0.6 * order++}s` : undefined;
            return (
              <li
                key={c.text}
                className={"flex gap-2 rounded-md px-1 py-1.5 " + (c.picked ? "cand-picked" : "")}
                style={delay ? { animationDelay: delay } : undefined}
              >
                <span
                  aria-hidden="true"
                  className={
                    "mt-[2px] grid size-[14px] shrink-0 place-items-center rounded-[3px] border " +
                    (c.picked ? "border-primary bg-primary text-white" : "border-[#8a9099] bg-white")
                  }
                >
                  {c.picked && <Check className="cand-tick size-2.5" strokeWidth={3.5} />}
                </span>
                <span className="text-[11.5px] leading-[17px] text-ink">{c.text}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="mt-auto flex justify-end pt-3">
        <span className="rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white">체크한 문장 일괄 추가</span>
      </div>
    </Card>
  );
}

function FinalCard() {
  return (
    <Card
      className="final-rise border-primary/35"
      icon={<Check className="size-3.5" />}
      title="최종 본문과 교사 검토"
    >
      <p className="rounded-md border-[1.5px] border-border px-2 py-1.5 text-[11.5px] leading-[18px] text-ink">
        <span className="line-clamp-3">
        역할 분담이 늦어지자 일정표를 먼저 제안해 모둠의 협의를 이끌었으며, 발표 자료 정리를 맡아 마감 전날까지 내용을 다시 살피고 고치며 맡은 일을 끝까지 책임지고 마무리함.</span>
      </p>
      <p className="mt-1.5 text-[10.5px] text-ink-2">공백 포함 281자 · 691Byte · 목표 300자</p>
      <div className="mt-2 rounded-lg bg-background px-2.5 py-2">
        <div className="flex items-center justify-between text-[10.5px]">
          <b className="font-semibold text-ink">1학년 연간 합계: 691 / 900 Byte</b>
          <span className="rounded-full border border-[#10b981]/40 bg-[#10b981]/10 px-1.5 text-[10px] font-semibold text-[#047857]">남음 209</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#e9eef4]" role="img" aria-label="연간 900Byte 중 691Byte 사용">
          <div className="meter-fill h-full rounded-full bg-[#10b981]" style={{ width: "76.8%" }} />
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="rounded-full border border-teal/45 bg-teal/10 px-2 py-0.5 text-[10px] font-semibold text-[#047857]">검토 완료</span>
        <span className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-white">
          <Copy className="size-3" /> 최종 본문 복사
        </span>
      </div>
    </Card>
  );
}

export function AppWindow() {
  return (
    <figure className="m-0">
      <div
        className="flex overflow-hidden rounded-2xl border border-[#d5dee8] bg-background shadow-[0_24px_60px_-20px_rgba(18,48,79,.35)]"
        aria-hidden="true"
      >
        <aside className="hidden w-[58px] shrink-0 flex-col items-center gap-2 bg-navy py-3.5 sm:flex">
          <img src="./logo.png" alt="" width={30} height={30} className="mb-2 rounded-lg" />
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <span
              key={n}
              className={
                "grid size-8 place-items-center rounded-[9px] text-[11px] font-semibold " +
                (n === 6 ? "bg-primary text-white" : "bg-white/[.07] text-white/70")
              }
            >
              {n}
            </span>
          ))}
        </aside>
        <div className="min-w-0 flex-1">
          <div className="border-b bg-white px-4 pt-2.5">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-blue-strong">6단계</span>
              <span className="text-[13px] font-semibold text-ink">관찰 기록 및 초안 작성</span>
              <span className="ml-auto hidden items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[10px] text-ink-2 md:inline-flex">
                <span className="size-1.5 rounded-full bg-[#10b981]" /> 암호화 저장됨
              </span>
            </div>
            <div className="mt-1.5 flex gap-3 overflow-hidden whitespace-nowrap">
              {tabs.map((t) => (
                <span
                  key={t}
                  className={
                    "border-b-2 pb-1.5 text-[11px] font-semibold " +
                    (t === "AI 후보" ? "border-primary text-blue-strong" : "border-transparent text-ink-2")
                  }
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
          <div className="p-3 sm:p-4">
            <p className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-bold text-ink">
              1학년 2반 1번 김하늘
              <span className="text-[10.5px] font-normal text-muted-foreground">1학기 · 행동특성 및 종합의견</span>
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ObservationCard />
              <div className="sm:row-span-2">
                <CandidatesCard />
              </div>
              <FinalCard />
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-[12.5px] text-muted-foreground">
        실제 앱 화면을 단순화했습니다. 학생과 문장은 가상 예시입니다.
      </figcaption>
    </figure>
  );
}
