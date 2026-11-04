'use client'

import { AlertTriangle, RefreshCw, Search } from 'lucide-react'
import Link from 'next/link'
import { useId, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/malmoa/ui/alert-dialog'
import { Checkbox } from '@/components/malmoa/ui/checkbox'
import { isActive, useDeleteJob, useHealth, useJobs, useStartTranscribe } from '@/hooks/malmoa/queries'
import { formatBytes, formatDuration } from '@/lib/malmoa/format'
import type { Job } from '@/lib/malmoa/types'
import { cn } from '@/lib/utils'
import { Menu, OsWindow, StatusCell } from './app-shell'
import { Notice } from './common'

const PAGE_SIZE = 10
const DAY = 24 * 60 * 60 * 1000

type Filter = 'all' | 'waiting' | 'active' | 'transcribed' | 'minutes' | 'failed'
const FILTERS: { value: Filter; label: string; dot: string; match: (j: Job) => boolean }[] = [
  { value: 'all', label: '전체', dot: '📁', match: () => true },
  { value: 'waiting', label: '변환 전', dot: '⚪', match: (j) => j.status === 'QUEUED' && j.progress == null },
  { value: 'active', label: '변환 중', dot: '🟡', match: isActive },
  { value: 'transcribed', label: '변환 완료', dot: '🟢', match: (j) => j.status === 'COMPLETED' && !j.minutesReady },
  { value: 'minutes', label: '회의록 완료', dot: '🔵', match: (j) => j.status === 'COMPLETED' && j.minutesReady },
  { value: 'failed', label: '실패', dot: '🔴', match: (j) => j.status === 'FAILED' },
]
type Period = 'all' | 'today' | 'week' | 'month'
const PERIODS: { value: Period; label: string; days: number }[] = [
  { value: 'all', label: '전체 기간', days: Infinity },
  { value: 'today', label: '오늘', days: 0 },
  { value: 'week', label: '최근 7일', days: 7 },
  { value: 'month', label: '최근 30일', days: 30 },
]
type Sort = 'new' | 'old' | 'name'

function inPeriod(job: Job, period: Period): boolean {
  if (period === 'all') return true
  const created = new Date(job.createdAt)
  if (period === 'today') return created.toDateString() === new Date().toDateString()
  return Date.now() - created.getTime() <= PERIODS.find((p) => p.value === period)!.days * DAY
}

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 상태 칸: 색 점 + 글자 (+ 변환 중이면 진행 막대) */
function StateCell({ job }: { job: Job }) {
  if (job.status === 'FAILED') return <span className="font-bold text-[#ba1a1a]">● 실패 (오류)</span>
  if (isActive(job))
    return (
      <span className="flex flex-col gap-1">
        <span className="font-bold text-[#006a6a]">
          ◐ {job.status === 'SUMMARIZING' ? '회의록 작성' : '변환 중'} ({job.progress ?? 0}%)
        </span>
        <span className="block h-1.5 w-24 bg-white w98-in">
          <span className="block h-full bg-[#000080]" style={{ width: `${job.progress ?? 0}%` }} />
        </span>
      </span>
    )
  if (job.status === 'QUEUED') return <span className="text-[#464653]">◌ 변환 전</span>
  return <span className="font-bold text-[#00a02a]">● {job.minutesReady ? '회의록 완료' : '완료'}</span>
}

function JobAction({ job, onTranscribe, busy }: { job: Job; onTranscribe: (job: Job) => void; busy: boolean }) {
  const btn = 'px-2 py-0.5 text-[11px] whitespace-nowrap w98-out active:w98-pressed'
  if (job.transcriptReady) {
    return (
      <span className="flex justify-center gap-1">
        <Link href={`/jobs/${job.id}`} className={btn}>
          결과 보기
        </Link>
        {job.status === 'FAILED' ? (
          <button type="button" className={cn(btn, 'font-bold')} onClick={() => onTranscribe(job)} disabled={busy}>
            다시 시도
          </button>
        ) : (
          <Link href={`/jobs/${job.id}`} className={btn}>
            회의록 AI
          </Link>
        )}
      </span>
    )
  }
  if (job.status === 'FAILED' || (job.status === 'QUEUED' && job.progress == null)) {
    return (
      <button type="button" className={cn(btn, 'font-bold')} onClick={() => onTranscribe(job)} disabled={busy}>
        {job.status === 'FAILED' ? '다시 시도' : '변환 시작'}
      </button>
    )
  }
  return <span className="text-[11px] text-[#464653]">처리 중…</span>
}

/** 회의 작업 목록 (작업 관리자 창) */
export function JobList() {
  const searchId = useId()
  const jobs = useJobs()
  const health = useHealth()
  const transcribe = useStartTranscribe()
  const remove = useDeleteJob()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [period, setPeriod] = useState<Period>('all')
  const [sort, setSort] = useState<Sort>('new')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)

  const all = jobs.data ?? []
  const q = query.trim().toLowerCase()
  const base = all.filter((j) => inPeriod(j, period) && (!q || j.fileName.toLowerCase().includes(q) || j.attendees.some((a) => a.name.toLowerCase().includes(q))))
  const match = FILTERS.find((f) => f.value === filter)!.match
  const filtered = base
    .filter(match)
    .sort((a, b) => (sort === 'name' ? a.fileName.localeCompare(b.fileName, 'ko') : sort === 'old' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)))
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const shown = filtered.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)

  // 지워졌거나 안 보이는 항목은 선택에서 뺀다
  const picked = all.filter((j) => selected.has(j.id))
  const pickedWaiting = picked.filter((j) => (j.status === 'QUEUED' && j.progress == null) || j.status === 'FAILED')
  const pickedDeletable = picked.filter((j) => !isActive(j))
  const failed = all.filter((j) => j.status === 'FAILED')
  const allShownPicked = shown.length > 0 && shown.every((j) => selected.has(j.id))

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const toggleShown = () =>
    setSelected((s) => {
      const n = new Set(s)
      shown.forEach((j) => (allShownPicked ? n.delete(j.id) : n.add(j.id)))
      return n
    })
  const reset = () => setPage(0)
  const pageNums = Array.from({ length: pages }, (_, i) => i).filter((i) => Math.abs(i - current) <= 2)
  const model = health.data?.whisperModel

  return (
    <OsWindow
      icon="📋"
      title={`말모아 작업관리자 - [전체 회의목록 (총 ${all.length}건)]`}
      menu={
        <>
          <Menu
            label="파일"
            hot="F"
            items={[
              { label: '새 녹음', href: '/' },
              { label: '파일 업로드 & 변환', href: '/upload' },
            ]}
          />
          <Menu
            label="작업"
            hot="A"
            items={[
              { label: `선택 항목 일괄 변환 (${pickedWaiting.length})`, onSelect: () => pickedWaiting.forEach((j) => transcribe.mutate(j.id)) },
              { label: `실패 항목 다시 시도 (${failed.length})`, onSelect: () => failed.forEach((j) => transcribe.mutate(j.id)) },
            ]}
          />
          <Menu label="보기" hot="V" items={FILTERS.map((f) => ({ label: `${f.label} 보기`, onSelect: () => (setFilter(f.value), reset()) }))} />
          <Menu label="도구" hot="T" items={[{ label: '시스템 설정', href: '/settings' }]} />
          <Menu label="도움말" hot="H" items={[{ label: '문제 해결', href: '/guide#faq' }]} />
        </>
      }
      statusBar={
        <>
          <StatusCell className="font-mono text-[10px] font-bold">
            {jobs.isFetching ? '불러오는 중' : '준비 완료 (READY)'} &nbsp; 선택됨: {picked.length} / 총 {all.length}개 작업
          </StatusCell>
          <StatusCell className="ml-auto font-mono text-[10px] font-bold">
            AI ENGINE: ON-DEVICE LOCAL <span className={health.data?.ffmpeg ? 'text-[#00a02a]' : 'text-[#ba1a1a]'}>● {health.isError ? 'OFFLINE' : 'ONLINE'}</span>
          </StatusCell>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {/* 검색·기간·정렬 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[#808080] pb-2 text-[12px] shadow-[0_1px_#fff]">
          <label htmlFor={searchId} className="font-bold">
            검색(<u>S</u>):
          </label>
          <span className="relative flex min-w-48 flex-1 items-center bg-white w98-in">
            <Search className="pointer-events-none absolute left-1.5 size-3.5 text-[#464653]" aria-hidden />
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                reset()
              }}
              placeholder="파일명 또는 참석자 이름으로 검색... (예: 김팀장)"
              className="h-6 w-full bg-transparent pr-2 pl-6 text-[12px] outline-none placeholder:text-[#808080]"
            />
          </span>
          <label className="flex items-center gap-1">
            기간:
            <select
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value as Period)
                reset()
              }}
              className="h-6 bg-white px-1 text-[12px] w98-in"
            >
              {PERIODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            정렬:
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-6 bg-white px-1 text-[12px] w98-in">
              <option value="new">일시 (최신순)</option>
              <option value="old">일시 (오래된순)</option>
              <option value="name">파일명 (가나다)</option>
            </select>
          </label>
          <button type="button" onClick={() => void jobs.refetch()} className="flex h-6 items-center gap-1 px-2 w98-out active:w98-pressed">
            <RefreshCw className={cn('size-3', jobs.isFetching && 'motion-safe:animate-spin')} aria-hidden /> 새로고침
          </button>
        </div>

        {/* 상태 탭 */}
        <div role="tablist" aria-label="상태로 거르기" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => {
                setFilter(f.value)
                reset()
              }}
              className={cn('flex h-6 items-center gap-1 px-2 text-[12px] outline-none', filter === f.value ? 'font-bold w98-checked' : 'w98-out')}
            >
              <span aria-hidden>{f.dot}</span> {f.label} ({base.filter(f.match).length})
            </button>
          ))}
        </div>

        {(transcribe.isError || remove.isError) && (
          <Notice tone="error" icon={<AlertTriangle />}>
            {transcribe.error?.message ?? `삭제하지 못했습니다. ${remove.error?.message}`}
          </Notice>
        )}

        {/* 목록 */}
        <div className="min-h-80 overflow-x-auto bg-white w98-in">
          <table className="w-full min-w-[960px] border-collapse text-[12px]">
            <thead>
              <tr className="text-left">
                <th className="w-9 bg-face p-1 w98-out">
                  <span className="flex justify-center">
                    <Checkbox checked={allShownPicked} onCheckedChange={toggleShown} aria-label="이 페이지 모두 선택" />
                  </span>
                </th>
                {['상태', '회의 / 파일명 ▾', '일시 / 길이', '참석자', '변환 엔진', '작업 동작'].map((h, i) => (
                  <th key={h} className={cn('bg-face px-2 py-1 font-normal w98-out', i === 5 && 'text-center')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.isPending ? (
                <tr>
                  <td colSpan={7} className="px-2 py-10 text-center text-[#464653]">
                    불러오는 중…
                  </td>
                </tr>
              ) : jobs.isError ? (
                <tr>
                  <td colSpan={7} className="px-2 py-10 text-center text-[#ba1a1a]">
                    작업 목록을 불러오지 못했습니다. {jobs.error.message}
                  </td>
                </tr>
              ) : shown.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-2 py-10 text-center text-[#464653]">
                    {all.length === 0 ? '아직 작업이 없습니다. 녹음기로 녹음하거나 파일 변환기에서 파일을 올려 보세요.' : '조건에 맞는 작업이 없습니다.'}
                  </td>
                </tr>
              ) : (
                shown.map((job) => (
                  <tr key={job.id} className={cn('border-b border-[#eeeeee] align-middle', job.status === 'FAILED' ? 'bg-[#fff5f4]' : selected.has(job.id) && 'bg-[#e0e0ff]')}>
                    <td className="p-1">
                      <span className="flex justify-center">
                        <Checkbox checked={selected.has(job.id)} onCheckedChange={() => toggle(job.id)} aria-label={`${job.fileName} 선택`} />
                      </span>
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <StateCell job={job} />
                    </td>
                    <td className="max-w-96 px-2 py-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-bold">
                        <span aria-hidden>{job.status === 'FAILED' ? '⚠️' : job.source === 'image' ? '🖼️' : job.source === 'recording' ? '🎙️' : '📁'}</span>
                        <span className="truncate">{job.fileName}</span>
                      </span>
                      <span className={cn('block truncate pl-6 text-[11px]', job.status === 'FAILED' ? 'text-[#ba1a1a]' : 'text-[#464653]')}>
                        {job.status === 'FAILED' && job.errorMessage
                          ? job.errorMessage
                          : `${job.source === 'image' ? '화이트보드 사진' : job.source === 'recording' ? '직접 녹음' : '업로드한 파일'} (${formatBytes(job.sizeBytes)})${isActive(job) && job.stage ? ` · ${job.stage}` : ''}`}
                      </span>
                    </td>
                    <td className="px-2 py-2 font-mono text-[11px] whitespace-nowrap">
                      {stamp(job.createdAt)}
                      <br />
                      <span className="font-bold text-[#006a6a]">{job.source === 'image' ? '이미지 1장' : job.durationSec != null ? formatDuration(Math.round(job.durationSec)) : '-'}</span>
                    </td>
                    <td className="px-2 py-2">
                      <span className="block max-w-56 truncate bg-[#f4f3f3] px-1 text-[11px] w98-in">{job.attendees.length > 0 ? job.attendees.map((a) => a.name).join(', ') : '등록되지 않음'}</span>
                    </td>
                    <td className="px-2 py-2">
                      <span className="bg-white px-1 font-mono text-[11px] w98-in">{job.source === 'image' ? 'OCR 판독' : `Whisper-${model ?? '--'}`}</span>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <JobAction job={job} onTranscribe={(j) => transcribe.mutate(j.id)} busy={transcribe.isPending} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 선택 작업 · 페이지 */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-bold">선택 작업:</span>
            <button type="button" disabled={pickedWaiting.length === 0 || transcribe.isPending} onClick={() => pickedWaiting.forEach((j) => transcribe.mutate(j.id))} className="h-6 px-2 w98-out active:w98-pressed disabled:text-[#808080]">
              선택 항목 일괄 변환(<u>C</u>) {pickedWaiting.length > 0 && `(${pickedWaiting.length})`}
            </button>
            <button type="button" disabled={failed.length === 0 || transcribe.isPending} onClick={() => failed.forEach((j) => transcribe.mutate(j.id))} className="h-6 px-2 w98-out active:w98-pressed disabled:text-[#808080]">
              실패 항목 다시 시도(<u>R</u>) {failed.length > 0 && `(${failed.length})`}
            </button>
            <button type="button" disabled={pickedDeletable.length === 0 || remove.isPending} onClick={() => setConfirmDelete(true)} className="h-6 px-2 text-[#ba1a1a] w98-out active:w98-pressed disabled:text-[#808080]">
              선택 삭제(<u>D</u>)... {pickedDeletable.length > 0 && `(${pickedDeletable.length})`}
            </button>
          </div>
          <nav aria-label="페이지 이동" className="flex flex-wrap items-center gap-1">
            <button type="button" onClick={() => setPage(0)} disabled={current === 0} className="h-6 px-2 font-mono text-[11px] w98-out disabled:text-[#808080]">
              &lt;&lt; 처음
            </button>
            <button type="button" onClick={() => setPage(current - 1)} disabled={current === 0} className="h-6 px-2 font-mono text-[11px] w98-out disabled:text-[#808080]">
              &lt; 이전
            </button>
            {pageNums.map((i) => (
              <button key={i} type="button" aria-current={i === current ? 'page' : undefined} onClick={() => setPage(i)} className={cn('h-6 min-w-7 px-1 font-mono text-[11px]', i === current ? 'font-bold w98-checked' : 'w98-out')}>
                {i + 1}
              </button>
            ))}
            <button type="button" onClick={() => setPage(current + 1)} disabled={current >= pages - 1} className="h-6 px-2 font-mono text-[11px] w98-out disabled:text-[#808080]">
              다음 &gt;
            </button>
            <button type="button" onClick={() => setPage(pages - 1)} disabled={current >= pages - 1} className="h-6 px-2 font-mono text-[11px] w98-out disabled:text-[#808080]">
              마지막 &gt;&gt;
            </button>
            <span className="pl-1 text-[11px] text-[#464653]">
              총 {pages}페이지 중 {current + 1}페이지
            </span>
          </nav>
        </div>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>선택한 작업 {pickedDeletable.length}개를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2 text-sm leading-relaxed">
                <ul className="max-h-32 list-disc overflow-auto pl-5">
                  {pickedDeletable.map((j) => (
                    <li key={j.id} className="break-all">
                      {j.fileName}
                    </li>
                  ))}
                </ul>
                <p>이 Mac에서 원본 파일, 변환 원문(TXT 포함), 회의록(고친 내용 포함), 작업 기록과 참석자 기록을 모두 지웁니다. 되돌릴 수 없습니다.</p>
                <p>참석자 명단은 지워지지 않습니다. 처리 중인 작업은 삭제되지 않습니다.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                pickedDeletable.forEach((j) => remove.mutate(j.id))
                setSelected(new Set())
              }}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </OsWindow>
  )
}
