"use client";

import { TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { WithdrawInput } from "../../types";

interface WithdrawFormProps {
  onSubmit: (input: WithdrawInput) => void;
  pending?: boolean;
  error?: string | null;
}

// 탈퇴. 비밀번호로 본인을 확인하고, 안내에 동의해야 버튼이 켜진다.
export function WithdrawForm({ onSubmit, pending, error }: WithdrawFormProps) {
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);

  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (password && agreed) onSubmit({ password });
      }}
    >
      <div className="flex gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-3 text-[13px] leading-5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="grid gap-1">
          <p><strong className="text-destructive">탈퇴하면 바로 로그인할 수 없습니다.</strong></p>
          <p>개인정보는 보관 기간(1년)이 지나면 지워집니다. 그 전까지 같은 아이디와 이메일로 다시 가입할 수 없습니다.</p>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="wd-password">비밀번호 확인</Label>
        <Input id="wd-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <label htmlFor="wd-agree" className="flex items-center gap-2 text-sm">
        <Checkbox id="wd-agree" checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} />
        위 내용을 확인했고 탈퇴합니다.
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" variant="destructive" disabled={pending || !password || !agreed} className="justify-self-start">
        {pending ? "처리 중…" : "탈퇴하기"}
      </Button>
    </form>
  );
}
