# 관측·채팅 API 연결 계약

최종 확인: **2026-10-04** · 정본: [server/vite-api.ts](../../server/vite-api.ts), [src/lib/live.ts](../../src/lib/live.ts), [src/lib/chat.ts](../../src/lib/chat.ts)

Vite의 개발·미리보기 서버와 운영 서버(`node server/main.ts`)에 E-UM과 LLM(OpenAI 호환 API 또는 claude CLI)을 호출하는 연결 계층을 붙인다. 계정·덕장·초대·배치·안내의 저장 API도 제공한다. 서버 구성은 [서버 구조](backend.md)를 참고한다. 관련 계약은 [계정·작업 API](workspace-api.md)를 참고한다. 브라우저는 아래 애플리케이션 API만 호출하며 원천 서비스의 키를 받지 않는다.

## 실행과 환경 설정

`npm run dev`, `npm run preview`와 운영 서버 `node server/main.ts`(빌드한 `dist/`와 API를 한 포트에서 제공)가 동일한 API 미들웨어를 제공한다. 로컬 개발 주소는 `http://127.0.0.1:3000`이다. 요청은 로컬 루프백 또는 `PUBLIC_ORIGINS`에 적은 전체 출처(스킴·호스트·포트)와 같은 동일 출처 요청만 받는다. 원격 접속은 TLS 프록시(Caddy) 뒤에서만 열며 규칙은 [접근 제어](backend.md#접근-제어)에 있다. `dist/`만 정적 배포하면 이 API가 생기지 않는다.

키는 Git에서 무시하는 `.env.local`에 저장한다. 설정을 바꾼 뒤 개발·미리보기 서버를 다시 시작한다.

`EUM_SERVICE_KEY`는 원문과 포털의 URL 인코딩 형태를 모두 받는다. 서버 설정에서 퍼센트 인코딩을 한 번만 해제하고, 실제 요청은 `URLSearchParams`로 인코딩한다. 원문의 `+`는 공백으로 바꾸지 않는다.

| 서버 변수                 | 용도·기본값                                   |
| ------------------------- | --------------------------------------------- |
| `EUM_SERVICE_KEY`         | 실제 E-UM 인증                                |
| `OPENAI_API_KEY`          | OpenAI 인증                                   |
| `OPENAI_MODEL`            | 기본 `gpt-4.1-mini`                           |
| `LLM_PROVIDER`            | 기본 `openai`, `claude`면 claude CLI          |
| `EUM_TIMEZONE_OFFSET`     | 시간대 없는 원천 시각의 해석값, 기본 `+09:00` |
| `EUM_STALE_AFTER_MINUTES` | 화면의 과거 관측 구분 기준, 기본 30분         |

신선도 설정은 **화면 데이터 갱신 기준이며 식품 건조 안전 기준이 아니다**. 원천 시각의 시간대가 없어 설정값을 적용했다면 응답의 한계 정보에 이를 남긴다.

`VITE_API_BASE_URL`이 없거나 비어 있으면 같은 출처의 API를 사용한다. 별도 애플리케이션 서버로 바꿀 때만 주소를 지정한다. 예를 들어 `http://localhost:8000`이면 해당 출처의 관측·채팅·계정·작업 API를 호출하며 쿠키를 포함한다. 별도 서버가 브라우저 출처를 허용하거나 같은 출처로 프록시해야 한다. `VITE_`는 공개 설정이므로 비밀키를 넣지 않는다.

## 경로

| 요청                                      | 결과                                                   |
| ----------------------------------------- | ------------------------------------------------------ |
| `GET /api/health`                         | 저장소 읽기 확인, 서버 모드·커밋·저장 schema, E-UM 설정 여부, LLM 제공자·설정 여부·모델 이름 |
| `GET /api/observations?siteId=덕장ID&deviceId=관측기ID` | 실제 장비 목록·관측값·선택 관측·출처·한계              |
| `POST /api/chat`                          | 관측 근거와 완성된 설명, 처리 제공자, 선택적 작업 의도 |

`GET /api/health` 응답은 `{ mode, eum: { configured }, llm: { provider, configured, model }, commit, schema }`이다. `mode`는 운영 서버(`main.ts`)에서 `server`, Vite 개발·미리보기에서 `local-bridge`다. `llm.provider`는 `openai` 또는 `claude`다. `commit`은 서버가 받은 `GIT_COMMIT`이며 없으면 `null`, `schema`는 저장 문서의 형식 번호다. 저장소를 읽지 못하면 `{ error, code }`와 HTTP 503을 돌려주며, 배포 스크립트가 이 응답으로 새 버전을 확인한다. `configured`는 키가 설정되었다는 뜻이며 실제 인증 성공을 검증하지 않는다. claude 제공자는 키 대신 서버의 로그인·토큰을 쓰므로 선택만으로 `true`다.

`siteId`가 있으면 소속을 검사하고 실제 위치와의 거리를 계산한다. `deviceId`를 생략하면 1km 내 최근 관측소 중 가까운 관측소를 선택하고, 없으면 다른 자료와 거리·신선도 한계를 함께 제공한다. `siteId`가 없는 공개 관측 조회는 기존 최신 시각 선택을 유지한다. 알 수 없는 장비 ID는 거절한다.

## 관측 응답

`LiveSnapshot`은 다음 필드를 사용한다.

| 필드                       | 내용                                                         |
| -------------------------- | ------------------------------------------------------------ |
| `fetchedAt`                | 서버가 자료를 조회·읽은 시각. 관측 시각과 다름               |
| `source`, `sourceUrl`      | 자료 출처와 키 없는 원천 API 경로                            |
| `devices`                  | 장비 ID·이름·주소·위경도                                     |
| `observations`, `selected` | 전체 정규화 관측과 선택 관측, 없으면 `null`                  |
| `status`                   | `ok` 또는 `archived`. 클라이언트 타입은 `error`도 지원       |
| `archiveSourceDate`        | 보관 자료의 최신 원천 관측일                                 |
| `warnings`                 | 조회 실패, 시간대 해석, 거리·판정 기준 한계 |
| `llm`                      | 모델 키 설정 여부와 모델 이름                                |

각 `LiveObservation`에는 `device`, `temperature`, `humidity`, `windSpeed`, `observedAt`, `observedAtRaw`, `ageMinutes`, `status`, `issues`, 선택적 `distanceM`이 있다. `siteId`가 있으면 스냅샷에 등록된 덕장의 `site: {id,name,latitude,longitude}`도 반환한다. 단위는 °C, %, m/s, 분이다. 없는 값은 `null`이다. 서버는 기온 −80~60°C, 습도 0~100%, 풍속 0~100m/s 밖의 값을 오류로 처리하고 원래 확인 가능한 다른 항목은 유지한다. 이 범위는 비정상 센서값을 거르는 데이터 검증 기준이며 건조 적합 기준이 아니다. 존재하지 않는 날짜와 시각의 자동 보정도 거부한다.

- `current`: 필요한 값·시각이 있으며 화면의 신선도 기준 이내이다.
- `stale`: 과거 관측이거나 명시된 보관 자료이다.
- `invalid`: 필수 값 또는 시각을 확인할 수 없다.

이 상태는 건조 적합 등급이 아니다. 등록한 덕장과의 거리는 m 단위이며, 위치가 없는 공개 조회는 거리를 만들어 내지 않는다.

서버는 장비 목록 `INT_S01_001`과 일괄 관측 `INT_S01_003`을 조회하고, 일괄 조회 실패·누락 시 단건 `INT_S01_004`로 다시 확인한다. 목록 API만 실패하면 보관된 실제 장비 정보와 실시간 API 측정값을 연결한다. 이때 `status: ok`는 관측값의 실시간 조회 성공을 뜻하며, 장비 정보가 보관 자료라는 사실은 `warnings`에 표시한다. 과거 측정값을 실시간 응답의 결측에 끼워 넣지 않는다. 자료는 서버에서 30초간 캐시한다. E-UM 개별 요청 제한은 12초이다.

실시간 조회를 확보하지 못하면 `research/api-tests/raw/INT_S01_001.json`, `INT_S01_003.json`의 **`response.data`만** 읽는다. 요청 URL·파라미터는 반환하지 않는다. 보관 자료는 `archived`로 표시하고 유효한 값도 `current`로 바꾸지 않는다. 보관 자료마저 없거나 손상됐다면 오류로 종료하며 값을 생성하지 않는다.

## 채팅 요청·응답

요청의 `Content-Type`은 `application/json`이다.

```json
{
  "message": "선택한 관측 자료의 한계를 알려줘",
  "siteId": "등록된-덕장-ID",
  "history": []
}
```

선택한 장비가 있으면 관측 응답의 ID를 `deviceId`에 추가한다. `siteId`는 실제 덕장 ID이며 로그인한 운영자 소속을 검사한다. 근로자·다른 덕장 사용자의 요청은 원천 API 호출 전에 거부한다. `scenario`가 전달되어도 실제 관측이나 등급을 결정하는 데 사용하지 않는다.

클라이언트는 최근 이력을 최대 12개·JSON 기준 UTF-8 6,000바이트 범위로 제한한다. 서버는 메시지 6,000자, 입력 이력 40개, 본문 32KiB를 상한으로 검사하고, 모델에는 최근 이력 최대 12개를 전달한다. 이력의 각 항목은 `role: user | assistant`, `content: string`이다. 현재 메시지는 이력과 구분한다.

성공 응답에는 일반 텍스트 `content`, 후속 질문 배열 `suggestions`, `provider: openai | compatible | claude | local`, `sourceFetchedAt`이 있다. `compatible`은 OpenAI가 아닌 호환 API(`LLM_API_BASE`)다. 선택 관측이 있으면 `observation`, 로컬 설명으로 대체했다면 `providerNotice`를 포함한다. 서버는 관측값을 구조화된 원천 근거에서 가져오며 모델이 카드의 수치를 생성하지 않는다.

`action`은 선택적으로 `start-batch`, `end-batch`, `guidance` 중 하나다. 해당 화면을 열기 위한 의도이며 채팅 응답만으로 저장·종료·발송하지 않는다. 기존 `Assessment` 타입은 호환·테스트에 남아 있지만 현재 로컬 서버는 검증되지 않은 건조 등급 대신 관측 근거를 반환한다.

OpenAI 호환 요청은 `/chat/completions`를 사용하며 `stream: false`로 완성된 답변을 받는다. 모델 요청 제한은 25초이다. `LLM_PROVIDER=claude`이면 서버가 `claude -p` CLI에 같은 근거를 주고 설명만 받는다. 도구는 없고 메시지당 시간·비용 상한, 동시 실행 상한, 최근 24시간 비용 상한이 있다([LLM 제공자](backend.md#llm-제공자)). 한도 초과·인증 실패·시간 초과도 아래처럼 로컬 설명으로 대체한다. 모델에는 위치 등록 여부와 계산된 거리를 보내며 계정 이메일·실제 덕장 좌표를 따로 보내지 않는다. 키 부재, 인증·한도·연결 실패 또는 불완전한 응답이면 확보한 관측 사실을 설명하는 로컬 문장으로 대체하고 제공자와 사유를 표시한다. 확인되지 않은 적합·안전·건조 가능 단정 표현도 보수적으로 검사해 로컬 설명으로 대체한다. 이 표현 검사는 모든 문장의 사실성을 검증하는 장치는 아니므로 구조화된 원천 관측과 한계 표시를 함께 제공한다. 원천 오류 본문이나 키를 그대로 노출하지 않는다.

## 진행 상태·취소·오류

`ChatTransport.send(request, { signal, onProgress })`는 최종 응답을 Promise로 반환한다. 화면은 요청 전달 → 응답 대기 → 응답 형식 확인을 표시한다. 글자 단위 스트리밍이나 서버 내부 진행률을 추정하지 않는다.

`AbortSignal`은 브라우저 fetch와 서버의 외부 요청까지 연결한다. 클라이언트 연결이 끊어지면 서버도 요청 중단을 시도하며 전체 처리 제한은 45초이다. 이미 외부 서비스에 전달된 요청의 처리·사용량까지 되돌린다는 의미는 아니다.

서버 오류의 JSON 형태는 `{ error: string, code: string }`이다. 주요 상태는 잘못된 입력 400, 허용 출처 조건 불충족 403(`LOCAL_ORIGIN_REQUIRED`), 미지원 메서드 405, 본문 초과 413, JSON 형식 필요 415, 외부 자료 확보 실패 502/503, 시간 초과·중단 504이다. E-UM 인증 실패가 보관 자료로 복구되면 HTTP 200과 `status: archived`로 결과와 실패 사유를 함께 제공한다.

## 테스트와 남은 경계

`npm test`로 클라이언트 계약, 관측 정규화, 데이터 폴백, 채팅 전송과 기록 처리를 확인한다. 목업 전송은 격리된 테스트에서만 명시적으로 선택하며 앱 기본 흐름은 HTTP이다. 실제 외부 호출 결과는 [2026-10-03 기록](../../research/api-tests/2026-10-03-live-connection.md)에 있다.

실제 덕장 등록·거리, 계정·역할·승인 API와 공유 SQLite 저장, 30분 자동 수집은 구현했다([서버 구조](backend.md)). 이메일 확인·재설정, 검증된 판정 규칙, 경보·쿨다운, 번역 검증·외부 안내 전송은 후속 범위다. 서버를 바꾸더라도 이 계약을 유지해야 한다.
