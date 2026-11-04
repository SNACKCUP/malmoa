# MeerKit 프로젝트

미어캣(meerkat) + 키트(kit). 무리를 위해 망을 봐 주는 미어캣처럼, 인증과 권한 같은 공통 기반이 서비스를 받쳐 주는 AI 서비스 스타터킷입니다.

## 시작하기

```bash
npx @snackcup/meerkit setup
```

환경 점검(Node.js, uv, Docker Desktop) → 라이브러리 설치 → 환경 변수와 비밀키 생성 → DB 실행 → 마이그레이션 → 로컬용 관리자 계정 → 서버 시작까지 자동으로 진행합니다.
- 이미 끝난 단계는 건너뛰므로 다시 실행해도 안전합니다.
- 전체 로그는 `meerkit-setup.log`에 남습니다.
- 서버를 켜지 않고 세팅만 하려면 `npx @snackcup/meerkit setup --no-start`
- 세팅이 끝난 뒤 서버만 켜려면 `npx @snackcup/meerkit start` (DB, 백엔드 8000, 프론트엔드 3000), 끄려면 `stop`, 상태는 `status`
- 새 기능 뼈대: `npx @snackcup/meerkit add feature <이름>`, 전체 명령: `npx @snackcup/meerkit --help`

| 서비스 | 주소 |
| --- | --- |
| 프론트엔드 | http://localhost:3000 |
| 백엔드 API 문서 | http://localhost:8000/docs |

로컬용 관리자 계정은 `backend/.env`의 `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`입니다. **로컬 전용**이니 운영에서는 반드시 바꾸세요.

## 폴더 구조

```text
frontend/             Next.js + shadcn/ui (킷 코드는 src/meerkit, 설정은 meerkit.config.ts)
backend/              FastAPI + SQLAlchemy + Alembic + PostgreSQL
docker-compose.yml    로컬 DB (PostgreSQL)
```

## 직접 실행하고 싶다면

```bash
docker compose up -d db
cd backend && uv sync && uv run alembic upgrade head && uv run python -m app.users.seed
uv run uvicorn app.main:app --reload
# 다른 터미널
cd frontend && npm install && npm run dev
```

## 알아 두세요

- 사용 설명서는 별도 사이트로 배포됩니다. 이 프로젝트에는 설명서 화면이 들어 있지 않고, 웰컴 페이지만 있습니다. 설명서 사이트 주소를 `frontend/.env.example`의 `NEXT_PUBLIC_DOCS_URL`에 넣으면 웰컴 페이지에 Docs 버튼이 나타납니다.
- 백엔드는 개발 중입니다. 일부 API는 바뀔 수 있습니다.
