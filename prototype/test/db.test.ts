import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrate, openDb } from '../src/db/index.ts';

const migrationsDir = path.resolve(import.meta.dirname, '..', 'db', 'migrations');

describe('migrate', () => {
  it('한 번만 적용하고, 두 번째 실행은 아무것도 하지 않는다', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'gwamegi-')), 'test.db');
    const first = openDb(file);
    expect(migrate(first, migrationsDir)).toContain('0001_chat');
    // dev·prod 처럼 다른 연결에서 다시 돌려도 안전해야 한다
    const second = openDb(file);
    expect(migrate(second, migrationsDir)).toEqual([]);
    expect(second.pragma('journal_mode', { simple: true })).toBe('wal');
    first.close();
    second.close();
  });
});
