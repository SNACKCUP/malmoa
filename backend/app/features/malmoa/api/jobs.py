import json
import logging
import mimetypes
import shutil
import uuid
from datetime import timedelta
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import quote

from fastapi import (
    APIRouter,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import Response, StreamingResponse
from pydantic import ValidationError
from sqlalchemy import delete, func, select

from app.core.exceptions import ConflictError
from app.features.malmoa.config import get_settings
from app.features.malmoa.db import SessionLocal
from app.features.malmoa.deps import CurrentUser
from app.features.malmoa.job_id import is_job_id, new_job_id
from app.features.malmoa.models import Event as EventRow
from app.features.malmoa.models import PendingUpload
from app.features.malmoa.schemas.jobs import (
    AttendeesUpdate,
    ErrorResponse,
    Job,
    JobList,
    JobStatus,
    MinutesDoc,
    MinutesUpdate,
    Transcript,
    TranscriptUpdate,
    UploadStart,
    UploadTicket,
    unique_attendees,
)
from app.features.malmoa.services import export, llm, speech_engines
from app.features.malmoa.services.file_store import (
    MARKDOWN,
    StorageError,
    delete_prefix,
    get_json,
    get_store,
    get_text,
    job_prefixes,
    minutes_keys,
    minutes_notes_prefix,
    put_json,
    put_text,
    transcript_keys,
    upload_key,
)
from app.features.malmoa.services.minutes import markdown_to_text
from app.features.malmoa.services.transcriber import write_transcript
from app.features.malmoa.services.worker import Worker
from app.features.malmoa.store import JobStore, now

router = APIRouter(prefix="/jobs", tags=["jobs"])
log = logging.getLogger(__name__)

ERRORS = {401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}}
CHUNK = 1024 * 1024


def _store(request: Request) -> JobStore:
    return request.app.state.store


def _worker(request: Request) -> Worker:
    return request.app.state.worker


def _busy(job: Job) -> bool:
    """대기열에 있거나 처리 중 (어느 서버의 작업자든)"""
    return job.task is not None or job.status in (JobStatus.TRANSCRIBING, JobStatus.SUMMARIZING)


def _get_job(request: Request, job_id: str, user: CurrentUser) -> Job:
    # job_id가 파일 경로로 쓰이므로 moa-<UUID> 형식만 허용한다. 다른 사용자의 작업은 없는 것처럼 404.
    if not is_job_id(job_id):
        raise HTTPException(404, "작업을 찾을 수 없습니다.")
    job = _store(request).get(job_id)
    if job is None or job.user_id != user.id:
        raise HTTPException(404, "작업을 찾을 수 없습니다.")
    return job


def _display_name(raw: str | None) -> str:
    # 경로 문자를 제거한 표시용 이름. 저장 파일 이름에는 쓰지 않는다.
    name = Path((raw or "").replace("\\", "/")).name.strip()
    return name[:200] or "녹음"


def _parse_attendees(raw: str | None) -> list[dict]:
    """업로드 폼의 attendees: JSON 배열 문자열 [{"name": "홍길동", "role": "기획팀"}]"""
    if not raw:
        return []
    try:
        body = AttendeesUpdate.model_validate({"attendees": json.loads(raw)})
    except (json.JSONDecodeError, ValidationError):
        raise HTTPException(400, "참석자 형식이 올바르지 않습니다. 이름은 1~50자로 적어 주세요.")
    return [a.model_dump() for a in unique_attendees(body.attendees)]


def _own_event(user: CurrentUser, event_id: str | None) -> uuid.UUID | None:
    """업로드 폼의 event_id: 내 일정이어야 한다 (파일을 받기 전에 확인)"""
    if not event_id:
        return None
    try:
        key = uuid.UUID(event_id)
    except ValueError:
        raise HTTPException(400, "연결할 일정을 찾을 수 없습니다.")
    with SessionLocal() as db:
        ev = db.get(EventRow, key)
        if ev is None:
            # 녹음하는 사이 일정이 지워졌다: 녹음은 일정 없이 받는다
            return None
        if ev.user_id != user.id:
            raise HTTPException(400, "연결할 일정을 찾을 수 없습니다.")
    return key


