"use client";

import { hasRole, type RoleName } from "../../roles";
import { useAuth } from "../hooks";
import { LoadingState } from "../../loading";
import { ForbiddenState } from "../../status/ForbiddenState";
import { RequireAuth } from "./RequireAuth";

function RoleCheck({ role, children }: { role: RoleName; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <LoadingState fullPage />;
  if (!hasRole(user, role)) {
    return <ForbiddenState />;
  }
  return <>{children}</>;
}

export function RequireRole({ role, children }: { role: RoleName; children: React.ReactNode }) {
  return (
    <RequireAuth>
      <RoleCheck role={role}>{children}</RoleCheck>
    </RequireAuth>
  );
}
