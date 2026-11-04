'use client'

import { AlertTriangle, Bell, FileText, MapPin, Mic, Plus, RotateCcw, Users, X } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useEvents, useRetryEventSync } from '@/hooks/malmoa/queries'
import {
  addDays,
  addMonths,
  formatDay,
  formatEventTime,
  formatReminders,
  formatMonth,
  formatTime,
  monthGrid,
  onDay,
  sameDay,
  startOfDay,
  startOfMonth,
  WEEKDAYS,
} from '@/lib/malmoa/calendar'
import { formatAttendee } from '@/lib/malmoa/format'
import type { CalendarEvent } from '@/lib/malmoa/types'
import { cn } from '@/lib/utils'
import { Fieldset, Menu, OsWindow, StatusCell } from './app-shell'
import { Notice } from './common'
import { DeleteEventDialog } from './delete-event-dialog'
import { AUTO_RECORD_LABEL, EventEditor } from './event-editor'
import { NextEventBadge, useNextEvent } from './next-event'

const MAX_CHIPS = 3
const tool = 'flex h-7 items-center gap-1 px-2.5 text-[12px] whitespace-nowrap outline-none w98-out active:w98-pressed disabled:text-shade'

/** 달력 칸 안의 일정. 칸 전체가 '날짜 고르기' 버튼이라 칩은 클릭만 따로 받아 일정 창을 연다 (키보드는 오른쪽 목록에서) */
function EventChip({ ev, onOpen }: { ev: CalendarEvent; onOpen: () => void }) {
  const auto = ev.autoRecord && ev.autoRecordState === 'armed'
  return (
    <span
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      title={`${ev.title} 열기`}
      className={cn(
        'flex cursor-pointer items-center gap-1 truncate px-1 text-left text-[11px] leading-4 hover:outline hover:outline-1 hover:outline-dotted hover:outline-black',
        ev.kind === 'meeting' ? 'bg-[#000080] text-white' : 'bg-[#dfdfdf] text-black',
      )}
    >
      {auto && <span className="size-1.5 shrink-0 bg-[#ff4040]" aria-hidden />}
      {!ev.allDay && <span className="shrink-0 font-mono text-[10px] font-bold">{formatTime(ev.startsAt)}</span>}
      <span className="truncate">{ev.title}</span>
    </span>
  )
}

