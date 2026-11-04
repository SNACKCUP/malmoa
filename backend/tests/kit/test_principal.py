"""권한 검사(app.core.principal): auth 가 요청마다 현재 사용자를 채우고, require_* 는 그 칸만 읽습니다."""

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.core.principal import ADMIN_ROLE, require_admin, require_login
from app.users import roles


def test_admin_role_matches_users_role_code():
    """core 의 관리자 역할 값이 roles 테이블의 MASTER 코드와 같아야 합니다."""
    assert ADMIN_ROLE == roles.MASTER


def test_admin_api_without_token_is_401(client):
    response = client.get("/api/users")
    assert response.status_code == 401
    assert response.json()["code"] == "UNAUTHORIZED"
    assert response.headers["WWW-Authenticate"] == "Bearer"


def test_admin_api_for_viewer_is_403(client, make_user, login):
    make_user("viewer01")
    response = client.get("/api/users", headers=login("viewer01"))
    assert response.status_code == 403
    assert response.json()["code"] == "FORBIDDEN"


def test_admin_api_for_master_passes(client, make_user, login):
    make_user("master01", admin=True)
    assert client.get("/api/users", headers=login("master01")).status_code == 200


def test_revoked_master_is_blocked_with_the_same_token(client, make_user, login):
    """역할은 매 요청 DB 에서 읽으므로, 회수하면 이미 받은 토큰으로도 바로 막힙니다 (토큰에 역할을 담지 않는 이유)."""
    make_user("master01", admin=True)
    target = make_user("master02", admin=True)
    target_headers = login("master02")
    assert client.get("/api/users", headers=target_headers).status_code == 200

    response = client.put(f"/api/users/{target.id}/roles", json={"roles": ["VIEWER"]}, headers=login("master01"))
    assert response.status_code == 200, response.text

    assert client.get("/api/users", headers=target_headers).status_code == 403


def test_deactivated_master_is_blocked_with_the_same_token(client, make_user, login):
    make_user("master01", admin=True)
    target = make_user("master02", admin=True)
    target_headers = login("master02")

    response = client.patch(f"/api/users/{target.id}/active", json={"is_active": False}, headers=login("master01"))
    assert response.status_code == 200, response.text

    assert client.get("/api/users", headers=target_headers).status_code == 401


def test_wrong_token_on_public_api_is_ignored(client):
    """틀린 토큰이 붙어 있어도 공개 API 는 그대로 동작합니다. 막는 일은 require_* 만 합니다."""
    response = client.get("/health", headers={"Authorization": "Bearer not-a-token"})
    assert response.status_code == 200


def test_without_load_principal_access_is_closed(client, make_user, login):
    """load_principal 을 등록하지 않은 앱에서는 진짜 MASTER 토큰이어도 401 입니다 (실수하면 열리지 않고 닫힘)."""
    make_user("master01", admin=True)
    headers = login("master01")

    bare = FastAPI()

    @bare.get("/admin-only", dependencies=[Depends(require_admin)])
    def admin_only():
        return {"ok": True}

    @bare.get("/login-only")
    def login_only(_=Depends(require_login)):
        return {"ok": True}

    with TestClient(bare, raise_server_exceptions=False) as bare_client:
        assert bare_client.get("/admin-only", headers=headers).status_code == 401
        assert bare_client.get("/login-only", headers=headers).status_code == 401
