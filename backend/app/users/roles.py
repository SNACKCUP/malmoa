# 역할 코드. roles 테이블의 code 값과 같습니다 (초기 데이터는 마이그레이션에서 넣음).
# 역할은 회원 데이터라 users 에 둡니다. 관리자 역할(ADMIN_ROLE)과 권한 검사는 core/principal.py 에 있습니다.
# 역할별 세부 권한은 아직 정하지 않았습니다. 지금은 이름만 있습니다.
MASTER = "MASTER"
OWNER = "OWNER"
VIEWER = "VIEWER"
WRITER = "WRITER"

ALL = (MASTER, OWNER, VIEWER, WRITER)

DEFAULT_ROLE = VIEWER  # 가입하면 받는 역할
