import re
from datetime import date
from typing import Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
)

from app.users.schemas import OPTIONAL_PROFILE_FIELDS, blank_to_none

# 로그인 아이디 규칙. 프론트 SignupForm.tsx의 userIdProblem과 같은 규칙·문구입니다.
LOGIN_ID_LENGTH = "아이디는 4~30자로 입력해 주세요."
LOGIN_ID_CHARS = "아이디는 영문·숫자·밑줄(_)만 쓸 수 있습니다."
LOGIN_ID_START = "아이디는 영문으로 시작해야 해요. (영문, 영문+숫자, 영문+밑줄, 영문+숫자+밑줄 가능)"


def check_login_id(value: str) -> str:
    """영문·숫자·밑줄 4~30자, 첫 글자는 영문. 어긋난 이유를 메시지로 알려 주고, 소문자로 바꿔 돌려줍니다."""
    if not 4 <= len(value) <= 30:
        raise ValueError(LOGIN_ID_LENGTH)
    if not re.fullmatch(r"[a-z0-9_]+", value):
        raise ValueError(LOGIN_ID_CHARS)
    if not value[0].isascii() or not value[0].isalpha():
        raise ValueError(LOGIN_ID_START)
    return value


# 가입·중복 확인에서 쓰는 아이디 (대문자로 보내도 소문자로 바꿔 저장). 로그인은 이 검사를 하지 않습니다.
LoginId = Annotated[
    str,
    StringConstraints(strip_whitespace=True, to_lower=True),
    AfterValidator(check_login_id),
]
Password = Annotated[str, Field(min_length=8, max_length=128)]

class ProfileFields(BaseModel):
    """가입·내 정보 수정에서 선택적으로 받는 항목 (프론트 signup.optionalFields). 비우거나 ""로 보내면 저장하지 않습니다."""

    nickname: str | None = Field(
        default=None, min_length=1, max_length=30, description="닉네임 (다른 회원과 겹치면 안 됨)", examples=["행복한미어캣"]
    )
    phone: str | None = Field(default=None, max_length=20, description="전화번호", examples=["010-1234-5678"])
    postcode: str | None = Field(default=None, max_length=10, description="우편번호", examples=["06236"])
    address: str | None = Field(
        default=None, max_length=255, description="기본 주소 (주소 검색 결과)", examples=["서울 강남구 테헤란로 123"]
    )
    address_detail: str | None = Field(default=None, max_length=255, description="상세 주소", examples=["4층 401호"])
    birth_date: date | None = Field(default=None, description="생년월일 (YYYY-MM-DD)", examples=["1995-04-12"])
    gender: str | None = Field(
        default=None, max_length=10, description="성별: male, female, none(선택 안 함)", examples=["female"]
    )

    _blank_to_none = field_validator(*OPTIONAL_PROFILE_FIELDS, mode="before")(blank_to_none)


class SignupRequest(ProfileFields):
    """회원가입 요청. 기본 역할은 VIEWER이고, 이메일 인증과 필수 약관 동의가 필요합니다."""

    user_id: LoginId = Field(
        description="로그인 아이디. 영문으로 시작, 영문·숫자·밑줄(_) 4~30자. 소문자로 저장", examples=["kim_2024"]
    )
    email: EmailStr = Field(description="이메일 (연락·인증용, 다른 회원과 겹치면 안 됨)", examples=["kim@example.com"])
    password: Password = Field(description="비밀번호 8~128자 (argon2 해시로만 저장)", examples=["Passw0rd!example"])
    name: str = Field(min_length=1, max_length=50, description="이름", examples=["김미어"])
    agreed_terms: list[str] = Field(
        default_factory=list,
        description="동의한 약관 id 목록 (GET /auth/terms의 id). 필수 약관(terms, privacy)은 꼭 포함",
        examples=[["terms", "privacy"]],
    )
    email_verification_token: str | None = Field(
        default=None,
        description="POST /auth/email/verify-code가 돌려준 token. 이메일 인증을 켠 경우(기본) 필수",
        examples=["verify-code 응답의 token 값"],
    )


