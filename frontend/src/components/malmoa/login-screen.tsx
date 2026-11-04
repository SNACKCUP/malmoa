'use client'

import { CalendarDays, FileText, FileUp, FolderOpen, Lock, Mic, Settings, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/malmoa/ui/button'
import { useHealth } from '@/hooks/malmoa/queries'
import { formatClock } from '@/lib/malmoa/format'
import { cn } from '@/lib/utils'
import { AuthPanel } from '@/meerkit'
import { refreshAccessToken } from '@/meerkit/api/client'
import { errorMessage } from '@/meerkit/api/error'
import { useAuthDialog } from '@/meerkit/auth/dialog-store'
import { formatRemaining, useLoginLockout, useRemainingLock } from '@/meerkit/auth/lockout'
import { useLogin } from '@/meerkit/auth/mutations'
import { Brand } from './common'
import { useRecorderContext } from './recorder-context'
import { useDragMove } from './use-drag-move'

/** 로그인이 풀린 동안 로그인 서버에 다시 물어보는 간격 (서버가 깨어나는 중이었으면 저절로 다시 로그인된다) */
const RETRY_MS = 20_000

/** 로그인 전 바탕화면 아이콘 (그림일 뿐 누를 수 없다 — 로그인 뒤 AppShell 의 진짜 아이콘으로 바뀐다) */
const DESK_ICONS = [
  { label: '말모아 녹음기', icon: Mic },
  { label: '파일 변환기', icon: FileUp },
  { label: '회의 작업목록', icon: FolderOpen },
  { label: '회의록 뷰어', icon: FileText },
  { label: '말모아 달력', icon: CalendarDays },
  { label: '시스템 설정', icon: Settings },
]

/** 로그인 창 뒤의 잠긴 바탕화면. inert 라 누르거나 탭으로 갈 수 없다 */
function LockedDesktop() {
  return (
    <div inert aria-hidden className="pointer-events-none fixed inset-0 select-none">
      <div className="absolute top-0 bottom-7 left-0 hidden w-24 flex-col items-center gap-3 px-1 py-3 lg:flex">
        {DESK_ICONS.map((a) => (
          <span key={a.label} className="flex w-20 flex-col items-center gap-1 bg-[#eeeeee] px-1 py-1.5 text-center opacity-80 w98-out">
            <a.icon className="size-6 text-[#464653]" />
            <span className="text-[10px] leading-3">{a.label}</span>
          </span>
        ))}
      </div>
      <div className="absolute top-0 right-0 left-0 flex h-8 items-center gap-2 bg-[#eeeeee] px-2 text-[11px] w98-out lg:left-24">
        <span className="flex items-center gap-1.5 font-bold">
          <Brand compact /> (Malmoa) OS v1.0 [KOR]
        </span>
        <span className="text-[#808080]">로그인하면 메뉴를 쓸 수 있습니다</span>
      </div>
      <div className="absolute top-20 right-10 hidden text-right xl:block">
        <p className="font-heading text-[28px] font-bold tracking-[0.2em] text-white/25">MALMOA OS</p>
        <p className="font-mono text-[11px] tracking-[0.25em] text-white/25">녹음은 글로, 회의는 기록으로.</p>
      </div>
      <div className="absolute right-0 bottom-0 left-0 flex h-7 items-center justify-between bg-face px-0.5 w98-out">
        <span className="flex h-[22px] items-center gap-1 px-1.5 text-[12px] font-bold text-[#808080] w98-out">
          <Lock className="size-3.5" /> 시작
        </span>
        <span className="flex h-[22px] items-center px-2 font-mono text-[11px] w98-in">
          <Clock />
        </span>
      </div>
    </div>
  )
}

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(t)
  }, [])
  return (
    <time dateTime={now.toISOString()}>
      {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
    </time>
  )
}

/** 밑줄 친 단축키 글자. accessKey 와 함께 쓴다 (Mac 크롬: Ctrl+Option+글자) */
const Hot = ({ label, k }: { label: string; k: string }) => (
  // 한 덩어리로 — 단추의 gap 이 글자 사이에 끼지 않게
  <span>
    {label}(<u>{k}</u>)
  </span>
)

