"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { ChangePasswordInput } from "../../types";

interface ChangePasswordFormProps {
  onSubmit: (input: ChangePasswordInput) => void;
  pending?: boolean;
  error?: string | null;
}

// 로그인한 사용자가 현재 비밀번호를 확인한 뒤 새 비밀번호로 바꾼다.
export function ChangePasswordForm({ onSubmit, pending, error }: ChangePasswordFormProps) {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [invalid, setInvalid] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (form.next.length < 8) return setInvalid("새 비밀번호는 8자 이상이어야 합니다.");
        if (form.next === form.current) return setInvalid("현재 비밀번호와 다른 비밀번호를 입력해 주세요.");
        if (form.next !== form.confirm) return setInvalid("새 비밀번호가 일치하지 않습니다.");
        setInvalid(null);
        onSubmit({ current_password: form.current, new_password: form.next });
        setForm({ current: "", next: "", confirm: "" });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="cp-current">현재 비밀번호</Label>
        <Input id="cp-current" type="password" autoComplete="current-password" required value={form.current} onChange={set("current")} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="cp-next">새 비밀번호</Label>
        <Input id="cp-next" type="password" autoComplete="new-password" required value={form.next} onChange={set("next")} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="cp-confirm">새 비밀번호 확인</Label>
        <Input id="cp-confirm" type="password" autoComplete="new-password" required value={form.confirm} onChange={set("confirm")} />
      </div>
      {(invalid ?? error) && <p role="alert" className="text-sm text-destructive">{invalid ?? error}</p>}
      <Button type="submit" disabled={pending} className="justify-self-start">{pending ? "변경 중…" : "비밀번호 변경"}</Button>
    </form>
  );
}
