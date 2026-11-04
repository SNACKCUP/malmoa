import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Windows 98 작은 부품들 (MeerKit 말모아 서브 프로젝트의 px 키트를 옮겨 옴)

// 8×8 픽셀 아이콘. 색은 글자색(currentColor)을 따른다.
const ICONS = {
  mic: ['..####..', '..####..', '..####..', '#.####.#', '#.####.#', '##....##', '.######.', '...##...'],
  upload: ['...##...', '..####..', '.######.', '...##...', '...##...', '........', '#......#', '########'],
  camera: ['........', '..####..', '########', '#.####.#', '#.#..#.#', '#.####.#', '########', '........'],
  check: ['........', '......##', '.....##.', '#...##..', '##.##...', '.###....', '..#.....', '........'],
  star: ['...##...', '...##...', '########', '.######.', '..####..', '.##..##.', '.#....#.', '........'],
  doc: ['#####...', '#...##..', '#...#.#.', '#...####', '#......#', '#.####.#', '#......#', '########'],
  lock: ['..####..', '.#....#.', '.#....#.', '########', '###..###', '###..###', '########', '########'],
  bolt: ['....##..', '...##...', '..##....', '.######.', '...##...', '..##....', '.##.....', '##......'],
  calendar: ['.#....#.', '########', '########', '#......#', '#.#.#..#', '#......#', '#.#.#..#', '########'],
  gear: ['...##...', '.######.', '.##..##.', '##....##', '##....##', '.##..##.', '.######.', '...##...'],
  help: ['..####..', '.##..##.', '.....##.', '....##..', '...##...', '...##...', '........', '...##...'],
  list: ['##.#####', '........', '##.#####', '........', '##.#####', '........', '##.#####', '........'],
  home: ['...##...', '..####..', '.######.', '########', '.#....#.', '.#.##.#.', '.#.##.#.', '.######.'],
  trash: ['..####..', '########', '.#....#.', '.#.##.#.', '.#.##.#.', '.#.##.#.', '.#.##.#.', '.######.'],
  people: ['.##..##.', '####.###', '####.###', '.##..##.', '........', '####.###', '####.###', '####.###'],
} as const

export type PixelIconName = keyof typeof ICONS

// 문자 격자 → SVG 경로. 같은 줄에서 이어지는 칸은 하나의 사각형으로 합친다.
function gridPath(rows: readonly string[]) {
  let d = ''
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      if (row[x] !== '#') {
        x++
        continue
      }
      let w = 1
      while (x + w < row.length && row[x + w] === '#') w++
      d += `M${x} ${y}h${w}v1h-${w}z`
      x += w
    }
  })
  return d
}

export function PixelIcon({ name, size = 16, label, className }: { name: PixelIconName; size?: number; label?: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 8 8"
      width={size}
      height={size}
      fill="currentColor"
      shapeRendering="crispEdges"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={gridPath(ICONS[name])} />
    </svg>
  )
}

// 진행 막대: 움푹 들어간 흰 칸 안에 남색 블록이 채워진다 (입력 레벨 등)
export function PxBar({ value, max = 100, segments = 20, tone = 'navy', label, className }: { value: number; max?: number; segments?: number; tone?: 'navy' | 'red' | 'teal'; label: string; className?: string }) {
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0
  const filled = Math.floor(ratio * segments + 1e-9)
  const fill = { navy: 'bg-[#000080]', red: 'bg-[#c00000]', teal: 'bg-[#008080]' }[tone]
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(Math.max(value, 0), max)} className={cn('flex h-5 gap-[2px] bg-white p-[3px] w98-in', className)}>
      {Array.from({ length: segments }, (_, i) => (
        <span key={i} className={cn('h-full flex-1', i < filled ? fill : 'bg-transparent')} />
      ))}
    </div>
  )
}

// 창 안의 구획: 제목이 붙은 새긴 테두리 상자. paper면 흰 안쪽 영역
export function Group({ title, paper, action, className, children }: { title: ReactNode; paper?: boolean; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <fieldset className={cn('grid min-w-0 gap-3 px-3.5 pt-2 pb-3.5 w98-group', className)}>
      <legend className="px-1.5 font-pixel text-[15px]">{title}</legend>
      {action ? <div className="flex flex-wrap justify-end gap-2">{action}</div> : null}
      <div className={cn('min-w-0', paper && 'bg-white p-3 text-black w98-in')}>{children}</div>
    </fieldset>
  )
}

// 흰 안쪽 영역 (탐색기·문서 보기)
export function Paper({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('bg-white p-3 text-black w98-in', className)} {...props} />
}

// 노란 안내 쪽지 (98 풍선 도움말 색)
export function Tip({ tone = 'info', className, ...props }: ComponentProps<'p'> & { tone?: 'info' | 'error' }) {
  return <p className={cn('bg-[#ffffe1] p-3 text-sm w98-flat', tone === 'error' ? 'text-[#b00000]' : 'text-black', className)} {...props} />
}

// 바탕화면 위에 바로 놓이는 화면 제목 (흰 글자 + 검은 그림자)
export function DeskTitle({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div>
      <h1 className="font-pixel text-3xl w98-desk-text">{title}</h1>
      {description ? <p className="mt-1 text-sm w98-desk-text">{description}</p> : null}
    </div>
  )
}
