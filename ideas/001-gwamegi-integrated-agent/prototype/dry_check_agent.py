#!/usr/bin/env python3
"""과메기 통합 에이전트 MVP.

사용자의 자연어 질문을 받아 INT_S01_004(대기환경 실시간_단일)를 호출하고,
임계값 기반 규칙으로 건조 적합도를 판단한 뒤 Claude로 자연어 응답을 만든다.

사용법:
    python dry_check_agent.py "오늘 오후에 과메기를 널어도 괜찮을까?"
    python dry_check_agent.py            # 인자 없으면 기본 질문 사용
"""

from __future__ import annotations

import os
import sys
from urllib.parse import unquote

import requests
from dotenv import find_dotenv, load_dotenv

load_dotenv(find_dotenv())

GENIX_BASE = "https://genix.pohang-eum.kr"
DEFAULT_DEVICE_ID = 1
DEFAULT_QUESTION = "오늘 오후에 과메기를 널어도 괜찮을까?"


def get_service_key() -> str:
    key = os.environ.get("EUM_SERVICE_KEY")
    if not key:
        raise SystemExit(
            "EUM_SERVICE_KEY가 없다. 저장소 루트에 .env를 만들고 값을 채워라 "
            "(cp .env.example .env)."
        )
    # E-UM 발급 키를 URL에서 그대로 복사하면 %2F 등으로 이미 퍼센트 인코딩된 채로
    # .env에 들어가는 경우가 있다. requests가 그걸 다시 인코딩(%25로 이중 인코딩)해
    # 401을 내므로, 여기서 한 번 디코딩해 원본 키로 되돌린다.
    return unquote(key)


def fetch_atmosphere_realtime(device_id: int = DEFAULT_DEVICE_ID) -> dict:
    """INT_S01_004 호출: 지정 장비의 최신 대기환경 실측값을 가져온다."""
    resp = requests.get(
        f"{GENIX_BASE}/dpg/atmosphere/device/realtime",
        params={"serviceKey": get_service_key(), "id": device_id},
        timeout=10,
    )
    resp.raise_for_status()
    body = resp.json()
    if body.get("status") != "success":
        raise RuntimeError(f"E-UM API 호출 실패: {body}")
    return body["data"]


def judge_drying_condition(data: dict) -> str:
    """온도·습도·풍속·PM10 임계값 기반 건조 적합도 판단.

    기준 출처: ideas/001-gwamegi-integrated-agent/README.md 3번 항목.
    선행 연구로 검증된 값이 아니라 MVP용 상식적 임계값이다 (data.md 리스크 참고).
    """
    if data["pm10"] > 150:
        return "부적합 (미세먼지 과다)"
    if data["humi"] > 80 or data["winsp"] < 1:
        return "주의"
    return "양호"


def build_response(question: str, data: dict, verdict: str) -> str:
    """Claude에게 질문 + 실측 데이터 + 판단 결과를 주고 자연어 응답을 받는다."""
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if not anthropic_key:
        return (
            f"[규칙 기반 판단: {verdict}] (ANTHROPIC_API_KEY가 없어 자연어 응답은 생략)\n"
            f"온도 {data['temp']}℃, 습도 {data['humi']}%, 풍속 {data['winsp']}m/s, "
            f"PM10 {data['pm10']} (측정시각 {data['logDateTime']})"
        )

    from anthropic import Anthropic

    client = Anthropic(api_key=anthropic_key)
    message = client.messages.create(
        model="claude-sonnet-5",
        max_tokens=300,
        messages=[
            {
                "role": "user",
                "content": (
                    "너는 구룡포 과메기 건조 관리를 돕는 에이전트다.\n"
                    f'사용자 질문: "{question}"\n'
                    f"실시간 측정값: 온도 {data['temp']}℃, 습도 {data['humi']}%, "
                    f"풍속 {data['winsp']}m/s, 풍향 {data['windir']}°, PM10 {data['pm10']}, "
                    f"측정시각 {data['logDateTime']}\n"
                    f"규칙 기반 판단 결과: {verdict}\n"
                    "위 데이터와 판단 결과만 근거로 삼아 사용자 질문에 2~3문장으로 답하라. "
                    "주어지지 않은 수치나 판단을 지어내지 마라."
                ),
            }
        ],
    )
    return message.content[0].text


def main() -> None:
    question = " ".join(sys.argv[1:]) or DEFAULT_QUESTION
    data = fetch_atmosphere_realtime()
    verdict = judge_drying_condition(data)
    print(build_response(question, data, verdict))


if __name__ == "__main__":
    main()
