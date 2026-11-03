import { ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

// 브라우저 기본 select. 접근성과 모바일 대응이 좋고, 모양만 shadcn 입력창에 맞춘다.
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative inline-flex">
      <select
        className={cn(
          "h-9 w-full appearance-none rounded-xl border bg-surface pl-3 pr-8 text-[13px] shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-brand/60 focus-visible:ring-[3px] focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export { NativeSelect };
