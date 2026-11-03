"""파일 저장소 — 업로드 원본·변환 원문·회의록을 로컬 폴더 또는 S3 호환 저장소에 둔다 (설정 MALMOA_FILES_BACKEND)

    local (기본): backend/storage/<key>  — 예전과 같은 폴더 배치 (uploads/·transcripts/·minutes/)
    s3          : 비공개 버킷 STORAGE_PRIVATE_BUCKET 하나 (Supabase Storage·AWS S3·R2 등)

meerkit 의 app/storage(공개/비공개 버킷 분리)를 참고했다. 말모아 파일은 회의 녹음·원문·회의록이라 모두 개인정보이므로
**비공개 버킷만 쓴다.** 공개 주소·미리 서명된 주소는 만들지 않고, 파일은 로그인 확인을 거쳐 말모아 백엔드가 전달한다.
키에는 원래 파일 이름을 넣지 않는다 (작업 ID만).

변환 임시 폴더(work/)는 여기에 두지 않는다. ffmpeg·Whisper 는 진짜 파일이 필요하고, 구간 저장·이어서 하기는
변환하는 컴퓨터 안에서만 의미가 있어서 항상 로컬(settings.work_dir)이다.
"""

import json
import logging
import os
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from app.features.malmoa.config import Settings, get_settings

log = logging.getLogger(__name__)

TEXT = "text/plain; charset=utf-8"
JSON = "application/json; charset=utf-8"
MARKDOWN = "text/markdown; charset=utf-8"


# ── 키 (저장 위치 이름) ──

def upload_key(stored_name: str) -> str:
    return f"uploads/{stored_name}"


def transcript_keys(job_id: str) -> tuple[str, str]:
    """변환 원문 (JSON 세그먼트, TXT)"""
    return f"transcripts/{job_id}.json", f"transcripts/{job_id}.txt"


def minutes_keys(job_id: str) -> tuple[str, str]:
    """회의록 (JSON 메타, Markdown 본문)"""
    return f"minutes/{job_id}.json", f"minutes/{job_id}.md"


def minutes_notes_prefix(job_id: str) -> str:
    """회의록 구간 메모 (긴 원문을 나눠 정리한 중간 결과). 실패해도 그 구간부터 잇기 위해 저장소에 둔다 — 서버 디스크는 재시작하면 지워진다.
    minutes/{job_id}. 아래라 작업 삭제 범위(job_prefixes)에 포함된다"""
    return f"minutes/{job_id}.notes/"


def minutes_note_key(job_id: str, index: int) -> str:
    return f"{minutes_notes_prefix(job_id)}chunk_{index:03d}.json"


def job_prefixes(job_id: str) -> tuple[str, ...]:
    """작업 하나에 딸린 원문·회의록 키의 접두사 (삭제 범위). 원본은 upload_key 로 따로"""
    return f"transcripts/{job_id}.", f"minutes/{job_id}."


class StorageError(Exception):
    """저장소에 닿지 못함 (설정·네트워크·권한). 사용자에게는 일반 오류로 보인다"""


class FileStore(Protocol):
    kind: str

    def put_bytes(self, key: str, data: bytes, content_type: str) -> None: ...
    def put_file(self, key: str, path: Path, content_type: str) -> None:
        """로컬 파일을 올린다 (큰 업로드). 올린 뒤 원래 파일은 없어진다"""
        ...
    def get_bytes(self, key: str) -> bytes:
        """없으면 FileNotFoundError"""
        ...
    def exists(self, key: str) -> bool: ...
    def delete(self, key: str) -> None:
        """없어도 오류 아님"""
        ...
    def list(self, prefix: str) -> list[str]: ...
    def local_copy(self, key: str):
        """with store.local_copy(key) as path: … — ffmpeg·글자 인식처럼 진짜 파일이 필요할 때. 없으면 FileNotFoundError"""
        ...
    def iter_bytes(self, key: str) -> Iterator[bytes]:
        """다운로드 응답용 (큰 파일을 메모리에 다 올리지 않는다). 없으면 FileNotFoundError"""
        ...
    def check(self) -> None:
        """시작할 때 확인. 쓸 수 없으면 RuntimeError(이유)"""
        ...


