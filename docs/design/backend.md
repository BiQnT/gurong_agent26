# 백엔드 구조와 API 계약

- **마지막 확인일**: 2026-10-04
- 왜 이렇게 정했나: [0002 GCP 실행 환경](../decisions/0002-gcp-runtime-layout.md), [0003 claude CLI 래핑](../decisions/0003-claude-cli-wrapper.md)
- 실행·테스트 방법: [prototype/README.md](../../prototype/README.md)

## 흐름

```
브라우저 ──POST /api/chat──▶ Next.js route (prototype/src/app/api/chat)
                               │  chat/service.ts: 검증·잠금, SQLite 에 질문 저장
                               ▼
                         claude -p  (메시지마다 프로세스 하나, 두 번째 턴부터 --resume)
                               │  내장 도구 없음. 허용 도구는 mcp__eum__* 뿐
                               ▼
                         E-UM MCP 서버 (src/mcp/eum-server.ts, stdio)
                               │  allowlist 의 API 마다 도구 하나. serviceKey 는 서버가 붙인다
                               ▼
                         genix.pohang-eum.kr (실제 호출)
◀── SSE (session · tool · delta · done | error) ── 답변 저장 후 done
```

- 규칙 함수(건조 등급, 신뢰도·거리 게이트)는 아직 없다. 생기면 MCP 도구로 추가하고,
  Claude 는 그 결과를 설명만 한다 (기획서 "규칙 함수와 생성형 AI의 작업 분리").
- 시스템 프롬프트: `prototype/src/agent/system-prompt.md`
- 노출하는 E-UM API: `prototype/src/eum/allowlist.ts`

## API 계약

모든 응답은 JSON, 채팅만 SSE 다. 같은 Next 앱(`prototype/`) 안의 페이지에서 부르면 CORS 설정이 필요 없다.

### `POST /api/chat`

요청 본문: `{ "message": string, "sessionId"?: string }`

- `sessionId` 를 빼면 새 대화. 응답의 `session` 이벤트로 받은 id 를 다음 요청에 넣는다.
- `message` 는 2,000자 이하. `/` 로 시작하면 안 된다 (Claude Code 명령으로 해석되는 것을 막는다).

응답: `text/event-stream`. 각 이벤트의 `data` 는 JSON 이고 `type` 필드가 이벤트 이름과 같다.

| 이벤트 | data | 언제 |
| --- | --- | --- |
| `session` | `{ sessionId }` | 첫 번째 (DB 저장이 실패하면 `error` 만 온다) |
| `tool` | `{ id, status: "start", name, label }` | E-UM 조회 시작. `name` 은 API ID, `label` 은 화면용 이름 |
| `tool` | `{ id, status: "end", isError }` | 같은 `id` 의 조회 끝 |
| `delta` | `{ text }` | 답변 조각. 이어 붙여 보여준다 |
| `done` | `{ messageId, text, costUsd }` | 끝. `text` 가 저장된 최종 답변이다 |
| `error` | `{ message }` | `done` 대신 온다 |

- `delta` 없이 `done` 만 올 수 있다. 최종 화면은 `done.text` 로 맞춘다.
- 답변에 마크다운(굵게, 목록)이 섞인다.
- 스트림 시작 전 오류는 JSON `{ error }` 와 상태 코드로 온다:
  `400` 잘못된 요청, `404` 없는 대화, `409` 그 대화가 아직 답변 중, `413` 본문이 너무 큼,
  `503` 동시 실행 상한(기본 4) 또는 최근 24시간 비용 상한(기본 $10)을 넘음.
- 서버에 `BASIC_AUTH` 가 설정돼 있으면 모든 요청(`/api/health` 제외)에 HTTP Basic 인증이 필요하다.
  같은 주소의 페이지라면 브라우저가 처음 한 번 묻고 이후 `fetch` 에 자동으로 붙인다.
- 연결을 끊으면 서버도 그 답변 생성을 멈춘다. 질문은 저장된 채로 남는다.

`EventSource` 는 POST 를 못 하므로 `fetch` 로 읽는다:

```ts
const res = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message, sessionId }),
});
if (!res.ok) throw new Error((await res.json()).error);
const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
let buffer = '';
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += value;
  const chunks = buffer.split('\n\n');
  buffer = chunks.pop()!;
  for (const chunk of chunks) {
    const data = chunk.split('\n').find((line) => line.startsWith('data: '));
    if (data) onEvent(JSON.parse(data.slice(6))); // { type: 'session' | 'tool' | 'delta' | 'done' | 'error', ... }
  }
}
```

### `GET /api/sessions`

최근 대화 50개. `{ sessions: [{ id, appEnv, title, createdAt, updatedAt }] }`.
`title` 은 첫 질문 앞 40자. 기본은 지금 서버(dev/prod)에서 만든 대화만, `?env=all` 이면 전부.

### `GET /api/sessions/:id/messages`

`{ sessionId, messages: [{ id, role: "user" | "assistant", content, toolCalls, createdAt }] }`.
`toolCalls` 는 그 답변에서 부른 E-UM API `[{ name, input, isError }]` 또는 `null`. 없는 대화면 `404`.

### `GET /api/health`

`{ ok, env, commit, schema, agentAuth }`. 배포 스크립트가 기동 확인에 쓴다.

## 지금 없는 것

- 사용자 구분: 암호를 아는 사람은 모든 대화를 볼 수 있다. 운영자·근로자·지역 역할(기획서 5장)이 생길 때 붙인다.
- 규칙 함수(건조 등급 등)와 배치·승인 흐름(US-1~3 도메인)

## 저장소 (SQLite)

`prototype/db/migrations/` 가 정본이다. 지금은 `chat_session`, `chat_message` 두 테이블.
기획서 6장의 도메인 테이블은 `0002_...sql` 부터 추가한다. dev·prod 가 같은 DB 파일을 쓰므로
마이그레이션은 **추가만** 한다 (컬럼·테이블 삭제나 이름 변경 금지).
