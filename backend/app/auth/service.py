"""로그인·이메일 인증 규칙. 토큰 발급은 core.security, 사용자 조회는 users.repository에 맡깁니다.

메일은 응답을 늦추지 않도록 BackgroundTasks 에 넣어 응답 뒤에 보냅니다.
"""

import logging
import math
from datetime import UTC, datetime, timedelta

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from app.auth import repository as auth_repository
from app.auth.models import EmailVerification, PasswordResetToken
from app.core.config import settings
from app.core.exceptions import AppError
from app.core.security import (
    create_email_verification_token,
    create_token,
    decode_email_verification_token,
    decode_token,
    generate_code,
    generate_token,
    hash_password,
    hash_secret,
    secrets_match,
    verify_dummy_password,
    verify_password,
)
from app.mail import send_mail
from app.users import repository
from app.users import service as user_service
from app.users.models import User

logger = logging.getLogger(__name__)


# 오류 코드 → HTTP 상태. 전역 핸들러(core.exceptions)가 이 값으로 응답합니다.
_STATUS = {
    "INVALID_CREDENTIALS": 401,
    "INACTIVE_USER": 401,
    "WITHDRAWN_USER": 401,
    "ACCOUNT_LOCKED": 429,
    "RATE_LIMITED": 429,
    "EMAIL_TAKEN": 409,
    "INVALID_CODE": 400,
    "INVALID_RESET_TOKEN": 400,
    "INVALID_PASSWORD": 400,
    "SAME_PASSWORD": 400,
    "PASSWORD_NOT_SET": 400,
    "EMAIL_VERIFICATION_REQUIRED": 400,
}


class AuthError(AppError):
    def __init__(self, code: str, message: str, *, retry_after: int | None = None):
        super().__init__(code, message, status_code=_STATUS.get(code, 400), retry_after=retry_after)


def _now() -> datetime:
    return datetime.now(UTC)


def _seconds_until(moment: datetime) -> int:
    return max(1, math.ceil((moment - _now()).total_seconds()))


def _locked_error(locked_until: datetime) -> AuthError:
    seconds = _seconds_until(locked_until)
    return AuthError(
        "ACCOUNT_LOCKED",
        f"로그인 시도가 너무 많습니다. {math.ceil(seconds / 60)}분 후 다시 시도해 주세요.",
        retry_after=seconds,
    )


def _record_login_failure(db: Session, user: User) -> None:
    user.failed_login_count = (user.failed_login_count or 0) + 1
    max_attempts = settings.login_lock_max_attempts
    if max_attempts > 0 and user.failed_login_count >= max_attempts:
        user.locked_until = _now() + timedelta(minutes=settings.login_lock_minutes)
        user.failed_login_count = 0
    db.commit()


def authenticate(db: Session, login_id: str, password: str) -> User:
    user = repository.get_by_login_id(db, login_id.strip().lower())
    # 소셜로만 가입한 계정(has_password=false)은 없는 계정과 같은 응답 (가입 방식을 알려 주지 않음)
    if user is None or user.deleted_at is not None or not user.has_password:
        verify_dummy_password(password)
        raise AuthError("INVALID_CREDENTIALS", "아이디 또는 비밀번호가 올바르지 않습니다.")
    if user.locked_until is not None and user.locked_until > _now():
        raise _locked_error(user.locked_until)
    if not verify_password(password, user.hashed_password):
        _record_login_failure(db, user)
        if user.locked_until is not None and user.locked_until > _now():
            raise _locked_error(user.locked_until)
        raise AuthError("INVALID_CREDENTIALS", "아이디 또는 비밀번호가 올바르지 않습니다.")
    if user.deactivated_at is not None:
        raise AuthError("WITHDRAWN_USER", "탈퇴한 계정입니다.")
    if not user.is_active:
        raise AuthError("INACTIVE_USER", "비활성화된 계정입니다. 관리자에게 문의하세요.")

    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = _now()
    db.commit()
    return user


def issue_tokens(user: User) -> tuple[str, str]:
    """(액세스 토큰, 리프레시 토큰)"""
    return create_token(user.id, "access"), create_token(user.id, "refresh")


