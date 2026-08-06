# 프로토타입 — 방파제 안전 경보 에이전트

두 경로로 나뉜다 (idea README 3번 "두 경로" 참고):

1. **온디맨드 질의** (`server.py`) — 사람이 Claude 같은 LLM 클라이언트에서 "지금 방파제
   상황 어때?"라고 물으면, MCP tool로 E-UM 실시간 데이터를 호출해 위험도를 판단하고 답한다.
2. **상시 감시·경보** (`monitor.py` + `dashboard.html`) — 아무도 안 물어봐도 계속 폴링하면서
   위험 신호가 잡히면 즉시 경보하고, 실시간 그래프 대시보드에서 확인·방송할 수 있다.

## 구성

| 파일 | 역할 |
| --- | --- |
| `eum_client.py` | E-UM genix 서버 공통 HTTP 클라이언트 (serviceKey 부착, 응답 껍데기 파싱, `.env` 자동 로드) |
| `risk_logic.py` | 위험도 판정 순수 로직 (결정론적 임계값). server.py/monitor.py가 공유 |
| `server.py` | FastMCP 서버 — 온디맨드 질의 경로. tool 5개 등록 |
| `narrator.py` | 경보 문구 생성 — **여기에만 생성형 AI(Claude API)를 쓴다.** 왜 여기만인지는 파일 docstring과 idea README "생성형 AI를 왜, 어디에 쓰는가" 참고. 키 없으면 kind별 결정론적 템플릿으로 대체 |
| `monitor.py` | 상시 폴링 감시 루프. 신규 이상행동/임계값 초과를 감지해 경보를 만든다 |
| `tts.py` | macOS 로컬 TTS 보조 기능 (이 서버를 macOS에서 직접 돌릴 때만 동작 — 팀 공용 경로 아님) |
| `dashboard_server.py` | Flask 서버 — 대시보드 정적 페이지 + 경보/스냅샷 API + 수동 방송·테스트 트리거 API |
| `dashboard.html` | 실시간 그래프 + 경보 피드 + 방송 UI. 음성은 브라우저 내장 Web Speech API로 재생 (OS 무관) |
| `test_offline.py` | 실제 API 없이 판단 로직만 검증하는 오프라인 테스트 |
| `requirements.txt` | `mcp`, `requests`, `python-dotenv`, `anthropic`, `flask` |

## 설치

```bash
cd ideas/002-breakwater-guard/prototype
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp ../../../.env.example .env
```

`.env`에 채울 것:

```
EUM_SERVICE_KEY=발급받은키          # 필수 — https://pohang-eum.kr/data 에서 발급
ANTHROPIC_API_KEY=발급받은키        # 선택 — 없으면 narrator.py가 템플릿 문구로 대체
```

## 1) 온디맨드 질의 — Claude Desktop/Code에 연결

```json
{
  "mcpServers": {
    "breakwater-guard": {
      "command": "/절대/경로/ideas/002-breakwater-guard/prototype/.venv/bin/python",
      "args": ["/절대/경로/ideas/002-breakwater-guard/prototype/server.py"]
    }
  }
}
```

연결 후 대화창에서 "지금 방파제 상황 어때? 방송 내보내야 돼?"라고 물으면 `assess_breakwater_risk`
tool이 실시간 데이터로 답한다.

## 2) 상시 감시 + 실시간 대시보드

```bash
python monitor.py &            # 백그라운드로 감시 루프 (기본 10초 폴링)
python dashboard_server.py     # http://localhost:8765
```

대시보드에서 할 수 있는 것:

- 자외선/풍속/기온 실시간 수치, 남·북 방파제 위험도(양호/주의/위험) 그래프
- 경보 피드: AI(또는 템플릿)가 작성한 방송 문구를 확인/수정 후 "🔊 방송" → 브라우저 음성으로 재생
- 수동 방송: AI 판정과 무관하게 담당자가 직접 문구를 써서 즉시 방송
- **🧪 테스트 알림 발생**: 실제 센서 이벤트를 기다리지 않고 종류별(실족감지/접근경고/침입감지/
  보행자 이상감지/위험도 상승/기상 위험)로 강제 발생시켜 전체 흐름을 확인할 수 있다 (스피커
  매칭과 문구 생성은 실제 로직을 그대로 탄다 — 가짜인 건 "이벤트 발생" 뿐)

폴링 간격은 `POLL_INTERVAL_SECONDS`(기본 10), 대시보드 포트는 `DASHBOARD_PORT`(기본 8765) 환경변수로
바꿀 수 있다.

## serviceKey 없이 판정 로직만 검증하기

```bash
python test_offline.py
```

카탈로그 문서 스키마를 따르는 가짜 응답으로 `assess_breakwater_risk`의 위험도 판정·스피커 매칭
로직을 검증한다.

## 알려진 한계

- **실제 현장 스피커로는 방송이 안 나간다.** 카탈로그에 스피커 제어(송출) API가 없다 — 위치 조회만
  있다. 지금 나는 소리는 대시보드를 연 사람의 브라우저 TTS다. `tts.py`는 macOS에서 `server.py`를
  직접 돌리는 사람을 위한 부가 데모일 뿐, 실제 스피커 연동이 아니다.
- 위험도 임계값(`risk_logic.py`)은 아직 실제 "위험" 사례를 못 본 상태의 잠정값이다 — 조회
  시점(2026-08-06 평일 오후)엔 이상행동이 전부 0건이었다. 성수기 실데이터로 재조정 필요.
- `dashboard_server.py`는 Flask 개발 서버라 프로덕션 배포용이 아니다. 로컬/사내망 데모 전용.
- `ANTHROPIC_API_KEY` 없이 쓰면 방송 문구가 kind별 사전 정의 템플릿으로 나간다 — 실제 생성형 AI
  문구를 보려면 키를 넣을 것.
