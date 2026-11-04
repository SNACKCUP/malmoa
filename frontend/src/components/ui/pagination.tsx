import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

// 1 … 4 5 [6] 7 8 … 20 처럼 현재 페이지 주변만 보여 준다.
export function pageItems(page: number, pageCount: number): (number | "…")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const items: (number | "…")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);
  if (start > 2) items.push("…");
  for (let p = start; p <= end; p++) items.push(p);
  if (end < pageCount - 1) items.push("…");
  items.push(pageCount);
  return items;
}

interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
}

const base =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-[13px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-40";

export function Pagination({ page, pageCount, onPageChange, className }: PaginationProps) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="페이지 이동" className={cn("flex items-center gap-1", className)}>
      <button type="button" aria-label="이전 페이지" className={cn(base, "hover:bg-accent")} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        <ChevronLeft className="size-4" />
      </button>
      {pageItems(page, pageCount).map((item, i) =>
        item === "…" ? (
          <span key={`gap-${i}`} className="px-1 text-muted-foreground">…</span>
        ) : (
          <button
            key={item}
            type="button"
            aria-current={item === page ? "page" : undefined}
            className={cn(base, item === page ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-accent")}
            onClick={() => onPageChange(item)}
          >
            {item}
          </button>
        ),
      )}
      <button type="button" aria-label="다음 페이지" className={cn(base, "hover:bg-accent")} disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
        <ChevronRight className="size-4" />
      </button>
    </nav>
  );
}
