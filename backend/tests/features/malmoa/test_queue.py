"""작업 대기열 (DB): 서버 여러 대에서 같은 작업을 둘이 가져가지 않기, 다른 서버 재시작에도 처리 중인 작업 유지,
끊긴 작업 복구, 작업자 역할, 회의록 구간 메모를 저장소에 두기 (서버 디스크는 재시작하면 지워진다)"""

import threading
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from app.features.malmoa.config import get_settings
from app.features.malmoa.db import SessionLocal
from app.features.malmoa.models import Job as JobRow
from app.features.malmoa.schemas.jobs import JobStatus
from app.features.malmoa.services import llm
from app.features.malmoa.services.file_store import (
    minutes_note_key,
    minutes_notes_prefix,
    put_json,
    transcript_keys,
)
from app.features.malmoa.services.minutes import generate_minutes
from app.features.malmoa.services.worker import Worker
from app.features.malmoa.store import STALE_FAILED, JobStore, now
from features.malmoa.conftest import auth, files, register
from features.malmoa.test_transcriber import fake_model, upload  # noqa: F401  (fake_model 은 fixture)

AUDIO = ("회의.m4a", b"fake-audio-bytes", "audio/mp4")


@pytest.fixture
def quiet(client):
    """테스트 앱의 작업자를 멈춘다 — 대기열을 직접 다루는 테스트에서 끼어들지 않게"""
    client.app.state.worker.stop()
    return client


def _job(client, h=None) -> str:
    return client.post("/api/jobs", files={"file": AUDIO}, headers=h or {}).json()["id"]


def _queue(job_id: str, task: str = "transcribe") -> None:
    assert JobStore().enqueue(job_id, task, status=JobStatus.QUEUED, progress=0, stage="대기") is not None


def _row(job_id: str) -> JobRow:
    with SessionLocal() as db:
        return db.get(JobRow, job_id)


def _age_heartbeat(job_id: str, seconds: int) -> None:
    with SessionLocal() as db:
        db.execute(update(JobRow).where(JobRow.id == job_id).values(heartbeat_at=now() - timedelta(seconds=seconds)))
        db.commit()


def test_two_workers_never_claim_the_same_job(quiet):
    client = quiet
    ids = [_job(client) for _ in range(6)]
    for i in ids:
        _queue(i)
    store = JobStore()
    start = threading.Barrier(2)
    got: dict[str, list[str]] = {"a": [], "b": []}

    def take(name: str) -> None:
        start.wait()
        while (claimed := store.claim(f"worker-{name}", ("transcribe",))) is not None:
            got[name].append(claimed[1])

    threads = [threading.Thread(target=take, args=(n,)) for n in got]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    taken = got["a"] + got["b"]
    assert sorted(taken) == sorted(ids)  # 모두 한 번씩
    assert len(set(taken)) == len(taken)  # 둘이 가져간 것 없음


def test_enqueue_twice_is_refused(quiet):
    client = quiet
    job_id = _job(client)
    _queue(job_id)
    assert JobStore().enqueue(job_id, "transcribe") is None
    with SessionLocal() as db:  # 처리 중이어도 거절
        db.execute(update(JobRow).where(JobRow.id == job_id).values(task=None, status=JobStatus.TRANSCRIBING))
        db.commit()
    assert JobStore().enqueue(job_id, "minutes") is None


def test_another_server_restart_keeps_my_running_job(quiet):
    client = quiet
    """서버 A 가 처리 중인 작업은 서버 B 가 켜지거나(재시작) 대기열을 확인해도 그대로다 (예전에는 B 가 실패로 표시했다)"""
    job_id = _job(client)
    _queue(job_id)
    store = JobStore()
    assert store.claim("server-a", ("transcribe",)) == ("transcribe", job_id)
    store.update(job_id, status=JobStatus.TRANSCRIBING, progress=40, stage="구간 2/5 변환 중")

    from app.main import app

    with TestClient(app):  # 서버 B 시작
        pass
    Worker(store, get_settings(), tasks=("transcribe",)).run_once()  # 서버 B 의 작업자가 대기열 확인
    row = _row(job_id)
    assert (row.status, row.progress, row.claimed_by) == (JobStatus.TRANSCRIBING, 40, "server-a")


def test_stale_job_is_requeued_then_failed_after_max_attempts(quiet):
    client = quiet
    s = get_settings()
    job_id = _job(client)
    _queue(job_id, "minutes")
    store = JobStore()
    for attempt in range(1, s.job_max_attempts + 1):
        assert store.claim(f"dead-{attempt}", ("minutes",)) == ("minutes", job_id)
        store.update(job_id, status=JobStatus.SUMMARIZING, progress=50, stage="구간 정리 중")
        assert store.recover_stale(s.job_stale_seconds, s.job_max_attempts) == ()  # 아직 살아 있음
        _age_heartbeat(job_id, s.job_stale_seconds + 1)  # 서버가 꺼져 생존 신호가 끊김
        assert store.recover_stale(s.job_stale_seconds, s.job_max_attempts) == (job_id,)
        row = _row(job_id)
        if attempt < s.job_max_attempts:
            assert (row.task, row.claimed_by, row.status) == ("minutes", None, JobStatus.SUMMARIZING)
            assert row.stage.startswith("회의록 작성이 중단되어")
    row = _row(job_id)
    assert (row.task, row.claimed_by, row.status, row.error_message) == (None, None, JobStatus.FAILED, STALE_FAILED)
    assert store.enqueue(job_id, "minutes") is not None  # 사용자가 다시 시도할 수 있다


