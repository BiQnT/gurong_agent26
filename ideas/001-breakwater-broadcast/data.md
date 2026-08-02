# 방파제 안내방송 에이전트 — 사용 데이터

실호출 검증일: **2026-08-03** · 서비스키 발급 완료

## 요약

| API ID | 엔드포인트 | 호출 테스트 | 판정 |
| --- | --- | --- | --- |
| `INT_S06_001` | `/dpg/pedestrian/device/list` | **성공** | **사용** — 스피커 8대, AI CCTV 15대, 자외선 1대 |
| `INT_S06_005` | `/dpg/sensor/latest/uvIndex` | **성공** | **사용** — 실시간 갱신 확인 |
| `INT_S01_004` | `/dpg/atmosphere/device/realtime` | **성공** | **사용** — 기온·습도·풍속·풍향 실시간 |
| `INT_S06_006` | `/dpg/aicctv/avghour/datas` | 응답은 성공 | **제외** — 10개월치 검출값이 전부 0 |
| `INT_S03_019` | `/dpg/ship-safe/stats/history` | 부분 성공 | **보류** — 날짜별 구멍 많음. `INT_S01_004`로 대체 |

> **호출 시 주의**: `serviceKey`는 발급 시점에 이미 URL 인코딩된 문자열이다.
> `urllib.parse.urlencode`에 넣으면 이중 인코딩돼 `401 유효하지 않은 이용자 서비스 키`가
> 난다. 키는 원문 그대로 붙이고 나머지 파라미터만 인코딩해야 한다. **팀 전체 해당.**

---

## 호출 기록

### INT_S06_001 — 보행자안전 장비 목록 ✅ 사용

**요청**

```bash
curl -s "https://genix.pohang-eum.kr/dpg/pedestrian/device/list?serviceKey=$EUM_SERVICE_KEY"
```

**응답 (일부)**

```json
{"id":"1","status":"success","data":{
  "ai_cctvs":[
    {"id":1,"name":"구룡포 북방파제 AI-01-001","angle":0,
     "latitude":"35.98573","longitude":"129.557888",
     "address":"포항시 남구 구룡포읍 구룡포리 954-3"}
  ],
  "speakers":[
    {"id":1,"name":"구룡포 북방파제 SG-01-001",
     "latitude":"35.987417","longitude":"129.558556",
     "address":"포항시 남구 구룡포읍 구룡포리 954-3"}
  ],
  "uv_devices":[
    {"id":1,"name":"자외선 측정기",
     "latitude":"35.98524","longitude":"129.551826",
     "address":"경북 포항시 병포리 157-294"}
  ]}}
```

**확인한 것**

- **스피커 8대** — 북방파제 `SG-01/02/03-001` + `SR-01-001`, 남방파제 `SG-10/11/12-001` + `SR-02-001`.
  `SG`와 `SR` 두 계열이 있는데 카탈로그에 구분 설명이 없다
- **AI CCTV 15대** — 북방파제 7대, 남방파제 8대
- **자외선 측정기 1대** — 병포리. 방파제가 아니라 내륙 쪽이다
- 좌표계는 WGS84 위경도. 문자열로 온다 (숫자 아님)

**막힌 것 / 이상한 것**

- **`구룡포 남방파제 SG-10-001`은 위경도·주소가 빈 문자열**이다. 8대 중 1대는 지도에 못 찍는다
- AI CCTV는 같은 좌표에 2~3대가 겹쳐 있다 (`AI-02-001/002/003`이 모두 `35.984143, 129.558226`).
  한 지점에 여러 각도로 달린 것으로 보이나 `angle`이 전부 0이라 구분이 안 된다

---

### INT_S06_005 — 자외선 실시간 ✅ 사용

**요청**

```bash
curl -s "https://genix.pohang-eum.kr/dpg/sensor/latest/uvIndex?serviceKey=$EUM_SERVICE_KEY&id=1"
```

**응답**

```json
{"id":"1","status":"success","data":{"dateTime":"2026-08-02 23:51:22","uvIndex":0.3}}
```

**확인한 것**

- 실시간으로 갱신된다 (호출 시각과 `dateTime`이 근접)
- 심야 호출이라 0.3. 주간 값은 재확인 필요
- 장비가 1대뿐이라 구역별 차이를 못 본다

---

### INT_S01_004 — 대기환경 실시간 ✅ 사용 (기상 소스)

`INT_S03_019` 대신 여기서 기상을 가져온다. 이름은 '대기환경'인데 **기온·습도·풍속·풍향이
전부 들어 있다.**

**요청**

```bash
curl -s "https://genix.pohang-eum.kr/dpg/atmosphere/device/realtime?serviceKey=$EUM_SERVICE_KEY&id=1"
```

**응답**

```json
{"id":"1","status":"success","data":{
  "logDateTime":"2026-08-02 15:00:05","devId":1,
  "pm10":8.2,"pm25":8.2,"so2":0.045,"no2":0.001,"o3":0.023,"co":0.494,
  "voc":0.097,"h2s":0.006,"nh3":0.006,"ou":6.0,"hcho":0.005,"co2":0.0527,
  "temp":24.2,"humi":76.0,"winsp":0.0,"windir":285.6,"batt":12.4}}
```

**확인한 것**

