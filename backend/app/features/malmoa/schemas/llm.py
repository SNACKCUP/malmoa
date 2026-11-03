from typing import Literal

from pydantic import Field

from app.features.malmoa.schemas.jobs import CamelModel

ProviderId = Literal["openai", "anthropic", "gemini", "compatible"]


class LlmProviderInfo(CamelModel):
    id: ProviderId
    label: str
    needs_key: bool
    key_page: str | None
    suggested_model: str


class LlmSettingsOut(CamelModel):
    """현재 AI 회의록 연결. 키 원문은 돌려주지 않는다 (key_hint만)"""

    provider: ProviderId
    model: str
    base_url: str | None
    has_key: bool
    key_hint: str | None
    source: Literal["screen", "env"]  # screen: 설정 화면에서 저장, env: backend/.env
    label: str
    problem: str | None  # 회의록을 만들 수 없는 이유 (없으면 바로 사용 가능)
    providers: list[LlmProviderInfo]


def clean_key(v: str | None) -> str | None:
    v = (v or "").strip()
    if not v:
        return None
    if any(c.isspace() for c in v) or len(v) > 512:
        raise ValueError("API 키 형식이 올바르지 않습니다. 복사한 키에 공백이나 줄바꿈이 섞이지 않았는지 확인해 주세요.")
    return v


def clean_url(v: str | None) -> str | None:
    v = (v or "").strip().rstrip("/")
    if not v:
        return None
    if not v.startswith(("http://", "https://")) or len(v) > 255:
        raise ValueError("주소는 http:// 또는 https:// 로 시작해야 합니다.")
    return v


# 키·주소 검사는 라우터에서 부른다 (ValueError 메시지를 400 응답으로 그대로 보여 주려고)


class LlmCheckIn(CamelModel):
    """키 확인·모델 목록. api_key를 비우면 같은 제공자로 저장된 키를 쓴다"""

    provider: ProviderId
    api_key: str | None = None
    base_url: str | None = None


class LlmSettingsIn(LlmCheckIn):
    model: str = Field(max_length=128)


class LlmCheckOut(CamelModel):
    models: list[str]
    message: str
