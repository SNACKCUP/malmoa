"""AI 회의록용 LLM 연결 — 제공자 고르기, API 키 암호화 저장, 호출

설정은 사용자마다 설정 화면에서 저장한 값(DB llm_settings)을 먼저 쓰고, 없으면 backend/.env 값을 쓴다.

제공자
  - openai     : OpenAI SDK
  - anthropic  : Anthropic SDK (Claude). OpenAI 호환 주소는 JSON 응답 형식 지정을 무시하므로 쓰지 않는다
  - gemini     : OpenAI SDK + Gemini의 OpenAI 호환 주소
  - compatible : OpenAI SDK + 사용자가 입력한 주소 (Ollama 같은 로컬 모델이면 키 없이)

키 원문은 DB에 저장하지 않는다 (Fernet 암호문). 화면에는 앞뒤 몇 글자(key_hint)만 돌려준다.
"""

import base64
import hashlib
import logging
from dataclasses import dataclass

import anthropic
import openai
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from app.features.malmoa.config import get_settings
from app.features.malmoa.models import LlmSetting

log = logging.getLogger(__name__)

TIMEOUT = 180  # 회의록 한 구간 요청
CHECK_TIMEOUT = 20  # 키 확인·모델 목록
MAX_TOKENS = 16000  # Claude는 출력 상한을 꼭 정해야 한다 (회의록 JSON이 잘리지 않을 만큼)


class LlmError(Exception):
    """사용자에게 그대로 보여 줄 수 있는 AI 연결 오류"""


@dataclass(frozen=True)
class Provider:
    label: str
    base_url: str | None  # 고정 주소 (compatible은 사용자가 입력)
    needs_key: bool
    key_page: str | None
    suggested_model: str  # 화면에서 처음 고를 때 채워 줄 값 (비우면 목록에서 고른다)


PROVIDERS: dict[str, Provider] = {
    "openai": Provider("OpenAI", None, True, "https://platform.openai.com/api-keys", "gpt-5.4-mini"),
    "anthropic": Provider("Anthropic (Claude)", None, True, "https://platform.claude.com/settings/keys", "claude-opus-5-5"),
    "gemini": Provider("Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai/", True, "https://aistudio.google.com/apikey", ""),
    "compatible": Provider("OpenAI 호환 (직접 입력·Ollama 등)", None, False, None, ""),
}


@dataclass(frozen=True)
class LlmConfig:
    provider: str
    model: str
    api_key: str
    base_url: str | None
    source: str  # screen | env
    key_unreadable: bool = False  # 저장된 암호문을 풀 수 없음 (SECRET_KEY가 바뀜)

    @property
    def label(self) -> str:
        return f"{PROVIDERS[self.provider].label} · {self.model}" if self.model else PROVIDERS[self.provider].label

    def problem(self) -> str | None:
        """회의록을 만들 수 없는 이유. 없으면 None"""
        if self.key_unreadable:
            return "저장된 AI API 키를 읽을 수 없습니다 (SECRET_KEY가 바뀌었을 수 있음). 설정 화면의 'AI 회의록 연결'에서 키를 다시 입력해 주세요."
        if PROVIDERS[self.provider].needs_key and not self.api_key:
            return "AI API 키가 설정되지 않았습니다. 설정 화면의 'AI 회의록 연결'에서 제공자와 API 키를 넣어 주세요."
        if self.provider == "compatible" and not self.base_url:
            return "OpenAI 호환 제공자의 주소가 없습니다. 설정 화면의 'AI 회의록 연결'에서 주소를 넣어 주세요."
        if not self.model:
            return "사용할 AI 모델이 설정되지 않았습니다. 설정 화면의 'AI 회의록 연결'에서 모델을 골라 주세요."
        return None


# ---------- 키 암호화 ----------


def _fernet() -> Fernet:
    s = get_settings()
    secret = s.secret_key
    if not secret:
        raise LlmError("API 키를 암호화할 열쇠가 없습니다. backend/.env에 SECRET_KEY를 넣고 백엔드를 다시 시작해 주세요.")
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()))


def encrypt_key(key: str) -> str:
    return _fernet().encrypt(key.encode()).decode()


def decrypt_key(token: str) -> str:
    """풀 수 없으면 InvalidToken"""
    return _fernet().decrypt(token.encode()).decode()


def key_hint(key: str) -> str:
    """화면 표시용: sk-proj…AbCd (짧은 키는 끝 2글자만)"""
    return f"{key[:7]}…{key[-4:]}" if len(key) >= 16 else f"…{key[-2:]}"


# ---------- 설정 읽기 ----------


def env_config() -> LlmConfig:
    s = get_settings()
    base_url = s.openai_base_url or None
    return LlmConfig(provider="compatible" if base_url else "openai", model=s.openai_model, api_key=s.openai_api_key, base_url=base_url, source="env")


def resolve(db: Session, user_id: int) -> LlmConfig:
    """이 사용자가 쓸 설정: 화면에서 저장한 값 → 없으면 .env"""
    row = db.get(LlmSetting, user_id)
    if row is None:
        return env_config()
    key, unreadable = "", False
    if row.api_key_enc:
        try:
            key = decrypt_key(row.api_key_enc)
        except (InvalidToken, LlmError):
            unreadable = True
    return LlmConfig(provider=row.provider, model=row.model, api_key=key, base_url=row.base_url, source="screen", key_unreadable=unreadable)


# ---------- 호출 ----------


