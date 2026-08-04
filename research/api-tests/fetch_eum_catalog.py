#!/usr/bin/env python3
"""E-UM 디지털트윈 포항 Open API 카탈로그 수집기.

https://pohang-eum.kr/data (API 자료실)의 내부 API를 호출해 전체 목록과
각 API의 요청·응답 스펙을 긁어와 docs/api-catalog/ 아래 마크다운과
data/eum-api-catalog.json 을 생성한다.

사용법:
    python3 research/api-tests/fetch_eum_catalog.py

카탈로그가 갱신되면(E-UM은 3차년도 서비스를 계속 추가 중) 다시 실행해서
diff 를 보면 무엇이 늘었는지 바로 알 수 있다.
"""

from __future__ import annotations

import json
import re
import time
import urllib.request
from pathlib import Path

BASE = "https://pohang-eum.kr/netro"
ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs" / "api-catalog"
DATA = ROOT / "data"

# typeId -> (파일 순번, 짧은 이름). E-UM의 typeId는 순서대로가 아니라서 고정 매핑한다.
TYPE_ORDER = {
    1: (1, "대기환경"),
    2: (2, "해양환경"),
    3: (3, "선박안전"),
    4: (4, "선박탄소"),
    7: (5, "침수예측"),
    8: (6, "보행자안전"),
    9: (7, "수산물유통"),
}

