"""관리자(MASTER) 계정 만들기. 여러 번 실행해도 안전합니다.

    uv run python -m app.users.seed

이미 있는 계정의 비밀번호는 바꾸지 않습니다. .env 의 비밀번호와 맞추려면 --reset-password 를 붙입니다.

    uv run python -m app.users.seed --reset-password

.env(또는 환경변수)의 SEED_ADMIN_USER_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD 를 사용합니다.
로컬에서는 .env 의 로컬 전용 값, 운영에서는 Actions 의 seed-admin 워크플로로 한 번 실행합니다 (docs/deployment.md).
"""

import sys
from datetime import UTC, datetime

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import hash_password
from app.users import repository, roles, service


def main(argv: list[str] | None = None) -> int:
    reset_password = "--reset-password" in (sys.argv[1:] if argv is None else argv)
    if not settings.seed_admin_password:
        print(
            "SEED_ADMIN_PASSWORD 가 비어 있습니다. backend/.env(운영은 Secret)에 비밀번호를 넣어 주세요."
        )
        return 1
    with SessionLocal() as db:
        existing = repository.get_by_login_id(
            db, settings.seed_admin_user_id
        ) or repository.get_by_email(db, settings.seed_admin_email)
        if existing:
            if reset_password:
                existing.hashed_password = hash_password(settings.seed_admin_password)
                existing.has_password = True
                existing.password_changed_at = datetime.now(
                    UTC
                )  # 이전에 발급된 로그인은 더 이상 통하지 않음
                existing.failed_login_count = 0
                existing.locked_until = None
                db.commit()
                print(
                    f"비밀번호를 .env 의 SEED_ADMIN_PASSWORD 로 바꿨습니다: {existing.login_id}"
                )
                return 0
            print(
                f"이미 있습니다: {existing.login_id} (건너뜀)\n"
                "비밀번호는 바꾸지 않았습니다. 이 계정을 만든 뒤 .env 의 SEED_ADMIN_PASSWORD 를 바꿨다면 "
                "로그인이 되지 않습니다.\n"
                "다시 맞추려면 backend 폴더에서: uv run python -m app.users.seed --reset-password"
            )
            return 0
        user = service.create_user(
            db,
            login_id=settings.seed_admin_user_id,
            email=settings.seed_admin_email,
            password=settings.seed_admin_password,
            name=settings.seed_admin_name,
            roles=[roles.MASTER],  # 관리자 역할 (core.principal.ADMIN_ROLE 과 같은 값)
        )
        user.email_verified_at = datetime.now(UTC)
        db.commit()
    print(f"관리자 계정을 만들었습니다: {settings.seed_admin_user_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
