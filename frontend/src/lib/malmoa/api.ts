/**
 * 말모아 API 호출 (backend/app/features/malmoa)
 *
 * - 주소: 같은 출처의 /api. next.config.ts 프록시가 meerkit 과 같은 백엔드로 넘긴다 (CLAUDE.md 12절, 2026-11-03 통합).
 *   업로드도 이 프록시를 지난다 (proxy.ts 가 없어 본문을 버퍼링하지 않음). 배포용 직접 업로드는 통합계획 단계 5.
 * - 로그인: meerkit 액세스 토큰을 Bearer 헤더로 싣는다. 401이면 meerkit 리프레시로 한 번 갱신해 다시 보낸다.
 */
import { refreshAccessToken } from '@/meerkit/api/client'
import { useAuthStore } from '@/meerkit/auth/store'
import type {
  Attendee,
  CalendarEvent,
  CalendarSync,
  EventInput,
  FiredReminder,
  Health,
  Job,
  JobSource,
  LlmCheck,
  LlmCheckInput,
  LlmSettings,
  LlmSettingsInput,
  MinutesDoc,
  MinutesFormat,
  Person,
  Transcript,
  UsageLimits,
  UsageSummary,
} from './types'

/** API 앞에 붙일 주소. 같은 출처라 비어 있다 (경로가 /api/… 로 시작) */
export const API_URL = ''

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const SERVER_DOWN = '로컬 서버에 연결할 수 없습니다. 백엔드(FastAPI)가 실행 중인지 확인해 주세요.'

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown }
    if (typeof body.detail === 'string') return body.detail
  } catch {
    /* JSON이 아닌 응답 */
  }
  return `요청을 처리하지 못했습니다. (HTTP ${res.status})`
}

function withToken(headers: HeadersInit | undefined, token: string | null): Headers {
  const h = new Headers(headers)
  if (token) h.set('Authorization', `Bearer ${token}`)
  return h
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const attempt = async (token: string | null) => {
    try {
      return await fetch(`${API_URL}${path}`, { ...init, headers: withToken(init.headers, token) })
    } catch {
      throw new ApiError(0, SERVER_DOWN)
    }
  }
  let res = await attempt(useAuthStore.getState().accessToken)
  if (res.status === 401) {
    // 액세스 토큰 만료(기본 30분) → meerkit 리프레시 쿠키로 갱신해 한 번만 다시 보낸다. 실패하면 로그인 화면으로 바뀐다
    const token = await refreshAccessToken()
    if (token) res = await attempt(token)
  }
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
  return res
}

const json = async <T>(path: string, init?: RequestInit) => (await send(path, init)).json() as Promise<T>

const jsonBody = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// ---------- 작업 ----------

export const getHealth = () => json<Health>('/api/health')

export const listJobs = () => json<{ jobs: Job[] }>('/api/jobs').then((r) => r.jobs)

export const getJob = (id: string) => json<Job>(`/api/jobs/${id}`)

/** 작업 삭제: 원본·변환 원문·회의록·작업 기록을 모두 지운다 (되돌릴 수 없음) */
export const deleteJob = async (id: string) => {
  await send(`/api/jobs/${id}`, { method: 'DELETE' })
}

export const startTranscribe = (id: string) => json<Job>(`/api/jobs/${id}/transcribe`, { method: 'POST' })

export const getTranscript = (id: string) => json<Transcript>(`/api/jobs/${id}/transcript`)

/** 원문 수정 저장: 문장마다 고친 글자 (순서·개수는 지금 원문과 같게, 빈 문장은 지워진다) */
export const saveTranscript = (id: string, texts: string[]) => json<Transcript>(`/api/jobs/${id}/transcript`, jsonBody('PUT', { texts }))

/** 회의록 생성 시작. 변환된 텍스트만 AI API로 전송된다. force: 기존 회의록을 새로 만들기 */
export const startMinutes = (id: string, force = false) => json<Job>(`/api/jobs/${id}/minutes${force ? '?force=true' : ''}`, { method: 'POST' })

export const getMinutes = (id: string) => json<MinutesDoc>(`/api/jobs/${id}/minutes`)

export const saveMinutes = (id: string, markdown: string) => json<MinutesDoc>(`/api/jobs/${id}/minutes`, jsonBody('PUT', { markdown }))

