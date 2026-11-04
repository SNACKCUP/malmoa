"""서버 쪽 로그인 잠금: 연속 5회 실패 → 5분 잠금 (429 + Retry-After)"""

from datetime import UTC, datetime, timedelta

from app.core.config import settings


def _try(client, password="wrong-password"):
    return client.post("/api/auth/login", json={"user_id": "user01", "password": password})


def test_locks_after_max_failures(client, make_user):
    make_user("user01")
    for _ in range(settings.login_lock_max_attempts - 1):
        assert _try(client).status_code == 401
    locked = _try(client)
    assert locked.status_code == 429
    retry = int(locked.headers["retry-after"])
    assert 0 < retry <= settings.login_lock_minutes * 60

    # 잠긴 동안에는 맞는 비밀번호도 거부
    assert _try(client, "password123").status_code == 429


def test_lock_expires(client, db, make_user):
    user = make_user("user01")
    user.locked_until = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()
    assert _try(client, "password123").status_code == 200


def test_success_resets_failure_count(client, db, make_user):
    user = make_user("user01")
    for _ in range(settings.login_lock_max_attempts - 1):
        _try(client)
    assert _try(client, "password123").status_code == 200
    db.refresh(user)
    assert user.failed_login_count == 0
    assert user.last_login_at is not None
    assert _try(client).status_code == 401  # 다시 1회째


def test_lock_disabled_with_zero(client, make_user, monkeypatch):
    monkeypatch.setattr(settings, "login_lock_max_attempts", 0)
    make_user("user01")
    for _ in range(10):
        assert _try(client).status_code == 401


def test_unknown_user_gets_same_error(client):
    response = client.post("/api/auth/login", json={"user_id": "nobody", "password": "x"})
    assert response.status_code == 401
    assert response.json()["detail"] == "아이디 또는 비밀번호가 올바르지 않습니다."