function MonthGrid({
  month,
  events,
  selected,
  onSelect,
  onOpen,
}: {
  month: Date
  events: CalendarEvent[]
  selected: Date
  onSelect: (d: Date) => void
  onOpen: (ev: CalendarEvent, day: Date) => void
}) {
  const today = new Date()
  return (
    <div className="bg-white text-black w98-in">
      <div className="grid grid-cols-7 bg-face text-center font-mono text-[11px] font-bold">
        {WEEKDAYS.map((w, i) => (
          <span key={w} className={cn('py-1 w98-out', i === 0 && 'text-[#ba1a1a]', i === 6 && 'text-[#000080]')}>
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {monthGrid(month).map((day) => {
          const dayEvents = events.filter((ev) => onDay(ev, day))
          const inMonth = day.getMonth() === month.getMonth()
          const isToday = sameDay(day, today)
          const isSelected = sameDay(day, selected)
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelect(day)}
              aria-pressed={isSelected}
              aria-label={`${formatDay(day)}${isToday ? ', 오늘' : ''}, 일정 ${dayEvents.length}개`}
              className={cn(
                'flex min-h-16 flex-col gap-0.5 border-r border-b border-[#dfdfdf] p-1 text-left outline-none focus-visible:outline-1 focus-visible:outline-dotted focus-visible:-outline-offset-2 focus-visible:outline-black sm:min-h-24',
                isSelected ? 'bg-[#e0e0ff] outline-2 -outline-offset-2 outline-[#000080] outline-solid' : inMonth ? 'hover:bg-[#f4f3f3]' : 'bg-[#faf9f9]',
              )}
            >
              <span className="flex items-center justify-between">
                <span
                  className={cn(
                    'flex h-5 min-w-5 items-center justify-center px-0.5 font-mono text-[11px] font-bold tabular-nums',
                    isToday ? 'bg-[#000080] text-white' : !inMonth ? 'font-normal text-[#b0b0b0]' : day.getDay() === 0 ? 'text-[#ba1a1a]' : day.getDay() === 6 ? 'text-[#000080]' : '',
                  )}
                >
                  {day.getDate()}
                </span>
                {isToday && <span className="hidden font-mono text-[9px] font-bold text-[#000080] sm:inline">TODAY</span>}
              </span>
              {/* 좁은 화면은 점, 넓은 화면은 제목 */}
              {dayEvents.length > 0 && (
                <span className="flex justify-center gap-0.5 sm:hidden" aria-hidden>
                  {dayEvents.slice(0, MAX_CHIPS).map((ev) => (
                    <span key={ev.id} className={cn('size-1.5', ev.kind === 'meeting' ? 'bg-[#000080]' : 'bg-[#808080]')} />
                  ))}
                </span>
              )}
              <span className="hidden min-w-0 flex-col gap-0.5 sm:flex" aria-hidden>
                {dayEvents.slice(0, MAX_CHIPS).map((ev) => (
                  <EventChip key={ev.id} ev={ev} onOpen={() => onOpen(ev, day)} />
                ))}
                {dayEvents.length > MAX_CHIPS && <span className="px-1 font-mono text-[10px] font-bold text-[#464653]">+{dayEvents.length - MAX_CHIPS}개 더</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 캘린더 앱(→ 아이폰)에 넣지 못한 일정: 이유와 다시 시도 */
function SyncFailed({ ev }: { ev: CalendarEvent }) {
  const retry = useRetryEventSync()
  return (
    <Notice
      tone="warning"
      icon={<AlertTriangle />}
      className="mt-1"
      action={
        <button type="button" className={tool} disabled={retry.isPending} onClick={() => retry.mutate(ev.id)}>
          <RotateCcw className="size-3" /> {retry.isPending ? '시도 중…' : '다시 시도'}
        </button>
      }
    >
      <span className="text-[12px]">아이폰 동기화 실패 · {retry.isError ? retry.error.message : ev.calendarError}</span>
    </Notice>
  )
}

/** 오른쪽: 고른 날의 일정 목록 */
function DayEvents({ day, events, loading, onOpen, onAdd }: { day: Date; events: CalendarEvent[]; loading: boolean; onOpen: (ev: CalendarEvent) => void; onAdd: () => void }) {
  const [removing, setRemoving] = useState<CalendarEvent | null>(null)
  const sorted = [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  return (
    <Fieldset title={`${formatDay(day)} 일정 (${events.length})`}>
      <div className="flex flex-col gap-2">
        <button type="button" className={cn(tool, 'self-start font-bold')} onClick={onAdd}>
          <Plus className="size-3.5" /> 이 날 일정 추가
        </button>
        {loading ? (
          <p className="bg-white p-3 text-[12px] text-[#464653] w98-in">불러오는 중…</p>
        ) : sorted.length === 0 ? (
          <p className="bg-white p-3 text-center text-[12px] text-[#464653] w98-in">
            📅 일정이 없습니다.
            <br />
            회의를 추가하면 알람과 자동 녹음을 걸 수 있습니다.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {sorted.map((ev) => {
              const autoBad = ev.autoRecordState === 'skipped' || ev.autoRecordState === 'failed'
              return (
                <li key={ev.id} className="relative">
                  <button
                    type="button"
                    onClick={() => onOpen(ev)}
                    className={cn(
                      'flex w-full flex-col gap-1 border-l-4 bg-white p-2 pr-8 text-left text-black outline-none w98-in hover:bg-[#f0f0ff] focus-visible:outline-1 focus-visible:outline-dotted focus-visible:-outline-offset-4 focus-visible:outline-black',
                      ev.kind === 'meeting' ? 'border-l-[#000080]' : 'border-l-[#808080]',
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] font-bold">{formatEventTime(ev)}</span>
                      <span className={cn('px-1 text-[10px] font-bold', ev.kind === 'meeting' ? 'bg-[#000080] text-white' : 'bg-[#dfdfdf] text-black')}>{ev.kind === 'meeting' ? '회의' : '일정'}</span>
                    </span>
                    <span className="text-[13px] font-bold break-all">{ev.title}</span>
                    {ev.location && (
                      <span className="flex items-center gap-1 text-[11px] text-[#464653]">
                        <MapPin className="size-3 shrink-0" aria-hidden /> {ev.location}
                      </span>
                    )}
                    {ev.attendees.length > 0 && (
                      <span className="flex items-start gap-1 text-[11px] text-[#464653]">
                        <Users className="mt-0.5 size-3 shrink-0" aria-label="참석자" /> {ev.attendees.map(formatAttendee).join(', ')}
                      </span>
                    )}
                    {ev.reminders.length > 0 && (
                      <span className="flex items-center gap-1 text-[11px] text-[#464653]">
                        <Bell className="size-3 shrink-0" aria-label="알람" /> {formatReminders(ev.reminders)}
                      </span>
                    )}
                    {ev.autoRecord && (
                      <span className={cn('flex items-start gap-1 text-[11px]', autoBad ? 'font-bold text-[#ba1a1a]' : 'text-[#ba1a1a]')}>
                        <Mic className="mt-0.5 size-3 shrink-0" aria-hidden /> {AUTO_RECORD_LABEL[ev.autoRecordState] || '자동 녹음'}
                        {ev.autoRecordNote && ` · ${ev.autoRecordNote}`}
                      </span>
                    )}
                    {ev.memo && <span className="line-clamp-2 bg-[#ffffe1] px-1 text-[11px] whitespace-pre-line">{ev.memo}</span>}
                  </button>
                  {/* 카드 전체가 '열기' 단추라 삭제는 그 위에 따로 얹는다 */}
                  <button
                    type="button"
                    onClick={() => setRemoving(ev)}
                    aria-label={`${ev.title} 일정 삭제`}
                    className="absolute top-1.5 right-1.5 grid size-5 place-items-center bg-face text-[#ba1a1a] outline-none w98-out active:w98-pressed"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                  {ev.jobId && (
                    <Link href={`/jobs/${ev.jobId}`} className={cn(tool, 'mt-1 w-fit')}>
                      <FileText className="size-3.5" aria-hidden /> 이 회의의 녹음·회의록 보기
                    </Link>
                  )}
                  {ev.calendarError && <SyncFailed ev={ev} />}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <DeleteEventDialog event={removing} onClose={() => setRemoving(null)} />
    </Fieldset>
  )
}

/** 말모아 달력 창 */
export function CalendarView() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState(() => startOfDay(new Date()))
  const [editing, setEditing] = useState<{ event: CalendarEvent | null; day: Date } | null>(null)
  const next = useNextEvent()

  // 달력에 보이는 6주 전체를 한 번에 받는다
  const grid = monthGrid(month)
  const events = useEvents(grid[0], addDays(grid[grid.length - 1], 1))
  const list = events.data ?? []
  const inMonth = list.filter((ev) => new Date(ev.startsAt).getMonth() === month.getMonth())
  const meetings = inMonth.filter((ev) => ev.kind === 'meeting').length
  const autoArmed = inMonth.filter((ev) => ev.autoRecord && ev.autoRecordState === 'armed').length

  const select = (d: Date) => {
    setSelected(d)
    if (d.getMonth() !== month.getMonth()) setMonth(startOfMonth(d))
  }
  const goToday = () => {
    const today = startOfDay(new Date())
    setMonth(startOfMonth(today))
    setSelected(today)
  }
  const add = () => setEditing({ event: null, day: selected })

  return (
    <OsWindow
      icon="📅"
      title={`말모아 달력 - [${formatMonth(month)} 일정 · 알람 · 자동 녹음]`}
      menu={
        <>
          <Menu
            label="일정"
            hot="S"
            items={[
              { label: '새 일정 추가', onSelect: add },
              { label: '오늘로 이동', onSelect: goToday },
            ]}
          />
          <Menu label="도구" hot="T" items={[{ label: '아이폰 일정 알림', href: '/settings#calendar-sync' }]} />
          <Menu label="도움말" hot="H" items={[{ label: '사용 안내', href: '/guide' }]} />
        </>
      }
      statusBar={
        <>
          <StatusCell>{events.isFetching ? '불러오는 중…' : '준비 완료'}</StatusCell>
          <StatusCell className="font-mono text-[10px]">
            {formatMonth(month)}: 일정 {inMonth.length} · 회의 {meetings} · 자동 녹음 예정 {autoArmed}
          </StatusCell>
          <StatusCell className="ml-auto">선택한 날: {formatDay(selected)}</StatusCell>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {/* 도구 줄: 달 이동 · 다음 일정 · 일정 추가 */}
        <div className="flex flex-wrap items-center gap-1 border-b border-shade pb-2 shadow-[0_1px_#fff]">
          <button type="button" className={tool} aria-label="이전 달" onClick={() => setMonth(addMonths(month, -1))}>
            ◀
          </button>
          <span className="min-w-32 bg-white px-3 py-1 text-center font-heading text-[14px] font-bold w98-in" aria-live="polite">
            {formatMonth(month)}
          </span>
          <button type="button" className={tool} aria-label="다음 달" onClick={() => setMonth(addMonths(month, 1))}>
            ▶
          </button>
          <button type="button" className={tool} onClick={goToday}>
            오늘
          </button>
          <span className="mx-1 h-6 w-0.5 border-l border-shade bg-white" aria-hidden />
          {next ? (
            <NextEventBadge next={next} className="h-7 max-w-96 text-[12px] w98-in" onOpen={() => setEditing({ event: next.event, day: startOfDay(new Date(next.event.startsAt)) })} />
          ) : (
            <span className="flex h-7 items-center bg-white px-2 text-[12px] text-[#464653] w98-in">📅 앞으로 24시간 안에 일정이 없습니다</span>
          )}
          <button type="button" className={cn(tool, 'ml-auto font-bold outline outline-1 -outline-offset-1 outline-black')} onClick={add}>
            <Plus className="size-3.5" /> 일정 추가
          </button>
        </div>

        {events.isError && (
          <Notice tone="error" icon={<AlertTriangle />}>
            일정을 불러오지 못했습니다: {events.error.message}
          </Notice>
        )}

        <div className="grid items-start gap-2 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Fieldset title="월간 일정표">
            <MonthGrid
              month={month}
              events={list}
              selected={selected}
              onSelect={select}
              onOpen={(ev, day) => {
                select(day)
                setEditing({ event: ev, day })
              }}
            />
            <p className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-[#464653]">
              <span className="flex items-center gap-1">
                <span className="size-2.5 bg-[#000080]" /> 회의
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2.5 bg-[#dfdfdf] outline outline-1 outline-[#808080]" /> 기타 일정
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 bg-[#ff4040]" /> 자동 녹음 예정
              </span>
              <span>칸을 누르면 그날 일정, 일정을 누르면 일정 창</span>
            </p>
          </Fieldset>

          <div className="lg:sticky lg:top-12">
            <DayEvents day={selected} events={list.filter((ev) => onDay(ev, selected))} loading={events.isPending} onOpen={(ev) => setEditing({ event: ev, day: selected })} onAdd={add} />
          </div>
        </div>
      </div>

      <EventEditor open={editing != null} onOpenChange={(o) => !o && setEditing(null)} event={editing?.event ?? null} day={editing?.day ?? selected} />
    </OsWindow>
  )
}
