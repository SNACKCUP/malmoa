"""말모아 API 는 meerkit 로그인 그대로 막힌다 (진짜 get_current_user, 진짜 액세스 토큰)

예전(통합 전) 말모아가 토큰을 직접 검증하던 test_auth.py 를 대신한다. 토큰 형식·만료·정지 계정 처리 자체는
meerkit 테스트(tests/kit/test_auth.py 등)가 시험한다.
"""

from datetime import UTC, datetime

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.features.malmoa.db import engine
from app.users.models import User
from features.malmoa.conftest import bearer, register

AUDIO = ("회의.m4a", b"fake-audio-bytes", "audio/mp4")


def test_health_needs_no_login(real_client):
    assert real_client.get("/api/health").status_code == 200


def test_no_token_is_401(real_client):
    for path in ("/api/jobs", "/api/events?from=2026-11-01T00:00:00Z&to=2026-11-02T00:00:00Z", "/api/people", "/api/settings/llm", "/api/usage"):
        res = real_client.get(path)
        assert res.status_code == 401, path
        assert res.json()["detail"] == "로그인이 필요합니다."


def test_bad_token_is_401(real_client):
    assert real_client.get("/api/jobs", headers={"Authorization": "Bearer not-a-jwt"}).status_code == 401


def test_members_see_only_their_jobs(real_client):
    one, two = register(real_client), register(real_client)
    job = real_client.post("/api/jobs", files={"file": AUDIO}, headers=bearer(one)).json()
    assert [j["id"] for j in real_client.get("/api/jobs", headers=bearer(one)).json()["jobs"]] == [job["id"]]
    assert real_client.get("/api/jobs", headers=bearer(two)).json() == {"jobs": []}
    assert real_client.get(f"/api/jobs/{job['id']}", headers=bearer(two)).status_code == 404


def test_deactivated_member_is_401(real_client):
    """meerkit 에서 탈퇴(비활성)한 회원의 토큰은 말모아에서도 막힌다 (요청마다 meerkit 이 회원 상태를 확인)"""
    member = register(real_client)
    assert real_client.get("/api/jobs", headers=bearer(member)).status_code == 200
    with Session(engine) as db:
        db.execute(update(User).where(User.id == int(member)).values(deactivated_at=datetime.now(UTC)))
        db.commit()
    assert real_client.get("/api/jobs", headers=bearer(member)).status_code == 401


def test_deleting_member_deletes_their_malmoa_data(real_client):
    """회원 행이 지워지면 작업·일정 등 말모아 데이터도 함께 지워진다 (FK ON DELETE CASCADE)"""
    member = register(real_client)
    real_client.post("/api/jobs", files={"file": AUDIO}, headers=bearer(member))
    real_client.post("/api/people", json={"name": "김회의"}, headers=bearer(member))
    with Session(engine) as db:
        db.delete(db.get(User, int(member)))
        db.commit()
        from sqlalchemy import text

        assert db.execute(text("select count(*) from jobs")).scalar() == 0
        assert db.execute(text("select count(*) from people")).scalar() == 0


# ── 말모아 사용 승인 (통합 단계 5-1, 결정 A: OWNER 또는 MASTER) ──

MALMOA_PATHS = ("/api/jobs", "/api/people", "/api/settings/llm", "/api/usage")


def test_signup_default_viewer_is_not_approved(real_client):
    """가입 기본 역할(VIEWER)만 있으면 말모아 API 는 403 MALMOA_NOT_APPROVED"""
    viewer = register(real_client, roles=("VIEWER",))
    for path in MALMOA_PATHS:
        res = real_client.get(path, headers=bearer(viewer))
        assert res.status_code == 403, path
        assert res.json()["code"] == "MALMOA_NOT_APPROVED"
    assert real_client.post("/api/jobs", files={"file": AUDIO}, headers=bearer(viewer)).status_code == 403


def test_member_without_roles_is_not_approved(real_client):
    nobody = register(real_client, roles=())
    assert real_client.get("/api/jobs", headers=bearer(nobody)).status_code == 403


def test_owner_and_master_are_approved(real_client):
    for roles in (("OWNER",), ("MASTER",), ("VIEWER", "OWNER"), ("WRITER", "MASTER")):
        member = register(real_client, roles=roles)
        assert real_client.get("/api/jobs", headers=bearer(member)).status_code == 200, roles


def test_writer_alone_is_not_approved(real_client):
    """승인 역할은 OWNER 하나 (결정 A) — WRITER 만으로는 안 된다"""
    writer = register(real_client, roles=("WRITER",))
    assert real_client.get("/api/jobs", headers=bearer(writer)).status_code == 403


def test_granting_and_revoking_owner_applies_at_once(real_client):
    """관리자가 역할을 주거나 빼면 다음 요청부터 바로 반영된다 (요청마다 meerkit 이 회원을 다시 읽음)"""
    from app.users import repository as users_repository

    member = register(real_client, roles=("VIEWER",))
    assert real_client.get("/api/jobs", headers=bearer(member)).status_code == 403
    with Session(engine) as db:
        user = db.get(User, int(member))
        user.roles = users_repository.get_roles_by_codes(db, ["VIEWER", "OWNER"])
        db.commit()
    assert real_client.get("/api/jobs", headers=bearer(member)).status_code == 200
    with Session(engine) as db:
        user = db.get(User, int(member))
        user.roles = users_repository.get_roles_by_codes(db, ["VIEWER"])
        db.commit()
    assert real_client.get("/api/jobs", headers=bearer(member)).status_code == 403


def test_health_stays_public_for_unapproved(real_client):
    viewer = register(real_client, roles=("VIEWER",))
    assert real_client.get("/api/health", headers=bearer(viewer)).status_code == 200
