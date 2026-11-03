"""이메일 인증번호·비밀번호 재설정 토큰·아이디 찾기 메일·리프레시 토큰 테이블 접근 (Spring의 Repository/DAO 역할).

SQL(쿼리)은 이 파일에만 둡니다. 저장(commit)은 하지 않고, 부르는 service·cleanup이 정합니다.
"""

from datetime import datetime

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session

from app.auth.models import (
    EmailVerification,
    LoginIdMail,
    PasswordResetToken,
    RefreshToken,
)
from app.users.models import User


def add(db: Session, row: object) -> None:
    """인증번호 또는 재설정 토큰 1건 추가"""
    db.add(row)
    db.flush()


def email_codes_since(db: Session, email: str, since: datetime) -> tuple[int, datetime | None, datetime | None]:
    """since 이후 이 이메일로 보낸 인증번호 (개수, 가장 이른 시각, 가장 늦은 시각). 발송 간격·하루 한도 검사용"""
    row = db.execute(
        select(
            func.count(EmailVerification.id),
            func.min(EmailVerification.created_at),
            func.max(EmailVerification.created_at),
        ).where(EmailVerification.email == email, EmailVerification.created_at >= since)
    ).one()
    return row[0], row[1], row[2]


def latest_pending_email_code(db: Session, email: str) -> EmailVerification | None:
    """이 이메일의 가장 최근 인증번호 중 아직 확인·사용하지 않은 것 (번호 확인할 때)"""
    return db.scalar(
        select(EmailVerification)
        .where(
            EmailVerification.email == email,
            EmailVerification.verified_at.is_(None),
            EmailVerification.used_at.is_(None),
        )
        .order_by(EmailVerification.id.desc())
        .limit(1)
    )


def get_email_verification(db: Session, verification_id: int) -> EmailVerification | None:
    """id로 인증 기록 1건 (가입할 때 인증 토큰 확인)"""
    return db.get(EmailVerification, verification_id)


def reset_tokens_since(db: Session, user_id: int, since: datetime) -> tuple[int, datetime | None, datetime | None]:
    """since 이후 이 사용자에게 보낸 재설정 링크 (개수, 가장 이른 시각, 가장 늦은 시각). 발송 간격·하루 한도 검사용"""
    row = db.execute(
        select(
            func.count(PasswordResetToken.id),
            func.min(PasswordResetToken.created_at),
            func.max(PasswordResetToken.created_at),
        ).where(PasswordResetToken.user_id == user_id, PasswordResetToken.created_at >= since)
    ).one()
    return row[0], row[1], row[2]


def expire_reset_tokens(db: Session, user_id: int, now: datetime) -> None:
    """아직 안 쓴 재설정 링크를 모두 못 쓰게 합니다 (새 링크를 보내거나 비밀번호가 바뀌었을 때)"""
    db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == user_id, PasswordResetToken.used_at.is_(None))
        .values(used_at=now)
    )


def get_reset_token_by_hash(db: Session, token_hash: str) -> PasswordResetToken | None:
    """링크 속 토큰의 해시로 재설정 기록 1건 (DB에는 해시만 있으므로 해시로 찾음)"""
    return db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash))


def delete_email_verifications_before(db: Session, cutoff: datetime) -> int:
    """cutoff 이전에 만든 인증번호 기록을 지우고 지운 개수를 돌려줌 (보관 기간 정리)"""
    result = db.execute(delete(EmailVerification).where(EmailVerification.created_at < cutoff))
    return result.rowcount or 0


def _withdrawn_user_ids():
    # 탈퇴(deactivated_at)했거나 개인정보를 지운(deleted_at) 회원
    return select(User.id).where(or_(User.deactivated_at.is_not(None), User.deleted_at.is_not(None)))


def count_reset_tokens_of_withdrawn(db: Session) -> int:
    """탈퇴 회원에게 남은 재설정 토큰 개수 (--dry-run 용)"""
    return db.scalar(
        select(func.count(PasswordResetToken.id)).where(PasswordResetToken.user_id.in_(_withdrawn_user_ids()))
    ) or 0


