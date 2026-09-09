import type { ParamSpec } from '../api/schemas.ts'
import { type QuoteInfo, rangeLabel, unitLabel } from '../params.ts'

/**
 * Parameter fields of the chosen preset (FR-015, FR-016). Values live as text —
 * what the person typed; `parseParams` turns it into a number at run
 * or save time, and the error lands under the specific field.
 */
export function ParamEditor({
  specs,
  market,
  texts,
  errors,
  onChange,
}: {
  specs: readonly ParamSpec[]
  market: QuoteInfo | undefined
  texts: Readonly<Record<string, string>>
  errors: Readonly<Record<string, string>>
  onChange: (key: string, text: string) => void
}) {
  return (
    <div className="mt-2 grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {specs.map((spec) => {
        const id = `param-${spec.key}`
        const error = errors[spec.key]
        return (
          <div key={spec.key}>
            <label htmlFor={id} className="block text-[11px] text-[hsl(var(--qe-dim))]">
              {spec.label}
            </label>
            <div className="mt-1 flex items-baseline gap-2">
              <input
                id={id}
                inputMode="decimal"
                value={texts[spec.key] ?? ''}
                onChange={(e) => onChange(spec.key, e.target.value)}
                aria-invalid={error !== undefined}
                aria-describedby={error ? `${id}-error` : undefined}
                className="qe-mono w-full min-w-0 border bg-[hsl(var(--qe-panel))] px-2 py-[5px] text-[13px] text-[hsl(var(--qe-text))] outline-none focus:border-[hsl(var(--qe-accent))]"
                style={{
                  borderColor: error ? 'hsl(var(--qe-loss))' : 'hsl(var(--qe-rule))',
                }}
              />
              <span className="qe-mono shrink-0 text-[11px] text-[hsl(var(--qe-dim))]">
                {unitLabel(spec, market)}
              </span>
            </div>
            <p
              id={error ? `${id}-error` : undefined}
              className={`qe-mono mt-1 text-[11px] ${
                error ? 'text-[hsl(var(--qe-loss))]' : 'text-[hsl(var(--qe-faint))]'
              }`}
            >
              {error ?? rangeLabel(spec, market)}
            </p>
          </div>
        )
      })}
    </div>
  )
}
