"""Mac 알림 센터에 알림 띄우기 (osascript). 외부로 아무것도 보내지 않는다.

제목·내용은 스크립트에 끼워 넣지 않고 인자(argv)로 넘겨 따옴표 등 특수문자에 안전하다.
처음 한 번 macOS가 알림 허용을 물을 수 있다 (시스템 설정 › 알림 › 스크립트 편집기).
"""

import logging
import subprocess
import sys

from app.features.malmoa.config import get_settings

log = logging.getLogger(__name__)

SCRIPT = """on run argv
display notification (item 2 of argv) with title (item 1 of argv) subtitle (item 3 of argv) sound name "Glass"
end run"""


def mac_notify(title: str, message: str, subtitle: str = "") -> bool:
    """알림을 띄우면 True. Mac이 아니거나 꺼 두었거나 실패하면 False (실패는 기록만 하고 넘어간다)"""
    if sys.platform != "darwin" or not get_settings().mac_notifications:
        return False
    try:
        subprocess.run(["osascript", "-e", SCRIPT, title, message, subtitle], check=True, capture_output=True, timeout=10)
        return True
    except (OSError, subprocess.SubprocessError) as e:
        log.warning("Mac 알림을 띄우지 못했습니다: %s", e)
        return False
