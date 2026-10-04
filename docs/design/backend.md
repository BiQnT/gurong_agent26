# 서버 구조

최종 확인: **2026-10-04** · 정본: [server/main.ts](../../server/main.ts), [server/vite-api.ts](../../server/vite-api.ts), [server/workspace.ts](../../server/workspace.ts), [server/sqlite-store.ts](../../server/sqlite-store.ts), [server/claude-cli.ts](../../server/claude-cli.ts)

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
                          ├─ 440 ──▶ dev   vite + API 미들웨어 (Basic 암호) 127.0.0.1:3001
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

`LLM_PROVIDER` 가 `claude` 이면 claude CLI, 그 밖에는 OpenAI 호환 HTTP API(기본)다. 어느 쪽이든 서버가 관측 근거를 확보해 시스템 프롬프트로 주고 모델은 설명만 쓴다. 모델에는 도구가 없고 판정·등급은 코드가 정한다. 응답이 확인되지 않은 판정 표현을 담았거나 호출이 실패하면 관측 사실만 말하는 로컬 설명으로 바꾸고 `provider: local` 과 `providerNotice` 를 붙인다.

**claude CLI** (`server/claude-cli.ts`): 메시지마다 `claude -p` 프로세스 하나. 프롬프트는 stdin, 결과는 `--output-format json`. 이전 대화는 화면이 보낸 `history` 를 글로 이어 붙인다.

