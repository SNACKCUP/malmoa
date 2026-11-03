// 다크 모드. 저장된 선택("light" | "dark")이 없으면 운영체제 설정을 따른다.
export const THEME_KEY = "meerkit-theme";
export type Theme = "light" | "dark";

export function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null; // 저장소를 쓸 수 없는 환경
  }
}

export function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** 지금 화면에 적용할 테마 */
export function effectiveTheme(): Theme {
  return storedTheme() ?? systemTheme();
}

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // 저장소를 쓸 수 없으면 이번 방문에만 적용된다
  }
}

/**
 * 첫 페인트 전에 실행하는 짧은 스크립트(layout의 <head>). 이게 없으면 다크 모드 사용자가
 * 새로고침할 때마다 밝은 화면이 잠깐 보인다. 위 함수들과 같은 규칙을 한 줄로 적었다.
 */
export const themeInitScript = `(function(){try{var s=localStorage.getItem("${THEME_KEY}");var d=(s==="dark"||(s!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches));document.documentElement.setAttribute("data-theme",d?"dark":"light")}catch(e){}})()`;
