"""탈퇴한 회원의 말모아 데이터 정리 (통합 단계 5-7, 결정 B: 탈퇴 30일 뒤)

meerkit 탈퇴는 회원 행을 지우지 않고 deactivated_at(탈퇴 시각)만 남긴다 — 1년 뒤 개인정보만 지운다(app/users/purge.py).
그래서 말모아 FK 의 ON DELETE CASCADE 가 일어나지 않으므로 여기서 지운다.
관리자 "비활성화"(is_active=false, deactivated_at 없음)는 탈퇴가 아니므로 건드리지 않는다.

지우는 것: 작업(원본·원문·회의록 파일과 임시 파일 포함), 끝내지 않은 업로드(객체 포함), 참석자 명단, 일정(알람 기록 포함),
AI 연결 설정·사용량·한도, 녹음기 생존 신호, 말모아 프로필(캘린더 구독 주소 포함). meerkit 회원 행은 그대로.
파일을 먼저 지우고 DB 행을 지운다 — 파일 삭제가 실패하면 행이 남아 다음 정리 때 다시 한다.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, exists, or_, select

from app.features.malmoa.config import get_settings
from app.features.malmoa.db import SessionLocal
from app.features.malmoa.models import (
    Event,
    Job,
    LlmSetting,
    LlmUsage,
    LlmUsageLimit,
    MalmoaProfile,
    PendingUpload,
    Person,
    RecorderBeat,
)
from app.features.malmoa.schemas.jobs import Job as JobSchema
from app.features.malmoa.services.file_store import StorageError, get_store, upload_key
from app.users.models import User

log = logging.getLogger(__name__)

TICK_SECONDS = 6 * 3600  # 서버가 깨어 있는 동안 이 간격으로 확인 (하루에 몇 번 돌아도 결과는 같다)
USER_TABLES = (Job, PendingUpload, Person, Event, LlmSetting, LlmUsage, LlmUsageLimit, RecorderBeat, MalmoaProfile)


def withdrawn_users(now: datetime | None = None) -> list[int]:
    """탈퇴한 지 withdrawn_data_days 가 지났고 말모아 데이터가 남은 회원 번호"""
    cutoff = (now or datetime.now(UTC)) - timedelta(days=get_settings().withdrawn_data_days)
    has_data = or_(*(exists().where(t.user_id == User.id) for t in USER_TABLES))
    with SessionLocal() as db:
        return list(db.scalars(select(User.id).where(User.deactivated_at.is_not(None), User.deactivated_at < cutoff, has_data).order_by(User.id)))


def purge_user(user_id: int) -> dict[str, int]:
    """회원 한 명의 말모아 데이터를 지운다. 지운 개수 (내용은 남기지 않는다)"""
    from app.features.malmoa.api.jobs import (
        delete_job_files,  # 작업 삭제 API 와 같은 삭제 범위
    )

    files = get_store()
    with SessionLocal() as db:
        jobs = list(db.scalars(select(Job).where(Job.user_id == user_id)))
        for job in jobs:
            delete_job_files(JobSchema.model_validate(job))
        uploads = list(db.scalars(select(PendingUpload).where(PendingUpload.user_id == user_id)))
        for up in uploads:
            files.delete(upload_key(up.stored_name))
        counts = {}
        for table in USER_TABLES:
            counts[table.__tablename__] = db.execute(delete(table).where(table.user_id == user_id)).rowcount
        db.commit()
    return counts


def purge_withdrawn(now: datetime | None = None, *, dry_run: bool = False) -> dict[int, dict[str, int] | None]:
    """기간이 지난 탈퇴 회원을 모두 정리한다. dry_run 이면 대상만 (값 None)"""
    result: dict[int, dict[str, int] | None] = {}
    for user_id in withdrawn_users(now):
        if dry_run:
            result[user_id] = None
            continue
        try:
            result[user_id] = purge_user(user_id)
            log.info("탈퇴 회원 말모아 데이터 정리: 회원 %d %s", user_id, {k: v for k, v in result[user_id].items() if v})
        except (OSError, StorageError):
            log.exception("탈퇴 회원 말모아 데이터 정리 실패: 회원 %d (다음에 다시)", user_id)
    return result


async def run_forever() -> None:
    """앱이 켜져 있는 동안 TICK_SECONDS 마다 (DB·저장소 작업은 스레드에서)"""
    while True:
        try:
            await asyncio.to_thread(purge_withdrawn)
        except Exception:
            log.exception("탈퇴 회원 정리 중 오류")
        await asyncio.sleep(TICK_SECONDS)


if __name__ == "__main__":  # 미리보기: uv run python -m app.features.malmoa.services.withdrawal
    print({uid: "정리 대상" for uid in purge_withdrawn(dry_run=True)} or "정리할 탈퇴 회원 없음")
