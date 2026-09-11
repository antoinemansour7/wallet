// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'

const apiDirectory = new URL('../../api/', import.meta.url)
const vercelConfig = new URL('../../vercel.json', import.meta.url)
const vercelIgnore = new URL('../../.vercelignore', import.meta.url)

describe('Vercel Hobby deployment shape', () => {
  it('stays at the 12-function limit and excludes API tests', () => {
    const ignore = readFileSync(vercelIgnore, 'utf8')
    expect(ignore).toContain('*.test.js')

    const functions = readdirSync(apiDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js'))
      .map((entry) => entry.name)
      .sort()

    expect(functions).toHaveLength(12)
    expect(functions).toContain('research-evaluation.js')
    expect(functions).not.toContain('get-research-history.js')
  })

  it('preserves the former research-history URL without another function', () => {
    const config = JSON.parse(readFileSync(vercelConfig, 'utf8'))
    expect(config.rewrites).toContainEqual({
      source: '/api/get-research-history',
      destination: '/api/get-research?history=1',
    })
  })
})
