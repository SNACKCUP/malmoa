# 04. API 명세

- 기준 주소: `http://localhost:8010`. 실행 중이면 `http://localhost:8010/docs`에서 자동 문서(OpenAPI) 확인 가능
- JSON 필드는 **camelCase** (`CamelModel`, 서버 내부는 snake_case)
- 오류 응답은 항상 `{"detail": "한국어 메시지"}`. 요청 검증 실패도 422 + 같은 형식
- 로그인 (2026-11-03): `/api/health` 외 모든 요청에 `Authorization: Bearer <meerkit 액세스 토큰>`이 필요하다. 없거나 틀리거나 만료면 401(`WWW-Authenticate: Bearer`). 말모아 백엔드에는 `/api/auth/*`가 없다 — 로그인·토큰 갱신은 브라우저의 `/api/*`(Next.js가 meerkit 백엔드로 넘김)
- 작업 ID 형식은 `moa-<UUID>` (예: `moa-79f7e21d-94af-49a0-96a0-60191aa35449`, 2026-11-02부터). 다른 사용자의 작업이나 이 형식이 아닌 `job_id`(예전 UUID만 있는 ID 포함)는 **404** (존재 여부를 숨김)

## 시스템

### `GET /api/health`
```json
{ "status": "ok", "database": "ok", "transcriber": "local_whisper", "whisperModel": "small", "ffmpeg": true, "llmConfigured": false, "llmModel": null, "maxUploadMb": 500 }
```
`database`(2026-11-03): DB 에 `select 1`을 해 본다. 닿지 않으면 **503** `{"detail": "DB에 연결할 수 없습니다."}`. 외부 cron 이 이 주소로 무료 서버를 깨운다 (`2026-11-03-DB와작업처리.md`).
`transcriber`(2026-11-03): 음성 변환 방식 `local_whisper` | `none`. `none`이면 음성 작업의 `POST /api/jobs/{id}/transcribe`가 **503** `{"detail": "이 서버에서는 음성 변환을 하지 않습니다. (TRANSCRIBER=none)"}` (사진 작업은 그대로 202).
`llmConfigured`·`llmModel`은 `.env` 기준이다 (사용자와 상관없는 상태 확인이라 사용자별 설정은 넣지 않음). 화면은 `GET /api/settings/llm`을 쓴다.

## 작업

### Job 객체
```ts
{
  id: string,                // moa-<UUID>
  userId: string,
  fileName: string,          // 표시용 원래 이름
  storedName: string,        // uploads/ 안의 실제 이름 ({id}.ext)
  source: "upload" | "recording" | "image",
  createdAt: string, updatedAt: string,   // ISO 8601
  sizeBytes: number, durationSec: number | null,
  status: "QUEUED" | "TRANSCRIBING" | "SUMMARIZING" | "COMPLETED" | "FAILED",
  progress: number | null,   // 0–100, 진행 중일 때만
  stage: string | null,      // "구간 3/24 변환 중" 같은 표시 문구
  errorMessage: string | null,
  transcriptReady: boolean, minutesReady: boolean,
  llmTokens: number | null,
  attendees: { name: string, role: string | null }[]   // 회의 참석자 (그때의 이름을 복사해 저장)
}
```

### 엔드포인트

