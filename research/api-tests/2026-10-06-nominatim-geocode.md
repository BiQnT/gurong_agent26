# 2026-10-06 · OpenStreetMap Nominatim 주소 ↔ 좌표 확인

덕장 등록 화면에서 지도 핀 위치를 주소로, 입력한 주소를 지도 위치로 바꾸기 위해 키 없이 쓸 수 있는 Nominatim 을 실제로 불렀다. 2026-10-06T12:32:14Z, User-Agent `haepung-gwamegi/1.0 (+https://35-192-216-232.sslip.io)`, 요청 사이 1.5초.

| 호출 | 요청 | 실제 결과 | 원본 |
| --- | --- | --- | --- |
| 주소 → 좌표 | `GET /search?q=경상북도 포항시 남구 구룡포읍 구룡포길 117&format=jsonv2&countrycodes=kr&limit=3&addressdetails=1&viewbox=129.30,36.15,129.65,35.85&accept-language=ko` | HTTP 200 · 3건, 모두 도로 `구룡포길` (첫 건 35.9886660, 129.5507424) | [raw](raw/nominatim-search-guryongpo.json) |
| 좌표 → 주소 | `GET /reverse?lat=35.981200&lon=129.540200&zoom=18&addressdetails=1&format=jsonv2&accept-language=ko` | HTTP 200 · `road: 호미로, hamlet: 병포, town: 구룡포읍, borough: 남구, city: 포항시, province: 경상북도` | [raw](raw/nominatim-reverse-guryongpo.json) |
| 바다 위 좌표 | `GET /reverse?lat=35.900000&lon=129.900000&...` | HTTP 200 · `{"error":"Unable to geocode"}` | [raw](raw/nominatim-reverse-sea.json) |

같은 날 앞서 시험한 검색: `포항시 남구 구룡포읍 호미로 221` 은 도로 `호미로` 2건, `구룡포읍` 은 읍 중심(35.98434, 129.53674), `포항시 남구 구룡포읍 병포리` 는 결과 없음.

## 한계

- OSM 한국 자료에는 건물 번호가 거의 없다. 주소로는 도로·마을까지만 찾고, 번지는 무시된다. 덕장의 정확한 위치는 사용자가 핀으로 맞춰야 한다.
- 리(里) 이름은 자주 찾지 못한다. 좌표 → 주소는 `hamlet`(자연마을, 예: 병포)까지 준다.
- 이용 정책: 초당 1회 이하, 앱을 알리는 User-Agent, 글자를 칠 때마다 부르는 자동완성 금지, 결과 캐시, 출처 표시(지도 타일에 이미 표시). 그래서 서버가 줄을 세우고 하루 동안 캐시한다 (`server/geocode.ts`).
- 번지까지 정확한 주소가 필요하면 국토교통부 브이월드 지오코더(무료, 키 필요)로 바꿀 수 있다.
