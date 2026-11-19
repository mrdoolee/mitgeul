import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readBackup } from '../src/core/crypto';
import { BackupFolder } from '../src/main/autoBackup';
import type { KeyProtector } from '../src/main/store';

const fakePc = (tag: string): KeyProtector => ({
  available: async () => true,
  encrypt: async (s) => Buffer.from(`${tag}|${s}`),
  decrypt: async (b) => {
    const [t, s] = b.toString().split('|');
    if (t !== tag) throw new Error('other pc');
    return s!;
  },
});

const tmp = () => path.join(mkdtempSync(path.join(tmpdir(), 'sgb-bk-')), '밑글 백업');

describe('백업 폴더', () => {
  it('폴더가 없으면 만들고, 있으면 그대로 쓴다', async () => {
    const dir = tmp();
    const b = new BackupFolder(dir, fakePc('A'));
    await b.ensure();
    writeFileSync(path.join(dir, 'keep.txt'), 'x');
    await b.ensure();
    expect(readdirSync(dir)).toContain('keep.txt');
  });

  it('자동 백업은 내용이 바뀔 때만 저장하고 같은 PC에서 비밀번호 없이 열린다', async () => {
    const dir = tmp();
    const b = new BackupFolder(dir, fakePc('A'));
    const now = new Date(2026, 10, 16, 9, 0);
    expect(await b.auto('{"a":1}', now)).toBe('saved');
    expect(await b.auto('{"a":1}', now)).toBe('same');
    expect(await b.auto('{"a":2}', now)).toBe('saved');
    const files = await b.list();
    expect(files.map((f) => f.name)).toEqual(['mitgeul_backup_261116.sgauto']);
    const text = (await import('node:fs')).readFileSync(path.join(dir, files[0]!.name), 'utf8');
    expect(text).not.toContain('"a"');
    expect(await b.readAuto(text)).toBe('{"a":2}');
    await expect(new BackupFolder(dir, fakePc('B')).readAuto(text)).rejects.toThrow(/다른 PC/);
  });

  it('자동 백업은 14일치만 남기고 이동용 백업은 지우지 않는다', async () => {
    const dir = tmp();
    const b = new BackupFolder(dir, fakePc('A'));
    await b.ensure();
    writeFileSync(path.join(dir, '메모_261001.sgauto'), '{}');
    for (let d = 1; d <= 20; d++) await b.auto(`{"d":${d}}`, new Date(2026, 10, d, 12));
    await b.move('{"m":1}', 'password123', new Date(2026, 10, 1, 8, 5));
    const names = readdirSync(dir).sort();
    // 자동 백업 이름(mitgeul_backup_yymmdd)이 아닌 파일은 정리하지 않는다.
    expect(names).toContain('메모_261001.sgauto');
    expect(names.filter((n) => n.startsWith('mitgeul_backup_'))).toHaveLength(14);
    expect(names).toContain('mitgeul_backup_261107.sgauto');
    expect(names).not.toContain('mitgeul_backup_261106.sgauto');
    expect(names).toContain('이동용백업_2026-11-01_0805.sgbak');
  });

  it('이동용 백업은 매번 새 파일이며 비밀번호로 어느 PC에서나 열린다', async () => {
    const dir = tmp();
    const b = new BackupFolder(dir, fakePc('A'));
    const at = new Date(2026, 10, 16, 20, 30);
    const p1 = await b.move('{"x":1}', 'password123', at);
    const p2 = await b.move('{"x":2}', 'password123', at);
    expect(p1).not.toBe(p2);
    const text = (await import('node:fs')).readFileSync(p2, 'utf8');
    expect(await readBackup(text, 'password123')).toBe('{"x":2}');
    await expect(b.move('{}', 'short')).rejects.toThrow(/8자/);
  });

  it('자동 백업 파일 이름에서 날짜를 읽는다', async () => {
    const { autoStamp } = await import('../src/main/autoBackup');
    expect(autoStamp('mitgeul_backup_261118.sgauto')).toBe('261118');
    expect(autoStamp('thesangdolite_backup_261020.sgauto')).toBeUndefined();
    expect(autoStamp('자동백업_2026-10-01.sgauto')).toBeUndefined();
    expect(autoStamp('mitgeul_backup_2611.sgauto')).toBeUndefined();
    expect(autoStamp('mitgeul_backup_261118.sgbak')).toBeUndefined();
    expect(autoStamp('이동용백업_2026-11-01_0805.sgbak')).toBeUndefined();
  });

  it('백업 폴더 밖 경로는 열지 않는다', () => {
    const b = new BackupFolder(tmp(), fakePc('A'));
    expect(() => b.resolve('../data.json')).toThrow();
    expect(() => b.resolve('..\\x.sgbak')).toThrow();
    expect(b.resolve('mitgeul_backup_261116.sgauto')).toContain('밑글 백업');
  });
});

describe('후보가 한 칸에 묶여 온 경우', () => {
  it('문장 단위로 나눠 5개로 만든다', async () => {
    const { splitMerged } = await import('../src/core/responses');
    const one = ['업무를 안내받으면 일부 파악함. 이유를 질문하며 확인함. 안내에 따라 확인하고 묻는 모습을 보임. 왜 해야 하는지 질문함. 취지를 확인하기 위해 질문함.'];
    const out = splitMerged(one);
    expect(out).toHaveLength(5);
    expect(out[0]).toBe('업무를 안내받으면 일부 파악함.');
    expect(splitMerged(['가함. 나함.', '다함.', '라함.', '마함.', '바함.'])).toHaveLength(5);
    expect(splitMerged(['한 문장만 있음.'])).toEqual(['한 문장만 있음.']);
    expect(splitMerged(['일. 이. 삼. 사. 오. 육. 칠.'])).toHaveLength(5);
  });
});
