'use client'

import { AdminMembersPage } from '@/meerkit/admin/AdminMembersPage'
import { OsWindow, StatusCell } from './app-shell'

/**
 * 회원 관리 (meerkit AdminMembersPage 를 98 창 안에). 권한(MASTER) 확인은 meerkit RequireRole 이 한다.
 * 말모아 사용 승인(역할 부여)도 여기서 한다 — 통합계획 결정 4.
 */
export function AdminWindow() {
  return (
    <OsWindow icon="👥" title="회원 관리 - [관리자]" width="max-w-6xl" statusBar={<StatusCell>역할·활성 상태를 바꾸면 바로 적용됩니다</StatusCell>}>
      <div className="bg-white w98-in">
        <AdminMembersPage />
      </div>
    </OsWindow>
  )
}
