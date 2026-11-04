"""소셜 계정 규칙(app.social.service)과 비밀번호 없는 계정, 연결 정리(app.social.cleanup)"""

import re
from datetime import UTC, datetime

import pytest

from app.auth import service as auth_service
from app.auth.service import AuthError
from app.social import service
from app.social.cleanup import cleanup
from app.social.models import SocialAccount
from app.social.schemas import SocialProfile
from app.social.service import SocialLoginError
from app.users import service as user_service
from app.users.service import UserError


def _profile(provider="google", pid="same-id", email="social01@example.com", verified=True):
    return SocialProfile(provider=provider, provider_user_id=pid, email=email, email_verified=verified, name="소셜")


def _social_user(db, **kwargs):
    return service.login_or_signup(db, _profile(**kwargs), agreed_terms=["terms", "privacy"])


def test_same_id_on_different_providers_are_different_accounts(db):
    google_user = _social_user(db, provider="google", pid="12345", email="a@example.com")
    kakao_user = _social_user(db, provider="kakao", pid="12345", email="b@example.com")

    assert google_user.id != kakao_user.id
    assert google_user.login_id.startswith("google_") and kakao_user.login_id.startswith("kakao_")


def test_one_user_can_link_several_providers(db):
    user = _social_user(db, provider="google", pid="g-1")
    linked = service.login_or_signup(db, _profile(provider="kakao", pid="k-1"), agreed_terms=[])

    assert linked.id == user.id
    assert {a.provider for a in db.query(SocialAccount).filter_by(user_id=user.id)} == {"google", "kakao"}


def test_unverified_email_signup_does_not_mark_user_verified(db):
    user = _social_user(db, provider="naver", pid="n-1", verified=False)
    assert user.email_verified_at is None


def test_social_only_user_cannot_change_password_or_withdraw(client, db):
    user = _social_user(db)
    with pytest.raises(AuthError) as auth_error:
        auth_service.change_password(db, user, "whatever123", "newpassword123")
    assert auth_error.value.code == "PASSWORD_NOT_SET"
    with pytest.raises(UserError) as user_error:
        user_service.withdraw(db, user, "whatever123")
    assert user_error.value.code == "PASSWORD_NOT_SET"


def test_password_reset_gives_social_user_a_password(client, db, mail_outbox):
    user = _social_user(db)
    assert client.post("/api/auth/password/forgot", json={"email": user.email}).status_code == 202
    token = re.search(r"reset-password\?token=([\w-]+)", mail_outbox[-1].text).group(1)

    assert client.post("/api/auth/password/reset", json={"token": token, "password": "newpassword123"}).status_code == 204

    db.refresh(user)
    assert user.has_password is True
    response = client.post("/api/auth/login", json={"user_id": user.login_id, "password": "newpassword123"})
    assert response.status_code == 200


def test_cleanup_removes_links_of_deleted_users_only(db):
    kept = _social_user(db, pid="kept", email="kept@example.com")
    gone = _social_user(db, pid="gone", email="gone@example.com")
    user_service.anonymize(gone)
    db.commit()

    assert cleanup(db, dry_run=True) == 1
    assert db.query(SocialAccount).count() == 2  # dry-run 은 지우지 않음
    assert cleanup(db) == 1
    assert [a.user_id for a in db.query(SocialAccount).all()] == [kept.id]
    assert cleanup(db) == 0  # 다시 실행해도 안전


def test_withdrawn_user_rejected_before_purge(db):
    user = _social_user(db)
    user.is_active, user.deactivated_at = False, datetime.now(UTC)
    db.commit()
    with pytest.raises(SocialLoginError) as error:
        _social_user(db)
    assert error.value.code == "account_inactive"
