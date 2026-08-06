"""구룡포 방파제 보행자 안전 경보 에이전트 — MCP 서버 (온디맨드 질의 경로).

E-UM 디지털트윈 포항의 보행자안전(S06) API를 MCP tool로 노출해서, LLM이
자연어 질문("지금 방파제 상황 어때?")에 실제 실시간 데이터로 답하고
위험도 판단·방송 스피커 추천까지 하도록 한다.

이 파일은 "사람이 물어봤을 때" 경로다. "물어보지 않아도 알아서 알리는" 상시
감시·경보 경로는 monitor.py에 따로 있다 (README.md "왜 두 경로로 나눴나" 참고).

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
from risk_logic import compute_zone_reports, find_speaker_for_zone

mcp = FastMCP("breakwater-guard")


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
    """대기환경 측정 장비 한 곳의 실시간 풍속·기온 등을 가져온다.

    INT_S01_004 — 풍속·폭염은 방파제 보행 위험을 높이는 가중 요인으로 쓴다.
    device_id는 대기환경 장비 고유번호(기본값 1, 카탈로그 예시값).
    현재 팀 serviceKey에 이 서비스 권한이 없어(40104) 호출이 실패할 수 있다 — data.md 참고.
    """
    return eum_get("/dpg/atmosphere/device/realtime", {"id": device_id})


@mcp.tool()
def assess_breakwater_risk(atmosphere_device_id: int = 1) -> str:
    """남/북 방파제의 현재 위험도를 판정하고, 위험도가 가장 높은 구역에 방송할 스피커를 추천한다.

    INT_S06_006(이상행동 통계) + INT_S06_005(자외선) + INT_S01_004(풍속·기온)를 종합해
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
    temperature: float | None = None
    try:
        atmo = get_atmosphere_realtime(atmosphere_device_id) or {}
        if isinstance(atmo, dict):
            wind_speed = atmo.get("winsp")
            temperature = atmo.get("temp")
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

    zone_reports = compute_zone_reports(incidents, wind_speed, uv_value, temperature)

    lines: list[str] = []
    for zone in zone_reports:
        record = zone["record"]
        if record:
            detail = (
                f"접근경고 {record.get('warningApproachCount', 0)}건, "
                f"실족감지 {record.get('warningFallDetectionCount', 0)}건, "
                f"침입감지 {record.get('warningInsideDetectionCount', 0)}건, "
                f"이상감지 {record.get('normalFallDetectionCount', 0)}건"
            )
        else:
            detail = "데이터 없음"
        lines.append(f"{zone['label']}: {detail} — {zone['level']}")

    if wind_speed is not None:
        wind_note = f"현재 풍속 {wind_speed}m/s"
        wind_note += "로 강풍주의보 수준, 테트라포드 위 보행 위험이 큽니다." if wind_speed >= 8.0 else "로 평이한 수준입니다."
        lines.append(wind_note)

    if temperature is not None and temperature >= 33.0:
        lines.append(f"기온 {temperature}℃로 폭염 수준, 장시간 체류 시 온열질환 위험이 있습니다.")

    if uv_value is not None:
        uv_note = f"자외선 지수 {uv_value}"
        uv_note += " (매우 높음, 장시간 체류 주의)" if uv_value >= 8.0 else ""
        lines.append(uv_note)

    riskiest = max(zone_reports, key=lambda z: z["score"])
    zone_keyword = riskiest["label"].replace("방파제", "")
    if riskiest["score"] > 0 or (wind_speed and wind_speed >= 8.0):
        speaker = find_speaker_for_zone(devices, riskiest["label"]) or find_speaker_for_zone(devices, zone_keyword)
        if speaker:
            lines.append(f"{riskiest['label']} 스피커({speaker})로 안전방송을 우선 송출하는 것을 권장합니다.")
        else:
            lines.append(f"{riskiest['label']} 구역 방송을 권장하나, 스피커 장비 매칭에 실패했습니다 (장비 목록 확인 필요).")

    if errors:
        lines.append("(일부 데이터 조회 실패: " + "; ".join(errors) + ")")

    return "\n".join(lines)


if __name__ == "__main__":
    mcp.run()
