"""merge malmoa and meerkit rc10 — 말모아 마이그레이션과 meerkit 0.1.0-rc.10 킷 마이그레이션 합치기 (2026-11-03)

둘 다 bba337f809ab 에서 갈라졌다: 말모아(8e8d39d3c0da 표 → 9c254e0e9345 약관 v2), 킷(b9a062494ca5 리프레시 토큰 → 72d61ade7e67 아이디 찾기 메일).
표를 바꾸지 않고 두 갈래를 하나의 head 로 잇기만 한다. 킷을 다시 업데이트해 새 킷 마이그레이션이 생기면 같은 방법으로 합친다.

Revision ID: d9c237041b79
Revises: 72d61ade7e67, 9c254e0e9345
Create Date: 2026-11-03 21:13:02.532902

"""
from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = 'd9c237041b79'
down_revision: str | Sequence[str] | None = ('72d61ade7e67', '9c254e0e9345')
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""


def downgrade() -> None:
    """Downgrade schema."""
