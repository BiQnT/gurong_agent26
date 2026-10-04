import type Database from 'better-sqlite3';
import { openDatabase } from './sqlite-store.ts';

// LLM 사용 비용 기록. 최근 24시간 합계로 사용 한도를 건다 (DB 를 공유하므로 dev·prod 합산).

export type UsageLog = {
  record: (provider: string, costUsd: number) => void;
  spentLast24h: () => number;
};

const logs = new Map<string, UsageLog>();

export function usageLog(file: string): UsageLog {
  const existing = logs.get(file);
  if (existing) return existing;
  const db: Database.Database = openDatabase(file);
  db.exec(`CREATE TABLE IF NOT EXISTS llm_usage (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    at       TEXT NOT NULL,
    provider TEXT NOT NULL,
    cost_usd REAL NOT NULL
  )`);
  const insert = db.prepare('INSERT INTO llm_usage (at, provider, cost_usd) VALUES (?, ?, ?)');
  const sum = db.prepare<[string], { usd: number }>(
    'SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM llm_usage WHERE at >= ?',
  );
  const log: UsageLog = {
    record: (provider, costUsd) => {
      if (costUsd > 0) insert.run(new Date().toISOString(), provider, costUsd);
    },
    spentLast24h: () => sum.get(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())!.usd,
  };
  logs.set(file, log);
  return log;
}
