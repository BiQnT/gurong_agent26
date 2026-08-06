"""구룡포 방파제 보행자 안전 경보 에이전트 — MCP 서버.

E-UM 디지털트윈 포항의 보행자안전(S06) API를 MCP tool로 노출해서, LLM이
자연어 질문("지금 방파제 상황 어때?")에 실제 실시간 데이터로 답하고
위험도 판단·방송 스피커 추천까지 하도록 한다.

실행:
    cd ideas/002-breakwater-guard/prototype
    cp ../../../.env.example .env   # EUM_SERVICE_KEY 채우기
    pip install -r requirements.txt
    python server.py

Claude Desktop/Code에 연결하려면 이 디렉터리를 cwd로 하는 stdio MCP
서버로 등록한다 (README.md 참고).
"""

from typing import Any

from eum_client import EumApiError, eum_get
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("breakwater-guard")

# --- 위험도 판정 임계값 -----------------------------------------------
# data.md에 실제 호출 결과가 아직 없어(serviceKey 미발급) 잠정값이다.
# 팀 serviceKey 발급 후 실제 값 분포를 보고 반드시 재조정할 것.
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


@mcp.tool()
def list_pedestrian_devices() -> Any:
    """방파제에 설치된 자외선 측정기·스피커·AI CCTV 장비 목록(이름, 위경도, 주소)을 가져온다.

    INT_S06_001 — 어느 구역(남/북방파제)에 어떤 스피커가 있는지 확인할 때 쓴다.
    """
    return eum_get("/dpg/pedestrian/device/list")


@mcp.tool()
def get_incident_stats() -> Any:
    """방파제 남/북 구역별 시간대별 이상행동(실족감지·침입감지·접근경고·이상감지) 발생 건수를 가져온다.

    INT_S06_006 — 위험도 판정의 핵심 입력.
    """
    return eum_get("/dpg/aicctv/avghour/datas")


@mcp.tool()
def get_uv_index() -> Any:
    """방파제 자외선 측정 장비의 최신 자외선 지수를 가져온다.

    INT_S06_005 — 강한 자외선은 보행자 부주의·장시간 체류를 늘려 위험 가중 요인으로 쓴다.
    """
    return eum_get("/dpg/sensor/latest/uvIndex")


@mcp.tool()
def get_atmosphere_realtime(device_id: int = 1) -> Any:
    """대기환경 측정 장비 한 곳의 실시간 풍속·미세먼지 등을 가져온다.

    INT_S01_004 — 풍속이 강하면 테트라포드 위 실족 위험이 커지므로 위험 가중 요인으로 쓴다.
    device_id는 대기환경 장비 고유번호(기본값 1, 카탈로그 예시값).
    """
    return eum_get("/dpg/atmosphere/device/realtime", {"id": device_id})


