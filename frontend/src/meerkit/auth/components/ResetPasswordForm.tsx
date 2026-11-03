"use client";

import { CircleCheck } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ResetPasswordFormProps {
  onSubmit: (input: { password: string }) => void;
  pending?: boolean;
  error?: string | null;
  /** true면 "변경 완료" 안내로 바뀐다 */
  done?: boolean;
  /** 완료 화면의 로그인 버튼 */
  onLogin?: () => void;
}

export function ResetPasswordForm({ onSubmit, pending, error, done, onLogin }: ResetPasswordFormProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);

  if (done) {
    return (
      <div className="mk-swap grid justify-items-center gap-3 py-4 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted"><CircleCheck className="size-5" /></span>
        <p className="text-sm font-semibold">비밀번호를 변경했습니다</p>
        <p className="text-[13px] text-muted-foreground">새 비밀번호로 로그인해 주세요.</p>
        {onLogin && <Button type="button" size="sm" onClick={onLogin}>로그인</Button>}
      </div>
    );
  }

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (password.length < 8) return setInvalid("비밀번호는 8자 이상이어야 합니다.");
        if (password !== confirm) return setInvalid("비밀번호가 일치하지 않습니다.");
        setInvalid(null);
        onSubmit({ password });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="reset-password">새 비밀번호</Label>
        <Input id="reset-password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="reset-password-confirm">새 비밀번호 확인</Label>
        <Input id="reset-password-confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      {(invalid ?? error) && <p role="alert" className="text-sm text-destructive">{invalid ?? error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "변경 중…" : "비밀번호 변경"}</Button>
    </form>
  );
}