def test_release_only_by_the_claiming_worker(quiet):
    client = quiet
    job_id = _job(client)
    _queue(job_id)
    store = JobStore()
    store.claim("worker-a", ("transcribe",))
    store.release(job_id, "worker-b")
    assert not store.heartbeat(job_id, "worker-b")
    assert _row(job_id).claimed_by == "worker-a"
    assert store.heartbeat(job_id, "worker-a")
    store.release(job_id, "worker-a")
    assert (_row(job_id).task, _row(job_id).claimed_by) == (None, None)


def test_worker_takes_only_its_tasks(quiet):
    client = quiet
    a, b = _job(client), _job(client)
    _queue(a, "transcribe")
    _queue(b, "minutes")
    assert JobStore().claim("cloud", ("minutes",)) == ("minutes", b)
    assert JobStore().claim("cloud", ("minutes",)) is None
    assert JobStore().claim("idle", ()) is None


def test_no_worker_thread_when_tasks_empty():
    w = Worker(JobStore(), get_settings(), tasks=())
    w.start()
    assert not w._thread.is_alive()


def test_api_request_is_processed_by_the_worker(client, fake_model):  # noqa: F811  fake_model 은 test_transcriber 에서 가져온 fixture
    import time

    job_id = upload(client, 5)
    res = client.post(f"/api/jobs/{job_id}/transcribe")
    assert res.status_code == 202 and "task" not in res.json()  # 대기열 내부 값은 응답에 넣지 않는다
    assert client.post(f"/api/jobs/{job_id}/transcribe").status_code in (200, 409)  # 대기·처리 중이면 409, 이미 끝났으면 200
    for _ in range(100):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("COMPLETED", "FAILED"):
            break
        time.sleep(0.05)
    assert job["status"] == "COMPLETED", job
    for _ in range(40):  # 처리 함수가 COMPLETED 를 쓴 직후 작업자가 대기열에서 뺀다
        if _row(job_id).task is None:
            break
        time.sleep(0.05)
    row = _row(job_id)
    assert (row.task, row.claimed_by, row.attempts) == (None, None, 1)
    assert client.delete(f"/api/jobs/{job_id}").status_code == 204


# ── 회의록 구간 메모 ──


def test_minutes_notes_live_in_storage_and_resume_after_failure(client, monkeypatch):
    h = auth(register(client))
    client.put("/api/settings/llm", json={"provider": "gemini", "model": "gemini-test", "apiKey": "sk-test-abcdefghijklmnop1234"}, headers=h)
    job_id = _job(client, h)
    segments = [{"start": i * 10, "end": i * 10 + 5, "text": f"{i}번째 안건을 길게 논의했습니다."} for i in range(3)]
    put_json(files(), transcript_keys(job_id)[0], {"segments": segments})
    JobStore().update(job_id, transcript_ready=True, status=JobStatus.COMPLETED)
    monkeypatch.setattr(get_settings(), "minutes_chunk_chars", 20)  # 문장마다 한 구간

    calls: list[str] = []

    def first_run(cfg, system, prompt):
        calls.append(prompt)
        if len(calls) == 2:
            raise RuntimeError("서버가 멈춤 흉내")
        return llm.Reply('{"summary": "구간 요약"}', 10, 5)

    monkeypatch.setattr(llm, "complete_json", first_run)
    generate_minutes(job_id, JobStore(), get_settings())
    assert JobStore().get(job_id).status == JobStatus.FAILED
    assert files().list(minutes_notes_prefix(job_id)) == [minutes_note_key(job_id, 0)]  # 첫 구간만 저장소에
    assert not (get_settings().work_dir / f"{job_id}_minutes").exists()  # 서버 디스크에는 남기지 않는다

    replies = iter([llm.Reply('{"summary": "구간 요약"}', 10, 5)] * 2 + [llm.Reply('{"title": "주간 회의"}', 10, 5)])
    monkeypatch.setattr(llm, "complete_json", lambda cfg, system, prompt: next(replies))
    generate_minutes(job_id, JobStore(), get_settings())
    assert JobStore().get(job_id).status == JobStatus.COMPLETED
    assert next(replies, None) is None  # 두 번째 실행은 남은 두 구간 + 합치기만
    assert files().list(minutes_notes_prefix(job_id)) == []  # 다 끝나면 메모를 지운다
