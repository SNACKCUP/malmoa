# 말모아(Malmoa) 프로젝트 개발 지시서

> **2026-11-03 통합:** 이 폴더(`~/Desktop/malmoa`, meerkit으로 만든 프로젝트)가 말모아 본체다. 아래 1~10절은 원래 지시서(요구사항 원문)이고, **구조·스택·폴더·로그인에 관한 내용은 12절이 우선한다.** 11절은 통합 전(인증 서버를 따로 두던 때) 규칙이라 12절로 대체됐다. 계획: `docs/2026-11-03-통합계획.md`.

## 1. 프로젝트 개요

**프로젝트명:** 말모아(Malmoa)

**폴더명:** `malmoa`

**서비스 목적:**

회의 녹음 파일을 업로드하면 음성을 텍스트로 변환하고, AI가 주요 논의 내용과 결정 사항을 정리하여 회의록 문서로 만들어 주는 개인용 웹 서비스이다.

매일 약 2시간씩 녹음한 회의 파일을 10일 동안 처리할 수 있도록 설계한다.

### 핵심 개발 원칙

- 음성 인식은 Mac 로컬에서 Whisper를 실행하여 처리한다.
- AI API는 변환된 텍스트를 회의록으로 정리하는 데 사용한다.
- 유료 API 호출을 최소화하고 사용량을 관리한다.
- 긴 음성 파일과 긴 회의 텍스트를 처리할 수 있도록 설계한다.
- 변환된 원문과 최종 회의록을 로컬에 저장한다.
- 작업 도중 오류가 발생해도 처음부터 다시 처리하지 않도록 한다.
- API 키, 녹음 파일, 개인정보를 GitHub에 올리지 않는다.

---

## 2. 개발 환경 및 기술 스택

> 2026-10-22 기술 스택 변경: React+Vite → Next.js(App Router)·shadcn/ui·Zustand·TanStack Query, JSON 파일 → PostgreSQL·Alembic, JWT 인증 추가.
> 2026-11-02 말모아 자체 로그인(JWT·회원가입·로그인 화면) 삭제. npm 로그인 라이브러리로 다시 연결할 예정이며, 그 전까지는 내장 로컬 계정 하나로 동작한다.

### 프런트엔드

- Next.js 16 (App Router, TypeScript)
- shadcn/ui (Radix 기반, `src/components/ui/`)
- Tailwind CSS 4
- Zustand — 클라이언트 상태 (녹음 설정, 참석자 초안)
- TanStack Query — 서버 데이터 조회·갱신 (작업 목록, 진행 상태 폴링)

Next.js 16은 학습 데이터와 API가 다르다. 코드를 쓰기 전에 `frontend/node_modules/next/dist/docs/`의 해당 가이드를 읽는다 (`frontend/AGENTS.md`).

### 백엔드

- Python 3.11
- FastAPI
- uv 패키지 관리
- OpenAI Whisper 로컬 음성 인식
- OpenAI Python SDK 등 호환 가능한 LLM API 클라이언트
- Pydantic Settings
- SQLAlchemy 2 + psycopg 3
- Alembic — DB 스키마 마이그레이션

### 데이터 저장

- PostgreSQL 16: 사용자(users), 작업 상태(jobs) 등 메타데이터
- 로컬 파일(`backend/storage/`): 음성 원본, 변환 원문, 회의록 본문처럼 큰 데이터
- 로컬 개발용 PostgreSQL은 Python 패키지 `pgserver`에 포함된 실행 파일로 띄운다 (`backend/scripts/db.sh`). 다른 PostgreSQL을 쓰려면 `DATABASE_URL`만 바꾼다.
- 스키마 변경은 반드시 Alembic 마이그레이션으로 한다 (`uv run alembic revision --autogenerate -m "…"`).

### 음성 처리

- ffmpeg
- Whisper 모델
- 한국어 음성 인식
- 긴 음성 파일 처리
- 진행 상태 및 오류 관리

---

## 3. 프로젝트 폴더 구조

다음 구조를 기준으로 프로젝트를 구성한다.

