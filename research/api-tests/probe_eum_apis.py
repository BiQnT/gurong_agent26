#!/usr/bin/env python3
"""E-UM Open API 를 전부 실제로 호출해보고 무엇이 살아 있는지 판정한다.

아이디어를 확정하기 전에 '호출되는 API'를 먼저 확보하기 위한 도구다.
카탈로그(docs/api-catalog/)는 E-UM이 문서에 적어둔 스펙일 뿐이고, 실제로
응답이 오는지 · 장비가 몇 대나 붙어 있는지는 불러봐야 안다.

사용법:
    EUM_SERVICE_KEY=... python3 research/api-tests/probe_eum_apis.py
    (또는 .env 에 EUM_SERVICE_KEY 를 넣어두면 알아서 읽는다)

생성물:
    research/api-tests/raw/<API_ID>.json   각 API 원본 응답 (커밋해서 기획서에 인용)
    research/api-tests/probe-summary.md    판정표 — 어느 API가 살아 있나
    data/eum-devices.geojson               모든 장비 위경도를 합친 지도 데이터

geojson.io 에 data/eum-devices.geojson 을 끌어다 놓으면 구룡포에 어떤 센서가
어디에 몇 대 박혀 있는지 한 장으로 보인다. 어떤 아이디어가 가능한지는 대개
그 지도를 보면 결정된다.
"""

from __future__ import annotations

import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

BASE = "https://genix.pohang-eum.kr"
ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "research" / "api-tests" / "raw"
SUMMARY = ROOT / "research" / "api-tests" / "probe-summary.md"
GEOJSON = ROOT / "data" / "eum-devices.geojson"

TIMEOUT = 20
SLEEP = 0.3  # 서버 배려. 40개 * 0.3초 = 12초면 끝난다.

# 어제 날짜를 기본으로 쓴다. 당일 데이터는 아직 안 쌓였을 수 있다.
YESTERDAY = (date.today() - timedelta(days=1)).strftime("%Y%m%d")

# (API ID, 서비스, 기능, 경로, 추가 파라미터 후보들)
#
# 추가 파라미터가 여러 개면 성공할 때까지 순서대로 시도한다. 카탈로그가
# '필수'라고 적어둔 것과 실제 동작이 다른 경우가 흔해서, 빈 후보({})를
# 먼저 넣어 파라미터 없이도 되는지부터 본다.
NO_ARG = [{}]
# 장비 id 는 1부터 시작하지 않는다. 실측상 2,3,4,5,7 등이 쓰인다.
BY_ID = [{}, {"id": "1"}, {"id": "2"}]
BY_DATE = [{}, {"date": YESTERDAY}]

# 아래 다섯은 1차 실행에서 400 이 났다. 에러 메시지가 필요한 파라미터를 하나씩
# 알려줘서 그대로 따라간 결과다. **엔드포인트마다 날짜 형식이 다르다** —
# stats/history 계열은 yyyyMMdd, stats/hour 계열은 yyyy-MM-dd 를 받는다.
TWO_DAYS_AGO = (date.today() - timedelta(days=2)).strftime("%Y%m%d")
ISO_YESTERDAY = (date.today() - timedelta(days=1)).strftime("%Y-%m-%d")

# startDate 와 endDate 는 "정확히 하루 차이"만 허용된다 (서버 제약).
BY_RANGE = [{"startDate": TWO_DAYS_AGO, "endDate": YESTERDAY}]
BY_TYPE_AIR = [{"type": "pm10", "date": ISO_YESTERDAY}]
BY_TYPE_SEA = [{"type": "doxygen", "date": ISO_YESTERDAY}]
# 선박 밀집도는 날짜(yyyyMMdd) + 시각(HHmm) 을 시작·종료 모두 요구한다.
BY_GRID = [{"startDate": YESTERDAY, "startTime": "0900", "endDate": YESTERDAY, "endTime": "1000"}]

