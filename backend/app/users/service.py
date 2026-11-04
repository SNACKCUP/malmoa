"""회원 관리 업무 규칙. HTTP는 모르고, DB 접근은 repository에 맡깁니다."""

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.core.security import generate_token, hash_password, verify_password
from app.storage import get_storage
from app.users import avatar, repository
from app.users.models import Role, Term, User
from app.users.roles import DEFAULT_ROLE

logger = logging.getLogger(__name__)

RESERVED_LOGIN_ID_PREFIX = "deleted_"  # 개인정보를 지운 계정의 아이디에 씁니다


# 오류 코드 → HTTP 상태. 전역 핸들러(core.exceptions)가 이 값으로 응답합니다.
_STATUS = {
    "USER_NOT_FOUND": 404,
    "SELF_CHANGE_FORBIDDEN": 400,
    "UNKNOWN_ROLE": 422,
    "UNKNOWN_TERM": 422,
    "TERMS_REQUIRED": 422,
    "LOGIN_ID_TAKEN": 409,
    "EMAIL_TAKEN": 409,
    "NICKNAME_TAKEN": 409,
    "INVALID_PASSWORD": 400,
    "PASSWORD_NOT_SET": 400,
    "USER_DELETED": 409,
}


class UserError(AppError):
    """회원 규칙 위반. 전역 핸들러가 HTTP 오류로 바꿉니다."""

    def __init__(self, code: str, message: str):
        super().__init__(code, message, status_code=_STATUS.get(code, 400))


def is_login_id_available(db: Session, login_id: str) -> bool:
    login_id = login_id.strip().lower()
    if login_id.startswith(RESERVED_LOGIN_ID_PREFIX):
        return False
    return repository.get_by_login_id(db, login_id) is None


def create_user(
    db: Session,
    *,
    login_id: str,
    email: str,
    password: str | None,
    name: str,
    profile: dict[str, Any] | None = None,
    roles: list[str] | None = None,
    agreed_terms: list[str] | None = None,
    email_verified: bool = False,
    commit: bool = True,
) -> User:
    """가입 규칙(중복 검사, 약관, 기본 역할). commit까지 합니다.

    agreed_terms 가 None 이면 약관 검사를 하지 않습니다 (시드·테스트처럼 서버가 직접 만드는 계정).
    password 가 None 이면 비밀번호 없는 계정(소셜 가입)으로 만듭니다: has_password=false, 로그인에 못 쓰는 해시.
    commit=False 면 flush 까지만 합니다. 부르는 쪽이 다른 행(소셜 연결 등)과 한 트랜잭션으로 저장할 때 씁니다.
    """
    login_id = login_id.strip().lower()
    email = email.strip().lower()
    profile = {k: v for k, v in (profile or {}).items() if v is not None}
    if not is_login_id_available(db, login_id):
        raise UserError("LOGIN_ID_TAKEN", "이미 사용 중인 아이디입니다.")
    if repository.get_by_email(db, email):
        raise UserError("EMAIL_TAKEN", "이미 가입된 이메일입니다.")
    if profile.get("nickname") and repository.get_by_nickname(db, profile["nickname"]):
        raise UserError("NICKNAME_TAKEN", "이미 사용 중인 닉네임입니다.")
    terms = _check_terms(db, agreed_terms) if agreed_terms is not None else []
    user = User(
        login_id=login_id,
        email=email,
        hashed_password=hash_password(password if password is not None else generate_token()),
        has_password=password is not None,
        name=name,
        **profile,
    )
    if email_verified:
        user.email_verified_at = datetime.now(UTC)
    user.roles = repository.get_roles_by_codes(db, roles or [DEFAULT_ROLE])
    repository.add(db, user)
    repository.add_term_agreements(db, user.id, [term.id for term in terms])
    if commit:
        db.commit()
        db.refresh(user)
    return user


def list_terms(db: Session) -> list[Term]:
    return repository.list_current_terms(db)


def _check_terms(db: Session, agreed_codes: list[str]) -> list[Term]:
    """동의한 약관 code 목록을 확인하고, 동의 기록을 남길 약관(현재 버전)을 돌려줍니다."""
    current = {term.code: term for term in repository.list_current_terms(db)}
    agreed = set(agreed_codes)
    if agreed - current.keys():
        raise UserError("UNKNOWN_TERM", "존재하지 않는 약관이 있습니다.")
    if any(term.is_required and code not in agreed for code, term in current.items()):
        raise UserError("TERMS_REQUIRED", "필수 약관에 모두 동의해 주세요.")
    return [current[code] for code in sorted(agreed)]


def search_users(
    db: Session, *, q: str | None, role_id: int | None, status: str | None, page: int, size: int
) -> tuple[list[User], int]:
    return repository.search(
        db, q=(q or "").strip() or None, role_id=role_id, status=status, offset=(page - 1) * size, limit=size
    )


def list_roles(db: Session) -> list[Role]:
    return repository.list_roles(db)


# ---- 내 정보 ----


def update_profile(
    db: Session, user: User, changes: dict[str, Any], *, email_verified: bool = False
) -> User:
    """바꿀 항목만 받습니다. 선택 항목은 None 으로 보내면 지워집니다. 이메일을 바꾸면 인증 상태를 다시 정합니다."""
    if "email" in changes:
        email = changes["email"].strip().lower()
        if email != user.email:
            other = repository.get_by_email(db, email)
            if other is not None and other.id != user.id:
                raise UserError("EMAIL_TAKEN", "이미 가입된 이메일입니다.")
            user.email = email
            user.email_verified_at = datetime.now(UTC) if email_verified else None
        changes = {k: v for k, v in changes.items() if k != "email"}
    nickname = changes.get("nickname")
    if nickname and nickname != user.nickname:
        other = repository.get_by_nickname(db, nickname)
        if other is not None and other.id != user.id:
            raise UserError("NICKNAME_TAKEN", "이미 사용 중인 닉네임입니다.")
    for field, value in changes.items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


