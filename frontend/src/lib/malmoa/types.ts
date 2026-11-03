// 백엔드 작업 상태 (CLAUDE.md 기능 3)
export type JobStatus = 'QUEUED' | 'TRANSCRIBING' | 'SUMMARIZING' | 'COMPLETED' | 'FAILED'

export type JobSource = 'upload' | 'recording' | 'image'

/** 회의 참석자 한 명 (role: 소속·직책, 선택) */
export interface Attendee {
  name: string
  role?: string | null
}

/** 캘린더 일정 (DOM의 Event와 겹치지 않게 CalendarEvent) */
export type EventKind = 'meeting' | 'other'
export type AutoRecordState = 'none' | 'armed' | 'started' | 'skipped' | 'failed'

/** 일정 추가·수정 요청. 시각은 시간대가 붙은 ISO 문자열 */
export interface EventInput {
  title: string
  kind: EventKind
  startsAt: string
  endsAt: string
  allDay: boolean
  location?: string | null
  memo?: string | null
  attendees: Attendee[]
  reminders: number[] // 몇 분 전에 알릴지
  autoRecord: boolean
}

export interface CalendarEvent extends EventInput {
  id: string
  autoRecordState: AutoRecordState
  autoRecordNote: string | null
  jobId: string | null // 이 회의의 녹음 작업
  calendarSynced: boolean // Mac 캘린더 앱(→ 아이폰)에 내보냄
  calendarError: string | null // 내보내지 못한 이유
  createdAt: string
  updatedAt: string
}

/** Mac 캘린더 앱 → 아이폰 알림 내보내기 설정 */
export interface CalendarSync {
  enabled: boolean
  available: boolean // 서버가 Mac에서 도는지
  calendarName: string
  failed: number // 내보내지 못한 앞으로의 일정 수
}

/** AI 회의록 제공자 (backend/app/services/llm.py PROVIDERS) */
export type LlmProviderId = 'openai' | 'anthropic' | 'gemini' | 'compatible'

export interface LlmProviderInfo {
  id: LlmProviderId
  label: string
  needsKey: boolean
  keyPage: string | null
  suggestedModel: string
}

/** AI 회의록 연결. 키 원문은 서버가 돌려주지 않는다 (keyHint만) */
export interface LlmSettings {
  provider: LlmProviderId
  model: string
  baseUrl: string | null
  hasKey: boolean
  keyHint: string | null
  source: 'screen' | 'env' // screen: 설정 화면에서 저장, env: backend/.env
  label: string // 예: "OpenAI · gpt-5.4-mini"
  problem: string | null // 회의록을 만들 수 없는 이유. null이면 사용 가능
  providers: LlmProviderInfo[]
}

/** apiKey를 비우면 같은 제공자로 저장된 키를 그대로 쓴다 */
export interface LlmCheckInput {
  provider: LlmProviderId
  apiKey?: string
  baseUrl?: string
}

export interface LlmSettingsInput extends LlmCheckInput {
  model: string
}

export interface LlmCheck {
  models: string[]
  message: string
}

/** 울린 일정 알람 (화면 알림용) */
export interface FiredReminder {
  eventId: string
  minutesBefore: number
  sentAt: string
  message: string
}

/** 참석자 명단에 등록된 사람 */
export interface Person {
  id: string
  name: string
  role: string | null
  createdAt: string
}

// backend/app/schemas/jobs.py 의 Job과 같은 모양
export interface Job {
  id: string
  userId: string
  fileName: string
  source: JobSource
  createdAt: string // ISO 8601
  updatedAt: string
  sizeBytes: number
  durationSec: number | null
  status: JobStatus
  progress: number | null // 0–100, 진행 중일 때만
  stage: string | null
  errorMessage: string | null
  transcriptReady: boolean
  minutesReady: boolean
  llmTokens: number | null // 이 작업에 쓴 AI API 토큰 합계
  attendees: Attendee[]
}

export interface TranscriptSegment {
  start: number
  end: number
  text: string
  confidence?: number | null // 사진 글자 인식의 확신도 (음성은 없음)
}

export interface Transcript {
  jobId: string
  text: string
  segments: TranscriptSegment[]
  /** 사용자가 원문을 직접 고쳤는지 */
  edited: boolean
}

/** 회의록 내려받기 형식 */
export type MinutesFormat = 'md' | 'txt' | 'docx' | 'pdf'

export interface MinutesDoc {
  jobId: string
  markdown: string
  generatedAt: string | null
  model: string | null
  edited: boolean
}

export interface Health {
  status: 'ok'
  /** DB 연결 확인 (닿지 않으면 응답 대신 503) */
  database: 'ok'
  /** 음성 변환 방식 (backend TRANSCRIBER). none 이면 그 서버는 음성 변환을 하지 않는다 */
  transcriber: 'local_whisper' | 'none'
  whisperModel: string
  ffmpeg: boolean
  llmConfigured: boolean
  llmModel: string | null
  maxUploadMb: number
}

// ---------- AI 사용량 (GET /api/usage) ----------

export interface UsageTotals {
  calls: number
  inputTokens: number
  outputTokens: number
  tokens: number
}

export interface UsageLimits {
  monthlyTokens: number | null // 한 달 토큰 한도 (없으면 null)
  dailyCalls: number | null // 하루 호출 한도
}

export interface UsageRecord {
  id: number
  createdAt: string
  jobId: string | null // 작업을 지웠으면 null
  fileName: string | null
  provider: string
  model: string
  calls: number
  inputTokens: number
  outputTokens: number
}

export interface UsageSummary extends UsageLimits {
  today: UsageTotals
  month: UsageTotals
  all: UsageTotals
  monthStart: string
  nextDay: string // 하루 호출 수가 다시 0이 되는 때 (한국 시간 자정)
  byModel: (UsageTotals & { provider: string; model: string })[]
  recent: UsageRecord[]
}
