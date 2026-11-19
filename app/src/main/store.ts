import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { deriveKey, newKdfParams, open, seal, type KdfParams, type Sealed } from '../core/crypto';
import { AppDataSchema, emptyAppData, integrityErrors, type AppData } from '../core/schema';

/**
 * 로컬 암호화 저장소.
 * - data.json: 데이터 키로 AES-256-GCM 암호화한 AppData. 쓰기는 임시 파일 → 교체, 직전 정상본은 data.prev.json
 * - key.json: 데이터 키를 Windows 계정 보호(safeStorage) 또는 앱 잠금 비밀번호(scrypt)로 감싼 값. 둘 중 하나만 남긴다.
 * Gemini API 키는 이 저장소와 백업에 넣지 않는다(keys.ts). CLI 로그인 정보는 이 앱이 읽거나 보관하지 않는다(providers.ts).
 */
export interface KeyProtector {
  available(): Promise<boolean>;
  encrypt(plain: string): Promise<Buffer>;
  decrypt(enc: Buffer): Promise<string>;
}

type KeyFile = { version: 1; mode: 'os'; wrapped: string } | { version: 1; mode: 'password'; kdf: KdfParams; wrapped: Sealed };

// 암호화 식별자. 배포 뒤에 바꾸면 그 전 저장 자료를 열 수 없다.
const DATA_AAD = 'mitgeul-data:1';
const KEY_AAD = 'mitgeul-key:1';

export class LockedError extends Error {}

export class Store {
  private key: Buffer | null = null;
  data: AppData = emptyAppData();
  constructor(
    readonly dir: string,
    private protector: KeyProtector,
  ) {}

  private p(name: string) {
    return path.join(this.dir, name);
  }

  async exists(name: string): Promise<boolean> {
    try {
      await fs.access(this.p(name));
      return true;
    } catch {
      return false;
    }
  }

  async lockMode(): Promise<'none' | 'os' | 'password'> {
    if (!(await this.exists('key.json'))) return 'none';
    const kf = JSON.parse(await fs.readFile(this.p('key.json'), 'utf8')) as KeyFile;
    return kf.mode;
  }

  private async writeAtomic(name: string, content: string) {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = this.p(`${name}.${randomBytes(4).toString('hex')}.tmp`);
    const fh = await fs.open(tmp, 'w');
    try {
      await fh.writeFile(content, 'utf8');
      await fh.sync();
    } finally {
      await fh.close();
    }
    await fs.rename(tmp, this.p(name));
  }

  /** 첫 실행 또는 잠금 해제 없이 열기(OS 보호). */
  async openWithOs(): Promise<void> {
    const mode = await this.lockMode();
    if (mode === 'password') throw new LockedError('앱 잠금 비밀번호가 필요합니다.');
    if (mode === 'none') {
      if ((await this.exists('data.json')) || (await this.exists('data.prev.json'))) {
        throw new Error('저장 키 파일이 없어 기존 자료를 열 수 없습니다. 자료를 덮어쓰지 않았습니다. 백업에서 복원하거나 앱 폴더를 확인하세요.');
      }
      if (!(await this.protector.available())) throw new Error('Windows 계정 보호 저장소를 사용할 수 없습니다. 앱 잠금 비밀번호를 설정해 주세요.');
      this.key = randomBytes(32);
      const wrapped = (await this.protector.encrypt(this.key.toString('base64'))).toString('base64');
      await this.writeAtomic('key.json', JSON.stringify({ version: 1, mode: 'os', wrapped } satisfies KeyFile));
      this.data = emptyAppData();
      await this.save();
      return;
    }
    const kf = JSON.parse(await fs.readFile(this.p('key.json'), 'utf8')) as Extract<KeyFile, { mode: 'os' }>;
    try {
      this.key = Buffer.from(await this.protector.decrypt(Buffer.from(kf.wrapped, 'base64')), 'base64');
    } catch {
      // 처음 실행 직후 강제 종료·정전으로 Windows 보호 비밀값(Local State)이 저장되지 못했거나, 다른 PC·계정에서 옮긴 폴더면 저장 키를 풀 수 없다.
      throw new Error('[저장 키 열기 실패] Windows 계정 보호로 감싼 저장 키를 풀 수 없어 앱 자료를 열 수 없습니다. 처음 실행 직후 앱이 강제로 꺼졌거나(정전 등), 다른 PC·Windows 계정에서 앱 폴더를 옮겨 온 경우에 생깁니다. 자료를 덮어쓰지 않았습니다. [초기화 후 백업에서 복원]으로 다시 시작할 수 있습니다.');
    }
    await this.load();
  }

