'use client'

import { Plus, X } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useEvents } from '@/hooks/malmoa/queries'
import { addDays, addMonths, formatDay, formatMonth, formatTime, monthGrid, onDay, sameDay, startOfDay, startOfMonth, WEEKDAYS } from '@/lib/malmoa/calendar'
import type { CalendarEvent } from '@/lib/malmoa/types'
import { cn } from '@/lib/utils'
import { DeleteEventDialog } from './delete-event-dialog'
import { EventEditor } from './event-editor'
import { NextEventBadge, useNextEvent } from './next-event'

const btn = 'flex h-6 items-center gap-1 px-2 text-[11px] outline-none w98-out active:w98-pressed'

/** 녹음기 옆 작은 달력: 다음 일정 알림, 일정 있는 날은 점, 날짜를 누르면 그날 일정(누르면 일정 창, ✕로 삭제) */
export function MiniCalendar() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState(() => startOfDay(new Date()))
  const [editing, setEditing] = useState<{ event: CalendarEvent | null; day: Date } | null>(null)
  const [removing, setRemoving] = useState<CalendarEvent | null>(null)
  const next = useNextEvent()
  const grid = monthGrid(month)
  const events = useEvents(grid[0], addDays(grid[grid.length - 1], 1))
  const list = events.data ?? []
  const today = new Date()
  const dayEvents = list.filter((ev) => onDay(ev, selected)).sort((a, b) => a.startsAt.localeCompare(b.startsAt))

  const pick = (d: Date) => {
    setSelected(d)
    if (d.getMonth() !== month.getMonth()) setMonth(startOfMonth(d))
  }

  return (
    <section aria-label="말모아 달력" className="flex flex-col gap-1.5 bg-[#eeeeee] p-2 text-[12px] w98-out">
      {/* 다음 일정: 10분 안이면 빨갛게 깜박인다. 누르면 일정 창 */}
      {next ? (
        <NextEventBadge next={next} className="h-7 w-full w98-in" onOpen={() => setEditing({ event: next.event, day: startOfDay(new Date(next.event.startsAt)) })} />
      ) : (
        <p className="flex h-7 items-center gap-1 bg-white px-1.5 text-[#464653] w98-in">📅 앞으로 24시간 안에 일정이 없습니다</p>
      )}
      <div className="flex items-center justify-between gap-1">
        <button type="button" className={btn} aria-label="이전 달" onClick={() => setMonth(addMonths(month, -1))}>
          ◀
        </button>
        <span className="flex-1 bg-white py-0.5 text-center font-heading text-[13px] font-bold w98-in" aria-live="polite">
          📅 {formatMonth(month)}
        </span>
        <button type="button" className={btn} aria-label="다음 달" onClick={() => setMonth(addMonths(month, 1))}>
          ▶
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => {
            setMonth(startOfMonth(today))
            setSelected(startOfDay(today))
          }}
        >
          오늘
        </button>
      </div>

      <div className="bg-white p-0.5 w98-in">
        <div className="grid grid-cols-7 text-center font-mono text-[10px] font-bold">
          {WEEKDAYS.map((w, i) => (
            <span key={w} className={cn('bg-face py-0.5 w98-out', i === 0 && 'text-[#ba1a1a]', i === 6 && 'text-[#000080]')}>
              {w}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {grid.map((day) => {
            const n = list.filter((ev) => onDay(ev, day)).length
            const inMonth = day.getMonth() === month.getMonth()
            const isToday = sameDay(day, today)
            const isSel = sameDay(day, selected)
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => pick(day)}
                aria-pressed={isSel}
                aria-label={`${formatDay(day)}${isToday ? ', 오늘' : ''}, 일정 ${n}개`}
                className={cn(
                  'flex h-9 flex-col items-center justify-center gap-0.5 font-mono text-[11px] outline-none focus-visible:outline-1 focus-visible:outline-dotted focus-visible:-outline-offset-2 focus-visible:outline-black',
                  isSel ? 'bg-[#000080] text-white' : 'hover:bg-[#e0e0ff]',
                  !inMonth && !isSel && 'text-[#b0b0b0]',
                  inMonth && !isSel && day.getDay() === 0 && 'text-[#ba1a1a]',
                  inMonth && !isSel && day.getDay() === 6 && 'text-[#000080]',
                )}
              >
                <span className={cn('leading-none', isToday && !isSel && 'border border-black px-0.5 font-bold')}>{day.getDate()}</span>
                <span className="flex h-1 gap-px" aria-hidden>
                  {Array.from({ length: Math.min(n, 3) }, (_, i) => (
                    <span key={i} className={cn('size-1', isSel ? 'bg-white' : 'bg-[#ba1a1a]')} />
                  ))}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-1">
        <span className="font-bold">{formatDay(selected)} 일정</span>
        <button type="button" className={btn} onClick={() => setEditing({ event: null, day: selected })}>
          <Plus className="size-3" aria-hidden /> 일정 추가
        </button>
      </div>
      <ul className="flex max-h-36 min-h-14 flex-col overflow-auto bg-white p-1 w98-in" aria-label={`${formatDay(selected)} 일정`}>
        {events.isError ? (
          <li className="p-1 text-[#ba1a1a]">일정을 불러오지 못했습니다.</li>
        ) : events.isPending ? (
          <li className="p-1 text-[#464653]">불러오는 중…</li>
        ) : dayEvents.length === 0 ? (
          <li className="p-1 text-[#464653]">일정이 없습니다.</li>
        ) : (
          dayEvents.map((ev) => (
            <li key={ev.id} className="flex items-center">
              <button
                type="button"
                onClick={() => setEditing({ event: ev, day: selected })}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-0.5 text-left outline-none hover:bg-[#000080] hover:text-white focus-visible:bg-[#000080] focus-visible:text-white"
              >
                <span className="w-10 shrink-0 font-mono text-[11px] font-bold">{ev.allDay ? '종일' : formatTime(ev.startsAt)}</span>
                <span className="min-w-0 flex-1 truncate">{ev.title}</span>
                {ev.kind === 'meeting' && <span className="shrink-0 text-[10px]">회의</span>}
                {ev.autoRecord && ev.autoRecordState === 'armed' && <span className="shrink-0 text-[10px] text-[#ba1a1a]">● 자동</span>}
              </button>
              <button
                type="button"
                onClick={() => setRemoving(ev)}
                aria-label={`${ev.title} 일정 삭제`}
                className="flex size-5 shrink-0 items-center justify-center text-[#ba1a1a] outline-none hover:bg-[#ffdad6] focus-visible:bg-[#ffdad6]"
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))
        )}
      </ul>
      <Link href="/calendar" className={cn(btn, 'self-end')}>
        큰 달력 열기 ▸
      </Link>

      <DeleteEventDialog event={removing} onClose={() => setRemoving(null)} />
      <EventEditor open={editing != null} onOpenChange={(o) => !o && setEditing(null)} event={editing?.event ?? null} day={editing?.day ?? selected} />
    </section>
  )
}
