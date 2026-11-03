"""회의 참석자: 명단 등록 · 회의별 참석자 · 회의록 반영"""

import json
from datetime import UTC, datetime

from app.features.malmoa.schemas.jobs import Attendee, Job
from app.features.malmoa.services.minutes import (
    Minutes,
    _final_prompt_from_transcript,
    render_markdown,
)
from features.malmoa.conftest import auth, files, register

AUDIO = ("회의.m4a", b"fake-audio-bytes", "audio/mp4")


def test_people_roster_crud(client):
    token = register(client)
    h = auth(token)
    a = client.post("/api/people", json={"name": "  홍길동 ", "role": "기획팀"}, headers=h)
    assert a.status_code == 201, a.text
    assert a.json()["name"] == "홍길동"
    client.post("/api/people", json={"name": "강감찬", "role": ""}, headers=h)

    people = client.get("/api/people", headers=h).json()["people"]
    assert [(p["name"], p["role"]) for p in people] == [("강감찬", None), ("홍길동", "기획팀")]

    dup = client.post("/api/people", json={"name": "홍길동"}, headers=h)
    assert dup.status_code == 409
    assert "이미 명단" in dup.json()["detail"]
    assert client.post("/api/people", json={"name": "   "}, headers=h).status_code == 422

    pid = a.json()["id"]
    upd = client.put(f"/api/people/{pid}", json={"name": "홍길동", "role": "개발팀"}, headers=h)
    assert upd.json()["role"] == "개발팀"
    assert client.delete(f"/api/people/{pid}", headers=h).status_code == 204
    assert [p["name"] for p in client.get("/api/people", headers=h).json()["people"]] == ["강감찬"]


def test_people_are_private(client):
    owner = register(client, "owner@example.com")
    other = register(client, "other@example.com")
    pid = client.post("/api/people", json={"name": "홍길동"}, headers=auth(owner)).json()["id"]

    assert client.get("/api/people", headers=auth(other)).json()["people"] == []
    assert client.delete(f"/api/people/{pid}", headers=auth(other)).status_code == 404
    # 같은 이름이라도 사용자마다 따로 등록할 수 있다
    assert client.post("/api/people", json={"name": "홍길동"}, headers=auth(other)).status_code == 201


def test_upload_with_attendees_and_edit_later(client):
    h = auth(register(client))
    attendees = [{"name": "홍길동", "role": "기획팀"}, {"name": "강감찬"}, {"name": "홍길동", "role": "중복"}]
    job = client.post("/api/jobs", files={"file": AUDIO}, data={"attendees": json.dumps(attendees)}, headers=h).json()
    assert job["attendees"] == [{"name": "홍길동", "role": "기획팀"}, {"name": "강감찬", "role": None}]

    res = client.put(f"/api/jobs/{job['id']}/attendees", json={"attendees": [{"name": "이순신", "role": "팀장"}]}, headers=h)
    assert res.status_code == 200, res.text
    assert client.get(f"/api/jobs/{job['id']}", headers=h).json()["attendees"] == [{"name": "이순신", "role": "팀장"}]

    # 명단에서 지워도 지난 회의 참석자는 그대로
    pid = client.post("/api/people", json={"name": "이순신"}, headers=h).json()["id"]
    client.delete(f"/api/people/{pid}", headers=h)
    assert client.get(f"/api/jobs/{job['id']}", headers=h).json()["attendees"][0]["name"] == "이순신"

    # 참석자 없는 업로드는 빈 목록
    plain = client.post("/api/jobs", files={"file": AUDIO}, headers=h).json()
    assert plain["attendees"] == []


def test_bad_attendees_are_rejected(client):
    h = auth(register(client))
    before = len(files().list("uploads/"))
    for raw in ("not json", json.dumps([{"name": ""}]), json.dumps([{"name": "가" * 51}])):
        res = client.post("/api/jobs", files={"file": AUDIO}, data={"attendees": raw}, headers=h)
        assert res.status_code == 400, raw
        assert "참석자" in res.json()["detail"]
    assert len(files().list("uploads/")) == before  # 거부된 업로드는 저장하지 않는다


def test_other_user_cannot_edit_attendees(client):
    owner = register(client, "owner@example.com")
    other = register(client, "other@example.com")
    job = client.post("/api/jobs", files={"file": AUDIO}, headers=auth(owner)).json()
    res = client.put(f"/api/jobs/{job['id']}/attendees", json={"attendees": [{"name": "홍길동"}]}, headers=auth(other))
    assert res.status_code == 404


def _job(attendees: list[Attendee]) -> Job:
    ts = datetime(2026, 10, 28, 1, 0, tzinfo=UTC)
    return Job(
        id="00000000-0000-0000-0000-000000000001",
        user_id=2,
        file_name="회의.m4a",
        stored_name="x.m4a",
        source="recording",
        created_at=ts,
        updated_at=ts,
        size_bytes=1,
        duration_sec=600,
        attendees=attendees,
    )


def test_minutes_show_registered_attendees():
    md = render_markdown(Minutes(title="주간 회의"), _job([Attendee(name="홍길동", role="기획팀"), Attendee(name="강감찬")]))
    assert "- 참석자: 홍길동(기획팀), 강감찬" in md
    assert "- 참석자: 확인 필요 (등록되지 않음)" in render_markdown(Minutes(), _job([]))


def test_minutes_prompt_lists_attendees_with_rules():
    prompt = _final_prompt_from_transcript("[00:00:01] 홍길동 님이 자료를 준비해 주세요", [Attendee(name="홍길동", role="기획팀")])
    assert "<참석자>\n- 홍길동(기획팀)\n</참석자>" in prompt
    assert "원문에서 이름이 나오지 않은 할 일에 참석자를 담당자로 넣지 않는다" in prompt
    assert "<참석자>" not in _final_prompt_from_transcript("[00:00:01] 안녕하세요", [])
