"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { errorMessage } from "../../api/error";
import { meerkitConfig } from "../../config";
import { useAuthDialog } from "../dialog-store";
import { useLoginLockout } from "../lockout";
import { useCheckUserId, useForgotId, useForgotPassword, useGoogleLogin, useLogin, useSendEmailCode, useSignup, useVerifyEmailCode } from "../mutations";
import { ForgotIdForm } from "./ForgotIdForm";
import { ForgotPasswordForm } from "./ForgotPasswordForm";
import { LoginForm } from "./LoginForm";
import { SignupForm } from "./SignupForm";

const copy = {
  login: { title: "로그인", desc: "아이디와 비밀번호를 입력하세요." },
  signup: { title: "회원가입", desc: "정보를 입력해 계정을 만드세요." },
  forgot: { title: "비밀번호 찾기", desc: "가입한 이메일로 재설정 링크를 보내 드립니다." },
  findId: { title: "아이디 찾기", desc: "가입한 이메일로 아이디를 알려 드립니다." },
} as const;

export function AuthDialog() {
  const { open, mode, closeDialog, setMode } = useAuthDialog();
  const login = useLogin();
  const googleLogin = useGoogleLogin();
  const signup = useSignup();
  const forgot = useForgotPassword();
  const forgotId = useForgotId();
  const lock = useLoginLockout();
  const sendCode = useSendEmailCode();
  const checkId = useCheckUserId();
  const verifyCode = useVerifyEmailCode();

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy[mode].title}</DialogTitle>
          <DialogDescription>{copy[mode].desc}</DialogDescription>
        </DialogHeader>

        {/* 모드가 바뀌면 폼이 부드럽게 교체된다 */}
        <div key={mode} className="mk-swap">
          {mode === "login" && (
            <LoginForm
              onSubmit={login.mutate}
              pending={login.isPending}
              error={errorMessage(login.error)}
              lockedUntil={lock.lockedUntil}
              attemptsLeft={lock.attemptsLeft}
              onForgotPassword={() => setMode("forgot")}
              onFindId={() => setMode("findId")}
              onGoogle={meerkitConfig.login.social.google ? googleLogin : undefined}
            />
          )}
          {mode === "signup" && (
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
      emailVerification={
                meerkitConfig.signup.emailVerification
                  ? {
                      sendCode: (email) => sendCode.mutateAsync({ email }),
                      verifyCode: async (email, code) => (await verifyCode.mutateAsync({ email, code })).token,
                    }
                  : undefined
              }
            />
          )}
          {mode === "forgot" && (
            <ForgotPasswordForm
              onSubmit={forgot.mutate}
              pending={forgot.isPending}
              error={errorMessage(forgot.error)}
              sent={forgot.isSuccess}
              onBack={() => {
                forgot.reset();
                setMode("login");
              }}
            />
          )}
          {mode === "findId" && (
            <ForgotIdForm
              onSubmit={forgotId.mutate}
              pending={forgotId.isPending}
              error={errorMessage(forgotId.error)}
              sent={forgotId.isSuccess}
              onBack={() => {
                forgotId.reset();
                setMode("login");
              }}
            />
          )}
        </div>

        {(mode === "login" || mode === "signup") && (
          <Button variant="link" className="justify-self-center" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
            {mode === "login" ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}
          </Button>
        )}
        {((mode === "forgot" && !forgot.isSuccess) || (mode === "findId" && !forgotId.isSuccess)) && (
          <Button variant="link" className="justify-self-center" onClick={() => setMode("login")}>로그인으로 돌아가기</Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
