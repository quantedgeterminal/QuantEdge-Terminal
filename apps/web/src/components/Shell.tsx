import type { ReactNode } from 'react'

/** Screen wrapper. The data-provenance line is rendered by App above the router, not here. */
export function Shell({ children }: { children: ReactNode }) {
  return <>{children}</>
}
