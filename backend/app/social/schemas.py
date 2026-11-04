from dataclasses import dataclass


# 공급자마다 다른 사용자 정보 응답을 이 형식으로 바꿉니다. service 는 이 값만 보고 판단합니다.
@dataclass(frozen=True)
class SocialProfile:
    provider: str
    provider_user_id: str  # 항상 문자열 (카카오 id 는 숫자로 옴)
    email: str | None  # 공급자가 주지 않거나 사용자가 동의하지 않으면 None
    email_verified: bool  # 공급자가 검증했다고 보장할 때만 True (Naver 는 항상 False)
    name: str | None = None
    profile_image_url: str | None = None
