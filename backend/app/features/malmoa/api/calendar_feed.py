"""캘린더 구독 주소 (ICS, 통합 단계 5-6) — 배포 서버에는 Mac 캘린더 앱이 없어 아이폰 일정 알림을 이것으로 대신한다

회원 (로그인·승인):  GET /api/calendar-feed 켜짐 여부 · POST 새로 만들기(예전 주소 무효, 주소는 이때 한 번만) · DELETE 끄기
캘린더 앱 (로그인 없음, 비밀 주소가 열쇠):  GET /api/calendar-feed/{비밀값}.ics
서버에는 비밀값의 SHA-256 만 둔다. 탈퇴·정지·승인 취소된 회원의 주소는 404.
"""

import hashlib
import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.features.malmoa.config import get_settings
from app.features.malmoa.db import get_db
from app.features.malmoa.deps import APPROVED_ROLES, CurrentUser
from app.features.malmoa.models import Event as EventRow
from app.features.malmoa.models import MalmoaProfile
from app.features.malmoa.schemas.jobs import CamelModel, ErrorResponse
from app.features.malmoa.services import ics, profiles
from app.users.models import User

router = APIRouter(prefix="/calendar-feed", tags=["calendar-feed"])
DB = Annotated[Session, Depends(get_db)]
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{40,64}$")  # secrets.token_urlsafe(32) = 43자
NOT_FOUND = "구독 주소를 찾을 수 없습니다."


class FeedStatus(CamelModel):
    enabled: bool
    created_at: datetime | None = None


class FeedCreated(CamelModel):
    path: str  # 화면이 자기 주소(origin)를 앞에 붙여 보여 준다. 이 응답 말고는 다시 볼 수 없다
    created_at: datetime


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@router.get("", response_model=FeedStatus, responses={401: {"model": ErrorResponse}})
def get_status(db: DB, user: CurrentUser) -> FeedStatus:
    profile = db.get(MalmoaProfile, user.id)
    on = profile is not None and profile.ics_token_hash is not None
    return FeedStatus(enabled=on, created_at=profile.ics_created_at if on else None)


@router.post("", status_code=status.HTTP_201_CREATED, response_model=FeedCreated, responses={401: {"model": ErrorResponse}})
def create(db: DB, user: CurrentUser) -> FeedCreated:
    """새 구독 주소. 이미 있으면 바꾼다 (예전 주소는 바로 404)"""
    token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    profiles.set_ics_token_hash(db, user.id, _hash(token), now)
    db.commit()
    return FeedCreated(path=f"/api/calendar-feed/{token}.ics", created_at=now)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT, responses={401: {"model": ErrorResponse}})
def disable(db: DB, user: CurrentUser) -> Response:
    profiles.set_ics_token_hash(db, user.id, None, None)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{token}.ics", responses={404: {"model": ErrorResponse}})
def feed(token: str, db: DB) -> Response:
    """캘린더 앱이 받아 가는 일정 (지난 30일 ~ 앞으로 400일)"""
    if not TOKEN_RE.match(token):
        raise HTTPException(404, NOT_FOUND)
    profile = db.scalar(select(MalmoaProfile).where(MalmoaProfile.ics_token_hash == _hash(token)))
    user = db.get(User, profile.user_id) if profile else None
    if user is None or not user.is_active or user.deactivated_at is not None or APPROVED_ROLES.isdisjoint(user.role_codes):
        raise HTTPException(404, NOT_FOUND)
    now = datetime.now(UTC)
    rows = db.scalars(
        select(EventRow)
        .where(EventRow.user_id == user.id, EventRow.ends_at >= now - timedelta(days=ics.PAST_DAYS), EventRow.starts_at <= now + timedelta(days=ics.FUTURE_DAYS))
        .order_by(EventRow.starts_at)
        .limit(2000)
    )
    body = ics.build_ics(rows, get_settings().tz, now)
    return Response(
        content=body.encode(),
        media_type="text/calendar; charset=utf-8",
        headers={"Cache-Control": "private, max-age=300", "Content-Disposition": 'inline; filename="malmoa.ics"', "X-Robots-Tag": "noindex"},
    )
