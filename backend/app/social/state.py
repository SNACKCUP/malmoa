"""로그인 시작 ↔ 콜백 사이에 들고 있을 값(state, PKCE, 약관 동의)을 서명 쿠키 하나에 담습니다.

서버에 저장하지 않으므로 테이블이 필요 없습니다. 쿠키는 콜백 주소에만 실리고, 콜백에서 바로 지웁니다.
"""

import base64
import hashlib
import hmac
import secrets
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import jwt

from app.core.config import settings
from app.core.security import ALGORITHM

STATE_COOKIE = "meerkit_oauth_state"
STATE_EXPIRE_MINUTES = 10
_TOKEN_TYPE = "social_state"


@dataclass(frozen=True)
class LoginState:
    provider: str
    state: str
    code_verifier: str | None = None  # PKCE 를 쓰는 공급자만
    agreed_terms: list[str] = field(default_factory=list)  # 가입 화면에서 동의한 약관 code (신규 가입 때 사용)

    @property
    def code_challenge(self) -> str | None:
        if self.code_verifier is None:
            return None
        digest = hashlib.sha256(self.code_verifier.encode()).digest()
        return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def cookie_path(provider: str) -> str:
    return f"/api/auth/{provider}/callback"


def new_state(provider: str, *, pkce: bool, agreed_terms: list[str]) -> LoginState:
    return LoginState(
        provider=provider,
        state=secrets.token_urlsafe(32),
        code_verifier=secrets.token_urlsafe(48) if pkce else None,
        agreed_terms=agreed_terms,
    )


def encode(login_state: LoginState) -> str:
    payload = {
        "type": _TOKEN_TYPE,
        "provider": login_state.provider,
        "state": login_state.state,
        "cv": login_state.code_verifier,
        "terms": login_state.agreed_terms,
        "exp": datetime.now(UTC) + timedelta(minutes=STATE_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=ALGORITHM)


def verify(cookie: str | None, provider: str, state: str | None) -> LoginState | None:
    """쿠키 서명·만료, 공급자, 쿼리의 state 가 모두 맞으면 저장해 둔 값. 하나라도 틀리면 None."""
    if not cookie or not state:
        return None
    try:
        payload = jwt.decode(cookie, settings.jwt_secret_key, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None
    if payload.get("type") != _TOKEN_TYPE or payload.get("provider") != provider:
        return None
    saved = payload.get("state")
    if not isinstance(saved, str) or not hmac.compare_digest(saved, state):
        return None
    return LoginState(
        provider=provider,
        state=saved,
        code_verifier=payload.get("cv"),
        agreed_terms=[t for t in payload.get("terms") or [] if isinstance(t, str)],
    )
