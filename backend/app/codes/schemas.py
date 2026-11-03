from pydantic import BaseModel, ConfigDict, Field, model_validator

OWNER_PATTERN = r"^[A-Z][A-Z0-9]*$"
CODE_PATTERN = r"^[A-Z][A-Z0-9_]*$"


class CodeRead(BaseModel):
    """공통코드 값 하나 (켜진 값만 보이는 조회용)"""

    model_config = ConfigDict(from_attributes=True)

    code: str = Field(description="DB 에 저장하는 값. 바뀌지 않음", examples=["FUNCTIONAL"])
    label: str = Field(description="화면에 보여 줄 이름", examples=["기능"])
    sort_order: int = Field(description="목록 순서 (작을수록 위)", examples=[1])


class CodeGroupRead(BaseModel):
    """공통코드 묶음과 켜진 값 목록 (드롭다운 채우기용)"""

    model_config = ConfigDict(from_attributes=True)

    group_code: str = Field(description="묶음 코드. owner 접두어로 시작", examples=["SVC_REQ_KIND"])
    owner: str = Field(description="누구의 코드인지: MEERKIT(킷), 서비스 이름", examples=["SVC"])
    name: str = Field(description="묶음 이름", examples=["요구사항 구분"])
    description: str | None = Field(default=None, description="설명", examples=[None])
    codes: list[CodeRead] = Field(description="켜진 값 목록, sort_order 순")


class CodeAdminRead(CodeRead):
    """공통코드 값 하나 (관리자용, 꺼진 값 포함)"""

    is_active: bool = Field(description="false 면 새로 고를 수 없음 (이미 저장된 데이터는 그대로)", examples=[True])


class CodeGroupAdminRead(BaseModel):
    """공통코드 묶음 (관리자용, 꺼진 묶음·값 포함)"""

    model_config = ConfigDict(from_attributes=True)

    group_code: str = Field(examples=["SVC_REQ_KIND"])
    owner: str = Field(examples=["SVC"])
    name: str = Field(examples=["요구사항 구분"])
    description: str | None = Field(default=None, examples=[None])
    is_active: bool = Field(description="묶음 사용 여부", examples=[True])
    codes: list[CodeAdminRead] = Field(description="모든 값 (꺼진 값 포함), sort_order 순")


class CodeCreate(BaseModel):
    """값 추가"""

    model_config = ConfigDict(extra="forbid")

    code: str = Field(
        min_length=1, max_length=50, pattern=CODE_PATTERN,
        description="저장할 값: 영문 대문자로 시작, 대문자·숫자·_ 만", examples=["SECURITY"],
    )
    label: str = Field(min_length=1, max_length=100, description="화면 이름", examples=["보안"])
    sort_order: int = Field(default=0, ge=0, le=100000, description="목록 순서", examples=[4])


class CodeUpdate(BaseModel):
    """값 수정. 보낸 칸만 바뀝니다. code 값은 바꿀 수 없습니다 (저장된 데이터가 쓰고 있음)."""

    model_config = ConfigDict(extra="forbid")

    label: str | None = Field(default=None, min_length=1, max_length=100, examples=["비기능 요구사항"])
    sort_order: int | None = Field(default=None, ge=0, le=100000, examples=[2])
    is_active: bool | None = Field(default=None, description="false 로 끄면 새로 고를 수 없음", examples=[False])

    @model_validator(mode="after")
    def _at_least_one(self):
        if not self.model_fields_set:
            raise ValueError("바꿀 칸(label, sort_order, is_active)을 하나 이상 보내세요.")
        for field in self.model_fields_set:
            if getattr(self, field) is None:
                raise ValueError(f"{field} 는 비울 수 없습니다.")
        return self
