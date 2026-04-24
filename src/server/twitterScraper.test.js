import { describe, expect, it } from 'vitest'
import { getTwitterCookieStrings, parseTwitterCookieInput } from './twitterScraper'

describe('parseTwitterCookieInput', () => {
  it('parses JSON cookie arrays of objects', () => {
    const cookies = parseTwitterCookieInput(JSON.stringify([
      { key: 'auth_token', value: 'abc123', domain: '.twitter.com', path: '/', secure: true },
      { key: 'ct0', value: 'csrf456' },
    ]))

    expect(cookies).toEqual([
      'auth_token=abc123; Domain=.twitter.com; Path=/; Secure',
      'ct0=csrf456; Path=/; Secure',
    ])
  })

  it('parses a semicolon-separated cookie header', () => {
    const cookies = parseTwitterCookieInput('auth_token=abc123; ct0=csrf456')

    expect(cookies).toEqual(['auth_token=abc123', 'ct0=csrf456'])
  })
})

describe('getTwitterCookieStrings', () => {
  it('accepts direct auth token env values', () => {
    const cookies = getTwitterCookieStrings({
      TWITTER_AUTH_TOKEN: 'abc123',
      TWITTER_CT0: 'csrf456',
    })

    expect(cookies).toEqual([
      'auth_token=abc123; Domain=.twitter.com; Path=/; Secure',
      'ct0=csrf456; Domain=.twitter.com; Path=/; Secure',
    ])
  })

  it('decodes base64-encoded cookie JSON', () => {
    const raw = JSON.stringify([{ key: 'auth_token', value: 'abc123' }])
    const cookies = getTwitterCookieStrings({
      TWITTER_COOKIES_BASE64: Buffer.from(raw, 'utf8').toString('base64'),
    })

    expect(cookies).toEqual(['auth_token=abc123; Path=/; Secure'])
  })
})
