"""AI 회의록 작성

흐름
  - 원문이 한 구간에 들어가면: API 1회로 바로 회의록 작성
  - 길면: 구간별 메모 작성(map) → 메모를 합쳐 최종 회의록 작성(reduce)
    구간 메모는 저장소의 minutes/{job_id}.notes/chunk_NNN.json 으로 저장해, 실패하거나 서버가 재시작해도 그 구간부터 이어서 진행한다.

원칙
  - 원문에 없는 담당자·일정·결정을 만들지 않는다. 확인할 수 없으면 '확인 필요'.
  - AI API로는 변환된 텍스트만 보낸다. (음성 파일은 보내지 않음)
  - 제공자(OpenAI·Claude·Gemini·호환)와 키는 작업 주인의 설정(services/llm.py)을 따른다.
"""

import json
import logging
from collections.abc import Callable
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, ValidationError, field_validator

from app.features.malmoa.config import Settings
from app.features.malmoa.db import SessionLocal
from app.features.malmoa.schemas.jobs import Attendee, Job, JobStatus
from app.features.malmoa.services import ai_usage, llm
from app.features.malmoa.services.chunker import Chunk, chunk_segments
from app.features.malmoa.services.file_store import (
    MARKDOWN,
    delete_prefix,
    get_json,
    get_store,
    minutes_keys,
    minutes_note_key,
    minutes_notes_prefix,
    put_json,
    put_text,
    transcript_keys,
)
from app.features.malmoa.store import JobStore, now

log = logging.getLogger(__name__)

UNKNOWN = "확인 필요"
JSON_RETRIES = 2


class MinutesError(Exception):
    """사용자에게 그대로 보여 줄 수 있는 회의록 작성 오류"""


# ---------- 결과 구조 ----------


def _fill(v: object) -> str:
    s = str(v or "").strip()
    return s or UNKNOWN


class Discussion(BaseModel):
    topic: str
    details: list[str] = []


class ActionItem(BaseModel):
    owner: str = UNKNOWN
    task: str
    due: str = UNKNOWN

    _fill_owner = field_validator("owner", "due", mode="before")(_fill)


class ScheduleItem(BaseModel):
    item: str
    date: str = UNKNOWN

    _fill_date = field_validator("date", mode="before")(_fill)


class ChunkNotes(BaseModel):
    summary: str = ""
    discussions: list[Discussion] = []
    decisions: list[str] = []
    action_items: list[ActionItem] = []
    schedule: list[ScheduleItem] = []
    open_questions: list[str] = []


class Minutes(BaseModel):
    title: str = "회의록"
    overview: str = ""
    discussions: list[Discussion] = []
    key_summary: list[str] = Field(default_factory=list)
    decisions: list[str] = []
    action_items: list[ActionItem] = []
    schedule: list[ScheduleItem] = []
    open_questions: list[str] = []


# ---------- 프롬프트 ----------

RULES = f"""규칙:
- 반드시 주어진 원문에 근거해서만 작성한다. 원문에 없는 사실, 담당자, 날짜, 결정을 만들어 내지 않는다.
- 담당자나 마감일이 원문에서 명확하지 않으면 "{UNKNOWN}"이라고 쓴다.
- '결정 사항'에는 원문에서 합의·확정된 것만 넣는다. 제안이나 의견은 논의 내용에 넣는다.
- 원문은 음성 인식(Whisper) 결과라 오탈자나 잘못 인식된 단어가 있을 수 있다. 문맥상 명백한 경우만 바로잡고, 애매한 고유명사·숫자는 '추가 확인이 필요한 사항'에 적는다.
- 여러 사람의 발언이 화자 구분 없이 섞여 있다. 누가 말했는지 추측하지 않는다.
- 한국어로, 간결한 문장으로 쓴다.
- JSON 객체 하나만 출력한다."""

