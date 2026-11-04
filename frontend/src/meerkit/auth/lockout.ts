"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { meerkitConfig } from "../config";

// 로그인 연속 실패 횟수와 잠금 해제 시각.
// sessionStorage에 저장해서 새로고침해도 유지된다 (탭을 닫으면 사라진다).
// 주의: 브라우저 쪽 잠금은 사용자 안내용이다. 실제 차단은 서버가 해야 한다.
interface LockoutState {
  attempts: number;
  lockedUntil: number | null;
  /** 실패를 한 번 기록한다. 한도에 닿으면 잠근다. */
  recordFailure: () => void;
  /** 서버가 알려 준 시간(밀리초)만큼 잠근다 */
  lockFor: (ms: number) => void;
  reset: () => void;
}

const { maxAttempts, lockMinutes } = meerkitConfig.login;

export const useLockoutStore = create<LockoutState>()(
  persist(
    (set, get) => ({
      attempts: 0,
      lockedUntil: null,
      recordFailure: () => {
        if (maxAttempts <= 0) return;
        const attempts = get().attempts + 1;
        if (attempts >= maxAttempts) set({ attempts, lockedUntil: Date.now() + lockMinutes * 60_000 });
        else set({ attempts });
      },
      lockFor: (ms) => set({ lockedUntil: Date.now() + ms }),
      reset: () => set({ attempts: 0, lockedUntil: null }),
    }),
    {
      name: "meerkit-login-lockout",
      storage: createJSONStorage(() => sessionStorage),
      // 서버 렌더링과 어긋나지 않도록 MeerkitProvider가 마운트된 뒤에 복원한다
      skipHydration: true,
    },
  ),
);

/** 남은 잠금 시간(밀리초). 잠겨 있지 않으면 0 */
export function useRemainingLock(lockedUntil: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!lockedUntil) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [lockedUntil]);
  return lockedUntil ? Math.max(0, lockedUntil - now) : 0;
}

/** mm:ss 형식 */
export function formatRemaining(ms: number) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 로그인 폼이 쓰는 잠금 상태. 잠금 시간이 지나면 자동으로 풀린다. */
export function useLoginLockout() {
  const attempts = useLockoutStore((s) => s.attempts);
  const lockedUntil = useLockoutStore((s) => s.lockedUntil);
  const reset = useLockoutStore((s) => s.reset);

  useEffect(() => {
    if (!lockedUntil) return;
    const wait = lockedUntil - Date.now();
    if (wait <= 0) return reset();
    const id = setTimeout(reset, wait);
    return () => clearTimeout(id);
  }, [lockedUntil, reset]);

  // 만료 여부는 useRemainingLock이 시계를 보고 판단한다 (렌더 중에는 시간을 읽지 않는다)
  return {
    enabled: maxAttempts > 0,
    lockedUntil,
    attemptsLeft: maxAttempts > 0 ? Math.max(0, maxAttempts - attempts) : null,
    maxAttempts,
  };
}
