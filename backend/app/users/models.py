"""회원 관련 테이블 (JPA의 @Entity 모음).

    users ──< user_roles >── roles          회원 ↔ 역할 (다대다)
    users ──< user_term_agreements >── terms 회원 ↔ 약관 동의 (다대다)

컬럼을 바꾸면 Alembic 마이그레이션을 만들어야 합니다 (uv run alembic revision --autogenerate).
"""

from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    func,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.models import TimestampMixin


# 사용자 ↔ 역할 연결 테이블 (다대다). 같은 역할을 두 번 넣지 못하도록 두 컬럼을 합쳐 PK로 둡니다.
# 회원이나 역할이 지워지면 연결 행도 같이 지워집니다 (ondelete="CASCADE").
class UserRole(Base):
    __tablename__ = "user_roles"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role_id: Mapped[int] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )


# 역할 목록 (MASTER/OWNER/VIEWER/WRITER). 초기 데이터는 마이그레이션에서 넣습니다.
class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30), unique=True)  # MASTER 등: 코드에서 비교하는 값
    name: Mapped[str] = mapped_column(String(50))  # 화면 표시용 이름


# 회원 한 명. 비밀번호는 argon2 해시로만 저장하고 응답에는 넣지 않습니다.
class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 로그인 아이디. API에서는 user_id 라는 이름으로 주고받습니다 (PK id, user_roles.user_id와 구분)
    login_id: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))  # 원문 비밀번호는 저장하지 않음
    # false면 소셜 로그인으로만 가입해 비밀번호가 없는 계정 (hashed_password 는 아무도 모르는 값의 해시)
    has_password: Mapped[bool] = mapped_column(Boolean, server_default=true())
    name: Mapped[str] = mapped_column(String(50))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=true())  # false면 관리자가 막은 계정

    # 가입 때 선택적으로 받는 항목 (프론트 meerkit.config.ts의 signup.optionalFields)
    nickname: Mapped[str | None] = mapped_column(String(30), unique=True)
    phone: Mapped[str | None] = mapped_column(String(20))
    postcode: Mapped[str | None] = mapped_column(String(10))
    address: Mapped[str | None] = mapped_column(String(255))
    address_detail: Mapped[str | None] = mapped_column(String(255))
    birth_date: Mapped[date | None] = mapped_column(Date)
    gender: Mapped[str | None] = mapped_column(String(10))
    avatar_url: Mapped[str | None] = mapped_column(String(500))  # 브라우저에서 여는 공개 주소 (app.storage)
    avatar_key: Mapped[str | None] = mapped_column(String(200))  # 저장소 안의 파일 key (교체·삭제할 때 씀)

    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # 이메일 인증을 마친 시각
    # 로그인 잠금: 연속 실패 횟수와 잠금이 풀리는 시각
    failed_login_count: Mapped[int] = mapped_column(Integer, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 이 시각 이전에 발급된 토큰은 거부합니다 (비밀번호를 바꾸면 다른 기기의 로그인이 풀림)
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 탈퇴: deactivated_at(탈퇴 시각, 계정 막힘) → 보관 기간이 지나면 개인정보를 지우고 deleted_at 기록
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # user.roles 로 역할 목록을 바로 꺼낼 수 있습니다 (JPA의 @ManyToMany + @JoinTable)
    # lazy="selectin": 회원을 읽을 때 역할도 한 번에 읽어 N+1 쿼리를 막습니다.
    roles: Mapped[list[Role]] = relationship(
        secondary="user_roles", lazy="selectin", order_by="Role.id"
    )

    @property
    def role_codes(self) -> list[str]:
        """역할 코드 목록. 예: ["MASTER", "VIEWER"]"""
        return sorted(role.code for role in self.roles)

    @property
    def email_verified(self) -> bool:
        """이메일 인증을 마쳤는지"""
        return self.email_verified_at is not None

    def has_role(self, code: str) -> bool:
        """이 역할을 가졌는지. (API 권한 검사는 app.core.principal 의 require_role 이 요청마다 담긴 역할로 합니다)"""
        return any(role.code == code for role in self.roles)


# 약관. 문구가 바뀌면 같은 code로 version을 올려 새 행을 추가합니다 (동의 기록은 버전별로 남음)
class Term(Base):
    __tablename__ = "terms"
    __table_args__ = (UniqueConstraint("code", "version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(30))  # 프론트 meerkit.config.ts의 terms[].id 와 같은 값
    version: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(100))
    is_required: Mapped[bool] = mapped_column(Boolean)  # true면 동의해야 가입 가능
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=true())  # 지금 가입 화면에 보이는 버전
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# 회원이 어떤 약관(버전)에 언제 동의했는지 기록합니다.
class UserTermAgreement(Base):
    __tablename__ = "user_term_agreements"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    term_id: Mapped[int] = mapped_column(ForeignKey("terms.id"), primary_key=True)
    agreed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
