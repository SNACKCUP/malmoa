'use client'

import { useId, useState } from 'react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/malmoa/ui/alert-dialog'
import { Button } from '@/components/malmoa/ui/button'
import { buildPromptInstructions, joinPrompt, transcriptBlock } from '@/lib/malmoa/minutesPrompt'
import type { Attendee, Transcript } from '@/lib/malmoa/types'
import { CopyButton } from './copy-button'

const PREVIEW_LINES = 4

/** 'AI 프롬프트 포함 복사': 원문 앞에 붙는 설명(요청문)을 보여 주고 고칠 수 있게 한 뒤 설명 + 원문을 복사한다 */
export function PromptCopyDialog({ transcript, fileName, fromImage, attendees }: { transcript: Transcript; fileName: string; fromImage: boolean; attendees: Attendee[] }) {
  const editorId = useId()
  const defaults = buildPromptInstructions(fromImage, attendees)
  // 고친 설명은 이 화면을 떠날 때까지 유지 (null이면 기본 설명)
  const [edited, setEdited] = useState<string | null>(null)
  const instructions = edited ?? defaults
  const block = transcriptBlock(transcript, fileName, fromImage)
  const blockLines = block.split('\n')
  const source = fromImage ? '사진에서 읽은 글' : 'Whisper 변환 원문'

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-[12px] font-bold">
          🤖 AI 프롬프트 포함 복사
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-h-[92dvh] overflow-y-auto data-[size=default]:max-w-[calc(100vw-2rem)] data-[size=default]:sm:max-w-3xl">
        <AlertDialogHeader>
          <AlertDialogTitle>🤖 AI 프롬프트 포함 복사</AlertDialogTitle>
          <AlertDialogDescription className="text-[12px] leading-relaxed">
            ChatGPT·Claude 등에 붙여 넣을 내용입니다. <b>① 설명(요청문)</b> 다음에 <b>② {source}</b>이 이어 붙어 한 번에 복사됩니다.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor={editorId} className="text-[12px] font-bold">
              ① 원문 앞에 붙는 설명 <span className="font-normal text-[#464653]">(필요하면 고쳐서 복사할 수 있습니다)</span>
            </label>
            {edited !== null && edited !== defaults && (
              <button type="button" className="text-[11px] text-[#000080] underline underline-offset-2" onClick={() => setEdited(null)}>
                기본 설명으로 되돌리기
              </button>
            )}
          </div>
          <textarea
            id={editorId}
            value={instructions}
            onChange={(e) => setEdited(e.target.value)}
            spellCheck={false}
            rows={14}
            className="max-h-[45dvh] min-h-40 w-full resize-y bg-white p-2 font-mono text-[12px] leading-relaxed outline-none w98-in"
          />
          {edited !== null && edited !== defaults && <p className="text-[11px] text-[#464653]">고친 설명은 이 화면을 떠날 때까지 유지됩니다.</p>}
        </div>

        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-[12px] font-bold">
            ② 그 뒤에 붙는 {source}{' '}
            <span className="font-normal text-[#464653]">
              (총 {transcript.segments.length.toLocaleString('ko-KR')}줄 · 약 {transcript.text.length.toLocaleString('ko-KR')}자)
            </span>
          </p>
          <pre className="overflow-x-auto bg-[#eeeeee] p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[#404040] w98-in">
            {blockLines.slice(0, PREVIEW_LINES + 1).join('\n')}
            {blockLines.length > PREVIEW_LINES + 1 && `\n… 이하 ${(blockLines.length - PREVIEW_LINES - 1).toLocaleString('ko-KR')}줄`}
          </pre>
        </div>

        <p className="bg-[#ffffe1] p-2 text-[11px] leading-relaxed w98-flat">
          🔒 복사만 하므로 말모아에서는 아무것도 전송되지 않고 비용도 들지 않습니다. 붙여 넣는 서비스(ChatGPT·Claude 등)로는 원문이 전달됩니다.
        </p>

        <AlertDialogFooter>
          <AlertDialogCancel>닫기</AlertDialogCancel>
          <CopyButton size="sm" className="font-bold" text={() => joinPrompt(instructions, block)}>
            📋 설명 + 원문 복사
          </CopyButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
