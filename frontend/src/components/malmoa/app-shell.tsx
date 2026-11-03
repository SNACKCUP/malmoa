'use client'

import { CalendarDays, FileText, FileUp, FolderOpen, Mic, Settings, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { createContext, use, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { browser } from 'react-dom'
import { useHealth, useJobs } from '@/hooks/malmoa/queries'
import { cn } from '@/lib/utils'
import { isAdminUser, useAuth, useLogout } from '@/meerkit'
import { useAuthStore } from '@/meerkit/auth/store'
import { useRecorderBusy } from '@/stores/malmoa/recorderBusy'
import { Brand } from './common'
import { LoginScreen, SessionLostOverlay } from './login-screen'
import { PendingApproval, isMalmoaApproved } from './pending-approval'
import { RecorderProvider, useRecorderContext } from './recorder-context'
import { ReminderToasts } from './reminder-toasts'
import { NextEventBadge, useNextEvent } from './next-event'

// 말모아 98 OS (stitch_ 시안): 위 메뉴 막대 · 왼쪽 바탕화면 아이콘 · 아래 작업 표시줄. 화면마다 큰 창 하나를 띄운다.

type AppKey = 'rec' | 'upload' | 'jobs' | 'viewer' | 'calendar' | 'settings' | 'guide'

interface App {
  key: Exclude<AppKey, 'guide'>
  href: string
  label: string
  task: string
  icon: LucideIcon
}

function appKeyOf(pathname: string): AppKey | null {
  if (pathname === '/') return 'rec'
  if (pathname.startsWith('/upload')) return 'upload'
  if (pathname === '/jobs') return 'jobs'
  if (pathname.startsWith('/jobs/')) return 'viewer'
  if (pathname.startsWith('/calendar')) return 'calendar'
  if (pathname.startsWith('/settings')) return 'settings'
  if (pathname.startsWith('/guide')) return 'guide'
  return null
}

/** 회의록 뷰어 아이콘은 가장 최근에 변환이 끝난 작업을 연다 (없으면 작업 목록) */
function useApps(): App[] {
  const jobs = useJobs()
  const latest = jobs.data?.find((j) => j.transcriptReady)
  return [
    { key: 'rec', href: '/', label: '말모아 녹음기', task: '🎙️ 말모아 녹음기 v1.0', icon: Mic },
    { key: 'upload', href: '/upload', label: '파일 변환기', task: '📁 파일 업로드 & 변환', icon: FileUp },
    { key: 'jobs', href: '/jobs', label: '회의 작업목록', task: '📋 회의 작업 목록', icon: FolderOpen },
    { key: 'viewer', href: latest ? `/jobs/${latest.id}` : '/jobs', label: '회의록 뷰어', task: '📝 회의록 뷰어', icon: FileText },
    { key: 'calendar', href: '/calendar', label: '말모아 달력', task: '📅 말모아 달력', icon: CalendarDays },
    { key: 'settings', href: '/settings', label: '시스템 설정', task: '⚙️ 시스템 설정', icon: Settings },
  ]
}

// ── 창 상태 (최소화·최대화): 화면을 옮기면 처음 상태로 ──
interface WindowState {
  min: boolean
  max: boolean
  setMin: (v: boolean) => void
  setMax: (v: boolean) => void
}
const WindowContext = createContext<WindowState>({ min: false, max: false, setMin: () => {}, setMax: () => {} })
export const useWindowState = () => useContext(WindowContext)

/** 작업 표시줄 시계 (15초마다 갱신) */
function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(t)
  }, [])
  return (
    <time dateTime={now.toISOString()} aria-label="현재 시각" className="font-mono text-[11px] tabular-nums">
      {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
    </time>
  )
}

