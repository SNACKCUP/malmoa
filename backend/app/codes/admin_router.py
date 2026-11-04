"""공통코드 관리 API: /api/admin/codes (MASTER 만). 꺼진 값 보기·값 추가·이름/순서/켜기·끄기.

묶음 추가·삭제와 값 삭제는 없습니다. 묶음은 주인(킷·서비스)의 마이그레이션에서만 만들고,
값은 이미 저장된 데이터가 쓰고 있을 수 있어서 지우지 않고 끕니다.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.codes import service
from app.codes.schemas import (
    OWNER_PATTERN,
    CodeAdminRead,
    CodeCreate,
    CodeGroupAdminRead,
    CodeUpdate,
)
from app.core.database import get_db
from app.core.principal import Principal, require_admin

router = APIRouter(prefix="/admin/codes", tags=["codes (admin)"])


@router.get(
    "",
    response_model=list[CodeGroupAdminRead],
    dependencies=[Depends(require_admin)],
    summary="공통코드 전체 (꺼진 묶음·값 포함)",
)
def list_groups(
    owner: Annotated[str | None, Query(max_length=20, pattern=OWNER_PATTERN, description="예: SVC")] = None,
    db: Session = Depends(get_db),
):
    return service.list_groups(db, owner=owner, include_inactive=True)


@router.post(
    "/{group_code}",
    response_model=CodeAdminRead,
    status_code=status.HTTP_201_CREATED,
    summary="값 추가 (같은 값이 있으면 409 CODE_EXISTS)",
)
def add_code(
    group_code: str,
    body: CodeCreate,
    db: Session = Depends(get_db),
    admin: Principal = Depends(require_admin),
):
    return service.add_code(
        db, admin.user_id, group_code, code=body.code, label=body.label, sort_order=body.sort_order
    )


@router.patch("/{group_code}/{code}", response_model=CodeAdminRead, summary="값 수정 (이름·순서·켜기/끄기)")
def update_code(
    group_code: str,
    code: str,
    body: CodeUpdate,
    db: Session = Depends(get_db),
    admin: Principal = Depends(require_admin),
):
    return service.update_code(db, admin.user_id, group_code, code, body.model_dump(exclude_unset=True))
