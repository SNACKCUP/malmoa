import type { ReactNode } from 'react'
import { Alert, AlertDescription } from '@/components/malmoa/ui/alert'
import { Badge } from '@/components/malmoa/ui/badge'
import type { JobStatus } from '@/lib/malmoa/types'
import { cn } from '@/lib/utils'

// 로고의 막대 [x, 위, 아래] — lucide AudioLines 와 같은 모양을 직접 그려 막대마다 움직일 수 있게 한다
const BARS = [
  [2, 10, 13],
  [6, 6, 17],
  [10, 3, 21],
  [14, 8, 15],
  [18, 5, 18],
  [22, 10, 13],
] as const

/** 서비스 이름. recording 이면 로고 막대가 소리에 맞춰 움직이듯 오르내린다 (동작 줄이기 설정이면 멈춤) */
export function Brand({ recording = false, compact = false }: { recording?: boolean; compact?: boolean }) {
  return (
    <span className={cn('flex items-center', compact ? 'gap-1' : 'gap-2')} title={recording ? '녹음 중' : undefined}>
      <span className="flex items-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="butt" shapeRendering="crispEdges" className={cn(compact ? 'size-3.5' : 'size-5', recording && 'text-[#b00000]')} aria-hidden>
          {BARS.map(([x, y1, y2], i) => (
            <line key={x} x1={x} x2={x} y1={y1} y2={y2} className={cn(recording && 'malmoa-eq')} style={recording ? { animationDelay: `${-i * 0.17}s` } : undefined} />
          ))}
        </svg>
      </span>
      <span className={compact ? 'text-[11px] font-bold' : 'text-lg font-bold'}>말모아</span>
      {recording && <span className="sr-only">녹음 중</span>}
    </span>
  )
}

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'error'

const toneClass: Record<Tone, string> = {
  neutral: 'bg-light text-black',
  primary: 'bg-[#008080] text-white',
  success: 'bg-[#000080] text-white',
  warning: 'bg-[#ffffa0] text-black',
  error: 'bg-[#c00000] text-white',
}
// 안내 상자 색: 98 풍선 도움말(노랑)을 바탕으로, 오류만 붉은 글자
const noticeClass: Record<Tone, string> = {
  neutral: 'bg-white text-black',
  primary: 'bg-[#ffffe1] text-black',
  success: 'bg-[#ffffe1] text-black',
  warning: 'bg-[#ffffe1] text-black',
  error: 'bg-[#ffffe1] text-[#b00000]',
}

export function ToneBadge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <Badge variant="outline" className={cn('h-5 px-2 text-sm', toneClass[tone])}>
      {children}
    </Badge>
  )
}

const statusMap: Record<JobStatus, { tone: Tone; label: string }> = {
  QUEUED: { tone: 'neutral', label: '대기 중' },
  TRANSCRIBING: { tone: 'primary', label: '음성 변환 중' },
  SUMMARIZING: { tone: 'primary', label: '회의록 작성 중' },
  COMPLETED: { tone: 'success', label: '완료' },
  FAILED: { tone: 'error', label: '실패' },
}

export function StatusBadge({ status, progress, label }: { status: JobStatus; progress?: number | null; label?: string }) {
  const s = statusMap[status]
  const text = label ?? s.label
  return <ToneBadge tone={s.tone}>{progress != null && status !== 'QUEUED' ? `${text} ${progress}%` : text}</ToneBadge>
}

/** 안내·경고·오류 상자 (shadcn Alert에 말모아 색을 입힘) */
export function Notice({ tone = 'neutral', icon, children, action, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <Alert role={tone === 'error' ? 'alert' : 'status'} className={cn('flex flex-wrap items-start gap-3 border-0 px-3 py-3 w98-flat', noticeClass[tone], className)}>
      {icon && <span className="mt-0.5 shrink-0 [&_svg]:size-4.5">{icon}</span>}
      <AlertDescription className="min-w-0 flex-1 basis-56 text-sm leading-relaxed text-current">{children}</AlertDescription>
      {action}
    </Alert>
  )
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center w98-in bg-white text-black [&_svg]:size-6">{icon}</span>
      <div>
        <p className="font-pixel text-[16px]">{title}</p>
        {description && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

export function PageHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-pixel text-3xl w98-desk-text">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm w98-desk-text">{description}</p>}
      </div>
      {action}
    </header>
  )
}