| 메서드·경로 | 설명 | 성공 | 주요 오류 |
|---|---|---|---|
| `POST /api/jobs` | multipart `file`, `source`(upload/recording/image, 기본 upload), `attendees`(선택, JSON 배열 문자열), `event_id`(선택, 이 녹음을 연결할 내 일정 — 자동 녹음). 사진 확장자면 자동 image | 201 `Job` | 400 형식·빈 파일·참석자 형식·없는 일정, 413 용량 |
| `PUT /api/jobs/{id}/attendees` | JSON `{attendees: [{name, role}]}` 전체 교체 (이름 1~50자, 최대 100명, 같은 이름 한 번만) | `Job` | 404, 422 |
| `GET /api/jobs` | 내 작업 목록, 최신순 | `{jobs: Job[]}` | |
| `GET /api/jobs/{id}` | 작업 상태 | `Job` | 404 |
| `POST /api/jobs/{id}/transcribe` | 변환(음성) 또는 글자 읽기(사진) 시작. 이미 원문이 있으면 그대로 반환, 실패했던 작업은 이어서 | 202 `Job` | 409 처리 중 |
| `GET /api/jobs/{id}/transcript` | 원문 | `{jobId, text, segments: [{start, end, text, confidence?}], edited}` | 404 아직 없음 |
| `PUT /api/jobs/{id}/transcript` | 원문 수정 JSON `{texts: string[]}` — 문장 순서·개수 그대로, 글자만 바꿈(시간 유지), 빈 문장은 삭제. 원문 .json·.txt 다시 쓰고 실패한 회의록 구간 메모 삭제 | `Transcript` (`edited: true`) | 400 문장 5,000자 초과, 404, 409 처리 중·문장 개수 다름 |
| `GET /api/jobs/{id}/transcript.txt` | 원문 TXT 다운로드 (`{이름}_원문.txt`) | 파일 | 404 |
| `POST /api/jobs/{id}/minutes?force=false` | 회의록 생성 시작 (내 AI 연결 설정 사용) | 202 `Job` | 400 원문 없음·AI 연결 미완성(`/api/settings/llm`의 `problem`), 409 이미 있음(force로 재생성)·처리 중 |
| `GET /api/jobs/{id}/minutes` | 회의록 | `{jobId, markdown, generatedAt, model, edited}` | 404 |
| `PUT /api/jobs/{id}/minutes` | JSON `{markdown}` (최대 200,000자) 저장 | `MinutesDoc` (`edited: true`) | 404 |
| `GET /api/jobs/{id}/download?format=md\|txt\|docx\|pdf` | 회의록 파일 (`{이름}_회의록.md/.txt/.docx/.pdf`, UTF-8 파일명). Word·PDF는 `services/export.py` | 파일 | 404, 500 PDF 한글 글꼴 없음 |
| `GET /api/jobs/{id}/file` | 올린 원본 파일 (사진 미리보기용) | 파일 | 404 |
| `DELETE /api/jobs/{id}` | 작업 삭제: 원본·원문·회의록·임시 파일·작업 기록(참석자 포함). 참석자 명단은 남김 | 204 | 404, 409 처리 중, 500 파일 삭제 실패(기록은 남음) |

작업 삭제 범위는 [2026-10-28-작업삭제.md](2026-10-28-작업삭제.md) 참고.

## AI 회의록 연결 (2026-11-02)

키 원문은 어떤 응답에도 넣지 않는다. 설정이 없으면 `.env`(`OPENAI_*`) 값을 보여 준다(`source: "env"`).

| 메서드·경로 | 요청 | 응답 | 오류 |
|---|---|---|---|
| `GET /api/settings/llm` | — | `{provider, model, baseUrl, hasKey, keyHint, source: "screen"\|"env", label, problem, providers: [{id, label, needsKey, keyPage, suggestedModel}]}` | 401 |
| `PUT /api/settings/llm` | `{provider: "openai"\|"anthropic"\|"gemini"\|"compatible", model, apiKey?, baseUrl?}` | `LlmSettings` | 400 키 없음(다른 제공자로 바꿀 때)·키에 공백·모델 없음·호환인데 주소 없음·주소 형식 |
| `DELETE /api/settings/llm` | — | 204 (→ `.env` 값 사용) | |
| `POST /api/settings/llm/check` | `{provider, apiKey?, baseUrl?}` (키를 비우면 같은 제공자로 저장된 키) | `{models: string[], message}` 모델 목록 조회만, 비용 없음 | 400 키 틀림·연결 안 됨 등 한국어 안내 |

`problem`이 `null`이 아니면 회의록 생성(`POST /api/jobs/{id}/minutes`)이 같은 메시지로 400.

## AI 사용량 (2026-11-02)

