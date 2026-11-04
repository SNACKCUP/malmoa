"""Mac 작업자 API (통합 단계 5-3, 결정 5 (가)) — 음성 인식·사진 글자 인식을 Mac 이 API 로 가져가 처리한다

Mac 에는 작업자 전용 열쇠(MALMOA_WORKER_TOKEN)와 API 주소만 둔다. DB 비밀번호·저장소 키는 두지 않는다.
서버 .env 에는 열쇠의 SHA-256 해시(MALMOA_WORKER_TOKEN_HASH)만 둔다. 회원 로그인 토큰으로는 이 API 를 쓸 수 없다.

흐름 (scripts/malmoa_worker.py):
  POST /api/worker/claim                       맡을 변환 하나 (없으면 204)
  GET  /api/worker/jobs/{id}/source            원본 파일 (백엔드가 저장소에서 읽어 전달 — 읽기 서명 주소는 만들지 않는다)
  POST /api/worker/jobs/{id}/report            진행 상황 + 생존 신호
  PUT  /api/worker/jobs/{id}/transcript        원문 저장 + 완료 (대기열에서 뺀다)
  POST /api/worker/jobs/{id}/fail              실패 (대기열에서 뺀다)
작업을 가져간 작업자만(X-Malmoa-Worker 헤더) 그 작업을 바꿀 수 있다. 생존 신호가 끊기면 서버가 다시 대기열로 돌린다.
"""

import hashlib
import hmac
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse
from fastapi.security.utils import get_authorization_scheme_param
from pydantic import Field

from app.features.malmoa.config import get_settings
from app.features.malmoa.job_id import is_job_id
from app.features.malmoa.schemas.jobs import CamelModel, ErrorResponse
from app.features.malmoa.services.file_store import StorageError, get_store, upload_key
from app.features.malmoa.services.transcriber import LocalJobIO
from app.features.malmoa.store import JobStore

router = APIRouter(prefix="/worker", tags=["worker"])

TASKS = ("transcribe",)  # Mac 이 맡는 일. AI 회의록(minutes)은 서버 작업자가 한다
WorkerId = Annotated[str, Header(alias="X-Malmoa-Worker", min_length=3, max_length=120, description="작업을 가져간 작업자 (claim 때 보낸 값)")]


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def require_worker(request: Request) -> None:
    expected = get_settings().malmoa_worker_token_hash.strip().lower()
    if not expected:
        raise HTTPException(503, "작업자 열쇠가 설정되지 않았습니다 (MALMOA_WORKER_TOKEN_HASH).")
    scheme, token = get_authorization_scheme_param(request.headers.get("Authorization"))
    if scheme.lower() != "bearer" or not token or not hmac.compare_digest(token_hash(token), expected):
        raise HTTPException(401, "작업자 열쇠가 맞지 않습니다.", headers={"WWW-Authenticate": "Bearer"})


Worker = Annotated[None, Depends(require_worker)]
ERRORS = {401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 503: {"model": ErrorResponse}}


class ClaimRequest(CamelModel):
    worker: str = Field(min_length=3, max_length=120)
    tasks: list[Literal["transcribe"]] = Field(default_factory=lambda: ["transcribe"])


class ClaimedJob(CamelModel):
    job_id: str
    task: Literal["transcribe"]
    source: str  # upload | recording | image (image 면 글자 인식)
    file_name: str
    stored_name: str
    size_bytes: int


class Report(CamelModel):
    start: bool = False
    stage: str | None = Field(default=None, max_length=255)
    progress: int | None = Field(default=None, ge=0, le=100)
    duration_sec: float | None = Field(default=None, ge=0)


class Segment(CamelModel):
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    text: str = Field(max_length=10_000)


class TranscriptIn(CamelModel):
    segments: list[Segment] | None = None  # None: 이미 있는 원문을 그대로 쓴다
    timed: bool = True
    stage: str = Field(default="변환 완료", max_length=255)


class FailIn(CamelModel):
    message: str = Field(min_length=1, max_length=500)


def _store(request: Request) -> JobStore:
    return request.app.state.store


