import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// 서버(VM)에서 dev·prod 두 프로세스가 함께 쓰는 SQLite 저장소.
// workspace.ts 의 diskStore 와 같은 read/write 계약을 지킨다. 지금은 workspace 문서 전체를
// JSON 한 칸에 넣는다. 표로 나누는 일은 데이터 구조가 굳은 뒤에 한다.

// 쓰기 함수는 동기만 받는다. 잠금(BEGIN IMMEDIATE)을 잡은 채 기다리면 다른 프로세스가
// busy_timeout 동안 통째로 멈추기 때문이다. Promise 를 돌려주면 타입 오류이고 실행 중에도 거부한다.
type Sync<R> = R extends PromiseLike<unknown> ? never : R;

export type DocumentStore<T> = {
  read: <R>(action: (doc: T) => R | Promise<R>) => Promise<R>;
  write: <R>(action: (doc: T) => Sync<R>) => Promise<R>;
};

export type StoreErrorCode =
  'SCHEMA_TOO_NEW' | 'SCHEMA_UPGRADE_NOT_ALLOWED' | 'INVALID_DOCUMENT' | 'ASYNC_WRITE';
export class StoreError extends Error {
  code: StoreErrorCode;
  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

export type SchemaOptions = {
  /** 이 코드가 읽고 쓰는 문서 형식 번호 */
  schemaVersion: number;
  /** 저장된 문서가 더 옛 형식일 때 이 코드의 형식으로 덮어써도 되는가. prod 배포에서만 켠다. */
  allowSchemaUpgrade?: boolean;
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
  { schemaVersion, allowSchemaUpgrade = false }: SchemaOptions,
): DocumentStore<T> {
  // 다른 모듈과 연결을 나눠 쓰지 않는다. 트랜잭션 중에 다른 쿼리가 끼어들 수 없게 하기 위해서다.
  const db = openDatabase(file);
  // generation 은 쓸 때마다 새로 만드는 난수다. 정수 version 은 백업을 복원하면 같은 번호가
  // 다시 나올 수 있어, 옛 캐시가 복원본을 덮어쓸 수 있다.
  db.exec(`CREATE TABLE IF NOT EXISTS documents (
    key        TEXT PRIMARY KEY,
    schema     INTEGER NOT NULL,
    generation TEXT NOT NULL,
    data       TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  const selectHead = db.prepare<[string], { schema: number; generation: string }>(
    'SELECT schema, generation FROM documents WHERE key = ?',
  );
  const selectDocument = db.prepare<[string], { schema: number; generation: string; data: string }>(
    'SELECT schema, generation, data FROM documents WHERE key = ?',
  );
  const upsert = db.prepare(
    `INSERT INTO documents (key, schema, generation, data, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET schema = excluded.schema, generation = excluded.generation,
       data = excluded.data, updated_at = excluded.updated_at`,
  );

  // 새 코드의 dev 가 prod 가 못 읽는 문서를 쓰지 못하게 한다.
  function checkSchema(stored: number, writing: boolean) {
    if (stored > schemaVersion)
      throw new StoreError(
        'SCHEMA_TOO_NEW',
        `Stored "${key}" schema ${stored} is newer than this code (${schemaVersion}). Deploy newer code or give this process its own database.`,
      );
    if (writing && stored < schemaVersion && !allowSchemaUpgrade)
      throw new StoreError(
        'SCHEMA_UPGRADE_NOT_ALLOWED',
        `Stored "${key}" schema ${stored} is older than this code (${schemaVersion}). Writing it would lock out older processes; set ALLOW_SCHEMA_UPGRADE=1 only on the prod deploy.`,
      );
  }

  // 다른 프로세스가 바꿨는지는 generation 한 칸만 보고 판단해 매번 JSON 을 다시 읽지 않는다.
  let cache: { generation: string; doc: T } | undefined;
  function load(writing: boolean): T {
    const head = selectHead.get(key) ?? { schema: schemaVersion, generation: '' };
    checkSchema(head.schema, writing);
    if (cache && cache.generation === head.generation) return cache.doc;
    const row = selectDocument.get(key);
    if (!row) {
      cache = { generation: '', doc: empty() };
      return cache.doc;
    }
    // 읽기는 트랜잭션 밖이라 두 조회 사이에 다른 프로세스가 썼을 수 있다.
    checkSchema(row.schema, writing);
    const parsed: unknown = JSON.parse(row.data);
    // 손상된 자료를 빈 자료로 덮어쓰지 않고 실패한다 (diskStore 와 같은 원칙).
    if (!valid(parsed)) throw new StoreError('INVALID_DOCUMENT', `Invalid stored document: ${key}`);
    cache = { generation: row.generation, doc: parsed };
    return cache.doc;
  }

  // immediate: 쓰기 잠금을 먼저 잡고 최신 문서를 읽는다. 다른 프로세스의 쓰기는 여기서 줄을 선다.
  // 함수 안에서 던지면 better-sqlite3 가 되돌린다.
  const commit = db.transaction((action: (doc: T) => unknown) => {
    const candidate = structuredClone(load(true));
    const output = action(candidate);
    if (typeof (output as { then?: unknown } | null | undefined)?.then === 'function')
      throw new StoreError('ASYNC_WRITE', `Write actions must be synchronous: ${key}`);
    if (!valid(candidate))
      throw new StoreError('INVALID_DOCUMENT', `Refusing to save invalid document: ${key}`);
    const generation = randomUUID();
    upsert.run(key, schemaVersion, generation, JSON.stringify(candidate), new Date().toISOString());
    return { output, next: { generation, doc: candidate } };
  });

  let queue: Promise<unknown> = Promise.resolve();
  function enqueue<R>(task: () => R | Promise<R>): Promise<R> {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  }
  return {
    read: <R>(action: (doc: T) => R | Promise<R>) =>
      enqueue(async () => structuredClone(await action(load(false)))),
    write: <R>(action: (doc: T) => Sync<R>) =>
      enqueue(() => {
        const { output, next } = commit.immediate(action);
        cache = next;
        return structuredClone(output as R);
      }),
  };
}
