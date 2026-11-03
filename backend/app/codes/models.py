"""공통코드 테이블 (JPA의 @Entity 모음). 킷과 서비스가 같이 씁니다.

    common_code_groups ──< common_codes      묶음(예: 요구사항 구분) ↔ 값(예: 기능, 비기능)

owner 로 누구의 코드인지 구분합니다: 킷은 MEERKIT, 서비스는 SVC 같은 자기 이름. group_code 는 반드시 owner + "_" 로 시작합니다
(DB CHECK). 그래서 킷과 서비스의 묶음 이름이 겹치지 않고, 서비스를 빼면 owner 행만 지우면 됩니다.
묶음은 주인의 Alembic 마이그레이션에서만 만들고 지웁니다. 킷은 서비스의 묶음을 모릅니다.

넣는 것: 사람이 이름·순서를 바꿀 수 있는 분류값(구분, 우선순위, 문서 종류).
넣지 않는 것: 코드가 흐름을 바꾸는 상태값·권한(문서 상태, 프로젝트 역할). 그런 값은 각 테이블의 CHECK 로 둡니다.
"""

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, String, Text, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.core.models import TimestampMixin


class CodeGroup(TimestampMixin, Base):
    __tablename__ = "common_code_groups"
    __table_args__ = (
        CheckConstraint("owner ~ '^[A-Z][A-Z0-9]*$'", name="ck_common_code_groups_owner_format"),
        CheckConstraint("group_code ~ '^[A-Z][A-Z0-9_]*$'", name="ck_common_code_groups_group_code_format"),
        # group_code 는 owner 접두어로 시작 (예: SVC_REQ_KIND). LIKE 의 \_ 는 글자 그대로의 밑줄
        CheckConstraint(r"group_code LIKE owner || '\_%'", name="ck_common_code_groups_group_code_owner_prefix"),
    )

    group_code: Mapped[str] = mapped_column(String(50), primary_key=True)  # 예: SVC_REQ_KIND
    owner: Mapped[str] = mapped_column(String(20), index=True)  # MEERKIT(킷) / 서비스 이름
    name: Mapped[str] = mapped_column(String(100))  # 화면 이름 (요구사항 구분)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=true())

    codes: Mapped[list["Code"]] = relationship(
        back_populates="group", order_by="Code.sort_order, Code.code", passive_deletes=True
    )


class Code(TimestampMixin, Base):
    __tablename__ = "common_codes"
    __table_args__ = (CheckConstraint("code ~ '^[A-Z][A-Z0-9_]*$'", name="ck_common_codes_code_format"),)

    # 묶음을 지우면 값도 같이 지워집니다 (서비스를 뺄 때)
    group_code: Mapped[str] = mapped_column(
        ForeignKey("common_code_groups.group_code", ondelete="CASCADE"), primary_key=True
    )
    code: Mapped[str] = mapped_column(String(50), primary_key=True)  # DB 에 저장되는 값 (FUNCTIONAL). 바꾸지 않음
    label: Mapped[str] = mapped_column(String(100))  # 화면 표시 (기능)
    sort_order: Mapped[int] = mapped_column(Integer, server_default="0")
    # 끄면 새로 고를 수 없지만, 이미 그 값을 저장한 데이터는 그대로 이름을 보여 줄 수 있습니다
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=true())

    group: Mapped[CodeGroup] = relationship(back_populates="codes")
