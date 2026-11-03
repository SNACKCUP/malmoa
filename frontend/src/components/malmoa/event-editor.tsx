'use client'

import { AlertTriangle, Mic, Trash2 } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/malmoa/ui/alert-dialog'
import { Button } from '@/components/malmoa/ui/button'
import { Checkbox } from '@/components/malmoa/ui/checkbox'
import { Input } from '@/components/malmoa/ui/input'
import { Label } from '@/components/malmoa/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/malmoa/ui/sheet'
import { Textarea } from '@/components/malmoa/ui/textarea'
import { useDeleteEvent, useSaveEvent } from '@/hooks/malmoa/queries'
import { addDays, fromInputs, REMINDER_OPTIONS, toDateInput, toTimeInput } from '@/lib/malmoa/calendar'
import type { Attendee, AutoRecordState, CalendarEvent, EventInput, EventKind } from '@/lib/malmoa/types'
import { useRecorderPrefs } from '@/stores/malmoa/recorderPrefs'
import { AttendeePicker } from './attendees'
import { Notice } from './common'

export const AUTO_RECORD_LABEL: Record<AutoRecordState, string> = {
  none: '',
  armed: '자동 녹음 예정',
  started: '자동 녹음 시작됨',
  skipped: '자동 녹음 건너뜀',
  failed: '자동 녹음 실패',
}

/** 새 일정의 기본 시각: 오늘이면 다음 정각, 다른 날이면 10시. 1시간짜리 */
function defaultTimes(day: Date): { start: string; end: string } {
  const now = new Date()
  const sameDay = toDateInput(day) === toDateInput(now)
  const hour = sameDay ? Math.min(now.getHours() + 1, 22) : 10
  const p = (n: number) => String(n).padStart(2, '0')
  return { start: `${p(hour)}:00`, end: `${p(hour + 1)}:00` }
}

