"""운영 설정 검사 (APP_ENV=production 에서만)"""

import pytest

from app.core.config import EXAMPLE_JWT_SECRET_KEY, Settings

SAFE = {
    "app_env": "production",
    "database_url": "postgresql+psycopg://u:p@db.example.com:5432/meerkit",
    "jwt_secret_key": "x" * 64,
    "cookie_secure": True,
    "cors_origins": "https://meerkit.example.com",
    "mail_backend": "smtp",
    "frontend_base_url": "https://meerkit.example.com",
}


def _settings(**overrides) -> Settings:
    return Settings(_env_file=None, **{**SAFE, **overrides})


def test_safe_production_settings_pass():
    assert _settings().production_problems() == []
    _settings().check_production()


def test_local_is_never_checked():
    assert _settings(app_env="local", cookie_secure=False, mail_backend="console").production_problems() == []


@pytest.mark.parametrize(
    ("overrides", "name"),
    [
        ({"jwt_secret_key": "short"}, "JWT_SECRET_KEY"),
        ({"jwt_secret_key": EXAMPLE_JWT_SECRET_KEY}, "JWT_SECRET_KEY"),
        ({"cookie_secure": False}, "COOKIE_SECURE"),
        ({"cors_origins": "http://localhost:3000"}, "CORS_ORIGINS"),
        ({"cors_origins": ""}, "CORS_ORIGINS"),
        ({"mail_backend": "console"}, "MAIL_BACKEND"),
        ({"frontend_base_url": "http://127.0.0.1:3000"}, "FRONTEND_BASE_URL"),
    ],
)
def test_risky_production_settings_stop_startup(overrides, name):
    with pytest.raises(RuntimeError) as exc:
        _settings(**overrides).check_production()
    assert name in str(exc.value)


def test_message_never_contains_secret_value():
    secret = "short-but-secret"
    with pytest.raises(RuntimeError) as exc:
        _settings(jwt_secret_key=secret).check_production()
    assert secret not in str(exc.value)
