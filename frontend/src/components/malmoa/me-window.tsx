'use client'

import { KeyRound, LogOut, Pencil, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/malmoa/ui/button'
import { useHealth, useJobs, useLlmSettings, useUsage } from '@/hooks/malmoa/queries'
import { formatBytes } from '@/lib/malmoa/format'
import { cn } from '@/lib/utils'
import { isAdminUser, MeAvatarField, MeNicknameForm, MePasswordForm, MeProfileForm, MeWithdrawForm, useAuth, useLogout, type User } from '@/meerkit'
import { Fieldset } from './app-shell'
import { isMalmoaApproved } from './pending-approval'
import { useDragMove } from './use-drag-move'

type Tab = 'general' | 'profile' | 'password' | 'withdraw'

const TABS: { key: Tab; label: string }[] = [
  { key: 'general', label: '일반 / 계정 정보' },
  { key: 'profile', label: '프로필 수정' },
  { key: 'password', label: '암호 변경' },
  { key: 'withdraw', label: '회원 탈퇴' },
]

function roleLabel(user: User) {
  if (isAdminUser(user)) return '시스템 관리자 (MASTER)'
  if (isMalmoaApproved(user)) return '말모아 사용자 (OWNER)'
  return '사용 승인 대기'
}

/** 읽기 전용 칸 (98 움푹 들어간 흰 칸) */
function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid min-w-0 gap-1">
      <span className="text-[12px] font-bold">{label}:</span>
      <span className={cn('flex h-7 min-w-0 items-center gap-2 bg-white px-1.5 text-[13px] w98-in', mono && 'font-mono')}>{children}</span>
    </div>
  )
}

/** 숫자 상자 하나 (시안의 세 칸) */
function Stat({ title, value, note }: { title: string; value: ReactNode; note: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5 bg-white p-2 w98-in">
      <span className="text-[11px]">{title}</span>
      <span className="font-heading text-[20px] leading-tight font-bold">{value}</span>
      <span className="truncate font-mono text-[10px] text-[#006a6a] uppercase">{note}</span>
    </div>
  )
}

/** 내 말모아 데이터: 작업·녹음 용량·AI 사용량 (승인된 회원만 — 아니면 서버가 403) */
function MyData() {
  const jobs = useJobs()
  const usage = useUsage()
  const list = jobs.data ?? []
  const bytes = list.reduce((sum, j) => sum + j.sizeBytes, 0)
  const done = list.filter((j) => j.minutesReady).length
  const month = usage.data?.month
  const limit = usage.data?.monthlyTokens ?? null
  return (
    <Fieldset title="내 말모아 데이터">
      <div className="grid gap-2 pt-1 sm:grid-cols-3">
        <Stat title="회의 작업" value={jobs.isSuccess ? `${list.length}건` : '…'} note={`회의록 완료 ${done}건`} />
        <Stat title="보관 중인 녹음·사진 원본" value={jobs.isSuccess ? formatBytes(bytes) : '…'} note="본인만 볼 수 있음" />
        <Stat
          title="이번 달 AI 사용"
          value={month ? `${month.tokens.toLocaleString()} 토큰` : '…'}
          note={month ? `호출 ${month.calls}회${limit ? ` · 한도 ${limit.toLocaleString()}` : ' · 한도 없음'}` : '확인 중'}
        />
      </div>
      <div className="mt-2 flex justify-end gap-1.5">
        <Button asChild variant="outline" size="sm">
          <Link href="/jobs">회의 작업 목록</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/settings">사용량·한도 설정</Link>
        </Button>
      </div>
    </Fieldset>
  )
}

