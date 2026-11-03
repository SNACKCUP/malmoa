'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { TooltipProvider } from '@/components/malmoa/ui/tooltip'
import { ApiError } from '@/lib/malmoa/api'

let browserQueryClient: QueryClient | undefined

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        // 인증·없는 작업 같은 4xx는 다시 시도해도 같으므로 재시도하지 않는다
        retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
        refetchOnWindowFocus: false,
      },
    },
  })
}

function getQueryClient() {
  // 서버 렌더마다 새로 만들고, 브라우저에서는 하나를 재사용
  if (typeof window === 'undefined') return makeQueryClient()
  browserQueryClient ??= makeQueryClient()
  return browserQueryClient
}

// 루트 레이아웃의 MeerkitProvider(로그인 복원·로그인 창·알림 상자) 안쪽에서 말모아 화면만 감싼다.
// 말모아 화면은 이 QueryClient 를 쓴다 (로그인 상태 자체는 meerkit 의 zustand 저장소 하나).
export function MalmoaProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  )
}
