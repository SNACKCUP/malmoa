from functools import lru_cache
from pathlib import Path
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    """말모아 설정. meerkit 설정(app.core.config)과 같은 backend/.env 를 읽는다.

    DB 주소·CORS·로그인 토큰은 meerkit 이 맡는다 (DATABASE_URL, CORS_ORIGINS, JWT_SECRET_KEY 는 여기 없음).
    저장소 모드는 meerkit 의 STORAGE_BACKEND(s3|memory|빈칸)와 뜻이 달라 MALMOA_FILES_BACKEND 로 따로 받고,
    S3 접속 정보(STORAGE_S3_*, STORAGE_PRIVATE_BUCKET)는 meerkit 과 같은 값을 함께 쓴다.
    """

    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore")

    # 설정 화면에서 입력한 AI API 키를 DB에 암호화해 저장할 때 쓰는 열쇠.
    # 바꾸면 저장된 키를 풀 수 없어 화면에서 다시 입력해야 한다 (legacy 말모아와 같은 값을 써야 옮긴 키가 풀린다)
    secret_key: str = ""

    # 아래 LLM 값은 설정 화면에서 아무것도 저장하지 않았을 때 쓰는 예비 값 (화면 설정이 우선).
    # 제공자는 OPENAI_BASE_URL이 있으면 OpenAI 호환, 없으면 OpenAI. Claude·Gemini는 설정 화면에서만 고른다
    openai_api_key: str = ""
    openai_model: str = ""
    openai_base_url: str = ""  # 비우면 OpenAI 기본 주소. OpenAI 호환 서비스를 쓸 때만 지정

    # 음성 변환 방식 (services/speech_engines.py). local_whisper: 이 컴퓨터에서 Whisper 실행 /
    # none: 이 서버는 음성 변환을 하지 않음 (Whisper 를 돌릴 수 없는 배포 서버). 새 방식은 엔진과 함께 여기에 추가
    transcriber: Literal["local_whisper", "none"] = "local_whisper"
    whisper_model: str = "small"
    whisper_language: str = "ko"
    segment_minutes: int = 5

    # 회의록: 원문을 이 글자 수 이하 구간으로 나눠 요약한다 (한국어 약 1~1.5자 = 1토큰)
    minutes_chunk_chars: int = 12_000

    max_upload_mb: int = 500

    # 작업 대기열 (services/worker.py, DB jobs 테이블). 이 서버가 가져가 처리할 일 — 비우면 작업자를 띄우지 않는다.
    # 예: 배포 서버 ["minutes"], Mac 작업자 ["transcribe"]
    worker_tasks: tuple[Literal["transcribe", "minutes"], ...] = ("transcribe", "minutes")
    worker_poll_seconds: float = 3  # 다른 서버가 넣은 작업을 확인하는 간격 (같은 서버에서 넣은 작업은 바로 가져간다)
    job_stale_seconds: int = 180  # 생존 신호가 이만큼 끊긴 작업은 다시 대기열로 (서버가 꺼졌거나 멈춤)
    job_max_attempts: int = 3  # 이만큼 끊기면 실패로 표시 (작업이 서버를 죽이는 경우 무한 반복 방지)

    # 일정 알람: 30초마다 확인해 Mac 알림 센터와 화면에 알린다 (테스트에서는 끈다)
    reminders_enabled: bool = True
    mac_notifications: bool = True
    # 알림 문구의 시각을 이 시간대로 쓴다 (배포 서버는 보통 UTC 라서 서버 시간대를 쓰지 않는다)
    app_timezone: str = "Asia/Seoul"

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.app_timezone)
    # 아이폰 알림용: 일정을 내보낼 Mac 캘린더 앱의 캘린더 이름 (iCloud 아래에 직접 만들어 둔다). 켜기/끄기는 설정 화면에서
    apple_calendar_name: str = "Malmoa"
    audio_extensions: tuple[str, ...] = (".mp3", ".wav", ".m4a", ".webm", ".mp4", ".ogg")
    # 화이트보드 사진: 글자 인식(Apple Vision)으로 텍스트를 만든다
    image_extensions: tuple[str, ...] = (".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp")

    @property
    def allowed_extensions(self) -> tuple[str, ...]:
        return self.audio_extensions + self.image_extensions

    # 로컬 저장 폴더 (원본·원문·회의록, 그리고 s3 모드에서도 쓰는 변환 임시 폴더 work/). 환경 변수 MALMOA_FILES_DIR
    malmoa_files_dir: Path = BACKEND_DIR / "storage"

    # 업로드 원본·변환 원문·회의록을 둘 곳 (services/file_store.py). local: 위 폴더 / s3: S3 호환 저장소의 비공개 버킷.
    # 환경 변수 MALMOA_FILES_BACKEND. 필드 이름을 storage_backend 로 두면 meerkit 의 STORAGE_BACKEND 를 읽어 버리므로 이름을 달리했다.
    # 아래 S3 접속 정보는 meerkit app/storage 와 같은 이름·같은 값을 쓴다. 말모아는 공개 버킷을 쓰지 않는다 (녹음·원문은 개인정보)
    malmoa_files_backend: Literal["local", "s3"] = "local"

    @property
    def storage_dir(self) -> Path:
        return self.malmoa_files_dir

    @property
    def storage_backend(self) -> Literal["local", "s3"]:
        return self.malmoa_files_backend

    storage_private_bucket: str = ""
    storage_s3_endpoint_url: str = ""
    storage_s3_region: str = ""
    storage_s3_access_key_id: str = ""
    storage_s3_secret_access_key: str = ""

    @property
    def uploads_dir(self) -> Path:
        return self.storage_dir / "uploads"

    @property
    def jobs_dir(self) -> Path:
        return self.storage_dir / "jobs"

    @property
    def transcripts_dir(self) -> Path:
        return self.storage_dir / "transcripts"

    @property
    def minutes_dir(self) -> Path:
        return self.storage_dir / "minutes"

    @property
    def work_dir(self) -> Path:
        """변환 중 임시 파일 (16kHz WAV, 구간별 결과). 완료 후 정리한다."""
        return self.storage_dir / "work"


@lru_cache
def get_settings() -> Settings:
    return Settings()
