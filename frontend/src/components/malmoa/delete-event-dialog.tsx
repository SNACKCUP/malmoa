'use client'

import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/malmoa/ui/alert-dialog'
import { useDeleteEvent } from '@/hooks/malmoa/queries'
import { formatTime } from '@/lib/malmoa/calendar'
import type { CalendarEvent } from '@/lib/malmoa/types'

/** 일정 삭제 확인 창 (홈 오늘 일정의 🗑, 캘린더 목록의 ✕). 일정만 지우고 연결된 녹음·회의록은 남긴다 */
export function DeleteEventDialog({ event, onClose }: { event: CalendarEvent | null; onClose: () => void }) {
  const remove = useDeleteEvent()
  return (
    <AlertDialog open={event != null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>이 일정을 삭제할까요?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2 text-sm leading-relaxed">
              <p className="font-medium break-all text-foreground">{event && `${event.allDay ? '종일' : formatTime(event.startsAt)} ${event.title}`}</p>
              <p>일정만 지웁니다. 되돌릴 수 없습니다.{event?.jobId && ' 이 회의의 녹음과 회의록은 지워지지 않습니다.'}</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              const ev = event
              if (!ev) return
              remove.mutate(ev.id, {
                onSuccess: () => toast.success(`‘${ev.title}’ 일정을 삭제했습니다`),
                onError: (err) => toast.error(`삭제하지 못했습니다: ${err.message}`),
              })
            }}
          >
            삭제
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
