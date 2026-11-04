"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import { errorMessage } from "../../api/error";
import type { User } from "../../types";
import { NICKNAME_RANGE } from "./OptionalFields";
import { NicknameInput } from "./NicknameInput";

interface NicknameFormProps {
  user: Pick<User, "nickname">;
  /**
   * 새 닉네임을 저장한다. 비우면 닉네임이 지워지고 이름이 다시 보인다.
   * Promise를 돌려주면 성공했을 때만 편집 창이 닫히고, 실패하면 열어 둔 채 오류를 보여 준다.
   */
  onSubmit: (nickname: string) => void | Promise<unknown>;
  pending?: boolean;
  error?: string | null;
  /** [자동 생성] 버튼 표시 여부. 기본 true */
  generator?: boolean;
}

// 마이페이지에서 닉네임만 빠르게 보고 바꾸는 한 줄 편집기. [변경]을 누르면 입력칸으로 바뀐다.
export function NicknameForm({ user, onSubmit, pending, error, generator = true }: NicknameFormProps) {
  const current = user.nickname ?? "";
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const next = value.trim();
    const length = Array.from(next).length;
    if (next && (length < NICKNAME_RANGE.min || length > NICKNAME_RANGE.max)) {
      return setInvalid(`닉네임은 ${NICKNAME_RANGE.min}~${NICKNAME_RANGE.max}자로 입력해 주세요.`);
    }
    setInvalid(null);
    setFailure(null);
    try {
      await onSubmit(next);
      setEditing(false); // 성공했을 때만 닫는다
    } catch (err) {
      setFailure(errorMessage(err)); // 실패하면 입력한 값을 그대로 두고 오류를 보여 준다
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">닉네임</p>
          <p className="truncate text-sm font-medium">{current || <span className="font-normal text-muted-foreground">설정하지 않음</span>}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setValue(current);
            setEditing(true);
          }}
        >
          <Pencil /> 변경
        </Button>
      </div>
    );
  }

  return (
    <form className="mk-swap grid gap-2" onSubmit={save} noValidate>
      <Label htmlFor="nickname-edit">닉네임</Label>
      <NicknameInput id="nickname-edit" value={value} onChange={setValue} generator={generator} placeholder={`${NICKNAME_RANGE.min}~${NICKNAME_RANGE.max}자`} />
      {(invalid ?? failure ?? error) && <p role="alert" className="text-xs text-destructive">{invalid ?? failure ?? error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || value.trim() === current}>{pending ? "저장 중…" : "저장"}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => { setEditing(false); setInvalid(null); setFailure(null); }}>취소</Button>
      </div>
    </form>
  );
}
