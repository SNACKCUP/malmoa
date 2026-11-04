"""Mac 캘린더 앱으로 일정 내보내기 (osascript) — iCloud가 아이폰에 동기화하면 아이폰 캘린더가 알림을 울린다

docs/2026-10-29-일정·알람·자동녹음.md 2-C:
- 한 방향: 말모아 → 캘린더 앱. 캘린더·아이폰에서 고친 내용은 말모아로 돌아오지 않는다.
- 넘기는 것: 제목, 시작·종료, 종일 여부, 장소, 알림. 메모·참석자·녹음·원문은 넘기지 않는다.
- 사용자가 캘린더 앱에서 iCloud 아래에 만든 캘린더(APPLE_CALENDAR_NAME, 기본 Malmoa)에만 쓴다.

값은 스크립트에 끼워 넣지 않고 인자(argv)로 넘겨 따옴표 등 특수문자에 안전하다.
"""

import logging
import re
import subprocess
import sys
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.features.malmoa.config import get_settings
from app.features.malmoa.db import SessionLocal
from app.features.malmoa.models import Event

log = logging.getLogger(__name__)

TIMEOUT = 30  # 캘린더 앱이 꺼져 있으면 켜는 데 몇 초 걸린다
NOTE = "말모아에서 만든 일정입니다. 여기서 고친 내용은 말모아에 반영되지 않습니다."

# 날짜는 Mac 현지 시각의 연·월·일·시·분으로 넘겨 만든다 (문자열 날짜는 언어 설정마다 해석이 다르다)
_HEAD = """on mkdate(parts)
set {y, m, d, hh, mm} to parts
set dt to current date
set day of dt to 1
set year of dt to y
set month of dt to m
set day of dt to d
set time of dt to hh * 3600 + mm * 60
return dt
end mkdate

on nums(s)
if s is "" then return {}
set AppleScript's text item delimiters to ","
set out to {}
repeat with x in text items of s
set end of out to (x as integer)
end repeat
set AppleScript's text item delimiters to ""
return out
end nums

on findEvent(cal, u)
tell application "Calendar"
if u is "" then return missing value
set found to (every event of cal whose uid is u)
if (count of found) is 0 then return missing value
return item 1 of found
end tell
end findEvent
"""

# 고칠 때는 지우고 새로 만든다: 이미 있는 일정의 알림은 캘린더 앱 스크립트로 지울 수 없다 (-10000 오류)
_UPSERT = _HEAD + """
on run argv
set {calName, u, t, loc, ad, sParts, eParts, mins, note} to argv
set s to my mkdate(my nums(sParts))
set e to my mkdate(my nums(eParts))
tell application "Calendar"
set cal to calendar calName
set old to my findEvent(cal, u)
if old is not missing value then delete old
set ev to make new event at end of events of cal with properties {summary:t, start date:s, end date:e, allday event:(ad is "1"), location:loc, description:note}
repeat with m in my nums(mins)
make new display alarm at end of display alarms of ev with properties {trigger interval:-(m as integer)}
end repeat
return uid of ev
end tell
end run
"""

_DELETE = _HEAD + """
on run argv
set {calName, u} to argv
tell application "Calendar"
set ev to my findEvent(calendar calName, u)
if ev is not missing value then delete ev
end tell
end run
"""

_CHECK = """on run argv
tell application "Calendar" to get name of calendar (item 1 of argv)
end run"""


class CalendarSyncError(Exception):
    """캘린더 앱에 쓰지 못함. 메시지는 화면에 그대로 보여 준다"""


def available() -> bool:
    return sys.platform == "darwin"


def _parts(dt: datetime) -> str:
    # 서버가 이 Mac에서 돌므로 Mac의 시간대로 바꿔 넘긴다
    local = dt.astimezone()
    return f"{local.year},{local.month},{local.day},{local.hour},{local.minute}"


def _explain(stderr: str) -> str:
    name = get_settings().apple_calendar_name
    if "-1743" in stderr:
        return "캘린더 제어 권한이 없습니다. 시스템 설정 › 개인정보 보호 및 보안 › 자동화에서 캘린더를 허용해 주세요."
    if "-1728" in stderr:
        return f"캘린더 앱에 '{name}' 캘린더가 없습니다. 캘린더 앱에서 iCloud 아래에 만들어 주세요."
    if "-1712" in stderr:
        return "캘린더 앱이 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요."
    first = re.sub(r"^\d+:\d+: execution error: ", "", stderr.strip().splitlines()[-1] if stderr.strip() else "")
    return f"캘린더 앱에 쓰지 못했습니다: {first or '알 수 없는 오류'}"[:255]