/** 음성 변환·AI 연결 상태 (읽기 전용 — 바꾸기는 시스템 설정) */
function Engines() {
  const health = useHealth()
  const llm = useLlmSettings()
  const h = health.data
  const l = llm.data
  return (
    <div className="grid gap-2 md:grid-cols-2">
      <Fieldset title="음성 변환 (Whisper)">
        <ul className="grid gap-1 pt-1 text-[12px]">
          <li className="flex items-center gap-1.5">
            <span className={cn('size-2.5', h?.transcriber === 'local_whisper' && h.ffmpeg ? 'bg-[#00a000]' : 'bg-[#808080]')} aria-hidden />
            {h ? (h.transcriber === 'local_whisper' ? `Whisper ${h.whisperModel} 모델 · ffmpeg ${h.ffmpeg ? '확인됨' : '없음'}` : 'Mac 작업자가 변환합니다') : health.isError ? '서버 연결 안 됨' : '확인 중…'}
          </li>
          <li className="text-[#404040]">녹음 파일은 외부 AI 로 보내지 않고 Whisper 로 글자로 바꿉니다. {h && `파일 한 개 최대 ${h.maxUploadMb}MB.`}</li>
        </ul>
      </Fieldset>
      <Fieldset title="AI 회의록 연결">
        <div className="grid gap-1 pt-1 text-[12px]">
          <p className="flex flex-wrap items-center justify-between gap-1">
            <span>{l ? l.label : llm.isError ? '불러오지 못했습니다' : '확인 중…'}</span>
            {l && <span className={cn('font-mono text-[11px] font-bold', l.problem ? 'text-[#b00000]' : 'text-[#006a6a]')}>{l.problem ? '연결 필요' : `${l.keyHint ?? '키 있음'} (연결됨)`}</span>}
          </p>
          {l?.problem && <p className="text-[#b00000]">{l.problem}</p>}
          <p className="bg-white p-1.5 text-[11px] leading-snug w98-in">API 키는 서버에 암호화해 저장하고 화면에는 끝 몇 글자만 보입니다. AI 에는 회의록 작성에 필요한 원문 텍스트만 보냅니다.</p>
          <Link href="/settings" className="justify-self-end text-[12px] text-primary underline underline-offset-2">
            시스템 설정에서 바꾸기
          </Link>
        </div>
      </Fieldset>
    </div>
  )
}

function General({ user, approved, go }: { user: User; approved: boolean; go: (t: Tab) => void }) {
  const logout = useLogout()
  return (
    <div className="grid gap-3">
      <Fieldset title="사용자 정보">
        <div className="grid gap-3 pt-1 sm:grid-cols-[10rem_1fr]">
          <div className="grid content-start justify-items-center gap-1.5 bg-white p-2 w98-in">
            <MeAvatarField showHint={false} />
            <span className="w-full bg-[#000080] py-0.5 text-center font-mono text-[10px] font-bold text-white uppercase">{isAdminUser(user) ? 'Admin' : approved ? 'Member' : 'Pending'}</span>
          </div>
          <div className="grid min-w-0 content-start gap-2">
            <div className="grid gap-2 md:grid-cols-2">
              <Field label="이름">
                <span className="flex-1 truncate font-bold">{user.name}</span>
                <span className={cn('font-mono text-[10px]', user.is_active ? 'text-[#006a6a]' : 'text-[#b00000]')}>{user.is_active ? 'ACTIVE' : 'INACTIVE'}</span>
              </Field>
              <Field label="아이디" mono>
                <span className="truncate">{user.user_id}</span>
              </Field>
              <Field label="이메일" mono>
                <span className="flex-1 truncate">{user.email}</span>
                {user.email_verified && <span className="font-mono text-[10px] text-[#006a6a]">인증됨</span>}
              </Field>
              <Field label="권한">
                <ShieldCheck className="size-3.5 shrink-0 text-[#000080]" aria-hidden />
                <span className="truncate font-bold text-[#000080]">{roleLabel(user)}</span>
              </Field>
            </div>
            <MeNicknameForm />
            <div className="flex flex-wrap justify-end gap-1.5">
              <Button variant="outline" size="sm" accessKey="e" onClick={() => go('profile')}>
                <Pencil /> <span>프로필 수정(<u>E</u>)</span>
              </Button>
              <Button variant="outline" size="sm" accessKey="p" onClick={() => go('password')}>
                <KeyRound /> <span>암호 변경(<u>P</u>)</span>
              </Button>
              <Button variant="outline" size="sm" accessKey="l" disabled={logout.isPending} onClick={() => logout.mutate()} className="text-[#b00000]">
                <LogOut /> <span>로그아웃(<u>L</u>)</span>
              </Button>
            </div>
          </div>
        </div>
      </Fieldset>
      {approved ? (
        <>
          <MyData />
          <Engines />
        </>
      ) : (
        <p className="bg-[#ffffe1] p-2 text-[12px] w98-in">관리자가 사용을 승인하면 녹음기·회의록·달력을 쓸 수 있습니다. 승인 전에도 프로필 수정·암호 변경·탈퇴는 여기서 할 수 있습니다.</p>
      )}
    </div>
  )
}

/**
 * 내 정보 (사용자 등록정보). 바탕화면 위에 뜬 98 대화상자 — 살짝 떠서 오르내린다 (malmoa.css .malmoa-float).
 * 계정 부품(사진·프로필·암호·탈퇴)은 meerkit 그대로(MeSections), 창·탭·요약만 말모아가 그린다 (2026-11-04).
 * standalone: 바탕화면 없이 (승인 대기 회원 — 말모아 API 를 부르지 않는다)
 */
