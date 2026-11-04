"""공통코드 킷 모듈(app/codes): 공용 테이블 + owner 구분, 조회(로그인), 관리(MASTER), 서비스용 검사 함수."""

import pytest
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.codes import is_valid_code, list_codes, require_code
from app.codes.models import Code, CodeGroup
from app.core.exceptions import AppError


@pytest.fixture
def seed_codes(db):
    """서비스가 자기 마이그레이션에서 넣는 것과 같은 모양의 테스트용 묶음.

    owner 는 테스트 전용 SVC 입니다. 서비스가 마이그레이션으로 넣는 묶음과 겹치지 않게 합니다.
    """
    db.add_all(
        [
            CodeGroup(group_code="SVC_REQ_KIND", owner="SVC", name="요구사항 구분"),
            CodeGroup(group_code="SVC_OLD", owner="SVC", name="꺼진 묶음", is_active=False),
            CodeGroup(group_code="MEERKIT_SAMPLE", owner="MEERKIT", name="킷 묶음"),
        ]
    )
    db.flush()
    db.add_all(
        [
            Code(group_code="SVC_REQ_KIND", code="NON_FUNCTIONAL", label="비기능", sort_order=2),
            Code(group_code="SVC_REQ_KIND", code="FUNCTIONAL", label="기능", sort_order=1),
            Code(group_code="SVC_REQ_KIND", code="CONSTRAINT", label="제약사항", sort_order=3, is_active=False),
            Code(group_code="SVC_OLD", code="A", label="에이", sort_order=1),
            Code(group_code="MEERKIT_SAMPLE", code="X", label="엑스", sort_order=1),
        ]
    )
    db.commit()


# ---- 조회 API (로그인한 사람) ----


def test_read_requires_login(client, seed_codes):
    assert client.get("/api/codes").status_code == 401
    assert client.get("/api/codes/SVC_REQ_KIND").status_code == 401


def test_viewer_reads_only_active_groups_and_codes_in_order(client, seed_codes, make_user, login):
    make_user("viewer01")
    response = client.get("/api/codes?owner=SVC", headers=login("viewer01"))
    assert response.status_code == 200
    groups = response.json()
    assert [g["group_code"] for g in groups] == ["SVC_REQ_KIND"]  # 꺼진 묶음·다른 owner 는 안 보임
    assert [c["code"] for c in groups[0]["codes"]] == ["FUNCTIONAL", "NON_FUNCTIONAL"]  # 꺼진 값 없음, 순서대로
    assert "is_active" not in groups[0]["codes"][0]


def test_read_one_group(client, seed_codes, make_user, login):
    make_user("viewer01")
    headers = login("viewer01")
    body = client.get("/api/codes/SVC_REQ_KIND", headers=headers).json()
    assert body["name"] == "요구사항 구분"
    assert [c["label"] for c in body["codes"]] == ["기능", "비기능"]
    for missing in ("SVC_OLD", "SVC_NOPE"):
        response = client.get(f"/api/codes/{missing}", headers=headers)
        assert response.status_code == 404
        assert response.json()["code"] == "CODE_GROUP_NOT_FOUND"


def test_owner_filter_is_validated(client, make_user, login):
    make_user("viewer01")
    assert client.get("/api/codes?owner=svc", headers=login("viewer01")).status_code == 422


# ---- 관리 API (MASTER) ----


def test_admin_api_is_master_only(client, seed_codes, make_user, login):
    make_user("viewer01")
    headers = login("viewer01")
    assert client.get("/api/admin/codes").status_code == 401
    assert client.get("/api/admin/codes", headers=headers).status_code == 403
    body = {"code": "SECURITY", "label": "보안"}
    assert client.post("/api/admin/codes/SVC_REQ_KIND", json=body, headers=headers).status_code == 403
    assert client.patch("/api/admin/codes/SVC_REQ_KIND/FUNCTIONAL", json={"label": "x"}, headers=headers).status_code == 403


def test_master_sees_inactive_too(client, seed_codes, make_user, login):
    make_user("master01", admin=True)
    groups = client.get("/api/admin/codes?owner=SVC", headers=login("master01")).json()
    assert [g["group_code"] for g in groups] == ["SVC_OLD", "SVC_REQ_KIND"]
    kinds = next(g for g in groups if g["group_code"] == "SVC_REQ_KIND")
    assert [(c["code"], c["is_active"]) for c in kinds["codes"]] == [
        ("FUNCTIONAL", True),
        ("NON_FUNCTIONAL", True),
        ("CONSTRAINT", False),
    ]


def test_master_adds_code(client, seed_codes, make_user, login):
    make_user("master01", admin=True)
    headers = login("master01")
    body = {"code": "SECURITY", "label": "보안", "sort_order": 4}
    response = client.post("/api/admin/codes/SVC_REQ_KIND", json=body, headers=headers)
    assert response.status_code == 201, response.text
    assert response.json() == {"code": "SECURITY", "label": "보안", "sort_order": 4, "is_active": True}

    duplicate = client.post("/api/admin/codes/SVC_REQ_KIND", json=body, headers=headers)
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "CODE_EXISTS"

    unknown = client.post("/api/admin/codes/SVC_NOPE", json=body, headers=headers)
    assert unknown.status_code == 404