```text
malmoa/
├── CLAUDE.md
├── README.md
├── .gitignore
│
├── start.sh                 # PostgreSQL → 마이그레이션 → 백엔드 → 프런트엔드 한 번에 실행
│
├── frontend/                # Next.js 16
│   ├── src/
│   │   ├── app/             # App Router: (app)/ 화면들
│   │   ├── components/
│   │   │   ├── ui/          # shadcn/ui
│   │   │   └── malmoa/      # 말모아 화면 컴포넌트
│   │   ├── hooks/           # TanStack Query 훅, 녹음 훅
│   │   ├── stores/          # Zustand 스토어
│   │   └── lib/             # API 클라이언트, 타입, 유틸
│   ├── components.json      # shadcn 설정
│   ├── package.json
│   └── next.config.ts
│
└── backend/
    ├── app/
    │   ├── main.py
    │   ├── api/
    │   │   └── jobs.py
    │   ├── services/
    │   │   ├── transcriber.py
    │   │   ├── chunker.py
    │   │   ├── minutes.py
    │   │   └── worker.py
    │   ├── core/
    │   │   ├── config.py
    │   │   ├── security.py  # 요청 사용자 (지금은 로컬 계정)
    │   │   └── storage.py   # 작업 저장소(DB)
    │   ├── db/              # SQLAlchemy 모델·세션
    │   └── schemas/
    ├── migrations/          # Alembic
    ├── scripts/db.sh        # 로컬 PostgreSQL 관리
    ├── tests/               # pytest
    ├── storage/
    │   ├── uploads/
    │   ├── transcripts/
    │   ├── minutes/
    │   └── postgres/        # 로컬 PostgreSQL 데이터
    ├── alembic.ini
    ├── .env.example
    └── pyproject.toml
```

기존 프로젝트 파일이 있다면 먼저 확인하고 불필요하게 덮어쓰지 않는다.

---

## 4. 필수 기능 요구사항

### 기능 1. 음성 파일 업로드

사용자가 음성 파일을 선택하고 업로드할 수 있도록 한다.

- MP3, WAV, M4A 등 지원 가능한 형식
- 파일명과 파일 크기 표시
- 업로드 진행 상태 표시
- 잘못된 형식 및 용량 초과 오류 안내
- 파일을 안전하게 저장
- 파일명에 포함된 경로 문자 등으로 인한 보안 문제 방지

2시간짜리 파일을 지원하되, 무제한 파일 크기를 허용하지 않는다. 설정 가능한 파일 크기 제한을 두고 실제 처리 가능 여부를 검증한다.

### 기능 2. Whisper 음성 변환

`services/transcriber.py`에 음성 인식 로직을 구현한다.

- 로컬 Whisper 모델 사용
- 한국어 인식
- 긴 녹음 파일 처리
- 변환 결과를 텍스트 파일로 저장
- 변환 실패 시 오류 기록
- 완료된 변환 결과 재사용
- 사용할 모델을 환경설정으로 변경 가능하게 구현

처음에는 `small` 모델을 기본값으로 사용하고, 실제 녹음으로 정확도와 처리 시간을 시험한다.

2시간 녹음 파일을 처리할 때 메모리 부족과 처리 시간 문제를 확인한다. 필요한 경우 오디오 분할 및 재시도 기능을 구현한다.

### 기능 3. 작업 상태 관리

다음 상태를 관리한다.

- `QUEUED`: 대기 중
- `TRANSCRIBING`: 음성 변환 중
- `SUMMARIZING`: 회의록 작성 중
- `COMPLETED`: 완료
- `FAILED`: 실패

각 작업은 고유 ID를 가진다.

백엔드 작업을 실행하는 동안 프런트엔드가 멈추지 않도록 비동기 작업 구조를 사용한다. 처음에는 로컬 단일 사용자 환경에 맞게 구현하고, 서버 재시작 시 작업 상태를 복구할 수 있도록 저장한다.

### 기능 4. AI 회의록 작성

`services/minutes.py`에 회의록 생성 기능을 구현한다.

음성 변환이 완료된 텍스트를 AI API에 전달하여 다음 내용을 생성한다.

1. 회의 제목
2. 회의 개요
3. 주요 논의 내용
4. 핵심 요약
5. 결정 사항
6. 담당자별 실행 과제
7. 일정 및 마감일
8. 추가 확인이 필요한 사항

원문에 없는 담당자, 일정, 결정 사항을 임의로 만들지 않는다. 확인할 수 없는 내용은 '확인 필요'로 표시한다.

### 기능 5. 긴 텍스트 처리

`services/chunker.py`를 구현한다.

- 긴 텍스트를 적절한 길이로 분할
- 문장이나 문단의 중간에서 불필요하게 자르지 않도록 처리
- 구간별 요약 생성
- 구간 요약을 통합하여 전체 회의록 작성
- API 토큰 한도와 비용 고려
- API 오류 시 재시도 정책 적용
- 실패한 구간부터 재개할 수 있도록 진행 상태 저장

