"""원문 직접 수정 · 회의록 Word/PDF 내보내기"""

import io

import pytest
from docx import Document

from app.features.malmoa.config import get_settings
from app.features.malmoa.schemas.jobs import JobStatus
from app.features.malmoa.services.export import parse, runs
from app.features.malmoa.services.file_store import (
    minutes_keys,
    put_json,
    put_text,
    transcript_keys,
)
from app.features.malmoa.store import JobStore
from features.malmoa.conftest import auth, files, register

AUDIO = ("회의.m4a", b"fake-audio-bytes", "audio/mp4")
SEGMENTS = [
    {"start": 0, "end": 3, "text": "김철수가 보고서를 씁니다."},
    {"start": 3, "end": 6, "text": "음 그러니까"},
    {"start": 3725, "end": 3730, "text": "다음 주 금요일까지입니다."},
]
MINUTES = "# 보고서 회의\n\n- 참석자: 김철수\n\n## 결정 사항\n\n- **김철수** — 보고서 작성 (마감: 확인 필요)\n\n---\n\n*AI로 작성한 회의록입니다.*\n"


def _job(client, h) -> str:
    job = client.post("/api/jobs", files={"file": AUDIO}, headers=h).json()
    put_json(files(), transcript_keys(job["id"])[0], {"jobId": job["id"], "text": "", "segments": SEGMENTS})
    JobStore().update(job["id"], transcript_ready=True, status=JobStatus.COMPLETED)
    return job["id"]


def test_edit_transcript_keeps_times_and_drops_empty(client):
    h = auth(register(client))
    jid = _job(client, h)
    s = get_settings()
    (s.work_dir / f"{jid}_minutes").mkdir(parents=True)  # 실패한 회의록 작성의 구간 메모

    res = client.put(f"/api/jobs/{jid}/transcript", json={"texts": ["김영희가 보고서를\n 씁니다.", "  ", "다음 주 금요일까지입니다."]}, headers=h)
    assert res.status_code == 200, res.text
    t = res.json()
    assert t["edited"] is True
    assert [x["text"] for x in t["segments"]] == ["김영희가 보고서를 씁니다.", "다음 주 금요일까지입니다."]
    assert [x["start"] for x in t["segments"]] == [0, 3725]
    assert t["text"] == "김영희가 보고서를 씁니다.\n다음 주 금요일까지입니다."
    # TXT 받기에도 반영, 시간 표시 유지
    txt = client.get(f"/api/jobs/{jid}/transcript.txt", headers=h).text
    assert txt == "[00:00:00] 김영희가 보고서를 씁니다.\n[01:02:05] 다음 주 금요일까지입니다.\n"
    assert not (s.work_dir / f"{jid}_minutes").exists()
    assert client.get(f"/api/jobs/{jid}/transcript", headers=h).json()["edited"] is True


def test_edit_transcript_rejects_stale_or_busy(client):
    h = auth(register(client))
    jid = _job(client, h)
    stale = client.put(f"/api/jobs/{jid}/transcript", json={"texts": ["하나"]}, headers=h)
    assert stale.status_code == 409 and "새로 고친" in stale.json()["detail"]

    JobStore().update(jid, status=JobStatus.SUMMARIZING)
    busy = client.put(f"/api/jobs/{jid}/transcript", json={"texts": ["a", "b", "c"]}, headers=h)
    assert busy.status_code == 409


def test_cannot_edit_someone_elses_transcript(client):
    jid = _job(client, auth(register(client)))
    other = auth(register(client, "other@example.com"))
    assert client.put(f"/api/jobs/{jid}/transcript", json={"texts": ["a", "b", "c"]}, headers=other).status_code == 404


def test_download_minutes_as_docx_and_pdf(client):
    h = auth(register(client))
    jid = _job(client, h)
    put_text(files(), minutes_keys(jid)[1], MINUTES)

    docx = client.get(f"/api/jobs/{jid}/download?format=docx", headers=h)
    assert docx.status_code == 200
    assert "wordprocessingml" in docx.headers["content-type"]
    assert "%ED%9A%8C%EC%9D%98%EB%A1%9D.docx" in docx.headers["content-disposition"]  # '회의록.docx'
    paragraphs = [p for p in Document(io.BytesIO(docx.content)).paragraphs if p.text]
    assert paragraphs[0].text == "보고서 회의" and paragraphs[0].style.name == "Title"
    action = next(p for p in paragraphs if "보고서 작성" in p.text)
    assert action.text == "김철수 — 보고서 작성 (마감: 확인 필요)"  # ** 기호는 굵게로 바뀐다
    assert action.runs[0].bold is True

    pdf = client.get(f"/api/jobs/{jid}/download?format=pdf", headers=h)
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF")


def test_markdown_parsing():
    kinds = [b.kind for b in parse(MINUTES) if b.kind != "blank"]
    assert kinds == ["h1", "bullet", "h2", "bullet", "rule", "note"]
    assert runs("**굵게** 보통 **둘") == [("굵게", True), (" 보통 **둘", False)]


# ── 배포 서버(Linux)에서도 PDF·사진 (통합 단계 5-4·5-5) ──


def test_pdf_uses_bundled_korean_font_without_mac_fonts(monkeypatch):
    """Mac 글꼴이 없는 서버에서도 함께 배포한 나눔고딕으로 한글 PDF 를 만든다"""
    from app.features.malmoa.services import export

    monkeypatch.setattr(export, "PDF_FONTS", export.PDF_FONTS[:1])  # 나눔고딕만
    assert export.PDF_FONTS[0][0].is_file() and export.PDF_FONTS[0][2].is_file()
    pdf = export.to_pdf("# 회의록\n\n**결정** 금요일까지 화면 이식\n- 담당: 확인 필요")
    assert pdf.startswith(b"%PDF") and b"NanumGothic" in pdf


def test_pdf_without_any_font_is_clear_error(monkeypatch, tmp_path):
    from app.features.malmoa.services import export

    missing = tmp_path / "none.ttf"
    monkeypatch.setattr(export, "PDF_FONTS", [(missing, 0, missing, 0)])
    with pytest.raises(export.ExportError):
        export.to_pdf("# 회의록")


def test_photo_text_recognition_is_mac_only(client, monkeypatch):
    """Linux 서버에서 사진 작업이 돌면 알 수 없는 오류 대신 'Mac 작업자에서만' 안내로 실패한다"""
    from app.features.malmoa.config import get_settings
    from app.features.malmoa.services import ocr
    from app.features.malmoa.services.transcriber import transcribe_job
    from app.features.malmoa.store import JobStore

    monkeypatch.setattr(ocr.sys, "platform", "linux")
    client.app.state.worker.stop()
    res = client.post("/api/jobs", files={"file": ("보드.png", b"\x89PNG fake", "image/png")})
    job_id = res.json()["id"]
    transcribe_job(job_id, JobStore(), get_settings())
    job = client.get(f"/api/jobs/{job_id}").json()
    assert job["status"] == "FAILED" and job["errorMessage"] == ocr.NOT_ON_MAC
