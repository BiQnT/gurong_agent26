# 대기환경 서비스에 등록 안 된 API 3개 발견

- 출처: E-UM (https://pohang-eum.kr/) — 대기환경(typeId=1) 서비스
- 계기: `ideas/001-gwamegi-integrated-agent` 작업 중, 비로그인 상태로 <https://pohang-eum.kr/data/list/1>에
  접속하면 대기환경 API가 6개로 보이는데 `docs/api-catalog/01-대기환경.md`엔 3개뿐이라는 제보(김영재)
- 조사자 / 조사일: Claude(에이전트) / 2026-08-04

## 원인

`research/api-tests/fetch_eum_catalog.py`는 E-UM의 **API 자료실 메타데이터 시스템**
(`https://pohang-eum.kr/netro/api`, `/api/list?type=`, `/api/detail?apiId=`)을 긁어온다.
대기환경(type=1)에 이 메타데이터 시스템에는 3개(`INT_S01_004`, `011`, `012`)만 등록돼 있다.

하지만 실제 데이터 서버(`https://genix.pohang-eum.kr`)에는 해양환경(marine) 서비스와 동일한
목록_전체/목록_단일/실시간_전체 패턴의 엔드포인트가 대기환경에도 존재하고, 실제로 정상 동작한다.
E-UM 측이 이 3개를 만들어놓고 API 자료실에 등록하는 걸 빠뜨린 것으로 보인다.

## 확인한 것 (성공)

**요청 1 — 목록_전체**

```bash
curl -s "https://genix.pohang-eum.kr/dpg/atmosphere/devices?serviceKey=$EUM_SERVICE_KEY"
```

응답 (일부, 24개 장비 중 1개만 발췌):

```json
{
  "id": "1",
  "status": "success",
  "data": [
    {
      "id": 1,
      "name": "유해물질 측정기 외1",
      "latitude": "35.980946",
      "longitude": "129.540324",
      "address": "포항시 남구 구룡포읍 병포리 469-52",
      "firm": "1.0.0",
      "nickname": "구룡포행정복지센터 남서측"
    }
  ]
}
```

**요청 2 — 목록_단일**

```bash
curl -s "https://genix.pohang-eum.kr/dpg/atmosphere/device?serviceKey=$EUM_SERVICE_KEY&id=1"
```

응답: `data`에 `poleId` 필드가 추가된 것 외엔 목록_전체의 개별 항목과 동일한 구조.

**요청 3 — 실시간_전체**

```bash
curl -s "https://genix.pohang-eum.kr/dpg/atmosphere/devices/realtime?serviceKey=$EUM_SERVICE_KEY"
```

응답: `INT_S01_004`(실시간_단일)와 동일한 필드 구조(`pm10`, `pm25`, `temp`, `humi`, `winsp`, `windir` 등)를
24개 장비 전체에 대해 배열로 반환.

## 확인한 것

- 데이터가 실제로 들어오는가: O — 24개 장비 모두 실제 위경도·주소·실측값 응답
- 커버 범위: 구룡포읍뿐 아니라 **호미곶면**(대보리, 강사리 등)까지 포함한 24개 장비. 카탈로그 서비스명은
  "구룡포읍 대기환경"이지만 실제 커버리지는 그보다 넓다
- 갱신 주기: 장비별로 상이 (2026-08-03 20시대~2026-08-04 05시대), 일부 장비(`devId=5,7`)는 `logDateTime`이
  빈 문자열이거나 `temp` 값이 비정상(예: `8.68e31`)으로 나오는 등 결측/이상치가 섞여 있음 — 실사용 시 필터링 필요
- 호출 제한: 미확인

## 판정

- 호출 성공 여부: 성공 (3개 전부)
- 에이전트에서 쓸 수 있는가: O — 특히 목록_전체(`/dpg/atmosphere/devices`)는 기존에 "장비 위치를 모른다"던
  데이터 공백을 메워준다 (`ideas/001-gwamegi-integrated-agent/data.md` 참고)
- 리스크: E-UM 공식 자료실에 등록된 API가 아니므로 (1) 사전 공지 없이 막히거나 경로가 바뀔 수 있음,
  (2) `apiId`(`INT_S01_001~003`)는 E-UM이 공식 발급한 값이 아니라 같은 서비스의 번호 규칙을 그대로 따서
  이 저장소가 임의로 붙인 식별자임 — 기획서 등 대외 문서에 인용할 때는 "E-UM 자료실 미등록, 자체 검증 완료"라고
  명시할 것

## 카탈로그 반영

`research/api-tests/fetch_eum_catalog.py`의 `MANUAL_SUPPLEMENT`에 위 3개를 하드코딩해두었다.
스크립트를 재실행해도 유실되지 않고 `docs/api-catalog/01-대기환경.md`, `docs/api-catalog/README.md`,
`data/eum-api-catalog.json`에 자동 반영된다.

## 다른 서비스도 같은 문제가 있는지 확인 (이상 없음)

대기환경과 같은 방식(등록된 형제 서비스의 URL 패턴을 본떠 미등록 엔드포인트를 추측 호출)으로
다른 서비스도 점검했으나 전부 `40401 요청한 엔드포인트는 존재하지 않음`으로 실제 엔드포인트가
없음을 확인했다 (= 카탈로그 누락이 아니라 애초에 없는 API):

| 추측 경로 | 대상 서비스 | 결과 |
| --- | --- | --- |
| `/dpg/cctv/devices/realtime` | 선박안전 | 404 (없음) |
| `/dpg/lidar/devices/realtime` | 선박안전 | 404 (없음) |
| `/dpg/transp/devices/realtime` | 수산물유통 | 404 (없음) |
| `/dpg/transp/device/realtime` | 수산물유통 | 404 (없음) |
| `/dpg/speaker/devices/realtime` | 보행자안전 | 404 (없음) |
| `/dpg/ai-cctv/devices/realtime` / `/dpg/aicctv/devices/realtime` | 보행자안전 | 404 (없음) |
| `/dpg/sensor/latest/roadLevel` / `holeLevel` / `riverLevel` / `rainLevel` | 침수예측 | 404 (없음) |
| `/dpg/water/roadDevices/realtime`, `/dpg/water/devices/realtime` | 침수예측 | 404 (없음) |

또한 `/netro/api/list?type=` 결과를 전 서비스에 대해 현재 카탈로그와 다시 대조했을 때
대기환경(type=1) 외에는 전부 일치했다 (`git diff` 결과 대기환경 외 변경 없음).

**결론**: 카탈로그 누락은 대기환경 3개가 유일했다. 다른 6개 서비스는 E-UM 자료실 메타데이터와
실제 동작이 일치한다.
