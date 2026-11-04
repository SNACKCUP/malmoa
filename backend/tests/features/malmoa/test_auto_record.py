"""자동 녹음: 결과 보고(한 번만), 녹음과 일정 연결, 탭 생존 신호 사전 경고, 시작 못 한 일정 만료"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import update

from app.features.malmoa.db import SessionLocal
from app.features.malmoa.models import RecorderBeat
from app.features.malmoa.services import auto_record
from features.malmoa.conftest import auth, register

AUDIO = ("회의.webm", b"fake-audio-bytes", "audio/webm")


def _now() -> datetime:
    return datetime.now(UTC).replace(microsecond=0)


def _event(client, h, start: datetime, title: str = "주간 회의", **kw) -> dict:
    body = {"title": title, "startsAt": start.isoformat(), "endsAt": (start + timedelta(hours=1)).isoformat(), "autoRecord": True, **kw}
    res = client.post("/api/events", json=body, headers=h)
    assert res.status_code == 201, res.text
    return res.json()


def _tick(now: datetime) -> list[str]:
    sent: list[str] = []
    with SessionLocal() as db:
        auto_record.tick(db, now, sent.append)
    return sent


def _beat_at(at: datetime) -> None:
    """생존 신호 시각을 점검 시각 기준으로 옮긴다 (신호는 '지금'으로 기록되므로)"""
    with SessionLocal() as db:
        db.execute(update(RecorderBeat).values(at=at))
        db.commit()


def test_report_once(client):
    h = auth(register(client))
    ev = _event(client, h, _now() + timedelta(minutes=1))
    assert ev["autoRecordState"] == "armed"
    res = client.post(f"/api/events/{ev['id']}/auto-record", json={"state": "started"}, headers=h)
    assert res.status_code == 200 and res.json()["autoRecordState"] == "started"
    # 같은 일정을 다른 탭이 또 보고하면 거절 (녹음은 하나만)
    assert client.post(f"/api/events/{ev['id']}/auto-record", json={"state": "started"}, headers=h).status_code == 409

    other = _event(client, h, _now() + timedelta(minutes=2), title="수동 회의", autoRecord=False)
    assert client.post(f"/api/events/{other['id']}/auto-record", json={"state": "started"}, headers=h).status_code == 409

    failed = _event(client, h, _now() + timedelta(minutes=3), title="권한 없는 회의")
    res = client.post(f"/api/events/{failed['id']}/auto-record", json={"state": "failed", "note": "마이크 사용 권한이 거부되었습니다."}, headers=h)
    assert res.json()["autoRecordState"] == "failed" and res.json()["autoRecordNote"].startswith("마이크")


def test_upload_links_event(client):
    h = auth(register(client))
    ev = _event(client, h, _now() + timedelta(minutes=1))
    res = client.post("/api/jobs", files={"file": AUDIO}, data={"source": "recording", "event_id": ev["id"]}, headers=h)
    assert res.status_code == 201, res.text
    job = res.json()
    assert client.get(f"/api/events/{ev['id']}", headers=h).json()["jobId"] == job["id"]

    # 다른 사람 일정·이상한 ID에는 연결하지 않고, 파일도 받지 않는다
    other = auth(register(client, "other@example.com"))
    assert client.post("/api/jobs", files={"file": AUDIO}, data={"event_id": ev["id"]}, headers=other).status_code == 400
    assert client.post("/api/jobs", files={"file": AUDIO}, data={"event_id": "not-a-uuid"}, headers=h).status_code == 400

    # 녹음하는 사이 일정을 지웠으면 연결 없이 받는다
    gone = _event(client, h, _now() + timedelta(minutes=2), title="지운 회의")
    assert client.delete(f"/api/events/{gone['id']}", headers=h).status_code == 204
    res = client.post("/api/jobs", files={"file": AUDIO}, data={"source": "recording", "event_id": gone["id"]}, headers=h)
    assert res.status_code == 201, res.text


def test_pre_warning_uses_heartbeat(client):
    h = auth(register(client))
    start = _now() + timedelta(minutes=30)
    _event(client, h, start, title="탭 없음")
    # 5분 전보다 이르면 아직 점검하지 않음
    assert _tick(start - timedelta(minutes=6)) == []
    sent = _tick(start - timedelta(minutes=4))
    assert len(sent) == 1 and "탭 없음" in sent[0] and "탭이 열려 있지 않습니다" in sent[0]
    assert _tick(start - timedelta(minutes=3)) == []  # 한 번만

    start2 = _now() + timedelta(minutes=40)
    _event(client, h, start2, title="권한 확인")
    assert client.post("/api/recorder/heartbeat", json={"micPermission": "prompt"}, headers=h).status_code == 204
    # 신호는 '지금' 시각으로 기록되므로 점검 시각도 지금 기준으로 맞춘다
    _beat_at(start2 - timedelta(minutes=5))
    sent = _tick(start2 - timedelta(minutes=4))
    assert len(sent) == 1 and "마이크 권한" in sent[0]

    start3 = _now() + timedelta(minutes=50)
    _event(client, h, start3, title="준비 완료")
    client.post("/api/recorder/heartbeat", json={"micPermission": "granted"}, headers=h)
    _beat_at(start3 - timedelta(minutes=5))
    # 앞의 '탭 없음' 일정은 이 시각에 만료 알림이 나가지만, '준비 완료'는 경고하지 않는다
    assert [m for m in _tick(start3 - timedelta(minutes=4)) if "준비 완료" in m] == []


def test_not_started_expires_to_skipped(client):
    h = auth(register(client))
    start = _now() + timedelta(minutes=1)
    ev = _event(client, h, start, title="닫힌 탭")
    assert _tick(start + timedelta(minutes=9)) == []  # 허용 범위 안: 아직 기다림
    sent = _tick(start + timedelta(minutes=11))
    assert len(sent) == 1 and "닫힌 탭" in sent[0]
    row = client.get(f"/api/events/{ev['id']}", headers=h).json()
    assert row["autoRecordState"] == "skipped" and "탭" in row["autoRecordNote"]
    # 이미 건너뛴 일정에는 늦은 보고를 받지 않는다
    assert client.post(f"/api/events/{ev['id']}/auto-record", json={"state": "started"}, headers=h).status_code == 409
