'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { appendChunk, assembleSession, createSession, deleteSession, listSessions, updateSession, type RecordingSession } from '@/lib/malmoa/recordingStore'

/** 구간 저장 주기. 브라우저가 갑자기 종료되면 최대 이만큼만 잃는다. */
export const CHUNK_INTERVAL_MS = 10_000
/** Opus 32kbps 모노 ≈ 2시간에 약 29MB — 말소리에는 충분하고, 저장소 파일당 한도(Supabase 무료 50MB) 안에 들어간다 */
const AUDIO_BITS_PER_SECOND = 32_000
/** 녹음 시작 전에 확보되어 있어야 하는 브라우저 저장 공간 (2시간 분량 + 여유) */
const MIN_FREE_BYTES = 200 * 1024 ** 2
/** 입력 레벨이 이 값 아래로 QUIET_MS 동안 지속되면 "소리가 작다"고 안내 */
const QUIET_LEVEL = 0.18
const QUIET_MS = 15_000

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'paused' | 'finalizing' | 'stopped'

export type RecorderErrorKind = 'unsupported' | 'insecure' | 'denied' | 'notfound' | 'busy' | 'device-lost' | 'storage' | 'unknown'

export interface RecorderError {
  kind: RecorderErrorKind
  message: string
}

export interface RecordingResult {
  sessionId: string
  url: string
  blob: Blob
  mimeType: string
  extension: string
  durationMs: number
  startedAt: string
}

export interface RecorderOptions {
  deviceId?: string
  /** 교실·회의실처럼 마이크에서 떨어진 여러 화자를 녹음할 때 켠다. */
  roomMode: boolean
}

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm']

function pickMimeType(): string {
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
}

function extensionFor(mimeType: string): string {
  return mimeType.startsWith('audio/mp4') ? 'm4a' : 'webm'
}

export function isRecordingSupported(): boolean {
  return typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
}

function audioConstraints({ deviceId, roomMode }: RecorderOptions): MediaTrackConstraints {
  return {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    channelCount: 1,
    // 통화용 처리(에코 제거·잡음 억제)는 가까운 한 사람 목소리에 맞춰져 있어
    // 멀리 있는 화자의 말소리까지 깎아낼 수 있다. 회의실 모드에서는 끄고 음량 보정만 남긴다.
    echoCancellation: !roomMode,
    noiseSuppression: !roomMode,
    autoGainControl: true,
  }
}

function toRecorderError(err: unknown): RecorderError {
  const name = err instanceof DOMException ? err.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return { kind: 'denied', message: '마이크 사용 권한이 거부되었습니다.' }
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { kind: 'notfound', message: '사용할 수 있는 마이크를 찾지 못했습니다.' }
    case 'NotReadableError':
    case 'AbortError':
      return { kind: 'busy', message: '다른 앱이 마이크를 사용 중이거나 마이크를 열 수 없습니다.' }
    default:
      return { kind: 'unknown', message: '녹음을 시작하지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.' }
  }
}

