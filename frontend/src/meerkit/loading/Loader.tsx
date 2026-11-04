import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

import { meerkitConfig } from "../config";
import type { LoaderVariant } from "../define-config";

export type { LoaderVariant };

export const LOADER_VARIANTS: { id: LoaderVariant; label: string; hint: string }[] = [
  { id: "ring", label: "링", hint: "가장 기본적인 회전 링. 어디에나 무난합니다" },
  { id: "dash", label: "대시", hint: "선이 늘었다 줄며 도는 원형. 부드럽고 가볍습니다" },
  { id: "dots", label: "점", hint: "점 세 개가 차례로 튑니다. 버튼·문장 옆에" },
  { id: "bars", label: "막대", hint: "이퀄라이저처럼 오르내립니다. 오디오·데이터 느낌" },
  { id: "pulse", label: "파동", hint: "가운데서 물결이 퍼집니다. 연결·대기 상태에" },
  { id: "spokes", label: "스포크", hint: "열두 개의 선이 차례로 사라지며 돕니다. 익숙하고 또렷합니다" },
  { id: "grid", label: "격자", hint: "아홉 칸이 차례로 밝아집니다. 대시보드·표에" },
  { id: "progress", label: "진행 막대", hint: "가로 막대가 흐릅니다. 페이지 위쪽·카드 안에" },
  { id: "morph", label: "변형", hint: "네모가 돌며 동그라미로 바뀝니다. 개성 있는 화면에" },
];

export const LOADER_SIZES = { sm: 16, md: 24, lg: 40, xl: 56 } as const;
export type LoaderSize = keyof typeof LOADER_SIZES;

interface LoaderProps {
  /** 모양. 기본은 meerkit.config.ts의 loading.variant */
  variant?: LoaderVariant;
  size?: LoaderSize;
  /** 있으면 스크린리더가 이 문구를 읽는다 (화면에는 보이지 않는다). 글자가 따로 있으면 생략한다 */
  label?: string;
  className?: string;
}

const cells = (n: number) => Array.from({ length: n }, (_, i) => i);

// 로딩 표시 9종. 색은 글자색(text-*)을 따르고 크기는 size로 정한다.
// 순수 CSS 애니메이션이라 가볍고, 움직임 끄기(설정·OS)를 지키면 멈춘 모양으로 보인다.
export function Loader({ variant = meerkitConfig.loading.variant, size = "md", label, className }: LoaderProps) {
  const style = { "--ld": `${LOADER_SIZES[size]}px` } as CSSProperties;
  const delay = (i: number, step: number) => ({ animationDelay: `${i * step}s` });

  return (
    <span
      role={label ? "status" : undefined}
      aria-hidden={label ? undefined : true}
      className={cn("mk-ld", `mk-ld-${variant}`, className)}
      style={style}
    >
      {label && <span className="sr-only">{label}</span>}
      {variant === "ring" && <i />}
      {variant === "dash" && (
        <svg viewBox="0 0 50 50" fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round">
          <circle cx={25} cy={25} r={20} />
        </svg>
      )}
      {variant === "dots" && cells(3).map((i) => <i key={i} style={delay(i, 0.16)} />)}
      {variant === "bars" && cells(5).map((i) => <i key={i} style={delay(i, 0.12)} />)}
      {variant === "pulse" && (
        <>
          <i />
          <i style={delay(1, 0.8)} />
          <b />
        </>
      )}
      {variant === "spokes" &&
        cells(12).map((i) => <i key={i} style={{ transform: `rotate(${i * 30}deg)`, animationDelay: `${(i - 12) / 12}s` }} />)}
      {variant === "grid" && cells(9).map((i) => <i key={i} style={{ animationDelay: `${((i % 3) + Math.floor(i / 3)) * 0.14 - 1.4}s` }} />)}
      {variant === "progress" && <i />}
      {variant === "morph" && <i />}
    </span>
  );
}
