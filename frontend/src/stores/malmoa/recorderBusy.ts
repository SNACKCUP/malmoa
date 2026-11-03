'use client'

import { create } from 'zustand'

interface RecorderBusy {
  /** 녹음 중·일시정지·정리 중이거나, 끝낸 녹음을 아직 보내지 않았다 */
  busy: boolean
  setBusy: (busy: boolean) => void
}

/**
 * 녹음기가 쓰이는 중인지. RecorderProvider 가 적고 AppShell 이 읽는다.
 * 녹음 도중 로그인이 풀려도(토큰 갱신 실패·인터넷 끊김 등) 녹음기를 화면에서 빼지 않기 위해서다 — 빼면 녹음이 멈춘다.
 */
export const useRecorderBusy = create<RecorderBusy>()((set) => ({
  busy: false,
  setBusy: (busy) => set({ busy }),
}))
