import Link from 'next/link'
import type { Kind, Section } from '@/meerkit/legal/content'
import { malmoaLegal } from './content'

function Body({ section }: { section: Section }) {
  return (
    <>
      {section.paragraphs?.map((text) => (
        <p key={text} className="mt-1.5 text-[13px] leading-6">
          {text}
        </p>
      ))}
      {section.items && (
        <ol className="mt-1.5 grid list-decimal gap-1 pl-5 text-[13px] leading-6">
          {section.items.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ol>
      )}
      {section.table && (
        <div className="mt-2 overflow-x-auto bg-white w98-in">
          <table className="w-full border-collapse text-[12px] leading-5">
            <thead>
              <tr>
                {section.table.head.map((label) => (
                  <th key={label} className="border-r border-b border-shade bg-face px-2 py-1 text-left font-bold last:border-r-0">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.table.rows.map((row) => (
                <tr key={row.join('|')}>
                  {row.map((cell, i) => (
                    <td key={i} className="border-r border-b border-dotted border-shade px-2 py-1 align-top last:border-r-0">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {section.notes && (
        <ul className="mt-2 grid list-disc gap-1 pl-5 text-[12px] leading-5 text-[#404040]">
          {section.notes.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      )}
    </>
  )
}

/**
 * 말모아 이용약관·개인정보 처리방침 (98 창). 로그인 전에도 봐야 하므로 AppShell 밖에서 .malmoa-98 틀만 쓴다.
 * 본문은 ./content.ts (meerkit 본문은 킷이라 고치지 않음).
 */
export function LegalView({ kind }: { kind: Kind }) {
  const doc = malmoaLegal[kind]
  const other = kind === 'terms' ? { href: '/privacy', label: '개인정보 처리방침' } : { href: '/terms', label: '이용약관' }
  return (
    <div className="malmoa-98 min-h-dvh px-3 py-8 font-sans text-black">
      <article className="mx-auto w-full max-w-3xl bg-face p-[3px] shadow-[2px_2px_0_rgba(0,0,0,0.35)] w98-out">
        <header className="flex h-6 items-center px-1 w98-title">
          <h1 className="flex items-center gap-1.5 text-[12px] font-bold">
            <span aria-hidden>📜</span> {doc.title}
          </h1>
        </header>
        <div className="grid gap-4 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-shade pb-2 text-[12px] shadow-[0_1px_#fff]">
            <span>
              시행일 {doc.effectiveDate} · 버전 {doc.version}
            </span>
            <nav className="flex gap-3">
              <Link href={other.href} className="text-primary underline underline-offset-2">
                {other.label}
              </Link>
              <Link href="/" className="text-primary underline underline-offset-2">
                말모아로
              </Link>
            </nav>
          </div>
          <p role="note" className="bg-[#ffffe1] p-2 text-[12px] leading-5 w98-in">
            이 문서는 <b>초안</b>입니다. 서비스를 시작하기 전에 운영자와 법무 검토를 거쳐 확정합니다.
          </p>
          {doc.intro && <p className="text-[13px] leading-6">{doc.intro}</p>}
          {doc.sections.map((section) => (
            <section key={section.title} className="bg-[#dfdfdf] p-3 w98-group">
              <h2 className="font-heading text-[14px] font-bold">{section.title}</h2>
              <Body section={section} />
            </section>
          ))}
          <p className="text-[12px] text-[#404040]">{doc.closing}</p>
        </div>
      </article>
    </div>
  )
}
