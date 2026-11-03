"""가입 규칙: 이메일 인증, 약관 동의, 아이디 확인"""

from app.core.config import settings


def test_terms_endpoint_lists_current_terms(client):
    terms = client.get("/api/auth/terms").json()
    assert [(t["id"], t["required"]) for t in terms] == [
        ("terms", True),
        ("privacy", True),
        ("marketing", False),
    ]


def test_signup_requires_required_terms(signup):
    response = signup("user01", agreed_terms=["terms"])
    assert response.status_code == 422
    assert "필수 약관" in response.json()["detail"]


def test_signup_rejects_unknown_term(signup):
    assert signup("user01", agreed_terms=["terms", "privacy", "nope"]).status_code == 422


def test_signup_stores_agreements(db, signup):
    from sqlalchemy import select

    from app.users.models import Term, UserTermAgreement

    response = signup("user01", agreed_terms=["terms", "privacy", "marketing"])
    assert response.status_code == 201
    codes = db.scalars(
        select(Term.code)
        .join(UserTermAgreement, UserTermAgreement.term_id == Term.id)
        .where(UserTermAgreement.user_id == response.json()["id"])
    ).all()
    assert sorted(codes) == ["marketing", "privacy", "terms"]


def test_signup_requires_email_verification(signup):
    response = signup("user01", email_verification_token=None)
    assert response.status_code == 400
    assert "이메일 인증" in response.json()["detail"]


def test_verification_token_must_match_email(signup, email_token):
    token = email_token("first@example.com")
    response = signup("user01", email="second@example.com", email_verification_token=token)
    assert response.status_code == 400


def test_verification_token_is_single_use(signup, email_token):
    token = email_token("first@example.com")
    assert signup("user01", email="first@example.com", email_verification_token=token).status_code == 201
    again = signup("user02", email="first@example.com", email_verification_token=token)
    assert again.status_code in (400, 409)


def test_signup_without_verification_when_disabled(monkeypatch, signup):
    monkeypatch.setattr(settings, "signup_email_verification_required", False)
    response = signup("user01", email_verification_token=None)
    assert response.status_code == 201
    assert response.json()["email_verified"] is False


def test_wrong_code_counts_attempts_then_blocks(client, last_code):
    client.post("/api/auth/email/send-code", json={"email": "a@example.com"})
    code = last_code()
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(settings.email_code_max_attempts):
        response = client.post(
            "/api/auth/email/verify-code", json={"email": "a@example.com", "code": wrong}
        )
        assert response.status_code == 400
    # 5번 틀린 뒤에는 맞는 번호도 거부 (새 번호를 받아야 함)
    response = client.post("/api/auth/email/verify-code", json={"email": "a@example.com", "code": code})
    assert response.status_code == 400


def test_expired_code_rejected(client, db, last_code):
    from datetime import UTC, datetime, timedelta

    from app.auth.models import EmailVerification

    client.post("/api/auth/email/send-code", json={"email": "a@example.com"})
    code = last_code()
    row = db.query(EmailVerification).filter_by(email="a@example.com").one()
    row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()
    response = client.post("/api/auth/email/verify-code", json={"email": "a@example.com", "code": code})
    assert response.status_code == 400


def test_send_code_cooldown_and_daily_limit(client, monkeypatch):
    first = client.post("/api/auth/email/send-code", json={"email": "a@example.com"})
    assert first.status_code == 204
    again = client.post("/api/auth/email/send-code", json={"email": "a@example.com"})
    assert again.status_code == 429
    assert 0 < int(again.headers["retry-after"]) <= settings.mail_cooldown_seconds

    monkeypatch.setattr(settings, "mail_cooldown_seconds", 0)
    monkeypatch.setattr(settings, "mail_daily_limit", 3)
    assert client.post("/api/auth/email/send-code", json={"email": "a@example.com"}).status_code == 204
    assert client.post("/api/auth/email/send-code", json={"email": "a@example.com"}).status_code == 204
    limited = client.post("/api/auth/email/send-code", json={"email": "a@example.com"})
    assert limited.status_code == 429


def test_check_user_id(client, make_user):
    make_user("taken01")
    assert client.get("/api/auth/check-user-id", params={"user_id": "taken01"}).json() == {
        "available": False
    }
    assert client.get("/api/auth/check-user-id", params={"user_id": "Free01"}).json() == {
        "available": True
    }
    assert client.get("/api/auth/check-user-id", params={"user_id": "deleted_9"}).json() == {
        "available": False
    }
    assert client.get("/api/auth/check-user-id", params={"user_id": "x"}).status_code == 422


def test_signup_blank_optional_fields_become_null(signup):
    response = signup("user01", nickname="", birth_date="", phone=" ")
    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["nickname"], body["birth_date"], body["phone"]) == (None, None, None)


def test_login_id_rule(client, signup):
    """아이디는 영문으로 시작 + 영문·숫자·밑줄 4~30자. 어긋난 이유를 메시지로 알려 줍니다."""
    for ok in ["kimm", "kim2024", "kim_lee", "kim_2024", "k___"]:
        assert client.get("/api/auth/check-user-id", params={"user_id": ok}).status_code == 200, ok
    for bad, reason in [
        ("33333", "영문으로 시작"),
        ("____", "영문으로 시작"),
        ("2024kim", "영문으로 시작"),
        ("_kim", "영문으로 시작"),
        ("kim-lee", "영문·숫자·밑줄"),
        ("김철수아", "영문·숫자·밑줄"),
        ("abc", "4~30자"),
        ("a" * 31, "4~30자"),
    ]:
        response = client.get("/api/auth/check-user-id", params={"user_id": bad})
        assert response.status_code == 422, bad
        assert reason in response.json()["errors"][0]["message"], bad

    rejected = signup("33333")
    assert rejected.status_code == 422
    assert rejected.json()["errors"][0]["field"] == "user_id"
    assert signup("Kim_2024").json()["user_id"] == "kim_2024"
