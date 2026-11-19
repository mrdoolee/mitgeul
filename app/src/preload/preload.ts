import { contextBridge, ipcRenderer } from 'electron';
import { ACTION_NAMES } from '../core/actionNames';

/** renderer에 이름이 정해진 명령만 공개한다. 원시 ipcRenderer·임의 채널은 노출하지 않는다. */
type Res<T> = { ok: true; value: T } | { ok: false; error: string; locked?: boolean; code?: string };
const call = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<Res<unknown>>;

const actions: Record<string, (payload: unknown) => Promise<Res<unknown>>> = {};
for (const name of ACTION_NAMES) actions[name] = call(`act:${name}`);

const api = {
  state: call('app:state'),
  openOs: call('app:openOs'),
  unlock: call('app:unlock'),
  act: (name: string, payload: unknown) => {
    const fn = actions[name];
    if (!fn) return Promise.resolve({ ok: false, error: `알 수 없는 명령: ${name}` } as Res<unknown>);
    return fn(payload);
  },
  recordView: call('query:record'),
  dashboard: call('query:dashboard'),
  exportPlan: call('query:exportPlan'),
  studentExportPlan: call('query:studentExportPlan'),
  studentExportFile: call('export:studentFile'),
  prepareCandidates: call('llm:prepareCandidates'),
  preparePolish: call('llm:preparePolish'),
  send: call('llm:send'),
  cancel: call('llm:cancel'),
  listModels: call('llm:listModels'),
  testModel: call('llm:testModel'),
  cliStatus: call('cli:status'),
  loginStart: call('cli:loginStart'),
  loginState: call('cli:loginState'),
  loginCode: call('cli:loginCode'),
  loginOpenUrl: call('cli:loginOpenUrl'),
  loginCancel: call('cli:loginCancel'),
  logout: call('cli:logout'),
  setKey: call('keys:set'),
  removeKey: call('keys:remove'),
  rosterOpenXlsx: call('roster:openXlsx'),
  rosterPreviewText: call('roster:previewText'),
  rosterSample: call('roster:sampleXlsx'),
  copyFinal: call('copy:final'),
  copyEdit: call('copy:edit'),
  exportFile: call('export:file'),
  backupCreate: call('backup:create'),
  backupRestore: call('backup:restore'),
  backupStatus: call('backup:status'),
  backupOpenFolder: call('backup:openFolder'),
  backupAutoNow: call('backup:autoNow'),
  backupRestoreNamed: call('backup:restoreNamed'),
  lockEnable: call('lock:enable'),
  lockDisable: call('lock:disable'),
  wipe: call('data:wipe'),
  openLicenses: call('app:openLicenses'),
  openGuideLink: call('app:openGuideLink'),
};

contextBridge.exposeInMainWorld('sgb', Object.freeze(api));
export type SgbApi = typeof api;
