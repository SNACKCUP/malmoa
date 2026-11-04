"""요청 ID 발급, 요청 1건당 접근 로그 1줄, 처리하지 못한 오류를 500 JSON 으로 바꾸기. (OncePerRequestFilter 역할)

순수 ASGI 미들웨어라서 응답 뒤에 도는 BackgroundTasks(메일 발송 등)의 로그에도 같은 요청 ID가 붙습니다.
"""

import json
import logging
import re
import time
import uuid

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.exceptions import error_body
from app.core.request_context import reset_request_id, set_request_id

logger = logging.getLogger("app.access")
error_logger = logging.getLogger("app.error")

REQUEST_ID_HEADER = "x-request-id"
# 밖에서 들어온 요청 ID는 안전한 모양일 때만 이어 씁니다 (로그 주입 방지)
_SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


def _incoming_request_id(scope: Scope) -> str | None:
    for name, value in scope.get("headers", []):
        if name == REQUEST_ID_HEADER.encode():
            candidate = value.decode("latin-1")
            return candidate if _SAFE_REQUEST_ID.match(candidate) else None
    return None


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = _incoming_request_id(scope) or uuid.uuid4().hex
        token = set_request_id(request_id)
        started = time.perf_counter()
        status_code = 500
        response_started = False

        async def send_with_id(message: Message) -> None:
            nonlocal status_code, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status_code = message["status"]
                headers = list(message.get("headers", []))
                headers.append((REQUEST_ID_HEADER.encode(), request_id.encode()))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        except Exception as exc:
            # 내부 메시지는 응답에 넣지 않고, 스택은 같은 요청 ID로 로그에 남깁니다.
            error_logger.exception("처리하지 못한 오류 %s", type(exc).__name__)
            status_code = 500
            if not response_started:
                body = json.dumps(
                    error_body("서버 오류가 발생했습니다.", "INTERNAL_ERROR"), ensure_ascii=False
                ).encode()
                await send_with_id(
                    {
                        "type": "http.response.start",
                        "status": 500,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode()),
                        ],
                    }
                )
                await send_with_id({"type": "http.response.body", "body": body})
        finally:
            # 경로만 남기고 쿼리 문자열·본문·헤더(토큰)는 남기지 않습니다.
            logger.info(
                "%s %s %s %.1fms",
                scope.get("method"),
                scope.get("path"),
                status_code,
                (time.perf_counter() - started) * 1000,
                extra={
                    "method": scope.get("method"),
                    "path": scope.get("path"),
                    "status": status_code,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                },
            )
            reset_request_id(token)
