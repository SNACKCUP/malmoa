"""파일 저장소 (STORAGE_BACKEND=local | s3) — 실제 저장 위치·키 이름, s3 모드에서 로컬에 남는 것, 삭제 범위, 설정 오류

local 테스트는 conftest 의 임시 폴더(STORAGE_DIR)에서, s3 테스트는 moto 가짜 S3 의 비공개 버킷에서 돈다.
"""

import os
import tempfile
from pathlib import Path

import boto3
import pytest

from app.features.malmoa.config import BACKEND_DIR, Settings, get_settings
from app.features.malmoa.services.file_store import (
    LocalStore,
    S3Store,
    get_store,
    minutes_keys,
    put_text,
    transcript_keys,
    upload_key,
)
from app.features.malmoa.services.transcriber import transcribe_job
from app.features.malmoa.store import JobStore
from features.malmoa.conftest import S3_TEST_BUCKET, files, local_only, s3_only
from features.malmoa.test_transcriber import fake_model, upload  # noqa: F401  (fake_model 은 fixture)


def transcribed_job(client) -> tuple[str, str]:
    """업로드 → (가짜 모델로) 변환까지 한 작업의 (작업 ID, 저장 이름)"""
    job_id = upload(client, 5)
    transcribe_job(job_id, JobStore(), get_settings())
    job = client.get(f"/api/jobs/{job_id}").json()
    assert job["status"] == "COMPLETED"
    return job_id, job["storedName"]


def bucket_keys() -> set[str]:
    s = get_settings()
    client = boto3.client(
        "s3",
        endpoint_url=s.storage_s3_endpoint_url,
        region_name=s.storage_s3_region,
        aws_access_key_id=s.storage_s3_access_key_id,
        aws_secret_access_key=s.storage_s3_secret_access_key,
    )
    return {o["Key"] for o in client.list_objects_v2(Bucket=S3_TEST_BUCKET).get("Contents", [])}


# ── 실제 저장 위치 ──


@local_only
def test_local_files_are_in_the_same_folders_as_before(client, fake_model):  # noqa: F811  fake_model 은 test_transcriber 에서 가져온 fixture
    root = get_settings().storage_dir
    assert Path(tempfile.gettempdir()).resolve() in root.resolve().parents  # 진짜 backend/storage 가 아닌 임시 폴더
    assert root.resolve() != (BACKEND_DIR / "storage").resolve()

    job_id, stored = transcribed_job(client)
    assert stored == f"{job_id}.wav"
    assert (root / "uploads" / f"{job_id}.wav").is_file()
    assert (root / "transcripts" / f"{job_id}.json").is_file()
    assert (root / "transcripts" / f"{job_id}.txt").is_file()


@s3_only
def test_s3_keys_have_job_id_only(client, fake_model):  # noqa: F811  fake_model 은 test_transcriber 에서 가져온 fixture
    job_id, _stored = transcribed_job(client)
    put_text(files(), minutes_keys(job_id)[1], "# 회의록")
    put_text(files(), minutes_keys(job_id)[0], "{}")

    mine = {k for k in bucket_keys() if job_id in k}
    assert mine == {
        f"uploads/{job_id}.wav",
        f"transcripts/{job_id}.json",
        f"transcripts/{job_id}.txt",
        f"minutes/{job_id}.md",
        f"minutes/{job_id}.json",
    }
    assert not any("회의" in k for k in bucket_keys())  # 원래 파일 이름(회의.wav)은 키에 넣지 않는다


@s3_only
def test_s3_mode_leaves_nothing_in_local_storage_folders(client, fake_model):  # noqa: F811  fake_model 은 test_transcriber 에서 가져온 fixture
    job_id, _ = transcribed_job(client)
    client.put(f"/api/jobs/{job_id}/transcript", json={"texts": ["고친 문장"]})
    put_text(files(), minutes_keys(job_id)[1], "# 회의록")
    client.put(f"/api/jobs/{job_id}/minutes", json={"markdown": "# 고친 회의록"})

    root = get_settings().storage_dir
    for folder in ("uploads", "transcripts", "minutes"):
        d = root / folder
        assert not d.exists() or not any(d.iterdir()), f"{folder}/ 에 파일이 생겼다"
    # 로컬에 남는 것은 변환 임시 폴더(work/)뿐
    assert {p.name for p in root.iterdir()} <= {"work"}


