import { describe, expect, it } from 'vitest'
import { EMPTY_LIST_NOTE, KEY_NOTE } from '../src/pages/RunScreen.tsx'

/** FR-022a: where we offer to save and where the list is empty, the cause of loss is named. */
describe('anonymous key explanation (FR-022a, T046)', () => {
  it('says the browser holds the key and the loss is irreversible', () => {
    expect(KEY_NOTE).toMatch(/anonymous key kept by this browser/)
    expect(KEY_NOTE).toMatch(/no account, no personal data/)
    expect(KEY_NOTE).toMatch(/Clearing site data or switching browsers/)
    expect(KEY_NOTE).toMatch(/nothing can be recovered/)
  })

  it('an empty list is not a blank space but the same explanation', () => {
    expect(EMPTY_LIST_NOTE).toMatch(/^No saved strategies in this browser\./)
    expect(EMPTY_LIST_NOTE).toContain(KEY_NOTE)
  })
})
