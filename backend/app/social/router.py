"""소셜 로그인 주소. 브라우저가 직접 이동하는 주소라 JSON 이 아니라 302 로 응답합니다.

    GET /api/auth/{provider}/login     → 공급자 인증 화면으로 302 (state 쿠키 설정)
    GET /api/auth/{provider}/callback  → 공급자가 돌려보내는 곳. 리프레시 쿠키를 심고 프론트로 302

프론트는 /auth/{provider}/callback 화면에서 POST /api/auth/refresh 로 액세스 토큰을 받습니다.
실패하면 프론트 주소에 ?error=<코드> 를 붙입니다. 토큰은 주소에 싣지 않습니다.
"""

import logging
from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.auth import service as auth_service
from app.auth.router import set_refresh_cookie
from app.core.config import settings
from app.core.database import get_db
from app.social import service, state
from app.social.providers import OAuthProvider, ProviderError, get_provider
from app.social.service import SocialLoginError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["social"])


def _provider(provider: str) -> OAuthProvider:
    found = get_provider(provider)
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="지원하지 않는 로그인 방식입니다.")
    return found


def _to_frontend(provider: str, error: str | None = None) -> RedirectResponse:
    url = f"{settings.frontend_base_url.rstrip('/')}/auth/{provider}/callback"
    if error:
        url += "?" + urlencode({"error": error})
    response = RedirectResponse(url, status_code=status.HTTP_302_FOUND)
    response.delete_cookie(state.STATE_COOKIE, path=state.cookie_path(provider))  # state 는 한 번만 사용
    return response


@router.get(
    "/{provider}/login",
    status_code=status.HTTP_302_FOUND,
    response_class=RedirectResponse,
    summary="소셜 로그인 시작 (공급자 인증 화면으로 302)",
)
def social_login(
    provider: str,
    agreed_terms: Annotated[
        str | None,
        Query(description="가입 화면에서 동의한 약관 code, 쉼표로 구분 (처음 온 계정의 가입에 사용)", examples=["terms,privacy"]),
    ] = None,
):
    found = _provider(provider)
    terms = [t.strip() for t in (agreed_terms or "").split(",") if t.strip()]
    login_state = state.new_state(provider, pkce=found.uses_pkce, agreed_terms=terms)
    response = RedirectResponse(
        found.authorize_url(login_state.state, login_state.code_challenge), status_code=status.HTTP_302_FOUND
    )
    response.set_cookie(
        state.STATE_COOKIE,
        state.encode(login_state),
        max_age=state.STATE_EXPIRE_MINUTES * 60,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",  # 공급자에서 돌아오는 최상위 이동(GET)에는 실림
        path=state.cookie_path(provider),
    )
    return response


@router.get(
    "/{provider}/callback",
    status_code=status.HTTP_302_FOUND,
    response_class=RedirectResponse,
    summary="소셜 로그인 콜백 (공급자가 호출, 프론트로 302)",
)
def social_callback(
    provider: str,
    code: str | None = None,
    state_param: Annotated[str | None, Query(alias="state")] = None,
    error: str | None = None,
    state_cookie: Annotated[str | None, Cookie(alias=state.STATE_COOKIE)] = None,
    db: Session = Depends(get_db),
):
    found = _provider(provider)
    if error:
        return _to_frontend(provider, "access_denied")  # 사용자가 공급자 화면에서 취소함
    saved = state.verify(state_cookie, provider, state_param)
    if saved is None or not code:
        return _to_frontend(provider, "state_mismatch")
    try:
        profile = found.fetch_profile(found.exchange_code(code, saved.code_verifier))
    except ProviderError:
        logger.warning("소셜 로그인 공급자 오류 provider=%s", provider)
        return _to_frontend(provider, "provider_error")
    try:
        user = service.login_or_signup(db, profile, agreed_terms=saved.agreed_terms)
    except SocialLoginError as e:
        logger.info("소셜 로그인 거절 provider=%s code=%s", provider, e.code)
        return _to_frontend(provider, e.code)

    response = _to_frontend(provider)
    _, refresh_token = auth_service.issue_tokens(user)
    set_refresh_cookie(response, refresh_token)
    return response
