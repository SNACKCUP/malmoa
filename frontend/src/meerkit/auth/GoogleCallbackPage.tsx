"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import { refreshAccessToken } from "../api/client";
import { meerkitConfig } from "../config";
import { LoadingState } from "../loading";
import { StatusScreen } from "../status/StatusScreen";
import { setSessionHint } from "./session-hint";

// 서버가 구글 인증을 마치고 돌려보내는 주소(/auth/google/callback).
// 서버가 이미 리프레시 쿠키를 심어 두었으므로, 토큰은 URL로 받지 않고 refresh 요청으로 받는다.
// 인증이 실패하면 서버가 ?error=... 를 붙여 보낸다.
export function GoogleCallbackPage() {
  const router = useRouter();
  const serverError = useSearchParams().get("error");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (serverError) return;
    refreshAccessToken().then((token) => {
      if (!token) return setFailed(true);
      setSessionHint(true);
      router.replace(meerkitConfig.routes.home);
    });
  }, [serverError, router]);

  if (serverError || failed) {
    return (
      <StatusScreen
        code="!"
        title="구글 로그인에 실패했습니다"
        description={
          serverError
            ? "구글 인증을 마치지 못했습니다. 잠시 후 다시 시도해 주세요."
            : "로그인 정보를 확인하지 못했습니다. 다시 시도해 주세요."
        }
        actions={
          <Button onClick={() => router.replace(meerkitConfig.routes.home)}>
            처음으로
          </Button>
        }
      />
    );
  }
  return <LoadingState fullPage label="구글 로그인 중…" />;
}
