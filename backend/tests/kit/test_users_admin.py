def test_non_master_cannot_list_members(client, make_user, login):
    make_user("user01")
    response = client.get("/api/users", headers=login("user01"))
    assert response.status_code == 403


def test_master_lists_members(client, make_user, login):
    make_user("admin01", admin=True)
    make_user("user01")
    response = client.get("/api/users", headers=login("admin01"))
    assert response.status_code == 200
    login_ids = [u["user_id"] for u in response.json()["items"]]
    assert {"admin01", "user01"} <= set(login_ids)


def test_master_grants_multiple_roles(client, make_user, login):
    make_user("admin01", admin=True)
    user = make_user("user01")
    admin_headers = login("admin01")

    response = client.put(
        f"/api/users/{user.id}/roles", json={"roles": ["WRITER", "MASTER"]}, headers=admin_headers
    )
    assert response.status_code == 200
    assert [r["name"] for r in response.json()["roles"]] == ["MASTER", "WRITER"]

    # 새 역할은 다음 요청부터 바로 적용 (토큰에 역할을 넣지 않고 DB에서 읽기 때문)
    assert client.get("/api/users", headers=login("user01")).status_code == 200


def test_unknown_role_rejected(client, make_user, login):
    make_user("admin01", admin=True)
    user = make_user("user01")
    response = client.put(
        f"/api/users/{user.id}/roles",
        json={"roles": ["SUPERUSER"]},
        headers=login("admin01"),
    )
    assert response.status_code == 422


def test_admin_cannot_change_self(client, make_user, login):
    admin = make_user("admin01", admin=True)
    headers = login("admin01")
    assert client.put(
        f"/api/users/{admin.id}/roles", json={"roles": ["VIEWER"]}, headers=headers
    ).status_code == 400
    assert client.patch(
        f"/api/users/{admin.id}/active", json={"is_active": False}, headers=headers
    ).status_code == 400


def test_deactivated_user_cannot_login_or_use_token(client, make_user, login):
    make_user("admin01", admin=True)
    user = make_user("user01")
    user_headers = login("user01")

    response = client.patch(
        f"/api/users/{user.id}/active",
        json={"is_active": False},
        headers=login("admin01"),
    )
    assert response.status_code == 200
    assert response.json()["is_active"] is False

    assert client.get("/api/auth/me", headers=user_headers).status_code == 401
    blocked = client.post("/api/auth/login", json={"user_id": "user01", "password": "password123"})
    assert blocked.status_code == 401


def test_member_search_filters_and_paging(client, make_user, login):
    make_user("admin01", admin=True)
    for i in range(5):
        make_user(f"kim{i:02d}", name=f"김{i}")
    make_user("lee01", name="이씨")
    headers = login("admin01")

    page1 = client.get("/api/users", params={"q": "kim", "page": 1, "size": 2}, headers=headers).json()
    assert page1["total"] == 5 and page1["page"] == 1 and page1["size"] == 2
    assert [u["user_id"] for u in page1["items"]] == ["kim04", "kim03"]  # 최근 가입 순
    page3 = client.get("/api/users", params={"q": "kim", "page": 3, "size": 2}, headers=headers).json()
    assert [u["user_id"] for u in page3["items"]] == ["kim00"]

    by_name = client.get("/api/users", params={"q": "이씨"}, headers=headers).json()
    assert [u["user_id"] for u in by_name["items"]] == ["lee01"]

    masters = client.get("/api/users", params={"role_id": 1}, headers=headers).json()
    assert [u["user_id"] for u in masters["items"]] == ["admin01"]

    # LIKE 특수문자는 글자 그대로 검색
    assert client.get("/api/users", params={"q": "%"}, headers=headers).json()["total"] == 0
    assert client.get("/api/users", params={"size": 101}, headers=headers).status_code == 422


def test_member_status_filter(client, make_user, login):
    make_user("admin01", admin=True)
    blocked = make_user("blocked01")
    gone = make_user("gone01")
    make_user("active01")
    headers = login("admin01")
    client.patch(f"/api/users/{blocked.id}/active", json={"is_active": False}, headers=headers)
    assert client.delete(f"/api/users/{gone.id}", headers=headers).status_code == 204

    def ids(status):
        body = client.get("/api/users", params={"status": status}, headers=headers).json()
        return {u["user_id"] for u in body["items"]}

    assert ids("inactive") == {"blocked01"}
    assert ids("deleted") == {"gone01"}
    assert "gone01" not in ids("active") and "blocked01" not in ids("active")


def test_admin_delete_is_soft_and_restorable(client, db, make_user, login):
    make_user("admin01", admin=True)
    user = make_user("user01")
    headers = login("admin01")
    assert client.delete(f"/api/users/{user.id}", headers=headers).status_code == 204
    db.refresh(user)
    assert user.deactivated_at is not None and user.deleted_at is None

    restored = client.patch(f"/api/users/{user.id}/active", json={"is_active": True}, headers=headers)
    assert restored.status_code == 200
    assert restored.json()["deactivated_at"] is None
    assert client.post("/api/auth/login", json={"user_id": "user01", "password": "password123"}).status_code == 200


def test_admin_unlocks_locked_user(client, db, make_user, login):
    from datetime import UTC, datetime, timedelta

    make_user("admin01", admin=True)
    user = make_user("user01")
    user.locked_until = datetime.now(UTC) + timedelta(minutes=5)
    db.commit()
    client.patch(f"/api/users/{user.id}/active", json={"is_active": True}, headers=login("admin01"))
    assert client.post("/api/auth/login", json={"user_id": "user01", "password": "password123"}).status_code == 200


def test_non_master_roles_cannot_use_admin_apis(client, make_user, login, db):
    from app.users import service

    owner = make_user("owner01")
    target = make_user("user01")
    admin = make_user("admin01", admin=True)
    service.update_roles(db, admin, owner.id, ["OWNER", "WRITER"])
    headers = login("owner01")
    assert client.get("/api/users", headers=headers).status_code == 403
    assert client.delete(f"/api/users/{target.id}", headers=headers).status_code == 403
    assert client.put(f"/api/users/{target.id}/roles", json={"roles": ["MASTER"]}, headers=headers).status_code == 403


def test_roles_list(client, make_user, login):
    make_user("user01")
    roles = client.get("/api/users/roles", headers=login("user01")).json()
    assert [(r["id"], r["name"]) for r in roles] == [(1, "MASTER"), (2, "OWNER"), (3, "VIEWER"), (4, "WRITER")]


def test_response_shows_lock_and_active_toggle_clears_it(client, db, make_user, login):
    from datetime import UTC, datetime, timedelta

    make_user("admin01", admin=True)
    user = make_user("user01")
    user.locked_until = datetime.now(UTC) + timedelta(minutes=5)
    db.commit()
    headers = login("admin01")

    listed = client.get("/api/users", params={"q": "user01"}, headers=headers).json()["items"][0]
    assert listed["locked_until"] is not None  # 관리자 화면의 "잠김" 표시에 씀

    response = client.patch(f"/api/users/{user.id}/active", json={"is_active": True}, headers=headers)
    assert response.status_code == 200
    assert response.json()["locked_until"] is None
