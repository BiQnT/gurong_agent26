# 관측·채팅 API 연결 계약

최종 확인: **2026-10-09** · 정본: [server/vite-api.ts](../../server/vite-api.ts), [server/chat.ts](../../server/chat.ts), [server/sources/eum-uv.ts](../../server/sources/eum-uv.ts), [src/lib/live.ts](../../src/lib/live.ts), [src/lib/chat.ts](../../src/lib/chat.ts)

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
| `EUM_TIMEZONE_OFFSET`     | 시간대 없는 원천 시각을 읽는 값, 기본 `+09:00` (확인된 값, 아래 참고) |
| `EUM_STALE_AFTER_MINUTES` | 화면의 과거 관측 구분 기준, 기본 30분         |

신선도 설정은 **화면 데이터 갱신 기준이며 식품 건조 안전 기준이 아니다**.

**원천 시각의 시간대.** E-UM 의 `logDateTime`(예: `2026-10-04 14:00:33`)에는 시간대 표기가 없지만 한국 시간이다. `2026-10-04T05:01:00Z`(한국 14:01)에 부른 단건 관측이 `14:00:33` 이었다([호출 기록](../../research/api-tests/2026-10-04-eum-key.md)). UTC 였다면 9시간 뒤 미래 시각이 된다.

- 기본값 `+09:00` 으로 읽으면 확인된 사실이므로 관측에 확인 사항(`issues`)을 붙이지 않는다. 그래서 "현재 관측값 기록"과 [30분 수집기](backend.md#수집기)가 실제 관측을 기록할 수 있다.
- 다른 값으로 바꾸면 해석 가정을 관측의 `issues` 와 응답의 `warnings` 에 남기고, 확인 사항이 있는 관측은 기록하지 않는다. 확인된 값은 [server/eum.ts](../../server/eum.ts)의 `EUM_SOURCE_OFFSET` 이다.
- 자외선 측정 시각(아래)도 시간대가 없으면 같은 설정으로 읽는다.

`VITE_API_BASE_URL`이 없거나 비어 있으면 같은 출처의 API를 사용한다. 별도 애플리케이션 서버로 바꿀 때만 주소를 지정한다. 예를 들어 `http://localhost:8000`이면 해당 출처의 관측·채팅·계정·작업 API를 호출하며 쿠키를 포함한다. 별도 서버가 브라우저 출처를 허용하거나 같은 출처로 프록시해야 한다. `VITE_`는 공개 설정이므로 비밀키를 넣지 않는다.

## 경로

| 요청                                      | 결과                                                   |
| ----------------------------------------- | ------------------------------------------------------ |
| `GET /api/health`                         | 저장소 읽기 확인, 서버 모드·커밋·저장 schema, E-UM 설정 여부, LLM 제공자·설정 여부·모델 이름 |
| `GET /api/observations?siteId=덕장ID&deviceId=관측기ID` | 실제 장비 목록·관측값·선택 관측·출처·한계              |
| `POST /api/chat`                          | 관측 근거와 완성된 설명, 처리 제공자, 선택적 작업 의도 |
| `GET /api/geocode/search?q=주소`          | 로그인 필요. 주소 → 좌표 후보 최대 3개 `{ results: [{ latitude, longitude, label }] }` |
| `GET /api/geocode/reverse?lat=위도&lng=경도` | 로그인 필요. 좌표 → 한국식 주소 `{ address }` (없으면 `null`) |

주소 검색은 OpenStreetMap Nominatim 을 서버가 대신 부른다. 서버 전체에서 1.1초에 한 번, 하루 캐시, 대기 20건을 넘으면 429 `GEOCODER_BUSY`, 연결 실패는 502 `GEOCODER_UNAVAILABLE`, 입력 오류는 400 `INVALID_ADDRESS`·`INVALID_LOCATION` 이다. 한국은 도로·마을 단위까지만 찾으므로 화면은 결과로 핀을 근처에 놓고 정확한 위치는 사용자가 맞춘다. 호출 기록: [2026-10-06 Nominatim](../../research/api-tests/2026-10-06-nominatim-geocode.md).

`GET /api/health` 응답은 `{ mode, eum: { configured }, llm: { provider, configured, model }, commit, schema }`이다. `mode`는 운영 서버(`main.ts`)에서 `server`, Vite 개발·미리보기에서 `local-bridge`다. `llm.provider`는 `openai` 또는 `claude`다. `commit`은 서버가 받은 `GIT_COMMIT`이며 없으면 `null`, `schema`는 저장 문서의 형식 번호다. 저장소를 읽지 못하면 `{ error, code }`와 HTTP 503을 돌려주며, 배포 스크립트가 이 응답으로 새 버전을 확인한다. `configured`는 키가 설정되었다는 뜻이며 실제 인증 성공을 검증하지 않는다. claude 제공자는 키 대신 서버의 로그인·토큰을 쓰므로 선택만으로 `true`다.

`siteId`가 있으면 소속을 검사하고 실제 위치와의 거리를 계산한다. `deviceId`를 생략하면 1km 내 최근 관측소 중 가까운 관측소를 선택하고, 없으면 다른 자료와 거리·신선도 한계를 함께 제공한다. `siteId`가 없는 공개 관측 조회는 기존 최신 시각 선택을 유지한다. 알 수 없는 장비 ID는 거절한다.

## 관측 응답

`LiveSnapshot`은 다음 필드를 사용한다.

| 필드                       | 내용                                                         |
| -------------------------- | ------------------------------------------------------------ |
| `fetchedAt`                | 서버가 자료를 조회·읽은 시각. 관측 시각과 다름               |
| `source`, `sourceUrl`      | 자료 출처와 키 없는 원천 API 경로                            |
| `devices`                  | 장비 ID·이름·주소·위경도, 선택적 `provider` (`eum`·`kma`, 없으면 E-UM) |
| `observations`, `selected` | 전체 정규화 관측과 선택 관측, 없으면 `null`                  |
| `status`                   | `ok` 또는 `archived`. 클라이언트 타입은 `error`도 지원       |
| `archiveSourceDate`        | 보관 자료의 최신 원천 관측일                                 |
| `warnings`                 | 조회 실패, 시간대 해석(`+09:00` 이 아닐 때), 거리·판정 기준 한계 |
| `llm`                      | 모델 키 설정 여부와 모델 이름                                |
| `weather`                  | `siteId` 가 있을 때만. 덕장 위치의 보조 자료 (아래 "기상청 보조"), 없으면 빠진다 |
| `selectionReason`          | 고른 이유: `eum`, `kma-no-recent-eum`(최근 E-UM 없음), `kma-eum-anomaly`(E-UM 값 비정상·기상청과 크게 다름), `explicit`(사용자가 고름) |
| `assessment`               | `siteId` 가 있을 때만. 규칙 함수의 널기 판정 (아래 "널기 판정") |

각 `LiveObservation`에는 `device`, `temperature`, `humidity`, `windSpeed`, `observedAt`, `observedAtRaw`, `ageMinutes`, `status`, `issues`, 선택적 `distanceM`이 있다. `siteId`가 있으면 스냅샷에 등록된 덕장의 `site: {id,name,latitude,longitude}`도 반환한다. 단위는 °C, %, m/s, 분이다. 없는 값은 `null`이다. 서버는 기온 −80~60°C, 습도 0~100%, 풍속 0~100m/s 밖의 값을 오류로 처리하고 원래 확인 가능한 다른 항목은 유지한다. 이 범위는 비정상 센서값을 거르는 데이터 검증 기준이며 건조 적합 기준이 아니다. 존재하지 않는 날짜와 시각의 자동 보정도 거부한다.

- `current`: 필요한 값·시각이 있으며 화면의 신선도 기준 이내이다.
- `stale`: 과거 관측이거나 명시된 보관 자료이다.
- `invalid`: 필수 값 또는 시각을 확인할 수 없다.

이 상태는 건조 적합 등급이 아니다. 등록한 덕장과의 거리는 m 단위이며, 위치가 없는 공개 조회는 거리를 만들어 내지 않는다.

서버는 장비 목록 `INT_S01_001`과 일괄 관측 `INT_S01_003`을 조회하고, 일괄 조회 실패·누락 시 단건 `INT_S01_004`로 다시 확인한다. 목록 API만 실패하면 보관된 실제 장비 정보와 실시간 API 측정값을 연결한다. 이때 `status: ok`는 관측값의 실시간 조회 성공을 뜻하며, 장비 정보가 보관 자료라는 사실은 `warnings`에 표시한다. 과거 측정값을 실시간 응답의 결측에 끼워 넣지 않는다. 자료는 서버에서 30초간 캐시한다. E-UM 개별 요청 제한은 12초이다.

### 기상청 보조

`KMA_AUTH_KEY` 가 있으면 E-UM 과 함께 기상청을 부른다 ([서버 코드](../../server/sources/kma.ts), [호출 기록](../../research/api-tests/2026-10-06-kma-apihub.md)). E-UM 이 정본이고 기상청은 보조다 ([0009](../decisions/0009-kma-fallback-for-eum.md)).

- **AWS 816 구룡포 매분자료**: 관측 목록 끝에 `device.id = kma-aws-816`, `provider: kma` 로 붙는다 (경도 129.5475, 위도 35.9831). 덕장 1km 안에 최근(`current`) E-UM 값이 있으면 E-UM 을 고르고, 없을 때만 1km 안의 AWS 를 고르며 `warnings` 에 알린다. 둘 다 최근 값인데 기온 5°C·습도 25% 넘게 다르면 관측기 상태를 확인하라고 알린다. 덕장이 없는 공개 조회도 최근 E-UM 값이 하나도 없을 때만 AWS 를 고른다. 화면·AI·30분 수집기가 같은 선택을 쓴다.
- **`weather`** (`siteId` 가 있는 관측 조회와 채팅 근거): `precipitation` 기상청 초단기실황(덕장 좌표를 기상청 격자로 바꿔 조회, 지금 비·눈과 1시간 강수량), `rain` AWS 816 의 최근 60분·오늘 강수량, `sun` 한국천문연구원 일출·일몰(`DATA_GO_KR_KEY` 필요). 판정에는 쓰지 않는다.
- 캐시: AWS 1분, 실황 10분, 일출·일몰 하루, 실패 30초~10분. 한 번 시도는 4초, 응답이 없으면 한 번 더 부른다. 관측 응답은 기상청을 최대 5초만 기다리고 늦은 결과는 다음 조회부터 쓴다.
- AWS 는 최근 10분(1분 전까지)을 받아 기온·습도가 있는 마지막 줄을 쓴다. 화면이 `kma-aws-816` 을 고른 채 물었는데 이번에 기상청을 못 받았으면 오류 대신 기본 선택을 쓴다. E-UM 이 보관 자료뿐이어도 1km 안의 기상청 AWS 실시간 값이 골라지면 수집기가 기록한다.
- 채팅은 경로 제한(90초)에서 관측을 기다린 시간을 뺀 만큼만 AI 를 기다리고, 넘으면 코드의 대체 답을 준다.
- `weather.forecast`: 기상청 초단기예보 앞으로 6시간 (`at`, 기온·습도·풍속, `precipitation`, `rain` 글). 등급을 바꾸지 않고 조언으로만 쓴다 ([호출 기록](../../research/api-tests/2026-10-06-kma-ultra-forecast.md)).
- E-UM 값이 비정상(습도 5% 미만)이거나 1km 안 기상청 AWS 와 기온 5°C·습도 25% 넘게 다르면 그 E-UM 장비를 건너뛰고, 다른 믿을 만한 E-UM 이 없으면 기상청 AWS 로 판정한다 (`selectionReason: kma-eum-anomaly`, [0010](../decisions/0010-drying-grade-rules.md)).
- 기상특보(B2)는 API허브 활용신청 뒤에 붙인다.

### 널기 판정 (`assessment`)

`src/lib/drying.ts` 의 `assessDrying` 이 고른 관측과 `weather` 로 등급을 정한다. 같은 입력이면 AI 없이 같은 결과다. 결정과 기준: [0010](../decisions/0010-drying-grade-rules.md).

| 등급 | 조건 (모두 가설값, `2026-10-06 가설값`) |
| --- | --- |
| 판정 불가 | 1km 안 최근 관측 없음, 오래됨, 값 누락, 습도 5% 미만 같은 비정상 값, 기온 -5°C 미만 |
| 부적합 | 비·눈(초단기실황), 풍속 14m/s 이상(강풍주의보 육상), 습도 85% 이상, 기온 15°C 초과 중 하나 |
| 적합 | 습도 60% 미만, 풍속 2~14m/s, 기온 -5~10°C 모두 |
| 주의 | 그 밖. 비·눈을 확인하지 못했으면(기상청 실황 없음) 적합 대신 주의 |

필드: `grade`, `summary`, `temperature`·`humidity`·`windSpeed`, `observedAt`·`ageMinutes`·`distanceM`(판정 불가면 `null` 가능), `deviceName`, `source`, `reasons`(축별 이유·측정 시각 KST·장비·거리), `advice`(예보·강수 조언, 등급 불변), `thresholds`(적용 기준 전체). 화면 검증기 `readAssessment` 는 등급이 있는데 수치가 없거나 1km 를 넘으면 받지 않는다.

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

성공 응답에는 일반 텍스트 `content`, 후속 질문 배열 `suggestions`, `provider: openai | compatible | claude | local`, `sourceFetchedAt`이 있다. `compatible`은 OpenAI가 아닌 호환 API(`LLM_API_BASE`)다. AI 답 대신 코드의 대체 답을 줬다면 `providerNotice`를 포함한다.

**카드 필드는 AI 가 그 자료를 실제로 봤을 때만 실린다** ([0011](../decisions/0011-assistant-reads-with-tools.md)). 팀·사용법 질문에는 카드가 없다. 모든 필드는 선택이고, 화면 검사기(`readChatReply`)는 형식이 틀린 카드만 버리고 답은 보여 준다. 숫자는 모두 서버 코드가 계산한다.

| 필드 | 언제 | 내용 |
| --- | --- | --- |
| `assessment`, `observation` | AI 가 현재 상태 도구를 불렀을 때 | 규칙 판정과 그 판정에 쓴 관측. 화면은 한 장(현재 건조 환경)으로 합쳐 그린다 |
| `forecast` | 예보 도구 | `ForecastOutlook`: 기상청 초단기예보 시간마다 같은 규칙으로 매긴 `expectedGrade`. 현재 등급이 아니다 |
| `history` | 과거 기간 도구, 기간 비교 도구 (최대 2개) | `HistorySummary`: 기간·출처·관측 지점과 거리·결측률, 일(31일 이하) 또는 주 단위 `rows`(기온·습도·풍속 평균·최저·최고, 강수, 등급별 시간 `gradeHours`, 가장 긴 적합 구간), 합계와 비율 |
| `batches` | 배치 도구 | `BatchDigest[]`: 원물·마리 수, 시작·종료, 걸린 시간, 기록 요약, 표본을 지금 기준으로 다시 매긴 등급 비율, 경보 수 |
| `sources` | 카드가 있을 때 | 화면의 "근거" 줄. 예: `현재 관측: 구룡포 주상절리 · 10.09 13:05 KST` |

타입과 검사기는 [src/lib/analysis.ts](../../src/lib/analysis.ts), [src/lib/chat.ts](../../src/lib/chat.ts). 화면은 카드를 답 문장 위에 둔다 (현재 환경 → 예보 → 기간 → 배치).

`action`은 선택적으로 `start-batch`, `end-batch`, `guidance` 중 하나다. 해당 화면을 열기 위한 의도이며 채팅 응답만으로 저장·종료·발송하지 않는다. 답에 `action` 버튼이 있으면 현재 건조 환경 카드 안의 같은 버튼은 숨긴다.

### AI 가 보는 자료 (도구)

`LLM_PROVIDER=claude`이면 서버가 `claude -p` 에 지시문([server/prompts/](../../server/prompts/))과 이 덕장 범위의 읽기 전용 도구를 준다 (연결 방식은 [LLM 제공자](backend.md#llm-제공자)). 도구 결과의 시각은 모두 `MM.DD HH:mm KST` 문자열이고, 계정 이메일과 덕장·관측기 좌표는 들어가지 않는다.

| 도구 | 결과 |
| --- | --- |
| `get_current_conditions` | 선택 관측(장비·기온·습도·풍속·시각·거리·상태), 규칙 판정과 이유·조언·적용 기준, 고른 이유(`selectionReason`), 비·눈·강수량·일출일몰, 자외선(`uv`, 아래), 경고 |
| `get_site_overview` | 덕장 이름·주소·등록일, 가까운 관측기 3개와 거리, 팀원 수(역할·언어별), 초대 대기, 배치 수, 답을 기다리는 근로자 질문 수 |
| `get_batches` | `status`(진행·종료·취소·전체), `limit`(1~10). 배치 요약 |
| `get_weather_history` | `from`·`to`(KST 날짜, 오늘까지, 한 번에 120일). 기간 요약. 외부 과거 관측이 없으면 이 덕장의 배치 기록(배치가 진행 중일 때만 30분마다 쌓임)으로 요약하고 `note` 로 한계를 알린다 |
| `compare_periods` | `base_from`·`base_to`·`target_from`·`target_to`. 두 기간 요약과 항목별 차이(비교 - 기준: 평균 기온·습도·풍속, 강수, 적합 시간·비율). 합친 점수는 없다. 판정할 자료가 없거나 결측 50% 초과, 출처가 다르면 `comparable: false` 와 이유 (신청서 US-4 의 비교 불가 처리). 카드는 두 기간 요약 |
| `get_forecast_outlook` | 초단기예보 예상 등급 |

OpenAI 호환 요청은 `/chat/completions`를 사용하며 `stream: false`로 완성된 답변을 받는다. 모델 요청 제한은 25초이다. 도구 없이 같은 지시문과 서버가 미리 담은 자료(위 표의 현재·덕장·배치·예보, `# CONTEXT`)를 주고, 과거 기간 분석은 하지 않는다. 이 경로의 카드는 질문이 날씨·널기(`assessment`)나 배치(`batches`)를 물을 때만 싣는다.

**답 검사와 대체 답.** AI 답은 내보내기 전에 코드가 다시 본다.

- 현재 시점 문장이 규칙 등급과 다른 등급을 말하거나, 현재 관측을 보지 않고 지금 널어도 된다고 하거나, 안전을 보장하면 규칙 등급을 옮긴 로컬 문장으로 바꾼다. 과거·예보 문장의 다른 등급은 어긋남이 아니다.
- 측정 숫자(°C·%·m/s·mm)가 이번 질문의 도구 결과·기준값·지시문·대화에 없으면 도구가 만든 요약 문장으로 바꾼다 (답의 자릿수로 반올림해 같으면 통과).
- 키 부재, 인증·한도·연결 실패, 시간 초과, 형식 오류면 질문 종류에 맞는 코드 요약(팀·배치·현재 상태)으로 답한다. 지금 날씨를 묻지 않은 질문에는 등급을 꺼내지 않는다.

이 검사는 모든 문장의 사실성을 증명하는 장치가 아니므로 구조화된 카드와 한계 표시를 함께 제공한다. 원천 오류 본문이나 키를 그대로 노출하지 않는다.

### 자외선 근거 (`uv`)

현재 상태 도구(`get_current_conditions`, OpenAI 호환 경로는 `# CONTEXT` 의 `current`)에는 관측 외에 `uv` 필드가 있다. E-UM `INT_S06_005` 자외선 실시간([2026-08-06 판정표](../../research/api-tests/probe-summary.md), HTTP 200)에서 읽으며 [server/sources/eum-uv.ts](../../server/sources/eum-uv.ts)가 맡는다. 응답(`ChatReply`)에는 담기지 않는다.

| 항목 | 내용 |
| --- | --- |
| 값 | `{ uvIndex, observedAt, stage, fetchedAt }` 또는 `null` |
| `stage` | 코드가 기상청 단계로 계산한다. 낮음 0-2, 보통 3-5, 높음 6-7, 매우높음 8-10, 위험 11 이상이며 소수 측정값은 반올림한다. 모델이 정하지 않는다 |
| 캐시 | 성공 10분, 실패 1분. 동시 요청은 E-UM 호출 하나로 합친다 |
| 시간 | E-UM 요청 제한 12초. 도구는 최대 3초만 기다리고 늦으면 `null` 로 진행한다. 조회는 뒤에서 이어져 다음 질문부터 캐시를 쓴다 |
| `null` | 키 없음, 조회 실패·시간 초과, 응답 형식 오류, 지수가 0-20 밖(센서 오류값을 거르는 자료 확인 범위이며 위험 기준이 아니다), 측정 시각을 알 수 없거나 조회 시각보다 5분 넘게 미래, 1시간 넘게 지난 값(멈춘 센서. 갱신 주기를 아직 확인하지 못해 1시간까지 받는다) |

프롬프트는 `uv` 를 근로자의 햇빛 노출 조언에만 쓰고 측정 시각을 함께 밝히게 하며, 건조 적합·작업 가능 판정으로 바꾸지 못하게 하고, `null` 이면 자외선을 말하지 않게 한다. OpenAI 호환 경로와 claude 경로가 같은 값을 쓴다.

## 진행 상태·취소·오류

`ChatTransport.send(request, { signal, onProgress })`는 최종 응답을 Promise로 반환한다. 화면은 요청 전달 → 응답 대기 → 응답 형식 확인을 표시한다. 글자 단위 스트리밍이나 서버 내부 진행률을 추정하지 않는다.

`AbortSignal`은 브라우저 fetch와 서버의 E-UM·OpenAI 호환 요청까지 연결한다. 클라이언트 연결이 끊어지면 서버도 요청 중단을 시도하며 전체 처리 제한은 관측 45초, 채팅 90초이다 (AI 가 도구를 부르는 시간). claude 제공자도 같이 멈추며, 비용을 알 수 없으므로 돈 시간만큼 추정해 기록한다([비용 기록](backend.md#llm-제공자)). 이미 외부 서비스에 전달된 요청의 처리·사용량까지 되돌린다는 의미는 아니다.

서버 오류의 JSON 형태는 `{ error: string, code: string }`이다. 주요 상태는 잘못된 입력 400, 허용 출처 조건 불충족 403(`LOCAL_ORIGIN_REQUIRED`), 미지원 메서드 405, 본문 초과 413, JSON 형식 필요 415, 외부 자료 확보 실패 502/503, 시간 초과·중단 504이다. E-UM 인증 실패가 보관 자료로 복구되면 HTTP 200과 `status: archived`로 결과와 실패 사유를 함께 제공한다.

## 테스트와 남은 경계

`npm test`로 클라이언트 계약, 관측 정규화, 데이터 폴백, 채팅 전송과 기록 처리를 확인한다. 목업 전송은 격리된 테스트에서만 명시적으로 선택하며 앱 기본 흐름은 HTTP이다. 실제 외부 호출 결과는 [2026-10-03 기록](../../research/api-tests/2026-10-03-live-connection.md)에 있다.

실제 덕장 등록·거리, 계정·역할·승인 API와 공유 SQLite 저장, 30분 자동 수집은 구현했다([서버 구조](backend.md)). 규칙 판정(가설 기준)과 수집기의 부적합 경보 기록도 구현했다. 이메일 확인·재설정, 현장 검증된 기준, 경보 알림 발신·조언 쿨다운, 번역 검증·외부 안내 전송은 후속 범위다. 서버를 바꾸더라도 이 계약을 유지해야 한다.
