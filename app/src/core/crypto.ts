import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, type ScryptOptions } from 'node:crypto';

/** AES-256-GCM 봉투. 모든 값은 base64. */
export interface Sealed {
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  data: string;
}

export function seal(key: Buffer, plaintext: Buffer, aad?: string): Sealed {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  if (aad) c.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([c.update(plaintext), c.final()]);
  return { alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function open(key: Buffer, s: Sealed, aad?: string): Buffer {
  if (s.alg !== 'aes-256-gcm') throw new Error('지원하지 않는 암호화 형식입니다.');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(s.iv, 'base64'));
  if (aad) d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(Buffer.from(s.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(s.data, 'base64')), d.final()]);
}

export interface KdfParams {
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
}

export const DEFAULT_KDF = { N: 2 ** 17, r: 8, p: 1 };

export function deriveKey(password: string, params: KdfParams): Promise<Buffer> {
  const opts: ScryptOptions = { N: params.N, r: params.r, p: params.p, maxmem: 256 * params.N * params.r };
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFC'), Buffer.from(params.salt, 'base64'), 32, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export function newKdfParams(cost = DEFAULT_KDF): KdfParams {
  return { kdf: 'scrypt', ...cost, salt: randomBytes(16).toString('base64') };
}

// 형식 식별자. 배포 뒤에 바꾸면 그 전 이동용 백업을 열 수 없다.
export const BACKUP_FORMAT = 'mitgeul-backup';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  kdf: KdfParams;
  payload: Sealed;
}

const BACKUP_AAD = `${BACKUP_FORMAT}:${BACKUP_VERSION}`;

export async function makeBackup(json: string, password: string, cost = DEFAULT_KDF): Promise<BackupFile> {
  if (password.length < 8) throw new Error('백업 비밀번호는 8자 이상이어야 합니다.');
  const kdf = newKdfParams(cost);
  const key = await deriveKey(password, kdf);
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, kdf, payload: seal(key, Buffer.from(json, 'utf8'), BACKUP_AAD) };
}

export async function readBackup(fileText: string, password: string): Promise<string> {
  let f: BackupFile;
  try {
    f = JSON.parse(fileText);
  } catch {
    throw new Error('백업 파일 형식이 아닙니다.');
  }
  if (f?.format !== BACKUP_FORMAT) throw new Error('이 앱의 백업 파일이 아닙니다.');
  if (f.version !== BACKUP_VERSION) throw new Error(`지원하지 않는 백업 버전입니다: ${f.version}`);
  if (f.kdf?.kdf !== 'scrypt' || f.kdf.N > 2 ** 20 || f.kdf.r > 16 || f.kdf.p > 4) throw new Error('백업 암호화 매개변수가 올바르지 않습니다.');
  const key = await deriveKey(password, f.kdf);
  try {
    return open(key, f.payload, BACKUP_AAD).toString('utf8');
  } catch {
    throw new Error('비밀번호가 틀렸거나 백업 파일이 손상되었습니다.');
  }
}
