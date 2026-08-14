import { describe, expect, it } from 'vitest'
import { PathKind } from '../src/index.ts'

describe('PathKind', () => {
  it('accepts only the two values from the spec', () => {
    expect(PathKind.parse('real')).toBe('real')
    expect(PathKind.parse('emulated')).toBe('emulated')
    expect(PathKind.safeParse('simulated').success).toBe(false)
    expect(PathKind.safeParse('').success).toBe(false)
  })
})
