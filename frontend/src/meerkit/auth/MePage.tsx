"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { ApiKeyInput } from "../ai/ApiKeyInput";
import { meerkitConfig } from "../config";
import { RoleBadges } from "./components/RoleBadges";
import { displayName } from "./components/UserAvatar";
import { RequireAuth } from "./guards/RequireAuth";
import { useAuth } from "./hooks";
import {
  MeAvatarField,
  MeNicknameForm,
  MePasswordForm,
  MeProfileForm,
  MeWithdrawForm,
} from "./MeSections";

export interface MePageTab {
  value: string;
  label: string;
  content: React.ReactNode;
}

export interface MePageProps {
  /** 화면 제목. 기본은 "내 정보" */
  title?: string;
  /** 기본 탭(프로필 수정, 비밀번호 변경, 탈퇴) 앞에 끼울 탭. 서비스 고유 설정을 넣는다 */
  extraTabs?: MePageTab[];
  /** 이미 <main> 안에 그려질 때 true. 바깥 <main>을 <div>로 바꾼다 */
  embedded?: boolean;
  /** AI 서비스용 "API 키" 탭을 보일지. 기본 true. AI를 쓰지 않는 서비스는 false */
  apiKey?: boolean;
}

const date = (iso: string) => iso.slice(0, 10);

function MeContent({
  title = "내 정보",
  extraTabs = [],
  embedded = false,
  apiKey = true,
}: MePageProps) {
  const { user } = useAuth();
  const router = useRouter();
  if (!user) return null;

  const Root = embedded ? "div" : "main";
  return (
    <Root className="mk-rise mx-auto max-w-xl px-4 py-12">
      <div className="mb-6 flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="rounded-full"
          aria-label="뒤로 가기"
          // 이전 화면이 없으면(주소를 직접 열었으면) 처음 화면으로 간다
          onClick={() =>
            window.history.length > 1
              ? router.back()
              : router.push(meerkitConfig.routes.home)
          }
        >
          <ArrowLeft />
        </Button>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      </div>
      <Card className="mb-4">
        <CardContent className="flex flex-col gap-5 sm:flex-row sm:gap-7">
          <MeAvatarField showHint={false} />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="truncate text-xl font-semibold">
              {displayName(user)}
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {user.email}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <RoleBadges roles={user.roles} />
              <span className="text-xs text-muted-foreground">
                가입일 {date(user.created_at)}
              </span>
            </div>
          </div>
        </CardContent>
        <CardContent className="mt-5 border-t pt-5 empty:hidden">
          <MeNicknameForm />
        </CardContent>
      </Card>

      <Tabs defaultValue={extraTabs[0]?.value ?? "profile"}>
        <TabsList>
          {extraTabs.map((x) => (
            <TabsTrigger key={x.value} value={x.value}>
              {x.label}
            </TabsTrigger>
          ))}
          <TabsTrigger value="profile">프로필 수정</TabsTrigger>
          <TabsTrigger value="password">비밀번호 변경</TabsTrigger>
          {apiKey && <TabsTrigger value="apikey">API 키</TabsTrigger>}
          <TabsTrigger value="withdraw">탈퇴</TabsTrigger>
        </TabsList>
        <Card className="mt-3">
          <CardContent>
            {extraTabs.map((x) => (
              <TabsContent key={x.value} value={x.value} className="mk-swap">
                {x.content}
              </TabsContent>
            ))}
            <TabsContent value="profile" className="mk-swap">
              <MeProfileForm />
            </TabsContent>
            <TabsContent value="password" className="mk-swap">
              <MePasswordForm />
            </TabsContent>
            {apiKey && (
              <TabsContent value="apikey" className="mk-swap">
                <ApiKeyInput showModel />
              </TabsContent>
            )}
            <TabsContent value="withdraw" className="mk-swap">
              <MeWithdrawForm />
            </TabsContent>
          </CardContent>
        </Card>
      </Tabs>
    </Root>
  );
}

export function MePage(props: MePageProps) {
  return (
    <RequireAuth>
      <MeContent {...props} />
    </RequireAuth>
  );
}
