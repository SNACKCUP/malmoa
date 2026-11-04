"use client";

import { MailCheck } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { ForgotIdInput } from "../../types";

interface ForgotIdFormProps {
  onSubmit: (input: ForgotIdInput) => void;
  pending?: boolean;
  error?: string | null;
  /** true면 "메일을 보냈습니다" 안내로 바뀐다 */
  sent?: boolean;
  /** 안내 화면에서 눌렀을 때 로그인으로 돌아간다 */
  onBack?: () => void;
}

// 아이디 찾기: 가입한 이메일을 넣으면 일부를 가린 아이디(예: ad***)를 메일로 보낸다.
// 가입 여부가 드러나지 않도록 안내 문구는 항상 같다 (비밀번호 찾기와 같은 방식).
export function ForgotIdForm({ onSubmit, pending, error, sent, onBack }: ForgotIdFormProps) {
  const [email, setEmail] = useState("");

  if (sent) {
    return (
      <div className="mk-swap grid justify-items-center gap-3 py-4 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted"><MailCheck className="size-5" /></span>
        <p className="text-sm font-semibold">메일을 확인해 주세요</p>
        <p className="text-[13px] leading-6 text-muted-foreground">
          <span className="font-medium text-foreground">{email}</span>(으)로 아이디 안내 메일을 보냈습니다.
          <br />가입된 이메일이라면 곧 도착합니다. 메일이 없다면 스팸함도 확인해 주세요.
        </p>
        {onBack && <Button type="button" variant="outline" size="sm" onClick={onBack}>로그인으로 돌아가기</Button>}
      </div>
    );
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ email: email.trim() });
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="forgot-id-email">이메일</Label>
        <Input id="forgot-id-email" type="email" autoComplete="email" required placeholder="가입할 때 사용한 이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "보내는 중…" : "아이디 받기"}</Button>
    </form>
  );
}
