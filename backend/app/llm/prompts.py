"""프롬프트 불러오기. 프롬프트는 각 서비스 폴더의 마크다운 파일에 두고, 킷은 읽는 방법만 제공합니다.

파일 형식 (## system / ## user 구역, 변수는 {이름}, 중괄호 자체를 쓰려면 {{ }}):

    ## system
    너는 회의록을 정리하는 비서다.

    ## user
    다음 회의록을 요약해 줘.
    {notes}

구역 제목이 없으면 파일 전체를 user 메시지로 씁니다.
"""

import re
from functools import lru_cache
from pathlib import Path

from langchain_core.prompts import ChatPromptTemplate

_SECTION = re.compile(r"^#{1,3}\s*(system|user|human)\s*$", re.IGNORECASE | re.MULTILINE)


@lru_cache(maxsize=128)
def _load(path: str) -> ChatPromptTemplate:
    text = Path(path).read_text(encoding="utf-8")
    parts = _SECTION.split(text)
    if len(parts) == 1:
        if not text.strip():
            raise ValueError(f"프롬프트 파일이 비어 있습니다: {path}")
        return ChatPromptTemplate.from_messages([("human", text.strip())])
    messages = []
    for i in range(1, len(parts), 2):
        role = "system" if parts[i].lower() == "system" else "human"
        body = parts[i + 1].strip()
        if body:
            messages.append((role, body))
    if not any(role == "human" for role, _ in messages):
        raise ValueError(f"프롬프트 파일에 user 구역이 없습니다: {path}")
    return ChatPromptTemplate.from_messages(messages)


def load_prompt(path: str | Path) -> ChatPromptTemplate:
    """마크다운 파일 → ChatPromptTemplate. 같은 파일은 한 번만 읽습니다(캐시)."""
    return _load(str(Path(path).resolve()))
