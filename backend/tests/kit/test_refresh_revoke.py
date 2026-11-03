"""리프레시 토큰 서버 무효화 (#55): 로그아웃·비밀번호 변경 뒤 복사된 토큰 거절, 갱신마다 회전, 재사용 감지,
막힌 회원 거절, 정리 명령, 로그에 토큰 값 없음"""

import logging
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth import service
from app.auth.cleanup import cleanup
from app.auth.models import RefreshToken
from app.main import app

COOKIE = "meerkit_refresh"


@pytest.fixture(autouse=True)
def _app_logs_visible():
    # app 로거는 propagate=False 라서 caplog 가 받도록 테스트 동안만 켭니다 (하네스 pytest-app-logging)
    logger = logging.getLogger("app")
    logger.propagate = True
    yield
    logger.propagate = False


def _login(client, login_id="user01", password="password123") -> str:
    response = client.post("/api/auth/login", json={"user_id": login_id, "password": password})
    assert response.status_code == 200, response.text
    return response.cookies[COOKIE]


def _refresh_with(client, token: str):
    client.cookies.clear()
    client.cookies.set(COOKIE, token, path="/api/auth")
    return client.post("/api/auth/refresh")


def _rows(db, user_id) -> list[RefreshToken]:
    stmt = select(RefreshToken).where(RefreshToken.user_id == user_id).order_by(RefreshToken.id)
    return list(db.scalars(stmt.execution_options(populate_existing=True)))


def test_login_stores_only_a_hash(client, db, make_user):
    user = make_user("user01")
    token = _login(client)
    [row] = _rows(db, user.id)
    assert row.token_hash != token and len(row.token_hash) == 64
    assert row.revoked_at is None and row.expires_at > datetime.now(UTC) + timedelta(days=13)


def test_refresh_rotates_and_old_token_is_refused(client, db, make_user, monkeypatch):
    user = make_user("user01")
    first = _login(client)
    response = _refresh_with(client, first)
    assert response.status_code == 200
    second = response.cookies[COOKIE]
    assert second != first
    old, new = _rows(db, user.id)
    assert old.revoked_at is not None and old.replaced_by_id == new.id and new.family_id == old.family_id

    # 다른 탭이 거의 동시에 옛 토큰으로 갱신: 액세스 토큰만 받고 쿠키는 건드리지 않음
    response = _refresh_with(client, first)
    assert response.status_code == 200 and "set-cookie" not in response.headers

    # 유예 시간이 지난 뒤 옛 토큰이 다시 오면 복사된 것으로 보고 같은 로그인의 토큰을 모두 폐기
    monkeypatch.setattr(service, "REFRESH_REUSE_GRACE_SECONDS", -1)
    assert _refresh_with(client, first).status_code == 401
    assert _refresh_with(client, second).status_code == 401
    assert all(row.revoked_at is not None for row in _rows(db, user.id))


def test_logout_revokes_only_this_device(client, make_user):  # client: DB 를 테스트 세션으로 바꿔 둠
    make_user("user01")
    with TestClient(app) as pc, TestClient(app) as phone:
        pc_token = _login(pc)
        phone_token = _login(phone)
        pc.cookies.clear()
        pc.cookies.set(COOKIE, pc_token, path="/api/auth")
        assert pc.post("/api/auth/logout").status_code == 204
        assert _refresh_with(pc, pc_token).status_code == 401  # 복사해 둔 토큰도 못 씀
        assert _refresh_with(phone, phone_token).status_code == 200  # 휴대폰은 그대로


def test_logout_closes_reuse_grace_for_old_cookie(client, make_user):
    # 갱신으로 바뀐 옛 쿠키는 다른 탭 때문에 10초 유예가 있지만, 그 사이 로그아웃했으면 다시 들어오지 못함
    make_user("user01")
    old = _login(client)
    new = _refresh_with(client, old).cookies[COOKIE]
    client.cookies.clear()
    client.cookies.set(COOKIE, new, path="/api/auth")
    assert client.post("/api/auth/logout").status_code == 204
    assert _refresh_with(client, old).status_code == 401  # 유예 시간 안이어도 거절
    assert _refresh_with(client, new).status_code == 401


def test_logout_with_rotated_cookie_also_revokes_new_token(client, make_user):
    # 옛 쿠키로 로그아웃해도 같은 로그인의 새 토큰까지 함께 폐기
    make_user("user01")
    old = _login(client)
    new = _refresh_with(client, old).cookies[COOKIE]
    client.cookies.clear()
    client.cookies.set(COOKIE, old, path="/api/auth")
    assert client.post("/api/auth/logout").status_code == 204
    assert _refresh_with(client, new).status_code == 401
    assert _refresh_with(client, old).status_code == 401


def test_password_change_logs_out_other_devices(client, make_user):
    make_user("user01")
    with TestClient(app) as other, TestClient(app) as me:
        other_token = _login(other)
        logged_in = me.post("/api/auth/login", json={"user_id": "user01", "password": "password123"})
        headers = {"Authorization": f"Bearer {logged_in.json()['access_token']}"}
        changed = me.patch(
            "/api/users/me/password",
            json={"current_password": "password123", "new_password": "new-password1"},
            headers=headers,
        )
        assert changed.status_code == 204
        assert _refresh_with(other, other_token).status_code == 401
        assert _refresh_with(me, changed.cookies[COOKIE]).status_code == 200  # 바꾼 기기는 새 쿠키로 계속


def test_deactivated_user_token_is_refused_and_not_revived(client, db, make_user, login):
    make_user("admin01", admin=True)
    user = make_user("user01")
    token = _login(client)
    admin = login("admin01")
    assert client.patch(f"/api/users/{user.id}/active", json={"is_active": False}, headers=admin).status_code == 200
    assert _refresh_with(client, token).status_code == 401
    assert client.patch(f"/api/users/{user.id}/active", json={"is_active": True}, headers=admin).status_code == 200
    assert _refresh_with(client, token).status_code == 401  # 다시 활성화해도 예전 토큰은 되살아나지 않음


def test_unknown_or_expired_rows_are_refused(client, db, make_user):
    user = make_user("user01")
    token = _login(client)
    [row] = _rows(db, user.id)
    row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()
    assert _refresh_with(client, token).status_code == 401
    # 서버 기록이 없는 토큰(이 변경 전에 발급된 것 등)
    db.delete(row)
    db.commit()
    assert _refresh_with(client, token).status_code == 401


def test_cleanup_removes_expired_and_blocked_users_tokens(client, db, make_user):
    kept = make_user("user01")
    blocked = make_user("user02")
    _login(client, "user01")
    _login(client, "user02")
    expired = _login(client, "user01")
    assert expired
    rows = _rows(db, kept.id)
    rows[-1].expires_at = datetime.now(UTC) - timedelta(days=1)
    blocked.is_active = False
    db.commit()

    assert cleanup(db, dry_run=True)["refresh_tokens"] == 2
    assert cleanup(db)["refresh_tokens"] == 2
    assert len(_rows(db, kept.id)) == 1 and _rows(db, blocked.id) == []
    assert cleanup(db)["refresh_tokens"] == 0  # 다시 실행해도 안전


def test_logs_never_contain_tokens(client, make_user, caplog, monkeypatch):
    make_user("user01")
    first = _login(client)
    second = _refresh_with(client, first).cookies[COOKIE]
    monkeypatch.setattr(service, "REFRESH_REUSE_GRACE_SECONDS", -1)
    with caplog.at_level(logging.INFO, logger="app"):
        _refresh_with(client, first)
    assert "재사용 감지" in caplog.text
    assert first not in caplog.text and second not in caplog.text
