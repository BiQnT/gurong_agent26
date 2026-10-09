# 2026-10-08 · 주최 측 대관 계정 E-UM 키 연결 확인

주최 측이 준 대관 계정으로 새로 받은 E-UM 서비스키를 로컬 `.env.local`의 `EUM_SERVICE_KEY`에 넣고, 앱이 쓰는 API 4개를 실제 호출했다. 앱(`normalizeEumServiceKey`)과 같게 퍼센트 인코딩을 한 번 해제한 값을 `serviceKey`로 보냈다. 비밀키와 키가 포함된 URL은 이 기록에 저장하지 않는다. 이 기록 시점에 VM(prod·dev)은 이전 키를 그대로 쓴다.

## 활용 신청 전

| API | 요청 경로 | 실제 결과 |
| --- | --- | --- |
| `INT_S01_001` | `GET /dpg/atmosphere/devices` | HTTP 401 · `40104` · 요청한 API 에 대한 권한 없음 |
| `INT_S01_003` | `GET /dpg/atmosphere/devices/realtime` | HTTP 401 · `40104` |
| `INT_S01_004` | `GET /dpg/atmosphere/device/realtime` (`id=1`) | HTTP 401 · `40104` |
| `INT_S06_005` | `GET /dpg/sensor/latest/uvIndex` | HTTP 401 · `40104` |

```json
{"rspns_rslt": {"rslt_cd": "40104","rslt_msg": "요청한 API 에 대한 권한 없음"},"rspns_bdy": null}
```

비교하려고 지어낸 키와 키 없는 요청을 같은 경로로 보냈더니 둘 다 HTTP 401 · `40102` · 유효하지 않은 이용자 서비스 키였다. `40104`는 키는 등록돼 있지만 그 API의 활용 승인이 없다는 뜻이다. 키를 퍼센트 인코딩된 그대로 보내도 결과는 `40104`로 같았다.

## 활용 신청 후 · 16:19 KST

4개 API를 활용 신청한 뒤 `2026-10-08T07:19:58Z`에 같은 키로 다시 호출했다.

| API | 실제 결과 |
| --- | --- |
| `INT_S01_001` · 관측기 목록 | HTTP 200 · `status: success` · 24개 |
| `INT_S01_003` · 일괄 관측 | HTTP 200 · `status: success` · 23행 |
| `INT_S01_004` · 단건 관측 (`id=1`) | HTTP 200 · `status: success` |
| `INT_S06_005` · 자외선 | HTTP 200 · `status: success` |

일괄 응답의 원문 관측 시각은 `2026-06-16 10:57:15`부터 `2026-10-08 16:20:06`까지다. `07:20:40Z` 기준으로 30분 이내 관측이 17행, 그보다 오래된 관측이 6행이었다. 원문 시각에는 시간대 표기가 없어 `+09:00`으로 계산했다.

비밀정보 없는 측정 필드만 추린 실제 샘플이다. 수치는 호출 당시 값이다.

```json
{
  "devId": 1,
  "logDateTime": "2026-10-08 16:20:01",
  "temp": 22.1,
  "humi": 51.3,
  "winsp": 1.37,
  "windir": 73.4
}
```

```json
{ "dateTime": "2026-10-08 16:13:00", "uvIndex": 1.9 }
```

## 남은 일

- VM 키 교체: 팀원이 만든 `env/haepung.env`는 고치지 않고, 뒤에 읽혀 앞을 이기는 `env/backend.env`에 `EUM_SERVICE_KEY`를 넣는다 ([비밀값](../../infra/gcp/README.md#비밀값)). 교체 뒤 화면의 관측 출처가 `E-UM · API 응답`인지 확인한다.

## VM 반영 · 2026-10-09 확인

새 키를 VM `env/backend.env`의 `EUM_SERVICE_KEY`에 넣었다(팀장 작업, 파일 수정 `2026-10-08T07:24:10Z`). prod·dev는 `2026-10-08T07:24:43Z`에 다시 시작해 그 뒤로 이 값을 읽는다.

| 확인 | 결과 |
| --- | --- |
| prod `GET /api/health` | `eum.configured: true` · 커밋 `7c6139e` |
| 30분 수집기 `2026-10-09T03:00:01Z` | `source=ok` · 덕장 3 · 배치 3 · 기록 2 · 결측 1 · 실패 0 |

`source=ok`는 수집기가 E-UM 실시간 조회에 성공했다는 뜻이다. 화면의 관측 출처 표시는 이번에 보지 않았다.
