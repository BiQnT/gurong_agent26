"""경보 문구 생성 — 규칙 기반 판정 "이후" 단계에서만 생성형 AI를 쓴다.

**왜 여기에만 LLM을 쓰는가** (idea README "생성형 AI를 왜 쓰는가" 참고):

- `server.py`(MCP tool, 온디맨드 질의) 경로는 이미 Claude 같은 LLM 클라이언트가
  대화 중에 tool 결과를 자연어로 구성해준다. 거기서 또 LLM을 부르면 중복이다.
- `monitor.py`(상시 감시, 백그라운드) 경로는 사람이 채팅으로 붙어있지 않은 채 혼자
  도는 프로세스다. 위험 상황을 "방금 감지된 판정을 사람이 바로 읽고/방송할 문장"으로
  바꿔줄 존재가 없다 — 이 자연어 생성 자체가 이 프로젝트에서 생성형 AI가 실제로
  필요한 지점이다.
- **위험도 판정(임계값 비교)은 여기서 하지 않는다.** 그건 `risk_logic.py`가 결정론적
  규칙으로 하고, 이 모듈은 "이미 내려진 판정을 사람이 읽을 문장으로 바꾸는" 역할만
  한다. 판정 자체를 LLM에 맡기면 같은 입력에도 다른 결과가 나올 수 있어 안전 경보
  시스템의 핵심 로직으로는 부적절하다 (감사·재현 불가능).

`ANTHROPIC_API_KEY`가 없으면 결정론적 템플릿 문구로 대체한다 — 키가 없어도 알림
자체는 끊기지 않아야 한다.
"""

from __future__ import annotations

import json
import os
from typing import Any, TypedDict

_client: Any = None
_client_checked = False

MODEL = "claude-sonnet-5"


class Narration(TypedDict):
    summary: str  # 관제 담당자용 상황 요약 한 문장
    script: str  # 스피커로 내보낼 방송 문구 한 문장 (사람이 대시보드에서 수정 가능)
    generated_by: str  # "llm" 또는 "template" — 어느 경로로 만들어졌는지 항상 표시


def _get_client() -> Any:
    global _client, _client_checked
    if _client_checked:
        return _client
    _client_checked = True

    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return None

    from anthropic import Anthropic

    _client = Anthropic(api_key=api_key)
    return _client


# kind별 방송 문구 템플릿. LLM 없이도(또는 LLM 실패 시) 상황에 안 맞는 문구가
# 나가지 않도록 kind마다 다르게 준비해뒀다 — 전부 같은 문장이 나가면 방송으로서
# 신뢰가 떨어진다.
_SCRIPT_TEMPLATES: dict[str, str] = {
    "실족감지": "{zone} 이용객께서는 주의하십시오. 실족 사고가 감지되었습니다. 안전요원이 확인 중이니 주변 이용객께서는 신속히 안전한 곳으로 이동해 주시기 바랍니다.",
    "접근경고": "{zone} 위험구역에 접근하는 인원이 감지되었습니다. 테트라포드 및 위험구역 접근을 자제해 주시기 바랍니다.",
    "침입감지": "{zone} 출입 제한구역에 무단 진입이 감지되었습니다. 즉시 지정된 구역 밖으로 이동해 주시기 바랍니다.",
    "보행자 이상감지": "{zone}에서 이상행동이 감지되었습니다. 이용객께서는 주변을 살펴 안전에 유의해 주시기 바랍니다.",
    "위험도 상승": "{zone} 위험 수준이 높아지고 있습니다. 이용객께서는 안전사고 예방을 위해 방파제 이용에 각별히 주의해 주시기 바랍니다.",
    "기상 위험": "현재 {zone} 기상 여건이 악화되었습니다. 강풍·자외선·고온 등으로 위험할 수 있으니 장시간 야외 체류를 자제해 주시기 바랍니다.",
    "수동방송": "{zone} 이용객께서는 안내에 따라 안전에 유의해 주시기 바랍니다.",
}


def _fallback(event: dict[str, Any]) -> Narration:
    """ANTHROPIC_API_KEY가 없거나 LLM 호출이 실패했을 때 쓰는 결정론적 템플릿.

    kind(실족감지/접근경고/...)별로 다른 문구를 쓴다 — LLM이 없어도 최소한
    "무슨 일이 일어났는지"에 맞는 방송이 나가야 한다.
    """
    zone = event["zone_label"]
    kind = event.get("kind", "")
    template = _SCRIPT_TEMPLATES.get(kind, _SCRIPT_TEMPLATES["위험도 상승"])
    return Narration(
        summary=f"[{event['level']}] {zone} — {event['reason']}",
        script=template.format(zone=zone),
        generated_by="template",
    )


def narrate_alert(event: dict[str, Any]) -> Narration:
    """구조화된 경보 이벤트를 (상황 요약, 방송 문구)로 바꾼다.

    event 예시:
        {
            "zone_label": "북방파제", "level": "위험",
            "reason": "최근 1시간 접근경고 12건, 실족감지 2건",
            "wind_speed": 8.1, "uv_index": 3.2, "temperature": None,
            "speaker": "구룡포 북방파제 SR-01-001",
        }
    """
    client = _get_client()
    if client is None:
        return _fallback(event)

    prompt = (
        "당신은 구룡포 방파제 안전관제 담당자를 돕는 경보 문구 작성 도우미입니다. "
        "아래는 센서 데이터를 규칙 기반으로 판정한 결과입니다 (판정 자체는 이미 끝났으니 "
        "다시 판단하지 말고 문구만 작성하세요). 과장하지 말고, 지시받지 않은 내용은 "
        "추가하지 마세요.\n\n"
        f"구역: {event['zone_label']}\n"
        f"위험도: {event['level']}\n"
        f"판정 근거: {event['reason']}\n"
        f"풍속: {event.get('wind_speed', '정보 없음')} m/s\n"
        f"자외선 지수: {event.get('uv_index', '정보 없음')}\n"
        f"기온: {event.get('temperature', '정보 없음')} ℃\n"
        f"추천 스피커: {event.get('speaker') or '매칭 실패'}\n\n"
        '아래 JSON 형식으로만 답하세요 (다른 텍스트 금지): '
        '{"summary": "담당자용 상황 요약 한 문장(수치 근거 포함)", '
        '"script": "스피커 방송 문구 한 문장"}'
    )

    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(block.text for block in response.content if block.type == "text").strip()
        parsed = json.loads(text)
        return Narration(
            summary=parsed["summary"],
            script=parsed["script"],
            generated_by="llm",
        )
    except Exception:  # noqa: BLE001 — 알림 발송이 LLM 장애로 막히면 안 된다
        return _fallback(event)
