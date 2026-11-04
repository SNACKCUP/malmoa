"""작업 ID: 'moa-' + UUID (예: moa-79f7e21d-94af-49a0-96a0-60191aa35449)

작업 ID는 저장 파일 이름(uploads/{id}.webm, transcripts/{id}.json …)에도 쓰이므로
이 형식만 받아들여 경로 문자가 끼어들지 못하게 한다.
"""

import re
import uuid

PREFIX = "moa-"
MAX_LENGTH = 40  # 'moa-' 4자 + UUID 36자
_PATTERN = re.compile(r"moa-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def new_job_id() -> str:
    return f"{PREFIX}{uuid.uuid4()}"


def is_job_id(value: str) -> bool:
    return bool(_PATTERN.fullmatch(value))


def from_legacy(value: str) -> str:
    """'moa-' 도입 전 UUID 작업 ID → 새 형식 (이미 새 형식이면 그대로)"""
    return value if is_job_id(value) else f"{PREFIX}{uuid.UUID(value)}"


def rename_job_files(dirs, old: str, new: str) -> None:
    """dirs 안에서 이름이 old로 시작하는 파일·폴더를 new로 시작하게 바꾼다 (old.json → new.json, old_minutes → new_minutes)"""
    for d in dirs:
        if not d.is_dir():
            continue
        for path in d.iterdir():
            if path.name.startswith(old):
                target = path.with_name(new + path.name[len(old) :])
                if not target.exists():
                    path.rename(target)
