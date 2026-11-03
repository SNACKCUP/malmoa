# 권한 검사에 쓰는 역할 기준. 역할 코드 자체는 users/roles.py, 관리자 역할과 검사 함수는 core/principal.py 에 있고,
# 여기서는 다시 내보내기만 합니다 (예전 import 경로 `from app.permissions import roles` 호환).
from app.core.principal import ADMIN_ROLE
from app.users.roles import ALL, DEFAULT_ROLE, MASTER, OWNER, VIEWER, WRITER

__all__ = ["ADMIN_ROLE", "ALL", "DEFAULT_ROLE", "MASTER", "OWNER", "VIEWER", "WRITER"]
