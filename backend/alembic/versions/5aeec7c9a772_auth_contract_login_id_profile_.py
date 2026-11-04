"""auth contract: login id, profile, withdrawal, terms, tokens

Revision ID: 5aeec7c9a772
Revises: 3c55452e0d8e
Create Date: 2026-10-25 20:38:44.975166

- users: 로그인 아이디(login_id), 선택 항목, 이메일 인증·로그인 잠금·탈퇴 컬럼 추가
- roles: USER/ADMIN → MASTER/OWNER/VIEWER/WRITER (ADMIN→MASTER, USER→VIEWER, 연결은 유지)
- 새 테이블: terms(+초기 약관 3종), user_term_agreements, email_verifications, password_reset_tokens
"""
import re
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '5aeec7c9a772'
down_revision: str | Sequence[str] | None = '3c55452e0d8e'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 프론트 frontend/src/meerkit/roles.ts 의 id와 맞춥니다.
NEW_ROLES = [
    {"id": 1, "code": "MASTER", "name": "시스템 전체 관리자"},
    {"id": 2, "code": "OWNER", "name": "자신이 소유한 데이터 관리"},
    {"id": 3, "code": "VIEWER", "name": "조회 전용 사용자"},
    {"id": 4, "code": "WRITER", "name": "데이터 작성 및 수정 사용자"},
]
OLD_ROLES = [
    {"id": 1, "code": "USER", "name": "일반 사용자"},
    {"id": 2, "code": "ADMIN", "name": "관리자"},
]
ROLE_FK = "user_roles_role_id_fkey"  # PostgreSQL 기본 이름 (첫 마이그레이션에서 이름 없이 만듦)


def _remap_roles(old_to_new: dict[str, str], new_rows: list[dict]) -> None:
    """역할 행을 바꾸면서 user_roles 연결을 새 역할 id로 옮깁니다. 매핑이 없는 역할의 연결은 지워집니다."""
    conn = op.get_bind()
    old_ids = {code: id_ for id_, code in conn.execute(sa.text("SELECT id, code FROM roles"))}
    new_ids = {row["code"]: row["id"] for row in new_rows}

    op.drop_constraint(ROLE_FK, "user_roles", type_="foreignkey")
    # 새 id와 겹치지 않게 잠시 음수로 옮겨 둔 뒤 역할 행을 바꿉니다.
    for old_code, old_id in old_ids.items():
        new_code = old_to_new.get(old_code)
        if new_code is None:
            conn.execute(sa.text("DELETE FROM user_roles WHERE role_id = :id"), {"id": old_id})
        else:
            conn.execute(
                sa.text("UPDATE user_roles SET role_id = :tmp WHERE role_id = :id"),
                {"tmp": -new_ids[new_code], "id": old_id},
            )
    conn.execute(sa.text("DELETE FROM roles"))
    op.bulk_insert(sa.table("roles", sa.column("id"), sa.column("code"), sa.column("name")), new_rows)
    conn.execute(sa.text("UPDATE user_roles SET role_id = -role_id WHERE role_id < 0"))
    conn.execute(
        sa.text("SELECT setval(pg_get_serial_sequence('roles', 'id'), (SELECT MAX(id) FROM roles))")
    )
    op.create_foreign_key(ROLE_FK, "user_roles", "roles", ["role_id"], ["id"], ondelete="CASCADE")


