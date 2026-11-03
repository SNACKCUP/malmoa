"""LLM 설정. 환경 변수 이름은 그대로(LLM_PROVIDER, LLM_MODEL, OPENAI_API_KEY 등)이고, llm 모듈이 직접 읽습니다.

다른 공통 모듈은 이 설정을 모릅니다 (llm 은 core 만 import, core 는 llm 을 모름).
"""

from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.config import settings as core_settings


class LLMSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # openai | fake. fake 는 키 없이 예시 응답을 돌려주는 로컬·테스트용 (운영에서는 시작을 막음)
    llm_provider: str = "openai"
    llm_model: str = "gpt-4o-mini"
    openai_api_key: str = ""
    llm_temperature: float = 0.2
    llm_timeout_seconds: int = 60  # 호출 1번의 시간 제한
    llm_max_retries: int = 2  # 공급자 SDK 의 재시도 (네트워크·일시 오류)
    llm_output_retries: int = 1  # 응답이 정해진 형식과 다를 때 다시 묻는 횟수
    llm_max_input_chars: int = 20000  # 입력 글자 수 상한 (비용 폭주·시간 초과 방지). 넘으면 413


llm_settings = LLMSettings()


def production_problems() -> list[str]:
    """APP_ENV=production 에서 LLM 쪽 위험한 설정. main.py 가 core 검사와 합쳐 시작 전에 확인합니다.

    키가 비어 있는 것은 막지 않습니다: 서버는 뜨고 LLM 기능만 503(LLM_NOT_CONFIGURED)으로 응답합니다.
    """
    if core_settings.app_env != "production":
        return []
    problems = []
    if llm_settings.llm_provider == "fake":
        problems.append("LLM_PROVIDER: 운영에서는 fake 를 쓸 수 없습니다 (가짜 응답). openai 로 설정하세요")
    return problems
