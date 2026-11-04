'use client'

import { useRef, useState, type PointerEvent } from 'react'

/** 화면 안에 꼭 남겨 둘 창의 크기 (제목 막대를 다시 잡을 수 있게) */
const KEEP_X = 120
const KEEP_Y = 32

/**
 * 98 대화상자를 제목 막대로 끌어 옮긴다 (로그인·내 정보, 2026-11-04). 마우스·터치 모두.
 * 옮길 창에 data-drag-root 와 style 을, 제목 막대에 handle 을 붙인다. 제목 막대 안의 단추(✕ 등)를 누를 때는 끌지 않는다.
 * 창이 담긴 영역(data-drag-root 의 부모 — 내 정보는 아이콘 줄·위 막대·작업 표시줄을 뺀 바탕화면) 밖으로 다 나가지 않게
 * 제목 막대 일부는 늘 그 안에 남긴다.
 */
export function useDragMove() {
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ px: number; py: number; x: number; y: number; rect: DOMRect; area: DOMRect } | null>(null)

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, a, input')) return
    const root = e.currentTarget.closest('[data-drag-root]')
    const area = root?.parentElement?.getBoundingClientRect()
    if (!root || !area) return
    start.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y, rect: root.getBoundingClientRect(), area }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const s = start.current
    if (!s) return
    const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)
    const { rect, area } = s
    const dx = clamp(e.clientX - s.px, area.left + KEEP_X - rect.right, area.right - KEEP_X - rect.left)
    const dy = clamp(e.clientY - s.py, area.top - rect.top, area.bottom - KEEP_Y - rect.top)
    setPos({ x: s.x + dx, y: s.y + dy })
  }
  const end = () => {
    start.current = null
    setDragging(false)
  }

  return {
    dragging,
    style: { transform: `translate(${pos.x}px, ${pos.y}px)` },
    handle: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, title: '끌어서 옮기기' },
  }
}
