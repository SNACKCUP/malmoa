"""AI 회의록 연결 설정: 키 암호화·숨김 · 사용자별 분리 · .env 대체 · 제공자별 호출 (유료 API는 부르지 않는다)"""

from types import SimpleNamespace

import anthropic
import httpx2
import openai
from sqlalchemy import select

from app.features.malmoa.config import get_settings
from app.features.malmoa.db import SessionLocal
from app.features.malmoa.models import LlmSetting
from app.features.malmoa.schemas.jobs import JobStatus
from app.features.malmoa.services import llm
from app.features.malmoa.services.file_store import (
    get_json,
    minutes_keys,
    put_json,
    transcript_keys,
)
from app.features.malmoa.services.minutes import generate_minutes
from app.features.malmoa.store import JobStore
from features.malmoa.conftest import auth, files, register

KEY = "sk-test-abcdefghijklmnop1234"
AUDIO = ("회의.m4a", b"fake-audio-bytes", "audio/mp4")


def _save(client, token, **body):
    return client.put("/api/settings/llm", json={"provider": "openai", "model": "gpt-test", **body}, headers=auth(token))


def test_without_screen_settings_uses_env(client):
    token = register(client)
    res = client.get("/api/settings/llm", headers=auth(token))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["source"] == "env"
    assert body["hasKey"] is False  # 테스트는 OPENAI_API_KEY="" 로 실행
    assert "API 키가 설정되지 않았습니다" in body["problem"]
    assert [p["id"] for p in body["providers"]] == ["openai", "anthropic", "gemini", "compatible"]


def test_saved_key_is_encrypted_and_never_returned(client):
    token = register(client)
    res = _save(client, token, apiKey=f"  {KEY} ")
    assert res.status_code == 200, res.text
    assert KEY not in res.text
    body = res.json()
    assert body["source"] == "screen" and body["problem"] is None
    assert body["keyHint"] == "sk-test…1234"
    assert body["label"] == "OpenAI · gpt-test"
    assert KEY not in client.get("/api/settings/llm", headers=auth(token)).text

    with SessionLocal() as db:
        row = db.scalar(select(LlmSetting))
        assert row.api_key_enc and KEY not in row.api_key_enc
        assert llm.decrypt_key(row.api_key_enc) == KEY
        assert llm.resolve(db, row.user_id).api_key == KEY


def test_blank_key_keeps_saved_key_only_for_same_provider(client):
    token = register(client)
    _save(client, token, apiKey=KEY)
    kept = _save(client, token, model="gpt-other")
    assert kept.status_code == 200 and kept.json()["keyHint"] == "sk-test…1234"
    assert kept.json()["model"] == "gpt-other"

    switched = _save(client, token, provider="anthropic", model="claude-opus-5-5")
    assert switched.status_code == 400
    assert "Anthropic (Claude) API 키를 입력" in switched.json()["detail"]


def test_first_save_can_reuse_env_key(client):
    token = register(client)
    settings = get_settings()
    settings.openai_api_key = KEY
    try:
        res = _save(client, token, model="gpt-other")  # 키 칸을 비우고 모델만 바꿔 저장
        assert res.status_code == 200, res.text
        assert res.json()["source"] == "screen" and res.json()["keyHint"] == "sk-test…1234"
    finally:
        settings.openai_api_key = ""
    # .env 키를 지워도 화면 설정에 암호화해 옮겨 두었으므로 그대로 쓴다
    with SessionLocal() as db:
        row = db.scalar(select(LlmSetting))
        assert llm.resolve(db, row.user_id).api_key == KEY


def test_compatible_provider_needs_url_but_not_key(client):
    token = register(client)
    assert "주소가 필요" in _save(client, token, provider="compatible", model="llama3").json()["detail"]
    assert "http://" in _save(client, token, provider="compatible", model="llama3", baseUrl="ftp://x").json()["detail"]
    ok = _save(client, token, provider="compatible", model="llama3", baseUrl="http://localhost:11434/v1/")
    assert ok.status_code == 200, ok.text
    assert ok.json()["baseUrl"] == "http://localhost:11434/v1"
    assert ok.json()["problem"] is None and ok.json()["hasKey"] is False
    # 다른 제공자로 바꾸면 주소는 버린다
    assert _save(client, token, apiKey=KEY).json()["baseUrl"] is None


