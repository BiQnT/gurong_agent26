# 2026-10-09 · E-UM 시간별 통계로 과거 기온·습도·풍속을 받을 수 있는지

AI 도우미의 과거 기간 분석([ADR 0011](../../docs/decisions/0011-assistant-reads-with-tools.md))에 쓸 디지털 트윈 자료를 찾으려고, 주최 측 대관 계정의 새 E-UM 키(로컬 `.env.local` 의 `EUM_SERVICE_KEY`)로 `INT_S01_012` 를 불렀다. 키와 키가 든 URL 은 기록하지 않는다. `2026-10-09T03:32:28Z` (12:32 KST), 로컬.

## 호출

| API | 요청 (키 제외) | 결과 |
| --- | --- | --- |
| `INT_S01_012` 대기환경 유해물질 시간별 통계 | `GET https://genix.pohang-eum.kr/dpg/atmosphere/sensor/stats/hour?type=temp&date=20260115` | HTTP 401 · `40104` |
| 같은 API | `type=humi`, `date=20260115` | HTTP 401 · `40104` |
| 같은 API | `type=winsp`, `date=20260115` | HTTP 401 · `40104` |
| 같은 API | `type=pm10`, `date=20261008` | HTTP 401 · `40104` |

```json
{"rspns_rslt": {"rslt_cd": "40104","rslt_msg": "요청한 API 에 대한 권한 없음"},"rspns_bdy": null}
```

## 읽는 법

- `40104` 는 키는 등록돼 있지만 이 API 의 활용 승인이 없다는 뜻이다 ([10-08 기록](2026-10-08-eum-organizer-key.md)과 같은 응답). 새 키는 `INT_S01_001`·`003`·`004`, `INT_S06_005` 만 활용 신청돼 있다.
- 이전 키로는 `type=pm10` 이 HTTP 200 이었고 장비별 24시간 평균이 왔다 ([2026-08-06 판정표](probe-summary.md), [원본](raw/INT_S01_012.json)). 기온·습도·풍속(`temp`·`humi`·`winsp`) 타입이 되는지는 아직 모른다.

## 활용 승인 후 · 14:09 KST

팀장이 `INT_S01_011`·`INT_S01_012` 활용 신청을 마친 뒤 `2026-10-09T05:09Z` 에 같은 키로 다시 불렀다. 권한 오류(`40104`)는 사라졌다.

| 요청 (키 제외) | 결과 |
| --- | --- |
| `INT_S01_012` `type=pm10&date=2026-10-08` | HTTP 200 · `success` · 장비별 시간 평균 (`{"hours":0,"devId":1,"type":"PM10","value":10.917,"unit":"㎍/㎥","level":"2"}` …) |
| `INT_S01_012` `type=pm25&date=2026-01-15` | HTTP 200 · `success` · 값이 모두 `0.0` (그날 자료가 없는 것으로 보인다) |
| `INT_S01_012` `type=temp`·`humi`·`winsp`·`TEMP`·`HUMI`·`temperature`·`humidity`·`windSpeed`, `date=2026-01-15` | HTTP 500 · `API 호출 실패: [400] … {"status":"fail","data":"Validation Failed"}` |
| `INT_S01_012` `date=20260115` (구분자 없음) | HTTP 400 · `날짜 형식이 올바르지 않습니다. yyyy-MM-dd 형식으로 입력해주세요.` |
| `INT_S01_011` `type=temp&startDate=2026-01-14&endDate=2026-01-15` | HTTP 500 · `Text '2026-01-14' could not be parsed at index 4` (이 API 는 `yyyyMMdd` 를 받는다) |

**판정**: 날짜는 `yyyy-MM-dd` 로 보내야 한다(카탈로그 예시 `20250106` 과 다르다). 통계 API 는 유해물질(`pm10`·`pm25` 등)만 받고 **기온·습도·풍속 타입은 받지 않는다**. 신청서에 적은 대로("과거 기온·습도·풍속 시계열은 E-UM 에서 제공하지 않으므로") 과거 건조 조건 분석에는 기상청 자료가 필요하다.

## 남은 일

- ~~E-UM 활용 신청 후 기온·습도·풍속 타입 확인~~ → 지원하지 않음 (위).
- 과거 건조 조건은 기상청 API허브(AWS 816 구룡포 매분자료 기간 조회, 포항 ASOS 시간자료)를 실호출로 확인한 뒤 붙인다. 그 전까지 과거 분석은 이 덕장의 배치 기록(30분 수집)만 쓰고, 도구 결과에 그 한계를 적는다.
