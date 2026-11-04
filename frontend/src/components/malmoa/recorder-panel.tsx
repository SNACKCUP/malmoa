'use client'

import { AlertTriangle, CalendarClock, Download, Mic, Play, RotateCcw, Save, Users } from 'lucide-react'
import { useEffect, useId, useRef, useState, type RefObject, type SyntheticEvent } from 'react'
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
import { Checkbox } from '@/components/malmoa/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/malmoa/ui/select'
import { useHealth, useJobCreated } from '@/hooks/malmoa/queries'
import { CHUNK_INTERVAL_MS } from '@/hooks/malmoa/useRecorder'
import { uploadAndTranscribe } from '@/lib/malmoa/api'
import { fileStamp, formatBytes, formatClock, formatDuration } from '@/lib/malmoa/format'
import { cn } from '@/lib/utils'
import { useMeetingDraft } from '@/stores/malmoa/meetingDraft'
import { useRecorderPrefs } from '@/stores/malmoa/recorderPrefs'
import { Fieldset, Menu, OsWindow, StatusCell } from './app-shell'
import { AttendeePicker } from './attendees'
import { Notice } from './common'
import { useRecorderContext } from './recorder-context'
import { MiniCalendar } from './mini-calendar'
import { TranscribeProgress } from './transcribe-progress'
import { SourceUpload } from './upload-panel'

const DEFAULT_DEVICE = 'default'
const SENT_KEY = 'malmoa-recorder-sent-job'
const LEDS = 20
// 녹음 조작 단추: 시작·일시정지·재개·종료는 같은 큰 크기, 모니터링·저장·초기화는 작게
const BIG =
  'flex h-12 w-full items-center justify-center gap-1.5 px-2 text-[15px] font-bold whitespace-nowrap outline-none w98-out active:w98-pressed disabled:font-normal disabled:text-shade'
const SMALL = 'flex h-7 items-center gap-1 px-2 text-[11px] whitespace-nowrap outline-none w98-out active:w98-pressed disabled:text-shade'

/** MediaRecorder가 만든 webm은 길이 정보가 없어 재생바가 동작하지 않는다 — 끝으로 한 번 이동해 길이를 계산시킨다. */
function fixDuration(e: SyntheticEvent<HTMLAudioElement>) {
  const el = e.currentTarget
  if (el.duration !== Infinity) return
  const reset = () => {
    el.removeEventListener('timeupdate', reset)
    el.currentTime = 0
  }
  el.addEventListener('timeupdate', reset)
  el.currentTime = 1e101
}

/** 시:분:초.백분초 (경과 시간은 0.25초마다 갱신된다) */
const clockWithCs = (ms: number) => `${formatClock(ms)}.${String(Math.floor((ms % 1000) / 10)).padStart(2, '0')}`

/** 마이크 입력 파형 (브라우저 분석기의 실제 값). 녹음 중이 아니면 가운데 선만 */
function Oscilloscope({ analyser, active }: { analyser: RefObject<AnalyserNode | null>; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0
    const buf = new Float32Array(1024)
    const draw = () => {
      const { width, height } = canvas
      ctx.clearRect(0, 0, width, height)
      // 눈금
      ctx.strokeStyle = 'rgba(0, 230, 57, 0.12)'
      ctx.lineWidth = 1
      for (let x = 0; x <= width; x += width / 10) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
      }
      for (let y = 0; y <= height; y += height / 6) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }
      ctx.setLineDash([3, 3])
      ctx.strokeStyle = '#00530e'
      ctx.beginPath()
      ctx.moveTo(0, height / 2)
      ctx.lineTo(width, height / 2)
      ctx.stroke()
      ctx.setLineDash([])
      const node = analyser.current
      if (active && node) {
        node.getFloatTimeDomainData(buf)
        ctx.strokeStyle = '#00e639'
        ctx.lineWidth = 2
        ctx.beginPath()
        for (let i = 0; i < buf.length; i++) {
          const x = (i / (buf.length - 1)) * width
          // 작은 말소리도 보이게 4배로 키워 그린다
          const y = height / 2 - Math.max(-1, Math.min(1, buf[i] * 4)) * (height / 2 - 4)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [analyser, active])
  return <canvas ref={canvasRef} width={1000} height={240} className="h-full w-full" aria-hidden />
}

/** 90년대 LED 레벨 미터: 1–14 초록, 15–17 노랑, 18–20 빨강 */
function LedMeter({ level, active }: { level: number; active: boolean }) {
  const lit = active ? Math.round(level * LEDS) : 0
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-6 font-mono text-[10px] font-bold">IN</span>
      <div className="flex h-4 flex-1 gap-px bg-black p-0.5 w98-in" role="meter" aria-label="입력 레벨" aria-valuemin={0} aria-valuemax={LEDS} aria-valuenow={lit}>
        {Array.from({ length: LEDS }, (_, i) => {
          const on = i < lit
          const color = i < 14 ? (on ? 'bg-[#00ff41]' : 'bg-[#003b0f]') : i < 17 ? (on ? 'bg-[#ffff00]' : 'bg-[#3b3b00]') : on ? 'bg-[#ff0000]' : 'bg-[#3b0000]'
          return <span key={i} className={cn('h-full flex-1', color)} />
        })}
      </div>
    </div>
  )
}

