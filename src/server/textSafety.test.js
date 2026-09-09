import { describe, expect, it } from 'vitest'
import { safeTruncate } from './textSafety.js'

// Emoji and other astral-plane characters are stored as a surrogate PAIR in a
// JS string — two UTF-16 code units. `.slice(0, N)` counts code units, so it
// can land between the two halves of one character, leaving the string ending
// in a lone high surrogate. That is exactly what crashed a production run on
// 2026-09-09: sanitizeSignalText's `.slice(0, 300)` bisected an emoji in a
// tweet, and Anthropic's API rejected the resulting request body with
// "no low surrogate in string".
const EMOJI = '\u{1F680}' // 🚀, a surrogate pair: 🚀
const isLoneHighSurrogate = (str) => {
  const last = str.charCodeAt(str.length - 1)
  return last >= 0xd800 && last <= 0xdbff
}

describe('safeTruncate', () => {
  it('never leaves a lone surrogate, even when the naive cut point lands inside one', () => {
    // 'hi' (2) + 🚀🚀🚀 (6 code units) = 8. Cutting at 3 lands exactly between
    // the two halves of the first 🚀 — the bug's exact mechanism.
    const text = `hi${EMOJI}${EMOJI}${EMOJI}`
    expect(isLoneHighSurrogate(text.slice(0, 3))).toBe(true) // the bug, reproduced

    const safe = safeTruncate(text, 3)
    expect(isLoneHighSurrogate(safe)).toBe(false)
    expect(() => JSON.parse(JSON.stringify({ t: safe }))).not.toThrow()
  })

  it('counts whole characters, not UTF-16 units, so an emoji is kept or dropped intact', () => {
    const text = `hi${EMOJI}${EMOJI}${EMOJI}`
    // 3 whole characters: 'h', 'i', 🚀 — never a split half of the fourth.
    expect(safeTruncate(text, 3)).toBe(`hi${EMOJI}`)
    expect(safeTruncate(text, 2)).toBe('hi')
  })

  it('keeps a whole trailing character when the budget lands exactly on a boundary', () => {
    const text = `hi${EMOJI}`
    expect(safeTruncate(text, 4)).toBe(`hi${EMOJI}`)
  })

  it('is a no-op for plain ASCII within budget', () => {
    expect(safeTruncate('hello world', 300)).toBe('hello world')
  })

  it('truncates plain ASCII over budget exactly as .slice would', () => {
    expect(safeTruncate('hello world', 5)).toBe('hello')
  })

  it('handles null, undefined and non-string input like the sites that call it expect', () => {
    expect(safeTruncate(null, 10)).toBe('')
    expect(safeTruncate(undefined, 10)).toBe('')
    expect(safeTruncate(12345, 3)).toBe('123')
  })

  it('a request body built from truncated text round-trips through JSON either way', () => {
    // The fix is really about wire validity, not JS-level throwing — confirm
    // JSON.stringify already escapes a lone surrogate rather than throwing, so
    // the danger is downstream (e.g. the SDK's own body encoding), and the
    // point of safeTruncate is to never produce that string in the first place.
    const bisected = `hi${EMOJI}${EMOJI}`.slice(0, 3)
    expect(isLoneHighSurrogate(bisected)).toBe(true)
    expect(() => JSON.stringify({ t: bisected })).not.toThrow()
    expect(JSON.stringify({ t: safeTruncate(`hi${EMOJI}${EMOJI}`, 3) })).not.toContain('\\ud')
  })
})