모든 텍스트를 무조건 한 번의 API 요청으로 처리하지 않는다.

### 기능 6. 회의록 편집 및 다운로드

완성된 회의록을 화면에서 확인하고 편집할 수 있도록 한다.

- 회의록 내용 수정
- 수정 결과 저장
- Markdown 파일 다운로드
- TXT 파일 다운로드
- 변환 원문 다시 보기
- 처리 완료 및 실패 상태 표시

---

## 5. 프런트엔드 화면 구성

### 메인 화면

서비스 이름은 '말모아'로 표시한다.

부제목:

'녹음은 글로, 회의는 기록으로.'

화면 구성:

1. 상단 헤더 및 서비스명
2. 음성 파일 업로드 영역
3. 업로드한 파일 목록
4. 변환 및 회의록 생성 버튼
5. 작업 진행 상태
6. 최근 작업 목록
7. 회의록 결과 보기

### 디자인 방향

- 최신 AI 생산성 서비스처럼 깔끔한 디자인
- 흰색 또는 밝은 회색 배경
- 적절한 여백과 읽기 쉬운 타이포그래피
- 명확한 진행 상태 표시
- 불필요한 장식과 복잡한 애니메이션 제외
- 데스크톱 우선, 반응형 지원
- 로딩 및 오류 상태를 사용자가 이해하기 쉽게 표시

실제 기능과 연결되지 않은 버튼은 만들지 않는다.

---

## 6. API 설계

다음 API를 우선 구현한다.

### 사용자 (로그인 없음)

말모아 자체 로그인 API(`/api/auth/*`)는 2026-11-02에 지웠다 (`docs/2026-11-02-로그인삭제.md`). 모든 요청은 내장 로컬 계정(`local@malmoa.local`)으로 처리한다.
npm 로그인 라이브러리를 붙일 때는 `core/security.py`의 `get_current_user`에서 그 토큰·세션을 확인해 사용자를 돌려주면 된다. 작업·일정·참석자는 이미 사용자별(`user_id`)로 나뉘어 있다.

### 파일 및 작업

- `POST /api/jobs`: 파일 업로드 및 작업 생성
- `GET /api/jobs`: 작업 목록 조회
- `GET /api/jobs/{job_id}`: 작업 상태 조회
- `POST /api/jobs/{job_id}/transcribe`: 음성 변환 시작
- `POST /api/jobs/{job_id}/minutes`: 회의록 생성 시작
- `GET /api/jobs/{job_id}/transcript`: 변환 원문 조회
- `GET /api/jobs/{job_id}/minutes`: 회의록 조회
- `PUT /api/jobs/{job_id}/minutes`: 회의록 수정 저장
- `PUT /api/jobs/{job_id}/transcript`: 변환 원문 수정 저장 (2026-11-02 추가, `docs/2026-11-02-원문편집·Word·PDF.md`)
- `GET /api/jobs/{job_id}/download?format=md|txt|docx|pdf`: 회의록 파일 다운로드 (Word·PDF 2026-11-02 추가)
- `GET /api/jobs/{job_id}/transcript.txt`: 변환 원문 TXT 다운로드
- `DELETE /api/jobs/{job_id}`: 작업 삭제 (2026-10-28 추가, 범위는 `docs/2026-10-28-작업삭제.md`)
- `PUT /api/jobs/{job_id}/attendees`: 회의 참석자 저장 (업로드 때 form `attendees`로도 보낼 수 있음)
- `GET·POST /api/people`, `PUT·DELETE /api/people/{id}`: 참석자 명단 (2026-10-28 추가, `docs/2026-10-28-참석자기능.md`)
- `GET /api/usage`, `PUT /api/usage/limits`: AI 사용량(오늘·이번 달·전체·모델별·최근)과 사용자가 정하는 한도 (2026-11-02 추가, `docs/2026-11-02-AI사용량.md`)
- `GET /api/events?from=&to=`, `POST /api/events`, `GET·PUT·DELETE /api/events/{id}`: 캘린더 일정 (2026-10-29 추가, `docs/2026-10-29-일정·알람·자동녹음.md`)
- `GET /api/events/reminders?since=`: 울린 알람(화면 알림용), `GET·PUT /api/events/calendar-sync`, `POST /api/events/{id}/sync`: 아이폰용 Mac 캘린더 앱 내보내기
- `POST /api/events/{id}/auto-record`: 자동 녹음 결과 보고, `POST /api/recorder/heartbeat`: 말모아 탭 생존·마이크 권한 신호, 업로드 form `event_id`: 녹음을 일정에 연결

