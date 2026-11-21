import type { Rubric } from '../core/prompts';
import type { Finding } from '../core/rules';
import type { AppData, Area, Provider } from '../core/schema';
import { toast } from './dom';

type Res<T> = { ok: true; value: T } | { ok: false; error: string; locked?: boolean; code?: string };
interface Gate {
  ok: boolean;
  reasons: string[];
}
export interface BackupStatus {
  dir: string;
  lastAutoAt: string | null;
  lastError: string | null;
  intervalMin: number;
  files: { name: string; kind: 'auto' | 'move'; at: string; size: number }[];
}

export interface RecordView {
  state: 'empty' | 'drafting' | 'reviewed' | 'reason' | 'excluded';
  reviewValid: boolean;
  reviewGate: Gate;
  finalGate: Gate;
  generationGate: Gate;
  draftStale: boolean;
  staleCandidates: string[];
  aggregation: {
    key: string;
    label: string;
    limit: number;
    total: number;
    remaining: number;
    over: boolean;
    overhead: number;
    prior: number;
    unknownPrior: string[];
    notes: string[];
    supported: boolean;
    members: { id: string; semester: number; workId: string; bytes: number }[];
  };
  output: { text: string; bytes: number; chars: number; uncertain: { char: string; index: number; counted: number }[] };
  findings: { final: Finding[]; draft: Finding[]; inputs: Finding[]; polish: Finding[]; candidates: Record<string, Finding[][]> };
}
export interface DashboardWork {
  workId: string;
  kind: 'homeroom' | 'subject' | 'club';
  label: string;
  studentIds: string[];
  studentCount: number;
  excludedCount: number;
  clubType: string | null;
  subjectKind: string | null;
  cells: { area: Area; semester: 1 | 2; annual?: boolean; counts: Record<RecordView['state'], number>; states: Record<string, RecordView['state']> }[];
}
export interface Prepared {
  requestId: string;
  kind: 'candidates' | 'polish';
  provider: Provider;
  model: string;
  autoModel: boolean;
  preview: string;
  replaced: { from: string; token: string }[];
  bytes: number;
}
export interface CliStatusView {
  installed: boolean;
  loggedIn: boolean;
  detail: string;
}
/** 구독 로그인 진행 상황(주 프로세스 cliLogin.ts의 LoginView와 같음) */
export interface LoginView {
  provider: 'anthropic' | 'openai';
  method: 'browser' | 'device';
  phase: 'waiting' | 'done' | 'failed' | 'cancelled';
  url?: string;
  userCode?: string;
  acceptsCode?: boolean;
  codeSent?: boolean;
  message?: string;
}
type CliStatusRes = { keyStatus: Record<Provider, boolean>; cliStatus: Record<Provider, CliStatusView> };
export interface AppStateRes {
  open: boolean;
  lockMode: 'none' | 'os' | 'password';
  recovered: boolean;
  data: AppData | null;
  rubric: Rubric;
  /** 요청 준비 상태: Gemini는 API 키 등록, Claude·ChatGPT는 CLI 설치·로그인 */
  keyStatus: Record<Provider, boolean>;
  cliStatus: Record<Provider, CliStatusView>;
  providers: { id: Provider; label: string }[];
  versions: { app: string; rules: string; rubric: string; prompt: string };
}

declare global {
  interface Window {
    sgb: {
      state(): Promise<Res<AppStateRes>>;
      openOs(): Promise<Res<AppStateRes>>;
      unlock(pw: string): Promise<Res<AppStateRes>>;
      act(name: string, payload: unknown): Promise<Res<{ data: AppData; result: unknown }>>;
      recordView(id: string): Promise<Res<RecordView>>;
      dashboard(): Promise<Res<DashboardWork[]>>;
      exportPlan(workId: string, area: Area, sems: number[]): Promise<Res<any>>;
      studentExportPlan(studentId: string): Promise<Res<import('../core/exportRows').StudentExportPlan>>;
      studentExportFile(studentId: string, format: 'xlsx' | 'hwpx'): Promise<Res<{ path: string; rows: number; skipped: number } | null>>;
      prepareCandidates(recordId: string, itemIds?: string[]): Promise<Res<Prepared>>;
      preparePolish(recordId: string, refine?: boolean, source?: 'draft' | 'final'): Promise<Res<Prepared>>;
      send(requestId: string): Promise<Res<{ applied: string[]; failed: Record<string, string>; discarded: string[]; message: string; data: AppData }>>;
      cancel(requestId: string): Promise<Res<void>>;
      listModels(p: Provider): Promise<Res<{ models: string[]; auto: string | null }>>;
      testModel(p: Provider, model: string, effort?: string): Promise<Res<{ model: string; ms: number; auto: boolean }>>;
      cliStatus(): Promise<Res<CliStatusRes>>;
      loginStart(p: 'anthropic' | 'openai', method: 'browser' | 'device'): Promise<Res<LoginView>>;
      loginState(p: 'anthropic' | 'openai'): Promise<Res<CliStatusRes & { view: LoginView | null }>>;
      loginCode(p: 'anthropic' | 'openai', code: string): Promise<Res<LoginView>>;
      loginOpenUrl(p: 'anthropic' | 'openai'): Promise<Res<void>>;
      loginCancel(p: 'anthropic' | 'openai'): Promise<Res<CliStatusRes & { view: LoginView | null }>>;
      logout(p: 'anthropic' | 'openai'): Promise<Res<CliStatusRes>>;
      setKey(p: Provider, key: string): Promise<Res<Record<Provider, boolean>>>;
      removeKey(p: Provider): Promise<Res<Record<Provider, boolean>>>;
      rosterOpenXlsx(defaults: { grade?: number; classNo?: number }): Promise<Res<any>>;
      rosterSample(): Promise<Res<string | null>>;
      rosterPreviewText(text: string, defaults: { grade?: number; classNo?: number }): Promise<Res<any>>;
      copyFinal(recordId: string): Promise<Res<boolean>>;
      copyEdit(text: string): Promise<Res<boolean>>;
      exportFile(workId: string, area: Area, sems: number[], format: 'xlsx' | 'hwpx'): Promise<Res<{ path: string; rows: number; skipped: number } | null>>;
      backupCreate(pw: string): Promise<Res<string | null>>;
      backupRestore(pw: string): Promise<Res<{ data: AppData; kept: string } | null>>;
      backupStatus(): Promise<Res<BackupStatus>>;
      backupOpenFolder(): Promise<Res<void>>;
      backupAutoNow(): Promise<Res<'saved' | 'same' | 'empty'>>;
      backupRestoreNamed(name: string, pw?: string): Promise<Res<{ data: AppData; kept: string } | null>>;
      lockEnable(pw: string): Promise<Res<void>>;
      lockDisable(): Promise<Res<void>>;
      wipe(confirm: string): Promise<Res<AppStateRes>>;
      openLicenses(): Promise<Res<void>>;
      openGuideLink(id: string): Promise<Res<void>>;
    };
  }
}

