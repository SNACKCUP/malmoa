"""비밀번호 해시, JWT 발급·검증, 일회용 코드·토큰. 기능 코드는 이 모듈만 통해서 토큰을 다룹니다."""

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

import jwt
from pwdlib import PasswordHash

from app.core.config import settings

ALGORITHM = "HS256"
TokenType = Literal["access", "refresh"]

_password_hash = PasswordHash.recommended()  # argon2
_DUMMY_HASH = _password_hash.hash("timing-equalizer")


def hash_password(password: str) -> str:
    return _password_hash.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return _password_hash.verify(password, hashed)


def verify_dummy_password(password: str) -> None:
    """없는 계정도 비밀번호 검사와 비슷한 시간이 걸리게 합니다 (응답 시간으로 가입 여부를 알 수 없게)."""
    _password_hash.verify(password, _DUMMY_HASH)


@dataclass(frozen=True)
class TokenClaims:
    user_id: int
    issued_at: int  # 초 단위 UNIX 시각


def create_token(user_id: int, token_type: TokenType) -> str:
    if token_type == "access":
        expires = timedelta(minutes=settings.jwt_expire_minutes)
    else:
        expires = timedelta(days=settings.refresh_token_expire_days)
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": now + expires,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=ALGORITHM)


def decode_token(token: str, token_type: TokenType) -> TokenClaims | None:
    """토큰이 유효하고 종류가 맞으면 사용자 id와 발급 시각, 아니면 None."""
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
    if payload.get("type") != token_type:
        return None
    try:
        return TokenClaims(user_id=int(payload["sub"]), issued_at=int(payload.get("iat", 0)))
    except (KeyError, ValueError, TypeError):
        return None


def create_email_verification_token(verification_id: int, email: str) -> str:
    """이메일 인증을 마쳤다는 증표. 가입 요청에 붙여 보냅니다."""
    expires = timedelta(minutes=settings.email_verification_token_expire_minutes)
    payload = {
        "sub": str(verification_id),
        "email": email,
        "type": "email_verification",
        "exp": datetime.now(UTC) + expires,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=ALGORITHM)


def decode_email_verification_token(token: str) -> tuple[int, str] | None:
    """(인증 기록 id, 이메일), 유효하지 않으면 None."""
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "email_verification":
        return None
    try:
        return int(payload["sub"]), str(payload["email"])
    except (KeyError, ValueError):
        return None


def generate_code(digits: int = 6) -> str:
    return f"{secrets.randbelow(10**digits):0{digits}d}"


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def hash_secret(value: str) -> str:
    """인증번호·재설정 토큰을 DB에 저장할 때 쓰는 해시. 서버 키로 HMAC 해서 DB만 유출돼서는 역산할 수 없습니다."""
    return hmac.new(settings.jwt_secret_key.encode(), value.encode(), hashlib.sha256).hexdigest()


def secrets_match(value: str, hashed: str) -> bool:
    return hmac.compare_digest(hash_secret(value), hashed)
