"""LLM 오류. 공급자(OpenAI 등) 예외를 사용자 문구와 오류 코드로 바꿉니다.

응답과 로그에는 API 키, 공급자 원문 메시지, 프롬프트·응답 내용을 넣지 않습니다.
"""

from app.core.exceptions import AppError


class LLMError(AppError):
    status_code = 502


class LLMNotConfiguredError(LLMError):
    status_code = 503


class LLMInputTooLongError(LLMError):
    status_code = 413


class LLMRateLimitedError(LLMError):
    status_code = 429


class LLMTimeoutError(LLMError):
    status_code = 504


def not_configured() -> LLMNotConfiguredError:
    return LLMNotConfiguredError("LLM_NOT_CONFIGURED", "AI 기능이 설정되지 않았습니다. 관리자에게 문의해 주세요.")


def bad_output() -> LLMError:
    return LLMError("LLM_BAD_OUTPUT", "AI 응답을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.")


def input_too_long(limit: int) -> LLMInputTooLongError:
    return LLMInputTooLongError(
        "LLM_INPUT_TOO_LONG", f"입력이 너무 깁니다. {limit:,}자 이하로 줄여서 다시 시도해 주세요."
    )


def unsupported_provider() -> LLMError:
    e = LLMError("LLM_UNSUPPORTED_PROVIDER", "지원하지 않는 AI 공급자입니다.")
    e.status_code = 400
    return e


def key_required() -> LLMError:
    e = LLMError("LLM_KEY_REQUIRED", "API 키를 입력해 주세요.")
    e.status_code = 400
    return e


def key_invalid() -> LLMError:
    e = LLMError("LLM_KEY_INVALID", "API 키가 올바르지 않거나 사용할 수 없습니다. 키를 다시 확인해 주세요.")
    e.status_code = 401
    return e


def key_quota_exceeded() -> LLMRateLimitedError:
    return LLMRateLimitedError("LLM_QUOTA_EXCEEDED", "입력한 API 키의 사용 한도를 모두 썼습니다. 공급자 사이트에서 한도를 확인해 주세요.")


# 크레딧·한도를 다 쓴 경우 공급자가 429와 함께 돌려주는 코드들 (요청이 많은 것과는 다른 문제)
_QUOTA_CODES = {"insufficient_quota", "credit_balance_exhausted", "billing_hard_limit_reached"}


def _names(exc: BaseException) -> set[str]:
    # 공급자 SDK 를 import 하지 않고 예외 클래스 이름으로 구분합니다 (openai·anthropic 모두 같은 이름을 씀)
    return {cls.__name__ for cls in type(exc).__mro__}


def translate(exc: Exception) -> LLMError:
    """공급자 예외 → LLMError. 이미 LLMError 면 그대로 돌려줍니다."""
    if isinstance(exc, LLMError):
        return exc
    names = _names(exc)
    if names & {"APITimeoutError", "TimeoutException", "TimeoutError", "ReadTimeout"}:
        return LLMTimeoutError("LLM_TIMEOUT", "AI 응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.")
    if "RateLimitError" in names:
        if getattr(exc, "code", None) in _QUOTA_CODES:
            return LLMRateLimitedError("LLM_QUOTA_EXCEEDED", "AI 사용 한도를 모두 썼습니다. 관리자에게 문의해 주세요.")
        return LLMRateLimitedError("LLM_RATE_LIMITED", "AI 요청이 많습니다. 잠시 후 다시 시도해 주세요.")
    if names & {"AuthenticationError", "PermissionDeniedError"}:
        return LLMNotConfiguredError("LLM_AUTH_FAILED", "AI 기능 설정에 문제가 있습니다. 관리자에게 문의해 주세요.")
    if "BadRequestError" in names and getattr(exc, "code", None) == "context_length_exceeded":
        return LLMInputTooLongError("LLM_INPUT_TOO_LONG", "입력이 너무 깁니다. 줄여서 다시 시도해 주세요.")
    return LLMError("LLM_PROVIDER_ERROR", "AI 서비스에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요.")
