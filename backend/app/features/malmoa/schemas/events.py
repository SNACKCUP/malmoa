"""캘린더 일정 스키마 (docs/2026-10-29-일정·알람·자동녹음.md)"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from app.features.malmoa.schemas.jobs import MAX_ATTENDEES, Attendee, CamelModel

# 알람 시점(분 전): 정시, 5분, 10분, 30분, 1시간, 하루 전
REMINDER_CHOICES = (0, 5, 10, 30, 60, 1440)

EventKind = Literal["meeting", "other"]
AutoRecordState = Literal["none", "armed", "started", "skipped", "failed"]


def _clean(v: object) -> object:
    # 앞뒤 공백을 지우고, 빈 값은 없음으로 (메모는 줄바꿈 유지)
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


class EventIn(CamelModel):
    """일정 추가·수정 요청"""

    title: str = Field(min_length=1, max_length=100)
    kind: EventKind = "meeting"
    starts_at: datetime
    ends_at: datetime
    all_day: bool = False
    location: str | None = Field(default=None, max_length=200)
    memo: str | None = Field(default=None, max_length=2000)
    attendees: list[Attendee] = Field(default=[], max_length=MAX_ATTENDEES)
    reminders: list[int] = Field(default=[], max_length=len(REMINDER_CHOICES))
    auto_record: bool = False

    @field_validator("title", "location", "memo", mode="before")
    @classmethod
    def _strip(cls, v: object) -> object:
        return _clean(v)

    @field_validator("starts_at", "ends_at")
    @classmethod
    def _aware(cls, v: datetime) -> datetime:
        # 시간대 없는 시각은 Mac 시간대와 서버 해석이 어긋날 수 있어 받지 않는다
        if v.tzinfo is None:
            raise ValueError("시간대가 포함된 시각이어야 합니다.")
        return v

    @field_validator("reminders")
    @classmethod
    def _reminders(cls, v: list[int]) -> list[int]:
        if any(m not in REMINDER_CHOICES for m in v):
            raise ValueError("지원하지 않는 알람 시점입니다.")
        return sorted(set(v), reverse=True)


class Event(CamelModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)

    id: uuid.UUID
    title: str
    kind: EventKind
    starts_at: datetime
    ends_at: datetime
    all_day: bool
    location: str | None = None
    memo: str | None = None
    attendees: list[Attendee] = Field(default_factory=list)
    reminders: list[int] = Field(default_factory=list)
    auto_record: bool
    auto_record_state: AutoRecordState
    auto_record_note: str | None = None
    job_id: str | None = None  # 이 회의의 녹음 작업 (moa-<UUID>)
    calendar_synced: bool = False  # Mac 캘린더 앱(→ 아이폰)에 내보냄
    calendar_error: str | None = None  # 내보내지 못한 이유
    created_at: datetime
    updated_at: datetime


class EventList(CamelModel):
    events: list[Event]


class FiredReminder(CamelModel):
    """울린 알람 (화면 알림용)"""

    event_id: uuid.UUID
    minutes_before: int
    sent_at: datetime
    message: str


class FiredReminderList(CamelModel):
    reminders: list[FiredReminder]


class AutoRecordReport(CamelModel):
    """자동 녹음 결과 (탭 → 서버)"""

    state: Literal["started", "skipped", "failed"]
    note: str | None = Field(default=None, max_length=255)


class MicHeartbeat(CamelModel):
    """말모아 탭 생존 신호 — 자동 녹음 사전 점검용"""

    mic_permission: Literal["granted", "prompt", "denied", "unknown"] = "unknown"


class CalendarSync(CamelModel):
    """Mac 캘린더 앱 → 아이폰 알림 내보내기 설정"""

    enabled: bool
    available: bool  # 이 서버가 Mac에서 도는지
    calendar_name: str
    failed: int = 0  # 내보내지 못한 앞으로의 일정 수


class CalendarSyncUpdate(CamelModel):
    enabled: bool
