import pytest

from app.auth.service import AuthError, issue_verified_email_proof


def test_signup_then_login_and_me(client, signup, login):
    response = signup("Writer01", email="New@Example.com", name="소영", nickname="미어캣")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["user_id"] == "writer01"
    assert body["email"] == "new@example.com"
    assert body["nickname"] == "미어캣"
    assert body["email_verified"] is True
    assert body["roles"] == [{"id": 3, "name": "VIEWER"}]
    assert "hashed_password" not in body

    headers = login("writer01")
    me = client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["name"] == "소영"


def test_signup_rejects_duplicate_login_id(client, make_user, signup):
    make_user("dupuser")
    assert signup("dupuser", email="other@example.com").status_code == 409


def test_send_code_rejects_registered_email(client, make_user):
    make_user("dupuser")
    response = client.post("/api/auth/email/send-code", json={"email": "dupuser@example.com"})
    assert response.status_code == 409


def test_signup_validates_fields(client):
    base = {
        "user_id": "user01",
        "email": "a@example.com",
        "password": "password123",
        "name": "x",
        "agreed_terms": ["terms", "privacy"],
    }
    assert client.post("/api/auth/signup", json={**base, "password": "short"}).status_code == 422
    assert client.post("/api/auth/signup", json={**base, "user_id": "ab"}).status_code == 422
    assert client.post("/api/auth/signup", json={**base, "user_id": "한글아이디"}).status_code == 422


def test_login_wrong_password(client, make_user):
    make_user("user01")
    response = client.post(
        "/api/auth/login", json={"user_id": "user01", "password": "wrong-password"}
    )
    assert response.status_code == 401


def test_me_requires_token(client):
    assert client.get("/api/auth/me").status_code == 401
    bad = client.get("/api/auth/me", headers={"Authorization": "Bearer nope"})
    assert bad.status_code == 401


def test_login_sets_httponly_refresh_cookie_and_refresh_works(client, make_user):
    make_user("user01")
    response = client.post("/api/auth/login", json={"user_id": "user01", "password": "password123"})
    set_cookie = response.headers["set-cookie"]
    assert "meerkit_refresh=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "Path=/api/auth" in set_cookie

    refreshed = client.post("/api/auth/refresh")
    assert refreshed.status_code == 200
    token = refreshed.json()["access_token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200


def test_refresh_without_cookie_fails(client):
    assert client.post("/api/auth/refresh").status_code == 401


def test_logout_clears_refresh_cookie(client, make_user, login):
    make_user("user01")
    login("user01")
    assert client.post("/api/auth/logout").status_code == 204
    assert client.post("/api/auth/refresh").status_code == 401


def test_access_token_cannot_be_used_as_refresh(client, make_user, login):
    make_user("user01")
    headers = login("user01")
    client.cookies.clear()
    access = headers["Authorization"].removeprefix("Bearer ")
    client.cookies.set("meerkit_refresh", access, path="/api/auth")
    assert client.post("/api/auth/refresh").status_code == 401


def _signup_with_proof(client, login_id: str, email: str, proof: str):
    return client.post(
        "/api/auth/signup",
        json={
            "user_id": login_id,
            "email": email,
            "password": "password123",
            "name": "초대받은사람",
            "agreed_terms": ["terms", "privacy"],
            "email_verification_token": proof,
        },
    )


def test_verified_email_proof_works_with_normal_signup_once(client, db, mail_outbox):
    proof = issue_verified_email_proof(db, "Invited@Example.com")
    assert mail_outbox == []  # 인증번호 메일을 보내지 않음

    response = _signup_with_proof(client, "invited01", "invited@example.com", proof)
    assert response.status_code == 201, response.text
    assert response.json()["email_verified"] is True

    again = _signup_with_proof(client, "invited02", "invited@example.com", proof)
    assert again.status_code != 201


def test_verified_email_proof_is_bound_to_its_email(client, db):
    proof = issue_verified_email_proof(db, "invited@example.com")
    response = _signup_with_proof(client, "other01", "other@example.com", proof)
    assert response.status_code == 400
    assert response.json()["code"] == "EMAIL_VERIFICATION_REQUIRED"


def test_verified_email_proof_rejects_registered_email(db, make_user):
    make_user("taken01")
    with pytest.raises(AuthError) as error:
        issue_verified_email_proof(db, "taken01@example.com")
    assert error.value.code == "EMAIL_TAKEN"
