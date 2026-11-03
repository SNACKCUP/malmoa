"""요청한 사용자 — meerkit 로그인 그대로 (app.auth.deps.get_current_user)

말모아는 회원 표를 따로 두지 않는다. 작업·일정·참석자·AI 설정은 meerkit users.id(정수)를 FK 로 쓴다.
쓰는 값은 user.id 뿐이다 (이 객체는 meerkit 의 요청 세션에 속한다 — 말모아 세션에서 고치지 않는다).
"""

from typing import Annotated

from fastapi import Depends

from app.auth.deps import get_current_user
from app.users.models import User

__all__ = ["CurrentUser", "User", "get_current_user"]

CurrentUser = Annotated[User, Depends(get_current_user)]
