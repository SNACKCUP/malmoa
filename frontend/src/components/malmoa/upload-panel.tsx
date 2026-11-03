'use client'

import { AlertTriangle, CheckCircle2, CircleCheck, CircleDashed, CloudUpload, FileAudio, FolderOpen, ImageIcon, Lock, ScanText, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, type DragEvent } from 'react'
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
import { isActive, useDeleteJob, useHealth, useJobCreated, useJobs, useLlmSettings, useStartTranscribe, useTranscript } from '@/hooks/malmoa/queries'
import { uploadAndTranscribe } from '@/lib/malmoa/api'
import { formatBytes } from '@/lib/malmoa/format'
import type { Job } from '@/lib/malmoa/types'
import { cn } from '@/lib/utils'
import { Fieldset, Menu, OsWindow, StatusCell } from './app-shell'
import { Notice } from './common'

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'webm', 'mp4', 'ogg']
// 화이트보드 사진: 서버에서 글자를 읽어 텍스트로 바꾼다
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp']
const ACCEPTED_EXTENSIONS = [...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS]
const MAX_UPLOAD_MB = 500
const LOW_CONFIDENCE = 0.4 // 사진 글자 인식 확신이 이보다 낮으면 '확인 필요'

const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''
const isImage = (name: string) => IMAGE_EXTENSIONS.includes(extOf(name))

function validate(file: File): string | null {
  const ext = extOf(file.name)
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return `지원하지 않는 형식입니다 (.${ext || '확장자 없음'}). 녹음(MP3·WAV·M4A·WEBM)이나 사진(JPG·PNG·HEIC)을 선택해 주세요.`
  }
  if (file.size > MAX_UPLOAD_MB * 1024 ** 2) {
    return `파일이 너무 큽니다 (${formatBytes(file.size)}). 최대 ${MAX_UPLOAD_MB}MB까지 올릴 수 있습니다.`
  }
  return null
}

const waiting = (j: Job) => j.status === 'QUEUED' && j.progress == null

