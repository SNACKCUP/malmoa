"use client";

import { SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Pagination } from "@/components/ui/pagination";

import type { RoleName } from "../../roles";
import type { MemberQuery, Page, User } from "../../types";
import { SIZE_OPTIONS, defaultMemberQuery } from "../members-filter";
import { LoadingOverlay, LoadingState } from "../../loading";
import { MemberFilters } from "./MemberFilters";
import { MemberTable } from "./MemberTable";

interface MemberDirectoryProps {
  query: MemberQuery;
  onQueryChange: (patch: Partial<MemberQuery>) => void;
  /** 현재 조건에 맞는 한 페이지 분량과 전체 개수 */
  data?: Page<User>;
  loading?: boolean;
  onRoleChange: (id: number, roles: RoleName[]) => void;
  onRemove: (id: number) => void;
  /** 활성/비활성 전환. 주면 표에 상태 버튼이 생긴다 */
  onActiveChange?: (id: number, isActive: boolean) => void;
  /** 역할 변경 방식. 기본은 확인 창("dialog"), "inline"이면 표 안의 선택 상자 */
  roleEditor?: "dialog" | "inline";
  /** 지금 로그인한 관리자의 id (본인 행의 역할·탈퇴 처리 잠금용) */
  currentUserId?: number;
}

// 검색·필터·표·페이지네이션을 한 덩어리로 묶은 관리자 멤버 목록.
// 데이터는 밖에서 주입한다 (서버 조회든 목 데이터든 상관없다).
export function MemberDirectory({ query, onQueryChange, data, loading, onRoleChange, onRemove, onActiveChange, roleEditor, currentUserId }: MemberDirectoryProps) {
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / query.size));
  const from = total === 0 ? 0 : (query.page - 1) * query.size + 1;
  const to = Math.min(total, query.page * query.size);

  return (
    <div className="grid gap-4">
      <MemberFilters query={query} onChange={onQueryChange} />

      <div className="overflow-hidden rounded-2xl border bg-card shadow-soft">
        {loading && !data ? (
          <LoadingState minHeight={240} />
        ) : total === 0 ? (
          <div className="grid justify-items-center gap-3 px-6 py-14 text-center">
            <SearchX className="size-7 text-muted-foreground" />
            <p className="text-sm font-medium">조건에 맞는 멤버가 없습니다.</p>
            <Button variant="outline" size="sm" onClick={() => onQueryChange({ ...defaultMemberQuery, size: query.size })}>필터 초기화</Button>
          </div>
        ) : (
          <LoadingOverlay loading={!!loading}>
            <MemberTable members={data!.items} onRoleChange={onRoleChange} onRemove={onRemove} onActiveChange={onActiveChange} roleEditor={roleEditor} currentUserId={currentUserId} />
          </LoadingOverlay>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted-foreground">
        <p>
          {total === 0 ? "결과 없음" : <>전체 <span className="font-medium text-foreground">{total}</span>명 중 {from}–{to}</>}
        </p>
        <div className="flex items-center gap-3">
          <NativeSelect aria-label="페이지당 개수" value={query.size} onChange={(e) => onQueryChange({ size: Number(e.target.value), page: 1 })}>
            {SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n}개씩</option>
            ))}
          </NativeSelect>
          <Pagination page={query.page} pageCount={pageCount} onPageChange={(page) => onQueryChange({ page })} />
        </div>
      </div>
    </div>
  );
}
