"use client";

import { Input } from "@/components/ui/input";

import { PHONE_MAX_LENGTH, formatPhone } from "./utils";

interface PhoneInputProps {
  /** "010-1234-5678" 형식의 값 */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  "aria-invalid"?: boolean;
}

// 칸 하나에 숫자만 입력하면 하이픈이 알아서 붙는다 (최대 13자). 값은 PhoneInputSplit과 같은 형식이다.
export function PhoneInput({ value, onChange, id, disabled, placeholder = "010-1234-5678", ...aria }: PhoneInputProps) {
  return (
    <Input
      id={id}
      type="tel"
      inputMode="numeric"
      autoComplete="tel"
      maxLength={PHONE_MAX_LENGTH}
      placeholder={placeholder}
      disabled={disabled}
      value={formatPhone(value)}
      onChange={(e) => onChange(formatPhone(e.target.value))}
      {...aria}
    />
  );
}