def _latest_zone_record(zone_records: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    if not zone_records:
        return None
    return max(zone_records, key=lambda r: r.get("hour", ""))


def _zone_score(record: dict[str, Any] | None) -> int:
    if not record:
        return 0
    return sum(int(record.get(field, 0) or 0) * weight for field, weight in INCIDENT_WEIGHTS.items())


def _risk_level(score: int) -> str:
    if score >= RISK_DANGER_THRESHOLD:
        return "위험"
    if score >= RISK_CAUTION_THRESHOLD:
        return "주의"
    return "양호"


def _find_speaker_for_zone(devices: dict[str, Any], zone_keyword: str) -> str | None:
    for speaker in (devices or {}).get("speakers", []) or []:
        if zone_keyword in (speaker.get("name") or ""):
            return speaker.get("name")
    return None


@mcp.tool()
def assess_breakwater_risk(atmosphere_device_id: int = 1) -> str:
    """남/북 방파제의 현재 위험도를 판정하고, 위험도가 가장 높은 구역에 방송할 스피커를 추천한다.

    INT_S06_006(이상행동 통계) + INT_S06_005(자외선) + INT_S01_004(풍속)를 종합해
    구역별로 "양호/주의/위험" 3단계를 매기고, 판단 근거와 추천 조치를 자연어로 돌려준다.
    이 tool 하나가 idea README의 3번(에이전트가 하는 일) MVP 시나리오 전체를 구현한다.
    """
    errors: list[str] = []

    incidents: dict[str, Any] = {}
    try:
        incidents = get_incident_stats() or {}
    except EumApiError as exc:
        errors.append(str(exc))

    uv_value: float | None = None
    try:
        uv_data = get_uv_index() or {}
        uv_value = uv_data.get("uvIndex") if isinstance(uv_data, dict) else None
    except EumApiError as exc:
        errors.append(str(exc))

    wind_speed: float | None = None
    try:
        atmo = get_atmosphere_realtime(atmosphere_device_id) or {}
        wind_speed = atmo.get("winsp") if isinstance(atmo, dict) else None
    except EumApiError as exc:
        errors.append(str(exc))

    devices: dict[str, Any] = {}
    try:
        devices = list_pedestrian_devices() or {}
    except EumApiError as exc:
        errors.append(str(exc))

    if errors and not incidents:
        return (
            "판정을 위한 데이터를 가져오지 못했다:\n- "
            + "\n- ".join(errors)
            + "\nEUM_SERVICE_KEY가 유효한지 확인할 것."
        )

    zone_labels = {"south": "남방파제", "north": "북방파제"}
    zone_data: list[tuple[str, dict[str, Any] | None, int, str]] = []  # (label, record, score, level)

    for zone_key, label in zone_labels.items():
        record = _latest_zone_record(incidents.get(zone_key))
        score = _zone_score(record)
        zone_data.append((label, record, score, _risk_level(score)))

    # 풍속·자외선은 방파제 전체에 걸리는 조건이지만, 이미 사람이 몰리고 있다는
    # 신호(이상행동 점수 > 0)가 있는 구역에서만 위험도를 한 단계 올린다.
    # 조용한 구역까지 전역 기상 조건만으로 "주의"로 올리면 오탐이 늘어난다.
    wind_alert = wind_speed is not None and wind_speed >= WIND_SPEED_ESCALATION_MS
    uv_alert = uv_value is not None and uv_value >= UV_ESCALATION_INDEX
    riskiest_zone_key = max(zone_data, key=lambda item: item[2])[0] if zone_data else None

    zone_reports: list[tuple[str, str, int]] = []  # (label, line, score)
    for label, record, score, level in zone_data:
        if level != "위험" and score > 0 and label == riskiest_zone_key and (wind_alert or uv_alert):
            level = "위험" if level == "주의" else "주의"

        if record:
            detail = (
                f"접근경고 {record.get('warningApproachCount', 0)}건, "
                f"실족감지 {record.get('warningFallDetectionCount', 0)}건, "
                f"침입감지 {record.get('warningInsideDetectionCount', 0)}건, "
                f"이상감지 {record.get('normalFallDetectionCount', 0)}건"
            )
        else:
            detail = "데이터 없음"

        zone_reports.append((label, f"{label}: {detail} — {level}", score))

    lines = [line for _label, line, _score in zone_reports]

    if wind_speed is not None:
        wind_note = f"현재 풍속 {wind_speed}m/s"
        if wind_speed >= WIND_SPEED_ESCALATION_MS:
            wind_note += "로 강풍주의보 수준, 테트라포드 위 보행 위험이 큽니다."
        else:
            wind_note += "로 평이한 수준입니다."
        lines.append(wind_note)

    if uv_value is not None:
        uv_note = f"자외선 지수 {uv_value}"
        uv_note += " (매우 높음, 장시간 체류 주의)" if uv_value >= UV_ESCALATION_INDEX else ""
        lines.append(uv_note)

    riskiest_label, _line, riskiest_score = max(zone_reports, key=lambda item: item[2])
    zone_keyword = riskiest_label.replace("방파제", "")  # "남방파제" -> "남"
    if riskiest_score > 0 or (wind_speed and wind_speed >= WIND_SPEED_ESCALATION_MS):
        speaker = _find_speaker_for_zone(devices, riskiest_label) or _find_speaker_for_zone(devices, zone_keyword)
        if speaker:
            lines.append(f"{riskiest_label} 스피커({speaker})로 안전방송을 우선 송출하는 것을 권장합니다.")
        else:
            lines.append(f"{riskiest_label} 구역 방송을 권장하나, 스피커 장비 매칭에 실패했습니다 (장비 목록 확인 필요).")

    if errors:
        lines.append("(일부 데이터 조회 실패: " + "; ".join(errors) + ")")

    return "\n".join(lines)


if __name__ == "__main__":
    mcp.run()
