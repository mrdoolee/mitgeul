import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/*
 * 히어로 오른쪽 캐러셀. 실제 앱 화면(가상 학생, 모의 AI 응답)을 사이드바와 긴 안내문을 걷어 내고
 * CSS 800×620 크기를 2배 해상도(1600×1240)로 캡처한 이미지다.
 * 가로 스크롤 스냅이라 손가락으로 밀어도 넘어가고, 화살표·단계 버튼·키보드 좌우 키로도 넘긴다. 자동으로 넘어가지 않는다.
 */
const slides = [
  { src: "./screens/observe.png", tab: "관찰 내용 입력", alt: "관찰 기록 탭. 자율 작성 칸에 학생에 대한 관찰 내용 두 문장이 들어가 있다." },
  { src: "./screens/candidates.png", tab: "AI 후보 선택", alt: "AI 후보 탭. 관찰 내용으로 만든 후보 문장 다섯 개 가운데 두 개가 체크되어 있다." },
  { src: "./screens/review.png", tab: "최종 본문 검토", alt: "최종 본문·검토 탭. 281자 최종 본문과 연간 Byte 합계, 검토 완료 표시가 보인다." },
  { src: "./screens/status.png", tab: "확인 및 출력", alt: "작성 내용 확인 및 출력 화면. 행특 1학기 작성 현황에서 학생 다섯 명 중 세 명이 검토 완료되었다." },
];

export function ScreenCarousel() {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  const goTo = useCallback((i: number) => {
    const el = track.current;
    if (!el) return;
    const next = (i + slides.length) % slides.length;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: next * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () => setIndex(Math.round(el.scrollLeft / el.clientWidth));
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="밑글 앱 화면"
      className="w-full"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); goTo(index + 1); }
        if (e.key === "ArrowLeft") { e.preventDefault(); goTo(index - 1); }
      }}
    >
      <div className="relative">
        <div className="overflow-hidden rounded-xl border border-[#d5dee8] bg-white shadow-[0_24px_60px_-24px_rgba(18,48,79,.4)]">
          <div
            ref={track}
            tabIndex={0}
            aria-live="polite"
            className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {slides.map((s, i) => (
              <figure
                key={s.src}
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} / ${slides.length}: ${s.tab}`}
                className="m-0 w-full shrink-0 snap-start"
              >
                <img
                  src={s.src}
                  alt={s.alt}
                  width={1600}
                  height={1240}
                  loading={i === 0 ? "eager" : "lazy"}
                  draggable={false}
                  className="block aspect-[1600/1240] w-full select-none"
                />
              </figure>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => goTo(index - 1)}
          aria-label="이전 화면"
          className="absolute top-1/2 left-0 grid size-10 -translate-x-1/3 -translate-y-1/2 place-items-center rounded-full border bg-white text-navy shadow-md hover:bg-accent sm:-translate-x-1/2"
        >
          <ChevronLeft className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => goTo(index + 1)}
          aria-label="다음 화면"
          className="absolute top-1/2 right-0 grid size-10 translate-x-1/3 -translate-y-1/2 place-items-center rounded-full border bg-white text-navy shadow-md hover:bg-accent sm:translate-x-1/2"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>
      <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="화면 고르기">
        {slides.map((s, i) => (
          <li key={s.src}>
            <button
              type="button"
              onClick={() => goTo(i)}
              aria-current={i === index ? "step" : undefined}
              className={
                "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] font-semibold transition-colors " +
                (i === index ? "border-primary bg-white text-blue-strong shadow-sm" : "border-transparent text-ink-2 hover:bg-white/70")
              }
            >
              <span
                className={
                  "grid size-5 shrink-0 place-items-center rounded-full text-[11px] " +
                  (i === index ? "bg-primary text-white" : "bg-[#dfe6ee] text-ink-2")
                }
              >
                {i + 1}
              </span>
              {s.tab}
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-center text-[12.5px] text-muted-foreground">실제 앱 화면에서 필요한 부분만 남겼습니다. 학생 이름과 문장은 가상 예시입니다.</p>
    </section>
  );
}
