import type { Metadata } from 'next'
import { UploadPanel } from '@/components/malmoa/upload-panel'

export const metadata: Metadata = { title: '파일 업로드 & 변환' }

export default function UploadPage() {
  return <UploadPanel />
}
