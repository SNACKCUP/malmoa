// 멤버 AI 사용량 컴포넌트가 함께 쓰는 타입과 규칙.
// 현재는 프론트 UI만 구현된 상태이고, 사용량의 기록·집계(서버)는 추후 적용 예정이다.

/** 한 멤버의 현재 주기 사용량 */
export interface AiUsage {
  used: number;
  /** 허용량. null이면 제한 없음 */
  limit: number | null;
  /** 단위 표시. 예: "토큰", "회" */
  unit?: string;
  /** 사용량이 초기화되는 시각(ISO). 있으면 "N일 뒤 초기화"를 보여 준다 */
  resetAt?: string;
}

export type UsagePeriod = "day" | "week" | "month";

export interface UsagePoint {
  /** 가로축 이름. 예: "10/20", "3주차", "10월" */
  label: string;
  value: number;
}

export const PERIODS: { id: UsagePeriod; label: string }[] = [
  { id: "day", label: "일별" },
  { id: "week", label: "주별" },
  { id: "month", label: "월별" },
];

export type UsageLevel = "ok" | "warn" | "danger";

/** 사용 비율(%)에 따른 단계: 70% 미만 여유, 70~90% 주의, 90% 이상 한도 임박 */
export function usageLevel(percent: number): UsageLevel {
  if (percent >= 90) return "danger";
  if (percent >= 70) return "warn";
  return "ok";
}

export const LEVEL_COLOR: Record<UsageLevel, string> = {
  ok: "var(--mk-brand)",
  warn: "var(--mk-tan)",
  danger: "var(--mk-destructive)",
};

export const LEVEL_LABEL: Record<UsageLevel, string> = {
  ok: "여유",
  warn: "주의",
  danger: "한도 임박",
};

export const formatNumber = (n: number) => n.toLocaleString("ko-KR");
