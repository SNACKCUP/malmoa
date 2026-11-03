"""malmoa terms v2 — 이용약관·개인정보 처리방침을 말모아 본문(버전 2)으로 (2026-11-03 통합 단계 4)

본문은 frontend/src/components/malmoa/legal/content.ts. 가입 화면은 is_active 인 버전에 동의를 받으므로
버전 1(meerkit 본문)은 끄고 버전 2 를 켠다. 이미 받은 버전 1 동의 기록은 그대로 둔다.
marketing 은 문구가 바뀌지 않았지만 같은 묶음으로 버전 2 를 만든다 — 약관 목록(GET /api/auth/terms)은 id 순이라,
terms·privacy 만 새 행을 만들면 marketing 이 맨 앞으로 와서 meerkit 순서(terms, privacy, marketing)가 바뀐다
(tests/kit/test_signup_rules.py). marketing 은 지금 가입 화면(meerkit.config.ts)에서 꺼져 있다.

Revision ID: 9c254e0e9345
Revises: 8e8d39d3c0da
Create Date: 2026-11-03 20:48:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "9c254e0e9345"
down_revision: str | Sequence[str] | None = "8e8d39d3c0da"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CODES = ("terms", "privacy", "marketing")  # 이 순서로 새 행을 만든다


def upgrade() -> None:
    conn = op.get_bind()
    for code in CODES:
        old = conn.execute(
            sa.text("select title, is_required from terms where code = :code and version = 1"), {"code": code}
        ).first()
        if old is None:  # 버전 1 이 없는 DB(새로 만든 DB 등)는 건너뛴다
            continue
        conn.execute(sa.text("update terms set is_active = false where code = :code and version = 1"), {"code": code})
        conn.execute(
            sa.text(
                "insert into terms (code, version, title, is_required, is_active) values (:code, 2, :title, :req, true)"
                " on conflict (code, version) do update set is_active = true"
            ),
            {"code": code, "title": old.title, "req": old.is_required},
        )


def downgrade() -> None:
    conn = op.get_bind()
    for code in CODES:
        conn.execute(sa.text("update terms set is_active = true where code = :code and version = 1"), {"code": code})
        # 버전 2 에 동의한 기록이 있으면 행을 지우지 않고 끄기만 한다
        conn.execute(
            sa.text(
                "delete from terms t where code = :code and version = 2"
                " and not exists (select 1 from user_term_agreements a where a.term_id = t.id)"
            ),
            {"code": code},
        )
        conn.execute(sa.text("update terms set is_active = false where code = :code and version = 2"), {"code": code})
