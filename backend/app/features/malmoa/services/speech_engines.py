"""음성 인식 엔진 — 소리 한 구간을 문장 목록으로 바꾸는 부분만 갈아끼운다 (설정 TRANSCRIBER)

긴 녹음 나누기·구간 저장·이어서 하기·합치기는 transcriber.py 가 엔진과 상관없이 맡는다.
엔진은 '16kHz 모노 float32 소리 한 구간 → [{start, end, text}]'(시각은 구간 안 기준, 빈 문장 제외)만 한다.

새 방식을 붙이려면 (예: Mac 작업자, 외부 음성 인식 API)
  1. 아래 SpeechEngine 모양을 따르는 클래스를 만들고 ENGINES 에 한 줄 추가한다.
  2. core/config.py 의 transcriber Literal 에 같은 이름을 추가한다 (tests/test_speech_engines.py 가 둘이 맞는지 본다).
"""

import logging
import threading
from functools import lru_cache
from typing import Protocol

import numpy as np

from app.features.malmoa.config import Settings

log = logging.getLogger(__name__)

# TRANSCRIBER=none: 이 서버는 음성 변환을 하지 않는다 (Whisper 를 돌릴 수 없는 배포 서버 등)
DISABLED = "none"
DISABLED_MESSAGE = "이 서버에서는 음성 변환을 하지 않습니다. (TRANSCRIBER=none)"


class SpeechEngine(Protocol):
    name: str

    @property
    def loading_stage(self) -> str | None:
        """준비(모델 불러오기 등) 중에 화면에 보여 줄 단계 문구. 준비할 것이 없으면 None"""
        ...

    def prepare(self) -> None:
        """첫 구간을 변환하기 전에 한 번 부른다 (이미 변환된 구간만 남았으면 부르지 않는다)"""
        ...

    def transcribe(self, audio: np.ndarray, language: str) -> list[dict]:
        """구간 하나 → [{start, end, text}] (초, 구간 안 기준). 실패하면 예외 — 재시도는 transcriber.py 가 한다"""
        ...


# ── 로컬 Whisper (이 컴퓨터에서 실행, 녹음을 밖으로 보내지 않는다) ──

_model_lock = threading.Lock()


@lru_cache(maxsize=1)
def _load_model(name: str):
    import whisper

    log.info("Whisper 모델 불러오는 중: %s", name)
    # Apple Silicon의 MPS는 Whisper에서 오류가 잦아 CPU를 쓴다.
    return whisper.load_model(name, device="cpu")


def load_model(name: str):
    with _model_lock:
        return _load_model(name)


class LocalWhisper:
    name = "local_whisper"

    def __init__(self, settings: Settings):
        self.model_name = settings.whisper_model
        self._model = None

    @property
    def loading_stage(self) -> str:
        return f"Whisper {self.model_name} 모델 불러오는 중"

    def prepare(self) -> None:
        self._model = load_model(self.model_name)

    def transcribe(self, audio: np.ndarray, language: str) -> list[dict]:
        result = self._model.transcribe(
            audio,
            language=language,
            fp16=False,
            # 긴 회의에서 같은 문장이 반복 출력되는 현상을 줄인다
            condition_on_previous_text=False,
            verbose=None,
        )
        return [{"start": seg["start"], "end": seg["end"], "text": seg["text"].strip()} for seg in result["segments"] if seg["text"].strip()]


ENGINES: dict[str, type[SpeechEngine]] = {
    LocalWhisper.name: LocalWhisper,
}


def enabled(settings: Settings) -> bool:
    return settings.transcriber != DISABLED


def get_engine(settings: Settings) -> SpeechEngine:
    """설정의 엔진. TRANSCRIBER=none 이면 호출하지 않는다 (enabled 로 먼저 확인)"""
    return ENGINES[settings.transcriber](settings)
