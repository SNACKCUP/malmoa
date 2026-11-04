import userConfig from "../../meerkit.config";

const githubUrl =
  process.env.NEXT_PUBLIC_GITHUB_URL ??
  "https://github.com/SNACKCUP/meerkit";

export const meerkitConfig = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api",
  // 웰컴 페이지 Docs 버튼이 여는 주소. 기본은 Meerkit 공식 설명서. 값이 비어 있어도 기본 주소를 쓴다.
  docsUrl: process.env.NEXT_PUBLIC_DOCS_URL || "https://meerkit.dev/",
  githubUrl,
  // 문서 사이트로만 배포할 때. 홈은 /docs로 이동하고 앱 화면(/me, /admin)은 닫힌다.
  docsOnly: process.env.NEXT_PUBLIC_DOCS_ONLY === "true",
  theme: userConfig.theme ?? "meerkit",
  motion: userConfig.motion ?? true,
  themeToggle: userConfig.themeToggle ?? true,
  signup: {
    passwordConfirm: userConfig.signup?.passwordConfirm ?? false,
    optionalFields: userConfig.signup?.optionalFields ?? [],
    name: {
      min: userConfig.signup?.name?.min ?? 2,
      max: userConfig.signup?.name?.max ?? 10,
    },
    phoneInput: userConfig.signup?.phoneInput ?? "single",
    terms: userConfig.signup?.terms ?? [],
    addressType: userConfig.signup?.addressType ?? "basic",
    addressSearch: userConfig.signup?.addressSearch ?? "popup",
    nickname: {
      generator: userConfig.signup?.nickname?.generator ?? true,
      autoFill: userConfig.signup?.nickname?.autoFill ?? false,
    },
    emailVerification: userConfig.signup?.emailVerification ?? false,
  },
  loading: {
    variant: userConfig.loading?.variant ?? "ring",
  },
  ai: {
    playground: userConfig.ai?.playground ?? true,
    voice: {
      colors:
        userConfig.ai?.voice?.colors && userConfig.ai.voice.colors.length >= 2
          ? userConfig.ai.voice.colors
          : ["#60a5fa", "#a78bfa", "#f472b6", "#2dd4bf"],
    },
  },
  login: {
    maxAttempts: userConfig.login?.maxAttempts ?? 5,
    lockMinutes: userConfig.login?.lockMinutes ?? 5,
    social: { google: userConfig.login?.social?.google ?? false },
  },
  routes: {
    home: "/",
    me: "/me",
    adminMembers: "/admin/members",
    resetPassword: "/reset-password",
    googleCallback: "/auth/google/callback",
    terms: "/terms",
    privacy: "/privacy",
    docs: "/docs",
  },
} as const;
