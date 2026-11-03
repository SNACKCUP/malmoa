"""Google OAuth 2.0 (OpenID Connect). 콘솔: Google Cloud Console → 사용자 인증 정보 → OAuth 클라이언트(웹)

사용자 정보는 userinfo 엔드포인트에서 받습니다. 토큰 교환과 userinfo 요청 모두 서버가 Google 에 직접(TLS)
보내므로 ID Token 서명 검증은 하지 않습니다.
"""

from app.social.config import social_settings
from app.social.providers.base import OAuthProvider, ProviderError
from app.social.schemas import SocialProfile


class GoogleProvider(OAuthProvider):
    name = "google"
    authorize_endpoint = "https://accounts.google.com/o/oauth2/v2/auth"
    token_endpoint = "https://oauth2.googleapis.com/token"
    userinfo_endpoint = "https://openidconnect.googleapis.com/v1/userinfo"
    scope = "openid email profile"
    uses_pkce = True

    @property
    def client_id(self) -> str:
        return social_settings.google_client_id

    @property
    def client_secret(self) -> str:
        return social_settings.google_client_secret

    def extra_authorize_params(self) -> dict[str, str]:
        return {"prompt": "select_account"}  # 여러 구글 계정 중 고를 수 있게

    def fetch_profile(self, tokens: dict) -> SocialProfile:
        info = self._json(
            "GET", self.userinfo_endpoint, headers={"Authorization": f"Bearer {tokens['access_token']}"}
        )
        if not info.get("sub"):
            raise ProviderError("google userinfo 에 sub 가 없음")
        return SocialProfile(
            provider=self.name,
            provider_user_id=str(info["sub"]),
            email=info.get("email") or None,
            email_verified=info.get("email_verified") is True,
            name=info.get("name") or None,
            profile_image_url=info.get("picture") or None,
        )
