import * as React from "react";

import { cn } from "@/lib/utils";

// 내용이 들어올 자리를 회색 블록으로 미리 잡아 두는 자리표시자. 빛이 천천히 지나간다.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden className={cn("mk-skeleton rounded-md", className)} {...props} />;
}

export { Skeleton };
