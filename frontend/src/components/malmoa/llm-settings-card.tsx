'use client'

import { AlertTriangle, CheckCircle2, Eye, EyeOff, KeyRound, Save, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@/components/malmoa/ui/button'
import { Input } from '@/components/malmoa/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/malmoa/ui/select'
import { useCheckLlm, useDeleteLlmSettings, useLlmSettings, useSaveLlmSettings } from '@/hooks/malmoa/queries'
import type { LlmProviderId, LlmSettings } from '@/lib/malmoa/types'
import { Notice, ToneBadge } from './common'
import { Group, Tip } from './px'

const code = 'bg-light px-1.5 py-0.5 font-mono text-sm text-black'

/** 설정: AI 회의록 제공자·API 키·모델 (docs/2026-11-02-AI-API-화면설정.md). 키는 서버에 암호화 저장되고 다시 보여 주지 않는다 */
export function LlmSettingsCard() {
  const settings = useLlmSettings()
  const s = settings.data

  return (
    <Group title="AI 회의록 연결" className="scroll-mt-24">
      <div id="llm" className="flex flex-col gap-4">
        {settings.isError && (
          <Notice tone="error" icon={<AlertTriangle />}>
            설정을 불러오지 못했습니다: {settings.error.message}
          </Notice>
        )}
        {!s ? (
          !settings.isError && <p className="py-4 text-center text-sm text-[#404040]">불러오는 중…</p>
        ) : (
          <>
            <Current s={s} />
            {/* 저장하면 key가 바뀌어 입력칸(특히 API 키)이 비워진다 */}
            <LlmForm key={`${s.source}:${s.provider}:${s.model}:${s.keyHint}:${s.baseUrl}`} s={s} />
          </>
        )}
      </div>
    </Group>
  )
}

function Current({ s }: { s: LlmSettings }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>지금 연결:</span>
        <b className="font-pixel">{s.label}</b>
        {s.keyHint && <span className="font-mono text-[12px] text-[#464653]">키 {s.keyHint}</span>}
        <span className="text-[12px] text-[#464653]">({s.source === 'screen' ? '이 화면에서 저장' : 'backend/.env 값'})</span>
        {/* 키가 맞는지는 '키 확인'으로만 알 수 있다 → 여기서는 "설정됨"까지만 */}
        {s.problem ? <ToneBadge tone="warning">설정 필요</ToneBadge> : <ToneBadge tone="success">설정됨</ToneBadge>}
      </div>
      {s.problem && (
        <Notice tone="warning" icon={<AlertTriangle />}>
          {s.problem}
        </Notice>
      )}
    </div>
  )
}

