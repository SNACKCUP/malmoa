"""AI 회의록 연결 설정 — 설정 화면에서 제공자·API 키·모델을 고른다

- 키는 암호화해 DB(llm_settings)에 저장하고, 응답에는 앞뒤 몇 글자(keyHint)만 돌려준다.
- 저장한 설정이 없으면 backend/.env 값을 쓴다. 삭제하면 다시 .env로 돌아간다.
- 키 확인은 모델 목록 조회로만 한다 (토큰을 쓰지 않아 비용이 들지 않음).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.features.malmoa.db import get_db
from app.features.malmoa.deps import CurrentUser
from app.features.malmoa.models import LlmSetting
from app.features.malmoa.schemas.jobs import ErrorResponse
from app.features.malmoa.schemas.llm import (
    LlmCheckIn,
    LlmCheckOut,
    LlmProviderInfo,
    LlmSettingsIn,
    LlmSettingsOut,
    clean_key,
    clean_url,
)
from app.features.malmoa.services import llm

router = APIRouter(prefix="/settings/llm", tags=["settings"])

DB = Annotated[Session, Depends(get_db)]
ERRORS = {400: {"model": ErrorResponse}, 401: {"model": ErrorResponse}}

PROVIDER_INFO = [
    LlmProviderInfo(id=pid, label=p.label, needs_key=p.needs_key, key_page=p.key_page, suggested_model=p.suggested_model)  # type: ignore[arg-type]
    for pid, p in llm.PROVIDERS.items()
]


def _out(db: Session, user: CurrentUser) -> LlmSettingsOut:
    cfg = llm.resolve(db, user.id)
    row = db.get(LlmSetting, user.id)
    hint = row.key_hint if row else (llm.key_hint(cfg.api_key) if cfg.api_key else None)
    return LlmSettingsOut(
        provider=cfg.provider,  # type: ignore[arg-type]
        model=cfg.model,
        base_url=cfg.base_url,
        has_key=bool(cfg.api_key) or cfg.key_unreadable,
        key_hint=hint,
        source=cfg.source,  # type: ignore[arg-type]
        label=cfg.label,
        problem=cfg.problem(),
        providers=PROVIDER_INFO,
    )


def _clean(body: LlmCheckIn) -> tuple[str | None, str | None]:
    try:
        key, url = clean_key(body.api_key), clean_url(body.base_url)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if body.provider == "compatible" and not url:
        raise HTTPException(400, "OpenAI 호환 제공자는 주소가 필요합니다. 예: http://localhost:11434/v1 (Ollama)")
    return key, url if body.provider == "compatible" else None


def _saved_key(db: Session, user: CurrentUser, provider: str) -> str:
    """같은 제공자로 저장해 둔 키 (다른 제공자 키를 잘못 보내지 않도록 제공자가 같을 때만)"""
    cfg = llm.resolve(db, user.id)
    return cfg.api_key if cfg.provider == provider else ""


@router.get("", response_model=LlmSettingsOut, responses=ERRORS)
def get_llm_settings(db: DB, user: CurrentUser) -> LlmSettingsOut:
    """현재 AI 회의록 연결 (키 원문은 돌려주지 않음)"""
    return _out(db, user)


@router.put("", response_model=LlmSettingsOut, responses=ERRORS)
def save_llm_settings(body: LlmSettingsIn, db: DB, user: CurrentUser) -> LlmSettingsOut:
    """저장. apiKey를 비우면 같은 제공자로 저장된 키(화면 설정 → 없으면 .env)를 그대로 쓴다"""
    key, url = _clean(body)
    model = body.model.strip()
    if not model:
        raise HTTPException(400, "모델을 골라 주세요.")
    row = db.get(LlmSetting, user.id)
    keep_old = key is None and row is not None and row.provider == body.provider and row.api_key_enc
    if key is None and not keep_old:
        # 화면 설정이 아직 없으면 .env 키(같은 제공자일 때)를 암호화해 옮겨 저장한다
        key = _saved_key(db, user, body.provider) or None
    if key is None and not keep_old and llm.PROVIDERS[body.provider].needs_key:
        raise HTTPException(400, f"{llm.PROVIDERS[body.provider].label} API 키를 입력해 주세요.")
    try:
        enc = llm.encrypt_key(key) if key else None
    except llm.LlmError as e:
        raise HTTPException(400, str(e))
    if row is None:
        row = LlmSetting(user_id=user.id)
        db.add(row)
    row.provider, row.model, row.base_url = body.provider, model, url
    if not keep_old:
        row.api_key_enc, row.key_hint = enc, (llm.key_hint(key) if key else None)
    db.commit()
    return _out(db, user)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT, responses=ERRORS)
def delete_llm_settings(db: DB, user: CurrentUser) -> Response:
    """화면 설정(저장한 키 포함)을 지운다 → backend/.env 값을 쓴다"""
    row = db.get(LlmSetting, user.id)
    if row is not None:
        db.delete(row)
        db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/check", response_model=LlmCheckOut, responses=ERRORS)
def check_llm(body: LlmCheckIn, db: DB, user: CurrentUser) -> LlmCheckOut:
    """키 확인 겸 모델 목록 (비용 없음). apiKey를 비우면 저장된 키로 확인한다"""
    key, url = _clean(body)
    key = key or _saved_key(db, user, body.provider)
    if not key and llm.PROVIDERS[body.provider].needs_key:
        raise HTTPException(400, f"{llm.PROVIDERS[body.provider].label} API 키를 입력해 주세요.")
    cfg = llm.LlmConfig(provider=body.provider, model="", api_key=key, base_url=url, source="screen")
    try:
        models = llm.list_models(cfg)
    except llm.LlmError as e:
        raise HTTPException(400, str(e))
    return LlmCheckOut(
        models=models,
        message=f"연결됨 · 모델 {len(models)}개. 키 확인은 무료이며, 계정 잔액(크레딧) 부족은 실제 회의록을 만들 때 알 수 있습니다.",
    )
