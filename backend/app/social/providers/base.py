"""공급자 계약. 공급자마다 다른 부분(주소, 응답 형식)은 이 클래스를 상속한 파일 안에서만 다룹니다.

service·router 에는 `if provider == "kakao"` 같은 분기를 두지 않습니다.
새 공급자: 이 클래스를 상속해 providers/<이름>.py 를 만들고 providers/__init__.py 의 목록에 넣습니다.
"""

import logging
from abc import ABC, abstractmethod
from urllib.parse import urlencode

import httpx

from app.social.config import social_settings
from app.social.schemas import SocialProfile

logger = logging.getLogger(__name__)


class ProviderError(Exception):
    """공급자 통신·응답 오류. 공급자 응답 원문이나 토큰은 담지 않습니다 (로그·응답으로 새지 않게)."""


class OAuthProvider(ABC):
    name: str  # social_accounts.provider 값이자 주소의 {provider}
    authorize_endpoint: str
    token_endpoint: str
    scope: str
    uses_pkce: bool = False
    transport: httpx.BaseTransport | None = None  # 테스트에서 httpx.MockTransport 를 넣습니다

    @property
    @abstractmethod
    def client_id(self) -> str: ...

    @property
    @abstractmethod
    def client_secret(self) -> str: ...

    @abstractmethod
    def fetch_profile(self, tokens: dict) -> SocialProfile:
        """토큰 응답으로 사용자 정보를 받아 공통 형식으로 바꿉니다. 필수 값이 없으면 ProviderError."""

    def is_configured(self) -> bool:
        return bool(self.client_id and self.client_secret)

    @property
    def redirect_uri(self) -> str:
        return f"{social_settings.social_redirect_base_url.rstrip('/')}/{self.name}/callback"

    def extra_authorize_params(self) -> dict[str, str]:
        return {}

    def authorize_url(self, state: str, code_challenge: str | None) -> str:
        params = {
            "response_type": "code",
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "state": state,
            **({"scope": self.scope} if self.scope else {}),
            **self.extra_authorize_params(),
        }
        if code_challenge:
            params |= {"code_challenge": code_challenge, "code_challenge_method": "S256"}
        return f"{self.authorize_endpoint}?{urlencode(params)}"

    def exchange_code(self, code: str, code_verifier: str | None) -> dict:
        """인가 코드 → 토큰 응답. 토큰은 사용자 정보를 받는 데만 쓰고 저장하지 않습니다."""
        data = {
            "grant_type": "authorization_code",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "redirect_uri": self.redirect_uri,
        }
        if code_verifier:
            data["code_verifier"] = code_verifier
        tokens = self._json("POST", self.token_endpoint, data=data)
        if not tokens.get("access_token"):
            raise ProviderError("토큰 응답에 access_token 이 없음")
        return tokens

    def _json(self, method: str, url: str, **kwargs) -> dict:
        """공급자 요청 공통: 제한 시간, 오류 변환. 실패하면 상태 코드만 로그에 남깁니다."""
        try:
            with httpx.Client(timeout=social_settings.social_http_timeout_seconds, transport=self.transport) as client:
                response = client.request(method, url, **kwargs)
        except httpx.HTTPError as e:
            raise ProviderError(f"{self.name} 요청 실패 ({type(e).__name__})") from None
        if response.status_code != 200:
            logger.warning("소셜 공급자 응답 오류 provider=%s status=%s", self.name, response.status_code)
            raise ProviderError(f"{self.name} 응답 오류 ({response.status_code})")
        try:
            body = response.json()
        except ValueError:
            raise ProviderError(f"{self.name} 응답이 JSON 이 아님") from None
        if not isinstance(body, dict):
            raise ProviderError(f"{self.name} 응답 형식 오류")
        return body
