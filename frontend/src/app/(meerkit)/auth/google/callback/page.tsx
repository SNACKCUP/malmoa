import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { meerkitConfig } from "@/meerkit";
import { GoogleCallbackPage } from "@/meerkit/auth/GoogleCallbackPage";

export const metadata: Metadata = { title: "구글 로그인", robots: { index: false, follow: false } };

export default function Page() {
  // 구글 로그인을 켜지 않았으면 이 주소는 없는 것으로 둔다
  if (meerkitConfig.docsOnly || !meerkitConfig.login.social.google) notFound();
  // useSearchParams는 Suspense 안에서 읽어야 한다.
  return (
    <Suspense>
      <GoogleCallbackPage />
    </Suspense>
  );
}