각 API의 요청 및 응답 형식은 Pydantic 스키마로 정의한다.

작업 상태를 확인할 수 있는 API와 오류 응답 형식도 함께 구현한다.

---

## 7. 환경변수 및 보안

`.env.example`에 필요한 설정 항목을 정의한다.

예시:

```dotenv
DATABASE_URL=postgresql+psycopg://malmoa:<비밀번호>@localhost:5432/malmoa
SECRET_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=
WHISPER_MODEL=small
MAX_UPLOAD_MB=500
```

실제 API 키는 `.env` 파일에만 저장한다.

> 2026-11-02 변경: AI 제공자·API 키·모델은 설정 화면에서 고르고 DB에 암호화 저장한다(`SECRET_KEY`). `.env`의 `OPENAI_*`는 화면 설정이 없을 때만 쓰는 예비 값이며 비워 둘 수 있다. 쓰이지 않던 `LLM_PROVIDER`는 없앴다.

- `.env`는 Git에 포함하지 않는다.
- DB 비밀번호와 SECRET_KEY도 `.env`에만 둔다 (`scripts/db.sh init`·`start.sh`가 생성).
- PostgreSQL은 localhost에서만 접속을 받는다.
- API 키를 프런트엔드에 노출하지 않는다.
- API 키가 없는 경우 회의록 생성 단계에서 명확한 오류를 표시한다.
- 음성 파일과 변환 텍스트는 외부에 자동 전송하지 않는다.
- AI API에 전송되는 것은 회의록 작성에 필요한 텍스트임을 사용자에게 안내한다.
- 파일 삭제 기능을 구현할 때는 원본과 관련 결과물의 삭제 범위를 명확히 한다.

---

## 8. 개발 진행 순서

아래 순서대로 진행하고, 각 단계가 검증되기 전에는 다음 단계로 넘어가지 않는다.

### 1단계: 프로젝트 분석 및 환경 확인

- 현재 폴더 구조 확인
- Mac 및 Python 버전 확인
- Node.js와 uv 설치 여부 확인
- 기존 파일과 의존성 확인
- 구현 계획 작성

### 2단계: 백엔드 기본 구성

- FastAPI 실행
- 상태 확인 API 구현
- 파일 업로드 API 구현
- 로컬 저장 구조 구현
- API 테스트

### 3단계: 음성 변환

- ffmpeg 확인
- Whisper 설치 확인
- 짧은 한국어 음성으로 시험
- 2시간 파일 처리 검증
- 변환 결과 저장 및 재사용

### 4단계: AI 회의록 작성

- API 연결 및 키 확인
- 텍스트 분할 구현
- 구간별 요약 구현
- 최종 회의록 통합
- 오류 및 비용 관리

### 5단계: 프런트엔드

- React 프로젝트 구성
- 업로드 화면
- 진행 상태 표시
- 작업 목록
- 회의록 결과 및 편집 화면
- 다운로드 기능

### 6단계: 통합 테스트

- 실제 음성 파일 업로드
- 변환 및 회의록 생성
- 오류 및 재시도
- 결과 저장 및 다운로드
- 2시간 녹음 처리 시험
- 10일간 반복 사용 시 파일 관리 검증

---

## 9. Claude Code 작업 지침

- 코드를 작성하기 전에 현재 프로젝트 상태를 확인한다.
- 기존 파일이 있으면 먼저 읽고 수정 범위를 정한다.
- 한 번에 모든 기능을 구현하지 않는다.
- 단계별로 파일을 생성하고 수정한다.
- 파일을 수정하기 전에 변경 목적을 설명한다.
- 설치 명령어와 실행 명령어를 구분해서 안내한다.
- 실제로 실행하지 않은 테스트를 성공했다고 보고하지 않는다.
- 오류가 발생하면 원인을 분석하고 수정한다.
- 임의로 유료 서비스에 가입하거나 결제하지 않는다.
- 무료 API 사용량을 초과하지 않도록 설정과 비용 안내를 구현한다.
- 불필요한 라이브러리와 복잡한 아키텍처를 피한다.
- README.md에 설치, 실행, 환경설정, 문제 해결 방법을 기록한다.

---

## 10. 첫 번째 작업 요청

지금은 전체 프로젝트를 한꺼번에 구현하지 않는다.

