"""말모아 Mac 작업자 — 음성 인식(Whisper)·사진 글자 인식(Apple Vision)을 작업자 API 로 가져가 처리한다 (통합 단계 5-3)

Mac 에는 작업자 열쇠와 API 주소만 둔다 (DB 비밀번호·저장소 키 없음). 서버를 쓸데없이 깨우지 않도록
정한 시간(기본 평일 08~20시)에만 할 일을 묻는다. 시간 밖에 바로 처리하려면 --now.

  uv run python scripts/malmoa_worker.py              계속 돌기 (Mac 로그인 때 자동 시작: scripts/malmoa_worker_launchd.sh)
  uv run python scripts/malmoa_worker.py --now        시간과 상관없이 지금 있는 일을 모두 처리하고 끝
  uv run python scripts/malmoa_worker.py new-token    새 열쇠 만들기 (열쇠 → Mac 설정 파일, 해시 → 서버 .env)

설정 (환경 변수 또는 --env-file, 기본 ~/.malmoa-worker.env — 권한 600 으로 둔다):
  MALMOA_API_URL                 예: https://malmoa-api.example.com (끝의 /api 없이)
  MALMOA_WORKER_TOKEN            작업자 열쇠
  MALMOA_WORKER_HOURS            묻는 시간, 기본 "mon-fri 08-20" (요일 범위 시작-끝시)
  MALMOA_WORKER_TZ               시간대, 기본 Asia/Seoul
  MALMOA_WORKER_POLL_SECONDS     평소 묻는 간격, 기본 90
Whisper 모델·구간 길이 등 변환 설정은 서버와 같은 이름(WHISPER_MODEL 등)을 쓴다.
"""

import argparse
import hashlib
import logging
import os
import secrets
import socket
import sys
import tempfile
import threading
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.features.malmoa.config import Settings
from app.features.malmoa.services.transcriber import run_transcription

log = logging.getLogger("malmoa.worker")

DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
HEARTBEAT_SECONDS = 20
BACKOFF_MINUTES = (2, 4, 8, 15)  # 서버가 응답하지 않으면 묻는 간격을 늘린다 (응답하면 원래대로)
DEFAULT_ENV_FILE = Path.home() / ".malmoa-worker.env"


def new_worker_id() -> str:
    """어느 Mac 의 어느 프로세스인지 (services/worker.py 와 같은 모양 — 그 모듈은 DB 를 불러와서 여기서 따로 만든다)"""
    return f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"


# ── 묻는 시간 ──


@dataclass(frozen=True)
class Hours:
    days: frozenset[int]  # 0=월 … 6=일
    start: int  # 시작 시 (포함)
    end: int  # 끝 시 (포함하지 않음)

    @classmethod
    def parse(cls, text: str) -> "Hours":
        """"mon-fri 08-20" → 월~금 08:00~19:59. 요일 하나("sat 10-12")·하루 종일("mon-sun 0-24")도 된다"""
        try:
            day_part, hour_part = text.strip().lower().split()
            d1, _, d2 = day_part.partition("-")
            a, b = DAYS.index(d1), DAYS.index(d2 or d1)
            days = frozenset(range(a, b + 1)) if a <= b else frozenset([*range(a, 7), *range(b + 1)])
            h1, h2 = (int(x) for x in hour_part.split("-"))
        except ValueError:
            raise ValueError(f'MALMOA_WORKER_HOURS 형식이 틀렸습니다: "{text}" (예: "mon-fri 08-20")') from None
        if not (0 <= h1 < h2 <= 24):
            raise ValueError(f'MALMOA_WORKER_HOURS 시각이 틀렸습니다: "{text}" (0~24, 시작 < 끝)')
        return cls(days, h1, h2)

    def contains(self, moment: datetime) -> bool:
        return moment.weekday() in self.days and self.start <= moment.hour < self.end


def backoff_seconds(failures: int, poll_seconds: float) -> float:
    """연속 실패 수 → 다음에 묻기까지. 0 이면 평소 간격"""
    if failures <= 0:
        return poll_seconds
    return BACKOFF_MINUTES[min(failures, len(BACKOFF_MINUTES)) - 1] * 60


# ── 작업자 API ──


