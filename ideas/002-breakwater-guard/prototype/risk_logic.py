"""위험도 판정 순수 로직 — server.py(온디맨드 MCP tool)와 monitor.py(상시 폴링)가 공유한다.

여기엔 규칙 기반 임계값 판정만 있다. 이 로직은 결정론적이어야 감시 시스템으로서
감사·재현이 가능하므로 LLM을 쓰지 않는다 (LLM은 narrator.py에서 "판정 이후 문구
생성" 단계에만 쓴다 — idea README의 "생성형 AI를 왜 여기 쓰는가" 참고).
"""

from __future__ import annotations

from typing import Any

# data.md에 실제 호출 결과로 검증된 값이 아직 부족해 잠정값이다.
# 성수기 실데이터를 더 모으면 재조정할 것.
INCIDENT_WEIGHTS = {
    "warningFallDetectionCount": 3,  # 실족감지 — 가장 위험
    "warningInsideDetectionCount": 2,  # 침입감지
    "warningApproachCount": 1,  # 접근경고
    "normalFallDetectionCount": 2,  # 보행자 이상감지
}
RISK_CAUTION_THRESHOLD = 5
RISK_DANGER_THRESHOLD = 15

WIND_SPEED_ESCALATION_MS = 8.0  # 강풍주의보 기준(초속 8m 내외)에 맞춘 잠정값
UV_ESCALATION_INDEX = 8.0  # "매우 높음" 단계로 보는 잠정값
HEAT_ALERT_TEMP_C = 33.0  # 폭염특보 기준에 맞춘 잠정값 (대기환경 서비스 권한 생기면 사용)

ZONE_LABELS = {"south": "남방파제", "north": "북방파제"}


def latest_zone_record(zone_records: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    if not zone_records:
        return None
    return max(zone_records, key=lambda r: r.get("hour", ""))


def zone_score(record: dict[str, Any] | None) -> int:
    if not record:
        return 0
    return sum(int(record.get(field, 0) or 0) * weight for field, weight in INCIDENT_WEIGHTS.items())


def risk_level(score: int) -> str:
    if score >= RISK_DANGER_THRESHOLD:
        return "위험"
    if score >= RISK_CAUTION_THRESHOLD:
        return "주의"
    return "양호"


def escalate(level: str) -> str:
    return "위험" if level == "주의" else "주의" if level == "양호" else level


def find_speaker_for_zone(devices: dict[str, Any], zone_keyword: str) -> str | None:
    for speaker in (devices or {}).get("speakers", []) or []:
        if zone_keyword in (speaker.get("name") or ""):
            return speaker.get("name")
    return None


def compute_zone_reports(
    incidents: dict[str, Any],
    wind_speed: float | None,
    uv_value: float | None,
    temperature: float | None = None,
) -> list[dict[str, Any]]:
    """구역별 (label, record, score, level) 딕셔너리 리스트를 계산한다.

    server.py의 assess_breakwater_risk와 monitor.py의 폴링 루프가 똑같은 계산을 쓴다.
    """
    zone_data = []
    for zone_key, label in ZONE_LABELS.items():
        record = latest_zone_record(incidents.get(zone_key))
        score = zone_score(record)
        zone_data.append({"zone_key": zone_key, "label": label, "record": record, "score": score, "level": risk_level(score)})

    wind_alert = wind_speed is not None and wind_speed >= WIND_SPEED_ESCALATION_MS
    uv_alert = uv_value is not None and uv_value >= UV_ESCALATION_INDEX
    heat_alert = temperature is not None and temperature >= HEAT_ALERT_TEMP_C
    riskiest_key = max(zone_data, key=lambda z: z["score"])["zone_key"] if zone_data else None

    for zone in zone_data:
        if (
            zone["level"] != "위험"
            and zone["score"] > 0
            and zone["zone_key"] == riskiest_key
            and (wind_alert or uv_alert or heat_alert)
        ):
            zone["level"] = escalate(zone["level"])

    return zone_data