- 제한 플래그: `--tools ""`, `--strict-mcp-config`, `--disable-slash-commands`, `--setting-sources ""`, `--no-session-persistence`, `--max-budget-usd`. `api_key` 모드는 `--bare` 를 더한다.
- 작업 폴더는 빈 폴더(`AGENT_WORKDIR`). 자식 프로세스에는 허용 목록의 환경변수(`PATH`, `HOME`, `CLAUDE_CONFIG_DIR` 등)와 인증 값 하나만 넘기고 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` 을 건다. E-UM 키 같은 다른 비밀값은 넘기지 않는다.
- 시간 초과·취소는 프로세스 그룹에 SIGTERM, 5초 뒤 SIGKILL 이다.
- 인증 값(`CLAUDE_CODE_OAUTH_TOKEN` 또는 `ANTHROPIC_API_KEY`)은 `.env.local` 이 아니라 프로세스 환경변수에서만 읽는다. VM 은 systemd 가 `backend.env` 로 넣는다.

| 변수 | 기본값 | 뜻 |
| --- | --- | --- |
| `LLM_PROVIDER` | `openai` | `claude` 면 claude CLI |
| `CLAUDE_BIN` | `claude` | 실행 파일 |
| `AGENT_WORKDIR` | `.local-data/agent-workdir` | claude 의 작업 폴더 |
| `AGENT_AUTH_MODE` | `subscription` | `subscription`: 토큰 또는 서버 로그인. `api_key`: `--bare` + `ANTHROPIC_API_KEY` |
| `AGENT_MODEL`, `AGENT_EFFORT` | CLI 기본 | 모델, 추론 강도 |
| `AGENT_MAX_BUDGET_USD` | `0.5` | 메시지 하나당 비용 상한 |
| `AGENT_TIMEOUT_MS` | `40000` | 메시지 하나당 시간 제한 |
| `AGENT_MAX_CONCURRENCY` | `4` | 동시에 띄우는 claude 수. 넘으면 로컬 설명 |
| `AGENT_DAILY_BUDGET_USD` | `10` | 최근 24시간 비용 합계 상한. `DATABASE_PATH` 가 있을 때만 세고 dev·prod 가 합산 |

VM 에 넣는 값은 [infra/gcp/backend.env.example](../../infra/gcp/backend.env.example). OpenAI 호환 경로의 변수(`OPENAI_API_KEY`, `LLM_API_BASE` 등)와 응답 형식은 [chat-api.md](chat-api.md).

제공자를 더하려면 `AgentAsk`(`{ system, history, message, signal }` 를 받아 `{ text, costUsd? }` 를 돌려주는 함수) 하나를 만든다.

## 접근 제어

**출처 규칙.** 모든 API 요청(`/api/health` 포함)이 `isLocalWorkspaceRequest` 를 통과해야 한다. 어긋나면 403 `LOCAL_ORIGIN_REQUIRED`. CORS 허용 헤더는 내지 않으므로 같은 출처의 화면만 쓴다.

1. `Host` 가 루프백(`localhost`, `127.0.0.1`, `[::1]`)이거나 `PUBLIC_ORIGINS` 의 호스트여야 한다. 개발용 터널 호스트(`PUBLIC_TUNNEL_HOSTS`)도 허용한다.
2. 연결한 쪽(소켓)이 루프백이어야 한다. 원격 요청은 같은 VM 의 Caddy 를 거쳐서만 들어온다.
3. 호스트가 `PUBLIC_ORIGINS` 에 해당하면 `Origin` 헤더가 있을 때 **목록의 전체 출처(스킴·호스트·포트)와 정확히 같아야** 하고, `Sec-Fetch-Site` 는 없거나 `same-origin`·`none` 이어야 한다. 이름이 같고 포트만 다른 출처(dev 440 의 화면이 prod 443 을 부르는 경우)는 거부한다. dev·prod 가 쿠키와 DB 를 같이 쓰기 때문이다. 기본 포트(443, 80)는 `Host` 에서 생략돼도 받는다.
4. 루프백·터널이면 `Origin` 이 `Host` 와 같은 출처(터널은 호스트 이름만)이고 `Sec-Fetch-Site` 가 `cross-site` 가 아니어야 한다.

`PUBLIC_ORIGINS` 는 쉼표로 구분한 전체 출처 목록이다. 요청마다 읽으며, `.env` 파일의 값은 시작할 때 프로세스 환경으로 옮겨진다(이미 있는 값은 덮지 않는다).

**쿠키.** `gwamegi_session`: `HttpOnly; SameSite=Lax; Path=/`, 30일. `Secure` 는 소켓이 TLS 이거나 `COOKIE_SECURE=1` 일 때 붙는다. Caddy 뒤의 앱은 평문 연결로 보이므로 VM 은 `COOKIE_SECURE=1` 이 필요하다. 쿠키는 포트별로 나뉘지 않아 같은 호스트의 dev(440)와 prod(443)는 로그인이 공유된다.

**dev 접속 암호.** `DEV_BASIC_AUTH=아이디:비밀번호` 를 설정하면 Vite dev 서버가 정적 파일을 포함한 모든 요청에 HTTP Basic 인증을 요구한다. 공개된 Vite dev 는 저장소의 코드·문서 파일을 그대로 주기 때문이다. `npm run preview` 와 `main.ts` 에는 걸지 않는다. 같이 쓰는 Vite 설정:

- `DEV_ALLOWED_HOSTS`: 쉼표 목록, Vite `allowedHosts`.
- `DEV_HMR_CLIENT_PORT`: 화면 자동 갱신 연결을 받는 포트(Caddy 의 440).
- `.env*`, 키·인증서 파일, `.npmrc`, `.git`, `.local-data` 는 Vite 가 주지 않는다(`server.fs.deny`).

**로그인 제한.** 같은 `클라이언트 주소 + 이메일` 로 10분 안에 로그인이 5번 쌓이면(성공하면 기록을 지운다) 이후 10분 동안 429 `LOGIN_RATE_LIMITED` 를 돌려준다. 차단 중에는 올바른 비밀번호도 거절한다. 가입에는 적용하지 않는다. 기록은 프로세스 메모리에만 있어서 dev·prod 가 따로 세고 재시작하면 사라진다. 클라이언트 주소는 소켓이 루프백(Caddy)일 때만 `X-Forwarded-For` 를 믿는다.

## 수집기

`server/collect.ts` (`npm run collect`)는 한 번 돌고 끝나는 프로세스다. systemd 타이머 `haepung-collect.timer` 가 prod 와 같은 환경으로 매시 00분·30분에 띄운다. dev 는 같은 DB 를 쓰므로 수집기를 돌리지 않는다(두 번 쌓인다).

- 진행 중인 배치가 있는 덕장을 찾아 E-UM 일괄 관측(`INT_S01_003`)을 한 번 호출하고, 덕장마다 1km 기준 장비를 골라 신뢰도를 검사한 뒤 `appendLiveObservation`([src/lib/operations.ts](../../src/lib/operations.ts))의 규칙으로 배치 기록에 추가한다. 수집하지 못한 시각은 결측 샘플로 남긴다.
- 적합 등급은 만들지 않는다.
- 자외선 조언(E-UM `INT_S06_005`)의 단계는 코드가 계산한다. AI 는 단계를 정하지 않고 설명만 한다.
- `KMA_AUTH_KEY`(기상청 API허브), `DATA_GO_KR_KEY`(공공데이터포털)는 설정에서 읽지만 아직 이 키로 호출하는 기능은 없다.

## 헬스체크

`GET /api/health` 는 저장소를 실제로 한 번 읽는다. 못 읽으면 503 이다. 응답 필드는 [chat-api.md](chat-api.md)에 있다. `commit` 은 `GIT_COMMIT` 환경변수(배포가 만드는 `release.env`)이고, 배포 스크립트가 새 `commit` 이 보이는지 확인한다. 읽기에 실패하면 배포가 직전 release 로 자동으로 되돌아간다([infra/gcp/README.md](../../infra/gcp/README.md)).

## 지금 없는 것

- 가입 제한과 이메일 확인·비밀번호 재설정 메일. 계정 복구는 `scripts/admin.ts` 로 한다.
- 서버 쪽 대화 저장. 대화는 브라우저 저장소에 있다.
- 데이터베이스 표 분리. 문서 하나를 한 행에 넣는다.
