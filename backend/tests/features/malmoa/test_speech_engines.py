"""음성 인식 엔진 고르기 (TRANSCRIBER) — 로컬 Whisper 엔진, 끄기(none), 설정 검증"""

import typing
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.features.malmoa.config import Settings, get_settings
from app.features.malmoa.services import speech_engines
from app.features.malmoa.services.transcriber import transcribe_job
from app.features.malmoa.store import JobStore
from features.malmoa.test_transcriber import FakeModel, upload


def test_config_choices_match_engines():
    """config 의 Literal 과 ENGINES 가 어긋나면 고를 수 있는데 없는 엔진이 생긴다"""
    choices = set(typing.get_args(Settings.model_fields["transcriber"].annotation))
    assert choices == set(speech_engines.ENGINES) | {speech_engines.DISABLED}


def test_default_is_local_whisper():
    assert Settings.model_fields["transcriber"].default == "local_whisper"
    assert isinstance(speech_engines.get_engine(get_settings()), speech_engines.LocalWhisper)


def test_unknown_transcriber_is_rejected():
    with pytest.raises(ValidationError, match="local_whisper"):
        Settings(transcriber="cloud_magic")


def test_local_whisper_passes_options_and_drops_blank_text(monkeypatch):
    model = FakeModel()
    loaded = []
    monkeypatch.setattr(speech_engines, "load_model", lambda name: loaded.append(name) or model)
    engine = speech_engines.LocalWhisper(get_settings())
    assert engine.loading_stage == f"Whisper {get_settings().whisper_model} 모델 불러오는 중"
    engine.prepare()
    assert loaded == [get_settings().whisper_model]

    found = engine.transcribe([0.0] * 10, "ko")
    assert found == [{"start": 1.0, "end": 2.0, "text": "문장1"}]  # 앞뒤 공백 정리, 빈 문장 제외
    assert model.calls[0][1] == {"language": "ko", "fp16": False, "condition_on_previous_text": False, "verbose": None}


@pytest.fixture
def transcriber_off(monkeypatch):
    monkeypatch.setattr(get_settings(), "transcriber", "none")


def test_off_rejects_audio_transcribe_request(client, transcriber_off):
    job_id = upload(client, 3)
    res = client.post(f"/api/jobs/{job_id}/transcribe")
    assert res.status_code == 503
    assert res.json()["detail"] == "이 서버에서는 음성 변환을 하지 않습니다. (TRANSCRIBER=none)"  # meerkit 오류 형식: detail + code·request_id
    assert client.get(f"/api/jobs/{job_id}").json()["status"] == "QUEUED"  # 작업은 그대로


def test_off_marks_job_failed_if_it_reaches_the_worker(client, transcriber_off, monkeypatch):
    monkeypatch.setattr(speech_engines, "load_model", lambda name: pytest.fail("끄면 모델을 불러오지 않는다"))
    job_id = upload(client, 3)
    transcribe_job(job_id, JobStore(), get_settings())
    job = client.get(f"/api/jobs/{job_id}").json()
    assert job["status"] == "FAILED"
    assert job["errorMessage"] == speech_engines.DISABLED_MESSAGE


def test_off_still_accepts_whiteboard_photos(client, transcriber_off):
    """사진 글자 읽기는 음성 변환 설정과 별개다 (다음 단계에서 따로 고르게 한다)"""
    png = (Path(__file__).parent / "fixtures" / "whiteboard.png").read_bytes()
    job_id = client.post("/api/jobs", files={"file": ("보드.png", png, "image/png")}).json()["id"]
    assert client.post(f"/api/jobs/{job_id}/transcribe").status_code == 202


def test_health_shows_transcriber(client, transcriber_off):
    assert client.get("/api/health").json()["transcriber"] == "none"
