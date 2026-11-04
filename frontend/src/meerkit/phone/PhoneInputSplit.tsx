"use client";

import { useRef } from "react";

import { Input } from "@/components/ui/input";

import { phoneDigits, splitPhone } from "./utils";

interface PhoneInputSplitProps {
  /** "010-1234-5678" 형식의 값. PhoneInput과 같은 형식으로 주고받는다 */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  disabled?: boolean;
  "aria-invalid"?: boolean;
}

const LIMITS = [3, 4, 4] as const;
const LABELS = ["전화번호 앞자리", "전화번호 가운데 자리", "전화번호 뒷자리"] as const;

// 칸 3개로 나눠 입력한다. 칸을 다 채우면 다음 칸으로 포커스가 넘어가고, 빈 칸에서 지우면 앞 칸으로 돌아간다.
export function PhoneInputSplit({ value, onChange, id, disabled, ...aria }: PhoneInputSplitProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const parts = splitPhone(value);

  function change(index: number, raw: string) {
    const digits = phoneDigits(raw).slice(0, LIMITS[index]);
    const next = [...parts];
    next[index] = digits;
    onChange(joinParts(next));
    if (digits.length === LIMITS[index] && index < 2) refs.current[index + 1]?.focus();
  }

  return (
    <div className="flex items-center gap-2" role="group" aria-label="전화번호">
      {parts.map((part, i) => (
        <div key={i} className="flex min-w-0 flex-1 items-center gap-2">
          <Input
            id={i === 0 ? id : undefined}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="tel"
            inputMode="numeric"
            autoComplete={i === 0 ? "tel-area-code" : "tel-local"}
            maxLength={LIMITS[i]}
            aria-label={LABELS[i]}
            disabled={disabled}
            className="text-center"
            value={part}
            onChange={(e) => change(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && part === "" && i > 0) refs.current[i - 1]?.focus();
            }}
            {...aria}
          />
          {i < 2 && <span className="text-muted-foreground" aria-hidden>-</span>}
        </div>
      ))}
    </div>
  );
}

// 칸 사이에 하이픈을 붙인다. 뒤쪽 칸이 비어 있으면 붙이지 않는다 (입력 도중의 값).
function joinParts(parts: string[]): string {
  return parts.join("-").replace(/-+$/, "");
}
