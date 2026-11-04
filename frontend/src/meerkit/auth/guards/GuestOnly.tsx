"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { meerkitConfig } from "../../config";
import { LoadingState } from "../../loading";
import { useAuth } from "../hooks";

interface GuestOnlyProps {
  children: React.ReactNode;
  /** 로그인한 사람을 보낼 곳. 기본은 `routes.home` */
  redirectTo?: string;
}

// 로그인하지 않은 사람만 볼 수 있는 화면(로그인·회원가입·아이디 찾기·비밀번호 찾기 등)을 감싼다.
// 로그인한 사람이 주소창으로 들어오면 화면을 보여 주지 않고 redirectTo로 보낸다.
export function GuestOnly({ children, redirectTo = meerkitConfig.routes.home }: GuestOnlyProps) {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (isAuthenticated && !isLoading) router.replace(redirectTo);
  }, [isAuthenticated, isLoading, redirectTo, router]);

  // 세션을 확인하는 동안과 이동하는 동안에는 화면을 비워 둔다(깜빡임 방지)
  if (isLoading || isAuthenticated) return <LoadingState fullPage />;
  return <>{children}</>;
}
