import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config.ts';

export type Db = Database.Database;

export function openDb(file: string): Db {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  // VM 에서는 dev·prod 두 프로세스가 같은 파일을 연다. WAL 이면 읽기와 쓰기가 서로 막지 않는다.
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  return db;
}

// next dev 는 모듈을 다시 읽으므로 연결을 globalThis 에 하나만 둔다.
const holder = globalThis as { gwamegiDb?: Db };

export function getDb(): Db {
  holder.gwamegiDb ??= openDb(getConfig().databasePath);
  return holder.gwamegiDb;
}

/**
 * db/migrations/NNNN_*.sql 을 번호 순서로 한 번씩 적용한다.
 * DB 를 dev·prod 가 공유하므로 마이그레이션은 컬럼·테이블 추가만 한다 (infra/gcp/README.md).
 */
export function migrate(db: Db, dir: string): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const files = readdirSync(dir)
    .filter((file) => /^\d{4}_[\w-]+\.sql$/.test(file))
    .sort();
  const applied: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    // dev·prod 가 동시에 기동해도 한쪽만 적용하도록 쓰기 잠금을 먼저 잡고 다시 확인한다.
    db.transaction(() => {
      const done = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version);
      if (done) return;
      db.exec(readFileSync(path.join(dir, file), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
      applied.push(version);
    }).immediate();
  }
  return applied;
}
