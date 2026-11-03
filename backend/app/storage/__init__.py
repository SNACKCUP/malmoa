"""파일 저장소 공통 모듈. 서비스 코드는 아래 함수만 씁니다. (core 만 import, 다른 공통 모듈과 독립)

    from app.storage import get_storage
    storage = get_storage()
    storage.put("avatars/abc.webp", data, "image/webp")
    url = storage.public_url("avatars/abc.webp")  # 브라우저에서 바로 여는 주소
    storage.delete("avatars/abc.webp")

    from app.storage import get_private_storage
    private = get_private_storage()  # 비공개 버킷: 공개 주소 없음, 권한 확인은 부르는 쪽 서버가
    private.put("service/sources/<무작위>", data, "application/pdf")  # key 에 원래 파일 이름을 넣지 않음
    data = private.get("service/sources/<무작위>")  # 없으면 404 STORAGE_OBJECT_NOT_FOUND
    private.delete("service/sources/<무작위>")

저장 방법은 .env 의 STORAGE_BACKEND 로 고릅니다: s3(Supabase Storage·AWS S3·R2 등) / memory(테스트).
비워 두면 저장 기능만 503(STORAGE_NOT_CONFIGURED)으로 응답하고 서버는 뜹니다.
"""

from app.storage.backends import (
    PrivateStorage,
    Storage,
    get_private_storage,
    get_storage,
    override_private_storage,
    override_storage,
)

__all__ = [
    "PrivateStorage",
    "Storage",
    "get_private_storage",
    "get_storage",
    "override_private_storage",
    "override_storage",
]