PROBES = [
    # --- 01 대기환경 ---
    # 001~003 은 E-UM 자료실에 미등록이고 genix 에서 직접 확인된 API 다
    # (research/api-tests/2026-08-04-atmosphere-undocumented-apis.md).
    ("INT_S01_001", "대기환경", "측정 장비 목록_전체", "/dpg/atmosphere/devices", NO_ARG),
    ("INT_S01_002", "대기환경", "측정 장비 목록_단일", "/dpg/atmosphere/device", BY_ID),
    ("INT_S01_003", "대기환경", "측정 장비 실시간_전체", "/dpg/atmosphere/devices/realtime", NO_ARG),
    ("INT_S01_004", "대기환경", "측정 장비 실시간_단일", "/dpg/atmosphere/device/realtime", BY_ID),
    ("INT_S01_011", "대기환경", "유해물질 통계", "/dpg/atmosphere/sensor/stats/history", BY_RANGE),
    ("INT_S01_012", "대기환경", "유해물질 시간별 통계", "/dpg/atmosphere/sensor/stats/hour", BY_TYPE_AIR),
    # --- 02 해양환경 ---
    ("INT_S02_001", "해양환경", "측정 장비 목록_전체", "/dpg/marine/devices", NO_ARG),
    ("INT_S02_002", "해양환경", "측정 장비 목록_단일", "/dpg/marine/device", BY_ID),
    ("INT_S02_003", "해양환경", "실시간 수집_전체", "/dpg/marine/devices/realtime", NO_ARG),
    ("INT_S02_004", "해양환경", "실시간 수집_단일", "/dpg/marine/device/realtime", BY_ID),
    ("INT_S02_011", "해양환경", "유해물질 통계", "/dpg/marine/sensor/stats/history", BY_TYPE_SEA),
    ("INT_S02_012", "해양환경", "유해물질 시간별 통계", "/dpg/marine/sensor/stats/hour", BY_TYPE_SEA),
    # --- 03 선박안전 ---
    ("INT_S03_001", "선박안전", "선박 기본정보_전체", "/dpg/ship/devices", NO_ARG),
    ("INT_S03_002", "선박안전", "선박 기본정보_단일", "/dpg/ship/device", BY_ID),
    ("INT_S03_003", "선박안전", "CCTV 기본정보_전체", "/dpg/cctv/devices", NO_ARG),
    ("INT_S03_004", "선박안전", "CCTV 기본정보_단일", "/dpg/cctv/device", BY_ID),
    ("INT_S03_005", "선박안전", "LiDAR 기본정보_전체", "/dpg/lidar/devices", NO_ARG),
    ("INT_S03_006", "선박안전", "LiDAR 기본정보_단일", "/dpg/lidar/device", BY_ID),
    ("INT_S03_007", "선박안전", "선박 실시간 위치_전체", "/dpg/ship/devices/realtime", NO_ARG),
    ("INT_S03_008", "선박안전", "선박 실시간 위치_단일", "/dpg/ship/device/realtime", BY_ID),
    ("INT_S03_019", "선박안전", "주요 기상 요소 과거", "/dpg/ship-safe/stats/history", BY_DATE),
    ("INT_S03_020", "선박안전", "해역 선박 밀집도", "/dpg/ship-safe/traffic", BY_GRID),
    # --- 04 선박탄소 ---
    ("INT_S04_004", "선박탄소", "탄소 배출량 통계", "/dpg/dashboard/old-ship/stats", BY_DATE),
    ("INT_S04_005", "선박탄소", "톤수별 당일 배출량", "/dpg/old-ship/day/ton/emission", BY_DATE),
    ("INT_S04_006", "선박탄소", "시간별 배출량", "/dpg/old-ship/hour/co-emission", BY_DATE),
    ("INT_S04_007", "선박탄소", "톤수별 배출·중립 순위", "/dpg/old-ship/size/history", BY_DATE),
    # --- 05 침수예측 ---
    ("INT_S05_001", "침수예측", "전체 수위계 장비 목록", "/dpg/water/devices", NO_ARG),
    ("INT_S05_002", "침수예측", "지표면 수위계", "/dpg/water/roadDevices", BY_ID),
    ("INT_S05_003", "침수예측", "맨홀 장비", "/dpg/water/holeDevices", BY_ID),
    ("INT_S05_004", "침수예측", "하천 수위계", "/dpg/water/riverDevices", BY_ID),
    ("INT_S05_005", "침수예측", "강우량계", "/dpg/water/rainDevices", BY_ID),
    ("INT_S05_006", "침수예측", "전체 수위계 실시간", "/dpg/sensor/latest/sensorLevel", BY_ID),
    # --- 06 보행자안전 ---
    ("INT_S06_001", "보행자안전", "장비 목록 (자외선·스피커·AI CCTV)", "/dpg/pedestrian/device/list", NO_ARG),
    ("INT_S06_002", "보행자안전", "자외선 측정 장비", "/dpg/uv/devices", BY_ID),
    ("INT_S06_003", "보행자안전", "스피커 장비", "/dpg/speaker/devices", BY_ID),
    ("INT_S06_004", "보행자안전", "AI CCTV", "/dpg/ai-cctv/devices", BY_ID),
    ("INT_S06_005", "보행자안전", "자외선 실시간", "/dpg/sensor/latest/uvIndex", BY_ID),
    ("INT_S06_006", "보행자안전", "시간대별 이상행동 발생수", "/dpg/aicctv/avghour/datas", BY_DATE),
    # --- 07 수산물유통 ---
    ("INT_S07_001", "수산물유통", "교통감시 장비 목록", "/dpg/transp/devices/list", NO_ARG),
    ("INT_S07_002", "수산물유통", "교통감시 장비_단일", "/dpg/transp/device", BY_ID),
    ("INT_S07_003", "수산물유통", "수산물 위탁판매장", "/dpg/auctionPlace/Info", NO_ARG),
    ("INT_S07_004", "수산물유통", "시간대별/차종별 교통량", "/dpg/statistics/trafficDatasPerHour", BY_DATE),
    ("INT_S07_005", "수산물유통", "시간대별 교통 혼잡율", "/dpg/traffic/congestion", BY_DATE),
]


