import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { meerkitConfig } from "@/meerkit";
import { MePage } from "@/meerkit/auth/MePage";

export const metadata: Metadata = { title: "내 정보", robots: { index: false, follow: false } };

export default function Page() {
  if (meerkitConfig.docsOnly) notFound();
  return <MePage />;
}
