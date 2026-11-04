"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

import { meerkitConfig } from "../config";
import { StatusScreen } from "./StatusScreen";

/** 로그인은 했지만 필요한 역할이 없을 때 보이는 영역 (RequireRole) */
export function ForbiddenState() {
  return (
    <StatusScreen
      fullPage={false}
      code="403"
      title="접근 권한이 없습니다"
      description="이 화면을 볼 수 있는 역할이 필요합니다. 권한이 필요하면 관리자에게 문의해 주세요."
      actions={
        <Button asChild variant="outline">
          <Link href={meerkitConfig.routes.home}>처음으로</Link>
        </Button>
      }
    />
  );
}
