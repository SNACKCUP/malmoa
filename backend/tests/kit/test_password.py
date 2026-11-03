"""비밀번호 찾기(메일 링크)·재설정·변경"""

import re
from datetime import UTC, datetime, timedelta

from app.auth.models import PasswordResetToken
from app.core.config import settings


def _token_from(message) -> str:
    return re.search(r"reset-password\?token=([\w-]+)", message.text).group(1)


def _login(client, password):
    return client.post("/api/auth/login", json={"user_id": "user01", "password": password})


def test_forgot_same_response_for_unknown_email(client, make_user, mail_outbox):
    make_user("user01")
    known = client.post("/api/auth/password/forgot", json={"email": "user01@example.com"})
    unknown = client.post("/api/auth/password/forgot", json={"email": "nobody@example.com"})
    garbage = client.post("/api/auth/password/forgot", json={"email": "not-an-email"})
    assert known.status_code == unknown.status_code == garbage.status_code == 202
    assert known.json() == unknown.json() == garbage.json()
    assert [m.to for m in mail_outbox] == ["user01@example.com"]
    assert mail_outbox[0].text.count(settings.frontend_base_url) == 1


def test_reset_flow_changes_password_once(client, make_user, mail_outbox):
    make_user("user01")
    client.post("/api/auth/password/forgot", json={"email": "user01@example.com"})
    token = _token_from(mail_outbox[-1])

    response = client.post("/api/auth/password/reset", json={"token": token, "password": "new-password1"})
    assert response.status_code == 204
    assert _login(client, "password123").status_code == 401
    assert _login(client, "new-password1").status_code == 200

    again = client.post("/api/auth/password/reset", json={"token": token, "password": "other-pass1"})
    assert again.status_code == 400


def test_reset_token_expires(client, db, make_user, mail_outbox):
    make_user("user01")
    client.post("/api/auth/password/forgot", json={"email": "user01@example.com"})
    token = _token_from(mail_outbox[-1])
    row = db.query(PasswordResetToken).one()
    row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()
    response = client.post("/api/auth/password/reset", json={"token": token, "password": "new-password1"})
    assert response.status_code == 400
    assert response.json()["detail"] == "링크가 만료되었거나 이미 사용되었습니다."


def test_new_reset_link_invalidates_previous(client, make_user, mail_outbox, monkeypatch):
    monkeypatch.setattr(settings, "mail_cooldown_seconds", 0)
    make_user("user01")
    client.post("/api/auth/password/forgot", json={"email": "user01@example.com"})
    old = _token_from(mail_outbox[-1])
    client.post("/api/auth/password/forgot", json={"email": "user01@example.com"})
    new = _token_from(mail_outbox[-1])
    assert client.post("/api/auth/password/reset", json={"token": old, "password": "new-password1"}).status_code == 400
    assert client.post("/api/auth/password/reset", json={"token": new, "password": "new-password1"}).status_code == 204


def test_forgot_is_rate_limited_silently(client, make_user, mail_outbox):
    make_user("user01")
    first = client.post("/api/auth/password/forgot", json={"email": "user01@example.com"})
    second = client.post("/api/auth/password/forgot", json={"email": "user01@example.com"})
    assert first.status_code == second.status_code == 202
    assert len(mail_outbox) == 1


def test_reset_unlocks_account(client, db, make_user, mail_outbox):
    user = make_user("user01")
    user.locked_until = datetime.now(UTC) + timedelta(minutes=5)
    db.commit()
    client.post("/api/auth/password/forgot", json={"email": "user01@example.com"})
    token = _token_from(mail_outbox[-1])
    client.post("/api/auth/password/reset", json={"token": token, "password": "new-password1"})
    assert _login(client, "new-password1").status_code == 200


def test_change_password(client, make_user, login):
    make_user("user01")
    headers = login("user01")

    wrong = client.patch(
        "/api/users/me/password",
        json={"current_password": "nope", "new_password": "new-password1"},
        headers=headers,
    )
    assert wrong.status_code == 400
    assert wrong.json()["detail"] == "현재 비밀번호가 올바르지 않습니다."

    ok = client.patch(
        "/api/users/me/password",
        json={"current_password": "password123", "new_password": "new-password1"},
        headers=headers,
    )
    assert ok.status_code == 204
    assert "meerkit_refresh=" in ok.headers["set-cookie"]
    assert _login(client, "new-password1").status_code == 200


def test_tokens_issued_before_password_change_are_rejected(client, db, make_user, login):
    user = make_user("user01")
    headers = login("user01")
    # 토큰을 받은 뒤에 비밀번호가 바뀐 상황 (iat가 초 단위라 시각을 앞으로 둡니다)
    user.password_changed_at = datetime.now(UTC) + timedelta(seconds=2)
    db.commit()
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    assert client.post("/api/auth/refresh").status_code == 401
