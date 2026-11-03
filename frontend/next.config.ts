import type { NextConfig } from "next";

// 개발 중 /api 요청을 FastAPI(8000)로 전달합니다. 배포 환경에서는 API_PROXY_TARGET으로 주소를 바꿉니다.
const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  output: "standalone",
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiTarget}/api/:path*` }];
  },
};

export default nextConfig;
