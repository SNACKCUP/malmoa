import type { Metadata } from 'next'
import { JobList } from '@/components/malmoa/job-list'

export const metadata: Metadata = { title: '회의 작업 목록' }

export default function JobsPage() {
  return <JobList />
}
