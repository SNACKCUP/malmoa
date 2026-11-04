import type { Metadata } from 'next'
import { MeWindow } from '@/components/malmoa/me-window'

export const metadata: Metadata = { title: '내 정보', robots: { index: false, follow: false } }

/** 내 정보 — meerkit MePage 대신 98 대화상자 (2026-11-04, 원래 (meerkit)/me) */
export default function MeRoute() {
  return <MeWindow />
}
