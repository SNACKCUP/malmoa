"use client";

import { memo } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TextFieldProps {
  id: string;
  /** 어떤 칸인지. 값이 바뀌면 onValueChange(name, value)로 알린다 */
  name: string;
  label: string;
  value: string;
  onValueChange: (name: string, value: string) => void;
  type?: string;
  autoComplete?: string;
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}

// 라벨 + 입력칸. memo라서 onValueChange를 useCallback으로 고정해 주면, 다른 칸을 입력할 때는 다시 그려지지 않는다.
export const TextField = memo(function TextField({ id, name, label, value, onValueChange, type = "text", ...rest }: TextFieldProps) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(e) => onValueChange(name, e.target.value)} {...rest} />
    </div>
  );
});
