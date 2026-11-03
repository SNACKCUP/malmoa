"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { RoleBadges } from "../../auth/components/RoleBadges";
import { displayName } from "../../auth/components/UserAvatar";
import { ROLES, type RoleName } from "../../roles";
import type { User } from "../../types";
import { RoleAssignDialog } from "./RoleAssignDialog";
import { RoleSelect } from "./RoleSelect";

interface MemberTableProps {
  members: User[];
  /** 새 역할 코드 목록을 전달한다 (한 사람이 여러 역할을 가질 수 있다) */
  onRoleChange: (id: number, roles: RoleName[]) => void;
  onRemove: (id: number) => void;
  /**
   * 활성/비활성 전환 (PATCH /users/{id}/active). 주면 [비활성화]·[활성화]·[잠금 해제]·[복구] 버튼이 생긴다.
   * 서버는 이때 로그인 잠금도 함께 풀고, 탈퇴 계정을 활성화하면 탈퇴를 취소한다.
   */
  onActiveChange?: (id: number, isActive: boolean) => void;
  /**
   * "dialog": 역할 옆 [변경] 버튼 → 확인 창에서 역할 설명을 보고 선택 (기본)
   * "inline": 표 안의 선택 상자에서 바로 변경
   */
  roleEditor?: "dialog" | "inline";
  /** 지금 로그인한 관리자의 id. 서버가 자기 역할·상태 변경을 막으므로 본인 행은 잠근다 */
  currentUserId?: number;
}

// 연속 로그인 실패로 잠긴 상태 (잠금 시각이 아직 지나지 않음)
const isLocked = (u: User) => !!u.locked_until && new Date(u.locked_until).getTime() > Date.now();

function StatusBadge({ user }: { user: User }) {
  if (user.deactivated_at) return <Badge variant="destructive">삭제됨</Badge>;
  return (
    <span className="flex flex-wrap gap-1">
      {user.is_active ? <Badge variant="brand">활성</Badge> : <Badge variant="secondary">비활성</Badge>}
      {isLocked(user) && <Badge variant="outline">잠김</Badge>}
    </span>
  );
}

// 상태에 맞는 버튼 하나: 활성 → 비활성화, 비활성 → 활성화, 잠김 → 잠금 해제, 탈퇴 → 복구 (개인정보를 지운 계정은 없음)
function ActiveButton({ user, disabled, onChange }: { user: User; disabled: boolean; onChange: (isActive: boolean) => void }) {
  if (user.deleted_at) return null;
  const [label, next] = user.deactivated_at
    ? ["복구", true]
    : isLocked(user)
      ? ["잠금 해제", true]
      : user.is_active
        ? ["비활성화", false]
        : ["활성화", true];
  return (
    <Button variant="outline" size="sm" disabled={disabled} onClick={() => onChange(next)}>
      {label}
    </Button>
  );
}

const date = (iso: string) => iso.slice(0, 10);
const roleNames = (u: User) => ROLES.filter((r) => u.roles.some((ur) => ur.id === r.id)).map((r) => r.name);

export function MemberTable({ members, onRoleChange, onRemove, onActiveChange, roleEditor = "dialog", currentUserId }: MemberTableProps) {
  const [target, setTarget] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  // 탈퇴 처리와 복구는 되돌리기 어려우므로 한 번 더 물어본 뒤 실행한다
  const [confirm, setConfirm] = useState<{ kind: "remove" | "restore"; user: User } | null>(null);

  if (members.length === 0) {
    return <p className="p-6 text-center text-sm text-muted-foreground">멤버가 없습니다.</p>;
  }
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>아이디</TableHead>
            <TableHead>이름</TableHead>
            <TableHead>이메일</TableHead>
            <TableHead>역할</TableHead>
            <TableHead>상태</TableHead>
            <TableHead>가입일</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => {
            // 탈퇴한 계정과 본인 계정은 역할·상태를 바꿀 수 없다 (서버도 막는다)
            const withdrawn = !!m.deactivated_at;
            const locked = withdrawn || m.id === currentUserId;
            return (
            <TableRow key={m.id}>
              <TableCell className="text-muted-foreground">{m.id}</TableCell>
              <TableCell className="font-medium">{m.user_id}</TableCell>
              <TableCell>{displayName(m)}</TableCell>
              <TableCell>{m.email}</TableCell>
              <TableCell>
                {roleEditor === "inline" ? (
                  <RoleSelect idPrefix={`role-${m.id}`} value={roleNames(m)} disabled={locked} onChange={(roles) => onRoleChange(m.id, roles)} />
                ) : (
                  <span className="flex items-center gap-2">
                    <RoleBadges roles={m.roles} />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={withdrawn}
                      onClick={() => {
                        setTarget(m);
                        setOpen(true);
                      }}
                    >
                      변경
                    </Button>
                  </span>
                )}
              </TableCell>
              <TableCell><StatusBadge user={m} /></TableCell>
              <TableCell className="text-muted-foreground">{date(m.created_at)}</TableCell>
              <TableCell>
                <span className="flex items-center justify-end gap-1">
                  {onActiveChange && (
                    // 본인 계정은 서버가 막으므로 잠근다. 탈퇴 계정은 [복구]만 쓸 수 있다
                    <ActiveButton
                      user={m}
                      disabled={m.id === currentUserId}
                      onChange={(next) => (m.deactivated_at ? setConfirm({ kind: "restore", user: m }) : onActiveChange(m.id, next))}
                    />
                  )}
                  <Button variant="outline" size="sm" disabled={locked} onClick={() => setConfirm({ kind: "remove", user: m })}>
                    탈퇴 처리
                  </Button>
                </span>
              </TableCell>
            </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <Dialog open={!!confirm} onOpenChange={(next) => !next && setConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{confirm?.kind === "remove" ? "탈퇴 처리할까요?" : "계정을 복구할까요?"}</DialogTitle>
            <DialogDescription>
              {confirm?.kind === "remove"
                ? `${confirm.user.user_id} 계정을 탈퇴 처리합니다. 이 계정은 로그인할 수 없게 되고, 보관 기간이 지나면 개인정보가 삭제됩니다.`
                : confirm && `${confirm.user.user_id} 계정의 탈퇴를 취소하고 다시 활성 상태로 되돌립니다.`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirm(null)}>취소</Button>
            <Button
              variant={confirm?.kind === "remove" ? "destructive" : "default"}
              onClick={() => {
                if (confirm?.kind === "remove") onRemove(confirm.user.id);
                else if (confirm) onActiveChange?.(confirm.user.id, true);
                setConfirm(null);
              }}
            >
              {confirm?.kind === "remove" ? "탈퇴 처리" : "복구"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {roleEditor === "dialog" && (
        <RoleAssignDialog
          user={target}
          open={open}
          onOpenChange={setOpen}
          currentUserId={currentUserId}
          onSubmit={(roles) => target && onRoleChange(target.id, roles)}
        />
      )}
    </>
  );
}
