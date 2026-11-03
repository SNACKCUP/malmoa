"""백그라운드 작업자 — 대기열은 DB(jobs.task)에 있고, 서버 메모리에는 두지 않는다

API 는 할 일을 jobs 행에 적기만 하고(JobStore.enqueue, 202 응답), 작업자가 하나씩 가져가 처리한다.
- 가져가기: SELECT … FOR UPDATE SKIP LOCKED — 서버(작업자)가 여러 대여도 같은 작업을 둘이 가져가지 않는다.
- 생존 신호: 처리하는 동안 HEARTBEAT_SECONDS 마다 heartbeat_at 을 고친다.
- 복구: 생존 신호가 JOB_STALE_SECONDS 넘게 끊긴 작업(서버가 꺼졌거나 재시작)은 다시 대기열로 돌린다.
  다른 서버가 재시작해도 이 서버가 처리 중인 작업은 건드리지 않는다.
- 역할: WORKER_TASKS 에 적힌 일만 가져간다 (예: 배포 서버 minutes, Mac 작업자 transcribe). 비우면 작업자를 띄우지 않는다.

Whisper는 CPU와 메모리를 많이 쓰므로 작업자 하나는 한 번에 한 작업만 처리한다.
"""

import logging
import os
import socket
import threading
import uuid

from app.features.malmoa.config import Settings
from app.features.malmoa.services.minutes import generate_minutes
from app.features.malmoa.services.transcriber import transcribe_job
from app.features.malmoa.store import JobStore

log = logging.getLogger(__name__)

HEARTBEAT_SECONDS = 20


def new_worker_id() -> str:
    """어느 컴퓨터의 어느 프로세스가 가져갔는지 (같은 프로세스 안에서도 작업자마다 다르게)"""
    return f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"


class Worker:
    def __init__(self, store: JobStore, settings: Settings, tasks: tuple[str, ...] | None = None):
        self.store = store
        self.settings = settings
        self.tasks = tuple(settings.worker_tasks if tasks is None else tasks)
        self.id = new_worker_id()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="malmoa-worker", daemon=True)

    def start(self) -> None:
        if self.tasks:
            self._thread.start()
            log.info("작업자 시작: %s (%s)", self.id, ", ".join(self.tasks))

    def stop(self, timeout: float = 5) -> None:
        """새 작업을 더 가져가지 않는다. 처리 중인 작업은 생존 신호가 끊기면 다른 작업자(또는 재시작한 서버)가 이어받는다"""
        self._stop.set()
        self._wake.set()
        if self._thread.is_alive():
            self._thread.join(timeout)

    def wake(self) -> None:
        """같은 서버에서 넣은 작업은 확인 간격을 기다리지 않고 바로 가져간다"""
        self._wake.set()

    def run_once(self) -> bool:
        """끊긴 작업을 복구하고, 맡을 작업이 있으면 하나 처리한다. 처리했으면 True"""
        self.store.recover_stale(self.settings.job_stale_seconds, self.settings.job_max_attempts)
        claimed = self.store.claim(self.id, self.tasks)
        if claimed is None:
            return False
        self._process(*claimed)
        return True

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                worked = self.run_once()
            except Exception:
                log.exception("작업 대기열 확인 실패")
                worked = False
            if not worked:
                self._wake.wait(self.settings.worker_poll_seconds)
                self._wake.clear()

    def _process(self, task: str, job_id: str) -> None:
        done = threading.Event()

        def beat() -> None:
            while not done.wait(HEARTBEAT_SECONDS):
                try:
                    self.store.heartbeat(job_id, self.id)
                except Exception:
                    log.exception("생존 신호 실패: %s", job_id)

        beater = threading.Thread(target=beat, name=f"malmoa-heartbeat-{job_id}", daemon=True)
        beater.start()
        try:
            if task == "transcribe":
                transcribe_job(job_id, self.store, self.settings)
            else:
                generate_minutes(job_id, self.store, self.settings)
        except Exception:
            log.exception("작업 처리 실패: %s", job_id)
        finally:
            done.set()
            beater.join()
            self.store.release(job_id, self.id)
