"""작업 상태 저장소 (PostgreSQL) + 파일 쓰기 도우미

작업 메타데이터는 DB(jobs 테이블)에, 큰 데이터(음성·원문·회의록)는 파일 저장소에 둔다.
JobStore는 요청 처리와 백그라운드 작업자 양쪽에서 쓰이므로 호출마다 짧은 세션을 연다.
작업 대기열도 jobs 테이블에 있다 (enqueue → claim → heartbeat → release, 끊기면 recover_stale).
"""

import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select, update

from app.features.malmoa.db import SessionLocal
from app.features.malmoa.job_id import is_job_id
from app.features.malmoa.models import Job as JobRow
from app.features.malmoa.schemas.jobs import Job, JobStatus

BUSY = (JobStatus.TRANSCRIBING, JobStatus.SUMMARIZING)
STALE_FAILED = "작업 중 서버가 여러 번 멈춰 중단했습니다. 다시 시도하면 완료된 구간부터 이어서 진행합니다."


def now() -> datetime:
    return datetime.now(UTC)


def write_json_atomic(path: Path, data: object) -> None:
    """임시 파일에 쓴 뒤 교체해, 중간에 끊겨도 파일이 깨지지 않게 한다."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def _key(job_id: str) -> str | None:
    return job_id if is_job_id(job_id) else None


class JobStore:
    def create(self, **fields) -> Job:
        with SessionLocal() as db:
            row = JobRow(**fields)
            db.add(row)
            db.commit()
            return Job.model_validate(row)

    def get(self, job_id: str) -> Job | None:
        key = _key(job_id)
        if key is None:
            return None
        with SessionLocal() as db:
            row = db.get(JobRow, key)
            return Job.model_validate(row) if row else None

    def list(self, user_id: int | None = None) -> list[Job]:
        with SessionLocal() as db:
            q = select(JobRow).order_by(JobRow.created_at.desc())
            if user_id is not None:
                q = q.where(JobRow.user_id == user_id)
            return [Job.model_validate(r) for r in db.scalars(q)]

    def update(self, job_id: str, **fields) -> Job:
        with SessionLocal() as db:
            row = db.get(JobRow, _key(job_id), with_for_update=True)
            if row is None:
                raise KeyError(str(job_id))
            for k, v in {**fields, "updated_at": now()}.items():
                setattr(row, k, v)
            db.commit()
            return Job.model_validate(row)

    def delete(self, job_id: str) -> None:
        with SessionLocal() as db:
            row = db.get(JobRow, _key(job_id))
            if row is not None:
                db.delete(row)
                db.commit()

    # ── 대기열 ──

    def enqueue(self, job_id: str, task: str, **fields) -> Job | None:
        """할 일을 대기열에 넣고 fields(화면에 보일 상태)를 함께 바꾼다. 이미 대기 중이거나 처리 중이면 None"""
        with SessionLocal() as db:
            row = db.get(JobRow, _key(job_id), with_for_update=True)
            if row is None:
                raise KeyError(str(job_id))
            if row.task is not None or row.status in BUSY:
                return None
            queue = {"task": task, "queued_at": now(), "claimed_by": None, "heartbeat_at": None, "attempts": 0}
            for k, v in {**fields, **queue, "updated_at": now()}.items():
                setattr(row, k, v)
            db.commit()
            return Job.model_validate(row)

    def claim(self, worker: str, tasks: tuple[str, ...]) -> tuple[str, str] | None:
        """맡을 수 있는 가장 오래된 작업 하나를 가져간다 → (할 일, 작업 ID). 여러 작업자가 동시에 불러도 같은 작업을 둘이 가져가지 않는다"""
        if not tasks:
            return None
        with SessionLocal() as db:
            q = (
                select(JobRow)
                .where(JobRow.task.in_(tasks), JobRow.claimed_by.is_(None))
                .order_by(JobRow.queued_at)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
            row = db.scalars(q).first()
            if row is None:
                return None
            row.claimed_by, row.heartbeat_at, row.attempts = worker, now(), row.attempts + 1
            db.commit()
            return row.task, row.id

    def heartbeat(self, job_id: str, worker: str) -> bool:
        """처리 중임을 알린다. 그사이 다른 작업자에게 넘어갔으면 False"""
        with SessionLocal() as db:
            n = db.execute(update(JobRow).where(JobRow.id == job_id, JobRow.claimed_by == worker).values(heartbeat_at=now())).rowcount
            db.commit()
            return n > 0

    def release(self, job_id: str, worker: str) -> None:
        """처리를 마치고 대기열에서 뺀다 (결과 상태는 처리 함수가 이미 기록했다)"""
        with SessionLocal() as db:
            db.execute(
                update(JobRow)
                .where(JobRow.id == job_id, JobRow.claimed_by == worker)
                .values(task=None, queued_at=None, claimed_by=None, heartbeat_at=None)
            )
            db.commit()

    def recover_stale(self, stale_seconds: int, max_attempts: int) -> tuple[str, ...]:
        """생존 신호가 끊긴 작업(서버가 꺼졌거나 멈춤)을 다시 대기열로 돌린다. max_attempts 번 끊긴 작업은 실패로 표시"""
        cutoff = now() - timedelta(seconds=stale_seconds)
        with SessionLocal() as db:
            q = select(JobRow).where(JobRow.claimed_by.is_not(None), JobRow.heartbeat_at < cutoff).with_for_update(skip_locked=True)
            rows = db.scalars(q).all()
            for row in rows:
                row.claimed_by, row.heartbeat_at, row.updated_at = None, None, now()
                if row.attempts >= max_attempts:
                    row.task, row.queued_at = None, None
                    row.status, row.progress, row.stage, row.error_message = JobStatus.FAILED, None, None, STALE_FAILED
                elif row.task == "minutes":
                    row.status, row.progress, row.stage = JobStatus.SUMMARIZING, 0, "회의록 작성이 중단되어 다시 순서를 기다리는 중"
                else:
                    row.status, row.progress, row.stage = JobStatus.QUEUED, 0, "변환이 중단되어 다시 순서를 기다리는 중"
            db.commit()
            return tuple(r.id for r in rows)
