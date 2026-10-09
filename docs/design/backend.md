# 서버 구조

최종 확인: **2026-10-09** · 정본: [server/main.ts](../../server/main.ts), [server/vite-api.ts](../../server/vite-api.ts), [server/workspace.ts](../../server/workspace.ts), [server/sqlite-store.ts](../../server/sqlite-store.ts), [server/claude-cli.ts](../../server/claude-cli.ts), [server/chat.ts](../../server/chat.ts), [server/collect.ts](../../server/collect.ts)

왜 이렇게 정했나: [0005 백엔드 통합](../decisions/0005-merge-backend-into-haepung-app.md). 엔드포인트와 요청·응답은 [관측·채팅 API](chat-api.md), [계정·작업 API](workspace-api.md)에 있고 여기서는 되풀이하지 않는다. VM 배치·배포·백업은 [infra/gcp/README.md](../../infra/gcp/README.md). 변수 이름은 [.env.example](../../.env.example).

## 실행 형태

API 는 하나의 미들웨어(`createApiMiddleware`)이고, 아래 세 방식이 같은 코드를 쓴다.

| 방식 | 명령 | 주소 | 화면 | 저장 |
| --- | --- | --- | --- | --- |
| 로컬 개발 | `npm run dev` | `127.0.0.1:3000` | Vite | `DATABASE_PATH` 가 없으면 `.local-data/workspace.json` |
| VM dev | `vite --host 127.0.0.1 --port 3001 --strictPort` | `127.0.0.1:3001` | Vite | 공유 SQLite |
| prod | `node server/main.ts` (`npm start`) | `127.0.0.1:3000` (`HOST`, `PORT`) | 빌드한 `dist/` | 공유 SQLite |

```
브라우저 ──https──▶ Caddy ─┬─ 443 ──▶ prod  node server/main.ts           127.0.0.1:3000  (dist + API)
                          ├─ 443 dev.<도메인> ──▶ dev   vite + API 미들웨어 (화면 파일만) 127.0.0.1:3001
                          └─ 80  ──▶ 443 으로 넘김
prod, dev ──▶ 같은 SQLite 파일 (DATABASE_PATH)
prod 전용 타이머 ──30분마다──▶ node server/collect.ts ──▶ 같은 SQLite 파일
```

- 앱은 127.0.0.1 에만 연다. 바깥 접속은 Caddy 가 TLS 로 받아 넘긴다.
- `main.ts` 는 API 를 먼저 보고, API 가 아닌 주소만 `dist/` 로 넘긴다. 확장자 없는 주소(`/invite/...`)는 `index.html` 을 주고, `dist/` 밖 파일은 읽지 않는다. `/api/` 아래의 없는 주소는 JSON 404 다.
- `.local-data/` 가 들어간 경로는 항상 404 다.
- `npm run preview` 는 빌드 결과에 같은 API 미들웨어를 붙인다.
- `main.ts` 는 `APP_MODE=server` 로 시작한다. `npm run dev`·`npm run preview`·VM dev 는 이 값이 없다.

## 저장

`DATABASE_PATH` 가 있으면 SQLite(`better-sqlite3`), 없으면 `.local-data/workspace.json` 파일이다. 둘 다 같은 읽기·쓰기 계약을 지킨다.

SQLite 저장소:

- `documents` 표의 한 행(`key = workspace`)에 계정·덕장·초대·작업 기록 문서 전체를 JSON 으로 넣는다. 열은 `key`, `schema`, `generation`, `data`, `updated_at`. WAL 모드, 쓰기가 겹치면 5초까지 기다린다.
- 쓰기는 `BEGIN IMMEDIATE` 트랜잭션에서 최신 문서를 읽고 함수를 실행한다. 쓰기 함수는 동기 함수만 받는다. Promise 를 돌려주면 `ASYNC_WRITE` 로 거부한다.
- 저장 전에 문서를 검증하고 실패하면 저장하지 않는다(`INVALID_DOCUMENT`). 읽을 때 손상된 문서도 빈 문서로 덮지 않고 실패한다.
- 캐시는 `generation` 으로 확인한다. 쓸 때마다 새로 만드는 난수라서 백업을 복원해도 옛 캐시가 복원본을 덮어쓰지 않는다.
- `schema` 번호(지금 1)를 문서와 함께 저장한다. 저장된 번호가 코드보다 새로우면 읽기·쓰기 모두 `SCHEMA_TOO_NEW` 로 실패한다. 더 옛 형식이면 `ALLOW_SCHEMA_UPGRADE=1` 일 때만 쓸 수 있다(`SCHEMA_UPGRADE_NOT_ALLOWED`). prod 배포 때만 이 값을 켠다.
- VM 의 dev 와 prod 는 이 파일 하나를 같이 쓴다. 저장 검증 규칙을 바꿀 때의 순서와 prod 가 멈췄을 때의 복구는 [0006](../decisions/0006-shared-db-validation-order.md).
- 같은 파일에 `llm_usage` 표(claude 호출 비용 기록)도 둔다. claude 제공자와 `DATABASE_PATH` 가 함께 있을 때만 만든다.

