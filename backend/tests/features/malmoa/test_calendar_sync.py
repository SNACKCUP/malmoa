"""Mac 캘린더 앱 내보내기: 켜기·끄기, 저장·수정·삭제 반영, 실패해도 일정 저장, 다시 시도 (가짜 캘린더 사용)"""

from datetime import datetime, timedelta, timezone

from features.malmoa.conftest import auth, register

KST = timezone(timedelta(hours=9))


def _body(days: int = 1, **kw) -> dict:
    start = datetime.now(KST).replace(hour=10, minute=0, second=0, microsecond=0) + timedelta(days=days)
    body = {"title": "주간 회의", "startsAt": start.isoformat(), "endsAt": (start + timedelta(hours=1)).isoformat(), "reminders": [10]}
    body.update(kw)
    return body


def _enable(client, h) -> dict:
    res = client.put("/api/events/calendar-sync", json={"enabled": True}, headers=h)
    assert res.status_code == 200, res.text
    return res.json()


def test_off_by_default_and_nothing_exported(client, calendar):
    h = auth(register(client))
    res = client.get("/api/events/calendar-sync", headers=h)
    assert res.status_code == 200 and res.json() == {"enabled": False, "available": True, "calendarName": "Malmoa", "failed": 0}
    ev = client.post("/api/events", json=_body(), headers=h).json()
    assert ev["calendarSynced"] is False and calendar.calls == 0


def test_enable_exports_upcoming_only(client, calendar):
    h = auth(register(client))
    client.post("/api/events", json=_body(days=2, title="앞으로"), headers=h)
    client.post("/api/events", json=_body(days=-3, title="지난 일정"), headers=h)
    assert _enable(client, h)["enabled"] is True
    # 켜면 아직 끝나지 않은 일정만 내보낸다 (메모·참석자는 넘기지 않음)
    assert [e[0] for e in calendar.events.values()] == ["앞으로"]


def test_save_update_delete_follow(client, calendar):
    h = auth(register(client))
    _enable(client, h)
    ev = client.post("/api/events", json=_body(location="3층"), headers=h).json()
    assert ev["calendarSynced"] is True and ev["calendarError"] is None
    (uid, fields), = calendar.events.items()
    assert fields[:3] == ["주간 회의", "3층", "0"] and fields[5] == "10"

    # 메모만 고치면 캘린더 앱은 건드리지 않는다
    calls = calendar.calls
    client.put(f"/api/events/{ev['id']}", json=_body(location="3층", memo="안건 정리"), headers=h)
    assert calendar.calls == calls and list(calendar.events) == [uid]

    # 시간·알림을 고치면 다시 만들고 예전 것은 지운다
    client.put(f"/api/events/{ev['id']}", json=_body(days=2, location="3층", reminders=[0, 30]), headers=h)
    (uid2, fields2), = calendar.events.items()
    assert uid2 != uid and fields2[5] == "0,30"

    assert client.delete(f"/api/events/{ev['id']}", headers=h).status_code == 204
    assert calendar.events == {}


def test_failure_keeps_event_and_retry(client, calendar):
    h = auth(register(client))
    _enable(client, h)
    calendar.error = "캘린더 앱에 'Malmoa' 캘린더가 없습니다."
    res = client.post("/api/events", json=_body(), headers=h)
    assert res.status_code == 201  # 말모아 저장은 성공
    ev = res.json()
    assert ev["calendarSynced"] is False and "Malmoa" in ev["calendarError"]
    assert client.get("/api/events/calendar-sync", headers=h).json()["failed"] == 1

    calendar.error = None
    ev = client.post(f"/api/events/{ev['id']}/sync", headers=h).json()
    assert ev["calendarSynced"] is True and ev["calendarError"] is None
    assert client.get("/api/events/calendar-sync", headers=h).json()["failed"] == 0


def test_enable_refused_when_calendar_missing(client, calendar):
    h = auth(register(client))
    calendar.error = "캘린더 앱에 'Malmoa' 캘린더가 없습니다."
    res = client.put("/api/events/calendar-sync", json={"enabled": True}, headers=h)
    assert res.status_code == 400 and "Malmoa" in res.json()["detail"]
    assert client.get("/api/events/calendar-sync", headers=h).json()["enabled"] is False


def test_disable_stops_export_and_retry_refused(client, calendar):
    h = auth(register(client))
    _enable(client, h)
    ev = client.post("/api/events", json=_body(), headers=h).json()
    assert client.put("/api/events/calendar-sync", json={"enabled": False}, headers=h).json()["enabled"] is False
    calls = calendar.calls
    client.put(f"/api/events/{ev['id']}", json=_body(days=3), headers=h)
    assert calendar.calls == calls  # 끄면 더 내보내지 않는다 (이미 내보낸 일정은 캘린더 앱에 남음)
    assert client.post(f"/api/events/{ev['id']}/sync", headers=h).status_code == 400