# 키를 찾아볼 곳. 팀원마다 키를 어디 두는지 달라서 여러 곳을 훑는다.
# 루트 .env 만 보게 했더니 "아이디어 폴더에만 키를 넣은" 사람이 전부 실패했다.
ENV_CANDIDATES = [
    ROOT / ".env",
    ROOT / ".env.local",
    *sorted(ROOT.glob("ideas/*/prototype/.env")),
    *sorted(ROOT.glob("ideas/*/prototype/*/.env")),
]


def load_key() -> str:
    key = os.environ.get("EUM_SERVICE_KEY", "").strip()
    if key:
        return key
    for env in ENV_CANDIDATES:
        if not env.exists():
            continue
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("EUM_SERVICE_KEY="):
                value = line.split("=", 1)[1].strip().strip("\"'")
                if value:
                    print(f"키를 {env.relative_to(ROOT)} 에서 읽었다.")
                    return value
    sys.exit(
        "EUM_SERVICE_KEY 를 못 찾았다. 아래 중 한 곳에 넣거나 환경변수로 넘길 것:\n"
        + "\n".join(f"  {p.relative_to(ROOT)}" for p in ENV_CANDIDATES[:2])
        + "\n  ideas/<아이디어>/prototype/.env\n"
        "  발급: https://pohang-eum.kr/data 로그인 → API 자료실 → 활용 신청"
    )


def call(path: str, params: dict, key: str) -> tuple[int, object]:
    """(HTTP 상태, 파싱된 JSON 또는 원문). 예외는 상태 0 으로 돌려준다."""
    # serviceKey 는 발급 시점에 이미 URL 인코딩된 문자열이다. urlencode 에 넣으면
    # 퍼센트 기호가 한 번 더 인코딩돼 401 "유효하지 않은 이용자 서비스 키"가 난다.
    # 키는 원문 그대로 붙이고 나머지 파라미터만 인코딩한다.
    rest = urllib.parse.urlencode(params)
    url = f"{BASE}{path}?serviceKey={key}" + (f"&{rest}" if rest else "")
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    # E-UM 서버 인증서 체인이 불완전한 경우가 있어 검증 실패 시 한 번 더 시도한다.
    for ctx in (None, ssl._create_unverified_context()):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as res:
                body = res.read().decode("utf-8", "replace")
                try:
                    return res.status, json.loads(body)
                except json.JSONDecodeError:
                    return res.status, body[:2000]
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            try:
                return e.code, json.loads(body)
            except json.JSONDecodeError:
                return e.code, body[:2000]
        except ssl.SSLError:
            continue  # 인증서 문제 → 검증 끄고 재시도
        except Exception as e:  # noqa: BLE001 — 어떤 이유로 죽었는지 기록만 하면 된다
            return 0, f"{type(e).__name__}: {e}"
    return 0, "SSLError: 검증 여부와 무관하게 실패"


def is_success(payload: object) -> bool:
    """E-UM 응답이 성공인가.

    대부분은 공통 껍데기 `{id, status, data}` 로 오지만, 일부(`INT_S01_011` 등)는
    껍데기 없이 값을 바로 돌려준다. 그래서 status 가 아예 없는 dict/list 도
    성공으로 본다 — 에러는 항상 `status` 나 문자열 메시지로 오기 때문이다.
    """
    if isinstance(payload, dict):
        if "status" in payload:
            return payload["status"] == "success"
        return bool(payload)  # 껍데기 없는 직접 응답
    return isinstance(payload, list) and bool(payload)


def count_items(payload: object) -> int:
    """응답 안에서 '몇 건이 왔나'를 가늠한다. data 아래 가장 큰 리스트 길이."""
    best = 0
    stack = [payload]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            best = max(best, len(node))
            stack.extend(node)
        elif isinstance(node, dict):
            stack.extend(node.values())
    return best


