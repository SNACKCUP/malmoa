"""음성 변환 과정 (긴 녹음 나누기 → 구간별 변환 → 이어서 하기 → 합치기)

진짜 Whisper 모델은 무거워서 가짜 모델로 시험한다. 모델을 끼우는 지점은 fake_model fixture 한 곳뿐이다.
"""

import io
import wave

import numpy as np
import pytest

from app.features.malmoa.config import get_settings
from app.features.malmoa.services import speech_engines
from app.features.malmoa.services.file_store import get_text, transcript_keys
from app.features.malmoa.services.transcriber import transcribe_job
from app.features.malmoa.store import JobStore
from features.malmoa.conftest import files

RATE = 16_000


def wav_bytes(seconds: float) -> bytes:
    """작은 잡음이 깔린 모노 16kHz WAV (어디서 잘라도 되는 소리)"""
    rng = np.random.default_rng(0)
    samples = (rng.normal(0, 800, int(seconds * RATE))).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(samples.tobytes())
    return buf.getvalue()


class FakeModel:
    """Whisper 모델 흉내: 구간마다 '문장N' 하나와 빈 문장 하나를 돌려준다"""

    def __init__(self):
        self.calls: list[tuple[int, dict]] = []  # (소리 길이(샘플), 옵션)
        self.fail = 0  # 남은 실패 횟수 (넣으면 그만큼 연달아 실패)

    def transcribe(self, audio, **options):
        self.calls.append((len(audio), options))
        if self.fail:
            self.fail -= 1
            raise RuntimeError("모델 오류 흉내")
        n = len(self.calls)
        return {"segments": [{"start": 1.0, "end": 2.0, "text": f" 문장{n} "}, {"start": 3.0, "end": 3.5, "text": "  "}]}


@pytest.fixture
def fake_model(monkeypatch):
    model = FakeModel()
    monkeypatch.setattr(speech_engines, "load_model", lambda name: model)
    return model


@pytest.fixture
def one_minute_parts(monkeypatch):
    monkeypatch.setattr(get_settings(), "segment_minutes", 1)


def upload(client, seconds: float) -> str:
    res = client.post("/api/jobs", files={"file": ("회의.wav", wav_bytes(seconds), "audio/wav")})
    assert res.status_code == 201, res.text
    return res.json()["id"]


def run(job_id: str) -> None:
    transcribe_job(job_id, JobStore(), get_settings())


def test_long_audio_is_split_transcribed_and_merged(client, fake_model, one_minute_parts):
    job_id = upload(client, 130)
    run(job_id)

    job = client.get(f"/api/jobs/{job_id}").json()
    assert job["status"] == "COMPLETED" and job["transcriptReady"] is True
    assert job["stage"] == "변환 완료" and job["durationSec"] == 130.0

    # 130초 → 1분 구간 3개. 지금 옵션(한국어, 앞 문장에 끌려가지 않기, CPU fp32)이 그대로 전달된다
    assert len(fake_model.calls) == 3
    for _, options in fake_model.calls:
        assert options["language"] == "ko"
        assert options["condition_on_previous_text"] is False
        assert options["fp16"] is False

    # 구간 안의 시각에 구간 시작 시각이 더해지고, 빈 문장은 버린다
    offsets = np.cumsum([0] + [n for n, _ in fake_model.calls[:-1]]) / RATE
    segments = client.get(f"/api/jobs/{job_id}/transcript").json()["segments"]
    assert [s["text"] for s in segments] == ["문장1", "문장2", "문장3"]
    assert [s["start"] for s in segments] == [round(1.0 + o, 2) for o in offsets]

    txt = get_text(files(), transcript_keys(job_id)[1])
    assert txt.splitlines()[0] == "[00:00:01] 문장1"
    assert not (get_settings().work_dir / job_id).exists()  # 임시 구간 파일 정리


def test_failed_part_resumes_from_that_part(client, fake_model, one_minute_parts):
    job_id = upload(client, 130)
    fake_model.fail = 0
    original = fake_model.transcribe

    def fail_after_first(audio, **options):
        if len(fake_model.calls) >= 1:
            fake_model.fail = 1
        return original(audio, **options)

    fake_model.transcribe = fail_after_first
    run(job_id)
    job = client.get(f"/api/jobs/{job_id}").json()
    assert job["status"] == "FAILED"
    assert job["errorMessage"] == "구간 2/3을 변환하지 못했습니다. 다시 시도하면 이 구간부터 이어서 변환합니다."
    assert len(fake_model.calls) == 1 + 2  # 1구간 성공, 2구간 두 번 시도

    # 다시 시도: 저장된 1구간은 건너뛰고 2·3구간만 변환한다
    fake_model.transcribe = original
    fake_model.calls.clear()
    run(job_id)
    assert client.get(f"/api/jobs/{job_id}").json()["status"] == "COMPLETED"
    assert len(fake_model.calls) == 2
    texts = [s["text"] for s in client.get(f"/api/jobs/{job_id}/transcript").json()["segments"]]
    assert texts == ["문장1", "문장1", "문장2"]  # 1구간은 첫 실행 결과, 2·3구간은 다시 시도한 결과


def test_part_retries_once_then_succeeds(client, fake_model):
    job_id = upload(client, 5)
    fake_model.fail = 1
    run(job_id)
    assert client.get(f"/api/jobs/{job_id}").json()["status"] == "COMPLETED"
    assert len(fake_model.calls) == 2


def test_finished_transcript_is_reused(client, fake_model):
    job_id = upload(client, 5)
    run(job_id)
    fake_model.calls.clear()
    run(job_id)
    assert fake_model.calls == []
    assert client.get(f"/api/jobs/{job_id}").json()["status"] == "COMPLETED"


def test_stage_names_the_model_while_loading(client, fake_model, monkeypatch):
    stages = []
    store = JobStore()
    real_update = store.update

    def spy(job_id, **fields):
        if fields.get("stage"):
            stages.append(fields["stage"])
        return real_update(job_id, **fields)

    monkeypatch.setattr(store, "update", spy)
    job_id = upload(client, 5)
    transcribe_job(job_id, store, get_settings())
    assert stages == ["오디오 준비 중", "Whisper small 모델 불러오는 중", "구간 1/1 변환 중", "변환 완료"]
