"""공통코드 테이블 접근 (Spring의 Repository/DAO 역할). SQL 은 이 파일에만 둡니다. commit 은 service 가 합니다."""

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.codes.models import Code, CodeGroup


def list_groups(db: Session, *, owner: str | None, include_inactive: bool) -> list[CodeGroup]:
    """묶음 목록 (값까지 한 번에). owner 로 거르고, group_code 순"""
    query = select(CodeGroup).options(selectinload(CodeGroup.codes)).order_by(CodeGroup.group_code)
    if owner is not None:
        query = query.where(CodeGroup.owner == owner)
    if not include_inactive:
        query = query.where(CodeGroup.is_active.is_(True))
    return list(db.scalars(query))


def get_group(db: Session, group_code: str) -> CodeGroup | None:
    return db.get(CodeGroup, group_code)


def get_code(db: Session, group_code: str, code: str) -> Code | None:
    return db.get(Code, (group_code, code))


def add(db: Session, row: Code) -> None:
    db.add(row)
    db.flush()
