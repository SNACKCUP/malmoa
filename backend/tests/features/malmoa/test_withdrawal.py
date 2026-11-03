"""탈퇴 회원 말모아 데이터 정리 (통합 단계 5-7, 결정 B: 탈퇴 30일 뒤)"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.features.malmoa.db import engine
from app.features.malmoa.models import (
    Event,
    Job,
    LlmUsage,
    MalmoaProfile,
    PendingUpload,
    Person,
)
from app.features.malmoa.services import withdrawal
from app.features.malmoa.services.file_store import transcript_keys
from app.users.models import User
from features.malmoa.conftest import auth, files, present, register

AUDIO = ("회의.m4a", b"fake-audio", "audio/mp4")
NOW = datetime.now(UTC)


def member_with_data(client) -> tuple[str, str]:
    """작업(원본·원문 파일)·참석자·일정·AI 사용량·구독 주소·올리는 중 파일이 있는 회원 → (회원 번호, 작업 번호)"""
    uid = register(client)
    h = auth(uid)
    job = client.post("/api/jobs", files={"file": AUDIO}, headers=h).json()
    files().put_bytes(transcript_keys(job["id"])[0], b'{"text": "x", "segments": []}', "application/json")
    client.post("/api/people", json={"name": "김회의"}, headers=h)
    start = NOW + timedelta(days=1)
    client.post("/api/events", json={"title": "회의", "startsAt": start.isoformat(), "endsAt": (start + timedelta(hours=1)).isoformat(), "reminders": [10]}, headers=h)
    client.post("/api/calendar-feed", headers=h)
    with Session(engine) as db:
        db.add(LlmUsage(user_id=int(uid), job_id=job["id"], file_name="회의.m4a", provider="gemini", model="m", calls=1, input_tokens=1, output_tokens=1))
        db.add(PendingUpload(id=f"moa-{'0' * 8}-0000-4000-8000-{uid.zfill(12)}", user_id=int(uid), file_name="b.m4a", stored_name=f"pending-{uid}.m4a", source="upload", content_type="audio/mp4", size_bytes=3))
        db.commit()
    files().put_bytes(f"uploads/pending-{uid}.m4a", b"abc", "audio/mp4")
    return uid, job["id"]


def withdraw(uid: str, days_ago: float) -> None:
    with Session(engine) as db:
        db.execute(update(User).where(User.id == int(uid)).values(is_active=False, deactivated_at=NOW - timedelta(days=days_ago)))
        db.commit()


def malmoa_rows(uid: str) -> int:
    with Session(engine) as db:
        return sum(db.scalar(select(func.count()).select_from(t).where(t.user_id == int(uid))) for t in withdrawal.USER_TABLES)


def test_only_members_withdrawn_over_30_days_are_purged(client):
    old, old_job = member_with_data(client)
    recent, recent_job = member_with_data(client)
    blocked, blocked_job = member_with_data(client)  # 관리자 비활성화 (탈퇴 아님)
    active, active_job = member_with_data(client)
    withdraw(old, 31)
    withdraw(recent, 10)
    with Session(engine) as db:
        db.execute(update(User).where(User.id == int(blocked)).values(is_active=False))
        db.commit()

    assert withdrawal.purge_withdrawn(dry_run=True) == {int(old): None}
    assert malmoa_rows(old) > 0  # 미리보기는 지우지 않는다

    result = withdrawal.purge_withdrawn()
    assert list(result) == [int(old)]
    assert result[int(old)]["jobs"] == 1 and result[int(old)]["events"] == 1 and result[int(old)]["malmoa_profiles"] == 1
    assert malmoa_rows(old) == 0
    assert not present(f"uploads/{old_job}.m4a") and not present(transcript_keys(old_job)[0])
    assert not present(f"uploads/pending-{old}.m4a")
    with Session(engine) as db:
        assert db.get(User, int(old)) is not None  # meerkit 회원 행은 그대로 (1년 뒤 meerkit 이 익명화)
    for uid, job in ((recent, recent_job), (blocked, blocked_job), (active, active_job)):
        assert malmoa_rows(uid) > 0
        assert present(f"uploads/{job}.m4a")

    assert withdrawal.purge_withdrawn() == {}  # 두 번째는 할 일 없음


def test_withdrawal_period_comes_from_settings(client, monkeypatch):
    from app.features.malmoa.config import get_settings

    uid, _ = member_with_data(client)
    withdraw(uid, 8)
    assert withdrawal.purge_withdrawn(dry_run=True) == {}
    monkeypatch.setattr(get_settings(), "withdrawn_data_days", 7)
    assert list(withdrawal.purge_withdrawn(dry_run=True)) == [int(uid)]


def test_usage_rows_of_other_members_survive(client):
    old, _ = member_with_data(client)
    keep, keep_job = member_with_data(client)
    withdraw(old, 40)
    withdrawal.purge_withdrawn()
    with Session(engine) as db:
        assert db.scalar(select(func.count()).select_from(LlmUsage).where(LlmUsage.user_id == int(keep))) == 1
        assert db.scalar(select(func.count()).select_from(Person).where(Person.user_id == int(keep))) == 1
        assert db.scalar(select(func.count()).select_from(Event).where(Event.user_id == int(keep))) == 1
        assert db.get(MalmoaProfile, int(keep)).ics_token_hash is not None
        assert db.get(Job, keep_job) is not None
        assert db.scalar(select(func.count()).select_from(PendingUpload).where(PendingUpload.user_id == int(keep))) == 1
