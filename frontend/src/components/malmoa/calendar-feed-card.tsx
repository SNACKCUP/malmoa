'use client'

import { AlertTriangle, CalendarPlus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/malmoa/ui/button'
import { useCalendarFeed, useCreateCalendarFeed, useDeleteCalendarFeed } from '@/hooks/malmoa/queries'
import { formatDateTime } from '@/lib/malmoa/format'
import { CopyButton } from './copy-button'
import { Notice, ToneBadge } from './common'
import { Group } from './px'

/**
 * 설정: 캘린더 구독 주소 (ICS, 통합 단계 5-6). 아이폰·구글 캘린더가 이 주소로 말모아 일정을 받아 가고 알람도 울린다.
 * 주소는 만들 때 한 번만 보여 준다 (서버에는 해시만). 잃어버리면 다시 만들기 — 예전 주소는 바로 막힌다.
 */
export function CalendarFeedCard() {
  const feed = useCalendarFeed()
  const create = useCreateCalendarFeed()
  const remove = useDeleteCalendarFeed()
  const [url, setUrl] = useState<string | null>(null)
  const f = feed.data
  const busy = create.isPending || remove.isPending

  const make = () =>
    create.mutate(undefined, {
      onSuccess: (r) => setUrl(new URL(r.path, window.location.origin).toString()),
    })

  return (
    <Group title="캘린더 구독 (아이폰·구글 캘린더)" className="scroll-mt-24">
      <div id="calendar-feed" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="flex-1 basis-72 text-sm leading-relaxed">
            말모아 일정을 휴대폰 캘린더에서 구독합니다. 제목·시각·장소·메모·참석자와 알람이 들어가고, 녹음·회의록은 들어가지 않습니다. 휴대폰 캘린더가 알람 시각에 직접 울립니다.
          </p>
          {f && (
            <div className="flex flex-wrap items-center gap-2">
              <ToneBadge tone={f.enabled ? 'success' : 'neutral'}>{f.enabled ? '켜짐' : '꺼짐'}</ToneBadge>
              <Button variant={f.enabled ? 'outline' : 'default'} disabled={busy} onClick={make}>
                <CalendarPlus /> {f.enabled ? '주소 다시 만들기' : '구독 주소 만들기'}
              </Button>
              {f.enabled && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    remove.mutate(undefined, {
                      onSuccess: () => setUrl(null),
                    })
                  }
                >
                  끄기
                </Button>
              )}
            </div>
          )}
        </div>
        {f?.enabled && f.createdAt && !url && <p className="text-[12px] text-[#404040]">{formatDateTime(f.createdAt)}에 만든 주소를 쓰는 중입니다. 주소를 잃어버렸으면 ‘주소 다시 만들기’를 누르세요 (예전 주소는 막힙니다).</p>}
        {url && (
          <div className="grid gap-2 bg-white p-2 w98-in">
            <p className="text-[12px] font-bold">구독 주소 — 지금만 볼 수 있습니다. 휴대폰 캘린더에 넣어 주세요.</p>
            <code className="block break-all bg-[#ffffe1] p-2 font-mono text-[12px]">{url}</code>
            <div>
              <CopyButton variant="outline" size="sm" text={() => url}>
                주소 복사
              </CopyButton>
            </div>
            <p className="text-[12px] leading-relaxed text-[#404040]">
              아이폰: 설정 › 캘린더 › 계정 › 계정 추가 › 기타 › <b>구독 캘린더 추가</b>에 붙여 넣기. 구글 캘린더(컴퓨터): 다른 캘린더 + › <b>URL로 추가</b>. 새 일정이 휴대폰에 보이기까지는 캘린더 앱이 정한 간격(보통 수십 분~몇 시간)이 걸립니다.
            </p>
          </div>
        )}
        <Notice tone="warning" icon={<AlertTriangle />}>
          이 주소를 아는 사람은 로그인 없이 일정 제목·장소·메모·참석자 이름을 볼 수 있습니다. 다른 사람에게 보내지 마세요. 새어 나갔다면 ‘주소 다시 만들기’나 ‘끄기’를 누르세요.
        </Notice>
        {(feed.isError || create.isError || remove.isError) && (
          <Notice tone="error" icon={<AlertTriangle />}>
            {(feed.error ?? create.error ?? remove.error)?.message}
          </Notice>
        )}
      </div>
    </Group>
  )
}