class ServerUnavailable(Exception):
    """서버가 응답하지 않음 (잠듦·네트워크) — 간격을 늘려 다시 묻는다"""


class WorkerApi:
    def __init__(self, base_url: str, token: str, worker_id: str, client: httpx.Client | None = None):
        self.worker_id = worker_id
        self.client = client or httpx.Client(base_url=base_url.rstrip("/"), timeout=httpx.Timeout(30, read=120))
        self.headers = {"Authorization": f"Bearer {token}", "X-Malmoa-Worker": worker_id}

    def _req(self, method: str, path: str, **kw) -> httpx.Response:
        try:
            res = self.client.request(method, f"/api/worker{path}", headers=self.headers, **kw)
        except httpx.TransportError as e:
            raise ServerUnavailable(type(e).__name__) from e
        if res.status_code >= 500:
            raise ServerUnavailable(f"HTTP {res.status_code}")
        if res.status_code == 401:
            raise SystemExit("작업자 열쇠가 맞지 않습니다 (MALMOA_WORKER_TOKEN 과 서버의 MALMOA_WORKER_TOKEN_HASH 확인).")
        return res

    def claim(self) -> dict | None:
        res = self._req("POST", "/claim", json={"worker": self.worker_id, "tasks": ["transcribe"]})
        if res.status_code == 204:
            return None
        res.raise_for_status()
        return res.json()

    def download(self, job_id: str, dest: Path) -> None:
        try:
            with self.client.stream("GET", f"/api/worker/jobs/{job_id}/source", headers=self.headers) as res:
                if res.status_code == 404:
                    raise FileNotFoundError(job_id)
                res.raise_for_status()
                with dest.open("wb") as out:
                    for chunk in res.iter_bytes():
                        out.write(chunk)
        except httpx.TransportError as e:
            raise ServerUnavailable(type(e).__name__) from e

    def report(self, job_id: str, **fields) -> bool:
        """진행 상황·생존 신호. 이 작업이 더는 내 것이 아니면 False"""
        res = self._req("POST", f"/jobs/{job_id}/report", json=fields)
        return res.status_code != 409

    def finish(self, job_id: str, segments: list[dict] | None, timed: bool, stage: str) -> None:
        self._req("PUT", f"/jobs/{job_id}/transcript", json={"segments": segments, "timed": timed, "stage": stage}).raise_for_status()

    def fail(self, job_id: str, message: str) -> None:
        self._req("POST", f"/jobs/{job_id}/fail", json={"message": message}).raise_for_status()


class RemoteJobIO:
    """transcriber.JobIO 의 작업자 API 판 — 변환 과정은 서버와 같은 run_transcription 을 쓴다"""

    def __init__(self, api: WorkerApi, job: dict, work_dir: Path):
        self.api, self.job_id, self.stored_name, self.work_dir = api, job["jobId"], job["storedName"], work_dir

    def has_transcript(self) -> bool:
        return False  # 이미 변환된 작업은 서버가 claim 때 걸러 낸다

    def report(self, *, start: bool = False, stage: str | None = None, progress: int | None = None, duration_sec: float | None = None) -> None:
        fields = {k: v for k, v in (("stage", stage), ("progress", progress), ("durationSec", duration_sec)) if v is not None}
        self.api.report(self.job_id, start=start, **fields)

    @contextmanager
    def original(self):
        self.work_dir.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix="malmoa-src-", suffix=Path(self.stored_name).suffix, dir=self.work_dir)
        os.close(fd)
        path = Path(name)
        try:
            self.api.download(self.job_id, path)
            yield path
        finally:
            path.unlink(missing_ok=True)  # 받은 원본은 쓰고 바로 지운다

    def finish(self, segments: list[dict] | None, *, timed: bool, stage: str) -> None:
        self.api.finish(self.job_id, segments, timed, stage)

    def fail(self, message: str) -> None:
        self.api.fail(self.job_id, message)


