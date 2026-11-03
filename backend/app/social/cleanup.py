"""소셜 계정 연결 정리. 여러 번 실행해도 안전합니다.

    uv run python -m app.social.cleanup            # 실제 처리
    uv run python -m app.social.cleanup --dry-run  # 몇 건인지 세기만

매일 한 번, 회원 개인정보 삭제(app.users.purge) 다음에 실행합니다 (.github/workflows/account-purge.yml).
purge 는 회원 행을 남기고 값만 지우므로, 연결 행(공급자 이메일·이름·사진 주소)은 여기서 지웁니다.
로그에는 건수만 남깁니다.
"""

import argparse
import logging
import sys

from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.logging import setup_logging
from app.social import repository

logger = logging.getLogger("app.social.cleanup")


def cleanup(db: Session, *, dry_run: bool = False) -> int:
    """개인정보를 지운 회원의 연결 행 수 — dry_run 이면 지울 건수"""
    if dry_run:
        return repository.count_of_deleted_users(db)
    count = repository.delete_of_deleted_users(db)
    db.commit()
    return count


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="지우지 않고 대상 건수만 출력")
    args = parser.parse_args(argv)
    setup_logging()
    try:
        with SessionLocal() as db:
            count = cleanup(db, dry_run=args.dry_run)
    except Exception:
        logger.exception("소셜 연결 정리 실패. DATABASE_URL과 DB 상태를 확인한 뒤 다시 실행하세요.")
        return 1
    logger.info("소셜 연결 %s %s건", "대상" if args.dry_run else "삭제", count)
    return 0


if __name__ == "__main__":
    sys.exit(main())
