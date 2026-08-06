"""E-UM 디지털트윈 포항 Open API 호출 클라이언트.

카탈로그 문서(docs/api-catalog/06-보행자안전.md, 01-대기환경.md)에 정의된
GET 엔드포인트를 호출하고 공통 응답 껍데기를 벗겨서 돌려준다.

정상 응답 껍데기는 카탈로그 문서 기준 {id, status, data} 이지만, 인증 실패
응답은 실측 결과 {rspns_rslt: {rslt_cd, rslt_msg}, rspns_bdy} 형태였다
(ideas/002-breakwater-guard/data.md 참고). serviceKey 발급 전이라 정상
응답이 어느 껍데기를 쓰는지 확정하지 못해 두 형태를 모두 처리한다.
"""

from __future__ import annotations

import os
from typing import Any

import requests

BASE_URL = "https://genix.pohang-eum.kr"
TIMEOUT_SECONDS = 10


class EumApiError(RuntimeError):
    """E-UM API가 실패 응답(인증 오류, 빈 데이터 등)을 돌려줬을 때."""


def _service_key() -> str:
    key = os.environ.get("EUM_SERVICE_KEY", "").strip()
    if not key:
        raise EumApiError(
            "EUM_SERVICE_KEY가 설정돼 있지 않다. "
            ".env.example을 복사해 .env를 만들고 "
            "https://pohang-eum.kr/data 에서 발급받은 키를 넣을 것."
        )
    return key


def eum_get(path: str, params: dict[str, Any] | None = None) -> Any:
    """E-UM genix 서버에 GET 요청을 보내고 data(또는 rspns_bdy)를 반환한다."""

    query = {"serviceKey": _service_key(), **(params or {})}
    response = requests.get(f"{BASE_URL}{path}", params=query, timeout=TIMEOUT_SECONDS)

    try:
        body = response.json()
    except ValueError as exc:
        raise EumApiError(f"{path} 응답이 JSON이 아니다 (HTTP {response.status_code})") from exc

    # 실패 응답 껍데기: {"rspns_rslt": {"rslt_cd", "rslt_msg"}, "rspns_bdy": null}
    if "rspns_rslt" in body:
        result = body["rspns_rslt"]
        if result.get("rslt_cd") != "00000" and result.get("rslt_cd") is not None:
            raise EumApiError(f"{path} 호출 실패: {result.get('rslt_msg')} (코드 {result.get('rslt_cd')})")
        return body.get("rspns_bdy")

    # 정상 응답 껍데기(카탈로그 문서 기준): {"id", "status", "data"}
    if body.get("status") not in (None, "success"):
        raise EumApiError(f"{path} 호출 실패: status={body.get('status')}")

    if "data" in body:
        return body["data"]

    return body
