"""인증용 임시 기록 테이블. 둘 다 원문 대신 해시만 저장하고, 오래된 행은 app.auth.cleanup 이 지웁니다."""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


# 가입 전 이메일 인증번호. 번호는 해시로만 저장하고, 확인에 성공하면 verified_at, 가입에 쓰이면 used_at을 기록합니다.
# 아직 회원이 아니므로 users와 연결하지 않고 이메일로 찾습니다.
class EmailVerification(Base):
    __tablename__ = "email_verifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    code_hash: Mapped[str] = mapped_column(String(64))  # 6자리 번호의 해시 (원문은 메일로만 보냄)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))  # 이 시각이 지나면 무효
    attempts: Mapped[int] = mapped_column(Integer, server_default="0")  # 틀린 횟수
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # 번호 확인 성공 시각
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # 가입에 쓰인 시각 (다시 못 씀)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


# 비밀번호 재설정 링크 토큰. 원문은 메일로만 보내고 DB에는 해시만 둡니다. 한 번 쓰면 used_at을 기록합니다.
class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 회원이 지워지면 토큰도 같이 지워집니다
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)  # 링크 속 토큰의 해시
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))  # 이 시각이 지나면 무효
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # 사용(또는 무효 처리)한 시각
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
