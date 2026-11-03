import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { toast } from "sonner";

import { authApi } from "../api/auth";
import { usersApi } from "../api/users";
import { meerkitConfig } from "../config";
import type {
  ChangePasswordInput,
  EmailCodeInput,
  ForgotIdInput,
  ForgotPasswordInput,
  LoginInput,
  ResetPasswordInput,
  SignupInput,
  UpdateProfileInput,
  VerifyEmailCodeInput,
  WithdrawInput,
} from "../types";
import { useAuthDialog } from "./dialog-store";
import { useLockoutStore } from "./lockout";
import { meKey } from "./queries";
import { setSessionHint } from "./session-hint";
import { useAuthStore } from "./store";

export function useLogin() {
  const setAccessToken = useAuthStore((s) => s.setAccessToken);
  const closeDialog = useAuthDialog((s) => s.closeDialog);
  const { recordFailure, lockFor, reset } = useLockoutStore.getState();
  return useMutation({
    mutationFn: (input: LoginInput) => authApi.login(input),
    onSuccess: ({ access_token }) => {
      reset();
      setAccessToken(access_token);
      setSessionHint(true);
      closeDialog();
    },
    onError: (error) => {
      if (!isAxiosError(error) || !error.response) return; // 네트워크 오류는 실패로 세지 않는다
      const status = error.response.status;
      if (status === 429 || status === 423) {
        // 서버가 이미 잠갔다면 서버가 알려 준 시간(Retry-After, 초)을 따른다
        const retry = Number(error.response.headers["retry-after"]);
        lockFor(
          Number.isFinite(retry) && retry > 0
            ? retry * 1000
            : meerkitConfig.login.lockMinutes * 60_000,
        );
      } else if (status === 400 || status === 401) {
        recordFailure(); // 아이디·비밀번호가 틀린 경우만 센다
      }
    },
  });
}

// 구글 로그인: 서버가 인증을 시작하므로 브라우저를 서버 주소로 보낸다. 끝나면 /auth/google/callback 으로 돌아온다.
export function useGoogleLogin() {
  return () => {
    window.location.href = authApi.googleLoginUrl();
  };
}

export function useSignup() {
  const login = useLogin();
  return useMutation({
    mutationFn: async (input: SignupInput) => {
      await authApi.signup(input);
      await login.mutateAsync({
        user_id: input.user_id,
        password: input.password,
      });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const setAccessToken = useAuthStore((s) => s.setAccessToken);
  return useMutation({
    mutationFn: authApi.logout,
    onSettled: () => {
      setAccessToken(null);
      setSessionHint(false);
      queryClient.removeQueries({ queryKey: meKey });
    },
  });
}

export function useForgotId() {
  return useMutation({
    mutationFn: (input: ForgotIdInput) => authApi.forgotId(input),
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (input: ForgotPasswordInput) => authApi.forgotPassword(input),
  });
}

// 아이디 중복 확인 (버튼을 누를 때만 부르므로 mutation 으로 둔다)
export function useCheckUserId() {
  return useMutation({
    mutationFn: (userId: string) => authApi.checkUserId(userId),
  });
}

export function useSendEmailCode() {
  return useMutation({
    mutationFn: (input: EmailCodeInput) => authApi.sendEmailCode(input),
  });
}

export function useVerifyEmailCode() {
  return useMutation({
    mutationFn: (input: VerifyEmailCodeInput) => authApi.verifyEmailCode(input),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (input: ResetPasswordInput) => authApi.resetPassword(input),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProfileInput) => usersApi.updateMe(input),
    onSuccess: (user) => {
      queryClient.setQueryData(meKey, user);
      toast.success("내 정보를 저장했습니다.");
    },
  });
}

export function useUpdateNickname() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (nickname: string) => usersApi.updateMe({ nickname }),
    onSuccess: (user) => {
      queryClient.setQueryData(meKey, user);
      toast.success("닉네임을 저장했습니다.");
    },
  });
}

export function useUploadAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => usersApi.uploadAvatar(file),
    onSuccess: (user) => {
      queryClient.setQueryData(meKey, user);
      toast.success("프로필 이미지를 바꿨습니다.");
    },
  });
}

export function useRemoveAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: usersApi.removeAvatar,
    onSuccess: (user) => {
      queryClient.setQueryData(meKey, user);
      toast.success("프로필 이미지를 삭제했습니다.");
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => usersApi.changePassword(input),
    onSuccess: () => toast.success("비밀번호를 변경했습니다."),
  });
}

// 탈퇴하면 서버가 리프레시 쿠키를 지운다. 브라우저 쪽 로그인 상태도 로그아웃처럼 정리한다.
export function useWithdraw() {
  const queryClient = useQueryClient();
  const setAccessToken = useAuthStore((s) => s.setAccessToken);
  return useMutation({
    mutationFn: (input: WithdrawInput) => usersApi.withdraw(input),
    onSuccess: () => {
      setAccessToken(null);
      setSessionHint(false);
      queryClient.removeQueries({ queryKey: meKey });
      toast.success("탈퇴했습니다. 이용해 주셔서 감사합니다.");
    },
  });
}
