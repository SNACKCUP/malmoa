'use client'

import Link from 'next/link'
import { hasRole, isAdminUser, useLogout, type User } from '@/meerkit'
import { useMe } from '@/meerkit/auth/queries'
import { Brand } from './common'

/** 말모아 사용 승인 (통합 단계 5-1, 결정 A). 실제 권한은 서버가 다시 확인한다 (403 MALMOA_NOT_APPROVED) */
export const isMalmoaApproved = (user: Pick<User, 'roles'> | null | undefined) => isAdminUser(user) || hasRole(user, 'OWNER')

/** 로그인했지만 관리자가 아직 사용 승인(OWNER 역할)을 주지 않은 회원에게 보이는 98 창 */
export function PendingApproval({ user }: { user: User }) {
  const me = useMe()
  const logout = useLogout()
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10 text-black">
      <section aria-label="말모아 사용 승인 대기" className="w-full max-w-md bg-face p-[3px] shadow-[2px_2px_0_rgba(0,0,0,0.35)] w98-out">
        <div className="flex h-6 items-center px-1 w98-title">
          <h1 className="flex items-center gap-1.5 text-[12px] font-bold tracking-tight text-white">
            <span aria-hidden>⏳</span> 말모아 OS — 사용 승인 대기
          </h1>
        </div>
        <div className="grid gap-3 p-3 text-[13px] leading-6">
          <div className="flex items-center gap-2 border-b border-shade pb-2 shadow-[0_1px_#fff]">
            <Brand />
            <p className="text-[12px]">녹음은 글로, 회의는 기록으로.</p>
          </div>
          <p>
            <b>{user.name}</b> 님, 가입해 주셔서 감사합니다. 말모아는 <b>관리자가 사용을 승인한 뒤</b>에 쓸 수 있습니다.
          </p>
          <p className="bg-[#ffffe1] p-2 text-[12px] w98-in">승인되면 이 화면에서 ‘다시 확인’을 누르거나 새로 고침하면 바로 녹음기가 열립니다.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void me.refetch()} disabled={me.isFetching} className="h-7 px-3 text-[12px] font-bold outline outline-1 -outline-offset-1 outline-black w98-out active:w98-pressed disabled:text-[#808080]">
              {me.isFetching ? '확인 중…' : '다시 확인'}
            </button>
            <Link href="/me" className="inline-flex h-7 items-center px-3 text-[12px] w98-out active:w98-pressed">
              내 정보
            </Link>
            <button type="button" onClick={() => logout.mutate()} className="h-7 px-3 text-[12px] w98-out active:w98-pressed">
              로그아웃
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
