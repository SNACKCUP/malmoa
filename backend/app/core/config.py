from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/.env.example 의 예시 값. 운영에서 이 값 그대로면 시작을 막습니다.
EXAMPLE_JWT_SECRET_KEY = "change-me-to-a-random-string-of-32-bytes-or-more"
_LOCAL_HOSTS = ("localhost", "127.0.0.1")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "local"
    log_level: str = "INFO"
    log_format: str = ""  # json | text. 비우면 APP_ENV=local 은 text, 그 밖은 json
    database_url: str
    test_database_url: str = ""  # pytest 전용 DB 주소, 비우면 DATABASE_URL 사용
    jwt_secret_key: str
    jwt_expire_minutes: int = 30  # 액세스 토큰 유효 시간(분)
    refresh_token_expire_days: int = 14  # 리프레시 토큰(httpOnly 쿠키) 유효 기간(일)
    cookie_secure: bool = False  # 배포(https)에서는 true
    api_docs_enabled: bool = True  # false면 /docs, /redoc, /openapi.json 을 숨김 (운영에서 API 목록 비공개)
    # 지금 돌고 있는 코드의 커밋. Render 는 RENDER_GIT_COMMIT 을 자동으로 넣어 줌. /health 에 보여 배포 확인에 씀
    app_commit: str = Field("", validation_alias=AliasChoices("APP_COMMIT", "RENDER_GIT_COMMIT"))
    cors_origins: str = "http://localhost:3000"  # 여러 개면 쉼표로 구분
    # 로그인 잠금: 연속 N회 실패하면 M분 잠금 (프론트 meerkit.config.ts의 login과 같은 값). 0이면 끔
    login_lock_max_attempts: int = 5
    login_lock_minutes: int = 5

    # 가입 이메일 인증: true면 인증번호 확인을 마쳐야 가입 가능 (프론트 signup.emailVerification도 true로)
    signup_email_verification_required: bool = True
    email_code_expire_minutes: int = 10
    email_code_max_attempts: int = 5
    email_verification_token_expire_minutes: int = 30  # 인증을 마친 뒤 가입을 끝내야 하는 시간

    password_reset_expire_minutes: int = 30  # 비밀번호 재설정 링크 유효 시간 (한 번만 사용)

    # 탈퇴 후 이 기간(일)이 지나면 개인정보를 지웁니다 (uv run python -m app.users.purge, 매일 실행)
    account_retention_days: int = 365
    email_verification_retention_days: int = 7  # 가입 인증번호 기록(이메일 포함) 보관 기간

    # 메일 안의 링크가 여는 프론트 주소 (예: 비밀번호 재설정 화면)
    frontend_base_url: str = "http://localhost:3000"

    # 메일 발송: console(로컬, 로그로만) / smtp(Mailpit 또는 메일 업체) / fake(테스트)
    mail_backend: str = "console"
    mail_from: str = "MeerKit <no-reply@localhost>"
    mail_smtp_host: str = "localhost"
    mail_smtp_port: int = 1025  # Mailpit 기본 포트
    mail_smtp_username: str = ""
    mail_smtp_password: str = ""
    mail_smtp_starttls: bool = False  # 587 포트 업체는 보통 true
    mail_smtp_ssl: bool = False  # 465 포트 업체는 true
    mail_smtp_timeout: int = 10  # 초
    # 같은 이메일로 보내는 인증·재설정 메일 제한
    mail_cooldown_seconds: int = 60
    mail_daily_limit: int = 10


    # 관리자 시드 계정 (uv run python -m app.users.seed). 로컬은 .env, 운영은 seed-admin 워크플로
    seed_admin_user_id: str = "admin"
    seed_admin_email: str = "admin@example.com"
    seed_admin_password: str = ""
    seed_admin_name: str = "관리자"

    @field_validator("database_url", "test_database_url")
    @classmethod
    def _use_psycopg_driver(cls, v: str) -> str:
        """Supabase 등이 주는 postgresql:// 주소를 우리 드라이버(psycopg 3) 주소로 바꿉니다."""
        for prefix in ("postgresql://", "postgres://"):
            if v.startswith(prefix):
                return "postgresql+psycopg://" + v[len(prefix):]
        return v

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip(' "\'[]') for o in self.cors_origins.split(",") if o.strip(' "\'[]')]

    def production_problems(self) -> list[str]:
        """APP_ENV=production 에서 위험한 설정 목록. 값은 넣지 않고 무엇을 고칠지만 적습니다."""
        if self.app_env != "production":
            return []
        problems = []
        if len(self.jwt_secret_key) < 32 or self.jwt_secret_key == EXAMPLE_JWT_SECRET_KEY:
            problems.append("JWT_SECRET_KEY: 32자 이상의 임의 값으로 바꾸세요 (예: openssl rand -hex 32)")
        if not self.cookie_secure:
            problems.append("COOKIE_SECURE: https 로 운영하므로 true 로 설정하세요")
        origins = self.cors_origin_list
        if not origins or any(host in o for o in origins for host in _LOCAL_HOSTS):
            problems.append("CORS_ORIGINS: 운영 프론트 주소만 넣으세요 (localhost 제외)")
        if self.mail_backend in ("console", "fake"):
            problems.append("MAIL_BACKEND: smtp 로 설정하세요 (console·fake 는 메일이 실제로 나가지 않음)")
        if any(host in self.frontend_base_url for host in _LOCAL_HOSTS):
            problems.append("FRONTEND_BASE_URL: 운영 프론트 주소로 바꾸세요 (메일 속 링크에 쓰임)")
        return problems

    def check_production(self) -> None:
        """웹 서버 시작 때 부릅니다. 운영에서 위험한 설정이면 고칠 목록을 보여 주고 시작을 멈춥니다.
        (탈퇴 계정 정리 같은 배치 작업은 쿠키·CORS·메일을 쓰지 않으므로 부르지 않습니다)"""
        problems = self.production_problems()
        if problems:
            raise RuntimeError("운영 설정을 고친 뒤 다시 시작하세요.\n- " + "\n- ".join(problems))


settings = Settings()
