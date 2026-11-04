from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth import service
from app.core.database import get_db
from app.users.models import User

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """Authorization: Bearer <액세스 토큰> 으로 로그인한 사용자를 꺼냅니다. (Spring Security 필터 역할)

    권한(역할) 검사는 app.core.principal 의 require_admin 등으로 합니다. 이 함수는 회원 정보가 필요할 때 씁니다.
    """
    # load_principal(앱 전체 공통 의존성)이 이미 확인한 회원이 있으면 다시 읽지 않습니다
    user = getattr(request.state, "current_user", None)
    if user is None and credentials is not None:
        user = service.user_from_token(db, credentials.credentials, "access")
    if user is None:
        # 표준(RFC 6750)대로 WWW-Authenticate 헤더를 함께 보냅니다. 전역 핸들러가 {"detail","code","request_id"}로 감쌉니다.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="로그인이 필요합니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user
