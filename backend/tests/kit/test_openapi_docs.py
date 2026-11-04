"""Swagger(/openapi.json)에 킷 양식의 한글 설명과 예시 값이 보이는지"""

KIT_SCHEMAS = [
    "SignupRequest",
    "LoginRequest",
    "TokenResponse",
    "LoginIdCheck",
    "EmailCodeRequest",
    "VerifyEmailCodeRequest",
    "VerifyEmailCodeResponse",
    "TermRead",
    "ForgotPasswordRequest",
    "ResetPasswordRequest",
    "ChangePasswordRequest",
    "RoleRead",
    "UserRead",
    "RolesUpdate",
    "ActiveUpdate",
    "UserPage",
    "ProfileUpdate",
    "WithdrawRequest",
]


def test_kit_schemas_have_descriptions_and_examples(client):
    schemas = client.get("/openapi.json").json()["components"]["schemas"]
    for name in KIT_SCHEMAS:
        schema = schemas[name]
        assert schema.get("description"), f"{name}: 양식 설명 없음"
        for field, prop in schema["properties"].items():
            assert prop.get("description"), f"{name}.{field}: 칸 설명 없음"
    assert schemas["SignupRequest"]["properties"]["user_id"]["examples"] == ["kim_2024"]


def test_examples_are_fake(client):
    """예시 값에는 example.com 같은 가짜 이메일만 씁니다."""
    text = client.get("/openapi.json").text
    for domain in ["gmail.com", "naver.com", "meerkit.dev"]:
        assert domain not in text