말모아가 회의록 작성에 쓴 AI 호출·토큰. 제공자의 남은 크레딧이 아니다. 하루·한 달은 한국 시간 기준.

| 메서드·경로 | 요청 | 응답 | 오류 |
|---|---|---|---|
| `GET /api/usage` | — | `UsageSummary` | |
| `PUT /api/usage/limits` | `{monthlyTokens: number\|null, dailyCalls: number\|null}` (null = 한도 없음) | `UsageSummary` | 422 0 이하·상한 초과(20억 토큰·100만 번) |

```ts
UsageTotals  = { calls, inputTokens, outputTokens, tokens }
UsageSummary = {
  today: UsageTotals, month: UsageTotals, all: UsageTotals,
  monthStart: string,   // 이번 달 1일 0시 (+09:00)
  nextDay: string,      // 내일 0시 (+09:00): 하루 호출 수가 다시 0이 되는 때
  byModel: (UsageTotals & { provider, model })[],   // 이번 달, 많이 쓴 순
  recent: { id, createdAt, jobId: string|null, fileName, provider, model, calls, inputTokens, outputTokens }[],  // 최근 20개
  monthlyTokens: number|null, dailyCalls: number|null
}
```

## 참석자 명단

| 메서드·경로 | 요청 | 응답 | 오류 |
|---|---|---|---|
| `GET /api/people` | — | `{people: [{id, name, role, createdAt}]}` 이름순 | |
| `POST /api/people` | `{name, role}` | 201 `Person` | 409 이미 있는 이름, 422 |
| `PUT /api/people/{id}` | `{name, role}` | `Person` | 404, 409 |
| `DELETE /api/people/{id}` | — | 204 (지난 회의의 참석자 기록은 그대로) | 404 |

## 일정 (캘린더, 2026-10-29)

설계·이후 단계(알람·자동 녹음)는 [2026-10-29-일정·알람·자동녹음.md](2026-10-29-일정·알람·자동녹음.md).

**Event**: `{id, title, kind: "meeting"|"other", startsAt, endsAt, allDay, location, memo, attendees: [{name, role}], reminders: [분], autoRecord, autoRecordState: "none"|"armed"|"started"|"skipped"|"failed", autoRecordNote, jobId, calendarSynced, calendarError, createdAt, updatedAt}` — `calendarSynced`는 Mac 캘린더 앱(→ 아이폰)에 내보냄, `calendarError`는 내보내지 못한 이유

**요청 본문 (EventIn)**: `{title(1~100), kind=meeting, startsAt, endsAt, allDay=false, location(≤200), memo(≤2000), attendees(≤100, 같은 이름은 한 번), reminders(0·5·10·30·60·1440 중, 큰 순으로 정리), autoRecord=false}` — 시각은 **시간대 포함** ISO 8601 (없으면 422)

| 메서드·경로 | 요청 | 응답 | 오류 |
|---|---|---|---|
| `GET /api/events?from=&to=` | 시간대 포함 시각 | `{events: [Event]}` 기간과 겹치는 일정, 시작 시각순 | 400 시간대 없음·기간 역순·400일 초과, 422 from/to 없음 |
| `POST /api/events` | EventIn | 201 Event | 400 아래 규칙, 422 |
| `GET /api/events/{id}` | — | Event | 404 |
| `PUT /api/events/{id}` | EventIn | Event | 400, 404, 422 |
| `DELETE /api/events/{id}` | — | 204 일정만 (연결된 녹음 작업은 그대로). 캘린더 앱에 내보낸 같은 일정도 지움 | 404 |
| `GET /api/events/calendar-sync` | — | `{enabled, available, calendarName, failed}` 아이폰 내보내기 설정. `failed` = 내보내지 못한 앞으로의 일정 수 | — |
| `PUT /api/events/calendar-sync` | `{enabled}` | 같은 형식. 켜면 캘린더·권한을 확인하고 아직 끝나지 않은 일정을 뒤에서 모두 내보냄. 끄면 이미 넣은 일정은 남김 | 400 캘린더 없음·권한 없음·Mac 아님 |
| `POST /api/events/{id}/sync` | — | Event. 캘린더 앱에 다시 내보내기 (실패했을 때) | 400 내보내기 꺼짐, 404 |
| `POST /api/events/{id}/auto-record` | `{state: "started"\|"skipped"\|"failed", note?(≤255)}` | Event. 자동 녹음 결과 보고(녹음한 탭이 보냄) + Mac 알림 | 404, 409 대기 중이 아님·자동 녹음 꺼짐, 422 |
| `POST /api/recorder/heartbeat` | `{micPermission: "granted"\|"prompt"\|"denied"\|"unknown"}` | 204. 말모아 탭 생존 신호(30초마다), 사용자마다 마지막 하나만 DB `recorder_beats`에 | 422 |
| `GET /api/events/reminders?since=` | 시간대 포함 시각 | `{reminders: [{eventId, minutesBefore, sentAt, message}]}` since 이후 실제로 울린 내 알람 (최대 하루 전까지). 화면 알림이 30초마다 부름 | 400 시간대 없음 |

