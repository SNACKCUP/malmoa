"""저장소 오류. 응답과 로그에는 키·비밀값·업체 원문 메시지를 넣지 않습니다."""

from app.core.exceptions import AppError


class StorageError(AppError):
    status_code = 502


class StorageNotConfiguredError(StorageError):
    status_code = 503


class StorageObjectNotFoundError(StorageError):
    status_code = 404


def not_configured() -> StorageNotConfiguredError:
    return StorageNotConfiguredError(
        "STORAGE_NOT_CONFIGURED", "파일 저장 기능이 설정되지 않았습니다. 관리자에게 문의해 주세요."
    )


def unavailable() -> StorageError:
    return StorageError("STORAGE_UNAVAILABLE", "파일 저장소에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요.")


def not_found() -> StorageObjectNotFoundError:
    return StorageObjectNotFoundError("STORAGE_OBJECT_NOT_FOUND", "파일을 찾을 수 없습니다.")
