'use client'

import { AlertTriangle, Pencil, Plus, Trash2, Users, X } from 'lucide-react'
import Link from 'next/link'
import { useId, useState } from 'react'
import { Button } from '@/components/malmoa/ui/button'
import { Input } from '@/components/malmoa/ui/input'
import { Label } from '@/components/malmoa/ui/label'
import { useAddPerson, useDeletePerson, usePeople, useSaveAttendees, useUpdatePerson } from '@/hooks/malmoa/queries'
import { ApiError } from '@/lib/malmoa/api'
import type { Attendee, Job } from '@/lib/malmoa/types'
import { cn } from '@/lib/utils'
import { Notice } from './common'

const MAX_LEN = 50

const clean = (s: string) => s.split(/\s+/).filter(Boolean).join(' ').slice(0, MAX_LEN)

/** 직책 입력칸. Enter·칸 밖 누르기 = 저장, Esc = 취소 */
function RoleInput({ name, role, onDone }: { name: string; role: string | null | undefined; onDone: (role: string | null | undefined) => void }) {
  const [text, setText] = useState(role ?? '')
  return (
    <Input
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => onDone(clean(text) || null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onDone(undefined)
        }
      }}
      maxLength={MAX_LEN}
      placeholder="직책·소속"
      aria-label={`${name} 직책`}
      className="h-7 w-28 px-2 text-[13px]"
    />
  )
}

/** 이름을 누르면 직책을 적을 수 있는 버튼 */
function NameButton({ a, onEdit }: { a: Attendee; onEdit: () => void }) {
  return (
    <button type="button" onClick={onEdit} className="flex items-center gap-1 hover:text-primary" title="눌러서 직책 적기" aria-label={`${a.name} 직책 적기`}>
      <span className="font-medium underline underline-offset-2">{a.name}</span>
      {a.role ? <span className="text-[#464653]">({a.role})</span> : <span className="text-[#808080]">+직책</span>}
    </button>
  )
}

/**
 * 참석자 이름표. onRemove가 있으면 ✕ 버튼으로 뺄 수 있고,
 * onRoleChange가 있으면 이름을 눌러 직책을 적을 수 있다. (undefined = 취소)
 */
