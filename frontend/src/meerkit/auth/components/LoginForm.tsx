"use client";

import { Lock } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { SocialLogin } from "./SocialLogin";
import { formatRemaining, useRemainingLock } from "../lockout";
import type { LoginInput } from "../../types";

interface LoginFormProps {
  onSubmit: (input: LoginInput) => void;
  pending?: boolean;
  error?: string | null;
  /** 잠금이 풀리는 시각(ms). 값이 있고 미래라면 폼이 잠긴다 */
  lockedUntil?: number | null;
  /** 잠기기까지 남은 시도 횟수. null이면 표시하지 않는다 */
  attemptsLeft?: number | null;
  /** 있으면 "비밀번호를 잊으셨나요?" 링크를 보여 준다 */
  onForgotPassword?: () => void;
  /** 있으면 "아이디를 잊으셨나요?" 링크를 보여 준다 */
  onFindId?: () => void;
  /** 있으면 폼 아래에 "소셜 로그인" 구분선과 [구글 계정으로 로그인하기] 버튼을 보여 준다 */
  onGoogle?: () => void;
}

export function LoginForm({ onSubmit, pending, error, lockedUntil = null, attemptsLeft = null, onForgotPassword, onFindId, onGoogle }: LoginFormProps) {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const remaining = useRemainingLock(lockedUntil);
  const locked = remaining > 0;

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!locked) onSubmit({ user_id: userId.trim(), password });
      }}
    >
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="login-user-id">아이디</Label>
          {onFindId && (
            <button type="button" onClick={onFindId} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              아이디를 잊으셨나요?
            </button>
          )}
        </div>
        <Input id="login-user-id" autoComplete="username" required disabled={locked} value={userId} onChange={(e) => setUserId(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="login-password">비밀번호</Label>
          {onForgotPassword && (
            <button type="button" onClick={onForgotPassword} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              비밀번호를 잊으셨나요?
            </button>
          )}
        </div>
        <Input id="login-password" type="password" autoComplete="current-password" required disabled={locked} value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>

      {locked ? (
        <div role="alert" className="mk-swap flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-3.5 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-destructive">로그인이 잠겼습니다</p>
            <p className="mt-0.5 text-[13px] text-foreground/70">
              로그인에 여러 번 실패했습니다. <span className="font-mono font-medium text-foreground">{formatRemaining(remaining)}</span> 뒤에 다시 시도하세요.
            </p>
          </div>
        </div>
      ) : (
        error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
            {attemptsLeft !== null && attemptsLeft > 0 && <span className="ml-1 text-muted-foreground">(남은 시도 {attemptsLeft}회)</span>}
          </p>
        )
      )}

      <Button type="submit" disabled={pending || locked}>
        {locked ? `잠김 ${formatRemaining(remaining)}` : pending ? "로그인 중…" : "로그인"}
      </Button>

      {onGoogle && <SocialLogin onGoogle={onGoogle} disabled={pending} />}
    </form>
  );
}
