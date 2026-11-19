import type { ReactNode } from "react";
import {
  Check,
  CircleAlert,
  Download,
  FileSpreadsheet,
  HardDrive,
  KeyRound,
  Lock,
  Monitor,
  Sprout,
  UserRoundX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  APP_NAME,
  APP_NAME_EN,
  APP_TAGLINE,
  APP_VERSION,
  CLAUDE_SETUP_URL,
  CODEX_SETUP_URL,
  DOWNLOAD_FILE,
  DOWNLOAD_URL,
  PRIVACY_URL,
  RELEASES_URL,
  REPO_URL,
} from "@/site";

const wrap = "mx-auto max-w-6xl px-4 sm:px-6";
/** 넓은 화면에서만 끊는 줄. 좁은 화면에서는 단어 단위로 자연스럽게 흐르게 둔다. */
const Br = () => <br className="hidden sm:inline" />;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className={`${wrap} flex h-16 items-center gap-6`}>
        <a href="#top" className="flex items-center gap-2.5" aria-label={`${APP_NAME} 처음으로`}>
          <img src="./logo.png" alt="" width={34} height={34} className="rounded-[9px] border" />
          <span className="text-[17px] font-bold text-navy">{APP_NAME}</span>
          <span className="hidden text-xs font-medium text-muted-foreground sm:inline">{APP_NAME_EN}</span>
        </a>
        <nav aria-label="페이지 안내" className="ml-auto hidden items-center gap-1 md:flex">
          {[
            ["#flow", "작성 흐름"],
            ["#areas", "지원 영역"],
            ["#privacy", "개인정보 보호"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="rounded-md px-3 py-2 text-sm font-medium text-ink-2 hover:bg-accent hover:text-accent-foreground">
              {label}
            </a>
          ))}
        </nav>
        <Button size="sm" className="ml-auto gap-2 rounded-[9px] font-semibold md:ml-2" asChild>
          <a href={DOWNLOAD_URL || "#download"}>
            <Download className="size-4" /> 내려받기
          </a>
        </Button>
      </div>
    </header>
  );
}

function SectionHead({ id, title, lead }: { id: string; title: ReactNode; lead: ReactNode }) {
  return (
    <div className="max-w-2xl">
      <h2 id={id} className="scroll-mt-24 font-serif text-[1.9rem] leading-[1.3] font-bold text-navy sm:text-[2.2rem]">
        {title}
      </h2>
      <p className="mt-3 text-base leading-[1.75] text-ink-2 sm:text-[17px]">{lead}</p>
    </div>
  );
}

const steps: { title: string; body: ReactNode }[] = [
  {
    title: "관찰 내용 넣기",
    body: <>선생님이 본 학생의 모습을 한두 문장으로 넣습니다. 필요하면 관찰 항목을 골라 점수와 사례를 더할 수 있습니다.</>,
  },
  {
    title: "후보 문장 받기",
    body: <>AI가 관찰 내용을 바탕으로 후보 문장 다섯 개를 씁니다. 관찰 내용에 없는 사건이나 역할은 지어내지 않도록 지시합니다.</>,
  },
  {
    title: "고르고 이어 붙이기",
    body: <>마음에 드는 후보를 통째로, 또는 필요한 부분만 골라 이어 붙입니다. 이 단계에서는 AI를 쓰지 않습니다.</>,
  },
  {
    title: "분량 맞춰 다듬기",
    body: <>모은 초안을 150자, 300자, 500자 가운데 고른 분량에 맞춰 다듬습니다. 글자 수와 Byte를 함께 보여 줍니다.</>,
  },
  {
    title: "검토하고 내보내기",
    body: <>검토를 마친 본문만 복사하거나 XLSX, HWPX 파일로 내보낼 수 있습니다.</>,
  },
];

