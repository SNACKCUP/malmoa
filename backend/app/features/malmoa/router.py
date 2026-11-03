"""말모아 API 묶음 — app/api.py 에서 한 번 등록한다 (main.py 가 "/api" 아래에 붙인다)

서버 시작·종료 때 할 일(작업자·알람 검사기·저장소 확인)은 이 라우터의 lifespan 으로 붙인다.
FastAPI 가 라우터 lifespan 을 앱의 것과 합쳐 주므로 meerkit main.py 를 고치지 않는다.
"""

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app.features.malmoa.api import events, jobs, llm_settings, people, recorder, usage
from app.features.malmoa.config import get_settings
from app.features.malmoa.db import engine
from app.features.malmoa.schemas.jobs import ErrorResponse, Health
from app.features.malmoa.services import reminders
from app.features.malmoa.services.file_store import get_store
from app.features.malmoa.services.transcriber import ffmpeg_exe
from app.features.malmoa.services.worker import Worker
from app.features.malmoa.store import JobStore

log = logging.getLogger("malmoa")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    # 변환 임시 폴더는 항상 로컬. 원본·원문·회의록은 저장소(MALMOA_FILES_BACKEND) — 쓸 수 없으면 이유를 알리고 시작하지 않는다
    settings.work_dir.mkdir(parents=True, exist_ok=True)
    if settings.storage_backend == "local":
        for d in (settings.uploads_dir, settings.transcripts_dir, settings.minutes_dir):
            d.mkdir(parents=True, exist_ok=True)
    get_store().check()

    # 말모아 표가 있는지 확인 — 없으면 마이그레이션을 안내하고 시작하지 않는다
    try:
        with engine.connect() as conn:
            conn.execute(text("select 1 from jobs limit 1"))
    except OperationalError as e:
        raise RuntimeError("PostgreSQL에 연결할 수 없습니다. backend/.env 의 DATABASE_URL 과 DB 실행 여부를 확인하세요.") from e
    except Exception as e:
        raise RuntimeError("말모아 표가 없습니다. backend 폴더에서 uv run alembic upgrade head 를 실행하세요.") from e

    store = JobStore()
    # 작업 대기열은 DB 에 있다. 서버가 꺼질 때 처리 중이던 작업은 생존 신호가 끊긴 뒤 작업자가 다시 대기열로 돌려
    # 완료된 구간부터 이어서 처리한다 (services/worker.py). 다른 서버가 처리 중인 작업은 건드리지 않는다.
    worker = Worker(store, settings)
    worker.start()
    app.state.store = store
    app.state.worker = worker
    # 일정 알람 검사기 (REMINDERS_ENABLED=false 면 끔)
    reminder_task = asyncio.create_task(reminders.run_forever()) if settings.reminders_enabled else None
    yield
    worker.stop()
    if reminder_task:
        reminder_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await reminder_task


router = APIRouter(lifespan=lifespan)
for sub in (jobs, people, events, recorder, llm_settings, usage):
    router.include_router(sub.router)


@router.get("/health", response_model=Health, tags=["system"], responses={503: {"model": ErrorResponse}})
def health() -> Health:
    """상태 확인 (DB 연결 포함 — 깨우기 요청이 이 주소를 부른다). DB 에 닿지 않으면 503.
    llm_configured·llm_model은 backend/.env 예비 값 기준 (실제 연결은 GET /api/settings/llm)"""
    try:
        with engine.connect() as conn:
            conn.execute(text("select 1"))
    except Exception:
        log.exception("상태 확인: DB 연결 실패")
        raise HTTPException(503, "DB에 연결할 수 없습니다.") from None
    settings = get_settings()
    return Health(
        status="ok",
        database="ok",
        transcriber=settings.transcriber,
        whisper_model=settings.whisper_model,
        ffmpeg=ffmpeg_exe() is not None,
        llm_configured=bool(settings.openai_api_key and settings.openai_model),
        llm_model=settings.openai_model or None,
        max_upload_mb=settings.max_upload_mb,
    )
