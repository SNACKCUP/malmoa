"use client";

import { Label, PolarAngleAxis, PolarGrid, PolarRadiusAxis, RadialBar, RadialBarChart } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { LoadingState } from "../../loading";
import { cn } from "@/lib/utils";

import { RoleBadges } from "../../auth/components/RoleBadges";
import { UserAvatar, displayName } from "../../auth/components/UserAvatar";
import type { User } from "../../types";
import { LEVEL_COLOR, LEVEL_LABEL, formatNumber, usageLevel, type AiUsage } from "../usage-status";

interface MemberAiUsageProps {
  /** 어느 멤버의 사용량인지 머리말에 보여 준다. 없으면 차트만 보인다 */
  member?: Pick<User, "name" | "nickname" | "avatar_url" | "user_id" | "roles">;
  usage: AiUsage | null | undefined;
  loading?: boolean;
  className?: string;
}

function daysUntil(iso?: string) {
  if (!iso) return null;
  const diff = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return diff > 0 ? diff : 0;
}

// 한 멤버가 이번 주기에 AI를 얼마나 썼는지 원형(Radial) 차트로 보여 준다.
// 현재는 프론트 UI만 구현된 상태이며, 사용량 기록·집계는 추후 적용 예정이다.
export function MemberAiUsage({ member, usage, loading, className }: MemberAiUsageProps) {
  const unit = usage?.unit ?? "회";
  const limited = !!usage && usage.limit !== null && usage.limit > 0;
  const percent = usage && limited ? Math.min(100, (usage.used / usage.limit!) * 100) : 0;
  const level = usageLevel(percent);
  const color = limited ? LEVEL_COLOR[level] : "var(--mk-brand)";
  const config = { usage: { label: "사용량", color } } satisfies ChartConfig;
  const reset = daysUntil(usage?.resetAt);

  return (
    <Card className={cn("w-full max-w-sm", className)}>
      <CardContent className="grid gap-4">
        {member && (
          <div className="flex items-center gap-3">
            <UserAvatar user={member} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{displayName(member)}</p>
              <p className="truncate text-xs text-muted-foreground">{member.user_id}</p>
            </div>
            <RoleBadges roles={member.roles} className="justify-end" />
          </div>
        )}

        {loading ? (
          <LoadingState minHeight={224} />
        ) : !usage ? (
          <div className="grid aspect-square max-h-56 place-items-center rounded-2xl border border-dashed text-center text-sm text-muted-foreground">
            <p>사용량 정보가 없습니다.<br /><span className="text-xs">아직 AI를 사용하지 않았거나 집계 전입니다.</span></p>
          </div>
        ) : (
          <ChartContainer config={config} role="img" aria-label={limited ? `AI 사용량 ${Math.round(percent)}%` : `AI 사용량 ${formatNumber(usage.used)} ${unit}`} className="mx-auto aspect-square max-h-56 w-full">
            {/* 전체 원(360°)을 회색 트랙으로 깔고, 그 위에 사용 비율(0~100)만큼 채운다 */}
            <RadialBarChart data={[{ name: "usage", value: limited ? percent : 100, fill: "var(--color-usage)" }]} startAngle={90} endAngle={-270} innerRadius="72%" outerRadius="98%">
              <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
              <PolarGrid gridType="circle" radialLines={false} stroke="none" className="first:fill-muted last:fill-card" polarRadius={[86, 74]} />
              <RadialBar dataKey="value" background cornerRadius={12} />
              <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
                <Label
                  content={({ viewBox }) => {
                    if (!viewBox || !("cx" in viewBox)) return null;
                    return (
                      <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                        <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) - 6} className="fill-foreground text-3xl font-semibold">
                          {limited ? `${Math.round(percent)}%` : formatNumber(usage.used)}
                        </tspan>
                        <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 16} className="fill-muted-foreground text-xs">
                          {limited ? "사용" : `${unit} 사용`}
                        </tspan>
                      </text>
                    );
                  }}
                />
              </PolarRadiusAxis>
            </RadialBarChart>
          </ChartContainer>
        )}

        {usage && !loading && (
          <dl className="grid gap-2 border-t pt-3 text-[13px]">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">사용량</dt>
              <dd className="font-medium tabular-nums">
                {formatNumber(usage.used)}{limited && <span className="text-muted-foreground"> / {formatNumber(usage.limit!)}</span>} {unit}
              </dd>
            </div>
            {limited && (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">남은 양</dt>
                <dd className="font-medium tabular-nums">{formatNumber(Math.max(0, usage.limit! - usage.used))} {unit}</dd>
              </div>
            )}
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">상태</dt>
              <dd>
                {limited ? (
                  <Badge variant={level === "danger" ? "destructive" : level === "warn" ? "secondary" : "brand"}>{LEVEL_LABEL[level]}</Badge>
                ) : (
                  <Badge variant="secondary">제한 없음</Badge>
                )}
              </dd>
            </div>
            {reset !== null && (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">초기화</dt>
                <dd className="font-medium">{reset === 0 ? "오늘" : `${reset}일 뒤`}</dd>
              </div>
            )}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
