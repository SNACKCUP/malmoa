"use client";

import { ShieldAlert, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { RoleBadges } from "../../auth/components/RoleBadges";
import { UserAvatar, displayName } from "../../auth/components/UserAvatar";
import { ADMIN_ROLE, ROLES, type RoleName } from "../../roles";
import type { User } from "../../types";

interface RoleAssignDialogProps {
  /** 역할을 바꿀 사용자. null이면 열려 있어도 아무것도 그리지 않는다 */
  user: User | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 새 역할 코드 목록을 전달한다 (하나 이상). 확인을 누르면 호출되고 모달은 닫힌다 */
  onSubmit: (roles: RoleName[]) => void;
  pending?: boolean;
  /** 지금 로그인한 관리자의 id. 서버가 자기 역할 변경을 막으므로 본인이면 변경을 잠근다 */
  currentUserId?: number;
}

const CRUD = [
  ["C", "Create(생성)"],
  ["R", "Read(조회)"],
  ["U", "Update(수정)"],
  ["D", "Delete(삭제)"],
] as const;

function CrudChips({ crud }: { crud: string }) {
  return (
    <span className="flex gap-1" aria-label={`권한 ${crud}`}>
      {CRUD.map(([letter, title]) => (
        <span
          key={letter}
          title={title}
          className={cn(
            "flex size-5 items-center justify-center rounded-md font-mono text-[10px] font-semibold transition-colors",
            crud.includes(letter) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground/60",
          )}
        >
          {letter}
        </span>
      ))}
    </span>
  );
}

// 관리자가 한 사용자에게 역할(권한)을 부여하거나 바꾸는 확인 창. 한 사람에게 여러 역할을 줄 수 있다.
// 역할마다 무엇을 할 수 있는지 보여 주고, 위험한 변경은 확인 전에 경고한다.
function Body({ user, onOpenChange, onSubmit, pending, currentUserId }: Omit<RoleAssignDialogProps, "open" | "user"> & { user: User }) {
  const currentNames = ROLES.filter((r) => user.roles.some((ur) => ur.id === r.id)).map((r) => r.name);
  const [selected, setSelected] = useState<RoleName[]>(currentNames);
  const toggle = (name: RoleName, on: boolean) =>
    setSelected((prev) => ROLES.map((r) => r.name).filter((n) => (n === name ? on : prev.includes(n))));
  const changed = selected.length !== currentNames.length || selected.some((n) => !currentNames.includes(n));
  const isSelf = user.id === currentUserId;
  const empty = selected.length === 0;
  const grantsAdmin = selected.includes(ADMIN_ROLE) && !currentNames.includes(ADMIN_ROLE);
  const revokesAdmin = !selected.includes(ADMIN_ROLE) && currentNames.includes(ADMIN_ROLE);

  return (
    <>
      <DialogHeader>
        <DialogTitle>역할 변경</DialogTitle>
        <DialogDescription>이 사용자에게 줄 역할을 모두 선택하세요. 여러 개를 고를 수 있고, 역할에 따라 할 수 있는 일이 달라집니다.</DialogDescription>
      </DialogHeader>

      <div className="flex items-center gap-3 rounded-2xl border bg-card p-3">
        <UserAvatar user={user} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{displayName(user)}</p>
          <p className="truncate text-xs text-muted-foreground">{user.user_id} · {user.email}</p>
        </div>
        <RoleBadges roles={user.roles} className="justify-end" />
      </div>

      <div className="grid gap-2">
        {ROLES.map((r) => (
          <label
            key={r.id}
            htmlFor={`role-${r.id}`}
            className="flex cursor-pointer items-center gap-3 rounded-2xl border bg-card p-3 transition-all duration-200 hover:bg-surface has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-surface has-[[data-state=checked]]:shadow-soft"
          >
            <Checkbox
              id={`role-${r.id}`}
              checked={selected.includes(r.name)}
              disabled={isSelf}
              onCheckedChange={(v) => toggle(r.name, v === true)}
            />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                {r.name}
                {currentNames.includes(r.name) && <span className="text-[11px] font-normal text-muted-foreground">현재</span>}
              </p>
              <p className="text-xs text-muted-foreground">{r.description}</p>
            </div>
            <CrudChips crud={r.crud} />
          </label>
        ))}
      </div>

      {changed && !empty && (
        <div className="mk-swap flex flex-wrap items-center justify-center gap-2 text-sm">
          {currentNames.map((n) => <Badge key={n} variant="secondary">{n}</Badge>)}
          <span className="text-muted-foreground">→</span>
          {selected.map((n) => <Badge key={n} variant="brand">{n}</Badge>)}
        </div>
      )}
      {empty && <p role="alert" className="text-center text-[13px] text-destructive">역할을 하나 이상 선택해 주세요.</p>}
      {isSelf && (
        <div role="alert" className="mk-swap flex gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-3 text-[13px] leading-5">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p>
            <strong className="text-destructive">자기 자신의 역할은 바꿀 수 없습니다.</strong> 관리자가 아무도 남지 않는 상황을 막기 위해서입니다. 다른 관리자에게 요청하세요.
          </p>
        </div>
      )}
      {grantsAdmin && !isSelf && (
        <div className="mk-swap flex gap-3 rounded-2xl border bg-surface p-3 text-[13px] leading-5 shadow-soft">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-brand" />
          <p><strong>{ADMIN_ROLE}</strong>는 모든 사용자와 데이터를 관리할 수 있습니다. 꼭 필요한 사람에게만 부여하세요.</p>
        </div>
      )}
      {revokesAdmin && !isSelf && (
        <div className="mk-swap flex gap-3 rounded-2xl border bg-surface p-3 text-[13px] leading-5 shadow-soft">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-brand" />
          <p>이 사용자는 더 이상 관리자 화면에 들어올 수 없게 됩니다.</p>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>취소</Button>
        <Button
          type="button"
          disabled={!changed || empty || isSelf || pending}
          onClick={() => {
            onSubmit(selected);
            onOpenChange(false);
          }}
        >
          {pending ? "변경 중…" : "역할 변경"}
        </Button>
      </div>
    </>
  );
}

export function RoleAssignDialog({ user, open, onOpenChange, ...rest }: RoleAssignDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        {/* 사용자가 바뀔 때마다 선택 상태를 새로 시작한다 */}
        {user && <Body key={user.id} user={user} onOpenChange={onOpenChange} {...rest} />}
      </DialogContent>
    </Dialog>
  );
}
