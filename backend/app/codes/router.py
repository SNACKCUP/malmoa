"""공통코드 조회 API: /api/codes (로그인한 사람 누구나, 켜진 값만). 화면의 드롭다운을 채울 때 씁니다."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.codes import service
from app.codes.models import CodeGroup
from app.codes.schemas import OWNER_PATTERN, CodeGroupRead, CodeRead
from app.core.database import get_db
from app.core.principal import require_login

router = APIRouter(prefix="/codes", tags=["codes"], dependencies=[Depends(require_login)])


def _public(group: CodeGroup) -> CodeGroupRead:
    return CodeGroupRead(
        group_code=group.group_code,
        owner=group.owner,
        name=group.name,
        description=group.description,
        codes=[CodeRead.model_validate(code) for code in group.codes if code.is_active],
    )


@router.get("", response_model=list[CodeGroupRead], summary="공통코드 목록 (켜진 묶음·값, owner 로 거르기)")
def list_groups(
    owner: Annotated[str | None, Query(max_length=20, pattern=OWNER_PATTERN, description="예: SVC")] = None,
    db: Session = Depends(get_db),
):
    return [_public(group) for group in service.list_groups(db, owner=owner)]


@router.get("/{group_code}", response_model=CodeGroupRead, summary="공통코드 묶음 하나 (켜진 값만)")
def get_group(group_code: str, db: Session = Depends(get_db)):
    return _public(service.get_active_group(db, group_code))
