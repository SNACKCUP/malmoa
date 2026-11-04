import { Info } from "lucide-react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { type Kind, legalContent, type Section } from "./content";

// 본문은 content.ts 에 있다. 이 파일은 화면 모양만 정의한다.
function Body({ section }: { section: Section }) {
  return (
    <>
      {section.paragraphs?.map((text) => (
        <p key={text} className="mt-2 text-[15px] leading-7 text-foreground/80">
          {text}
        </p>
      ))}
      {section.items && (
        <ol className="mt-2 grid list-decimal gap-1.5 pl-5 text-[15px] leading-7 text-foreground/80">
          {section.items.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ol>
      )}
      {section.table && (
        <div className="mt-3 overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                {section.table.head.map((label) => (
                  <TableHead key={label}>{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {section.table.rows.map((row) => (
                <TableRow key={row.join("|")}>
                  {row.map((cell, i) => (
                    <TableCell key={i} className="align-top whitespace-normal text-[13px] leading-6">
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {section.notes && (
        <ul className="mt-3 grid list-disc gap-1.5 pl-5 text-[14px] leading-6 text-foreground/70">
          {section.notes.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      )}
    </>
  );
}

export function LegalPage({ kind }: { kind: Kind }) {
  const doc = legalContent[kind];
  return (
    <div className="min-h-screen">
      <main className="mk-rise mx-auto w-full max-w-3xl px-6 py-14">
        <h1 className="text-3xl font-semibold tracking-tight">{doc.title}</h1>
        <p className="mt-2 text-[13px] text-foreground/60">
          시행일 {doc.effectiveDate} · 버전 {doc.version}
        </p>
        <div className="mt-5 flex gap-3 rounded-2xl border bg-surface p-4 text-[13px] leading-6 text-foreground/80 shadow-soft">
          <Info className="mt-0.5 size-4 shrink-0 text-brand" />
          <p>
            이 문서는 <strong>샘플 문서</strong>입니다. 실제 서비스로 운영하기 전에 법무 검토를 거쳐 확정합니다.
          </p>
        </div>
        {doc.intro && <p className="mt-8 text-[15px] leading-7 text-foreground/80">{doc.intro}</p>}
        <div className="mt-8 grid gap-7">
          {doc.sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-base font-semibold">{section.title}</h2>
              <Body section={section} />
            </section>
          ))}
        </div>
        <p className="mt-10 text-[14px] text-foreground/70">{doc.closing}</p>
      </main>
    </div>
  );
}
