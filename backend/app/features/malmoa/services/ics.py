"""캘린더 구독(ICS, RFC 5545) 만들기 — 아이폰·구글 캘린더가 비밀 주소로 받아 간다 (통합 단계 5-6, 결정 C)

넣는 것: 제목·시각·장소·메모·참석자·알람. 녹음·원문·회의록은 넣지 않는다.
"""

from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from app.features.malmoa.models import Event

CALENDAR_NAME = "말모아"
PAST_DAYS = 30  # 지난 일정은 이만큼만
FUTURE_DAYS = 400  # 앞으로의 일정은 이만큼까지


def escape(text: str) -> str:
    """TEXT 값: 역슬래시·세미콜론·쉼표·줄바꿈"""
    return text.replace("\\", "\\\\").replace(";", r"\;").replace(",", "\\,").replace("\r\n", "\n").replace("\n", "\\n")


def fold(line: str) -> str:
    """한 줄 75바이트 넘으면 접는다 (UTF-8 글자 중간에서 자르지 않는다)"""
    out, cur, size = [], "", 0
    for ch in line:
        n = len(ch.encode())
        if size + n > (75 if not out else 74):
            out.append(cur)
            cur, size = "", 0
        cur += ch
        size += n
    out.append(cur)
    return "\r\n ".join(out)


def _utc(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")


def _description(ev: Event) -> str:
    parts = []
    if ev.memo:
        parts.append(ev.memo.strip())
    names = [a["name"] + (f"({a['role']})" if a.get("role") else "") for a in ev.attendees or [] if a.get("name")]
    if names:
        parts.append("참석자: " + ", ".join(names))
    return "\n\n".join(parts)


def _event(ev: Event, tz: ZoneInfo, now: datetime) -> list[str]:
    lines = ["BEGIN:VEVENT", f"UID:{ev.id}@malmoa", f"DTSTAMP:{_utc(now)}", f"LAST-MODIFIED:{_utc(ev.updated_at or ev.created_at or now)}"]
    if ev.all_day:  # 저장은 시작일 0시 ~ 마지막 날 다음 날 0시 (끝 날은 포함하지 않음 — ICS 와 같은 방식)
        start = ev.starts_at.astimezone(tz).date()
        end = max(ev.ends_at.astimezone(tz).date(), start + timedelta(days=1))
        lines += [f"DTSTART;VALUE=DATE:{start:%Y%m%d}", f"DTEND;VALUE=DATE:{end:%Y%m%d}"]
    else:
        lines += [f"DTSTART:{_utc(ev.starts_at)}", f"DTEND:{_utc(ev.ends_at)}"]
    lines.append(f"SUMMARY:{escape(ev.title)}")
    if ev.location:
        lines.append(f"LOCATION:{escape(ev.location)}")
    if desc := _description(ev):
        lines.append(f"DESCRIPTION:{escape(desc)}")
    for minutes in sorted(set(ev.reminders or [])):
        lines += ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{escape(ev.title)}", f"TRIGGER:-PT{minutes}M" if minutes else "TRIGGER:PT0M", "END:VALARM"]
    lines.append("END:VEVENT")
    return lines


def build_ics(events: Iterable[Event], tz: ZoneInfo, now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//SNACKCUP//Malmoa//KO",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{CALENDAR_NAME}",
        f"X-WR-TIMEZONE:{tz.key}",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",  # 다시 받아 가는 간격 희망값 (실제 주기는 캘린더 앱이 정한다)
        "X-PUBLISHED-TTL:PT1H",
    ]
    for ev in events:
        lines += _event(ev, tz, now)
    lines.append("END:VCALENDAR")
    return "\r\n".join(fold(line) for line in lines) + "\r\n"
