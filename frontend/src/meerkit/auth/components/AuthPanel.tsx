"use client";

import { useEffect } from "react";

import { errorMessage } from "../../api/error";
import { meerkitConfig } from "../../config";
import { useLoginLockout } from "../lockout";
import { useCheckUserId, useGoogleLogin, useLogin, useSendEmailCode, useSignup, useVerifyEmailCode } from "../mutations";
import { LoginForm } from "./LoginForm";
import { SignupForm } from "./SignupForm";

interface AuthPanelProps {
  mode: "login" | "signup";
  /** 로그인(가입 뒤 자동 로그인 포함)에 성공하면 호출한다. 보통 다른 화면으로 보낸다 */
  onSuccess?: () => void;
  /** 비밀번호 찾기 링크를 보여 줄 때 누르면 호출한다 */
  onForgotPassword?: () => void;
  /** 아이디 찾기 링크를 보여 줄 때 누르면 호출한다 */
  onFindId?: () => void;
  /** 가입 모드에서 이메일을 고정하고 인증번호 대신 이 증표로 가입한다 (예: 서비스의 초대 링크). SignupForm의 presetEmail 참고 */
  presetEmail?: { email: string; token: string };
}

/** 로그인·가입 폼을 모달 없이 페이지에 바로 놓는 부품. 로직은 AuthDialog와 같고, 폼 모양은 LoginForm·SignupForm이 정한다 */
export function AuthPanel({ mode, onSuccess, onForgotPassword, onFindId, presetEmail }: AuthPanelProps) {
  const login = useLogin();
  const googleLogin = useGoogleLogin();
  const signup = useSignup();
  const lock = useLoginLockout();
  const sendCode = useSendEmailCode();
  const checkId = useCheckUserId();
  const verifyCode = useVerifyEmailCode();

  const done = login.isSuccess || signup.isSuccess;
  useEffect(() => {
    if (done) onSuccess?.();
    // onSuccess가 바뀌어도 한 번만 부른다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  if (mode === "login") {
    return (
      <LoginForm
        onSubmit={login.mutate}
        pending={login.isPending}
        error={errorMessage(login.error)}
        lockedUntil={lock.lockedUntil}
        attemptsLeft={lock.attemptsLeft}
        onForgotPassword={onForgotPassword}
        onFindId={onFindId}
        onGoogle={meerkitConfig.login.social.google ? googleLogin : undefined}
      />
    );
  }
  return (
    <SignupForm
      onSubmit={signup.mutate}
      onGoogle={meerkitConfig.login.social.google ? googleLogin : undefined}
      pending={signup.isPending}
      error={errorMessage(signup.error)}
      passwordConfirm={meerkitConfig.signup.passwordConfirm}
      optionalFields={[...meerkitConfig.signup.optionalFields]}
      terms={[...meerkitConfig.signup.terms]}
      addressType={meerkitConfig.signup.addressType}
      nickname={meerkitConfig.signup.nickname}
              nameRange={meerkitConfig.signup.name}
              phoneInput={meerkitConfig.signup.phoneInput}
      addressSearch={meerkitConfig.signup.addressSearch}
      checkUserId={(id) => checkId.mutateAsync(id)}
      presetEmail={presetEmail}
      emailVerification={
        meerkitConfig.signup.emailVerification
          ? {
              sendCode: (email) => sendCode.mutateAsync({ email }),
              verifyCode: async (email, code) => (await verifyCode.mutateAsync({ email, code })).token,
            }
          : undefined
      }
    />
  );
}
