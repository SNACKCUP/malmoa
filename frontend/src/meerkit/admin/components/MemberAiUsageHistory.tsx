"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingState } from "../../loading";
import { cn } from "@/lib/utils";

import { PERIODS, formatNumber, type UsagePeriod, type UsagePoint } from "../usage-status";

interface MemberAiUsageHistoryProps {
  /** 기간 단위별 사용량. 없는 단위의 탭은 숨겨진다 */
  data: Partial<Record<UsagePeriod, UsagePoint[]>>;
  /** 제목 아래에 보여 줄 설명. 예: 멤버 이름 */
  description?: string;
  unit?: string;
  /** 처음 보여 줄 기간. 기본은 일별 */
  defaultPeriod?: UsagePeriod;
  /** 기간 탭이 바뀔 때. 서버에서 해당 기간 데이터를 가져오는 데 쓴다 */
  onPeriodChange?: (period: UsagePeriod) => void;
  loading?: boolean;
  className?: string;
}

const config = { value: { label: "사용량", color: "var(--mk-brand)" } } satisfies ChartConfig;

// 멤버의 AI 사용량을 일별/주별/월별 막대(Bar) 차트로 보여 준다.
// 현재는 프론트 UI만 구현된 상태이며, 사용량 기록·집계는 추후 적용 예정이다.
export function MemberAiUsageHistory({ data, description, unit = "회", defaultPeriod = "day", onPeriodChange, loading, className }: MemberAiUsageHistoryProps) {
  const available = PERIODS.filter((p) => data[p.id]);
  const [period, setPeriod] = useState<UsagePeriod>(available.some((p) => p.id === defaultPeriod) ? defaultPeriod : (available[0]?.id ?? "day"));
  const points = data[period] ?? [];
  const total = points.reduce((sum, p) => sum + p.value, 0);
  const peak = points.reduce<UsagePoint | null>((best, p) => (!best || p.value > best.value ? p : best), null);
  const average = points.length ? Math.round(total / points.length) : 0;

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1.5">
            <CardTitle>AI 사용량 추이</CardTitle>
            <CardDescription>{description ?? "기간별로 사용한 양을 확인합니다."}</CardDescription>
          </div>
          {available.length > 1 && (
            <Tabs
              value={period}
              onValueChange={(v) => {
                setPeriod(v as UsagePeriod);
                onPeriodChange?.(v as UsagePeriod);
              }}
            >
              <TabsList>
                {available.map((p) => <TabsTrigger key={p.id} value={p.id}>{p.label}</TabsTrigger>)}
              </TabsList>
            </Tabs>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        <dl className="grid grid-cols-3 gap-3 text-center">
          {[
            ["합계", `${formatNumber(total)} ${unit}`],
            ["평균", `${formatNumber(average)} ${unit}`],
            ["최대", peak ? `${peak.label} · ${formatNumber(peak.value)}` : "-"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl border bg-surface px-2 py-2.5">
              <dt className="text-[11px] text-muted-foreground">{k}</dt>
              <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>

        {loading ? (
          <LoadingState minHeight={192} />
        ) : points.length === 0 ? (
          <div className="grid h-48 place-items-center rounded-2xl border border-dashed text-sm text-muted-foreground">표시할 사용량이 없습니다.</div>
        ) : (
          <ChartContainer config={config} role="img" aria-label={`${PERIODS.find((p) => p.id === period)?.label} AI 사용량 막대 차트, 합계 ${formatNumber(total)} ${unit}`} className="aspect-auto h-52 w-full">
            <BarChart data={points} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent valueFormatter={(v) => `${formatNumber(Number(v))} ${unit}`} />} />
              <Bar dataKey="value" fill="var(--color-value)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
