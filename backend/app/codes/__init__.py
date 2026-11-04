"""공통코드 공통 모듈. 킷과 서비스가 테이블 2개를 같이 쓰고 owner(MEERKIT/서비스 이름)로 구분합니다. (core 만 import)

서비스 코드는 아래 함수만 씁니다.

    from app.codes import list_codes, require_code
    require_code(db, "SVC_REQ_KIND", body.kind)   # 켜진 값이 아니면 400 INVALID_CODE
    kinds = list_codes(db, "SVC_REQ_KIND")        # 켜진 값 목록 (sort_order 순)

묶음과 처음 값은 서비스가 자기 Alembic 마이그레이션에서 넣습니다 (group_code 는 owner + "_" 로 시작).
API: GET /api/codes (로그인), /api/admin/codes (MASTER: 보기·추가·수정).
"""

from app.codes.service import is_valid_code, list_codes, require_code

__all__ = ["is_valid_code", "list_codes", "require_code"]