def user_from_token(db: Session, token: str, token_type: str) -> User | None:
    claims = decode_token(token, token_type)  # type: ignore[arg-type]
    if claims is None:
        return None
    user = repository.get_by_id(db, claims.user_id)
    if user is None or not user.is_active or user.deactivated_at is not None:
        return None
    # 비밀번호를 바꾸기 전에 발급된 토큰은 거부합니다 (iat가 초 단위라 같은 초에 발급된 토큰은 허용)
    if user.password_changed_at is not None and claims.issued_at < int(
        user.password_changed_at.timestamp()
    ):
        return None
    return user


# ---- 메일 발송 횟수 제한 (인증번호·비밀번호 재설정 공통) ----


def mail_retry_after(count_today: int, first_today: datetime | None, last: datetime | None) -> int | None:
    """보내면 안 되는 상황이면 기다려야 할 초, 보내도 되면 None"""
    now = _now()
    if last is not None and settings.mail_cooldown_seconds > 0:
        next_allowed = last + timedelta(seconds=settings.mail_cooldown_seconds)
        if next_allowed > now:
            return _seconds_until(next_allowed)
    if count_today >= settings.mail_daily_limit and first_today is not None:
        return _seconds_until(first_today + timedelta(days=1))
    return None


# ---- 가입 전 이메일 인증 ----

INVALID_CODE_MESSAGE = "인증번호가 올바르지 않거나 만료되었습니다."


def send_email_code(db: Session, tasks: BackgroundTasks, email: str) -> None:
    email = email.strip().lower()
    if repository.get_by_email(db, email):
        raise AuthError("EMAIL_TAKEN", "이미 가입된 이메일입니다.")
    count, first, last = auth_repository.email_codes_since(db, email, _now() - timedelta(days=1))
    retry_after = mail_retry_after(count, first, last)
    if retry_after is not None:
        raise AuthError("RATE_LIMITED", "잠시 후 다시 시도해 주세요.", retry_after=retry_after)

    code = generate_code()
    now = _now()
    auth_repository.add(
        db,
        EmailVerification(
            email=email,
            code_hash=hash_secret(code),
            expires_at=now + timedelta(minutes=settings.email_code_expire_minutes),
            created_at=now,
        ),
    )
    db.commit()
    tasks.add_task(
        send_mail,
        email,
        "email_code",
        {"code": code, "expire_minutes": settings.email_code_expire_minutes},
    )


def verify_email_code(db: Session, email: str, code: str) -> str:
    """인증번호가 맞으면 가입에 붙일 증표(token)를 돌려줍니다."""
    email = email.strip().lower()
    row = auth_repository.latest_pending_email_code(db, email)
    if (
        row is None
        or row.expires_at <= _now()
        or row.attempts >= settings.email_code_max_attempts
    ):
        raise AuthError("INVALID_CODE", INVALID_CODE_MESSAGE)
    if not secrets_match(code.strip(), row.code_hash):
        row.attempts += 1
        db.commit()
        raise AuthError("INVALID_CODE", INVALID_CODE_MESSAGE)
    row.verified_at = _now()
    db.commit()
    return create_email_verification_token(row.id, email)


def issue_verified_email_proof(db: Session, email: str) -> str:
    """서비스가 다른 방법(예: 초대 링크 토큰)으로 메일함 소유를 이미 확인한 이메일에 가입 증표를 줍니다.

    인증번호 확인(verify_email_code)과 같은 "확인됨" 기록을 남기고 같은 1회용 증표를 돌려주므로,
    가입(signup)·만료·정리 명령은 그대로 동작합니다. HTTP로 열지 말고, 메일함 소유를 확인한 서비스 코드에서만 부르세요.
    """
    email = email.strip().lower()
    if repository.get_by_email(db, email):
        raise AuthError("EMAIL_TAKEN", "이미 가입된 이메일입니다.")
    now = _now()
    row = EmailVerification(
        email=email,
        code_hash=hash_secret(generate_token()),  # 입력할 번호가 없으므로 아무도 모르는 값
        expires_at=now,
        verified_at=now,
        created_at=now,
    )
    auth_repository.add(db, row)
    db.commit()
    logger.info("확인된 이메일 증표 발급 verification_id=%s", row.id)
    return create_email_verification_token(row.id, email)