function EventForm({ event, day, onDone }: { event: CalendarEvent | null; day: Date; onDone: () => void }) {
  const ids = {
    title: useId(),
    date: useId(),
    endDate: useId(),
    start: useId(),
    end: useId(),
    allDay: useId(),
    location: useId(),
    memo: useId(),
    reminders: useId(),
    autoRecord: useId(),
  }
  const save = useSaveEvent()
  const remove = useDeleteEvent()

  const initial = event
    ? {
        date: toDateInput(new Date(event.startsAt)),
        // 종일 일정의 종료는 다음 날 00:00으로 저장되므로 화면에는 하루 앞당겨 보여 준다
        endDate: toDateInput(event.allDay ? addDays(new Date(event.endsAt), -1) : new Date(event.endsAt)),
        start: toTimeInput(new Date(event.startsAt)),
        end: toTimeInput(new Date(event.endsAt)),
      }
    : { date: toDateInput(day), endDate: toDateInput(day), ...defaultTimes(day) }

  const [title, setTitle] = useState(event?.title ?? '')
  const [kind, setKind] = useState<EventKind>(event?.kind ?? 'meeting')
  const [allDay, setAllDay] = useState(event?.allDay ?? false)
  const [date, setDate] = useState(initial.date)
  const [endDate, setEndDate] = useState(initial.endDate)
  const [start, setStart] = useState(initial.start)
  const [end, setEnd] = useState(initial.end)
  const [location, setLocation] = useState(event?.location ?? '')
  const [memo, setMemo] = useState(event?.memo ?? '')
  const [attendees, setAttendees] = useState<Attendee[]>(event?.attendees ?? [])
  // 새 일정은 10분 전 알람을 기본으로
  const [reminders, setReminders] = useState<number[]>(event?.reminders ?? [10])
  const [autoRecord, setAutoRecord] = useState(event?.autoRecord ?? false)
  const [consentOpen, setConsentOpen] = useState(false)
  const { autoRecordConsent, setAutoRecordConsent } = useRecorderPrefs()
  const [error, setError] = useState<string | null>(null)

  const busy = save.isPending || remove.isPending

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!title.trim()) return setError('제목을 입력해 주세요.')
    const startsAt = allDay ? fromInputs(date) : fromInputs(date, start)
    // 종일: 마지막 날의 다음 날 00:00까지
    const lastDay = fromInputs(endDate)
    const endsAt = allDay ? lastDay && addDays(lastDay, 1) : fromInputs(date, end)
    if (!startsAt || !endsAt) return setError('날짜와 시각을 확인해 주세요.')
    if (endsAt <= startsAt) return setError(allDay ? '마지막 날은 시작 날과 같거나 뒤여야 합니다.' : '종료 시각은 시작 시각보다 뒤여야 합니다.')

    const meeting = kind === 'meeting'
    const input: EventInput = {
      title: title.trim(),
      kind,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      allDay,
      location: location.trim() || null,
      memo: memo.trim() || null,
      attendees: meeting ? attendees : [],
      reminders,
      autoRecord: meeting && !allDay && autoRecord,
    }
    save.mutate({ id: event?.id, input }, { onSuccess: onDone, onError: (err) => setError(err.message) })
  }

  const toggleReminder = (m: number) => setReminders((r) => (r.includes(m) ? r.filter((x) => x !== m) : [...r, m]))

  const kindButton = (k: EventKind, label: string) => (
    <Button type="button" variant={kind === k ? 'default' : 'outline'} aria-pressed={kind === k} className="h-10 flex-1" onClick={() => setKind(k)}>
      {label}
    </Button>
  )

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      {/* 위 단추 줄: 긴 일정 창을 끝까지 내리지 않고도 저장할 수 있게 */}
      <div className="flex items-center gap-2 border-b border-shade px-4 py-2 shadow-[0_1px_#fff]">
        <span className="min-w-0 flex-1 truncate text-[12px] text-[#464653]">
          {error ? <span className="font-bold text-[#ba1a1a]">{error}</span> : kind === 'meeting' ? '회의 일정 · 알람과 자동 녹음을 걸 수 있습니다' : '기타 일정'}
        </span>
        <Button type="submit" size="sm" className="px-4" disabled={busy}>
          {save.isPending ? '저장 중…' : '저장'}
        </Button>
      </div>
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pt-4 pb-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={ids.title}>제목</Label>
          <Input id={ids.title} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} placeholder="예: 주간 회의" className="h-11" autoFocus={!event} />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">종류</span>
          <div className="flex gap-2" role="group" aria-label="일정 종류">
            {kindButton('meeting', '회의')}
            {kindButton('other', '기타 일정')}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox id={ids.allDay} checked={allDay} onCheckedChange={(v) => setAllDay(v === true)} />
          <Label htmlFor={ids.allDay} className="cursor-pointer font-normal">
            종일
          </Label>
        </div>

        {allDay ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor={ids.date}>시작 날</Label>
              <Input id={ids.date} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={ids.endDate}>마지막 날</Label>
              <Input id={ids.endDate} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-11" required />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex flex-col gap-2">
              <Label htmlFor={ids.date}>날짜</Label>
              <Input id={ids.date} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={ids.start}>시작</Label>
              <Input id={ids.start} type="time" value={start} onChange={(e) => setStart(e.target.value)} className="h-11" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={ids.end}>종료</Label>
              <Input id={ids.end} type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="h-11" required />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor={ids.location}>장소 (선택)</Label>
          <Input id={ids.location} value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} placeholder="예: 3층 회의실" className="h-11" />
        </div>

        <div className="flex flex-col gap-2">
          <span id={ids.reminders} className="text-sm font-medium">
            알람
          </span>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby={ids.reminders}>
            {REMINDER_OPTIONS.map((o) => {
              const on = reminders.includes(o.minutes)
              return (
                <Button
                  key={o.minutes}
                  type="button"
                  variant={on ? 'default' : 'outline'}
                  aria-pressed={on}
                  className="h-9 px-3.5"
                  onClick={() => toggleReminder(o.minutes)}
                >
                  {o.label}
                </Button>
              )
            })}
          </div>
          <p className="text-[12px] leading-relaxed text-muted-foreground">말모아가 켜져 있으면 Mac 알림 센터와 열려 있는 말모아 화면에 알립니다. 여러 개를 고를 수 있습니다.</p>
        </div>

        {kind === 'meeting' && !allDay && (
          <div className="flex flex-col gap-2 p-3 w98-group">
            <div className="flex items-start gap-3">
              <Checkbox
                id={ids.autoRecord}
                checked={autoRecord}
                className="mt-0.5"
                onCheckedChange={(v) => {
                  // 처음 켤 때는 안내 문구에 동의를 받는다
                  if (v === true && !autoRecordConsent) setConsentOpen(true)
                  else setAutoRecord(v === true)
                }}
              />
              <Label htmlFor={ids.autoRecord} className="flex cursor-pointer flex-col items-start gap-0.5 font-normal">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Mic className="size-4 text-brand" aria-hidden /> 시작 시각에 자동으로 녹음
                </span>
                <span className="text-[12px] leading-relaxed text-muted-foreground">
                  말모아 탭이 열려 있고, 마이크가 ‘허용’이고, Mac이 깨어 있어야 녹음됩니다. 끝낼 때는 직접 종료를 눌러 주세요.
                </span>
              </Label>
            </div>
            {event?.autoRecord && event.autoRecordState !== 'none' && event.autoRecordState !== 'armed' && (
              <p className="text-[12px] text-muted-foreground">
                지난 결과: {AUTO_RECORD_LABEL[event.autoRecordState]}
                {event.autoRecordNote && ` · ${event.autoRecordNote}`}
              </p>
            )}
          </div>
        )}

        <AlertDialog open={consentOpen} onOpenChange={setConsentOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>자동 녹음을 쓰기 전에</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="flex flex-col gap-2 text-sm leading-relaxed">
                  <p>자동 녹음은 정해진 시간에 확인 없이 마이크 녹음을 시작합니다.</p>
                  <p>
                    <b className="font-medium text-foreground">본인이 참석하는 회의에만</b> 쓰고, 참석자에게 녹음한다는 사실을 알려 주세요. 본인이 참여하지 않는 대화를 녹음하는
                    것은 법(통신비밀보호법)에 어긋날 수 있습니다.
                  </p>
                  <p>녹음 파일은 이 Mac에만 저장되고 외부로 보내지 않습니다. 녹음 중에는 화면과 탭 제목에 ‘녹음 중’이 표시됩니다.</p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setAutoRecordConsent(true)
                  setAutoRecord(true)
                }}
              >
                이해했고 사용합니다
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {kind === 'meeting' && <AttendeePicker value={attendees} onChange={setAttendees} />}

        <div className="flex flex-col gap-2">
          <Label htmlFor={ids.memo}>메모 (선택)</Label>
          <Textarea id={ids.memo} value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={2000} rows={3} />
        </div>

        {error && (
          <Notice tone="error" icon={<AlertTriangle />}>
            {error}
          </Notice>
        )}
      </div>

      <SheetFooter className="flex-row items-center border-t">
        {event && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" className="h-11 text-muted-foreground hover:text-error-ink" disabled={busy}>
                <Trash2 /> 삭제
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>이 일정을 삭제할까요?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="flex flex-col gap-2 text-sm leading-relaxed">
                    <p className="font-medium break-all text-foreground">{event.title}</p>
                    <p>일정만 지웁니다. 되돌릴 수 없습니다.{event.jobId && ' 이 회의의 녹음과 회의록은 지워지지 않습니다.'}</p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => remove.mutate(event.id, { onSuccess: onDone, onError: (err) => setError(`삭제하지 못했습니다: ${err.message}`) })}
                >
                  삭제
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        <Button type="submit" className="ml-auto h-11 px-5" disabled={busy}>
          {save.isPending ? '저장 중…' : '저장'}
        </Button>
      </SheetFooter>
    </form>
  )
}

/** 일정 추가·수정 창. event가 없으면 day 날짜로 새 일정 */
export function EventEditor({ open, onOpenChange, event, day }: { open: boolean; onOpenChange: (open: boolean) => void; event: CalendarEvent | null; day: Date }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{event ? '일정 수정' : '일정 추가'}</SheetTitle>
          <SheetDescription>회의를 고르면 참석자를 함께 적을 수 있습니다.</SheetDescription>
        </SheetHeader>
        {/* 열 때마다 입력값을 새로 채운다 */}
        {open && <EventForm key={event?.id ?? toDateInput(day)} event={event} day={day} onDone={() => onOpenChange(false)} />}
      </SheetContent>
    </Sheet>
  )
}
