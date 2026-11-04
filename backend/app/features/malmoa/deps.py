"""요청한 사용자 — meerkit 로그인 + 말모아 사용 승인(역할)

말모아는 회원 표를 따로 두지 않는다. 작업·일정·참석자·AI 설정은 meerkit users.id(정수)를 FK 로 쓴다.
쓰는 값은 user.id 뿐이다 (이 객체는 meerkit 의 요청 세션에 속한다 — 말모아 세션에서 고치지 않는다).

사용 승인 (통합계획 결정 4, 단계 5 결정 A): 가입하면 누구나 VIEWER 를 받으므로, 관리자가 OWNER 를 줘야 말모아를 쓴다.
MASTER(관리자)는 항상 쓸 수 있다. 승인 전이면 403 MALMOA_NOT_APPROVED — 화면은 이 코드로 "승인 대기"를 보여 준다.
"""

from typing import Annotated

from fastapi import Depends

from app.auth.deps import get_current_user
from app.core.exceptions import ForbiddenError
from app.users.models import User
from app.users.roles import MASTER, OWNER

__all__ = ["APPROVED_ROLES", "CurrentUser", "User", "get_current_user", "get_malmoa_user"]

APPROVED_ROLES = frozenset({MASTER, OWNER})


def get_malmoa_user(user: Annotated[User, Depends(get_current_user)]) -> User:
    """로그인했고 말모아 사용 승인 역할이 있는 회원"""
    if APPROVED_ROLES.isdisjoint(user.role_codes):
        raise ForbiddenError("MALMOA_NOT_APPROVED", "관리자의 사용 승인을 기다리고 있습니다. 승인되면 말모아를 쓸 수 있습니다.")
    return user


CurrentUser = Annotated[User, Depends(get_malmoa_user)]
