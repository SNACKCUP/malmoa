'use client'

import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { listFiredReminders } from '@/lib/malmoa/api'

const POLL_MS = 30_000

/** 울린 일정 알람을 화면 위쪽에 띄운다. 화면을 연 뒤에 울린 것만 (지난 알람을 다시 띄우지 않음) */
export function ReminderToasts() {
  const router = useRouter()
  const since = useRef(new Date())
  const shown = useRef(new Set<string>())
  const fired = useQuery({
    queryKey: ['events', 'reminders'],
    queryFn: () => listFiredReminders(since.current),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
  })

  useEffect(() => {
    for (const r of fired.data ?? []) {
      const key = `${r.eventId}:${r.minutesBefore}`
      if (shown.current.has(key)) continue
      shown.current.add(key)
      if (new Date(r.sentAt) > since.current) since.current = new Date(r.sentAt)
      toast(r.message, {
        id: key,
        description: '말모아 일정 알람',
        duration: 5 * 60_000,
        closeButton: true,
        action: { label: '캘린더', onClick: () => router.push('/calendar') },
      })
    }
  }, [fired.data, router])

  return null
}