export function FlowSection() {
  return (
    <section className="border-y bg-white py-16 sm:py-24">
      <div className={wrap}>
        <SectionHead
          id="flow"
          title="관찰 내용에서 본문까지, 다섯 단계"
          lead={
            <>
              AI는 후보 문장을 쓰고 다듬는 일만 합니다.
              <Br /> 어떤 문장을 남길지는 선생님이 정합니다.
            </>
          }
        />
        <ol className="mt-12 grid gap-x-6 gap-y-10 md:grid-cols-5">
          {steps.map((s, i) => (
            <li key={s.title} className="relative flex gap-4 md:flex-col md:gap-0">
              {i < steps.length - 1 && (
                <span aria-hidden="true" className="absolute top-5 left-[calc(2.5rem+0.75rem)] hidden h-px w-[calc(100%-2.5rem)] bg-input md:block" />
              )}
              <span className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-primary bg-white font-serif text-lg font-bold text-primary">
                {i + 1}
              </span>
              <div className="md:mt-5">
                <h3 className="text-[17px] font-semibold text-ink">{s.title}</h3>
                <p className="mt-2 text-[14.5px] leading-[1.7] text-ink-2">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

const areas = ["자율·자치활동", "동아리활동", "진로활동", "과목별 세부능력 및 특기사항", "행동특성 및 종합의견"];

export function AreasSection() {
  return (
    <section className="py-16 sm:py-24">
      <div className={wrap}>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-center lg:gap-16">
          <div>
            <SectionHead
              id="areas"
              title={
                <>
                  중학교와 고등학교,
                  <br />
                  다섯 영역을 한 앱에서
                </>
              }
              lead={
                <>
                  학교급을 고르면 분량과 기재 기준을 그 학교급에 맞춰 적용합니다.
                  <Br /> 담임 학급, 수업 반, 동아리를 나눠 관리하고 학생 명단은 한 번만 입력하면 됩니다.
                </>
              }
            />
            <div className="mt-8 flex max-w-2xl flex-col gap-3 text-[14.5px] leading-[1.7] text-ink-2">
              <p className="flex gap-3">
                <Sprout className="mt-1 size-4 shrink-0 text-primary" />
                <span>
                  부족한 점도 지우거나 부풀리지 않고 성장의 방향으로 바꿔 씁니다.
                  <Br /> 기재요령 제16조①의 교육적 관점을 모든 영역에 적용합니다.
                </span>
              </p>
              <p className="flex gap-3">
                <FileSpreadsheet className="mt-1 size-4 shrink-0 text-primary" />
                <span>명단은 샘플 양식 XLSX를 채워 한꺼번에 올릴 수 있습니다.</span>
              </p>
            </div>
          </div>
          <ul className="overflow-hidden rounded-xl border bg-white" aria-label="지원 영역">
            {areas.map((a) => (
              <li key={a} className="flex items-center gap-3 border-b px-5 py-4 last:border-b-0">
                <Check className="size-4 shrink-0 text-primary" strokeWidth={2.5} />
                <span className="font-serif text-[16.5px] font-bold text-navy">{a}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

const guards = [
  { icon: HardDrive, title: "PC에만 암호화해 저장", body: "학생 정보와 작성 내용은 선생님 PC에 암호화해 둡니다. 제작자는 서버를 운영하지 않고 사용 통계도 모으지 않습니다." },
  { icon: UserRoundX, title: "이름은 표식으로 바꿔 전송", body: "명단의 성명 전체와 등록한 별칭을 [[학생A]] 같은 표식으로 바꿔 보냅니다. 이름이 남아 있으면 전송을 막습니다." },
  { icon: KeyRound, title: "선생님 계정으로 직접 연결", body: "Gemini는 본인 API 키로, Claude와 ChatGPT는 PC에 설치한 Claude Code와 Codex로 본인 구독 계정에서 부릅니다. 중간 서버를 거치지 않고, 로그인 정보는 앱이 읽거나 보관하지 않습니다." },
  { icon: Lock, title: "앱 잠금과 자동 백업", body: "비밀번호로 앱을 잠글 수 있고 문서 폴더에 하루 한 개씩 14일 동안 백업을 남깁니다." },
];

export function PrivacySection() {
  return (
    <section className="bg-navy py-16 text-white sm:py-24">
      <div className={wrap}>
        <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 id="privacy" className="scroll-mt-24 font-serif text-[1.9rem] leading-[1.3] font-bold sm:text-[2.2rem]">
              학생 이름은
              <br />
              PC 밖으로 나가지 않습니다
            </h2>
            <p className="mt-3 max-w-xl text-base leading-[1.75] text-white/75 sm:text-[17px]">
              AI를 부를 때만, 이름을 표식으로 바꾼 글을
              <Br /> 선생님이 고른 AI 제공자 한 곳에 보냅니다.
            </p>
            <figure className="mt-8 rounded-xl border border-white/12 bg-white/[.06] p-5">
              <figcaption className="text-[13px] font-semibold text-white/60">전송 직전 본문</figcaption>
              <p className="mt-3 text-[15px] leading-[1.8] text-white/55 line-through decoration-white/40">
                김하늘은 모둠 활동에서 일정표를 먼저 제안함.
              </p>
              <p className="mt-1 text-[15px] leading-[1.8] text-white">
                <mark className="rounded-sm bg-[#3b7dd8]/35 px-0.5 text-white">[[학생A]]</mark>은 모둠 활동에서 일정표를 먼저 제안함.
              </p>
            </figure>
            <p className="mt-4 max-w-xl text-[13.5px] leading-[1.7] text-white/60">
              Claude Code와 Codex는 앱이 넘긴 글에 계정 이메일, OS, 날짜 같은 자체 정보를 덧붙여 보냅니다. 이 부분은 앱이 막을 수 없으니{" "}
              <a href={PRIVACY_URL} className="text-white/85 underline underline-offset-4">개인정보 처리방침</a>을 함께 확인해 주세요.
            </p>
          </div>
          <ul className="grid gap-x-8 gap-y-8 sm:grid-cols-2">
            {guards.map(({ icon: Icon, title, body }) => (
              <li key={title}>
                <span className="grid size-10 place-items-center rounded-[11px] bg-white/10">
                  <Icon className="size-5 text-[#8fb8ee]" />
                </span>
                <h3 className="mt-4 text-[17px] font-semibold">{title}</h3>
                <p className="mt-2 text-[14.5px] leading-[1.7] text-white/72">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function DownloadSection() {
  return (
    <section className="py-16 sm:py-24">
      <div className={`${wrap} grid gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-16`}>
        <div>
          <h2 id="download" className="scroll-mt-24 font-serif text-[1.9rem] leading-[1.3] font-bold text-navy sm:text-[2.2rem]">
            {APP_NAME} 내려받기
          </h2>
          <p className="mt-3 max-w-xl text-base leading-[1.75] text-ink-2 sm:text-[17px]">
            파일 하나를 내려받아 바로 실행합니다.
            <Br /> 처음 실행하면 학교급과 학년을 확인하고 AI를 연결한 뒤 학생 명단을 입력하는 순서로 안내합니다.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            {DOWNLOAD_URL ? (
              <Button size="lg" className="h-12 gap-3 rounded-[10px] px-6 text-[15px] font-semibold" asChild>
                <a href={DOWNLOAD_URL} download>
                  <Download className="size-4" /> {DOWNLOAD_FILE} 내려받기
                </a>
              </Button>
            ) : (
              <p className="rounded-[10px] border border-dashed border-input bg-white px-4 py-3 text-[14.5px] text-ink-2">
                내려받기 주소를 준비하고 있습니다. 공개되면 이 자리에 {DOWNLOAD_FILE} 파일이 올라옵니다.
              </p>
            )}
            <a href={PRIVACY_URL} className="text-[14.5px] font-medium whitespace-nowrap text-accent-foreground underline-offset-4 hover:underline">
              개인정보 처리방침 읽기
            </a>
          </div>
          <p className="mt-4 text-[13.5px] leading-[1.7] text-ink-2">
            지난 버전과 바뀐 내용은{" "}
            <a href={RELEASES_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-accent-foreground underline underline-offset-4">GitHub 릴리스</a>에서,
            소스 코드는{" "}
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-accent-foreground underline underline-offset-4">GitHub 저장소</a>에서 볼 수 있습니다(MIT License).
          </p>
        </div>
        <dl className="grid gap-5 rounded-xl border bg-white p-6 text-[14.5px]">
          <div className="flex gap-3">
            <Monitor className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <dt className="font-semibold text-ink">실행 환경</dt>
              <dd className="mt-1 leading-[1.65] text-ink-2">Windows 64비트 PC, 설치 없는 portable 실행 파일</dd>
            </div>
          </div>
          <div className="flex gap-3">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <dt className="font-semibold text-ink">AI 기능</dt>
              <dd className="mt-1 leading-[1.65] text-ink-2">
                아래 셋 가운데 하나를 연결합니다.
                <ul className="mt-1.5 list-disc space-y-1 pl-5">
                  <li>Gemini: Google AI Studio에서 받은 API 키</li>
                  <li>
                    Claude: Claude Pro·Max 구독과{" "}
                    <a href={CLAUDE_SETUP_URL} target="_blank" rel="noopener noreferrer" className="text-accent-foreground underline underline-offset-4">Claude Code</a> 설치
                  </li>
                  <li>
                    ChatGPT: ChatGPT Plus·Pro 구독과{" "}
                    <a href={CODEX_SETUP_URL} target="_blank" rel="noopener noreferrer" className="text-accent-foreground underline underline-offset-4">Codex CLI</a> 설치
                  </li>
                </ul>
                <span className="mt-1.5 block">로그인은 앱의 [Claude 로그인]·[ChatGPT 로그인] 버튼으로 합니다. 연결하지 않아도 관찰 내용과 본문은 직접 쓸 수 있습니다.</span>
              </dd>
            </div>
          </div>
          <div className="flex gap-3">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <dt className="font-semibold text-ink">알아 두세요</dt>
              <dd className="mt-1 leading-[1.65] text-ink-2">
                공식 기재요령과 선생님의 최종 판단을 대신하지 않습니다.
                <br />
                교육정보시스템에 자동으로 입력하지 않습니다.
                <br />
                Claude·ChatGPT 연결은 선생님 본인 PC에서 본인 구독 계정으로 쓰세요.
              </dd>
            </div>
          </div>
        </dl>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-navy text-white/60">
      <div className={`${wrap} flex flex-col gap-3 py-8 text-[13px] sm:flex-row sm:items-center`}>
        <span className="flex items-center gap-2.5">
          <img src="./logo.png" alt="" width={24} height={24} className="rounded-md" />
          <span className="font-semibold text-white">{APP_NAME}</span>
          <span>{APP_TAGLINE}</span>
        </span>
        <span className="sm:ml-auto">버전 {APP_VERSION}</span>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="text-white/80 underline-offset-4 hover:underline">
          GitHub
        </a>
        <a href={PRIVACY_URL} className="text-white/80 underline-offset-4 hover:underline">
          개인정보 처리방침
        </a>
      </div>
    </footer>
  );
}
