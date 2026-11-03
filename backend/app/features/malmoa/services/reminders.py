"""일정 알람 검사기 — 30초마다 tick()을 불러 울릴 알람을 찾는다

규칙 (docs/2026-10-29-일정·알람·자동녹음.md):
- 알람 시각에서 LATE 안이면 그대로 울린다.
- 서버가 꺼져 있거나 Mac이 잠자서 놓친 알람은 몰아서 울리지 않는다.
  일정이 아직 시작 전이면 "곧 시작"을 한 번만, 이미 시작했으면 조용히 넘긴다.
- 한 번 처리한 알람은 event_reminders 에 남겨 다시 울리지 않는다 (서버를 껐다 켜도).
- 일정을 저장할 때 이미 지난 알람 시점은 미리 처리한 것으로 남긴다 (저장하자마자 울리지 않게).
- 서버가 여러 대여도 한 번에 한 서버만 검사한다 (PostgreSQL advisory lock). 서버가 잠들었다 깨면 그때 놓친 알람을 위 규칙대로 처리하고,
  화면은 GET /api/events/reminders?since= 로 그사이 기록된 알림을 받아 간다.
"""

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.features.malmoa.config import get_settings
from app.features.malmoa.db import engine
from app.features.malmoa.models import Event, EventReminder
from app.features.malmoa.services import auto_record
from app.features.malmoa.services.notify import mac_notify

log = logging.getLogger(__name__)

TICK_SECONDS = 30
LOCK_KEY = 0x6D616C6D  # 알람 검사기 advisory lock 번호 ("malm"). 이 번호를 쥔 서버만 검사한다
LATE = timedelta(minutes=2)  # 검사 주기·처리 지연을 감안해 이만큼 늦어도 제때 울린 것으로 본다
MAX_BEFORE = timedelta(minutes=1440)  # 가장 이른 알람: 하루 전

LABELS = {0: "지금 시작", 5: "5분 뒤 시작", 10: "10분 뒤 시작", 30: "30분 뒤 시작", 60: "1시간 뒤 시작", 1440: "내일 시작"}


def remind_label(minutes: int) -> str:
    return LABELS.get(minutes, f"{minutes}분 뒤 시작")


def _local_hm(dt: datetime) -> str:
    # 배포 서버는 보통 UTC 라서 서버 시간대가 아니라 APP_TIMEZONE 으로 표시한다
    return dt.astimezone(get_settings().tz).strftime("%H:%M")


def _message(ev: Event, when: str) -> str:
    parts = [f"{when} · {'종일' if ev.all_day else _local_hm(ev.starts_at)} {ev.title}"]
    if ev.location:
        parts.append(ev.location)
    return " · ".join(parts)


def _soon(ev: Event, now: datetime) -> str:
    left = max(1, round((ev.starts_at - now).total_seconds() / 60))
    return f"곧 시작 ({left // 60}시간 {left % 60}분 뒤)" if left >= 60 else f"곧 시작 ({left}분 뒤)"


@dataclass
class Fired:
    event_id: str
    title: str
    message: str


def tick(db: Session, now: datetime | None = None, notify: Callable[[str, str], object] | None = None) -> list[Fired]:
    """지금 울릴 알람을 처리하고, 실제로 알린 것을 돌려준다"""
    now = now or datetime.now(UTC)
    notify = notify or (lambda _title, message: mac_notify("말모아 일정", message))
    events = db.scalars(
        select(Event).where(
            Event.starts_at >= now - LATE,
            Event.starts_at <= now + MAX_BEFORE + LATE,
            func.cardinality(Event.reminders) > 0,
        )
    ).all()
    if not events:
        return []
    done = {(r.event_id, r.minutes_before) for r in db.scalars(select(EventReminder).where(EventReminder.event_id.in_([e.id for e in events])))}

    fired: list[Fired] = []
    for ev in events:
        due = sorted(m for m in ev.reminders if (ev.id, m) not in done and ev.starts_at - timedelta(minutes=m) <= now)
        if not due:
            continue
        fresh = [m for m in due if now - (ev.starts_at - timedelta(minutes=m)) <= LATE]
        if fresh:
            message = _message(ev, remind_label(fresh[0]))  # 여러 개가 겹치면 가장 가까운 것 하나만
        elif ev.starts_at > now:
            message = _message(ev, _soon(ev, now))  # 놓친 알람: 시작 전이면 한 번만
        else:
            message = None  # 이미 시작한 일정의 놓친 알람은 조용히 넘긴다
        for i, m in enumerate(due):
            notified = message is not None and i == 0
            db.add(EventReminder(event_id=ev.id, minutes_before=m, sent_at=now, notified=notified, message=message if notified else None))
        if message:
            fired.append(Fired(str(ev.id), ev.title, message))
    # 먼저 기록하고 나서 알린다: 알림이 실패해도 같은 알람을 되풀이하지 않는다
    db.commit()
    for f in fired:
        notify(f.title, f.message)
        log.info("알람: %s", f.message)
    return fired


def mark_past(db: Session, ev: Event, now: datetime | None = None, *, reset: bool = False) -> None:
    """일정 저장 직후: 이미 지난 알람 시점은 처리한 것으로 남긴다. reset=True 면 (시작 시각이 바뀌어) 기록을 지우고 다시 계산"""
    now = now or datetime.now(UTC)
    if reset:
        db.execute(delete(EventReminder).where(EventReminder.event_id == ev.id))
    done = set(db.scalars(select(EventReminder.minutes_before).where(EventReminder.event_id == ev.id)))
    for m in ev.reminders:
        if m not in done and ev.starts_at - timedelta(minutes=m) <= now:
            db.add(EventReminder(event_id=ev.id, minutes_before=m, sent_at=now, notified=False))
    db.commit()


def check_once() -> bool:
    """알람·자동 녹음 검사를 한 번. 다른 서버가 검사 중이면 건너뛰고 False"""
    with engine.connect() as conn:
        if not conn.execute(select(func.pg_try_advisory_lock(LOCK_KEY))).scalar():
            conn.rollback()
            return False
        conn.commit()  # 세션 단위 잠금이라 커밋해도 유지된다. 아래 Session 이 자기 트랜잭션을 쓰게 비워 둔다
        try:
            with Session(bind=conn) as db:
                tick(db)
                auto_record.tick(db)
        finally:
            conn.rollback()
            conn.execute(select(func.pg_advisory_unlock(LOCK_KEY)))
            conn.commit()
    return True


async def run_forever() -> None:
    """앱이 켜져 있는 동안 TICK_SECONDS마다 검사 (DB 작업은 스레드에서)"""
    while True:
        try:
            await asyncio.to_thread(check_once)
        except Exception:
            log.exception("알람 검사 중 오류")
        await asyncio.sleep(TICK_SECONDS)
