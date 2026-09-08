import { zValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import type { z } from 'zod'

/**
 * One validation-error shape across the whole API boundary (FR-016): code, field, message.
 * Without it `zValidator` returns a raw `ZodError` — an issues array without a field name
 * in the usual place, and the client cannot show the error on a specific field.
 */
export interface FieldProblem {
  readonly error: 'invalid_request' | 'invalid_params'
  /** Dotted path to the field: `levelsMs.1`, `from`; for a preset parameter — its key. */
  readonly field: string
  readonly message: string
}

export function fieldProblem(issues: readonly z.core.$ZodIssue[]): FieldProblem {
  const issue = issues[0]
  const path = issue?.path.map(String) ?? []
  const message = issue?.message ?? 'invalid request'
  // A preset parameter gives the same error as the engine: the client has one way to show it.
  if (path[0] === 'params' && path.length > 1) {
    return { error: 'invalid_params', field: path.slice(1).join('.'), message }
  }
  return { error: 'invalid_request', field: path.join('.') || 'body', message }
}

/** `zValidator` with our failure shape instead of the raw Zod result. */
export function validated<T extends z.ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) return c.json(fieldProblem(result.error.issues), 400)
  })
}