/** 메뉴 막대의 내림 메뉴 하나. 바깥을 누르거나 Esc로 닫힌다 */
export function Menu({ label, hot, active, items }: { label: string; hot: string; active?: boolean; items: { label: string; href?: string; onSelect?: () => void }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn('px-1.5 py-0.5 text-[11px] whitespace-nowrap outline-none hover:bg-[#000080] hover:text-white focus-visible:bg-[#000080] focus-visible:text-white', (open || active) && 'bg-[#000080] text-white')}
      >
        {label}(<u>{hot}</u>)
      </button>
      {open && (
        <ul role="menu" className="absolute top-full left-0 z-50 mt-0.5 min-w-44 p-[3px] text-[12px] shadow-[2px_2px_0_rgba(0,0,0,0.5)] w98-out">
          {items.map((it) => (
            <li key={it.label} role="none">
              {it.href ? (
                <Link role="menuitem" href={it.href} onClick={() => setOpen(false)} className="block px-5 py-1 hover:bg-[#000080] hover:text-white focus-visible:bg-[#000080] focus-visible:text-white focus-visible:outline-none">
                  {it.label}
                </Link>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false)
                    it.onSelect?.()
                  }}
                  className="block w-full px-5 py-1 text-left hover:bg-[#000080] hover:text-white focus-visible:bg-[#000080] focus-visible:text-white focus-visible:outline-none"
                >
                  {it.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** 로그아웃하면 말모아 화면 데이터(작업·일정 등)를 비운다. 다음에 로그인한 사람에게 앞사람의 목록이 잠깐이라도 보이지 않게 */
function useClearDataOnSignOut() {
  const queryClient = useQueryClient()
  const token = useAuthStore((s) => s.accessToken)
  const signedIn = useRef(false)
  useEffect(() => {
    if (token) signedIn.current = true
    else if (signedIn.current) {
      signedIn.current = false
      queryClient.clear()
    }
  }, [token, queryClient])
}

/**
 * 화면의 틀. 녹음기·창 상태가 브라우저 저장소(localStorage)와 마이크를 쓰므로 브라우저에서만 그린다.
 * (Cache Components가 클라이언트 컴포넌트도 미리 렌더하므로 use(browser())로 서버 렌더에서 제외)
 * 로그인은 meerkit(CLAUDE.md 11절): 새로고침 뒤 세션을 복원하는 동안은 기다리고, 로그인 전이면 로그인 창을 띄운다.
 * 녹음기를 쓰는 중에 로그인이 풀리면(토큰 갱신 실패·인터넷 끊김·로그인 만료) 화면을 로그인 창으로 바꾸지 않는다 —
 * 녹음기가 화면에서 빠지면 녹음이 멈추기 때문이다. 바탕화면은 그대로 두고 그 위에 로그인 창을 띄운다.
 */
export function AppShell({ children }: { children: ReactNode }) {
  use(browser('녹음기 설정이 브라우저 저장소에 있어 서버에서 그릴 수 없습니다.'))
  const { isAuthenticated, isLoading, user } = useAuth()
  const recorderBusy = useRecorderBusy((s) => s.busy)
  useClearDataOnSignOut()

  if (!recorderBusy) {
    if (isLoading) return <ShellFallback message="로그인 확인 중…" />
    if (!isAuthenticated) return <LoginScreen />
    // 관리자가 사용 승인(OWNER)을 주기 전 (통합 단계 5-1). 서버도 403 MALMOA_NOT_APPROVED 로 막는다
    if (user && !isMalmoaApproved(user)) return <PendingApproval user={user} />
  }
  return (
    <RecorderProvider>
      <ReminderToasts />
      <Desktop>{children}</Desktop>
      {!isAuthenticated && <SessionLostOverlay />}
    </RecorderProvider>
  )
}

function Desktop({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const apps = useApps()
  const current = appKeyOf(pathname)
  const health = useHealth()
  const rec = useRecorderContext()
  const [startOpen, setStartOpen] = useState(false)
  const startRef = useRef<HTMLDivElement>(null)
  const [win, setWin] = useState({ path: pathname, min: false, max: false })
  // 화면을 옮기면 창은 보통 크기로 다시 연다
  const state = win.path === pathname ? win : { path: pathname, min: false, max: false }
  const windowState: WindowState = {
    min: state.min,
    max: state.max,
    setMin: (v) => setWin({ ...state, min: v }),
    setMax: (v) => setWin({ ...state, max: v }),
  }

  useEffect(() => {
    if (!startOpen) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !startRef.current?.contains(e.target as Node)) setStartOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [startOpen])

  const href = (k: App['key']) => apps.find((a) => a.key === k)!.href
  const whisperOk = health.isSuccess && health.data.ffmpeg
  const recording = rec.status === 'recording'
  const lit = recording ? Math.round(rec.level * 5) : 0
  const nextEvent = useNextEvent()
  const { user } = useAuth()
  const logout = useLogout()
  const signOut = () => logout.mutate()
  const admin = isAdminUser(user)

  return (
    <WindowContext value={windowState}>
      <div className="min-h-dvh text-black">
        <a href="#malmoa-main" className="sr-only z-50 bg-face px-4 py-2 focus:not-sr-only focus:fixed focus:top-10 focus:left-3">
          본문으로 건너뛰기
        </a>

        {/* 왼쪽 바탕화면 아이콘 */}
        <aside className="fixed top-0 bottom-7 left-0 z-10 hidden w-24 flex-col items-center gap-3 px-1 py-3 lg:flex">
          <nav aria-label="바탕화면 아이콘" className="flex flex-col items-center gap-3">
            {apps.map((a) => {
              const here = current === a.key
              return (
                <Link
                  key={a.key}
                  href={a.href}
                  aria-current={here ? 'page' : undefined}
                  className={cn(
                    // 네모 단추 하나에 아이콘과 이름. 누르는 동안·지금 화면은 눌린 채 남색 바탕 + 흰 글씨
                    'group flex w-20 flex-col items-center gap-1 px-1 py-1.5 text-center outline-none w98-out focus-visible:outline-1 focus-visible:outline-dotted focus-visible:-outline-offset-4 focus-visible:outline-white active:bg-[#000080] active:text-white active:w98-pressed',
                    here ? 'bg-[#000080] font-bold text-white w98-pressed' : 'bg-[#eeeeee] text-black hover:bg-[#dfdfdf]',
                  )}
                >
                  <a.icon
                    className={cn('size-6 group-active:text-white', here ? 'text-white' : a.key === 'rec' ? 'text-[#00003c]' : a.key === 'upload' ? 'text-[#006a6a]' : 'text-[#464653]')}
                    aria-hidden
                  />
                  <span className="text-[10px] leading-3">{a.label}</span>
                </Link>
              )
            })}
          </nav>
        </aside>

        {/* 위 메뉴 막대 */}
        <header className="fixed top-0 right-0 left-0 z-20 flex h-8 items-center justify-between gap-2 bg-[#eeeeee] px-2 w98-out lg:left-24">
          <div className="flex min-w-0 items-center gap-2">
            <Link href="/" className="shrink-0 text-[11px] font-bold tracking-tight" aria-label="말모아 녹음기로">
              <span className="sm:hidden">
                <Brand recording={recording} />
              </span>
              <span className="hidden items-center gap-1.5 sm:flex">
                <Brand recording={recording} compact /> (Malmoa) OS v1.0 [KOR]
              </span>
            </Link>
            <nav aria-label="메뉴" className="ml-1 flex items-center gap-0.5 overflow-x-auto sm:overflow-visible">
              <Menu
                label="파일"
                hot="F"
                active={current === 'jobs' || current === 'upload'}
                items={[
                  { label: '새 녹음', href: '/' },
                  { label: '파일 업로드 & 변환', href: '/upload' },
                  { label: '회의 작업 목록', href: '/jobs' },
                  { label: '내 정보', href: '/me' },
                  { label: '로그아웃', onSelect: signOut },
                ]}
              />
              <Menu
                label="편집"
                hot="E"
                active={current === 'viewer'}
                items={[
                  { label: '회의록 뷰어', href: href('viewer') },
                  { label: '참석자 명단', href: '/settings#people' },
                ]}
              />
              <Menu label="녹음" hot="R" active={current === 'rec'} items={[{ label: '말모아 녹음기', href: '/' }]} />
              <Menu
                label="보기"
                hot="V"
                active={current === 'calendar'}
                items={[
                  { label: '말모아 달력', href: '/calendar' },
                  { label: '회의 작업 목록', href: '/jobs' },
                ]}
              />
              <Menu
                label="도구"
                hot="T"
                active={current === 'settings'}
                items={[
                  { label: '시스템 설정', href: '/settings' },
                  { label: '아이폰 일정 알림', href: '/settings#calendar-sync' },
                  ...(admin ? [{ label: '회원 관리 (관리자)', href: '/admin/members' }] : []),
                ]}
              />
              <Menu
                label="도움말"
                hot="H"
                active={current === 'guide'}
                items={[
                  { label: '사용 안내', href: '/guide' },
                  { label: '문제 해결', href: '/guide#faq' },
                ]}
              />
            </nav>
          </div>
          <div className="flex min-w-0 shrink-0 items-center gap-1">
            {user && (
              <Link href="/me" className="max-w-32 truncate bg-white px-1 text-[11px] w98-in hover:underline" title={`내 정보: ${user.name} (${user.email})`}>
                👤 {user.name}
              </Link>
            )}
            <span className="hidden shrink-0 bg-white px-1 font-mono text-[10px] font-bold text-[#006a6a] uppercase w98-in sm:inline">
              LOCAL: {health.data ? `WHISPER-${health.data.whisperModel}` : health.isError ? '서버 연결 안 됨' : '확인 중'}
            </span>
          </div>
        </header>

        <main id="malmoa-main" tabIndex={-1} className="min-h-dvh px-2 pt-10 pb-10 outline-none sm:px-3 lg:pl-27">
          {children}
        </main>

        {/* 아래 작업 표시줄 */}
        <footer className="fixed right-0 bottom-0 left-0 z-30 flex h-7 items-center justify-between gap-1 bg-face px-0.5 w98-out">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <div ref={startRef} className="relative shrink-0">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={startOpen}
                onClick={() => setStartOpen((v) => !v)}
                className={cn('flex h-[22px] items-center gap-1 px-1.5 text-[12px] font-bold outline-none w98-out', startOpen && 'w98-pressed')}
              >
                <span aria-hidden className="grid size-3.5 grid-cols-2 gap-px">
                  <span className="bg-[#ff0000]" />
                  <span className="bg-[#00a000]" />
                  <span className="bg-[#0000ff]" />
                  <span className="bg-[#ffd700]" />
                </span>
                시작
              </button>
              {startOpen && (
                <ul role="menu" className="absolute bottom-full left-0 mb-1 flex min-w-52 flex-col p-[3px] text-[12px] shadow-[2px_2px_0_rgba(0,0,0,0.5)] w98-out">
                  <li role="none" className="w98-title mb-1 px-2 py-1 text-[11px] font-bold">
                    말모아 OS
                  </li>
                  {apps.map((a) => (
                    <li key={a.key} role="none">
                      <Link role="menuitem" href={a.href} onClick={() => setStartOpen(false)} className="flex items-center gap-2 px-2 py-1.5 hover:bg-[#000080] hover:text-white">
                        <a.icon className="size-4" aria-hidden /> {a.label}
                      </Link>
                    </li>
                  ))}
                  {admin && (
                    <li role="none">
                      <Link role="menuitem" href="/admin/members" onClick={() => setStartOpen(false)} className="flex items-center gap-2 border-t border-shade px-2 py-1.5 shadow-[inset_0_1px_#fff] hover:bg-[#000080] hover:text-white">
                        👥 회원 관리
                      </Link>
                    </li>
                  )}
                  <li role="none">
                    <Link role="menuitem" href="/me" onClick={() => setStartOpen(false)} className="flex items-center gap-2 border-t border-shade px-2 py-1.5 shadow-[inset_0_1px_#fff] hover:bg-[#000080] hover:text-white">
                      👤 내 정보
                    </Link>
                  </li>
                  <li role="none">
                    <Link role="menuitem" href="/guide" onClick={() => setStartOpen(false)} className="flex items-center gap-2 px-2 py-1.5 hover:bg-[#000080] hover:text-white">
                      ❓ 사용 안내
                    </Link>
                  </li>
                  <li role="none">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setStartOpen(false)
                        signOut()
                      }}
                      className="flex w-full items-center gap-2 border-t border-shade px-2 py-1.5 text-left shadow-[inset_0_1px_#fff] hover:bg-[#000080] hover:text-white"
                    >
                      🔒 로그아웃{user ? ` (${user.name})` : ''}
                    </button>
                  </li>
                </ul>
              )}
            </div>
            <span aria-hidden className="h-5 w-0.5 shrink-0 border-l border-shade bg-white" />
            <nav aria-label="작업 표시줄" className="flex min-w-0 items-center gap-1 overflow-x-auto">
              {apps.map((a) => {
                const here = current === a.key
                return (
                  <button
                    key={a.key}
                    type="button"
                    aria-pressed={here}
                    onClick={() => {
                      // 지금 창의 단추를 누르면 최소화·복원, 다른 창이면 그 화면으로
                      if (here) windowState.setMin(!state.min)
                      else router.push(a.href)
                    }}
                    className={cn('flex h-[22px] shrink-0 items-center px-2 text-[11px] whitespace-nowrap outline-none', here && !state.min ? 'bg-[#dadada] font-bold w98-checked' : 'w98-out')}
                  >
                    {a.task}
                  </button>
                )
              })}
            </nav>
          </div>
          {nextEvent && <NextEventBadge next={nextEvent} className="hidden h-[22px] max-w-72 shrink text-[11px] w98-in sm:flex" />}
          <div className="flex h-[22px] shrink-0 items-center gap-2 px-2 w98-in">
            <span className="flex items-center gap-1" title={whisperOk ? '이 Mac의 Whisper 사용 가능' : 'Whisper 확인 필요'}>
              <span className={cn('size-2', whisperOk ? 'bg-[#00e639]' : 'bg-[#808080]')} aria-hidden />
              <span className="hidden font-mono text-[10px] sm:inline">WHISPER</span>
            </span>
            <span className="hidden h-3 items-end gap-px sm:flex" title="마이크 입력 레벨" aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className={cn('h-full w-1', i < lit ? (i === 4 ? 'bg-[#ff0000]' : 'bg-[#00e639]') : 'bg-[#808080]')} />
              ))}
            </span>
            <Clock />
          </div>
        </footer>
      </div>
    </WindowContext>
  )
}

export function ShellFallback({ message = '말모아 OS를 여는 중…' }: { message?: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center" role="status">
      <p className="px-4 py-2 text-[13px] font-bold w98-out">{message}</p>
    </div>
  )
}

/**
 * 화면 하나 = 98 창 하나. 제목 막대의 _ □ ✕ 는 최소화(작업 표시줄에서 복원) · 최대화(바탕화면 전체) · 닫기(녹음기로).
 * statusBar는 창 맨 아래 상태 표시줄.
 */
export function OsWindow({
  title,
  icon,
  width = 'max-w-none',
  menu,
  statusBar,
  children,
}: {
  title: ReactNode
  icon?: ReactNode
  width?: string
  menu?: ReactNode
  statusBar?: ReactNode
  children: ReactNode
}) {
  const { min, max, setMin, setMax } = useWindowState()
  const router = useRouter()
  const pathname = usePathname()
  return (
    <section
      aria-label={typeof title === 'string' ? title : undefined}
      className={cn('flex flex-col bg-face p-[3px] shadow-[2px_2px_0_rgba(0,0,0,0.35)] w98-out', max ? 'fixed top-8 right-0 bottom-7 left-0 z-20 overflow-auto lg:left-24' : cn('mx-auto w-full', width))}
    >
      <div className="flex h-6 shrink-0 items-center justify-between gap-2 px-1 w98-title">
        <h1 className="flex min-w-0 items-center gap-1.5 text-[12px] font-bold tracking-tight text-white">
          {icon && <span className="shrink-0 leading-none">{icon}</span>}
          <span className="truncate">{title}</span>
        </h1>
        <div className="flex shrink-0 items-center gap-0.5">
          <TitleButton label={min ? '창 펼치기' : '최소화'} onClick={() => setMin(!min)}>
            _
          </TitleButton>
          <TitleButton label={max ? '이전 크기로' : '최대화'} onClick={() => setMax(!max)}>
            {max ? '❐' : '□'}
          </TitleButton>
          <TitleButton label={pathname === '/' ? '최소화' : '닫고 녹음기로'} onClick={() => (pathname === '/' ? setMin(true) : router.push('/'))}>
            ✕
          </TitleButton>
        </div>
      </div>
      {!min && (
        <>
          {menu && <div className="flex flex-wrap items-center gap-1 border-b border-[#c6c5d5]/50 px-1 py-0.5 text-[11px]">{menu}</div>}
          <div className="min-w-0 flex-1 p-2">{children}</div>
          {statusBar && <div className="flex flex-wrap items-stretch gap-1 px-0.5 pb-0.5 text-[11px]">{statusBar}</div>}
        </>
      )}
    </section>
  )
}

function TitleButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="grid size-4 place-items-center bg-face text-[10px] leading-none font-bold text-black outline-none w98-out active:w98-pressed">
      <span aria-hidden>{children}</span>
    </button>
  )
}

/** 창 상태 표시줄의 칸 하나 (움푹 들어간 칸) */
export function StatusCell({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn('flex min-w-0 items-center gap-1 px-1.5 py-0.5 w98-flat', className)}>{children}</span>
}

/** 창 안 구획: 새긴 테두리 + 남색 굵은 제목 (시안의 fieldset) */
export function Fieldset({ title, className, children }: { title: ReactNode; className?: string; children: ReactNode }) {
  return (
    <fieldset className={cn('min-w-0 bg-[#f4f3f3] px-2.5 pt-1 pb-2.5 w98-group', className)}>
      <legend className="ml-1 bg-[#f4f3f3] px-1 text-[13px] font-bold text-[#000080]">{title}</legend>
      {children}
    </fieldset>
  )
}
