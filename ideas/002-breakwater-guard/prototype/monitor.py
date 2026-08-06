"""구룡포 방파제 상시 감시 루프 — "물어봐야 답하는" 게 아니라 "알아서 알리는" 경로.

server.py(MCP tool)는 사람이 채팅으로 물어봐야 동작한다. 안전 경보는 그래서는
안 된다는 피드백에 따라 만든 백그라운드 프로세스다: 일정 주기로 E-UM API를
직접 폴링하면서

1. 실족감지·접근경고가 **새로 늘어나면** 즉시 경보 (방파제 빠짐/접근 감지)
2. 구역 위험도가 "위험"으로 올라가면 즉시 경보
3. 풍속·자외선·기온이 임계값을 넘어서면(edge, 매번 반복 알림 아님) 기상 위험 경보

경보가 뜨면 narrator.py(생성형 AI, 판정 이후 문구 생성 전용 — 모듈 docstring 참고)로
상황 요약과 방송 문구를 만들고, alerts.jsonl에 기록한다. 매 폴링마다
dashboard_data.json에 최근 이력을 남겨서 dashboard.html이 실시간 그래프로 보여준다.

실행:
    python monitor.py                # 기본 30초 간격
    POLL_INTERVAL_SECONDS=10 python monitor.py
    AUTO_BROADCAST_LOCAL_TTS=1 python monitor.py   # 이 macOS 기기에서 바로 소리로도 재생
"""

from __future__ import annotations

import json
import os
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from eum_client import EumApiError, eum_get
from narrator import narrate_alert
from risk_logic import ZONE_LABELS, HEAT_ALERT_TEMP_C, UV_ESCALATION_INDEX, WIND_SPEED_ESCALATION_MS, compute_zone_reports, find_speaker_for_zone

HERE = Path(__file__).resolve().parent
SNAPSHOT_PATH = HERE / "dashboard_data.json"
ALERTS_PATH = HERE / "alerts.jsonl"

POLL_INTERVAL_SECONDS = int(os.environ.get("POLL_INTERVAL_SECONDS", "10"))
AUTO_BROADCAST_LOCAL_TTS = os.environ.get("AUTO_BROADCAST_LOCAL_TTS", "").strip() == "1"
HISTORY_MAX_POINTS = 120

