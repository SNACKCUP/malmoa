"""말모아 운영 설정 검사 (통합 단계 5-8) — APP_ENV=production 에서 위험한 설정이면 서버를 켜지 않는다

meerkit 의 검사(app/main.py check_startup)와 같은 방식: 값은 적지 않고 무엇을 고칠지만 적는다.
meerkit main.py 는 고치지 않으므로 말모아 router 의 lifespan 이 부른다. Mac 작업자(scripts/malmoa_worker.py)는
DB·meerkit 설정 없이 돌아야 하므로 이 검사를 config.py 가 아닌 이 모듈에 둔다 (트러블 #42).
"""

import re

from app.core.config import settings as core_settings
from app.features.malmoa.config import Settings, get_settings

MAX_UPLOAD_MB_PROD = 50  # 녹음 32kbps 기준 2시간 약 29MB (docs/2026-11-03-DB와작업처리.md 5e)
PRIVACY_POLICY_WITHDRAWN_DAYS = 30  # 개인정보 처리방침 3번 표 (components/malmoa/legal/content.ts) 와 같아야 한다
_HEX64 = re.compile(r"^[0-9a-f]{64}$")


def production_problems(s: Settings | None = None) -> list[str]:
    if core_settings.app_env != "production":
        return []
    s = s or get_settings()
    problems = []
    if len(s.secret_key) < 32:
        problems.append("SECRET_KEY: 32자 이상 임의 값으로 (화면에서 넣은 AI API 키를 암호화한다. 바꾸면 저장된 키를 다시 넣어야 함)")
    if s.storage_backend != "s3":
        problems.append("MALMOA_FILES_BACKEND: s3 로 (배포 서버 디스크는 재시작·재배포 때 비워질 수 있음)")
    elif not s.storage_private_bucket:
        problems.append("STORAGE_PRIVATE_BUCKET: 녹음·원문·회의록을 둘 비공개 버킷 이름")
    if s.max_upload_mb > MAX_UPLOAD_MB_PROD:
        problems.append(f"MAX_UPLOAD_MB: {MAX_UPLOAD_MB_PROD} 이하로 (녹음 32kbps 기준 2시간 약 29MB)")
    if "transcribe" in s.worker_tasks:
        problems.append('WORKER_TASKS: ["minutes"] 로 (음성·사진 변환은 Mac 작업자가 한다 — 서버에는 Whisper·Vision 이 없음)')
    if not _HEX64.match(s.malmoa_worker_token_hash.strip().lower()):
        problems.append("MALMOA_WORKER_TOKEN_HASH: Mac 작업자 열쇠의 SHA-256 (uv run python scripts/malmoa_worker.py new-token)")
    if s.mac_notifications:
        problems.append("MAC_NOTIFICATIONS: false 로 (서버에는 Mac 알림 센터가 없음)")
    if not s.withdrawn_cleanup_enabled or s.withdrawn_data_days != PRIVACY_POLICY_WITHDRAWN_DAYS:
        problems.append(f"WITHDRAWN_CLEANUP_ENABLED=true, WITHDRAWN_DATA_DAYS={PRIVACY_POLICY_WITHDRAWN_DAYS} 로 (개인정보 처리방침의 탈퇴 정리 기간과 같게)")
    return problems


def check_production() -> None:
    problems = production_problems()
    if problems:
        raise RuntimeError("말모아 운영 설정을 고친 뒤 다시 시작하세요.\n- " + "\n- ".join(problems))
