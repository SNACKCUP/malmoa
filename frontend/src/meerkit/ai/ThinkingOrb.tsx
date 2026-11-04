"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

export type OrbState = "working" | "searching" | "solving" | "listening" | "connecting" | "weaving" | "composing" | "breathing" | "shaping";

interface OrbMotion {
  /** 초당 회전 속도(rad) */
  rot: number;
  /** 구가 기울어진 정도(rad) */
  tilt: number;
  /** 숨 쉬듯 커졌다 작아지는 정도와 속도(Hz) */
  breathe: number;
  breatheHz: number;
  /** 위아래로 비틀리는 정도 (나선 모양) */
  twist: number;
  /** 물결이 표면을 타고 오르는 정도 */
  wave: number;
  /** 점이 파르르 떨리는 정도 */
  jitter: number;
  /** 밝은 띠가 위아래로 훑고 지나가는지 */
  scan: boolean;
  /** 타원으로 눌렸다 펴지는 정도 */
  squash: number;
}

export const ORB_STATES: Record<OrbState, { label: string; description: string; motion: OrbMotion }> = {
  working: { label: "작업 중", description: "차분하게 돌며 일하는 기본 상태", motion: { rot: 1.0, tilt: 0.35, breathe: 0.03, breatheHz: 0.5, twist: 0, wave: 0, jitter: 0, scan: false, squash: 0 } },
  searching: { label: "찾는 중", description: "밝은 띠가 위아래로 훑으며 찾습니다", motion: { rot: 0.6, tilt: 0.3, breathe: 0.02, breatheHz: 0.5, twist: 0, wave: 0, jitter: 0, scan: true, squash: 0 } },
  solving: { label: "푸는 중", description: "빠르게 돌며 파르르 떨립니다", motion: { rot: 1.7, tilt: 0.4, breathe: 0.03, breatheHz: 1.2, twist: 0, wave: 0, jitter: 0.045, scan: false, squash: 0 } },
  listening: { label: "듣는 중", description: "천천히 숨 쉬며 귀를 기울입니다", motion: { rot: 0.25, tilt: 0.25, breathe: 0.09, breatheHz: 0.35, twist: 0, wave: 0, jitter: 0, scan: false, squash: 0 } },
  connecting: { label: "연결 중", description: "점들이 나선으로 엮입니다", motion: { rot: 0.8, tilt: 0.35, breathe: 0.02, breatheHz: 0.5, twist: 1.1, wave: 0, jitter: 0, scan: false, squash: 0 } },
  weaving: { label: "엮는 중", description: "반대 방향으로 비틀리며 물결칩니다", motion: { rot: 0.7, tilt: 0.3, breathe: 0.02, breatheHz: 0.5, twist: -1.3, wave: 0.07, jitter: 0, scan: false, squash: 0 } },
  composing: { label: "작성 중", description: "표면에 잔물결이 퍼집니다", motion: { rot: 0.5, tilt: 0.3, breathe: 0.02, breatheHz: 0.5, twist: 0, wave: 0.1, jitter: 0, scan: false, squash: 0 } },
  breathing: { label: "숨 고르는 중", description: "크게 부풀었다 줄어듭니다", motion: { rot: 0.15, tilt: 0.25, breathe: 0.14, breatheHz: 0.25, twist: 0, wave: 0, jitter: 0, scan: false, squash: 0 } },
  shaping: { label: "다듬는 중", description: "둥글었다 납작해지며 모양을 잡습니다", motion: { rot: 0.5, tilt: 0.3, breathe: 0.02, breatheHz: 0.5, twist: 0, wave: 0, jitter: 0, scan: false, squash: 0.2 } },
};

interface ThinkingOrbProps {
  state?: OrbState;
  /** 한 변의 크기(px). 20쯤이면 글줄 안, 64쯤이면 채팅 아바타 크기 */
  size?: number;
  /** 움직이는 속도 배율. 기본 1 */
  speed?: number;
  /** true면 멈춘 모양으로 그린다 */
  paused?: boolean;
  className?: string;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

// 점으로 이루어진 구슬. AI가 일하는 동안 상태별로 다르게 움직인다.
// 점 색은 글자색(currentColor)을 따른다. 움직임 끄기(설정·OS)를 지키며 이때는 멈춘 모양만 그린다.
export function ThinkingOrb({ state = "working", size = 32, speed = 1, paused = false, className }: ThinkingOrbProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const m = ORB_STATES[state].motion;
    const count = Math.round(Math.min(260, Math.max(40, size * 2.4)));
    const dotR = Math.max(0.7, (size / 64) * 1.4);
    const R = size / 2 - dotR * 1.8;
    const cx = size / 2;
    const cy = size / 2;
    ctx.fillStyle = getComputedStyle(canvas).color || "#1b1d29";

    const points = Array.from({ length: count }, (_, i) => {
      const y = count === 1 ? 0 : 1 - (i / (count - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = i * GOLDEN;
      return { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r, seed: i * 12.9898 };
    });

    function draw(t: number) {
      ctx!.clearRect(0, 0, size, size);
      const breathe = 1 + m.breathe * Math.sin(Math.PI * 2 * m.breatheHz * t);
      const sx = 1 + m.squash * Math.sin(t * 1.6);
      const sy = 1 - m.squash * Math.sin(t * 1.6);
      const bandY = Math.sin(t * 1.4) * 0.9;
      for (const p of points) {
        const ang = t * m.rot + m.twist * p.y;
        const x1 = p.x * Math.cos(ang) + p.z * Math.sin(ang);
        const z1 = -p.x * Math.sin(ang) + p.z * Math.cos(ang);
        const y2 = p.y * Math.cos(m.tilt) - z1 * Math.sin(m.tilt);
        const z2 = p.y * Math.sin(m.tilt) + z1 * Math.cos(m.tilt);
        const k = breathe + m.wave * Math.sin(p.y * 7 - t * 3) + m.jitter * Math.sin(p.seed + t * 9);
        const depth = (z2 + 1) / 2; // 0(뒤) ~ 1(앞)
        let alpha = 0.18 + 0.82 * depth;
        let radius = dotR * (0.55 + 0.75 * depth);
        if (m.scan) {
          const band = Math.exp(-((y2 - bandY) ** 2) / 0.05);
          alpha = Math.min(1, alpha + band * 0.8);
          radius *= 1 + band * 0.55;
        }
        ctx!.globalAlpha = alpha;
        ctx!.beginPath();
        ctx!.arc(cx + x1 * R * k * sx, cy + y2 * R * k * sy, radius, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
    }

    const still = paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.mkMotion === "off";
    draw(1.2); // 처음부터 바로 한 장 그려서 빈 칸이 보이지 않게 한다
    if (still) return;

    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      draw(((now - start) / 1000) * speed);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [state, size, speed, paused]);

  return <canvas ref={ref} aria-hidden className={cn("shrink-0", className)} style={{ width: size, height: size }} />;
}
