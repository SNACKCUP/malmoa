import { Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { ROLES } from "../roles";
import { mockUsers } from "./mock-users";

// 실제 킷 화면(로그인 폼, 멤버 목록, 역할 선택, 토스트)을 그대로 닮은 장식용 목업.
// 눌리지 않도록 inert + aria-hidden 처리한다.
function Float({ className, delay, children }: { className?: string; delay: number; children: React.ReactNode }) {
  return (
    <div className={cn("mk-fade absolute hidden xl:block", className)} style={{ animationDelay: `${700 + delay * 160}ms` }}>
      <div className="mk-float" style={{ animationDelay: `${delay * -2.3}s` }}>
        {children}
      </div>
    </div>
  );
}

const panel = "rounded-2xl border bg-card shadow-soft";

function LoginCard() {
  return (
    <div className={cn(panel, "w-[270px] p-5")}>
      <p className="text-base font-semibold">로그인</p>
      <p className="mt-0.5 text-xs text-muted-foreground">아이디와 비밀번호를 입력하세요.</p>
      <div className="mt-4 grid gap-3">
        <div className="grid gap-1.5">
          <Label className="text-xs">아이디</Label>
          <Input readOnly tabIndex={-1} value="writer01" className="h-9 text-[13px]" />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">비밀번호</Label>
          <Input readOnly tabIndex={-1} type="password" value="password" className="h-9 text-[13px]" />
        </div>
        <Button tabIndex={-1} size="sm" className="mt-1 w-full">로그인</Button>
      </div>
    </div>
  );
}

function MembersCard() {
  const status = (u: (typeof mockUsers)[number]) =>
    u.is_active ? <Badge variant="brand">활성</Badge> : <Badge variant="secondary">비활성</Badge>;
  return (
    <div className={cn(panel, "w-[330px] overflow-hidden")}>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <p className="text-sm font-semibold">멤버 관리</p>
        <span className="text-xs text-muted-foreground">{mockUsers.length}명</span>
      </div>
      <div className="divide-y">
        {mockUsers.map((u) => (
          <div key={u.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-medium">{u.name.slice(0, 1)}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium leading-4">{u.name}</p>
              <p className="truncate text-xs text-muted-foreground">{u.user_id}</p>
            </div>
            <Badge variant="outline">{u.roles.map((r) => r.name).join(" · ")}</Badge>
            {status(u)}
          </div>
        ))}
      </div>
    </div>
  );
}

function RoleMenu() {
  return (
    <div className={cn(panel, "w-[230px] p-1.5")}>
      <p className="px-2.5 py-1.5 text-xs text-muted-foreground">역할 변경</p>
      {ROLES.map((r) => (
        <div key={r.id} className={cn("flex items-center justify-between rounded-lg px-2.5 py-2 text-[13px]", r.name === "WRITER" && "bg-accent")}>
          <span className="font-medium">{r.name}</span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            {r.crud}
            {r.name === "WRITER" && <Check className="size-3.5 text-foreground" />}
          </span>
        </div>
      ))}
    </div>
  );
}

function Toast() {
  return (
    <div className={cn(panel, "flex w-[300px] items-center gap-3 p-3.5")}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Check className="size-4" />
      </span>
      <div>
        <p className="text-[13px] font-medium">역할이 변경되었습니다</p>
        <p className="text-xs text-muted-foreground">박조회 · VIEWER → WRITER</p>
      </div>
    </div>
  );
}

export function GhostCards() {
  return (
    <div aria-hidden inert className="pointer-events-none absolute inset-0 select-none">
      <Float className="left-[3%] top-[16%]" delay={0}><LoginCard /></Float>
      <Float className="left-[5%] bottom-[12%]" delay={2}><Toast /></Float>
      <Float className="right-[3%] top-[14%]" delay={1}><MembersCard /></Float>
      <Float className="right-[6%] bottom-[10%]" delay={3}><RoleMenu /></Float>
    </div>
  );
}
