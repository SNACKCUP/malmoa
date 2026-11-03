"""회원별 말모아 설정 (malmoa_profiles). meerkit users 에 없는 값만 둔다"""

from datetime import datetime

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.features.malmoa.models import MalmoaProfile


def calendar_sync_on(db: Session, user_id: int) -> bool:
    """Mac 캘린더 앱 내보내기가 켜져 있는지 (설정한 적 없으면 꺼짐)"""
    profile = db.get(MalmoaProfile, user_id)
    return profile is not None and profile.calendar_sync


def set_calendar_sync(db: Session, user_id: int, enabled: bool) -> None:
    """켜기·끄기를 저장한다 (같은 회원의 요청이 동시에 와도 행은 하나). 커밋은 부르는 쪽이 한다"""
    db.execute(
        insert(MalmoaProfile)
        .values(user_id=user_id, calendar_sync=enabled)
        .on_conflict_do_update(index_elements=[MalmoaProfile.user_id], set_={"calendar_sync": enabled})
    )


def set_ics_token_hash(db: Session, user_id: int, token_hash: str | None, created_at: datetime | None) -> None:
    """캘린더 구독 주소를 새로 만들거나(해시) 끈다(None). 예전 주소는 바로 무효. 커밋은 부르는 쪽이 한다"""
    values = {"ics_token_hash": token_hash, "ics_created_at": created_at}
    db.execute(insert(MalmoaProfile).values(user_id=user_id, **values).on_conflict_do_update(index_elements=[MalmoaProfile.user_id], set_=values))
