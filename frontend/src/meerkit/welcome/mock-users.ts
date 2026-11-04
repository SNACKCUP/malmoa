import { ROLES, type RoleName } from "../roles";
import type { User } from "../types";

// 웰컴 페이지 미리보기 카드용 목 데이터
export const roleOf = (id: number) => {
  const r = ROLES.find((x) => x.id === id) ?? ROLES[2];
  return { id: r.id, name: r.name };
};

/** 역할 이름 목록 → 서버 응답과 같은 roles 배열 (ROLES 순서) */
export const rolesOf = (names: readonly RoleName[]) =>
  ROLES.filter((r) => names.includes(r.name)).map((r) => ({ id: r.id, name: r.name }));

const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T09:00:00Z`;

// docs 미리보기에서만 쓰는 목 데이터. 백엔드 없이도 화면이 열린다.
export const mockUsers: User[] = [
  { id: 1, user_id: "master01", email: "master@example.com", name: "김관리", email_verified: true, roles: [roleOf(1)], is_active: true, created_at: at(1), updated_at: at(1), deactivated_at: null, deleted_at: null },
  { id: 2, user_id: "writer01", email: "writer@example.com", name: "이작성", email_verified: true, roles: [roleOf(3), roleOf(4)], is_active: true, created_at: at(5), updated_at: at(5), deactivated_at: null, deleted_at: null },
  { id: 3, user_id: "viewer01", email: "viewer@example.com", name: "박조회", email_verified: false, roles: [roleOf(3)], is_active: false, created_at: at(12), updated_at: at(12), deactivated_at: null, deleted_at: null },
];
