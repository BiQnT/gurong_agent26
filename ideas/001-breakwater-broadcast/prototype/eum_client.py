#!/usr/bin/env python3
"""E-UM 디지털트윈 포항 Open API 클라이언트.

이 아이디어가 쓰는 API 4개를 감싼다. 서비스키는 **레포 루트의 `.env`** 하나가
정본이다 (`EUM_SERVICE_KEY`). 아이디어 폴더에 `.env` 를 따로 만들지 않는다.

| API ID | 기능 | 함수 |
| --- | --- | --- |
| `INT_S06_001` | 보행자안전 장비 목록 (자외선기·스피커·AI CCTV) | `pedestrian_devices()` |
| `INT_S06_005` | 자외선 측정 장비 실시간 | `uv_index(device_id)` |
| `INT_S06_006` | 시간대별 이상행동 발생수 통계 | `abnormal_events(date)` |
| `INT_S03_019` | 주요 기상 요소 과거 정보 (기온·풍속·풍향) | `weather(date)` |

단독 실행하면 지금 방파제 상황을 한 화면으로 찍어준다.

    python3 ideas/001-breakwater-broadcast/prototype/eum_client.py

전체 40개 API 중 무엇이 살아 있는지는 `research/api-tests/probe_eum_apis.py` 가
판정한다. 이 클라이언트는 그중 4개만 쓴다.
"""

from __future__ import annotations

import json
import os
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date as _date
from datetime import timedelta
from pathlib import Path

BASE = "https://genix.pohang-eum.kr"
ROOT = Path(__file__).resolve().parents[3]
TIMEOUT = 20


class EumError(RuntimeError):
    """E-UM 이 실패 응답을 줬거나 호출 자체가 실패했을 때."""


HERE = Path(__file__).resolve().parent

# 찾는 순서: 환경변수 → 이 폴더의 .env → 레포 루트의 .env
#
# 개인 키(LLM 등)는 사람마다 쓰는 모델도 키도 달라서 아이디어 폴더에 두고,
# 팀 공용인 EUM_SERVICE_KEY 는 루트에 하나만 둬도 된다. 둘 다 있으면
# 가까운 쪽(이 폴더)이 이긴다.
ENV_FILES = (HERE / ".env", ROOT / ".env")


def load_env(name: str) -> str | None:
    """환경변수 → 가까운 .env → 먼 .env 순으로 값을 찾는다. 없으면 None."""
    value = os.environ.get(name, "").strip()
    if value:
        return value
    for env in ENV_FILES:
        if not env.exists():
            continue
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith(f"{name}="):
                value = line.split("=", 1)[1].strip().strip("\"'")
                if value:
                    return value
    return None


def load_key() -> str:
    key = load_env("EUM_SERVICE_KEY")
    if key:
        return key
    raise EumError(
        "EUM_SERVICE_KEY 가 없다. 다음 중 한 곳에 넣거나 환경변수로 넘길 것:\n"
        + "\n".join(f"  {p}" for p in ENV_FILES)
        + "\n발급: https://pohang-eum.kr/data 로그인 → API 자료실 → 활용 신청"
    )


def get(path: str, **params: object) -> object:
    """`GET {BASE}{path}` 를 호출하고 응답의 `data` 를 돌려준다.

    E-UM 공통 응답 껍데기는 `{id, status, data}` 이고 실제 값은 `data` 안에 있다.
    `status` 가 `success` 가 아니면 `EumError` 를 던진다.
    """
    query = urllib.parse.urlencode(
        {"serviceKey": load_key(), **{k: v for k, v in params.items() if v is not None}}
    )
    url = f"{BASE}{path}?{query}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})

    # E-UM 서버 인증서 체인이 불완전한 경우가 있어 검증 실패 시 한 번 더 시도한다.
    last: Exception | None = None
    for ctx in (None, ssl._create_unverified_context()):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as res:
                body = json.loads(res.read().decode("utf-8", "replace"))
                break
        except ssl.SSLError as e:
            last = e
            continue
        except urllib.error.HTTPError as e:
            raise EumError(f"{path} HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}") from e
        except Exception as e:  # noqa: BLE001
            raise EumError(f"{path} 호출 실패: {type(e).__name__}: {e}") from e
    else:
        raise EumError(f"{path} SSL 실패: {last}")

    if body.get("status") != "success":
        raise EumError(f"{path} 응답 실패: {json.dumps(body, ensure_ascii=False)[:300]}")
    return body.get("data")


