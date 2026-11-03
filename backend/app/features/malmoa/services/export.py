"""회의록 Markdown → Word(.docx) · PDF 파일

말모아 회의록은 render_markdown이 만드는 단순한 형식만 쓴다:
  # 제목 / ## 구획 / ### 소주제 / - 목록 / **굵게** / --- / *기울임 한 줄*
사용자가 직접 고친 내용도 이 범위 밖이면 일반 문단으로 넣는다 (글자는 빠뜨리지 않는다).
"""

import io
import re
from dataclasses import dataclass
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor
from fpdf import FPDF

# PDF에 넣을 한글 글꼴, 앞에서부터 있는 것을 쓴다. (일반체 파일, 번호, 굵은체 파일, 번호) — TTC는 묶음 안의 번호
# 함께 배포하는 나눔고딕(OFL, fonts/README.md)을 먼저 써서 Mac·배포 서버(Linux)의 PDF 모양을 같게 한다 (통합 단계 5-5)
FONTS_DIR = Path(__file__).resolve().parents[1] / "fonts"
PDF_FONTS = [
    (FONTS_DIR / "NanumGothic-Regular.ttf", 0, FONTS_DIR / "NanumGothic-Bold.ttf", 0),
    (Path("/System/Library/Fonts/AppleSDGothicNeo.ttc"), 0, Path("/System/Library/Fonts/AppleSDGothicNeo.ttc"), 6),
    (Path("/System/Library/Fonts/Supplemental/AppleGothic.ttf"), 0, Path("/System/Library/Fonts/Supplemental/AppleGothic.ttf"), 0),
]
WORD_FONT = "Apple SD Gothic Neo"  # Windows Word에는 없어서 맑은 고딕 등으로 대신 보인다


class ExportError(Exception):
    """사용자에게 그대로 보여 줄 수 있는 내보내기 오류"""


@dataclass(frozen=True)
class Block:
    kind: str  # h1 | h2 | h3 | bullet | para | note | rule | blank
    text: str = ""


def parse(markdown: str) -> list[Block]:
    blocks: list[Block] = []
    for raw in markdown.splitlines():
        line = raw.rstrip()
        s = line.strip()
        if not s:
            blocks.append(Block("blank"))
        elif s.startswith("### "):
            blocks.append(Block("h3", s[4:]))
        elif s.startswith("## "):
            blocks.append(Block("h2", s[3:]))
        elif s.startswith("# "):
            blocks.append(Block("h1", s[2:]))
        elif s in ("---", "***", "___"):
            blocks.append(Block("rule"))
        elif s.startswith(("- ", "* ", "+ ")):
            blocks.append(Block("bullet", s[2:]))
        elif len(s) > 2 and s.startswith("*") and s.endswith("*") and not s.startswith("**"):
            blocks.append(Block("note", s[1:-1]))
        else:
            blocks.append(Block("para", s))
    return blocks


def runs(text: str) -> list[tuple[str, bool]]:
    """'**굵게**' 표시를 (글자, 굵게?) 조각으로. 짝이 안 맞는 ** 는 글자 그대로 둔다"""
    parts = re.split(r"\*\*(.+?)\*\*", text)
    return [(p, i % 2 == 1) for i, p in enumerate(parts) if p]


# ---------- Word ----------


def to_docx(markdown: str) -> bytes:
    doc = Document()
    for name, size in (("Normal", 10.5), ("Title", 22), ("Heading 1", 15), ("Heading 2", 12.5), ("List Bullet", 10.5)):
        style = doc.styles[name]
        style.font.name = WORD_FONT
        style.element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), WORD_FONT)
        style.font.size = Pt(size)

    def add_runs(par, text: str, italic: bool = False) -> None:
        for chunk, bold in runs(text):
            r = par.add_run(chunk)
            r.bold = bold or None
            r.italic = italic or None

    for b in parse(markdown):
        if b.kind == "h1":
            add_runs(doc.add_paragraph(style="Title"), b.text)
        elif b.kind == "h2":
            add_runs(doc.add_paragraph(style="Heading 1"), b.text)
        elif b.kind == "h3":
            add_runs(doc.add_paragraph(style="Heading 2"), b.text)
        elif b.kind == "bullet":
            add_runs(doc.add_paragraph(style="List Bullet"), b.text)
        elif b.kind == "note":
            p = doc.add_paragraph()
            add_runs(p, b.text, italic=True)
            for r in p.runs:
                r.font.color.rgb = RGBColor(0x60, 0x60, 0x60)
                r.font.size = Pt(9)
        elif b.kind == "rule":
            doc.add_paragraph("─" * 30).alignment = WD_ALIGN_PARAGRAPH.CENTER
        elif b.kind == "para":
            add_runs(doc.add_paragraph(), b.text)
        # blank: Word 문단 간격으로 충분하다
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# ---------- PDF ----------


def _pdf() -> FPDF:
    for regular, regular_no, bold, bold_no in PDF_FONTS:
        if regular.is_file() and bold.is_file():
            pdf = FPDF(format="A4")
            pdf.add_font("ko", "", str(regular), collection_font_number=regular_no)
            pdf.add_font("ko", "B", str(bold), collection_font_number=bold_no)
            return pdf
    raise ExportError("PDF에 쓸 한글 글꼴을 찾지 못했습니다. Word나 Markdown으로 받아 주세요.")


def to_pdf(markdown: str) -> bytes:
    pdf = _pdf()
    pdf.set_margins(20, 18, 20)
    pdf.set_auto_page_break(True, margin=18)
    pdf.add_page()
    left = pdf.l_margin

    def write(text: str, size: float, height: float, bold_all: bool = False, gray: bool = False) -> None:
        pdf.set_text_color(96 if gray else 0)
        for chunk, bold in runs(text):
            pdf.set_font("ko", "B" if bold or bold_all else "", size)
            pdf.write(height, chunk)
        pdf.ln(height)

    for b in parse(markdown):
        if b.kind == "h1":
            write(b.text, 18, 9, bold_all=True)
            pdf.ln(2)
        elif b.kind == "h2":
            pdf.ln(3)
            write(b.text, 13.5, 7.5, bold_all=True)
            pdf.set_draw_color(180)
            pdf.line(left, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
            pdf.ln(2)
        elif b.kind == "h3":
            pdf.ln(1)
            write(b.text, 11.5, 6.5, bold_all=True)
        elif b.kind == "bullet":
            pdf.set_font("ko", "", 10.5)
            pdf.set_text_color(0)
            pdf.set_x(left + 2)
            pdf.cell(5, 6, "•")
            pdf.set_left_margin(left + 7)  # 줄이 넘어가도 글머리표 뒤에 맞춘다
            write(b.text, 10.5, 6)
            pdf.set_left_margin(left)
        elif b.kind == "note":
            write(b.text, 9, 5, gray=True)
        elif b.kind == "rule":
            pdf.ln(2)
            pdf.set_draw_color(200)
            pdf.line(left, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
            pdf.ln(3)
        elif b.kind == "para":
            write(b.text, 10.5, 6)
        else:
            pdf.ln(2)
    return bytes(pdf.output())
