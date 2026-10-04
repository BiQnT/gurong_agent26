import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { sqliteDocumentStore, type SchemaOptions } from './sqlite-store.ts';
import { runScript, scriptPath } from './test-helpers/run-script.ts';

type Counter = { count: number };
type Row = { schema: number; generation: string; data: string; updated_at: string };
const counterStore = (file: string, options: SchemaOptions = { schemaVersion: 1 }) =>
  sqliteDocumentStore<Counter>(
    file,
    'counter',
    () => ({ count: 0 }),
    (value): value is Counter =>
      !!value &&
      typeof value === 'object' &&
      Number.isSafeInteger((value as Counter).count) &&
      (value as Counter).count >= 0,
    options,
  );
// 저장소와 별개의 연결로 행을 직접 본다 (다른 프로세스·복원 도구 흉내).
function withConnection<R>(file: string, action: (db: Database.Database) => R): R {
  const db = new Database(file);
  try {
    return action(db);
  } finally {
    db.close();
  }
}
const readRow = (file: string) =>
  withConnection(file, (db) =>
    db.prepare<[], Row>('SELECT schema, generation, data, updated_at FROM documents').get(),
  )!;
const stored = (file: string) => {
  const row = readRow(file);
  return { schema: row.schema, count: (JSON.parse(row.data) as Counter).count };
};
async function tempDb(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'gwamegi-sqlite-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, file: join(directory, 'shared.db') };
}

test(
  'two processes incrementing the same document concurrently lose no writes',
  {
    timeout: 60000,
  },
  async (t) => {
    const { file } = await tempDb(t);
    const times = 100;
    const parent = counterStore(file);
    await parent.read(() => undefined);
    const helper = fileURLToPath(new URL('./test-helpers/counter-writer.ts', import.meta.url));
    const writers = [1, 2].map(() => {
      const child = spawn(
        process.execPath,
        ['--experimental-strip-types', '--no-warnings', helper, file, String(times)],
        { stdio: ['pipe', 'pipe', 'inherit'] },
      );
      return {
        child,
        ready: once(createInterface({ input: child.stdout }), 'line'),
        exited: once(child, 'exit'),
      };
    });
    t.after(() => writers.forEach(({ child }) => child.kill()));
    await Promise.all(writers.map((writer) => writer.ready));
    for (const { child } of writers) child.stdin.write('go\n');
    const codes = await Promise.all(writers.map(async (writer) => (await writer.exited)[0]));
    assert.deepEqual(codes, [0, 0]);
    assert.equal(await parent.read((doc) => doc.count), 2 * times);
    assert.equal(stored(file).count, 2 * times);
  },
);

test('schema guard: older code cannot read or write newer documents, newer code upgrades only when allowed', async (t) => {
  const { file } = await tempDb(t);
  const prod = counterStore(file, { schemaVersion: 1 });
  await prod.write((doc) => {
    doc.count = 7;
  });
  const dev = counterStore(file, { schemaVersion: 2 });
  assert.equal(await dev.read((doc) => doc.count), 7);
  await assert.rejects(
    dev.write((doc) => {
      doc.count = 8;
    }),
    { code: 'SCHEMA_UPGRADE_NOT_ALLOWED' },
  );
  assert.deepEqual(stored(file), { schema: 1, count: 7 });
  assert.equal(await prod.read((doc) => doc.count), 7);

  const upgrade = counterStore(file, { schemaVersion: 2, allowSchemaUpgrade: true });
  await upgrade.write((doc) => {
    doc.count = 9;
  });
  assert.deepEqual(stored(file), { schema: 2, count: 9 });
  await assert.rejects(
    prod.read((doc) => doc.count),
    { code: 'SCHEMA_TOO_NEW' },
  );
  await assert.rejects(
    prod.write((doc) => {
      doc.count = 10;
    }),
    { code: 'SCHEMA_TOO_NEW' },
  );
  assert.deepEqual(stored(file), { schema: 2, count: 9 });

  // generation 이 그대로여도 (캐시가 맞아도) schema 는 매번 본다.
  const other = await tempDb(t);
  const cached = counterStore(other.file);
  await cached.write((doc) => {
    doc.count = 1;
  });
  withConnection(other.file, (db) => db.exec('UPDATE documents SET schema = 2'));
  await assert.rejects(
    cached.read((doc) => doc.count),
    { code: 'SCHEMA_TOO_NEW' },
  );
});

test('a restored row is never overwritten from a stale cache', async (t) => {
  const { directory, file } = await tempDb(t);
  const store = counterStore(file);
  await store.write((doc) => {
    doc.count = 1;
  });
  const backup = readRow(file);
  for (const count of [2, 3])
    await store.write((doc) => {
      doc.count = count;
    });
  // 다른 연결이 행을 백업 시점 내용으로 되돌린다.
  withConnection(file, (db) =>
    db
      .prepare('UPDATE documents SET schema = ?, generation = ?, data = ?, updated_at = ?')
      .run(backup.schema, backup.generation, backup.data, backup.updated_at),
  );
  assert.equal(await store.read((doc) => doc.count), 1);
  await store.write((doc) => {
    doc.count += 10;
  });
  assert.equal(stored(file).count, 11);

  // SQLite 온라인 백업으로 파일 전체를 되돌려도 같다 (운영 복원 방식).
  const snapshot = join(directory, 'snapshot.db');
  const live = new Database(file);
  await live.backup(snapshot);
  live.close();
  await store.write((doc) => {
    doc.count = 50;
  });
  const restore = new Database(snapshot);
  await restore.backup(file);
  restore.close();
  await store.write((doc) => {
    doc.count += 1;
  });
  assert.equal(stored(file).count, 12);
});

test('invalid candidates and async write actions are rolled back before anything is saved', async (t) => {
  const { file } = await tempDb(t);
  const store = counterStore(file);
  await store.write((doc) => {
    doc.count = 5;
  });
  const before = readRow(file);
  await assert.rejects(
    store.write((doc) => {
      doc.count = -1;
    }),
    { code: 'INVALID_DOCUMENT' },
  );
  const asyncWrite = store.write(
    // @ts-expect-error 쓰기 함수는 동기만 받는다 (잠금을 잡은 채 기다리지 않게).
    async (doc) => {
      doc.count = 99;
    },
  );
  await assert.rejects(asyncWrite, { code: 'ASYNC_WRITE' });
  assert.deepEqual(readRow(file), before);
  assert.equal(await store.read((doc) => doc.count), 5);
  await store.write((doc) => {
    doc.count += 1;
  });
  assert.equal(stored(file).count, 6);
});

test('copy-prod-to-dev copies a live database and refuses to overwrite by mistake', async (t) => {
  const { directory, file } = await tempDb(t);
  const live = counterStore(file);
  await live.write((doc) => {
    doc.count = 42;
  });
  const script = scriptPath('copy-prod-to-dev.ts');
  const target = join(directory, 'dev', 'dev.db');
  assert.equal((await runScript(script, [file, target])).code, 0);
  assert.equal(stored(target).count, 42);
  assert.notEqual((await runScript(script, [file, file])).code, 0);
  assert.notEqual((await runScript(script, [file, join(directory, '.', 'shared.db')])).code, 0);
  await live.write((doc) => {
    doc.count = 43;
  });
  const refused = await runScript(script, [file, target]);
  assert.notEqual(refused.code, 0);
  assert.match(refused.stderr, /--force/);
  assert.equal(stored(target).count, 42);
  assert.equal((await runScript(script, [file, target, '--force'])).code, 0);
  assert.equal(stored(target).count, 43);
  assert.equal(stored(file).count, 43);
});
