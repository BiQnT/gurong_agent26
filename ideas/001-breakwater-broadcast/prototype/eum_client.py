#!/usr/bin/env python3
"""E-UM 디지털트윈 포항 Open API 클라이언트.

이 아이디어가 쓰는 API 4개를 감싼다. 서비스키는 **레포 루트의 `.env`** 하나가
정본이다 (`EUM_SERVICE_KEY`). 아이디어 폴더에 `.env` 를 따로 만들지 않는다.

| API ID | 기능 | 함수 | 판정 |
| --- | --- | --- | --- |
| `INT_S06_001` | 보행자안전 장비 목록 (자외선기·스피커·AI CCTV) | `pedestrian_devices()` | 사용 |
| `INT_S06_005` | 자외선 측정 장비 실시간 | `uv_index(device_id)` | 사용 |
| `INT_S01_004` | 대기환경 실시간 (기온·습도·풍속·풍향) | `air_realtime(device_id)` | 사용 |
| `INT_S06_006` | 시간대별 이상행동 발생수 통계 | `abnormal_events()` | **제외** |
| `INT_S03_019` | 주요 기상 요소 과거 정보 | `weather_history(date)` | 보류 |

실호출 검증 결과는 `../data.md`. 요약하면 이상행동 검출(`INT_S06_006`)은 10개월치가
전부 0이라 트리거로 쓸 수 없고, 기상 이력(`INT_S03_019`)은 날짜별 구멍이 많아
실시간 대기환경(`INT_S01_004`)으로 대체했다.

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
    # serviceKey 는 발급 시점에 이미 URL 인코딩된 문자열이다. urlencode 에 넣으면
    # 퍼센트 기호가 한 번 더 인코딩돼 401 "유효하지 않은 이용자 서비스 키"가 난다.
    # 키는 원문 그대로 붙이고, 나머지 파라미터만 인코딩한다.
    rest = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    url = f"{BASE}{path}?serviceKey={load_key()}" + (f"&{rest}" if rest else "")
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


def abnormal_events() -> object:
    """AI CCTV 가 검출한 이상행동 발생수. **트리거로 쓰지 않는다.**

    필드는 방파제 안전에 정확히 맞는다 — `warningFallDetectionCount`(추락),
    `warningInsideDetectionCount`(구역 내부 진입), `warningApproachCount`(접근),
    `normalFallDetectionCount`. 남/북 방파제가 `south`/`north` 로 나뉜다.

    그런데 값이 없다. 최근 60일 전수 + 2025-10~2026-07 월별 표본을 조회한 결과
    **총 검출 0건**이고, `date` 파라미터는 무시된 채 항상 호출 시점 기준 최근
    10시간이 돌아온다. 검출 기능이 가동되지 않는 것으로 보인다 (`../data.md`).

    주최 측 답변으로 가동이 확인되면 그때 트리거로 복귀시킨다. 그 전까지는
    현황 표시용으로만 호출한다. `date` 인자는 서버가 무시하므로 받지 않는다.
    """
    return get("/dpg/aicctv/avghour/datas", date=yesterday())


# --- INT_S01_004 --------------------------------------------------------------


def air_realtime(device_id: int | str = 1) -> dict:
    """대기환경 실시간. **기상 소스는 여기다.**

    이름은 '대기환경'인데 `temp`(기온 ℃), `humi`(습도 %), `winsp`(풍속),
    `windir`(풍향)가 다 들어 있다. 오염물질(`pm10`, `h2s`, `ou` 등)도 함께 온다.

    카탈로그의 단위 표기에 오류가 있다 — `winsp` 가 "℃", `windir` 가 "%" 로
    적혀 있으나 실제로는 각각 m/s 와 도(°)로 보인다.
    """
    data = get("/dpg/atmosphere/device/realtime", id=device_id)
    return data if isinstance(data, dict) else {}


# --- INT_S03_019 --------------------------------------------------------------


def weather_history(date: str | None = None) -> dict:
    """주요 기상 요소 과거. **날짜별로 구멍이 많다. 실시간은 `air_realtime()` 을 쓸 것.**

    데이터가 없는 날은 형식 검증을 통과한 뒤 500 (`String cannot be cast to Date`)
    으로 터진다. 2026년 최근 날짜는 대부분 실패한다. `windir` 가 1015.0 처럼
    기압에 가까운 값으로 와서 필드 매핑도 의심스럽다 (`../data.md`).
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
    for name, fn in (("air", air_realtime), ("abnormal", abnormal_events)):
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
    air = snap["air"]
    if "error" in air:
        print(f"  기상     실패: {air['error'][:120]}")
    else:
        print(
            f"  기상     {air.get('logDateTime')} · 기온 {air.get('temp')}℃ · "
            f"습도 {air.get('humi')}% · 풍속 {air.get('winsp')} · 풍향 {air.get('windir')}"
        )
    print(f"  자외선   {json.dumps(snap['uv'], ensure_ascii=False)}")

    # 이상행동은 트리거에서 제외했지만, 값이 살아나면 바로 알 수 있게 합계만 찍는다.
    ab = snap["abnormal"]
    if isinstance(ab, dict) and "error" not in ab:
        total = sum(
            v
            for rows in ab.values()
            if isinstance(rows, list)
            for row in rows
            for k, v in row.items()
            if k != "hour" and isinstance(v, (int, float))
        )
        zones = ", ".join(f"{z} {len(r)}행" for z, r in ab.items() if isinstance(r, list))
        note = "  ← 검출 미가동으로 보임 (data.md 참고)" if total == 0 else "  ← 값이 살아났다!"
        print(f"  이상행동 {zones} · 검출 합계 {total}건{note}")
    else:
        print(f"  이상행동 {json.dumps(ab, ensure_ascii=False)[:120]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