# E-UM의 "API 자료실" 메타데이터 시스템(/netro/api/*)에 등록이 안 돼 있어서
# 이 스크립트로는 자동 수집이 안 되지만, genix.pohang-eum.kr 서버에는 실제로
# 살아있고 정상 동작하는 것을 직접 확인한 API. 해양환경(marine) 서비스가 쓰는
# 목록_전체/목록_단일/실시간_전체/실시간_단일 4종 패턴 중 대기환경은 실시간_단일
# (INT_S01_004)만 등록돼 있고 나머지 3개가 누락돼 있었다.
#
# 확인 기록: research/api-tests/2026-08-04-atmosphere-undocumented-apis.md
# apiId는 E-UM이 같은 역할에 실제로 쓰는 번호 규칙(marine 001~004)을 그대로
# 따랐을 뿐, E-UM이 공식 발급한 ID가 아니다 — 문서에 그 사실을 명시한다.
MANUAL_SUPPLEMENT: dict[int, list[dict]] = {
    1: [
        {
            "apiId": "INT_S01_001",
            "serviceName": "대기환경 측정 장비 기본 정보 목록_전체 (⚠ E-UM 자료실 미등록, genix 직접 확인)",
            "description": (
                "구룡포 내 설치된 대기환경 측정 장비의 정보 목록을 조회할 수 있습니다. "
                "장비명, 설치 위치의 위경도, 주소 정보를 제공합니다. "
                "E-UM API 자료실 메타데이터에는 등록돼 있지 않지만 genix.pohang-eum.kr 서버에서 "
                "2026-08-04에 실제 호출 성공을 확인했다(구룡포~호미곶 24개 장비 응답)."
            ),
            "method": "GET",
            "url": "https://genix.pohang-eum.kr/dpg/atmosphere/devices",
            "apiType": "REST API",
            "updateAt": "2026-08-04",
            "requestItems": [
                {
                    "itemNameEn": "serviceKey",
                    "itemNameKo": "서비스키",
                    "itemRequired": "Y",
                    "sampleData": "yqfuaX1YKzxki2YCEvIgG...",
                    "itemDescription": "API 활용 시 필요한 서비스 인증키",
                },
            ],
            "responseItems": [
                {"itemNameEn": "id", "itemNameKo": "응답상태 고유번호", "sampleData": "1", "itemDescription": "응답 상태 고유번호"},
                {"itemNameEn": "status", "itemNameKo": "응답상태", "sampleData": "success", "itemDescription": "응답상태"},
                {"itemNameEn": "data", "itemNameKo": "응답값 배열", "sampleData": "", "itemDescription": "응답값 배열"},
                {"itemNameEn": "id", "itemNameKo": "장비 고유번호", "sampleData": "1", "itemDescription": "장비 고유번호"},
                {"itemNameEn": "name", "itemNameKo": "장비명", "sampleData": "유해물질 측정기 외1", "itemDescription": "장비명칭"},
                {"itemNameEn": "latitude", "itemNameKo": "위도", "sampleData": "35.980946", "itemDescription": "장비위치(위도)"},
                {"itemNameEn": "longitude", "itemNameKo": "경도", "sampleData": "129.540324", "itemDescription": "장비위치(경도)"},
                {"itemNameEn": "address", "itemNameKo": "주소", "sampleData": "포항시 남구 구룡포읍 병포리 469-52", "itemDescription": "장비 상세 위치 주소"},
                {"itemNameEn": "firm", "itemNameKo": "펌웨어 버전", "sampleData": "1.0.0", "itemDescription": "장비 펌웨어 버전"},
                {"itemNameEn": "nickname", "itemNameKo": "장비 별칭", "sampleData": "구룡포행정복지센터 남서측", "itemDescription": "장비 설치 위치 별칭"},
            ],
        },
        {
            "apiId": "INT_S01_002",
            "serviceName": "대기환경 측정 장비 기본 정보 목록_단일 (⚠ E-UM 자료실 미등록, genix 직접 확인)",
            "description": (
                "구룡포 내 설치된 대기환경 측정 장비 중 사용자가 지정한 장비의 정보를 조회할 수 있습니다. "
                "장비명, 설치 위치의 위경도, 주소 정보를 제공합니다. "
                "E-UM API 자료실 메타데이터에는 등록돼 있지 않지만 genix.pohang-eum.kr 서버에서 "
                "2026-08-04에 실제 호출 성공을 확인했다."
            ),
            "method": "GET",
            "url": "https://genix.pohang-eum.kr/dpg/atmosphere/device",
            "apiType": "REST API",
            "updateAt": "2026-08-04",
            "requestItems": [
                {
                    "itemNameEn": "serviceKey",
                    "itemNameKo": "서비스키",
                    "itemRequired": "Y",
                    "sampleData": "yqfuaX1YKzxki2YCEvIgG...",
                    "itemDescription": "API 활용 시 필요한 서비스 인증키",
                },
                {
                    "itemNameEn": "id",
                    "itemNameKo": "장비 고유번호",
                    "itemRequired": "Y",
                    "sampleData": "1",
                    "itemDescription": "장비 고유번호",
                },
            ],
            "responseItems": [
                {"itemNameEn": "id", "itemNameKo": "응답상태 고유번호", "sampleData": "1", "itemDescription": "응답 상태 고유번호"},
                {"itemNameEn": "status", "itemNameKo": "응답상태", "sampleData": "success", "itemDescription": "응답상태"},
                {"itemNameEn": "data", "itemNameKo": "응답값 객체", "sampleData": "", "itemDescription": "응답값 객체"},
                {"itemNameEn": "id", "itemNameKo": "장비 고유번호", "sampleData": "1", "itemDescription": "장비 고유번호"},
                {"itemNameEn": "name", "itemNameKo": "장비명", "sampleData": "유해물질 측정기 외1", "itemDescription": "장비명칭"},
                {"itemNameEn": "latitude", "itemNameKo": "위도", "sampleData": "35.980946", "itemDescription": "장비위치(위도)"},
                {"itemNameEn": "longitude", "itemNameKo": "경도", "sampleData": "129.540324", "itemDescription": "장비위치(경도)"},
                {"itemNameEn": "address", "itemNameKo": "주소", "sampleData": "포항시 남구 구룡포읍 병포리 469-52", "itemDescription": "장비 상세 위치 주소"},
                {"itemNameEn": "firm", "itemNameKo": "펌웨어 버전", "sampleData": "1.0.0", "itemDescription": "장비 펌웨어 버전"},
                {"itemNameEn": "poleId", "itemNameKo": "전주 고유번호", "sampleData": "1", "itemDescription": "장비가 설치된 전주 고유번호"},
                {"itemNameEn": "nickname", "itemNameKo": "장비 별칭", "sampleData": "구룡포행정복지센터 남서측", "itemDescription": "장비 설치 위치 별칭"},
            ],
        },
        {
            "apiId": "INT_S01_003",
            "serviceName": "대기환경 측정 장비 실시간 수집 정보_전체 (⚠ E-UM 자료실 미등록, genix 직접 확인)",
            "description": (
                "구룡포 내 설치된 대기환경 측정 장비 전체에서 가장 최근에 수집된 데이터를 조회할 수 있습니다. "
                "미세먼지, 초미세먼지, 이산화황, 이산화질소, 오존, 일산화탄소, VOC, 황화수소, 암모니아, "
                "복합악취, 포름알데하이드, 이산화탄소, 온도, 습도, 풍속, 풍향, 배터리 전압 등의 데이터를 제공합니다. "
                "E-UM API 자료실 메타데이터에는 등록돼 있지 않지만 genix.pohang-eum.kr 서버에서 "
                "2026-08-04에 실제 호출 성공을 확인했다(24개 장비 응답)."
            ),
            "method": "GET",
            "url": "https://genix.pohang-eum.kr/dpg/atmosphere/devices/realtime",
            "apiType": "REST API",
            "updateAt": "2026-08-04",
            "requestItems": [
                {
                    "itemNameEn": "serviceKey",
                    "itemNameKo": "서비스키",
                    "itemRequired": "Y",
                    "sampleData": "yqfuaX1YKzxki2YCEvIgG...",
                    "itemDescription": "API 활용 시 필요한 서비스 인증키",
                },
            ],
            "responseItems": [
                {"itemNameEn": "id", "itemNameKo": "응답상태 고유번호", "sampleData": "1", "itemDescription": "응답 상태 고유번호"},
                {"itemNameEn": "status", "itemNameKo": "응답상태", "sampleData": "success", "itemDescription": "응답상태"},
                {"itemNameEn": "data", "itemNameKo": "응답값 배열", "sampleData": "", "itemDescription": "응답값 배열"},
                {"itemNameEn": "logDateTime", "itemNameKo": "데이터 수집 시각", "sampleData": "2026-08-03 20:01:14", "itemDescription": "데이터 수집 시각"},
                {"itemNameEn": "devId", "itemNameKo": "장비 고유번호", "sampleData": "1", "itemDescription": "장비 고유번호"},
                {"itemNameEn": "pm10", "itemNameKo": "미세먼지", "sampleData": "19.3", "itemDescription": "미세먼지(단위 : PPM, 실측상 ㎍/㎥ 관례 가능성 있어 재검증 필요)"},
                {"itemNameEn": "pm25", "itemNameKo": "초미세먼지", "sampleData": "13.0", "itemDescription": "초미세먼지(단위 : PPM, 실측상 ㎍/㎥ 관례 가능성 있어 재검증 필요)"},
                {"itemNameEn": "so2", "itemNameKo": "이산화황", "sampleData": "0.051", "itemDescription": "이산화황(단위 : PPM)"},
                {"itemNameEn": "no2", "itemNameKo": "이산화질소", "sampleData": "0.001", "itemDescription": "이산화질소(단위 : PPM)"},
                {"itemNameEn": "o3", "itemNameKo": "오존", "sampleData": "0.025", "itemDescription": "오존(단위 : PPM)"},
                {"itemNameEn": "co", "itemNameKo": "일산화탄소", "sampleData": "0.388", "itemDescription": "일산화탄소(단위 : PPM)"},
                {"itemNameEn": "voc", "itemNameKo": "VOC", "sampleData": "0.079", "itemDescription": "VOC(단위 : PPM)"},
                {"itemNameEn": "h2s", "itemNameKo": "황화수소", "sampleData": "0.002", "itemDescription": "황화수소(단위 : PPM)"},
                {"itemNameEn": "nh3", "itemNameKo": "암모니아", "sampleData": "0.001", "itemDescription": "암모니아(단위 : PPM)"},
                {"itemNameEn": "ou", "itemNameKo": "복합악취", "sampleData": "6.0", "itemDescription": "복합악취(단위 : PPM)"},
                {"itemNameEn": "hcho", "itemNameKo": "포름알데하이드", "sampleData": "0.006", "itemDescription": "포름알데하이드(단위 : PPM)"},
                {"itemNameEn": "co2", "itemNameKo": "이산화탄소", "sampleData": "0.0486", "itemDescription": "이산화탄소(단위 : PPM)"},
                {"itemNameEn": "temp", "itemNameKo": "온도", "sampleData": "24.5", "itemDescription": "온도(단위 : ℃)"},
                {"itemNameEn": "humi", "itemNameKo": "습도", "sampleData": "83.2", "itemDescription": "습도(단위 : %)"},
                {"itemNameEn": "winsp", "itemNameKo": "풍속", "sampleData": "0.17", "itemDescription": "풍속(단위 : m/s)"},
                {"itemNameEn": "windir", "itemNameKo": "풍향", "sampleData": "286.9", "itemDescription": "풍향(단위 : °)"},
                {"itemNameEn": "batt", "itemNameKo": "배터리 전압", "sampleData": "12.4", "itemDescription": "배터리 전압(단위 : V)"},
            ],
        },
    ],
}


