'use client'

import { AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/malmoa/ui/button'
import { useCalendarSync, useSetCalendarSync } from '@/hooks/malmoa/queries'
import { Notice, ToneBadge } from './common'
import { Group } from './px'

/** 설정: 일정을 Mac 캘린더 앱(iCloud)으로 내보내 아이폰 캘린더가 알림을 울리게 한다 (docs/2026-10-29-일정·알람·자동녹음.md 2-C) */
export function CalendarSyncCard() {
  const sync = useCalendarSync()
  const toggle = useSetCalendarSync()
  const s = sync.data
  const name = s?.calendarName ?? 'Malmoa'

  return (
    <Group title="Mac 캘린더 앱으로 내보내기 (이 Mac 에서 실행할 때)" className="scroll-mt-24">
      <div id="calendar-sync" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="flex-1 basis-72 text-sm leading-relaxed">
            말모아 일정을 Mac 캘린더 앱의 ‘{name}’ 캘린더(iCloud)에 같이 넣습니다. 아이폰 캘린더가 알람 시각에 직접 울려서 Mac이 잠들어 있어도 알림을 받을 수 있습니다.
          </p>
          {s && (
            <div className="flex items-center gap-3">
              <ToneBadge tone={s.enabled ? 'success' : 'neutral'}>{s.enabled ? '켜짐' : '꺼짐'}</ToneBadge>
              <Button variant={s.enabled ? 'outline' : 'default'} disabled={!s.available || toggle.isPending} onClick={() => toggle.mutate(!s.enabled)}>
                {toggle.isPending ? '확인 중…' : s.enabled ? '끄기' : '켜기'}
              </Button>
            </div>
          )}
        </div>
        {sync.isError && (
          <Notice tone="error" icon={<AlertTriangle />}>
            설정을 불러오지 못했습니다: {sync.error.message}
          </Notice>
        )}
        {s && !s.available && (
          <Notice tone="warning" icon={<AlertTriangle />}>
            말모아 서버가 Mac이 아닌 곳에서 실행 중이라 쓸 수 없습니다. 위의 ‘캘린더 구독’으로 휴대폰에서 일정과 알람을 받으세요.
          </Notice>
        )}
        {toggle.isError && (
          <Notice tone="error" icon={<AlertTriangle />}>
            {toggle.error.message}
          </Notice>
        )}
        {s?.enabled && s.failed > 0 && (
          <Notice
            tone="warning"
            icon={<AlertTriangle />}
            action={
              <Button variant="outline" size="sm" asChild>
                <Link href="/calendar">캘린더에서 보기</Link>
              </Button>
            }
          >
            앞으로의 일정 {s.failed}개를 캘린더 앱에 넣지 못했습니다. 캘린더에서 일정을 열어 ‘다시 시도’를 눌러 주세요.
          </Notice>
        )}
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-[#404040]">
          <li>
            넘기는 것은 <strong className="font-medium text-black">제목·시간·장소·알람</strong>뿐입니다. 메모·참석자·녹음·원문은 넘기지 않습니다. 넘긴 내용은 사용자의 iCloud에
            저장됩니다.
          </li>
          <li>한 방향입니다. 캘린더 앱이나 아이폰에서 고친 내용은 말모아로 돌아오지 않으니 일정은 말모아에서 고쳐 주세요.</li>
          <li>켜면 아직 끝나지 않은 일정을 모두 넣고, 그 뒤로는 저장·삭제할 때마다 같이 반영합니다. 끄면 이미 넣은 일정은 캘린더 앱에 남습니다.</li>
          <li>종일 일정에는 캘린더 앱의 ‘종일 이벤트 기본 알림’이 함께 붙을 수 있습니다 (캘린더 앱 설정 › 알림에서 바꿀 수 있음).</li>
          <li>필요: 캘린더 앱에서 iCloud 아래에 ‘{name}’ 캘린더를 만들어 두고, 아이폰 설정 › 캘린더 › 계정 › iCloud에서 캘린더를 켭니다.</li>
        </ul>
      </div>
    </Group>
  )
}
