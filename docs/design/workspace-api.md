# 계정·덕장 API

최종 확인: **2026-10-09**

정본 계약: [`src/lib/workspace.ts`](../../src/lib/workspace.ts). 구현: [`server/workspace.ts`](../../server/workspace.ts), Vite 연결: [`server/vite-api.ts`](../../server/vite-api.ts). 이 문서는 실제 구현의 범위를 설명한다. 서버 구성(저장소, 접근 제어)은 [서버 구조](backend.md)에 있다.

모든 경로는 `/api` 기준이다. 요청 본문이 있는 호출은 `Content-Type: application/json`을 사용하며, 브라우저 클라이언트는 `credentials: include`로 세션 쿠키를 보낸다. 정상 응답은 HTTP 200, 실패는 `{ error: string, code: string }`이다. 응답에는 `Cache-Control: no-store`를 적용한다.

| 경로 | 방식 | 입력 | 접근 권한·응답 |
| --- | --- | --- | --- |
| `/auth/session` | GET | 없음 | `{ user, sites }`; 비로그인은 `{ user: null, sites: [] }` |
| `/auth/signup` | POST | `{ name, email, password }` | 가입 후 세션 발급, `{ user, sites }` |
| `/auth/login` | POST | `{ email, password }` | 로그인 후 세션 교체, `{ user, sites }` |
| `/auth/logout` | POST | `{}` | 현재 세션 폐기, `{ ok: true }` |
| `/sites` | POST | `{ name, address, latitude, longitude }` | 로그인 필요; 생성자를 운영자로 등록, `Site` |
| `/sites/:id` | PATCH | 같은 덕장 입력 | 해당 덕장 운영자만 수정, `Site` |
| `/sites/:id/preferences` | PATCH | `{ language: 'ko' \| 'vi' }` | 해당 덕장의 자기 언어만 변경, `Site` |
| `/sites/:id/team` | GET | 없음 | 운영자만 팀원·초대 목록, `Team` |
| `/sites/:id/invitations` | POST | `{ language: 'ko' \| 'vi' }` | 운영자만 생성, `{ invitation, token }` |
| `/sites/:id/invitations/:invitationId` | DELETE | 없음 | 운영자만 취소, `{ ok: true }` |
| `/sites/:id/invitations/:invitationId/link` | GET | 없음 | 운영자만, 대기 중인 초대의 링크를 다시 계산해 `{ token }` ([0012](../decisions/0012-invite-link-rederive.md)) |
| `/sites/:id/members/:userId` | DELETE | 없음 | 운영자만 근로자 접근 제거, `{ ok: true }` |
| `/invitations/:token` | GET | 없음 | 링크 보유자에게 덕장·운영자 이름, 언어, 만료 시각, 상태 |
| `/invitations/:token/accept` | POST | `{}` | 로그인한 계정을 근로자로 등록, `Site` |
| `/sites/:id/operations` | GET | 없음 | 해당 덕장 구성원, `{ data, revision }` |
| `/sites/:id/operations` | PUT | `{ data, revision }` | 운영자만 변경, 새 `{ data, revision }` |
| `/sites/:id/guidance/:guidanceId/replies` | POST | `{ kind: 'read' \| 'completed' \| 'question', text? }` | 근로자만 응답, 새 `{ data, revision }` |
| `/sites/:id/guidance/:guidanceId/replies/:replyId/answer` | POST | `{ text }` | 운영자만 실제 질문에 답변, 새 `{ data, revision }` |

`Site.role`과 `Site.language`는 요청한 계정의 덕장별 멤버십에서 결정한다. 계정에 전역 운영자/근로자 역할은 없다. 다른 덕장에 운영자·근로자로 각각 참여할 수 있다. 클라이언트가 보낸 역할·계정 ID는 권한의 근거로 사용하지 않는다. 운영자 자신을 팀에서 제거할 수 없다.

덕장 이름·주소는 필수다. 위도는 유한한 숫자 `-90…90`, 경도는 `-180…180`이다. `/observations?siteId=:id`는 구성원 확인 후 등록 위치에 따른 관측기 선택·거리를 붙인다. `/chat`은 본문의 실제 `siteId`에 운영자 권한을 요구한다. 일반 공개 관측 조회와 `/health`는 로그인 없이 사용할 수 있다.

## 계정·초대 수명

