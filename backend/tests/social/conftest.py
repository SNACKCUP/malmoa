"""소셜 로그인 테스트 공통: Google 을 켜고, Google 서버 응답은 httpx.MockTransport 로 흉내 냅니다."""

from dataclasses import dataclass, field
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app.social.config import social_settings
from app.social.providers import PROVIDERS


@dataclass
class FakeGoogle:
    """userinfo 를 바꿔 가며 테스트합니다. token_status/userinfo_status 로 실패를 흉내 냅니다."""

    userinfo: dict = field(
        default_factory=lambda: {
            "sub": "google-sub-1",
            "email": "social01@example.com",
            "email_verified": True,
            "name": "구글사용자",
            "picture": "https://lh3.googleusercontent.com/a/photo",
        }
    )
    token_status: int = 200
    userinfo_status: int = 200
    requests: list[httpx.Request] = field(default_factory=list)

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.host == "oauth2.googleapis.com":
            if self.token_status != 200:
                return httpx.Response(self.token_status, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"access_token": "google-access-token", "token_type": "Bearer"})
        if request.url.host == "openidconnect.googleapis.com":
            return httpx.Response(self.userinfo_status, json=self.userinfo)
        return httpx.Response(404)


@pytest.fixture
def google(monkeypatch):
    fake = FakeGoogle()
    monkeypatch.setattr(social_settings, "google_client_id", "test-client-id")
    monkeypatch.setattr(social_settings, "google_client_secret", "test-client-secret")
    monkeypatch.setattr(social_settings, "social_redirect_base_url", "http://localhost:3000/api/auth")
    monkeypatch.setattr(PROVIDERS["google"], "transport", httpx.MockTransport(fake.handle))
    return fake


@pytest.fixture
def google_login(client, google):
    """로그인 시작 → (Google 화면은 건너뛰고) 콜백 호출. 콜백의 응답(302)을 돌려줍니다."""

    def _login(*, agreed_terms: str | None = None, state: str | None = None, code: str = "auth-code"):
        params = {"agreed_terms": agreed_terms} if agreed_terms else {}
        start = client.get("/api/auth/google/login", params=params, follow_redirects=False)
        assert start.status_code == 302, start.text
        issued_state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
        return client.get(
            "/api/auth/google/callback",
            params={"code": code, "state": state or issued_state},
            follow_redirects=False,
        )

    return _login

