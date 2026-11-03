'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as api from '@/lib/malmoa/api'
import type { Attendee, EventInput, Job } from '@/lib/malmoa/types'

export const keys = {
  jobs: ['jobs'] as const,
  job: (id: string) => ['jobs', id] as const,
  transcript: (id: string) => ['jobs', id, 'transcript'] as const,
  minutes: (id: string) => ['jobs', id, 'minutes'] as const,
  health: ['health'] as const,
  people: ['people'] as const,
  events: ['events'] as const,
  eventRange: (from: Date, to: Date) => ['events', from.toISOString(), to.toISOString()] as const,
  calendarSync: ['calendar-sync'] as const,
  calendarFeed: ['calendar-feed'] as const,
  llm: ['settings', 'llm'] as const,
  usage: ['usage'] as const,
}

const ACTIVE_POLL_MS = 2_000

export const isActive = (j: Job) => j.status === 'TRANSCRIBING' || j.status === 'SUMMARIZING' || (j.status === 'QUEUED' && j.progress != null)

/** 작업 목록. 처리 중인 작업이 있으면 2초마다 새로고침 */
export function useJobs() {
  return useQuery({
    queryKey: keys.jobs,
    queryFn: api.listJobs,
    refetchInterval: (q) => (q.state.data?.some(isActive) ? ACTIVE_POLL_MS : false),
  })
}

export function useJob(id: string) {
  return useQuery({
    queryKey: keys.job(id),
    queryFn: () => api.getJob(id),
    refetchInterval: (q) => (q.state.data && isActive(q.state.data) ? ACTIVE_POLL_MS : false),
  })
}

export function useTranscript(id: string, enabled: boolean) {
  return useQuery({ queryKey: keys.transcript(id), queryFn: () => api.getTranscript(id), enabled, staleTime: Infinity })
}

export function useMinutes(id: string, enabled: boolean) {
  return useQuery({ queryKey: keys.minutes(id), queryFn: () => api.getMinutes(id), enabled })
}

export function useHealth() {
  return useQuery({ queryKey: keys.health, queryFn: api.getHealth, staleTime: 30_000 })
}

/** 작업이 바뀌었을 때 목록과 상세를 함께 갱신 */
function useJobUpdater() {
  const qc = useQueryClient()
  return (job: Job) => {
    qc.setQueryData(keys.job(job.id), job)
    void qc.invalidateQueries({ queryKey: keys.jobs, exact: true })
  }
}

export function useStartTranscribe() {
  const update = useJobUpdater()
  return useMutation({ mutationFn: (id: string) => api.startTranscribe(id), onSuccess: update })
}

export function useStartMinutes() {
  const update = useJobUpdater()
  return useMutation({ mutationFn: ({ id, force }: { id: string; force?: boolean }) => api.startMinutes(id, force), onSuccess: update })
}

export function useSaveMinutes(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (markdown: string) => api.saveMinutes(id, markdown),
    onSuccess: (doc) => qc.setQueryData(keys.minutes(id), doc),
  })
}

export function useSaveTranscript(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (texts: string[]) => api.saveTranscript(id, texts),
    onSuccess: (t) => qc.setQueryData(keys.transcript(id), t),
  })
}

/** 작업 삭제 후 목록에서 빼고 상세 캐시를 지운다 */
export function useDeleteJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.deleteJob,
    onSuccess: (_, id) => {
      qc.setQueryData<Job[]>(keys.jobs, (jobs) => jobs?.filter((j) => j.id !== id))
      qc.removeQueries({ queryKey: keys.job(id) })
    },
  })
}

/** 업로드·녹음 전송 후 목록 갱신 */
export function useJobCreated() {
  const update = useJobUpdater()
  return update
}

/** 회의 참석자 저장 */
export function useSaveAttendees(id: string) {
  const update = useJobUpdater()
  return useMutation({ mutationFn: (attendees: Attendee[]) => api.saveAttendees(id, attendees), onSuccess: update })
}

/** 참석자 명단 (자주 참석하는 사람) */
export function usePeople() {
  return useQuery({ queryKey: keys.people, queryFn: api.listPeople, staleTime: 60_000 })
}

export function useAddPerson() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: api.addPerson, onSuccess: () => qc.invalidateQueries({ queryKey: keys.people }) })
}

export function useUpdatePerson() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...p }: Attendee & { id: string }) => api.updatePerson(id, p),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.people }),
  })
}

export function useDeletePerson() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: api.deletePerson, onSuccess: () => qc.invalidateQueries({ queryKey: keys.people }) })
}

/** 기간과 겹치는 일정 */
export function useEvents(from: Date, to: Date) {
  return useQuery({ queryKey: keys.eventRange(from, to), queryFn: () => api.listEvents(from, to), staleTime: 30_000 })
}

/** 일정 추가·수정 (id가 있으면 수정). 끝나면 모든 기간의 일정 목록을 다시 받는다 */
export function useSaveEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: EventInput }) => (id ? api.updateEvent(id, input) : api.addEvent(input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.events }),
  })
}

export function useRetryEventSync() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: api.retryEventSync, onSuccess: () => qc.invalidateQueries({ queryKey: keys.events }) })
}

export function useCalendarFeed() {
  return useQuery({ queryKey: keys.calendarFeed, queryFn: api.getCalendarFeed })
}

export function useCreateCalendarFeed() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: api.createCalendarFeed, onSuccess: () => void qc.invalidateQueries({ queryKey: keys.calendarFeed }) })
}

export function useDeleteCalendarFeed() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: api.deleteCalendarFeed, onSuccess: () => void qc.invalidateQueries({ queryKey: keys.calendarFeed }) })
}

export function useCalendarSync() {
  return useQuery({ queryKey: keys.calendarSync, queryFn: api.getCalendarSync })
}

export function useSetCalendarSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.setCalendarSync,
    onSuccess: (data) => {
      qc.setQueryData(keys.calendarSync, data)
      // 켜면 서버가 뒤에서 내보내므로 조금 뒤 일정과 실패 수를 다시 읽는다
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: keys.events })
        void qc.invalidateQueries({ queryKey: keys.calendarSync })
      }, 3_000)
    },
  })
}

export function useDeleteEvent() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: api.deleteEvent, onSuccess: () => qc.invalidateQueries({ queryKey: keys.events }) })
}

/** AI 회의록 연결 (설정 화면 저장값 → 없으면 backend/.env) */
export function useLlmSettings() {
  return useQuery({ queryKey: keys.llm, queryFn: api.getLlmSettings, staleTime: 30_000 })
}

export function useSaveLlmSettings() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: api.saveLlmSettings, onSuccess: (data) => qc.setQueryData(keys.llm, data) })
}

export function useDeleteLlmSettings() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: api.deleteLlmSettings, onSuccess: () => qc.invalidateQueries({ queryKey: keys.llm }) })
}

export function useCheckLlm() {
  return useMutation({ mutationFn: api.checkLlm })
}

/** AI 사용량 (말모아가 회의록 작성에 쓴 호출·토큰)과 사용자가 정한 한도 */
export function useUsage() {
  return useQuery({ queryKey: keys.usage, queryFn: api.getUsage, staleTime: 10_000 })
}

export function useSaveUsageLimits() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: api.saveUsageLimits, onSuccess: (data) => qc.setQueryData(keys.usage, data) })
}