**먼저 1단계만 수행한다.**

1. 현재 VS Code 프로젝트 폴더와 파일을 분석한다.
2. Mac의 Python, Node.js, uv 설치 상태를 확인한다.
3. 프로젝트 폴더 구조를 제안한다.
4. 필요한 설치 명령어를 제시한다.
5. 기존 파일을 임의로 삭제하거나 덮어쓰지 않는다.
6. 분석 결과와 다음 작업 계획을 보고한 뒤 사용자 확인을 기다린다.

첫 번째 목표는 말모아의 개발 환경을 안정적으로 준비하는 것이다.

---

## 11. meerkit 연결 규칙 (통합 전, 12절로 대체됨)

> 2026-11-03 추가: 로그인·회원 관리는 meerkit으로 연결한다 (`docs/2026-11-02-meerkit로그인연결-분석.md`).
> 2026-11-03 통합으로 대체: 아래는 legacy 말모아(`~/Desktop/legacy/Malmoa`)가 따로 띄운 meerkit 서버에 붙던 때의 규칙이다. 기록으로만 남긴다.

- 로그인·회원·역할·멤버 관리는 meerkit이 맡는다. 말모아는 가입·비밀번호를 직접 다루지 않는다.
- meerkit 코드(생성 프로젝트 `~/Desktop/malmoa`, 복사한 `frontend/src/meerkit/`)는 고치지 않는다. 바꿔야 하면 설정(`meerkit.config.ts`, `.env`)이나 그 바깥 코드에서 처리한다.
- 말모아 백엔드는 meerkit 액세스 토큰(JWT HS256, `sub`=정수 회원 id)만 검증한다. 사용자 연결은 `users.meerkit_user_id` 하나로 한다. 이메일·이름을 복사해 두지 않는다.
- 브라우저의 `/api/*`는 meerkit 몫이다 (리프레시 쿠키 경로가 `/api/auth`이기 때문). 말모아 API는 `NEXT_PUBLIC_API_URL`(절대 주소)로 부르고 `Bearer` 헤더만 쓴다.
- 주소·포트·비밀키는 코드에 쓰지 않고 `.env`로만 받는다.
- DB를 바꾸는 작업 전에는 `backups/`에 덤프를 남긴다.
- 실제 앱(3001)을 시험 브라우저로 열지 않는다. 시험은 5181·8003에서 한다.
- 작업하면 `docs/`의 날짜 문서·진행표·기능명세·목차를 함께 고친다.
- 커밋 전에 `scripts/check-rules.sh`를 돌려 위 규칙(meerkit 파일 무변경, 코드 안 `localhost`)을 확인한다.

---

## 12. 통합 구조 규칙 (2026-11-03~)

> 말모아를 meerkit 프로젝트 안의 서비스 기능으로 넣는다. 계획·결정·단계: `docs/2026-11-03-통합계획.md`.

### 구조

