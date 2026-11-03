'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Attendee } from '@/lib/malmoa/types'

interface MeetingDraft {
  attendees: Attendee[]
  /** 이 녹음을 연결할 일정 (자동 녹음으로 시작했을 때). 서버로 보낼 때 함께 보내 일정에 연결한다 */
  event: { id: string; title: string } | null
  setAttendees: (attendees: Attendee[]) => void
  startFromEvent: (event: { id: string; title: string }, attendees: Attendee[]) => void
  clear: () => void
}

/**
 * 지금 녹음하는 회의의 참석자. 녹음을 서버로 보낼 때 함께 보내고 비운다.
 * 브라우저가 갑자기 닫혀도 녹음 복구와 함께 남아 있도록 localStorage에 둔다.
 */
export const useMeetingDraft = create<MeetingDraft>()(
  persist(
    (set) => ({
      attendees: [],
      event: null,
      setAttendees: (attendees) => set({ attendees }),
      startFromEvent: (event, attendees) => set({ event, attendees }),
      clear: () => set({ attendees: [], event: null }),
    }),
    { name: 'malmoa-meeting-draft', storage: createJSONStorage(() => localStorage) },
  ),
)
