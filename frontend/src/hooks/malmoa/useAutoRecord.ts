'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { keys } from '@/hooks/malmoa/queries'
import type { useRecorder } from '@/hooks/malmoa/useRecorder'
import { listEvents, reportAutoRecord, sendHeartbeat } from '@/lib/malmoa/api'
import type { CalendarEvent } from '@/lib/malmoa/types'
import { useMeetingDraft } from '@/stores/malmoa/meetingDraft'
import { useRecorderPrefs } from '@/stores/malmoa/recorderPrefs'

type Recorder = ReturnType<typeof useRecorder>

const POLL_MS = 15_000
const HEARTBEAT_MS = 30_000
const NOTICE_MS = 60_000 // 시작 1분 전부터 '취소' 배너
const GRACE_MS = 10 * 60_000 // 서버의 auto_record.GRACE 와 같게: 시작 시각이 이만큼 지나도 늦게라도 시작
const LOCK = 'malmoa-auto-record'
const RECORDING_LOCK = 'malmoa-recording' // 녹음 중인 탭이 잡고 있다 (다른 탭의 녹음도 알 수 있게)

type MicPermission = 'granted' | 'prompt' | 'denied' | 'unknown'

/**
 * 잠금을 잡고 있다가, 돌려준 함수를 부르면 놓는다 (기다리는 중이면 기다리기를 취소).
 * 개발 모드(StrictMode)처럼 effect 를 곧바로 정리했는데 잠금이 늦게 승인되면 바로 놓는다 —
 * 그러지 않으면 아무도 놓지 않는 잠금이 남아 다른 탭과 다시 그린 화면이 영영 기다린다.
 */
function holdLock(name: string, onAcquired?: () => void): () => void {
  const ac = new AbortController()
  let alive = true
  let release: (() => void) | undefined
  navigator.locks
    .request(name, { signal: ac.signal }, () => {
      if (!alive) return
      onAcquired?.()
      return new Promise<void>((resolve) => (release = resolve))
    })
    .catch(() => {}) // 기다리기를 취소함
  return () => {
    alive = false
    ac.abort()
    release?.()
  }
}

/** 이 탭이든 다른 탭이든 지금 녹음 중인가 (녹음 중인 탭이 잡거나 기다리는 잠금) */
async function recordingSomewhere(): Promise<boolean> {
  try {
    const q = await navigator.locks?.query()
    return [...(q?.held ?? []), ...(q?.pending ?? [])].some((l) => l.name === RECORDING_LOCK)
  } catch {
    return false
  }
}

async function micPermission(): Promise<MicPermission> {
  try {
    return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state
  } catch {
    return 'unknown'
  }
}

/**
 * 시간이 되면 자동 녹음 (docs/2026-10-29-일정·알람·자동녹음.md 3장). RecorderProvider 에 한 번 둔다.
 *
 * - 탭이 여러 개면 navigator.locks 로 한 탭만 맡는다 (맡은 탭을 닫으면 다음 탭이 이어받음).
 * - 맡은 탭은 30초마다 서버에 생존 신호·마이크 권한을 보내 서버가 미리 경고할 수 있게 한다.
 * - 15초마다(그리고 시작 시각에 맞춰) 대기 중인 일정을 보고, 시각이 되면 기존 녹음기로 시작한다.
 * - 시작하면 홈(녹음 칸)으로 옮긴다. 끝내기는 자동으로 하지 않는다. 사용자가 종료하고 보내면 녹음이 일정에 연결된다.
 */
