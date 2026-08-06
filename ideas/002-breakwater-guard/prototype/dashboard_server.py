"""방파제 실시간 모니터링 대시보드 서버.

monitor.py가 계속 갱신하는 dashboard_data.json / alerts.jsonl을 읽어서 웹으로
보여준다. 그래프·알림 피드는 dashboard.html(브라우저) 쪽에서 그리고, 방송
음성 합성(TTS)도 브라우저 내장 Web Speech API로 하기 때문에 팀원이 Windows든
macOS든 자기 브라우저로 대시보드를 열면 그대로 소리가 난다 (tts.py의 macOS
`say`는 monitor.py를 직접 돌리는 사람만을 위한 보조 기능일 뿐, 팀 공용 경로가
아니다 — tts.py 모듈 docstring 참고).

실행:
    python monitor.py &          # 백그라운드로 감시 루프 실행
    python dashboard_server.py   # http://localhost:8765 에서 대시보드 열람
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

from eum_client import EumApiError, eum_get
from narrator import narrate_alert
from risk_logic import find_speaker_for_zone

HERE = Path(__file__).resolve().parent
SNAPSHOT_PATH = HERE / "dashboard_data.json"
ALERTS_PATH = HERE / "alerts.jsonl"
PORT = int(os.environ.get("DASHBOARD_PORT", "8765"))

app = Flask(__name__)

# 실제 센서 이벤트를 기다리지 않고 알림 파이프라인 전체(문구 생성 -> 로그 -> 대시보드 표시
# -> 사람 승인 -> 음성 방송)를 시연/디버깅할 수 있게 하는 테스트 트리거. 스피커 매칭은
# 실제 INT_S06_001 호출로 하고, 문구는 실제 narrate_alert()를 그대로 탄다 — "이벤트 발생"
# 부분만 가짜고 나머지 파이프라인은 진짜다.
TEST_EVENT_TEMPLATES = {
    "실족감지": {"level": "위험", "reason": "[테스트] 실족감지 1건 신규 발생 (방파제에서 사람이 넘어졌을 가능성)"},
    "접근경고": {"level": "주의", "reason": "[테스트] 위험구역 접근경고 5건 신규 발생"},
    "침입감지": {"level": "주의", "reason": "[테스트] 침입감지 1건 신규 발생"},
    "보행자 이상감지": {"level": "주의", "reason": "[테스트] 보행자 이상감지 2건 신규 발생"},
    "위험도 상승": {"level": "위험", "reason": "[테스트] 누적 이상행동 점수 18점으로 위험 단계 진입"},
    "기상 위험": {"level": "주의", "reason": "[테스트] 풍속 9.5m/s — 기상 조건 위험 수준 진입"},
}


@app.after_request
def no_cache(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/")
def index():
    return send_from_directory(HERE, "dashboard.html")


@app.get("/api/config")
def config():
    """대시보드가 'AI 문구 생성이 켜져 있는지'를 알 수 있게 (키 값 자체는 절대 노출 안 함)."""
    return jsonify({"llm_enabled": bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())})


@app.get("/api/snapshot")
def snapshot():
    if not SNAPSHOT_PATH.exists():
        return jsonify({"updated_at": None, "history": [], "recent_alerts": [], "errors": ["monitor.py가 아직 실행 전이거나 첫 폴링 전입니다."]})
    return jsonify(json.loads(SNAPSHOT_PATH.read_text(encoding="utf-8")))


@app.get("/api/alerts")
def alerts():
    if not ALERTS_PATH.exists():
        return jsonify([])
    lines = ALERTS_PATH.read_text(encoding="utf-8").splitlines()
    limit = int(request.args.get("limit", "30"))
    return jsonify([json.loads(line) for line in lines[-limit:]][::-1])


@app.post("/api/broadcast")
def broadcast():
    """사람이 대시보드에서 (AI 초안을 수정했든, 완전 새로 썼든) 방송을 확정했을 때 기록한다.

    실제 음성 재생은 브라우저(dashboard.html)가 Web Speech API로 이미 처리했으므로,
    여기서는 감사 로그(alerts.jsonl)에 "누가 무엇을 언제 방송했는지"만 남긴다.
    """
    body = request.get_json(force=True, silent=True) or {}
    zone_label = body.get("zone_label") or "미지정"
    script = (body.get("script") or "").strip()
    if not script:
        return jsonify({"error": "script는 비어 있을 수 없다"}), 400

    entry = {
        "timestamp": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "zone_label": zone_label,
        "level": body.get("level") or "수동",
        "kind": "수동방송",
        "reason": "관제 담당자가 대시보드에서 직접 방송",
        "summary": f"{zone_label} 담당자 수동 방송",
        "script": script,
        "generated_by": "human",
        "speaker": body.get("speaker"),
        "status": "관리자 방송 완료",
    }
    with ALERTS_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    return jsonify(entry)


@app.post("/api/debug/trigger")
def debug_trigger():
    """테스트용: 실제 센서 이벤트 없이 알림 파이프라인 전체를 강제로 한 번 태운다."""
    body = request.get_json(force=True, silent=True) or {}
    kind = body.get("kind")
    zone_label = body.get("zone_label") or "북방파제"
    template = TEST_EVENT_TEMPLATES.get(kind)
    if not template:
        return jsonify({"error": f"알 수 없는 kind: {kind}. 가능한 값: {list(TEST_EVENT_TEMPLATES)}"}), 400

    speaker = None
    try:
        devices = eum_get("/dpg/pedestrian/device/list") or {}
        speaker = find_speaker_for_zone(devices, zone_label) or find_speaker_for_zone(devices, zone_label.replace("방파제", ""))
    except EumApiError:
        pass  # 장비 목록을 못 가져와도 테스트 알림 자체는 진행한다

    event = {
        "kind": kind,
        "zone_label": zone_label,
        "level": template["level"],
        "reason": template["reason"],
        "wind_speed": 9.5 if kind == "기상 위험" else None,
        "uv_index": None,
        "temperature": None,
        "speaker": speaker,
    }
    narration = narrate_alert(event)
    entry = {
        "timestamp": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "zone_label": zone_label,
        "level": event["level"],
        "kind": f"{kind} (테스트)",
        "reason": event["reason"],
        "summary": narration["summary"],
        "script": narration["script"],
        "generated_by": narration["generated_by"],
        "speaker": speaker,
        "status": "대기승인",
    }
    with ALERTS_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    return jsonify(entry)


if __name__ == "__main__":
    print(f"대시보드: http://localhost:{PORT}")
    app.run(host="0.0.0.0", port=PORT, debug=False)
