import type { Metadata, Viewport } from "next";

import { MeerkitProvider, meerkitConfig, themeInitScript } from "@/meerkit";

import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const TITLE = "Meerkit — 인증과 유저 관리를 갖춘 AI 서비스 스타터킷";
const DESCRIPTION = "회원가입, 로그인, 권한, 관리자 화면과 이를 받쳐 주는 백엔드를 명령어 한 줄로 시작하는 스타터킷입니다. Next.js와 FastAPI로 만들었고, 설명서가 함께 있습니다.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s | Meerkit" },
  description: DESCRIPTION,
  applicationName: "Meerkit",
  keywords: ["Meerkit", "미어킷", "스타터킷", "회원가입", "로그인", "인증", "유저 관리", "권한 관리", "Next.js", "FastAPI", "AI 서비스", "create-meerkit"],
  category: "technology",
  alternates: { canonical: "/" },
  openGraph: { type: "website", locale: "ko_KR", siteName: "Meerkit", url: "/", title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = { themeColor: "#F7F3E8" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" suppressHydrationWarning data-mk-theme={meerkitConfig.theme} data-mk-motion={meerkitConfig.motion ? "on" : "off"}>
      <head>
        {/* 첫 화면이 그려지기 전에 저장된 테마를 적용해서 새로고침 때 깜빡이지 않게 한다 */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>
        <MeerkitProvider>{children}</MeerkitProvider>
      </body>
    </html>
  );
}
