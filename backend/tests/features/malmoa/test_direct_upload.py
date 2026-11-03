"""저장소 직접 업로드 (통합 단계 5-2): 서명 주소 발급 → 브라우저가 저장소에 PUT → 끝 알림 → 작업 생성

s3 모드(MALMOA_FILES_BACKEND=s3, moto)에서 실제로 서명 주소에 PUT 한다. local 모드에서는 409 DIRECT_UPLOAD_OFF 만 확인.
"""

from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import httpx
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.features.malmoa.api.jobs import cleanup_uploads
from app.features.malmoa.config import get_settings
from app.features.malmoa.db import engine
from app.features.malmoa.models import PendingUpload
from app.features.malmoa.store import now
from features.malmoa.conftest import auth, files, local_only, register, s3_only

AUDIO = b"fake-m4a-bytes" * 100
AUDIO_SIZE = len(AUDIO)


def start(client, size=AUDIO_SIZE, name="회의.m4a", headers=None, **extra):
    body = {"fileName": name, "sizeBytes": size, "contentType": "audio/mp4", "source": "upload", **extra}
    return client.post("/api/jobs/uploads", json=body, headers=headers or {})


def put(ticket, data=AUDIO):
    return httpx.put(ticket["url"], content=data, headers=ticket["headers"])


@local_only
def test_local_storage_says_direct_upload_off(client):
    res = start(client)
    assert res.status_code == 409
    assert res.json()["code"] == "DIRECT_UPLOAD_OFF"


@s3_only
def test_upload_put_complete_creates_job(client):
    res = start(client, attendees=[{"name": "김회의"}])
    assert res.status_code == 201, res.text
    ticket = res.json()
    assert ticket["method"] == "PUT" and ticket["uploadId"].startswith("moa-")
    assert client.get("/api/jobs").json() == {"jobs": []}  # 끝내기 전에는 목록에 없다
    assert put(ticket).status_code == 200
    done = client.post(f"/api/jobs/uploads/{ticket['uploadId']}/complete")
    assert done.status_code == 201, done.text
    job = done.json()
    assert job["id"] == ticket["uploadId"] and job["sizeBytes"] == len(AUDIO) and job["status"] == "QUEUED"
    assert job["attendees"] == [{"name": "김회의", "role": None}]
    assert files().get_bytes(f"uploads/{job['storedName']}") == AUDIO
    assert [j["id"] for j in client.get("/api/jobs").json()["jobs"]] == [job["id"]]
    # 한 번 끝낸 업로드는 다시 끝낼 수 없다
    assert client.post(f"/api/jobs/uploads/{ticket['uploadId']}/complete").status_code == 404


@s3_only
def test_signed_url_binds_put_size_and_type(client):
    """SigV4 서명은 요청 방법(PUT)을 함께 서명하므로 같은 주소로 읽을(GET) 수 없다 — 녹음은 비공개.
    moto 는 서명을 검사하지 않아 실제 거절은 단계 6 에서 R2 로 확인한다. 여기서는 서명에 무엇이 묶였는지 본다."""
    ticket = start(client).json()
    q = parse_qs(urlparse(ticket["url"]).query)
    assert q["X-Amz-Algorithm"] == ["AWS4-HMAC-SHA256"]
    signed = q["X-Amz-SignedHeaders"][0].split(";")
    assert {"content-length", "content-type", "host"} <= set(signed), signed
    assert int(q["X-Amz-Expires"][0]) == get_settings().upload_url_expires_seconds
    assert "uploads/" in urlparse(ticket["url"]).path  # 이 파일 하나의 키에만


@s3_only
def test_rejects_bad_type_and_too_big(client, monkeypatch):
    assert start(client, name="악성.exe").status_code == 400
    monkeypatch.setattr(get_settings(), "max_upload_mb", 1)
    assert start(client, size=2 * 1024 * 1024).status_code == 413
    assert start(client, size=0).status_code == 422


@s3_only
def test_complete_before_put_is_409(client):
    ticket = start(client).json()
    assert client.post(f"/api/jobs/uploads/{ticket['uploadId']}/complete").status_code == 409


@s3_only
def test_size_mismatch_is_rejected_and_object_removed(client):
    ticket = start(client, size=len(AUDIO)).json()
    r = put(ticket, AUDIO + b"more")
    if r.status_code == 200:  # 저장소가 크기 서명을 검사하지 않으면 끝낼 때 막는다
        done = client.post(f"/api/jobs/uploads/{ticket['uploadId']}/complete")
        assert done.status_code == 400
        assert not files().exists(f"uploads/{ticket['uploadId']}.m4a")
    assert client.get("/api/jobs").json() == {"jobs": []}


@s3_only
def test_other_member_cannot_complete(client):
    ticket = start(client).json()
    put(ticket)
    other = register(client)
    assert client.post(f"/api/jobs/uploads/{ticket['uploadId']}/complete", headers=auth(other)).status_code == 404


@s3_only
def test_pending_limit(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "pending_upload_max", 2)
    assert start(client).status_code == 201
    assert start(client).status_code == 201
    assert start(client).status_code == 429


@s3_only
def test_abandoned_upload_is_cleaned_up(client):
    ticket = start(client).json()
    put(ticket)
    key = f"uploads/{ticket['uploadId']}.m4a"
    assert files().exists(key)
    with Session(engine) as db:
        db.execute(update(PendingUpload).values(created_at=now() - timedelta(hours=25)))
        db.commit()
    assert cleanup_uploads() == 1
    assert not files().exists(key)
    assert client.post(f"/api/jobs/uploads/{ticket['uploadId']}/complete").status_code == 404


@s3_only
def test_event_must_be_mine(client):
    assert start(client, eventId="not-a-uuid").status_code == 400
