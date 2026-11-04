import type { Metadata } from 'next'
import { SettingsView } from '@/components/malmoa/settings-view'

export const metadata: Metadata = { title: '설정' }

export default function SettingsPage() {
  return <SettingsView />
}
