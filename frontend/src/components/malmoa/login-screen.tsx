'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/malmoa/ui/button'
import { formatClock } from '@/lib/malmoa/format'
import { cn } from '@/lib/utils'
import { AuthPanel } from '@/meerkit'
import { refreshAccessToken } from '@/meerkit/api/client'
import { useAuthDialog } from '@/meerkit/auth/dialog-store'
import { Brand } from './common'
import { useRecorderContext } from './recorder-context'

/** 로그인이 풀린 동안 로그인 서버에 다시 물어보는 간격 (서버가 깨어나는 중이었으면 저절로 다시 로그인된다) */
const RETRY_MS = 20_000

/**
 * 로그인 전 화면: 바탕화면 가운데 98 창 하나에 meerkit 로그인·가입 폼(AuthPanel)을 넣는다 (CLAUDE.md 11절).
 * 폼 부품은 말모아 98 단추·입력칸(components/ui)으로 그려진다. 비밀번호·아이디 찾기는 meerkit 로그인 창(AuthDialog)을 연다.
 * 로그인에 성공하면 meerkit 저장소에 토큰이 생기고 AppShell 이 바로 바탕화면으로 바꾼다.
 * overlay: 바탕화면 위에 띄운다 (녹음 중 로그인이 풀린 경우). notice: 창 안 위쪽에 보일 안내
 */
export function LoginScreen({ overlay = false, notice }: { overlay?: boolean; notice?: ReactNode }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const openDialog = useAuthDialog((s) => s.openDialog)

  return (
    <div className={cn('flex items-center justify-center px-4 py-10 text-black', overlay ? 'fixed inset-0 z-[60] overflow-y-auto bg-black/40' : 'min-h-dvh')}>
      <section aria-label={mode === 'login' ? '말모아 로그인' : '말모아 회원가입'} className="w-full max-w-sm bg-face p-[3px] shadow-[2px_2px_0_rgba(0,0,0,0.35)] w98-out">
        <div className="flex h-6 items-center px-1 w98-title">
          <h1 className="flex items-center gap-1.5 text-[12px] font-bold tracking-tight text-white">
            <span aria-hidden>🔑</span> 말모아 OS — {mode === 'login' ? '로그인' : '회원가입'}
          </h1>
        </div>
        <div className="grid gap-3 p-3">
          <div className="flex items-center gap-2 border-b border-shade pb-2 shadow-[0_1px_#fff]">
            <Brand />
            <p className="text-[12px]">녹음은 글로, 회의는 기록으로.</p>
          </div>
          {notice}
          <AuthPanel key={mode} mode={mode} onForgotPassword={() => openDialog('forgot')} onFindId={() => openDialog('findId')} />
          <button type="button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')} className="justify-self-center text-[12px] text-primary underline underline-offset-2 hover:text-[#1084d0]">
            {mode === 'login' ? '계정이 없으신가요? 회원가입' : '이미 계정이 있으신가요? 로그인'}
          </button>
        </div>
      </section>
    </div>
  )
}

/**
 * 녹음기를 쓰는 중에 로그인이 풀렸을 때(토큰 갱신 실패·인터넷 끊김·로그인 만료) 바탕화면 위에 띄우는 로그인 창.
 * 녹음은 브라우저 안에서 계속된다. 리프레시 쿠키가 살아 있으면 로그인 서버가 돌아오는 대로 저절로 다시 로그인되고,
 * 아니면 여기서 다시 로그인한다. 녹음 끝내기는 로그인 없이 할 수 있고, 보내기는 로그인 뒤에 한다.
 */
export function SessionLostOverlay() {
  const rec = useRecorderContext()
  const live = rec.status === 'recording' || rec.status === 'paused'

  useEffect(() => {
    const id = window.setInterval(() => void refreshAccessToken(), RETRY_MS)
    return () => window.clearInterval(id)
  }, [])

  return (
    <LoginScreen
      overlay
      notice={
        <div role="alert" className="grid gap-2 bg-[#ffffe1] p-2 text-[12px] w98-in">
          <p>
            <b>로그인이 풀렸습니다.</b>{' '}
            {live ? (
              <>
                녹음은 계속되고 있습니다 (<span className="font-mono tabular-nums">{formatClock(rec.elapsedMs)}</span>).
              </>
            ) : (
              '녹음은 브라우저에 그대로 있습니다.'
            )}{' '}
            다시 로그인하면 이어서 끝내고 보낼 수 있습니다. <b>이 탭을 닫지 마세요.</b>
          </p>
          {live && (
            <Button variant="outline" size="sm" className="justify-self-start" onClick={rec.stop}>
              녹음 끝내기 (보내기는 로그인 뒤)
            </Button>
          )}
        </div>
      }
    />
  )
}
