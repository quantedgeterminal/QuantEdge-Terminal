/**
 * Non-removable line above every screen: data provenance or the prototype mark.
 * No close button by design (in the spirit of SC-007: the mark cannot be removed).
 */
export default function Banner({ text }: { text: string }) {
  return (
    <div className="border-b border-[hsl(var(--qe-rule))] bg-[hsl(var(--qe-panel))]">
      <p className="mx-auto max-w-[1280px] px-4 py-[7px] text-[11px] leading-[1.4] text-[hsl(var(--qe-dim))] sm:px-6">
        {text}
      </p>
    </div>
  )
}