- 이메일은 공백 제거·소문자로 정규화하며 중복 가입을 거절한다. 이름은 1~80자다. 새 비밀번호(가입, 관리 스크립트의 임시 비밀번호)는 8~128자이고 문자(`\p{L}`)와 숫자(`0-9`)를 하나 이상 포함해야 하며, 어기면 HTTP 400 `WEAK_PASSWORD`다. 규칙은 `isStrongPassword`([`src/lib/workspace.ts`](../../src/lib/workspace.ts)) 하나를 서버와 가입 화면이 같이 쓴다. 로그인은 규칙 전에 만든 비밀번호도 받도록 8~128자 길이만 확인한다. 비밀번호는 계정별 난수 salt와 Node `scrypt`로 해시한다.
- 세션은 32바이트 난수의 불투명 토큰이다. `gwamegi_session` 쿠키는 `HttpOnly; SameSite=Lax; Path=/`, 30일 만료이며 서버에도 만료 시각을 저장한다. 연결이 HTTPS이거나 `COOKIE_SECURE=1`이면 `Secure`를 붙인다. TLS 프록시(Caddy) 뒤의 서버는 평문 연결로 보이므로 VM은 `COOKIE_SECURE=1`을 쓴다. 저장소에는 토큰 원문 대신 SHA-256 해시만 저장한다.
- 가입·로그인 시 현재 세션을 교체하고, 로그아웃 시 서버 세션과 쿠키를 폐기한다. 한 계정은 세션을 최근 10개만 둔다. 11번째를 만들면 가장 오래된 세션이 지워지고 그 기기는 로그아웃된 상태가 된다. `Account` 응답에는 `id`, `name`, `email`만 포함한다.
- 초대 토큰은 32바이트(base64url 43자)이며 7일 후 만료한다. 서버 비밀값 `INVITE_LINK_SECRET`(32자 이상, 짧으면 없는 것으로 보고 경고를 남긴다)이 없으면 난수로 만들고 초대 생성 응답에서만 원문을 준다. 있으면 `base64url(HMAC-SHA256(비밀값, "invite:" + 초대 ID))`로 만들어, 운영자가 `GET /sites/:id/invitations/:invitationId/link`로 대기 중인 초대의 링크를 다시 받는다. 서버는 다시 계산한 토큰의 해시가 저장된 해시와 같을 때만 돌려준다. 비밀값 없이 만든 초대와 비밀값을 바꾸기 전 초대는 HTTP 409 `INVITE_LINK_UNAVAILABLE`이고(링크 자체는 만료 전까지 유효), 사용·취소·만료된 초대는 HTTP 410 `INVITATION_UNAVAILABLE`이다. `Invitation.linkAvailable`은 다시 받을 수 있는 대기 중 초대에만 `true`다. 어느 경우든 디스크에는 토큰의 SHA-256 해시만 저장하며 저장 형식은 같다([0012](../decisions/0012-invite-link-rederive.md)). 링크 전송은 운영자가 복사하여 수행하며 이메일을 발송하지 않는다.
- 초대 상태는 `pending`, `accepted`, `revoked`, `expired`다. 만료 여부는 서버 시각으로 계산한다. 동일 계정의 성공한 수락 재시도는 멤버십이 남아 있을 때만 동일 덕장을 반환한다. 다른 계정의 재사용과 제거된 팀원의 기존 초대 재사용은 거절한다.
- 이미 수락한 초대는 취소할 수 없다. 접근을 회수하려면 팀원 제거를 사용한다. 초대를 만든 운영자의 자기 수락은 거절한다.

## 작업 기록·응답

`data`는 공통 `validateOperationsData`로 전체 구조를 검사한다. 덕장별 정수 `revision`은 0에서 시작한다. 운영자 PUT은 읽었던 버전과 현재 버전이 일치해야 하며, 다르면 HTTP 409 `REVISION_CONFLICT`를 반환한다. 클라이언트는 최신 기록을 다시 읽고 변경을 적용한다.

근로자 응답의 ID·시각·계정 이름은 서버가 기록하고 `simulated: false`로 저장한다. `read`/`completed`는 근로자·안내·응답 종류별로 한 번만 추가되며 재시도는 같은 버전을 반환한다. 질문은 공백이 아닌 2,000자 이내다. 완료 응답은 안내 이력을 갱신하며 **배치를 종료하지 않는다**. 연결된 배치가 종료·취소되면 새 근로자 응답은 거절한다. 기존 확인·완료 응답의 재시도는 유지한다.

운영자 답변은 실제 질문의 `answer: { text, at, userId, userName }`에 저장한다. 답변은 공백이 아닌 1,000자 이내 원문이며 자동 번역하지 않는다. 같은 답변의 재시도는 변경 없이 성공하고 다른 내용으로 덮어쓰면 HTTP 409 `ANSWER_EXISTS`다. 배치 종료 후에도 기존 질문에 답할 수 있다. 운영자 PUT은 근로자 응답, 답변 및 근로자 로그를 생성·변조·삭제할 수 없다.

