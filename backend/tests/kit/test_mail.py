import logging

import pytest

from app.core.config import settings
from app.mail import Rendered, register_template, send_mail
from app.mail import templates as mail_templates


def test_send_mail_renders_template_into_outbox(mail_outbox):
    assert send_mail("a@example.com", "email_code", {"code": "123456", "expire_minutes": 10})
    [message] = mail_outbox
    assert message.to == "a@example.com"
    assert "인증번호" in message.subject
    assert "123456" in message.text and "123456" in message.html


def test_html_escapes_values(mail_outbox):
    send_mail(
        "a@example.com",
        "password_reset",
        {"name": "<b>x</b>", "link": "http://localhost/reset?token=t", "expire_minutes": 30},
    )
    assert "<b>x</b>" not in mail_outbox[0].html


def test_failure_returns_false_and_logs_without_data(mail_outbox, caplog, monkeypatch):
    monkeypatch.setattr(settings, "mail_backend", "smtp")
    monkeypatch.setattr(settings, "mail_smtp_host", "127.0.0.1")
    monkeypatch.setattr(settings, "mail_smtp_port", 1)  # 아무도 듣지 않는 포트
    with caplog.at_level(logging.ERROR, logger="app.mail"):
        ok = send_mail("a@example.com", "email_code", {"code": "987654", "expire_minutes": 10})
    assert ok is False
    assert "메일 발송 실패" in caplog.text
    assert "987654" not in caplog.text


def test_unknown_template_is_reported_not_raised(mail_outbox):
    assert send_mail("a@example.com", "nope", {}) is False
    assert mail_outbox == []


def test_console_backend_hides_body_outside_local(caplog, monkeypatch):
    monkeypatch.setattr(settings, "mail_backend", "console")
    monkeypatch.setattr(settings, "app_env", "production")
    with caplog.at_level(logging.INFO, logger="app.mail"):
        send_mail("a@example.com", "email_code", {"code": "555111", "expire_minutes": 10})
    assert "a@example.com" in caplog.text
    assert "555111" not in caplog.text


@pytest.fixture
def restore_templates():
    """테스트에서 등록한 양식을 끝나면 지웁니다 (등록 목록은 앱 전역)."""
    before = dict(mail_templates.TEMPLATES)
    yield
    mail_templates.TEMPLATES.clear()
    mail_templates.TEMPLATES.update(before)


def _invite(data):
    return Rendered(subject=f"{data['project']} 초대", text=data["link"], html=f"<p>{data['link']}</p>")


def test_registered_template_is_sent_like_kit_templates(mail_outbox, restore_templates):
    register_template("svc_invite", _invite)
    assert send_mail("a@example.com", "svc_invite", {"project": "쇼핑몰", "link": "http://localhost/i/t"})
    [message] = mail_outbox
    assert message.subject == "쇼핑몰 초대"
    assert message.template == "svc_invite"


def test_duplicate_or_kit_name_cannot_be_overwritten(restore_templates):
    register_template("svc_invite", _invite)
    with pytest.raises(ValueError):
        register_template("svc_invite", _invite)
    with pytest.raises(ValueError):
        register_template("email_code", _invite)


@pytest.mark.parametrize("name", ["", "Invite", "1invite", "svc-invite", "svc invite"])
def test_template_name_format_is_checked(name, restore_templates):
    with pytest.raises(ValueError):
        register_template(name, _invite)
