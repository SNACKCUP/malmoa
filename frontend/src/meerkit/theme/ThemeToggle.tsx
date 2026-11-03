"use client";

import { Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";

import { applyTheme, saveTheme } from "./theme";

// 해/달 버튼. 아이콘은 CSS(dark: 변형)로 바꿔서, 서버 화면과 어긋나 하이드레이션 경고가 나지 않는다.
export function ThemeToggle({ className }: { className?: string }) {
  function toggle() {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
    saveTheme(next);
  }
  return (
    <button
      type="button"
      aria-label="다크 모드 전환"
      title="다크 모드 전환"
      onClick={toggle}
      className={cn("grid size-9 place-items-center rounded-xl border bg-surface text-muted-foreground shadow-soft outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/30", className)}
    >
      <Sun className="size-4 dark:hidden" aria-hidden />
      <Moon className="hidden size-4 dark:block" aria-hidden />
    </button>
  );
}