@pytest.mark.parametrize(
    "body",
    [
        {"code": "security", "label": "보안"},  # 소문자
        {"code": "1ST", "label": "보안"},  # 숫자로 시작
        {"code": "SECURITY", "label": ""},
        {"code": "SECURITY", "label": "보안", "is_active": False},  # 모르는 칸
    ],
)
def test_add_code_rejects_bad_input(client, seed_codes, make_user, login, body):
    make_user("master01", admin=True)
    response = client.post("/api/admin/codes/SVC_REQ_KIND", json=body, headers=login("master01"))
    assert response.status_code == 422


def test_master_updates_and_deactivates_code(client, seed_codes, make_user, login):
    make_user("master01", admin=True)
    headers = login("master01")
    response = client.patch(
        "/api/admin/codes/SVC_REQ_KIND/NON_FUNCTIONAL", json={"label": "비기능 요구사항"}, headers=headers
    )
    assert response.status_code == 200
    assert response.json()["label"] == "비기능 요구사항"

    response = client.patch("/api/admin/codes/SVC_REQ_KIND/FUNCTIONAL", json={"is_active": False}, headers=headers)
    assert response.status_code == 200
    codes = client.get("/api/codes/SVC_REQ_KIND", headers=headers).json()["codes"]
    assert [c["code"] for c in codes] == ["NON_FUNCTIONAL"]  # 끈 값은 조회에서 빠짐


@pytest.mark.parametrize("body", [{}, {"label": None}, {"code": "NEW"}])
def test_update_code_rejects_bad_input(client, seed_codes, make_user, login, body):
    """빈 요청, 칸 비우기, code 값 바꾸기는 받지 않습니다."""
    make_user("master01", admin=True)
    response = client.patch("/api/admin/codes/SVC_REQ_KIND/FUNCTIONAL", json=body, headers=login("master01"))
    assert response.status_code == 422


def test_update_unknown_code_is_404(client, seed_codes, make_user, login):
    make_user("master01", admin=True)
    response = client.patch("/api/admin/codes/SVC_REQ_KIND/NOPE", json={"label": "x"}, headers=login("master01"))
    assert response.status_code == 404
    assert response.json()["code"] == "CODE_NOT_FOUND"


# ---- 서비스용 함수 ----


def test_is_valid_and_require_code(db, seed_codes):
    assert is_valid_code(db, "SVC_REQ_KIND", "FUNCTIONAL")
    assert not is_valid_code(db, "SVC_REQ_KIND", "CONSTRAINT")  # 꺼진 값
    assert not is_valid_code(db, "SVC_OLD", "A")  # 꺼진 묶음
    assert not is_valid_code(db, "SVC_REQ_KIND", "NOPE")
    assert not is_valid_code(db, "SVC_NOPE", "FUNCTIONAL")

    require_code(db, "SVC_REQ_KIND", "FUNCTIONAL")
    with pytest.raises(AppError) as error:
        require_code(db, "SVC_REQ_KIND", "CONSTRAINT")
    assert (error.value.status_code, error.value.code) == (400, "INVALID_CODE")


def test_list_codes(db, seed_codes):
    assert [c.code for c in list_codes(db, "SVC_REQ_KIND")] == ["FUNCTIONAL", "NON_FUNCTIONAL"]
    # 이미 저장된 데이터의 이름을 보여 줄 때는 꺼진 값도
    assert [c.code for c in list_codes(db, "SVC_REQ_KIND", include_inactive=True)] == [
        "FUNCTIONAL",
        "NON_FUNCTIONAL",
        "CONSTRAINT",
    ]
    assert list_codes(db, "SVC_OLD") == []  # 꺼진 묶음
    with pytest.raises(AppError):
        list_codes(db, "SVC_NOPE")


# ---- DB 가 막는 규칙 ----


@pytest.mark.parametrize(
    ("group_code", "owner"),
    [
        ("MEERKIT_X", "SVC"),  # 다른 owner 의 접두어
        ("SVCX", "SVC"),  # 접두어 뒤에 _ 없음
        ("SVC_x", "SVC"),  # 소문자
        ("svc_X", "svc"),  # owner 소문자
    ],
)
def test_db_rejects_group_code_not_matching_owner(db, group_code, owner):
    db.add(CodeGroup(group_code=group_code, owner=owner, name="x"))
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()


def test_deleting_group_deletes_its_codes(db, seed_codes):
    """서비스를 빼면 owner 묶음만 지우면 값도 함께 지워집니다."""
    db.execute(delete(CodeGroup).where(CodeGroup.owner == "SVC"))
    db.commit()
    remaining = set(db.scalars(select(Code.group_code).distinct()))
    assert "MEERKIT_SAMPLE" in remaining
    assert not any(g.startswith("SVC_") for g in remaining)
