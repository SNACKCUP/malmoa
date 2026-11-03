"""요청 하나 동안 유지되는 값(요청 ID). 로그와 오류 응답이 같은 ID를 쓰게 합니다. (Logback MDC 역할)"""

from contextvars import ContextVar

_request_id: ContextVar[str | None] = ContextVar("request_id", default=None)


def get_request_id() -> str | None:
    return _request_id.get()


def set_request_id(value: str | None):
    return _request_id.set(value)


def reset_request_id(token) -> None:
    _request_id.reset(token)