def yesterday() -> str:
    """E-UM 통계 API 가 받는 `YYYYMMDD`. 당일은 아직 안 쌓였을 수 있어 전날을 쓴다."""
    return (_date.today() - timedelta(days=1)).strftime("%Y%m%d")


# --- INT_S06_001 --------------------------------------------------------------


def pedestrian_devices() -> dict:
    """보행자안전 장비 목록. `uv_devices` / `speakers` / `ai_cctvs` 세 묶음이 한 번에 온다.

    각 항목에 `id`, `name`, `latitude`, `longitude`, `address` 가 있고
    AI CCTV 에는 `angle`(카메라 각도)이 추가로 붙는다.
    """
    data = get("/dpg/pedestrian/device/list")
    return data if isinstance(data, dict) else {}


# --- INT_S06_005 --------------------------------------------------------------


def uv_index(device_id: int | str) -> dict:
    """자외선 측정 장비 실시간 수치. `{dateTime, uvIndex}`."""
    data = get("/dpg/sensor/latest/uvIndex", id=device_id)
    return data if isinstance(data, dict) else {}


# --- INT_S06_006 --------------------------------------------------------------


def abnormal_events(date: str | None = None) -> object:
    """AI CCTV 가 검출한 시간대별 이상행동 발생수 통계.

    카탈로그에 '이상행동'의 정의가 없다. 실족·추락인지, 월파 구간 접근인지,
    배회인지에 따라 이 아이디어의 설득력이 달라진다 — 응답을 보고도 모르면
    주최 측(권소현, ikwon@postech.ac.kr)에 문의할 것.
    """
    return get("/dpg/aicctv/avghour/datas", date=date or yesterday())


# --- INT_S03_019 --------------------------------------------------------------


def weather(date: str | None = None) -> dict:
    """주요 기상 요소. 요청일의 전일(`beforeDay`)과 당일(`nowDay`)이 함께 온다.

    각 묶음에 `temp`(기온 ℃), `winsp`(풍속), `windir`(풍향), `logDateTime`.
    파고·조위는 E-UM 에 없다. 필요하면 기상청 해양기상부이나 국립해양조사원으로 보충한다.
    """
    data = get("/dpg/ship-safe/stats/history", date=date or yesterday())
    return data if isinstance(data, dict) else {}


def snapshot() -> dict:
    """지금 방파제 상황을 한 번에 모은다. 위험 판단·방송 문안 생성의 입력이 된다."""
    devices = pedestrian_devices()
    uv_devices = devices.get("uv_devices") or []

    uv: dict = {}
    if uv_devices:
        try:
            uv = uv_index(uv_devices[0].get("id", 1))
        except EumError as e:
            uv = {"error": str(e)}

    out: dict = {"devices": devices, "uv": uv}
    for name, fn in (("weather", weather), ("abnormal", abnormal_events)):
        try:
            out[name] = fn()
        except EumError as e:
            out[name] = {"error": str(e)}
    return out


def main() -> int:
    try:
        snap = snapshot()
    except EumError as e:
        print(f"실패: {e}", file=sys.stderr)
        return 1

    devices = snap["devices"]
    print("구룡포 방파제 안내방송 — 상황 스냅샷")
    print()
    for key, label in (("uv_devices", "자외선 측정기"), ("speakers", "스피커"), ("ai_cctvs", "AI CCTV")):
        items = devices.get(key) or []
        print(f"  {label:<12} {len(items)}대")
        for it in items:
            print(f"      - {it.get('name')}  ({it.get('latitude')}, {it.get('longitude')})  {it.get('address') or ''}")
    print()
    print(f"  자외선   {json.dumps(snap['uv'], ensure_ascii=False)}")
    print(f"  기상     {json.dumps(snap['weather'], ensure_ascii=False)[:200]}")
    print(f"  이상행동 {json.dumps(snap['abnormal'], ensure_ascii=False)[:200]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
