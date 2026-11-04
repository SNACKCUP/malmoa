"use client";

import { errorMessage } from "../api/error";
import { meerkitConfig } from "../config";
import { ChangePasswordForm } from "./components/ChangePasswordForm";
import { NicknameForm } from "./components/NicknameForm";
import { ProfileForm } from "./components/ProfileForm";
import { ProfileImageField } from "./components/ProfileImageField";
import { WithdrawForm } from "./components/WithdrawForm";
import { useAuth } from "./hooks";
import { useChangePassword, useRemoveAvatar, useSendEmailCode, useUpdateNickname, useUpdateProfile, useUploadAvatar, useVerifyEmailCode, useWithdraw } from "./mutations";

// 내 정보 화면의 부분들. 서버 호출(mutation)까지 묶어 두어서, 서비스가 화면 배치를 직접 짜더라도
// 킷의 훅 내부 파일을 import 하지 않고 이 부품만 가져다 놓으면 된다. 로그인한 사용자에게만 그린다(RequireAuth 안에서 쓴다).

// 부품이 보여 줄 수 있게 서버 오류를 문구가 담긴 Error로 바꿔 다시 던진다
const rethrow = (e: unknown): never => {
  throw new Error(errorMessage(e) ?? "이미지를 처리하지 못했습니다.");
};

/** 프로필 이미지 올리기·지우기 */
export function MeAvatarField({ showHint = true }: { showHint?: boolean } = {}) {
  const { user } = useAuth();
  const upload = useUploadAvatar();
  const removeAvatar = useRemoveAvatar();
  if (!user) return null;
  return <ProfileImageField user={user} onUpload={(file) => upload.mutateAsync(file).catch(rethrow)} onRemove={() => removeAvatar.mutateAsync().catch(rethrow)} showHint={showHint} />;
}

/** 닉네임 바꾸기. 설정에서 닉네임을 쓰지 않으면 아무것도 그리지 않는다 */
export function MeNicknameForm() {
  const { user } = useAuth();
  const nick = useUpdateNickname();
  if (!user || !meerkitConfig.signup.optionalFields.includes("nickname")) return null;
  return (
    <NicknameForm
      key={user.nickname ?? ""}
      user={user}
      onSubmit={(nickname) => nick.mutateAsync(nickname)}
      pending={nick.isPending}
      error={errorMessage(nick.error)}
      generator={meerkitConfig.signup.nickname.generator}
    />
  );
}

/** 이름·연락처·주소 같은 프로필 수정 */
export function MeProfileForm() {
  const { user } = useAuth();
  const update = useUpdateProfile();
  const sendCode = useSendEmailCode();
  const verifyCode = useVerifyEmailCode();
  if (!user) return null;
  return (
    <ProfileForm
      key={user.updated_at}
      user={user}
      onSubmit={update.mutate}
      pending={update.isPending}
      error={errorMessage(update.error)}
      optionalFields={meerkitConfig.signup.optionalFields.filter((f) => f !== "nickname")}
      addressType={meerkitConfig.signup.addressType}
      nameRange={meerkitConfig.signup.name}
      phoneInput={meerkitConfig.signup.phoneInput}
      addressSearch={meerkitConfig.signup.addressSearch}
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

/** 비밀번호 변경 */
export function MePasswordForm() {
  const change = useChangePassword();
  return <ChangePasswordForm onSubmit={change.mutate} pending={change.isPending} error={errorMessage(change.error)} />;
}

/** 회원 탈퇴 */
export function MeWithdrawForm() {
  const withdraw = useWithdraw();
  return <WithdrawForm onSubmit={withdraw.mutate} pending={withdraw.isPending} error={errorMessage(withdraw.error)} />;
}
