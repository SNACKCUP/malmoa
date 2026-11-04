"""캘린더 일정: 추가·조회·수정·삭제, 입력 확인, 자동 녹음 상태, 본인 일정만"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import update

from app.features.malmoa.db import engine
from app.features.malmoa.models import Event as EventRow
from features.malmoa.conftest import auth, register

KST = timezone(timedelta(hours=9))
AUDIO = ("회의.m4a", b"fake-audio-bytes", "audio/mp4")


def _at(days: int, hour: int, minute: int = 0) -> datetime:
    """오늘(한국 시각) 기준 며칠 뒤 몇 시"""
    today = datetime.now(KST).replace(hour=0, minute=0, second=0, microsecond=0)
    return today + timedelta(days=days, hours=hour, minutes=minute)


def _body(**kw) -> dict:
    body = {"title": "주간 회의", "startsAt": _at(1, 10).isoformat(), "endsAt": _at(1, 11).isoformat()}
    body.update(kw)
    return body


def _titles(client, h: dict, start: datetime, end: datetime) -> list[str]:
    res = client.get("/api/events", params={"from": start.isoformat(), "to": end.isoformat()}, headers=h)
    assert res.status_code == 200, res.text
    return [e["title"] for e in res.json()["events"]]


def _set_state(event_id: str, state: str) -> None:
    with engine.begin() as conn:
        conn.execute(update(EventRow).where(EventRow.id == event_id).values(auto_record_state=state))


def test_event_crud_and_range(client):
    h = auth(register(client))
    a = client.post(
        "/api/events",
        json=_body(
            title="  주간 회의 ",
            location=" 3층 회의실 ",
            memo="",
            attendees=[{"name": "홍길동", "role": "기획팀"}, {"name": "홍길동"}, {"name": "강감찬"}],
            reminders=[10, 0, 10, 1440],
        ),
        headers=h,
    )
    assert a.status_code == 201, a.text
    ev = a.json()
    assert ev["title"] == "주간 회의" and ev["location"] == "3층 회의실" and ev["memo"] is None
    assert ev["kind"] == "meeting" and ev["allDay"] is False
    assert [x["name"] for x in ev["attendees"]] == ["홍길동", "강감찬"]
    assert ev["reminders"] == [1440, 10, 0]
    assert ev["autoRecord"] is False and ev["autoRecordState"] == "none" and ev["jobId"] is None

    client.post("/api/events", json=_body(title="점심", kind="other", startsAt=_at(1, 12).isoformat(), endsAt=_at(1, 13).isoformat()), headers=h)
    client.post("/api/events", json=_body(title="다음 주", startsAt=_at(8, 9).isoformat(), endsAt=_at(8, 10).isoformat()), headers=h)
    client.post("/api/events", json=_body(title="종일", allDay=True, startsAt=_at(1, 0).isoformat(), endsAt=_at(2, 0).isoformat()), headers=h)

    # 내일 하루와 겹치는 일정 (시작 시각순): 종일 일정은 00:00부터
    assert _titles(client, h, _at(1, 0), _at(2, 0)) == ["종일", "주간 회의", "점심"]
    # 걸쳐 있는 일정도 포함: 10:30~10:45 구간은 주간 회의(10~11)·종일과 겹침
    assert _titles(client, h, _at(1, 10, 30), _at(1, 10, 45)) == ["종일", "주간 회의"]
    # 끝나는 순간에 시작하는 구간은 겹치지 않음
    assert _titles(client, h, _at(1, 11), _at(1, 12)) == ["종일"]

    upd = client.put(f"/api/events/{ev['id']}", json=_body(title="주간 회의 (변경)", reminders=[]), headers=h)
    assert upd.status_code == 200, upd.text
    assert upd.json()["title"] == "주간 회의 (변경)" and upd.json()["reminders"] == [] and upd.json()["attendees"] == []
    assert client.get(f"/api/events/{ev['id']}", headers=h).json()["title"] == "주간 회의 (변경)"

    assert client.delete(f"/api/events/{ev['id']}", headers=h).status_code == 204
    assert client.get(f"/api/events/{ev['id']}", headers=h).status_code == 404
    assert client.delete(f"/api/events/{ev['id']}", headers=h).status_code == 404


def test_event_validation(client):
    h = auth(register(client))

    def post(**kw):
        return client.post("/api/events", json=_body(**kw), headers=h)

    res = post(endsAt=_at(1, 10).isoformat())
    assert res.status_code == 400 and "종료 시각" in res.json()["detail"]
    assert post(endsAt=_at(40, 10).isoformat()).status_code == 400
    assert post(startsAt="2026-11-01T10:00:00").status_code == 422  # 시간대 없음
    assert post(reminders=[15]).status_code == 422
    assert post(title="   ").status_code == 422
    assert post(kind="party").status_code == 422
    assert post(title="가" * 101).status_code == 422

    res = post(kind="other", autoRecord=True)
    assert res.status_code == 400 and "회의 일정" in res.json()["detail"]
    res = post(allDay=True, autoRecord=True)
    assert res.status_code == 400 and "종일" in res.json()["detail"]
    past = datetime.now(KST) - timedelta(minutes=30)
    res = post(startsAt=past.isoformat(), endsAt=(past + timedelta(hours=1)).isoformat(), autoRecord=True)
    assert res.status_code == 400 and "지난 일정" in res.json()["detail"]
    # 시작한 지 10분이 안 됐으면 아직 걸 수 있다
    recent = datetime.now(KST) - timedelta(minutes=5)
    assert post(startsAt=recent.isoformat(), endsAt=(recent + timedelta(hours=1)).isoformat(), autoRecord=True).status_code == 201
    # 지난 일정 자체는 자동 녹음 없이 기록할 수 있다
    assert post(startsAt=past.isoformat(), endsAt=(past + timedelta(hours=1)).isoformat()).status_code == 201

    params = {"from": _at(0, 0).isoformat(), "to": _at(500, 0).isoformat()}
    assert client.get("/api/events", params=params, headers=h).status_code == 400
    params = {"from": "2026-11-01T00:00:00", "to": "2026-11-02T00:00:00"}
    assert client.get("/api/events", params=params, headers=h).status_code == 400
    assert client.get("/api/events", headers=h).status_code == 422


def test_auto_record_state(client):
    h = auth(register(client))
    ev = client.post("/api/events", json=_body(autoRecord=True), headers=h).json()
    assert ev["autoRecord"] is True and ev["autoRecordState"] == "armed"

    # 시각을 그대로 두고 제목만 고치면 진행 상태 유지
    _set_state(ev["id"], "started")
    same = client.put(f"/api/events/{ev['id']}", json=_body(title="이름만 변경", autoRecord=True), headers=h).json()
    assert same["autoRecordState"] == "started"
    # 시작 시각을 바꾸면 다시 대기
    moved = client.put(f"/api/events/{ev['id']}", json=_body(startsAt=_at(2, 10).isoformat(), endsAt=_at(2, 11).isoformat(), autoRecord=True), headers=h).json()
    assert moved["autoRecordState"] == "armed"
    # 끄면 none
    off = client.put(f"/api/events/{ev['id']}", json=_body(startsAt=_at(2, 10).isoformat(), endsAt=_at(2, 11).isoformat()), headers=h).json()
    assert off["autoRecord"] is False and off["autoRecordState"] == "none"
    # 다시 켜면 대기
    on = client.put(f"/api/events/{ev['id']}", json=_body(startsAt=_at(2, 10).isoformat(), endsAt=_at(2, 11).isoformat(), autoRecord=True), headers=h).json()
    assert on["autoRecordState"] == "armed"


def test_events_are_private(client):
    owner = register(client, "owner@example.com")
    other = register(client, "other@example.com")
    ev = client.post("/api/events", json=_body(), headers=auth(owner)).json()

    assert client.get(f"/api/events/{ev['id']}", headers=auth(other)).status_code == 404
    assert client.put(f"/api/events/{ev['id']}", json=_body(), headers=auth(other)).status_code == 404
    assert client.delete(f"/api/events/{ev['id']}", headers=auth(other)).status_code == 404
    params = {"from": _at(0, 0).isoformat(), "to": _at(3, 0).isoformat()}
    assert client.get("/api/events", params=params, headers=auth(other)).json()["events"] == []
    assert client.get("/api/events/not-a-uuid", headers=auth(owner)).status_code == 404


def test_deleting_job_keeps_event(client):
    h = auth(register(client))
    job = client.post("/api/jobs", files={"file": AUDIO}, headers=h).json()
    ev = client.post("/api/events", json=_body(), headers=h).json()
    with engine.begin() as conn:
        conn.execute(update(EventRow).where(EventRow.id == ev["id"]).values(job_id=job["id"]))
    assert client.get(f"/api/events/{ev['id']}", headers=h).json()["jobId"] == job["id"]

    # 작업을 지우면 일정은 남고 연결만 끊긴다
    assert client.delete(f"/api/jobs/{job['id']}", headers=h).status_code == 204
    assert client.get(f"/api/events/{ev['id']}", headers=h).json()["jobId"] is None
    # 일정을 지워도 작업은 지워지지 않는다
    job2 = client.post("/api/jobs", files={"file": AUDIO}, headers=h).json()
    with engine.begin() as conn:
        conn.execute(update(EventRow).where(EventRow.id == ev["id"]).values(job_id=job2["id"]))
    assert client.delete(f"/api/events/{ev['id']}", headers=h).status_code == 204
    assert client.get(f"/api/jobs/{job2['id']}", headers=h).status_code == 200
