"""AI 사용량: 호출마다 기록하고, 오늘·이번 달·전체로 모아 보여 준다 (docs/2026-11-02-AI사용량.md)

- 제공자의 남은 크레딧·무료 한도는 일반 API 키로 알 수 없다. 그래서 말모아가 직접 쓴 양을 세고,
  사용자가 넣은 한도(한 달 토큰 수·하루 호출 수)와 비교한다.
- 하루·한 달의 경계는 한국 시간 자정·1일이다.
"""

import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.features.malmoa.db import SessionLocal
from app.features.malmoa.models import LlmUsage, LlmUsageLimit
from app.features.malmoa.store import now

log = logging.getLogger(__name__)

KST = ZoneInfo("Asia/Seoul")
RECENT = 20


def record(user_id: int, job_id: str | None, file_name: str | None, provider: str, model: str, input_tokens: int, output_tokens: int) -> None:
    """AI 호출 한 번을 기록한다. 기록이 실패해도 회의록 작성은 멈추지 않는다"""
    try:
        with SessionLocal() as db:
            db.add(
                LlmUsage(
                    user_id=user_id,
                    job_id=job_id,
                    file_name=file_name,
                    provider=provider,
                    model=model,
                    calls=1,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                )
            )
            db.commit()
    except Exception:
        log.exception("AI 사용량을 기록하지 못했습니다: %s", job_id)


def period_starts(at: datetime | None = None) -> tuple[datetime, datetime]:
    """(오늘 0시, 이번 달 1일 0시) — 한국 시간"""
    local = (at or now()).astimezone(KST)
    today = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return today, today.replace(day=1)


def _totals(db: Session, user_id: int, since: datetime | None = None) -> dict:
    q = select(
        func.coalesce(func.sum(LlmUsage.calls), 0),
        func.coalesce(func.sum(LlmUsage.input_tokens), 0),
        func.coalesce(func.sum(LlmUsage.output_tokens), 0),
    ).where(LlmUsage.user_id == user_id)
    if since is not None:
        q = q.where(LlmUsage.created_at >= since)
    calls, inp, out = db.execute(q).one()
    return {"calls": int(calls), "input_tokens": int(inp), "output_tokens": int(out), "tokens": int(inp) + int(out)}


def summary(db: Session, user_id: int, at: datetime | None = None) -> dict:
    today, month = period_starts(at)
    by_model = db.execute(
        select(
            LlmUsage.provider,
            LlmUsage.model,
            func.sum(LlmUsage.calls),
            func.sum(LlmUsage.input_tokens),
            func.sum(LlmUsage.output_tokens),
        )
        .where(LlmUsage.user_id == user_id, LlmUsage.created_at >= month)
        .group_by(LlmUsage.provider, LlmUsage.model)
        .order_by(func.sum(LlmUsage.input_tokens + LlmUsage.output_tokens).desc())
    ).all()
    recent = db.scalars(select(LlmUsage).where(LlmUsage.user_id == user_id).order_by(LlmUsage.created_at.desc(), LlmUsage.id.desc()).limit(RECENT)).all()
    limit = db.get(LlmUsageLimit, user_id)
    return {
        "today": _totals(db, user_id, today),
        "month": _totals(db, user_id, month),
        "all": _totals(db, user_id),
        "month_start": month,
        "next_day": today + timedelta(days=1),
        "by_model": [
            {"provider": p, "model": m, "calls": int(c), "input_tokens": int(i), "output_tokens": int(o), "tokens": int(i) + int(o)} for p, m, c, i, o in by_model
        ],
        "recent": recent,
        "monthly_tokens": limit.monthly_tokens if limit else None,
        "daily_calls": limit.daily_calls if limit else None,
    }


def save_limits(db: Session, user_id: int, monthly_tokens: int | None, daily_calls: int | None) -> None:
    row = db.get(LlmUsageLimit, user_id)
    if row is None:
        row = LlmUsageLimit(user_id=user_id)
        db.add(row)
    row.monthly_tokens = monthly_tokens
    row.daily_calls = daily_calls
    db.commit()
