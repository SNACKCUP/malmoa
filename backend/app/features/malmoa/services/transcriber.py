"""음성 변환 과정 (엔진과 상관없이 공통)

긴 녹음 처리 방식
  1. ffmpeg로 원본(webm/m4a/mp3…)을 16kHz 모노 WAV로 한 번 변환한다. (Whisper 입력 형식)
  2. WAV를 SEGMENT_MINUTES 길이로 나눠 구간마다 음성 인식 엔진을 부른다.
     엔진(로컬 Whisper 등)은 설정 TRANSCRIBER 로 고른다 — services/speech_engines.py
  3. 구간 결과를 work/{job_id}/part_000.json 으로 즉시 저장한다. (work/ 는 저장소 설정과 상관없이 항상 로컬)
     실패하거나 서버가 꺼져도 다시 시작하면 저장된 구간은 건너뛰고 이어서 변환한다.
  4. 모든 구간이 끝나면 저장소의 transcripts/{job_id}.json · .txt 로 합치고 임시 파일을 지운다.
     원본·원문은 저장소(MALMOA_FILES_BACKEND: 로컬 폴더 또는 S3 비공개 버킷)에 있다 — services/file_store.py

2시간 녹음의 16kHz WAV는 약 230MB이고, 한 번에 메모리에 올리는 것은 한 구간뿐이다.
"""

import json
import logging
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np

from app.features.malmoa.config import Settings
from app.features.malmoa.schemas.jobs import JobStatus
from app.features.malmoa.services.file_store import (
    TEXT,
    get_store,
    put_json,
    put_text,
    transcript_keys,
    upload_key,
)
from app.features.malmoa.services.ocr import OcrError, read_text
from app.features.malmoa.services.speech_engines import (
    DISABLED_MESSAGE,
    enabled,
    get_engine,
)
from app.features.malmoa.store import JobStore, write_json_atomic

log = logging.getLogger(__name__)

SAMPLE_RATE = 16_000
PART_RETRIES = 2
# 구간 경계를 정할 때, 목표 지점 앞 이 범위 안에서 가장 조용한 곳을 찾아 자른다 (말 중간에서 자르지 않도록)
BOUNDARY_SEARCH_SEC = 20
FRAME_SEC = 0.1


class TranscribeError(Exception):
    """사용자에게 그대로 보여 줄 수 있는 변환 오류"""


def ffmpeg_exe() -> str | None:
    """시스템 ffmpeg가 있으면 쓰고, 없으면 imageio-ffmpeg에 포함된 실행 파일을 쓴다."""
    if found := shutil.which("ffmpeg"):
        return found
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001  어떤 이유로든 못 찾으면 '없음' (상태 확인·오류 안내에 쓰임)
        return None


