"""캘린더 구독 주소 (ICS, 통합 단계 5-6, 결정 C: 제목·시각·장소·메모·참석자·알람, 녹음·회의록은 넣지 않음)"""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.features.malmoa.db import engine
from app.features.malmoa.services import ics
from app.users import repository as users_repository
from app.users.models import User
from features.malmoa.conftest import auth, register

SEOUL = ZoneInfo("Asia/Seoul")


def add_event(client, headers=None, **extra) -> dict:
    start = datetime.now(SEOUL).replace(microsecond=0) + timedelta(days=1)
    body = {"title": "주간 회의", "startsAt": start.isoformat(), "endsAt": (start + timedelta(hours=1)).isoformat(), "location": "3층 회의실", "memo": "예산 검토", "attendees": [{"name": "김회의", "role": "팀장"}], "reminders": [10, 0], **extra}
    res = client.post("/api/events", json=body, headers=headers or {})
    assert res.status_code == 201, res.text
    return res.json()


def feed_path(client, headers=None) -> str:
    res = client.post("/api/calendar-feed", headers=headers or {})
    assert res.status_code == 201, res.text
    return res.json()["path"]


def test_off_by_default_then_create_and_fetch(client):
    assert client.get("/api/calendar-feed").json() == {"enabled": False, "createdAt": None}
    add_event(client)
    path = feed_path(client)
    assert path.startswith("/api/calendar-feed/") and path.endswith(".ics")
    assert client.get("/api/calendar-feed").json()["enabled"] is True
    res = client.get(path, headers={"X-Test-User": ""})  # 캘린더 앱은 로그인하지 않는다
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/calendar")
    body = res.text
    assert body.startswith("BEGIN:VCALENDAR\r\n") and body.endswith("END:VCALENDAR\r\n")
    for part in ("SUMMARY:주간 회의", "LOCATION:3층 회의실", "예산 검토", "참석자: 김회의(팀장)", "TRIGGER:-PT10M", "TRIGGER:PT0M", "X-WR-CALNAME:말모아"):
        assert part in body.replace("\r\n ", ""), part


def test_feed_works_without_any_login(real_client):
    member = register(real_client)
    from features.malmoa.conftest import bearer

    add_event(real_client, bearer(member))
    path = feed_path(real_client, bearer(member))
    assert real_client.get(path).status_code == 200  # Authorization 헤더 없이


def test_regenerate_invalidates_old_and_delete_turns_off(client):
    old = feed_path(client)
    new = feed_path(client)
    assert old != new
    assert client.get(old).status_code == 404
    assert client.get(new).status_code == 200
    assert client.delete("/api/calendar-feed").status_code == 204
    assert client.get(new).status_code == 404
    assert client.get("/api/calendar-feed").json()["enabled"] is False


def test_only_my_events_and_no_recordings(client):
    mine = add_event(client, title="내 회의")
    other = register(client)
    add_event(client, auth(other), title="남의 회의")
    body = client.get(feed_path(client)).text
    assert "내 회의" in body and "남의 회의" not in body
    assert mine["id"] in body
    for secret in ("transcript", "minutes", "/api/jobs", "moa-"):
        assert secret not in body


def test_bad_or_unknown_token_is_404(client):
    assert client.get("/api/calendar-feed/짧음.ics").status_code == 404
    assert client.get("/api/calendar-feed/" + "A" * 43 + ".ics").status_code == 404


def test_unapproved_or_deactivated_owner_feed_is_404(client):
    path = feed_path(client)
    me = client.get("/api/calendar-feed")  # 기본 회원 만들어짐
    assert me.status_code == 200
    with Session(engine) as db:
        user = db.query(User).filter_by(login_id="malmoa-default").one()
        user.roles = users_repository.get_roles_by_codes(db, ["VIEWER"])
        db.commit()
        assert client.get(path).status_code == 404  # 승인 취소
        user.roles = users_repository.get_roles_by_codes(db, ["OWNER"])
        db.commit()
        assert client.get(path).status_code == 200
        db.execute(update(User).where(User.id == user.id).values(deactivated_at=datetime.now(UTC)))
        db.commit()
    assert client.get(path).status_code == 404  # 탈퇴


def test_all_day_event_uses_dates(client):
    day = datetime(2026, 12, 24, tzinfo=SEOUL)
    add_event(client, title="성탄 휴무", allDay=True, startsAt=day.isoformat(), endsAt=(day + timedelta(days=2)).isoformat(), reminders=[], memo=None, attendees=[], location=None)
    body = client.get(feed_path(client)).text
    assert "DTSTART;VALUE=DATE:20261224" in body and "DTEND;VALUE=DATE:20261226" in body


def test_escape_and_fold():
    assert ics.escape("a,b;c\\d\n줄") == "a\\,b\\;c\\\\d\\n줄"
    line = "DESCRIPTION:" + "가" * 60
    folded = ics.fold(line)
    assert all(len(part.encode()) <= 75 for part in folded.split("\r\n"))
    assert folded.replace("\r\n ", "") == line