def _backfill_login_ids() -> None:
    """기존 계정의 login_id를 이메일 앞부분으로 채웁니다. 겹치면 뒤에 _<id>를 붙입니다."""
    conn = op.get_bind()
    taken: set[str] = set()
    for user_id, email in conn.execute(sa.text("SELECT id, email FROM users ORDER BY id")):
        base = re.sub(r"[^a-z0-9_]", "_", email.split("@")[0].lower())[:24]
        base = base.ljust(4, "_")
        login_id = base if base not in taken else f"{base}_{user_id}"[:30]
        taken.add(login_id)
        conn.execute(
            sa.text("UPDATE users SET login_id = :login_id WHERE id = :id"),
            {"login_id": login_id, "id": user_id},
        )


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('email_verifications',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('code_hash', sa.String(length=64), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('attempts', sa.Integer(), server_default='0', nullable=False),
    sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_email_verifications_created_at'), 'email_verifications', ['created_at'], unique=False)
    op.create_index(op.f('ix_email_verifications_email'), 'email_verifications', ['email'], unique=False)
    terms_table = op.create_table('terms',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('code', sa.String(length=30), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=100), nullable=False),
    sa.Column('is_required', sa.Boolean(), nullable=False),
    sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('code', 'version')
    )
    op.create_table('password_reset_tokens',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('token_hash')
    )
    op.create_index(op.f('ix_password_reset_tokens_user_id'), 'password_reset_tokens', ['user_id'], unique=False)
    op.create_table('user_term_agreements',
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('term_id', sa.Integer(), nullable=False),
    sa.Column('agreed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['term_id'], ['terms.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id', 'term_id')
    )

    # login_id: NULL 허용으로 추가 → 기존 행 채우기 → NOT NULL (db-migration.md 순서)
    op.add_column('users', sa.Column('login_id', sa.String(length=30), nullable=True))
    _backfill_login_ids()
    op.alter_column('users', 'login_id', nullable=False)
    op.create_index(op.f('ix_users_login_id'), 'users', ['login_id'], unique=True)

    op.add_column('users', sa.Column('nickname', sa.String(length=30), nullable=True))
    op.add_column('users', sa.Column('phone', sa.String(length=20), nullable=True))
    op.add_column('users', sa.Column('postcode', sa.String(length=10), nullable=True))
    op.add_column('users', sa.Column('address', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('address_detail', sa.String(length=255), nullable=True))
    op.add_column('users', sa.Column('birth_date', sa.Date(), nullable=True))
    op.add_column('users', sa.Column('gender', sa.String(length=10), nullable=True))
    op.add_column('users', sa.Column('avatar_url', sa.String(length=500), nullable=True))
    op.add_column('users', sa.Column('email_verified_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('failed_login_count', sa.Integer(), server_default='0', nullable=False))
    op.add_column('users', sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('last_login_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('password_changed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('deactivated_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))
    op.create_unique_constraint('users_nickname_key', 'users', ['nickname'])

    _remap_roles({"ADMIN": "MASTER", "USER": "VIEWER"}, NEW_ROLES)

    # 초기 약관: code는 프론트 meerkit.config.ts 의 signup.terms[].id 와 같아야 합니다.
    op.bulk_insert(
        terms_table,
        [
            {"code": "terms", "version": 1, "title": "이용약관", "is_required": True},
            {"code": "privacy", "version": 1, "title": "개인정보 수집 및 이용", "is_required": True},
            {"code": "marketing", "version": 1, "title": "마케팅 정보 수신", "is_required": False},
        ],
    )


def downgrade() -> None:
    """Downgrade schema."""
    _remap_roles({"MASTER": "ADMIN", "VIEWER": "USER"}, OLD_ROLES)

    op.drop_constraint('users_nickname_key', 'users', type_='unique')
    op.drop_index(op.f('ix_users_login_id'), table_name='users')
    op.drop_column('users', 'deleted_at')
    op.drop_column('users', 'deactivated_at')
    op.drop_column('users', 'password_changed_at')
    op.drop_column('users', 'last_login_at')
    op.drop_column('users', 'locked_until')
    op.drop_column('users', 'failed_login_count')
    op.drop_column('users', 'email_verified_at')
    op.drop_column('users', 'avatar_url')
    op.drop_column('users', 'gender')
    op.drop_column('users', 'birth_date')
    op.drop_column('users', 'address_detail')
    op.drop_column('users', 'address')
    op.drop_column('users', 'postcode')
    op.drop_column('users', 'phone')
    op.drop_column('users', 'nickname')
    op.drop_column('users', 'login_id')
    op.drop_table('user_term_agreements')
    op.drop_index(op.f('ix_password_reset_tokens_user_id'), table_name='password_reset_tokens')
    op.drop_table('password_reset_tokens')
    op.drop_table('terms')
    op.drop_index(op.f('ix_email_verifications_email'), table_name='email_verifications')
    op.drop_index(op.f('ix_email_verifications_created_at'), table_name='email_verifications')
    op.drop_table('email_verifications')
