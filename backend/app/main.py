from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api import api_router
from app.auth.principal import load_principal
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.exceptions import AppError, register_exception_handlers
from app.core.logging import setup_logging
from app.core.middleware import RequestContextMiddleware
from app.llm.config import production_problems as llm_production_problems
from app.social.config import production_problems as social_production_problems
from app.storage.config import production_problems as storage_production_problems


def check_startup() -> None:
    """공통 설정(core)·LLM·저장소·소셜 로그인 설정의 운영 검사를 합쳐서, 고칠 목록이 있으면 시작을 멈춥니다."""
    problems = (
        settings.production_problems()
        + llm_production_problems()
        + storage_production_problems()
        + social_production_problems()
    )
    if problems:
        raise RuntimeError("운영 설정을 고친 뒤 다시 시작하세요.\n- " + "\n- ".join(problems))


class ServiceUnavailableError(AppError):
    status_code = 503


def create_app() -> FastAPI:
    setup_logging()
    check_startup()  # 운영(APP_ENV=production)에서 위험한 설정이면 시작하지 않음
    docs = settings.api_docs_enabled
    app = FastAPI(
        title="MeerKit",
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
        # 요청마다 현재 사용자를 채웁니다. 권한 검사(app.core.principal.require_*)는 이 값만 읽습니다.
        dependencies=[Depends(load_principal)],
    )
    register_exception_handlers(app)
    # 나중에 추가한 미들웨어가 바깥을 감쌉니다. CORS 를 가장 바깥에 두어 500 응답에도 CORS 헤더가 붙게 합니다.
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
    )

    @app.get("/health", summary="살아 있는지 (DB 확인 없음)")
    def health():
        if settings.app_commit:
            return {"status": "ok", "commit": settings.app_commit[:7]}
        return {"status": "ok"}

    @app.get("/health/ready", summary="요청을 받을 준비가 됐는지 (DB 연결까지 확인)")
    def ready():
        try:
            with SessionLocal() as db:
                db.execute(text("SELECT 1"))
        except Exception as e:
            raise ServiceUnavailableError("DB_UNAVAILABLE", "데이터베이스에 연결할 수 없습니다.") from e
        return {"status": "ok", "database": "ok"}

    app.include_router(api_router, prefix="/api")
    return app


app = create_app()
