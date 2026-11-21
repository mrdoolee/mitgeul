import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, safeStorage, session, shell, type IpcMainInvokeEvent } from 'electron';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { ACTION_NAMES, ActionError, applyAction } from '../core/actions';
import { APP_TITLE, BACKUP_DIR_NAME, USER_DATA_DIR_NAME } from '../core/brand';
import { measure } from '../core/bytes';
import { readBackup } from '../core/crypto';
import { planExport, planStudentExport } from '../core/exportRows';
import {
  activeStudentIds,
  aggregationStatus,
  areasForWork,
  checkContext,
  draftStale,
  evidenceHash,
  finalGate,
  findingsFor,
  inputTexts,
  generationGate,
  outputText,
  recordState,
  reviewGate,
  reviewValid,
  workRefs,
  isAnnual,
  semestersFor,
} from '../core/model';
import { PROMPT_VERSION, type Rubric } from '../core/prompts';
import { parseRosterTable, previewRoster } from '../core/roster';
import { checkText, RULES_VERSION } from '../core/rules';
import { AppDataSchema, EFFORTS, integrityErrors, PROVIDERS, type AppData, type Area, type Effort, type Provider } from '../core/schema';
import { buildHwpx, buildStudentHwpx, buildStudentXlsx, buildXlsx, initHwp } from './exporters';
import { readXlsxFirstSheet } from './xlsxRead';
import { rosterSampleXlsx } from './exporters';
import { BackupFolder } from './autoBackup';
import { ApiKeys } from './keys';
import { LlmService } from './llm';
import { CliLogin, isLoginProvider, type LoginMethod } from './cliLogin';
import { cliStatus, listModels, pickAutoModel, PROVIDER_LABEL, ProviderError, testModel, usesCli, type CliRuntime, type CliStatus } from './providers';
import { LockedError, Store, type KeyProtector } from './store';

const userDataOverride = process.env.MITGEUL_USER_DATA;
// 사용자 자료 폴더: %APPDATA%\MITGEUL. 시험 실행은 MITGEUL_USER_DATA로 임시 폴더를 쓴다.
app.setPath('userData', userDataOverride ? path.resolve(userDataOverride) : path.join(app.getPath('appData'), USER_DATA_DIR_NAME));
/** 개발·시험 전용: Gemini는 모의 서버 주소, Claude·ChatGPT는 실제 CLI 대신 가짜 CLI 스크립트를 쓴다(패키징된 앱에서는 쓰지 않는다). */
const cliRuntime: CliRuntime = !app.isPackaged
  ? {
      baseUrlOverride: process.env.MITGEUL_LLM_BASE || undefined,
      override: {
        ...(process.env.MITGEUL_CLI_CLAUDE ? { anthropic: process.env.MITGEUL_CLI_CLAUDE } : {}),
        ...(process.env.MITGEUL_CLI_CODEX ? { openai: process.env.MITGEUL_CLI_CODEX } : {}),
      },
      extraEnv: process.env.MITGEUL_FAKE_CLI_BASE ? { MITGEUL_FAKE_CLI_BASE: process.env.MITGEUL_FAKE_CLI_BASE } : undefined,
    }
  : {};

const resourcesDir = app.isPackaged ? path.join(process.resourcesPath, 'app.asar', 'resources') : path.join(__dirname, '..', '..', 'resources');
const rubric: Rubric = JSON.parse(readFileSync(path.join(resourcesDir, 'rubrics', '2026-middle-rubric-v1.json'), 'utf8'));
const styleGuide = readFileSync(path.join(resourcesDir, 'prompts', 'polish-style.md'), 'utf8');

const protector: KeyProtector = {
  available: () => safeStorage.isAsyncEncryptionAvailable(),
  encrypt: (s) => safeStorage.encryptStringAsync(s),
  decrypt: async (b) => (await safeStorage.decryptStringAsync(b)).result,
};

