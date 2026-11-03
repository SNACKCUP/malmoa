import logging
from typing import Any

from app.mail.backends import Message, get_backend
from app.mail.templates import render

logger = logging.getLogger(__name__)


def send_mail(to: str, template: str, data: dict[str, Any]) -> bool:
    """템플릿으로 메일을 만들어 보냅니다. 실패해도 예외를 던지지 않고 False를 돌려줍니다.

    요청 응답이 늦어지지 않도록 라우터에서 BackgroundTasks 로 부르는 것을 권장합니다.
    로그에는 받는 사람과 템플릿 이름만 남기고, data(인증번호·링크)는 남기지 않습니다.
    """
    try:
        rendered = render(template, data)
        get_backend().send(
            Message(
                to=to,
                subject=rendered.subject,
                text=rendered.text,
                html=rendered.html,
                template=template,
            )
        )
    except Exception as e:  # noqa: BLE001 — 메일 실패가 요청 전체를 실패시키지 않게 합니다
        logger.error("메일 발송 실패 to=%s template=%s error=%s", to, template, type(e).__name__)
        return False
    logger.info("메일 발송 to=%s template=%s", to, template)
    return True
