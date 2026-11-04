'use client'

import { AlertTriangle, Check } from 'lucide-react'
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
  AlertDialogTrigger,
} from '@/components/malmoa/ui/alert-dialog'
import { Progress } from '@/components/malmoa/ui/progress'
import { useLlmSettings, useMinutes, useSaveMinutes, useStartMinutes, useUsage } from '@/hooks/malmoa/queries'
import { downloadFile, minutesFilePath } from '@/lib/malmoa/api'
import type { Job, MinutesFormat } from '@/lib/malmoa/types'
import { cn } from '@/lib/utils'
import { Notice, ToneBadge } from './common'
import { MarkdownView } from './markdown-view'
import { USAGE_WARN_RATIO, usageRatios } from './usage-card'

type View = 'all' | 'summary' | 'todo'
const VIEWS: { value: View; label: string; match?: RegExp }[] = [
  { value: 'all', label: '구조화된 회의록' },
  { value: 'summary', label: '핵심 요약', match: /개요|요약|결정/ },
  { value: 'todo', label: '할 일/Action Items', match: /실행|할 일|일정|마감|확인/ },
]

/** 회의록 Markdown에서 ‘## 제목’ 구획 중 match에 맞는 것만 남긴다 */
function pickSections(markdown: string, match: RegExp): string {
  const out: string[] = []
  let keep = false
  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) keep = match.test(line)
    else if (line.startsWith('# ')) keep = false
    if (keep) out.push(line)
  }
  return out.join('\n').trim()
}

const btn = 'flex h-7 items-center gap-1 px-2 text-[12px] whitespace-nowrap outline-none w98-out active:w98-pressed disabled:text-shade'