def _openai_client(cfg: LlmConfig, timeout: float, retries: int) -> openai.OpenAI:
    base_url = cfg.base_url if cfg.provider == "compatible" else PROVIDERS[cfg.provider].base_url
    # 로컬 서버(Ollama 등)는 키가 없어도 되지만 SDK는 빈 키를 받지 않는다
    return openai.OpenAI(api_key=cfg.api_key or "not-needed", base_url=base_url, timeout=timeout, max_retries=retries)


def _anthropic_client(cfg: LlmConfig, timeout: float, retries: int) -> anthropic.Anthropic:
    return anthropic.Anthropic(api_key=cfg.api_key, timeout=timeout, max_retries=retries)


def friendly(e: Exception, cfg: LlmConfig) -> LlmError:
    """SDK 오류 → 한국어 안내. 키 원문은 메시지에 넣지 않는다"""
    name = PROVIDERS[cfg.provider].label
    text = str(e)
    if isinstance(e, (openai.AuthenticationError, anthropic.AuthenticationError)):
        return LlmError(f"{name} API 키가 올바르지 않습니다. 설정 화면에서 키를 확인해 주세요.")
    if isinstance(e, (openai.NotFoundError, anthropic.NotFoundError)):
        return LlmError(f"AI 모델 '{cfg.model}'을 찾을 수 없습니다. 설정 화면에서 모델을 다시 골라 주세요.")
    if isinstance(e, (openai.PermissionDeniedError, anthropic.PermissionDeniedError)):
        return LlmError(f"이 API 키로는 모델 '{cfg.model}'을 사용할 수 없습니다.")
    # 크레딧 부족: OpenAI는 429 insufficient_quota, Anthropic은 400 "credit balance is too low"
    if "insufficient_quota" in text or "credit balance" in text or "credit_balance" in text:
        return LlmError(f"{name} 계정의 사용 한도(크레딧)가 부족합니다. 제공자 사이트에서 결제·사용량 설정을 확인해 주세요.")
    if isinstance(e, (openai.RateLimitError, anthropic.RateLimitError)):
        return LlmError("AI API 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요. 완료된 구간부터 이어서 진행합니다.")
    if isinstance(e, (openai.APIConnectionError, anthropic.APIConnectionError)):  # 시간 초과도 여기에 포함
        where = "주소와 서버 실행 여부를" if cfg.provider == "compatible" else "인터넷 연결을"
        return LlmError(f"AI API에 연결할 수 없습니다. {where} 확인한 뒤 다시 시도해 주세요.")
    if isinstance(e, (openai.BadRequestError, anthropic.BadRequestError)):
        return LlmError(f"AI API가 요청을 거부했습니다: {getattr(e, 'message', text)}")
    return LlmError("AI API 호출 중 오류가 발생했습니다. 잠시 후 다시 시도하면 완료된 구간부터 이어서 진행합니다.")


def list_models(cfg: LlmConfig) -> list[str]:
    """키 확인 겸 모델 목록. 토큰을 쓰지 않으므로 비용이 들지 않는다"""
    try:
        if cfg.provider == "anthropic":
            ids = [m.id for m in _anthropic_client(cfg, CHECK_TIMEOUT, 1).models.list()]
        else:
            # Gemini는 'models/gemini-…' 형식으로 돌려준다
            ids = [m.id.removeprefix("models/") for m in _openai_client(cfg, CHECK_TIMEOUT, 1).models.list()]
    except (openai.OpenAIError, anthropic.AnthropicError) as e:
        log.warning("AI 모델 목록 조회 실패 (%s): %s", cfg.provider, type(e).__name__)
        raise friendly(e, cfg) from e
    return sorted(set(ids))


@dataclass(frozen=True)
class Reply:
    text: str
    input_tokens: int
    output_tokens: int


def complete_json(cfg: LlmConfig, system: str, prompt: str) -> Reply:
    """JSON 객체 하나를 요청한다. 응답 형식 검사는 부르는 쪽(minutes._ask)에서"""
    try:
        if cfg.provider == "anthropic":
            return _complete_anthropic(cfg, system, prompt)
        res = _openai_client(cfg, TIMEOUT, 3).chat.completions.create(
            model=cfg.model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
    except (openai.OpenAIError, anthropic.AnthropicError) as e:
        log.warning("AI API 오류 (%s): %s", cfg.provider, type(e).__name__)
        raise friendly(e, cfg) from e
    usage = res.usage
    return Reply(res.choices[0].message.content or "", usage.prompt_tokens if usage else 0, usage.completion_tokens if usage else 0)


def _complete_anthropic(cfg: LlmConfig, system: str, prompt: str) -> Reply:
    # 최신 Claude 모델은 응답 미리 채우기(prefill)·temperature를 받지 않는다 → 지시문으로 JSON만 요청
    res = _anthropic_client(cfg, TIMEOUT, 3).messages.create(
        model=cfg.model,
        max_tokens=MAX_TOKENS,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    if res.stop_reason == "refusal":
        raise LlmError("AI가 이 내용의 처리를 거절했습니다. 다른 모델을 골라 다시 시도해 주세요.")
    if res.stop_reason == "max_tokens":
        raise LlmError("AI 응답이 너무 길어 중간에 잘렸습니다. 원문을 나누는 단위(MINUTES_CHUNK_CHARS)를 줄여 다시 시도해 주세요.")
    # 생각(thinking) 블록은 건너뛰고 본문만
    text = "".join(b.text for b in res.content if b.type == "text")
    return Reply(text, res.usage.input_tokens, res.usage.output_tokens)
