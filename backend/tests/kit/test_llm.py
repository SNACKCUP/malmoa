"""LLM 공통 모듈: 프롬프트 불러오기, 구조화 응답, 재시도, 입력 상한, 오류 변환, 설정, 로그.

예시: 회의록 → 요약 + 할 일 목록 (서비스와 무관한 일반 예시)
"""

import logging
from pathlib import Path

import pytest
from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient
from langchain_core.language_models import BaseChatModel
from pydantic import BaseModel

from app.llm import get_chat_model, invoke_structured, load_prompt, override_chat_model
from app.llm.config import llm_settings, production_problems
from app.llm.errors import LLMError, translate
from app.llm.testing import FakeChatModel

PROMPT = Path(__file__).parent / "prompts" / "meeting_summary.md"
NOTES = "10/24 회의. 김미어: 로그인 화면 시안 금요일까지. 이캣: 배포 일정 확인."


class ActionItem(BaseModel):
    owner: str
    task: str
    due: str | None = None


class MeetingSummary(BaseModel):
    summary: str
    action_items: list[ActionItem]


GOOD = {
    "summary": "로그인 시안과 배포 일정을 논의했다.",
    "action_items": [{"owner": "김미어", "task": "로그인 화면 시안", "due": "금요일"}],
}


@pytest.fixture(autouse=True)
def _llm_logs_visible():
    # app 로거는 propagate=False 라서 caplog 가 받도록 테스트 동안만 켭니다
    logger = logging.getLogger("app")
    logger.propagate = True
    yield
    logger.propagate = False


# ---- 프롬프트 ----


def test_load_prompt_sections_and_variables():
    prompt = load_prompt(PROMPT)
    messages = prompt.format_messages(notes=NOTES)
    assert [m.type for m in messages] == ["system", "human"]
    assert "지어내지 않는다" in messages[0].content
    assert NOTES in messages[1].content


def test_load_prompt_without_headings_is_user_message(tmp_path):
    path = tmp_path / "plain.md"
    path.write_text("요약해 줘: {text}", encoding="utf-8")
    assert [m.type for m in load_prompt(path).format_messages(text="x")] == ["human"]


def test_load_prompt_requires_user_section(tmp_path):
    path = tmp_path / "only_system.md"
    path.write_text("## system\n너는 비서다.", encoding="utf-8")
    with pytest.raises(ValueError):
        load_prompt(path)


# ---- 구조화 응답 ----


def test_invoke_structured_returns_schema_object(fake_llm):
    fake_llm.responses.append(GOOD)
    result = invoke_structured(load_prompt(PROMPT), MeetingSummary, {"notes": NOTES})
    assert isinstance(result, MeetingSummary)
    assert result.action_items[0].owner == "김미어"
    sent = fake_llm.calls[0]
    assert sent[0].type == "system" and NOTES in sent[1].content


def test_bad_shape_is_retried_once(fake_llm, caplog):
    fake_llm.responses.extend([{"summary": 1}, GOOD])
    with caplog.at_level(logging.INFO, logger="app.llm"):
        result = invoke_structured(load_prompt(PROMPT), MeetingSummary, {"notes": NOTES})
    assert result.summary
    assert "outcome=ok_after_retry" in caplog.text


def test_bad_shape_twice_raises_bad_output(fake_llm):
    fake_llm.responses.extend([{"summary": 1}, "not json"])
    with pytest.raises(LLMError) as e:
        invoke_structured(load_prompt(PROMPT), MeetingSummary, {"notes": NOTES})
    assert (e.value.code, e.value.status_code) == ("LLM_BAD_OUTPUT", 502)


def test_input_too_long_is_rejected_before_calling(fake_llm, monkeypatch):
    monkeypatch.setattr(llm_settings, "llm_max_input_chars", 10)
    with pytest.raises(LLMError) as e:
        invoke_structured(load_prompt(PROMPT), MeetingSummary, {"notes": NOTES})
    assert (e.value.code, e.value.status_code) == ("LLM_INPUT_TOO_LONG", 413)
    assert fake_llm.calls == []


def test_fake_without_responses_returns_placeholder(fake_llm):
    result = invoke_structured(load_prompt(PROMPT), MeetingSummary, {"notes": NOTES})
    assert isinstance(result, MeetingSummary)
    assert isinstance(result.action_items[0], ActionItem)


# ---- 공급자 오류 → 사용자 문구 ----


def _provider_error(name: str, **attrs) -> Exception:
    exc = type(name, (Exception,), {})("원문 오류: sk-secret-key 포함")
    for key, value in attrs.items():
        setattr(exc, key, value)
    return exc


