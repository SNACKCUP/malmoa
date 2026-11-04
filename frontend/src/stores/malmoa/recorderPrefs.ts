'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

interface RecorderPrefs {
  deviceId: string
  roomMode: boolean
  /** 자동 녹음 안내 문구(본인 참석 회의만·참석자에게 알림)에 동의함 */
  autoRecordConsent: boolean
  setDeviceId: (deviceId: string) => void
  setRoomMode: (roomMode: boolean) => void
  setAutoRecordConsent: (v: boolean) => void
}

/** 녹음 설정(마이크, 회의실 모드, 자동 녹음 동의)을 다음 회의에도 그대로 쓰도록 기억한다. */
export const useRecorderPrefs = create<RecorderPrefs>()(
  persist(
    (set) => ({
      deviceId: '',
      roomMode: true,
      autoRecordConsent: false,
      setDeviceId: (deviceId) => set({ deviceId }),
      setRoomMode: (roomMode) => set({ roomMode }),
      setAutoRecordConsent: (autoRecordConsent) => set({ autoRecordConsent }),
    }),
    { name: 'malmoa-recorder', storage: createJSONStorage(() => localStorage) },
  ),
)
