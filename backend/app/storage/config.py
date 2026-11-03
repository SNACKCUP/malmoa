"""저장소 설정. storage 모듈이 직접 읽습니다 (다른 공통 모듈은 이 설정을 모름)."""

from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.config import settings as core_settings


class StorageSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # s3 | memory | 빈 값. memory 는 프로세스 메모리에만 두는 테스트용 (운영에서는 시작을 막음)
    storage_backend: str = ""
    storage_bucket: str = "meerkit-public"  # 공개 읽기 버킷 (누구나 주소로 열 수 있는 파일만)
    # 비공개 버킷 (고객 문서 원본 등). 공개 주소 없음, 서버가 권한을 확인하고 읽어서 내려줌
    storage_private_bucket: str = "meerkit-private"
    # S3 호환 API 주소. Supabase 로컬: http://127.0.0.1:54321/storage/v1/s3
    storage_s3_endpoint_url: str = ""
    storage_s3_region: str = "local"  # Supabase 로컬은 local, 운영은 대시보드에 나온 리전
    storage_s3_access_key_id: str = ""
    storage_s3_secret_access_key: str = ""
    # 공개 파일 주소의 앞부분 (뒤에 파일 key 가 붙음).
    # Supabase 로컬: http://127.0.0.1:54321/storage/v1/object/public/meerkit-public
    storage_public_base_url: str = ""
    storage_timeout_seconds: int = 10


storage_settings = StorageSettings()


def production_problems() -> list[str]:
    """APP_ENV=production 에서 저장소 쪽 위험한 설정. main.py 가 다른 검사와 합쳐 시작 전에 확인합니다.

    비어 있는 것은 막지 않습니다: 서버는 뜨고 저장 기능만 503(STORAGE_NOT_CONFIGURED)으로 응답합니다.
    """
    if core_settings.app_env != "production":
        return []
    problems = []
    backend = storage_settings.storage_backend
    if backend == "memory":
        problems.append("STORAGE_BACKEND: 운영에서는 memory 를 쓸 수 없습니다 (재시작하면 파일이 사라짐). s3 로 설정하세요")
    if backend == "s3" and any(h in storage_settings.storage_public_base_url for h in ("localhost", "127.0.0.1")):
        problems.append("STORAGE_PUBLIC_BASE_URL: 운영 저장소의 공개 주소로 바꾸세요 (localhost 제외)")
    if backend == "s3" and storage_settings.storage_private_bucket == storage_settings.storage_bucket:
        problems.append("STORAGE_PRIVATE_BUCKET: 공개 버킷과 다른 비공개 버킷을 쓰세요 (고객 파일이 공개 주소로 열림)")
    return problems
