'use client'

import { AlertTriangle, Check } from 'lucide-react'
import Link from 'next/link'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Checkbox } from '@/components/malmoa/ui/checkbox'
import { useHealth, useJob, useMinutes, useSaveTranscript, useTranscript } from '@/hooks/malmoa/queries'
import { downloadFile, minutesFilePath, originalFileUrl, transcriptTxtPath } from '@/lib/malmoa/api'
import { formatClock, formatDuration } from '@/lib/malmoa/format'
import type { Job, MinutesFormat, Transcript, TranscriptSegment } from '@/lib/malmoa/types'
import { cn } from '@/lib/utils'
import { Menu, OsWindow, StatusCell } from './app-shell'
import { JobAttendees } from './attendees'
import { Notice, ToneBadge } from './common'
import { CopyButton } from './copy-button'
import { MinutesPanel } from './minutes-panel'
import { PromptCopyDialog } from './prompt-copy-dialog'

const MINUTES_FORMATS: { format: MinutesFormat; label: string }[] = [
  { format: 'docx', label: 'Word' },
  { format: 'pdf', label: 'PDF' },
  { format: 'md', label: 'Markdown' },
  { format: 'txt', label: 'TXT' },
]
const LOW_CONFIDENCE = 0.4 // 사진 글자 인식 확신이 이보다 낮으면 '확인 필요'
const tool = 'flex h-7 items-center gap-1 px-2 text-[12px] whitespace-nowrap outline-none w98-out active:w98-pressed disabled:text-shade'

/** 화이트보드 원본 사진 (인증 헤더가 필요해 직접 받아 표시) */
function PhotoPreview({ id, name }: { id: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let made: string | null = null
    originalFileUrl(id)
      .then((u) => {
        made = u
        setUrl(u)
      })
      .catch(() => setFailed(true))
    return () => {
      if (made) URL.revokeObjectURL(made)
    }
  }, [id])
  if (failed) return <p className="text-[12px] text-[#464653]">사진을 불러오지 못했습니다.</p>
  if (!url) return <div className="aspect-[4/3] w-full animate-pulse bg-[#eeeeee]" aria-label="사진 불러오는 중" />
  return (
    <a href={url} target="_blank" rel="noopener" className="block bg-white p-1 w98-in" title="크게 보기">
      {/* eslint-disable-next-line @next/next/no-img-element -- 인증 후 받은 blob 주소라 next/image 최적화 대상이 아님 */}
      <img src={url} alt={`${name} 원본 사진`} className="max-h-[50vh] w-full object-contain" />
    </a>
  )
}

/** TXT 다운로드와 같은 형식: [00:12:34] 문장 */
function timedText(t: Transcript): string {
  return t.segments.map((s) => `[${formatClock(s.start * 1000)}] ${s.text}`).join('\n')
}

const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

/** 원본 음성 재생 + 원문 맞춰 보기. 음성은 처음 재생할 때 이 Mac 서버에서 받아 온다 */
function useAudioSync(job: Job) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const duration = job.durationSec ?? 0

  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url])

  const ensure = async (): Promise<HTMLAudioElement | null> => {
    if (audioRef.current && url) return audioRef.current
    setLoading(true)
    setError(null)
    try {
      const u = await originalFileUrl(job.id)
      const a = new Audio(u)
      a.playbackRate = rate
      a.ontimeupdate = () => setTime(a.currentTime)
      a.onplay = () => setPlaying(true)
      a.onpause = () => setPlaying(false)
      a.onended = () => setPlaying(false)
      audioRef.current = a
      setUrl(u)
      return a
    } catch (e) {
      setError(e instanceof Error ? e.message : '원본 음성을 불러오지 못했습니다.')
      return null
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => () => audioRef.current?.pause(), [])

  const toggle = async () => {
    const a = await ensure()
    if (!a) return
    if (a.paused) void a.play().catch(() => setError('재생하지 못했습니다.'))
    else a.pause()
  }
  const seek = async (sec: number, play = false) => {
    const a = await ensure()
    if (!a) return
    a.currentTime = Math.max(0, Math.min(sec, duration || sec))
    setTime(a.currentTime)
    if (play && a.paused) void a.play().catch(() => setError('재생하지 못했습니다.'))
  }
  const changeRate = (r: number) => {
    setRate(r)
    if (audioRef.current) audioRef.current.playbackRate = r
  }
  return { time, playing, loading, error, duration, rate, toggle, seek, changeRate }
}

