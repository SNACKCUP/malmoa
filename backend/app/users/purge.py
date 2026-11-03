"""보관 기간이 지난 탈퇴 계정의 개인정보를 지웁니다. 여러 번 실행해도 안전합니다.

    uv run python -m app.users.purge            # 실제 처리
    uv run python -m app.users.purge --dry-run  # 몇 건인지 세기만

매일 한 번 실행합니다 (.github/workflows/account-purge.yml 또는 서버 cron).
기준: 탈퇴 시각(deactivated_at)으로부터 ACCOUNT_RETENTION_DAYS 일이 지난 계정.
계정 행은 남기고 이름·이메일·아이디 등을 지운 뒤 deleted_at 을 기록합니다.
로그에는 건수와 계정 번호(id)만 남깁니다.

users 의 데이터만 다룹니다. 인증 쪽 기록(재설정 토큰·이메일 인증번호) 정리는
auth 모듈의 `uv run python -m app.auth.cleanup` 이 맡습니다 (워크플로에서 이어서 실행).
"""

import argparse
import logging
import sys
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.logging import setup_logging
from app.users import repository, service

logger = logging.getLogger("app.users.purge")

BATCH_SIZE = 500


def purge(db: Session, *, dry_run: bool = False, now: datetime | None = None) -> int:
    """처리한(또는 dry_run이면 처리할) 계정 수"""
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(days=settings.account_retention_days)
    if dry_run:
        return repository.count_withdrawn_before(db, cutoff)

    total = 0
    while True:
        users = repository.withdrawn_before(db, cutoff, BATCH_SIZE)
        if not users:
            break
        for user in users:
            service.anonymize(user)
        db.commit()  # 배치마다 저장: 중간에 실패해도 처리한 만큼은 남고, 다시 실행하면 이어서 처리
        total += len(users)
        logger.info("개인정보 삭제 ids=%s", [u.id for u in users])
    return total


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="처리하지 않고 대상 건수만 출력")
    args = parser.parse_args(argv)
    setup_logging()
    try:
        with SessionLocal() as db:
            count = purge(db, dry_run=args.dry_run)
    except Exception:
        logger.exception("개인정보 삭제 작업 실패. DATABASE_URL과 DB 상태를 확인한 뒤 다시 실행하세요.")
        return 1
    action = "대상" if args.dry_run else "처리"
    logger.info(
        "탈퇴 후 %s일 지난 계정 %s %s건", settings.account_retention_days, action, count
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
