"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";

import { Toaster } from "@/components/ui/sonner";

import { AuthDialog } from "../auth/components/AuthDialog";
import { useLockoutStore } from "../auth/lockout";
import { refreshAccessToken } from "../api/client";
import { hasSessionHint } from "../auth/session-hint";
import { useAuthStore } from "../auth/store";
import { meerkitConfig } from "../config";
import { ThemeSync } from "../theme/ThemeSync";

// 새로고침 시 리프레시 쿠키로 액세스 토큰을 복원한다.
// 로그인한 적이 있는 브라우저에서만 요청한다 (처음 온 방문자나 문서만 보는 사람에게는 요청이 나가지 않는다).
function useRestoreSession() {
  const setSessionStatus = useAuthStore((s) => s.setSessionStatus);
  useEffect(() => {
    if (meerkitConfig.docsOnly || !hasSessionHint()) {
      setSessionStatus("ready");
      return;
    }
    setSessionStatus("restoring");
    // 복원이 끝나기 전에는 "로그인 전" 화면을 보여 주지 않는다 (useAuth().isLoading)
    refreshAccessToken().finally(() => setSessionStatus("ready"));
  }, [setSessionStatus]);
}

export function MeerkitProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  useRestoreSession();
  // 로그인 실패 횟수·잠금 시각을 sessionStorage에서 복원한다 (새로고침해도 유지)
  useEffect(() => {
    useLockoutStore.persist.rehydrate();
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Suspense fallback={null}>
        <ThemeSync />
      </Suspense>
      <AuthDialog />
      <Toaster />
    </QueryClientProvider>
  );
}
