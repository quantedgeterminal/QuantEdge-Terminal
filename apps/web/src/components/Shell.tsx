import type { ReactNode } from 'react'
import { demoHeading } from '../lib/mockSource'

/** Screen wrapper. The prototype banner is rendered by App above the router, not here. */
export function Shell({ children }: { children: ReactNode }) {
  return <>{children}</>
}

export function DemoStrip({ children }: { children: ReactNode }) {
  return (
    <div className="mt-14 border-t border-[hsl(var(--qe-rule))] pt-3">
      <p className="qe-smallcaps mb-3 text-[10px] text-[hsl(var(--qe-faint))]">{demoHeading}</p>
      {children}
    </div>
  )
}

export function Toggle({
  label,
  on,
  onChange,
}: {
  label: string
  on: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className="flex items-center gap-3 text-left text-[12px] text-[hsl(var(--qe-dim))] hover:text-[hsl(var(--qe-text))]"
    >
      <span
        className="flex h-[14px] w-[26px] items-center border px-[2px]"
        style={{
          borderColor: on ? 'hsl(var(--qe-accent))' : 'hsl(var(--qe-rule))',
        }}
      >
        <span
          className="h-[8px] w-[8px] transition-transform duration-150"
          style={{
            background: on ? 'hsl(var(--qe-accent))' : 'hsl(var(--qe-faint))',
            transform: on ? 'translateX(10px)' : 'translateX(0)',
          }}
        />
      </span>
      <span className="qe-mono">{label}</span>
    </button>
  )
}
