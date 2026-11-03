'use client'

import { AlertTriangle, Save } from 'lucide-react'
import Link from 'next/link'
import { useId, useState } from 'react'
import { Button } from '@/components/malmoa/ui/button'
import { Input } from '@/components/malmoa/ui/input'
import { useSaveUsageLimits, useUsage } from '@/hooks/malmoa/queries'
import type { UsageSummary, UsageTotals } from '@/lib/malmoa/types'
import { Notice, ToneBadge } from './common'
import { Group, PxBar, Tip } from './px'

/** 한도의 이 비율을 넘으면 경고 */
export const USAGE_WARN_RATIO = 0.8

const num = (n: number) => n.toLocaleString('ko-KR')
const time = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

/** 한도와 비교한 사용 비율 (한도가 없으면 null). 화면 여러 곳에서 같은 기준으로 경고한다 */
export function usageRatios(u: UsageSummary) {
  return {
    month: u.monthlyTokens ? u.month.tokens / u.monthlyTokens : null,
    today: u.dailyCalls ? u.today.calls / u.dailyCalls : null,
  }
}

/** 설정: AI 사용량 — 말모아가 회의록 작성에 쓴 호출·토큰, 사용자가 정한 한도와 비교 (docs/2026-11-02-AI사용량.md) */
export function UsageCard() {
  const usage = useUsage()
  // 저장하면 입력칸(LimitForm)을 새 값으로 다시 그리므로 저장 상태는 여기서 들고 있는다
  const save = useSaveUsageLimits()
  const u = usage.data

  return (
    <Group title="AI 사용량" className="scroll-mt-24">
      <div id="usage" className="flex flex-col gap-4">
        <p className="text-sm text-[#404040]">말모아가 회의록을 만들며 AI를 부른 횟수와 토큰입니다. 형식이 틀려 다시 물은 호출, 실패한 시도에서 쓴 토큰도 셉니다. 하루·한 달은 한국 시간 기준입니다.</p>
        {usage.isError && (
          <Notice tone="error" icon={<AlertTriangle />}>
            사용량을 불러오지 못했습니다: {usage.error.message}
          </Notice>
        )}
        {!u ? (
          !usage.isError && <p className="py-4 text-center text-sm text-[#404040]">불러오는 중…</p>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              <Stat label="오늘" t={u.today} />
              <Stat label="이번 달" t={u.month} />
              <Stat label="전체" t={u.all} />
            </div>
            <LimitBars u={u} />
            <LimitForm key={`${u.monthlyTokens}:${u.dailyCalls}`} u={u} save={save} />
            <ByModel u={u} />
            <Recent u={u} />
          </>
        )}
      </div>
    </Group>
  )
}

function Stat({ label, t }: { label: string; t: UsageTotals }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-white px-3 py-2 w98-in">
      <span className="text-[12px] font-bold text-[#000080]">{label}</span>
      <span className="font-pixel text-lg tabular-nums">{num(t.tokens)} 토큰</span>
      <span className="text-[12px] text-[#464653] tabular-nums">
        입력 {num(t.inputTokens)} · 출력 {num(t.outputTokens)} · 호출 {num(t.calls)}번
      </span>
    </div>
  )
}

function Bar({ label, used, limit, unit, note }: { label: string; used: number; limit: number; unit: string; note: string }) {
  const ratio = used / limit
  const pct = Math.floor(ratio * 100)
  const over = ratio >= 1
  const warn = ratio >= USAGE_WARN_RATIO
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-bold">{label}</span>
        <span className="flex items-center gap-2 tabular-nums">
          {num(used)} / {num(limit)} {unit} ({pct}%)
          {over ? <ToneBadge tone="error">한도 넘음</ToneBadge> : warn ? <ToneBadge tone="warning">80% 넘음</ToneBadge> : null}
        </span>
      </div>
      <PxBar value={used} max={limit} tone={warn ? 'red' : 'navy'} label={`${label} ${pct}%`} />
      <span className="text-[12px] text-[#464653]">{note}</span>
    </div>
  )
}

function LimitBars({ u }: { u: UsageSummary }) {
  const r = usageRatios(u)
  if (r.month == null && r.today == null) {
    return <Tip>아래에 한도를 넣으면 이번 달·오늘 사용량을 한도와 비교해 막대로 보여 주고, 80%를 넘으면 경고합니다.</Tip>
  }
  const warn = (r.month ?? 0) >= USAGE_WARN_RATIO || (r.today ?? 0) >= USAGE_WARN_RATIO
  const over = (r.month ?? 0) >= 1 || (r.today ?? 0) >= 1
  return (
    <div className="flex flex-col gap-3">
      {u.monthlyTokens != null && <Bar label="이번 달 토큰" used={u.month.tokens} limit={u.monthlyTokens} unit="토큰" note={`${time(u.monthStart)}부터 · 다음 달 1일에 0부터 다시 셉니다`} />}
      {u.dailyCalls != null && <Bar label="오늘 호출" used={u.today.calls} limit={u.dailyCalls} unit="번" note={`${time(u.nextDay)}(한국 시간 자정)에 0부터 다시 셉니다`} />}
      {warn && (
        <Notice tone={over ? 'error' : 'warning'} icon={<AlertTriangle />}>
          {over
            ? '정해 둔 한도를 넘었습니다. 제공자의 실제 한도라면 회의록 만들기가 거절될 수 있습니다. AI 프롬프트 포함 복사로 ChatGPT·Claude 화면에서 만드는 방법도 있습니다.'
            : '정해 둔 한도의 80%를 넘었습니다. 긴 회의는 여러 번 호출하니 남은 양을 확인해 주세요.'}
        </Notice>
      )}
    </div>
  )
}

