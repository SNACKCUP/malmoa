import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalView } from "@/components/malmoa/legal/legal-view";
import { meerkitConfig } from "@/meerkit";

// 말모아 본문(components/malmoa/legal/content.ts, 버전 2)을 98 창으로 보여 준다. meerkit 본문(LegalPage)은 쓰지 않는다 (2026-11-03 통합 단계 4)
export const metadata: Metadata = { title: "개인정보 처리방침", description: "말모아 개인정보 처리방침입니다. 회의 녹음·원문·회의록을 어떻게 처리하고 보관하는지 밝힙니다.", alternates: { canonical: "/privacy" } };

export default function Page() {
  if (meerkitConfig.docsOnly) notFound();
  return <LegalView kind="privacy" />;
}
