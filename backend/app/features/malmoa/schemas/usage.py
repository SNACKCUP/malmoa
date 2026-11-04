from datetime import datetime

from pydantic import ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.features.malmoa.schemas.jobs import CamelModel

# 한도 입력칸의 상한: DB 칸(Integer)에 들어가고, 실수로 자릿수를 더 쳐도 막힌다
MAX_MONTHLY_TOKENS = 2_000_000_000
MAX_DAILY_CALLS = 1_000_000


class UsageTotals(CamelModel):
    calls: int
    input_tokens: int
    output_tokens: int
    tokens: int


class ModelUsage(UsageTotals):
    provider: str
    model: str


class UsageRecord(CamelModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)

    id: int
    created_at: datetime
    job_id: str | None  # 작업을 지웠으면 None
    file_name: str | None
    provider: str
    model: str
    calls: int
    input_tokens: int
    output_tokens: int


class UsageLimits(CamelModel):
    """비우면(None) 그 한도는 쓰지 않는다"""

    monthly_tokens: int | None = Field(default=None, ge=1, le=MAX_MONTHLY_TOKENS)
    daily_calls: int | None = Field(default=None, ge=1, le=MAX_DAILY_CALLS)


class UsageSummary(UsageLimits):
    today: UsageTotals
    month: UsageTotals
    all: UsageTotals
    month_start: datetime  # 이번 달 1일 0시 (한국 시간)
    next_day: datetime  # 하루 호출 수가 다시 0이 되는 때 (한국 시간 자정)
    by_model: list[ModelUsage]  # 이번 달, 많이 쓴 순
    recent: list[UsageRecord]  # 최근 기록 20개
