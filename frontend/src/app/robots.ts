import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// 로그인이 필요한 화면과 서버 주소는 검색에 나오지 않게 한다
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/me", "/admin", "/reset-password", "/auth/", "/api/"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
