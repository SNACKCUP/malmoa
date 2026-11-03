"""프로필 이미지 검사·변환. 파일은 app.storage 에 두고, users 테이블에는 주소(avatar_url)와 key 만 둡니다.

- 2MB 넘으면 413, 내용이 JPG·PNG·WEBP 가 아니면 415, 열리지 않으면 422 (확장자·Content-Type 은 믿지 않음)
- 다시 그려서 저장: 사진 속 위치정보(EXIF) 등 메타데이터가 빠지고, 긴 변을 512px 로 줄여 WEBP 로 통일
"""

import io
import secrets

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.exceptions import AppError, ValidationError

MAX_BYTES = 2 * 1024 * 1024  # 프론트 안내와 같은 값 (2MB)
MAX_SIDE = 512
MAX_PIXELS = 40_000_000  # 압축 폭탄(작은 파일이 거대한 이미지로 풀리는 것) 방지
KEY_PREFIX = "avatars/"
CONTENT_TYPE = "image/webp"


class ImageTooLargeError(AppError):
    status_code = 413


class UnsupportedImageTypeError(AppError):
    status_code = 415


def _sniff(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "JPEG"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "PNG"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "WEBP"
    return None


def process(data: bytes) -> bytes:
    """올린 이미지를 검사하고 저장할 WEBP 바이트를 돌려줍니다."""
    if len(data) > MAX_BYTES:
        raise ImageTooLargeError("IMAGE_TOO_LARGE", "이미지는 2MB 이하로 올려 주세요.")
    kind = _sniff(data)
    if kind is None:
        raise UnsupportedImageTypeError("UNSUPPORTED_IMAGE_TYPE", "JPG, PNG, WEBP 이미지만 올릴 수 있습니다.")
    invalid = ValidationError("INVALID_IMAGE", "이미지를 읽을 수 없습니다. 다른 파일로 다시 시도해 주세요.")
    try:
        with Image.open(io.BytesIO(data)) as probe:
            if probe.format != kind or probe.width * probe.height > MAX_PIXELS:
                raise invalid
            probe.verify()  # 잘린 파일·깨진 데이터 확인 (verify 뒤에는 다시 열어야 함)
        with Image.open(io.BytesIO(data)) as image:
            image = ImageOps.exif_transpose(image)  # 휴대폰 사진의 회전 정보를 실제 방향으로 반영
            image.thumbnail((MAX_SIDE, MAX_SIDE))
            if image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGBA" if "A" in image.getbands() or "transparency" in image.info else "RGB")
            out = io.BytesIO()
            image.save(out, format="WEBP", quality=85)  # 새로 그린 이미지라 EXIF 등 메타데이터가 붙지 않음
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as e:
        raise invalid from e
    return out.getvalue()


def new_key() -> str:
    """추측할 수 없는 파일 key. 회원 번호를 넣지 않아 주소로 다른 회원을 훑어볼 수 없습니다."""
    return f"{KEY_PREFIX}{secrets.token_urlsafe(24)}.webp"
