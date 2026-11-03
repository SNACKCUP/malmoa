"""소셜 로그인 주소 (/api/auth/{provider}/login · callback): 302 위치, error 코드, 쿠키, 계정 처리"""

from datetime import UTC, datetime
from urllib.parse import parse_qs, urlparse

from app.social.config import social_settings
from app.social.models import SocialAccount
from app.social.state import STATE_COOKIE
from app.users import repository as user_repository
from app.users.models import UserTermAgreement

TERMS = "terms,privacy"
FRONT_CALLBACK = "http://localhost:3000/auth/google/callback"


def error_of(response) -> str | None:
    """프론트 콜백으로 보낸 302 의 ?error= 값 (성공이면 None)"""
    location = response.headers["location"]
    assert location.startswith(FRONT_CALLBACK), location
    return parse_qs(urlparse(location).query).get("error", [None])[0]


def _accounts(db):
    return db.query(SocialAccount).all()


def test_disabled_or_unknown_provider_is_404(client, monkeypatch):
    monkeypatch.setattr(social_settings, "google_client_id", "")
    assert client.get("/api/auth/google/login", follow_redirects=False).status_code == 404
    assert client.get("/api/auth/google/callback", follow_redirects=False).status_code == 404
    assert client.get("/api/auth/facebook/login", follow_redirects=False).status_code == 404


def test_login_redirects_to_google_with_state_and_pkce(client, google):
    response = client.get("/api/auth/google/login", follow_redirects=False)

    assert response.status_code == 302
    location = urlparse(response.headers["location"])
    query = parse_qs(location.query)
    assert f"{location.scheme}://{location.netloc}{location.path}" == "https://accounts.google.com/o/oauth2/v2/auth"
    assert query["client_id"] == ["test-client-id"]
    assert query["redirect_uri"] == ["http://localhost:3000/api/auth/google/callback"]
    assert query["scope"] == ["openid email profile"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["state"][0] and query["code_challenge"][0]
    cookie = response.headers["set-cookie"]
    assert STATE_COOKIE in cookie and "HttpOnly" in cookie and "Path=/api/auth/google/callback" in cookie


def test_new_account_signup_with_terms(client, db, google, google_login):
    response = google_login(agreed_terms=TERMS)

    assert response.status_code == 302
    assert error_of(response) is None
    user = user_repository.get_by_email(db, "social01@example.com")
    assert user.has_password is False
    assert user.login_id.startswith("google_")
    assert user.name == "구글사용자"
    assert user.role_codes == ["VIEWER"]
    assert user.email_verified_at is not None
    assert db.query(UserTermAgreement).filter_by(user_id=user.id).count() == 2
    [account] = _accounts(db)
    assert (account.user_id, account.provider, account.provider_user_id) == (user.id, "google", "google-sub-1")
    assert account.email_verified is True and account.last_login_at is not None
    # 토큰 교환에 PKCE code_verifier 와 같은 redirect_uri 를 보냄
    token_body = parse_qs(google.requests[0].content.decode())
    assert token_body["code_verifier"][0] and token_body["redirect_uri"] == ["http://localhost:3000/api/auth/google/callback"]
    # 프론트 콜백 화면이 하는 것처럼 리프레시 쿠키로 액세스 토큰을 받음
    refreshed = client.post("/api/auth/refresh")
    assert refreshed.status_code == 200
    me = client.get("/api/users/me", headers={"Authorization": f"Bearer {refreshed.json()['access_token']}"})
    assert me.json()["email"] == "social01@example.com"


def test_new_account_without_terms_is_rejected(db, google_login):
    assert error_of(google_login()) == "terms_required"
    assert user_repository.get_by_email(db, "social01@example.com") is None
    assert _accounts(db) == []


def test_linked_account_logs_in_and_updates_snapshot(db, google, google_login):
    google_login(agreed_terms=TERMS)
    google.userinfo["name"] = "바뀐이름"

    response = google_login()  # 이미 연결된 계정은 약관 없이 로그인

    assert error_of(response) is None
    [account] = _accounts(db)
    assert account.name == "바뀐이름"
    assert user_repository.get_by_email(db, "social01@example.com").name == "구글사용자"  # users 는 그대로


def test_state_mismatch_or_missing_cookie(client, google, google_login):
    assert error_of(google_login(state="forged")) == "state_mismatch"
    client.cookies.clear()
    response = client.get("/api/auth/google/callback", params={"code": "c", "state": "s"}, follow_redirects=False)
    assert error_of(response) == "state_mismatch"
    assert google.requests == []  # state 가 틀리면 Google 에 요청하지 않음


def test_state_is_single_use(client, google, google_login):
    response = google_login(agreed_terms=TERMS)
    assert STATE_COOKIE in response.headers["set-cookie"]  # 콜백에서 state 쿠키를 지움
    assert client.cookies.get(STATE_COOKIE) is None


def test_user_cancelled_on_google(client, google):
    client.get("/api/auth/google/login", follow_redirects=False)
    response = client.get("/api/auth/google/callback", params={"error": "access_denied"}, follow_redirects=False)
    assert error_of(response) == "access_denied"


def test_provider_failure_leaves_no_data(db, google, google_login):
    google.token_status = 400
    assert error_of(google_login(agreed_terms=TERMS)) == "provider_error"
    google.token_status, google.userinfo_status = 200, 500
    assert error_of(google_login(agreed_terms=TERMS)) == "provider_error"
    assert user_repository.get_by_email(db, "social01@example.com") is None
    assert _accounts(db) == []


def test_missing_email_cannot_sign_up(google, google_login):
    del google.userinfo["email"]
    assert error_of(google_login(agreed_terms=TERMS)) == "email_required"


def test_verified_email_links_existing_user(db, make_user, google_login):
    user = make_user("member01", email="social01@example.com")

    assert error_of(google_login()) is None

    [account] = _accounts(db)
    assert account.user_id == user.id
    db.refresh(user)
    assert user.has_password is True  # 기존 비밀번호는 그대로


def test_unverified_email_does_not_link_existing_user(db, make_user, google, google_login):
    make_user("member01", email="social01@example.com")
    google.userinfo["email_verified"] = False
    assert error_of(google_login()) == "email_exists"
    assert _accounts(db) == []


def test_other_google_account_on_already_linked_user(db, google, google_login):
    google_login(agreed_terms=TERMS)
    google.userinfo["sub"] = "google-sub-2"  # 같은 이메일, 다른 구글 계정
    assert error_of(google_login()) == "already_linked"
    assert len(_accounts(db)) == 1


def test_inactive_or_withdrawn_user_is_rejected(db, google_login):
    google_login(agreed_terms=TERMS)
    user = user_repository.get_by_email(db, "social01@example.com")
    user.is_active = False
    db.commit()
    assert error_of(google_login()) == "account_inactive"

    user.is_active, user.deactivated_at = False, datetime.now(UTC)
    db.commit()
    assert error_of(google_login()) == "account_inactive"


def test_social_only_user_has_no_password_login(client, db, google_login):
    google_login(agreed_terms=TERMS)
    user = user_repository.get_by_email(db, "social01@example.com")

    response = client.post("/api/auth/login", json={"user_id": user.login_id, "password": "anything123"})
    assert response.status_code == 401
    assert response.json()["code"] == "INVALID_CREDENTIALS"
