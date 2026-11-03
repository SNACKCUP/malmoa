"use client";

import { CalendarDays } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { Calendar } from "./Calendar";
import { formatDate } from "./utils";

const triggerCls = "flex h-10 w-full items-center justify-between gap-2 rounded-xl border bg-surface px-3 text-left text-sm outline-none transition-shadow focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive";
const panelCls = "z-[70] rounded-2xl border bg-popover p-4 text-popover-foreground shadow-lg outline-none";

interface DatePickerProps {
  value: string;
  onChange: (date: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  className?: string;
  /** 달력 제목을 연·월 선택 상자로 (생년월일처럼 먼 날짜를 고를 때) */
  yearMonthSelect?: boolean;
}

// 날짜 하나를 고르는 입력. 눌러서 달력을 열고, 고르면 닫힌다.
export function DatePicker({ value, onChange, placeholder = "날짜 선택", min, max, disabled, id, className, yearMonthSelect, ...aria }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger id={id} disabled={disabled} className={cn(triggerCls, className)} {...aria}>
        <span className={value ? "" : "text-muted-foreground"}>{value ? formatDate(value) : placeholder}</span>
        <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className={panelCls}>
          <Calendar value={value} min={min} max={max} yearMonthSelect={yearMonthSelect} onSelect={(d) => { onChange(d); setOpen(false); }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

interface LinkedProps {
  start: string;
  end: string;
  onChange: (range: { start: string; end: string }) => void;
  startLabel?: string;
  endLabel?: string;
  disabled?: boolean;
  className?: string;
}

// 시작일과 종료일을 따로 고르되 서로 묶여 있다. 종료일은 시작일 이후만 고를 수 있고, 시작일을 종료일보다 늦게 바꾸면 종료일이 비워진다.
export function DateRangeLinked({ start, end, onChange, startLabel = "시작일", endLabel = "종료일", disabled, className }: LinkedProps) {
  return (
    <div className={cn("grid grid-cols-2 gap-3", className)}>
      <div className="grid gap-1.5">
        <span className="text-xs font-bold">{startLabel}</span>
        <DatePicker aria-label={startLabel} value={start} disabled={disabled} onChange={(d) => onChange({ start: d, end: end && end < d ? "" : end })} />
      </div>
      <div className="grid gap-1.5">
        <span className="text-xs font-bold">{endLabel}</span>
        <DatePicker aria-label={endLabel} value={end} min={start || undefined} disabled={disabled} placeholder={start ? "날짜 선택" : "시작일을 먼저 골라요"} onChange={(d) => onChange({ start, end: d })} />
      </div>
    </div>
  );
}

interface RangeProps {
  value: { start: string; end: string };
  onChange: (range: { start: string; end: string }) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  className?: string;
}

// 한 입력에서 시작일과 종료일을 이어서 고른다. 첫 클릭이 시작일, 두 번째 클릭이 종료일이고 고른 범위가 칠해진다.
export function DateRangePicker({ value, onChange, placeholder = "기간 선택", disabled, id, className, ...aria }: RangeProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<string | null>(null); // 시작일만 골랐고 종료일을 기다리는 중
  const [hover, setHover] = useState<string | null>(null);

  const pick = (d: string) => {
    if (!anchor) return setAnchor(d);
    const [s, e] = [anchor, d].sort();
    onChange({ start: s, end: e });
    setAnchor(null);
    setHover(null);
    setOpen(false);
  };
  const label = value.start && value.end ? `${formatDate(value.start)} – ${formatDate(value.end)}` : "";

  return (
    <Popover.Root open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setAnchor(null); setHover(null); } }}>
      <Popover.Trigger id={id} disabled={disabled} className={cn(triggerCls, className)} {...aria}>
        <span className={label ? "" : "text-muted-foreground"}>{label || placeholder}</span>
        <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className={cn(panelCls, "max-w-[calc(100vw-1rem)]")}>
          <p className="mb-2 text-xs text-muted-foreground" role="status">{anchor ? "종료일을 골라 주세요" : "시작일을 골라 주세요"}</p>
          <Calendar
            months={2}
            className="max-sm:flex-col"
            range={anchor ? { start: anchor } : value.start && value.end ? value : undefined}
            preview={anchor ? hover ?? undefined : undefined}
            defaultMonth={value.start || undefined}
            onHover={anchor ? setHover : undefined}
            onSelect={pick}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
