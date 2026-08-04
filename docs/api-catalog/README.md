# E-UM 디지털트윈 포항 Open API 카탈로그

출처: <https://pohang-eum.kr/data> · 자동 수집 · **총 43개 API / 7개 서비스**

재생성: `python3 research/api-tests/fetch_eum_catalog.py`

## 공통 사항

- 전 API가 `GET` 방식 REST API. 엔드포인트 호스트는 `genix.pohang-eum.kr`
- **모든 API에 `serviceKey` 파라미터가 필수**다. E-UM 로그인 후 발급받는 개인 인증키이며,
  API 자료실에서 신청(`/api/apply`)해야 나온다. 키는 저장소에 커밋하지 말고 `.env`에 둔다.
- 호출 형태: `GET https://genix.pohang-eum.kr/dpg/<path>?serviceKey=<KEY>&...`
- 응답 공통 껍데기: `{ id, status, data }` — 실제 값은 `data` 안에 있다.
- **⚠ 표시가 붙은 3개 API는 E-UM API 자료실 메타데이터(`/netro/api/*`)에 정식 등록이 안 돼 있다.** genix 서버에 직접 요청해 실제 동작을 확인하고 `research/api-tests/fetch_eum_catalog.py`의 `MANUAL_SUPPLEMENT`에 수동으로 채워 넣은 것이다. apiId는 E-UM이 동일 역할에 실제로 쓰는 번호 규칙을 따랐을 뿐 공식 발급 ID가 아니다. 조사 기록: [research/api-tests/2026-08-04-atmosphere-undocumented-apis.md](../../research/api-tests/2026-08-04-atmosphere-undocumented-apis.md)

## 서비스별 문서

| # | 서비스 | API 수 | 문서 |
| --- | --- | --- | --- |
| 1 | 구룡포읍 대기환경 | 6 | [대기환경](01-대기환경.md) |
| 2 | 구룡포읍 해양환경 | 6 | [해양환경](02-해양환경.md) |
| 3 | 구룡포읍 선박안전 | 10 | [선박안전](03-선박안전.md) |
| 4 | 구룡포읍 선박탄소 | 4 | [선박탄소](04-선박탄소.md) |
| 5 | 구룡포읍 침수예측 | 6 | [침수예측](05-침수예측.md) |
| 6 | 구룡포읍 보행자안전 | 6 | [보행자안전](06-보행자안전.md) |
| 7 | 구룡포읍 수산물 | 5 | [수산물유통](07-수산물유통.md) |

## 전체 API 목록

