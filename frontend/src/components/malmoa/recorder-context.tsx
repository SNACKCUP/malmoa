'use client'

import { CalendarClock, Pause, Play } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { Button } from '@/components/malmoa/ui/button'
import { useAutoRecord } from '@/hooks/malmoa/useAutoRecord'
import { useRecorder } from '@/hooks/malmoa/useRecorder'
import { useRecorderBusy } from '@/stores/malmoa/recorderBusy'
import { formatTime } from '@/lib/malmoa/calendar'
import { formatClock } from '@/lib/malmoa/format'
import { cn } from '@/lib/utils'

type Recorder = ReturnType<typeof useRecorder>

const RecorderContext = createContext<Recorder | null>(null)

/**
 * 녹음기를 앱 틀(AppShell)에 둔다. 홈의 녹음 칸이 아니라 여기서 녹음이 돌아가므로
 * 결과 보기·작업 목록 등 다른 화면으로 옮겨도 녹음이 끊기지 않는다.
 */
export function RecorderProvider({ children }: { children: ReactNode }) {
  const rec = useRecorder()
  const auto = useAutoRecord(rec)
  useRecordingTitle(rec.status === 'recording' || rec.status === 'paused')
  useReportBusy(rec.status !== 'idle')
  return (
    <RecorderContext.Provider value={rec}>
      {children}
      <RecordingDock rec={rec} />
      {auto.upcoming && (
        <div
          role="status"
          className="fixed top-4 left-1/2 z-50 flex w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 flex-wrap items-center gap-3 w98-out px-4 py-3 shadow-[2px_2px_0_0_rgba(0,0,0,0.5)]"
        >
          <CalendarClock className="size-5 shrink-0 text-brand" aria-hidden />
          <span className="flex-1 basis-56 text-sm">
            <b className="font-semibold">{formatTime(auto.upcoming.startsAt)}</b> ‘{auto.upcoming.title}’ 자동 녹음을 곧 시작합니다
          </span>
          <Button variant="outline" size="sm" className="h-9" onClick={() => auto.upcoming && auto.cancel(auto.upcoming)}>
            이번만 취소
          </Button>
        </div>
      )}
    </RecorderContext.Provider>
  )
}

/** 녹음기가 쓰이는 중인지 AppShell 에 알린다 (그동안은 로그인이 풀려도 녹음기를 화면에서 빼지 않는다) */
function useReportBusy(busy: boolean) {
  useEffect(() => {
    useRecorderBusy.getState().setBusy(busy)
  }, [busy])
  useEffect(() => () => useRecorderBusy.getState().setBusy(false), [])
}

const RECORDING_PREFIX = '● 녹음 중 · '

/** 녹음 중이면 탭 제목 앞에 표시한다 (다른 탭에서 볼 때도 녹음 중임을 숨기지 않게). 화면을 옮겨 제목이 바뀌어도 다시 붙인다 */
function useRecordingTitle(active: boolean) {
  useEffect(() => {
    if (!active) return
    const mark = () => {
      if (!document.title.startsWith(RECORDING_PREFIX)) document.title = RECORDING_PREFIX + document.title
    }
    mark()
    const id = window.setInterval(mark, 1000)
    return () => {
      window.clearInterval(id)
      document.title = document.title.replace(RECORDING_PREFIX, '')
    }
  }, [active])
}

export function useRecorderContext(): Recorder {
  const rec = useContext(RecorderContext)
  if (!rec) throw new Error('RecorderProvider 안에서만 쓸 수 있습니다.')
  return rec
}

/** 홈이 아닌 화면에서 녹음 중일 때 오른쪽 아래에 떠 있는 작은 녹음 막대 */
function RecordingDock({ rec }: { rec: Recorder }) {
  const pathname = usePathname()
  const active = rec.status === 'recording' || rec.status === 'paused'
  if (!active || pathname === '/') return null
  const recording = rec.status === 'recording'

  return (
    <div
      role="region"
      aria-label="녹음 상태"
      className="fixed right-4 bottom-4 z-40 flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-3 w98-out px-4 py-3 shadow-[2px_2px_0_0_rgba(0,0,0,0.5)]"
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <span className={cn('size-2.5', recording ? 'bg-error motion-safe:animate-pulse' : 'bg-warning')} aria-hidden />
        {recording ? '녹음 중' : '일시정지'}
        <span className="font-mono tabular-nums">{formatClock(rec.elapsedMs)}</span>
      </span>
      {recording ? (
        <Button variant="outline" size="sm" className="h-9" onClick={rec.pause}>
          <Pause /> 일시정지
        </Button>
      ) : (
        <Button variant="outline" size="sm" className="h-9" onClick={rec.resume}>
          <Play /> 재개
        </Button>
      )}
      <Button size="sm" className="h-9" asChild>
        <Link href="/">녹음 화면으로</Link>
      </Button>
    </div>
  )
}
