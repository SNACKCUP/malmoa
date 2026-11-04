"""공통 오류 형식 {"detail","code","request_id"}, 요청 ID, 접근 로그, 상태 점검"""

import logging

from fastapi import APIRouter
from fastapi.testclient import TestClient

from app.core.exceptions import NotFoundError
from app.main import create_app


def _assert_error(response, status: int, code: str):
    assert response.status_code == status
    body = response.json()
    assert body["code"] == code
    assert isinstance(body["detail"], str) and body["detail"]
    assert body["request_id"] == response.headers["x-request-id"]
    return body


def test_app_error_keeps_message_and_adds_code(client, make_user):
    make_user("user01")
    response = client.post("/api/auth/login", json={"user_id": "user01", "password": "wrong-pass"})
    body = _assert_error(response, 401, "INVALID_CREDENTIALS")
    assert body["detail"] == "아이디 또는 비밀번호가 올바르지 않습니다."


def test_http_exception_gets_same_shape(client):
    _assert_error(client.get("/api/auth/me"), 401, "UNAUTHORIZED")
    _assert_error(client.get("/api/nope"), 404, "NOT_FOUND")


def test_forbidden_from_permissions(client, make_user, login):
    make_user("user01")
    _assert_error(client.get("/api/users", headers=login("user01")), 403, "FORBIDDEN")


def test_validation_error_has_readable_detail_and_fields(client):
    response = client.post("/api/auth/login", json={"user_id": "a"})
    body = _assert_error(response, 422, "VALIDATION_ERROR")
    assert "password" in body["detail"]
    assert body["errors"][0]["field"] == "password"


def test_rate_limit_keeps_retry_after(client):
    client.post("/api/auth/email/send-code", json={"email": "a@example.com"})
    response = client.post("/api/auth/email/send-code", json={"email": "a@example.com"})
    _assert_error(response, 429, "RATE_LIMITED")
    assert int(response.headers["retry-after"]) > 0


def _app_with_routes():
    app = create_app()
    router = APIRouter()

    @router.get("/boom")
    def boom():
        raise RuntimeError("내부 비밀 메시지")

    @router.get("/missing")
    def missing():
        raise NotFoundError("THING_NOT_FOUND", "찾을 수 없습니다.")

    app.include_router(router, prefix="/test")
    return app


def test_unhandled_error_returns_500_with_request_id_and_logs_stack(caplog):
    client = TestClient(_app_with_routes(), raise_server_exceptions=False)
    with caplog.at_level(logging.ERROR, logger="app.error"):
        logging.getLogger("app").propagate = True  # caplog 가 받도록 테스트 동안만
        try:
            response = client.get("/test/boom")
        finally:
            logging.getLogger("app").propagate = False
    body = _assert_error(response, 500, "INTERNAL_ERROR")
    assert "비밀" not in body["detail"]  # 내부 메시지는 응답에 넣지 않음
    record = next(r for r in caplog.records if r.name == "app.error")
    assert record.request_id == body["request_id"]
    assert record.exc_info is not None


def test_custom_app_error_subclass():
    client = TestClient(_app_with_routes())
    _assert_error(client.get("/test/missing"), 404, "THING_NOT_FOUND")


def test_request_id_is_reused_when_safe_and_replaced_when_not(client):
    ok = client.get("/health", headers={"X-Request-ID": "abc-123"})
    assert ok.headers["x-request-id"] == "abc-123"
    bad = client.get("/health", headers={"X-Request-ID": "bad id\nINJECTED"})
    assert bad.headers["x-request-id"] != "bad id\nINJECTED"
    assert len(bad.headers["x-request-id"]) == 32


def test_access_log_has_no_query_string(client, caplog):
    logging.getLogger("app").propagate = True
    try:
        with caplog.at_level(logging.INFO, logger="app.access"):
            client.get("/api/auth/check-user-id", params={"user_id": "secret_value"})
    finally:
        logging.getLogger("app").propagate = False
    line = next(r for r in caplog.records if r.name == "app.access")
    assert line.path == "/api/auth/check-user-id" and line.status == 200
    assert "secret_value" not in line.getMessage()


def test_health_ready_checks_database(client):
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/health/ready").json() == {"status": "ok", "database": "ok"}


def test_health_ready_returns_503_when_db_down(client, monkeypatch):
    import app.main as main_module

    class Broken:
        def __enter__(self):
            raise ConnectionError("db down")

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(main_module, "SessionLocal", lambda: Broken())
    _assert_error(client.get("/health/ready"), 503, "DB_UNAVAILABLE")


def test_json_log_format(monkeypatch):
    import json

    from app.core.logging import JsonFormatter, RequestIdFilter

    record = logging.LogRecord("app.x", logging.INFO, __file__, 1, "안녕 %s", ("세상",), None)
    RequestIdFilter().filter(record)
    record.status = 200
    data = json.loads(JsonFormatter().format(record))
    assert data["message"] == "안녕 세상" and data["level"] == "INFO" and data["status"] == 200
    assert "request_id" in data
