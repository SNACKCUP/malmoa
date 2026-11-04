import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { Role } from "../../types";

// 사용자가 가진 역할을 배지로 나란히 보여 준다 (한 사람이 여러 역할을 가질 수 있다)
export function RoleBadges({ roles, className }: { roles: Role[]; className?: string }) {
  if (roles.length === 0) return <span className="text-xs text-muted-foreground">역할 없음</span>;
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {roles.map((r) => (
        <Badge key={r.id} variant="outline">{r.name}</Badge>
      ))}
    </span>
  );
}
