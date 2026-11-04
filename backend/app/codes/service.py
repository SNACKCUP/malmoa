"""공통코드 업무 규칙. 서비스 코드는 list_codes / is_valid_code / require_code 를 씁니다.

    from app.codes import list_codes, require_code
    require_code(db, "SVC_REQ_KIND", body.kind)     # 켜진 값이 아니면 400 INVALID_CODE
    kinds = list_codes(db, "SVC_REQ_KIND")          # AI 에게 넘길 구분 목록, 드롭다운
"""

import logging

from sqlalchemy.orm import Session

from app.codes import repository
from app.codes.models import Code, CodeGroup
from app.core.exceptions import BadRequestError, ConflictError, NotFoundError

logger = logging.getLogger(__name__)


def _group_or_404(db: Session, group_code: str) -> CodeGroup:
    group = repository.get_group(db, group_code)
    if group is None:
        raise NotFoundError("CODE_GROUP_NOT_FOUND", "공통코드 묶음을 찾을 수 없습니다.")
    return group


def _active_only(group: CodeGroup) -> list[Code]:
    return [code for code in group.codes if code.is_active]


# ---- 조회 ----


def list_groups(db: Session, *, owner: str | None = None, include_inactive: bool = False) -> list[CodeGroup]:
    """묶음 목록. include_inactive=False 면 켜진 묶음만 (값은 응답 단계에서 켜진 것만 고름)"""
    return repository.list_groups(db, owner=owner, include_inactive=include_inactive)


def get_active_group(db: Session, group_code: str) -> CodeGroup:
    """켜진 묶음 하나. 없거나 꺼졌으면 404"""
    group = _group_or_404(db, group_code)
    if not group.is_active:
        raise NotFoundError("CODE_GROUP_NOT_FOUND", "공통코드 묶음을 찾을 수 없습니다.")
    return group


def list_codes(db: Session, group_code: str, *, include_inactive: bool = False) -> list[Code]:
    """한 묶음의 값 목록 (sort_order 순). 묶음이 꺼져 있으면 켜진 값도 없는 것으로 봅니다.

    include_inactive=True 는 이미 저장된 데이터의 이름을 보여 줄 때 씁니다 (꺼진 값도 이름은 보여야 함).
    """
    group = _group_or_404(db, group_code)
    if include_inactive:
        return list(group.codes)
    return _active_only(group) if group.is_active else []


def is_valid_code(db: Session, group_code: str, code: str) -> bool:
    """새로 고를 수 있는 값인지 (묶음과 값이 모두 켜져 있음)"""
    row = repository.get_code(db, group_code, code)
    return row is not None and row.is_active and row.group.is_active


def require_code(db: Session, group_code: str, code: str) -> None:
    """새로 고를 수 있는 값이 아니면 400 INVALID_CODE. 저장 전에 부릅니다."""
    if not is_valid_code(db, group_code, code):
        raise BadRequestError("INVALID_CODE", f"사용할 수 없는 값입니다: {group_code}.{code}")


# ---- 관리자 (MASTER). 묶음 추가·삭제와 값 삭제는 없습니다 (묶음은 마이그레이션, 값은 끄기) ----


def add_code(
    db: Session, actor_id: int, group_code: str, *, code: str, label: str, sort_order: int
) -> Code:
    _group_or_404(db, group_code)
    if repository.get_code(db, group_code, code) is not None:
        raise ConflictError("CODE_EXISTS", "이미 있는 값입니다. 다시 쓰려면 기존 값을 켜세요.")
    row = Code(group_code=group_code, code=code, label=label, sort_order=sort_order)
    repository.add(db, row)
    db.commit()
    db.refresh(row)
    logger.info("공통코드 추가 group=%s code=%s actor_id=%s", group_code, code, actor_id)
    return row


def update_code(db: Session, actor_id: int, group_code: str, code: str, changes: dict) -> Code:
    """label·sort_order·is_active 만 바꿉니다. code 값은 저장된 데이터가 쓰고 있어서 바꾸지 않습니다."""
    row = repository.get_code(db, group_code, code)
    if row is None:
        raise NotFoundError("CODE_NOT_FOUND", "공통코드 값을 찾을 수 없습니다.")
    for field in ("label", "sort_order", "is_active"):
        if field in changes:
            setattr(row, field, changes[field])
    db.commit()
    db.refresh(row)
    logger.info(
        "공통코드 수정 group=%s code=%s fields=%s actor_id=%s", group_code, code, sorted(changes), actor_id
    )
    return row
