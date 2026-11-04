"""긴 회의 원문 분할

Whisper가 만든 문장(세그먼트) 경계에서만 자르므로 문장 중간에서 끊기지 않는다.
각 줄에 [시:분:초]를 붙여 AI가 일정·발언 시점을 참고할 수 있게 한다.

한국어는 대략 1~1.5자당 1토큰이므로 기본 12,000자 ≈ 8~12k 토큰.
2시간 회의(약 3~4만 자)는 3~4개 구간이 된다.
"""

from dataclasses import dataclass


@dataclass
class Chunk:
    index: int
    start: float
    end: float
    text: str


def _clock(sec: float) -> str:
    s = int(sec)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def chunk_segments(segments: list[dict], max_chars: int) -> list[Chunk]:
    chunks: list[Chunk] = []
    lines: list[str] = []
    size = 0
    start = 0.0
    end = 0.0

    for seg in segments:
        text = seg["text"].strip()
        if not text:
            continue
        line = f"[{_clock(seg['start'])}] {text}"
        if lines and size + len(line) + 1 > max_chars:
            chunks.append(Chunk(len(chunks), start, end, "\n".join(lines)))
            lines, size = [], 0
        if not lines:
            start = seg["start"]
        lines.append(line)
        size += len(line) + 1
        end = seg["end"]

    if lines:
        chunks.append(Chunk(len(chunks), start, end, "\n".join(lines)))
    return chunks
