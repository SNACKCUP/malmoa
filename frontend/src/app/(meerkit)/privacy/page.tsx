import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { meerkitConfig } from "@/meerkit";
import { LegalPage } from "@/meerkit/legal/LegalPage";

export const metadata: Metadata = { title: "개인정보 처리방침", description: "Meerkit 개인정보 수집 및 이용에 관한 안내입니다.", alternates: { canonical: "/privacy" } };

export default function Page() {
  if (meerkitConfig.docsOnly) notFound();
  return <LegalPage kind="privacy" />;
}
