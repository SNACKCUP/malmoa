import type { RoleName } from "./roles";

export interface Role {
  id: number;
  name: RoleName;
}

export interface User {
  id: number;
  user_id: string;
  email: string;
  name: string;
  /** 프로필 이미지 주소. 없으면 이름의 첫 글자로 대신한다. */
  avatar_url?: string | null;
  // 가입·내 정보에서 선택적으로 받는 항목 (meerkit.config.ts의 signup.optionalFields)
  nickname?: string | null;
  phone?: string | null;
  postcode?: string | null;
  address?: string | null;
  address_detail?: string | null;
  birth_date?: string | null;
  gender?: string | null;
  /** 이메일 인증을 마쳤는지 */
  email_verified: boolean;
  /** 가진 역할 목록. 한 사람이 여러 역할을 가질 수 있다 (가입하면 VIEWER) */
  roles: Role[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** 로그인 잠금이 풀리는 시각. 지금보다 뒤면 연속 실패로 잠긴 상태 */
  locked_until?: string | null;
  /** 탈퇴(또는 관리자 삭제) 시각. 값이 있으면 탈퇴한 계정이다 */
  deactivated_at: string | null;
  /** 탈퇴 후 보관 기간이 지나 개인정보를 지운 시각 */
  deleted_at: string | null;
}

export interface LoginInput {
  user_id: string;
  password: string;
}

export interface SignupInput extends LoginInput {
  email: string;
  name: string;
  // meerkit.config.ts의 signup.optionalFields로 켠 항목만 전달된다.
  nickname?: string;
  phone?: string;
  postcode?: string;
  address?: string;
  address_detail?: string;
  birth_date?: string;
  gender?: string;
  /** 동의한 약관의 id 목록. 필수 약관이 모두 포함되어야 가입할 수 있다 */
  agreed_terms?: string[];
  /** 이메일 인증을 마쳤을 때 서버가 준 증표. 인증 기능을 켠 경우에만 전달된다 */
  email_verification_token?: string;
}

export interface EmailCodeInput {
  email: string;
}

export interface VerifyEmailCodeInput {
  email: string;
  code: string;
}

export interface VerifyEmailCodeResponse {
  token: string;
}

export interface ForgotIdInput {
  email: string;
}

export interface ForgotPasswordInput {
  email: string;
}

export interface ResetPasswordInput {
  token: string;
  password: string;
}

export interface WithdrawInput {
  /** 본인 확인용 현재 비밀번호 */
  password: string;
}

export interface ChangePasswordInput {
  current_password: string;
  new_password: string;
}

export interface UpdateProfileInput {
  name: string;
  email: string;
  /** 이메일을 바꿀 때 새 이메일로 인증을 마치고 받은 증표 */
  email_verification_token?: string;
  nickname?: string;
  phone?: string;
  postcode?: string;
  address?: string;
  address_detail?: string;
  birth_date?: string;
  gender?: string;
}

export type MemberStatus = "all" | "active" | "inactive" | "deleted";

/** 관리자 멤버 목록의 검색·필터·페이지 조건 */
export interface MemberQuery {
  q: string;
  roleId: number | null;
  status: MemberStatus;
  page: number;
  size: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export interface TokenResponse {
  access_token: string;
}
