"""모델 얻기. 기능 코드는 get_chat_model() 로만 모델을 얻습니다. 공급자를 바꾸면 이 파일과 .env 만 바뀝니다.

다른 공급자 추가 예 (Anthropic):
    1) uv add langchain-anthropic
    2) .env: LLM_PROVIDER=anthropic, LLM_MODEL=<모델 이름>, ANTHROPIC_API_KEY=...
    3) config.py 에 anthropic_api_key 추가, 아래 _api_key() 에 분기 추가
"""

import logging
from collections.abc import Iterator
from contextlib import contextmanager

from langchain.chat_models import init_chat_model
from langchain_core.language_models import BaseChatModel

from app.llm.config import llm_settings
from app.llm.errors import not_configured
from app.llm.testing import FakeChatModel

logger = logging.getLogger(__name__)

_override: BaseChatModel | None = None


def _api_key(provider: str) -> str:
    if provider == "openai":
        return llm_settings.openai_api_key
    return ""


# 사용자가 직접 키를 넣어 쓸 수 있는 공급자. 다른 공급자를 열려면 여기에 더하고 위 안내(uv add ...)를 따릅니다.
BYOK_PROVIDERS = {"openai"}


def get_chat_model(*, api_key: str | None = None, model_name: str | None = None) -> BaseChatModel:
    """설정값(LLM_PROVIDER, LLM_MODEL, 키, 온도, 시간 제한)으로 모델을 만듭니다.

    api_key 를 주면 서버 키 대신 그 키를 씁니다 (사용자가 입력한 키). 키는 저장하지 않고 로그에도 남기지 않습니다.
    model_name 을 주면 LLM_MODEL 대신 그 모델을 씁니다 (허용 여부는 호출하는 쪽에서 검사).

    FastAPI 의존성으로도 쓸 수 있습니다: model = Depends(get_chat_model)
    키가 없거나 공급자 설정이 잘못되면 503 LLM_NOT_CONFIGURED (다른 기능은 그대로 동작).
    """
    if _override is not None:
        return _override
    provider = llm_settings.llm_provider
    if provider == "fake":
        return FakeChatModel()
    key = api_key or _api_key(provider)
    if not key:
        raise not_configured()
    try:
        return init_chat_model(
            model_name or llm_settings.llm_model,
            model_provider=provider,
            api_key=key,
            temperature=llm_settings.llm_temperature,
            timeout=llm_settings.llm_timeout_seconds,
            max_retries=llm_settings.llm_max_retries,
        )
    except (ValueError, ImportError) as e:
        # 지원하지 않는 공급자이거나 공급자 패키지가 설치되지 않음. 키는 로그에 남기지 않습니다.
        logger.error("LLM 모델 생성 실패 provider=%s error=%s", provider, type(e).__name__)
        raise not_configured() from e


@contextmanager
def override_chat_model(model: BaseChatModel) -> Iterator[BaseChatModel]:
    """테스트에서 get_chat_model() 이 돌려줄 모델을 잠시 바꿉니다."""
    global _override
    previous, _override = _override, model
    try:
        yield model
    finally:
        _override = previous
