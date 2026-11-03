"""사진 속 글자 읽기 (화이트보드 사진 → 텍스트)

macOS 내장 글자 인식(Apple Vision)을 이 Mac 안에서 실행한다. 사진은 외부로 보내지 않는다.
결과는 음성 원문과 같은 형식(segments)으로 돌려줘, 결과 화면·복사·회의록 작성을 그대로 쓴다.
"""

import sys
from pathlib import Path

LOW_CONFIDENCE = 0.4  # 이보다 낮으면 화면에서 '확인 필요'로 표시
NOT_ON_MAC = "사진 글자 인식은 Mac 작업자에서만 할 수 있습니다. Mac 작업자가 켜져 있으면 다시 시도해 주세요."


class OcrError(Exception):
    """사용자에게 그대로 보여 줄 수 있는 글자 인식 오류"""


def _orientation(path: Path) -> int:
    """휴대폰 사진의 회전 정보(EXIF). 없으면 1(정방향)."""
    import Quartz
    from Foundation import NSURL

    src = Quartz.CGImageSourceCreateWithURL(NSURL.fileURLWithPath_(str(path)), None)
    if src is None:
        raise OcrError("사진을 열 수 없습니다. 손상되었거나 지원하지 않는 형식일 수 있습니다.")
    props = Quartz.CGImageSourceCopyPropertiesAtIndex(src, 0, None) or {}
    return int(props.get(Quartz.kCGImagePropertyOrientation, 1))


def read_text(path: Path) -> list[dict]:
    """사진의 글자를 위→아래, 왼쪽→오른쪽 순서의 줄 목록으로 돌려준다.
    Apple Vision 은 macOS 에만 있다 — 배포 서버(Linux)에서는 하지 않고 Mac 작업자가 한다 (통합 단계 5-4)."""
    if sys.platform != "darwin":
        raise OcrError(NOT_ON_MAC)
    try:
        import Vision
        from Foundation import NSURL
    except ImportError:  # Mac 이지만 작업자 의존성(worker 그룹)이 없음
        raise OcrError("이 Mac 에 글자 인식 모듈이 없습니다. backend 폴더에서 uv sync 를 실행하세요.") from None

    request = Vision.VNRecognizeTextRequest.alloc().init()
    request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
    request.setRecognitionLanguages_(["ko-KR", "en-US"])
    request.setUsesLanguageCorrection_(True)

    handler = Vision.VNImageRequestHandler.alloc().initWithURL_orientation_options_(
        NSURL.fileURLWithPath_(str(path)), _orientation(path), None
    )
    ok, err = handler.performRequests_error_([request], None)
    if not ok:
        raise OcrError(f"사진에서 글자를 읽지 못했습니다. ({err.localizedDescription() if err else '알 수 없는 오류'})")

    lines = []
    for obs in request.results() or []:
        cand = obs.topCandidates_(1)
        if not cand:
            continue
        text = str(cand[0].string()).strip()
        if not text:
            continue
        box = obs.boundingBox()  # 0~1 비율, 원점은 왼쪽 아래
        lines.append({"text": text, "confidence": round(float(cand[0].confidence()), 2),
                      "top": 1 - (box.origin.y + box.size.height), "left": box.origin.x, "height": box.size.height})

    # 같은 높이(줄 높이의 절반 이내)에 있는 글은 한 줄로 보고 왼쪽부터
    lines.sort(key=lambda l: l["top"])
    rows: list[list[dict]] = []
    for line in lines:
        if rows and abs(rows[-1][0]["top"] - line["top"]) < rows[-1][0]["height"] / 2:
            rows[-1].append(line)
        else:
            rows.append([line])
    segments = []
    for row in rows:
        row.sort(key=lambda l: l["left"])
        segments.append({
            "start": 0.0,
            "end": 0.0,
            "text": "  ".join(l["text"] for l in row),
            "confidence": min(l["confidence"] for l in row),
        })
    return segments