/**
 * 98 로그인 폼. 로그인·잠금은 meerkit 그대로(useLogin·useLoginLockout) — 모양만 말모아 98 대화상자로 그린다.
 * 로그인에 성공하면 meerkit 저장소에 토큰이 생기고 AppShell 이 바로 바탕화면으로 바꾼다.
 */
function LoginForm({ onSignup }: { onSignup: () => void }) {
  const login = useLogin()
  const lock = useLoginLockout()
  const remaining = useRemainingLock(lock.lockedUntil)
  const locked = remaining > 0
  const openDialog = useAuthDialog((s) => s.openDialog)
  const [userId, setUserId] = useState('')
  const [password, setPassword] = useState('')
  const error = errorMessage(login.error)

  const row = 'grid items-center gap-1 sm:grid-cols-[9rem_1fr]'
  const input = 'h-7 w-full bg-white px-1.5 text-[13px] outline-none w98-in disabled:bg-face disabled:text-shade'
  return (
    <form
      className="grid gap-2.5"
      onSubmit={(e) => {
        e.preventDefault()
        if (!locked) login.mutate({ user_id: userId.trim(), password })
      }}
    >
      <div className={row}>
        <label htmlFor="login-user-id" className="text-[13px] font-bold">
          <Hot label="사용자 아이디" k="U" />:
        </label>
        <input id="login-user-id" accessKey="u" autoComplete="username" required disabled={locked} value={userId} onChange={(e) => setUserId(e.target.value)} className={input} />
      </div>
      <div className={row}>
        <label htmlFor="login-password" className="text-[13px] font-bold">
          <Hot label="암호" k="P" />:
        </label>
        <input id="login-password" accessKey="p" type="password" autoComplete="current-password" required disabled={locked} value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
      </div>

      {locked ? (
        <p role="alert" className="flex items-start gap-2 bg-[#ffffe1] p-2 text-[12px] w98-in">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-[#b00000]" />
          <span>
            <b>로그인이 잠겼습니다.</b> 여러 번 틀려서 <span className="font-mono font-bold">{formatRemaining(remaining)}</span> 뒤에 다시 시도할 수 있습니다.
          </span>
        </p>
      ) : (
        error && (
          <p role="alert" className="bg-[#ffffe1] p-2 text-[12px] text-[#b00000] w98-in">
            {error}
            {lock.attemptsLeft !== null && lock.attemptsLeft > 0 && <span className="ml-1 text-black">(남은 시도 {lock.attemptsLeft}회)</span>}
          </p>
        )
      )}

      <p className="flex items-start gap-1.5 p-1.5 text-[12px] leading-snug w98-group">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[#000080]" aria-hidden />
        녹음·원문·회의록은 로그인한 본인만 볼 수 있습니다. AI 회의록을 만들 때는 원문 텍스트만 AI 서비스로 보냅니다.
      </p>

      <div className="flex flex-wrap justify-end gap-1.5 border-t border-shade pt-2.5 shadow-[inset_0_1px_#fff]">
        <Button type="submit" size="sm" accessKey="o" disabled={login.isPending || locked} className="min-w-20 font-bold">
          {locked ? `잠김 ${formatRemaining(remaining)}` : login.isPending ? '확인 중…' : <Hot label="확인" k="O" />}
        </Button>
        <Button type="button" variant="outline" size="sm" accessKey="i" onClick={() => openDialog('findId')}>
          <Hot label="아이디 찾기" k="I" />
        </Button>
        <Button type="button" variant="outline" size="sm" accessKey="f" onClick={() => openDialog('forgot')}>
          <Hot label="암호 찾기" k="F" />
        </Button>
        <Button type="button" variant="outline" size="sm" accessKey="n" onClick={onSignup} className="text-[#000080]">
          <Hot label="회원가입" k="N" />
        </Button>
      </div>
    </form>
  )
}

/** 창 아래 상태 막대: 말모아 서버에 닿는지 (GET /api/health 는 로그인 없이 된다) */
function ServerStatus() {
  const health = useHealth()
  const ok = health.isSuccess
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-face px-3 py-2 font-mono text-[11px] shadow-[2px_2px_0_rgba(0,0,0,0.35)] w98-out">
      <span className="flex items-center gap-1.5 font-bold">
        <span className={cn('size-2 rounded-full', ok ? 'bg-[#00c040]' : health.isError ? 'bg-[#c00000]' : 'bg-[#808080]')} aria-hidden />
        SERVER: {ok ? '연결됨' : health.isError ? '연결 안 됨 (잠시 뒤 다시 시도)' : '확인 중…'}
      </span>
      <span className="text-[#006a6a]">MALMOA OS · 녹음은 글로, 회의는 기록으로.</span>
    </div>
  )
}

/**
 * 로그인 전 화면: 잠긴 바탕화면 위에 98 로그인 대화상자를 띄운다 (살짝 떠서 오르내림 — malmoa.css .malmoa-float).
 * 가입은 meerkit 폼(AuthPanel, 약관·이메일 인증 포함)을 같은 창 안에 넣는다. 비밀번호·아이디 찾기는 meerkit 대화상자.
 * overlay: 바탕화면 위에 띄운다 (녹음 중 로그인이 풀린 경우 — 뒤의 진짜 바탕화면이 보인다). notice: 창 안 위쪽에 보일 안내
 */
export function LoginScreen({ overlay = false, notice }: { overlay?: boolean; notice?: ReactNode }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const openDialog = useAuthDialog((s) => s.openDialog)
  const signup = mode === 'signup'
  const drag = useDragMove()

  return (
    <div className={cn('flex items-center justify-center px-4 py-14 text-black', overlay ? 'fixed inset-0 z-[60] overflow-y-auto bg-black/40' : 'min-h-dvh')}>
      {!overlay && <LockedDesktop />}
      {/* 바깥: 끌어 옮긴 자리(translate), 안쪽: 둥둥 움직임 — 끄는 동안은 멈춘다 */}
      <div data-drag-root style={drag.style} className="relative w-full max-w-xl">
      <div className={cn('malmoa-float grid gap-3', drag.dragging && 'paused')}>
        <section role="dialog" aria-modal="true" aria-labelledby="malmoa-login-title" className="bg-face p-[3px] shadow-[3px_3px_0_rgba(0,0,0,0.4)] w98-out">
          <div {...drag.handle} className="flex h-6 cursor-move touch-none items-center px-1 select-none w98-title">
            <h1 id="malmoa-login-title" className="flex items-center gap-1.5 text-[12px] font-bold tracking-tight text-white">
              <span aria-hidden>🔑</span> 말모아 OS {signup ? '회원가입' : '로그인'} v1.0
            </h1>
          </div>
          <div className="grid gap-3 p-2.5">
            <div className="flex items-center gap-3 bg-white p-2.5 w98-in">
              <span className="grid size-14 shrink-0 place-items-center bg-[#000080] text-white w98-out" aria-hidden>
                <span className="grid justify-items-center gap-0.5">
                  <Lock className="size-6" />
                  <span className="font-mono text-[9px] font-bold">SECURE</span>
                </span>
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[15px] font-bold">
                  {signup ? '새 사용자 등록' : '사용자 인증'}
                  <span className="text-[#808080]">·</span>
                  <Brand compact />
                </p>
                <p className="mt-0.5 text-[12px] leading-snug text-[#404040]">
                  {signup ? '가입한 뒤 관리자가 사용을 승인하면 녹음기·회의록·달력을 쓸 수 있습니다.' : '말모아 녹음기·회의록·달력을 쓰려면 아이디와 암호를 넣으세요.'}
                </p>
              </div>
            </div>
            {notice}
            {signup ? (
              <div className="grid gap-2.5">
                <div className="max-h-[60dvh] overflow-y-auto bg-white p-3 w98-in">
                  <AuthPanel mode="signup" onForgotPassword={() => openDialog('forgot')} onFindId={() => openDialog('findId')} />
                </div>
                <div className="flex justify-end border-t border-shade pt-2.5 shadow-[inset_0_1px_#fff]">
                  <Button type="button" variant="outline" size="sm" onClick={() => setMode('login')}>
                    ← 로그인으로
                  </Button>
                </div>
              </div>
            ) : (
              <LoginForm onSignup={() => setMode('signup')} />
            )}
          </div>
        </section>
        {!overlay && <ServerStatus />}
      </div>
      </div>
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
