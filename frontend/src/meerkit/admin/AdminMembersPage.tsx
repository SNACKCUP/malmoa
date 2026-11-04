"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";


import { meerkitConfig } from "../config";
import { ADMIN_ROLE } from "../roles";
import { RequireRole } from "../auth/guards/RequireRole";
import { useAuth } from "../auth/hooks";
import type { MemberQuery } from "../types";
import { MemberDirectory } from "./components/MemberDirectory";
import { defaultMemberQuery } from "./members-filter";
import { useMembers, useRemoveMember, useUpdateActive, useUpdateRoles } from "./queries";

function Members() {
  const [query, setQuery] = useState<MemberQuery>(defaultMemberQuery);
  const onQueryChange = useCallback((patch: Partial<MemberQuery>) => setQuery((q) => ({ ...q, ...patch })), []);
  const { data, isFetching, isError } = useMembers(query);
  const updateRoles = useUpdateRoles();
  const removeMember = useRemoveMember();
  const updateActive = useUpdateActive();
  const { user } = useAuth();
  const router = useRouter();

  return (
    <main className="mk-rise mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="rounded-full"
          aria-label="뒤로 가기"
          // 이전 화면이 없으면(주소를 직접 열었으면) 처음 화면으로 간다
          onClick={() => (window.history.length > 1 ? router.back() : router.push(meerkitConfig.routes.home))}
        >
          <ArrowLeft />
        </Button>
        <h1 className="text-3xl font-semibold tracking-tight">멤버 <span className="text-brand">관리</span></h1>
      </div>
      {isError && <p className="mb-4 text-sm text-destructive">목록을 불러오지 못했습니다.</p>}
      <MemberDirectory
        query={query}
        onQueryChange={onQueryChange}
        data={data}
        loading={isFetching}
        onRoleChange={(id, roles) => updateRoles.mutate({ id, roles })}
        onRemove={(id) => removeMember.mutate(id)}
        onActiveChange={(id, isActive) => updateActive.mutate({ id, isActive })}
        currentUserId={user?.id}
      />
    </main>
  );
}

export function AdminMembersPage() {
  return (
    <RequireRole role={ADMIN_ROLE}>
      <Members />
    </RequireRole>
  );
}
