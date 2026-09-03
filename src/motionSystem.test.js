import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
const tailwind = readFileSync(resolve(process.cwd(), 'tailwind.config.js'), 'utf8')

describe('motion system', () => {
  it('defines one easing curve and a short/long duration pair', () => {
    expect(css.match(/--motion-ease:/g)).toHaveLength(1)
    expect(css.match(/--motion-duration-(?:short|long):/g)).toHaveLength(2)
    expect(tailwind).toContain("motion: 'var(--motion-ease)'")
    expect(tailwind).toContain("'motion-short': 'var(--motion-duration-short)'")
    expect(tailwind).toContain("'motion-long': 'var(--motion-duration-long)'")
  })

  it('keeps reduced motion immediate, finite, and without smooth scrolling', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('animation-iteration-count: 1 !important')
    expect(css).toContain('scroll-behavior: auto !important')
    expect(css).toContain('transition-duration: 0.01ms !important')
  })

  it('does not retain decorative or data-entrance animation primitives', () => {
    for (const retired of ['.reveal', '.draw-line', '.fade-in-late', '.blob-drift', '.flash-up', '.flash-down', '.live-dot']) {
      expect(css).not.toContain(retired)
    }
  })
})