def consume_email_verification(db: Session, token: str | None, email: str) -> None:
    """가입할 때 증표를 확인하고 사용 처리합니다. commit은 가입과 함께 합니다."""
    decoded = decode_email_verification_token(token) if token else None
    row = None
    if decoded is not None and decoded[1] == email.strip().lower():
        row = auth_repository.get_email_verification(db, decoded[0])
    if row is None or row.verified_at is None or row.used_at is not None:
        raise AuthError(
            "EMAIL_VERIFICATION_REQUIRED", "이메일 인증을 완료해 주세요. (인증이 만료되었으면 다시 받아 주세요)"
        )
    row.used_at = _now()


def signup(db: Session, data: dict, *, verification_token: str | None) -> User:
    """가입. 이메일 인증 증표 확인 → 계정·약관 동의 저장을 한 트랜잭션으로 처리합니다."""
    verified = False
    if settings.signup_email_verification_required or verification_token:
        consume_email_verification(db, verification_token, data["email"])
        verified = True
    return user_service.create_user(db, **data, email_verified=verified)


# ---- 비밀번호 찾기·재설정·변경 ----

INVALID_RESET_MESSAGE = "링크가 만료되었거나 이미 사용되었습니다."


def _set_password(db: Session, user: User, new_password: str) -> None:
    now = _now()
    user.hashed_password = hash_password(new_password)
    user.has_password = True  # 소셜 가입 계정도 재설정 메일로 비밀번호를 만들면 아이디 로그인 가능
    user.password_changed_at = now  # 이전에 발급된 토큰(다른 기기 로그인)은 더 이상 통하지 않음
    user.failed_login_count = 0
    user.locked_until = None
    auth_repository.expire_reset_tokens(db, user.id, now)


def request_password_reset(db: Session, tasks: BackgroundTasks, email: str) -> None:
    """가입 여부를 알려 주지 않도록 어떤 경우에도 조용히 끝납니다 (라우터는 항상 같은 응답)."""
    user = repository.get_by_email(db, email.strip().lower())
    if user is None or not user.is_active or user.deactivated_at is not None:
        return
    count, first, last = auth_repository.reset_tokens_since(db, user.id, _now() - timedelta(days=1))
    if mail_retry_after(count, first, last) is not None:
        logger.info("비밀번호 재설정 메일 제한으로 건너뜀 user_id=%s", user.id)
        return

    raw = generate_token()
    now = _now()
    auth_repository.expire_reset_tokens(db, user.id, now)  # 이전 링크는 무효
    auth_repository.add(
        db,
        PasswordResetToken(
            user_id=user.id,
            token_hash=hash_secret(raw),
            expires_at=now + timedelta(minutes=settings.password_reset_expire_minutes),
            created_at=now,
        ),
    )
    db.commit()
    link = f"{settings.frontend_base_url.rstrip('/')}/reset-password?token={raw}"
    tasks.add_task(
        send_mail,
        user.email,
        "password_reset",
        {"name": user.name, "link": link, "expire_minutes": settings.password_reset_expire_minutes},
    )


def reset_password(db: Session, token: str, new_password: str) -> None:
    row = auth_repository.get_reset_token_by_hash(db, hash_secret(token))
    if row is None or row.used_at is not None or row.expires_at <= _now():
        raise AuthError("INVALID_RESET_TOKEN", INVALID_RESET_MESSAGE)
    user = repository.get_by_id(db, row.user_id)
    if user is None or not user.is_active or user.deactivated_at is not None:
        raise AuthError("INVALID_RESET_TOKEN", INVALID_RESET_MESSAGE)
    _set_password(db, user, new_password)
    db.commit()


def change_password(db: Session, user: User, current_password: str, new_password: str) -> None:
    if not user.has_password:
        raise AuthError("PASSWORD_NOT_SET", "비밀번호가 없는 계정입니다. 비밀번호 찾기로 먼저 설정해 주세요.")
    if not verify_password(current_password, user.hashed_password):
        raise AuthError("INVALID_PASSWORD", "현재 비밀번호가 올바르지 않습니다.")
    if current_password == new_password:
        raise AuthError("SAME_PASSWORD", "새 비밀번호가 현재 비밀번호와 같습니다.")
    _set_password(db, user, new_password)
    db.commit()
