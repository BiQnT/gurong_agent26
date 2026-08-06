"""방송 문구를 이 서버가 실행 중인 로컬 macOS 기기에서 소리로 재생한다 (보조 기능).

**중요한 한계 1**: E-UM 카탈로그 43개 API 중 방파제 스피커는 위치 조회(`INT_S06_001`)만
있고, 원격으로 소리를 내보내는 제어 API가 없다 (data.md 참고). 그래서 이 함수는 실제
현장 스피커를 울리지 못한다.

**중요한 한계 2 (macOS 전용)**: 여기 쓰는 `say` 명령은 macOS에만 있다. 팀원이 Windows에서
`monitor.py`를 돌리면 이 함수는 조용히 아무 일도 안 하고 False를 반환한다. **팀 전체가
공유하는 실제 음성 경로는 이게 아니라 `dashboard.html`의 브라우저 내장 음성합성(Web
Speech API)이다** — 그건 운영체제 상관없이 대시보드를 연 사람의 브라우저에서 소리가
난다. 이 파일은 어디까지나 서버를 직접 macOS에서 돌리는 사람을 위한 부가 데모다.

실제 스피커 제어 API가 열리면 이 파일의 `speak()` 내부만 그 API 호출로 바꾸면 되고,
호출부(monitor.py)는 수정할 필요가 없도록 인터페이스를 분리했다.
"""

from __future__ import annotations

import platform
import shutil
import subprocess


def speak(text: str, voice: str = "Yuna") -> bool:
    """텍스트를 음성으로 재생한다. 재생에 성공하면 True.

    macOS 외 환경이거나 `say`가 없으면 조용히 False를 반환한다 (알림 로직 자체가
    TTS 실패로 죽으면 안 되므로 예외를 던지지 않는다).
    """
    if platform.system() != "Darwin" or shutil.which("say") is None:
        return False
    try:
        subprocess.run(["say", "-v", voice, text], check=False, timeout=30)
        return True
    except Exception:
        return False
