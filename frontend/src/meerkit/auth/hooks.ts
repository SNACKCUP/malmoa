import { isAdminUser } from "../roles";
import { useMe } from "./queries";
import { useAuthStore } from "./store";

export function useAuth() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const sessionStatus = useAuthStore((s) => s.sessionStatus);
  const { data: user, isLoading } = useMe();
  // 세션을 복원하는 중이거나 내 정보를 받아 오는 중이면 "로그인 전/후"를 아직 알 수 없다
  const resolving = sessionStatus !== "ready" || (!!accessToken && isLoading);
  return {
    user,
    isAuthenticated: !!accessToken,
    isLoading: resolving,
    isAdmin: isAdminUser(user),
  };
}