@s3_only
def test_s3_delete_removes_only_that_jobs_objects(client, fake_model):  # noqa: F811  fake_model 은 test_transcriber 에서 가져온 fixture
    a, _ = transcribed_job(client)
    b, _ = transcribed_job(client)
    before_b = {k for k in bucket_keys() if b in k}
    assert len(before_b) == 3

    assert client.delete(f"/api/jobs/{a}").status_code == 204
    keys = bucket_keys()
    assert not any(a in k for k in keys)
    assert {k for k in keys if b in k} == before_b


# ── 저장소 동작 ──


def test_store_roundtrip_and_prefix_listing():
    store = files()
    key_json, key_txt = transcript_keys("moa-roundtrip")
    put_text(store, key_json, '{"a": 1}')
    put_text(store, key_txt, "원문")
    assert store.exists(key_json)
    assert store.get_bytes(key_txt).decode() == "원문"
    assert store.list("transcripts/moa-roundtrip.") == [key_json, key_txt]
    with store.local_copy(key_txt) as path:
        assert path.read_text(encoding="utf-8") == "원문"
    assert b"".join(store.iter_bytes(key_txt)) == "원문".encode()
    store.delete(key_json)
    store.delete(key_json)  # 없는 키를 지워도 오류 아님
    assert not store.exists(key_json)
    with pytest.raises(FileNotFoundError):
        store.get_bytes(key_json)
    with pytest.raises(FileNotFoundError), store.local_copy(key_json):
        pass


@s3_only
def test_s3_large_file_is_uploaded_in_parts_and_temp_copy_is_removed():
    store = files()
    src = get_settings().work_dir / "big-upload.bin"
    src.parent.mkdir(parents=True, exist_ok=True)
    data = os.urandom(40 * 1024 * 1024)  # 분할 기준 16MB 보다 크다
    src.write_bytes(data)
    store.put_file(upload_key("moa-big.m4a"), src, "audio/mp4")
    assert not src.exists()  # 올린 뒤 임시 파일은 없어진다
    with store.local_copy(upload_key("moa-big.m4a")) as path:
        assert path.read_bytes() == data
        copied = path
    assert not copied.exists()  # 내려받은 사본도 다 쓰면 지운다
    store.delete(upload_key("moa-big.m4a"))


def test_local_store_rejects_keys_outside_root(tmp_path):
    store = LocalStore(tmp_path)
    for bad in ("../secret.txt", "uploads/../../x", "/etc/passwd"):
        with pytest.raises(ValueError):
            store.put_bytes(bad, b"x", "text/plain")


def test_s3_settings_missing_values_refuse_to_start():
    with pytest.raises(RuntimeError, match="STORAGE_PRIVATE_BUCKET"):
        S3Store(Settings(malmoa_files_backend="s3", storage_private_bucket="", storage_s3_endpoint_url="http://x", storage_s3_access_key_id="k", storage_s3_secret_access_key="s"))


@s3_only
def test_s3_missing_bucket_fails_startup_check():
    s = get_settings()
    other = Settings(**{**s.model_dump(), "storage_private_bucket": "no-such-bucket"})
    with pytest.raises(RuntimeError, match="no-such-bucket"):
        S3Store(other).check()


def test_mode_comes_from_conftest_not_env_file():
    """테스트는 .env 의 저장소 값(로컬 Supabase 등)을 쓰지 않는다: s3 모드면 moto 버킷, local 이면 임시 폴더"""
    s = get_settings()
    store = get_store()
    if s.storage_backend == "s3":
        assert s.storage_private_bucket == S3_TEST_BUCKET
        assert s.storage_s3_access_key_id == "moto-test-key"
        assert "54321" not in s.storage_s3_endpoint_url  # 로컬 Supabase 주소가 아님
        assert isinstance(store, S3Store)
    else:
        assert s.storage_s3_endpoint_url == "" and s.storage_private_bucket == ""
        assert isinstance(store, LocalStore)
