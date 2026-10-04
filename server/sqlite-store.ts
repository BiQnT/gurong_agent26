import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// 서버(VM)에서 dev·prod 두 프로세스가 함께 쓰는 SQLite 저장소.
// workspace.ts 의 diskStore 와 같은 read/write 계약을 지킨다. 지금은 workspace 문서 전체를
// JSON 한 칸에 넣는다. 표로 나누는 일은 데이터 구조가 굳은 뒤에 한다.

export type DocumentStore<T> = {
  read: <R>(action: (doc: T) => R | Promise<R>) => Promise<R>;
  write: <R>(action: (doc: T) => R | Promise<R>) => Promise<R>;
};

export function openDatabase(file: string): Database.Database {
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  // WAL: 한쪽이 쓰는 중에도 다른 쪽은 읽을 수 있다. 쓰기끼리 겹치면 최대 5초 기다린다.
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function sqliteDocumentStore<T>(
  file: string,
  key: string,
  empty: () => T,
  valid: (value: unknown) => value is T,
): DocumentStore<T> {
  // 다른 모듈과 연결을 나눠 쓰지 않는다. 트랜잭션 중에 다른 쿼리가 끼어들 수 없게 하기 위해서다.
  const db = openDatabase(file);
  db.exec(`CREATE TABLE IF NOT EXISTS documents (
    key        TEXT PRIMARY KEY,
    version    INTEGER NOT NULL,
    data       TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  const selectVersion = db.prepare<[string], { version: number }>(
    'SELECT version FROM documents WHERE key = ?',
  );
  const selectDocument = db.prepare<[string], { version: number; data: string }>(
    'SELECT version, data FROM documents WHERE key = ?',
  );
  const upsert = db.prepare(
    `INSERT INTO documents (key, version, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET version = excluded.version, data = excluded.data, updated_at = excluded.updated_at`,
  );

  // 다른 프로세스가 바꿨는지는 version 한 칸만 보고 판단해 매번 JSON 을 다시 읽지 않는다.
  let cache: { version: number; doc: T } | undefined;
  function load(): { version: number; doc: T } {
    const version = selectVersion.get(key)?.version ?? 0;
    if (cache && cache.version === version) return cache;
    const row = selectDocument.get(key);
    if (!row) {
      cache = { version: 0, doc: empty() };
      return cache;
    }
    const parsed: unknown = JSON.parse(row.data);
    // 손상된 자료를 빈 자료로 덮어쓰지 않고 실패한다 (diskStore 와 같은 원칙).
    if (!valid(parsed)) throw new Error(`Invalid stored document: ${key}`);
    cache = { version: row.version, doc: parsed };
    return cache;
  }

  let queue: Promise<unknown> = Promise.resolve();
  function run<R>(write: boolean, action: (doc: T) => R | Promise<R>): Promise<R> {
    const result = queue.then(async () => {
      if (!write) {
        const output = action(load().doc);
        return structuredClone(output instanceof Promise ? await output : output);
      }
      // 쓰기 잠금을 먼저 잡고 최신 문서를 읽는다. 다른 프로세스의 쓰기는 여기서 줄을 선다.
      db.exec('BEGIN IMMEDIATE');
      try {
        const current = load();
        const candidate = structuredClone(current.doc);
        const pending = action(candidate);
        const output = pending instanceof Promise ? await pending : pending;
        const version = current.version + 1;
        upsert.run(key, version, JSON.stringify(candidate), new Date().toISOString());
        db.exec('COMMIT');
        cache = { version, doc: candidate };
        return structuredClone(output);
      } catch (error) {
        if (db.inTransaction) db.exec('ROLLBACK');
        throw error;
      }
    });
    queue = result.catch(() => undefined);
    return result;
  }
  return {
    read: (action) => run(false, action),
    write: (action) => run(true, action),
  };
}