def collect_points(payload: object, api_id: str, service: str) -> list[dict]:
    """응답 어디에 있든 latitude/longitude 를 가진 객체를 전부 GeoJSON 피처로."""
    features: list[dict] = []
    stack = [payload]
    while stack:
        node = stack.pop()
        if isinstance(node, list):
            stack.extend(node)
        elif isinstance(node, dict):
            lat, lon = node.get("latitude"), node.get("longitude")
            if lat is not None and lon is not None:
                try:
                    coords = [float(lon), float(lat)]
                except (TypeError, ValueError):
                    coords = None
                if coords:
                    features.append(
                        {
                            "type": "Feature",
                            "geometry": {"type": "Point", "coordinates": coords},
                            "properties": {
                                "api_id": api_id,
                                "service": service,
                                "name": node.get("name"),
                                "address": node.get("address"),
                                "device_id": node.get("id"),
                                "sensor_type": node.get("sensorType"),
                            },
                        }
                    )
            stack.extend(node.values())
    return features


def main() -> None:
    key = load_key()
    RAW.mkdir(parents=True, exist_ok=True)
    GEOJSON.parent.mkdir(parents=True, exist_ok=True)

    rows: list[dict] = []
    features: list[dict] = []

    for api_id, service, name, path, variants in PROBES:
        result = None
        for params in variants:
            status, payload = call(path, params, key)
            time.sleep(SLEEP)
            result = (params, status, payload)
            if is_success(payload):
                break

        params, status, payload = result
        ok = is_success(payload)
        n = count_items(payload) if ok else 0

        (RAW / f"{api_id}.json").write_text(
            json.dumps(
                {
                    "api_id": api_id,
                    "service": service,
                    "name": name,
                    "url": f"{BASE}{path}",
                    "params": {"serviceKey": "<REDACTED>", **params},
                    "http_status": status,
                    "response": payload,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        if ok:
            features.extend(collect_points(payload, api_id, service))

        note = ""
        if not ok:
            if isinstance(payload, dict):
                note = str(payload.get("message") or payload.get("status") or "")[:60]
            else:
                note = str(payload)[:60]

        rows.append(
            {
                "api_id": api_id,
                "service": service,
                "name": name,
                "path": path,
                "params": ", ".join(f"{k}={v}" for k, v in params.items()) or "—",
                "status": status,
                "ok": ok,
                "count": n,
                "note": note.replace("\n", " "),
            }
        )
        mark = "OK " if ok else "FAIL"
        print(f"[{mark}] {api_id} {service}/{name}  http={status} items={n} {note}")

    GEOJSON.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    alive = sum(1 for r in rows if r["ok"])
    lines = [
        "# E-UM API 실호출 판정표",
        "",
        f"`research/api-tests/probe_eum_apis.py` 자동 생성 · 실행일 {date.today()}",
        "",
        f"**{alive}/{len(rows)} 개 API 응답 성공** · 장비 좌표 {len(features)}개 수집",
        "",
        "원본 응답은 `research/api-tests/raw/<API_ID>.json`.",
        "장비 위치는 `data/eum-devices.geojson` — geojson.io 에 끌어다 놓으면 지도로 보인다.",
        "",
        "| API ID | 서비스 | 기능 | 파라미터 | HTTP | 판정 | 건수 | 비고 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in rows:
        lines.append(
            f"| `{r['api_id']}` | {r['service']} | {r['name']} | {r['params']} | "
            f"{r['status']} | {'O' if r['ok'] else 'X'} | {r['count'] or '—'} | {r['note']} |"
        )
    lines += [
        "",
        "## 읽는 법",
        "",
        "- **판정 O + 건수 0** — 응답은 오는데 데이터가 비었다. 장비 미설치이거나 아직 수집 전이다.",
        "  아이디어의 근거로 쓰기 전에 반드시 확인할 것.",
        "- **판정 X** — 파라미터가 더 필요하거나 권한 밖이다. `raw/<API_ID>.json` 의 응답을 보고",
        "  카탈로그 스펙과 대조한다.",
        "- 건수는 응답 안에서 가장 긴 리스트의 길이다. 정확한 장비 수는 원본 JSON 으로 확인할 것.",
    ]
    SUMMARY.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print()
    print(f"응답 성공 {alive}/{len(rows)} · 장비 좌표 {len(features)}개")
    print(f"  판정표  {SUMMARY.relative_to(ROOT)}")
    print(f"  원본    {RAW.relative_to(ROOT)}/<API_ID>.json")
    print(f"  지도    {GEOJSON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