- `temp` 24.2℃, `humi` 76.0%, `winsp` 0.0, `windir` 285.6 — 위험도 판정에 필요한 값이 다 있다
- 갱신 주기는 시간 단위로 보인다 (`logDateTime`이 정시 근처)
- 카탈로그의 단위 표기에 오류가 있다: `winsp`가 "℃", `windir`가 "%"로 적혀 있는데
  실제로는 각각 m/s 와 도(°)로 보인다

---

### INT_S06_006 — 시간대별 이상행동 발생수 ❌ 제외

**이 아이디어의 원래 트리거였다. 실호출 결과 쓸 수 없다.**

**요청**

```bash
curl -s "https://genix.pohang-eum.kr/dpg/aicctv/avghour/datas?serviceKey=$EUM_SERVICE_KEY&date=20260802"
```

**응답 (구조)**

```json
{"id":"1","status":"success","data":{
  "south":[{"hour":"2026-08-02 15:00:00",
            "warningFallDetectionCount":0,"warningInsideDetectionCount":0,
            "warningApproachCount":0,"normalFallDetectionCount":0}],
  "north":[...]}}
```

**좋은 소식 — '이상행동'의 정의가 필드명으로 드러났다**

추락 감지(`warningFallDetectionCount`), 구역 내부 진입(`warningInsideDetectionCount`),
접근(`warningApproachCount`), 일반 추락(`normalFallDetectionCount`). 방파제 안전
시나리오에 정확히 맞는 항목이고, 남/북 방파제(`south`/`north`)로 구역이 나뉘어 온다.

**나쁜 소식 — 값이 없다**

- **검출값이 전부 0이다.** 최근 60일 전수 조회 + 2025-10 ~ 2026-07 월별 표본 조회 결과
  **총 검출 0건**. 사람이 접근만 해도 올라갈 `warningApproachCount`조차 0이다
- **`date` 파라미터가 무시된다.** 어느 날짜를 넣어도 응답은 항상 **호출 시점 기준 최근
  10시간**이다. `date=20260802`로 요청했는데 `2026-08-02 15:00` ~ `2026-08-03 00:00`이
  돌아왔다. 과거 재생 데모도 불가능하다

**판정**: 장비(AI CCTV 15대)는 등록돼 있으나 **이상행동 검출이 가동되지 않고 있다**고
보는 것이 타당하다. 이 API를 아이디어의 방아쇠로 쓸 수 없다.

**대응**: 주최 측(권소현, ikwon@postech.ac.kr)에 ① 검출 기능의 가동 여부와 일정,
② `date` 파라미터가 동작하지 않는 것이 의도인지 문의한다. 본선 개발 기간(9.7~9.28)에
켜질 가능성이 있으면 트리거를 되살릴 수 있다. **답을 받기 전에는 이 API에 의존하지 않는다.**

---

### INT_S03_019 — 주요 기상 요소 과거 ⚠️ 보류

**요청**

```bash
curl -s "https://genix.pohang-eum.kr/dpg/ship-safe/stats/history?serviceKey=$EUM_SERVICE_KEY&date=20251201"
```

**응답 (성공한 날)**

```json
{"id":"1","status":"success","data":{"top":{"beforeDay":{
  "temp":13.2,"winsp":1.1,"windir":1015.0,"logDateTime":"..."}}}}
```

**확인한 것**

- 날짜 형식은 `yyyyMMdd`가 맞다. 다른 형식은 `날짜 형식이 올바르지 않습니다`로 거부된다
- **데이터가 있는 날과 없는 날이 섞여 있다.** 없는 날은 형식 검증을 통과한 뒤
  `500 서버 내부 오류: class java.lang.String cannot be cast to class java.util.Date`로 터진다.
  E-UM 서버 쪽 버그다

| 날짜 | 결과 |
| --- | --- |
| 2025-12-01, 2025-12-15 | 성공 |
| 2025-12-31, 2026-01-02, 2026-01-10 | 500 |
| 2026-02-01, 2026-03-01 | 성공 |
| 2026-05-01, 2026-06-01, 2026-07-15, 2026-07-31, 2026-08-02 | 500 |

- `windir` 값이 `1015.0`, `1022.6` 등으로 온다. 풍향이라면 0~360 범위여야 하는데
  기압(hPa)에 가까운 값이다. **필드가 잘못 매핑돼 있을 가능성**이 있다

**판정**: 최근 날짜가 대부분 실패하고 필드 신뢰도도 의심스럽다. 기상은 `INT_S01_004`
실시간으로 대체한다. 이력이 필요하면 `INT_S01_012`(대기환경 시간별 통계)를 먼저 검증한다.

---

## E-UM에 없어서 공공데이터포털에서 보충하는 데이터

| 데이터명 | 출처 | 왜 필요한가 | 라이선스 |
| --- | --- | --- | --- |
| 파고·조위 | 기상청 해양기상부이 / 국립해양조사원 | E-UM 전체에 파고·조위가 없다. 월파 위험을 직접 못 본다 | 확인 필요 |

## 데이터 공백

| 필요한 데이터 | 없는 이유 | 대안 |
| --- | --- | --- |
| **방파제 위 사람 수·위치** | `INT_S06_006` 검출이 가동되지 않음 | 주최 측 문의. 답 오기 전까지는 기상·자외선 기반 위험 판정으로 간다 |
| 파고 | E-UM 40개 API 어디에도 없음 | 풍속(`INT_S01_004.winsp`)으로 대리 |
| 구역별 자외선 | 측정기가 1대뿐 | 단일 값을 전 구역에 적용하고 한계를 명시 |
