"""인증용 기록 테이블. 모두 원문 대신 해시만 저장하고, 오래된 행은 app.auth.cleanup 이 지웁니다."""

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


# 아이디 찾기 메일을 보낸 기록. 같은 회원에게 너무 자주 보내지 않도록(발송 간격·하루 한도) 시각만 남깁니다.
# 아이디·이메일 원문은 저장하지 않고, 하루가 지난 행은 app.auth.cleanup 이 지웁니다.
class LoginIdMail(Base):
    __tablename__ = "auth_login_id_mails"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 회원이 지워지면 기록도 같이 지워집니다
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


# 발급한 리프레시 토큰 (#55). 토큰은 JWT 지만 서버가 여기 적어 두고 갱신할 때마다 확인해서, 로그아웃·비밀번호 변경 뒤에는
# 복사된 토큰도 쓸 수 없게 합니다. 갱신할 때마다 새 토큰으로 바꾸고(회전) 옛 행에 replaced_by_id 를 남깁니다.
# 이미 바뀐 토큰이 다시 오면 탈취로 보고 같은 family(한 번의 로그인에서 이어진 토큰들)를 모두 폐기합니다.
class RefreshToken(Base):
    __tablename__ = "auth_refresh_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 회원이 지워지면 토큰도 같이 지워집니다
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)  # 쿠키 속 토큰의 해시 (원문은 저장하지 않음)
    family_id: Mapped[str] = mapped_column(String(43), index=True)  # 로그인 한 번 = family 하나 (기기 하나)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # 로그아웃·회전·전체 폐기 시각
    replaced_by_id: Mapped[int | None] = mapped_column(Integer)  # 회전으로 바뀐 새 토큰 행 (재사용 감지용)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
