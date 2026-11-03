'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { keys, useMinutes, useStartTranscribe, useTranscript } from '@/hooks/malmoa/queries'
import { getJob } from '@/lib/malmoa/api'
import { formatClock } from '@/lib/malmoa/format'
import { cn } from '@/lib/utils'
import type { Job } from '@/lib/malmoa/types'
import { Fieldset } from './app-shell'
import { CopyButton } from './copy-button'
import { MarkdownView } from './markdown-view'

const LOW_CONFIDENCE = 0.4

/** 변환이 끝난 결과 문서를 녹음기 창에서 바로 본다: 원문(+ 회의록이 있으면 회의록) */
function ResultDoc({ job }: { job: Job }) {
  const transcript = useTranscript(job.id, true)
  const minutes = useMinutes(job.id, job.minutesReady)
  const [tab, setTab] = useState<'transcript' | 'minutes'>(job.minutesReady ? 'minutes' : 'transcript')
  const t = transcript.data
  const timed = job.source !== 'image'
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-end justify-between gap-1">
        <div role="tablist" aria-label="결과 문서" className="flex gap-0.5">
          <button type="button" role="tab" aria-selected={tab === 'transcript'} onClick={() => setTab('transcript')} className={cn('px-2.5 text-[12px] w98-out', tab === 'transcript' ? '-mb-0.5 h-7 font-bold' : 'h-6')}>
            📄 변환 원문
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'minutes'}
            disabled={!job.minutesReady}
            title={job.minutesReady ? undefined : '회의록 뷰어에서 AI 회의록을 만들 수 있습니다'}
            onClick={() => setTab('minutes')}
            className={cn('px-2.5 text-[12px] w98-out disabled:text-shade', tab === 'minutes' ? '-mb-0.5 h-7 font-bold' : 'h-6')}
          >
            📝 AI 회의록{!job.minutesReady && ' (아직 없음)'}
          </button>
        </div>
        {t && tab === 'transcript' && (
          <CopyButton variant="outline" size="sm" className="mb-1 h-6 text-[11px]" text={() => t.text}>
            📋 텍스트 복사
          </CopyButton>
        )}
      </div>
      <div className="max-h-96 min-h-32 overflow-auto bg-white p-3 text-[13px] leading-relaxed w98-in">
        {tab === 'minutes' ? (
          minutes.isError ? (
            <p className="text-[#ba1a1a]">회의록을 불러오지 못했습니다. {minutes.error.message}</p>
          ) : minutes.data ? (
            <MarkdownView markdown={minutes.data.markdown} />
          ) : (
            <p className="text-[#464653]">불러오는 중…</p>
          )
        ) : transcript.isError ? (
          <p className="text-[#ba1a1a]">원문을 불러오지 못했습니다. {transcript.error.message}</p>
        ) : !t ? (
          <p className="text-[#464653]">불러오는 중…</p>
        ) : t.segments.length === 0 ? (
          <p className="text-[#464653]">{timed ? '인식된 말소리가 없습니다. 녹음에 대화가 없거나 소리가 너무 작았을 수 있습니다.' : '사진에서 글자를 찾지 못했습니다.'}</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {t.segments.map((s, i) => {
              const unsure = s.confidence != null && s.confidence < LOW_CONFIDENCE
              return (
                <li key={i} className={cn('flex flex-wrap items-baseline gap-x-2', unsure && 'bg-[#ffffe1]')}>
                  {timed && <span className="font-mono text-[10px] font-bold text-[#000080]">[{formatClock(s.start * 1000)}]</span>}
                  <span className="min-w-0 flex-1">{s.text}</span>
                  {unsure && <span className="bg-[#ffdad6] px-1 text-[10px] font-bold text-[#ba1a1a]">확인 필요</span>}
                </li>
              )
            })}
          </ol>
        )}
      </div>
      {t && <p className="text-right font-mono text-[10px] text-[#464653]">총 {t.segments.length}개 문장 · {t.text.length.toLocaleString('ko-KR')}자</p>}
    </div>
  )
}

const STEPS = ['서버로 보내기', '변환 대기', '음성 → 텍스트', '완료']
const LEDS = 20

/**
 * 녹음기 창 아래: 방금 보낸 녹음의 텍스트 변환 진행 상황.
 * sending(0~1)이면 업로드 중, jobId가 있으면 서버 작업을 2초마다 확인한다.
 */