def _checked_name(raw: str | None, source: str) -> tuple[str, str, str]:
    """(표시 이름, 확장자, source). 지원하지 않는 형식이면 400. 사진 확장자면 source=image"""
    settings = get_settings()
    file_name = _display_name(raw)
    ext = Path(file_name).suffix.lower()
    if ext not in settings.allowed_extensions:
        allowed = ", ".join(e.lstrip(".").upper() for e in settings.allowed_extensions)
        raise HTTPException(400, f"지원하지 않는 파일 형식입니다. ({allowed})")
    return file_name, ext, "image" if ext in settings.image_extensions else source


def _too_big() -> HTTPException:
    return HTTPException(413, f"파일이 너무 큽니다. 최대 {get_settings().max_upload_mb}MB까지 올릴 수 있습니다.")


def _new_job(request: Request, *, job_id: str, user_id: int, file_name: str, stored_name: str, source: str, size: int, attendees: list[dict], event_key: uuid.UUID | None) -> Job:
    """저장소에 원본이 들어간 뒤 작업 기록을 만든다 (서버로 올리기·직접 올리기 공통)"""
    ts = now()
    job = _store(request).create(
        id=job_id,
        user_id=user_id,
        file_name=file_name,
        stored_name=stored_name,
        source=source,
        created_at=ts,
        updated_at=ts,
        size_bytes=size,
        status=JobStatus.QUEUED,
        stage="글자 읽기 대기" if source == "image" else "변환 대기",
        attendees=attendees,
    )
    if event_key:
        _link_event(event_key, job.id)
    return job


def _link_event(event_id: uuid.UUID, job_id: str) -> None:
    # 녹음을 처음 시작한 일정에 연결한다. 일정이 그사이 지워졌으면 그냥 넘어간다
    with SessionLocal() as db:
        ev = db.get(EventRow, event_id)
        if ev is not None:
            ev.job_id = job_id
            db.commit()


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=Job,
    responses={400: {"model": ErrorResponse}, 401: {"model": ErrorResponse}, 413: {"model": ErrorResponse}},
)
async def create_job(
    request: Request,
    user: CurrentUser,
    file: Annotated[UploadFile, File(description="음성 파일 또는 화이트보드 사진")],
    source: Annotated[Literal["upload", "recording", "image"], Form()] = "upload",
    attendees: Annotated[str | None, Form(description='참석자 JSON 배열 [{"name": "…", "role": "…"}] (선택)')] = None,
    event_id: Annotated[str | None, Form(description="이 녹음을 연결할 일정 ID (자동 녹음 등, 선택)")] = None,
) -> Job:
    """파일 업로드 및 작업 생성 (사진이면 글자 인식 작업)"""
    settings = get_settings()
    attendee_list = _parse_attendees(attendees)
    event_key = _own_event(user, event_id)
    file_name, ext, source = _checked_name(file.filename, source)

    job_id = new_job_id()
    stored_name = f"{job_id}{ext}"
    # 크기 제한을 보며 로컬 임시 파일에 받은 뒤 저장소에 넣는다 (로컬: 옮기기, S3: 나눠 올리기)
    incoming = settings.work_dir / "incoming"
    incoming.mkdir(parents=True, exist_ok=True)
    tmp = incoming / stored_name
    limit = settings.max_upload_mb * 1024 * 1024
    size = 0
    try:
        with tmp.open("wb") as out:
            while chunk := await file.read(CHUNK):
                size += len(chunk)
                if size > limit:
                    raise _too_big()
                out.write(chunk)
        if size == 0:
            raise HTTPException(400, "빈 파일입니다.")
        get_store().put_file(upload_key(stored_name), tmp, file.content_type or "application/octet-stream")
    except StorageError:
        raise HTTPException(503, "파일 저장소에 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.") from None
    finally:
        tmp.unlink(missing_ok=True)

    return _new_job(request, job_id=job_id, user_id=user.id, file_name=file_name, stored_name=stored_name, source=source, size=size, attendees=attendee_list, event_key=event_key)


# ── 직접 업로드 (통합 단계 5-2): 브라우저 → 저장소(R2) 서명 주소 PUT → 끝났다고 알림 → 작업 생성 ──
# 큰 녹음이 화면 서버(Vercel)·백엔드를 거치지 않는다. 로컬 저장소(local)에서는 쓰지 않고 위 POST /api/jobs 로 올린다.


