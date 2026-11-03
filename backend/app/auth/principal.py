"""요청마다 현재 사용자를 채웁니다. main.py 가 앱 전체 공통 의존성으로 등록합니다. (Spring Security 필터 역할)

토큰이 있으면 get_current_user 와 똑같이 확인하고(서명·만료, 회원 존재, 비활성 아님, 비밀번호 변경 전 토큰 아님)
DB 에서 읽은 역할로 request.state 에 Principal 을 담습니다. 매 요청 DB 에서 읽으므로 역할 회수·비활성화가 바로 반영됩니다.
토큰이 없거나 틀리면 아무것도 담지 않고 넘어갑니다. 막는 일은 core.principal 의 require_* 가 합니다.
"""

from fastapi import Depends, Request
from fastapi.security.utils import get_authorization_scheme_param
from sqlalchemy.orm import Session

from app.auth import service
from app.core.database import get_db
from app.core.principal import Principal, set_principal


def load_principal(request: Request, db: Session = Depends(get_db)) -> None:
    # HTTPBearer 의존성을 쓰지 않고 헤더를 직접 읽습니다. 그래야 Swagger 가 공개 API 까지 자물쇠로 표시하지 않습니다.
    scheme, token = get_authorization_scheme_param(request.headers.get("Authorization"))
    if scheme.lower() != "bearer" or not token:
        return
    user = service.user_from_token(db, token, "access")
    if user is None:
        return
    request.state.current_user = user  # get_current_user 가 다시 읽지 않게
    set_principal(request, Principal(user_id=user.id, roles=frozenset(user.role_codes)))