관리 스크립트는 서버와 같은 저장소(잠금·검증·schema 확인)를 거치므로 서버가 켜져 있어도 된다.

```bash
DATABASE_PATH=<db> node scripts/admin.ts users                       # 계정 목록
DATABASE_PATH=<db> node scripts/admin.ts reset-password <email>      # 임시 비밀번호를 한 번만 보여 주고 기존 로그인을 끊는다
DATABASE_PATH=<db> node scripts/admin.ts import-json <path> [--force]  # workspace.json 가져오기 (DB 가 비었을 때만)
DATABASE_PATH=<db> node scripts/admin.ts export-json <path>          # 새 JSON 파일로 내보내기 (권한 0600)
node scripts/copy-prod-to-dev.ts <원본.db> <대상.db> [--force]         # SQLite 온라인 백업으로 복사
```

dev 가 저장 형식을 바꾸는 작업을 할 때는 `copy-prod-to-dev.ts` 로 만든 복사본을 dev 의 `DATABASE_PATH` 로 쓴다. 형식이 같을 때만 prod 와 DB 를 공유한다.

## LLM 제공자

`LLM_PROVIDER` 가 `claude` 이면 claude CLI, 그 밖에는 OpenAI 호환 HTTP API(기본)다. 기본 지시는 [server/prompts/](../../server/prompts/)의 md 파일(페르소나·규칙·도구 쓰는 법·자료 읽는 법·과메기 상식)이고 서버가 시작할 때 읽는다. 판정·등급·숫자는 코드가 정하고 모델은 설명만 쓴다 ([0010](../decisions/0010-drying-grade-rules.md), [0011](../decisions/0011-assistant-reads-with-tools.md)).

