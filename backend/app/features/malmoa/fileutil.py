"""DB 없이 쓰는 파일 도우미 — Mac 작업자(scripts/malmoa_worker.py)도 불러오므로 DB·meerkit 설정을 import 하지 않는다"""

import json
import os
from pathlib import Path


def write_json_atomic(path: Path, data: object) -> None:
    """임시 파일에 쓴 뒤 교체해, 중간에 끊겨도 파일이 깨지지 않게 한다."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)