# ── 공통 도우미 ──

def get_text(store: FileStore, key: str) -> str:
    return store.get_bytes(key).decode("utf-8")


def get_json(store: FileStore, key: str):
    return json.loads(get_text(store, key))


def put_text(store: FileStore, key: str, text: str, content_type: str = TEXT) -> None:
    store.put_bytes(key, text.encode("utf-8"), content_type)


def put_json(store: FileStore, key: str, data: object) -> None:
    store.put_bytes(key, json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"), JSON)


def delete_prefix(store: FileStore, prefix: str) -> int:
    keys = store.list(prefix)
    for key in keys:
        store.delete(key)
    return len(keys)


# ── 로컬 폴더 ──

class LocalStore:
    kind = "local"

    def __init__(self, root: Path):
        self.root = root.resolve()

    def path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if not p.is_relative_to(self.root) or p == self.root:
            raise ValueError(f"저장소 밖을 가리키는 키입니다: {key!r}")
        return p

    def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        p = self.path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(p.name + ".tmp")  # 중간에 끊겨도 파일이 깨지지 않게 바꿔치기
        tmp.write_bytes(data)
        os.replace(tmp, p)

    def put_file(self, key: str, path: Path, content_type: str) -> None:
        p = self.path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(path, p)

    def get_bytes(self, key: str) -> bytes:
        return self.path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self.path(key).is_file()

    def delete(self, key: str) -> None:
        self.path(key).unlink(missing_ok=True)

    def list(self, prefix: str) -> list[str]:
        folder, _, start = prefix.rpartition("/")
        d = self.path(folder) if folder else self.root
        if not d.is_dir():
            return []
        return sorted(f"{folder}/{p.name}" if folder else p.name for p in d.iterdir() if p.is_file() and p.name.startswith(start))

    @contextmanager
    def local_copy(self, key: str):
        p = self.path(key)
        if not p.is_file():
            raise FileNotFoundError(key)
        yield p

    def iter_bytes(self, key: str) -> Iterator[bytes]:
        p = self.path(key)
        f = p.open("rb")  # 없으면 여기서 FileNotFoundError (응답을 시작하기 전)

        def chunks():
            with f:
                while chunk := f.read(1024 * 1024):
                    yield chunk

        return chunks()

    def check(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)


# ── S3 호환 저장소 (비공개 버킷 하나) ──

class S3Store:
    kind = "s3"

    def __init__(self, settings: Settings):
        import boto3
        from boto3.s3.transfer import TransferConfig
        from botocore.config import Config

        missing = [
            name
            for name, value in (
                ("STORAGE_PRIVATE_BUCKET", settings.storage_private_bucket),
                ("STORAGE_S3_ENDPOINT_URL", settings.storage_s3_endpoint_url),
                ("STORAGE_S3_ACCESS_KEY_ID", settings.storage_s3_access_key_id),
                ("STORAGE_S3_SECRET_ACCESS_KEY", settings.storage_s3_secret_access_key),
            )
            if not value
        ]
        if missing:
            raise RuntimeError(f"MALMOA_FILES_BACKEND=s3 인데 backend/.env 에 {', '.join(missing)} 가 없습니다.")
        self.bucket = settings.storage_private_bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.storage_s3_endpoint_url,
            region_name=settings.storage_s3_region or None,
            aws_access_key_id=settings.storage_s3_access_key_id,
            aws_secret_access_key=settings.storage_s3_secret_access_key,
            config=Config(
                s3={"addressing_style": "path"},  # Supabase 는 버킷을 주소 경로에 둔다
                connect_timeout=10,
                read_timeout=60,
                retries={"max_attempts": 3},
            ),
        )
        # 큰 녹음은 나눠 올린다 (Supabase S3 는 조각 5MB 이상)
        self.transfer = TransferConfig(multipart_threshold=16 * 1024 * 1024, multipart_chunksize=16 * 1024 * 1024)

    def _call(self, action: str, **kwargs):
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            return getattr(self.client, action)(Bucket=self.bucket, **kwargs)
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code")
            if code in ("NoSuchKey", "404", "NotFound"):
                raise FileNotFoundError(kwargs.get("Key", "")) from e
            log.error("저장소 %s 실패 key=%s code=%s", action, kwargs.get("Key"), code)
            raise StorageError(f"저장소 {action} 실패 ({code})") from e
        except BotoCoreError as e:
            log.error("저장소 %s 실패 key=%s error=%s", action, kwargs.get("Key"), type(e).__name__)
            raise StorageError(f"저장소 {action} 실패 ({type(e).__name__})") from e

    def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        self._call("put_object", Key=key, Body=data, ContentType=content_type, CacheControl="private, no-store")

    def put_file(self, key: str, path: Path, content_type: str) -> None:
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            self.client.upload_file(
                str(path), self.bucket, key, ExtraArgs={"ContentType": content_type, "CacheControl": "private, no-store"}, Config=self.transfer
            )
        except (BotoCoreError, ClientError) as e:
            log.error("저장소 업로드 실패 key=%s error=%s", key, type(e).__name__)
            raise StorageError("저장소 업로드 실패") from e
        path.unlink(missing_ok=True)

    def get_bytes(self, key: str) -> bytes:
        body = self._call("get_object", Key=key)["Body"]
        try:
            return body.read()
        finally:
            body.close()

    def exists(self, key: str) -> bool:
        try:
            self._call("head_object", Key=key)
            return True
        except FileNotFoundError:
            return False

    def delete(self, key: str) -> None:
        self._call("delete_object", Key=key)

    def list(self, prefix: str) -> list[str]:
        keys: list[str] = []
        token = None
        while True:
            page = self._call("list_objects_v2", Prefix=prefix, **({"ContinuationToken": token} if token else {}))
            keys += [o["Key"] for o in page.get("Contents", [])]
            if not page.get("IsTruncated"):
                return sorted(keys)
            token = page["NextContinuationToken"]

    @contextmanager
    def local_copy(self, key: str):
        from botocore.exceptions import BotoCoreError, ClientError

        if not self.exists(key):
            raise FileNotFoundError(key)
        fd, name = tempfile.mkstemp(prefix="malmoa-", suffix=Path(key).suffix, dir=get_settings().work_dir)
        os.close(fd)
        tmp = Path(name)
        try:
            try:
                self.client.download_file(self.bucket, key, str(tmp), Config=self.transfer)
            except (BotoCoreError, ClientError) as e:
                raise StorageError("저장소에서 파일을 내려받지 못했습니다") from e
            yield tmp
        finally:
            tmp.unlink(missing_ok=True)

    def iter_bytes(self, key: str) -> Iterator[bytes]:
        body = self._call("get_object", Key=key)["Body"]

        def chunks():
            try:
                yield from body.iter_chunks(1024 * 1024)
            finally:
                body.close()

        return chunks()

    def check(self) -> None:
        try:
            self._call("head_bucket")
        except (StorageError, FileNotFoundError) as e:
            raise RuntimeError(
                f"S3 저장소의 비공개 버킷 '{self.bucket}' 에 접속할 수 없습니다. 버킷이 있는지, "
                "STORAGE_S3_ENDPOINT_URL·키가 맞는지 확인하세요. (버킷은 비공개로 미리 만들어 둔다)"
            ) from e


@lru_cache(maxsize=4)
def _store(backend: str, root: str) -> FileStore:
    settings = get_settings()
    return S3Store(settings) if backend == "s3" else LocalStore(Path(root))


def get_store() -> FileStore:
    """설정(MALMOA_FILES_BACKEND)에 맞는 저장소"""
    settings = get_settings()
    return _store(settings.storage_backend, str(settings.storage_dir))