export function MeWindow({ standalone = false }: { standalone?: boolean }) {
  const { user } = useAuth()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('general')
  const drag = useDragMove()
  if (!user) return null
  const approved = isMalmoaApproved(user)
  // 다른 창의 ✕ 와 같이 녹음기로 (뒤로 가기는 바로 이 주소로 들어온 경우 말모아 밖으로 나간다)
  const close = () => router.push('/')

  return (
    <div className={cn('flex justify-center overflow-y-auto px-3 py-6 sm:items-center', standalone ? 'min-h-dvh' : 'fixed top-8 right-0 bottom-7 left-0 z-40 bg-black/25 lg:left-24')}>
      {/* 바깥: 끌어 옮긴 자리(translate), 안쪽: 둥둥 움직임 — 끄는 동안은 멈춘다 */}
      <div data-drag-root style={drag.style} className="w-full max-w-4xl">
      <section role="dialog" aria-modal="true" aria-labelledby="malmoa-me-title" className={cn('malmoa-float bg-face p-[3px] shadow-[3px_3px_0_rgba(0,0,0,0.4)] w98-out', drag.dragging && 'paused')}>
        <div {...drag.handle} className="flex h-6 cursor-move touch-none items-center justify-between gap-2 px-1 select-none w98-title">
          <h1 id="malmoa-me-title" className="flex min-w-0 items-center gap-1.5 text-[12px] font-bold tracking-tight text-white">
            <span aria-hidden>🪪</span>
            <span className="truncate">말모아 사용자 등록정보 — 내 정보</span>
          </h1>
          <button type="button" aria-label="닫기" title="닫기" onClick={close} className="grid size-4 shrink-0 place-items-center bg-face text-[10px] leading-none font-bold text-black outline-none w98-out active:w98-pressed">
            <span aria-hidden>✕</span>
          </button>
        </div>

        <div className="p-2.5">
          <div role="tablist" aria-label="내 정보" className="flex flex-wrap items-end gap-0.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`me-tab-${t.key}`}
                aria-selected={tab === t.key}
                aria-controls="me-panel"
                onClick={() => setTab(t.key)}
                className={cn('px-3 text-[12px] w98-out', tab === t.key ? 'relative z-10 -mb-0.5 h-7 font-bold' : 'h-6', t.key === 'withdraw' && 'text-[#b00000]')}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div id="me-panel" role="tabpanel" aria-labelledby={`me-tab-${tab}`} className="p-2.5 w98-out">
            {tab === 'general' && <General user={user} approved={approved} go={setTab} />}
            {tab === 'profile' && (
              <Fieldset title="프로필 수정">
                <div className="max-w-xl bg-white p-3 w98-in">
                  <MeProfileForm />
                </div>
              </Fieldset>
            )}
            {tab === 'password' && (
              <Fieldset title="암호 변경">
                <div className="max-w-xl bg-white p-3 w98-in">
                  <MePasswordForm />
                </div>
              </Fieldset>
            )}
            {tab === 'withdraw' && (
              <Fieldset title="회원 탈퇴">
                <p className="mb-2 bg-[#ffffe1] p-2 text-[12px] leading-snug w98-in">
                  탈퇴하면 바로 로그인할 수 없고, <b>30일 뒤</b> 녹음·원문·회의록·일정·참석자 명단이 모두 지워집니다. 필요한 회의록은 먼저 내려받아 두세요.
                </p>
                <div className="max-w-xl bg-white p-3 w98-in">
                  <MeWithdrawForm />
                </div>
              </Fieldset>
            )}
          </div>

          <div className="mt-2.5 flex items-center justify-end">
            <Button size="sm" accessKey="c" onClick={close} className="min-w-20">
              <span>닫기(<u>C</u>)</span>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-stretch gap-1 px-0.5 pb-0.5 font-mono text-[11px]">
          <span className="flex items-center gap-1.5 px-1.5 py-0.5 font-bold w98-flat">
            <span className="size-2 rounded-full bg-[#00c040]" aria-hidden /> 로그인: {user.user_id}
          </span>
          <span className="flex items-center px-1.5 py-0.5 w98-flat">가입일 {user.created_at.slice(0, 10)}</span>
          <span className="ml-auto flex items-center px-1.5 py-0.5 text-[#006a6a] w98-flat">{roleLabel(user)}</span>
        </div>
      </section>
      </div>
    </div>
  )
}
