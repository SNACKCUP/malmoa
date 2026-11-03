import { create } from "zustand";

import { useAuthStore } from "../auth/store";
import { estimateCost, type Usage } from "./pricing";

interface LlmKeyState {
  /** 사용자가 입력한 API 키. 메모리에만 둔다(persist 금지): 새로고침하면 사라진다 */
  apiKey: string;
  /** 이 탭에서 쓴 토큰과 예상 비용 합계 (저장하지 않음) */
  total: { input: number; output: number; cost: number; calls: number };
  setApiKey: (key: string) => void;
  clearApiKey: () => void;
  addUsage: (model: string, usage: Usage) => void;
  resetUsage: () => void;
}

const EMPTY_TOTAL = { input: 0, output: 0, cost: 0, calls: 0 };

export const useLlmKeyStore = create<LlmKeyState>((set) => ({
  apiKey: "",
  total: EMPTY_TOTAL,
  setApiKey: (apiKey) => set({ apiKey }),
  clearApiKey: () => set({ apiKey: "" }),
  addUsage: (model, usage) =>
    set((s) => ({
      total: {
        input: s.total.input + usage.input_tokens,
        output: s.total.output + usage.output_tokens,
        cost: s.total.cost + (estimateCost(model, usage) ?? 0),
        calls: s.total.calls + 1,
      },
    })),
  resetUsage: () => set({ total: EMPTY_TOTAL }),
}));

// 로그아웃(또는 세션 종료)하면 키와 사용량을 함께 지운다
useAuthStore.subscribe((state, prev) => {
  if (prev.accessToken && !state.accessToken) useLlmKeyStore.setState({ apiKey: "", total: EMPTY_TOTAL });
});
