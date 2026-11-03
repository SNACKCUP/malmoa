import uuid
from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """JSON은 프런트엔드 관례에 맞춰 camelCase로 주고받는다."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class JobStatus(StrEnum):
    QUEUED = "QUEUED"
    TRANSCRIBING = "TRANSCRIBING"
    SUMMARIZING = "SUMMARIZING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class Attendee(CamelModel):
    """회의 참석자 한 명"""

    name: str = Field(min_length=1, max_length=50)
    role: str | None = Field(default=None, max_length=50)  # 소속·직책 (선택)

    @field_validator("name", "role", mode="before")
    @classmethod
    def _strip(cls, v: object) -> object:
        # 앞뒤 공백을 지우고, 빈 소속은 없음으로
        if isinstance(v, str):
            v = " ".join(v.split())
            return v or None
        return v


MAX_ATTENDEES = 100


def unique_attendees(items: list[Attendee]) -> list[Attendee]:
    """이름이 같은 사람은 한 번만 (먼저 나온 것 유지)"""
    seen: set[str] = set()
    out = []
    for a in items:
        if a.name not in seen:
            seen.add(a.name)
            out.append(a)
    return out


class Job(CamelModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)

    id: str  # moa-<UUID>
    user_id: int
    file_name: str  # 사용자가 올린 원래 이름 (표시용)
    stored_name: str  # storage/uploads 안의 실제 파일 이름
    source: Literal["upload", "recording", "image"]
    created_at: datetime
    updated_at: datetime
    size_bytes: int
    duration_sec: float | None = None
    status: JobStatus = JobStatus.QUEUED
    progress: int | None = None  # 0–100, 진행 중일 때만
    stage: str | None = None  # 사용자에게 보여 줄 현재 단계 설명
    error_message: str | None = None
    transcript_ready: bool = False
    minutes_ready: bool = False
    llm_tokens: int | None = None  # 이 작업에 쓴 AI API 토큰 합계 (비용 확인용)
    attendees: list[Attendee] = []
    task: str | None = Field(default=None, exclude=True)  # 대기열의 할 일 (있으면 대기 중이거나 처리 중). 응답에는 넣지 않는다


class AttendeesUpdate(CamelModel):
    attendees: list[Attendee] = Field(max_length=MAX_ATTENDEES)


class Person(CamelModel):
    """참석자 명단의 한 사람"""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)

    id: uuid.UUID
    name: str
    role: str | None = None
    created_at: datetime


class PersonList(CamelModel):
    people: list[Person]


class JobList(CamelModel):
    jobs: list[Job]


class TranscriptSegment(CamelModel):
    start: float
    end: float
    text: str
    confidence: float | None = None  # 사진 글자 인식의 확신도 (음성은 없음)


class Transcript(CamelModel):
    job_id: str
    text: str
    segments: list[TranscriptSegment]
    edited: bool = False  # 사용자가 원문을 직접 고쳤는지


class TranscriptUpdate(CamelModel):
    """원문 수정: 문장마다 바뀐 글자만 보낸다 (시간 정보는 서버에 있는 값 유지). 빈 문장은 지운다"""

    texts: list[str] = Field(max_length=20_000)


class MinutesDoc(CamelModel):
    job_id: str
    markdown: str
    generated_at: str | None = None
    model: str | None = None
    edited: bool = False


class MinutesUpdate(CamelModel):
    markdown: str = Field(max_length=200_000)


class Health(CamelModel):
    status: Literal["ok"]
    database: Literal["ok"]  # DB 에 닿지 않으면 이 응답 대신 503
    transcriber: str  # 음성 변환 방식 (TRANSCRIBER: local_whisper | none)
    whisper_model: str
    ffmpeg: bool
    llm_configured: bool
    llm_model: str | None
    max_upload_mb: int


class ErrorResponse(BaseModel):
    detail: str