/** 회의 참석자 저장 (전체를 이 목록으로 바꾼다) */
export const saveAttendees = (id: string, attendees: Attendee[]) => json<Job>(`/api/jobs/${id}/attendees`, jsonBody('PUT', { attendees }))

// ---------- 참석자 명단 ----------

export const listPeople = () => json<{ people: Person[] }>('/api/people').then((r) => r.people)

export const addPerson = (p: Attendee) => json<Person>('/api/people', jsonBody('POST', p))

export const updatePerson = (id: string, p: Attendee) => json<Person>(`/api/people/${id}`, jsonBody('PUT', p))

export const deletePerson = async (id: string) => {
  await send(`/api/people/${id}`, { method: 'DELETE' })
}

// ---------- 일정 (캘린더) ----------

/** 기간과 겹치는 일정 (시작 시각순) */
export const listEvents = (from: Date, to: Date) =>
  json<{ events: CalendarEvent[] }>(`/api/events?${new URLSearchParams({ from: from.toISOString(), to: to.toISOString() })}`).then((r) => r.events)

export const addEvent = (e: EventInput) => json<CalendarEvent>('/api/events', jsonBody('POST', e))

export const updateEvent = (id: string, e: EventInput) => json<CalendarEvent>(`/api/events/${id}`, jsonBody('PUT', e))

/** since 이후에 울린 내 알람 */
export const listFiredReminders = (since: Date) =>
  json<{ reminders: FiredReminder[] }>(`/api/events/reminders?${new URLSearchParams({ since: since.toISOString() })}`).then((r) => r.reminders)

/** 자동 녹음 결과 보고 (시작 시각에 녹음한 탭이 보낸다) */
export const reportAutoRecord = (id: string, state: 'started' | 'skipped' | 'failed', note?: string) =>
  json<CalendarEvent>(`/api/events/${id}/auto-record`, jsonBody('POST', { state, note }))

/** 탭 생존 신호 + 마이크 권한 (자동 녹음 사전 점검) */
export const sendHeartbeat = async (micPermission: 'granted' | 'prompt' | 'denied' | 'unknown') => {
  await send('/api/recorder/heartbeat', jsonBody('POST', { micPermission }))
}

/** 캘린더 앱에 다시 내보내기 (실패했을 때) */
export const retryEventSync = (id: string) => json<CalendarEvent>(`/api/events/${id}/sync`, { method: 'POST' })

export const getCalendarSync = () => json<CalendarSync>('/api/events/calendar-sync')

/** 켜면 서버가 캘린더·권한을 확인하고 앞으로의 일정을 뒤에서 내보낸다 */
export const setCalendarSync = (enabled: boolean) => json<CalendarSync>('/api/events/calendar-sync', jsonBody('PUT', { enabled }))

/** 일정만 지운다 (연결된 녹음 작업은 그대로) */
export const deleteEvent = async (id: string) => {
  await send(`/api/events/${id}`, { method: 'DELETE' })
}

/** 인증이 필요한 파일을 받아 브라우저 다운로드로 저장한다. (a href 로는 토큰을 보낼 수 없음) */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const res = await send(path)
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const encoded = /filename\*=utf-8''([^;]+)/i.exec(disposition)?.[1]
  const name = encoded ? decodeURIComponent(encoded) : fallbackName
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export const transcriptTxtPath = (id: string) => `/api/jobs/${id}/transcript.txt`

/** 올린 원본(화이트보드 사진)을 인증 헤더와 함께 받아 화면에 쓸 수 있는 주소로 만든다. 다 쓰면 URL.revokeObjectURL */
export async function originalFileUrl(id: string): Promise<string> {
  const res = await send(`/api/jobs/${id}/file`)
  return URL.createObjectURL(await res.blob())
}
export const minutesFilePath = (id: string, format: MinutesFormat) => `/api/jobs/${id}/download?format=${format}`

/** XHR 로 보내고 올라간 비율을 알린다 (fetch 는 업로드 진행률을 주지 않는다) */
function xhrSend(method: string, url: string, body: Blob | FormData, headers: Record<string, string>, onProgress?: (ratio: number) => void): Promise<XMLHttpRequest> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => resolve(xhr)
    xhr.onerror = () => reject(new ApiError(0, SERVER_DOWN))
    xhr.send(body)
  })
}