/** 회의록 뷰어 오른쪽: AI 회의록 (작성 중 · 완성 · 아직 없음) */
export function MinutesPanel({ job, transcriptChars }: { job: Job; transcriptChars: number }) {
  const editorId = useId()
  const llm = useLlmSettings()
  const running = job.status === 'SUMMARIZING'
  const failed = job.status === 'FAILED' && job.transcriptReady
  const configured = !!llm.data && !llm.data.problem
  const usage = useUsage()
  const ratios = usage.data ? usageRatios(usage.data) : null
  const nearLimit = !!ratios && Math.max(ratios.month ?? 0, ratios.today ?? 0) >= USAGE_WARN_RATIO

  const minutes = useMinutes(job.id, job.minutesReady && !running)
  const start = useStartMinutes()
  const save = useSaveMinutes(job.id)
  const [view, setView] = useState<View>('all')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const download = (format: MinutesFormat) => {
    setDownloadError(null)
    downloadFile(minutesFilePath(job.id, format), `회의록.${format}`).catch((e: Error) => setDownloadError(e.message))
  }

  const actionError = start.error?.message ?? save.error?.message ?? downloadError
  const doc = job.minutesReady && !running ? minutes.data : undefined

  // 새로 만들기: 이미 있으면 확인 창을 거친다 (수정 내용이 사라지고 API 비용이 든다)
  const regenerate = doc ? (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button type="button" className={cn(btn, 'font-bold')} disabled={!configured || start.isPending}>
          ✨ AI 회의록 새로 만들기/다시 생성
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>회의록을 새로 만들까요?</AlertDialogTitle>
          <AlertDialogDescription>직접 수정한 내용은 사라지고, AI API가 다시 호출되어 비용이 발생합니다.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={() => start.mutate({ id: job.id, force: true })}>새로 만들기</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : (
    <button type="button" className={cn(btn, 'font-bold')} disabled={!configured || running || start.isPending} onClick={() => start.mutate({ id: job.id })}>
      ✨ {failed ? 'AI 회의록 다시 시도' : 'AI 회의록 만들기'}
    </button>
  )

  const shown = doc ? (view === 'all' ? doc.markdown : pickSections(doc.markdown, VIEWS.find((v) => v.value === view)!.match!)) : ''

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 탭 + 새로 만들기 */}
      <div className="flex flex-wrap items-end justify-between gap-1 border-b-2 border-white px-1 pt-1 shadow-[0_1px_#808080]">
        <div role="tablist" aria-label="회의록 보기" className="flex gap-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              role="tab"
              aria-selected={view === v.value}
              disabled={!doc || editing}
              onClick={() => setView(v.value)}
              className={cn('px-2.5 text-[12px] outline-none w98-out disabled:text-shade', view === v.value ? '-mb-0.5 h-7 font-bold' : 'h-6')}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="mb-1">{regenerate}</div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 p-1.5">
        {actionError && (
          <Notice tone="error" icon={<AlertTriangle />}>
            {actionError}
          </Notice>
        )}

        {running ? (
          <div className="flex flex-col gap-3 bg-white p-4 w98-in">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-heading text-[15px] font-bold">AI가 회의록을 작성하고 있습니다</h2>
              <ToneBadge tone="primary">{job.progress ?? 0}%</ToneBadge>
            </div>
            <Progress value={Math.max(job.progress ?? 0, 4)} aria-label="회의록 작성 진행률" />
            <p className="text-[12px] text-[#464653]" aria-live="polite">
              {job.stage}
            </p>
            <p className="text-[11px] text-[#464653]">긴 회의는 구간별로 정리한 뒤 하나로 합칩니다. 이 화면을 닫아도 작업은 계속됩니다.</p>
          </div>
        ) : job.minutesReady ? (
          minutes.isError ? (
            <Notice tone="error" icon={<AlertTriangle />}>
              회의록을 불러오지 못했습니다. {minutes.error.message}
            </Notice>
          ) : !doc ? (
            <p className="py-10 text-center text-[12px] text-[#464653]">불러오는 중…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#464653]">
                {doc.edited ? <ToneBadge tone="primary">직접 수정됨</ToneBadge> : <ToneBadge tone="success">AI 작성</ToneBadge>}
                {doc.model && <span className="font-mono">모델 {doc.model}</span>}
                {job.llmTokens != null && <span className="font-mono">· 토큰 {job.llmTokens.toLocaleString('ko-KR')}</span>}
                {save.isSuccess && !editing && (
                  <span className="flex items-center gap-1 font-bold text-[#00a02a]">
                    <Check className="size-3.5" /> 저장됨
                  </span>
                )}
              </div>
              {failed && job.errorMessage && (
                <Notice tone="error" icon={<AlertTriangle />}>
                  새로 만들지 못해 이전 회의록을 보여 줍니다. {job.errorMessage}
                </Notice>
              )}
              {editing ? (
                <div className="flex min-h-0 flex-1 flex-col gap-1">
                  <label htmlFor={editorId} className="text-[11px] font-bold">
                    회의록 편집 <span className="font-normal text-[#464653]">(Markdown — # 제목, ## 소제목, - 목록)</span>
                  </label>
                  <textarea
                    id={editorId}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    spellCheck={false}
                    className="min-h-96 flex-1 resize-y bg-white p-3 font-mono text-[12px] leading-relaxed outline-none w98-in"
                  />
                </div>
              ) : (
                <article className="min-h-0 flex-1 overflow-auto bg-white p-3 text-[13px] w98-in [&_h3]:text-[#000080] [&_ul]:bg-[#faf9f9] [&_ul]:py-1 [&_ul]:pr-2 [&_ul]:w98-flat">
                  {shown ? <MarkdownView markdown={shown} /> : <p className="text-[#464653]">이 회의록에는 해당 항목이 없습니다.</p>}
                </article>
              )}
              <p className="text-[10px] text-[#464653]">원문에 없는 담당자·일정·결정 사항은 지어내지 않고 ‘확인 필요’로 표시합니다.</p>
              {/* 아래 단추 줄 */}
              <div className="flex flex-wrap items-center justify-between gap-1 border-t border-[#808080] pt-1.5 shadow-[inset_0_1px_#fff]">
                <div className="flex gap-1">
                  {editing ? (
                    <>
                      <button
                        type="button"
                        className={cn(btn, 'font-bold outline outline-1 -outline-offset-1 outline-black')}
                        disabled={save.isPending || draft === doc.markdown}
                        onClick={() => save.mutate(draft, { onSuccess: () => setEditing(false) })}
                      >
                        💾 {save.isPending ? '저장 중…' : '회의록 저장'}
                      </button>
                      <button type="button" className={btn} disabled={save.isPending} onClick={() => setEditing(false)}>
                        취소
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={cn(btn, 'font-bold')}
                      onClick={() => {
                        setDraft(doc.markdown)
                        save.reset()
                        setView('all')
                        setEditing(true)
                      }}
                    >
                      ✏️ 회의록 편집
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  <button type="button" className={btn} disabled={editing} onClick={() => download('docx')} title="Word·한글·Pages에서 열 수 있습니다">
                    📝 Word 받기
                  </button>
                  <button type="button" className={btn} disabled={editing} onClick={() => download('pdf')}>
                    📕 PDF 받기
                  </button>
                  <button type="button" className={btn} disabled={editing} onClick={() => download('md')}>
                    📤 Markdown
                  </button>
                  <button type="button" className={btn} disabled={editing} onClick={() => download('txt')}>
                    💾 TXT
                  </button>
                </div>
              </div>
            </>
          )
        ) : (
          <div className="flex flex-col gap-3 bg-white p-4 text-[12px] w98-in">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center bg-[#000080] text-[20px] w98-in" aria-hidden>
                🤖
              </span>
              <div>
                <h2 className="font-heading text-[15px] font-bold">AI 회의록 만들기</h2>
                <p className="mt-1 leading-relaxed text-[#464653]">
                  변환된 원문으로 회의 제목, 개요, 주요 논의, 핵심 요약, 결정 사항, 담당자별 할 일, 일정, 확인이 필요한 사항을 정리합니다. 원문에서 확인할 수 없는 담당자·마감일은 ‘확인 필요’로 표시합니다. 완성된 회의록은 이 화면에서 고친 뒤
                  Word(.docx)·PDF·Markdown·TXT 파일로 받을 수 있습니다.
                </p>
              </div>
            </div>
            {failed && job.errorMessage && (
              <Notice tone="error" icon={<AlertTriangle />}>
                <p className="font-bold">회의록을 만들지 못했습니다.</p>
                <p>{job.errorMessage}</p>
              </Notice>
            )}
            {llm.data && !configured && (
              <Notice tone="warning" icon={<AlertTriangle />}>
                <p className="font-bold">AI API가 아직 연결되지 않았습니다.</p>
                <p className="mt-1">
                  API 없이 쓰려면 위의 <b>AI 프롬프트 포함 복사</b>로 복사해 ChatGPT나 Claude에 붙여넣으세요. 앱에서 바로 만들려면{' '}
                  <Link href="/settings#llm" className="font-bold text-[#000080] underline underline-offset-2">
                    시스템 설정
                  </Link>
                  의 ‘AI 회의록 연결’에서 제공자와 API 키를 넣으세요.
                </p>
              </Notice>
            )}
            {configured && nearLimit && ratios && (
              <Notice tone="warning" icon={<AlertTriangle />}>
                <p className="font-bold">정해 둔 AI 사용 한도에 가깝습니다.</p>
                <p className="mt-1">
                  {ratios.month != null && `이번 달 토큰 ${Math.floor(ratios.month * 100)}%`}
                  {ratios.month != null && ratios.today != null && ' · '}
                  {ratios.today != null && `오늘 호출 ${Math.floor(ratios.today * 100)}%`} 사용.{' '}
                  <Link href="/settings#usage" className="font-bold text-[#000080] underline underline-offset-2">
                    AI 사용량 보기
                  </Link>
                </p>
              </Notice>
            )}
            <p className="bg-[#ffffe1] p-2 leading-relaxed w98-flat">
              🔒 AI API({llm.data?.label ?? '확인 중'})로는 <b>변환된 텍스트 약 {transcriptChars.toLocaleString('ko-KR')}자</b>만 전송됩니다. 음성 파일은 이 Mac 밖으로 나가지 않습니다. API 사용량에 따라
              비용이 발생할 수 있습니다.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
