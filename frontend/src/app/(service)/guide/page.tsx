import { Pause } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Button } from '@/components/malmoa/ui/button'
import { OsWindow } from '@/components/malmoa/app-shell'
import { PixelIcon } from '@/components/malmoa/px'
import { ToneBadge } from '@/components/malmoa/common'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: '사용 안내' }

const SECTIONS = [
  { id: 'flow', label: '전체 작업 흐름' },
  { id: 'prepare', label: '녹음 전 준비' },
  { id: 'record', label: '직접 녹음하기' },
  { id: 'upload', label: '파일 업로드' },
  { id: 'recover', label: '녹음이 끊겼을 때' },
  { id: 'caution', label: '정확도를 높이려면' },
  { id: 'privacy', label: '개인정보' },
  { id: 'faq', label: '문제 해결' },
]

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-16 border-b border-shade pb-6 last:border-0 last:pb-0">
      <h2 id={`${id}-title`} className="font-pixel text-2xl text-[#000080]">
        {title}
      </h2>
      {description && <p className="mt-1 text-sm text-[#404040]">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Checklist({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-black">
          <PixelIcon name="check" size={18} className="mt-1 shrink-0 text-[#000080]" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

/** 버튼 이름을 본문에서 가리킬 때 쓰는 표시 (누를 수 있는 버튼이 아님) */
function Key({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'primary' | 'danger' }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 px-2 align-middle font-pixel text-[13px] whitespace-nowrap text-black w98-out',
        tone === 'primary' && 'outline outline-1 -outline-offset-1 outline-black',
        tone === 'danger' && 'text-[#b00000]',
      )}
    >
      {children}
    </span>
  )
}

const FLOW: { icon: ReactNode; title: string; body: string; ready: boolean }[] = [
  { icon: <PixelIcon name="mic" size={24} />, title: '녹음 또는 업로드', body: '브라우저에서 바로 녹음하거나, 이미 녹음한 파일을 올립니다.', ready: true },
  { icon: <PixelIcon name="lock" size={24} />, title: '자동 저장', body: '녹음은 10초마다 이 브라우저에 저장되어 중간에 꺼져도 남습니다.', ready: true },
  { icon: <PixelIcon name="doc" size={24} />, title: '음성 → 텍스트', body: '이 Mac에서 Whisper가 음성을 한국어 텍스트로 바꿉니다.', ready: true },
  { icon: <PixelIcon name="bolt" size={24} />, title: 'AI 회의록 작성', body: '변환된 텍스트만 AI에 보내 요약·결정 사항·할 일을 정리합니다. (설정에서 API 연결 필요)', ready: true },
  { icon: <PixelIcon name="check" size={24} />, title: '확인 · 편집 · 다운로드', body: '회의록 뷰어에서 원문과 회의록을 고치고 Word · PDF · Markdown · TXT로 내려받습니다.', ready: true },
]