export function TranscribeProgress({ jobId, sending, onClose }: { jobId: string | null; sending: number | null; onClose: () => void }) {
  const job = useQuery({
    queryKey: keys.job(jobId ?? ''),
    queryFn: () => getJob(jobId!),
    enabled: jobId != null,
    // 끝나거나 실패할 때까지 확인 (작업 대기 중에도 멈추지 않게)
    refetchInterval: (q) => (q.state.data && (q.state.data.transcriptReady || q.state.data.status === 'FAILED') ? false : 2_000),
  })
  const retry = useStartTranscribe()
  // 서버가 파일을 받은 뒤 지난 시간
  const [now, setNow] = useState(() => Date.now())
  const j = job.data
  const done = j?.transcriptReady ?? false
  const failed = j?.status === 'FAILED' && !done
  useEffect(() => {
    if (done || failed) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [done, failed])

  if (sending == null && jobId == null) return null

  // 지금 단계 (0 보내기, 1 대기, 2 변환, 3 완료)
  const step = sending != null ? 0 : !j || j.status === 'QUEUED' ? 1 : done ? 3 : 2
  const pct = sending != null ? Math.round(sending * 100) : done ? 100 : (j?.progress ?? 0)
  const lit = Math.round((pct / 100) * LEDS)
  const message =
    sending != null
      ? sending < 1
        ? `녹음 파일을 이 Mac의 로컬 서버로 보내는 중… ${pct}%`
        : '변환을 요청하는 중…'
      : failed
        ? (j?.errorMessage ?? '변환하지 못했습니다.')
        : done
          ? '텍스트 변환이 끝났습니다. 아래에서 결과 문서를 바로 확인하세요.'
          : (j?.stage ?? (step === 1 ? '변환 순서를 기다리는 중' : '음성을 텍스트로 바꾸는 중'))

  return (
    <Fieldset title="텍스트 변환 진행 상황">
      <div className="flex flex-col gap-2 text-[12px]" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 truncate font-bold">{j?.fileName ?? '방금 녹음한 파일'}</span>
          <span className="font-mono text-[11px] text-[#464653]">
            {j && !done && !failed ? `경과 ${formatClock(Math.max(0, now - new Date(j.createdAt).getTime()))}` : ''}
          </span>
        </div>

        {/* 단계 */}
        <ol className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          {STEPS.map((label, i) => {
            const state = failed && i === step ? 'fail' : i < step || (i === 3 && done) ? 'done' : i === step ? 'now' : 'todo'
            return (
              <li
                key={label}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1',
                  state === 'now' ? 'bg-[#000080] font-bold text-white w98-in' : state === 'fail' ? 'bg-[#ffdad6] font-bold text-[#ba1a1a] w98-in' : 'bg-white w98-flat',
                  state === 'todo' && 'text-[#808080]',
                )}
              >
                <span className="font-mono">{state === 'done' ? '✔' : state === 'fail' ? '✖' : `${i + 1}.`}</span>
                {label}
                {i === 2 && state === 'now' && <span className="ml-auto font-mono">{pct}%</span>}
              </li>
            )
          })}
        </ol>

        {/* 진행 막대 */}
        <div className="flex items-center gap-2 bg-black px-1.5 py-1 font-mono text-[11px] w98-in">
          <span className="flex h-3 flex-1 gap-px" role="progressbar" aria-label="텍스트 변환 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            {Array.from({ length: LEDS }, (_, i) => (
              <span key={i} className={cn('h-full flex-1', i < lit ? (failed ? 'bg-[#ff0000]' : 'bg-[#00ff41]') : 'bg-[#1f3b25]')} />
            ))}
          </span>
          <span className={cn('w-12 text-right', failed ? 'text-[#ff4040]' : 'text-[#00ff41]')}>{failed ? 'FAIL' : `${pct}%`}</span>
        </div>

        <p className={cn('px-1', failed && 'font-bold text-[#ba1a1a]')}>{message}</p>
        {done && j && <ResultDoc job={j} />}

        {job.isError && <p className="px-1 text-[#ba1a1a]">진행 상황을 불러오지 못했습니다. {job.error.message}</p>}
        {retry.isError && <p className="px-1 text-[#ba1a1a]">{retry.error.message}</p>}

        <div className="flex flex-wrap justify-end gap-1">
          {done && jobId && (
            <Link href={`/jobs/${jobId}`} className="flex h-7 items-center px-3 font-bold outline outline-1 -outline-offset-1 outline-black w98-out active:w98-pressed">
              📝 회의록 뷰어에서 열기 (AI 회의록 만들기)
            </Link>
          )}
          {failed && jobId && (
            <button type="button" disabled={retry.isPending} onClick={() => retry.mutate(jobId)} className="h-7 px-3 font-bold w98-out active:w98-pressed">
              다시 시도
            </button>
          )}
          {jobId && !done && !failed && (
            <Link href="/jobs" className="flex h-7 items-center px-3 w98-out active:w98-pressed">
              작업 목록에서 보기
            </Link>
          )}
          {sending == null && (
            <button type="button" onClick={onClose} className="h-7 px-3 w98-out active:w98-pressed" title={done || failed ? '닫기' : '변환은 계속됩니다'}>
              {done || failed ? '닫기' : '숨기기'}
            </button>
          )}
        </div>
      </div>
    </Fieldset>
  )
}