FINAL_SCHEMA = f"""출력 JSON 형식:
{{
  "title": "회의 내용을 나타내는 짧은 제목",
  "overview": "회의 목적과 흐름을 2~3문장으로",
  "discussions": [{{"topic": "논의 주제", "details": ["세부 내용", "..."]}}],
  "key_summary": ["핵심 요약 3~5개"],
  "decisions": ["확정된 결정 사항"],
  "action_items": [{{"owner": "담당자 또는 {UNKNOWN}", "task": "할 일", "due": "마감일 또는 {UNKNOWN}"}}],
  "schedule": [{{"item": "일정 내용", "date": "날짜/시점 또는 {UNKNOWN}"}}],
  "open_questions": ["추가 확인이 필요한 사항"]
}}
해당 내용이 없으면 빈 배열 []로 둔다."""

CHUNK_SCHEMA = f"""출력 JSON 형식:
{{
  "summary": "이 구간 요약 2~3문장",
  "discussions": [{{"topic": "논의 주제", "details": ["세부 내용"]}}],
  "decisions": ["확정된 결정 사항"],
  "action_items": [{{"owner": "담당자 또는 {UNKNOWN}", "task": "할 일", "due": "마감일 또는 {UNKNOWN}"}}],
  "schedule": [{{"item": "일정 내용", "date": "날짜/시점 또는 {UNKNOWN}"}}],
  "open_questions": ["확인이 필요한 사항"]
}}
해당 내용이 없으면 빈 배열 []로 둔다."""

SYSTEM = "너는 회의 녹음 원문을 정확한 회의록으로 정리하는 비서다. 사실만 기록하고 추측하지 않는다."


def attendee_label(a: Attendee) -> str:
    return f"{a.name}({a.role})" if a.role else a.name


def _attendees_block(attendees: list[Attendee]) -> str:
    """사용자가 등록한 참석자. 담당자 이름 표기를 맞추는 데만 쓰고, 발언자나 담당자를 추측하는 근거로 쓰지 않게 한다."""
    if not attendees:
        return ""
    names = "\n".join(f"- {attendee_label(a)}" for a in attendees)
    return (
        f"<참석자>\n{names}\n</참석자>\n"
        "참석자 명단 사용 규칙:\n"
        "- 원문에 나온 이름이 참석자와 같은 사람으로 보이면 담당자를 참석자 명단의 이름으로 적는다. (음성 인식으로 이름이 조금 틀렸을 수 있다)\n"
        f"- 원문에서 이름이 나오지 않은 할 일에 참석자를 담당자로 넣지 않는다. 그런 경우는 \"{UNKNOWN}\".\n"
        "- 원문에 누가 말했는지 표시가 없으므로 발언자를 추측하지 않는다.\n\n"
    )


def _final_prompt_from_transcript(text: str, attendees: list[Attendee]) -> str:
    return (
        f"다음은 회의 녹음을 받아 적은 원문이다. 각 줄 앞의 [시:분:초]는 발언 시점이다.\n\n{RULES}\n\n{FINAL_SCHEMA}\n\n"
        f"{_attendees_block(attendees)}<원문>\n{text}\n</원문>"
    )


def _chunk_prompt(chunk: Chunk, total: int, attendees: list[Attendee]) -> str:
    return (
        f"다음은 긴 회의 원문 중 {chunk.index + 1}/{total}번째 구간이다. 이 구간에서 나온 내용만 정리한다. "
        f"앞뒤 구간에서 이어지는 이야기일 수 있으니, 이 구간만으로 확정할 수 없는 담당자·일정은 \"{UNKNOWN}\"으로 둔다.\n\n"
        f"{RULES}\n\n{CHUNK_SCHEMA}\n\n{_attendees_block(attendees)}<원문>\n{chunk.text}\n</원문>"
    )


def _reduce_prompt(notes: list[ChunkNotes], attendees: list[Attendee]) -> str:
    body = json.dumps([{"구간": i + 1, **n.model_dump()} for i, n in enumerate(notes)], ensure_ascii=False, indent=1)
    return (
        "다음은 하나의 긴 회의를 시간 순서대로 나눈 구간별 정리 메모다. 이것을 합쳐 회의 전체의 회의록을 만든다.\n"
        "- 같은 주제·결정·할 일이 여러 구간에 나오면 하나로 합친다.\n"
        f"- 어느 구간에서 담당자나 마감일이 확인되면 그 값을 쓰고, 끝까지 확인되지 않으면 \"{UNKNOWN}\"으로 둔다.\n\n"
        f"{RULES}\n\n{FINAL_SCHEMA}\n\n{_attendees_block(attendees)}<구간 메모>\n{body}\n</구간 메모>"
    )


