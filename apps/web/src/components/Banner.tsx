import { banner } from '../lib/mockSource'

export default function Banner() {
  return (
    <div className="border-b border-[hsl(var(--qe-rule))] bg-[hsl(var(--qe-panel))]">
      <p className="mx-auto max-w-[1280px] px-4 py-[7px] text-[11px] leading-[1.4] text-[hsl(var(--qe-dim))] sm:px-6">
        {banner}
      </p>
    </div>
  )
}
