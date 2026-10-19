import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { figures } from '../src/figures.ts'
import type { StudyResult } from '../src/study.ts'

/**
 * The research page on Pages quotes the published run. Every number on it carries
 * `data-fig="<name>"`; this test reads the page and the committed results and fails on any figure
 * that differs, or that names nothing the run produces.
 */
const page = readFileSync(new URL('../../landing/research/index.html', import.meta.url), 'utf8')
const raw = readFileSync(new URL('../results/dataset-v1.json', import.meta.url), 'utf8')
const result: StudyResult = JSON.parse(raw)
const figs = figures(result)

const entities: Record<string, string> = {
  minus: '\u2212',
  thinsp: '\u2009',
  mdash: '\u2014',
  nbsp: '\u00a0',
  amp: '&',
  lt: '<',
}

function text(html: string): string {
  return html.replace(/&([a-z]+);/g, (m, name: string) => entities[name] ?? m)
}

const onPage = [...page.matchAll(/data-fig="([^"]+)">([^<]*)</g)].map((m) => ({
  key: m[1] ?? '',
  shown: text(m[2] ?? ''),
}))

describe('research page', () => {
  it('marks its figures', () => {
    expect(onPage.length).toBeGreaterThan(100)
  })

  it.each(onPage)('$key reads $shown from the run', ({ key, shown }) => {
    expect(figs[key], `no figure named ${key}`).toBeDefined()
    expect(shown).toBe(figs[key])
  })

  it('leaves no unmarked figure in a results table', () => {
    for (const m of page.matchAll(/<td class="num"(?! data-fig)[^>]*>/g)) {
      throw new Error(`unmarked number cell: ${m[0]}`)
    }
  })
})

describe('published results', () => {
  it('has no unfilled order at zero delay, by construction of the execution model', () => {
    const all = [...result.baseline, ...result.sweep, ...result.control]
    expect(all.every((m) => m.unfilledAt0 === 0)).toBe(true)
  })

  it('is byte for byte what the study writes, so a rerun can be compared by checksum', () => {
    expect(raw).toBe(`${JSON.stringify(result, null, 2)}\n`)
  })

  it('covers every market, preset, size and limit of the sweep', () => {
    expect(result.sweep).toHaveLength(3 * 3 * 5 * 3)
    expect(result.baseline).toHaveLength(3 * 3 * 2)
    expect(result.control).toHaveLength(3 * 3 * 2)
  })
})