export type Screen = 'settings' | 'students' | 'teacher' | 'assign' | 'setup' | 'write' | 'review';

export const S = {
  app: null as AppStateRes | null,
  screen: 'settings' as Screen,
  /** 화면별 하위 작업 탭 */
  sub: {} as Partial<Record<Screen, string>>,
  /** 이번 렌더에서 화면이 쓴 하위 탭(하단 이전/다음 버튼용) */
  curTabs: null as null | { ids: string[]; labels: string[]; active: string },
  /** 상단 sticky 서브 메뉴 자리(app.ts가 매 렌더마다 만든다) */
  tabSlot: null as HTMLElement | null,
  /** 다음 렌더에서 맨 위로 스크롤(화면·탭 이동) */
  scrollTop: false,
  /** 관찰·작성 선택: 작업 → 영역 → 학생. 학기는 초안 작성 초기 설정 값을 따른다. */
  sel: { studentId: '' as string, semester: 1 as 1 | 2, workId: '' as string, area: '' as Area | '' },
  recordId: '' as string,
  view: null as RecordView | null,
  busy: '' as string,
  pendingRequestId: '' as string,
  render: () => {},
};

export function data(): AppData {
  if (!S.app?.data) throw new Error('데이터가 열려 있지 않습니다.');
  return S.app.data;
}

/** IPC 결과 처리: 실패면 알림 후 undefined */
export async function run<T>(p: Promise<Res<T>>, okMessage?: string): Promise<T | undefined> {
  const r = await p;
  if (!r.ok) {
    toast(r.error, 'err');
    return undefined;
  }
  if (okMessage) toast(okMessage, 'ok');
  return r.value;
}

export async function act(name: string, payload: unknown, okMessage?: string): Promise<unknown | undefined> {
  const v = await run(window.sgb.act(name, payload), okMessage);
  if (!v) return undefined;
  S.app!.data = v.data;
  return v.result ?? true;
}

export async function refreshView() {
  S.view = S.recordId ? ((await run(window.sgb.recordView(S.recordId))) ?? null) : null;
}

export const AREA_NAME: Record<Area, string> = { autonomy: '자율·자치', club: '동아리', career: '진로', subject: '과목세특', behavior: '행특' };
export const STATE_LABEL: Record<RecordView['state'], string> = { empty: '미작성', drafting: '작성 중', reviewed: '검토 완료', reason: '사유 입력', excluded: '기재 제외' };

export interface Tab {
  id: string;
  label: string;
  badge?: string;
}

/** 화면 하위 섹션 탭: 상단 sticky 서브 메뉴에 그리고 현재 탭 ID를 돌려준다. */
export function useTabs(tabs: Tab[]): string {
  const cur = S.sub[S.screen];
  const active = tabs.some((t) => t.id === cur) ? cur! : tabs[0]!.id;
  S.sub[S.screen] = active;
  S.curTabs = { ids: tabs.map((t) => t.id), labels: tabs.map((t) => t.label), active };
  const slot = S.tabSlot;
  if (slot) {
    slot.replaceChildren(
      ...tabs.map((t) => {
        const b = document.createElement('button');
        b.className = `subtab ${t.id === active ? 'on' : ''}`;
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', t.id === active ? 'true' : 'false');
        b.textContent = t.label;
        if (t.badge) {
          const s = document.createElement('span');
          s.className = 'subtab-badge';
          s.textContent = t.badge;
          b.appendChild(s);
        }
        b.addEventListener('click', () => {
          if (S.sub[S.screen] === t.id) return;
          S.sub[S.screen] = t.id;
          S.scrollTop = true;
          S.render();
        });
        return b;
      }),
    );
    slot.hidden = tabs.length < 2;
  }
  return active;
}