def convert_to_wav(src: Path, dst: Path) -> None:
    exe = ffmpeg_exe()
    if exe is None:
        raise TranscribeError("ffmpeg를 찾을 수 없습니다. 백엔드 의존성을 다시 설치해 주세요 (uv sync).")
    tmp = dst.with_suffix(".tmp.wav")
    proc = subprocess.run(
        [exe, "-nostdin", "-y", "-i", str(src), "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s16le", str(tmp)],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        tail = "\n".join(proc.stderr.strip().splitlines()[-3:])
        log.error("ffmpeg 변환 실패: %s", proc.stderr)
        raise TranscribeError(f"오디오 파일을 읽을 수 없습니다. 손상되었거나 지원하지 않는 형식일 수 있습니다. ({tail})")
    tmp.replace(dst)


def plan_boundaries(wav: wave.Wave_read, part_frames: int) -> list[int]:
    """구간 시작 프레임 목록 [0, b1, b2, …, 끝]. 각 경계는 목표 지점 직전의 가장 조용한 0.1초."""
    total = wav.getnframes()
    bounds = [0]
    frame = int(FRAME_SEC * SAMPLE_RATE)
    window = BOUNDARY_SEARCH_SEC * SAMPLE_RATE
    while total - bounds[-1] > part_frames:
        target = bounds[-1] + part_frames
        lo = max(bounds[-1] + part_frames // 2, target - window)
        wav.setpos(lo)
        samples = np.frombuffer(wav.readframes(target - lo), dtype=np.int16).astype(np.float32)
        n = len(samples) // frame
        if n == 0:
            bounds.append(target)
            continue
        energy = np.sqrt((samples[: n * frame].reshape(n, frame) ** 2).mean(axis=1))
        bounds.append(lo + int(np.argmin(energy)) * frame)
    bounds.append(total)
    return bounds


def _clock(sec: float) -> str:
    s = int(sec)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def write_transcript(settings: Settings, job_id: str, segments: list[dict], *, timed: bool, edited_at: str | None = None) -> None:
    """원문 JSON + TXT 저장 (저장소). 음성은 TXT에 [시:분:초]를 붙이고, 사진은 글만 쓴다"""
    json_key, txt_key = transcript_keys(job_id)
    text = "\n".join(s["text"] for s in segments)
    data: dict = {"jobId": job_id, "text": text, "segments": segments}
    if edited_at:
        data["editedAt"] = edited_at
    files = get_store()
    put_json(files, json_key, data)
    lines = [f"[{_clock(s['start'])}] {s['text']}" for s in segments] if timed else [s["text"] for s in segments]
    put_text(files, txt_key, "\n".join(lines) + "\n", TEXT)


def _read_image(job_id: str, stored_name: str, store: JobStore, settings: Settings) -> None:
    """화이트보드 사진: 글자 인식 결과를 음성 원문과 같은 형식으로 저장"""
    try:
        store.update(job_id, status=JobStatus.TRANSCRIBING, progress=0, stage="사진에서 글자 읽는 중", error_message=None)
        with get_store().local_copy(upload_key(stored_name)) as photo:
            segments = read_text(photo)
        write_transcript(settings, job_id, segments, timed=False)
        store.update(job_id, status=JobStatus.COMPLETED, progress=None, stage="글자 읽기 완료", transcript_ready=True)
        log.info("사진 글자 읽기 완료: %s (%d줄)", job_id, len(segments))
    except OcrError as e:
        store.update(job_id, status=JobStatus.FAILED, progress=None, stage=None, error_message=str(e))
    except Exception:
        log.exception("사진 글자 읽기 중 오류: %s", job_id)
        store.update(job_id, status=JobStatus.FAILED, progress=None, stage=None, error_message="사진에서 글자를 읽는 중 오류가 발생했습니다. 다시 시도해 주세요.")


def transcribe_job(job_id: str, store: JobStore, settings: Settings) -> None:
    job = store.get(job_id)
    if job is None:
        return

    files = get_store()
    if files.exists(transcript_keys(job_id)[0]):  # 완료된 결과 재사용
        store.update(job_id, status=JobStatus.COMPLETED, progress=None, stage="변환 완료", transcript_ready=True, error_message=None)
        return

    if job.source == "image":
        return _read_image(job_id, job.stored_name, store, settings)
    if not enabled(settings):
        store.update(job_id, status=JobStatus.FAILED, progress=None, stage=None, error_message=DISABLED_MESSAGE)
        return

    work = settings.work_dir / job_id
    work.mkdir(parents=True, exist_ok=True)
    wav_path = work / "audio.wav"

    try:
        store.update(job_id, status=JobStatus.TRANSCRIBING, progress=0, stage="오디오 준비 중", error_message=None)
        if not wav_path.is_file():
            try:
                with files.local_copy(upload_key(job.stored_name)) as original:
                    convert_to_wav(original, wav_path)
            except FileNotFoundError:
                raise TranscribeError("원본 파일이 없습니다. 다시 올려 주세요.") from None

        with wave.open(str(wav_path), "rb") as wav:
            total_frames = wav.getnframes()
            duration = total_frames / SAMPLE_RATE
            if total_frames == 0:
                raise TranscribeError("녹음에 소리가 없습니다. 파일을 확인해 주세요.")

            # 경계는 처음 한 번 정해 저장한다. 이어서 변환할 때 같은 경계를 써야 구간 결과가 맞물린다.
            plan_path = work / "plan.json"
            if plan_path.is_file():
                bounds = json.loads(plan_path.read_text(encoding="utf-8"))
            else:
                bounds = plan_boundaries(wav, settings.segment_minutes * 60 * SAMPLE_RATE)
                write_json_atomic(plan_path, bounds)
            n_parts = len(bounds) - 1
            store.update(job_id, duration_sec=round(duration, 1))

            engine = None
            for i in range(n_parts):
                part_path = work / f"part_{i:03d}.json"
                if part_path.is_file():
                    continue
                if engine is None:
                    engine = get_engine(settings)
                    if engine.loading_stage:
                        store.update(job_id, stage=engine.loading_stage, progress=round(i / n_parts * 100))
                    engine.prepare()

                store.update(job_id, stage=f"구간 {i + 1}/{n_parts} 변환 중", progress=round(i / n_parts * 100))
                wav.setpos(bounds[i])
                pcm = wav.readframes(bounds[i + 1] - bounds[i])
                audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
                offset = bounds[i] / SAMPLE_RATE

                for attempt in range(1, PART_RETRIES + 1):
                    try:
                        found = engine.transcribe(audio, settings.whisper_language)
                        break
                    except Exception:
                        log.exception("구간 %d 변환 실패 (시도 %d/%d)", i, attempt, PART_RETRIES)
                        if attempt == PART_RETRIES:
                            raise TranscribeError(f"구간 {i + 1}/{n_parts}을 변환하지 못했습니다. 다시 시도하면 이 구간부터 이어서 변환합니다.")

                segments = [{"start": round(seg["start"] + offset, 2), "end": round(seg["end"] + offset, 2), "text": seg["text"]} for seg in found]
                write_json_atomic(part_path, segments)
                store.update(job_id, progress=round((i + 1) / n_parts * 100))

        # 구간 결과 합치기
        segments = []
        for i in range(n_parts):
            segments.extend(json.loads((work / f"part_{i:03d}.json").read_text(encoding="utf-8")))
        write_transcript(settings, job_id, segments, timed=True)
        shutil.rmtree(work, ignore_errors=True)

        store.update(job_id, status=JobStatus.COMPLETED, progress=None, stage="변환 완료", transcript_ready=True)
        log.info("변환 완료: %s (%.0f초, %d개 문장)", job_id, duration, len(segments))

    except TranscribeError as e:
        store.update(job_id, status=JobStatus.FAILED, progress=None, stage=None, error_message=str(e))
    except Exception:
        log.exception("변환 중 예상하지 못한 오류: %s", job_id)
        store.update(
            job_id,
            status=JobStatus.FAILED,
            progress=None,
            stage=None,
            error_message="변환 중 오류가 발생했습니다. 다시 시도하면 완료된 구간부터 이어서 변환합니다.",
        )