/** 진행 막대 칸: 남색(완료) · 청록(진행 중) · 빈 칸(대기) */
function QueueBar({ job }: { job: Job }) {
  const done = job.transcriptReady && job.status !== 'TRANSCRIBING'
  const pct = done ? 100 : job.status === 'FAILED' ? 0 : (job.progress ?? 0)
  const label = done ? '100% 완료' : job.status === 'FAILED' ? '실패' : waiting(job) ? '0% 대기' : `${pct}% ${job.source === 'image' ? '판독 중' : '변환 중'}`
  return (
    <div className="relative h-4 bg-white w98-in" role="progressbar" aria-label={`${job.fileName} 진행률`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <div className={cn('absolute inset-y-[2px] left-[2px]', done ? 'bg-[#000080]' : 'bg-[#006a6a]')} style={{ width: `calc(${pct}% - 4px)` }} />
      <span className={cn('relative block text-center font-mono text-[9px] leading-4 font-bold', pct > 45 ? 'text-white' : 'text-[#464653]')}>{label}</span>
    </div>
  )
}

function stateText(job: Job): { text: string; className: string } {
  if (job.status === 'FAILED') return { text: '실패', className: 'text-[#ba1a1a] font-bold' }
  if (job.status === 'COMPLETED' && job.minutesReady) return { text: '회의록 완료', className: 'font-bold' }
  if (job.transcriptReady) return { text: job.source === 'image' ? '글자 읽기 완료' : '텍스트 변환 완료', className: 'font-bold' }
  if (waiting(job)) return { text: '업로드 완료 (대기)', className: 'text-[#464653]' }
  return { text: `● ${job.stage ?? (job.source === 'image' ? '글자 추출 중' : '변환 중')}`, className: 'text-[#006a6a] font-bold' }
}

/** 사진에서 읽은 글 미리보기 (가장 최근 사진 작업) */
function OcrPreview({ job }: { job: Job | undefined }) {
  const transcript = useTranscript(job?.id ?? '', job?.transcriptReady ?? false)
  if (!job) return <p className="p-3 text-[12px] text-[#464653]">아직 올린 화이트보드 사진이 없습니다. 사진을 올리면 읽은 글을 여기서 미리 볼 수 있습니다.</p>
  const segs = transcript.data?.segments ?? []
  const unsure = segs.filter((s) => s.confidence != null && s.confidence < LOW_CONFIDENCE).length
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
        <span className="flex min-w-0 items-center gap-1 font-bold">
          <ScanText className="size-3.5 shrink-0" aria-hidden /> 대상: <span className="truncate">{job.fileName}</span>
        </span>
        {unsure > 0 && <span className="text-[11px] font-bold text-[#ba1a1a]">⚠️ 불확실 감지 {unsure}건</span>}
      </div>
      <div className="max-h-40 min-h-24 overflow-auto bg-white p-2 text-[12px] w98-in">
        {!job.transcriptReady ? (
          <p className="text-[#464653]">{job.status === 'FAILED' ? '글자를 읽지 못했습니다.' : '글자를 읽는 중입니다…'}</p>
        ) : transcript.isPending ? (
          <p className="text-[#464653]">불러오는 중…</p>
        ) : segs.length === 0 ? (
          <p className="text-[#464653]">사진에서 글자를 찾지 못했습니다.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {segs.map((s, i) => {
              const low = s.confidence != null && s.confidence < LOW_CONFIDENCE
              return (
                <li key={i} className={cn('flex flex-wrap items-center gap-1', low && 'bg-[#ffffe1] px-1 py-0.5')}>
                  <span>· {s.text}</span>
                  {low && <span className="border border-[#ba1a1a] bg-[#ffdad6] px-1 text-[10px] font-bold text-[#ba1a1a]">⚠ [확인 필요]</span>}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {job.transcriptReady && (
        <Link href={`/jobs/${job.id}`} className="self-end px-2 py-0.5 text-[11px] w98-out active:w98-pressed">
          읽은 글 전체 보기 ▸
        </Link>
      )}
    </div>
  )
}

/**
 * 소스 파일 업로드 및 카메라 촬영 (음성 / 사진). 파일 변환기와 녹음기 창이 함께 쓴다.
 * 올리면 바로 텍스트 변환을 시작하고 onUploaded로 작업을 알려 준다. compact: 좁은 칸용 (포맷 검사를 아래로)
 */
export function SourceUpload({ onUploaded, compact = false }: { onUploaded?: (job: Job) => void; compact?: boolean }) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const onJobCreated = useJobCreated()
  const health = useHealth()
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<number | undefined>(undefined)
  const [uploadedName, setUploadedName] = useState<string | null>(null)

  const uploading = progress != null && !uploadedName && !error
  const ext = file ? extOf(file.name) : null
  const model = health.data?.whisperModel

  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = ''
    if (photoRef.current) photoRef.current.value = ''
  }

  const pick = (f: File | undefined) => {
    if (!f || uploading) return
    const err = validate(f)
    setError(err)
    setFile(err ? null : f)
    setProgress(undefined)
    setUploadedName(null)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    pick(e.dataTransfer.files[0])
  }

  const clear = () => {
    setFile(null)
    setProgress(undefined)
    setUploadedName(null)
    setError(null)
    resetInput()
  }

  const upload = async () => {
    if (!file) return
    setError(null)
    setProgress(0)
    try {
      const job = await uploadAndTranscribe(file, file.name, isImage(file.name) ? 'image' : 'upload', setProgress)
      setProgress(1)
      setUploadedName(file.name)
      setFile(null)
      resetInput()
      onJobCreated(job)
      onUploaded?.(job)
    } catch (e) {
      setProgress(undefined)
      setError(e instanceof Error ? e.message : '업로드하지 못했습니다.')
    }
  }

  return (
    <Fieldset title="1. 소스 파일 업로드 및 카메라 촬영 (음성 / 사진)">
      <div className={cn('grid gap-2', compact ? '2xl:grid-cols-[minmax(0,1fr)_320px]' : 'lg:grid-cols-[minmax(0,1fr)_450px]')}>
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            compact ? 'min-h-36' : 'min-h-48',
            'flex cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed px-4 py-5 text-center focus-within:outline-1 focus-within:outline-dotted focus-within:outline-black',
            dragging ? 'border-[#000080] bg-[#e0e0ff]' : 'border-[#808080] bg-white',
          )}
        >
          <span className="flex items-center gap-3 text-[#000080]" aria-hidden>
            <CloudUpload className="size-10" strokeWidth={2.5} />
            <ScanText className="size-10 text-[#006a6a]" strokeWidth={2.5} />
          </span>
          <span className="text-[15px] font-bold">음성(MP3, WAV, M4A, WEBM) 및 사진(JPG, PNG, HEIC) 파일을 이곳으로 끌어다 놓으십시오.</span>
          <span className="text-[12px] text-[#464653]">단일 파일 최대 {MAX_UPLOAD_MB}MB 지원 · 2시간 분량의 회의 녹음도 처리 · 사진은 글자를 읽어 텍스트로</span>
          <span className="mt-1 flex flex-wrap justify-center gap-2">
            <span className="flex h-7 items-center gap-1 px-3 text-[12px] w98-out">
              <FolderOpen className="size-3.5" aria-hidden /> 찾아보기(<u>B</u>)...
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                photoRef.current?.click()
              }}
              disabled={uploading}
              className="flex h-7 items-center gap-1 px-3 text-[12px] w98-out active:w98-pressed"
            >
              📷 화이트보드 사진 찍기 / 올리기 (스마트폰 연동)
            </button>
          </span>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(',') + ',audio/*,image/*'}
            className="sr-only"
            disabled={uploading}
            onChange={(e) => pick(e.target.files?.[0])}
          />
          <input ref={photoRef} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => pick(e.target.files?.[0])} />
        </label>

        <div className="flex flex-col gap-2 bg-white p-2 text-[12px] w98-in">
          <div className="flex items-center justify-between border-b border-[#c6c5d5] pb-1">
            <span className="font-heading text-[14px] font-bold">포맷 적합성 검사</span>
            <span
              className={cn('px-1 font-mono text-[10px] font-bold', error ? 'bg-[#ffdad6] text-[#ba1a1a]' : file ? 'bg-[#72ff70] text-[#002203]' : 'bg-[#eeeeee] text-[#464653]')}
            >
              {error ? 'REJECT' : file ? 'READY' : 'IDLE'}
            </span>
          </div>
          <ul className="flex flex-col gap-1">
            <li className="flex items-center gap-1.5">
              <CircleCheck className="size-3.5 text-[#00a02a]" aria-hidden /> 음성 포맷: MP3, M4A, WAV, WEBM, MP4, OGG
            </li>
            <li className="flex items-center gap-1.5">
              <CircleCheck className="size-3.5 text-[#00a02a]" aria-hidden /> 이미지 포맷: JPG, PNG, HEIC, WEBP
            </li>
            <li className="flex items-center gap-1.5">
              <CircleCheck className="size-3.5 text-[#00a02a]" aria-hidden /> 최대 크기: 파일 하나당 {MAX_UPLOAD_MB}MB
            </li>
            <li className="flex items-center gap-1.5">
              {file ? <CircleCheck className="size-3.5 text-[#00a02a]" aria-hidden /> : <CircleDashed className="size-3.5 text-[#464653]" aria-hidden />}
              {file ? `선택한 파일: .${ext} · ${formatBytes(file.size)} — 처리 가능` : '선택한 파일 검사 대기'}
            </li>
          </ul>
          <p className="mt-auto bg-[#f4f3f3] px-1.5 py-1 text-[11px] text-[#464653] w98-flat">
            ⚡ 음성은 이 Mac의 Whisper{model ? `(${model})` : ''}가, 사진은 이 Mac의 글자 인식이 처리합니다.
          </p>
        </div>
      </div>

      {(file || error || uploadedName) && (
        <div className="mt-2 flex flex-col gap-2">
          {error && (
            <Notice tone="error" icon={<AlertTriangle />}>
              {error}
            </Notice>
          )}
          {uploadedName && (
            <Notice tone="success" icon={<CheckCircle2 />}>
              <span className="font-bold">{uploadedName}</span> 업로드 완료. {isImage(uploadedName) ? '사진에서 글자 읽기를' : '텍스트 변환을'} 시작했습니다. 진행 상황을
              확인하세요.
            </Notice>
          )}
          {file && (
            <div className="flex flex-wrap items-center gap-2 bg-white p-1.5 text-[12px] w98-in">
              {isImage(file.name) ? <ImageIcon className="size-4" aria-hidden /> : <FileAudio className="size-4" aria-hidden />}
              <span className="min-w-0 flex-1 truncate font-bold">{file.name}</span>
              <span className="font-mono text-[11px]">{formatBytes(file.size)}</span>
              {progress != null && <span className="font-mono text-[11px] font-bold text-[#006a6a]">{Math.round(progress * 100)}%</span>}
              <button
                type="button"
                onClick={upload}
                disabled={uploading}
                className="h-6 px-2 text-[11px] font-bold outline outline-1 -outline-offset-1 outline-black w98-out active:w98-pressed disabled:text-[#808080]"
              >
                {uploading ? '업로드 중…' : isImage(file.name) ? '올리고 글자 읽기' : '업로드하고 텍스트로 변환'}
              </button>
              {!uploading && (
                <button type="button" onClick={clear} aria-label={`${file.name} 빼기`} className="grid size-6 place-items-center w98-out active:w98-pressed">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Fieldset>
  )
}

/** 파일 변환기 창: 업로드 · 대기 큐 · 엔진 상태 · 사진 판독 미리보기 */
export function UploadPanel() {
  const router = useRouter()
  const health = useHealth()
  const llm = useLlmSettings()
  const jobs = useJobs()
  const transcribe = useStartTranscribe()
  const remove = useDeleteJob()
  const [openWhenDone, setOpenWhenDone] = useState(false)
  const [watching, setWatching] = useState<string | null>(null)

  const all = jobs.data ?? []
  const queue = all.slice(0, 8)
  const waitingJobs = all.filter(waiting)
  const latestImage = all.find((j) => j.source === 'image')

  // ‘변환 완료 후 회의록 뷰어로 이동’: 방금 올린 작업의 변환이 끝나면 결과 화면을 연다
  const watched = watching ? all.find((j) => j.id === watching) : undefined
  useEffect(() => {
    if (openWhenDone && watched?.transcriptReady) router.push(`/jobs/${watched.id}`)
  }, [openWhenDone, watched, router])

  // 대기 중인 항목 모두 변환 시작 (Alt+G)
  const startAll = () => waitingJobs.forEach((j) => transcribe.mutate(j.id))
  const startAllRef = useRef(startAll)
  useEffect(() => {
    startAllRef.current = startAll
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === 'KeyG') {
        e.preventDefault()
        startAllRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const model = health.data?.whisperModel
  const active = all.filter(isActive)
  const busy = active[0]
  const totalBytes = queue.reduce((n, j) => n + j.sizeBytes, 0)

  return (
    <OsWindow
      icon="📂"
      title="멀티미디어 변환기 v1.0 - [파일 업로드 및 광학 판독]"
      menu={
        <>
          <Menu label="파일" hot="F" items={[{ label: '회의 작업 목록', href: '/jobs' }]} />
          <Menu label="변환" hot="C" items={[{ label: '대기 항목 모두 변환 시작 (Alt+G)', onSelect: startAll }]} />
          <Menu label="보기" hot="V" items={[{ label: '회의록 뷰어', href: latestImage?.transcriptReady ? `/jobs/${latestImage.id}` : '/jobs' }]} />
          <Menu label="도구" hot="T" items={[{ label: '시스템 설정', href: '/settings' }]} />
          <Menu label="도움말" hot="H" items={[{ label: '파일 업로드 안내', href: '/guide#upload' }]} />
          <span className="ml-auto font-mono text-[10px] font-bold">
            WHISPER: {model ? model.toUpperCase() : '--'}{' '}
            <span className={cn('ml-1', health.data?.ffmpeg ? 'text-[#00a02a]' : 'text-[#ba1a1a]')}>● {health.data?.ffmpeg ? 'FFMPEG READY' : 'FFMPEG 확인 필요'}</span>
          </span>
        </>
      }
      statusBar={
        <>
          <StatusCell>준비 완료 ({queue.length}개 항목 표시)</StatusCell>
          <StatusCell className="font-bold">
            오디오 엔진: {model ? `WHISPER-${model.toUpperCase()}` : '확인 중'} {health.data?.ffmpeg ? 'ONLINE' : ''}
          </StatusCell>
          <StatusCell className="ml-auto font-mono text-[10px] font-bold text-[#006a6a]">AI 회의록: {llm.data && !llm.data.problem ? '연결됨' : '미연결'}</StatusCell>
          <StatusCell className="font-bold">KOR</StatusCell>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <SourceUpload onUploaded={(job) => setWatching(job.id)} />

        <Fieldset title={`2. 대기 큐 및 작업 현황판 (${queue.length}개 항목 표시)`}>
          {(transcribe.isError || remove.isError) && (
            <Notice tone="error" icon={<AlertTriangle />} className="mb-2">
              {transcribe.error?.message ?? remove.error?.message}
            </Notice>
          )}
          <div className="overflow-x-auto bg-white w98-in">
            <table className="w-full min-w-[760px] border-collapse text-[12px]">
              <thead>
                <tr className="text-left">
                  {['파일명', '크기', '종류', '진행 상황', '현재 상태', '동작'].map((h, i) => (
                    <th key={h} className={cn('bg-face px-2 py-1 font-normal w98-out', i === 5 && 'text-center')}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.isPending ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-center text-[#464653]">
                      불러오는 중…
                    </td>
                  </tr>
                ) : queue.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-center text-[#464653]">
                      아직 작업이 없습니다. 위에서 파일을 올리거나 녹음기로 녹음해 보세요.
                    </td>
                  </tr>
                ) : (
                  queue.map((job) => {
                    const st = stateText(job)
                    return (
                      <tr key={job.id} className="border-b border-[#eeeeee] odd:bg-white even:bg-[#faf9f9]">
                        <td className="max-w-80 px-2 py-1.5">
                          <span className="flex min-w-0 items-center gap-1.5 font-bold">
                            {job.source === 'image' ? <ImageIcon className="size-3.5 shrink-0" aria-hidden /> : <FileAudio className="size-3.5 shrink-0" aria-hidden />}
                            <span className="truncate">{job.fileName}</span>
                          </span>
                        </td>
                        <td className="px-2 font-mono text-[11px] whitespace-nowrap">{formatBytes(job.sizeBytes)}</td>
                        <td className="px-2 whitespace-nowrap text-[#464653]">
                          {job.source === 'image' ? '화이트보드 OCR' : job.source === 'recording' ? '오디오 (직접 녹음)' : '오디오 (업로드)'}
                        </td>
                        <td className="w-56 px-2">
                          <QueueBar job={job} />
                        </td>
                        <td className={cn('px-2 whitespace-nowrap', st.className)}>{st.text}</td>
                        <td className="px-2 text-center whitespace-nowrap">
                          <span className="inline-flex gap-1">
                            {job.transcriptReady ? (
                              <Link href={`/jobs/${job.id}`} className="px-2 py-0.5 text-[11px] font-bold w98-out active:w98-pressed">
                                결과 보기
                              </Link>
                            ) : waiting(job) || job.status === 'FAILED' ? (
                              <button
                                type="button"
                                disabled={transcribe.isPending}
                                onClick={() => transcribe.mutate(job.id)}
                                className="px-2 py-0.5 text-[11px] font-bold w98-out active:w98-pressed"
                              >
                                {job.status === 'FAILED' ? '다시 시도' : '변환 시작'}
                              </button>
                            ) : null}
                            {!isActive(job) && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <button type="button" disabled={remove.isPending} className="px-2 py-0.5 text-[11px] text-[#ba1a1a] w98-out active:w98-pressed">
                                    삭제
                                  </button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>이 작업을 삭제할까요?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      {job.fileName} — 원본 파일, 변환 원문{job.minutesReady && ', 회의록'}과 작업 기록을 이 Mac에서 모두 지웁니다. 되돌릴 수 없습니다. 참석자
                                      명단은 지워지지 않습니다.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>취소</AlertDialogCancel>
                                    <AlertDialogAction variant="destructive" onClick={() => remove.mutate(job.id)}>
                                      삭제
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <span>
              표시한 파일: <b>{queue.length}개</b> ({formatBytes(totalBytes)}) <span className="mx-1 text-[#808080]">|</span> 변환 대기: <b>{waitingJobs.length}개</b>
            </span>
            <Link href="/jobs" className="px-2 py-0.5 text-[11px] w98-out active:w98-pressed">
              전체 작업 목록 ▸
            </Link>
          </div>
        </Fieldset>

        <div className="grid gap-3 lg:grid-cols-2">
          <Fieldset title="3. 로컬 인공지능 엔진 상태 모니터">
            <div className="flex flex-col gap-2 text-[12px]">
              <div className="flex flex-col gap-1 bg-white p-2 w98-in">
                <div className="flex items-center justify-between">
                  <span className="font-bold">🖥️ Mac 로컬 Whisper 엔진</span>
                  <span className={cn('px-1 font-mono text-[10px] font-bold', health.data?.ffmpeg ? 'bg-[#72ff70] text-[#002203]' : 'bg-[#ffdad6] text-[#ba1a1a]')}>
                    {health.isError ? 'OFFLINE' : health.data?.ffmpeg ? 'NORMAL' : 'CHECK'}
                  </span>
                </div>
                <p>
                  모델: <b className="font-mono">Whisper-{model ?? '--'}</b> (이 Mac에서 실행)
                </p>
                <p className="text-[11px] text-[#464653]">
                  ffmpeg {health.data?.ffmpeg ? '사용 가능' : '확인 필요'} · 최대 업로드 {health.data?.maxUploadMb ?? MAX_UPLOAD_MB}MB · AI 회의록{' '}
                  {llm.data && !llm.data.problem ? `${llm.data.label} 연결됨` : '미연결'}
                </p>
              </div>
              <div className="flex items-center gap-2 bg-black px-1.5 py-1 font-mono text-[11px] text-white w98-in">
                <span className="shrink-0">처리 중:</span>
                <span className="flex h-3 flex-1 gap-px" aria-hidden>
                  {Array.from({ length: 20 }, (_, i) => (
                    <span key={i} className={cn('h-full flex-1', busy && i < Math.round(((busy.progress ?? 0) / 100) * 20) ? 'bg-[#00ff41]' : 'bg-[#1f3b25]')} />
                  ))}
                </span>
                <span className="shrink-0 text-[#00ff41]">{busy ? `${busy.progress ?? 0}% · ${active.length}개` : 'IDLE'}</span>
              </div>
              <p className="flex items-start gap-2 bg-[#eeeeee] p-2 w98-flat">
                <Lock className="mt-0.5 size-5 shrink-0" aria-hidden />
                <span>
                  <b>🔒 데이터 보호:</b> 음성 및 사진은 이 Mac 밖 클라우드로 보내지 않고 로컬에서 변환합니다. AI 회의록을 만들 때만 변환된 텍스트가 AI API로 전송됩니다.
                </span>
              </p>
            </div>
          </Fieldset>

          <Fieldset title="4. 사진 광학 문자 판독 (OCR) 미리보기">
            <OcrPreview job={latestImage} />
          </Fieldset>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#808080] pt-2 shadow-[inset_0_1px_#fff]">
          <label className="flex cursor-pointer items-center gap-1.5 text-[12px]">
            <Checkbox checked={openWhenDone} onCheckedChange={(v) => setOpenWhenDone(v === true)} />
            변환 완료 후 ‘회의록 뷰어’로 즉시 이동 (방금 올린 파일)
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={startAll}
              disabled={waitingJobs.length === 0 || transcribe.isPending}
              className="h-8 px-4 text-[13px] font-bold outline outline-1 -outline-offset-1 outline-black w98-out active:w98-pressed disabled:font-normal disabled:text-[#808080]"
            >
              ▷ 대기 항목 전체 변환 시작 ({waitingJobs.length}) (<u>Alt+G</u>)
            </button>
          </div>
        </div>
      </div>
    </OsWindow>
  )
}
