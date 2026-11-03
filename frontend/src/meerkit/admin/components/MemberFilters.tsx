"use client";

import { RotateCcw, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import { ROLES } from "../../roles";
import type { MemberQuery, MemberStatus } from "../../types";
import { STATUS_OPTIONS, defaultMemberQuery } from "../members-filter";

interface MemberFiltersProps {
  query: MemberQuery;
  onChange: (patch: Partial<MemberQuery>) => void;
  /** 검색어를 입력하고 이 시간(ms)이 지나면 반영한다 */
  debounceMs?: number;
}

// 검색어, 역할, 상태 필터. 조건이 바뀌면 1페이지로 돌아간다.
export function MemberFilters({ query, onChange, debounceMs = 300 }: MemberFiltersProps) {
  const [text, setText] = useState(query.q);
  // 밖에서 검색어가 바뀌면(예: "필터 초기화") 입력창도 따라간다. 입력 중인 글자는 건드리지 않는다.
  const [appliedQ, setAppliedQ] = useState(query.q);
  if (query.q !== appliedQ) {
    setAppliedQ(query.q);
    setText(query.q);
  }

  // 입력이 멈추면 검색어를 반영한다
  useEffect(() => {
    if (text === query.q) return;
    const id = setTimeout(() => onChange({ q: text, page: 1 }), debounceMs);
    return () => clearTimeout(id);
  }, [text, query.q, debounceMs, onChange]);

  const filtered = query.q !== "" || query.roleId !== null || query.status !== "all";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-52 flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="멤버 검색"
          placeholder="아이디, 이름, 이메일 검색"
          className="h-9 pl-9"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <NativeSelect
        aria-label="역할 필터"
        value={query.roleId ?? ""}
        onChange={(e) => onChange({ roleId: e.target.value === "" ? null : Number(e.target.value), page: 1 })}
      >
        <option value="">전체 역할</option>
        {ROLES.map((r) => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </NativeSelect>
      <NativeSelect
        aria-label="상태 필터"
        value={query.status}
        onChange={(e) => onChange({ status: e.target.value as MemberStatus, page: 1 })}
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </NativeSelect>
      {filtered && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setText("");
            onChange({ ...defaultMemberQuery, size: query.size });
          }}
        >
          <RotateCcw /> 초기화
        </Button>
      )}
    </div>
  );
}
