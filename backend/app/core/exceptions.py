"""공통 오류. 모든 오류 응답을 {"detail", "code", "request_id"} 한 가지 형식으로 맞춥니다.

service 는 AppError(또는 하위 예외)만 던지고, router 는 HTTP 로 바꾸는 코드를 두지 않습니다.
전역 핸들러가 상태 코드와 응답 형식을 정합니다. (Spring 의 @RestControllerAdvice 역할)

    raise NotFoundError("USER_NOT_FOUND", "사용자를 찾을 수 없습니다.")
"""

import logging
from http import HTTPStatus

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.request_context import get_request_id

logger = logging.getLogger(__name__)


class AppError(Exception):
    """업무 규칙 위반. code 는 프론트·로그에서 구분하는 값, message 는 사용자에게 보여 줄 문구입니다."""

    status_code: int = 400

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int | None = None,
        retry_after: int | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        if status_code is not None:
            self.status_code = status_code
        self.retry_after = retry_after  # 429 응답의 Retry-After(초)


class BadRequestError(AppError):
    status_code = 400


class UnauthorizedError(AppError):
    status_code = 401


class ForbiddenError(AppError):
    status_code = 403


class NotFoundError(AppError):
    status_code = 404


class ConflictError(AppError):
    status_code = 409


class ValidationError(AppError):
    status_code = 422


class RateLimitedError(AppError):
    status_code = 429


def error_body(detail: str, code: str, **extra) -> dict:
    return {"detail": detail, "code": code, "request_id": get_request_id(), **extra}


def _http_code(status_code: int) -> str:
    """HTTPException 에는 code 가 없으므로 상태 이름으로 만듭니다. 예: 404 → NOT_FOUND"""
    try:
        return HTTPStatus(status_code).name
    except ValueError:
        return f"HTTP_{status_code}"


async def _app_error(_: Request, exc: AppError) -> JSONResponse:
    headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
    if exc.status_code >= 500:
        logger.error("업무 오류 code=%s", exc.code)
    return JSONResponse(error_body(exc.message, exc.code), status_code=exc.status_code, headers=headers)


async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, str) else HTTPStatus(exc.status_code).phrase
    return JSONResponse(
        error_body(detail, _http_code(exc.status_code)),
        status_code=exc.status_code,
        headers=getattr(exc, "headers", None),
    )


def _field(loc: tuple) -> str:
    # ("body", "user_id") → "user_id". 위치 정보(body/query 등)는 빼고 필드 이름만 보여 줍니다.
    parts = [str(p) for p in loc if p not in ("body", "query", "path", "header", "cookie")]
    return ".".join(parts) or "요청"


async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    errors = [{"field": _field(e.get("loc", ())), "message": e.get("msg", ""), "type": e.get("type", "")} for e in exc.errors()]
    first = errors[0]["field"] if errors else "요청"
    return JSONResponse(
        error_body(f"입력값이 올바르지 않습니다. ({first})", "VALIDATION_ERROR", errors=errors),
        status_code=422,
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _app_error)
    app.add_exception_handler(StarletteHTTPException, _http_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    # 처리하지 못한 예외(500)는 core.middleware.RequestContextMiddleware 가 같은 형식으로 바꿉니다.
