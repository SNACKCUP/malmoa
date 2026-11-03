"""정해진 형태(Pydantic 스키마)로 답 받기.

    result = invoke_structured(load_prompt(PROMPT), MeetingSummary, {"notes": text})

- 입력이 LLM_MAX_INPUT_CHARS 를 넘으면 413 LLM_INPUT_TOO_LONG (호출하지 않음)
- 응답 형식이 스키마와 다르면 LLM_OUTPUT_RETRIES 번 다시 묻고, 그래도 다르면 502 LLM_BAD_OUTPUT
- 공급자 오류는 errors.translate() 로 바꿉니다 (시간 초과 504, 한도 429, 설정 503 등)
- 로그: 공급자·모델·소요 시간·결과·오류 코드만. 프롬프트·응답 내용·토큰 사용량은 남기지 않습니다.
"""

import logging
import time
from typing import Any

from langchain_core.exceptions import OutputParserException
from langchain_core.language_models import BaseChatModel
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError

from app.llm.client import get_chat_model
from app.llm.config import llm_settings
from app.llm.errors import LLMError, bad_output, input_too_long, translate

logger = logging.getLogger(__name__)

_BAD_SHAPE = (PydanticValidationError, OutputParserException)


def _input_chars(variables: dict[str, Any]) -> int:
    return sum(len(v) for v in variables.values() if isinstance(v, str))


def _model_name(model: BaseChatModel) -> str:
    return str(getattr(model, "model_name", None) or getattr(model, "model", None) or type(model).__name__)


def invoke_structured[T: BaseModel](
    prompt: ChatPromptTemplate,
    schema: type[T],
    variables: dict[str, Any],
    *,
    model: BaseChatModel | None = None,
) -> T:
    limit = llm_settings.llm_max_input_chars
    if _input_chars(variables) > limit:
        raise input_too_long(limit)

    model = model or get_chat_model()
    chain = prompt | model.with_structured_output(schema)
    provider, name = llm_settings.llm_provider, _model_name(model)
    started = time.perf_counter()
    outcome, code = "error", None
    try:
        for attempt in range(llm_settings.llm_output_retries + 1):
            try:
                result = chain.invoke(variables)
                if isinstance(result, dict):
                    result = schema.model_validate(result)
                if not isinstance(result, schema):
                    raise OutputParserException("스키마와 다른 응답")
                outcome = "ok" if attempt == 0 else "ok_after_retry"
                return result
            except _BAD_SHAPE:
                continue  # 형식이 다르면 다시 묻습니다
        code = "LLM_BAD_OUTPUT"
        raise bad_output()
    except LLMError as e:
        code = code or e.code
        raise
    except Exception as e:
        err = translate(e)
        code = err.code
        raise err from e
    finally:
        logger.info(
            "LLM 호출 provider=%s model=%s outcome=%s code=%s duration_ms=%.0f",
            provider,
            name,
            outcome,
            code or "-",
            (time.perf_counter() - started) * 1000,
        )
