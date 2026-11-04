"""Mac 작업자 API (통합 단계 5-3) — 작업자 열쇠, 가져가기·원본 받기·진행·완료·실패, 작업자 프로그램 전체 흐름

작업자 프로그램(scripts/malmoa_worker.py)은 이 시험의 TestClient 를 HTTP 클라이언트로 끼워 실제 API 로 돈다.
서버 안의 작업자가 먼저 가져가지 않게 각 시험은 그 작업자를 멈추고 시작한다.
"""

import importlib.util
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from app.features.malmoa.config import get_settings
from app.features.malmoa.services.file_store import get_text, transcript_keys
from app.features.malmoa.store import JobStore
from features.malmoa.conftest import bearer, files, register
from features.malmoa.test_transcriber import fake_model, upload  # noqa: F401

TOKEN = "test-worker-token-0123456789"
SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "malmoa_worker.py"
_spec = importlib.util.spec_from_file_location("malmoa_worker", SCRIPT)
mw = importlib.util.module_from_spec(_spec)
sys.modules["malmoa_worker"] = mw
_spec.loader.exec_module(mw)


@pytest.fixture
def api(client, monkeypatch):
    """서버 안의 작업자를 멈추고, 작업자 열쇠를 설정한 TestClient"""
    client.app.state.worker.stop()
    monkeypatch.setattr(get_settings(), "malmoa_worker_token_hash", mw.hashlib.sha256(TOKEN.encode()).hexdigest())
    return client


def W(worker="mac-1"):
    return {"Authorization": f"Bearer {TOKEN}", "X-Malmoa-Worker": worker}


def queued(client, seconds=3) -> str:
    job_id = upload(client, seconds)
    assert client.post(f"/api/jobs/{job_id}/transcribe").status_code == 202
    return job_id


def claim(client, worker="mac-1"):
    return client.post("/api/worker/claim", json={"worker": worker}, headers=W(worker))


# ── 열쇠 ──


def test_no_hash_configured_is_503(client):
    client.app.state.worker.stop()
    assert client.post("/api/worker/claim", json={"worker": "mac-1"}, headers=W()).status_code == 503


def test_wrong_or_missing_token_is_401(api):
    assert api.post("/api/worker/claim", json={"worker": "mac-1"}).status_code == 401
    assert api.post("/api/worker/claim", json={"worker": "mac-1"}, headers={"Authorization": "Bearer nope"}).status_code == 401


def test_member_login_token_is_not_a_worker_key(api):
    member = register(api)
    res = api.post("/api/worker/claim", json={"worker": "mac-1"}, headers=bearer(member))
    assert res.status_code == 401


# ── 가져가기·처리 ──


def test_claim_is_empty_then_returns_queued_job_once(api):
    assert claim(api).status_code == 204
    job_id = queued(api)
    got = claim(api)
    assert got.status_code == 200
    body = got.json()
    assert body["jobId"] == job_id and body["task"] == "transcribe" and body["source"] == "upload"
    assert claim(api, "mac-2").status_code == 204  # 같은 작업을 둘이 가져가지 않는다


def test_source_report_transcript_flow(api):
    job_id = queued(api)
    claim(api)
    src = api.get(f"/api/worker/jobs/{job_id}/source", headers=W())
    assert src.status_code == 200 and src.content[:4] == b"RIFF"
    assert api.post(f"/api/worker/jobs/{job_id}/report", json={"start": True, "stage": "구간 1/1 변환 중", "progress": 50, "durationSec": 3}, headers=W()).status_code == 204
    job = api.get(f"/api/jobs/{job_id}").json()
    assert (job["status"], job["stage"], job["progress"], job["durationSec"]) == ("TRANSCRIBING", "구간 1/1 변환 중", 50, 3.0)
    seg = [{"start": 0.5, "end": 1.0, "text": "안녕하세요"}]
    assert api.put(f"/api/worker/jobs/{job_id}/transcript", json={"segments": seg}, headers=W()).status_code == 204
    job = api.get(f"/api/jobs/{job_id}").json()
    assert job["status"] == "COMPLETED" and job["transcriptReady"] is True and JobStore().get(job_id).task is None
    assert get_text(files(), transcript_keys(job_id)[1]) == "[00:00:00] 안녕하세요\n"
    # 끝낸 작업은 더 바꿀 수 없다
    assert api.post(f"/api/worker/jobs/{job_id}/report", json={}, headers=W()).status_code == 409


def test_other_worker_cannot_touch_claimed_job(api):
    job_id = queued(api)
    claim(api, "mac-1")
    assert api.get(f"/api/worker/jobs/{job_id}/source", headers=W("mac-2")).status_code == 409
    assert api.post(f"/api/worker/jobs/{job_id}/fail", json={"message": "x"}, headers=W("mac-2")).status_code == 409