export function AttendeeChips({
  attendees,
  onRemove,
  onRoleChange,
  small = false,
}: {
  attendees: Attendee[]
  onRemove?: (a: Attendee) => void
  onRoleChange?: (a: Attendee, role: string | null) => void
  small?: boolean
}) {
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <ul className="flex flex-wrap gap-1" aria-label="참석자">
      {attendees.map((a) => (
        <li key={a.name} className={cn('flex items-center gap-1 bg-[#eeeeee] pr-0.5 pl-1.5 w98-flat', small ? 'h-5 text-[11px]' : 'h-7 text-[13px]')}>
          {editing === a.name && onRoleChange ? (
            <>
              <span className="font-medium">{a.name}</span>
              <RoleInput
                name={a.name}
                role={a.role}
                onDone={(role) => {
                  setEditing(null)
                  if (role !== undefined && role !== (a.role ?? null)) onRoleChange(a, role)
                }}
              />
            </>
          ) : onRoleChange ? (
            <NameButton a={a} onEdit={() => setEditing(a.name)} />
          ) : (
            <>
              <span className="font-medium">{a.name}</span>
              {a.role && <span className="text-[#464653]">({a.role})</span>}
            </>
          )}
          {onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(a)}
              className="ml-0.5 flex size-4 items-center justify-center text-[#ba1a1a] hover:bg-white"
              aria-label={`${a.name} 빼기`}
            >
              <X className="size-3" />
            </button>
          ) : (
            <span className="w-2" />
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * 참석자 고르기: 명단에서 누르거나, 새 이름을 적어 추가한다.
 * 새로 적은 사람은 다음 회의에서 고를 수 있도록 명단에도 저장한다.
 */
export function AttendeePicker({ value, onChange, compact = false }: { value: Attendee[]; onChange: (next: Attendee[]) => void; compact?: boolean }) {
  const nameId = useId()
  const roleId = useId()
  const people = usePeople()
  const addPerson = useAddPerson()
  const updatePerson = useUpdatePerson()
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [error, setError] = useState<string | null>(null)
  // compact: 이름표 칸 + ‘+추가’를 눌러야 추가 칸이 열린다 (녹음기 창)
  const [adding, setAdding] = useState(false)

  // 이 회의의 직책을 바꾸고, 명단에 있는 사람이면 다음 회의를 위해 명단에도 저장한다
  const changeRole = (a: Attendee, r: string | null) => {
    onChange(value.map((x) => (x.name === a.name ? { ...x, role: r } : x)))
    const known = people.data?.find((p) => p.name === a.name)
    if (known && known.role !== r) {
      updatePerson.mutate(
        { id: known.id, name: known.name, role: r },
        {
          onError: (e) => setError(`명단에 저장하지 못했습니다: ${e.message}`),
        },
      )
    }
  }

  const chosen = new Set(value.map((a) => a.name))
  const suggestions = (people.data ?? []).filter((p) => !chosen.has(p.name))

  const add = (a: Attendee) => {
    if (!chosen.has(a.name)) onChange([...value, a])
  }

  const submit = () => {
    const n = clean(name)
    if (!n) return
    const r = clean(role) || null
    const known = people.data?.find((p) => p.name === n)
    add({ name: n, role: r ?? known?.role ?? null })
    setName('')
    setRole('')
    setError(null)
    if (!known) {
      // 명단 저장 실패는 이 회의의 참석자 추가를 막지 않는다
      addPerson.mutate(
        { name: n, role: r },
        {
          onError: (e) => e instanceof ApiError && e.status !== 409 && setError(`명단에 저장하지 못했습니다: ${e.message}`),
        },
      )
    }
  }

  const chips = <AttendeeChips attendees={value} small={compact} onRemove={(a) => onChange(value.filter((x) => x.name !== a.name))} onRoleChange={changeRole} />

  return (
    <div className="flex flex-col gap-2">
      {compact ? (
        <div className="flex min-h-8 flex-wrap items-center gap-1 bg-white p-1 w98-in">
          {value.length > 0 ? chips : <span className="px-1 text-[11px] text-[#808080]">참석자 없음</span>}
          <button
            type="button"
            aria-expanded={adding}
            onClick={() => setAdding((v) => !v)}
            className="px-1 text-[11px] font-bold underline underline-offset-2 hover:bg-[#000080] hover:text-white"
          >
            {adding ? '닫기' : '+추가'}
          </button>
        </div>
      ) : value.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {chips}
          <p className="text-[12px] text-[#464653]">이름을 누르면 직책을 적을 수 있습니다.</p>
        </div>
      ) : (
        <p className="text-[13px] text-[#464653]">아직 참석자가 없습니다.</p>
      )}

      {(!compact || adding) && (
        <div className="flex flex-col gap-2">
          {suggestions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[12.5px] text-[#464653]">명단에서 고르기</p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((p) => (
                  <Button key={p.id} type="button" variant="outline" size="sm" className="h-8 px-3 text-[13px]" onClick={() => add({ name: p.name, role: p.role })}>
                    <Plus className="size-3.5" />
                    {p.name}
                    {p.role && <span className="text-[#464653]">{p.role}</span>}
                  </Button>
                ))}
                {suggestions.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-3 text-[13px]"
                    onClick={() => onChange([...value, ...suggestions.map((p) => ({ name: p.name, role: p.role }))])}
                  >
                    모두 추가
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* 일정 창처럼 다른 form 안에서도 쓰이므로 form 대신 Enter를 직접 받는다 (중첩 form 금지) */}
          <div
            role="group"
            aria-label="참석자 추가"
            className="flex flex-wrap items-end gap-2"
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing || !(e.target instanceof HTMLInputElement)) return
              e.preventDefault()
              submit()
            }}
          >
            <div className="flex min-w-32 flex-1 flex-col gap-1">
              <Label htmlFor={nameId} className="text-[12.5px] font-normal text-[#464653]">
                이름
              </Label>
              <Input
                id={nameId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={MAX_LEN}
                placeholder="홍길동"
                className={compact ? 'h-7 text-[12px]' : 'h-9'}
                autoComplete="off"
              />
            </div>
            <div className="flex min-w-32 flex-1 flex-col gap-1">
              <Label htmlFor={roleId} className="text-[12.5px] font-normal text-[#464653]">
                소속·직책 (선택)
              </Label>
              <Input
                id={roleId}
                value={role}
                onChange={(e) => setRole(e.target.value)}
                maxLength={MAX_LEN}
                placeholder="기획팀"
                className={compact ? 'h-7 text-[12px]' : 'h-9'}
                autoComplete="off"
              />
            </div>
            <Button type="button" variant="outline" size={compact ? 'sm' : 'default'} disabled={!clean(name)} onClick={submit}>
              <Plus /> 추가
            </Button>
          </div>
        </div>
      )}

      {error && (
        <Notice tone="warning" icon={<AlertTriangle />}>
          {error}
        </Notice>
      )}
    </div>
  )
}

