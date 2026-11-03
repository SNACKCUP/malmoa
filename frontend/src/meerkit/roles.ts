import type { User } from "./types";

// 역할 4종. id는 서버 roles 테이블과 같다 (GET /users/roles). 한 사람이 여러 역할을 가질 수 있다.
export const ROLES = [
  { id: 1, name: "MASTER", description: "시스템 전체 관리자", crud: "CRUD" },
  { id: 2, name: "OWNER", description: "자신이 소유한 데이터 관리", crud: "CRUD" },
  { id: 3, name: "VIEWER", description: "조회 전용 사용자", crud: "R" },
  { id: 4, name: "WRITER", description: "데이터 작성 및 수정 사용자", crud: "CRU" },
] as const;

export type RoleName = (typeof ROLES)[number]["name"];

export const ADMIN_ROLE: RoleName = "MASTER";

export const hasRole = (user: Pick<User, "roles"> | null | undefined, role: RoleName) =>
  !!user?.roles.some((r) => r.name === role);

/** 관리자 화면을 쓸 수 있는지. 화면 표시용이며 실제 권한은 서버가 다시 확인한다 */
export const isAdminUser = (user: Pick<User, "roles"> | null | undefined) => hasRole(user, ADMIN_ROLE);
