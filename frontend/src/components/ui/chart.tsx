"use client";

import * as React from "react";
import * as RechartsPrimitive from "recharts";

import { cn } from "@/lib/utils";

// shadcn/ui Chart: Recharts를 shadcn 방식(CSS 변수 색, 툴팁, 범례)으로 감싼 것.
// https://ui.shadcn.com/docs/components/chart
export type ChartConfig = {
  [key: string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
    /** 시리즈 색. CSS 변수 --color-<key>로 차트 안에서 쓸 수 있다 */
    color?: string;
  };
};

const ChartContext = React.createContext<{ config: ChartConfig } | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) throw new Error("useChart는 <ChartContainer> 안에서만 쓸 수 있습니다.");
  return context;
}

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const entries = Object.entries(config).filter(([, c]) => c.color);
  if (entries.length === 0) return null;
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `[data-chart=${id}] {\n${entries.map(([key, c]) => `  --color-${key}: ${c.color};`).join("\n")}\n}`,
      }}
    />
  );
}

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/60 [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted/70 [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-sector]:outline-hidden [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer initialDimension={{ width: 320, height: 180 }}>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

const ChartTooltip = RechartsPrimitive.Tooltip;

interface TooltipItem {
  name?: string | number;
  dataKey?: string | number;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown> & { fill?: string };
}

interface ChartTooltipContentProps {
  active?: boolean;
  payload?: TooltipItem[];
  label?: React.ReactNode;
  className?: string;
  hideLabel?: boolean;
  hideIndicator?: boolean;
  /** 값을 화면에 보일 모양으로 바꾼다. 예: (v) => `${v.toLocaleString()}회` */
  valueFormatter?: (value: number | string) => React.ReactNode;
}

function ChartTooltipContent({ active, payload, label, className, hideLabel, hideIndicator, valueFormatter }: ChartTooltipContentProps) {
  const { config } = useChart();
  if (!active || !payload?.length) return null;
  return (
    <div className={cn("grid min-w-32 gap-1.5 rounded-xl border bg-popover px-3 py-2 text-xs shadow-xl", className)}>
      {!hideLabel && label != null && <div className="font-medium">{label}</div>}
      <div className="grid gap-1">
        {payload.map((item, i) => {
          const key = String(item.dataKey ?? item.name ?? "value");
          const cfg = config[key];
          const color = item.payload?.fill ?? item.color;
          return (
            <div key={`${key}-${i}`} className="flex items-center gap-2">
              {!hideIndicator && <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />}
              <span className="text-muted-foreground">{cfg?.label ?? item.name}</span>
              <span className="ml-auto font-mono font-medium tabular-nums">
                {valueFormatter ? valueFormatter(item.value ?? 0) : typeof item.value === "number" ? item.value.toLocaleString("ko-KR") : item.value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { ChartContainer, ChartTooltip, ChartTooltipContent, useChart };
