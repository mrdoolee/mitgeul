import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Provider } from '../core/schema';
import type { KeyProtector } from './store';

/** API 키 저장: Windows 계정 보호(safeStorage)로 암호화해 업무 데이터·백업과 분리한다. renderer에는 등록 여부만 알린다. */
export class ApiKeys {
  constructor(
    private file: string,
    private protector: KeyProtector,
  ) {}

  private async readAll(): Promise<Partial<Record<Provider, string>>> {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch {
      return {};
    }
  }

  async status(): Promise<Record<Provider, boolean>> {
    const all = await this.readAll();
    return { gemini: !!all.gemini, openai: !!all.openai, anthropic: !!all.anthropic };
  }

  async get(p: Provider): Promise<string> {
    const all = await this.readAll();
    const v = all[p];
    if (!v) return '';
    return this.protector.decrypt(Buffer.from(v, 'base64'));
  }

  async set(p: Provider, key: string): Promise<void> {
    const k = key.trim();
    if (!/^[\x21-\x7e]{10,300}$/.test(k)) throw new Error('API 키 형식이 올바르지 않습니다.');
    if (!(await this.protector.available())) throw new Error('Windows 계정 보호 저장소를 사용할 수 없어 키를 저장하지 못했습니다.');
    const all = await this.readAll();
    all[p] = (await this.protector.encrypt(k)).toString('base64');
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(all), 'utf8');
  }

  async remove(p: Provider): Promise<void> {
    const all = await this.readAll();
    delete all[p];
    await fs.writeFile(this.file, JSON.stringify(all), 'utf8');
  }
}
