/**
 * 녹음 구간 저장소 (IndexedDB)
 *
 * MediaRecorder가 timeslice마다 내보내는 Blob 구간을 즉시 IndexedDB에 기록한다.
 * 브라우저가 녹음 도중 종료되어도 마지막 구간 이전까지는 디스크에 남아 있어,
 * 다음 실행 때 같은 세션의 구간을 순서대로 이어 붙여 복구할 수 있다.
 * (한 MediaRecorder 세션의 구간은 첫 구간에만 헤더가 있고, 순서대로 이으면 하나의 유효한 파일이 된다.)
 */

const DB_NAME = 'malmoa-recordings'
const DB_VERSION = 1
const SESSIONS = 'sessions'
const CHUNKS = 'chunks'

export type SessionStatus = 'recording' | 'stopped'

export interface RecordingSession {
  id: string
  startedAt: string
  mimeType: string
  status: SessionStatus
  durationMs: number // 마지막으로 저장된 구간 시점의 녹음 길이
  chunkCount: number
  sizeBytes: number
}

interface ChunkRecord {
  sessionId: string
  seq: number
  blob: Blob
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        db.createObjectStore(SESSIONS, { keyPath: 'id' })
        const chunks = db.createObjectStore(CHUNKS, { keyPath: ['sessionId', 'seq'] })
        chunks.createIndex('bySession', 'sessionId')
      }
      req.onsuccess = () => {
        const db = req.result
        // 브라우저가 연결을 닫으면(오래 열어 둔 탭, 저장소 정리 등) 다음에 새로 연다
        db.onclose = () => (dbPromise = null)
        db.onversionchange = () => {
          db.close()
          dbPromise = null
        }
        resolve(db)
      }
      req.onerror = () => {
        dbPromise = null
        reject(req.error)
      }
    })
  }
  return dbPromise
}

/** 닫힌 연결로 시작하다 실패하면 연결을 새로 열어 한 번 더 한다 */
async function retryOnce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch {
    dbPromise = null
    return fn()
  }
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function createSession(session: RecordingSession): Promise<void> {
  return retryOnce(async () => {
    const tx = (await openDb()).transaction(SESSIONS, 'readwrite')
    tx.objectStore(SESSIONS).put(session)
    await done(tx)
  })
}

export async function updateSession(id: string, patch: Partial<RecordingSession>): Promise<void> {
  const tx = (await openDb()).transaction(SESSIONS, 'readwrite')
  const store = tx.objectStore(SESSIONS)
  const current = await result(store.get(id) as IDBRequest<RecordingSession | undefined>)
  if (current) store.put({ ...current, ...patch })
  await done(tx)
}

/** 구간 Blob과 세션 메타데이터를 한 트랜잭션으로 기록한다. */
export function appendChunk(sessionId: string, seq: number, blob: Blob, durationMs: number): Promise<void> {
  return retryOnce(() => writeChunk(sessionId, seq, blob, durationMs))
}

async function writeChunk(sessionId: string, seq: number, blob: Blob, durationMs: number): Promise<void> {
  const tx = (await openDb()).transaction([SESSIONS, CHUNKS], 'readwrite')
  tx.objectStore(CHUNKS).put({ sessionId, seq, blob } satisfies ChunkRecord)
  const sessions = tx.objectStore(SESSIONS)
  const current = await result(sessions.get(sessionId) as IDBRequest<RecordingSession | undefined>)
  if (current) {
    sessions.put({
      ...current,
      durationMs,
      chunkCount: Math.max(current.chunkCount, seq + 1),
      sizeBytes: current.sizeBytes + blob.size,
    })
  }
  await done(tx)
}

export async function assembleSession(id: string): Promise<Blob> {
  const db = await openDb()
  const tx = db.transaction([SESSIONS, CHUNKS], 'readonly')
  const session = await result(tx.objectStore(SESSIONS).get(id) as IDBRequest<RecordingSession | undefined>)
  const chunks = await result(tx.objectStore(CHUNKS).index('bySession').getAll(IDBKeyRange.only(id)) as IDBRequest<ChunkRecord[]>)
  chunks.sort((a, b) => a.seq - b.seq)
  return new Blob(
    chunks.map((c) => c.blob),
    { type: session?.mimeType ?? 'audio/webm' },
  )
}

export async function listSessions(): Promise<RecordingSession[]> {
  const tx = (await openDb()).transaction(SESSIONS, 'readonly')
  const all = await result(tx.objectStore(SESSIONS).getAll() as IDBRequest<RecordingSession[]>)
  return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/** 세션과 그 구간을 모두 삭제한다. */
export async function deleteSession(id: string): Promise<void> {
  const tx = (await openDb()).transaction([SESSIONS, CHUNKS], 'readwrite')
  tx.objectStore(SESSIONS).delete(id)
  tx.objectStore(CHUNKS).delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]))
  await done(tx)
}