  async openWithPassword(password: string): Promise<void> {
    const kf = JSON.parse(await fs.readFile(this.p('key.json'), 'utf8')) as KeyFile;
    if (kf.mode !== 'password') throw new Error('잠금이 설정되어 있지 않습니다.');
    const k = await deriveKey(password, kf.kdf);
    try {
      this.key = open(k, kf.wrapped, KEY_AAD);
    } catch {
      throw new LockedError('비밀번호가 틀렸습니다.');
    }
    await this.load();
  }

  /** 앱 잠금 켜기: 데이터 키를 비밀번호로 감싸고 OS 보호 사본을 지운다. */
  async enablePasswordLock(password: string): Promise<void> {
    if (!this.key) throw new Error('저장소가 열려 있지 않습니다.');
    if (password.length < 8) throw new Error('잠금 비밀번호는 8자 이상이어야 합니다.');
    const kdf = newKdfParams();
    const k = await deriveKey(password, kdf);
    await this.writeAtomic('key.json', JSON.stringify({ version: 1, mode: 'password', kdf, wrapped: seal(k, this.key, KEY_AAD) } satisfies KeyFile));
  }

  async disablePasswordLock(): Promise<void> {
    if (!this.key) throw new Error('저장소가 열려 있지 않습니다.');
    const wrapped = (await this.protector.encrypt(this.key.toString('base64'))).toString('base64');
    await this.writeAtomic('key.json', JSON.stringify({ version: 1, mode: 'os', wrapped } satisfies KeyFile));
  }

  private decryptFile(text: string): AppData {
    const sealed = JSON.parse(text) as Sealed;
    const json = open(this.key!, sealed, DATA_AAD).toString('utf8');
    return AppDataSchema.parse(JSON.parse(json));
  }

  private async load(): Promise<void> {
    for (const name of ['data.json', 'data.prev.json']) {
      if (!(await this.exists(name))) continue;
      try {
        const d = this.decryptFile(await fs.readFile(this.p(name), 'utf8'));
        if (integrityErrors(d).length) throw new Error('integrity');
        this.data = d;
        if (name === 'data.prev.json') this.recoveredFromPrevious = true;
        return;
      } catch {
        continue;
      }
    }
    if (await this.exists('data.json')) throw new Error('저장 파일을 열 수 없습니다(손상 또는 다른 키). 백업에서 복원하세요.');
    this.data = emptyAppData();
  }

  recoveredFromPrevious = false;

  async save(next?: AppData): Promise<void> {
    if (!this.key) throw new Error('저장소가 열려 있지 않습니다.');
    const d = AppDataSchema.parse(next ?? this.data);
    const errs = integrityErrors(d);
    if (errs.length) throw new Error(`저장 전 무결성 검사 실패: ${errs.slice(0, 3).join(' / ')}`);
    const content = JSON.stringify(seal(this.key, Buffer.from(JSON.stringify(d), 'utf8'), DATA_AAD));
    if (await this.exists('data.json')) {
      await fs.copyFile(this.p('data.json'), this.p('data.prev.json'));
    }
    await this.writeAtomic('data.json', content);
    this.data = d;
  }

  /** 복원: 검증된 데이터로 전체 교체. 교체 전 현재 데이터를 보관 파일로 남긴다. */
  async replaceAll(d: AppData): Promise<string> {
    const keep = `data.before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    if (await this.exists('data.json')) await fs.copyFile(this.p('data.json'), this.p(keep));
    await this.save(d);
    return keep;
  }

  /** 영구 삭제 후 호출: 앱이 관리하는 이전 정상본·복원 전 보관본에 삭제 전 자료가 남지 않게 한다. */
  async purgeHistory(): Promise<void> {
    await this.save();
    await fs.copyFile(this.p('data.json'), this.p('data.prev.json'));
    const names = await fs.readdir(this.dir).catch(() => [] as string[]);
    for (const n of names) if (n.startsWith('data.before-restore-')) await fs.rm(this.p(n), { force: true });
  }

  /** 전체 초기화: 데이터·이전본·보관본·키를 모두 지운다. */
  async wipe(): Promise<void> {
    const names = await fs.readdir(this.dir).catch(() => [] as string[]);
    for (const n of names) if (/^data\.|^key\.json$/.test(n)) await fs.rm(this.p(n), { force: true });
    this.key = null;
    this.data = emptyAppData();
  }

  get isOpen() {
    return !!this.key;
  }
}
