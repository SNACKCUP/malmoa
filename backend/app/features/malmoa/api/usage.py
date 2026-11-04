"""AI 사용량 — 말모아가 회의록 작성에 쓴 AI 호출·토큰과 사용자가 정한 한도 (docs/2026-11-02-AI사용량.md)"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.features.malmoa.db import get_db
from app.features.malmoa.deps import CurrentUser
from app.features.malmoa.schemas.jobs import ErrorResponse
from app.features.malmoa.schemas.usage import UsageLimits, UsageSummary
from app.features.malmoa.services import ai_usage

router = APIRouter(prefix="/usage", tags=["usage"])

DB = Annotated[Session, Depends(get_db)]


@router.get("", response_model=UsageSummary)
def get_usage(db: DB, user: CurrentUser) -> UsageSummary:
    """오늘·이번 달·전체 사용량, 이번 달 모델별, 최근 기록, 한도"""
    return UsageSummary.model_validate(ai_usage.summary(db, user.id))


@router.put("/limits", response_model=UsageSummary, responses={422: {"model": ErrorResponse}})
def save_limits(body: UsageLimits, db: DB, user: CurrentUser) -> UsageSummary:
    """한 달 토큰 한도·하루 호출 한도 저장 (비우면 한도 없음)"""
    ai_usage.save_limits(db, user.id, body.monthly_tokens, body.daily_calls)
    return UsageSummary.model_validate(ai_usage.summary(db, user.id))
