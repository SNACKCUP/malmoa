"""AI 테스트 API. 로그인한 사용자가 자기 API 키로 한 번 물어보고 답과 토큰 사용량을 받습니다.

키는 요청 헤더(X-LLM-API-Key)로만 받고, 저장하거나 로그에 남기지 않습니다.
"""

from fastapi import APIRouter, Depends, Header

from app.auth.deps import get_current_user
from app.features.llm_demo.schemas import ChatRequest, ChatResponse, UsageRead
from app.llm import chat_once
from app.users.models import User

router = APIRouter(prefix="/llm", tags=["llm"])


@router.post("/chat", response_model=ChatResponse, summary="내 API 키로 AI에게 한 번 묻기 (로그인 필요)")
def chat(
    body: ChatRequest,
    x_llm_api_key: str | None = Header(default=None, max_length=300),
    _user: User = Depends(get_current_user),
):
    reply = chat_once(body.message, api_key=x_llm_api_key, model_name=body.model, provider="openai")
    return ChatResponse(
        reply=reply.text,
        model=reply.model,
        usage=UsageRead(
            input_tokens=reply.usage.input_tokens,
            output_tokens=reply.usage.output_tokens,
            total_tokens=reply.usage.total_tokens,
        ),
    )
