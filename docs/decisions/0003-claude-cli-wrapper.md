# 0003. 생성형 AI 는 claude CLI 를 메시지마다 띄우고, E-UM 은 MCP 도구로 준다

- **날짜**: 2026-10-04
- **상태**: 제안
- **정한 사람**: 안동현
- **관련**: [docs/design/backend.md](../design/backend.md), 본선 서비스 기획서 "규칙 함수 및 생성형 AI의 작업 분리"

## 맥락

사용자가 채팅으로 보낸 메시지를 Claude 에게 넘기고, Claude 가 필요한 E-UM API 를 불러 답하게 해야 했다.
어떤 E-UM API 를 쓸지는 아직 확정 전이다 (기획서에는 5종). 공개 주소에서 도는 서버라
Claude 가 셸 명령을 실행하거나 서버 파일을 읽으면 안 된다.

## 결정

- 메시지마다 `claude -p` 프로세스를 하나 띄우고 출력(`stream-json`)을 SSE 로 브라우저에 흘린다.
  두 번째 턴부터는 첫 턴에 받은 세션 id 로 `--resume` 한다.
- 내장 도구는 전부 끈다(`--tools ""`). 쓸 수 있는 것은 우리 MCP 서버의 E-UM 도구뿐이다
  (`--strict-mcp-config`, `--allowedTools mcp__eum__*`, `--permission-mode dontAsk`).
- 서버 계정의 개인 설정·플러그인·CLAUDE.md 는 읽지 않는다(`--setting-sources ""`, 빈 작업 폴더).
- E-UM API 는 `allowlist.ts` 에 적힌 것만 도구가 된다. 설명은 카탈로그에서 자동으로 붙는다.
- 인증은 환경변수 하나로 바꾼다. 당분간 `subscription`(팀 내부 테스트), 외부 공개 전 `api_key`(`--bare`).

## 이유

- 팀이 원한 방식이 "메시지를 CLI 로 넘겨서 받아오기"다. 터미널에서 같은 명령으로 그대로 재현된다.
- MCP 도구로 주면 serviceKey 는 서버에만 있고 Claude 는 키를 보지 못한다. 응답 JSON 도 요약 없이 그대로 받는다.
- 2026-10-04 로컬에서 확인: 위 플래그로 띄우면 도구는 E-UM 5개만 보이고, 개인 CLAUDE.md 지시가
  적용되지 않으며, `--resume` 이 같은 세션 id 로 이전 대화를 기억한다. 가짜 키로 부르면 E-UM 이 401 을
  돌려주고 Claude 는 값을 지어내지 않고 실패를 그대로 말했다.
- Anthropic 정책상 개인 구독(Pro/Max) 로그인으로 다른 사람에게 서비스하는 제품을 만들 수 없다.
  CLI 로 넘기든 SDK 로 넘기든 같다. 그래서 전환을 env 한 줄로 만들어 두었다.

## 검토한 대안

| 대안 | 왜 안 골랐나 |
| --- | --- |
| Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) | 내부적으로 같은 CLI 를 띄운다. 팀이 CLI 직접 호출을 원했다 |
| Messages API + 직접 도구 루프 | 루프·세션 저장을 우리가 짜야 한다. 3주 일정에 비해 이득이 작다 |
| Claude 에 Bash/WebFetch 를 열어 E-UM 을 curl 하게 하기 | 공개 서버에서 셸 실행은 위험하고, serviceKey 가 Claude 에게 노출된다 |

## 결과

- 쉬워지는 것: E-UM API 추가는 한 줄. 규칙 함수(건조 등급 등)도 같은 MCP 서버에 도구로 붙이면 된다
- 감수하는 것: 메시지마다 프로세스를 띄워 1~2초 더 걸린다. 동시 실행은 4개로 묶었다
- 되돌리려면: `src/agent/claude-cli.ts` 만 바꾸면 된다. `chat/service.ts` 는 이벤트만 받는다
