"""내 정보 조회·수정, 탈퇴"""

from app.core.config import settings


def test_get_and_update_me(client, make_user, login):
    make_user("user01")
    headers = login("user01")
    assert client.get("/api/users/me", headers=headers).json()["user_id"] == "user01"

    response = client.patch(
        "/api/users/me",
        json={"name": "새이름", "phone": "010-1234-5678", "birth_date": "1990-01-02"},
        headers=headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert (body["name"], body["phone"], body["birth_date"]) == ("새이름", "010-1234-5678", "1990-01-02")

    cleared = client.patch("/api/users/me", json={"phone": None, "name": None}, headers=headers)
    assert cleared.json()["phone"] is None
    assert cleared.json()["name"] == "새이름"  # 이름은 지울 수 없음


def test_cannot_change_login_id_or_roles_via_me(client, make_user, login):
    make_user("user01")
    headers = login("user01")
    body = client.patch(
        "/api/users/me", json={"user_id": "hacker", "roles": ["MASTER"]}, headers=headers
    ).json()
    assert body["user_id"] == "user01"
    assert [r["name"] for r in body["roles"]] == ["VIEWER"]


def test_duplicate_nickname_rejected(client, make_user, login):
    make_user("user01", nickname="미어캣")
    make_user("user02")
    response = client.patch("/api/users/me", json={"nickname": "미어캣"}, headers=login("user02"))
    assert response.status_code == 409


def test_email_change_requires_verification(client, make_user, login, email_token):
    make_user("user01")
    headers = login("user01")
    without = client.patch("/api/users/me", json={"email": "new@example.com"}, headers=headers)
    assert without.status_code == 400

    token = email_token("new@example.com")
    response = client.patch(
        "/api/users/me",
        json={"email": "new@example.com", "email_verification_token": token},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["email"] == "new@example.com"
    assert response.json()["email_verified"] is True


def test_email_change_to_taken_email(client, make_user, login, monkeypatch):
    monkeypatch.setattr(settings, "signup_email_verification_required", False)
    make_user("user01")
    make_user("user02")
    response = client.patch(
        "/api/users/me", json={"email": "user02@example.com"}, headers=login("user01")
    )
    assert response.status_code == 409


def test_withdraw_blocks_login_and_tokens(client, db, make_user, login):
    user = make_user("user01")
    headers = login("user01")
    wrong = client.request("DELETE", "/api/users/me", json={"password": "nope"}, headers=headers)
    assert wrong.status_code == 400

    response = client.request(
        "DELETE", "/api/users/me", json={"password": "password123"}, headers=headers
    )
    assert response.status_code == 204
    db.refresh(user)
    assert user.is_active is False and user.deactivated_at is not None

    assert client.get("/api/users/me", headers=headers).status_code == 401
    assert client.post("/api/auth/refresh").status_code == 401
    blocked = client.post("/api/auth/login", json={"user_id": "user01", "password": "password123"})
    assert blocked.status_code == 401
    assert blocked.json()["detail"] == "탈퇴한 계정입니다."


def test_withdrawn_user_keeps_login_id_and_email_reserved(client, make_user, login, signup):
    make_user("user01")
    client.request("DELETE", "/api/users/me", json={"password": "password123"}, headers=login("user01"))
    assert client.get("/api/auth/check-user-id", params={"user_id": "user01"}).json()["available"] is False
    assert client.post("/api/auth/email/send-code", json={"email": "user01@example.com"}).status_code == 409


def test_blank_optional_fields_are_cleared(client, make_user, login):
    make_user("user01", nickname="미어캣", phone="010-1234-5678", birth_date="1990-01-02")
    headers = login("user01")
    response = client.patch(
        "/api/users/me",
        json={"nickname": "", "phone": "  ", "birth_date": "", "address": ""},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["nickname"], body["phone"], body["birth_date"], body["address"]) == (None,) * 4


def test_blank_required_field_still_rejected(client, make_user, login):
    make_user("user01")
    assert client.patch("/api/users/me", json={"name": ""}, headers=login("user01")).status_code == 422
