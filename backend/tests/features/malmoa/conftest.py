"""말모아 테스트 환경 — meerkit 테스트 DB(TEST_DATABASE_URL, 이름이 _test)와 임시 storage 폴더를 쓴다.

상위 tests/conftest.py(meerkit)가 테스트 DB 를 만들고 마이그레이션을 최신으로 맞춘 뒤 앱을 불러온다.
말모아 테스트는 meerkit 테스트와 달리 실제로 커밋한다 (작업자 스레드가 다른 세션으로 읽기 때문). 그래서 테스트마다
앞뒤로 말모아 표와 users 를 비운다 (meerkit 테스트는 롤백 방식이라 남는 것이 없다).

저장소 두 모드로 같은 테스트를 돌린다 (app/features/malmoa/services/file_store.py):
  uv run python -m pytest tests/features/malmoa                              → local: 임시 폴더
  MALMOA_FILES_BACKEND=s3 uv run python -m pytest tests/features/malmoa      → s3: 여기서 띄운 moto 가짜 S3 의 비공개 버킷
저장소 설정은 여기서 모두 덮어쓴다 — backend/.env 의 저장소 값(로컬 Supabase 등)은 테스트에 쓰이지 않는다.
"""

import itertools
import os
import socket
import tempfile
from typing import Annotated

_STORAGE = tempfile.mkdtemp(prefix="malmoa-test-")

# 말모아 설정은 처음 쓸 때 읽히므로(get_settings 캐시) 아래에서 캐시를 비우면 이 값이 쓰인다
os.environ["MALMOA_FILES_DIR"] = _STORAGE
os.environ["SECRET_KEY"] = "test-secret-not-for-production-0123456789"
os.environ["OPENAI_API_KEY"] = ""
# 테스트 중 알람 검사기·실제 Mac 알림을 띄우지 않는다 (검사기는 tick()을 직접 불러 시험)
os.environ["REMINDERS_ENABLED"] = "false"
os.environ["MAC_NOTIFICATIONS"] = "false"
# 작업자는 켠다 — 개발 .env 는 전환 전까지 WORKER_TASKS=[] 이다 (통합계획 단계 2). 테스트가 .env 에 따라 달라지지 않게 여기서 정한다
os.environ["WORKER_TASKS"] = '["transcribe", "minutes"]'

STORAGE_MODE = "s3" if os.environ.get("MALMOA_FILES_BACKEND") == "s3" else "local"
S3_TEST_BUCKET = "malmoa-test-private"
_moto = None
if STORAGE_MODE == "s3":
    from moto.server import ThreadedMotoServer

    with socket.socket() as _sock:
        _sock.bind(("127.0.0.1", 0))
        _port = _sock.getsockname()[1]
    _moto = ThreadedMotoServer(ip_address="127.0.0.1", port=_port, verbose=False)
    _moto.start()
    _s3_env = {
        "STORAGE_PRIVATE_BUCKET": S3_TEST_BUCKET,
        "STORAGE_S3_ENDPOINT_URL": f"http://127.0.0.1:{_port}",
        "STORAGE_S3_REGION": "us-east-1",
        "STORAGE_S3_ACCESS_KEY_ID": "moto-test-key",
        "STORAGE_S3_SECRET_ACCESS_KEY": "moto-test-secret",
    }
    import boto3

    boto3.client(
        "s3",
        endpoint_url=_s3_env["STORAGE_S3_ENDPOINT_URL"],
        region_name="us-east-1",
        aws_access_key_id="moto-test-key",
        aws_secret_access_key="moto-test-secret",
    ).create_bucket(Bucket=S3_TEST_BUCKET)
else:
    _s3_env = {k: "" for k in ("STORAGE_PRIVATE_BUCKET", "STORAGE_S3_ENDPOINT_URL", "STORAGE_S3_REGION", "STORAGE_S3_ACCESS_KEY_ID", "STORAGE_S3_SECRET_ACCESS_KEY")}
# 모드와 저장소 설정을 모두 여기서 정한다 (.env 값을 쓰지 않게 빈 값도 명시)
os.environ["MALMOA_FILES_BACKEND"] = STORAGE_MODE
os.environ.update(_s3_env)

import pytest
from fastapi import Depends, Request
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.security import create_token
from app.features.malmoa.config import get_settings
from app.features.malmoa.db import engine, get_db
from app.features.malmoa.deps import get_current_user
from app.features.malmoa.services.file_store import get_store
from app.users.models import User

