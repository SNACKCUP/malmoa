"""현재 사용자(누가, 어떤 역할로 요청했는지)와 권한 검사. (Spring 의 SecurityContextHolder + @PreAuthorize 역할)

core 는 회원 테이블도 로그인 방법도 모릅니다. 요청마다 auth 가 토큰과 DB 를 확인해
request.state 에 Principal 을 담고(app.auth.principal.load_principal), 여기 검사 함수는 그 칸만 읽습니다.
그래서 어느 공통 모듈이든 core 만 import 해서 권한을 검사할 수 있습니다.

    @router.post("", dependencies=[Depends(require_admin)])
    def create(...): ...

칸이 비어 있으면(로그인 안 함, 또는 load_principal 이 등록되지 않음) 401, 역할이 없으면 403 입니다.
ContextVar 가 아니라 request.state 를 쓰는 이유: FastAPI 는 동기 의존성을 다른 스레드에서 돌려서
ContextVar 에 넣은 값이 API 코드에 보이지 않을 수 있습니다 (Spring 의 ThreadLocal 과 같은 문제).
"""

from collections.abc import Callable
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.exceptions import ForbiddenError

# Swagger 에 "이 API 는 Bearer 토큰 필요"(자물쇠)를 표시하고 Authorize 한 토큰을 보내게 하는 용도입니다. 확인은 하지 않습니다.
_bearer = HTTPBearer(auto_error=False)

ADMIN_ROLE = "MASTER"  # 킷 관리자(서비스 전체 관리자) 역할. 관리자 검사는 이 값 하나로만 합니다.


@dataclass(frozen=True)
class Principal:
    user_id: int
    roles: frozenset[str]


def set_principal(request: Request, principal: Principal) -> None:
    request.state.principal = principal


def get_principal(request: Request) -> Principal | None:
    return getattr(request.state, "principal", None)


def _unauthorized() -> HTTPException:
    # get_current_user 와 같은 401 (RFC 6750 WWW-Authenticate). 전역 핸들러가 {"detail","code","request_id"}로 감쌉니다.
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="로그인이 필요합니다.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_role(*codes: str) -> Callable[[Request], Principal]:
    """로그인했고, 나열한 역할 중 하나라도 있어야 통과합니다. 역할을 적지 않으면 로그인만 확인합니다."""

    def checker(request: Request, _: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> Principal:
        principal = get_principal(request)
        if principal is None:
            raise _unauthorized()
        if codes and principal.roles.isdisjoint(codes):
            raise ForbiddenError("FORBIDDEN", "권한이 없습니다.")
        return principal

    return checker


require_login = require_role()
require_admin = require_role(ADMIN_ROLE)