def _owned(request: Request, job_id: str, worker: str) -> LocalJobIO:
    """이 작업자가 가져간 작업이면 생존 신호를 남기고 서버 쪽 입출력을 돌려준다. 아니면 409 (끊겨서 다른 작업자에게 넘어감 등)"""
    if not is_job_id(job_id):
        raise HTTPException(404, "작업을 찾을 수 없습니다.")
    store = _store(request)
    job = store.get(job_id)
    if job is None:
        raise HTTPException(404, "작업을 찾을 수 없습니다.")
    if not store.heartbeat(job_id, worker):
        raise HTTPException(409, "이 작업자가 가져간 작업이 아닙니다 (생존 신호가 끊겨 다시 대기열로 갔을 수 있음).")
    return LocalJobIO(job_id, job.stored_name, store, get_settings())


@router.post("/claim", response_model=ClaimedJob, responses={**ERRORS, 204: {"description": "맡을 작업 없음"}})
def claim(request: Request, _: Worker, body: ClaimRequest) -> ClaimedJob | Response:
    """맡을 변환 하나. 끊긴 작업을 먼저 대기열로 돌리고, 원문이 이미 있는 작업은 서버가 바로 완료 처리한다"""
    settings = get_settings()
    store = _store(request)
    store.recover_stale(settings.job_stale_seconds, settings.job_max_attempts)
    while True:
        claimed = store.claim(body.worker, tuple(body.tasks) or TASKS)
        if claimed is None:
            return Response(status_code=status.HTTP_204_NO_CONTENT)
        task, job_id = claimed
        job = store.get(job_id)
        io = LocalJobIO(job_id, job.stored_name, store, settings)
        if io.has_transcript():  # 이미 변환된 작업 — Mac 에 보낼 필요 없음
            io.finish(None, timed=True, stage="변환 완료")
            store.release(job_id, body.worker)
            continue
        return ClaimedJob(job_id=job_id, task=task, source=job.source, file_name=job.file_name, stored_name=job.stored_name, size_bytes=job.size_bytes)


@router.get("/jobs/{job_id}/source", responses=ERRORS)
def source(request: Request, _: Worker, worker: WorkerId, job_id: str) -> StreamingResponse:
    """원본 파일 (조금씩 읽어 보낸다)"""
    io = _owned(request, job_id, worker)
    try:
        chunks = get_store().iter_bytes(upload_key(io.stored_name))
    except FileNotFoundError:
        raise HTTPException(404, "원본 파일이 없습니다.") from None
    except StorageError:
        raise HTTPException(503, "파일 저장소에 연결하지 못했습니다.") from None
    return StreamingResponse(chunks, media_type="application/octet-stream")


@router.post("/jobs/{job_id}/report", status_code=status.HTTP_204_NO_CONTENT, responses=ERRORS)
def report(request: Request, _: Worker, worker: WorkerId, job_id: str, body: Report) -> Response:
    """진행 상황. 값 없이 보내면 생존 신호만"""
    io = _owned(request, job_id, worker)
    if body.start or body.stage is not None or body.progress is not None or body.duration_sec is not None:
        io.report(start=body.start, stage=body.stage, progress=body.progress, duration_sec=body.duration_sec)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/jobs/{job_id}/transcript", status_code=status.HTTP_204_NO_CONTENT, responses=ERRORS)
def transcript(request: Request, _: Worker, worker: WorkerId, job_id: str, body: TranscriptIn) -> Response:
    """원문 저장 + 완료. 대기열에서 뺀다"""
    io = _owned(request, job_id, worker)
    segments = None if body.segments is None else [s.model_dump() for s in body.segments]
    if segments is None and not io.has_transcript():
        raise HTTPException(400, "원문이 없습니다.")
    try:
        io.finish(segments, timed=body.timed, stage=body.stage)
    except StorageError:
        raise HTTPException(503, "파일 저장소에 저장하지 못했습니다. 다시 시도해 주세요.") from None
    _store(request).release(job_id, worker)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/jobs/{job_id}/fail", status_code=status.HTTP_204_NO_CONTENT, responses=ERRORS)
def fail(request: Request, _: Worker, worker: WorkerId, job_id: str, body: FailIn) -> Response:
    """변환 실패 — 사용자에게 보일 이유와 함께. 대기열에서 뺀다 (사용자가 다시 시도하면 완료된 구간부터 이어서)"""
    io = _owned(request, job_id, worker)
    io.fail(body.message)
    _store(request).release(job_id, worker)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router", "token_hash"]
