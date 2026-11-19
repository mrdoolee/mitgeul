import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { makeBackup, open, seal, type Sealed } from '../core/crypto';
import type { KeyProtector } from './store';

/**
 * 백업 폴더 관리.
 * - 자동 백업: Windows 계정 보호로 감싼 키로 암호화한다. 비밀번호가 필요 없고 이 PC·이 계정에서만 열린다.
 *   하루 1개 파일을 덮어쓰며 갱신하고 최근 KEEP_DAYS일치만 남긴다.
 * - 이동용 백업: 교사가 입력한 비밀번호로 암호화한다. 다른 PC에서도 열린다. 매번 새 파일로 남긴다.
 */
// 형식 식별자. 배포 뒤에 바꾸면 그 전 자동 백업을 열 수 없다.
export const AUTO_FORMAT = 'mitgeul-autobackup';
const AUTO_AAD = `${AUTO_FORMAT}:1`;
export const AUTO_PREFIX = 'mitgeul_backup_';
export const MOVE_PREFIX = '이동용백업_';
export const AUTO_EXT = '.sgauto';
export const MOVE_EXT = '.sgbak';
export const KEEP_DAYS = 14;

interface AutoFile {
  format: typeof AUTO_FORMAT;
  version: 1;
  wrapped: string;
  payload: Sealed;
}

export interface BackupEntry {
  name: string;
  kind: 'auto' | 'move';
  at: string;
  size: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const dayStamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** 자동 백업 파일 이름용 yymmdd */
export const yymmdd = (d: Date) => `${pad(d.getFullYear() % 100)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const minuteStamp = (d: Date) => `${dayStamp(d)}_${pad(d.getHours())}${pad(d.getMinutes())}`;

export class BackupFolder {
  lastAutoAt: string | null = null;
  lastError: string | null = null;
  private lastHash = '';
  private running: Promise<unknown> | null = null;

  constructor(readonly dir: string, private protector: KeyProtector) {}

  /** 폴더가 없을 때만 만든다(있으면 그대로 쓴다). */
  async ensure(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  private async writeAtomic(name: string, content: string) {
    await this.ensure();
    const target = path.join(this.dir, name);
    const tmp = `${target}.${randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(tmp, content, 'utf8');
    await fs.rename(tmp, target);
    return target;
  }

  /** 내용이 바뀌었을 때만 자동 백업한다. 동시에 두 번 돌지 않는다. */
  async auto(json: string, now = new Date()): Promise<'saved' | 'same'> {
    if (this.running) await this.running.catch(() => undefined);
    const hash = createHash('sha256').update(json).digest('hex');
    if (hash === this.lastHash) return 'same';
    const job = (async () => {
      const key = randomBytes(32);
      const wrapped = (await this.protector.encrypt(key.toString('base64'))).toString('base64');
      const file: AutoFile = { format: AUTO_FORMAT, version: 1, wrapped, payload: seal(key, Buffer.from(json, 'utf8'), AUTO_AAD) };
      await this.writeAtomic(`${AUTO_PREFIX}${yymmdd(now)}${AUTO_EXT}`, JSON.stringify(file));
      await this.prune(now);
    })();
    this.running = job;
    try {
      await job;
      this.lastHash = hash;
      this.lastAutoAt = now.toISOString();
      this.lastError = null;
      return 'saved';
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      this.running = null;
    }
  }

  /** 비밀번호로 암호화한 이동용 백업을 폴더에 새 파일로 남긴다. */
  async move(json: string, password: string, now = new Date()): Promise<string> {
    const b = await makeBackup(json, password);
    let name = `${MOVE_PREFIX}${minuteStamp(now)}${MOVE_EXT}`;
    for (let i = 2; await exists(path.join(this.dir, name)); i++) name = `${MOVE_PREFIX}${minuteStamp(now)}_${i}${MOVE_EXT}`;
    return this.writeAtomic(name, JSON.stringify(b));
  }

  /** 자동 백업 파일을 연다. 다른 PC·계정에서 만든 파일이면 열 수 없다. */
  async readAuto(text: string): Promise<string> {
    let f: AutoFile;
    try {
      f = JSON.parse(text);
    } catch {
      throw new Error('자동 백업 파일 형식이 아닙니다.');
    }
    if (f?.format !== AUTO_FORMAT || f.version !== 1) throw new Error('이 앱의 자동 백업 파일이 아닙니다.');
    let key: Buffer;
    try {
      key = Buffer.from(await this.protector.decrypt(Buffer.from(f.wrapped, 'base64')), 'base64');
    } catch {
      throw new Error('이 자동 백업은 다른 PC나 다른 Windows 계정에서 만들어져 열 수 없습니다. 이동용 백업(.sgbak)을 사용하세요.');
    }
    try {
      return open(key, f.payload, AUTO_AAD).toString('utf8');
    } catch {
      throw new Error('자동 백업 파일이 손상되었습니다.');
    }
  }

  async list(): Promise<BackupEntry[]> {
    let names: string[] = [];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    const out: BackupEntry[] = [];
    for (const name of names) {
      const kind = name.endsWith(AUTO_EXT) ? 'auto' : name.endsWith(MOVE_EXT) ? 'move' : null;
      if (!kind) continue;
      try {
        const st = await fs.stat(path.join(this.dir, name));
        out.push({ name, kind, at: st.mtime.toISOString(), size: st.size });
      } catch {
        /* 사라진 파일은 건너뛴다 */
      }
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }

  /** 폴더 안의 백업 이름만 받는다(경로 조작 방지). */
  resolve(name: string): string {
    const base = path.basename(String(name));
    if (base !== name || !(base.endsWith(AUTO_EXT) || base.endsWith(MOVE_EXT))) throw new Error('백업 폴더 안의 백업 파일만 열 수 있습니다.');
    return path.join(this.dir, base);
  }

  /** 자동 백업은 최근 KEEP_DAYS일치만 남긴다. 이동용 백업은 지우지 않는다. */
  async prune(now = new Date()) {
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (KEEP_DAYS - 1));
    const keepFrom = yymmdd(cutoff);
    for (const name of await fs.readdir(this.dir)) {
      const stamp = autoStamp(name);
      if (stamp && stamp < keepFrom) await fs.rm(path.join(this.dir, name), { force: true });
    }
  }
}

/** 자동 백업 파일 이름(mitgeul_backup_yymmdd.sgauto)에서 yymmdd를 읽는다. 자동 백업 파일이 아니면 undefined. */
export function autoStamp(name: string): string | undefined {
  if (!name.endsWith(AUTO_EXT) || !name.startsWith(AUTO_PREFIX)) return undefined;
  const stamp = name.slice(AUTO_PREFIX.length, -AUTO_EXT.length);
  return /^\d{6}$/.test(stamp) ? stamp : undefined;
}

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
