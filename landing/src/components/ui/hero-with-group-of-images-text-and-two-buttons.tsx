import { Download, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScreenCarousel } from "@/components/landing/screen-carousel";
import { APP_VERSION, DOWNLOAD_URL } from "@/site";

/*
 * 21st.dev "hero with group of images, text and two buttons" 구조를 따른다.
 * 왼쪽: 배지·제목·설명·버튼 두 개. 오른쪽 이미지 격자는 실제 앱 화면 캡처 캐러셀(ScreenCarousel)로 바꿨다.
 */
function Hero() {
  const downloadHref = DOWNLOAD_URL || "#download";
  return (
    <div className="w-full py-14 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid grid-cols-1 items-center gap-12 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] xl:gap-14">
          <div className="flex flex-col gap-6">
            <div>
              <Badge variant="outline" className="border-primary/30 bg-card px-3 py-1 text-[13px] font-semibold text-accent-foreground">
                2026학년도 중·고등학교 생활기록부
              </Badge>
            </div>
            <div className="flex flex-col gap-5">
              <h1 className="text-left font-serif text-[2.5rem] leading-[1.25] font-bold tracking-[-0.02em] text-navy sm:text-5xl xl:text-[3.2rem]">
                <span className="sm:whitespace-nowrap">관찰 내용 몇 줄이</span>
                <br />
                <span className="sm:whitespace-nowrap">생기부 초안이 됩니다</span>
              </h1>
              <p className="max-w-[30rem] text-left text-[17px] leading-[1.75] text-ink-2 sm:text-lg">
                생기부를 쓸 때 학생에 대한 관찰 내용을 짧게 넣으면, AI가 생활기록부에 쓸 수 있는 후보 문장을 다섯 개씩 제안합니다.
                <br className="hidden sm:inline" /> 마음에 드는 문장을 골라 다듬고 마지막 확인은 선생님이 합니다.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button size="lg" className="h-12 gap-3 rounded-[10px] px-6 text-[15px] font-semibold" asChild>
                <a href={downloadHref}>
                  <Download className="size-4" /> Windows용 내려받기
                </a>
              </Button>
              <Button size="lg" variant="outline" className="h-12 gap-3 rounded-[10px] bg-card px-6 text-[15px] font-semibold text-accent-foreground" asChild>
                <a href="#flow">
                  <ListChecks className="size-4" /> 작성 흐름 보기
                </a>
              </Button>
            </div>
            <p className="text-[13px] leading-5 text-muted-foreground">
              설치 없이 바로 실행하는 portable 파일입니다(버전 {APP_VERSION}).
              <br />
              AI 기능은 Gemini API 키나 선생님의 Claude·ChatGPT 구독으로 씁니다.
            </p>
          </div>
          <div className="mx-auto w-full max-w-[760px]">
            <ScreenCarousel />
          </div>
        </div>
      </div>
    </div>
  );
}

export { Hero };
