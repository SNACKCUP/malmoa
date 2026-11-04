"""회원·역할·약관 테이블 접근 (Spring의 Repository/DAO 역할).

SQL(쿼리)은 이 파일에만 둡니다. 저장(commit)은 하지 않고, 부르는 service가 정합니다.
"""

from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.users.models import Role, Term, User, UserTermAgreement


def get_by_id(db: Session, user_id: int) -> User | None:
    """PK(id)로 회원 1명. 없으면 None"""
    return db.get(User, user_id)


def get_by_login_id(db: Session, login_id: str) -> User | None:
    """로그인 아이디로 회원 1명 (로그인, 아이디 중복 확인)"""
    return db.scalar(select(User).where(User.login_id == login_id))


def get_by_email(db: Session, email: str) -> User | None:
    """이메일로 회원 1명 (가입 중복 확인, 비밀번호 찾기)"""
    return db.scalar(select(User).where(User.email == email))


def get_by_nickname(db: Session, nickname: str) -> User | None:
    """닉네임으로 회원 1명 (닉네임 중복 확인)"""
    return db.scalar(select(User).where(User.nickname == nickname))


def _like(q: str) -> str:
    """검색어를 "포함" 검색용 패턴으로. 사용자가 넣은 % _ 는 글자 그대로 찾도록 막습니다."""
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def search(
    db: Session,
    *,
    q: str | None,
    role_id: int | None,
    status: str | None,
    offset: int,
    limit: int,
) -> tuple[list[User], int]:
    """멤버 검색 (관리자 화면). (이번 페이지 목록, 전체 개수)를 돌려줍니다.

    q: 아이디·이름·이메일·닉네임 중 하나라도 포함
    role_id: 이 역할을 가진 사람만
    status: active(사용 중) / inactive(관리자가 막음) / deleted(탈퇴)
    정렬: 최근 가입 순
    """
    stmt = select(User)
    if q:
        pattern = _like(q)
        stmt = stmt.where(
            or_(
                User.login_id.ilike(pattern, escape="\\"),
                User.name.ilike(pattern, escape="\\"),
                User.email.ilike(pattern, escape="\\"),
                User.nickname.ilike(pattern, escape="\\"),
            )
        )
    if role_id is not None:
        stmt = stmt.where(User.roles.any(Role.id == role_id))
    if status == "active":
        stmt = stmt.where(User.is_active.is_(True), User.deactivated_at.is_(None))
    elif status == "inactive":
        stmt = stmt.where(User.is_active.is_(False), User.deactivated_at.is_(None))
    elif status == "deleted":
        stmt = stmt.where(User.deactivated_at.is_not(None))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = list(db.scalars(stmt.order_by(User.id.desc()).offset(offset).limit(limit)))
    return items, total


def list_roles(db: Session) -> list[Role]:
    """역할 전체 (id 순)"""
    return list(db.scalars(select(Role).order_by(Role.id)))


def get_roles_by_codes(db: Session, codes: list[str]) -> list[Role]:
    """역할 코드 목록(["VIEWER", ...])에 해당하는 역할들. 없는 코드는 빠집니다."""
    return list(db.scalars(select(Role).where(Role.code.in_(codes)).order_by(Role.id)))


def add(db: Session, user: User) -> User:
    """새 회원 추가. flush 로 id를 바로 받아 둡니다 (commit은 service가)"""
    db.add(user)
    db.flush()
    return user


def list_current_terms(db: Session) -> list[Term]:
    """지금 가입 화면에 보여 줄 약관 (is_active 인 버전만)"""
    return list(db.scalars(select(Term).where(Term.is_active.is_(True)).order_by(Term.id)))


def add_term_agreements(db: Session, user_id: int, term_ids: list[int]) -> None:
    """회원의 약관 동의 기록을 한 번에 추가"""
    db.add_all(UserTermAgreement(user_id=user_id, term_id=term_id) for term_id in term_ids)
    db.flush()


def withdrawn_before(db: Session, cutoff: datetime, limit: int) -> list[User]:
    """cutoff 이전에 탈퇴했고 아직 개인정보를 지우지 않은 계정 (탈퇴 정리 배치에서 limit 개씩)"""
    return list(
        db.scalars(
            select(User)
            .where(User.deactivated_at <= cutoff, User.deleted_at.is_(None))
            .order_by(User.id)
            .limit(limit)
        )
    )


def count_withdrawn_before(db: Session, cutoff: datetime) -> int:
    """withdrawn_before 대상이 몇 건인지 (--dry-run 용)"""
    return (
        db.scalar(
            select(func.count(User.id)).where(User.deactivated_at <= cutoff, User.deleted_at.is_(None))
        )
        or 0
    )