def _delete_avatar_file(key: str | None) -> None:
    """이전 이미지 파일 삭제. 실패해도 요청은 성공으로 두고 로그만 남깁니다 (DB 는 이미 새 값)."""
    if not key:
        return
    try:
        get_storage().delete(key)
    except AppError as e:
        logger.warning("프로필 이미지 파일 삭제 실패 key=%s code=%s", key, e.code)


def set_avatar(db: Session, user: User, data: bytes) -> User:
    """이미지를 검사·변환해 저장소에 올리고 주소를 기록합니다. 이전 이미지는 지웁니다."""
    image = avatar.process(data)
    storage = get_storage()
    key = avatar.new_key()
    storage.put(key, image, avatar.CONTENT_TYPE)
    old_key = user.avatar_key
    user.avatar_key = key
    user.avatar_url = storage.public_url(key)
    db.commit()
    db.refresh(user)
    logger.info("프로필 이미지 변경 user_id=%s size=%s", user.id, len(image))
    _delete_avatar_file(old_key)
    return user


def remove_avatar(db: Session, user: User) -> User:
    old_key = user.avatar_key
    user.avatar_key = None
    user.avatar_url = None
    db.commit()
    db.refresh(user)
    _delete_avatar_file(old_key)
    return user


def _deactivate(user: User) -> None:
    """탈퇴 처리: 계정을 막고 탈퇴 시각을 남깁니다. 개인정보는 보관 기간 뒤 purge 명령이 지웁니다."""
    user.is_active = False
    if user.deactivated_at is None:
        user.deactivated_at = datetime.now(UTC)


def withdraw(db: Session, user: User, password: str) -> None:
    if not user.has_password:
        # 소셜로만 가입한 계정은 확인할 비밀번호가 없음. 비밀번호 재설정 메일로 먼저 비밀번호를 만들어야 함
        raise UserError("PASSWORD_NOT_SET", "비밀번호가 없는 계정입니다. 비밀번호를 먼저 설정해 주세요.")
    if not verify_password(password, user.hashed_password):
        raise UserError("INVALID_PASSWORD", "비밀번호가 올바르지 않습니다.")
    _deactivate(user)
    db.commit()


DELETED_NAME = "탈퇴회원"
UNUSABLE_PASSWORD = "!deleted"  # 어떤 비밀번호와도 맞지 않는 값 (로그인은 deleted_at 으로 먼저 막힘)
PERSONAL_FIELDS = (
    "nickname",
    "phone",
    "postcode",
    "address",
    "address_detail",
    "birth_date",
    "gender",
    "avatar_url",
    "avatar_key",
    "email_verified_at",
    "last_login_at",
)


def anonymize(user: User) -> None:
    """개인정보를 지우고 deleted_at 을 기록합니다. 행은 남겨 다른 데이터의 참조(작성자 등)가 깨지지 않게 합니다."""
    user.login_id = f"{RESERVED_LOGIN_ID_PREFIX}{user.id}"
    user.email = f"{RESERVED_LOGIN_ID_PREFIX}{user.id}@deleted.invalid"
    user.name = DELETED_NAME
    user.hashed_password = UNUSABLE_PASSWORD
    _delete_avatar_file(user.avatar_key)
    for field in PERSONAL_FIELDS:
        setattr(user, field, None)
    user.is_active = False
    user.failed_login_count = 0
    user.locked_until = None
    user.deleted_at = datetime.now(UTC)


# ---- 관리자 ----


def _get_other_user(db: Session, actor: User, user_id: int) -> User:
    user = repository.get_by_id(db, user_id)
    if user is None:
        raise UserError("USER_NOT_FOUND", "사용자를 찾을 수 없습니다.")
    if user.id == actor.id:
        # 관리자가 자기 권한을 빼거나 자기 계정을 막아 아무도 관리자가 없어지는 상황을 막습니다.
        raise UserError("SELF_CHANGE_FORBIDDEN", "자기 자신의 역할·상태는 바꿀 수 없습니다.")
    return user


def update_roles(db: Session, actor: User, user_id: int, codes: list[str]) -> User:
    user = _get_other_user(db, actor, user_id)
    codes = sorted(set(codes))
    roles = repository.get_roles_by_codes(db, codes)
    if len(roles) != len(codes):
        raise UserError("UNKNOWN_ROLE", "존재하지 않는 역할이 있습니다.")
    user.roles = roles
    db.commit()
    db.refresh(user)
    return user


def update_active(db: Session, actor: User, user_id: int, is_active: bool) -> User:
    """활성/비활성 전환. 로그인 잠금도 함께 풉니다. 탈퇴한 계정을 활성화하면 탈퇴가 취소됩니다."""
    user = _get_other_user(db, actor, user_id)
    if user.deleted_at is not None:
        raise UserError("USER_DELETED", "개인정보가 삭제된 계정은 바꿀 수 없습니다.")
    user.is_active = is_active
    if is_active:
        user.deactivated_at = None
    user.failed_login_count = 0
    user.locked_until = None
    db.commit()
    db.refresh(user)
    return user


def delete_user(db: Session, actor: User, user_id: int) -> None:
    """관리자 삭제 = 탈퇴 처리 (바로 지우지 않고 보관 기간 뒤 개인정보 삭제)"""
    user = _get_other_user(db, actor, user_id)
    _deactivate(user)
    db.commit()
