# MeerKit 백엔드 운영 이미지 (Render 등 Docker 호스팅용). 자세한 배포 순서: docs/deployment.md
# 로컬 개발은 이 파일 대신 `uv run uvicorn app.main:app --reload` 를 씁니다.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /bin/uv

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

# 의존성만 먼저 설치해 코드가 바뀌어도 이 층은 캐시로 재사용합니다
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY . .
RUN uv sync --locked --no-dev

# root 가 아닌 사용자로 실행합니다
RUN useradd --create-home --uid 10001 app
USER app

ENV PATH="/app/.venv/bin:$PATH" \
    PORT=8000
EXPOSE 8000

# 호스팅이 주는 PORT 로 띄웁니다. 앞단 프록시(Render)의 X-Forwarded-* 헤더를 믿습니다.
# 마이그레이션은 여기서 돌리지 않습니다. 배포 워크플로(.github/workflows/deploy.yml)가 배포 전에 실행합니다.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
