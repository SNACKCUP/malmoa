import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

import type { User } from "../../types";

const sizes = {
  sm: "size-7 text-[11px]",
  md: "size-9 text-xs",
  lg: "size-12 text-base",
  xl: "size-20 text-2xl",
} as const;

// 이미지가 없을 때 쓰는 이니셜. 한글은 첫 글자, 영문은 단어 앞글자 최대 2개.
export function initialsOf(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const words = trimmed.split(/\s+/);
  if (/^[A-Za-z]/.test(trimmed) && words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return Array.from(trimmed)[0].toUpperCase();
}

// 닉네임이 있으면 닉네임, 없으면 이름을 보여 준다
export const displayName = (user: Pick<User, "name" | "nickname">) => user.nickname?.trim() || user.name;

interface UserAvatarProps {
  user: Pick<User, "name" | "nickname" | "avatar_url">;
  size?: keyof typeof sizes;
  className?: string;
}

export function UserAvatar({ user, size = "md", className }: UserAvatarProps) {
  return (
    <Avatar className={cn(sizes[size], className)}>
      {user.avatar_url && <AvatarImage src={user.avatar_url} alt={`${displayName(user)} 프로필`} />}
      <AvatarFallback className="text-[inherit]">{initialsOf(displayName(user))}</AvatarFallback>
    </Avatar>
  );
}