# ---------- API 호출 ----------


class Usage:
    def __init__(self) -> None:
        self.input = 0
        self.output = 0
        self.calls = 0
        # 호출마다 AI 사용량 기록(llm_usage)에 남긴다 (입력 토큰, 출력 토큰)
        self.on_call: Callable[[int, int], None] | None = None




def _json_object(text: str) -> object:
    """응답에서 JSON 객체를 꺼낸다. (Claude 등은 ```json 코드 블록이나 앞뒤 설명을 붙일 수 있다)"""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise
        return json.loads(text[start : end + 1])


def _ask[T: BaseModel](cfg: llm.LlmConfig, prompt: str, model_cls: type[T], usage: Usage) -> T:
    for attempt in range(1, JSON_RETRIES + 1):
        try:
            reply = llm.complete_json(cfg, SYSTEM, prompt)
        except llm.LlmError as e:
            raise MinutesError(str(e)) from e

        usage.calls += 1
        usage.input += reply.input_tokens
        usage.output += reply.output_tokens
        if usage.on_call:
            usage.on_call(reply.input_tokens, reply.output_tokens)
        try:
            return model_cls.model_validate(_json_object(reply.text))
        except (json.JSONDecodeError, ValidationError):
            log.warning("AI 응답 형식 오류 (시도 %d/%d): %s", attempt, JSON_RETRIES, reply.text[:300])
    raise MinutesError("AI 응답을 회의록 형식으로 읽지 못했습니다. 다시 시도해 주세요.")


# ---------- Markdown ----------

KST = ZoneInfo("Asia/Seoul")


def _duration(sec: float | None) -> str:
    if not sec:
        return UNKNOWN
    if sec < 60:
        return "1분 미만"
    m = round(sec / 60)
    return f"{m // 60}시간 {m % 60}분" if m >= 60 else f"{m}분"


def render_markdown(m: Minutes, job: Job) -> str:
    def bullets(items: list[str]) -> list[str]:
        return [f"- {x}" for x in items] or ["- 없음"]

    created = job.created_at.astimezone(KST).strftime("%Y-%m-%d %H:%M")
    out = [
        f"# {m.title}",
        "",
        f"- 녹음 등록: {created}",
        f"- 녹음 길이: {_duration(job.duration_sec)}",
        f"- 참석자: {', '.join(attendee_label(a) for a in job.attendees) or f'{UNKNOWN} (등록되지 않음)'}",
        f"- 원본 파일: {job.file_name}",
        "",
        "## 회의 개요",
        "",
        m.overview or UNKNOWN,
        "",
        "## 주요 논의 내용",
        "",
    ]
    if m.discussions:
        for d in m.discussions:
            out += [f"### {d.topic}", "", *bullets(d.details), ""]
    else:
        out += ["- 없음", ""]
    out += ["## 핵심 요약", "", *bullets(m.key_summary), ""]
    out += ["## 결정 사항", "", *bullets(m.decisions), ""]
    out += ["## 담당자별 실행 과제", ""]
    out += [f"- **{a.owner}** — {a.task} (마감: {a.due})" for a in m.action_items] or ["- 없음"]
    out += ["", "## 일정 및 마감일", ""]
    out += [f"- {s.date}: {s.item}" for s in m.schedule] or ["- 없음"]
    out += ["", "## 추가 확인이 필요한 사항", "", *bullets(m.open_questions), ""]
    out += ["---", "", "*말모아가 음성 인식 원문을 바탕으로 AI로 작성한 회의록입니다. 중요한 내용은 원문과 대조해 확인하세요.*", ""]
    return "\n".join(out)


def markdown_to_text(md: str) -> str:
    """TXT 다운로드용: Markdown 기호를 걷어 낸 일반 텍스트"""
    lines = []
    for line in md.splitlines():
        s = line.rstrip()
        if s.startswith("### "):
            s = "▶ " + s[4:]
        elif s.startswith("## "):
            s = "■ " + s[3:]
        elif s.startswith("# "):
            s = s[2:]
        elif s == "---":
            s = ""
        s = s.replace("**", "")
        if len(s) > 1 and s.startswith("*") and s.endswith("*"):
            s = s[1:-1]
        lines.append(s)
    return "\n".join(lines).strip() + "\n"


