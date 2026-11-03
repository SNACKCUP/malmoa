"""인증 쪽 기록 정리. 여러 번 실행해도 안전합니다.

    uv run python -m app.auth.cleanup            # 실제 처리
    uv run python -m app.auth.cleanup --dry-run  # 몇 건인지 세기만

매일 한 번, 회원 개인정보 삭제(app.users.purge) 다음에 실행합니다 (.github/workflows/account-purge.yml).
- 탈퇴했거나 개인정보를 지운 회원의 비밀번호 재설정 토큰 삭제
- EMAIL_VERIFICATION_RETENTION_DAYS 보다 오래된 이메일 인증번호 기록 삭제 (이메일 주소가 들어 있음)
로그에는 건수만 남깁니다.
"""

import argparse
import logging
import sys
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.auth import repository
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.logging import setup_logging

logger = logging.getLogger("app.auth.cleanup")


def cleanup(db: Session, *, dry_run: bool = False, now: datetime | None = None) -> dict[str, int]:
    """{"reset_tokens": 건수, "email_verifications": 건수} — dry_run 이면 지울 건수"""
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(days=settings.email_verification_retention_days)
    if dry_run:
        return {
            "reset_tokens": repository.count_reset_tokens_of_withdrawn(db),
            "email_verifications": repository.count_email_verifications_before(db, cutoff),
        }
    result = {
        "reset_tokens": repository.delete_reset_tokens_of_withdrawn(db),
        "email_verifications": repository.delete_email_verifications_before(db, cutoff),
    }
    db.commit()
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="지우지 않고 대상 건수만 출력")
    args = parser.parse_args(argv)
    setup_logging()
    try:
        with SessionLocal() as db:
            counts = cleanup(db, dry_run=args.dry_run)
    except Exception:
        logger.exception("인증 기록 정리 실패. DATABASE_URL과 DB 상태를 확인한 뒤 다시 실행하세요.")
        return 1
    action = "대상" if args.dry_run else "삭제"
    logger.info(
        "재설정 토큰 %s %s건, 이메일 인증 기록 %s %s건",
        action, counts["reset_tokens"], action, counts["email_verifications"],
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
