"use client";

import { Eye, EyeOff, KeyRound } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

import { useAuth } from "../auth/hooks";
import { LoginRequiredDialog } from "./LoginRequiredDialog";
import { useLlmKeyStore } from "./llm-key-store";
import {
  maskKey as mask,
  PROVIDERS,
  type ModelOption,
  type ProviderId,
} from "./providers";

interface ApiKeyInputProps {
  className?: string;
  /** 어느 공급자의 키를 받을지. 기본은 OpenAI */
  provider?: ProviderId;
  /** 모델 고르는 칸을 보일지. 기본은 숨김 */
  showModel?: boolean;
  /** 모델 목록을 바꾸고 싶을 때 (기본은 공급자의 기본 목록) */
  models?: ModelOption[];
  /**
   * 넘기면 저장 버튼이 키를 서버로 보내는 방식이 된다. 입력한 키는 화면에 남기지 않고 끝자리만 보인다.
   * 넘기지 않으면 키를 브라우저 메모리에만 두고 요청할 때 헤더로 보낸다(웰컴 페이지의 AI 테스트가 쓰는 방식).
   * 실패하면 throw 해서 이유를 알려 준다.
   */
  onSave?: (value: ApiKeyInputValue) => void | Promise<void>;
  /** 서버에 이미 저장된 값(onSave와 함께). 원본 키는 받지 않고 끝자리(keyHint)만 받는다 */
  initial?: { keyHint?: string; model?: string };
}

/** onSave로 넘어가는 값. apiKey는 이번에 새로 입력한 경우에만 있다 */
export interface ApiKeyInputValue {
  provider: ProviderId;
  model: string;
  apiKey?: string;
}

// API 키를 입력받는 칸. 로그인 전에도 보이지만, 입력하려 하면 로그인 안내가 먼저 뜬다.
// onSave를 넘기면 서버로 저장하는 방식, 넘기지 않으면 키를 메모리에만 두는 방식이다.
export function ApiKeyInput(props: ApiKeyInputProps) {
  return props.onSave ? (
    <ServerApiKeyInput {...props} onSave={props.onSave} />
  ) : (
    <MemoryApiKeyInput {...props} />
  );
}

