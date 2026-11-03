from typing import Literal

from pydantic import BaseModel, Field

# 화면에서 고를 수 있는 모델. 목록에 없는 이름은 받지 않습니다.
ChatModelName = Literal["gpt-4o-mini", "gpt-4o"]


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=20000)
    model: ChatModelName = "gpt-4o-mini"


class UsageRead(BaseModel):
    input_tokens: int
    output_tokens: int
    total_tokens: int


class ChatResponse(BaseModel):
    reply: str
    model: str
    usage: UsageRead
