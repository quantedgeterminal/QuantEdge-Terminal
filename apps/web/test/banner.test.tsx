import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { App, PROVENANCE } from '../src/App.tsx'
import { banner as prototypeBanner } from '../src/lib/mockSource.ts'

// Every reachable screen, by route.
const routes = ['/', '/runs/00000000-0000-4000-8000-000000000001', '/markets/sol-usdc']

function render(route: string): string {
  return renderToString(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  )
}

describe('data provenance line', () => {
  it.each(routes)('is on %s', (route) => {
    expect(render(route)).toContain(PROVENANCE)
  })

  it('says where the data comes from and that nothing goes to the market', () => {
    expect(PROVENANCE).toMatch(/recorded by us/)
    expect(PROVENANCE).toMatch(/nothing is sent to any market/)
  })

  it('has no control that could remove it', () => {
    const html = render('/')
    const start = html.indexOf(PROVENANCE)
    const before = html.slice(Math.max(0, start - 400), start)
    expect(before).not.toMatch(/<button/)
  })
})

describe('prototype mark on the terminal (numbers are made up until M2)', () => {
  it('is on /markets/sol-usdc and only there', () => {
    expect(render('/markets/sol-usdc')).toContain(prototypeBanner)
    expect(render('/')).not.toContain(prototypeBanner)
    expect(prototypeBanner).toMatch(/fictional/)
  })
})
