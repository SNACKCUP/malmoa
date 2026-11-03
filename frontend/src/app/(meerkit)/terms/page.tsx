import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalView } from "@/components/malmoa/legal/legal-view";
import { meerkitConfig } from "@/meerkit";

// 말모아 본문(components/malmoa/legal/content.ts, 버전 2)을 98 창으로 보여 준다. meerkit 본문(LegalPage)은 쓰지 않는다 (2026-11-03 통합 단계 4)
export const metadata: Metadata = { title: "이용약관", description: "말모아 이용약관입니다.", alternates: { canonical: "/terms" } };

export default function Page() {
  if (meerkitConfig.docsOnly) notFound();
  return <LegalView kind="terms" />;
}
