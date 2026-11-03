"use client";

import { useEffect, useRef, useState } from "react";

interface DelayedLoadingOptions {
  /** 로딩이 이 시간(ms)보다 오래 걸릴 때만 보여 준다. 기본 250 */
  delay?: number;
  /** 한 번 보였다면 최소 이 시간(ms)은 유지한다. 기본 450 */
  minDuration?: number;
}

/**
 * 로딩 표시가 번쩍 나타났다 사라지는 것을 막는다.
 * - 응답이 빨라서 delay 안에 끝나면 로딩 표시를 아예 보여 주지 않는다.
 * - 일단 보여 줬다면 minDuration 동안은 유지해서 깜빡임을 없앤다.
 */
export function useDelayedLoading(loading: boolean, { delay = 250, minDuration = 450 }: DelayedLoadingOptions = {}) {
  const [show, setShow] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (loading && !show) {
      const id = setTimeout(() => {
        shownAt.current = Date.now();
        setShow(true);
      }, delay);
      return () => clearTimeout(id);
    }
    if (!loading && show) {
      const remaining = Math.max(0, minDuration - (Date.now() - shownAt.current));
      const id = setTimeout(() => setShow(false), remaining);
      return () => clearTimeout(id);
    }
  }, [loading, show, delay, minDuration]);

  return show;
}
