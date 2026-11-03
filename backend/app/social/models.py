"""소셜 계정 연결 테이블.

    users ──< social_accounts      회원 1명 ↔ 공급자별 계정 (공급자마다 최대 1개)

공급자를 추가해도 이 테이블은 바뀌지 않습니다 (provider 값만 늘어남).
공급자 토큰(Access·Refresh·ID Token)은 저장하지 않습니다.
"""

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint, false
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.core.models import TimestampMixin


class SocialAccount(TimestampMixin, Base):
    __tablename__ = "social_accounts"
    __table_args__ = (
        # 로그인 때 찾는 키. 공급자끼리 id 값이 겹칠 수 있어(카카오는 숫자) 두 컬럼을 합쳐 유일하게 둡니다.
        UniqueConstraint("provider", "provider_user_id"),
        # 한 회원에게 같은 공급자 계정을 두 개 연결하지 않습니다.
        UniqueConstraint("user_id", "provider"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # 회원별 조회는 UNIQUE(user_id, provider) 인덱스가 맡으므로 따로 인덱스를 두지 않음
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # google | kakao | naver. DB enum 이 아니라 공급자를 추가해도 마이그레이션이 필요 없음 (허용 값은 providers/)
    provider: Mapped[str] = mapped_column(String(20))
    provider_user_id: Mapped[str] = mapped_column(String(255))  # 공급자가 발급한 변하지 않는 id (Google sub 등)

    # 아래는 마지막 로그인 때 공급자가 준 값 (표시·연결 판단용). users 의 값을 바꾸지 않습니다.
    email: Mapped[str | None] = mapped_column(String(255))  # 동의하지 않으면 없을 수 있음 (Kakao·Naver)
    email_verified: Mapped[bool] = mapped_column(Boolean, server_default=false())  # 공급자가 검증을 보장할 때만 true
    name: Mapped[str | None] = mapped_column(String(50))
    profile_image_url: Mapped[str | None] = mapped_column(String(500))  # 공급자 주소 그대로 (저장소에 복사하지 않음)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