@pytest.mark.parametrize(
    ("name", "attrs", "code", "status"),
    [
        ("APITimeoutError", {}, "LLM_TIMEOUT", 504),
        ("RateLimitError", {}, "LLM_RATE_LIMITED", 429),
        ("RateLimitError", {"code": "insufficient_quota"}, "LLM_QUOTA_EXCEEDED", 429),
        ("AuthenticationError", {}, "LLM_AUTH_FAILED", 503),
        ("BadRequestError", {"code": "context_length_exceeded"}, "LLM_INPUT_TOO_LONG", 413),
        ("APIConnectionError", {}, "LLM_PROVIDER_ERROR", 502),
    ],
)
def test_translate_provider_errors(name, attrs, code, status):
    err = translate(_provider_error(name, **attrs))
    assert (err.code, err.status_code) == (code, status)
    assert "sk-secret" not in err.message


def test_provider_error_logs_no_content_or_raw_message(fake_llm, caplog):
    fake_llm.responses.append(_provider_error("RateLimitError"))
    with caplog.at_level(logging.INFO, logger="app.llm"), pytest.raises(LLMError) as e:
        invoke_structured(load_prompt(PROMPT), MeetingSummary, {"notes": NOTES})
    assert e.value.code == "LLM_RATE_LIMITED"
    assert "code=LLM_RATE_LIMITED" in caplog.text and "provider=" in caplog.text
    assert NOTES not in caplog.text and "sk-secret" not in caplog.text


# ---- 모델 얻기·설정 ----


def test_missing_key_is_not_configured(monkeypatch):
    monkeypatch.setattr(llm_settings, "llm_provider", "openai")
    monkeypatch.setattr(llm_settings, "openai_api_key", "")
    with pytest.raises(LLMError) as e:
        get_chat_model()
    assert (e.value.code, e.value.status_code) == ("LLM_NOT_CONFIGURED", 503)


def test_unknown_provider_is_not_configured(monkeypatch):
    monkeypatch.setattr(llm_settings, "llm_provider", "nope")
    monkeypatch.setattr(llm_settings, "openai_api_key", "")
    with pytest.raises(LLMError):
        get_chat_model()


def test_openai_model_uses_settings(monkeypatch):
    monkeypatch.setattr(llm_settings, "llm_provider", "openai")
    monkeypatch.setattr(llm_settings, "openai_api_key", "sk-test-not-real")
    monkeypatch.setattr(llm_settings, "llm_timeout_seconds", 12)
    model = get_chat_model()  # 네트워크 호출 없음 (객체만 생성)
    assert isinstance(model, BaseChatModel)
    assert model.model_name == llm_settings.llm_model
    assert model.request_timeout == 12


def test_fake_provider(monkeypatch):
    monkeypatch.setattr(llm_settings, "llm_provider", "fake")
    assert isinstance(get_chat_model(), FakeChatModel)


def test_production_blocks_fake_provider_but_not_missing_key(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(llm_settings, "openai_api_key", "")
    monkeypatch.setattr(llm_settings, "llm_provider", "openai")
    assert production_problems() == []  # 키가 없어도 서버는 뜸 (LLM 기능만 503)
    monkeypatch.setattr(llm_settings, "llm_provider", "fake")
    assert any("LLM_PROVIDER" in p for p in production_problems())


# ---- API 에서 쓸 때: 오류 응답 형식 ----


def _app_with_llm_route():
    from app.main import create_app

    app = create_app()
    router = APIRouter()

    @router.post("/summary")
    def summary(body: dict, model: BaseChatModel = Depends(get_chat_model)):
        return invoke_structured(load_prompt(PROMPT), MeetingSummary, {"notes": body["notes"]}, model=model)

    app.include_router(router, prefix="/test")
    return app


def test_route_returns_503_when_not_configured(monkeypatch):
    monkeypatch.setattr(llm_settings, "llm_provider", "openai")
    monkeypatch.setattr(llm_settings, "openai_api_key", "")
    response = TestClient(_app_with_llm_route()).post("/test/summary", json={"notes": NOTES})
    assert response.status_code == 503
    body = response.json()
    assert body["code"] == "LLM_NOT_CONFIGURED" and body["request_id"]


def test_route_with_dependency_override():
    app = _app_with_llm_route()
    app.dependency_overrides[get_chat_model] = lambda: FakeChatModel(responses=[GOOD])
    response = TestClient(app).post("/test/summary", json={"notes": NOTES})
    assert response.status_code == 200
    assert response.json()["action_items"][0]["task"] == "로그인 화면 시안"


def test_override_context_restores():
    from app.llm import client

    model = FakeChatModel()
    with override_chat_model(model):
        assert get_chat_model() is model
    assert client._override is None
