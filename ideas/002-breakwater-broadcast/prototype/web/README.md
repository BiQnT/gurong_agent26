# 방파제 안내방송 에이전트 — 웹 MVP

Next.js 16 · React 19 · Tailwind 4 · Gemini · **로컬 dev 전용** (배포·DB 없음)

## 실행

```bash
# 키는 한 단계 위 prototype/.env 에 있다 (EUM_SERVICE_KEY, GEMINI_API_KEY)
pnpm install
pnpm dev          # http://localhost:3000
```

| 경로 | 화면 |
| --- | --- |
| `/` | 사용자용 — 자연어로 묻고 판정 근거와 방송 문안을 받는다 |
| `/monitor` | 지자체 관제 — 지도, 위험 등급, 방송 권고, 판정 한계 |

## 검증

```bash
pnpm test         # 규칙 경계값 + E-UM 실호출 (목 없음)
pnpm build        # 타입 검사 포함
```

실호출 테스트는 스피커 8대·AI CCTV 15대를 실제로 받아온다. 네트워크나 E-UM 이
죽으면 같이 실패해야 맞다 — 목으로 통과하는 테스트는 '실제 호출' 요건을 증명하지 못한다.

## API

| 엔드포인트 | 설명 |
| --- | --- |
| `GET /api/snapshot` | E-UM 원시 값 (장비·기상·자외선·이상행동) |
| `GET /api/assess?scenario=` | 규칙 기반 위험 판정. LLM 안 씀 |
| `POST /api/agent` | `{q, scenario?}` → 판정 + 방송 문안 |

```bash
curl -s localhost:3000/api/assess | head -c 300
curl -s -X POST localhost:3000/api/agent -H 'Content-Type: application/json' \
  -d '{"q":"지금 방송 내보내야 하나?","scenario":"storm"}'
```

## 시연 모드

이 에이전트는 위험할 때만 방송한다. 발표 당일 무풍이면 방송 경로를 못 보여주므로
`scenario` 로 기상값을 대체할 수 있다: `gale`(강풍주의보) `storm`(강풍경보)
`heatwave`(폭염+자외선).

**장비 목록과 좌표는 실측 그대로**이고 기온·풍속·자외선만 바뀐다. 응답의
`simulation` 필드와 화면 배너에 시연임이 표시된다. 기본값은 항상 실측이다.

## 구조

```
lib/env.ts       상위 .env 를 서버 런타임에 읽는다 (키가 번들에 안 들어가게)
lib/eum.ts       E-UM 클라이언트. serviceKey 는 인코딩하지 않는다
lib/risk.ts      규칙 판정. LLM 없음. 임계값 전부 기상청 공인 기준 + 출처
lib/scenario.ts  시연용 기상값 주입
lib/agent.ts     Gemini 툴콜링 루프 + 결정적 문안 생성
app/monitor/     관제 화면 (지도는 react-leaflet, ssr:false)
```

설계 근거는 [`../../design/agent-loop.md`](../../design/agent-loop.md),
데이터 판정 기록은 [`../../data.md`](../../data.md).

## 알려진 제약

- **자외선 측정기 1대**가 병포리(내륙)에 있어 방파제 실측이 아니다
- **스피커 `SG-10-001` 은 위경도가 빈 문자열**이라 지도에 못 찍는다 (8대 중 7대만 표시)
- **AI CCTV 이상행동 검출이 미가동** — 10개월치 0건. 지금 사람이 있는지 모른다
- **파고·조위가 E-UM 전체에 없다** — 풍속으로 대리한다

전부 화면에 그대로 노출된다. 숨기지 않는다.