const STATES: { step: string; icon: ReactNode; iconClass: string; title: string; body: ReactNode }[] = [
  {
    step: '1. 녹음 전',
    icon: <PixelIcon name="mic" size={24} />,
    iconClass: 'text-[#000080] w98-out',
    title: '마이크와 모드 선택',
    body: (
      <>
        사용할 마이크를 고르고 <b className="font-medium">회의실 모드</b>를 확인한 뒤 <Key tone="primary">녹음 시작</Key>을 누릅니다. 처음 한 번은 브라우저가 마이크 권한을 묻습니다. <b className="font-medium">이번 회의 참석자</b>도 여기서 고릅니다 (녹음 중에 늦게 온 사람을 더해도 됩니다).
      </>
    ),
  },
  {
    step: '2. 녹음 중',
    icon: <span className="size-3 bg-error" />,
    iconClass: 'text-[#000080] w98-out',
    title: '시간과 입력 레벨 확인',
    body: (
      <>
        경과 시간과 입력 막대가 움직이는지 확인하세요. 막대가 거의 움직이지 않으면 Mac을 화자 가까이 옮깁니다. <Key>일시정지</Key> <Key tone="danger">종료</Key>
      </>
    ),
  },
  {
    step: '3. 일시정지',
    icon: <Pause size={22} />,
    iconClass: 'text-[#000080] w98-out',
    title: '쉬는 시간에 멈추기',
    body: (
      <>
        일시정지한 동안은 녹음되지 않고 시간도 멈춥니다. 멈춘 순간까지 바로 저장됩니다. <Key>재개</Key>로 이어서 녹음합니다.
      </>
    ),
  },
  {
    step: '4. 종료 후',
    icon: <PixelIcon name="check" size={24} />,
    iconClass: 'text-[#000080] w98-out',
    title: '들어 보고 보관하기',
    body: (
      <>
        재생해서 녹음을 확인하세요. <Key tone="primary">파일 저장</Key>으로 Mac에 내려받을 수 있고, <Key>다시 녹음</Key>은 지금 녹음을 지웁니다.
      </>
    ),
  },
]

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: '“마이크 사용 권한이 거부되었습니다”가 나와요',
    a: (
      <>
        주소창 왼쪽의 사이트 설정 아이콘을 눌러 마이크를 ‘허용’으로 바꿉니다. 그래도 안 되면 macOS <b className="font-medium">시스템 설정 › 개인정보 보호 및 보안 › 마이크</b>에서 사용하는 브라우저를 켜고, 브라우저를 다시 시작하세요.
      </>
    ),
  },
  { q: '“다른 앱이 마이크를 사용 중”이라고 나와요', a: 'Zoom, FaceTime, 녹음 앱처럼 마이크를 쓰는 앱을 종료한 뒤 다시 시도하세요.' },
  {
    q: '입력 막대가 거의 움직이지 않아요',
    a: (
      <>
        <b className="font-medium">시스템 설정 › 사운드 › 입력</b>에서 올바른 마이크가 선택되어 있는지, 입력 음량이 너무 낮지 않은지 확인하세요. 녹음 화면의 ‘마이크’ 목록에서도 장치를 고를 수 있습니다.
      </>
    ),
  },
  { q: '녹음이 저장되지 않는다고 나와요', a: '시크릿(개인 정보 보호) 창에서는 브라우저 저장소가 제한됩니다. 일반 창에서 사용하세요. Mac 저장 공간이 부족한 경우에도 발생할 수 있습니다.' },
  { q: '재생바가 움직이지 않아요', a: 'Chrome에서 녹음한 WebM 파일은 브라우저가 전체 길이를 계산하는 데 1~2초가 걸립니다. 잠시 기다린 뒤 다시 눌러 주세요.' },
  { q: '어떤 브라우저를 써야 하나요?', a: '최신 Chrome 또는 Edge를 권장합니다. Safari도 녹음은 되지만 파일이 M4A 형식으로 저장됩니다. 주소는 http://localhost:3001 으로 열어야 마이크를 쓸 수 있습니다.' },
]

