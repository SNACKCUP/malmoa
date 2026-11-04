"""소셜 로그인 계정 규칙. 공급자와 무관하게 SocialProfile 만 보고 판단합니다.

    1. (provider, provider_user_id) 연결이 있으면 → 그 회원으로 로그인
    2. 없고 같은 이메일 회원이 있으면 → 공급자가 이메일 검증을 보장할 때만 연결 후 로그인
    3. 둘 다 없으면 → 약관 동의를 확인하고 새 회원(VIEWER, 비밀번호 없음) + 연결을 한 트랜잭션으로 생성

실패는 SocialLoginError(code) 로 알리고, router 가 프론트 콜백 주소의 ?error=<code> 로 보냅니다.
"""

import logging
import secrets
from datetime import UTC, datetime

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.social import repository
from app.social.models import SocialAccount
from app.social.schemas import SocialProfile
from app.users import repository as user_repository
from app.users import service as user_service
from app.users.models import User
from app.users.service import UserError

logger = logging.getLogger(__name__)

NAME_MAX = 50


class SocialLoginError(Exception):
    """프론트에 ?error= 로 넘길 코드. 예: account_inactive, email_exists, terms_required"""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _now() -> datetime:
    return datetime.now(UTC)


def _check_usable(user: User | None) -> User:
    if user is None or user.deleted_at is not None or user.deactivated_at is not None or not user.is_active:
        raise SocialLoginError("account_inactive")
    return user


def _remember(account: SocialAccount, profile: SocialProfile, now: datetime) -> None:
    """공급자가 이번에 준 값을 연결 행에 기록합니다. users 의 값은 바꾸지 않습니다."""
    account.email = profile.email
    account.email_verified = profile.email_verified
    account.name = (profile.name or "")[:NAME_MAX] or None
    account.profile_image_url = profile.profile_image_url
    account.last_login_at = now


def _new_login_id(db: Session, provider: str) -> str:
    """아이디 규칙(영문 시작, 영문·숫자·밑줄 4~30자)에 맞는 겹치지 않는 아이디. 예: google_3f9a1c2b7d"""
    for _ in range(5):
        login_id = f"{provider}_{secrets.token_hex(5)}"
        if user_service.is_login_id_available(db, login_id):
            return login_id
    raise SocialLoginError("provider_error")


def _link(db: Session, user: User, profile: SocialProfile, now: datetime) -> None:
    account = SocialAccount(
        user_id=user.id, provider=profile.provider, provider_user_id=profile.provider_user_id
    )
    _remember(account, profile, now)
    repository.add(db, account)


def login_or_signup(db: Session, profile: SocialProfile, *, agreed_terms: list[str]) -> User:
    now = _now()
    account = repository.get_by_provider_user_id(db, profile.provider, profile.provider_user_id)
    if account is not None:
        user = _check_usable(user_repository.get_by_id(db, account.user_id))
        _remember(account, profile, now)
        user.last_login_at = now
        db.commit()
        return user

    if not profile.email:
        raise SocialLoginError("email_required")
    email = profile.email.strip().lower()

    existing = user_repository.get_by_email(db, email)
    if existing is not None:
        # 검증되지 않은 이메일로 연결하면 남의 계정을 가로챌 수 있으므로 자동 연결하지 않습니다.
        if not profile.email_verified:
            raise SocialLoginError("email_exists")
        user = _check_usable(existing)
        if repository.get_by_user_and_provider(db, user.id, profile.provider) is not None:
            raise SocialLoginError("already_linked")  # 이 회원에게 같은 공급자의 다른 계정이 이미 연결됨
        return _save(db, user, profile, now)

    try:
        user = user_service.create_user(
            db,
            login_id=_new_login_id(db, profile.provider),
            email=email,
            password=None,
            name=(profile.name or email.split("@")[0])[:NAME_MAX],
            agreed_terms=agreed_terms,
            email_verified=profile.email_verified,
            commit=False,
        )
    except UserError as e:
        db.rollback()
        if e.code in ("TERMS_REQUIRED", "UNKNOWN_TERM"):
            raise SocialLoginError("terms_required") from None
        if e.code == "EMAIL_TAKEN":
            raise SocialLoginError("email_exists") from None
        raise SocialLoginError("signup_failed") from None
    logger.info("소셜 가입 provider=%s user_id=%s", profile.provider, user.id)
    return _save(db, user, profile, now)


def _save(db: Session, user: User, profile: SocialProfile, now: datetime) -> User:
    """연결 행을 추가하고 회원·약관 동의와 함께 저장합니다. 동시에 같은 계정이 연결되면 모두 되돌립니다."""
    try:
        _link(db, user, profile, now)
        user.last_login_at = now
        db.commit()
    except IntegrityError:
        db.rollback()
        raise SocialLoginError("already_linked") from None
    db.refresh(user)
    return user
