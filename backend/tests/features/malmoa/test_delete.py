"""작업 삭제: 원본·원문·회의록·임시 파일·작업 기록을 모두 지우고, 명단은 남긴다"""

from app.features.malmoa.config import get_settings
from app.features.malmoa.schemas.jobs import JobStatus
from app.features.malmoa.services.file_store import (
    minutes_keys,
    put_text,
    transcript_keys,
    upload_key,
)
from app.features.malmoa.store import JobStore
from features.malmoa.conftest import auth, files, present, register

AUDIO = ("회의.m4a", b"fake-audio-bytes", "audio/mp4")


def _job_with_results(client, h) -> tuple[dict, list]:
    s = get_settings()
    job = client.post("/api/jobs", files={"file": AUDIO}, data={"attendees": '[{"name": "홍길동"}]'}, headers=h).json()
    jid = job["id"]
    put_text(files(), transcript_keys(jid)[0], '{"jobId": "x", "text": "", "segments": []}')
    put_text(files(), transcript_keys(jid)[1], "원문")
    put_text(files(), minutes_keys(jid)[1], "# 회의록")
    put_text(files(), minutes_keys(jid)[0], "{}")
    (s.work_dir / jid).mkdir(parents=True)
    (s.work_dir / jid / "part_000.json").write_text("[]", encoding="utf-8")
    (s.work_dir / f"{jid}_minutes").mkdir(parents=True)
    paths = [
        upload_key(job["storedName"]),
        transcript_keys(jid)[0],
        transcript_keys(jid)[1],
        minutes_keys(jid)[1],
        minutes_keys(jid)[0],
        s.work_dir / jid,
        s.work_dir / f"{jid}_minutes",
    ]
    assert all(present(p) for p in paths)
    return job, paths


def test_delete_removes_files_and_record_but_keeps_roster(client):
    h = auth(register(client))
    client.post("/api/people", json={"name": "홍길동"}, headers=h)
    job, paths = _job_with_results(client, h)
    other, other_paths = _job_with_results(client, h)

    assert client.delete(f"/api/jobs/{job['id']}", headers=h).status_code == 204
    assert not any(present(p) for p in paths)
    assert client.get(f"/api/jobs/{job['id']}", headers=h).status_code == 404
    assert [j["id"] for j in client.get("/api/jobs", headers=h).json()["jobs"]] == [other["id"]]
    # 다른 작업과 명단은 그대로
    assert all(present(p) for p in other_paths)
    assert [p["name"] for p in client.get("/api/people", headers=h).json()["people"]] == ["홍길동"]
    # 두 번 지우면 404
    assert client.delete(f"/api/jobs/{job['id']}", headers=h).status_code == 404


def test_cannot_delete_while_processing(client):
    h = auth(register(client))
    job = client.post("/api/jobs", files={"file": AUDIO}, headers=h).json()
    JobStore().update(job["id"], status=JobStatus.TRANSCRIBING, progress=10)
    res = client.delete(f"/api/jobs/{job['id']}", headers=h)
    assert res.status_code == 409
    assert "처리 중" in res.json()["detail"]
    assert files().exists(upload_key(job["storedName"]))


def test_cannot_delete_other_users_job(client):
    owner = register(client, "owner@example.com")
    other = register(client, "other@example.com")
    job = client.post("/api/jobs", files={"file": AUDIO}, headers=auth(owner)).json()
    assert client.delete(f"/api/jobs/{job['id']}", headers=auth(other)).status_code == 404
    assert client.delete("/api/jobs/not-a-uuid", headers=auth(owner)).status_code == 404
    assert client.get(f"/api/jobs/{job['id']}", headers=auth(owner)).status_code == 200
