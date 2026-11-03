"""발송 방법(백엔드). MAIL_BACKEND 값으로 하나를 고릅니다."""

import logging
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import ClassVar, Protocol

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Message:
    to: str
    subject: str
    text: str
    html: str
    template: str


class MailBackend(Protocol):
    def send(self, message: Message) -> None: ...


class ConsoleBackend:
    """실제로 보내지 않고 로그로만 남깁니다. 본문(인증번호·링크)은 APP_ENV=local 에서만 출력합니다."""

    def send(self, message: Message) -> None:
        logger.info("메일(console) to=%s subject=%s", message.to, message.subject)
        if settings.app_env == "local":
            logger.info("메일 본문 (로컬 전용 출력)\n%s", message.text)


class SmtpBackend:
    """SMTP로 보냅니다. 로컬에서는 Mailpit(docker compose up -d mailpit), 운영에서는 메일 업체의 SMTP."""

    def send(self, message: Message) -> None:
        email = EmailMessage()
        email["Subject"] = message.subject
        email["From"] = settings.mail_from
        email["To"] = message.to
        email.set_content(message.text)
        email.add_alternative(message.html, subtype="html")

        smtp_class = smtplib.SMTP_SSL if settings.mail_smtp_ssl else smtplib.SMTP
        with smtp_class(
            settings.mail_smtp_host, settings.mail_smtp_port, timeout=settings.mail_smtp_timeout
        ) as smtp:
            if settings.mail_smtp_starttls and not settings.mail_smtp_ssl:
                smtp.starttls()
            if settings.mail_smtp_username:
                smtp.login(settings.mail_smtp_username, settings.mail_smtp_password)
            smtp.send_message(email)


class FakeBackend:
    """테스트용. 보낸 메일을 outbox 리스트에 쌓습니다 (tests/conftest.py 의 mail_outbox 픽스처)."""

    outbox: ClassVar[list[Message]] = []

    def send(self, message: Message) -> None:
        self.outbox.append(message)


# TODO(메일 업체 선택 후): Resend 같은 업체 API로 보내는 백엔드를 추가하고 아래 표에 등록합니다.
#   대부분의 업체가 SMTP도 지원하므로, 그 전까지는 MAIL_BACKEND=smtp 로 업체의 SMTP 주소를 써도 됩니다.

BACKENDS: dict[str, type[MailBackend]] = {
    "console": ConsoleBackend,
    "smtp": SmtpBackend,
    "fake": FakeBackend,
}


def get_backend() -> MailBackend:
    try:
        return BACKENDS[settings.mail_backend]()
    except KeyError:
        raise ValueError(f"MAIL_BACKEND 값이 올바르지 않습니다: {settings.mail_backend}") from None