INCIDENT_FIELDS = [
    "warningFallDetectionCount",
    "warningInsideDetectionCount",
    "warningApproachCount",
    "normalFallDetectionCount",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


class MonitorState:
    """폴링 사이 상태를 들고 있는다 — 이게 있어야 "새로 늘어난 것"만 경보할 수 있다."""

    def __init__(self) -> None:
        self.last_seen_count: dict[tuple[str, str, str], int] = {}  # (zone, hour, field) -> count
        self.last_level: dict[str, str] = {}  # zone_key -> level
        self.weather_alert_active = False

    def new_incident_delta(self, zone_key: str, record: dict[str, Any] | None, field: str) -> int:
        if not record:
            return 0
        hour = record.get("hour", "")
        key = (zone_key, hour, field)
        current = int(record.get(field, 0) or 0)
        previous = self.last_seen_count.get(key, 0)
        self.last_seen_count[key] = current
        return max(0, current - previous)


def fetch_all() -> tuple[dict[str, Any], float | None, float | None, float | None, dict[str, Any], list[str]]:
    """incidents, uv, wind, temperature, devices, errors 를 최대한 가져온다 (부분 실패 허용)."""
    errors: list[str] = []

    incidents: dict[str, Any] = {}
    try:
        incidents = eum_get("/dpg/aicctv/avghour/datas") or {}
    except EumApiError as exc:
        errors.append(str(exc))

    uv_value: float | None = None
    try:
        uv_data = eum_get("/dpg/sensor/latest/uvIndex") or {}
        uv_value = uv_data.get("uvIndex") if isinstance(uv_data, dict) else None
    except EumApiError as exc:
        errors.append(str(exc))

    wind_speed: float | None = None
    temperature: float | None = None
    try:
        atmo = eum_get("/dpg/atmosphere/device/realtime", {"id": 1}) or {}
        if isinstance(atmo, dict):
            wind_speed = atmo.get("winsp")
            temperature = atmo.get("temp")
    except EumApiError as exc:
        errors.append(str(exc))

    devices: dict[str, Any] = {}
    try:
        devices = eum_get("/dpg/pedestrian/device/list") or {}
    except EumApiError as exc:
        errors.append(str(exc))

    return incidents, uv_value, wind_speed, temperature, devices, errors


def record_alert(event: dict[str, Any]) -> dict[str, Any]:
    narration = narrate_alert(event)
    entry = {
        "timestamp": now_iso(),
        "zone_label": event["zone_label"],
        "level": event["level"],
        "kind": event["kind"],
        "reason": event["reason"],
        "summary": narration["summary"],
        "script": narration["script"],
        "generated_by": narration["generated_by"],
        "speaker": event.get("speaker"),
        "status": "대기승인",
    }

    if AUTO_BROADCAST_LOCAL_TTS:
        from tts import speak

        if speak(entry["script"]):
            entry["status"] = "자동방송(로컬 TTS)"

    with ALERTS_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    print(f"[{entry['timestamp']}] 🚨 {entry['summary']}")
    print(f"    방송문구({entry['generated_by']}): {entry['script']}")

    return entry


def detect_events(
    state: MonitorState,
    zone_reports: list[dict[str, Any]],
    devices: dict[str, Any],
    wind_speed: float | None,
    uv_value: float | None,
    temperature: float | None,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []

    for zone in zone_reports:
        zone_key, label, record = zone["zone_key"], zone["label"], zone["record"]
        speaker = find_speaker_for_zone(devices, label) or find_speaker_for_zone(devices, label.replace("방파제", ""))

        fall_delta = state.new_incident_delta(zone_key, record, "warningFallDetectionCount")
        if fall_delta > 0:
            events.append(
                {
                    "kind": "실족감지",
                    "zone_label": label,
                    "level": "위험",
                    "reason": f"방금 실족감지 {fall_delta}건 신규 발생 (방파제에서 사람이 넘어졌을 가능성)",
                    "wind_speed": wind_speed,
                    "uv_index": uv_value,
                    "temperature": temperature,
                    "speaker": speaker,
                }
            )

        approach_delta = state.new_incident_delta(zone_key, record, "warningApproachCount")
        if approach_delta > 0:
            events.append(
                {
                    "kind": "접근경고",
                    "zone_label": label,
                    "level": zone["level"],
                    "reason": f"방금 위험구역 접근경고 {approach_delta}건 신규 발생",
                    "wind_speed": wind_speed,
                    "uv_index": uv_value,
                    "temperature": temperature,
                    "speaker": speaker,
                }
            )

        # 침입감지/이상감지도 같은 방식으로 신규 발생분만 잡는다.
        for field, kind in (("warningInsideDetectionCount", "침입감지"), ("normalFallDetectionCount", "보행자 이상감지")):
            delta = state.new_incident_delta(zone_key, record, field)
            if delta > 0:
                events.append(
                    {
                        "kind": kind,
                        "zone_label": label,
                        "level": zone["level"],
                        "reason": f"방금 {kind} {delta}건 신규 발생",
                        "wind_speed": wind_speed,
                        "uv_index": uv_value,
                        "temperature": temperature,
                        "speaker": speaker,
                    }
                )

        previous_level = state.last_level.get(zone_key)
        if zone["level"] == "위험" and previous_level != "위험":
            events.append(
                {
                    "kind": "위험도 상승",
                    "zone_label": label,
                    "level": "위험",
                    "reason": f"누적 이상행동 점수 {zone['score']}점으로 위험 단계 진입",
                    "wind_speed": wind_speed,
                    "uv_index": uv_value,
                    "temperature": temperature,
                    "speaker": speaker,
                }
            )
        state.last_level[zone_key] = zone["level"]

    weather_alert_now = (
        (wind_speed is not None and wind_speed >= WIND_SPEED_ESCALATION_MS)
        or (uv_value is not None and uv_value >= UV_ESCALATION_INDEX)
        or (temperature is not None and temperature >= HEAT_ALERT_TEMP_C)
    )
    if weather_alert_now and not state.weather_alert_active:
        reasons = []
        if wind_speed is not None and wind_speed >= WIND_SPEED_ESCALATION_MS:
            reasons.append(f"풍속 {wind_speed}m/s")
        if uv_value is not None and uv_value >= UV_ESCALATION_INDEX:
            reasons.append(f"자외선 지수 {uv_value}")
        if temperature is not None and temperature >= HEAT_ALERT_TEMP_C:
            reasons.append(f"기온 {temperature}℃")
        events.append(
            {
                "kind": "기상 위험",
                "zone_label": "방파제 전체",
                "level": "주의",
                "reason": ", ".join(reasons) + " — 기상 조건 위험 수준 진입",
                "wind_speed": wind_speed,
                "uv_index": uv_value,
                "temperature": temperature,
                "speaker": None,
            }
        )
    state.weather_alert_active = weather_alert_now

    return events


def write_snapshot(history: deque[dict[str, Any]], recent_alerts: list[dict[str, Any]], errors: list[str]) -> None:
    payload = {
        "updated_at": now_iso(),
        "history": list(history),
        "recent_alerts": recent_alerts[-20:],
        "errors": errors,
    }
    tmp_path = SNAPSHOT_PATH.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(SNAPSHOT_PATH)  # 대시보드가 쓰다 만 파일을 읽지 않도록 원자적 교체


def load_recent_alerts(limit: int = 20) -> list[dict[str, Any]]:
    if not ALERTS_PATH.exists():
        return []
    lines = ALERTS_PATH.read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines[-limit:]]


def run() -> None:
    state = MonitorState()
    history: deque[dict[str, Any]] = deque(maxlen=HISTORY_MAX_POINTS)
    recent_alerts = load_recent_alerts()

    print(f"방파제 상시 감시 시작 (폴링 간격 {POLL_INTERVAL_SECONDS}초, Ctrl+C로 종료)")
    while True:
        incidents, uv_value, wind_speed, temperature, devices, errors = fetch_all()
        zone_reports = compute_zone_reports(incidents, wind_speed, uv_value, temperature)

        history.append(
            {
                "timestamp": now_iso(),
                "uv_index": uv_value,
                "wind_speed": wind_speed,
                "temperature": temperature,
                "zones": {z["zone_key"]: {"score": z["score"], "level": z["level"]} for z in zone_reports},
            }
        )

        events = detect_events(state, zone_reports, devices, wind_speed, uv_value, temperature)
        for event in events:
            entry = record_alert(event)
            recent_alerts.append(entry)

        write_snapshot(history, recent_alerts, errors)

        if errors:
            print(f"[{now_iso()}] (일부 API 조회 실패: {'; '.join(errors)})")

        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        print("\n감시 종료")
