"use client";

import { useCallback, useState } from "react";

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

  return (
    <main className="mk-rise mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">멤버 <span className="text-brand">관리</span></h1>
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
