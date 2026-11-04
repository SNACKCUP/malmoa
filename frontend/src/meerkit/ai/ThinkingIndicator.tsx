"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { ThinkingOrb, type OrbState } from "./ThinkingOrb";

const sizes = {
  sm: { orb: 20, text: "text-xs", dot: 4 },
  md: { orb: 32, text: "text-sm", dot: 5 },
  lg: { orb: 64, text: "text-base", dot: 7 },
} as const;

const DEFAULT_LABELS = ["생각하는 중", "자료를 찾는 중", "답변을 정리하는 중"];

interface ThinkingIndicatorProps {
  /**
   * "orb": 점으로 이루어진 구슬 + 문구...
   * "dots": 문구 + 물결치는 점 세 개
   * "shimmer": 빛이 지나가는 문구...
   */
  variant?: "orb" | "dots" | "shimmer";
  /** orb 모양일 때 구슬의 상태(움직임). 기본 working */
  orbState?: OrbState;
  /** 문구가 이 목록을 돌아가며 부드럽게 바뀐다. 하나만 주면 고정된다 */
  labels?: string[];
  /** 문구가 바뀌는 간격(ms). 기본 2600 */
  interval?: number;
  size?: keyof typeof sizes;
  className?: string;
}

// AI가 답을 준비하는 동안 보여 주는 "생각 중" 표시. 스크린리더에는 현재 문구를 읽어 준다.
export function ThinkingIndicator({ variant = "orb", orbState = "working", labels = DEFAULT_LABELS, interval = 2600, size = "md", className }: ThinkingIndicatorProps) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (labels.length < 2) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % labels.length), interval);
    return () => clearInterval(id);
  }, [labels.length, interval]);

  const label = labels[index % labels.length] ?? "";
  const s = sizes[size];

  return (
    <span role="status" aria-live="polite" className={cn("inline-flex items-center gap-2.5 text-foreground", className)}>
      {variant === "orb" && <ThinkingOrb state={orbState} size={s.orb} />}
      {/* 바깥은 등장(위로 떠오름), 안쪽은 반짝임. 한 요소에 두 애니메이션을 같이 걸면 하나가 덮어쓰여서 나눠 두었다 */}
      <span key={label} className={cn("mk-swap font-medium", s.text)}>
        <span className={variant === "shimmer" ? "mk-shimmer-text" : "text-muted-foreground"}>
          {label}
          {variant !== "dots" && "..."}
        </span>
      </span>
      {variant === "dots" && (
        <span className="inline-flex items-end gap-1 text-muted-foreground" aria-hidden style={{ height: s.dot * 2 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="mk-dot" style={{ width: s.dot, height: s.dot, animationDelay: `${i * 0.16}s` }} />
          ))}
        </span>
      )}
    </span>
  );
}
