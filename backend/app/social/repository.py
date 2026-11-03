"""소셜 계정 연결 테이블 접근 (Spring의 Repository/DAO 역할).

SQL(쿼리)은 이 파일에만 둡니다. 저장(commit)은 하지 않고, 부르는 service·cleanup이 정합니다.
"""

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.social.models import SocialAccount
from app.users.models import User


def get_by_provider_user_id(db: Session, provider: str, provider_user_id: str) -> SocialAccount | None:
    """공급자 계정으로 연결 1건 (로그인할 때)"""
    return db.scalar(
        select(SocialAccount).where(
            SocialAccount.provider == provider, SocialAccount.provider_user_id == provider_user_id
        )
    )


def get_by_user_and_provider(db: Session, user_id: int, provider: str) -> SocialAccount | None:
    """이 회원에게 이미 연결된 같은 공급자 계정 (다른 계정을 또 연결하지 않도록)"""
    return db.scalar(
        select(SocialAccount).where(SocialAccount.user_id == user_id, SocialAccount.provider == provider)
    )


def add(db: Session, account: SocialAccount) -> None:
    db.add(account)
    db.flush()


def _of_deleted_users():
    return select(User.id).where(User.deleted_at.is_not(None))


def count_of_deleted_users(db: Session) -> int:
    """개인정보를 지운 회원의 연결 수 (cleanup dry-run)"""
    return db.scalar(
        select(func.count(SocialAccount.id)).where(SocialAccount.user_id.in_(_of_deleted_users()))
    ) or 0


def delete_of_deleted_users(db: Session) -> int:
    """개인정보를 지운 회원의 연결 삭제. 지운 건수"""
    result = db.execute(delete(SocialAccount).where(SocialAccount.user_id.in_(_of_deleted_users())))
    return result.rowcount or 0
