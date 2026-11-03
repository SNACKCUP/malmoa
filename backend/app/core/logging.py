"""앱 로그 설정. app.* 로거를 표준 출력으로 내보내고, 모든 줄에 요청 ID를 붙입니다.

LOG_FORMAT=json 이면 한 줄에 JSON 하나(운영, 로그 수집용), text 면 사람이 읽기 쉬운 형식(로컬)입니다.
비밀번호·토큰·인증번호·업로드 문서 내용은 로그 메시지에 넣지 않습니다.
"""

import json
import logging
from datetime import UTC, datetime

from app.core.config import settings
from app.core.request_context import get_request_id

# 접근 로그 등에서 extra 로 넘기는 필드. JSON 로그에 그대로 실립니다.
_EXTRA_FIELDS = ("method", "path", "status", "duration_ms")


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id() or "-"
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        data = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", "-"),
        }
        for key in _EXTRA_FIELDS:
            if hasattr(record, key):
                data[key] = getattr(record, key)
        if record.exc_info:
            data["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(data, ensure_ascii=False)


def log_format() -> str:
    if settings.log_format:
        return settings.log_format.lower()
    return "text" if settings.app_env == "local" else "json"


def setup_logging() -> None:
    logger = logging.getLogger("app")
    logger.setLevel(settings.log_level.upper())
    logger.propagate = False
    if getattr(logger, "_meerkit_configured", False):
        return
    handler = logging.StreamHandler()
    handler.addFilter(RequestIdFilter())
    if log_format() == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s [%(request_id)s] %(message)s")
        )
    logger.addHandler(handler)
    logger._meerkit_configured = True  # type: ignore[attr-defined]
    # 접근 로그는 app.access 가 남기므로 uvicorn 기본 접근 로그는 끕니다 (중복 방지)
    logging.getLogger("uvicorn.access").disabled = True