export default function GuidePage() {
  return (
    <OsWindow icon="❓" title="말모아 도움말 - [사용 안내]" width="max-w-5xl">
        <p className="px-1 pb-1 text-[12px] text-[#464653]">교실이나 회의실에서 여러 사람의 대화를 Mac으로 녹음하고, 텍스트와 회의록으로 정리하는 방법입니다.</p>
        <div className="grid md:grid-cols-[210px_1fr]">
          <nav aria-label="사용 안내 목차" className="p-2 md:sticky md:top-14 md:self-start">
            <p className="mb-1 font-pixel text-sm">목차</p>
            <ul className="grid bg-white p-1 text-sm text-black w98-in">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="flex items-center gap-2 px-2 py-1 hover:bg-[#000080] hover:text-white focus-visible:bg-[#000080] focus-visible:text-white focus-visible:outline-none">
                    <PixelIcon name="doc" size={12} className="shrink-0" />
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="m-2 grid gap-6 bg-white p-5 text-black w98-in md:ml-0">
      <Section id="flow" title="전체 작업 흐름" description="녹음부터 회의록까지 다섯 단계로 진행됩니다.">
        <ol className="grid gap-3 sm:grid-cols-2">
          {FLOW.map((f, i) => (
            <li key={f.title} className="flex flex-col gap-3 p-3 w98-flat">
              <div className="flex items-center justify-between">
                <span className="flex size-10 items-center justify-center text-[#000080] w98-out">{f.icon}</span>
                {f.ready ? <ToneBadge tone="success">사용 가능</ToneBadge> : <ToneBadge>준비 중</ToneBadge>}
              </div>
              <div>
                <p className="font-pixel text-lg">
                  {i + 1}. {f.title}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-[#404040]">{f.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="prepare" title="녹음 전 준비" description="2시간 회의를 끊김 없이 녹음하기 위한 Mac 설정입니다.">
        <Checklist
          items={[
            <>Mac에 <b className="font-medium">전원 어댑터를 연결</b>합니다. 녹음 중에는 화면이 꺼지지 않도록 자동으로 막지만, 배터리가 떨어지면 녹음이 멈춥니다.</>,
            <>Mac을 <b className="font-medium">책상 가운데, 화자들과 비슷한 거리</b>에 두고 덮개를 연 채로 둡니다. MacBook의 마이크는 키보드 위쪽에 있습니다.</>,
            <>
              <b className="font-medium">시스템 설정 › 사운드 › 입력</b>에서 사용할 마이크와 입력 음량을 확인합니다.
            </>,
            <>Zoom, FaceTime 등 마이크를 쓰는 앱을 종료하고, 브라우저는 <b className="font-medium">일반 창</b>으로 엽니다.</>,
            <>녹음한다는 사실을 참석자에게 미리 알립니다.</>,
            <>
              자주 오는 사람은 <Link href="/settings#people" className="font-medium text-[#000080] underline underline-offset-2">설정 › 참석자 명단</Link>에 미리 등록해 두면 회의마다 눌러서 참석자로 넣을 수 있습니다. 참석자는 결과 화면·작업 목록·회의록에 표시되고, 결과 화면에서 언제든 고칠 수 있습니다.
            </>,
          ]}
        />
      </Section>

      <Section id="record" title="직접 녹음하기" description="홈 화면의 ‘직접 녹음’ 패널은 상태에 따라 이렇게 바뀝니다.">
        <ol className="grid gap-3 sm:grid-cols-2">
          {STATES.map((s) => (
            <li key={s.step} className="flex flex-col gap-3 p-3 w98-flat">
              <p className="text-[13px] font-medium text-[#404040]">{s.step}</p>
              <span className={cn('flex size-11 items-center justify-center', s.iconClass)}>{s.icon}</span>
              <p className="font-pixel text-lg">{s.title}</p>
              <p className="text-sm leading-7 text-black">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-4 bg-[#ffffe1] p-3 w98-flat text-sm leading-relaxed text-black">
          <p className="font-medium">회의실 모드란?</p>
          <p className="mt-1 text-[#404040]">
            브라우저의 통화용 음성 처리(에코 제거·잡음 억제)는 마이크 바로 앞 한 사람에게 맞춰져 있어, 멀리 있는 사람의 목소리를 잡음으로 보고 줄일 수 있습니다. 회의실 모드는 이 처리를 끄고 음량 자동 조절만 남깁니다. 여러 사람이 떨어져 앉은 교실·회의실에서는 켜 두세요.
          </p>
        </div>
      </Section>

      <Section id="upload" title="파일 업로드" description="휴대폰이나 녹음기로 이미 녹음한 파일도 쓸 수 있습니다.">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: <PixelIcon name="mic" size={20} />, title: '지원 형식', body: 'MP3 · WAV · M4A · WEBM' },
            { icon: <PixelIcon name="upload" size={20} />, title: '최대 크기', body: '파일 하나당 500MB' },
            { icon: <PixelIcon name="star" size={20} />, title: '권장 길이', body: '2시간 분량 회의까지' },
          ].map((c) => (
            <div key={c.title} className="flex items-center gap-3 p-3 w98-flat">
              <span className="flex size-10 shrink-0 items-center justify-center text-[#000080] w98-out">{c.icon}</span>
              <div>
                <p className="text-[13px] text-[#404040]">{c.title}</p>
                <p className="text-[15px] font-medium text-black">{c.body}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm leading-relaxed text-[#404040]">
          파일을 업로드 영역으로 끌어다 놓거나 <Key>파일 선택</Key>을 누른 뒤 <Key tone="primary">업로드하고 텍스트로 변환</Key>을 누릅니다.
        </p>
      </Section>

      <Section id="recover" title="녹음이 끊겼을 때" description="브라우저나 Mac이 갑자기 꺼져도 녹음은 대부분 남아 있습니다.">
        <ol className="flex flex-col gap-3 text-[15px] leading-relaxed text-black">
          <li className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center bg-[#000080] font-pixel text-[13px] text-white">1</span>
            녹음은 <b className="font-medium">10초마다</b> 이 브라우저에 저장됩니다. 갑자기 꺼지면 마지막 10초 이내만 사라집니다.
          </li>
          <li className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center bg-[#000080] font-pixel text-[13px] text-white">2</span>
            <span>
              말모아를 다시 열면 녹음 패널에 <b className="font-medium">“이전 녹음이 중간에 종료되었습니다”</b>가 표시됩니다. <Key tone="primary">불러오기</Key>를 누르면 저장된 부분까지 이어 붙여 재생·저장할 수 있습니다.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center bg-[#000080] font-pixel text-[13px] text-white">3</span>
            회의가 계속되는 중이면 불러온 녹음을 <Key>파일 저장</Key>으로 내려받아 두고, 새로 녹음을 시작하세요.
          </li>
        </ol>
        <div className="mt-4 flex gap-3 bg-[#ffffe1] p-3 w98-flat text-sm leading-relaxed text-black">
          <PixelIcon name="help" size={18} className="mt-0.5 shrink-0" />
          <p>브라우저의 ‘인터넷 사용 기록 / 사이트 데이터 삭제’를 하면 보관 중인 녹음도 함께 지워집니다. 중요한 녹음은 꼭 파일로 저장해 두세요.</p>
        </div>
      </Section>

      <Section id="caution" title="정확도를 높이려면" description="음성 인식(Whisper)은 녹음 상태에 따라 정확도가 크게 달라집니다.">
        <Checklist
          items={[
            '마이크에서 3~4m 넘게 떨어진 발언은 정확도가 떨어집니다. 넓은 교실에서는 USB 회의용 마이크를 연결하고 녹음 화면에서 선택하세요.',
            '여러 사람이 동시에 말하면 겹친 부분은 제대로 인식되지 않습니다. 한 사람씩 말하도록 진행하면 결과가 훨씬 좋아집니다.',
            '녹음 중 Mac 키보드를 치면 그 소리가 가장 크게 녹음됩니다. 메모는 다른 기기로 하세요.',
            <>
              말모아는 <b className="font-medium">누가 말했는지 구분하지 못합니다.</b> “OO님이 금요일까지 정리해 주세요”처럼 이름을 말로 언급해야 회의록의 담당자 칸이 채워집니다. 확인할 수 없는 담당자·마감일은 ‘확인 필요’로 표시됩니다.
            </>,
            '온라인 회의 상대방의 목소리는 스피커 소리로만 녹음되어 품질이 낮습니다. 스피커 음량을 적당히 키우세요.',
          ]}
        />
      </Section>

      <Section id="privacy" title="개인정보" description="녹음 파일이 어디에 보관되고 무엇이 외부로 나가는지 정리했습니다.">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="p-3 w98-flat">
            <PixelIcon name="lock" size={22} className="text-[#000080]" />
            <p className="mt-2 font-pixel text-lg">음성은 Mac 밖으로 나가지 않습니다</p>
            <p className="mt-1 text-[13px] leading-relaxed text-[#404040]">녹음과 업로드한 파일은 이 Mac의 브라우저와 로컬 서버에만 저장됩니다.</p>
          </div>
          <div className="p-3 w98-flat">
            <PixelIcon name="mic" size={22} className="text-[#000080]" />
            <p className="mt-2 font-pixel text-lg">음성 변환도 Mac에서</p>
            <p className="mt-1 text-[13px] leading-relaxed text-[#404040]">Whisper가 이 Mac에서 직접 실행되어, 변환을 위해 음성을 외부로 보내지 않습니다.</p>
          </div>
          <div className="bg-[#ffffe1] p-3 w98-flat">
            <PixelIcon name="bolt" size={22} className="text-[#000080]" />
            <p className="mt-2 font-pixel text-lg">회의록 작성 시 텍스트만 전송</p>
            <p className="mt-1 text-[13px] leading-relaxed text-black">AI 회의록을 만들 때는 변환된 텍스트가 AI API로 전송됩니다. 민감한 회의라면 이 단계 전에 원문을 확인하세요.</p>
          </div>
        </div>
      </Section>

      <Section id="faq" title="문제 해결">
        <div className="grid gap-2">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-4 w98-out">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 font-pixel text-base text-black [&::-webkit-details-marker]:hidden">
                {f.q}
                <span aria-hidden="true" className="text-[#404040] transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="pb-4 text-sm leading-relaxed text-[#404040]">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>

            <div className="flex flex-wrap items-center justify-between gap-3 p-4 w98-out">
              <p className="font-pixel text-xl">준비가 되었다면 홈에서 바로 녹음을 시작하세요!</p>
              <Button asChild>
                <Link href="/">
                  <PixelIcon name="mic" size={18} /> 녹음하러 가기
                </Link>
              </Button>
            </div>
          </div>
        </div>
    </OsWindow>
  )
}
