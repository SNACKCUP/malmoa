from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

OPTIONAL_PROFILE_FIELDS = (
    "nickname",
    "phone",
    "postcode",
    "address",
    "address_detail",
    "birth_date",
    "gender",
)


def blank_to_none(value):
    """프론트는 비운 칸을 ""로 보냅니다. 선택 항목의 ""(공백만 있는 값 포함)는 "지움"(NULL)으로 받습니다."""
    if isinstance(value, str) and not value.strip():
        return None
    return value


class RoleRead(BaseModel):
    """역할 하나. 한 회원이 여러 역할을 가질 수 있습니다."""

    model_config = ConfigDict(from_attributes=True)

    id: int = Field(description="역할 번호", examples=[3])
    name: str = Field(
        validation_alias="code", description="역할 코드: MASTER(관리자), OWNER, VIEWER(기본), WRITER", examples=["VIEWER"]
    )


class UserRead(BaseModel):
    """회원 정보 응답. 비밀번호(해시)는 절대 포함하지 않습니다. 시각은 모두 UTC(+00:00)입니다."""

    model_config = ConfigDict(from_attributes=True)

    id: int = Field(description="회원 번호 (DB PK, 관리자 API 주소의 {user_id}에 쓰는 값)", examples=[12])
    user_id: str = Field(validation_alias="login_id", description="로그인 아이디", examples=["kim_2024"])
    email: str = Field(description="이메일", examples=["kim@example.com"])
    name: str = Field(description="이름", examples=["김미어"])
    nickname: str | None = Field(default=None, description="닉네임 (선택)", examples=["행복한미어캣"])
    phone: str | None = Field(default=None, description="전화번호 (선택)", examples=["010-1234-5678"])
    postcode: str | None = Field(default=None, description="우편번호 (선택)", examples=["06236"])
    address: str | None = Field(default=None, description="기본 주소 (선택)", examples=["서울 강남구 테헤란로 123"])
    address_detail: str | None = Field(default=None, description="상세 주소 (선택)", examples=["4층 401호"])
    birth_date: date | None = Field(default=None, description="생년월일 (선택)", examples=["1995-04-12"])
    gender: str | None = Field(default=None, description="성별: male, female, none (선택)", examples=["female"])
    avatar_url: str | None = Field(default=None, description="프로필 이미지 주소 (선택)", examples=[None])
    email_verified: bool = Field(description="이메일 인증을 마쳤는지", examples=[True])
    roles: list[RoleRead] = Field(description="가진 역할 목록")
    is_active: bool = Field(description="false면 로그인할 수 없음 (관리자가 막았거나 탈퇴)", examples=[True])
    created_at: datetime = Field(description="가입 시각", examples=["2026-10-27T04:35:54Z"])
    updated_at: datetime = Field(description="마지막으로 정보가 바뀐 시각", examples=["2026-10-27T04:40:12Z"])
    locked_until: datetime | None = Field(
        default=None, description="로그인 잠금이 풀리는 시각 (연속 5번 실패로 잠겼을 때만)", examples=[None]
    )
    deactivated_at: datetime | None = Field(default=None, description="탈퇴(또는 관리자 삭제) 시각", examples=[None])
    deleted_at: datetime | None = Field(
        default=None, description="보관 기간(365일)이 지나 개인정보를 지운 시각", examples=[None]
    )


class RolesUpdate(BaseModel):
    """회원의 역할을 통째로 바꿉니다 (보낸 목록이 새 역할 전체)."""

    roles: list[str] = Field(
        min_length=1,
        description="역할 코드 목록, 1개 이상 (MASTER, OWNER, VIEWER, WRITER)",
        examples=[["VIEWER", "WRITER"]],
    )


class ActiveUpdate(BaseModel):
    """계정 활성/비활성. 활성화하면 로그인 잠금도 풀리고, 탈퇴한 계정이면 복구됩니다."""

    is_active: bool = Field(description="true: 활성화(복구·잠금 해제), false: 비활성화", examples=[False])


class UserPage(BaseModel):
    """멤버 검색 결과 한 페이지"""

    items: list[UserRead] = Field(description="이 페이지의 회원 목록")
    total: int = Field(description="조건에 맞는 전체 회원 수", examples=[42])
    page: int = Field(description="지금 페이지 (1부터)", examples=[1])
    size: int = Field(description="페이지당 개수", examples=[20])


MemberStatus = Literal["active", "inactive", "deleted"]


class ProfileUpdate(BaseModel):
    """내 정보 수정. 보낸 항목만 바꿉니다. 선택 항목은 null 로 보내면 지워집니다."""

    name: str | None = Field(default=None, min_length=1, max_length=50, description="이름 (비울 수 없음)", examples=["김미어"])
    email: EmailStr | None = Field(
        default=None, description="새 이메일 (바꿀 때는 email_verification_token도 함께)", examples=["kim.new@example.com"]
    )
    email_verification_token: str | None = Field(
        default=None,
        description="새 이메일로 /auth/email/send-code → verify-code를 거쳐 받은 token",
        examples=["verify-code 응답의 token 값"],
    )
    nickname: str | None = Field(
        default=None, min_length=1, max_length=30, description="닉네임 (다른 회원과 겹치면 안 됨)", examples=["행복한미어캣"]
    )
    phone: str | None = Field(default=None, max_length=20, description="전화번호", examples=["010-1234-5678"])
    postcode: str | None = Field(default=None, max_length=10, description="우편번호", examples=["06236"])
    address: str | None = Field(default=None, max_length=255, description="기본 주소", examples=["서울 강남구 테헤란로 123"])
    address_detail: str | None = Field(default=None, max_length=255, description="상세 주소", examples=["4층 401호"])
    birth_date: date | None = Field(default=None, description="생년월일 (YYYY-MM-DD)", examples=["1995-04-12"])
    gender: str | None = Field(default=None, max_length=10, description="성별: male, female, none", examples=["female"])

    _blank_to_none = field_validator(*OPTIONAL_PROFILE_FIELDS, mode="before")(blank_to_none)


class WithdrawRequest(BaseModel):
    """회원 탈퇴. 계정은 바로 막히고, 개인정보는 보관 기간(365일) 뒤에 지워집니다."""

    password: str = Field(description="지금 비밀번호 (본인 확인)", examples=["Passw0rd!example"])
