"use client";

import { useEffect } from "react";

import { applyTheme, effectiveTheme } from "./theme";

// 운영체제 설정이 바뀔 때 테마를 다시 맞춘다.
export function ThemeSync() {
  useEffect(() => {
    applyTheme(effectiveTheme());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(effectiveTheme());
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return null;
}
