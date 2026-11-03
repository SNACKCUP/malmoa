"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { errorMessage } from "../api/error";
import { meerkitConfig } from "../config";
import { ChangePasswordForm } from "./components/ChangePasswordForm";
import { NicknameForm } from "./components/NicknameForm";
import { ProfileForm } from "./components/ProfileForm";
import { ProfileImageField } from "./components/ProfileImageField";
import { RoleBadges } from "./components/RoleBadges";
import { displayName } from "./components/UserAvatar";
import { WithdrawForm } from "./components/WithdrawForm";
import { RequireAuth } from "./guards/RequireAuth";
import { useAuth } from "./hooks";
import { useChangePassword, useRemoveAvatar, useSendEmailCode, useUpdateNickname, useUpdateProfile, useUploadAvatar, useVerifyEmailCode, useWithdraw } from "./mutations";

const date = (iso: string) => iso.slice(0, 10);

// 부품이 보여 줄 수 있게 서버 오류를 문구가 담긴 Error로 바꿔 다시 던진다
const rethrow = (e: unknown): never => {
  throw new Error(errorMessage(e) ?? "이미지를 처리하지 못했습니다.");
};

function MeContent() {
  const { user } = useAuth();
  const update = useUpdateProfile();
  const change = useChangePassword();
  const nick = useUpdateNickname();
  const withdraw = useWithdraw();
  const sendCode = useSendEmailCode();
  const verifyCode = useVerifyEmailCode();
  const upload = useUploadAvatar();
  const removeAvatar = useRemoveAvatar();
  const router = useRouter();
  if (!user) return null;
  const nicknameOn = meerkitConfig.signup.optionalFields.includes("nickname");

  return (
    <main className="mk-rise mx-auto max-w-xl px-4 py-12">
      <div className="mb-6 flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="rounded-full"
          aria-label="뒤로 가기"
          // 이전 화면이 없으면(주소를 직접 열었으면) 처음 화면으로 간다
          onClick={() => (window.history.length > 1 ? router.back() : router.push(meerkitConfig.routes.home))}
        >
          <ArrowLeft />
        </Button>
        <h1 className="text-3xl font-semibold tracking-tight">내 정보</h1>
      </div>
      <Card className="mb-4">
        <CardContent className="grid gap-5">
          <ProfileImageField user={user} onUpload={(file) => upload.mutateAsync(file).catch(rethrow)} onRemove={() => removeAvatar.mutateAsync().catch(rethrow)} />
          <div className="min-w-0">
            <p className="truncate text-xl font-semibold">{displayName(user)}</p>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
            <div className="mt-2 flex items-center gap-2">
              <RoleBadges roles={user.roles} />
              <span className="text-xs text-muted-foreground">가입일 {date(user.created_at)}</span>
            </div>
          </div>
        </CardContent>
        {nicknameOn && (
          <CardContent className="mt-5 border-t pt-5">
            <NicknameForm
              key={user.nickname ?? ""}
              user={user}
              onSubmit={(nickname) => nick.mutateAsync(nickname)}
              pending={nick.isPending}
              error={errorMessage(nick.error)}
              generator={meerkitConfig.signup.nickname.generator}
            />
          </CardContent>
        )}
      </Card>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">프로필 수정</TabsTrigger>
          <TabsTrigger value="password">비밀번호 변경</TabsTrigger>
          <TabsTrigger value="withdraw">탈퇴</TabsTrigger>
        </TabsList>
        <Card className="mt-3">
          <CardContent>
            <TabsContent value="profile" className="mk-swap">
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
            </TabsContent>
            <TabsContent value="password" className="mk-swap">
              <ChangePasswordForm onSubmit={change.mutate} pending={change.isPending} error={errorMessage(change.error)} />
            </TabsContent>
            <TabsContent value="withdraw" className="mk-swap">
              <WithdrawForm onSubmit={withdraw.mutate} pending={withdraw.isPending} error={errorMessage(withdraw.error)} />
            </TabsContent>
          </CardContent>
        </Card>
      </Tabs>
    </main>
  );
}

export function MePage() {
  return (
    <RequireAuth>
      <MeContent />
    </RequireAuth>
  );
}
