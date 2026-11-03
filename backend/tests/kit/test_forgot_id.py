"""아이디 찾기 (POST /auth/id/forgot): 가입 여부를 드러내지 않는 같은 응답, 메일 내용, 발송 제한, 로그에 아이디 없음"""

import logging
from datetime import UTC, datetime, timedelta

import pytest

from app.auth.cleanup import cleanup
from app.auth.models import LoginIdMail
from app.core.config import settings

URL = "/api/auth/id/forgot"


@pytest.fixture(autouse=True)
def _app_logs_visible():
    # app 로거는 propagate=False 라서 caplog 가 받도록 테스트 동안만 켭니다 (하네스 pytest-app-logging)
    logger = logging.getLogger("app")
    logger.propagate = True
    yield
    logger.propagate = False


def test_same_response_whether_or_not_email_exists(client, make_user, mail_outbox):
    make_user("user01")
    known = client.post(URL, json={"email": "User01@Example.com "})
    unknown = client.post(URL, json={"email": "nobody@example.com"})
    garbage = client.post(URL, json={"email": "not-an-email"})
    assert known.status_code == unknown.status_code == garbage.status_code == 204
    assert known.content == unknown.content == garbage.content == b""
    [message] = mail_outbox
    assert message.to == "user01@example.com" and message.template == "login_id"
    assert "user01" in message.text and "user01" in message.html


def test_blocked_users_get_no_mail(client, db, make_user, mail_outbox):
    inactive = make_user("user01")
    inactive.is_active = False
    withdrawn = make_user("user02")
    withdrawn.deactivated_at = datetime.now(UTC)
    db.commit()
    for email in ("user01@example.com", "user02@example.com"):
        assert client.post(URL, json={"email": email}).status_code == 204
    assert mail_outbox == []


def test_social_only_account_is_told_to_set_a_password(client, db, make_user, mail_outbox):
    user = make_user("user01")
    user.has_password = False
    db.commit()
    client.post(URL, json={"email": "user01@example.com"})
    assert "비밀번호 찾기" in mail_outbox[-1].text


def test_rate_limited_silently(client, make_user, mail_outbox, monkeypatch):
    make_user("user01")
    assert client.post(URL, json={"email": "user01@example.com"}).status_code == 204
    assert client.post(URL, json={"email": "user01@example.com"}).status_code == 204  # 60초 안: 조용히 건너뜀
    assert len(mail_outbox) == 1

    monkeypatch.setattr(settings, "mail_cooldown_seconds", 0)
    monkeypatch.setattr(settings, "mail_daily_limit", 2)
    for _ in range(3):
        assert client.post(URL, json={"email": "user01@example.com"}).status_code == 204
    assert len(mail_outbox) == 2  # 하루 한도


def test_logs_never_contain_login_id(client, make_user, mail_outbox, caplog):
    make_user("findme_secret", email="owner@example.com")  # 메일 주소는 발송 로그에 남으므로 아이디와 다르게
    with caplog.at_level(logging.DEBUG):
        client.post(URL, json={"email": "owner@example.com"})
        client.post(URL, json={"email": "owner@example.com"})  # 제한으로 건너뛴 로그도 확인
    assert len(mail_outbox) == 1
    assert "findme_secret" not in caplog.text


def test_cleanup_removes_day_old_records(client, db, make_user, mail_outbox):
    user = make_user("user01")
    client.post(URL, json={"email": "user01@example.com"})
    db.add(LoginIdMail(user_id=user.id, created_at=datetime.now(UTC) - timedelta(days=2)))
    db.commit()
    assert cleanup(db, dry_run=True)["login_id_mails"] == 1
    assert cleanup(db)["login_id_mails"] == 1
    assert db.query(LoginIdMail).count() == 1
