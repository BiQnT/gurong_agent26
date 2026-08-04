# 프로토타입

## dry_check_agent.py

사용자의 자연어 질문 → `INT_S01_004`(대기환경 실시간_단일) 실제 호출 →
임계값 기반 건조 적합도 판단 → Claude로 자연어 응답. MVP 3대 요건(LLM 자연어
이해·응답 / 실제 API 호출 / 판단)을 전부 만족하는 최소 스크립트다.

**실행 방법**

```bash
# 저장소 루트에 .env가 없다면 먼저 만든다 (이미 있으면 생략)
cp ../../../.env.example ../../../.env   # EUM_SERVICE_KEY, ANTHROPIC_API_KEY 채우기

pip install -r requirements.txt
python dry_check_agent.py "오늘 오후에 과메기를 널어도 괜찮을까?"
```

`ANTHROPIC_API_KEY`가 비어 있으면 자연어 응답 대신 규칙 기반 판단 결과와 원본 수치만
출력한다 (LLM 연결 전에도 데이터 파이프라인만 먼저 확인할 수 있게 한 것).

`.env`는 저장소 루트 기준으로 한 개만 두면 된다 — 스크립트가 자기 위치부터 상위
디렉터리로 올라가며 `.env`를 자동으로 찾는다 (`python-dotenv`의 `find_dotenv`).
