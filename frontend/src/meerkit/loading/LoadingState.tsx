import { cn } from "@/lib/utils";

import { Loader, type LoaderSize, type LoaderVariant } from "./Loader";

interface LoadingStateProps {
  /** 로더 옆(아래)에 보일 문구. false면 문구 없이 로더만. 기본 "불러오는 중…" */
  label?: string | false;
  variant?: LoaderVariant;
  size?: LoaderSize;
  /** "stack": 로더 아래에 문구 (기본) / "inline": 로더 옆에 문구 한 줄 */
  layout?: "stack" | "inline";
  /** true면 화면 한가운데 큰 영역을 차지한다. 페이지 전체를 불러올 때 */
  fullPage?: boolean;
  /** 영역의 최소 높이. 로딩이 끝나고 내용이 들어올 때 화면이 덜 흔들리게 한다. 예: 200, "12rem" */
  minHeight?: number | string;
  className?: string;
}

// "불러오는 중"을 보여 주는 공통 자리. 킷의 모든 로딩 화면이 이것을 쓰고, 모양은 meerkit.config.ts의 loading.variant를 따른다.
export function LoadingState({ label = "불러오는 중…", variant, size = "md", layout = "stack", fullPage, minHeight, className }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ minHeight: fullPage ? undefined : minHeight }}
      className={cn(
        "flex items-center justify-center gap-3 text-muted-foreground",
        layout === "stack" ? "flex-col" : "flex-row",
        fullPage && "min-h-[60vh]",
        className,
      )}
    >
      <Loader variant={variant} size={size} />
      {label !== false && <span className="text-sm">{label}</span>}
      {label === false && <span className="sr-only">불러오는 중</span>}
    </div>
  );
}
