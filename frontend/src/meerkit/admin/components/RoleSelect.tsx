"use client";

import { Checkbox } from "@/components/ui/checkbox";

import { ROLES, type RoleName } from "../../roles";

interface RoleSelectProps {
  /** 지금 선택된 역할 코드 목록 */
  value: RoleName[];
  /** 체크가 바뀔 때마다 새 역할 목록을 전달한다. 마지막 하나는 끌 수 없다 */
  onChange: (roles: RoleName[]) => void;
  disabled?: boolean;
  idPrefix?: string;
}

// 표 안에서 바로 역할을 켜고 끄는 체크박스 묶음 (한 사람이 여러 역할을 가질 수 있다)
export function RoleSelect({ value, onChange, disabled, idPrefix = "role" }: RoleSelectProps) {
  const toggle = (name: RoleName, on: boolean) => {
    const next = ROLES.map((r) => r.name).filter((n) => (n === name ? on : value.includes(n)));
    if (next.length > 0) onChange(next);
  };
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {ROLES.map((r) => {
        const id = `${idPrefix}-${r.id}`;
        const checked = value.includes(r.name);
        return (
          <label key={r.id} htmlFor={id} className="flex items-center gap-1.5 text-xs">
            <Checkbox
              id={id}
              checked={checked}
              disabled={disabled || (checked && value.length === 1)}
              onCheckedChange={(v) => toggle(r.name, v === true)}
            />
            {r.name}
          </label>
        );
      })}
    </span>
  );
}