let store: Store;
let keys: ApiKeys;
let llm: LlmService;
let backups: BackupFolder;
const AUTO_BACKUP_MS = 10 * 60 * 1000;
let win: BrowserWindow | null = null;
let lastRosterTable: unknown[][] | null = null;
/** 제공자별 모델 목록 캐시(30분). 자동 선택은 이 목록에서 고른다. */
const modelCache = new Map<Provider, { at: number; models: string[] }>();
async function modelsOf(p: Provider, fresh = false): Promise<string[]> {
  const c = modelCache.get(p);
  if (!fresh && c && Date.now() - c.at < 30 * 60_000) return c.models;
  const models = await listModels(p, { ...cliRuntime, apiKey: p === 'gemini' ? await keys.get(p) : undefined });
  modelCache.set(p, { at: Date.now(), models });
  return models;
}
async function resolveModel(p: Provider, chosen: string): Promise<{ model: string; auto: boolean }> {
  if (chosen) return { model: chosen, auto: false };
  let models: string[];
  try {
    models = await modelsOf(p);
  } catch (e) {
    throw new Error(`자동 선택을 위해 모델 목록을 불러오지 못했습니다. 설정에서 모델을 직접 고르거나 잠시 뒤 다시 시도하세요. (${(e as Error).message})`);
  }
  const auto = pickAutoModel(p, models);
  if (!auto) throw new Error('자동으로 고를 수 있는 모델이 없습니다. 설정에서 모델 목록을 불러와 직접 고르세요.');
  return { model: auto, auto: true };
}

/** CLI 설치·로그인 상태(시작할 때와 설정에서 [상태 다시 확인]을 누를 때 갱신) */
let cliCache: { at: number; status: Record<Provider, CliStatus> } | null = null;
async function cliStatuses(fresh = false): Promise<Record<Provider, CliStatus>> {
  if (!fresh && cliCache && Date.now() - cliCache.at < 10 * 60_000) return cliCache.status;
  const [anthropic, openai] = await Promise.all([cliStatus('anthropic', cliRuntime), cliStatus('openai', cliRuntime)]);
  const status: Record<Provider, CliStatus> = { anthropic, openai, gemini: { installed: false, loggedIn: false, detail: 'API 키 방식' } };
  cliCache = { at: Date.now(), status };
  return status;
}
/** 앱 버튼으로 구독 CLI 로그인·로그아웃(로그인 정보는 각 CLI가 저장하고 앱은 보관하지 않는다). */
const openedLoginUrls: string[] = [];
// 시험 전용: 개발 실행에서 MITGEUL_NO_BROWSER면 브라우저를 열지 않고 주소만 기록한다.
if (!app.isPackaged) (globalThis as { __mitgeulOpenedLoginUrls?: string[] }).__mitgeulOpenedLoginUrls = openedLoginUrls;
const cliLogin = new CliLogin({
  rt: cliRuntime,
  openExternal: (url) => {
    if (!app.isPackaged && process.env.MITGEUL_NO_BROWSER) return void openedLoginUrls.push(url);
    void shell.openExternal(url);
  },
  onChange: () => {
    cliCache = null;
    modelCache.delete('anthropic');
    modelCache.delete('openai');
  },
  appVersion: app.getVersion(),
});
async function loginResult(provider: 'anthropic' | 'openai') {
  const view = cliLogin.state(provider);
  const st = await cliStatuses(!view || view.phase !== 'waiting');
  return { view, keyStatus: await readyOf(st), cliStatus: st };
}

/** 요청 준비 상태: Gemini는 API 키 등록, Claude·ChatGPT는 CLI 로그인 */
const readyOf = async (st: Record<Provider, CliStatus>): Promise<Record<Provider, boolean>> => ({ anthropic: st.anthropic.loggedIn, openai: st.openai.loggedIn, gemini: (await keys.status()).gemini });

async function commit(mutate: (d: AppData) => void) {
  const copy = structuredClone(store.data);
  mutate(copy);
  await store.save(copy);
}

function senderOk(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  return !!win && e.sender === win.webContents && url.startsWith('file://') && url.includes('/dist/renderer/index.html');
}

function handle(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!senderOk(e)) throw new Error('허용되지 않은 호출입니다.');
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg, locked: err instanceof LockedError, ...(err instanceof ProviderError ? { code: err.code } : {}) };
    }
  });
}

