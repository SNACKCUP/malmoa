/**
 * 캘린더 날짜 계산. 모두 브라우저(=이 Mac)의 현지 시각 기준.
 * 서버와는 시간대가 붙은 ISO 문자열로 주고받는다.
 */
import type { CalendarEvent } from './types'

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

/** 알람 시점 (서버의 REMINDER_CHOICES와 같아야 함) */
export const REMINDER_OPTIONS = [
  { minutes: 0, label: '정시' },
  { minutes: 5, label: '5분 전' },
  { minutes: 10, label: '10분 전' },
  { minutes: 30, label: '30분 전' },
  { minutes: 60, label: '1시간 전' },
  { minutes: 1440, label: '하루 전' },
] as const

/** [1440, 10] → "하루 전, 10분 전" */
export const formatReminders = (minutes: number[]) =>
  REMINDER_OPTIONS.filter((o) => minutes.includes(o.minutes))
    .reverse()
    .map((o) => o.label)
    .join(', ')

const p = (n: number) => String(n).padStart(2, '0')

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes())

export const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)

export const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1)

export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** 달력에 그릴 6주(42칸): 그달 1일이 있는 주의 일요일부터 */
export function monthGrid(month: Date): Date[] {
  const first = startOfMonth(month)
  const start = addDays(first, -first.getDay())
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
}

/** 그날(00:00~24:00)과 겹치는 일정인가 */
export function onDay(ev: CalendarEvent, day: Date): boolean {
  const from = startOfDay(day)
  const to = addDays(from, 1)
  return new Date(ev.startsAt) < to && new Date(ev.endsAt) > from
}

/** <input type="date"> 값: 2026-10-29 */
export const toDateInput = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`

/** <input type="time"> 값: 14:05 */
export const toTimeInput = (d: Date) => `${p(d.getHours())}:${p(d.getMinutes())}`

/** 입력칸의 날짜·시각을 현지 시각 Date로 */
export function fromInputs(date: string, time = '00:00'): Date | null {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null
  return new Date(y, m - 1, d, hh, mm)
}

/** 10월 29일 (목) */
export const formatDay = (d: Date) => new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }).format(d)

/** 2026년 10월 */
export const formatMonth = (d: Date) => new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long' }).format(d)

/** 14:05 */
export const formatTime = (iso: string) => toTimeInput(new Date(iso))

/** 일정의 시간 표시: "종일", "10:00 ~ 11:30", 여러 날이면 "10월 29일 (목) 10:00 ~ 10월 30일 (금) 18:00" */
export function formatEventTime(ev: CalendarEvent): string {
  const s = new Date(ev.startsAt)
  const e = new Date(ev.endsAt)
  if (ev.allDay) {
    const last = addDays(e, -1)
    return sameDay(s, last) ? '종일' : `${formatDay(s)} ~ ${formatDay(last)} 종일`
  }
  if (sameDay(s, e) || (e.getHours() === 0 && e.getMinutes() === 0 && sameDay(s, addDays(e, -1)))) {
    return `${toTimeInput(s)} ~ ${toTimeInput(e)}`
  }
  return `${formatDay(s)} ${toTimeInput(s)} ~ ${formatDay(e)} ${toTimeInput(e)}`
}
