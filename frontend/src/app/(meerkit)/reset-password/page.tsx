import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { meerkitConfig } from "@/meerkit";
import { ResetPasswordPage } from "@/meerkit/auth/ResetPasswordPage";

export const metadata: Metadata = { title: "비밀번호 재설정", robots: { index: false, follow: false } };

export default function Page() {
  if (meerkitConfig.docsOnly) notFound();
  // useSearchParams는 Suspense 안에서 읽어야 한다.
  return (
    <Suspense>
      <ResetPasswordPage />
    </Suspense>
  );
}
