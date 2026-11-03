"""로그인한 본인의 회원 API: /api/users/me (내 정보 조회·수정, 프로필 이미지, 탈퇴, 비밀번호 변경)

/users/{user_id} 보다 먼저 등록해야 "me"가 id로 해석되지 않습니다 (app/api.py).
"""

from fastapi import APIRouter, Depends, File, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.auth import router as auth_router
from app.auth import service as auth_service
from app.auth.deps import get_current_user
from app.auth.schemas import ChangePasswordRequest
from app.core.config import settings
from app.core.database import get_db
from app.users import avatar, service
from app.users.models import User
from app.users.schemas import ProfileUpdate, UserRead, WithdrawRequest

router = APIRouter(prefix="/users/me", tags=["users (me)"])


@router.get("", response_model=UserRead, summary="내 정보")
def get_me(user: User = Depends(get_current_user)):
    return user


@router.patch("", response_model=UserRead, summary="내 정보 수정 (보낸 항목만)")
def update_me(
    body: ProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    changes = body.model_dump(exclude_unset=True, exclude={"email_verification_token"})
    for required in ("name", "email"):
        if required in changes and changes[required] is None:
            del changes[required]  # 이름·이메일은 지울 수 없음
    email_verified = False
    new_email = changes.get("email")
    email_changed = bool(new_email) and new_email.strip().lower() != user.email
    if email_changed and (
        settings.signup_email_verification_required or body.email_verification_token
    ):
        auth_service.consume_email_verification(db, body.email_verification_token, new_email)
        email_verified = True
    return service.update_profile(db, user, changes, email_verified=email_verified)


@router.post(
    "/avatar",
    response_model=UserRead,
    summary="프로필 이미지 올리기 (JPG·PNG·WEBP, 2MB 이하)",
    description=(
        "multipart/form-data 의 `file` 하나를 받습니다. 서버가 파일 내용으로 형식을 다시 확인하고, "
        "위치정보(EXIF)를 지운 512px WEBP 로 바꿔 저장합니다. 이전 이미지는 지워집니다. "
        "오류: 413 IMAGE_TOO_LARGE, 415 UNSUPPORTED_IMAGE_TYPE, 422 INVALID_IMAGE, 503 STORAGE_NOT_CONFIGURED"
    ),
)
async def upload_avatar(
    file: UploadFile = File(description="이미지 파일 (JPG, PNG, WEBP · 2MB 이하)"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    data = await file.read(avatar.MAX_BYTES + 1)  # 한도보다 1바이트 더 읽어 넘었는지만 확인
    return service.set_avatar(db, user, data)


@router.delete("/avatar", response_model=UserRead, summary="프로필 이미지 삭제")
def delete_avatar(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return service.remove_avatar(db, user)


@router.delete(
    "",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="탈퇴 (계정을 막고, 보관 기간이 지나면 개인정보 삭제)",
)
def withdraw_me(
    body: WithdrawRequest,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    service.withdraw(db, user, body.password)
    response.delete_cookie(auth_router.REFRESH_COOKIE, path=auth_router.REFRESH_COOKIE_PATH)


@router.patch(
    "/password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="비밀번호 변경 (다른 기기의 로그인은 풀리고, 이 기기는 새 리프레시 쿠키를 받음)",
)
def change_password(
    body: ChangePasswordRequest,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    auth_service.change_password(db, user, body.current_password, body.new_password)
    # 지금 쓰던 액세스 토큰도 무효가 되므로, 프론트는 401을 받으면 /auth/refresh 로 새 토큰을 받습니다.
    auth_router.set_refresh_cookie(response, auth_service.issue_tokens(user)[1])
