import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // 의존 방향 (docs/architecture.md): 킷은 서비스 코드를 import 하지 않고, 서비스 화면은 킷을 공개 API(@/meerkit)로만 쓴다.
  {
    files: ["src/meerkit/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app", "@/app/**"],
              message: "킷(src/meerkit)은 src/app(라우트·서비스 화면)을 import 하지 않습니다.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/app/(service)/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/meerkit/**"],
              message: "서비스 화면은 킷을 @/meerkit(공개 API)으로만 import 합니다. 필요한 것이 없으면 src/meerkit/index.ts에 export를 추가하세요.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