function requireOpen() {
  if (!store.isOpen) throw new LockedError('잠금 해제가 필요합니다.');
}

function recordView(recordId: string) {
  const d = store.data;
  const r = d.records.find((x) => x.id === recordId);
  if (!r) throw new Error('기록을 찾을 수 없습니다.');
  const agg = aggregationStatus(d, r);
  const out = outputText(r);
  return {
    state: recordState(d, r),
    reviewValid: reviewValid(d, r),
    reviewGate: reviewGate(d, r),
    finalGate: finalGate(d, r),
    generationGate: generationGate(d, r),
    draftStale: draftStale(r),
    staleCandidates: r.candidates.filter((c) => c.evidenceHash !== evidenceHash(d, r, c.itemId)).map((c) => c.itemId),
    aggregation: {
      key: agg.info.key,
      label: agg.info.label,
      limit: agg.info.limit,
      total: agg.total,
      remaining: agg.remaining,
      over: agg.over,
      overhead: agg.info.overhead,
      prior: agg.priorBytes,
      unknownPrior: agg.unknownPrior,
      notes: agg.info.notes,
      supported: agg.info.supported,
      members: agg.members.filter((m) => m.id !== r.id).map((m) => ({ id: m.id, semester: m.semester, workId: m.workId, bytes: measure(outputText(m)).bytes })),
    },
    output: { text: out, ...measure(out) },
    findings: {
      final: findingsFor(d, r, out),
      draft: findingsFor(d, r, r.draft),
      // 관찰 메모 속 이름은 전송 전에 익명화하므로 입력 단계에서는 이름 규칙을 적용하지 않는다.
      inputs: checkText(inputTexts(d, r).join('\n'), { ...checkContext(d, r), rosterFullNames: [], rosterPartialNames: [] }).map((f) => (f.ruleId === 'custom-ban' ? { ...f, severity: 'warn' as const, message: '설정의 기재 금지 문구입니다. AI에는 쓰지 말라고 지시하며, 최종 본문에 남으면 차단합니다.' } : f)),
      polish: r.polish ? findingsFor(d, r, r.polish.resultText) : [],
      candidates: Object.fromEntries(r.candidates.map((c) => [c.itemId, c.texts.map((t) => findingsFor(d, r, t))])),
    },
  };
}

function dashboard() {
  const d = store.data;
  return d.works.map((w) => {
    const refs = workRefs(d, w.id);
    const ids = activeStudentIds(d, w.id);
    const areas = areasForWork(w.kind);
    const cells = areas.flatMap((area) =>
      semestersFor(d, w.id, area).map((semester) => {
        const counts = { empty: 0, drafting: 0, reviewed: 0, reason: 0, excluded: 0 };
        const states: Record<string, keyof typeof counts> = {};
        for (const sid of ids) {
          const r = d.records.find((x) => x.studentId === sid && x.workId === w.id && x.area === area && x.semester === semester);
          const s = recordState(d, r);
          counts[s]++;
          states[sid] = s;
        }
        return { area, semester, annual: isAnnual(d, w.id, area), counts, states };
      }),
    );
    return { workId: w.id, kind: w.kind, label: refs?.label ?? '(연결 끊김)', studentIds: ids, studentCount: ids.length, excludedCount: w.excludedStudentIds.length, clubType: refs?.club?.clubType ?? null, subjectKind: refs?.subject?.kind ?? null, cells };
  });
}

async function appState() {
  const lockMode = await store.lockMode();
  return {
    open: store.isOpen,
    lockMode,
    recovered: store.recoveredFromPrevious,
    data: store.isOpen ? store.data : null,
    rubric,
    keyStatus: await readyOf(await cliStatuses()),
    cliStatus: await cliStatuses(),
    providers: PROVIDERS.map((p) => ({ id: p, label: PROVIDER_LABEL[p] })),
    versions: { app: app.getVersion(), rules: RULES_VERSION, rubric: rubric.version, prompt: PROMPT_VERSION },
  };
}

