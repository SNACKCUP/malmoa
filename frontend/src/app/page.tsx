import { redirect } from "next/navigation";

import { WelcomePage, meerkitConfig } from "@/meerkit";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// 검색 결과에 서비스 정보를 알려 주는 구조화 데이터
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareSourceCode",
  name: "Meerkit",
  url: SITE_URL,
  inLanguage: "ko",
  description: "인증과 유저 관리를 갖춘 AI 서비스 스타터킷",
  programmingLanguage: ["TypeScript", "Python"],
  codeRepository: meerkitConfig.githubUrl,
  image: `${SITE_URL}/meerkit-logo.png`,
};

export default function HomePage() {
  if (meerkitConfig.docsOnly) redirect(meerkitConfig.routes.docs);
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c"),
        }}
      />
      {/* <WelcomePage /> */}
    </>
  );
}