def delete_reset_tokens_of_withdrawn(db: Session) -> int:
    """탈퇴 회원의 재설정 토큰을 지우고 지운 개수를 돌려줌"""
    result = db.execute(
        delete(PasswordResetToken).where(PasswordResetToken.user_id.in_(_withdrawn_user_ids()))
    )
    return result.rowcount or 0


def count_email_verifications_before(db: Session, cutoff: datetime) -> int:
    """delete_email_verifications_before 대상 개수 (--dry-run 용)"""
    return db.scalar(
        select(func.count(EmailVerification.id)).where(EmailVerification.created_at < cutoff)
    ) or 0


# ---- 아이디 찾기 메일 ----


def login_id_mails_since(db: Session, user_id: int, since: datetime) -> tuple[int, datetime | None, datetime | None]:
    """since 이후 이 회원에게 보낸 아이디 안내 메일 (개수, 가장 이른 시각, 가장 늦은 시각). 발송 간격·하루 한도 검사용"""
    row = db.execute(
        select(
            func.count(LoginIdMail.id),
            func.min(LoginIdMail.created_at),
            func.max(LoginIdMail.created_at),
        ).where(LoginIdMail.user_id == user_id, LoginIdMail.created_at >= since)
    ).one()
    return row[0], row[1], row[2]


def count_login_id_mails_before(db: Session, cutoff: datetime) -> int:
    """delete_login_id_mails_before 대상 개수 (--dry-run 용)"""
    return db.scalar(select(func.count(LoginIdMail.id)).where(LoginIdMail.created_at < cutoff)) or 0


def delete_login_id_mails_before(db: Session, cutoff: datetime) -> int:
    """cutoff 이전 아이디 안내 메일 기록을 지우고 지운 개수를 돌려줌 (발송 제한에 하루치만 필요)"""
    result = db.execute(delete(LoginIdMail).where(LoginIdMail.created_at < cutoff))
    return result.rowcount or 0


# ---- 리프레시 토큰 (#55) ----


def get_refresh_token_by_hash(db: Session, token_hash: str) -> RefreshToken | None:
    """쿠키 속 토큰의 해시로 발급 기록 1건 (갱신·로그아웃 때). 동시에 두 번 회전하지 않게 행을 잠급니다"""
    return db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash).with_for_update())


def get_refresh_token(db: Session, token_id: int) -> RefreshToken | None:
    """id로 발급 기록 1건 (회전으로 바뀐 새 토큰이 아직 살아 있는지 볼 때)"""
    return db.get(RefreshToken, token_id)


def revoke_refresh_family(db: Session, family_id: str, now: datetime) -> int:
    """한 로그인에서 이어진 토큰을 모두 폐기 (로그아웃, 이미 바뀐 토큰이 다시 왔을 때)"""
    result = db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    return result.rowcount or 0


def revoke_user_refresh_tokens(db: Session, user_id: int, now: datetime) -> int:
    """이 회원의 모든 기기 토큰을 폐기 (비밀번호 변경·재설정)"""
    result = db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    return result.rowcount or 0


def _stale_refresh_tokens(now: datetime):
    # 만료됐거나, 막힌 회원(관리자 비활성화·탈퇴·개인정보 삭제)의 토큰. 막힌 회원의 토큰은 지금도 갱신에서 거절되지만,
    # 다시 활성화했을 때 예전 토큰이 되살아나지 않게 지웁니다
    blocked = select(User.id).where(
        or_(User.is_active.is_(False), User.deactivated_at.is_not(None), User.deleted_at.is_not(None))
    )
    return or_(RefreshToken.expires_at < now, RefreshToken.user_id.in_(blocked))


def count_stale_refresh_tokens(db: Session, now: datetime) -> int:
    """delete_stale_refresh_tokens 대상 개수 (--dry-run 용)"""
    return db.scalar(select(func.count(RefreshToken.id)).where(_stale_refresh_tokens(now))) or 0


def delete_stale_refresh_tokens(db: Session, now: datetime) -> int:
    """만료됐거나 막힌 회원의 리프레시 토큰을 지우고 지운 개수를 돌려줌"""
    result = db.execute(delete(RefreshToken).where(_stale_refresh_tokens(now)))
    return result.rowcount or 0
