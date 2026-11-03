import Image from "next/image";

import { cn } from "@/lib/utils";

// 로고 이미지에서 미어캣 얼굴만 잘라서 보여 준다 (글씨 부분은 제외).
export function LogoMark({ className }: { className?: string }) {
  return (
    <div className={cn("relative size-16 overflow-hidden rounded-3xl border bg-card", className)}>
      <Image
        src="/meerkit-logo.png"
        alt="Meerkit"
        fill
        sizes="160px"
        priority
        className="scale-[2.25] object-cover"
        style={{ transformOrigin: "46% 36%" }}
      />
    </div>
  );
}
