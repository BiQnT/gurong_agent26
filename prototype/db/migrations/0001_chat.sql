-- 채팅 기록. 기획서 6장의 도메인 테이블(drying_site, batch 등)은 다음 번호로 따로 추가한다.

CREATE TABLE chat_session (
  id               TEXT PRIMARY KEY,  -- 서버가 발급한 UUID. 프론트는 이 값만 다룬다
  agent_session_id TEXT,              -- claude CLI 세션 id. 첫 응답의 init 이벤트로 채우고 다음 턴에 --resume 한다
  app_env          TEXT NOT NULL,     -- dev / prod / local. DB 를 공유하므로 어느 환경에서 만든 대화인지 남긴다
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE chat_message (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES chat_session(id),
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  tool_calls TEXT,                    -- assistant 턴에서 부른 도구 [{ name, input, isError }] JSON
  cost_usd   REAL,
  created_at TEXT NOT NULL
);

CREATE INDEX chat_message_by_session ON chat_message (session_id, id);
