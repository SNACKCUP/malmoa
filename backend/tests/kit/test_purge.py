"""보관 기간이 지난 탈퇴 계정의 개인정보 삭제"""

from datetime import UTC, datetime, timedelta

from app.core.config import settings
from app.users.purge import purge


def _withdrawn(db, make_user, login_id, days_ago, **fields):
    user = make_user(login_id, **fields)
    user.is_active = False
    user.deactivated_at = datetime.now(UTC) - timedelta(days=days_ago)
    db.commit()
    return user


def test_purge_anonymizes_only_expired_accounts(client, db, make_user):
    old = _withdrawn(
        db, make_user, "old01", settings.account_retention_days + 1, nickname="옛닉", phone="010-1"
    )
    recent = _withdrawn(db, make_user, "recent01", settings.account_retention_days - 1)
    active = make_user("active01")

    assert purge(db, dry_run=True) == 1
    db.refresh(old)
    assert old.deleted_at is None  # dry-run은 바꾸지 않음

    assert purge(db) == 1
    db.refresh(old)
    db.refresh(recent)
    db.refresh(active)
    assert old.deleted_at is not None
    assert (old.login_id, old.name) == (f"deleted_{old.id}", "탈퇴회원")
    assert old.email == f"deleted_{old.id}@deleted.invalid"
    assert old.nickname is None and old.phone is None
    assert old.hashed_password == "!deleted"
    assert recent.deleted_at is None and recent.login_id == "recent01"
    assert active.deleted_at is None

    assert purge(db) == 0  # 다시 실행해도 안전


def test_purged_account_cannot_login_and_frees_identifiers(client, db, make_user, signup):
    old = _withdrawn(db, make_user, "old01", settings.account_retention_days + 1)
    purge(db)
    for login_id in ("old01", f"deleted_{old.id}"):
        response = client.post("/api/auth/login", json={"user_id": login_id, "password": "password123"})
        assert response.status_code == 401
    # 지운 뒤에는 같은 아이디·이메일로 다시 가입할 수 있음
    assert signup("old01", email="old01@example.com").status_code == 201


def test_purged_account_shows_as_deleted_and_cannot_be_restored(client, db, make_user, login):
    make_user("admin01", admin=True)
    old = _withdrawn(db, make_user, "old01", settings.account_retention_days + 1)
    purge(db)
    headers = login("admin01")
    listed = client.get("/api/users", params={"status": "deleted"}, headers=headers).json()
    assert listed["items"][0]["deleted_at"] is not None
    restore = client.patch(f"/api/users/{old.id}/active", json={"is_active": True}, headers=headers)
    assert restore.status_code == 409
