import sys

import pytest

from app.features.malmoa.services.file_store import upload_key
from features.malmoa.conftest import auth, files, register

AUDIO = ("회의.m4a", b"fake-audio-bytes", "audio/mp4")


def test_health_is_public(client):
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_default_member_uses_jobs(client):
    """헤더 없는 테스트 요청은 기본 회원으로 처리된다 (로그인으로 막히는지는 test_login.py)"""
    job = client.post("/api/jobs", files={"file": AUDIO}).json()
    assert [j["id"] for j in client.get("/api/jobs").json()["jobs"]] == [job["id"]]
    assert client.get(f"/api/jobs/{job['id']}").status_code == 200


def test_upload_and_list_own_jobs(client):
    token = register(client)
    res = client.post("/api/jobs", files={"file": AUDIO}, data={"source": "upload"}, headers=auth(token))
    assert res.status_code == 201, res.text
    job = res.json()
    assert job["fileName"] == "회의.m4a"
    assert job["status"] == "QUEUED"
    assert files().exists(upload_key(job["storedName"]))

    jobs = client.get("/api/jobs", headers=auth(token)).json()["jobs"]
    assert [j["id"] for j in jobs] == [job["id"]]
    assert client.get(f"/api/jobs/{job['id']}", headers=auth(token)).status_code == 200


def test_users_cannot_see_each_others_jobs(client):
    owner = register(client, "owner@example.com")
    other = register(client, "other@example.com")

    job = client.post("/api/jobs", files={"file": AUDIO}, headers=auth(owner)).json()
    assert client.get("/api/jobs", headers=auth(other)).json()["jobs"] == []
    for path in ("", "/transcript", "/minutes"):
        assert client.get(f"/api/jobs/{job['id']}{path}", headers=auth(other)).status_code == 404
    assert client.post(f"/api/jobs/{job['id']}/transcribe", headers=auth(other)).status_code == 404


def test_upload_rejects_bad_files(client):
    token = register(client)
    bad_ext = client.post("/api/jobs", files={"file": ("../../etc/passwd.exe", b"x")}, headers=auth(token))
    assert bad_ext.status_code == 400
    empty = client.post("/api/jobs", files={"file": ("empty.mp3", b"")}, headers=auth(token))
    assert empty.status_code == 400


def test_minutes_without_api_key_is_explained(client):
    token = register(client)
    job = client.post("/api/jobs", files={"file": AUDIO}, headers=auth(token)).json()
    res = client.post(f"/api/jobs/{job['id']}/minutes", headers=auth(token))
    assert res.status_code == 400
    assert "먼저 음성을 텍스트로 변환" in res.json()["detail"]


# Linux(GitHub CI·배포 서버)에서는 사진 작업이 일부러 NOT_ON_MAC 으로 실패한다 — 그쪽은 test_edit_export.py 가 본다
@pytest.mark.skipif(sys.platform != "darwin", reason="Apple Vision 은 macOS 전용")
def test_whiteboard_photo_is_read_as_text(client):
    """화이트보드 사진: 올리면 사진 작업이 되고, 글자 읽기 결과가 원문으로 저장된다 (Apple Vision, macOS 전용)"""
    import time
    from pathlib import Path

    token = register(client)
    png = (Path(__file__).parent / "fixtures" / "whiteboard.png").read_bytes()
    job = client.post("/api/jobs", files={"file": ("화이트보드.png", png, "image/png")}, headers=auth(token)).json()
    assert job["source"] == "image"
    assert job["stage"] == "글자 읽기 대기"

    assert client.post(f"/api/jobs/{job['id']}/transcribe", headers=auth(token)).status_code == 202
    for _ in range(100):
        state = client.get(f"/api/jobs/{job['id']}", headers=auth(token)).json()
        if state["status"] in ("COMPLETED", "FAILED"):
            break
        time.sleep(0.2)
    assert state["status"] == "COMPLETED", state
    assert state["transcriptReady"] is True

    t = client.get(f"/api/jobs/{job['id']}/transcript", headers=auth(token)).json()
    texts = [s["text"] for s in t["segments"]]
    assert "1. 관리자 화면 11월 출시" in texts
    assert all(s["confidence"] is not None for s in t["segments"])

    original = client.get(f"/api/jobs/{job['id']}/file", headers=auth(token))
    assert original.status_code == 200
    assert original.headers["content-type"] == "image/png"
    assert original.content == png


def test_job_id_has_moa_prefix_and_rejects_other_forms(client):
    """작업 ID는 moa-<UUID>. 파일 이름에 쓰이므로 다른 형식(예전 UUID·경로 문자)은 404"""
    import re

    h = auth(register(client))
    job = client.post("/api/jobs", files={"file": ("회의.m4a", b"fake-audio-bytes", "audio/mp4")}, headers=h).json()
    assert re.fullmatch(r"moa-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", job["id"])
    assert job["storedName"] == f"{job['id']}.m4a"
    assert files().exists(upload_key(job["storedName"]))
    assert client.get(f"/api/jobs/{job['id']}", headers=h).status_code == 200
    for bad in (job["id"][4:], f"moa-..%2F{job['id'][4:]}", job["id"].upper()):
        assert client.get(f"/api/jobs/{bad}", headers=h).status_code == 404