def cleanup_uploads() -> int:
    """끝내지 않은 지 pending_upload_hours 가 지난 업로드를 객체와 함께 지운다. 지운 수"""
    cutoff = now() - timedelta(hours=get_settings().pending_upload_hours)
    with SessionLocal() as db:
        old = list(db.scalars(select(PendingUpload).where(PendingUpload.created_at < cutoff)))
        files = get_store()
        for up in old:
            try:
                files.delete(upload_key(up.stored_name))
            except StorageError:
                log.warning("끝내지 않은 업로드 객체를 지우지 못함: %s (다음에 다시)", up.id)
                continue
            db.delete(up)
        db.commit()
    return len(old)


@router.post(
    "/uploads",
    status_code=status.HTTP_201_CREATED,
    response_model=UploadTicket,
    responses={400: {"model": ErrorResponse}, 401: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 413: {"model": ErrorResponse}, 429: {"model": ErrorResponse}},
)
def start_upload(user: CurrentUser, body: UploadStart) -> UploadTicket:
    """직접 업로드 시작: 형식·크기를 확인하고 이 파일 하나만 올릴 수 있는 서명 주소를 준다.
    로컬 저장소면 409 DIRECT_UPLOAD_OFF — 화면은 POST /api/jobs 로 올린다."""
    settings = get_settings()
    files = get_store()
    if files.kind != "s3":
        raise ConflictError("DIRECT_UPLOAD_OFF", "이 서버는 저장소 직접 업로드를 쓰지 않습니다. 서버로 올려 주세요.")
    file_name, ext, source = _checked_name(body.file_name, body.source)
    if body.size_bytes > settings.max_upload_mb * 1024 * 1024:
        raise _too_big()
    event_key = _own_event(user, body.event_id)
    cleanup_uploads()
    with SessionLocal() as db:
        pending = db.scalar(select(func.count()).select_from(PendingUpload).where(PendingUpload.user_id == user.id))
        if pending >= settings.pending_upload_max:
            raise HTTPException(429, "올리는 중인 파일이 너무 많습니다. 먼저 올린 파일이 끝난 뒤 다시 시도해 주세요.")
        upload_id = new_job_id()
        stored_name = f"{upload_id}{ext}"
        content_type = body.content_type or "application/octet-stream"
        try:
            url = files.presign_put(upload_key(stored_name), content_type, body.size_bytes, settings.upload_url_expires_seconds)
        except StorageError:
            raise HTTPException(503, "파일 저장소에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.") from None
        db.add(
            PendingUpload(
                id=upload_id,
                user_id=user.id,
                file_name=file_name,
                stored_name=stored_name,
                source=source,
                content_type=content_type,
                size_bytes=body.size_bytes,
                attendees=[a.model_dump() for a in unique_attendees(body.attendees)],
                event_id=event_key,
            )
        )
        db.commit()
    return UploadTicket(
        upload_id=upload_id,
        url=url,
        headers={"Content-Type": content_type, "Cache-Control": "private, no-store"},
        expires_at=now() + timedelta(seconds=settings.upload_url_expires_seconds),
    )


