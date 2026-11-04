// 모델별 예상 요금 (USD, 토큰 100만 개당). 화면에 "예상"으로만 보여 주는 참고용 값이고, 공급자 요금은 바뀔 수 있다.
// 모델을 늘리면 여기에도 한 줄 추가한다.
export const PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
};

export const MODELS = [
  { id: "gpt-4o-mini", label: "GPT-4o mini", description: "빠르고 저렴해요" },
  { id: "gpt-4o", label: "GPT-4o", description: "더 정확해요" },
] as const;

export type ModelId = (typeof MODELS)[number]["id"];

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

/** 예상 비용(USD). 단가를 모르는 모델이면 null */
export function estimateCost(model: string, usage: Pick<Usage, "input_tokens" | "output_tokens">): number | null {
  const price = PRICE_PER_MILLION[model];
  if (!price) return null;
  return (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1_000_000;
}

export function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  return usd < 0.0001 ? "< $0.0001" : `$${usd.toFixed(4)}`;
}
