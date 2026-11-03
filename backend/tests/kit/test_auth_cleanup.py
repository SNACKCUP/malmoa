"""인증 기록 정리(app.auth.cleanup): 탈퇴 회원의 재설정 토큰, 오래된 이메일 인증 기록"""

from datetime import UTC, datetime, timedelta

from app.auth.cleanup import cleanup
from app.auth.models import EmailVerification, PasswordResetToken
from app.core.config import settings


def _token(db, user, suffix):
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=f"hash-{suffix}",
            expires_at=datetime.now(UTC) + timedelta(minutes=30),
            created_at=datetime.now(UTC),
        )
    )
    db.commit()


def test_removes_reset_tokens_of_withdrawn_users_only(db, make_user):
    active = make_user("active01")
    gone = make_user("gone01")
    gone.is_active = False
    gone.deactivated_at = datetime.now(UTC)
    db.commit()
    _token(db, active, "a")
    _token(db, gone, "g")

    assert cleanup(db, dry_run=True)["reset_tokens"] == 1
    assert db.query(PasswordResetToken).count() == 2  # dry-run 은 지우지 않음

    assert cleanup(db)["reset_tokens"] == 1
    assert [t.user_id for t in db.query(PasswordResetToken).all()] == [active.id]
    assert cleanup(db)["reset_tokens"] == 0  # 다시 실행해도 안전


def test_removes_old_email_verifications(db):
    old = EmailVerification(
        email="x@example.com",
        code_hash="h",
        expires_at=datetime.now(UTC),
        created_at=datetime.now(UTC) - timedelta(days=settings.email_verification_retention_days + 1),
    )
    fresh = EmailVerification(
        email="y@example.com", code_hash="h", expires_at=datetime.now(UTC), created_at=datetime.now(UTC)
    )
    db.add_all([old, fresh])
    db.commit()

    assert cleanup(db, dry_run=True)["email_verifications"] == 1
    assert cleanup(db)["email_verifications"] == 1
    assert {row.email for row in db.query(EmailVerification).all()} == {"y@example.com"}


def test_main_dry_run_exit_code(monkeypatch):
    from app.auth import cleanup as module

    monkeypatch.setattr(module, "cleanup", lambda db, dry_run=False: {"reset_tokens": 0, "email_verifications": 0})
    assert module.main(["--dry-run"]) == 0