/** 시간 버튼: 누르면 그 위치부터 재생 */
function TimeButton({ sec, onSeek }: { sec: number; onSeek: (sec: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSeek(sec)}
      title="이 위치부터 듣기"
      className="bg-[#eeeeee] px-1 font-mono text-[10px] font-bold text-[#000080] w98-in hover:bg-[#000080] hover:text-white"
    >
      [{formatClock(sec * 1000)}]
    </button>
  )
}

/** 원문 편집의 한 문장. 2시간 녹음은 문장이 수천 개라, 고친 줄만 다시 그리도록 memo */
const EditRow = memo(function EditRow({
  index,
  segment,
  value,
  showTime,
  current,
  onChange,
  onSeek,
}: {
  index: number
  segment: TranscriptSegment
  value: string
  showTime: boolean
  current: boolean
  onChange: (index: number, text: string) => void
  onSeek?: (sec: number) => void
}) {
  const changed = value !== segment.text
  return (
    <li className={cn('flex flex-col gap-0.5 px-1 py-0.5', current && 'bg-[#e0e0ff]')}>
      <span className="flex items-center gap-1.5">
        {showTime && onSeek && <TimeButton sec={segment.start} onSeek={onSeek} />}
        {changed && <span className="bg-[#000080] px-1 text-[10px] font-bold text-white">{value.trim() ? '고침' : '지움'}</span>}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(index, e.target.value)}
        rows={Math.max(1, Math.ceil(value.length / 48))}
        aria-label={`${index + 1}번째 문장`}
        spellCheck={false}
        className={cn(
          'w-full resize-none bg-white px-1.5 py-1 text-[13px] leading-relaxed outline-none w98-in field-sizing-content focus:bg-[#ffffe1]',
          changed && 'bg-[#f0f0ff]',
          !value.trim() && 'line-through',
        )}
      />
    </li>
  )
})

