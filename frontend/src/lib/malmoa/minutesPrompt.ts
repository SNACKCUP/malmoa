import type { Attendee, Transcript } from './types'
import { formatAttendee, formatClock } from './format'

/**
 * API 없이 쓰는 방법: 이 요청문 + 원문을 복사해 ChatGPT·Claude 등에 직접 붙여넣는다.
 * 규칙과 항목은 backend/app/services/minutes.py 의 프롬프트와 같게 유지한다.
 * fromImage: 화이트보드 사진에서 글자 인식으로 읽은 원문 (시점 정보 없음)
 * attendees: 사용자가 등록한 참석자. 담당자 이름 표기를 맞추는 데만 쓰게 한다.
 */
export function buildMinutesPrompt(transcript: Transcript, fileName: string, fromImage = false, attendees: Attendee[] = []): string {
  return joinPrompt(buildPromptInstructions(fromImage, attendees), transcriptBlock(transcript, fileName, fromImage))
}

/** 요청문(설명) + 원문을 합친다. 설명을 화면에서 고쳐도 같은 모양으로 붙는다 */
export function joinPrompt(instructions: string, block: string): string {
  return `${instructions.trimEnd()}\n\n${block}`
}

/** 원문 부분: [원문 — 파일명] 다음 줄부터 문장 (음성은 [시:분:초] 포함) */
export function transcriptBlock(transcript: Transcript, fileName: string, fromImage = false): string {
  const lines = fromImage
    ? transcript.segments.map((s) => s.text).join('\n')
    : transcript.segments.map((s) => `[${formatClock(s.start * 1000)}] ${s.text}`).join('\n')
  return `[원문 — ${fileName}]\n${lines}`
}

/** 원문 앞에 붙는 설명(요청문): 무엇을 어떤 규칙·형식으로 써 달라는지 */
export function buildPromptInstructions(fromImage = false, attendees: Attendee[] = []): string {
  const intro = fromImage
    ? '아래는 회의 중 화이트보드를 찍은 사진에서 글자 인식으로 읽은 내용입니다. 이 내용으로 회의록을 작성해 주세요.'
    : '아래는 회의 녹음을 음성 인식(Whisper)으로 받아 적은 원문입니다. 이 원문으로 회의록을 작성해 주세요.'
  const sourceRules = fromImage
    ? `- 글자 인식 결과라 잘못 읽은 글자나 빠진 줄이 있을 수 있습니다. 문맥상 명백한 것만 바로잡고, 애매한 고유명사·숫자는 '추가 확인이 필요한 사항'에 적어 주세요.
- 도형·화살표·그림은 읽지 못했습니다. 줄 사이의 관계를 추측하지 마세요.`
    : `- 음성 인식 결과라 오탈자나 잘못 인식된 단어가 있을 수 있습니다. 문맥상 명백한 것만 바로잡고, 애매한 고유명사·숫자는 '추가 확인이 필요한 사항'에 적어 주세요.
- 여러 사람의 발언이 화자 구분 없이 섞여 있습니다. 누가 말했는지 추측하지 마세요.
- 각 줄 앞의 [시:분:초]는 발언 시점입니다.`
  const attendeeSection = attendees.length
    ? `
[참석자]
${attendees.map((a) => `- ${formatAttendee(a)}`).join('\n')}
- 원문에 나온 이름이 참석자와 같은 사람으로 보이면 담당자를 참석자 명단의 이름으로 적어 주세요. (인식 과정에서 이름이 조금 틀렸을 수 있습니다)
- 원문에서 이름이 나오지 않은 할 일에 참석자를 담당자로 넣지 마세요. 그런 경우는 "확인 필요"입니다.
- 회의록 맨 위에 참석자 명단을 그대로 적어 주세요.
`
    : ''
  return `${intro}

[작성 규칙]
- 반드시 원문에 근거해서만 작성하고, 원문에 없는 사실·담당자·날짜·결정을 만들어 내지 마세요.
- 담당자나 마감일이 원문에서 명확하지 않으면 "확인 필요"라고 써 주세요.
- '결정 사항'에는 합의·확정된 것만 넣고, 제안이나 의견은 논의 내용에 넣어 주세요.
${sourceRules}

[회의록 형식]
1. 회의 제목
2. 회의 개요 (2~3문장)
3. 주요 논의 내용 (주제별)
4. 핵심 요약 (3~5개)
5. 결정 사항
6. 담당자별 실행 과제 (담당자 / 할 일 / 마감일)
7. 일정 및 마감일
8. 추가 확인이 필요한 사항
${attendeeSection}`
}
