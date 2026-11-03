// 키를 받을 수 있는 AI 공급자. 서비스는 이 중 필요한 것만 골라 키를 받는다(`providers` prop).
export type ProviderId = "openai" | "gemini" | "claude";

export interface ModelOption {
  id: string;
  label: string;
}

export interface ProviderInfo {
  id: ProviderId;
  /** 화면에 보이는 이름 */
  label: string;
  /** 키 입력칸 안내 문구 */
  placeholder: string;
  /** 키 모양 확인용. 진짜 유효한지는 서버가 호출해 보고 알려 준다 */
  pattern: RegExp;
  /** 기본 모델 목록. 서비스는 `models` prop으로 덮어쓸 수 있다 */
  models: ModelOption[];
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  openai: {
    id: "openai",
    label: "GPT (OpenAI)",
    placeholder: "OpenAI API 키 (sk-...)",
    pattern: /^sk-[A-Za-z0-9_-]{16,}$/,
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
      { id: "gpt-4o", label: "GPT-4o" },
    ],
  },
  gemini: {
    id: "gemini",
    label: "Gemini (Google)",
    placeholder: "Gemini API 키 (AIza...)",
    pattern: /^AIza[A-Za-z0-9_-]{20,}$/,
    models: [
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    ],
  },
  claude: {
    id: "claude",
    label: "Claude (Anthropic)",
    placeholder: "Anthropic API 키 (sk-ant-...)",
    pattern: /^sk-ant-[A-Za-z0-9_-]{16,}$/,
    models: [
      { id: "claude-haiku-5-5", label: "Claude Haiku" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet" },
    ],
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export const maskKey = (key: string) => (key.length > 8 ? `${key.slice(0, 3)}…${key.slice(-4)}` : "••••");
