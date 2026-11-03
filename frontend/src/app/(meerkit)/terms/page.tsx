import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { meerkitConfig } from "@/meerkit";
import { LegalPage } from "@/meerkit/legal/LegalPage";

export const metadata: Metadata = { title: "이용약관", description: "Meerkit 이용약관입니다.", alternates: { canonical: "/terms" } };

export default function Page() {
  if (meerkitConfig.docsOnly) notFound();
  return <LegalPage kind="terms" />;
}
