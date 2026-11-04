import type { Metadata } from 'next'
import { AdminWindow } from '@/components/malmoa/admin-window'

export const metadata: Metadata = { title: '회원 관리', robots: { index: false, follow: false } }

export default function AdminMembersRoute() {
  return <AdminWindow />
}
