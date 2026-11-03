import { cn } from "@/lib/utils";

import { Loader, type LoaderSize, type LoaderVariant } from "./Loader";

interface LoadingOverlayProps {
  loading: boolean;
  children: React.ReactNode;
  variant?: LoaderVariant;
  size?: LoaderSize;
  /** 접근성용 문구 (화면에는 보이지 않는다) */
  label?: string;
  className?: string;
}

// 이미 보이는 내용 위에 로더를 덮는다. 목록을 다시 불러올 때 화면이 비지 않고 흐려지며 로더가 나타난다.
export function LoadingOverlay({ loading, children, variant, size = "md", label = "불러오는 중", className }: LoadingOverlayProps) {
  return (
    <div className={cn("relative", className)} aria-busy={loading}>
      <div className={cn("transition-[opacity,filter] duration-300", loading && "pointer-events-none opacity-50 blur-[1px]")}>{children}</div>
      <div
        role="status"
        aria-live="polite"
        className={cn("absolute inset-0 grid place-items-center text-foreground transition-opacity duration-300", loading ? "opacity-100" : "pointer-events-none opacity-0")}
      >
        {loading && (
          <>
            <Loader variant={variant} size={size} />
            <span className="sr-only">{label}</span>
          </>
        )}
      </div>
    </div>
  );
}
