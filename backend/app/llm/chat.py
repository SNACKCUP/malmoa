"""한 번 묻고 한 번 답 받기 (대화 기록 없음). 테스트·데모와 간단한 기능용입니다.

    reply = chat_once("안녕", api_key=사용자가_넣은_키)
    reply.text, reply.usage.total_tokens

- 키는 저장하지 않고, 로그에도 남기지 않습니다. 로그: 공급자·모델·소요 시간·결과·오류 코드만.
  (프롬프트와 응답 내용은 남기지 않습니다. 토큰 수는 화면에 보여 주기 위해 응답에만 담고 기록하지 않습니다.)
- 입력이 LLM_MAX_INPUT_CHARS 를 넘으면 413 LLM_INPUT_TOO_LONG (호출하지 않음)
- 사용자 키로 부른 경우, 키 오류·한도 초과는 "내 키 문제"라고 알려 줍니다.
"""

import logging
import time
from dataclasses import dataclass

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from app.llm.client import BYOK_PROVIDERS, get_chat_model
from app.llm.config import llm_settings
from app.llm.errors import (
    LLMError,
    input_too_long,
    key_invalid,
    key_quota_exceeded,
    key_required,
    translate,
    unsupported_provider,
)

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = "당신은 친절한 도우미입니다. 한국어로 짧고 분명하게 답하세요."


@dataclass(frozen=True)
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0


@dataclass(frozen=True)
class ChatReply:
    text: str
    model: str
    usage: Usage


def _model_name(model: BaseChatModel) -> str:
    return str(getattr(model, "model_name", None) or getattr(model, "model", None) or type(model).__name__)


def _text(content) -> str:
    if isinstance(content, str):
        return content
    # 일부 공급자는 조각 목록으로 돌려줍니다
    return "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in content)


def chat_once(
    message: str,
    *,
    api_key: str | None = None,
    model_name: str | None = None,
    provider: str | None = None,
) -> ChatReply:
    limit = llm_settings.llm_max_input_chars
    if len(message) > limit:
        raise input_too_long(limit)

    # 서버가 가짜 모델(fake)이면 키 없이 예시 응답을 돌려줍니다 (로컬 개발용)
    use_user_key = llm_settings.llm_provider != "fake"
    if use_user_key:
        if provider is not None and provider not in BYOK_PROVIDERS:
            raise unsupported_provider()
        if not api_key:
            raise key_required()

    started = time.perf_counter()
    outcome, code, provider_code = "error", None, None
    try:
        model = get_chat_model(api_key=api_key if use_user_key else None, model_name=model_name)
        response = model.invoke([SystemMessage(SYSTEM_PROMPT), HumanMessage(message)])
        meta = getattr(response, "usage_metadata", None) or {}
        usage = Usage(
            input_tokens=int(meta.get("input_tokens", 0)),
            output_tokens=int(meta.get("output_tokens", 0)),
            total_tokens=int(meta.get("total_tokens", 0)),
        )
        outcome = "ok"
        return ChatReply(text=_text(response.content), model=_model_name(model), usage=usage)
    except Exception as exc:
        error = translate(exc)
        code = error.code
        # 원인을 구분할 수 있게 공급자의 오류 코드만 남깁니다 (메시지에는 키 일부가 들어 있을 수 있어 남기지 않음)
        provider_code = f"{type(exc).__name__}/{getattr(exc, 'code', None)}"
        if use_user_key and code == "LLM_AUTH_FAILED":
            raise key_invalid() from exc
        if use_user_key and code == "LLM_QUOTA_EXCEEDED":
            raise key_quota_exceeded() from exc
        if isinstance(exc, LLMError):
            raise
        raise error from exc
    finally:
        logger.info(
            "LLM chat provider=%s model=%s outcome=%s code=%s provider_error=%s ms=%d",
            llm_settings.llm_provider,
            model_name or llm_settings.llm_model,
            outcome,
            code,
            provider_code,
            (time.perf_counter() - started) * 1000,
        )
