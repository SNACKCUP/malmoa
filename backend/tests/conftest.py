import re
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from alembic import command
from app.core.config import settings

# 테스트는 실제 PostgreSQL(테스트용 DB)에서 돌고, 테스트마다 트랜잭션을 롤백해 흔적을 남기지 않습니다.
# TEST_DATABASE_URL이 있으면 그 DB를 씁니다. app.core.database가 엔진을 만들기 전에 바꿔야 해서 맨 위에 둡니다.
if settings.test_database_url:
    settings.database_url = settings.test_database_url
settings.mail_backend = "fake"  # 테스트에서는 메일을 보내지 않고 mail_outbox에 쌓습니다

# 개발·운영 DB에서 테스트가 돌지 않도록 이름이 _test로 끝나는 DB만 허용합니다.
_test_url = make_url(settings.database_url)
if not (_test_url.database or "").endswith("_test"):
    pytest.exit(
        f"테스트 DB 이름은 _test로 끝나야 합니다 (현재: {_test_url.database}). "
        "backend/.env의 TEST_DATABASE_URL을 확인하세요.",
        returncode=2,
    )


# 테스트 DB가 없으면 만들고, 마이그레이션을 최신으로 맞춥니다.
def _prepare_test_db() -> None:
    admin_engine = create_engine(_test_url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": _test_url.database}
        ).scalar()
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{_test_url.database}"'))
    admin_engine.dispose()

    # alembic/env.py가 settings.database_url을 읽으므로 위에서 바꾼 주소로 적용됩니다.
    command.upgrade(Config(str(Path(__file__).resolve().parents[1] / "alembic.ini")), "head")


_prepare_test_db()

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.database import engine, get_db
from app.mail.backends import FakeBackend
from app.main import app
from app.permissions import roles
from app.users import service as user_service


@pytest.fixture
def db():
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def fake_llm():
    """API 키 없이 쓰는 가짜 LLM. fake_llm.responses 에 응답을 넣고, fake_llm.calls 로 들어간 메시지를 확인합니다."""
    from app.llm import override_chat_model
    from app.llm.testing import FakeChatModel

    model = FakeChatModel()
    with override_chat_model(model):
        yield model


@pytest.fixture(autouse=True)
def isolate_storage(monkeypatch):
    """개발자 .env 의 STORAGE_* 를 무시합니다. 테스트가 로컬 버킷에 파일을 올리지 않게 합니다."""
    from app.storage import backends
    from app.storage.config import storage_settings

    caches = (backends._s3, backends._memory, backends._s3_private, backends._memory_private)
    monkeypatch.setattr(storage_settings, "storage_backend", "")
    for cache in caches:
        cache.cache_clear()
    yield
    for cache in caches:
        cache.cache_clear()


@pytest.fixture
def storage():
    """메모리 저장소. storage.objects 로 올라간 파일을 확인합니다."""
    from app.storage import override_storage
    from app.storage.backends import MemoryStorage

    memory = MemoryStorage()
    override_storage(memory)
    yield memory
    override_storage(None)


@pytest.fixture
def private_storage():
    """비공개 메모리 저장소. private_storage.objects 로 올라간 파일을 확인합니다."""
    from app.storage import override_private_storage
    from app.storage.backends import MemoryStorage

    memory = MemoryStorage()
    override_private_storage(memory)
    yield memory
    override_private_storage(None)


@pytest.fixture(autouse=True)
def mail_outbox():
    FakeBackend.outbox.clear()
    yield FakeBackend.outbox
    FakeBackend.outbox.clear()


PASSWORD = "password123"


@pytest.fixture
def make_user(db):
    """make_user("user01") → 아이디 user01, 이메일 user01@example.com 인 VIEWER 계정"""

    def _make(login_id: str, *, admin: bool = False, password: str = PASSWORD, **fields):
        codes = [roles.ADMIN_ROLE] if admin else [roles.DEFAULT_ROLE]
        return user_service.create_user(
            db,
            login_id=login_id,
            email=fields.pop("email", f"{login_id}@example.com"),
            password=password,
            name=fields.pop("name", "테스트"),
            profile=fields,
            roles=codes,
        )

    return _make


def _code_from(message) -> str:
    return re.search(r"인증번호: (\d{6})", message.text).group(1)


@pytest.fixture
def last_code(mail_outbox):
    """가장 최근 인증번호 메일의 번호"""
    return lambda: _code_from(mail_outbox[-1])


@pytest.fixture
def email_token(client, mail_outbox):
    """이메일 인증번호 발송 → 메일에서 번호 읽기 → 확인 → 가입용 증표"""

    def _token(email: str) -> str:
        assert client.post("/api/auth/email/send-code", json={"email": email}).status_code == 204
        code = _code_from(mail_outbox[-1])
        response = client.post("/api/auth/email/verify-code", json={"email": email, "code": code})
        assert response.status_code == 200, response.text
        return response.json()["token"]

    return _token


@pytest.fixture
def signup(client, email_token):
    """API로 가입. 기본값: 필수 약관 동의 + 이메일 인증 완료"""

    def _signup(login_id: str, **overrides):
        email = overrides.pop("email", f"{login_id}@example.com")
        body = {
            "user_id": login_id,
            "email": email,
            "password": PASSWORD,
            "name": "가입자",
            "agreed_terms": ["terms", "privacy"],
            **overrides,
        }
        if "email_verification_token" not in body:
            body["email_verification_token"] = email_token(email)
        return client.post("/api/auth/signup", json=body)

    return _signup


@pytest.fixture
def login(client):
    def _login(login_id: str, password: str = PASSWORD) -> dict[str, str]:
        response = client.post("/api/auth/login", json={"user_id": login_id, "password": password})
        assert response.status_code == 200, response.text
        return {"Authorization": f"Bearer {response.json()['access_token']}"}

    return _login
