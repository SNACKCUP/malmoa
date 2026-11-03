import { create } from "zustand";

// 액세스 토큰은 메모리에만 둔다 (persist 금지). 리프레시 토큰은 httpOnly 쿠키.
// sessionStatus: 새로고침 뒤 세션을 복원하는 동안 "로그인 전 화면"이 깜빡이지 않게 하려는 표시.
//   "unknown"  아직 복원 여부를 모른다 (서버 렌더·첫 렌더)
//   "restoring" 리프레시로 세션을 복원하는 중
//   "ready"    복원이 끝났다 (로그인 상태이든 아니든)
export type SessionStatus = "unknown" | "restoring" | "ready";

interface AuthState {
  accessToken: string | null;
  sessionStatus: SessionStatus;
  setAccessToken: (token: string | null) => void;
  setSessionStatus: (status: SessionStatus) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  sessionStatus: "unknown",
  setAccessToken: (accessToken) => set({ accessToken }),
  setSessionStatus: (sessionStatus) => set({ sessionStatus }),
}));