# ---------- 작업 ----------


def generate_minutes(job_id: str, store: JobStore, settings: Settings) -> None:
    job = store.get(job_id)
    if job is None:
        return
    json_key, md_key = minutes_keys(job_id)
    files = get_store()
    usage = Usage()

    def spent() -> int:
        # 실패한 시도에서 쓴 토큰도 비용에 포함해 기록한다
        return ((store.get(job_id) or job).llm_tokens or 0) + usage.input + usage.output

    try:
        try:
            segments = get_json(files, transcript_keys(job_id)[0])["segments"]
        except FileNotFoundError:
            raise MinutesError("변환된 원문이 없습니다. 먼저 음성을 텍스트로 변환해 주세요.") from None
        chunks = chunk_segments(segments, settings.minutes_chunk_chars)
        if not chunks:
            raise MinutesError("원문에 인식된 말소리가 없어 회의록을 만들 수 없습니다.")

        with SessionLocal() as db:
            cfg = llm.resolve(db, job.user_id)
        if problem := cfg.problem():
            raise MinutesError(problem)
        usage.on_call = lambda i, o: ai_usage.record(job.user_id, job_id, job.file_name, cfg.provider, cfg.model, i, o)
        total_steps = len(chunks) + 1 if len(chunks) > 1 else 1
        store.update(job_id, status=JobStatus.SUMMARIZING, progress=0, stage="회의록 작성 준비 중", error_message=None)

        if len(chunks) == 1:
            store.update(job_id, stage="AI가 회의록을 작성하는 중")
            minutes = _ask(cfg, _final_prompt_from_transcript(chunks[0].text, job.attendees), Minutes, usage)
        else:
            notes: list[ChunkNotes] = []
            for c in chunks:
                part = minutes_note_key(job_id, c.index)
                if files.exists(part):
                    notes.append(ChunkNotes.model_validate(get_json(files, part)))
                    continue
                store.update(job_id, stage=f"구간 {c.index + 1}/{len(chunks)} 정리 중", progress=round(c.index / total_steps * 100))
                n = _ask(cfg, _chunk_prompt(c, len(chunks), job.attendees), ChunkNotes, usage)
                put_json(files, part, n.model_dump())
                notes.append(n)
            store.update(job_id, stage="전체 회의록으로 합치는 중", progress=round(len(chunks) / total_steps * 100))
            minutes = _ask(cfg, _reduce_prompt(notes, job.attendees), Minutes, usage)

        job = store.get(job_id) or job
        put_json(
            files,
            json_key,
            {
                "jobId": job_id,
                "generatedAt": now().isoformat(),
                "provider": cfg.provider,
                "model": cfg.model,
                "usage": {"calls": usage.calls, "inputTokens": usage.input, "outputTokens": usage.output},
                "minutes": minutes.model_dump(),
            },
        )
        put_text(files, md_key, render_markdown(minutes, job), MARKDOWN)
        delete_prefix(files, minutes_notes_prefix(job_id))

        store.update(
            job_id,
            status=JobStatus.COMPLETED,
            progress=None,
            stage="회의록 완료",
            minutes_ready=True,
            llm_tokens=spent(),
        )
        log.info("회의록 완료: %s (호출 %d회, 입력 %d · 출력 %d 토큰)", job_id, usage.calls, usage.input, usage.output)

    except MinutesError as e:
        store.update(job_id, status=JobStatus.FAILED, progress=None, stage=None, error_message=str(e), llm_tokens=spent() or None)
    except Exception:
        log.exception("회의록 작성 중 예상하지 못한 오류: %s", job_id)
        store.update(
            job_id,
            status=JobStatus.FAILED,
            progress=None,
            stage=None,
            error_message="회의록 작성 중 오류가 발생했습니다. 다시 시도하면 완료된 구간부터 이어서 진행합니다.",
            llm_tokens=spent() or None,
        )
