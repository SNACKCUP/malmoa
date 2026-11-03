"""ORM 모델 — 스키마 변경은 Alembic 마이그레이션으로 (alembic revision --autogenerate)

회원은 meerkit users(정수 id)를 FK 로 쓴다. 회원별 말모아 값은 malmoa_profiles 에 둔다.

큰 데이터(음성, 변환 원문, 회의록 본문)는 storage/ 아래 파일로 두고, DB에는 상태와 메타데이터만 저장한다.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.features.malmoa.db import Base  # meerkit 과 같은 Base → Alembic 이 함께 관리
from app.features.malmoa.job_id import MAX_LENGTH as JOB_ID_LENGTH
from app.features.malmoa.job_id import new_job_id


class MalmoaProfile(Base):
    """회원별 말모아 설정 (meerkit users 에 없는 값). 처음 쓸 때 만든다"""

    __tablename__ = "malmoa_profiles"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    # 일정을 Mac 캘린더 앱으로 내보내 아이폰에서 알림 받기 (설정 화면, 기본 끔)
    calendar_sync: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(JOB_ID_LENGTH), primary_key=True, default=new_job_id)  # moa-<UUID>
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    file_name: Mapped[str] = mapped_column(String(255))
    stored_name: Mapped[str] = mapped_column(String(64))
    source: Mapped[str] = mapped_column(String(16))  # upload | recording | image
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    size_bytes: Mapped[int] = mapped_column(Integer)
    duration_sec: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16), index=True)
    progress: Mapped[int | None] = mapped_column(Integer)
    stage: Mapped[str | None] = mapped_column(String(255))
    error_message: Mapped[str | None] = mapped_column(Text)
    transcript_ready: Mapped[bool] = mapped_column(Boolean, default=False)
    minutes_ready: Mapped[bool] = mapped_column(Boolean, default=False)
    llm_tokens: Mapped[int | None] = mapped_column(Integer)
    # 이 회의의 참석자 [{name, role}] — 명단(people)에서 고른 그때의 이름을 복사해 둔다 (명단을 고쳐도 지난 회의는 그대로)
    attendees: Mapped[list[dict]] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    # 작업 대기열 (services/worker.py). 서버 메모리가 아니라 여기에 두어 재시작·서버 여러 대에서도 잃지 않는다.
    # task 가 있으면 대기 중이거나 처리 중, claimed_by 가 있으면 그 작업자가 처리 중 (heartbeat_at 으로 살아 있음을 알림)
    task: Mapped[str | None] = mapped_column(String(16))  # transcribe | minutes
    queued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    claimed_by: Mapped[str | None] = mapped_column(String(128))
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # 가져간 횟수 (끊겨서 다시 가져가면 늘어남)



class Person(Base):
    """자주 참석하는 사람 명단 — 회의마다 골라 참석자로 넣는다"""

    __tablename__ = "people"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_people_user_name"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(50))
    role: Mapped[str | None] = mapped_column(String(50))  # 소속·직책 (선택)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())



class Event(Base):
    """캘린더 일정 — 회의(녹음·자동 녹음 연결 가능) 또는 그 밖의 일정"""

    __tablename__ = "events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(16))  # meeting | other
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    location: Mapped[str | None] = mapped_column(String(200))
    memo: Mapped[str | None] = mapped_column(Text)
    attendees: Mapped[list[dict]] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    # 몇 분 전에 알릴지 (0 = 정시)
    reminders: Mapped[list[int]] = mapped_column(ARRAY(Integer), default=list, server_default=text("'{}'"))
    auto_record: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_record_state: Mapped[str] = mapped_column(String(16), default="none", server_default="none")  # none | armed | started | skipped | failed
    auto_record_note: Mapped[str | None] = mapped_column(String(255))  # 건너뛴·실패한 이유
    auto_record_warned: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))  # 시작 전 점검 알림을 보냈음
    # 이 회의의 녹음. 작업을 지워도 일정은 남는다
    job_id: Mapped[str | None] = mapped_column(String(JOB_ID_LENGTH), ForeignKey("jobs.id", ondelete="SET NULL"))
    calendar_uid: Mapped[str | None] = mapped_column(String(255))  # Mac 캘린더 앱에 만든 같은 일정 (휴대폰 알림용)
    calendar_error: Mapped[str | None] = mapped_column(String(255))  # 캘린더 앱에 내보내지 못한 이유 (성공하면 비움)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


    @property
    def calendar_synced(self) -> bool:
        return self.calendar_uid is not None and self.calendar_error is None


class RecorderBeat(Base):
    """말모아 탭의 마지막 생존 신호와 마이크 권한 (사용자마다 한 줄). 서버가 여러 대이거나 재시작해도 같은 값을 본다"""

    __tablename__ = "recorder_beats"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    mic_permission: Mapped[str] = mapped_column(String(16))  # granted | prompt | denied | unknown


class EventReminder(Base):
    """보낸 알람 기록 — 같은 알람이 다시 울리지 않게 한다. notified=false 는 울리지 않고 넘긴 것"""

    __tablename__ = "event_reminders"

    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), primary_key=True)
    minutes_before: Mapped[int] = mapped_column(Integer, primary_key=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    notified: Mapped[bool] = mapped_column(Boolean)
    message: Mapped[str | None] = mapped_column(String(300))


class LlmSetting(Base):
    """설정 화면에서 고른 AI 회의록 제공자·모델·API 키 (사용자마다 하나). 없으면 .env 값을 쓴다"""

    __tablename__ = "llm_settings"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    provider: Mapped[str] = mapped_column(String(16))  # openai | anthropic | gemini | compatible
    model: Mapped[str] = mapped_column(String(128))
    base_url: Mapped[str | None] = mapped_column(String(255))
    # 키 원문은 저장하지 않는다: Fernet 암호문과 화면 표시용 앞뒤 몇 글자만
    api_key_enc: Mapped[str | None] = mapped_column(Text)
    key_hint: Mapped[str | None] = mapped_column(String(32))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())




class PendingUpload(Base):
    """브라우저가 저장소(R2)에 바로 올리는 중인 파일 (통합 단계 5-2). 올리기가 끝났다고 알리면 jobs 행을 만들고 지운다.
    끝내지 않은 것은 하루 뒤 객체와 함께 지운다 (api/jobs.py cleanup_uploads). 작업 목록에는 보이지 않는다."""

    __tablename__ = "malmoa_uploads"

    id: Mapped[str] = mapped_column(String(JOB_ID_LENGTH), primary_key=True)  # 확정되면 이 값이 작업 id 가 된다
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    file_name: Mapped[str] = mapped_column(String(255))
    stored_name: Mapped[str] = mapped_column(String(64))
    source: Mapped[str] = mapped_column(String(16))  # upload | recording | image
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer)  # 브라우저가 알린 크기 — 끝낼 때 저장소의 실제 크기와 같아야 한다
    attendees: Mapped[list[dict]] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    event_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("events.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

class LlmUsage(Base):
    """AI 호출 기록: 회의록을 만들며 AI를 부를 때마다 한 줄 (실패한 시도 포함).
    작업을 지워도 남는다 (job_id만 비고 file_name은 그대로)"""

    __tablename__ = "llm_usage"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[str | None] = mapped_column(String(JOB_ID_LENGTH), ForeignKey("jobs.id", ondelete="SET NULL"))
    file_name: Mapped[str | None] = mapped_column(String(255))
    provider: Mapped[str] = mapped_column(String(16))
    model: Mapped[str] = mapped_column(String(128))
    calls: Mapped[int] = mapped_column(Integer)  # 보통 1. 예전 기록을 옮긴 줄은 그 회의록의 호출 수
    input_tokens: Mapped[int] = mapped_column(Integer)
    output_tokens: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class LlmUsageLimit(Base):
    """사용자가 직접 넣는 AI 사용 한도 (제공자의 남은 양은 일반 API 키로 알 수 없어서). 비우면 한도 없음"""

    __tablename__ = "llm_usage_limits"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    monthly_tokens: Mapped[int | None] = mapped_column(Integer)
    daily_calls: Mapped[int | None] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