/** 말모아 녹음기 창 (홈) */
export function RecorderPanel() {
  const rec = useRecorderContext()
  const health = useHealth()
  const onJobCreated = useJobCreated()
  const { deviceId, roomMode, setDeviceId, setRoomMode } = useRecorderPrefs()
  const draft = useMeetingDraft()
  const deviceSelectId = useId()
  const roomModeId = useId()
  const [sending, setSending] = useState<number | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  // 방금 보낸 녹음의 작업 ID: 화면을 옮겼다 돌아와도 진행 상황을 이어 보여 준다 (이 탭에서만)
  const [sentJob, setSentJobState] = useState<string | null>(() => {
    try {
      const id = sessionStorage.getItem(SENT_KEY)
      // 2026-11-02부터 작업 ID는 moa-<UUID>. 그 전에 저장된 예전 ID는 찾을 수 없으니 버린다
      return id?.startsWith('moa-') ? id : null
    } catch {
      return null
    }
  })
  const setSentJob = (id: string | null) => {
    setSentJobState(id)
    try {
      if (id) sessionStorage.setItem(SENT_KEY, id)
      else sessionStorage.removeItem(SENT_KEY)
    } catch {
      // 저장소를 못 쓰면 이 화면에서만 보여 준다
    }
  }
  const [monitor, setMonitor] = useState(false)

  const active = rec.status === 'recording' || rec.status === 'paused'
  const stopped = rec.status === 'stopped' && rec.result != null
  const unavailable = rec.error?.kind === 'unsupported' || rec.error?.kind === 'insecure'
  const lastSaved = rec.saved.at ? new Date(rec.saved.at).toLocaleTimeString('ko-KR', { hour12: false }) : null
  const baseName = rec.result ? `말모아_녹음_${fileStamp(new Date(rec.result.startedAt))}` : ''
  // 저장된 장치가 지금 연결되어 있지 않으면 기본 마이크로
  const selectedDevice = deviceId && rec.devices.some((d) => d.deviceId === deviceId) ? deviceId : DEFAULT_DEVICE
  const canStart = (rec.status === 'idle' || rec.status === 'requesting') && !unavailable && rec.status !== 'requesting'

  const start = () => {
    void rec.start({ deviceId: deviceId || undefined, roomMode })
  }

  // 단축키: Alt+R 시작, Alt+P 일시정지, Alt+C 재개, Alt+S 종료 (Mac은 Option)
  const keysRef = useRef({ canStart, status: rec.status, start, pause: rec.pause, resume: rec.resume, stop: rec.stop })
  useEffect(() => {
    keysRef.current = { canStart, status: rec.status, start, pause: rec.pause, resume: rec.resume, stop: rec.stop }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return
      const k = keysRef.current
      const act =
        e.code === 'KeyR' && k.canStart
          ? k.start
          : e.code === 'KeyP' && k.status === 'recording'
            ? k.pause
            : e.code === 'KeyC' && k.status === 'paused'
              ? k.resume
              : e.code === 'KeyS' && (k.status === 'recording' || k.status === 'paused')
                ? k.stop
                : null
      if (!act) return
      e.preventDefault()
      act()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 로컬 서버로 보내 변환을 시작한다. 서버가 받은 뒤에만 브라우저 보관본을 지운다.
  const sendToServer = async () => {
    if (!rec.result) return
    const name = `${baseName}.${rec.result.extension}`
    setSendError(null)
    setSentJob(null)
    setSending(0)
    try {
      const job = await uploadAndTranscribe(rec.result.blob, name, 'recording', setSending, draft.attendees, draft.event?.id)
      await rec.discard()
      draft.clear()
      setSentJob(job.id)
      setMonitor(false)
      onJobCreated(job)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : '녹음을 보내지 못했습니다.')
    } finally {
      setSending(null)
    }
  }

  const clockMs = stopped ? rec.result!.durationMs : active || rec.status === 'finalizing' ? rec.elapsedMs : 0
  const stateTitle =
    rec.status === 'recording'
      ? '녹음 진행 중...'
      : rec.status === 'paused'
        ? '일시정지'
        : rec.status === 'finalizing'
          ? '파일 정리 중...'
          : rec.status === 'stopped'
            ? '녹음 완료'
            : rec.status === 'requesting'
              ? '마이크 연결 중...'
              : '대기 중'
  const statusText =
    rec.status === 'recording'
      ? '입력 오디오 캡처 중'
      : rec.status === 'paused'
        ? '일시정지 · 이어서 녹음하려면 재개'
        : rec.status === 'finalizing'
          ? '녹음 파일을 정리하는 중'
          : rec.status === 'stopped'
            ? '녹음 완료 · 텍스트로 변환하세요'
            : unavailable
              ? '이 브라우저에서는 녹음할 수 없습니다'
              : '대기 중 (녹음 시작: Alt+R)'
  const model = health.data?.whisperModel

  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-2">
      {/* 위 알림 띠: 녹음 중이면 백그라운드 녹음 안내 (오늘 일정은 아래 작은 달력에) */}
      {active || rec.status === 'finalizing' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-face p-1 shadow-sm w98-out" role="status">
          <span className="flex items-center gap-2 pl-1 text-[11px] font-bold">
            <span className="relative flex size-4">
              {rec.status === 'recording' && <span className="absolute inline-flex size-full bg-[#ba1a1a] opacity-60 motion-safe:animate-ping" />}
              <span className={cn('relative inline-flex size-4', rec.status === 'recording' ? 'bg-[#ba1a1a]' : 'bg-[#c08000]')} />
            </span>
            백그라운드 녹음 활성화: 다른 화면으로 전환해도 녹음 및 10초 세이브가 중단 없이 지속됩니다.
          </span>
          <span className="flex items-center gap-2 pr-1 font-mono text-[11px]">
            {draft.event && <span className="font-bold text-[#006a6a]">일정: {draft.event.title}</span>}
            <span className="bg-[#000e01] px-1 text-[10px] font-bold text-[#00e639] w98-in">{rec.status === 'recording' ? 'LIVE_REC' : 'PAUSED'}</span>
          </span>
        </div>
      ) : null}

      <OsWindow
        icon="🎙️"
        title={`말모아 - 사운드 레코더 v1.0 [홈 › 녹음기] - [${stateTitle}]`}
        menu={
          <>
            <Menu
              label="파일"
              hot="F"
              items={[
                { label: '파일 업로드 & 변환', href: '/upload' },
                { label: '회의 작업 목록', href: '/jobs' },
              ]}
            />
            <Menu
              label="회의"
              hot="M"
              items={[
                { label: '오늘 일정 · 달력', href: '/calendar' },
                { label: '참석자 명단', href: '/settings#people' },
              ]}
            />
            <Menu label="옵션" hot="O" items={[{ label: '시스템 설정', href: '/settings' }]} />
            <Menu
              label="도움말"
              hot="H"
              items={[
                { label: '직접 녹음하기', href: '/guide#record' },
                { label: '녹음이 끊겼을 때', href: '/guide#recover' },
              ]}
            />
          </>
        }
        statusBar={
          <>
            <StatusCell className="flex-1 basis-60">
              <span className={cn('size-2 shrink-0', rec.status === 'recording' ? 'bg-[#00e639]' : rec.status === 'paused' ? 'bg-[#c08000]' : 'bg-[#808080]')} aria-hidden />
              상태: {statusText}
            </StatusCell>
            <StatusCell className="flex-1 basis-56 justify-center font-mono text-[10px] font-bold">
              {rec.sampleRate ? `${rec.sampleRate.toLocaleString('en-US')} Hz` : '-- Hz'} · {stopped ? rec.result!.mimeType.toUpperCase() : 'MIC INPUT'}
            </StatusCell>
            <StatusCell className="flex-1 basis-56 justify-end font-mono text-[10px] text-[#006a6a]">
              브라우저 보관: {rec.saved.chunks > 0 ? formatBytes(rec.saved.bytes) : stopped ? formatBytes(rec.result!.blob.size) : '0 B'}
            </StatusCell>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {rec.pending && rec.status === 'idle' && (
            <Notice
              tone="warning"
              icon={<RotateCcw />}
              action={
                <div className="flex gap-2">
                  <button type="button" className="h-6 px-2 text-[11px] outline outline-1 -outline-offset-1 outline-black w98-out active:w98-pressed" onClick={rec.recoverPending}>
                    불러오기
                  </button>
                  <button type="button" className="h-6 px-2 text-[11px] w98-out active:w98-pressed" onClick={rec.discardPending}>
                    삭제
                  </button>
                </div>
              }
            >
              <p className="font-bold">{rec.pending.status === 'recording' ? '이전 녹음이 중간에 종료되었습니다.' : '저장해 둔 녹음이 있습니다.'}</p>
              <p>
                {new Date(rec.pending.startedAt).toLocaleString('ko-KR')} 시작 · {formatDuration(Math.round(rec.pending.durationMs / 1000))} 분량 ·{' '}
                {formatBytes(rec.pending.sizeBytes)} 보존됨
              </p>
            </Notice>
          )}
          {rec.error && (
            <Notice tone="error" icon={<AlertTriangle />}>
              <p className="font-bold">{rec.error.message}</p>
              {rec.error.kind === 'denied' && (
                <p className="mt-1 text-black">
                  주소창 왼쪽의 사이트 설정에서 마이크를 ‘허용’으로 바꾸고, macOS <b>시스템 설정 › 개인정보 보호 및 보안 › 마이크</b>에서 사용 중인 브라우저가 켜져 있는지 확인해
                  주세요.
                </p>
              )}
              {rec.error.kind === 'unsupported' && <p className="mt-1 text-black">최신 Chrome, Edge, Safari에서 열거나, 녹음 앱으로 녹음한 뒤 파일 업로드를 이용해 주세요.</p>}
              {rec.error.kind === 'insecure' && <p className="mt-1 text-black">주소를 http://localhost 로 열어 주세요.</p>}
              {rec.error.kind === 'busy' && <p className="mt-1 text-black">Zoom, FaceTime 등 마이크를 쓰는 앱을 종료한 뒤 다시 시도해 주세요.</p>}
            </Notice>
          )}
          {draft.event && (active || rec.status === 'finalizing' || stopped) && (
            <Notice tone="primary" icon={<CalendarClock />}>
              <span className="font-bold">‘{draft.event.title}’ 자동 녹음</span> · 끝나면 종료를 누르세요. 텍스트로 변환하면 이 녹음이 일정에 연결됩니다.
            </Notice>
          )}
          {rec.warning && (
            <Notice tone="warning" icon={<AlertTriangle />}>
              {rec.warning}
            </Notice>
          )}

          {/* 파형 + 시간·레벨 */}
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_410px]">
            <div className="relative flex min-h-56 flex-col bg-[#000e01] p-1 font-mono text-[11px] text-[#00e639] w98-in">
              <div className="flex flex-wrap justify-between gap-2 px-1">
                <span className="flex items-center gap-1.5">
                  <span className={cn('size-2', active ? 'bg-[#00e639]' : 'bg-[#00530e]')} />
                  OSCILLOSCOPE WAVE: REALTIME INPUT
                </span>
                <span className="font-bold">SAMPLERATE: {rec.sampleRate ? `${rec.sampleRate.toLocaleString('en-US')}Hz` : '--'}</span>
              </div>
              <div className="min-h-0 flex-1">
                <Oscilloscope analyser={rec.analyser} active={rec.status === 'recording'} />
              </div>
              <div className="flex flex-wrap justify-between gap-2 px-1">
                <span>CHUNK INTERVAL: {CHUNK_INTERVAL_MS / 1000}s</span>
                <span>WINDOW SIZE: 1024 FRAMES</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 bg-[#eeeeee] p-2 w98-out">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-bold">
                  녹음 시간(<u>T</u>):
                </span>
                {rec.status === 'recording' ? (
                  <span className="flex items-center gap-1 font-mono font-bold text-[#ba1a1a]">
                    <span className="size-2 bg-[#ba1a1a] motion-safe:animate-pulse" /> REC ON AIR
                  </span>
                ) : rec.status === 'paused' ? (
                  <span className="font-mono font-bold text-[#c08000]">PAUSED</span>
                ) : (
                  <span className="font-mono text-[#808080]">STANDBY</span>
                )}
              </div>
              <p
                className="bg-[#000e01] py-1.5 text-center font-mono text-[34px] leading-none font-bold tracking-wider text-[#00e639] tabular-nums w98-in"
                aria-label={`녹음 시간 ${formatClock(clockMs)}`}
              >
                {clockWithCs(clockMs)}
              </p>
              <div className="flex justify-between pl-7 font-mono text-[9px] font-bold">
                <span>-60dB</span>
                <span>-40dB</span>
                <span>-20dB</span>
                <span>-9dB</span>
                <span className="text-[#ba1a1a]">PEAK</span>
              </div>
              <LedMeter level={rec.level} active={rec.status === 'recording'} />
              <p className={cn('flex items-start gap-1.5 p-1.5 text-[11px] w98-flat', rec.quiet ? 'bg-[#ffffe1]' : 'bg-[#f4f3f3]')} role={rec.quiet ? 'alert' : undefined}>
                <span aria-hidden>{rec.quiet ? '⚠️' : 'ℹ️'}</span>
                {rec.quiet ? (
                  <span>
                    <b>주의:</b> 입력 소리가 매우 작습니다. Mac을 화자들 가운데에 두고, 덮개를 연 채로 유지해 주세요.
                  </span>
                ) : active ? (
                  <span>입력 레벨이 정상입니다. 막대가 거의 움직이지 않으면 Mac을 화자 가까이 옮기세요.</span>
                ) : (
                  <span>녹음을 시작하면 마이크 입력 파형과 레벨이 표시됩니다.</span>
                )}
              </p>
            </div>
          </div>

          {/* 녹음 조작 단추 (위 파형 칸과 같은 폭) + 오른쪽은 텍스트로 변환 */}
          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_410px]">
            <div className="grid min-w-0 grid-cols-2 gap-1 bg-[#eeeeee] p-1 w98-out sm:grid-cols-4">
              <button type="button" disabled={!canStart} onClick={start} className={cn(BIG, 'outline outline-1 -outline-offset-1 outline-black disabled:outline-none')}>
                <span className="text-[18px] text-[#ba1a1a]">●</span> {rec.status === 'requesting' ? '연결 중…' : '녹음 시작'} (<u>R</u>)
              </button>
              <button type="button" disabled={rec.status !== 'recording'} onClick={rec.pause} className={BIG}>
                <span className="bg-[#c08000] px-0.5 text-[11px] text-white">II</span> 일시정지 (<u>P</u>)
              </button>
              <button type="button" disabled={rec.status !== 'paused'} onClick={rec.resume} className={BIG}>
                ▸ 재개 (<u>C</u>)
              </button>
              <button
                type="button"
                disabled={!active}
                onClick={rec.stop}
                className={cn(BIG, 'text-[#ba1a1a] outline outline-1 -outline-offset-1 outline-black disabled:outline-none')}
              >
                ■ 녹음 종료 (Alt+S)
              </button>
            </div>
            {/* 텍스트로 변환: 녹음 단추 오른쪽 (녹음을 마치면 다음 할 일) */}
            <button
              type="button"
              disabled={!stopped || sending != null}
              onClick={sendToServer}
              className="flex h-full min-h-14 w-full items-center justify-center gap-2 bg-[#000080] px-3 text-[17px] font-bold text-white outline outline-1 -outline-offset-1 outline-black shadow-[inset_1px_1px_#bfc2ff,inset_-1px_-1px_#000] active:shadow-[inset_1px_1px_#000,inset_-1px_-1px_#bfc2ff] disabled:bg-[#808080] disabled:text-[#dfdfdf]"
            >
              <span aria-hidden>🚀</span>
              {sending == null
                ? stopped
                  ? '텍스트로 변환 (Whisper AI 실행)'
                  : '텍스트로 변환 (녹음을 마치면)'
                : sending < 1
                  ? `서버로 보내는 중… ${Math.round(sending * 100)}%`
                  : '변환 요청 중…'}
            </button>
          </div>
        </div>

        {/* 아래: 왼쪽은 듣기·변환, 오른쪽은 작은 달력 (위 시간 칸과 같은 폭) */}
        <div className="grid items-start gap-2 lg:grid-cols-[minmax(0,1fr)_410px]">
          <div className="flex min-w-0 flex-col gap-2">
            {/* 녹음 결과: 듣기 · 파일 저장 · 초기화 */}
            <div className="flex flex-col gap-1.5 bg-[#f4f3f3] p-1.5 w98-out">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[11px] font-bold">녹음 결과:</span>
                  <button type="button" disabled={!stopped} aria-pressed={monitor} onClick={() => setMonitor((v) => !v)} className={cn(SMALL, monitor && 'w98-pressed')}>
                    <Play className="size-3" aria-hidden /> 녹음 듣기
                  </button>
                  {stopped ? (
                    <a href={rec.result!.url} download={`${baseName}.${rec.result!.extension}`} className={SMALL}>
                      <Download className="size-3" aria-hidden /> {rec.result!.extension.toUpperCase()} 파일 저장
                    </a>
                  ) : (
                    <button type="button" disabled className={SMALL}>
                      <Download className="size-3" aria-hidden /> 파일 저장
                    </button>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button type="button" disabled={!stopped || sending != null} className={SMALL}>
                        <RotateCcw className="size-3" aria-hidden /> 초기화
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>지금 녹음을 지우고 다시 녹음할까요?</AlertDialogTitle>
                        <AlertDialogDescription>파일로 저장하지 않은 녹음은 복구할 수 없습니다.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>취소</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => {
                            setMonitor(false)
                            void rec.discard()
                          }}
                        >
                          지우고 다시 녹음
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                <p className="text-[11px] text-[#464653]">🧠 {model ? `Whisper-${model}` : 'Whisper'}가 이 Mac에서 텍스트로 바꿉니다 · 음성은 외부로 보내지 않습니다</p>
              </div>
              {stopped && monitor && (
                <div className="flex flex-wrap items-center gap-2 bg-white p-1.5 w98-in">
                  <span className="font-mono text-[11px] font-bold">{baseName}</span>
                  <audio controls src={rec.result!.url} onLoadedMetadata={fixDuration} className="h-8 min-w-60 flex-1" preload="metadata">
                    녹음된 음성을 재생할 수 없는 브라우저입니다.
                  </audio>
                </div>
              )}
            </div>

            {/* 이미 녹음한 파일·화이트보드 사진: 올리면 아래 진행 상황·결과 문서에 이어서 보인다 */}
            <SourceUpload compact onUploaded={(job) => setSentJob(job.id)} />

            {sendError && (
              <Notice tone="error" icon={<AlertTriangle />}>
                {sendError} 녹음은 이 브라우저에 그대로 남아 있습니다.
              </Notice>
            )}

            <TranscribeProgress jobId={sentJob} sending={sending} onClose={() => setSentJob(null)} />

            {/* 도움말 상자 */}
            <div className="grid gap-3 bg-[#eeeeee] p-3 w98-out md:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {[
                ['단축키 안내', 'Alt+R(시작), Alt+P(일시정지), Alt+C(재개), Alt+S(종료)로 녹음을 제어합니다. Mac은 Option 키입니다.'],
                ['안전한 데이터 보존', `녹음 중 ${CHUNK_INTERVAL_MS / 1000}초마다 브라우저에 저장해, 창이 갑자기 닫혀도 저장된 구간까지 다음 실행 때 불러올 수 있습니다.`],
                ['참석자 기록', '참석자 태그를 붙여 두면 작업 목록·회의록에 함께 기록됩니다. 누가 말했는지 자동으로 구분하지는 않습니다.'],
              ].map(([t, d], i) => (
                <div key={t} className="flex gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center bg-white text-[12px] font-bold w98-in">{i + 1}</span>
                  <div>
                    <h3 className="font-heading text-[14px] font-bold">{t}</h3>
                    <p className="text-[12px] leading-snug text-[#464653]">{d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            {/* 10초 자동 저장 상태 */}
            <div className="flex flex-col justify-center gap-1 bg-white px-2 py-1 text-[11px] w98-in">
              <span className="flex min-w-0 items-center gap-1.5 font-mono font-bold text-[#006a6a]">
                <Save className="size-3.5 shrink-0 text-[#000080]" aria-hidden />
                <span className="truncate">
                  {rec.saved.chunks > 0 ? `${CHUNK_INTERVAL_MS / 1000}초 자동 저장 완료: [${lastSaved}]` : `브라우저 IndexedDB ${CHUNK_INTERVAL_MS / 1000}초 주기 자동 저장`}
                </span>
              </span>
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-[#464653]">비정상 종료 시 저장된 구간까지 복구</span>
                <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] font-bold">
                  <span className={cn('size-2', rec.saved.chunks > 0 ? 'bg-[#00e639]' : 'bg-[#808080]')} />
                  CHUNK: #{rec.saved.chunks} ({formatBytes(rec.saved.bytes)})
                </span>
              </span>

              {/* 녹음 및 회의 메타데이터 환경설정: 녹음이 먼저 보이도록 오른쪽 열 (작은 달력 위) */}
              <Fieldset title="녹음 및 회의 메타데이터 환경설정">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <label htmlFor={deviceSelectId} className="flex items-center gap-1 text-[11px] font-bold">
                      <Mic className="size-3.5 text-[#006a6a]" aria-hidden /> 입력 마이크 장치(<u>D</u>):
                    </label>
                    <Select value={selectedDevice} onValueChange={(v) => setDeviceId(v === DEFAULT_DEVICE ? '' : v)} disabled={unavailable || active}>
                      <SelectTrigger id={deviceSelectId} className="h-7! w-full text-[11px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DEFAULT_DEVICE}>시스템 기본 마이크</SelectItem>
                        {rec.devices.map((d, i) => (
                          <SelectItem key={d.deviceId} value={d.deviceId}>
                            {d.label || `마이크 ${i + 1}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <label htmlFor={roomModeId} className="flex cursor-pointer items-center gap-1.5 text-[11px] font-bold">
                      <Checkbox id={roomModeId} checked={roomMode} disabled={active} onCheckedChange={(v) => setRoomMode(v === true)} />
                      회의실 모드 (먼 목소리 보존 · 통화용 잡음 억제 끔)
                    </label>
                    <span className="pl-5 text-[10px] text-[#464653]">여러 사람이 떨어져 앉은 회의실·교실에서 켜 두세요</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="flex items-center gap-1 text-[11px] font-bold">
                      <Users className="size-3.5 text-[#000080]" aria-hidden /> 참석자 태그{draft.attendees.length > 0 && ` (${draft.attendees.length}명)`}:
                    </span>
                    <AttendeePicker compact value={draft.attendees} onChange={draft.setAttendees} />
                  </div>
                </div>
              </Fieldset>
              <MiniCalendar />
            </div>
          </div>
        </div>
      </OsWindow>
    </div>
  )
}
