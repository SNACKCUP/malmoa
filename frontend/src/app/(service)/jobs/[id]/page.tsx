import { Suspense } from 'react'
import { JobResult } from '@/components/malmoa/job-result'

export default function JobResultPage({ params }: PageProps<'/jobs/[id]'>) {
  return <Suspense fallback={<p className="py-16 text-center text-sm text-muted-foreground">불러오는 중…</p>}>{params.then(({ id }) => <JobResult id={id} />)}</Suspense>
}
