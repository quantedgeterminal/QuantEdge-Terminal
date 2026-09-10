import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { App, PROVENANCE } from '../src/App.tsx'

// Every reachable screen, by route.
const routes = [
  '/',
  '/runs/00000000-0000-4000-8000-000000000001',
  '/markets/1',
  '/markets/1/compare',
]

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

  it('no screen shows made-up numbers any more', () => {
    for (const route of routes) expect(render(route)).not.toMatch(/fictional/i)
  })
})
