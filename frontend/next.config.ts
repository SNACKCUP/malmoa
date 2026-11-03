import type { NextConfig } from "next";

// 개발 중 /api 요청을 FastAPI(8000)로 전달합니다. 배포 환경에서는 API_PROXY_TARGET으로 주소를 바꿉니다.
const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  output: "standalone",
  experimental: {
    // 말모아 화면은 브라우저 저장소·마이크를 쓰는 SPA라(use(browser())) 서버 미리 렌더로 즉시 보여 줄 수 없다.
    // 그래서 모든 페이지를 암묵적으로 검사하지 않고, instant 를 명시한 구간만 검사한다 (legacy 말모아와 같은 설정)
    instantInsights: {
      validationLevel: "manual-warning",
    },
    // /api 프록시는 요청 본문을 메모리에 담는데 기본 한도가 10MB 라 녹음 업로드가 잘린다 (말모아 MAX_UPLOAD_MB=500 + 여유).
    // 큰 파일을 서버 메모리에 담는 방식이라 배포 때는 버킷 직접 업로드로 바꾼다 (docs/2026-11-03-통합계획.md 단계 5)
    proxyClientMaxBodySize: "520mb",
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiTarget}/api/:path*` }];
  },
};

export default nextConfig;