export function useAutoRecord(rec: Recorder) {
  const qc = useQueryClient()
  const router = useRouter()
  const [leader, setLeader] = useState(false)
  const [upcoming, setUpcoming] = useState<CalendarEvent | null>(null)
  const recRef = useRef(rec)
  const handled = useRef(new Set<string>())

  useEffect(() => {
    recRef.current = rec
  })

  // 담당 탭 고르기 (맡은 탭을 닫으면 기다리던 다음 탭이 이어받는다)
  useEffect(() => {
    if (!navigator.locks) {
      // 잠금을 지원하지 않는 브라우저: 이 탭이 맡는다
      void Promise.resolve().then(() => setLeader(true))
      return
    }
    const stop = holdLock(LOCK, () => setLeader(true))
    return () => {
      stop()
      setLeader(false)
    }
  }, [])

  // 녹음 중에는 잠금을 잡아 다른 탭의 자동 녹음이 겹치지 않게 한다
  const active = rec.status === 'recording' || rec.status === 'paused' || rec.status === 'finalizing'
  useEffect(() => {
    if (!active || !navigator.locks) return
    return holdLock(RECORDING_LOCK)
  }, [active])

  // 생존 신호
  useEffect(() => {
    if (!leader) return
    const beat = async () => sendHeartbeat(await micPermission()).catch(() => {})
    void beat()
    const id = window.setInterval(beat, HEARTBEAT_MS)
    return () => window.clearInterval(id)
  }, [leader])

  const report = useCallback(
    async (ev: CalendarEvent, state: 'started' | 'skipped' | 'failed', note?: string) => {
      await reportAutoRecord(ev.id, state, note).catch(() => {}) // 다른 탭이 먼저 처리했으면 409 — 무시
      void qc.invalidateQueries({ queryKey: keys.events })
    },
    [qc],
  )

  const begin = useCallback(
    async (ev: CalendarEvent) => {
      const r = recRef.current
      if (r.status === 'recording' || r.status === 'paused' || r.status === 'requesting' || r.status === 'finalizing' || (await recordingSomewhere())) {
        toast.warning(`‘${ev.title}’ 자동 녹음을 건너뛰었습니다`, { description: '이미 다른 녹음이 진행 중입니다.', duration: 5 * 60_000 })
        return report(ev, 'skipped', '이미 다른 녹음이 진행 중이었습니다.')
      }
      if (r.status === 'stopped') {
        toast.warning(`‘${ev.title}’ 자동 녹음을 건너뛰었습니다`, { description: '서버로 보내지 않은 녹음이 있습니다. 먼저 보내거나 지워 주세요.', duration: 5 * 60_000 })
        return report(ev, 'skipped', '서버로 보내지 않은 녹음이 있어 시작하지 않았습니다.')
      }
      const { deviceId, roomMode } = useRecorderPrefs.getState()
      useMeetingDraft.getState().startFromEvent({ id: ev.id, title: ev.title }, ev.attendees)
      const err = await r.start({ deviceId: deviceId || undefined, roomMode })
      if (err) {
        useMeetingDraft.getState().clear()
        toast.error(`‘${ev.title}’ 자동 녹음을 시작하지 못했습니다`, { description: err.message, duration: 5 * 60_000 })
        return report(ev, 'failed', err.message)
      }
      toast.success(`‘${ev.title}’ 자동 녹음을 시작했습니다`, { description: '회의가 끝나면 종료를 누르고 텍스트로 변환해 주세요.', duration: 5 * 60_000 })
      // 녹음 칸이 보이도록 홈으로
      if (window.location.pathname !== '/') router.push('/')
      return report(ev, 'started')
    },
    [report, router],
  )

  // 일정 확인
  useEffect(() => {
    if (!leader) return
    let busy = false
    let timer = 0
    const check = async () => {
      if (busy) return
      busy = true
      try {
        const now = Date.now()
        const events = await listEvents(new Date(now - GRACE_MS), new Date(now + 2 * 60_000))
        const armed = events
          .filter((e) => e.autoRecord && e.autoRecordState === 'armed' && !handled.current.has(e.id))
          .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
        const next = armed.find((e) => Date.parse(e.startsAt) > now && Date.parse(e.startsAt) - now <= NOTICE_MS) ?? null
        setUpcoming(next)
        window.clearTimeout(timer)
        if (next) timer = window.setTimeout(() => void check(), Date.parse(next.startsAt) - now + 300)
        for (const ev of armed.filter((e) => Date.parse(e.startsAt) <= now && now - Date.parse(e.startsAt) <= GRACE_MS)) {
          handled.current.add(ev.id)
          await begin(ev)
        }
      } catch {
        /* 서버가 꺼져 있으면 다음 확인 때 다시 */
      } finally {
        busy = false
      }
    }
    void check()
    const id = window.setInterval(() => void check(), POLL_MS)
    return () => {
      window.clearInterval(id)
      window.clearTimeout(timer)
    }
  }, [leader, begin])

  /** 1분 전 배너의 '취소' */
  const cancel = useCallback(
    (ev: CalendarEvent) => {
      handled.current.add(ev.id)
      setUpcoming(null)
      void report(ev, 'skipped', '시작 전에 취소했습니다.')
    },
    [report],
  )

  return { upcoming, cancel }
}