def _osascript(script: str, *args: str) -> str:
    """스크립트를 실행하고 결과를 돌려준다 (테스트에서 이 함수를 바꿔 끼운다)"""
    if not available():
        raise CalendarSyncError("캘린더 앱 내보내기는 Mac에서만 쓸 수 있습니다.")
    try:
        res = subprocess.run(["osascript", "-e", script, *args], capture_output=True, text=True, timeout=TIMEOUT, check=False)
    except subprocess.TimeoutExpired:
        raise CalendarSyncError("캘린더 앱이 응답하지 않습니다. 잠시 뒤 다시 시도해 주세요.")
    except OSError as e:
        raise CalendarSyncError(f"osascript를 실행하지 못했습니다: {e}")
    if res.returncode != 0:
        log.warning("캘린더 앱 오류: %s", res.stderr.strip())
        raise CalendarSyncError(_explain(res.stderr))
    return res.stdout.strip()


def check() -> None:
    """캘린더가 있고 제어 권한이 있는지 (켤 때 확인)"""
    _osascript(_CHECK, get_settings().apple_calendar_name)


def upsert(ev: Event) -> str:
    """캘린더 앱에 일정을 (다시) 만들고 새 uid를 돌려준다. 예전 uid의 일정이 남아 있으면 지운다"""
    mins = ",".join(str(m) for m in sorted(ev.reminders or []))
    return _osascript(
        _UPSERT,
        get_settings().apple_calendar_name,
        ev.calendar_uid or "",
        ev.title,
        ev.location or "",
        "1" if ev.all_day else "0",
        _parts(ev.starts_at),
        # 말모아의 종일 일정은 '다음 날 0시'에 끝나지만, 캘린더 앱에는 마지막 날을 넘겨야 그날까지로 들어간다
        _parts(ev.ends_at - timedelta(days=1) if ev.all_day else ev.ends_at),
        mins,
        NOTE,
    )


def remove(uid: str) -> None:
    """캘린더 앱에서 일정을 지운다 (이미 없으면 그냥 넘어간다)"""
    _osascript(_DELETE, get_settings().apple_calendar_name, uid)


# ── DB와 함께 쓰는 부분 ──────────────────────────────────────────


def fields(ev: Event) -> tuple:
    """캘린더 앱에 넘기는 값. 이것이 바뀌지 않았으면 다시 내보내지 않는다"""
    return (ev.title, ev.location, ev.all_day, ev.starts_at, ev.ends_at, tuple(sorted(ev.reminders or [])))


def export(db: Session, ev: Event, before: tuple | None = None) -> None:
    """일정 하나를 캘린더 앱에 반영한다. 실패하면 이유를 남기고, 말모아 일정 저장은 그대로 둔다"""
    if ev.calendar_synced and before == fields(ev):
        return
    try:
        ev.calendar_uid, ev.calendar_error = upsert(ev), None
    except CalendarSyncError as e:
        ev.calendar_error = str(e)
    db.commit()


def forget(ev: Event) -> None:
    """일정을 지우기 전에 캘린더 앱에서도 지운다 (실패해도 말모아 일정은 지운다)"""
    if not ev.calendar_uid:
        return
    try:
        remove(ev.calendar_uid)
    except CalendarSyncError as e:
        log.warning("캘린더 앱에서 일정을 지우지 못했습니다 (%s): %s", ev.title, e)


def export_upcoming(user_id: int) -> int:
    """내보내기를 켰을 때: 아직 끝나지 않은 일정을 모두 내보낸다. 실패한 수를 돌려준다"""
    failed = 0
    with SessionLocal() as db:
        rows = db.scalars(select(Event).where(Event.user_id == user_id, Event.ends_at > datetime.now(UTC)).order_by(Event.starts_at)).all()
        for ev in rows:
            export(db, ev)
            failed += ev.calendar_error is not None
    return failed
