"""serviceKey 없이 위험도 판정 로직만 검증하는 오프라인 테스트.

실제 E-UM 서버 대신 카탈로그 문서(INT_S06_006/005, INT_S01_004) 스키마를
따르는 가짜 응답을 넣어서 assess_breakwater_risk()의 판정·스피커 매칭
로직이 의도대로 동작하는지 확인한다. serviceKey를 발급받기 전에도
MCP 서버의 "판단" 부분이 옳게 동작하는지 검증할 수 있다.

실행:
    pip install -r requirements.txt
    python test_offline.py
"""

from __future__ import annotations

from unittest.mock import patch

import server

FAKE_INCIDENTS = {
    "north": [
        {
            "hour": "2026-08-06 14:00:00",
            "warningFallDetectionCount": 2,
            "warningInsideDetectionCount": 0,
            "warningApproachCount": 12,
            "normalFallDetectionCount": 0,
        }
    ],
    "south": [
        {
            "hour": "2026-08-06 14:00:00",
            "warningFallDetectionCount": 0,
            "warningInsideDetectionCount": 0,
            "warningApproachCount": 3,
            "normalFallDetectionCount": 0,
        }
    ],
}
FAKE_UV = {"dateTime": "2026-08-06 14:00:00", "uvIndex": 3.2}
FAKE_ATMO = {"logDateTime": "2026-08-06 14:00:00", "devId": 1, "winsp": 8.1}
FAKE_DEVICES = {
    "uv_devices": [{"id": 1, "name": "자외선 측정기"}],
    "speakers": [
        {"id": 1, "name": "구룡포 북방파제 SR-01-001"},
        {"id": 2, "name": "구룡포 남방파제 SR-02-001"},
    ],
    "ai_cctvs": [{"id": 1, "name": "구룡포 북방파제 AI-01-001"}],
}


def fake_eum_get(path: str, params: dict | None = None):
    if path == "/dpg/aicctv/avghour/datas":
        return FAKE_INCIDENTS
    if path == "/dpg/sensor/latest/uvIndex":
        return FAKE_UV
    if path == "/dpg/atmosphere/device/realtime":
        return FAKE_ATMO
    if path == "/dpg/pedestrian/device/list":
        return FAKE_DEVICES
    raise AssertionError(f"unexpected path: {path}")


def main() -> None:
    with patch("server.eum_get", side_effect=fake_eum_get):
        report = server.assess_breakwater_risk()

    print(report)
    print()

    assert "북방파제" in report and "위험" in report, "북방파제가 위험으로 판정되어야 한다"
    assert "남방파제" in report and "양호" in report, "남방파제가 양호로 판정되어야 한다"
    assert "강풍주의보" in report, "풍속 8.1m/s는 강풍 경고 문구를 포함해야 한다"
    assert "SR-01-001" in report, "위험 구역인 북방파제 스피커가 추천되어야 한다"

    print("OK: 판정 로직 검증 통과")


if __name__ == "__main__":
    main()
