"""일정 알람: 제때 한 번만 울리기, 놓친 알람 처리, 저장 직후 울리지 않기, 시작 시각 변경, 화면 알림 API"""

from datetime import UTC, datetime, timedelta

from app.features.malmoa.db import SessionLocal
from app.features.malmoa.services.reminders import tick
from features.malmoa.conftest import auth, register


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _event(client, h, start: datetime, reminders: list[int], title: str = "주간 회의", **kw) -> dict:
    body = {"title": title, "startsAt": _iso(start), "endsAt": _iso(start + timedelta(hours=1)), "reminders": reminders, **kw}
    res = client.post("/api/events", json=body, headers=h)
    assert res.status_code == 201, res.text
    return res.json()


def _tick(now: datetime) -> list[str]:
    sent: list[str] = []
    with SessionLocal() as db:
        tick(db, now, lambda _t, m: sent.append(m))
    return sent


def _now() -> datetime:
    return datetime.now(UTC).replace(microsecond=0)


def test_fires_once_at_the_right_time(client):
    h = auth(register(client))
    start = _now() + timedelta(hours=2)
    _event(client, h, start, [10, 0], location="3층 회의실")

    assert _tick(start - timedelta(minutes=11)) == []  # 아직
    sent = _tick(start - timedelta(minutes=10) + timedelta(seconds=20))
    assert len(sent) == 1 and sent[0].startswith("10분 뒤 시작 · ") and "주간 회의" in sent[0] and sent[0].endswith("3층 회의실")
    assert _tick(start - timedelta(minutes=9)) == []  # 다시 울리지 않음 (서버를 껐다 켜도 기록이 DB에 있음)
    assert [m.split(" · ")[0] for m in _tick(start + timedelta(seconds=30))] == ["지금 시작"]
    assert _tick(start + timedelta(minutes=1)) == []


def test_missed_reminders_collapse_into_one(client):
    h = auth(register(client))
    start = _now() + timedelta(hours=3)
    _event(client, h, start, [1440, 60, 30, 10])

    # 서버가 꺼져 있다가 시작 20분 전에 켜짐: 1시간 전·30분 전을 놓침 → "곧 시작" 한 번만
    sent = _tick(start - timedelta(minutes=20))
    assert len(sent) == 1 and sent[0].startswith("곧 시작 (20분 뒤)")
    # 10분 전 알람은 제때 울린다
    assert [m.split(" · ")[0] for m in _tick(start - timedelta(minutes=10))] == ["10분 뒤 시작"]


def test_missed_after_start_is_silent(client):
    h = auth(register(client))
    start = _now() + timedelta(hours=1)
    _event(client, h, start, [10])
    # 시작하고 1분 뒤에야 켜짐: 10분 전 알람은 조용히 넘김
    assert _tick(start + timedelta(minutes=1)) == []
    assert _tick(start + timedelta(minutes=1, seconds=30)) == []


def test_saving_does_not_fire_past_reminders(client):
    h = auth(register(client))
    # 5분 뒤 시작하는 일정에 하루 전·10분 전 알람: 이미 지난 시점이라 울리지 않고, 정시 알람만 남는다
    start = _now() + timedelta(minutes=5)
    _event(client, h, start, [1440, 10, 0])
    assert _tick(_now()) == []
    assert [m.split(" · ")[0] for m in _tick(start)] == ["지금 시작"]


def test_moving_start_resets_reminders(client):
    h = auth(register(client))
    start = _now() + timedelta(hours=2)
    ev = _event(client, h, start, [10])
    assert len(_tick(start - timedelta(minutes=10))) == 1

    # 제목만 바꾸면 다시 울리지 않는다
    body = {"title": "제목 변경", "startsAt": _iso(start), "endsAt": _iso(start + timedelta(hours=1)), "reminders": [10]}
    assert client.put(f"/api/events/{ev['id']}", json=body, headers=h).status_code == 200
    assert _tick(start - timedelta(minutes=9)) == []

    # 하루 뒤로 옮기면 새 시각에 맞춰 다시 울린다
    later = start + timedelta(days=1)
    body = {"title": "제목 변경", "startsAt": _iso(later), "endsAt": _iso(later + timedelta(hours=1)), "reminders": [10]}
    assert client.put(f"/api/events/{ev['id']}", json=body, headers=h).status_code == 200
    assert len(_tick(later - timedelta(minutes=10))) == 1