/** 빈칸 = 한도 없음. 쉼표·공백은 지우고 읽는다 */
function parseLimit(text: string): number | null | 'bad' {
  const t = text.replace(/[,\s]/g, '')
  if (!t) return null
  if (!/^\d+$/.test(t) || Number(t) < 1) return 'bad'
  return Number(t)
}

function LimitForm({ u, save }: { u: UsageSummary; save: ReturnType<typeof useSaveUsageLimits> }) {
  const ids = { month: useId(), day: useId() }
  const [month, setMonth] = useState(u.monthlyTokens != null ? String(u.monthlyTokens) : '')
  const [day, setDay] = useState(u.dailyCalls != null ? String(u.dailyCalls) : '')
  const m = parseLimit(month)
  const d = parseLimit(day)
  const bad = m === 'bad' || d === 'bad'
  const changed = m !== u.monthlyTokens || d !== u.dailyCalls

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (bad) return
        save.mutate({ monthlyTokens: m, dailyCalls: d })
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
        <label htmlFor={ids.month} className="text-sm font-bold">
          한 달 토큰 한도
        </label>
        <Input
          id={ids.month}
          inputMode="numeric"
          placeholder="예: 1,000,000 (비우면 한도 없음)"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="sm:max-w-xs"
          disabled={save.isPending}
        />
        <label htmlFor={ids.day} className="text-sm font-bold">
          하루 호출 한도
        </label>
        <Input id={ids.day} inputMode="numeric" placeholder="예: 1,000 (비우면 한도 없음)" value={day} onChange={(e) => setDay(e.target.value)} className="sm:max-w-xs" disabled={save.isPending} />
      </div>
      <Tip>
        제공자가 알려 주는 남은 양이 아니라 직접 정하는 기준입니다. 무료 등급의 실제 한도는 제공자 사이트(Gemini는 Google AI Studio의 사용량·한도 화면)에서 확인해 넣으세요. 같은 키를 말모아 밖에서도
        쓰면 그 사용량은 여기에 들어가지 않습니다.
      </Tip>
      {bad && <p className="text-sm text-[#c00000]">한도는 1 이상의 숫자로 넣거나 비워 두세요.</p>}
      {save.isError && (
        <Notice tone="error" icon={<AlertTriangle />}>
          저장하지 못했습니다: {save.error.message}
        </Notice>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={bad || !changed || save.isPending}>
          <Save /> {save.isPending ? '저장 중…' : '한도 저장'}
        </Button>
        {save.isSuccess && !changed && <span className="text-sm text-[#006a6a]">✓ 저장됨</span>}
      </div>
    </form>
  )
}

function ByModel({ u }: { u: UsageSummary }) {
  if (!u.byModel.length) return null
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-bold">이번 달 모델별</h3>
      <div className="overflow-x-auto bg-white w98-in">
        <table className="w-full text-[12px] tabular-nums">
          <thead className="bg-face text-left">
            <tr>
              <th className="px-2 py-1">모델</th>
              <th className="px-2 py-1 text-right">호출</th>
              <th className="px-2 py-1 text-right">입력</th>
              <th className="px-2 py-1 text-right">출력</th>
              <th className="px-2 py-1 text-right">합계</th>
            </tr>
          </thead>
          <tbody>
            {u.byModel.map((m) => (
              <tr key={`${m.provider}:${m.model}`} className="border-t border-dotted border-[#808080]">
                <td className="px-2 py-1 whitespace-nowrap">
                  {m.model || '(모델 미상)'} <span className="text-[#464653]">· {m.provider}</span>
                </td>
                <td className="px-2 py-1 text-right">{num(m.calls)}</td>
                <td className="px-2 py-1 text-right">{num(m.inputTokens)}</td>
                <td className="px-2 py-1 text-right">{num(m.outputTokens)}</td>
                <td className="px-2 py-1 text-right font-bold">{num(m.tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Recent({ u }: { u: UsageSummary }) {
  if (!u.recent.length) return <Tip>아직 AI로 회의록을 만든 기록이 없습니다.</Tip>
  return (
    <details className="flex flex-col gap-1">
      <summary className="cursor-pointer text-sm font-bold">최근 기록 {u.recent.length}개</summary>
      <div className="mt-1 overflow-x-auto bg-white w98-in">
        <table className="w-full text-[12px] tabular-nums">
          <thead className="bg-face text-left">
            <tr>
              <th className="px-2 py-1">시각</th>
              <th className="px-2 py-1">회의</th>
              <th className="px-2 py-1">모델</th>
              <th className="px-2 py-1 text-right">호출</th>
              <th className="px-2 py-1 text-right">입력</th>
              <th className="px-2 py-1 text-right">출력</th>
            </tr>
          </thead>
          <tbody>
            {u.recent.map((r) => (
              <tr key={r.id} className="border-t border-dotted border-[#808080]">
                <td className="px-2 py-1 whitespace-nowrap">{time(r.createdAt)}</td>
                <td className="max-w-48 truncate px-2 py-1" title={r.fileName ?? undefined}>
                  {r.jobId ? (
                    <Link href={`/jobs/${r.jobId}`} className="text-[#000080] underline">
                      {r.fileName ?? '회의'}
                    </Link>
                  ) : (
                    <span className="text-[#464653]">[지운 작업] {r.fileName ?? '회의'}</span>
                  )}
                </td>
                <td className="px-2 py-1 whitespace-nowrap">{r.model || '(모델 미상)'}</td>
                <td className="px-2 py-1 text-right">{num(r.calls)}</td>
                <td className="px-2 py-1 text-right">{num(r.inputTokens)}</td>
                <td className="px-2 py-1 text-right">{num(r.outputTokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
