import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { App } from '../src/App'
import { banner } from '../src/lib/mockSource'

// Every reachable screen of the prototype, by route.
const routes = ['/', '/runs/run-7f3a', '/markets/sol-usdc']

function render(route: string): string {
  return renderToString(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  )
}

describe('prototype banner', () => {
  it.each(routes)('is rendered on %s', (route) => {
    expect(render(route)).toContain(banner)
  })

  it('says the figures are fictional and nothing was measured', () => {
    expect(banner).toMatch(/fictional/)
    expect(banner).toMatch(/nothing has been measured/)
  })

  it('has no control that could dismiss it', () => {
    const html = render('/')
    const bannerStart = html.indexOf(banner)
    const before = html.slice(Math.max(0, bannerStart - 400), bannerStart)
    expect(before).not.toMatch(/<button/)
    expect(before).not.toMatch(/aria-label="(close|dismiss)/i)
  })
})