function LlmForm({ s }: { s: LlmSettings }) {
  const ids = { provider: useId(), key: useId(), url: useId(), model: useId(), models: useId() }
  const [provider, setProvider] = useState<LlmProviderId>(s.provider)
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [baseUrl, setBaseUrl] = useState(s.baseUrl ?? '')
  const [model, setModel] = useState(s.model)
  const check = useCheckLlm()
  const save = useSaveLlmSettings()
  const remove = useDeleteLlmSettings()

  const info = s.providers.find((p) => p.id === provider) ?? s.providers[0]
  const sameProvider = provider === s.provider
  // 저장된 키는 같은 제공자일 때만 다시 쓴다 (서버도 같은 규칙)
  const savedKey = sameProvider && s.hasKey && s.keyHint
  const compatible = provider === 'compatible'
  const body = { provider, apiKey: apiKey.trim() || undefined, baseUrl: compatible ? baseUrl.trim() || undefined : undefined }
  const busy = check.isPending || save.isPending || remove.isPending
  const local = compatible && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(baseUrl.trim())

  const changeProvider = (id: LlmProviderId) => {
    setProvider(id)
    check.reset()
    save.reset()
    const next = s.providers.find((p) => p.id === id)
    setModel(id === s.provider ? s.model : (next?.suggestedModel ?? ''))
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate({ ...body, model: model.trim() })
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center">
        <label htmlFor={ids.provider} className="text-sm font-bold">
          제공자
        </label>
        <Select value={provider} onValueChange={(v) => changeProvider(v as LlmProviderId)} disabled={busy}>
          <SelectTrigger id={ids.provider} className="w-full sm:max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {s.providers.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label htmlFor={ids.key} className="text-sm font-bold">
          API 키
        </label>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 gap-1.5">
            <Input
              id={ids.key}
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={savedKey ? `저장됨 ${s.keyHint} · 바꿀 때만 입력` : info.needsKey ? '발급받은 키를 붙여 넣으세요' : '필요 없으면 비워 두세요'}
              className="font-mono"
              disabled={busy}
            />
            <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={() => setShowKey((v) => !v)} aria-pressed={showKey} disabled={!apiKey}>
              {showKey ? <EyeOff /> : <Eye />} {showKey ? '숨기기' : '보기'}
            </Button>
          </div>
          {info.keyPage && (
            <a href={info.keyPage} target="_blank" rel="noreferrer" className="w-fit text-[12px] text-[#000080] underline underline-offset-2">
              {info.label} 키 발급 페이지 ↗
            </a>
          )}
        </div>

        {compatible && (
          <>
            <label htmlFor={ids.url} className="text-sm font-bold">
              주소
            </label>
            <Input
              id={ids.url}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434/v1 (Ollama)"
              className="font-mono"
              spellCheck={false}
              disabled={busy}
            />
          </>
        )}

        <label htmlFor={ids.model} className="text-sm font-bold">
          모델
        </label>
        <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row">
          {/* 목록을 불러오면 고를 수 있고, 목록이 없는 서버를 위해 직접 입력도 된다 */}
          <Input
            id={ids.model}
            list={ids.models}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="모델 이름 (목록 불러오기 또는 직접 입력)"
            className="font-mono sm:max-w-sm"
            spellCheck={false}
            disabled={busy}
          />
          <datalist id={ids.models}>
            {check.data?.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <Button type="button" variant="outline" className="h-8 shrink-0" disabled={busy || (info.needsKey && !apiKey.trim() && !savedKey)} onClick={() => check.mutate(body)}>
            <KeyRound /> {check.isPending ? '확인 중…' : '키 확인·모델 불러오기'}
          </Button>
        </div>
      </div>

      {check.isSuccess && (
        <Notice tone="success" icon={<CheckCircle2 />}>
          {check.data.message} 모델 칸을 누르면 목록에서 고를 수 있습니다.
        </Notice>
      )}
      {check.isError && (
        <Notice tone="error" icon={<AlertTriangle />}>
          {check.error.message}
        </Notice>
      )}
      {save.isError && (
        <Notice tone="error" icon={<AlertTriangle />}>
          {save.error.message}
        </Notice>
      )}
      {remove.isError && (
        <Notice tone="error" icon={<AlertTriangle />}>
          {remove.error.message}
        </Notice>
      )}

      <Tip>
        회의록을 만들 때 <b>변환된 텍스트</b>가 {local ? '이 Mac의 로컬 AI 서버' : info.label}로 전송됩니다. 음성 파일은 보내지 않습니다.
        {local ? ' 로컬 서버라 텍스트도 이 Mac 밖으로 나가지 않습니다.' : ' 사용량에 따른 비용은 그 제공자 계정에 청구됩니다.'} API 키는 이 Mac의 데이터베이스에 암호화해 저장되고,
        저장한 뒤에는 화면에 다시 표시되지 않습니다.
      </Tip>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {s.source === 'screen' && (
          <Button type="button" variant="outline" disabled={busy} onClick={() => remove.mutate()}>
            <Trash2 /> {remove.isPending ? '지우는 중…' : '저장한 설정 지우기 (.env 사용)'}
          </Button>
        )}
        <Button type="submit" disabled={busy || !model.trim()}>
          <Save /> {save.isPending ? '저장 중…' : '저장'}
        </Button>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-[#464653]">또는 backend/.env 파일로 설정하기</summary>
        <p className="mt-2 leading-relaxed">
          이 화면에서 저장한 값이 없을 때는 <code className={code}>backend/.env</code>의 <code className={code}>OPENAI_API_KEY</code>·<code className={code}>OPENAI_MODEL</code>
          (호환 서버면 <code className={code}>OPENAI_BASE_URL</code>)을 씁니다. .env를 고친 뒤에는 백엔드를 다시 시작해야 합니다.
        </p>
      </details>
    </form>
  )
}