- **claude**: 이 덕장의 읽기 전용 도구 5개(`server/agent-tools.ts`)를 부를 수 있다. 서버는 AI 가 실제로 부른 도구로 화면 카드를 정한다. 도구 목록과 카드는 [채팅 요청·응답](chat-api.md#채팅-요청응답).
- **OpenAI 호환**: 도구 없이, 같은 지시문과 서버가 미리 담은 자료(현재 관측·덕장·배치·예보)로 답한다. 과거 기간 분석은 하지 않는다.
- 답은 내보내기 전에 검사한다(`server/answer-checks.ts`). 현재 시점 문장의 등급이 규칙과 다르거나 현재 관측을 보지 않고 널어도 된다고 하면 규칙 문장으로, 측정 숫자가 도구 결과·기준·지시문·대화에 없으면 도구가 만든 요약으로 바꾸고 `provider: local` 과 `providerNotice` 를 붙인다. 호출이 실패해도 같은 대체 답을 준다. 대체 답은 질문이 지금 날씨를 묻지 않으면 등급을 꺼내지 않는다.

**claude CLI** (`server/claude-cli.ts`): 메시지마다 `claude -p` 프로세스 하나. 프롬프트는 stdin, 결과는 `--output-format json`. 이전 대화는 화면이 보낸 `history` 를 글로 이어 붙이고, 첫 질문도 `지금 질문:` 으로 감싼다. `/` 로 시작하는 입력은 `--disable-slash-commands` 를 줘도 CLI 가 명령으로 가로채기 때문이다.

- 제한 플래그: `--tools ""`, `--strict-mcp-config`, `--disable-slash-commands`, `--setting-sources ""`, `--no-session-persistence`, `--max-budget-usd`. `api_key` 모드는 `--bare` 를 더한다.
- 도구: `--mcp-config` 로 서버 안의 루프백 MCP 엔드포인트(`server/tool-server.ts`, 127.0.0.1 임의 포트, Streamable HTTP 의 JSON 응답만)를 주고 `--allowedTools mcp__haepung` 으로 그것만 허용한다. 채팅 요청마다 일회용 토큰을 만들고 요청이 끝나면 지운다. 토큰은 인자가 아니라 환경변수 `HAEPUNG_TOOL_TOKEN` 으로 넘긴다 (프로세스 목록에 보이지 않게). 한 질문에 도구는 8번까지다.
- 작업 폴더는 빈 폴더(`AGENT_WORKDIR`). 자식 프로세스에는 허용 목록의 환경변수(`PATH`, `HOME`, `CLAUDE_CONFIG_DIR` 등)와 인증 값 하나만 넘기고 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` 을 건다. E-UM 키 같은 다른 비밀값은 넘기지 않는다.
- 시간 초과(`AGENT_TIMEOUT_MS`)는 프로세스 그룹에 SIGTERM, 5초 뒤 SIGKILL 이다. 화면이 요청을 취소하거나 채팅 경로 전체 제한(90초)이 지나도 같은 방법으로 멈춰 동시 실행 자리를 바로 돌려준다.
- 인증 값(`CLAUDE_CODE_OAUTH_TOKEN` 또는 `ANTHROPIC_API_KEY`)은 `.env.local` 이 아니라 프로세스 환경변수에서만 읽는다. VM 은 systemd 가 `backend.env` 로 넣는다.

| 변수 | 기본값 | 뜻 |
| --- | --- | --- |
| `LLM_PROVIDER` | `openai` | `claude` 면 claude CLI |
| `CLAUDE_BIN` | `claude` | 실행 파일 |
| `AGENT_WORKDIR` | `.local-data/agent-workdir` | claude 의 작업 폴더 |
| `AGENT_AUTH_MODE` | `subscription` | `subscription`: 토큰 또는 서버 로그인. `api_key`: `--bare` + `ANTHROPIC_API_KEY` |
| `AGENT_MODEL`, `AGENT_EFFORT` | CLI 기본 | 모델, 추론 강도 |
| `AGENT_MAX_BUDGET_USD` | `0.5` | 메시지 하나당 비용 상한. 시간 초과 때 기록하는 비용이기도 하다 |
| `AGENT_TIMEOUT_MS` | `75000` | 메시지 하나당 시간 제한 (도구 왕복 포함) |
| `AGENT_MAX_CONCURRENCY` | `4` | 동시에 띄우는 claude 수. 넘으면 로컬 설명 |
| `AGENT_DAILY_BUDGET_USD` | `10` | 최근 24시간 비용 합계 상한. `DATABASE_PATH` 가 있을 때만 세고 dev·prod 가 합산 |

**비용 기록.** 메시지 하나가 끝날 때마다 `llm_usage` 에 비용을 쌓고, 최근 24시간 합계가 `AGENT_DAILY_BUDGET_USD` 에 닿으면 이후 질문은 로컬 설명으로 바뀐다. 상한을 피해 가지 못하도록 아래처럼 센다.

| 경우 | 기록하는 비용 |
| --- | --- |
| 정상 종료 | claude 가 알려 준 실제 비용 |
| 비용을 알려 준 실패 (예: 메시지당 상한 초과) | 그 비용 |
| 시간 초과, 화면이 취소 (연결 끊김, 채팅 전체 90초 제한) | 비용을 알 수 없어 `AGENT_MAX_BUDGET_USD × (돈 시간 / AGENT_TIMEOUT_MS)`. 제한 시간을 다 쓰면 메시지당 상한 전체다. 세지 않으면 취소를 반복해 하루 한도를 피해 갈 수 있다 |
| 그 밖에 비용을 알 수 없는 실패 | 세지 않는다 |

VM 에 넣는 값은 [infra/gcp/backend.env.example](../../infra/gcp/backend.env.example). OpenAI 호환 경로의 변수(`OPENAI_API_KEY`, `LLM_API_BASE` 등)와 응답 형식은 [chat-api.md](chat-api.md).

제공자를 더하려면 `AgentAsk`(`{ system, history, message, signal }` 를 받아 `{ text, costUsd? }` 를 돌려주는 함수) 하나를 만든다.

## 접근 제어

**출처 규칙.** 모든 API 요청(`/api/health` 포함)이 `isLocalWorkspaceRequest` 를 통과해야 한다. 어긋나면 403 `LOCAL_ORIGIN_REQUIRED`. CORS 허용 헤더는 내지 않으므로 같은 출처의 화면만 쓴다.

1. `Host` 가 루프백(`localhost`, `127.0.0.1`, `[::1]`)이거나 `PUBLIC_ORIGINS` 의 호스트여야 한다. 개발용 터널 호스트(`PUBLIC_TUNNEL_HOSTS`)도 허용한다.
2. 연결한 쪽(소켓)이 루프백이어야 한다. 원격 요청은 같은 VM 의 Caddy 를 거쳐서만 들어온다.
3. 호스트가 `PUBLIC_ORIGINS` 에 해당하면 `Origin` 헤더가 있을 때 **목록의 전체 출처(스킴·호스트·포트)와 정확히 같아야** 하고, `Sec-Fetch-Site` 는 없거나 `same-origin`·`none` 이어야 한다. 이름이나 포트가 다른 출처(dev.<도메인> 의 화면이 prod 를 부르는 경우)는 같은 사이트(same-site)여도 거부한다. dev·prod 가 DB 를 같이 쓰기 때문이다. 기본 포트(443, 80)는 `Host` 에서 생략돼도 받는다.
4. 루프백·터널이면 `Origin` 이 `Host` 와 같은 출처(터널은 호스트 이름만)이고 `Sec-Fetch-Site` 가 `cross-site` 가 아니어야 한다.

`PUBLIC_ORIGINS` 는 쉼표로 구분한 전체 출처 목록이다. 요청마다 읽으며, `.env` 파일의 값은 시작할 때 프로세스 환경으로 옮겨진다(이미 있는 값은 덮지 않는다).

**쿠키.** `gwamegi_session`: `HttpOnly; SameSite=Lax; Path=/`, 30일. `Secure` 는 소켓이 TLS 이거나 `COOKIE_SECURE=1` 일 때 붙는다. Caddy 뒤의 앱은 평문 연결로 보이므로 VM 은 `COOKIE_SECURE=1` 이 필요하다. `Domain` 을 붙이지 않으므로 dev(`dev.<도메인>`)와 prod 는 쿠키가 따로다. 계정은 같은 DB 라 같지만 로그인은 각각 한다.

**dev 접속 암호.** `DEV_BASIC_AUTH=아이디:비밀번호` 를 설정하면 Vite dev 서버가 정적 파일을 포함한 모든 요청에 HTTP Basic 인증을 요구한다. 공개된 Vite dev 는 저장소의 코드·문서 파일을 그대로 주기 때문이다. `npm run preview` 와 `main.ts` 에는 걸지 않는다. `DEV_OPEN=1` 이면 암호 대신 화면에 필요한 주소(`/`, `/index.html`, `/src/`, `/node_modules/`, `public/` 의 파일, Vite 내부 `/@vite/`·`/@react-refresh`·`/@id/__x00__`, `/api/`)만 주고 나머지는 404 다. 인코딩과 `../` 를 푼 경로로 판단하며 `DEV_BASIC_AUTH` 보다 앞선다. VM 은 이 방식이다([0008](../decisions/0008-open-dev-app-files-only.md)). `PUBLIC_ORIGINS` 가 설정돼 있는데 둘 다 없으면 dev 서버는 공개된 채 열리지 않도록 오류로 시작을 멈춘다. 같이 쓰는 Vite 설정:

- `DEV_ALLOWED_HOSTS`: 쉼표 목록, Vite `allowedHosts`.
- `DEV_HMR_CLIENT_PORT`: 화면 자동 갱신 연결을 받는 포트(Caddy 의 443).
- `.env*`, 키·인증서 파일, `.npmrc`, `.git`, `.local-data` 는 Vite 가 주지 않는다(`server.fs.deny`).

**로그인·가입 제한.**

- 로그인: 같은 `클라이언트 주소 + 이메일` 로 10분 안에 실패가 5번 쌓이면(성공하면 기록을 지운다) 이후 10분 동안 429 `LOGIN_RATE_LIMITED` 를 돌려준다. 차단 중에는 올바른 비밀번호도 거절한다.
- 가입: 같은 클라이언트 주소에서 1시간에 10번까지만 받고, 넘으면 429 `SIGNUP_RATE_LIMITED` 를 돌려준다. 계정을 만든 요청만 세고, 이미 가입한 이메일 등으로 실패한 시도는 세지 않는다 (같은 와이파이를 쓰는 여러 사람). 계정을 대량으로 만들어 AI 사용량을 쓰는 것을 늦추려는 장치다.
- 둘 다 기록은 프로세스 메모리에만 있어서 dev·prod 가 따로 세고 재시작하면 사라진다. 클라이언트 주소는 소켓이 루프백(Caddy)일 때만 `X-Forwarded-For` 를 믿는다.

## 수집기

`server/collect.ts` (`npm run collect`)는 한 번 돌고 끝나는 프로세스다. systemd 타이머 `haepung-collect.timer` 가 prod 와 같은 환경으로 매시 00분·30분에 띄운다([타이머](../../infra/gcp/systemd/haepung-collect.timer), [서비스](../../infra/gcp/systemd/haepung-collect.service)). dev 는 같은 DB 를 쓰므로 수집기를 돌리지 않는다(두 번 쌓인다).

- **대상:** 진행 중인 배치가 있는 덕장만. 하나도 없으면 E-UM 을 부르지 않고 끝난다.
- **조회:** `createObservationService` 로 한 번만 조회하고(장비 목록 `INT_S01_001`, 일괄 관측 `INT_S01_003`, 빠진 장비는 단건 `INT_S01_004`. [chat-api.md](chat-api.md)) 모든 덕장이 그 결과를 같이 쓴다.
- **기록:** 덕장마다 화면과 같은 기준(1km 안의 최근 관측 중 가장 가까운 장비)으로 관측을 고른다. 진행 중인 배치마다 `appendLiveObservation`([src/lib/operations.ts](../../src/lib/operations.ts))이 받아 주면 실제 관측으로 기록한다. 수동 기록의 기준(`observationRecordIssue`: 현재 상태, 관측 후 30분 이내, 값·시각 유효, 확인 사항 없음)을 그대로 쓴다.
- **결측:** 고르지 못했거나 기준에 못 미치면(E-UM 조회 실패, 보관 자료만 있음, 1km 안에 최근 관측 없음, 기록 기준 미달) 결측 샘플을 남긴다. 장비 ID 는 `collector-missing`, 값과 `distanceM` 은 `null`, `alert` 는 `false` 이고 이유는 배치 로그의 `detail` 에 적는다. 보고서에서 결측 샘플은 결측률에만 잡히고 유효 표본·거리 검증에서는 빠진다(`getBatchReport`).
- **한 구간에 한 번:** 로그 id 를 `collect-<30분 구간 시작 시각(ISO)>` 로 정한다. 같은 id 가 이미 있으면(타이머가 두 번 돌아도) 아무것도 더하지 않는다. 운영자가 같은 장비·같은 관측 시각을 이미 손으로 기록했다면 그 표본이 대신한다.
- **저장:** `workspace.appendCollected(siteId, update)` 가 잠금 안에서 최신 기록에 적용한다. 운영자 저장처럼 `revision` 을 올리므로 화면의 충돌 재시도가 그대로 동작하고, 저장 전 검증과 근로자 이력 보호도 같다. 사람의 요청이 아니라 쿠키·소속 검사는 없다.
- **등급과 경보:** 기록한 관측마다 규칙 함수(`assessDrying`, [0010](../decisions/0010-drying-grade-rules.md))로 등급을 매겨 로그 `detail` 에 등급·이유·기준 이름을 남긴다. 강수는 기상청 초단기실황을 쓴다. 부적합이면 직전 경보로부터 1시간이 지났을 때만 `kind: alert` 로그(`alert-<구간>`)를 더하고 그 샘플의 `alert` 를 `true` 로 한다. 근로자·휴대폰 알림 발신과 기본 조언 3시간 쿨다운은 아직 없다.
- **끝나는 법:** 한 줄 요약(`[collect] <시각> source=… sites=… batches=… recorded=… missing=… skipped=… failed=…`)을 남기고 끝난다. 덕장 한 곳의 저장이 실패하면 나머지는 계속 수집하되 종료 코드가 1 이고, 저장소를 열지 못해도 1 이다. E-UM 조회 실패는 결측으로 기록하므로 종료 코드 0 이다.

## 헬스체크

`GET /api/health` 는 저장소를 실제로 한 번 읽는다. 못 읽으면 503 이다. 응답 필드는 [chat-api.md](chat-api.md)에 있다. `commit` 은 `GIT_COMMIT` 환경변수(배포가 만드는 `release.env`)이고, 배포 스크립트가 새 `commit` 이 보이는지 확인한다. 읽기에 실패하면 배포가 직전 release 로 자동으로 되돌아간다([infra/gcp/README.md](../../infra/gcp/README.md)).

## 지금 없는 것

- 이메일 확인·비밀번호 재설정 메일. 계정 복구는 `scripts/admin.ts` 로 한다.
- 경보 발신(근로자·휴대폰 알림), 기본 조언 3시간 쿨다운. 경보는 배치 기록에만 남는다.
- 기상특보(B2), 초단기·단기예보. 특보는 API허브 활용신청이 필요하다 ([호출 기록](../../research/api-tests/2026-10-06-kma-apihub.md)). 기상청 보조 자료는 [chat-api.md](chat-api.md#기상청-보조).
- 서버 쪽 대화 저장. 대화는 브라우저 저장소에 있다.
- 데이터베이스 표 분리. 문서 하나를 한 행에 넣는다.
