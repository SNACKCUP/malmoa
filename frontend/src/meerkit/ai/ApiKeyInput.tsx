"use client";

import { Eye, EyeOff, KeyRound } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { useAuth } from "../auth/hooks";
import { LoginRequiredDialog } from "./LoginRequiredDialog";
import { useLlmKeyStore } from "./llm-key-store";

// OpenAI 키 형태(sk-...). 모양만 대충 확인하고, 진짜 유효한지는 서버가 호출해 보고 알려 준다.
const KEY_PATTERN = /^sk-[A-Za-z0-9_-]{16,}$/;

const mask = (key: string) => `${key.slice(0, 3)}…${key.slice(-4)}`;

interface ApiKeyInputProps {
  className?: string;
}

// API 키를 입력받는 칸. 로그인 전에도 보이지만, 입력하려 하면 로그인 안내가 먼저 뜬다.
// 키는 메모리에만 두고(새로고침하면 지워짐) 요청할 때 헤더로만 보낸다.
export function ApiKeyInput({ className }: ApiKeyInputProps) {
  const { isAuthenticated } = useAuth();
  const apiKey = useLlmKeyStore((s) => s.apiKey);
  const setApiKey = useLlmKeyStore((s) => s.setApiKey);
  const clearApiKey = useLlmKeyStore((s) => s.clearApiKey);

  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askLogin, setAskLogin] = useState(false);

  const save = () => {
    const key = draft.trim();
    if (!KEY_PATTERN.test(key)) {
      setError("OpenAI API 키는 sk-로 시작해요. 키를 다시 확인해 주세요.");
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
            <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="font-medium">API 키 연결됨</span>
            <code className="truncate text-xs text-muted-foreground">{mask(apiKey)}</code>
          </span>
          <Button size="sm" variant="ghost" onClick={clearApiKey}>지우기</Button>
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
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type={show ? "text" : "password"}
                value={draft}
                autoComplete="off"
                spellCheck={false}
                aria-label="OpenAI API 키"
                aria-invalid={!!error}
                placeholder="OpenAI API 키 (sk-...)"
                className="pl-9 pr-10"
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
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                onClick={() => setShow((v) => !v)}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <Button type="submit" disabled={isAuthenticated && !draft.trim()}>저장</Button>
          </form>
          {error ? (
            <p role="alert" className="text-xs text-destructive">{error}</p>
          ) : (
            <p className="text-xs text-muted-foreground">키는 이 브라우저 메모리에만 두고 서버에 저장하지 않아요. 새로고침하면 지워져요.</p>
          )}
        </>
      )}
      <LoginRequiredDialog open={askLogin} onOpenChange={setAskLogin} />
    </div>
  );
}
