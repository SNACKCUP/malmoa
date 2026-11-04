"""소셜 로그인 설정. social 모듈이 직접 읽습니다 (다른 공통 모듈은 이 설정을 모름).

공급자는 CLIENT_ID 와 CLIENT_SECRET 이 모두 있어야 켜집니다. 비어 있으면 그 공급자 주소는 404.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.config import settings as core_settings


class SocialSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # 공급자 Redirect URI 의 앞부분. 실제 URI 는 <이 값>/<provider>/callback
    # 개발은 Next 가 /api 를 백엔드로 넘기므로 프론트 주소를 씁니다 (쿠키가 프론트 주소에 저장되게)
    social_redirect_base_url: str = "http://localhost:3000/api/auth"
    social_http_timeout_seconds: float = 10  # 공급자 토큰·프로필 요청 제한 시간(초)

    google_client_id: str = ""
    google_client_secret: str = ""


social_settings = SocialSettings()


def production_problems() -> list[str]:
    """APP_ENV=production 에서 소셜 로그인 쪽 위험한 설정. main.py 가 다른 검사와 합쳐 시작 전에 확인합니다.

    공급자를 하나도 켜지 않았으면 검사하지 않습니다 (소셜 로그인을 안 쓰는 서비스).
    """
    if core_settings.app_env != "production" or not social_settings.google_client_id:
        return []
    url = social_settings.social_redirect_base_url
    if not url.startswith("https://") or any(h in url for h in ("localhost", "127.0.0.1")):
        return ["SOCIAL_REDIRECT_BASE_URL: 운영 주소(https)로 바꾸고 공급자 콘솔의 Redirect URI 도 같은 값으로 등록하세요"]
    return []
