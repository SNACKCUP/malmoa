import type { ReactNode } from 'react'

/**
 * 회의록 Markdown 표시 (backend/app/services/minutes.py 의 render_markdown 형식에 맞춘 최소 렌더러)
 * 지원: # ~ ###, "- " 목록, ---, **굵게**, *기울임 한 줄*, 일반 문단. '확인 필요'는 강조 표시.
 */

const UNKNOWN = '확인 필요'

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  text.split(/(\*\*[^*]+\*\*)/g).forEach((part, i) => {
    const bold = part.startsWith('**') && part.endsWith('**') && part.length > 4
    const body = bold ? part.slice(2, -2) : part
    const pieces = body.split(UNKNOWN).flatMap((p, j, arr) =>
      j < arr.length - 1
        ? [p, <mark key={`u${i}-${j}`} className="bg-[#ffff00] px-1 font-bold text-black">{UNKNOWN}</mark>]
        : [p],
    )
    out.push(bold ? <strong key={i} className="font-semibold text-foreground">{pieces}</strong> : <span key={i}>{pieces}</span>)
  })
  return out
}

export function MarkdownView({ markdown }: { markdown: string }) {
  const blocks: ReactNode[] = []
  let list: string[] = []

  const flush = () => {
    if (list.length === 0) return
    blocks.push(
      <ul key={`l${blocks.length}`} className="flex list-disc flex-col gap-1.5 pl-5 marker:text-black">
        {list.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>,
    )
    list = []
  }

  markdown.split('\n').forEach((raw, i) => {
    const line = raw.trimEnd()
    if (line.startsWith('- ')) {
      list.push(line.slice(2))
      return
    }
    flush()
    if (!line.trim()) return
    if (line.startsWith('### ')) blocks.push(<h4 key={i} className="mt-1 text-[13px] font-bold">{inline(line.slice(4))}</h4>)
    else if (line.startsWith('## ')) blocks.push(<h3 key={i} className="mt-3 border-b border-[#c6c5d5] pb-0.5 font-heading text-[15px] font-bold first:mt-0">{inline(line.slice(3))}</h3>)
    else if (line.startsWith('# ')) blocks.push(<h2 key={i} className="bg-white px-2 py-1 font-heading text-[16px] font-bold w98-in">{inline(line.slice(2))}</h2>)
    else if (line === '---') blocks.push(<hr key={i} className="my-2 border-shade" />)
    else if (/^\*[^*].*\*$/.test(line)) blocks.push(<p key={i} className="text-[13px] text-muted-foreground italic">{line.slice(1, -1)}</p>)
    else blocks.push(<p key={i}>{inline(line)}</p>)
  })
  flush()

  return <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-foreground">{blocks}</div>
}
