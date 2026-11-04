"use client";

import { usePathname } from "next/navigation";

import { ThemeToggle } from "./ThemeToggle";

// 모든 화면 오른쪽 아래에 떠 있는 다크 모드 버튼. 설명서(/docs)는 머리글에 같은 버튼이 있어서 그리지 않는다.
export function FloatingThemeToggle() {
  const pathname = usePathname();
  if (pathname?.startsWith("/docs")) return null;
  return (
    <div className="fixed bottom-5 right-5 z-40 print:hidden">
      <ThemeToggle className="size-11 rounded-full shadow-lg transition-transform duration-200 hover:scale-105 active:scale-95" />
    </div>
  );
}