/** 왼쪽: Whisper 변환 원문 뷰어 (+ 오디오 재생 싱크) */
function TranscriptPane({ job, transcript }: { job: Job; transcript: Transcript }) {
  const [showTime, setShowTime] = useState(true)
  const timed = job.source !== 'image'
  const audio = useAudioSync(job)
  const save = useSaveTranscript(job.id)
  const [draft, setDraft] = useState<string[] | null>(null) // null이면 보기 모드
  const editing = draft !== null
  const busy = job.status === 'TRANSCRIBING' || job.status === 'SUMMARIZING'
  const changedCount = draft ? draft.filter((d, i) => d !== transcript.segments[i]?.text).length : 0
  const changeRow = useCallback((index: number, text: string) => setDraft((d) => d && d.map((x, i) => (i === index ? text : x))), [])
  // audio는 렌더마다 새 객체 → 문장 줄(memo)이 매번 다시 그려지지 않도록 바뀌지 않는 콜백으로 넘긴다
  const seekRef = useRef(audio.seek)
  useEffect(() => {
    seekRef.current = audio.seek
  })
  const seekPlay = useCallback((sec: number) => void seekRef.current(sec, true), [])
  // 지금 재생 중인 문장
  const currentIdx = audio.playing || audio.time > 0 ? transcript.segments.findLastIndex((s) => s.start <= audio.time) : -1
  const listRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    if (audio.playing && currentIdx >= 0) listRef.current?.children[currentIdx]?.scrollIntoView({ block: 'nearest' })
  }, [audio.playing, currentIdx])

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
        <h2 className="flex items-center gap-1.5 text-[14px] font-bold">
          <span aria-hidden>🎙️</span> {timed ? 'Whisper 변환 원문 뷰어' : '사진에서 읽은 글'}
          <span className="text-[10px] font-normal text-[#464653]">(총 {transcript.segments.length}개 {timed ? '발언 세그먼트' : '줄'})</span>
          {transcript.edited && <ToneBadge tone="primary">직접 수정됨</ToneBadge>}
          {save.isSuccess && !editing && (
            <span className="flex items-center gap-1 text-[11px] font-bold text-[#00a02a]">
              <Check className="size-3.5" /> 저장됨
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {timed && (
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px]">
              <Checkbox checked={showTime} onCheckedChange={(v) => setShowTime(v === true)} />
              타임스탬프 시간 표시 켜기
            </label>
          )}
          {!editing && transcript.segments.length > 0 && (
            <button
              type="button"
              className={cn(tool, 'font-bold')}
              disabled={busy}
              title={busy ? '변환이나 회의록 작성이 끝난 뒤에 고칠 수 있습니다' : '잘못 인식된 글자를 직접 고칩니다'}
              onClick={() => {
                save.reset()
                setDraft(transcript.segments.map((s) => s.text))
              }}
            >
              ✏️ 원문 편집
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-white p-2 w98-in">
        {!timed && (
          <div className="mb-3">
            <PhotoPreview id={job.id} name={job.fileName} />
          </div>
        )}
        {transcript.segments.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-[#464653]">
            {timed ? '인식된 말소리가 없습니다. 녹음에 대화가 없거나 소리가 너무 작았을 수 있습니다.' : '사진에서 글자를 찾지 못했습니다. 화이트보드를 정면에서, 빛 반사 없이 다시 찍어 보세요.'}
          </p>
        ) : draft ? (
          <ol ref={listRef} className="flex flex-col gap-1.5">
            {transcript.segments.map((s, i) => (
              <EditRow
                key={i}
                index={i}
                segment={s}
                value={draft[i] ?? ''}
                showTime={timed && showTime}
                current={i === currentIdx}
                onChange={changeRow}
                onSeek={timed ? seekPlay : undefined}
              />
            ))}
          </ol>
        ) : (
          <ol ref={listRef} className="flex flex-col gap-2">
            {transcript.segments.map((s, i) => {
              const unsure = s.confidence != null && s.confidence < LOW_CONFIDENCE
              return (
                <li key={i} className={cn('flex flex-col gap-0.5 px-1 py-0.5', unsure && 'bg-[#ffffe1]', i === currentIdx && 'bg-[#e0e0ff]')}>
                  {(timed && showTime) || unsure ? (
                    <span className="flex items-center gap-1.5">
                      {timed && showTime && <TimeButton sec={s.start} onSeek={seekPlay} />}
                      {unsure && <span className="bg-[#ffdad6] px-1 text-[10px] font-bold text-[#ba1a1a]">확인 요망</span>}
                    </span>
                  ) : null}
                  <span className="text-[13px] leading-relaxed">
                    {s.text}
                    {unsure && <mark className="ml-1 bg-[#ffff00] px-0.5 font-bold">[확인 필요]</mark>}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </div>

      {save.isError && (
        <Notice tone="error" icon={<AlertTriangle />}>
          원문을 저장하지 못했습니다. {save.error.message}
        </Notice>
      )}
      {draft && (
        <div className="flex flex-col gap-1 bg-[#ffffe1] p-1.5 text-[11px] w98-flat">
          <p className="leading-relaxed">
            문장 칸을 눌러 고치세요. 시간은 그대로 두고 글자만 바뀝니다. 칸을 비우면 그 문장은 지워집니다.
            {job.minutesReady && ' 이미 만든 회의록은 바뀌지 않으니, 고친 원문으로 다시 정리하려면 ‘AI 회의록 새로 만들기’를 누르세요.'}
          </p>
          <div className="flex flex-wrap items-center justify-between gap-1">
            <span className="font-bold">{changedCount ? `${changedCount}개 문장 고침` : '아직 고친 문장 없음'}</span>
            <div className="flex gap-1">
              <button type="button" className={tool} disabled={save.isPending} onClick={() => setDraft(null)}>
                취소
              </button>
              <button
                type="button"
                className={cn(tool, 'font-bold outline outline-1 -outline-offset-1 outline-black')}
                disabled={save.isPending || changedCount === 0 || busy}
                onClick={() => save.mutate(draft, { onSuccess: () => setDraft(null) })}
              >
                💾 {save.isPending ? '저장 중…' : '원문 저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {timed && (
        <div className="flex flex-col gap-1 bg-[#eeeeee] p-1.5 text-[11px] w98-out">
          <div className="flex items-center justify-between">
            <span className="font-mono font-bold">오디오 재생 싱크</span>
            <span className="font-mono font-bold tabular-nums">
              {mmss(audio.time)} / {mmss(audio.duration)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(audio.duration, 1)}
            step={0.5}
            value={Math.min(audio.time, audio.duration || audio.time)}
            onChange={(e) => void audio.seek(Number(e.target.value))}
            aria-label="재생 위치"
            className="h-3 w-full accent-[#000080]"
          />
          <div className="flex flex-wrap items-center justify-between gap-1">
            <div className="flex gap-1">
              <button type="button" className={tool} onClick={() => void audio.seek(audio.time - 5)} aria-label="5초 뒤로">
                ◂◂ 5s
              </button>
              <button type="button" className={cn(tool, 'font-bold')} onClick={() => void audio.toggle()} disabled={audio.loading}>
                {audio.loading ? '불러오는 중…' : audio.playing ? 'II 일시정지' : '▸ 재생'}
              </button>
              <button type="button" className={tool} onClick={() => void audio.seek(audio.time + 5)} aria-label="5초 앞으로">
                5s ▸▸
              </button>
            </div>
            <label className="flex items-center gap-1">
              배속
              <select value={audio.rate} onChange={(e) => audio.changeRate(Number(e.target.value))} className="h-6 bg-white px-1 text-[11px] w98-in">
                {[0.75, 1, 1.25, 1.5, 2].map((r) => (
                  <option key={r} value={r}>
                    {r.toFixed(r % 1 ? 2 : 1)}x
                  </option>
                ))}
              </select>
            </label>
          </div>
          {audio.error && <p className="text-[#ba1a1a]">{audio.error}</p>}
        </div>
      )}

      <div className="flex justify-between gap-2 px-1.5 py-0.5 font-mono text-[10px] w98-flat">
        <span>인코딩: UTF-8 (Korean)</span>
        <span>총 글자 수: {transcript.text.length.toLocaleString('ko-KR')}자</span>
      </div>
    </div>
  )
}

/** 회의록 뷰어 창 */
export function JobResult({ id }: { id: string }) {
  const job = useJob(id)
  const health = useHealth()
  const transcript = useTranscript(id, job.data?.transcriptReady ?? false)
  const minutes = useMinutes(id, (job.data?.minutesReady ?? false) && job.data?.status !== 'SUMMARIZING')
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const download = (path: string, name: string) => {
    setDownloadError(null)
    downloadFile(path, name).catch((e: Error) => setDownloadError(e.message))
  }

  const back = (
    <Link href="/jobs" className={tool}>
      ◂ 회의 작업 목록
    </Link>
  )

  const error = job.error ?? transcript.error
  if (error || !job.data || !transcript.data) {
    const notReady = job.data && !job.data.transcriptReady
    return (
      <OsWindow icon="📝" title="말모아 회의뷰어" width="max-w-lg">
        <div className="flex flex-col items-start gap-3 p-3 text-[13px]">
          {error ? (
            <Notice tone="error" icon={<AlertTriangle />}>
              <p className="font-bold">결과를 열 수 없습니다</p>
              <p>{error.message}</p>
            </Notice>
          ) : notReady ? (
            <p>
              <b>{job.data!.fileName}</b> — 아직 텍스트 변환이 끝나지 않았습니다. {job.data!.stage ?? '변환이 끝나면 이 화면에서 원문과 회의록을 볼 수 있습니다.'}
            </p>
          ) : (
            <p className="text-[#464653]">불러오는 중…</p>
          )}
          {(error || notReady) && back}
        </div>
      </OsWindow>
    )
  }

  const j = job.data
  const t = transcript.data
  const created = new Date(j.createdAt)
  const when = `${created.getFullYear()}년 ${created.getMonth() + 1}월 ${created.getDate()}일 ${String(created.getHours()).padStart(2, '0')}:${String(created.getMinutes()).padStart(2, '0')}`
  const lines = minutes.data ? minutes.data.markdown.split('\n').length : t.segments.length

  return (
    <OsWindow
      icon="📝"
      title={`말모아 회의뷰어 - ${j.fileName} [결과 보기]`}
      menu={
        <>
          <Menu label="파일" hot="F" items={[{ label: '회의 작업 목록', href: '/jobs' }]} />
          <Menu label="회의록" hot="M" items={[{ label: '참석자 명단 관리', href: '/settings#people' }]} />
          <Menu
            label="내보내기"
            hot="X"
            items={[
              { label: '변환 원문 TXT 받기', onSelect: () => download(transcriptTxtPath(j.id), '원문.txt') },
              ...(j.minutesReady
                ? [
                    ...MINUTES_FORMATS.map((f) => ({ label: `회의록 ${f.label} 받기`, onSelect: () => download(minutesFilePath(j.id, f.format), `회의록.${f.format}`) })),
                  ]
                : []),
            ]}
          />
          <Menu label="도움말" hot="H" items={[{ label: '정확도를 높이려면', href: '/guide#caution' }]} />
          <span className="ml-auto font-mono text-[10px] font-bold text-[#006a6a] uppercase">
            {j.source === 'image' ? 'OCR 판독' : `WHISPER-${health.data?.whisperModel ?? '--'}`} / KOR
          </span>
        </>
      }
      statusBar={
        <>
          <StatusCell className="font-mono text-[10px]">
            <span className={cn('size-2', j.status === 'FAILED' ? 'bg-[#ba1a1a]' : 'bg-[#00e639]')} aria-hidden />
            {j.status === 'SUMMARIZING' ? `회의록 작성 중 ${j.progress ?? 0}%` : j.status === 'FAILED' ? '처리 실패' : '준비 완료 (READY)'}
            {minutes.data && ` · 회의록 ${minutes.data.edited ? '직접 수정됨' : 'AI 작성'}`}
          </StatusCell>
          <StatusCell className="ml-auto font-mono text-[10px]">
            줄 {lines}, 글자 {t.text.length.toLocaleString('ko-KR')}
          </StatusCell>
          <StatusCell className="font-mono text-[10px] font-bold text-[#006a6a]">MALMOA-DOC-{j.id.slice(0, 6).toUpperCase()}</StatusCell>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        {/* 일시 · 참석자 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[#c6c5d5] px-1 pb-1.5 text-[12px]">
          <span className="flex items-center gap-1">
            <span aria-hidden>📅</span>
            <b>일시:</b> {when}
            {j.durationSec != null && ` (총 ${formatDuration(Math.round(j.durationSec))})`}
          </span>
          <div className="min-w-0 flex-1 text-[12px] [&_h2]:text-[12px] [&_h2]:font-bold [&_h2]:text-black">
            <JobAttendees job={j} />
          </div>
        </div>

        {/* 복사 · 내려받기 */}
        <div className="flex flex-wrap items-center justify-between gap-1">
          <div className="flex flex-wrap gap-1">
            <CopyButton variant="outline" size="sm" className="h-7 text-[12px]" text={() => t.text}>
              📋 텍스트만 복사
            </CopyButton>
            {j.source !== 'image' && (
              <CopyButton variant="outline" size="sm" className="h-7 text-[12px]" text={() => timedText(t)}>
                ⏱️ 시간 포함 복사
              </CopyButton>
            )}
            <PromptCopyDialog transcript={t} fileName={j.fileName} fromImage={j.source === 'image'} attendees={j.attendees} />
          </div>
          <div className="flex gap-1">
            <button type="button" className={tool} onClick={() => download(transcriptTxtPath(j.id), '원문.txt')}>
              💾 원문 TXT 받기
            </button>
            <button type="button" className={tool} disabled={!j.minutesReady} onClick={() => download(minutesFilePath(j.id, 'md'), '회의록.md')}>
              📄 Markdown 받기
            </button>
          </div>
        </div>
        {downloadError && (
          <Notice tone="error" icon={<AlertTriangle />}>
            {downloadError}
          </Notice>
        )}

        {/* 원문 | 회의록 */}
        <div className="grid min-h-[620px] gap-1.5 lg:h-[calc(100dvh-17rem)] lg:grid-cols-2">
          <div className="min-h-0 bg-face p-1 w98-out">
            <TranscriptPane job={j} transcript={t} />
          </div>
          <div className="min-h-0 bg-face p-1 w98-out">
            <MinutesPanel job={j} transcriptChars={t.text.length} />
          </div>
        </div>
      </div>
    </OsWindow>
  )
}
