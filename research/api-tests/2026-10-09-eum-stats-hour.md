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

## 남은 일

- E-UM 포털(주최 측 대관 계정)에서 `INT_S01_011`·`INT_S01_012` 활용 신청 → `type=temp`·`humi`·`winsp` 를 과거 날짜로 다시 호출한다. 되면 과거 분석의 정본 출처를 E-UM 으로 둘 수 있다.
- 그 전까지 과거 분석은 이 덕장의 배치 기록(30분 수집)만 쓰고, 도구 결과에 그 한계를 적는다.
