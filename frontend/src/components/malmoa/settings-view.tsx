'use client'

import { AlertTriangle, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/malmoa/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/malmoa/ui/card'
import { useHealth, useLlmSettings } from '@/hooks/malmoa/queries'
import { Menu, OsWindow, StatusCell } from './app-shell'
import { PeopleRoster } from './attendees'
import { CalendarSyncCard } from './calendar-sync-card'
import { Notice, ToneBadge } from './common'
import { LlmSettingsCard } from './llm-settings-card'
import { UsageCard } from './usage-card'
import { Group } from './px'

function Row({ label, value, ok }: { label: string; value: ReactNode; ok: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-dotted border-black py-2 last:border-0">
      <dt>{label}</dt>
      <dd className="flex items-center gap-2 text-sm">
        <span className="font-pixel">{value}</span>
        {ok ? <ToneBadge tone="success">정상</ToneBadge> : <ToneBadge tone="warning">설정 필요</ToneBadge>}
      </dd>
    </div>
  )
}

/** 연결 상태 확인, 참석자 명단, 아이폰 일정 알림, AI 회의록 연결(제공자·키·모델) */
export function SettingsView() {
  const health = useHealth()
  const llm = useLlmSettings()

  return (
    <OsWindow
      icon="⚙️"
      title="시스템 설정 - [말모아 등록정보]"
      width="max-w-4xl"
      menu={
        <>
          <Menu label="도구" hot="T" items={[{ label: '연결 다시 확인', onSelect: () => void Promise.all([health.refetch(), llm.refetch()]) }]} />
          <Menu label="도움말" hot="H" items={[{ label: '사용 안내', href: '/guide' }]} />
        </>
      }
      statusBar={
        <>
          <StatusCell>{health.isFetching ? '확인 중…' : health.isError ? '서버 연결 안 됨' : '준비 완료'}</StatusCell>
          <StatusCell className="ml-auto font-mono text-[10px]">/api</StatusCell>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
          <p className="text-[#464653]">로컬 서버, 데이터베이스, 음성 인식, AI API 연결 상태입니다.</p>
          <Button variant="outline" size="sm" onClick={() => void Promise.all([health.refetch(), llm.refetch()])} disabled={health.isFetching}>
            <RotateCcw /> {health.isFetching ? '확인 중…' : '다시 확인'}
          </Button>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>말모아 등록정보</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5">
            <Group title="연결 상태" paper>
              {health.isError ? (
                <Notice tone="error" icon={<AlertTriangle />}>
                  {health.error.message}
                </Notice>
              ) : !health.data ? (
                <p className="py-4 text-center text-sm text-[#404040]">확인 중…</p>
              ) : (
                <dl className="grid">
                  <Row label="말모아 서버 (FastAPI)" value="/api (이 사이트와 같은 서버)" ok />
                  <Row label="데이터베이스 (PostgreSQL)" value="연결됨" ok />
                  <Row label="음성 인식 (Whisper)" value={`${health.data.whisperModel} 모델 · 이 Mac`} ok={health.data.ffmpeg} />
                  <Row label="AI 회의록" value={llm.data ? (llm.data.problem ? '키 또는 모델 미설정' : llm.data.label) : '확인 중…'} ok={!!llm.data && !llm.data.problem} />
                  <Row label="최대 업로드 크기" value={`${health.data.maxUploadMb}MB`} ok />
                </dl>
              )}
            </Group>

            <Group title="참석자 명단" className="scroll-mt-24">
              <div id="people" className="grid gap-3">
                <p className="text-sm text-[#404040]">자주 참석하는 사람을 등록해 두면 녹음·결과 화면에서 눌러서 참석자로 넣을 수 있습니다.</p>
                <PeopleRoster />
              </div>
            </Group>

            <CalendarSyncCard />

            <LlmSettingsCard />

            <UsageCard />
          </CardContent>
        </Card>
      </div>
    </OsWindow>
  )
}
