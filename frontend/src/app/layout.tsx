import type { Metadata, Viewport } from "next";

import { MeerkitProvider, meerkitConfig, themeInitScript } from "@/meerkit";

import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const TITLE = "말모아 — 녹음은 글로, 회의는 기록으로.";
const DESCRIPTION = "회의를 녹음하거나 녹음 파일을 올리면 음성을 텍스트로 바꾸고, AI가 논의·결정 사항과 할 일을 회의록으로 정리해 주는 서비스입니다.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s · 말모아" },
  description: DESCRIPTION,
  applicationName: "말모아",
  keywords: ["말모아", "Malmoa", "회의록", "회의 녹음", "음성 텍스트 변환", "받아쓰기", "Whisper", "AI 회의록", "회의 요약"],
  category: "productivity",
  alternates: { canonical: "/" },
  openGraph: { type: "website", locale: "ko_KR", siteName: "말모아", url: "/", title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = { themeColor: "#008080" }; // 말모아 98 바탕화면 청록

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
