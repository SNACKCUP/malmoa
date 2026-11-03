import type { Metadata } from 'next'
import { Public_Sans, Space_Grotesk, Space_Mono } from 'next/font/google'
import { connection } from 'next/server'
import { Suspense } from 'react'
import { AppShell, ShellFallback } from '@/components/malmoa/app-shell'
import { MalmoaProviders } from '@/components/malmoa/providers'

// 말모아 98 OS 시안의 글꼴: 본문 Public Sans, 제목 Space Grotesk, 숫자·라벨 Space Mono. 한글은 Pretendard로 대체된다
const publicSans = Public_Sans({ variable: '--font-public-sans', subsets: ['latin'] })
const spaceGrotesk = Space_Grotesk({ variable: '--font-space-grotesk', subsets: ['latin'], weight: ['700'] })
const spaceMono = Space_Mono({ variable: '--font-space-mono', subsets: ['latin'], weight: ['400', '700'] })

export const metadata: Metadata = {
  title: {
    default: '말모아 — 녹음은 글로, 회의는 기록으로.',
    template: '%s · 말모아',
  },
  description: '회의 녹음을 텍스트로 변환하고 AI로 회의록을 정리하는 서비스',
}

/**
 * 요청마다 그리는 화면이라고 알린다. 말모아 화면은 AppShell 이 브라우저에서만 그려서(use(browser())) 서버 미리 렌더에는
 * 페이지가 들어가지 않는다. 그래서 /jobs/[id] 처럼 주소 값(params)이 있는 화면의 메타데이터가 "막힘"으로 판정돼
 * 운영 빌드가 멈춘다 (Next 16 Cache Components). 표시는 AppShell 바깥에 있어야 한다.
 */
async function DynamicMarker() {
  await connection()
  return null
}

/**
 * 말모아 화면(98 OS). .malmoa-98 이 있는 동안만 98 색·모서리·글꼴이 켜진다 (components/malmoa/malmoa.css).
 * meerkit 화면(/me, /admin/members 등)은 이 틀 밖이라 meerkit 모습 그대로다 (통합계획 결정 3).
 */
export default function ServiceLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className={`malmoa-98 ${publicSans.variable} ${spaceGrotesk.variable} ${spaceMono.variable} min-h-dvh font-sans text-foreground`}>
      <Suspense>
        <DynamicMarker />
      </Suspense>
      <MalmoaProviders>
        <Suspense fallback={<ShellFallback />}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </MalmoaProviders>
    </div>
  )
}
