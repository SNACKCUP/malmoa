import type { MemberQuery, MemberStatus, Page, User } from "../types";

export const defaultMemberQuery: MemberQuery = { q: "", roleId: null, status: "all", page: 1, size: 10 };

export const STATUS_OPTIONS: { value: MemberStatus; label: string }[] = [
  { value: "all", label: "전체 상태" },
  { value: "active", label: "활성" },
  { value: "inactive", label: "비활성" },
  { value: "deleted", label: "삭제됨" },
];

export const SIZE_OPTIONS = [10, 20, 50] as const;

// 서버와 같은 기준: 탈퇴 시각(deactivated_at)이 있으면 삭제됨
export const statusOf = (u: User): Exclude<MemberStatus, "all"> => (u.deactivated_at ? "deleted" : u.is_active ? "active" : "inactive");

/**
 * 서버가 하는 일을 브라우저에서 흉내 낸다. 문서 미리보기, 테스트, 서버 없이 화면을 볼 때 쓴다.
 * 실제 서비스에서는 서버가 같은 조건으로 걸러서 돌려준다.
 */
export function filterMembers(all: User[], query: MemberQuery): Page<User> {
  const q = query.q.trim().toLowerCase();
  const matched = all.filter((u) => {
    if (q && ![u.user_id, u.name, u.email].some((v) => v.toLowerCase().includes(q))) return false;
    if (query.roleId !== null && !u.roles.some((r) => r.id === query.roleId)) return false;
    if (query.status !== "all" && statusOf(u) !== query.status) return false;
    return true;
  });
  const start = (query.page - 1) * query.size;
  return { items: matched.slice(start, start + query.size), total: matched.length, page: query.page, size: query.size };
}
