"use client";

import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";

import { UserMenu } from "../auth/components/UserMenu";
import { useAuthDialog } from "../auth/dialog-store";
import { useAuth } from "../auth/hooks";
import { useLogout } from "../auth/mutations";
import { LlmPlayground } from "../ai/LlmPlayground";
import { LogoMark } from "../brand/LogoMark";
import { meerkitConfig } from "../config";
import { GhostCards } from "./GhostCards";

// 요소가 위에서부터 차례로 부드럽게 올라온다.
const delay = (n: number) => ({ animationDelay: `${n * 110}ms` });

export function WelcomePage() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const openDialog = useAuthDialog((s) => s.openDialog);
  const logout = useLogout();

  // 로그인 전후 모두 보인다. 문서는 별도 사이트로 배포하므로 docsUrl로 보내고, 새 창으로 연다.
  const docsButton = meerkitConfig.docsUrl ? (
    <Button asChild size="lg" variant="ghost">
      <a href={meerkitConfig.docsUrl} target="_blank" rel="noreferrer">
        Docs <ArrowUpRight />
      </a>
    </Button>
  ) : null;

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6">
      <GhostCards />
      <div className="relative z-10 flex flex-col items-center gap-6 text-center">
        <div className="mk-rise" style={delay(0)}>
          <LogoMark className="size-24 shadow-soft" />
        </div>
        <h1 className="mk-rise text-5xl font-semibold tracking-tight sm:text-6xl 2xl:text-7xl" style={delay(1)}>
          Welcome to Meerkit
        </h1>
        <p className="mk-rise text-xl font-medium text-foreground/80 sm:text-2xl" style={delay(2)}>
          Let&apos;s build your service, faster.
        </p>
        <p className="mk-rise max-w-md text-balance text-[15px] leading-relaxed text-muted-foreground" style={delay(3)}>
          회원가입, 로그인, 권한 관리를 지금 바로 테스트해 보세요.
        </p>
        <div className="mk-rise pt-2" style={delay(4)}>
          {isLoading ? (
            // 세션을 확인하는 동안 로그인 버튼이 먼저 보였다 사라지지 않게 같은 높이의 빈 자리를 둔다
            <div className="h-11" aria-hidden />
          ) : isAuthenticated && user ? (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <UserMenu user={user} onLogout={() => logout.mutate()} />
              {docsButton}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" onClick={() => openDialog("signup")}>회원가입</Button>
              <Button size="lg" variant="outline" onClick={() => openDialog("login")}>로그인</Button>
              {docsButton}
            </div>
          )}
        </div>
        {meerkitConfig.ai.playground && !isLoading && (
          <div className="mk-rise w-full pt-4" style={delay(5)}>
            <LlmPlayground className="mx-auto" />
          </div>
        )}
      </div>
    </main>
  );
}
