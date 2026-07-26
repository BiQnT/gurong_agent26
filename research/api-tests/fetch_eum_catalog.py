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
        catalog[str(tid)] = {
            "typeId": tid,
            "serviceTitle": t["serviceTitle"],
            "serviceName": t["serviceName"],
            "description": t["description"],
            "apis": apis,
        }
        print(f"  {tid} {t['serviceTitle']}: {len(apis)}개")
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
    (DOCS / "README.md").write_text("\n".join(index), encoding="utf-8")

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
