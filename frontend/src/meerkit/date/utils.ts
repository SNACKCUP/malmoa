// 날짜는 "YYYY-MM-DD" 글자로 주고받는다. 시간대에 따라 하루가 밀리지 않도록 Date는 화면을 그릴 때만 쓴다.
export const pad = (n: number) => String(n).padStart(2, "0");
export const toISO = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
export const parseISO = (v: string): { y: number; m: number; d: number } => {
  const [y, m, d] = v.split("-").map(Number);
  if (!y || !m || !d) return parseISO(todayISO()); // 비었거나 잘못된 값은 오늘로 본다
  return { y, m: m - 1, d };
};
export const todayISO = () => {
  const t = new Date();
  return toISO(t.getFullYear(), t.getMonth(), t.getDate());
};
export const formatDate = (v: string) => (v ? v.replaceAll("-", ".") : "");
export const addMonths = (y: number, m: number, diff: number) => {
  const d = new Date(y, m + diff, 1);
  return { y: d.getFullYear(), m: d.getMonth() };
};
export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 그 달을 일요일부터 시작하는 주 단위 칸으로 만든다. 비는 칸은 null */
export function monthCells(y: number, m: number): (string | null)[] {
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const cells: (string | null)[] = Array(first).fill(null);
  for (let d = 1; d <= days; d++) cells.push(toISO(y, m, d));
  while (cells.length % 7) cells.push(null);
  return cells;
}
