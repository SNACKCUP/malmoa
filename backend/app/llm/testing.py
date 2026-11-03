"""테스트·로컬용 가짜 모델. API 키 없이 정해 둔 응답을 돌려줍니다 (LLM_PROVIDER=fake 또는 테스트).

    model = FakeChatModel(responses=[{"summary": "...", "action_items": []}])
    with override_chat_model(model):
        result = invoke_structured(prompt, MeetingSummary, {"notes": "..."})
    model.calls  # 모델에 들어간 메시지 목록 (프롬프트 확인용)

responses 항목: dict(스키마로 검증) / Pydantic 객체 / JSON 문자열 / 예외(그대로 발생).
응답을 다 쓰면 스키마 모양의 예시 값을 만들어 돌려줍니다.
"""

import types
import typing
from enum import Enum
from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.prompt_values import PromptValue
from langchain_core.runnables import RunnableLambda
from pydantic import BaseModel, Field


def placeholder(tp: Any) -> Any:
    """스키마 모양을 맞춘 예시 값 (fake 모드에서 화면을 개발할 때 쓰임)"""
    origin = typing.get_origin(tp)
    if origin in (typing.Union, types.UnionType):
        args = [a for a in typing.get_args(tp) if a is not type(None)]
        return placeholder(args[0]) if args else None
    if origin is typing.Literal:
        return typing.get_args(tp)[0]
    if origin in (list, set, tuple):
        args = typing.get_args(tp)
        return [placeholder(args[0])] if args else []
    if origin is dict:
        return {}
    if isinstance(tp, type):
        if issubclass(tp, BaseModel):
            return tp.model_validate(
                {
                    name: (field.default if field.default is not None and not field.is_required() else placeholder(field.annotation))
                    for name, field in tp.model_fields.items()
                }
            )
        if issubclass(tp, Enum):
            return next(iter(tp))
        if issubclass(tp, bool):
            return False
        if issubclass(tp, (int, float)):
            return tp(0)
        if issubclass(tp, str):
            return "(예시 응답)"
    return None


class FakeChatModel(BaseChatModel):
    responses: list[Any] = Field(default_factory=list)
    calls: list[list[BaseMessage]] = Field(default_factory=list)
    model_name: str = "fake"

    @property
    def _llm_type(self) -> str:
        return "meerkit-fake"

    def _next(self) -> Any:
        if not self.responses:
            return None
        item = self.responses.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item

    def _record(self, value: Any) -> None:
        if isinstance(value, PromptValue):
            self.calls.append(value.to_messages())
        elif isinstance(value, list):
            self.calls.append(value)

    def _generate(self, messages: list[BaseMessage], stop=None, run_manager=None, **kwargs) -> ChatResult:
        self.calls.append(messages)
        item = self._next()
        text = item if isinstance(item, str) else ("(예시 응답)" if item is None else str(item))
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=text))])

    def with_structured_output(self, schema, *, include_raw: bool = False, **kwargs):
        def run(value):
            self._record(value)
            item = self._next()
            if item is None:
                return placeholder(schema)
            if isinstance(item, BaseModel):
                return item
            if isinstance(item, str):
                return schema.model_validate_json(item)
            return schema.model_validate(item)

        return RunnableLambda(run)