## 오류·저장 경계

| HTTP | 대표 코드 | 의미 |
| --- | --- | --- |
| 400 | `INVALID_CREDENTIALS`, `INVALID_SITE`, `INVALID_OPERATIONS`, `INVALID_REPLY`, `INVALID_ANSWER` | 입력 형식 오류 |
| 400 | `WEAK_PASSWORD` | 가입 비밀번호가 8~128자, 문자·숫자 포함 규칙에 맞지 않음 |
| 400 | `PROTECTED_WORKER_HISTORY` | 응답·답변·근로자 로그 변조 시도 |
| 401 | `AUTH_REQUIRED`, `LOGIN_FAILED` | 로그인 필요 또는 인증 실패 |
| 403 | `SITE_ACCESS_DENIED`, `LOCAL_ORIGIN_REQUIRED` | 덕장 권한 또는 허용 출처 불일치 |
| 404 | `INVITATION_NOT_FOUND`, `GUIDANCE_NOT_FOUND`, `REPLY_NOT_FOUND` | 대상 없음 |
| 409 | `EMAIL_IN_USE`, `REVISION_CONFLICT`, `ANSWER_EXISTS`, `BATCH_CLOSED` | 중복·동시 수정·종료 상태 충돌 |
| 409 | `INVITE_LINK_UNAVAILABLE` | 비밀값 없이 만든 초대이거나 비밀값을 바꾸기 전에 만든 초대라 링크를 다시 계산할 수 없음 |
| 410 | `INVITATION_UNAVAILABLE` | 이미 사용·취소·만료된 초대 |
| 413 / 415 | `BODY_TOO_LARGE` / `JSON_REQUIRED` | 1 MiB 초과 / JSON 형식 필요 |
| 429 | `LOGIN_RATE_LIMITED` | `/auth/login` 실패가 같은 주소·이메일로 10분 안에 5번 쌓여 10분간 차단 |
| 429 | `SIGNUP_RATE_LIMITED` | `/auth/signup` 이 같은 클라이언트 주소에서 1시간에 10번을 넘음. 기록 방식은 [로그인·가입 제한](backend.md#접근-제어) |
| 500 | `WORKSPACE_ERROR` | 디스크·DB 읽기·저장 실패(저장소 schema 불일치 포함); 빈 데이터로 덮어쓰지 않음 |

`DATABASE_PATH`가 설정되면 서버 데이터는 공유 SQLite 파일에 저장한다. dev·prod 프로세스가 같은 파일을 함께 쓰며, 쓰기는 트랜잭션 안에서 저장 전 검증을 거치고 문서 형식(schema) 번호를 확인한다([저장](backend.md#저장)). `DATABASE_PATH`가 없으면(로컬 개발 기본) Git 제외 경로 `.local-data/workspace.json`에 저장한다. 파일 권한은 `0600`, 새 디렉터리는 `0700`이다. 한 Node 프로세스 안에서 파일별 트랜잭션을 직렬화하고 임시 파일 쓰기·동기화·rename으로 교체한다. 파일 손상은 실패로 처리하며 조용히 초기화하지 않는다. Vite 파일 접근 차단과 API 앞단 경로 검사로 `.local-data`의 정적 제공도 막는다.

클라이언트 API는 응답 본문을 포함해 20초 제한을 적용한다. 호출자의 취소 신호는 유지한다. 시간 초과는 저장 실패 확정이 아니므로 최신 상태를 확인한 뒤 재시도한다. 덕장 선택과 운영자 대화는 계정·덕장으로 범위를 나눈 브라우저 저장소를 사용하며, 비밀번호나 세션 토큰을 `localStorage`에 넣지 않는다.

요청은 `localhost`/루프백 호스트이거나 `PUBLIC_ORIGINS`에 적은 전체 출처(스킴·호스트·포트)와 같은 동일 출처만 허용한다. `Origin`이 목록의 출처와 정확히 같아야 하므로 호스트 이름이 같아도 포트가 다르면 거부한다. dev와 prod는 쿠키와 DB를 같이 쓰기 때문에 서로의 화면에서 온 요청을 받지 않는다. 직접 연결한 쪽은 루프백이어야 하므로 원격 접속은 TLS 프록시(Caddy)를 거친다([접근 제어](backend.md#접근-제어)). 이메일 인증·발송과 비밀번호 재설정은 아직 제공하지 않는다. 계정 복구는 관리 스크립트(`scripts/admin.ts`)로 한다. 서버를 바꾸더라도 이 계약을 유지해야 한다.
