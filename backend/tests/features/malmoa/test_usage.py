"""AI 사용량: 호출마다 기록 · 작업을 지워도 남음 · 한국 시간 기준 오늘/이번 달 · 한도 저장 (유료 API는 부르지 않는다)"""

from datetime import UTC, datetime

from app.features.malmoa.config import get_settings
from app.features.malmoa.db import SessionLocal
from app.features.malmoa.models import LlmUsage
from app.features.malmoa.schemas.jobs import JobStatus
from app.features.malmoa.services import ai_usage, llm
from app.features.malmoa.services.file_store import put_json, transcript_keys
from app.features.malmoa.services.minutes import generate_minutes
from app.features.malmoa.store import JobStore
from features.malmoa.conftest import auth, files, register

KEY = "sk-test-abcdefghijklmnop1234"


def _job_ready_for_minutes(client, h) -> str:
    client.put("/api/settings/llm", json={"provider": "gemini", "model": "gemini-test", "apiKey": KEY}, headers=h)
    job = client.post("/api/jobs", files={"file": ("주간회의.m4a", b"fake-audio-bytes", "audio/mp4")}, headers=h).json()
    put_json(files(), transcript_keys(job["id"])[0], {"segments": [{"start": 0, "end": 3, "text": "금요일까지 보고서를 쓰기로 했습니다."}]})
    JobStore().update(job["id"], transcript_ready=True, status=JobStatus.COMPLETED)
    return job["id"]


def test_every_call_is_recorded_and_kept_after_job_delete(client, monkeypatch):
    h = auth(register(client))
    job_id = _job_ready_for_minutes(client, h)
    replies = iter([llm.Reply("형식이 틀린 답", 100, 10), llm.Reply('{"title": "주간 회의"}', 120, 30)])
    monkeypatch.setattr(llm, "complete_json", lambda cfg, system, prompt: next(replies))
    generate_minutes(job_id, JobStore(), get_settings())
    assert JobStore().get(job_id).llm_tokens == 260

    u = client.get("/api/usage", headers=h).json()
    # 형식이 틀려 다시 물은 호출도 센다
    expected = {"calls": 2, "inputTokens": 220, "outputTokens": 40, "tokens": 260}
    assert u["today"] == u["month"] == u["all"] == expected
    assert u["byModel"] == [{"provider": "gemini", "model": "gemini-test", **expected}]
    assert [(r["jobId"], r["fileName"], r["inputTokens"]) for r in u["recent"]] == [(job_id, "주간회의.m4a", 120), (job_id, "주간회의.m4a", 100)]
    assert u["monthlyTokens"] is None and u["dailyCalls"] is None

    assert client.delete(f"/api/jobs/{job_id}", headers=h).status_code == 204
    after = client.get("/api/usage", headers=h).json()
    assert after["all"] == expected
    assert {(r["jobId"], r["fileName"]) for r in after["recent"]} == {(None, "주간회의.m4a")}


def test_failed_provider_call_records_nothing(client, monkeypatch):
    h = auth(register(client))
    job_id = _job_ready_for_minutes(client, h)

    def failing(cfg, system, prompt):
        raise llm.LlmError("크레딧이 부족합니다.")

    monkeypatch.setattr(llm, "complete_json", failing)
    generate_minutes(job_id, JobStore(), get_settings())
    assert JobStore().get(job_id).status == JobStatus.FAILED
    assert client.get("/api/usage", headers=h).json()["all"]["calls"] == 0


def test_today_and_month_follow_korean_time(client):
    user_id = int(register(client))
    at = datetime(2026, 11, 2, 3, 0, tzinfo=UTC)  # 한국 11월 2일 낮 12시
    with SessionLocal() as db:
        for when, tokens in [
            (datetime(2026, 11, 1, 15, 30, tzinfo=UTC), 1),  # 한국 11/2 00:30 → 오늘
            (datetime(2026, 11, 1, 14, 30, tzinfo=UTC), 10),  # 한국 11/1 23:30 → 이번 달
            (datetime(2026, 10, 31, 15, 30, tzinfo=UTC), 100),  # 한국 11/1 00:30 → 이번 달
            (datetime(2026, 10, 31, 14, 30, tzinfo=UTC), 1000),  # 한국 10/31 23:30 → 지난달
        ]:
            db.add(LlmUsage(user_id=user_id, provider="gemini", model="m", calls=1, input_tokens=tokens, output_tokens=0, created_at=when))
        db.commit()
        s = ai_usage.summary(db, user_id, at)
    assert (s["today"]["tokens"], s["month"]["tokens"], s["all"]["tokens"]) == (1, 111, 1111)
    assert s["month_start"].isoformat() == "2026-11-01T00:00:00+09:00"
    assert s["next_day"].isoformat() == "2026-11-03T00:00:00+09:00"


def test_limits_are_saved_validated_and_per_user(client):
    me, other = auth(register(client)), auth(register(client, "other@example.com"))
    saved = client.put("/api/usage/limits", json={"monthlyTokens": 1_000_000, "dailyCalls": 1500}, headers=me).json()
    assert (saved["monthlyTokens"], saved["dailyCalls"]) == (1_000_000, 1500)
    assert client.get("/api/usage", headers=other).json()["monthlyTokens"] is None

    assert client.put("/api/usage/limits", json={"monthlyTokens": 0}, headers=me).status_code == 422
    assert client.put("/api/usage/limits", json={"dailyCalls": -1}, headers=me).status_code == 422
    assert client.put("/api/usage/limits", json={"monthlyTokens": 3_000_000_000}, headers=me).status_code == 422

    cleared = client.put("/api/usage/limits", json={"monthlyTokens": None, "dailyCalls": 1500}, headers=me).json()
    assert (cleared["monthlyTokens"], cleared["dailyCalls"]) == (None, 1500)
