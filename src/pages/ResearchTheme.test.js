// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The research workspace borrows the landing page's tokens. That is right for
// light mode, which is where the forest/cream/sage identity lives, and wrong for
// dark: index.css settles that brand green is a light-mode identity and the
// brand roles resolve to neutral on dark, leaving colour to gain/loss.
//
// The page shipped painting --wa-forest #203c2d over the app's #0a0a0c ground,
// so it read as a green slab under a black navbar. jsdom does not apply this
// stylesheet and dark mode sits behind a manual toggle, so the guard reads the
// CSS as text instead. It is coarse on purpose: it cannot see contrast, only
// that dark stopped reaching for the green family.

const css = readFileSync(join('src', 'pages', 'Research.css'), 'utf8')

/** The landing tokens that carry colour. Spacing and type tokens are fine anywhere. */
const COLOUR_TOKENS = [
  'forest', 'panel', 'ink', 'cream', 'sage', 'soft', 'mist', 'muted',
  'line', 'dark-line', 'glow', 'border', 'focus',
]
const colourTokenRe = new RegExp(`var\\(--wa-(?:${COLOUR_TOKENS.join('|')})\\)`, 'g')

/** Extract one brace-balanced rule body by its selector. */
function ruleBody(selector) {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`selector not found: ${selector}`)
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    else if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  throw new Error(`unbalanced rule: ${selector}`)
}

const LIGHT = '.wallai-system.research-workspace'
const DARK = '.dark .research-workspace'

const declaredRoles = (body) => new Set(
  [...body.matchAll(/(--rw-[a-z-]+)\s*:/g)].map((m) => m[1]),
)

describe('research workspace theming', () => {
  it('resolves every dark role from the app tokens, never the landing greens', () => {
    const dark = ruleBody(DARK)
    expect(dark.match(colourTokenRe)).toBeNull()
    // Positively: it reaches for the product's own palette.
    expect(dark).toMatch(/var\(--color-wall-bg\)/)
    expect(dark).toMatch(/var\(--color-accent\)/)
  })

  it('keeps the landing identity in light mode', () => {
    const light = ruleBody(LIGHT)
    expect(light).toMatch(/var\(--wa-cream\)/)
    expect(light).toMatch(/var\(--wa-forest\)/)
  })

  // A role defined only in light silently keeps its green value on dark, which
  // is exactly how a single forest value survives an otherwise neutral theme.
  it('overrides every light role in dark', () => {
    const missing = [...declaredRoles(ruleBody(LIGHT))]
      .filter((role) => !declaredRoles(ruleBody(DARK)).has(role))
    expect(missing).toEqual([])
  })

  // Rules must go through the --rw-* roles. A rule naming a landing colour
  // directly cannot change with the theme, which is how the briefing masthead
  // stayed forest green on both.
  it('routes every rule through the theme roles', () => {
    const rules = css.replace(ruleBody(LIGHT), '').replace(ruleBody(DARK), '')
    const offenders = [...new Set(rules.match(colourTokenRe) ?? [])]
    expect(offenders).toEqual([])
  })
})