/** 결과 화면: 회의 참석자 보기·고치기 */
export function JobAttendees({ job }: { job: Job }) {
  const save = useSaveAttendees(job.id)
  const [draft, setDraft] = useState<Attendee[] | null>(null)
  const editing = draft != null

  if (!editing) {
    return (
      <section aria-labelledby="attendees-title" className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="attendees-title" className="flex items-center gap-1.5 text-sm font-medium text-[#464653]">
          <Users className="size-4" aria-hidden />
          참석자 {job.attendees.length > 0 && `${job.attendees.length}명`}
        </h2>
        {job.attendees.length > 0 ? <AttendeeChips small attendees={job.attendees} /> : <span className="text-sm text-[#464653]">등록되지 않음</span>}
        <Button
          variant="outline"
          size="xs"
          className="h-5 text-[11px]"
          onClick={() => {
            save.reset()
            setDraft(job.attendees)
          }}
        >
          <Pencil /> {job.attendees.length > 0 ? '참석자 편집' : '참석자 등록'}
        </Button>
      </section>
    )
  }

  return (
    <section aria-labelledby="attendees-edit-title" className="flex flex-col gap-4 p-4 w98-group">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="attendees-edit-title" className="flex items-center gap-1.5 text-[15px] font-semibold">
          <Users className="size-4.5" aria-hidden /> 회의 참석자
        </h2>
        <Link href="/settings#people" className="text-[13px] text-primary underline-offset-2 hover:underline">
          명단 관리
        </Link>
      </div>
      <AttendeePicker value={draft} onChange={setDraft} />
      {job.minutesReady && (
        <p className="text-[12.5px] leading-relaxed text-[#464653]">
          이미 만든 회의록 본문은 바뀌지 않습니다. 회의록의 참석자 줄은 회의록 화면에서 직접 고치거나, 회의록을 다시 만들면 반영됩니다.
        </p>
      )}
      {save.error && (
        <Notice tone="error" icon={<AlertTriangle />}>
          {save.error.message}
        </Notice>
      )}
      <div className="flex gap-2">
        <Button className="h-10" disabled={save.isPending} onClick={() => save.mutate(draft, { onSuccess: () => setDraft(null) })}>
          {save.isPending ? '저장 중…' : '저장'}
        </Button>
        <Button variant="outline" className="h-10" disabled={save.isPending} onClick={() => setDraft(null)}>
          취소
        </Button>
      </div>
    </section>
  )
}

/** 설정 화면: 참석자 명단 관리. 지워도 지난 회의의 참석자 기록은 그대로 남는다. */
export function PeopleRoster() {
  const nameId = useId()
  const roleId = useId()
  const people = usePeople()
  const addPerson = useAddPerson()
  const deletePerson = useDeletePerson()
  const updatePerson = useUpdatePerson()
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const error = people.error ?? addPerson.error ?? deletePerson.error ?? updatePerson.error

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const n = clean(name)
          if (!n) return
          addPerson.mutate(
            { name: n, role: clean(role) || null },
            {
              onSuccess: () => {
                setName('')
                setRole('')
              },
            },
          )
        }}
      >
        <div className="flex min-w-36 flex-1 flex-col gap-1">
          <Label htmlFor={nameId} className="text-[13px]">
            이름
          </Label>
          <Input id={nameId} value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_LEN} placeholder="홍길동" className="h-11" autoComplete="off" />
        </div>
        <div className="flex min-w-36 flex-1 flex-col gap-1">
          <Label htmlFor={roleId} className="text-[13px]">
            소속·직책 (선택)
          </Label>
          <Input id={roleId} value={role} onChange={(e) => setRole(e.target.value)} maxLength={MAX_LEN} placeholder="기획팀" className="h-11" autoComplete="off" />
        </div>
        <Button type="submit" className="h-11" disabled={!clean(name) || addPerson.isPending}>
          <Plus /> 명단에 추가
        </Button>
      </form>

      {error && (
        <Notice tone="error" icon={<AlertTriangle />}>
          {error.message}
        </Notice>
      )}

      {people.data && people.data.length === 0 && <p className="text-sm text-[#464653]">아직 등록한 사람이 없습니다. 녹음 화면에서 참석자를 추가해도 여기에 저장됩니다.</p>}
      {people.data && people.data.length > 0 && (
        <ul className="flex flex-col divide-y divide-[#c0c0c0] bg-white text-black w98-in">
          {people.data.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex min-w-0 flex-1 items-center gap-2 text-[15px]">
                {editing === p.id ? (
                  <>
                    <span className="font-medium">{p.name}</span>
                    <RoleInput
                      name={p.name}
                      role={p.role}
                      onDone={(role) => {
                        setEditing(null)
                        if (role !== undefined && role !== p.role) updatePerson.mutate({ id: p.id, name: p.name, role })
                      }}
                    />
                  </>
                ) : (
                  <NameButton a={p} onEdit={() => setEditing(p.id)} />
                )}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-9"
                disabled={deletePerson.isPending}
                onClick={() => deletePerson.mutate(p.id)}
                aria-label={`${p.name} 명단에서 지우기`}
              >
                <Trash2 /> 지우기
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[12.5px] leading-relaxed text-[#464653]">
        이름을 누르면 직책을 적거나 고칠 수 있습니다. 명단을 고치거나 지워도 이미 저장한 회의의 참석자 기록은 바뀌지 않습니다.
      </p>
    </div>
  )
}
