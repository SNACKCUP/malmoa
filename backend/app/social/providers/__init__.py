"""공급자 목록. 새 공급자(kakao, naver)는 파일을 만들고 아래 목록에 한 줄 추가합니다."""

from app.social.providers.base import OAuthProvider, ProviderError
from app.social.providers.google import GoogleProvider

PROVIDERS: dict[str, OAuthProvider] = {p.name: p for p in (GoogleProvider(),)}


def get_provider(name: str) -> OAuthProvider | None:
    """켜진(클라이언트 ID·시크릿이 있는) 공급자만 돌려줍니다. 없거나 꺼졌으면 None."""
    provider = PROVIDERS.get(name)
    return provider if provider is not None and provider.is_configured() else None


__all__ = ["PROVIDERS", "OAuthProvider", "ProviderError", "get_provider"]
