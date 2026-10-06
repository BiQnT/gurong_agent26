# 2026-10-06 · 기상청 API허브·공공데이터포털 연결 확인 (VM)

E-UM 관측기가 오래됐거나 이상할 때 대신 쓸 실시간 자료를 찾으려고, VM 의 `backend.env` 에 넣은 키(`KMA_AUTH_KEY`, `DATA_GO_KR_KEY`)로 실제 호출했다. 2026-10-06T13:06:56Z (22:06 KST), VM `35.192.216.232`. 키와 키가 들어간 URL 은 기록하지 않는다. 저장한 응답에 키가 없는 것을 VM 에서 확인했다.

| ID | API | 요청 (키 제외) | 실제 결과 | 원본 |
| --- | --- | --- | --- | --- |
| A2 | AWS 매분자료 (816 구룡포) | `GET https://apihub.kma.go.kr/api/typ01/cgi-bin/url/nph-aws2_min?tm2=202610062203&stn=816&disp=0&help=1` | HTTP 200 · 텍스트. `202610062203 816 … WS10 2.4 · TA 13.5 · HM 85.5 · RN-DAY 0.0` | [raw](raw/kma-aws816-minute.txt) |
| A1 | 관측지점 정보 (AWS) | `GET https://apihub.kma.go.kr/api/typ01/url/stn_inf.php?inf=AWS&stn=&tm=&help=1` | HTTP 200 · EUC-KR 텍스트. 816 구룡포: 경도 129.5475, 위도 35.9831, 해발 42.37m, 경상북도 포항시남구 구룡포읍 병포리 | [raw (816 줄만, UTF-8 변환)](raw/kma-stn-inf-aws816.txt) |
| A3 | 초단기실황 (격자 106,94) | `GET https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getUltraSrtNcst?pageNo=1&numOfRows=20&dataType=JSON&base_date=20261006&base_time=2100&nx=106&ny=94` | HTTP 200 · `PTY 0, REH 82, RN1 0, T1H 13.1, VEC 312, WSD 2.6` | [raw](raw/kma-ultra-srt-ncst.json) |
| B6 | 출몰시각 (한국천문연구원, 공공데이터포털) | `GET https://apis.data.go.kr/B090041/openapi/service/RiseSetInfoService/getLCRiseSetInfo?locdate=20261006&longitude=129.5402&latitude=35.9812&dnYn=Y` | HTTP 200 · XML. 기준 지점 `경주시감포읍`(35.8, 129.5), 일출 `0621`, 일몰 `1759` | [raw](raw/datagokr-risesetinfo.xml) |
| B2 | 기상특보 현황 | `GET https://apihub.kma.go.kr/api/typ01/url/wrn_now_data.php?fe=f&tm=&disp=0&help=1` | **HTTP 403** · `활용신청이 필요한 API 입니다.` | [raw](raw/kma-wrn-now-403.json) |
| A3 | 초단기실황 (공공데이터포털 경로) | `GET https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst?…` | **HTTP 403** · `SERVICE_KEY_IS_NOT_REGISTERED_ERROR`. 같은 자료를 API허브로 받으므로 쓰지 않는다 | 저장 안 함 |

## 읽는 법

- **A2 열**: `YYMMDDHHMI(KST) STN WD1 WS1 WDS WSS WD10 WS10 TA RE RN-15m RN-60m RN-12H RN-DAY HM PA PS TD`. 응답 머리말에 "-50 이하는 관측이 없거나 에러" 라고 적혀 있다 (`RE -99.9` 가 그 예). 1분마다 갱신된다.
- **A2 와 덕장 거리**: 등록 예시 덕장(35.9812, 129.5402)에서 816 까지 약 0.7km. 덕장마다 거리를 계산해 1km 기준을 그대로 적용한다.
- **A3**: 매시 정각 자료가 약 40분 뒤 나온다. `PTY` 강수형태 0 없음 · 1 비 · 2 비/눈 · 3 눈 · 5 빗방울 · 6 빗방울눈날림 · 7 눈날림, `RN1` 1시간 강수량(mm). 격자는 기상청 격자 변환 공식(A6)으로 덕장 좌표에서 계산한다. 이 호출의 106,94 는 팀원이 정한 값(35.99, 129.555 부근)이고, 예시 덕장 좌표(35.9812, 129.5402)는 105,94 다. 공식은 서울시청이 공식 격자 60,127 로 나오는 것으로 확인했다. 같은 날 105,94 로도 호출해 `resultCode 00`, `PTY 0` 을 받았다.
- **B6**: 입력 좌표를 가까운 기준 지점으로 반올림한다. 시각은 `HHMM` 문자열(뒤 공백 포함).

## 남은 일

- B2 기상특보: 기상청 API허브에서 "기상특보 현황 조회" 활용신청 후 다시 확인한다.