@router.post(
    "/uploads/{upload_id}/complete",
    status_code=status.HTTP_201_CREATED,
    response_model=Job,
    responses={400: {"model": ErrorResponse}, 401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def complete_upload(request: Request, user: CurrentUser, upload_id: str) -> Job:
    """직접 업로드 끝: 저장소에 알린 크기 그대로 들어왔는지 확인하고 작업을 만든다 (변환 시작은 따로)"""
    if not is_job_id(upload_id):
        raise HTTPException(404, "올리는 중인 파일을 찾을 수 없습니다.")
    files = get_store()
    with SessionLocal() as db:
        up = db.get(PendingUpload, upload_id)
        if up is None or up.user_id != user.id:
            raise HTTPException(404, "올리는 중인 파일을 찾을 수 없습니다.")
        key = upload_key(up.stored_name)
        try:
            actual = files.size(key)
        except StorageError:
            raise HTTPException(503, "파일 저장소에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.") from None
        if actual is None:
            raise HTTPException(409, "파일이 아직 저장소에 올라가지 않았습니다. 올리기가 끝난 뒤 다시 시도해 주세요.")
        if actual != up.size_bytes:
            # 알린 것과 다른 파일 — 지우고 처음부터 다시 올리게 한다
            files.delete(key)
            db.execute(delete(PendingUpload).where(PendingUpload.id == upload_id))
            db.commit()
            raise HTTPException(400, "올린 파일 크기가 처음 알린 크기와 다릅니다. 다시 올려 주세요.")
        fields = {"file_name": up.file_name, "stored_name": up.stored_name, "source": up.source, "size": actual, "attendees": up.attendees, "event_key": up.event_id}
        db.delete(up)
        db.commit()
    return _new_job(request, job_id=upload_id, user_id=user.id, **fields)


@router.put("/{job_id}/attendees", response_model=Job, responses=ERRORS)
def update_attendees(request: Request, user: CurrentUser, job_id: str, body: AttendeesUpdate) -> Job:
    """회의 참석자 저장 (전체를 이 목록으로 바꾼다). 이미 만든 회의록 본문은 바뀌지 않는다."""
    _get_job(request, job_id, user)
    return _store(request).update(job_id, attendees=[a.model_dump() for a in unique_attendees(body.attendees)])


@router.get("", response_model=JobList, responses={401: {"model": ErrorResponse}})
def list_jobs(request: Request, user: CurrentUser) -> JobList:
    """내 작업 목록 (최신순)"""
    return JobList(jobs=_store(request).list(user.id))


@router.get("/{job_id}", response_model=Job, responses=ERRORS)
def get_job(request: Request, user: CurrentUser, job_id: str) -> Job:
    """작업 상태 조회"""
    return _get_job(request, job_id, user)


def job_local_files(job: Job) -> list[Path]:
    """작업 하나에 딸린 로컬 임시 파일·폴더 (저장소 설정과 무관). 없는 것도 포함될 수 있다."""
    settings = get_settings()
    jid = str(job.id)
    return [
        settings.work_dir / jid,  # 변환 중 임시 파일
        settings.work_dir / f"{jid}_minutes",  # 회의록 구간 메모 (예전 위치. 지금은 저장소 minutes/{id}.notes/)
        settings.storage_dir / "jobs_legacy" / f"{jid}.json",  # DB 도입 전 작업 기록
    ]


def delete_job_files(job: Job) -> None:
    """삭제 범위: 저장소의 원본 음성·사진, 변환 원문 .json·.txt, 회의록 .md·.json + 로컬 임시 파일"""
    files = get_store()
    files.delete(upload_key(job.stored_name))
    for prefix in job_prefixes(str(job.id)):
        delete_prefix(files, prefix)
    for path in job_local_files(job):
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink(missing_ok=True)


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT, responses=ERRORS)
def delete_job(request: Request, user: CurrentUser, job_id: str) -> Response:
    """작업 삭제 — 원본 파일·변환 원문·회의록·임시 파일·작업 기록(참석자 포함)을 모두 지운다. 되돌릴 수 없다.
    참석자 명단과 브라우저에 남은 녹음은 지우지 않는다."""
    job = _get_job(request, job_id, user)
    if _busy(job):
        raise HTTPException(409, "처리 중인 작업은 삭제할 수 없습니다. 처리가 끝난 뒤 다시 시도해 주세요.")
    # 파일을 먼저 지운다. 실패하면 작업 기록이 남아 있으므로 다시 시도할 수 있다.
    try:
        delete_job_files(job)
    except (OSError, StorageError):
        log.exception("작업 파일 삭제 실패: %s", job_id)
        raise HTTPException(500, "파일을 지우는 중 오류가 발생했습니다. 다시 시도해 주세요.")
    _store(request).delete(job_id)
    log.info("작업 삭제: %s (%s)", job_id, job.file_name)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{job_id}/transcribe", status_code=status.HTTP_202_ACCEPTED, response_model=Job, responses={**ERRORS, 503: {"model": ErrorResponse}})
def start_transcribe(request: Request, user: CurrentUser, job_id: str) -> Job:
    """음성 변환 시작 (이미 변환된 작업은 결과를 재사용, 실패한 작업은 완료된 구간부터 이어서)"""
    job = _get_job(request, job_id, user)
    if job.transcript_ready:
        return job
    if job.source != "image" and not speech_engines.enabled(get_settings()):
        raise HTTPException(503, speech_engines.DISABLED_MESSAGE)
    queued = _store(request).enqueue(job_id, "transcribe", status=JobStatus.QUEUED, progress=0, stage="변환 순서 대기 중", error_message=None)
    if queued is None:
        raise HTTPException(409, "이미 처리 중인 작업입니다.")
    _worker(request).wake()
    return queued


@router.get("/{job_id}/transcript", response_model=Transcript, responses=ERRORS)
def get_transcript(request: Request, user: CurrentUser, job_id: str) -> Transcript:
    """변환 원문 조회"""
    _get_job(request, job_id, user)
    data = _read_transcript(job_id)
    return Transcript.model_validate({**data, "edited": bool(data.get("editedAt"))})


def _read_transcript(job_id: str) -> dict:
    try:
        return get_json(get_store(), transcript_keys(job_id)[0])
    except FileNotFoundError:
        raise HTTPException(404, "아직 변환된 원문이 없습니다.") from None


SEGMENT_MAX = 5000  # 문장 하나에 넣을 수 있는 글자 수


@router.put("/{job_id}/transcript", response_model=Transcript, responses={**ERRORS, 400: {"model": ErrorResponse}})
def update_transcript(request: Request, user: CurrentUser, job_id: str, body: TranscriptUpdate) -> Transcript:
    """변환 원문 수정 저장 — 문장마다 글자만 바꾸고 시간은 그대로 둔다. 빈 문장은 지운다

    고친 원문은 TXT 받기·복사·AI 회의록 만들기에 쓰인다. 이미 만든 회의록은 바뀌지 않는다.
    """
    job = _get_job(request, job_id, user)
    if _busy(job):
        raise HTTPException(409, "변환이나 회의록 작성이 끝난 뒤에 원문을 고칠 수 있습니다.")
    data = _read_transcript(job_id)
    old = data["segments"]
    if len(body.texts) != len(old):
        raise HTTPException(409, "원문이 그사이 바뀌었습니다. 화면을 새로 고친 뒤 다시 고쳐 주세요.")
    if any(len(t) > SEGMENT_MAX for t in body.texts):
        raise HTTPException(400, f"문장 하나는 {SEGMENT_MAX:,}자까지 넣을 수 있습니다.")
    segments = []
    for seg, text in zip(old, body.texts, strict=True):
        text = " ".join(text.split())  # 줄바꿈·연속 공백은 한 칸으로 (한 문장 = 한 줄)
        if text:
            segments.append({**seg, "text": text})
    settings = get_settings()
    write_transcript(settings, job_id, segments, timed=job.source != "image", edited_at=now().isoformat())
    # 회의록 작성 중 실패해 남겨 둔 구간 메모는 고치기 전 원문으로 만든 것이라 버린다 (저장소 + 예전 로컬 위치)
    delete_prefix(get_store(), minutes_notes_prefix(job_id))
    shutil.rmtree(settings.work_dir / f"{job_id}_minutes", ignore_errors=True)
    return get_transcript(request, user, job_id)


@router.get("/{job_id}/transcript.txt", responses=ERRORS)
def download_transcript(request: Request, user: CurrentUser, job_id: str) -> Response:
    """변환 원문 TXT 다운로드 (시간 표시 포함)"""
    job = _get_job(request, job_id, user)
    try:
        text = get_text(get_store(), transcript_keys(job_id)[1])
    except FileNotFoundError:
        raise HTTPException(404, "아직 변환된 원문이 없습니다.") from None
    name = f"{Path(job.file_name).stem}_원문.txt"
    return Response(text, media_type="text/plain; charset=utf-8", headers={"Content-Disposition": f"attachment; filename*=utf-8''{quote(name)}"})


@router.post("/{job_id}/minutes", status_code=status.HTTP_202_ACCEPTED, response_model=Job, responses={**ERRORS, 400: {"model": ErrorResponse}})
def start_minutes(request: Request, user: CurrentUser, job_id: str, force: Annotated[bool, Query(description="이미 있는 회의록을 새로 만들기")] = False) -> Job:
    """회의록 생성 시작 — 변환된 텍스트만 AI API로 전송한다"""
    job = _get_job(request, job_id, user)
    if not job.transcript_ready:
        raise HTTPException(400, "먼저 음성을 텍스트로 변환해 주세요.")
    with SessionLocal() as db:
        problem = llm.resolve(db, user.id).problem()
    if problem:
        raise HTTPException(400, problem)
    if job.minutes_ready and not force:
        raise HTTPException(409, "이미 회의록이 있습니다. 새로 만들려면 force=true로 요청하세요.")
    queued = _store(request).enqueue(job_id, "minutes", status=JobStatus.SUMMARIZING, progress=0, stage="회의록 작성 순서 대기 중", error_message=None)
    if queued is None:
        raise HTTPException(409, "이미 처리 중인 작업입니다.")
    _worker(request).wake()
    return queued


def _read_minutes(job_id: str) -> tuple[str, dict]:
    files = get_store()
    json_key, md_key = minutes_keys(job_id)
    try:
        markdown = get_text(files, md_key)
    except FileNotFoundError:
        raise HTTPException(404, "아직 회의록이 없습니다.") from None
    meta = get_json(files, json_key) if files.exists(json_key) else {}
    return markdown, meta


@router.get("/{job_id}/minutes", response_model=MinutesDoc, responses=ERRORS)
def get_minutes(request: Request, user: CurrentUser, job_id: str) -> MinutesDoc:
    """회의록 조회 (Markdown)"""
    _get_job(request, job_id, user)
    markdown, meta = _read_minutes(job_id)
    return MinutesDoc(job_id=job_id, markdown=markdown, generated_at=meta.get("generatedAt"), model=meta.get("model"), edited=bool(meta.get("editedAt")))


@router.put("/{job_id}/minutes", response_model=MinutesDoc, responses=ERRORS)
def update_minutes(request: Request, user: CurrentUser, job_id: str, body: MinutesUpdate) -> MinutesDoc:
    """회의록 수정 저장"""
    _get_job(request, job_id, user)
    _, meta = _read_minutes(job_id)
    files = get_store()
    json_key, md_key = minutes_keys(job_id)
    put_text(files, md_key, body.markdown, MARKDOWN)
    if meta:
        meta["editedAt"] = now().isoformat()
        put_json(files, json_key, meta)
    return MinutesDoc(job_id=job_id, markdown=body.markdown, generated_at=meta.get("generatedAt"), model=meta.get("model"), edited=True)


@router.get("/{job_id}/download", responses=ERRORS)
def download(request: Request, user: CurrentUser, job_id: str, format: Annotated[Literal["md", "txt", "docx", "pdf"], Query()] = "md") -> Response:
    """회의록 파일 다운로드 (Markdown · TXT · Word · PDF)"""
    job = _get_job(request, job_id, user)
    markdown, _ = _read_minutes(job_id)
    stem = f"{Path(job.file_name).stem}_회의록"
    if format == "txt":
        content, media, name = markdown_to_text(markdown), "text/plain; charset=utf-8", f"{stem}.txt"
    elif format == "docx":
        content, media, name = export.to_docx(markdown), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", f"{stem}.docx"
    elif format == "pdf":
        try:
            content = export.to_pdf(markdown)
        except export.ExportError as e:
            raise HTTPException(500, str(e))
        media, name = "application/pdf", f"{stem}.pdf"
    else:
        content, media, name = markdown, "text/markdown; charset=utf-8", f"{stem}.md"
    return Response(content, media_type=media, headers={"Content-Disposition": f"attachment; filename*=utf-8''{quote(name)}"})


@router.get("/{job_id}/file", responses=ERRORS)
def get_original_file(request: Request, user: CurrentUser, job_id: str) -> StreamingResponse:
    """올린 원본 파일 (화이트보드 사진 미리보기·원본 음성 재생용). 저장소에서 조금씩 읽어 보낸다"""
    job = _get_job(request, job_id, user)
    try:
        chunks = get_store().iter_bytes(upload_key(job.stored_name))
    except FileNotFoundError:
        raise HTTPException(404, "원본 파일이 없습니다.") from None
    media = mimetypes.guess_type(job.stored_name)[0] or "application/octet-stream"
    return StreamingResponse(chunks, media_type=media)