| API ID | 서비스 | 기능 | 엔드포인트 |
| --- | --- | --- | --- |
| `INT_S01_001` | 구룡포읍 대기환경 | 대기환경 측정 장비 기본 정보 목록_전체 (⚠ E-UM 자료실 미등록, genix 직접 확인) | `/dpg/atmosphere/devices` |
| `INT_S01_002` | 구룡포읍 대기환경 | 대기환경 측정 장비 기본 정보 목록_단일 (⚠ E-UM 자료실 미등록, genix 직접 확인) | `/dpg/atmosphere/device` |
| `INT_S01_003` | 구룡포읍 대기환경 | 대기환경 측정 장비 실시간 수집 정보_전체 (⚠ E-UM 자료실 미등록, genix 직접 확인) | `/dpg/atmosphere/devices/realtime` |
| `INT_S01_004` | 구룡포읍 대기환경 | 대기환경 측정 장비 실시간 수집 정보_단일 | `/dpg/atmosphere/device/realtime` |
| `INT_S01_011` | 구룡포읍 대기환경 | 대기환경 유해물질 통계 정보 | `/dpg/atmosphere/sensor/stats/history` |
| `INT_S01_012` | 구룡포읍 대기환경 | 대기환경 유해물질 시간별 통계 정보 | `/dpg/atmosphere/sensor/stats/hour` |
| `INT_S02_001` | 구룡포읍 해양환경 | 해양환경 측정 장비 기본 정보 목록_전체 | `/dpg/marine/devices` |
| `INT_S02_002` | 구룡포읍 해양환경 | 해양환경 측정 장비 기본 정보 목록_단일 | `/dpg/marine/device` |
| `INT_S02_003` | 구룡포읍 해양환경 | 해양환경 측정 장비 실시간 수집 정보_전체 | `/dpg/marine/devices/realtime` |
| `INT_S02_004` | 구룡포읍 해양환경 | 해양환경 측정 장비 실시간 수집 정보_단일 | `/dpg/marine/device/realtime` |
| `INT_S02_011` | 구룡포읍 해양환경 | 해양환경 유해물질 통계 정보 | `/dpg/marine/sensor/stats/history` |
| `INT_S02_012` | 구룡포읍 해양환경 | 해양환경 유해물질 시간별 통계 정보 | `/dpg/marine/sensor/stats/hour` |
| `INT_S03_001` | 구룡포읍 선박안전 | 구룡포항_선박 기본정보_전체 | `/dpg/ship/devices` |
| `INT_S03_002` | 구룡포읍 선박안전 | 구룡포항_선박 기본정보_단일 | `/dpg/ship/device` |
| `INT_S03_003` | 구룡포읍 선박안전 | 구룡포_CCTV 기본정보_전체 | `/dpg/cctv/devices` |
| `INT_S03_004` | 구룡포읍 선박안전 | 구룡포_CCTV 기본정보_단일 | `/dpg/cctv/device` |
| `INT_S03_005` | 구룡포읍 선박안전 | 구룡포항_LiDAR 기본정보_전체 | `/dpg/lidar/devices` |
| `INT_S03_006` | 구룡포읍 선박안전 | 구룡포항_LiDAR 기본정보_단일 | `/dpg/lidar/device` |
| `INT_S03_007` | 구룡포읍 선박안전 | 구룡포항_선박 실시간 위치 정보_전체 | `/dpg/ship/devices/realtime` |
| `INT_S03_008` | 구룡포읍 선박안전 | 구룡포항_선박 실시간 위치 정보_단일 | `/dpg/ship/device/realtime` |
| `INT_S03_019` | 구룡포읍 선박안전 | 주요 기상 요소 과거 정보 | `/dpg/ship-safe/stats/history` |
| `INT_S03_020` | 구룡포읍 선박안전 | 해역 선박 밀집도 분석 정보 | `/dpg/ship-safe/traffic` |
| `INT_S04_004` | 구룡포읍 선박탄소 | 선박 탄소 배출량 통계 정보 | `/dpg/dashboard/old-ship/stats` |
| `INT_S04_005` | 구룡포읍 선박탄소 | 선박 톤수별 당일 탄소 배출량 | `/dpg/old-ship/day/ton/emission` |
| `INT_S04_006` | 구룡포읍 선박탄소 | 선박 시간별 탄소 배출량 | `/dpg/old-ship/hour/co-emission` |
| `INT_S04_007` | 구룡포읍 선박탄소 | 선박 톤수별 탄소 배출 및 중립 순위 정보 | `/dpg/old-ship/size/history` |
| `INT_S05_001` | 구룡포읍 침수예측 | 각 종류별 전체 수위계 장비 정보 목록 | `/dpg/water/devices` |
| `INT_S05_002` | 구룡포읍 침수예측 | 특정 지표면 수위계 장비 정보 | `/dpg/water/roadDevices` |
| `INT_S05_003` | 구룡포읍 침수예측 | 특정 맨홀 장비 정보 | `/dpg/water/holeDevices` |
| `INT_S05_004` | 구룡포읍 침수예측 | 특정 하천 수위계 장비 정보 | `/dpg/water/riverDevices` |
| `INT_S05_005` | 구룡포읍 침수예측 | 특정 강우량계 장비 정보 | `/dpg/water/rainDevices` |
| `INT_S05_006` | 구룡포읍 침수예측 | 전체 수위계 장비 실시간 수집 정보 | `/dpg/sensor/latest/sensorLevel` |
| `INT_S06_001` | 구룡포읍 보행자안전 | 보행자 예측 관련 각 종류별 장비 정보 목록 | `/dpg/pedestrian/device/list` |
| `INT_S06_002` | 구룡포읍 보행자안전 | 특정 자외선 측정 장비 정보 | `/dpg/uv/devices` |
| `INT_S06_003` | 구룡포읍 보행자안전 | 특정 스피커 장비 정보 | `/dpg/speaker/devices` |
| `INT_S06_004` | 구룡포읍 보행자안전 | 특정 AI CCTV 정보 | `/dpg/ai-cctv/devices` |
| `INT_S06_005` | 구룡포읍 보행자안전 | 자외선 측정 장비 실시간 수집 정보 | `/dpg/sensor/latest/uvIndex` |
| `INT_S06_006` | 구룡포읍 보행자안전 | 시간대별 이상행동 발생수 통계 | `/dpg/aicctv/avghour/datas` |
| `INT_S07_001` | 구룡포읍 수산물 | 전체 교통감시 장비 정보 목록 | `/dpg/transp/devices/list` |
| `INT_S07_002` | 구룡포읍 수산물 | 특정 교통감시 장비 정보 | `/dpg/transp/device` |
| `INT_S07_003` | 구룡포읍 수산물 | 구룡포 수산물 위탁판매장 정보 | `/dpg/auctionPlace/Info` |
| `INT_S07_004` | 구룡포읍 수산물 | 시간대별/차종별 교통량 통계 | `/dpg/statistics/trafficDatasPerHour` |
| `INT_S07_005` | 구룡포읍 수산물 | 시간대별 교통 혼잡율 | `/dpg/traffic/congestion` |
