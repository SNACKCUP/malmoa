"use client";

import { ChevronDown, LogOut, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { meerkitConfig } from "../../config";
import { isAdminUser } from "../../roles";
import type { User } from "../../types";
import { RoleBadges } from "./RoleBadges";
import { UserAvatar, displayName } from "./UserAvatar";

export interface UserMenuItem {
  label: string;
  href: string;
  icon?: React.ReactNode;
}

interface UserMenuProps {
  user: User;
  onLogout: () => void;
  /** 기본 메뉴(내 정보, 멤버 관리) 위에 추가할 링크 */
  items?: UserMenuItem[];
  /** false면 버튼에 아바타만 보여 준다 */
  showName?: boolean;
  align?: "start" | "center" | "end";
}

export function UserMenu({ user, onLogout, items = [], showName = true, align = "end" }: UserMenuProps) {
  const isAdmin = isAdminUser(user);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="계정 메뉴"
          className={cn(
            "group flex items-center gap-2 rounded-full border bg-surface p-1 shadow-soft outline-none transition-all duration-200 hover:-translate-y-px focus-visible:ring-[3px] focus-visible:ring-ring/30",
            showName ? "pr-3" : "pr-1",
          )}
        >
          <UserAvatar user={user} size="md" />
          {showName && <span className="text-[13px] font-medium">{displayName(user)}</span>}
          {showName && <ChevronDown className="size-3.5 text-muted-foreground transition-transform duration-300 group-data-[state=open]:rotate-180" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-64">
        <div className="flex items-center gap-3 p-2.5">
          <UserAvatar user={user} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{displayName(user)}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            <RoleBadges roles={user.roles} className="mt-1.5" />
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={meerkitConfig.routes.me}><UserRound /> 내 정보</Link>
        </DropdownMenuItem>
        {isAdmin && (
          <DropdownMenuItem asChild>
            <Link href={meerkitConfig.routes.adminMembers}><ShieldCheck /> 멤버 관리</Link>
          </DropdownMenuItem>
        )}
        {items.length > 0 && <DropdownMenuSeparator />}
        {items.length > 0 && <DropdownMenuLabel>바로가기</DropdownMenuLabel>}
        {items.map((it) => (
          <DropdownMenuItem key={it.href} asChild>
            <Link href={it.href}>{it.icon} {it.label}</Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={onLogout}>
          <LogOut /> 로그아웃
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
