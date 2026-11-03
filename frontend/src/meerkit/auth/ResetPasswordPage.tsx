"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { Card, CardContent } from "@/components/ui/card";

import { errorMessage } from "../api/error";
import { LogoMark } from "../brand/LogoMark";
import { meerkitConfig } from "../config";
import { ResetPasswordForm } from "./components/ResetPasswordForm";
import { useAuthDialog } from "./dialog-store";
import { useAuth } from "./hooks";
import { useResetPassword } from "./mutations";

// 메일의 링크(/reset-password?token=...)로 들어오는 화면
export function ResetPasswordPage() {
  const token = useSearchParams().get("token");
  const reset = useResetPassword();
  const openDialog = useAuthDialog((s) => s.openDialog);
  const router = useRouter();
  const { isAuthenticated } = useAuth();

  // 재설정을 마치고 이 화면에서 로그인하면 웰컴 화면으로 보낸다
  useEffect(() => {
    if (reset.isSuccess && isAuthenticated) router.replace(meerkitConfig.routes.home);
  }, [reset.isSuccess, isAuthenticated, router]);

  return (
    <div className="flex min-h-screen flex-col">
      <main className="mk-rise mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-12">
        <div className="grid justify-items-center gap-3 text-center">
          <LogoMark className="size-14" />
          <h1 className="text-2xl font-semibold tracking-tight">비밀번호 재설정</h1>
          <p className="text-sm text-muted-foreground">새로 사용할 비밀번호를 입력해 주세요.</p>
        </div>
        <Card>
          <CardContent>
            {token ? (
              <ResetPasswordForm
                onSubmit={({ password }) => reset.mutate({ token, password })}
                pending={reset.isPending}
                error={errorMessage(reset.error)}
                done={reset.isSuccess}
                onLogin={() => openDialog("login")}
              />
            ) : (
              <div className="grid justify-items-center gap-2 py-4 text-center">
                <p className="text-sm font-semibold">유효하지 않은 링크입니다</p>
                <p className="text-[13px] text-muted-foreground">메일의 링크를 다시 눌러 주세요. 링크가 만료되었다면 비밀번호 찾기를 다시 진행해 주세요.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
