// ─── Safe truncation for untrusted external text ──────────────────────────────
//
// Every discovery source — X posts, Yahoo RSS, Exa search results — hands the
// pipeline raw text that gets truncated with plain `.slice(0, N)` before it
// goes into an LLM prompt. `.slice` counts UTF-16 code units, not characters,
// so cutting at N can land in the middle of an emoji: an astral character like
// 😀 is stored as a surrogate PAIR (two 16-bit units), and slicing between them
// leaves the string ending in a lone high surrogate, which is not valid UTF-16.
//
// That is not cosmetic. A production run on 2026-09-09 lost its ticker-picking
// step to `"no low surrogate in string: line 1 column 56123"` — Anthropic's API
// rejecting the request body outright, after `sanitizeSignalText`'s own
// `.slice(0, 300)` in src/server/researchEngine.js bisected an emoji in a tweet.
// The run degraded gracefully (the cycle carried the prior board rather than
// losing it), but this is exactly the kind of one-bad-tweet failure that
// should not be able to happen at all.
//
// Array.from(text) iterates by Unicode code point, keeping every surrogate
// pair intact, so slicing the resulting array can never split one.
export function safeTruncate(text, maxLength) {
  if (text == null) return ''
  const str = String(text)
  // The common case never needs the code-point path; skip it when the raw
  // length is already within budget or clearly extreme relative to it, since
  // Array.from on a very long string is real work for text that will never be
  // affected (surrogate pairs only make code-point count LOWER than length).
  if (str.length <= maxLength) return str
  return Array.from(str).slice(0, maxLength).join('')
}
