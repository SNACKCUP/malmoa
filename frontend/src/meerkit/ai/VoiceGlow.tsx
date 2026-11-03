"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import { meerkitConfig } from "../config";

interface VoiceGlowProps {
  /** 지금 목소리 크기(0~1). useVoiceRecorder의 levelRef를 그대로 넘긴다 */
  levelRef: React.RefObject<number>;
  /** true면 파동이 올라오고, false가 되면 부드럽게 가라앉는다 */
  active: boolean;
  /** 파동 색(2개 이상). 생략하면 meerkit.config.ts의 ai.voice.colors */
  colors?: string[];
  className?: string;
}

// 목소리 크기에 따라 일렁이는 컬러 파동. 위로 솟았다가 좌우로 쓸린다. 글자를 가리지 않도록 연하게 그린다.
const LAYERS = [
  { k: 2.2, speed: 1.1, phase: 0, alpha: 0.4, scale: 1 },
  { k: 3.1, speed: -1.5, phase: 1.7, alpha: 0.32, scale: 0.8 },
  { k: 1.5, speed: 0.8, phase: 3.1, alpha: 0.28, scale: 0.95 },
  { k: 4.2, speed: -2, phase: 4.6, alpha: 0.22, scale: 0.6 },
];

function reducedMotion() {
  return document.documentElement.dataset.mkMotion === "off" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function VoiceGlow({ levelRef, active, colors = meerkitConfig.ai.voice.colors, className }: VoiceGlowProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ampRef = useRef(0);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = reducedMotion();
    let raf = 0;
    let last = performance.now();

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // 목표 크기로 부드럽게 따라간다 (올라갈 땐 빠르게, 내려갈 땐 천천히)
      const target = active ? (still ? 0.35 : 0.14 + levelRef.current * 0.86) : 0;
      const ease = target > ampRef.current ? 9 : 3.5;
      ampRef.current += (target - ampRef.current) * Math.min(1, ease * dt);
      if (!still) timeRef.current += dt * (0.6 + ampRef.current * 1.6);
      const amp = ampRef.current;
      const t = timeRef.current;

      if (amp > 0.004) {
        const sweep = 0.5 + 0.32 * Math.sin(t * 0.7); // 가장 높게 솟는 곳이 좌우로 오간다
        LAYERS.forEach((layer, li) => {
          const grad = ctx.createLinearGradient(0, 0, w, 0);
          colors.forEach((c, ci) => grad.addColorStop(ci / (colors.length - 1), colors[(ci + li) % colors.length]));
          ctx.globalAlpha = layer.alpha * Math.min(1, amp * 3);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(0, h);
          for (let x = 0; x <= w; x += 4) {
            const u = x / w;
            const bump = Math.exp(-((u - sweep) ** 2) / 0.07) * 0.75 + 0.25;
            const wave = 0.65 + 0.35 * Math.sin(u * layer.k * Math.PI * 2 + t * layer.speed + layer.phase);
            const y = h - h * 0.72 * amp * layer.scale * bump * wave;
            ctx.lineTo(x, y);
          }
          ctx.lineTo(w, h);
          ctx.closePath();
          ctx.fill();
        });
        ctx.globalAlpha = 1;
      }

      // 움직임을 끈 환경에서는 한 번만 그리고, 가라앉은 뒤에는 멈춘다
      if (!still && (active || amp > 0.004)) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active, levelRef, colors]);

  return <canvas ref={canvasRef} aria-hidden className={cn("pointer-events-none block h-24 w-full blur-[6px]", className)} />;
}