- 백엔드: FastAPI + SQLAlchemy + Alembic, Python 3.12 (`backend/`). 말모아 기능은 **`backend/app/features/malmoa/` 아래에만** 둔다 (`api/`, `services/`, `schemas/`, `config.py`, `db.py`, `deps.py`, `models.py`, `router.py`). 킷 밖 새 패키지는 `tests/test_import_rules.py`가 막는다. 새 코드는 router → service → repository 방향(SQL은 repository)을 따른다 — 옮겨 온 legacy 코드는 아직 아니다 (계획 문서 단계 1 결과).
- 말모아 설정(`app/features/malmoa/config.py`)은 meerkit 과 같은 `backend/.env`를 읽는다. **meerkit 설정과 같은 이름의 필드를 만들지 않는다** — 이름이 같으면 meerkit 값을 읽어 버린다 (트러블 이슈 #33). 저장소는 `MALMOA_FILES_BACKEND`·`MALMOA_FILES_DIR`, S3 접속 정보만 meerkit 과 공유.
- 프런트: Next.js 16 (`frontend/`). 말모아 화면은 `src/app/(service)/`, 말모아 컴포넌트는 `src/components/malmoa/`, 98 OS 부품은 `src/components/malmoa/ui/`. 그 밖의 말모아 코드는 `src/lib/malmoa/`·`src/hooks/malmoa/`·`src/stores/malmoa/`. 이용약관·처리방침 본문은 `src/components/malmoa/legal/content.ts`(meerkit 본문은 킷이라 안 씀) — 문구를 바꾸면 버전을 올리고 Alembic 으로 `terms` 새 버전 행을 넣는다. 98 스타일은 `src/components/malmoa/malmoa.css` — 색·모서리·글꼴은 `.malmoa-98`(말모아 화면) 안에서만 켜지게 `--m98-*` 변수로 두고, `:root`의 shadcn·meerkit 변수를 직접 바꾸지 않는다. 말모아 API 는 같은 출처 `/api`(Next 프록시).
- DB: PostgreSQL 하나 (로컬은 `docker-compose.yml`의 db, `127.0.0.1:5433`). 스키마 변경은 Alembic 마이그레이션으로만.
- 로그인·회원·역할: meerkit 그대로 (`app.auth.deps.get_current_user`, `app.core.principal.require_role`, 프런트 `@/meerkit`). 말모아는 회원 표를 따로 두지 않고 `users.id`(정수)를 FK로 쓴다.

### 고치지 않는 것

- **킷 폴더:** 백엔드 `app/core`, `auth`, `users`, `account`, `permissions`, `social`, `codes`, `mail`, `llm`, `storage` / 프런트 `src/meerkit/`. 바꿔야 하면 설정(`meerkit.config.ts`, `.env`)이나 킷 밖 코드에서 처리한다.
- 킷 밖이지만 meerkit이 만든 템플릿 파일은 **계획 문서의 "고칠 템플릿 파일" 목록에 있는 것만** 고치고, 고치면 그 목록에 남긴다.
- `backend/app/main.py`: 서버 시작 때 할 일은 `APIRouter(lifespan=…)`로 붙인다.

### 데이터·비밀

- DB나 파일을 옮기거나 바꾸기 전에 백업한다 (`~/Desktop/legacy/Malmoa/backups/`, 권한 600). 데이터 작업은 미리보기 → 백업 → 승인 → 실행 → 검증.
- 비밀 값은 `.env`에만. 주소·포트·비밀키를 코드에 쓰지 않는다.
- 녹음·원문·회의록은 비공개다. 공개 주소를 만들지 않는다 (업로드 전용 서명 주소만 허용, 내려받기는 로그인 확인 뒤 백엔드가 전달).
- Mac 작업자에는 작업자 전용 열쇠만 둔다. DB 비밀번호·저장소 쓰기 키를 두지 않는다.

### 실행·시험

- legacy 말모아(3001·8010)는 새 앱 검증이 끝날 때까지 실제로 쓰는 앱이다. **3001을 시험 브라우저로 열지 않는다.** 새 앱 시험은 5181(화면)·8003(백엔드). 화면: `cd frontend && API_PROXY_TARGET=http://localhost:8003 npx next dev -p 5181`. 시험 브라우저 로그인은 비밀번호 대신 백엔드에서 `app.auth.service.issue_tokens(db, user)`로 발급한 리프레시 토큰을 `meerkit_refresh` 쿠키(경로 `/api/auth`)로 넣는다 (meerkit rc.10 부터 서버 기록이 있어야 하므로 `create_token(…, 'refresh')`만으로는 401, 갱신마다 회전) — 토큰은 출력하지 않는다.
- meerkit 업데이트: `npx @snackcup/meerkit@<버전> update`(미리보기) → 커밋·DB 백업 → `update --apply` → 킷 마이그레이션과 말모아 마이그레이션이 갈라지면 `uv run alembic merge -m … heads` → 개발·테스트 DB `upgrade head` → 전체 테스트·빌드·5181 확인 (`docs/2026-11-03-통합계획.md` "meerkit rc.10 업데이트").
- 3000 포트는 meerkit 패키지 소스(`~/Desktop/snackcup_meerkit/meerkit`) 화면이 쓰고 있을 수 있다. 끄지 않는다.
- 테스트 (`backend/`): `uv run pytest` (전체 = meerkit + 말모아), 말모아만 `uv run pytest tests/features/malmoa`, s3 모드는 앞에 `MALMOA_FILES_BACKEND=s3`. `.env`의 `FRONTEND_BASE_URL`이 3000 이 아니면 meerkit 소셜 로그인 테스트 11개가 실패한다 (트러블 이슈 #34, 앞에 `FRONTEND_BASE_URL=http://localhost:3000`). legacy 폴더에서는 `uv run python -m pytest` (#32). 결과는 통과·실패 수 그대로 보고한다.
- 작업하면 `docs/`의 날짜 문서·진행표(`01-기획.md`)·기능명세·목차(`README.md`)를 함께 고친다.
