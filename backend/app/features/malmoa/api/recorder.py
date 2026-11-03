"""녹음 탭 상태 — 자동 녹음 사전 점검 (docs/2026-10-29-일정·알람·자동녹음.md 3장)"""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.features.malmoa.db import get_db
from app.features.malmoa.deps import CurrentUser
from app.features.malmoa.schemas.events import MicHeartbeat
from app.features.malmoa.services import auto_record

router = APIRouter(prefix="/recorder", tags=["recorder"])


@router.post("/heartbeat", status_code=status.HTTP_204_NO_CONTENT)
def heartbeat(body: MicHeartbeat, user: CurrentUser, db: Annotated[Session, Depends(get_db)]) -> Response:
    """말모아 탭이 30초마다 보낸다: 탭이 열려 있음 + 마이크 권한 상태. 사용자마다 마지막 하나만 DB 에 둔다"""
    auto_record.beat(db, user.id, body.mic_permission)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