def get(path: str) -> dict:
    req = urllib.request.Request(BASE + path, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def clean(text: str | None) -> str:
    """설명 필드에 <br/> 등 HTML이 섞여 있어 마크다운 표에 넣기 전에 정리한다."""
    if not text:
        return ""
    text = re.sub(r"<br\s*/?>", " ", text)
    text = re.sub(r"<[^>]+>", "", text)
    return text.replace("|", "\\|").strip()


def fetch() -> dict:
    types = get("/api")["data"]
    catalog = {}
    for t in types:
        tid = t["typeId"]
        listing = get(f"/api/list?type={tid}")["data"]
        apis = []
        for item in listing.get("list", []):
            detail = get(f"/api/detail?apiId={item['id']}")
            if detail.get("status") != "success":
                print(f"  ! {item['id']} 상세 조회 실패: {detail.get('data')}")
                continue
            apis.append(detail["data"])
            time.sleep(0.15)
        supplement = MANUAL_SUPPLEMENT.get(tid, [])
        apis = supplement + apis
        catalog[str(tid)] = {
            "typeId": tid,
            "serviceTitle": t["serviceTitle"],
            "serviceName": t["serviceName"],
            "description": t["description"],
            "apis": apis,
        }
        extra = f" (+수동 {len(supplement)}개)" if supplement else ""
        print(f"  {tid} {t['serviceTitle']}: {len(apis)}개{extra}")
    return catalog


def render_api(a: dict) -> list[str]:
    out = [
        f"### {a['apiId']} — {a['serviceName']}",
        "",
        f"{clean(a.get('description'))}",
        "",
        f"- **URL**: `{a['method']} {a['url']}`",
        f"- **형식**: {a.get('apiType', 'REST API')}",
        f"- **최종 수정**: {(a.get('updateAt') or '')[:10]}",
        "",
        "**요청 변수**",
        "",
        "| 파라미터 | 한글명 | 필수 | 예시 | 설명 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for it in a.get("requestItems", []):
        req = "필수" if it.get("itemRequired") == "Y" else "선택"
        out.append(
            f"| `{it['itemNameEn']}` | {clean(it.get('itemNameKo'))} | {req} "
            f"| `{clean(it.get('sampleData'))}` | {clean(it.get('itemDescription'))} |"
        )
    out += ["", "**응답 필드**", "", "| 필드 | 한글명 | 예시 | 설명 |", "| --- | --- | --- | --- |"]
    for it in a.get("responseItems", []):
        out.append(
            f"| `{it['itemNameEn']}` | {clean(it.get('itemNameKo'))} "
            f"| `{clean(it.get('sampleData'))}` | {clean(it.get('itemDescription'))} |"
        )
    out.append("")
    return out


def write_docs(catalog: dict) -> None:
    DOCS.mkdir(parents=True, exist_ok=True)
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / "eum-api-catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )

    total = sum(len(v["apis"]) for v in catalog.values())
    manual_total = sum(len(v) for v in MANUAL_SUPPLEMENT.values())
    ordered = sorted(catalog.values(), key=lambda v: TYPE_ORDER[v["typeId"]][0])

    index = [
        "# E-UM 디지털트윈 포항 Open API 카탈로그",
        "",
        f"출처: <https://pohang-eum.kr/data> · 자동 수집 · **총 {total}개 API / {len(catalog)}개 서비스**",
        "",
        "재생성: `python3 research/api-tests/fetch_eum_catalog.py`",
        "",
        "## 공통 사항",
        "",
        "- 전 API가 `GET` 방식 REST API. 엔드포인트 호스트는 `genix.pohang-eum.kr`",
        "- **모든 API에 `serviceKey` 파라미터가 필수**다. E-UM 로그인 후 발급받는 개인 인증키이며,",
        "  API 자료실에서 신청(`/api/apply`)해야 나온다. 키는 저장소에 커밋하지 말고 `.env`에 둔다.",
        "- 호출 형태: `GET https://genix.pohang-eum.kr/dpg/<path>?serviceKey=<KEY>&...`",
        "- 응답 공통 껍데기: `{ id, status, data }` — 실제 값은 `data` 안에 있다.",
        (
            f"- **⚠ 표시가 붙은 {manual_total}개 API는 E-UM API 자료실 메타데이터(`/netro/api/*`)에 "
            "정식 등록이 안 돼 있다.** genix 서버에 직접 요청해 실제 동작을 확인하고 "
            "`research/api-tests/fetch_eum_catalog.py`의 `MANUAL_SUPPLEMENT`에 수동으로 채워 넣은 것이다. "
            "apiId는 E-UM이 동일 역할에 실제로 쓰는 번호 규칙을 따랐을 뿐 공식 발급 ID가 아니다. "
            "조사 기록: [research/api-tests/2026-08-04-atmosphere-undocumented-apis.md]"
            "(../../research/api-tests/2026-08-04-atmosphere-undocumented-apis.md)"
        ) if manual_total else None,
        "",
        "## 서비스별 문서",
        "",
        "| # | 서비스 | API 수 | 문서 |",
        "| --- | --- | --- | --- |",
    ]
    for v in ordered:
        n, short = TYPE_ORDER[v["typeId"]]
        index.append(f"| {n} | {v['serviceTitle']} | {len(v['apis'])} | [{short}]({n:02d}-{short}.md) |")

    index += ["", "## 전체 API 목록", "", "| API ID | 서비스 | 기능 | 엔드포인트 |", "| --- | --- | --- | --- |"]
    for v in ordered:
        for a in v["apis"]:
            path = a["url"].replace("https://genix.pohang-eum.kr", "")
            index.append(
                f"| `{a['apiId']}` | {v['serviceTitle']} | {clean(a['serviceName'])} | `{path}` |"
            )
    index.append("")
    (DOCS / "README.md").write_text("\n".join(line for line in index if line is not None), encoding="utf-8")

    for v in ordered:
        n, short = TYPE_ORDER[v["typeId"]]
        body = [
            f"# {v['serviceTitle']}",
            "",
            f"> {clean(v['serviceName'])}",
            "",
            clean(v["description"]),
            "",
            f"API {len(v['apis'])}개 · [카탈로그 인덱스로](README.md)",
            "",
            "---",
            "",
        ]
        for a in v["apis"]:
            body += render_api(a)
            body += ["---", ""]
        (DOCS / f"{n:02d}-{short}.md").write_text("\n".join(body), encoding="utf-8")

    print(f"\n생성 완료: {DOCS} ({len(catalog) + 1}개 파일), {DATA / 'eum-api-catalog.json'}")


if __name__ == "__main__":
    print("E-UM API 카탈로그 수집 중...")
    write_docs(fetch())