function ModelPicker({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: ModelOption[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <NativeSelect
      aria-label={`${label} 모델`}
      wrapperClassName="w-full"
      className="h-11 text-sm"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </NativeSelect>
  );
}

// 서버로 저장하는 방식. 키는 저장할 때 한 번만 보내고 화면에는 끝자리만 남긴다.
function ServerApiKeyInput({
  className,
  provider = "openai",
  showModel = false,
  models,
  onSave,
  initial,
}: ApiKeyInputProps & { onSave: NonNullable<ApiKeyInputProps["onSave"]> }) {
  const info = PROVIDERS[provider];
  const modelOptions = models ?? info.models;
  const { isAuthenticated } = useAuth();
  const [hint, setHint] = useState(initial?.keyHint ?? "");
  const [model, setModel] = useState(
    initial?.model ?? modelOptions[0]?.id ?? "",
  );
  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [askLogin, setAskLogin] = useState(false);

  const change =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setError(null);
      setSaved(false);
    };

  const save = async () => {
    const key = draft.trim();
    if (key && !info.pattern.test(key))
      return setError(
        `${info.label} 키 모양이 달라요. 키를 다시 확인해 주세요.`,
      );
    if (!key && !hint) return setError("키를 입력해 주세요.");
    setSaving(true);
    try {
      await onSave({ provider, model, ...(key ? { apiKey: key } : {}) });
      if (key) setHint(mask(key));
      setDraft("");
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "저장하지 못했어요. 잠시 뒤에 다시 시도해 주세요.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className={cn("grid gap-3 text-left", className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (!isAuthenticated) return setAskLogin(true);
        save();
      }}
    >
      <div className="flex items-start gap-2">
        <div className="relative flex-1">
          <KeyRound
            className="pointer-events-none absolute left-3.5 top-[22px] size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type={show ? "text" : "password"}
            value={draft}
            autoComplete="off"
            spellCheck={false}
            aria-label={`${info.label} API 키`}
            aria-invalid={!!error}
            placeholder={
              hint ? `저장됨 ${hint} — 바꾸려면 새 키를 입력` : info.placeholder
            }
            className="pl-10 pr-11"
            onFocus={(e) => {
              if (!isAuthenticated) {
                e.currentTarget.blur();
                setAskLogin(true);
              }
            }}
            onChange={(e) => change(setDraft)(e.target.value)}
          />
          <button
            type="button"
            aria-label={show ? "키 가리기" : "키 보기"}
            className="absolute right-2 top-[22px] -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors duration-200 hover:text-foreground"
            onClick={() => setShow((v) => !v)}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <Button type="submit" disabled={saving} className="h-11">
          {saving ? "저장 중…" : saved ? "저장됨" : "저장"}
        </Button>
      </div>
      {showModel && (
        <ModelPicker
          label={info.label}
          value={model}
          options={modelOptions}
          onChange={change(setModel)}
        />
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <LoginRequiredDialog open={askLogin} onOpenChange={setAskLogin} />
    </form>
  );
}

// 메모리에만 두는 방식. 키는 새로고침하면 지워지고 요청할 때 헤더로만 보낸다.
function MemoryApiKeyInput({
  className,
  provider = "openai",
  showModel = false,
  models,
}: ApiKeyInputProps) {
  const info = PROVIDERS[provider];
  const modelOptions = models ?? info.models;
  const { isAuthenticated } = useAuth();
  const apiKey = useLlmKeyStore((s) => s.apiKey);
  const setApiKey = useLlmKeyStore((s) => s.setApiKey);
  const clearApiKey = useLlmKeyStore((s) => s.clearApiKey);
  const model = useLlmKeyStore((s) => s.model);
  const setModel = useLlmKeyStore((s) => s.setModel);

  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askLogin, setAskLogin] = useState(false);

  const save = () => {
    const key = draft.trim();
    if (!info.pattern.test(key)) {
      setError(`${info.label} 키 모양이 달라요. 키를 다시 확인해 주세요.`);
      return;
    }
    setApiKey(key);
    setDraft("");
    setError(null);
  };

  return (
    <div className={cn("grid gap-2 text-left", className)}>
      {apiKey ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-soft">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <KeyRound
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="font-medium">API 키 연결됨</span>
            <code className="truncate text-xs text-muted-foreground">
              {mask(apiKey)}
            </code>
          </span>
          <Button size="sm" variant="ghost" onClick={clearApiKey}>
            지우기
          </Button>
        </div>
      ) : (
        <>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!isAuthenticated) return setAskLogin(true);
              save();
            }}
          >
            <div className="relative flex-1">
              <KeyRound
                className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type={show ? "text" : "password"}
                value={draft}
                autoComplete="off"
                spellCheck={false}
                aria-label={`${info.label} API 키`}
                aria-invalid={!!error}
                placeholder={info.placeholder}
                className="pl-10 pr-11"
                onFocus={(e) => {
                  // 로그인 전이면 입력하기 전에 안내한다
                  if (!isAuthenticated) {
                    e.currentTarget.blur();
                    setAskLogin(true);
                  }
                }}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setError(null);
                }}
              />
              <button
                type="button"
                aria-label={show ? "키 가리기" : "키 보기"}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors duration-200 hover:text-foreground"
                onClick={() => setShow((v) => !v)}
              >
                {show ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
            <Button
              type="submit"
              className="h-11"
              disabled={isAuthenticated && !draft.trim()}
            >
              저장
            </Button>
          </form>
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              키는 이 브라우저 메모리에만 두고 서버에 저장하지 않아요.
              새로고침하면 지워져요.
            </p>
          )}
        </>
      )}
      {showModel && (
        <ModelPicker
          label={info.label}
          value={model || modelOptions[0]?.id || ""}
          options={modelOptions}
          onChange={setModel}
        />
      )}
      <LoginRequiredDialog open={askLogin} onOpenChange={setAskLogin} />
    </div>
  );
}
