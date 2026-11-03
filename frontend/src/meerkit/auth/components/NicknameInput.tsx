"use client";

import { Dices } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { generateNickname } from "../nickname";

interface NicknameInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** true면 입력칸 옆에 [자동 생성] 버튼을 보여 준다 */
  generator?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

// 닉네임 입력칸. 직접 입력하거나 [자동 생성]으로 이름을 받아 쓴다. 누를 때마다 새 이름이 나온다.
export function NicknameInput({ id, value, onChange, generator = true, placeholder, disabled }: NicknameInputProps) {
  return (
    <div className="flex gap-2">
      <Input id={id} autoComplete="nickname" placeholder={placeholder} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} />
      {generator && (
        <Button type="button" variant="outline" size="field" disabled={disabled} onClick={() => onChange(generateNickname())}>
          <Dices /> 자동 생성
        </Button>
      )}
    </div>
  );
}
