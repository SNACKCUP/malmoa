"use client";

import { useAuth } from "../hooks";
import { useAuthDialog } from "../dialog-store";
import { LoadingState } from "../../loading";
import { Button } from "@/components/ui/button";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const openDialog = useAuthDialog((s) => s.openDialog);

  if (isLoading) return <LoadingState fullPage />;
  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center gap-3 p-10">
        <p className="text-sm text-muted-foreground">로그인이 필요합니다.</p>
        <Button onClick={() => openDialog("login")}>로그인</Button>
      </div>
    );
  }
  return <>{children}</>;
}
