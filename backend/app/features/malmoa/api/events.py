"""캘린더 일정 — 회의와 그 밖의 일정. 알람·자동 녹음은 이 일정의 시각을 기준으로 동작한다

일정을 지워도 연결된 녹음 작업(jobs)은 지우지 않는다.
캘린더 앱 내보내기를 켜 두면 저장·삭제할 때 Mac 캘린더 앱에도 반영한다 (실패해도 말모아 저장은 성공).
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    HTTPException,
    Query,
    Response,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.features.malmoa.config import get_settings
from app.features.malmoa.db import get_db
from app.features.malmoa.deps import CurrentUser
from app.features.malmoa.models import Event as EventRow
from app.features.malmoa.models import EventReminder
from app.features.malmoa.schemas.events import (
    AutoRecordReport,
    CalendarSync,
    CalendarSyncUpdate,
    Event,
    EventIn,
    EventList,
    FiredReminder,
    FiredReminderList,
)
from app.features.malmoa.schemas.jobs import ErrorResponse, unique_attendees
from app.features.malmoa.services import apple_calendar, auto_record, profiles
from app.features.malmoa.services.reminders import mark_past

router = APIRouter(prefix="/events", tags=["events"])

DB = Annotated[Session, Depends(get_db)]
ERRORS = {400: {"model": ErrorResponse}, 401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}}

MAX_RANGE = timedelta(days=400)  # 목록 한 번에 볼 수 있는 기간
MAX_LENGTH = timedelta(days=31)  # 일정 하나의 최대 길이


def _get(db: Session, event_id: str, user: CurrentUser) -> EventRow:
    try:
        key = uuid.UUID(event_id)
    except ValueError:
        raise HTTPException(404, "일정을 찾을 수 없습니다.")
    row = db.get(EventRow, key)
    if row is None or row.user_id != user.id:
        raise HTTPException(404, "일정을 찾을 수 없습니다.")
    return row


def _check(body: EventIn) -> None:
    if body.ends_at <= body.starts_at:
        raise HTTPException(400, "종료 시각은 시작 시각보다 뒤여야 합니다.")
    if body.ends_at - body.starts_at > MAX_LENGTH:
        raise HTTPException(400, "일정 하나는 31일을 넘을 수 없습니다.")
    if body.auto_record:
        if body.kind != "meeting":
            raise HTTPException(400, "자동 녹음은 회의 일정에만 걸 수 있습니다.")
        if body.all_day:
            raise HTTPException(400, "종일 일정에는 자동 녹음을 걸 수 없습니다. 시작 시각을 정해 주세요.")


def _arm(row: EventRow) -> None:
    """자동 녹음을 (다시) 대기 상태로. 이미 시작할 수 없는 시각이면 거절한다."""
    if row.starts_at + auto_record.GRACE < datetime.now(UTC):
        raise HTTPException(400, "이미 지난 일정에는 자동 녹음을 걸 수 없습니다.")
    row.auto_record_state, row.auto_record_note, row.auto_record_warned = "armed", None, False


def _apply(row: EventRow, body: EventIn) -> None:
    row.title, row.kind = body.title, body.kind
    row.starts_at, row.ends_at, row.all_day = body.starts_at, body.ends_at, body.all_day
    row.location, row.memo = body.location, body.memo
    row.attendees = [a.model_dump() for a in unique_attendees(body.attendees)]
    row.reminders = body.reminders
    row.auto_record = body.auto_record


@router.get("", response_model=EventList, responses=ERRORS)
def list_events(
    db: DB,
    user: CurrentUser,
    start: Annotated[datetime, Query(alias="from", description="이 시각 이후에 끝나는 일정")],
    end: Annotated[datetime, Query(alias="to", description="이 시각 전에 시작하는 일정")],
) -> EventList:
    """기간과 겹치는 내 일정 (시작 시각순)"""
    if start.tzinfo is None or end.tzinfo is None:
        raise HTTPException(400, "from·to에는 시간대가 포함된 시각을 넣어 주세요.")
    if end <= start or end - start > MAX_RANGE:
        raise HTTPException(400, "조회 기간이 올바르지 않습니다. (최대 400일)")
    rows = db.scalars(
        select(EventRow)
        .where(EventRow.user_id == user.id, EventRow.starts_at < end, EventRow.ends_at > start)
        .order_by(EventRow.starts_at, EventRow.created_at)
    )
    return EventList(events=[Event.model_validate(r) for r in rows])


@router.get("/reminders", response_model=FiredReminderList, responses=ERRORS)
def fired_reminders(db: DB, user: CurrentUser, since: Annotated[datetime, Query(description="이 시각 이후에 울린 알람")]) -> FiredReminderList:
    """화면 알림용: since 이후에 실제로 울린 내 알람 (최대 하루 전까지)"""
    if since.tzinfo is None:
        raise HTTPException(400, "since에는 시간대가 포함된 시각을 넣어 주세요.")
    since = max(since, datetime.now(UTC) - timedelta(days=1))
    rows = db.execute(
        select(EventReminder)
        .join(EventRow, EventRow.id == EventReminder.event_id)
        .where(EventRow.user_id == user.id, EventReminder.notified, EventReminder.sent_at > since)
        .order_by(EventReminder.sent_at)
    ).scalars()
    return FiredReminderList(reminders=[FiredReminder.model_validate(r, from_attributes=True) for r in rows])


def _sync_status(db: Session, user: CurrentUser) -> CalendarSync:
    enabled = profiles.calendar_sync_on(db, user.id)
    failed = db.scalar(
        select(func.count()).where(EventRow.user_id == user.id, EventRow.calendar_error.is_not(None), EventRow.ends_at > datetime.now(UTC))
    )
    return CalendarSync(
        enabled=enabled,
        available=apple_calendar.available(),
        calendar_name=get_settings().apple_calendar_name,
        failed=failed if enabled else 0,
    )


@router.get("/calendar-sync", response_model=CalendarSync, responses=ERRORS)
def get_calendar_sync(db: DB, user: CurrentUser) -> CalendarSync:
    """Mac 캘린더 앱(→ 아이폰) 내보내기 설정"""
    return _sync_status(db, user)


@router.put("/calendar-sync", response_model=CalendarSync, responses=ERRORS)
def set_calendar_sync(body: CalendarSyncUpdate, db: DB, user: CurrentUser, tasks: BackgroundTasks) -> CalendarSync:
    """켜면 캘린더와 권한을 확인한 뒤, 아직 끝나지 않은 일정을 뒤에서 모두 내보낸다. 끄면 이미 내보낸 일정은 캘린더 앱에 남는다"""
    if body.enabled and not profiles.calendar_sync_on(db, user.id):
        try:
            apple_calendar.check()
        except apple_calendar.CalendarSyncError as e:
            raise HTTPException(400, str(e))
        tasks.add_task(apple_calendar.export_upcoming, user.id)
    profiles.set_calendar_sync(db, user.id, body.enabled)
    db.commit()
    return _sync_status(db, user)


@router.post("", status_code=status.HTTP_201_CREATED, response_model=Event, responses=ERRORS)
def add_event(body: EventIn, db: DB, user: CurrentUser) -> Event:
    """일정 추가"""
    _check(body)
    row = EventRow(user_id=user.id)
    _apply(row, body)
    if row.auto_record:
        _arm(row)
    db.add(row)
    db.commit()
    mark_past(db, row)
    if profiles.calendar_sync_on(db, user.id):
        apple_calendar.export(db, row)
    db.refresh(row)
    return Event.model_validate(row)


@router.get("/{event_id}", response_model=Event, responses=ERRORS)
def get_event(event_id: str, db: DB, user: CurrentUser) -> Event:
    return Event.model_validate(_get(db, event_id, user))


@router.put("/{event_id}", response_model=Event, responses=ERRORS)
def update_event(event_id: str, body: EventIn, db: DB, user: CurrentUser) -> Event:
    """일정 수정. 자동 녹음을 새로 켰거나 시작 시각을 바꾸면 다시 대기 상태가 된다."""
    _check(body)
    row = _get(db, event_id, user)
    moved = body.starts_at != row.starts_at
    before = apple_calendar.fields(row)
    rearm = body.auto_record and (not row.auto_record or moved)
    _apply(row, body)
    if rearm:
        _arm(row)
    elif not row.auto_record:
        row.auto_record_state, row.auto_record_note = "none", None
    db.commit()
    # 시작 시각이 바뀌면 알람을 처음부터 다시 계산한다
    mark_past(db, row, reset=moved)
    if profiles.calendar_sync_on(db, user.id):
        apple_calendar.export(db, row, before)
    db.refresh(row)
    return Event.model_validate(row)


@router.post("/{event_id}/auto-record", response_model=Event, responses={**ERRORS, 409: {"model": ErrorResponse}})
def report_auto_record(event_id: str, body: AutoRecordReport, db: DB, user: CurrentUser) -> Event:
    """자동 녹음 결과 보고 (말모아 탭이 시작 시각에 보냄). 대기 중인 일정에만 한 번 받는다"""
    row = _get(db, event_id, user)
    if not row.auto_record or row.auto_record_state != "armed":
        raise HTTPException(409, "이미 처리했거나 자동 녹음이 꺼진 일정입니다.")
    auto_record.report(db, row, body.state, body.note)
    db.refresh(row)
    return Event.model_validate(row)


@router.post("/{event_id}/sync", response_model=Event, responses=ERRORS)
def retry_sync(event_id: str, db: DB, user: CurrentUser) -> Event:
    """캘린더 앱에 다시 내보내기 (실패했을 때 '다시 시도')"""
    row = _get(db, event_id, user)
    if not profiles.calendar_sync_on(db, user.id):
        raise HTTPException(400, "캘린더 앱 내보내기가 꺼져 있습니다. 설정에서 켜 주세요.")
    apple_calendar.export(db, row)
    db.refresh(row)
    return Event.model_validate(row)


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT, responses=ERRORS)
def delete_event(event_id: str, db: DB, user: CurrentUser) -> Response:
    """일정만 지운다 (연결된 녹음 작업은 그대로). 캘린더 앱에 내보낸 같은 일정도 지운다"""
    row = _get(db, event_id, user)
    apple_calendar.forget(row)
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
