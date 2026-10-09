import { useRef, useState, type ReactNode } from 'react'

// 두 구획을 나란히 두고 가운데 경계선을 끌거나 화살표 키로 폭을 조절한다. 한쪽이 null이면 다른 쪽이 전체 폭
export default function SplitPane({
  left,
  right,
  label,
  initial = 50,
  min = 25,
  max = 75,
}: {
  left: ReactNode | null
  right: ReactNode | null
  label: string
  initial?: number
  min?: number
  max?: number
}) {
  const [ratio, setRatio] = useState(initial)
  const wrap = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const clamp = (v: number) => Math.max(min, Math.min(max, v))

  if (!left || !right) return <div className="split-pane">{left ?? right}</div>

  return (
    <div className="split-pane" ref={wrap} style={{ gridTemplateColumns: `${ratio}fr auto ${100 - ratio}fr` }}>
      <div className="split-cell">{left}</div>
      <div
        className="split-handle"
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={ratio}
        aria-valuemin={min}
        aria-valuemax={max}
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!dragging.current || !wrap.current) return
          const r = wrap.current.getBoundingClientRect()
          setRatio(clamp(Math.round(((e.clientX - r.left) / r.width) * 100)))
        }}
        onPointerUp={() => (dragging.current = false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setRatio((v) => clamp(v - 5))
          if (e.key === 'ArrowRight') setRatio((v) => clamp(v + 5))
        }}
      />
      <div className="split-cell">{right}</div>
    </div>
  )
}