def test_bad_input_is_explained(client):
    token = register(client)
    assert "공백이나 줄바꿈" in _save(client, token, apiKey="sk-abc def").json()["detail"]
    assert "모델을 골라" in _save(client, token, apiKey=KEY, model="  ").json()["detail"]


def test_settings_are_per_user_and_delete_falls_back_to_env(client):
    owner = register(client, "owner@example.com")
    other = register(client, "other@example.com")
    _save(client, owner, apiKey=KEY)

    theirs = client.get("/api/settings/llm", headers=auth(other)).json()
    assert theirs["source"] == "env" and theirs["keyHint"] is None

    assert client.delete("/api/settings/llm", headers=auth(owner)).status_code == 204
    assert client.get("/api/settings/llm", headers=auth(owner)).json()["source"] == "env"


def test_changed_secret_asks_to_enter_key_again(client):
    token = register(client)
    _save(client, token, apiKey=KEY)
    settings = get_settings()
    original = settings.secret_key
    settings.secret_key = "a-different-secret"
    try:
        body = client.get("/api/settings/llm", headers=auth(token)).json()
        assert body["hasKey"] is True
        assert "다시 입력" in body["problem"]
    finally:
        settings.secret_key = original


def test_check_lists_models_with_typed_or_saved_key(client, monkeypatch):
    token = register(client)
    seen = []

    def fake_list(cfg):
        seen.append(cfg)
        return ["gpt-a", "gpt-b"]

    monkeypatch.setattr(llm, "list_models", fake_list)
    res = client.post("/api/settings/llm/check", json={"provider": "openai", "apiKey": KEY}, headers=auth(token))
    assert res.status_code == 200, res.text
    assert res.json()["models"] == ["gpt-a", "gpt-b"]
    assert seen[-1].api_key == KEY

    # 키를 비우면 같은 제공자로 저장된 키
    assert client.post("/api/settings/llm/check", json={"provider": "openai"}, headers=auth(token)).status_code == 400
    _save(client, token, apiKey=KEY)
    assert client.post("/api/settings/llm/check", json={"provider": "openai"}, headers=auth(token)).status_code == 200
    assert seen[-1].api_key == KEY
    assert client.post("/api/settings/llm/check", json={"provider": "gemini"}, headers=auth(token)).status_code == 400

    def failing(cfg):
        raise llm.LlmError("OpenAI API 키가 올바르지 않습니다.")

    monkeypatch.setattr(llm, "list_models", failing)
    bad = client.post("/api/settings/llm/check", json={"provider": "openai", "apiKey": KEY}, headers=auth(token))
    assert bad.status_code == 400 and "올바르지 않습니다" in bad.json()["detail"]


def test_start_minutes_uses_my_settings(client):
    token = register(client)
    job = client.post("/api/jobs", files={"file": AUDIO}, headers=auth(token)).json()
    JobStore().update(job["id"], transcript_ready=True, status=JobStatus.COMPLETED)
    res = client.post(f"/api/jobs/{job['id']}/minutes", headers=auth(token))
    assert res.status_code == 400
    assert "설정 화면" in res.json()["detail"]


def _transcribed_job(client, token) -> str:
    job = client.post("/api/jobs", files={"file": AUDIO}, headers=auth(token)).json()
    put_json(files(), transcript_keys(job["id"])[0], {"segments": [{"start": 0, "end": 3, "text": "다음 주 금요일까지 김철수가 보고서를 쓰기로 했습니다."}]})
    JobStore().update(job["id"], transcript_ready=True, status=JobStatus.COMPLETED)
    return job["id"]


