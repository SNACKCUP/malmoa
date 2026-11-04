'use client'

import { Check } from 'lucide-react'
import { useState, type ComponentProps, type ReactNode } from 'react'
import { Button } from '@/components/malmoa/ui/button'

/** 클립보드 복사 버튼. 누른 뒤 2초간 결과를 보여 준다. */
export function CopyButton({ text, children, ...props }: { text: () => string; children: ReactNode } & Omit<ComponentProps<typeof Button>, 'onClick' | 'children'>) {
  const [result, setResult] = useState<'ok' | 'fail' | null>(null)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text())
      setResult('ok')
    } catch {
      setResult('fail')
    }
    window.setTimeout(() => setResult(null), 2000)
  }

  return (
    <Button {...props} onClick={copy} aria-live="polite">
      {result === 'ok' ? (
        <>
          <Check /> 복사되었습니다
        </>
      ) : result === 'fail' ? (
        '복사하지 못했습니다'
      ) : (
        children
      )}
    </Button>
  )
}
