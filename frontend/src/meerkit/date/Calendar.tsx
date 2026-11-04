"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { WEEKDAYS, addMonths, monthCells, parseISO, todayISO } from "./utils";

export interface CalendarProps {
  /** 한 날짜를 고르는 달력의 선택값 */
  value?: string;
  /** 범위를 칠할 때의 시작/끝. 끝이 없으면 시작만 표시한다 */
  range?: { start?: string; end?: string };
  /** 이 날짜 이전은 고를 수 없다 */
  min?: string;
  /** 이 날짜 이후는 고를 수 없다 */
  max?: string;
  onSelect: (date: string) => void;
  /** 범위를 고르는 중에 마우스가 올라간 날짜를 알려 준다(미리 칠하기용) */
  onHover?: (date: string | null) => void;
  /** 범위 고르는 중 미리 칠할 끝 날짜 */
  preview?: string;
  /** 처음 보여 줄 달. 기본은 선택값, 없으면 오늘 */
  defaultMonth?: string;
  /** 달력을 여러 달 나란히 보여 준다. 기본 1 */
  months?: 1 | 2;
  /** true면 제목의 연·월을 선택 상자로 바꿔 멀리 있는 연도(예: 생년월일)로 바로 이동할 수 있다 */
  yearMonthSelect?: boolean;
  className?: string;
}

// 선택 상자에 넣을 연도 목록. min/max가 있으면 그 범위, 없으면 현재 연도 기준 앞뒤로 넉넉하게
function yearOptions(current: number, min?: string, max?: string) {
  const thisYear = new Date().getFullYear();
  const from = min ? Number(min.slice(0, 4)) : Math.min(current, thisYear) - 100;
  const to = max ? Number(max.slice(0, 4)) : Math.max(current, thisYear) + 10;
  return Array.from({ length: to - from + 1 }, (_, k) => to - k);
}

// 기본 달력. 날짜 하나 고르기, 범위 칠하기, 고를 수 있는 구간 제한을 모두 이 부품 하나로 한다.
export function Calendar({ value, range, min, max, onSelect, onHover, preview, defaultMonth, months = 1, yearMonthSelect = false, className }: CalendarProps) {
  const seed = parseISO(defaultMonth || value || range?.start || todayISO());
  const [view, setView] = useState({ y: seed.y, m: seed.m });
  const today = todayISO();

  const lo = range?.start && (range.end ?? preview) ? [range.start, range.end ?? preview!].sort() : null;

  return (
    <div className={cn("flex gap-6", className)}>
      {Array.from({ length: months }, (_, i) => {
        const { y, m } = addMonths(view.y, view.m, i);
        return (
          <div key={i} className="w-[17.5rem]">
            <div className="mb-2 flex items-center justify-between">
              {i === 0 ? (
                <button type="button" aria-label="이전 달" className="grid size-8 place-items-center rounded-full hover:bg-muted" onClick={() => setView(addMonths(view.y, view.m, -1))}><ChevronLeft className="size-4" /></button>
              ) : <span className="size-8" />}
              {yearMonthSelect && i === 0 ? (
                <div className="flex items-center gap-1 text-sm font-semibold">
                  <select
                    aria-label="연도"
                    className="rounded-md bg-transparent px-1 py-0.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
                    value={y}
                    onChange={(e) => setView({ y: Number(e.target.value), m })}
                  >
                    {yearOptions(y, min, max).map((year) => <option key={year} value={year}>{year}년</option>)}
                  </select>
                  <select
                    aria-label="월"
                    className="rounded-md bg-transparent px-1 py-0.5 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30"
                    value={m}
                    onChange={(e) => setView({ y, m: Number(e.target.value) })}
                  >
                    {Array.from({ length: 12 }, (_, k) => <option key={k} value={k}>{k + 1}월</option>)}
                  </select>
                </div>
              ) : (
                <p className="text-sm font-semibold" aria-live="polite">{y}년 {m + 1}월</p>
              )}
              {i === months - 1 ? (
                <button type="button" aria-label="다음 달" className="grid size-8 place-items-center rounded-full hover:bg-muted" onClick={() => setView(addMonths(view.y, view.m, 1))}><ChevronRight className="size-4" /></button>
              ) : <span className="size-8" />}
            </div>
            <div className="grid grid-cols-7 text-center text-xs text-muted-foreground">
              {WEEKDAYS.map((w) => <span key={w} className="py-1">{w}</span>)}
            </div>
            <div className="grid grid-cols-7" onMouseLeave={() => onHover?.(null)}>
              {monthCells(y, m).map((date, idx) => {
                if (!date) return <span key={idx} className="h-9" />;
                const disabled = (!!min && date < min) || (!!max && date > max);
                const isEdge = date === value || date === lo?.[0] || date === lo?.[1] || date === range?.start || date === range?.end;
                const inRange = !!lo && date > lo[0] && date < lo[1];
                const isStart = !!lo && date === lo[0] && lo[0] !== lo[1];
                const isEnd = !!lo && date === lo[1] && lo[0] !== lo[1];
                return (
                  <span key={idx} className={cn("relative flex h-9 items-center justify-center", inRange && "bg-primary/15", isStart && "rounded-l-full bg-primary/15", isEnd && "rounded-r-full bg-primary/15")}>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-pressed={isEdge}
                      aria-label={date.replaceAll("-", ".")}
                      onClick={() => onSelect(date)}
                      onMouseEnter={() => onHover?.(date)}
                      className={cn(
                        "size-9 rounded-full text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                        !disabled && !isEdge && "hover:bg-muted",
                        date === today && !isEdge && "font-bold text-primary",
                        isEdge && "bg-primary font-semibold text-primary-foreground",
                        disabled && "cursor-not-allowed text-muted-foreground/40",
                      )}
                    >
                      {Number(date.slice(8))}
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