def test_generate_minutes_with_claude_reply_in_code_block(client, monkeypatch):
    token = register(client)
    _save(client, token, provider="anthropic", model="claude-opus-5-5", apiKey="sk-ant-test-0123456789abcd")
    job_id = _transcribed_job(client, token)
    calls = []

    def fake_complete(cfg, system, prompt):
        calls.append(cfg)
        return llm.Reply('설명입니다.\n```json\n{"title": "보고서 회의", "decisions": ["보고서 작성"]}\n```', 120, 30)

    monkeypatch.setattr(llm, "complete_json", fake_complete)
    generate_minutes(job_id, JobStore(), get_settings())

    job = JobStore().get(job_id)
    assert job.status == JobStatus.COMPLETED, job.error_message
    assert job.llm_tokens == 150
    assert calls[0].provider == "anthropic" and calls[0].api_key == "sk-ant-test-0123456789abcd"
    saved = get_json(files(), minutes_keys(job_id)[0])
    assert saved["provider"] == "anthropic" and saved["model"] == "claude-opus-5-5"
    assert saved["minutes"]["title"] == "보고서 회의"


def test_generate_minutes_reports_provider_error(client, monkeypatch):
    token = register(client)
    _save(client, token, apiKey=KEY)
    job_id = _transcribed_job(client, token)

    def no_credit(cfg, system, prompt):
        raise llm.LlmError("OpenAI 계정의 사용 한도(크레딧)가 부족합니다.")

    monkeypatch.setattr(llm, "complete_json", no_credit)
    generate_minutes(job_id, JobStore(), get_settings())
    job = JobStore().get(job_id)
    assert job.status == JobStatus.FAILED
    assert "크레딧" in job.error_message


def _response(code: int) -> httpx2.Response:
    return httpx2.Response(code, request=httpx2.Request("POST", "https://api.example.com"))


def test_friendly_errors_for_both_sdks():
    oa = llm.LlmConfig("openai", "gpt-test", KEY, None, "screen")
    cl = llm.LlmConfig("anthropic", "claude-opus-5-5", KEY, None, "screen")
    quota = openai.RateLimitError("You have no credits remaining (insufficient_quota)", response=_response(429), body=None)
    assert "크레딧" in str(llm.friendly(quota, oa))
    busy = openai.RateLimitError("Rate limit reached", response=_response(429), body=None)
    assert "너무 많습니다" in str(llm.friendly(busy, oa))
    credit = anthropic.BadRequestError("Your credit balance is too low", response=_response(400), body=None)
    assert "크레딧" in str(llm.friendly(credit, cl))
    wrong = anthropic.AuthenticationError("invalid x-api-key", response=_response(401), body=None)
    msg = str(llm.friendly(wrong, cl))
    assert "Anthropic (Claude) API 키가 올바르지 않습니다" in msg and KEY not in msg


def test_claude_reply_skips_thinking_blocks(monkeypatch):
    res = SimpleNamespace(
        stop_reason="end_turn",
        content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text='{"title": "t"}')],
        usage=SimpleNamespace(input_tokens=7, output_tokens=3),
    )
    sent = {}

    class FakeMessages:
        def create(self, **kw):
            sent.update(kw)
            return res

    monkeypatch.setattr(llm, "_anthropic_client", lambda cfg, timeout, retries: SimpleNamespace(messages=FakeMessages()))
    reply = llm.complete_json(llm.LlmConfig("anthropic", "claude-opus-5-5", KEY, None, "screen"), "sys", "prompt")
    assert reply == llm.Reply('{"title": "t"}', 7, 3)
    assert sent["system"] == "sys" and sent["max_tokens"] == llm.MAX_TOKENS and "temperature" not in sent

    res.stop_reason = "refusal"
    try:
        llm.complete_json(llm.LlmConfig("anthropic", "claude-opus-5-5", KEY, None, "screen"), "sys", "prompt")
        raise AssertionError("거절을 오류로 알려야 한다")
    except llm.LlmError as e:
        assert "거절" in str(e)