class LoginRequest(BaseModel):
    """로그인 요청. 아이디는 형식 검사 없이 DB와 비교만 합니다 (대소문자 구분 없음)."""

    user_id: str = Field(description="로그인 아이디 (이메일 아님)", examples=["kim_2024"])
    password: str = Field(description="비밀번호", examples=["Passw0rd!example"])


class TokenResponse(BaseModel):
    """로그인·토큰 재발급 응답. 리프레시 토큰은 응답 본문이 아니라 httpOnly 쿠키로 옵니다."""

    access_token: str = Field(
        description="API 호출용 액세스 토큰 (Authorization: Bearer <값>)", examples=["eyJhbGciOi...(JWT)"]
    )
    token_type: str = Field(default="bearer", description="토큰 종류 (항상 bearer)", examples=["bearer"])


class LoginIdCheck(BaseModel):
    """아이디 중복 확인 결과"""

    available: bool = Field(description="true면 가입에 쓸 수 있는 아이디", examples=[True])


class EmailCodeRequest(BaseModel):
    """가입 인증번호 요청. 6자리 번호를 메일로 보냅니다 (같은 이메일은 60초에 1번, 하루 10번까지)."""

    email: EmailStr = Field(description="인증번호를 받을 이메일", examples=["kim@example.com"])


class VerifyEmailCodeRequest(BaseModel):
    """메일로 받은 인증번호 확인 (10분 안에, 5번까지 틀릴 수 있음)"""

    email: EmailStr = Field(description="인증번호를 받은 이메일", examples=["kim@example.com"])
    code: str = Field(min_length=1, max_length=10, description="메일로 받은 6자리 인증번호", examples=["123456"])


class VerifyEmailCodeResponse(BaseModel):
    """인증 성공 증표. 가입(또는 이메일 변경) 요청의 email_verification_token에 넣습니다."""

    token: str = Field(description="이메일 인증 증표 (한 번만 사용, 일정 시간 뒤 만료)", examples=["(증표 문자열)"])


class TermRead(BaseModel):
    """가입 화면에 보여 줄 약관 (현재 버전)"""

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(
        validation_alias="code", description="약관 id (프론트 terms[].id, 가입 agreed_terms에 넣는 값)", examples=["terms"]
    )
    version: int = Field(description="약관 버전 (문구가 바뀌면 올라감)", examples=[1])
    title: str = Field(description="화면에 보일 약관 이름", examples=["이용약관"])
    required: bool = Field(validation_alias="is_required", description="true면 동의해야 가입 가능", examples=[True])


class ForgotPasswordRequest(BaseModel):
    """비밀번호 재설정 메일 요청. 가입 여부와 상관없이 같은 응답을 줍니다 (가입 여부를 알려 주지 않음)."""

    # 형식이 틀려도 같은 응답을 주려고 EmailStr로 검사하지 않습니다
    email: str = Field(max_length=255, description="가입한 이메일", examples=["kim@example.com"])


class ResetPasswordRequest(BaseModel):
    """메일 링크로 새 비밀번호 정하기. 링크는 한 번만 쓸 수 있고 30분 동안 유효합니다."""

    token: str = Field(
        min_length=1, max_length=200, description="재설정 메일 링크의 token 값", examples=["메일 링크의 token 값"]
    )
    password: Password = Field(description="새 비밀번호 8~128자", examples=["NewPassw0rd!example"])


class ChangePasswordRequest(BaseModel):
    """로그인한 상태에서 비밀번호 바꾸기. 다른 기기의 로그인은 풀립니다."""

    current_password: str = Field(description="지금 비밀번호 (본인 확인)", examples=["Passw0rd!example"])
    new_password: Password = Field(description="새 비밀번호 8~128자", examples=["NewPassw0rd!example"])