function registerIpc() {
  handle('app:state', appState);
  handle('app:openOs', async () => {
    await store.openWithOs();
    return appState();
  });
  handle('app:unlock', async (password: string) => {
    await store.openWithPassword(String(password ?? ''));
    return appState();
  });
  for (const name of ACTION_NAMES) {
    handle(`act:${name}`, async (payload: unknown) => {
      requireOpen();
      const { data, result } = applyAction(store.data, name, payload);
      await store.save(data);
      if (name === 'student.delete' && result === 'purge') await store.purgeHistory();
      return { data: store.data, result };
    });
  }
  handle('query:record', (recordId: string) => (requireOpen(), recordView(String(recordId))));
  handle('query:dashboard', () => (requireOpen(), dashboard()));
  handle('query:studentExportPlan', (studentId: string) => (requireOpen(), planStudentExport(store.data, String(studentId))));
  handle('export:studentFile', async (studentId: string, format: 'xlsx' | 'hwpx') => {
    requireOpen();
    const plan = planStudentExport(store.data, String(studentId));
    if (!plan.rows.length) throw new Error('출력할 검토 완료 기록이 없습니다.');
    const buf = format === 'hwpx' ? (initHwp(readFileSync(path.join(resourcesDir, 'wasm', 'rhwp_bg.wasm'))), buildStudentHwpx(plan)) : buildStudentXlsx(plan);
    const safe = plan.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    const res = await dialog.showSaveDialog(win!, { title: '파일 저장', defaultPath: `${safe}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (res.canceled || !res.filePath) return null;
    await fs.writeFile(res.filePath, buf);
    return { path: res.filePath, rows: plan.rows.length, skipped: plan.skipped.length };
  });
  handle('query:exportPlan', (workId: string, area: Area, semesters: (1 | 2)[]) => (requireOpen(), planExport(store.data, String(workId), area, (semesters ?? []).filter((s) => s === 1 || s === 2))));

  handle('llm:prepareCandidates', (recordId: string, itemIds?: string[]) => (requireOpen(), llm.prepareCandidates(String(recordId), Array.isArray(itemIds) ? itemIds.map(String) : undefined)));
  handle('llm:preparePolish', (recordId: string, refine?: boolean, source?: string) => (requireOpen(), llm.preparePolish(String(recordId), refine === true, source === 'final' ? 'final' : 'draft')));
  handle('llm:send', async (requestId: string) => {
    requireOpen();
    const r = await llm.send(String(requestId));
    return { ...r, data: store.data };
  });
  handle('llm:cancel', (requestId: string) => llm.cancel(String(requestId)));
  handle('llm:listModels', async (provider: Provider) => {
    if (!PROVIDERS.includes(provider)) throw new Error('알 수 없는 제공자');
    const models = await modelsOf(provider, true);
    return { models, auto: pickAutoModel(provider, models) };
  });
  handle('llm:testModel', async (provider: Provider, model: string, effort?: string) => {
    if (!PROVIDERS.includes(provider)) throw new Error('알 수 없는 제공자');
    if (effort && !(EFFORTS as readonly string[]).includes(effort)) throw new Error('알 수 없는 추론 강도');
    const { model: m, auto } = await resolveModel(provider, String(model ?? '').trim());
    const r = await testModel(provider, m, { ...cliRuntime, apiKey: provider === 'gemini' ? await keys.get(provider) : undefined, effort: provider === 'gemini' || !effort ? undefined : (effort as Effort) });
    return { ...r, auto };
  });
  // CLI 상태 다시 확인: 상태 확인 명령만 실행한다(자격 증명 파일은 읽지 않는다).
  handle('cli:status', async () => {
    const st = await cliStatuses(true);
    modelCache.delete('anthropic');
    modelCache.delete('openai');
    return { keyStatus: await readyOf(st), cliStatus: st };
  });
  // 구독 로그인: Claude는 Claude Code 로그인 실행, ChatGPT는 Codex 앱 서버 로그인. 진행 상황은 화면이 1초마다 묻는다.
  const loginProvider = (p: unknown) => {
    if (!isLoginProvider(p)) throw new Error('구독 로그인은 Claude·ChatGPT만 씁니다.');
    return p;
  };
  handle('cli:loginStart', async (provider: unknown, method: unknown) => {
    const p = loginProvider(provider);
    const m: LoginMethod = method === 'device' && p === 'openai' ? 'device' : 'browser';
    return cliLogin.start(p, m);
  });
  handle('cli:loginState', (provider: unknown) => loginResult(loginProvider(provider)));
  handle('cli:loginCode', (provider: unknown, code: unknown) => cliLogin.submitCode(loginProvider(provider), String(code ?? '')));
  handle('cli:loginOpenUrl', (provider: unknown) => cliLogin.openUrl(loginProvider(provider)));
  handle('cli:loginCancel', (provider: unknown) => {
    const p = loginProvider(provider);
    cliLogin.cancel(p);
    return loginResult(p);
  });
  handle('cli:logout', async (provider: unknown) => {
    const p = loginProvider(provider);
    await cliLogin.logout(p);
    const st = await cliStatuses(true);
    return { keyStatus: await readyOf(st), cliStatus: st };
  });
  // Gemini API 키. CLI 제공자는 키를 받지 않는다.
  handle('keys:set', async (provider: Provider, key: string) => {
    if (provider !== 'gemini') throw new Error('API 키는 Gemini만 씁니다. Claude·ChatGPT는 구독 CLI로 로그인하세요.');
    await keys.set(provider, String(key ?? ''));
    modelCache.delete(provider);
    return readyOf(await cliStatuses());
  });
  handle('keys:remove', async (provider: Provider) => {
    if (provider !== 'gemini') throw new Error('API 키는 Gemini만 씁니다.');
    await keys.remove(provider);
    return readyOf(await cliStatuses());
  });

  handle('roster:openXlsx', async (defaults: { grade?: number; classNo?: number }) => {
    requireOpen();
    const res = await dialog.showOpenDialog(win!, { title: '명단 XLSX 선택', filters: [{ name: 'Excel 통합 문서', extensions: ['xlsx'] }], properties: ['openFile'] });
    if (res.canceled || !res.filePaths[0]) return null;
    lastRosterTable = await readXlsxFirstSheet(await fs.readFile(res.filePaths[0]));
    return rosterPreview(defaults);
  });
  handle('roster:sampleXlsx', async () => {
    const res = await dialog.showSaveDialog(win!, { title: '학생 명단 양식 저장', defaultPath: '학생명단_양식.xlsx', filters: [{ name: 'Excel 통합 문서', extensions: ['xlsx'] }] });
    if (res.canceled || !res.filePath) return null;
    await fs.writeFile(res.filePath, rosterSampleXlsx(store.data.settings.defaultGrade));
    return res.filePath;
  });
  handle('roster:previewText', (text: string, defaults: { grade?: number; classNo?: number }) => {
    requireOpen();
    lastRosterTable = String(text ?? '')
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .map((l) => l.split(/\t|,/).map((c) => c.trim()));
    return rosterPreview(defaults);
  });

  handle('copy:final', (recordId: string) => {
    requireOpen();
    const r = store.data.records.find((x) => x.id === recordId);
    if (!r) throw new Error('기록을 찾을 수 없습니다.');
    const g = finalGate(store.data, r);
    if (!g.ok) throw new Error(`최종 본문 복사를 할 수 없습니다: ${g.reasons.join(' / ')}`);
    clipboard.writeText(outputText(r));
    return true;
  });
  handle('copy:edit', (text: string) => {
    clipboard.writeText(String(text ?? '').slice(0, 20000));
    return true;
  });
  handle('export:file', async (workId: string, area: Area, semesters: (1 | 2)[], format: 'xlsx' | 'hwpx') => {
    requireOpen();
    const plan = planExport(store.data, String(workId), area, semesters);
    if (!plan.rows.length) throw new Error('출력할 검토 완료 기록이 없습니다.');
    const buf = format === 'hwpx' ? (initHwp(readFileSync(path.join(resourcesDir, 'wasm', 'rhwp_bg.wasm'))), buildHwpx(plan)) : buildXlsx(plan);
    const safe = plan.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    const res = await dialog.showSaveDialog(win!, { title: '파일 저장', defaultPath: `${safe}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (res.canceled || !res.filePath) return null;
    await fs.writeFile(res.filePath, buf);
    return { path: res.filePath, rows: plan.rows.length, skipped: plan.skipped.length };
  });
  // 이동용 백업: 비밀번호로 암호화해 백업 폴더에 새 파일로 남긴다(저장 위치를 묻지 않는다).
  handle('backup:create', async (password: string) => {
    requireOpen();
    return backups.move(JSON.stringify(store.data), String(password ?? ''));
  });
  handle('backup:status', async () => ({
    dir: backups.dir,
    lastAutoAt: backups.lastAutoAt,
    lastError: backups.lastError,
    intervalMin: AUTO_BACKUP_MS / 60000,
    files: await backups.list(),
  }));
  handle('backup:openFolder', async () => {
    await backups.ensure();
    const err = await shell.openPath(backups.dir);
    if (err) throw new Error(`백업 폴더를 열지 못했습니다: ${err}`);
  });
  handle('backup:autoNow', async () => {
    requireOpen();
    if (isEmptyData()) return 'empty';
    return backups.auto(JSON.stringify(store.data));
  });
  // 백업 폴더 안의 파일에서 복원. 자동 백업은 비밀번호 없이, 이동용 백업은 비밀번호로 연다.
  handle('backup:restoreNamed', async (name: string, password?: string) => {
    requireOpen();
    const file = backups.resolve(String(name));
    const text = await fs.readFile(file, 'utf8');
    const json = file.endsWith('.sgauto') ? await backups.readAuto(text) : await readBackup(text, String(password ?? ''));
    return restoreJson(json);
  });
  // 다른 곳(USB 등)의 백업 파일에서 복원
  handle('backup:restore', async (password: string) => {
    requireOpen();
    const res = await dialog.showOpenDialog(win!, { title: '백업 파일 선택', defaultPath: backups.dir, filters: [{ name: '백업', extensions: ['sgbak', 'sgauto'] }], properties: ['openFile'] });
    if (res.canceled || !res.filePaths[0]) return null;
    const text = await fs.readFile(res.filePaths[0], 'utf8');
    const json = res.filePaths[0].endsWith('.sgauto') ? await backups.readAuto(text) : await readBackup(text, String(password ?? ''));
    return restoreJson(json);
  });
}

async function restoreJson(json: string) {
  {
    let parsed: AppData;
    try {
      parsed = AppDataSchema.parse(JSON.parse(json));
    } catch {
      throw new Error('백업 내용의 형식이 올바르지 않아 복원하지 않았습니다. 현재 자료는 그대로입니다.');
    }
    const errs = integrityErrors(parsed);
    if (errs.length) throw new Error(`백업의 참조 관계가 끊어져 복원하지 않았습니다: ${errs.slice(0, 3).join(' / ')}`);
    const kept = await store.replaceAll(parsed);
    return { data: store.data, kept };
  }
}

function registerIpc2() {
  handle('lock:enable', async (password: string) => (requireOpen(), store.enablePasswordLock(String(password ?? ''))));
  handle('lock:disable', async () => (requireOpen(), store.disablePasswordLock()));
  handle('data:wipe', async (confirm: string) => {
    if (confirm !== '전체 삭제') throw new Error('확인 문구가 일치하지 않습니다.');
    await store.wipe();
    return appState();
  });
  // 키 발급 안내: 정해 둔 공식 사이트만 기본 브라우저로 연다(임의 주소는 열지 않는다).
  handle('app:openGuideLink', async (id: unknown) => {
    const links: Record<string, string> = {
      geminiKey: 'https://aistudio.google.com/apikey',
      geminiPricing: 'https://ai.google.dev/gemini-api/docs/pricing',
      claudeSetup: 'https://code.claude.com/docs/en/setup',
      claudeLegal: 'https://code.claude.com/docs/en/legal-and-compliance',
      claudePricing: 'https://claude.com/pricing',
      codexSetup: 'https://developers.openai.com/codex/cli',
      codexPricing: 'https://chatgpt.com/pricing',
      original: 'https://dorms.school/apps/6a94b4dc-040e-4b49-8ecd-b909ea6ef01a',
      instagram: 'https://www.instagram.com/trdoolee',
      blog: 'https://blog.naver.com/trdoolee',
    };
    const url = typeof id === 'string' ? links[id] : undefined;
    if (!url) throw new Error('알 수 없는 안내 링크입니다.');
    await shell.openExternal(url);
  });
  handle('app:openLicenses', async () => {
    // asar 안의 파일은 외부 프로그램이 열 수 없어 고지 파일은 asar 밖(app.asar.unpacked)에 둔다.
    const dir = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'resources') : resourcesDir;
    const err = await shell.openPath(path.join(dir, 'THIRD_PARTY_NOTICES.txt'));
    if (err) throw new Error(`고지 파일을 열지 못했습니다: ${err}`);
  });
}

function rosterPreview(defaults: { grade?: number; classNo?: number }) {
  if (!lastRosterTable) throw new Error('명단을 먼저 불러오세요.');
  const parsed = parseRosterTable(lastRosterTable, defaults ?? {});
  const pv = previewRoster(parsed.rows, store.data.students, store.data.settings.schoolLevel, store.data.settings.schoolYear);
  return { ...pv, errors: parsed.errors };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: APP_TITLE,
    backgroundColor: '#f2f5f8',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.once('ready-to-show', () => win?.show());
  win.setIcon(path.join(resourcesDir, 'icon.png'));
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('closed', () => (win = null));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'));
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    // renderer는 로컬 파일만 읽는다. 외부 요청은 main의 LLM 경계만 사용한다.
    cb({ cancel: !(details.url.startsWith('file://') || details.url.startsWith('devtools://')) });
  });
  const dir = path.join(app.getPath('userData'), 'store');
  store = new Store(dir, protector);
  keys = new ApiKeys(path.join(app.getPath('userData'), 'keys.json'), protector);
  llm = new LlmService({
    getData: () => store.data,
    commit,
    rubric,
    styleGuide,
    apiKey: (p) => keys.get(p),
    resolveModel,
    cli: cliRuntime,
  });
  // 백업 폴더: 문서\BACKUP_DIR_NAME(없을 때만 만든다). 시험 실행은 임시 사용자 폴더 안을 쓴다.
  const backupDir = process.env.MITGEUL_BACKUP_DIR
    ? path.resolve(process.env.MITGEUL_BACKUP_DIR)
    : userDataOverride
      ? path.join(app.getPath('userData'), 'backups')
      : documentsBackupDir();
  backups = new BackupFolder(backupDir, protector);
  void backups.ensure().catch(() => undefined);
  registerIpc();
  registerIpc2();
  createWindow();
  setInterval(() => void autoBackup(), AUTO_BACKUP_MS);
});

function documentsBackupDir() {
  return path.join(app.getPath('documents'), BACKUP_DIR_NAME);
}

/** 학생·기록이 하나도 없는 빈 자료(초기화 직후 등)는 자동 백업하지 않는다. 그날의 정상 백업을 빈 자료로 덮어쓰지 않게. */
function isEmptyData() {
  const d = store.data;
  return !d.students.length && !d.records.length;
}

async function autoBackup() {
  if (!store?.isOpen || isEmptyData()) return;
  try {
    await backups.auto(JSON.stringify(store.data));
  } catch {
    /* lastError에 남고 설정 화면에 표시된다 */
  }
}

// 앱을 닫을 때 한 번 더 자동 백업한다(최대 5초 기다린다).
let quitting = false;
app.on('before-quit', (e) => {
  cliLogin.cancelAll();
  if (quitting || !store?.isOpen) return;
  e.preventDefault();
  quitting = true;
  void Promise.race([autoBackup(), new Promise((r) => setTimeout(r, 5000))]).finally(() => app.quit());
});

app.on('window-all-closed', () => app.quit());
void ActionError;
