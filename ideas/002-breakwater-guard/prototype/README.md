# 프로토타입 — 방파제 안전 경보 MCP 서버

E-UM 디지털트윈의 보행자안전(S06)·대기환경(S01) API를 [MCP](https://modelcontextprotocol.io) tool로
감싸서, Claude 같은 LLM이 자연어로 "지금 방파제 상황 어때?"라고 물으면 실시간 데이터를 직접 호출해
위험도를 판단하고 방송할 스피커를 추천하도록 만든 서버다.

## 구성

| 파일 | 역할 |
| --- | --- |
| `eum_client.py` | E-UM genix 서버 공통 HTTP 클라이언트 (serviceKey 부착, 응답 껍데기 파싱) |
| `server.py` | FastMCP 서버 — tool 5개 등록 (`assess_breakwater_risk`가 핵심) |
| `test_offline.py` | 실제 API 없이 판단 로직만 검증하는 오프라인 테스트 |
| `requirements.txt` | `mcp`, `requests`, `python-dotenv` |

## tool 목록

- `list_pedestrian_devices` — INT_S06_001, 자외선/스피커/AI CCTV 장비 위치 목록
- `get_incident_stats` — INT_S06_006, 남/북 방파제 시간대별 이상행동 발생 건수
- `get_uv_index` — INT_S06_005, 자외선 실시간 지수
- `get_atmosphere_realtime` — INT_S01_004, 대기환경 실시간(풍속 등)
- `assess_breakwater_risk` — 위 4개를 종합해 구역별 위험도(양호/주의/위험)와 추천 스피커를 자연어로 반환. **이 tool 하나가 idea README 3번 시나리오의 전체 구현체다.**

## 설치 및 실행

```bash
cd ideas/002-breakwater-guard/prototype
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp ../../../.env.example .env   # EUM_SERVICE_KEY 채우기 (https://pohang-eum.kr/data 발급)

python server.py   # stdio MCP 서버로 실행
```

## serviceKey 없이 로직만 검증하기

```bash
python test_offline.py
```

카탈로그 문서 스키마를 따르는 가짜 응답으로 `assess_breakwater_risk`의 위험도 판정·스피커 매칭
로직을 검증한다. serviceKey를 아직 발급받지 못한 상태에서도 "판단 로직이 옳게 동작하는가"는
확인할 수 있다 (실제 API 스키마 검증은 [data.md](../data.md) 참고 — serviceKey 발급 후 재확인 필요).

## Claude Desktop / Claude Code에 연결하기

`claude_desktop_config.json`(또는 Claude Code의 MCP 설정)에 아래처럼 등록하면 대화창에서 바로
"지금 방파제 상황 어때?"라고 물어볼 수 있다.

```json
{
  "mcpServers": {
    "breakwater-guard": {
      "command": "/절대/경로/ideas/002-breakwater-guard/prototype/.venv/bin/python",
      "args": ["/절대/경로/ideas/002-breakwater-guard/prototype/server.py"],
      "env": { "EUM_SERVICE_KEY": "발급받은키" }
    }
  }
}
```

## 알려진 한계 (MVP 범위)

- serviceKey를 아직 발급받지 못해 **실제 서버 응답으로는 검증하지 못했다.** `eum_client.py`는
  카탈로그 문서 스키마와, 인증 실패 시 실측한 에러 응답 스키마를 기준으로 작성됐다 — 정상 응답이
  문서와 다른 필드를 쓸 가능성은 남아 있다 ([data.md](../data.md) 참고).
- 위험도 임계값(`server.py`의 `INCIDENT_WEIGHTS`, `RISK_*_THRESHOLD`)은 실제 데이터 분포를 본 적
  없는 잠정값이다. serviceKey 발급 후 며칠치 실데이터를 보고 다시 잡아야 한다.
- 스피커 자동 송출은 하지 않는다 — 카탈로그에 스피커 제어 API가 없어 "추천"까지만 한다.