function xhrError(xhr: XMLHttpRequest, fallback: string): ApiError {
  let message = `${fallback} (HTTP ${xhr.status})`
  try {
    const body = JSON.parse(xhr.responseText) as { detail?: unknown }
    if (typeof body.detail === 'string') message = body.detail
  } catch {
    /* JSON이 아닌 응답 */
  }
  return new ApiError(xhr.status, message)
}

/** 서버로 올리기 (로컬 저장소): multipart 로 백엔드에 보낸다 */
function formUpload(form: FormData, onProgress?: (ratio: number) => void): Promise<Job> {
  const upload = async (token: string | null, retried: boolean): Promise<Job> => {
    const xhr = await xhrSend('POST', `${API_URL}/api/jobs`, form, token ? { Authorization: `Bearer ${token}` } : {}, onProgress)
    if (xhr.status >= 200 && xhr.status < 300) return JSON.parse(xhr.responseText) as Job
    if (xhr.status === 401 && !retried) {
      // 토큰이 업로드 도중 만료된 경우: 갱신해 한 번만 다시 올린다
      const fresh = await refreshAccessToken()
      if (fresh) return upload(fresh, true)
      throw new ApiError(401, '로그인이 만료되었습니다. 다시 로그인해 주세요.')
    }
    throw xhrError(xhr, '업로드하지 못했습니다.')
  }
  return upload(useAuthStore.getState().accessToken, false)
}

interface UploadTicket {
  uploadId: string
  url: string
  method: 'PUT'
  headers: Record<string, string>
  expiresAt: string
}

/**
 * 파일 업로드 → 작업 생성 (통합 단계 5-2).
 * 저장소가 R2(s3)면 서명 주소를 받아 브라우저가 저장소에 바로 PUT 하고 끝났다고 알린다 — 큰 녹음이 화면 서버·백엔드를 거치지 않는다.
 * 서버가 409(DIRECT_UPLOAD_OFF, 로컬 저장소)로 답하면 예전처럼 서버로 올린다.
 */
export async function createJob(file: Blob, fileName: string, source: JobSource, onProgress?: (ratio: number) => void, attendees: Attendee[] = [], eventId?: string): Promise<Job> {
  let ticket: UploadTicket | null = null
  try {
    ticket = await json<UploadTicket>(
      '/api/jobs/uploads',
      jsonBody('POST', { fileName, sizeBytes: file.size, contentType: file.type || 'application/octet-stream', source, attendees, eventId: eventId ?? null }),
    )
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 409)) throw e
  }
  if (!ticket) {
    const form = new FormData()
    form.append('file', file, fileName)
    form.append('source', source)
    if (attendees.length) form.append('attendees', JSON.stringify(attendees))
    if (eventId) form.append('event_id', eventId)
    return formUpload(form, onProgress)
  }
  const put = await xhrSend(ticket.method, ticket.url, file, ticket.headers, onProgress)
  if (put.status < 200 || put.status >= 300) throw new ApiError(put.status, `저장소에 올리지 못했습니다. (HTTP ${put.status}) 잠시 뒤 다시 시도해 주세요.`)
  return json<Job>(`/api/jobs/uploads/${ticket.uploadId}/complete`, { method: 'POST' })
}

/** 업로드 후 바로 음성 변환을 요청한다. */
export async function uploadAndTranscribe(
  file: Blob,
  fileName: string,
  source: JobSource,
  onProgress?: (ratio: number) => void,
  attendees: Attendee[] = [],
  eventId?: string,
): Promise<Job> {
  const job = await createJob(file, fileName, source, onProgress, attendees, eventId)
  return startTranscribe(job.id)
}

// ---------- AI 회의록 연결 (키는 서버에 암호화 저장, 응답에는 keyHint만) ----------

export const getLlmSettings = () => json<LlmSettings>('/api/settings/llm')

export const saveLlmSettings = (body: LlmSettingsInput) => json<LlmSettings>('/api/settings/llm', jsonBody('PUT', body))

export const deleteLlmSettings = async () => {
  await send('/api/settings/llm', { method: 'DELETE' })
}

/** 키 확인 겸 모델 목록 (토큰을 쓰지 않아 비용 없음) */
export const checkLlm = (body: LlmCheckInput) => json<LlmCheck>('/api/settings/llm/check', jsonBody('POST', body))

// ---------- AI 사용량 ----------

export const getUsage = () => json<UsageSummary>('/api/usage')

export const saveUsageLimits = (body: UsageLimits) => json<UsageSummary>('/api/usage/limits', jsonBody('PUT', body))