export function useRecorder() {
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [error, setError] = useState<RecorderError | null>(() =>
    !isRecordingSupported()
      ? window.isSecureContext
        ? { kind: 'unsupported', message: '이 브라우저는 녹음 기능(MediaRecorder)을 지원하지 않습니다.' }
        : { kind: 'insecure', message: '보안 연결(https 또는 localhost)에서만 마이크를 사용할 수 있습니다.' }
      : null,
  )
  const [warning, setWarning] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [level, setLevel] = useState(0)
  const [quiet, setQuiet] = useState(false)
  const [saved, setSaved] = useState({ chunks: 0, bytes: 0, at: 0 })
  const [result, setResult] = useState<RecordingResult | null>(null)
  const [pending, setPending] = useState<RecordingSession | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sessionRef = useRef<{ id: string; startedAt: string; mimeType: string } | null>(null)
  const seqRef = useRef(0)
  const writeChain = useRef<Promise<void>>(Promise.resolve())
  const accumulatedMs = useRef(0)
  const segmentStart = useRef(0)
  const audioCtxRef = useRef<AudioContext | null>(null)
  // 파형 표시(오실로스코프)용: 화면이 직접 읽어 그린다
  const analyserRef = useRef<AnalyserNode | null>(null)
  const [sampleRate, setSampleRate] = useState<number | null>(null)
  const rafRef = useRef(0)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  const getElapsed = useCallback(() => {
    const running = recorderRef.current?.state === 'recording'
    return accumulatedMs.current + (running ? performance.now() - segmentStart.current : 0)
  }, [])

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const all = await navigator.mediaDevices.enumerateDevices()
    setDevices(all.filter((d) => d.kind === 'audioinput' && d.deviceId))
  }, [])

  // 이전 실행에서 남은 녹음(중단되었거나 아직 전송하지 않은 것)을 찾는다.
  useEffect(() => {
    if (!isRecordingSupported()) return
    void navigator.mediaDevices.enumerateDevices().then((all) => setDevices(all.filter((d) => d.kind === 'audioinput' && d.deviceId)))
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices)
    listSessions()
      .then(async (sessions) => {
        for (const s of sessions.filter((s) => s.chunkCount === 0)) await deleteSession(s.id)
        setPending(sessions.find((s) => s.chunkCount > 0) ?? null)
      })
      .catch(() => {})
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshDevices)
  }, [refreshDevices])

  // 경과 시간 표시
  useEffect(() => {
    if (status !== 'recording' && status !== 'paused') return
    const id = window.setInterval(() => setElapsedMs(getElapsed()), 250)
    return () => window.clearInterval(id)
  }, [status, getElapsed])

  // 녹음 중 페이지를 닫으려 하면 경고 (이미 저장된 구간은 남는다)
  useEffect(() => {
    if (status !== 'recording' && status !== 'paused') return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [status])

  // 화면 꺼짐(잠자기) 방지 — 탭이 다시 보일 때 재요청
  useEffect(() => {
    if (status !== 'recording' && status !== 'paused') return
    const acquire = async () => {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') {
          wakeLockRef.current = await navigator.wakeLock.request('screen')
        }
      } catch {
        /* 지원하지 않거나 거부됨 — 안내 문구로 대신한다 */
      }
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      document.removeEventListener('visibilitychange', acquire)
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }
  }, [status])

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    analyserRef.current = null
    setLevel(0)
    setQuiet(false)
  }, [])

  const startMeter = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(analyser)
    audioCtxRef.current = ctx
    analyserRef.current = analyser
    setSampleRate(ctx.sampleRate)
    // 자동 녹음처럼 사용자 동작 없이 시작하면 브라우저가 레벨 표시를 멈춰 둔다 (녹음 자체는 정상). 화면을 처음 누를 때 살린다
    if (ctx.state === 'suspended') document.addEventListener('pointerdown', () => void ctx.resume(), { once: true })
    const buf = new Float32Array(analyser.fftSize)
    let last = 0
    let quietSince: number | null = null
    const loop = (t: number) => {
      if (t - last > 80) {
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (const v of buf) sum += v * v
        const rms = Math.sqrt(sum / buf.length)
        // -60dB ~ 0dB 를 0~1로
        const value = Math.min(1, Math.max(0, (20 * Math.log10(rms || 1e-8) + 60) / 60))
        setLevel(value)
        if (value >= QUIET_LEVEL || recorderRef.current?.state !== 'recording') {
          quietSince = null
          setQuiet(false)
        } else if (quietSince == null) {
          quietSince = t
        } else if (t - quietSince > QUIET_MS) {
          setQuiet(true)
        }
        last = t
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [])

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    stopMeter()
  }, [stopMeter])

  const finalize = useCallback(async () => {
    const session = sessionRef.current
    if (!session) return
    setStatus('finalizing')
    releaseStream()
    try {
      await writeChain.current
      const durationMs = accumulatedMs.current
      await updateSession(session.id, { status: 'stopped', durationMs })
      const blob = await assembleSession(session.id)
      setResult({
        sessionId: session.id,
        url: URL.createObjectURL(blob),
        blob,
        mimeType: session.mimeType,
        extension: extensionFor(session.mimeType),
        durationMs,
        startedAt: session.startedAt,
      })
      setStatus('stopped')
    } catch {
      setError({ kind: 'storage', message: '녹음 파일을 정리하지 못했습니다. 저장된 구간은 다음 실행 때 복구할 수 있습니다.' })
      setStatus('idle')
    } finally {
      recorderRef.current = null
    }
  }, [releaseStream])

  const start = useCallback(
    /** 시작하면 null, 못 하면 그 이유 (화면에도 error로 보인다) */
    async (options: RecorderOptions): Promise<RecorderError | null> => {
      if (!isRecordingSupported()) return { kind: 'unsupported', message: '이 브라우저는 녹음 기능을 지원하지 않습니다.' }
      setError(null)
      setWarning(null)
      setStatus('requesting')

      try {
        const est = await navigator.storage?.estimate?.()
        if (est?.quota != null && est.usage != null && est.quota - est.usage < MIN_FREE_BYTES) {
          setWarning('브라우저 저장 공간이 부족해 긴 녹음이 끝까지 저장되지 않을 수 있습니다.')
        }
        await navigator.storage?.persist?.()
      } catch {
        /* 추정 실패는 무시 */
      }

      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(options) })
      } catch (err) {
        const e = toRecorderError(err)
        setError(e)
        setStatus('idle')
        return e
      }
      streamRef.current = stream
      refreshDevices() // 권한을 받은 뒤에야 장치 이름이 보인다

      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, {
        mimeType: mimeType || undefined,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      })
      const session = {
        id: crypto.randomUUID(),
        startedAt: new Date().toISOString(),
        mimeType: recorder.mimeType || mimeType || 'audio/webm',
      }
      try {
        await createSession({ ...session, status: 'recording', durationMs: 0, chunkCount: 0, sizeBytes: 0 })
      } catch (err) {
        releaseStream()
        const why = err instanceof DOMException ? ` (${err.name})` : ''
        const e: RecorderError = {
          kind: 'storage',
          message: `브라우저 저장소(IndexedDB)에 녹음을 기록할 수 없습니다${why}. 페이지를 새로고침한 뒤 다시 시도해 주세요. 시크릿 창이거나 저장 공간이 가득 차면 녹음을 보존할 수 없습니다.`,
        }
        setError(e)
        setStatus('idle')
        return e
      }

      sessionRef.current = session
      seqRef.current = 0
      accumulatedMs.current = 0
      writeChain.current = Promise.resolve()
      setSaved({ chunks: 0, bytes: 0, at: 0 })
      setElapsedMs(0)

      recorder.ondataavailable = (e) => {
        if (e.data.size === 0) return
        const seq = seqRef.current++
        const duration = getElapsed()
        const blob = e.data
        writeChain.current = writeChain.current
          .then(() => appendChunk(session.id, seq, blob, duration))
          .then(() => setSaved((s) => ({ chunks: s.chunks + 1, bytes: s.bytes + blob.size, at: Date.now() })))
          .catch(() => setWarning('일부 구간을 저장하지 못했습니다. 저장 공간을 확인해 주세요. 녹음은 계속됩니다.'))
      }
      recorder.onstop = () => void finalize()
      recorder.onerror = () => {
        setWarning('녹음 중 오류가 발생해 녹음을 종료했습니다. 저장된 구간까지는 보존됩니다.')
      }
      // 마이크가 분리되거나 시스템이 장치를 회수한 경우
      stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          if (recorderRef.current.state === 'recording') {
            accumulatedMs.current += performance.now() - segmentStart.current
          }
          setWarning('마이크 연결이 끊겨 녹음을 종료했습니다. 끊기기 전까지 녹음된 내용은 저장되었습니다.')
          recorderRef.current.stop()
        }
      })

      recorderRef.current = recorder
      segmentStart.current = performance.now()
      recorder.start(CHUNK_INTERVAL_MS)
      startMeter(stream)
      setStatus('recording')
      return null
    },
    [finalize, getElapsed, refreshDevices, releaseStream, startMeter],
  )

  const pause = useCallback(() => {
    const r = recorderRef.current
    if (r?.state !== 'recording') return
    accumulatedMs.current += performance.now() - segmentStart.current
    r.pause()
    r.requestData() // 일시정지 시점까지의 구간을 바로 디스크에 기록
    setElapsedMs(accumulatedMs.current)
    setStatus('paused')
  }, [])

  const resume = useCallback(() => {
    const r = recorderRef.current
    if (r?.state !== 'paused') return
    segmentStart.current = performance.now()
    r.resume()
    setStatus('recording')
  }, [])

  const stop = useCallback(() => {
    const r = recorderRef.current
    if (!r || r.state === 'inactive') return
    if (r.state === 'recording') accumulatedMs.current += performance.now() - segmentStart.current
    setElapsedMs(accumulatedMs.current)
    r.stop()
  }, [])

  /** 결과를 버리고 처음 상태로 (다시 녹음) */
  const discard = useCallback(async () => {
    if (result) {
      URL.revokeObjectURL(result.url)
      await deleteSession(result.sessionId).catch(() => {})
    }
    sessionRef.current = null
    setResult(null)
    setWarning(null)
    setElapsedMs(0)
    setSaved({ chunks: 0, bytes: 0, at: 0 })
    setStatus('idle')
  }, [result])

  /** 이전 실행에서 남은 녹음을 이어 붙여 결과로 불러온다. */
  const recoverPending = useCallback(async () => {
    if (!pending) return
    try {
      await updateSession(pending.id, { status: 'stopped' })
      const blob = await assembleSession(pending.id)
      sessionRef.current = { id: pending.id, startedAt: pending.startedAt, mimeType: pending.mimeType }
      accumulatedMs.current = pending.durationMs
      setElapsedMs(pending.durationMs)
      setResult({
        sessionId: pending.id,
        url: URL.createObjectURL(blob),
        blob,
        mimeType: pending.mimeType,
        extension: extensionFor(pending.mimeType),
        durationMs: pending.durationMs,
        startedAt: pending.startedAt,
      })
      setPending(null)
      setStatus('stopped')
    } catch {
      setError({ kind: 'storage', message: '저장된 녹음을 불러오지 못했습니다.' })
    }
  }, [pending])

  const discardPending = useCallback(async () => {
    if (!pending) return
    await deleteSession(pending.id).catch(() => {})
    setPending(null)
  }, [pending])

  // 언마운트 시 정리
  useEffect(
    () => () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
      releaseStream()
    },
    [releaseStream],
  )

  return {
    status,
    error,
    warning,
    elapsedMs,
    level,
    quiet,
    saved,
    result,
    pending,
    devices,
    analyser: analyserRef,
    sampleRate,
    start,
    pause,
    resume,
    stop,
    discard,
    recoverPending,
    discardPending,
    clearError: () => setError(null),
  }
}