def process(api: WorkerApi, job: dict, settings: Settings) -> None:
    """가져온 작업 하나. 처리하는 동안 생존 신호를 보낸다 (끊기면 서버가 다시 대기열로)"""
    done = threading.Event()

    def beat() -> None:
        while not done.wait(HEARTBEAT_SECONDS):
            try:
                api.report(job["jobId"])
            except (ServerUnavailable, httpx.HTTPError):
                log.warning("생존 신호 실패: %s", job["jobId"])

    beater = threading.Thread(target=beat, name="malmoa-worker-heartbeat", daemon=True)
    beater.start()
    try:
        log.info("변환 시작: %s (%s, %dB)", job["jobId"], job["source"], job["sizeBytes"])
        run_transcription(job["jobId"], job["source"], settings, RemoteJobIO(api, job, settings.work_dir))
    finally:
        done.set()
        beater.join()


def drain(api: WorkerApi, settings: Settings) -> int:
    """지금 있는 일을 모두 처리한다. 처리한 수"""
    n = 0
    while job := api.claim():
        process(api, job, settings)
        n += 1
    return n


def run_forever(api: WorkerApi, settings: Settings, hours: Hours, tz: ZoneInfo, poll_seconds: float) -> None:
    failures = 0
    log.info("작업자 시작: %s (묻는 시간 %s, %s)", api.worker_id, os.environ.get("MALMOA_WORKER_HOURS", "mon-fri 08-20"), tz.key)
    while True:
        if hours.contains(datetime.now(tz)):
            try:
                if drain(api, settings):
                    log.info("대기열을 비웠습니다")
                failures = 0
            except ServerUnavailable as e:
                failures += 1
                log.warning("서버가 응답하지 않음 (%s) — %d분 뒤 다시", e, backoff_seconds(failures, poll_seconds) // 60)
        time.sleep(backoff_seconds(failures, poll_seconds))


# ── 설정·명령 ──


def load_env_file(path: Path) -> None:
    """KEY=VALUE 줄을 환경 변수로 (이미 있는 환경 변수가 우선). 없으면 건너뜀"""
    if not path.is_file():
        return
    if path.stat().st_mode & 0o077:
        log.warning("%s 를 다른 사용자도 읽을 수 있습니다. chmod 600 으로 바꾸세요.", path)
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.split(" #")[0].strip().strip('"').strip("'"))


def new_token() -> None:
    token = secrets.token_urlsafe(32)
    print("작업자 열쇠 (Mac 의 ~/.malmoa-worker.env 에 MALMOA_WORKER_TOKEN=… 으로, 다른 곳에 두지 마세요):")
    print(f"  {token}")
    print("서버 .env 에 넣을 해시:")
    print(f"  MALMOA_WORKER_TOKEN_HASH={hashlib.sha256(token.encode()).hexdigest()}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="말모아 Mac 작업자 (음성 인식·사진 글자 인식)")
    parser.add_argument("command", nargs="?", choices=["run", "new-token"], default="run")
    parser.add_argument("--now", action="store_true", help="시간과 상관없이 지금 있는 일을 모두 처리하고 끝낸다")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # 요청마다 남는 기록은 끈다 (실패는 따로 남긴다)

    if args.command == "new-token":
        new_token()
        return 0

    load_env_file(args.env_file)
    url, token = os.environ.get("MALMOA_API_URL", ""), os.environ.get("MALMOA_WORKER_TOKEN", "")
    if not url or not token:
        print(f"MALMOA_API_URL 과 MALMOA_WORKER_TOKEN 이 필요합니다 ({args.env_file} 또는 환경 변수).", file=sys.stderr)
        return 2
    settings = Settings(worker_tasks=())  # 변환 설정(WHISPER_MODEL 등)만 쓴다. DB·저장소는 쓰지 않는다
    api = WorkerApi(url, token, new_worker_id())
    if args.now:
        try:
            n = drain(api, settings)
        except ServerUnavailable as e:
            print(f"서버가 응답하지 않습니다 ({e}). 잠시 뒤 다시 실행하세요.", file=sys.stderr)
            return 1
        print(f"처리한 작업: {n}개")
        return 0
    hours = Hours.parse(os.environ.get("MALMOA_WORKER_HOURS", "mon-fri 08-20"))
    run_forever(api, settings, hours, ZoneInfo(os.environ.get("MALMOA_WORKER_TZ", "Asia/Seoul")), float(os.environ.get("MALMOA_WORKER_POLL_SECONDS", "90")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