get_settings.cache_clear()

local_only = pytest.mark.skipif(STORAGE_MODE != "local", reason="로컬 저장소 전용")
s3_only = pytest.mark.skipif(STORAGE_MODE != "s3", reason="S3 저장소 전용 (MALMOA_FILES_BACKEND=s3)")

# 말모아 표 + meerkit users (CASCADE 로 users 에 딸린 표도 함께 비워진다. roles·terms 같은 기준 표는 그대로)
_TABLES = "jobs, people, events, event_reminders, recorder_beats, llm_settings, llm_usage, llm_usage_limits, malmoa_profiles, users"


def files():
    """지금 모드의 저장소 (local: 임시 폴더, s3: moto 버킷)"""
    return get_store()


def present(item) -> bool:
    """저장소 키(문자열)는 저장소에서, 로컬 경로(Path, work_dir 등)는 디스크에서 있는지 본다"""
    return files().exists(item) if isinstance(item, str) else item.exists()


TEST_USER_HEADER = "X-Test-User"
DEFAULT_LOGIN_ID = "malmoa-default"  # 헤더 없는 요청의 회원
_login_ids = (f"malmoa-{n}" for n in itertools.count(1000))  # register() 가 만드는 회원


def _make_user(db: Session, login_id: str) -> User:
    """테스트용 meerkit 회원 (비밀번호 로그인은 쓰지 않는다)"""
    user = User(login_id=login_id, email=f"{login_id}@example.com", hashed_password="!test", name="테스트")
    db.add(user)
    db.commit()
    return user


def _clean() -> None:
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {_TABLES} CASCADE"))


@pytest.fixture(autouse=True)
def clean_tables():
    _clean()
    yield
    _clean()  # meerkit 테스트(롤백 방식)에 커밋된 회원이 남지 않게


def _test_user(request: Request, db: Annotated[Session, Depends(get_db)]) -> User:
    """테스트 전용: X-Test-User 헤더의 회원으로 요청한다 (없으면 기본 회원).
    meerkit 로그인 자체로 막히는지는 test_login.py 가 실제 get_current_user 로 시험한다."""
    user_id = request.headers.get(TEST_USER_HEADER)
    if user_id:
        return db.get(User, int(user_id))
    return db.query(User).filter_by(login_id=DEFAULT_LOGIN_ID).one_or_none() or _make_user(db, DEFAULT_LOGIN_ID)


@pytest.fixture
def client():
    from app.main import app

    app.dependency_overrides[get_current_user] = _test_user
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def real_client():
    """로그인을 바꾸지 않은 클라이언트 (meerkit 토큰으로 막히는지 시험용)"""
    from app.main import app

    with TestClient(app) as c:
        yield c


class FakeCalendar:
    """테스트용 캘린더 앱: 실제 Mac 캘린더를 건드리지 않고 osascript 호출을 흉내 낸다"""

    def __init__(self):
        self.events: dict[str, list[str]] = {}  # uid → [제목, 장소, 종일, 시작, 종료, 알림]
        self.error: str | None = None  # 넣으면 그 이유로 실패
        self.calls = 0

    def __call__(self, script: str, *args: str) -> str:
        from app.features.malmoa.services import apple_calendar as ac

        self.calls += 1
        if self.error:
            raise ac.CalendarSyncError(self.error)
        if script == ac._UPSERT:
            self.events.pop(args[1], None)
            uid = f"uid-{self.calls}"
            self.events[uid] = list(args[2:8])
            return uid
        if script == ac._DELETE:
            self.events.pop(args[1], None)
        return ""


@pytest.fixture(autouse=True)
def calendar(monkeypatch):
    from app.features.malmoa.services import apple_calendar

    fake = FakeCalendar()
    monkeypatch.setattr(apple_calendar, "_osascript", fake)
    monkeypatch.setattr(apple_calendar, "available", lambda: True)
    yield fake


def register(client: TestClient, email: str = "me@example.com") -> str:
    """테스트용 회원을 DB에 바로 만들고 번호를 돌려준다 (email 은 예전 호출과의 호환용, 쓰지 않음)"""
    with Session(engine) as db:
        return str(_make_user(db, next(_login_ids)).id)


def auth(user_id: str) -> dict:
    return {TEST_USER_HEADER: user_id}


def bearer(user_id: str | int) -> dict:
    """진짜 meerkit 액세스 토큰 (real_client 용)"""
    return {"Authorization": f"Bearer {create_token(int(user_id), 'access')}"}