def test_fired_reminders_api_is_private(client):
    owner = register(client, "owner@example.com")
    other = register(client, "other@example.com")
    since = _now() - timedelta(minutes=1)
    # 이미 시작 직전인 일정: 바로 다음 tick에 "지금 시작"
    start = _now() + timedelta(seconds=30)
    ev = _event(client, auth(owner), start, [0])
    _tick(start)

    res = client.get("/api/events/reminders", params={"since": _iso(since)}, headers=auth(owner))
    assert res.status_code == 200, res.text
    items = res.json()["reminders"]
    assert len(items) == 1 and items[0]["eventId"] == ev["id"] and items[0]["message"].startswith("지금 시작")
    assert client.get("/api/events/reminders", params={"since": _iso(since)}, headers=auth(other)).json()["reminders"] == []
    # since 이후 것만
    later = _iso(_now() + timedelta(hours=1))
    assert client.get("/api/events/reminders", params={"since": later}, headers=auth(owner)).json()["reminders"] == []
    assert client.get("/api/events/reminders", params={"since": "2026-10-29T10:00:00"}, headers=auth(owner)).status_code == 400


# ── 무료 서버가 잠들었다 깨는 경우 · 서버 여러 대 ──


def test_after_wake_missed_reminder_is_found_with_since(client):
    """서버가 잠든 사이 알람 시각이 지남 → 깨어난 첫 검사에서 규칙대로 처리하고, 화면은 잠들기 전 since 로 그 알림을 받는다"""
    h = auth(register(client))
    since = _now()  # 화면이 마지막으로 알림을 받아 간 시각 (서버가 잠들기 전)
    start = _now() + timedelta(minutes=40)
    soon = _event(client, h, start, [30], title="곧 시작할 회의")
    _event(client, h, _now() + timedelta(minutes=5), [10], title="저장 때 이미 지난 알람")  # 저장할 때 처리됨 → 울리지 않음
    begun_start = _now() + timedelta(minutes=8)
    _event(client, h, begun_start, [5], title="잠든 사이 시작한 회의")

    # 시작 30분 전 알람(=10분 뒤)을 놓치고, 시작 20분 전에 깨어남. 그사이 '잠든 사이 시작한 회의'는 이미 시작했다
    woke = start - timedelta(minutes=20)
    sent = _tick(woke)
    assert len(sent) == 1 and sent[0].startswith("곧 시작 (20분 뒤)") and "곧 시작할 회의" in sent[0]

    items = client.get("/api/events/reminders", params={"since": _iso(since)}, headers=h).json()["reminders"]
    assert [(i["eventId"], i["message"]) for i in items] == [(soon["id"], sent[0])]
    # 같은 since 로 다시 물어도 같은 하나 (중복으로 울리지 않음), 깨어난 뒤 검사가 또 돌아도 새 알림 없음
    assert _tick(woke + timedelta(seconds=30)) == []
    assert len(client.get("/api/events/reminders", params={"since": _iso(since)}, headers=h).json()["reminders"]) == 1


def test_only_one_server_checks_at_a_time(client, monkeypatch):
    from sqlalchemy import func, select

    from app.features.malmoa.db import engine
    from app.features.malmoa.services import auto_record, reminders

    calls: list[str] = []
    monkeypatch.setattr(reminders, "tick", lambda db: calls.append("tick"))
    monkeypatch.setattr(auto_record, "tick", lambda db: calls.append("auto"))

    with engine.connect() as other_server:
        assert other_server.execute(select(func.pg_try_advisory_lock(reminders.LOCK_KEY))).scalar()
        assert reminders.check_once() is False  # 다른 서버가 검사 중 → 건너뜀
        assert calls == []
        other_server.execute(select(func.pg_advisory_unlock(reminders.LOCK_KEY)))
        other_server.commit()
    assert reminders.check_once() is True
    assert calls == ["tick", "auto"]
    assert reminders.check_once() is True  # 잠금은 검사가 끝나면 풀린다


def test_two_servers_checking_together_fire_once(client, monkeypatch):
    import threading
    import uuid

    from sqlalchemy import update

    from app.features.malmoa.models import Event
    from app.features.malmoa.services import reminders

    h = auth(register(client))
    ev = _event(client, h, _now() + timedelta(hours=1), [0], title="동시에 검사")
    with SessionLocal() as db:  # 지금 막 시작한 일정으로 옮긴다 (알람 기록은 아직 없음 → 다음 검사에서 '지금 시작')
        db.execute(update(Event).where(Event.id == uuid.UUID(ev["id"])).values(starts_at=_now() - timedelta(seconds=30)))
        db.commit()
    fired: list[str] = []
    monkeypatch.setattr(reminders, "mac_notify", lambda title, message: fired.append(message))
    gate = threading.Barrier(2)

    def server() -> None:
        gate.wait()
        reminders.check_once()

    threads = [threading.Thread(target=server) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(fired) == 1 and fired[0].startswith("지금 시작")
    assert reminders.check_once() is True and len(fired) == 1  # 다음 검사에서도 다시 울리지 않음


def test_messages_use_app_timezone_not_server_timezone(client, monkeypatch):
    from datetime import UTC

    from app.features.malmoa.services.reminders import _local_hm

    monkeypatch.setenv("TZ", "UTC")  # 배포 서버처럼
    assert _local_hm(datetime(2026, 11, 3, 0, 30, tzinfo=UTC)) == "09:30"  # APP_TIMEZONE 기본값 Asia/Seoul
