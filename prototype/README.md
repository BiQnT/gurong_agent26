# prototype: 과메기 통합 에이전트 서버

Next.js 16 앱. 지금은 백엔드 API 만 있다. 구조와 API 계약은 [docs/design/backend.md](../docs/design/backend.md).

## 로컬 실행

필요한 것: Node 22.18 이상, 로그인된 `claude` CLI (`claude --version`).

```bash
cd prototype
npm ci
cp .env.example .env.local     # EUM_SERVICE_KEY 채우기
npm run db:migrate             # .data/gwamegi.db 생성
npm run dev                    # http://localhost:3000
```

```bash
curl -N localhost:3000/api/chat -H 'content-type: application/json' -d '{"message":"자외선 지수 알려줘"}'
```

`AGENT_AUTH_MODE` 를 비우면 `subscription` 이라 로컬에 로그인된 claude 계정을 쓴다.

## 테스트

```bash
npm test          # vitest. E-UM·claude 를 실제로 부르지 않는다 (기록된 실제 응답으로 검증)
npm run typecheck
npm run build
```

## 자주 하는 일

**E-UM API 를 하나 더 쓰게 하기.** `src/eum/allowlist.ts` 에 API ID 와 쓰는 파라미터를 한 줄 추가한다.
설명·파라미터 설명은 `data/eum-api-catalog.json` 에서 자동으로 붙는다. 넣기 전에
`research/api-tests/probe-summary.md` 에서 실제로 200 이 오는지 확인한다.

**에이전트 말투·규칙 바꾸기.** `src/agent/system-prompt.md` 를 고친다. 다음 메시지부터 반영된다.

**claude 가 실제로 받는 명령 보기.** `src/agent/claude-cli.ts` 의 `buildClaudeArgs` 가 전부다.
같은 인자로 터미널에서 `claude -p ...` 를 돌리면 그대로 재현된다.

**DB 테이블 추가.** `db/migrations/0002_<이름>.sql` 을 만들고 `npm run db:migrate`.
VM 은 dev·prod 가 DB 를 공유하므로 추가만 한다.

## 환경변수

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `EUM_SERVICE_KEY` | | E-UM 서비스키. 없으면 도구가 실패를 돌려준다 |
| `AGENT_AUTH_MODE` | `subscription` | `api_key` 면 claude 를 `--bare` 로 띄워 `ANTHROPIC_API_KEY` 만 쓴다 |
| `CLAUDE_CODE_OAUTH_TOKEN` | | subscription 모드에서 서버용 토큰 (`claude setup-token`) |
| `ANTHROPIC_API_KEY` | | api_key 모드에서 사용 |
| `AGENT_MODEL`, `AGENT_EFFORT` | CLI 기본값 | `--model`, `--effort` 로 넘긴다 |
| `AGENT_MAX_BUDGET_USD` | `0.5` | 메시지 하나당 비용 상한 |
| `AGENT_TIMEOUT_MS` | `120000` | 메시지 하나당 시간 상한 |
| `AGENT_MAX_CONCURRENCY` | `4` | 동시에 띄우는 claude 수 |
| `DATABASE_PATH` | `.data/gwamegi.db` | |
| `AGENT_WORKDIR` | `.data/agent-workdir` | claude 를 띄우는 빈 폴더 |
| `CLAUDE_BIN` | `claude` | |
| `APP_ENV` | `local` | 대화 기록에 남는 환경 이름 |

VM 에서의 값은 [infra/gcp/README.md](../infra/gcp/README.md).
