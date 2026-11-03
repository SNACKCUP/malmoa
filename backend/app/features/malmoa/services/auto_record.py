"""자동 녹음 — 녹음은 브라우저(말모아 탭)가 하고, 서버는 상태 기록·사전 경고·만료 처리만 한다

docs/2026-10-29-일정·알람·자동녹음.md 3장:
- 탭이 시작 시각에 녹음을 시작하고 결과(started·skipped·failed)를 보고한다.
- 탭은 30초마다 생존 신호와 마이크 권한을 보낸다 (recorder_beats 테이블 — 서버 여러 대·재시작에서도 같은 값). 시작 5분 전에 신호가 없거나 권한이 없으면 Mac 알림으로 미리 경고한다.
- 시작 시각 + GRACE 가 지나도 대기(armed) 중이면 '건너뜀'으로 남기고 알린다 (탭이 닫혀 있었거나 Mac이 잠자고 있었음).
"""

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.features.malmoa.config import get_settings
from app.features.malmoa.models import Event, RecorderBeat
from app.features.malmoa.services.notify import mac_notify

log = logging.getLogger(__name__)

GRACE = timedelta(minutes=10)  # 시작 시각이 이만큼 지나도 늦게라도 시작한다 (숨은 탭 타이머 지연·잠자기에서 깬 직후)
WARN_BEFORE = timedelta(minutes=5)  # 이때 탭·마이크 권한을 미리 점검한다
BEAT_FRESH = timedelta(minutes=2)  # 이 안에 생존 신호가 있으면 탭이 열려 있다고 본다

TITLE = "말모아 자동 녹음"


def beat(db: Session, user_id: int, mic_permission: str, now: datetime | None = None) -> None:
    """탭의 생존 신호를 기록한다 (사용자마다 마지막 하나만)"""
    at = now or datetime.now(UTC)
    stmt = insert(RecorderBeat).values(user_id=user_id, at=at, mic_permission=mic_permission)
    db.execute(stmt.on_conflict_do_update(index_elements=[RecorderBeat.user_id], set_={"at": at, "mic_permission": mic_permission}))
    db.commit()


def _hm(dt: datetime) -> str:
    return dt.astimezone(get_settings().tz).strftime("%H:%M")


def _default_notify(message: str) -> None:
    mac_notify(TITLE, message)


def report(db: Session, ev: Event, state: str, note: str | None, notify: Callable[[str], object] | None = None) -> None:
    """탭이 보낸 결과를 기록하고 Mac 알림으로 알린다. 호출 전에 ev가 대기(armed) 상태인지 확인한다"""
    notify = notify or _default_notify
    ev.auto_record_state, ev.auto_record_note = state, note
    db.commit()
    if state == "started":
        notify(f"자동 녹음을 시작했습니다 · {_hm(ev.starts_at)} {ev.title}")
    else:
        notify(f"자동 녹음을 하지 못했습니다 · {ev.title} · {note or '이유 없음'}")


def tick(db: Session, now: datetime | None = None, notify: Callable[[str], object] | None = None) -> list[str]:
    """사전 경고와 만료 처리. 보낸 알림 문구를 돌려준다 (알람 검사기와 함께 30초마다)"""
    now = now or datetime.now(UTC)
    notify = notify or _default_notify
    sent: list[str] = []
    armed = db.scalars(
        select(Event).where(Event.auto_record, Event.auto_record_state == "armed", Event.starts_at <= now + WARN_BEFORE).order_by(Event.starts_at)
    ).all()
    for ev in armed:
        if ev.starts_at + GRACE < now:
            ev.auto_record_state = "skipped"
            ev.auto_record_note = "시작 시각에 말모아 탭이 열려 있지 않았거나 Mac이 잠자기 상태였습니다."
            db.commit()
            msg = f"자동 녹음을 하지 못했습니다 · {ev.title} · 말모아 탭이 닫혀 있었거나 Mac이 잠자기 상태였습니다."
        elif ev.starts_at > now and not ev.auto_record_warned:
            ev.auto_record_warned = True  # 한 번만 (보내기 전에 기록: 알림이 실패해도 되풀이하지 않는다)
            db.commit()
            b = db.get(RecorderBeat, ev.user_id)
            if b is None or now - b.at > BEAT_FRESH:
                msg = f"{_hm(ev.starts_at)} {ev.title} 자동 녹음 예정 · 말모아 탭이 열려 있지 않습니다. 말모아를 열어 두세요."
            elif b.mic_permission != "granted":
                msg = f"{_hm(ev.starts_at)} {ev.title} 자동 녹음 예정 · 마이크 권한을 '허용'으로 바꿔 주세요 (주소창 왼쪽 사이트 설정)."
            else:
                continue
        else:
            continue
        notify(msg)
        log.info("자동 녹음: %s", msg)
        sent.append(msg)
    return sent