400 규칙: 종료 ≤ 시작, 31일 초과, 자동 녹음을 회의가 아닌 일정·종일 일정·시작한 지 10분 넘게 지난 일정에 거는 경우.
자동 녹음 상태: 켜면 `armed`. 수정할 때 자동 녹음을 새로 켜거나 시작 시각을 바꾸면 다시 `armed`, 끄면 `none`, 그 밖에는 유지.
녹음 작업을 지우면 `jobId`는 `null`이 되고 일정은 남습니다.

알람 (`app/services/reminders.py`, 30초마다): 알람 시각에서 2분 안이면 울림. 놓친 알람은 시작 전이면 "곧 시작" 한 번만, 시작 후면 조용히 넘김. 처리 기록은 `event_reminders`(일정+분 단위로 한 번)에 남아 서버를 껐다 켜도 다시 울리지 않음. 일정 저장 때 이미 지난 알람 시점은 미리 처리한 것으로 기록. 시작 시각을 바꾸면 기록을 지우고 다시 계산.

아이폰 내보내기 (`app/services/apple_calendar.py`, 켜 두었을 때): 일정 추가·수정 때 Mac 캘린더 앱의 `APPLE_CALENDAR_NAME`(기본 Malmoa) 캘린더에 제목·시간·장소·알림을 넣음. 메모·참석자는 넘기지 않음. 한 방향. 실패해도 일정 저장은 성공(201/200)이고 `calendarError`에 이유.

자동 녹음 (`app/services/auto_record.py`, 알람 검사기와 함께 30초마다): 시작 5분 전에 최근 2분 안의 생존 신호가 없거나 마이크 권한이 `granted`가 아니면 Mac 알림으로 한 번 경고. 시작 시각 + 10분이 지나도 `armed`면 `skipped`("탭이 닫혀 있었거나 Mac이 잠자기")로 바꾸고 알림.

### 상태 변화

```text
POST /api/jobs                → QUEUED (stage "변환 대기" / "글자 읽기 대기")
POST /transcribe              → QUEUED(progress 0, "변환 순서 대기 중") → TRANSCRIBING → COMPLETED | FAILED
POST /minutes                 → SUMMARIZING → COMPLETED | FAILED
서버 재시작 시 진행 중이던 작업 → FAILED ("다시 시도하면 완료된 구간부터 이어서")
```

프런트는 `isActive(job)` (TRANSCRIBING·SUMMARIZING·또는 QUEUED이면서 progress가 있음)일 때만 2초 폴링합니다.

### 예시

```bash
curl -F file=@회의.m4a -F source=upload http://localhost:8010/api/jobs
curl -X POST http://localhost:8010/api/jobs/<id>/transcribe
curl http://localhost:8010/api/jobs/<id>
curl http://localhost:8010/api/jobs/<id>/transcript.txt -o 원문.txt
```
