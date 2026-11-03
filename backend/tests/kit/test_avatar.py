"""프로필 이미지 올리기·삭제 (저장소는 메모리로 바꿔 끼움)"""

import io
from datetime import UTC, datetime, timedelta

from PIL import Image

from app.core.config import settings
from app.users import avatar
from app.users.purge import purge


def _image(fmt: str, size=(800, 600), *, exif: bool = False) -> bytes:
    out = io.BytesIO()
    image = Image.new("RGB", size, (200, 120, 40))
    kwargs = {}
    if exif:
        data = Image.Exif()
        data[0x8825] = {2: (37.0, 30.0, 0.0)}  # GPS 위도
        data[0x010F] = "PhoneMaker"
        kwargs["exif"] = data
    image.save(out, format=fmt, **kwargs)
    return out.getvalue()


def _upload(client, headers, data: bytes, filename="me.png", content_type="image/png"):
    return client.post(
        "/api/users/me/avatar", files={"file": (filename, data, content_type)}, headers=headers
    )


def test_upload_converts_to_small_webp_and_sets_url(client, make_user, login, storage):
    make_user("user01")
    headers = login("user01")
    response = _upload(client, headers, _image("PNG"))
    assert response.status_code == 200, response.text
    url = response.json()["avatar_url"]
    key = url.removeprefix(storage.base_url + "/")
    assert key.startswith("avatars/") and key.endswith(".webp")
    data, content_type = storage.objects[key]
    assert content_type == "image/webp"
    with Image.open(io.BytesIO(data)) as saved:
        assert saved.format == "WEBP" and max(saved.size) == avatar.MAX_SIDE
    assert client.get("/api/users/me", headers=headers).json()["avatar_url"] == url


def test_jpeg_location_data_is_removed(client, make_user, login, storage):
    make_user("user01")
    original = _image("JPEG", exif=True)
    with Image.open(io.BytesIO(original)) as check:
        assert check.getexif()  # 원본에는 EXIF 가 있음
    _upload(client, login("user01"), original, "photo.jpg", "image/jpeg")
    (data, _), = storage.objects.values()
    with Image.open(io.BytesIO(data)) as saved:
        assert not saved.getexif()
        assert "exif" not in saved.info


def test_replace_deletes_old_file_and_delete_clears(client, make_user, login, storage):
    make_user("user01")
    headers = login("user01")
    first = _upload(client, headers, _image("PNG")).json()["avatar_url"]
    second = _upload(client, headers, _image("WEBP"), "a.webp", "image/webp").json()["avatar_url"]
    assert first != second
    assert list(storage.objects) == [second.removeprefix(storage.base_url + "/")]

    response = client.delete("/api/users/me/avatar", headers=headers)
    assert response.status_code == 200
    assert response.json()["avatar_url"] is None
    assert storage.objects == {}


def test_rejects_large_fake_and_broken_files(client, make_user, login, storage):
    make_user("user01")
    headers = login("user01")

    too_big = _upload(client, headers, b"\x89PNG\r\n\x1a\n" + b"0" * avatar.MAX_BYTES)
    assert (too_big.status_code, too_big.json()["code"]) == (413, "IMAGE_TOO_LARGE")

    # 확장자·Content-Type 은 이미지라고 해도 내용이 아니면 거절
    fake = _upload(client, headers, b"<script>alert(1)</script>", "x.png", "image/png")
    assert (fake.status_code, fake.json()["code"]) == (415, "UNSUPPORTED_IMAGE_TYPE")

    gif = io.BytesIO()
    Image.new("RGB", (10, 10)).save(gif, format="GIF")
    assert _upload(client, headers, gif.getvalue(), "a.gif", "image/gif").status_code == 415

    broken = _upload(client, headers, _image("PNG")[:200])
    assert (broken.status_code, broken.json()["code"]) == (422, "INVALID_IMAGE")
    assert storage.objects == {}


def test_requires_login(client, storage):
    assert _upload(client, {}, _image("PNG")).status_code == 401
    assert client.delete("/api/users/me/avatar").status_code == 401


def test_storage_not_configured_returns_503(client, make_user, login):
    make_user("user01")
    response = _upload(client, login("user01"), _image("PNG"))
    assert (response.status_code, response.json()["code"]) == (503, "STORAGE_NOT_CONFIGURED")


def test_purge_deletes_avatar_file(client, db, make_user, login, storage):
    user = make_user("user01")
    _upload(client, login("user01"), _image("PNG"))
    assert storage.objects
    user.is_active = False
    user.deactivated_at = datetime.now(UTC) - timedelta(days=settings.account_retention_days + 1)
    db.commit()

    assert purge(db) == 1
    db.refresh(user)
    assert (user.avatar_url, user.avatar_key) == (None, None)
    assert storage.objects == {}