def test_fail_marks_failed_and_releases(api):
    job_id = queued(api)
    claim(api)
    assert api.post(f"/api/worker/jobs/{job_id}/fail", json={"message": "구간 2/3을 변환하지 못했습니다."}, headers=W()).status_code == 204
    job = api.get(f"/api/jobs/{job_id}").json()
    assert job["status"] == "FAILED" and job["errorMessage"] == "구간 2/3을 변환하지 못했습니다." and JobStore().get(job_id).task is None
    assert api.post(f"/api/jobs/{job_id}/transcribe").status_code == 202  # 사용자가 다시 시도할 수 있다


def test_stale_claim_goes_back_to_queue(api, monkeypatch):
    job_id = queued(api)
    claim(api, "mac-1")
    monkeypatch.setattr(get_settings(), "job_stale_seconds", -1)  # 생존 신호가 끊긴 것으로
    again = claim(api, "mac-2")
    assert again.status_code == 200 and again.json()["jobId"] == job_id
    assert api.post(f"/api/worker/jobs/{job_id}/report", json={}, headers=W("mac-1")).status_code == 409


def test_already_transcribed_job_is_completed_by_server(api):
    job_id = queued(api)
    claim(api)
    api.put(f"/api/worker/jobs/{job_id}/transcript", json={"segments": [{"start": 0, "end": 1, "text": "가"}]}, headers=W())
    JobStore().update(job_id, transcript_ready=False, status="QUEUED")
    api.post(f"/api/jobs/{job_id}/transcribe")  # transcript_ready 가 꺼져 있으므로 대기열에 들어간다
    assert claim(api).status_code == 204  # 원문이 이미 있으면 Mac 에 보내지 않고 서버가 완료 처리
    assert api.get(f"/api/jobs/{job_id}").json()["transcriptReady"] is True


# ── 작업자 프로그램 (scripts/malmoa_worker.py) ──


def test_worker_program_transcribes_through_api(api, fake_model, tmp_path):  # noqa: F811
    job_id = queued(api, 3)
    worker = mw.WorkerApi("http://testserver", TOKEN, "mac-test", client=api)
    settings = get_settings().model_copy(update={"malmoa_files_dir": tmp_path / "mac"})  # Mac 의 임시 폴더 (work/)
    assert mw.drain(worker, settings) == 1
    job = api.get(f"/api/jobs/{job_id}").json()
    assert job["status"] == "COMPLETED" and job["stage"] == "변환 완료" and job["durationSec"] == 3.0
    assert [s["text"] for s in api.get(f"/api/jobs/{job_id}/transcript").json()["segments"]] == ["문장1"]
    assert not list(settings.work_dir.glob("malmoa-src-*"))  # 받은 원본은 지웠다
    assert not (settings.work_dir / job_id).exists()  # 구간 임시 파일도


def test_worker_program_reports_failure(api, fake_model, tmp_path):  # noqa: F811
    job_id = queued(api, 3)
    fake_model.fail = 99
    worker = mw.WorkerApi("http://testserver", TOKEN, "mac-test", client=api)
    mw.drain(worker, get_settings().model_copy(update={"malmoa_files_dir": tmp_path}))
    job = api.get(f"/api/jobs/{job_id}").json()
    assert job["status"] == "FAILED" and "이어서" in job["errorMessage"] and JobStore().get(job_id).task is None


def test_hours_and_backoff():
    h = mw.Hours.parse("mon-fri 08-20")
    seoul = ZoneInfo("Asia/Seoul")
    assert h.contains(datetime(2026, 11, 3, 8, 0, tzinfo=seoul))  # 화 08:00
    assert h.contains(datetime(2026, 11, 3, 19, 59, tzinfo=seoul))
    assert not h.contains(datetime(2026, 11, 3, 20, 0, tzinfo=seoul))
    assert not h.contains(datetime(2026, 11, 7, 10, 0, tzinfo=seoul))  # 토
    assert mw.Hours.parse("sat-mon 0-24").days == frozenset({5, 6, 0})
    for bad in ("mon-fri", "xyz 8-20", "mon 20-8"):
        with pytest.raises(ValueError):
            mw.Hours.parse(bad)
    assert [mw.backoff_seconds(n, 90) for n in range(6)] == [90, 120, 240, 480, 900, 900]


def test_worker_program_needs_no_db_or_secrets(tmp_path):
    """Mac 에는 DB 비밀번호·meerkit 비밀 키가 없다 (결정 5) — 환경 변수를 비우고 .env 가 없는 폴더에서도 뜨고, DB 모듈을 불러오지 않는다"""
    import subprocess

    code = (
        "import importlib.util, sys;"
        f"s=importlib.util.spec_from_file_location('mw', {str(SCRIPT)!r}); m=importlib.util.module_from_spec(s); s.loader.exec_module(m);"
        "bad=[k for k in sys.modules if k.startswith(('app.core','app.auth','app.users','app.features.malmoa.db','app.features.malmoa.store','sqlalchemy','psycopg'))];"
        "print(','.join(bad) or 'clean')"
    )
    out = subprocess.run([sys.executable, "-c", code], cwd=tmp_path, env={"HOME": str(tmp_path), "PATH": "/usr/bin:/bin"}, capture_output=True, text=True, check=False)
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "clean"
