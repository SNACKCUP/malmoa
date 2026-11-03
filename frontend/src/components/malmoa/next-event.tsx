'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useEvents } from '@/hooks/malmoa/queries'
import { addDays, formatTime, startOfDay } from '@/lib/malmoa/calendar'
import type { CalendarEvent } from '@/lib/malmoa/types'
import { cn } from '@/lib/utils'

const SOON_MIN = 10 // 이 시간 안으로 다가오면 빨갛게 깜박인다

export interface NextEvent {
  event: CalendarEvent
  ongoing: boolean
  minutesLeft: number
  soon: boolean
  label: string
}

const until = (min: number) => (min < 1 ? '곧 시작' : min < 60 ? `${min}분 후` : `${Math.floor(min / 60)}시간${min % 60 ? ` ${min % 60}분` : ''} 후`)

/** 지금 진행 중이거나 24시간 안에 시작하는 가장 가까운 일정 (종일 일정 제외). 20초마다 다시 계산 */
export function useNextEvent(): NextEvent | null {
  const today = startOfDay(new Date())
  const events = useEvents(today, addDays(today, 2))
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000)
    return () => clearInterval(t)
  }, [])
  const list = (events.data ?? []).filter((e) => !e.allDay)
  const ongoing = list.find((e) => new Date(e.startsAt).getTime() <= now && now < new Date(e.endsAt).getTime())
  const next = list
    .filter((e) => new Date(e.startsAt).getTime() > now && new Date(e.startsAt).getTime() - now <= 24 * 60 * 60 * 1000)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]
  // 곧 시작할 일정이 있으면 진행 중인 일정보다 먼저 알린다
  const minutesNext = next ? Math.floor((new Date(next.startsAt).getTime() - now) / 60_000) : Infinity
  if (next && (!ongoing || minutesNext <= SOON_MIN)) {
    const tomorrow = new Date(next.startsAt).getDate() !== new Date(now).getDate()
    return {
      event: next,
      ongoing: false,
      minutesLeft: minutesNext,
      soon: minutesNext <= SOON_MIN,
      label: `${tomorrow ? '내일 ' : ''}${formatTime(next.startsAt)} ${next.title} · ${until(minutesNext)}`,
    }
  }
  if (ongoing) return { event: ongoing, ongoing: true, minutesLeft: 0, soon: true, label: `진행 중: ${formatTime(ongoing.startsAt)} ${ongoing.title}` }
  return null
}

/** 다음 일정 알림 칸 (작업 표시줄·녹음기에 함께 쓴다). 10분 안이면 빨갛게 깜박인다 */
export function NextEventBadge({ next, className, onOpen }: { next: NextEvent; className?: string; onOpen?: () => void }) {
  const auto = next.event.autoRecord && next.event.autoRecordState === 'armed'
  const body = (
    <>
      <span aria-hidden>{next.soon ? '⏰' : '📅'}</span>
      <span className="truncate">{next.label}</span>
      {auto && !next.ongoing && <span className={cn('shrink-0', next.soon ? 'text-[#ffff00]' : 'text-[#ba1a1a]')}>● 자동 녹음</span>}
    </>
  )
  const cls = cn(
    'flex min-w-0 items-center gap-1 px-1.5 font-bold outline-none',
    next.soon ? 'bg-[#ba1a1a] text-white motion-safe:animate-pulse' : 'bg-[#ffffe1] text-black',
    className,
  )
  return onOpen ? (
    <button type="button" onClick={onOpen} className={cls} aria-live="polite">
      {body}
    </button>
  ) : (
    <Link href="/calendar" className={cls} aria-live="polite" title="말모아 달력에서 보기">
      {body}
    </Link>
  )
}
