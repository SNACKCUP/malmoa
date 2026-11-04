from fastapi.testclient import TestClient

from app.core.config import Settings, settings
from app.main import create_app


def test_supabase_style_url_uses_psycopg_driver():
    s = Settings(database_url="postgresql://u:p@host:5432/postgres?sslmode=require", jwt_secret_key="x" * 32)
    assert s.database_url == "postgresql+psycopg://u:p@host:5432/postgres?sslmode=require"
    s = Settings(database_url="postgres://u:p@host/db", jwt_secret_key="x" * 32)
    assert s.database_url == "postgresql+psycopg://u:p@host/db"
    s = Settings(database_url="postgresql+psycopg://u:p@host/db", jwt_secret_key="x" * 32)
    assert s.database_url == "postgresql+psycopg://u:p@host/db"


def test_api_docs_can_be_hidden(monkeypatch):
    monkeypatch.setattr(settings, "api_docs_enabled", False)
    client = TestClient(create_app())
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404
    assert client.get("/health").status_code == 200


def test_health_shows_deployed_commit(monkeypatch):
    monkeypatch.setattr(settings, "app_commit", "3333dedad8612c0015adbf1114bd491d1721e780")
    client = TestClient(create_app())
    assert client.get("/health").json() == {"status": "ok", "commit": "3333ded"}


def test_render_commit_env_is_read(monkeypatch):
    monkeypatch.setenv("RENDER_GIT_COMMIT", "abcdef1234")
    assert Settings(database_url="postgresql+psycopg://h/db", jwt_secret_key="x" * 32).app_commit == "abcdef1234"
