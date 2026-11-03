"""말모아 운영 설정 검사 (통합 단계 5-8) — APP_ENV=production 에서만, 값은 메시지에 넣지 않는다"""

import hashlib

import pytest

from app.core.config import settings as core_settings
from app.features.malmoa import checks
from app.features.malmoa.config import Settings

GOOD = {
    "secret_key": "s" * 48,
    "malmoa_files_backend": "s3",
    "storage_private_bucket": "malmoa-private",
    "max_upload_mb": 50,
    "worker_tasks": ("minutes",),
    "malmoa_worker_token_hash": hashlib.sha256(b"k").hexdigest(),
    "mac_notifications": False,
    "withdrawn_cleanup_enabled": True,
    "withdrawn_data_days": 30,
}


@pytest.fixture
def production(monkeypatch):
    monkeypatch.setattr(core_settings, "app_env", "production")


def test_local_env_is_never_blocked():
    assert checks.production_problems(Settings(secret_key="", worker_tasks=("transcribe",))) == []


def test_good_production_settings_pass(production):
    assert checks.production_problems(Settings(**GOOD)) == []


@pytest.mark.parametrize(
    ("change", "key"),
    [
        ({"secret_key": "short"}, "SECRET_KEY"),
        ({"malmoa_files_backend": "local"}, "MALMOA_FILES_BACKEND"),
        ({"storage_private_bucket": ""}, "STORAGE_PRIVATE_BUCKET"),
        ({"max_upload_mb": 500}, "MAX_UPLOAD_MB"),
        ({"worker_tasks": ("transcribe", "minutes")}, "WORKER_TASKS"),
        ({"malmoa_worker_token_hash": "not-a-hash"}, "MALMOA_WORKER_TOKEN_HASH"),
        ({"mac_notifications": True}, "MAC_NOTIFICATIONS"),
        ({"withdrawn_data_days": 7}, "WITHDRAWN_DATA_DAYS"),
        ({"withdrawn_cleanup_enabled": False}, "WITHDRAWN_CLEANUP_ENABLED"),
    ],
)
def test_each_risky_setting_is_reported(production, change, key):
    problems = checks.production_problems(Settings(**{**GOOD, **change}))
    assert len(problems) == 1 and key in problems[0]


def test_secret_values_are_not_in_messages(production):
    problems = checks.production_problems(Settings(**{**GOOD, "secret_key": "leak-me", "malmoa_worker_token_hash": "leak-hash"}))
    assert problems and not any("leak" in p for p in problems)


def test_server_refuses_to_start(production, monkeypatch):
    monkeypatch.setattr(checks, "get_settings", lambda: Settings(**{**GOOD, "worker_tasks": ("transcribe",)}))
    with pytest.raises(RuntimeError, match="WORKER_TASKS"):
        checks.check_production()


def test_app_startup_runs_the_check(production, monkeypatch):
    """서버가 켜질 때(말모아 lifespan) 실제로 검사한다 — 위험하면 TestClient 시작이 실패한다"""
    from fastapi.testclient import TestClient

    from app.main import app

    monkeypatch.setattr(checks, "get_settings", lambda: Settings(**{**GOOD, "mac_notifications": True}))
    with pytest.raises(RuntimeError, match="MAC_NOTIFICATIONS"), TestClient(app):
        pass
