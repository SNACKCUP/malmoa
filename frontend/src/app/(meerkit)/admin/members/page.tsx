import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { meerkitConfig } from "@/meerkit";
import { AdminMembersPage } from "@/meerkit/admin/AdminMembersPage";

export const metadata: Metadata = { title: "멤버 관리", robots: { index: false, follow: false } };

export default function Page() {
  if (meerkitConfig.docsOnly) notFound();
  return <AdminMembersPage />;
}
