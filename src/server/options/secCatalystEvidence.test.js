import { describe, expect, it, vi } from 'vitest'
import { gatherOptionsSecEvidence } from './secCatalystEvidence.js'

function master(resolutions) {
  return { resolve: ({ ticker }) => resolutions[ticker] || [] }
}

const security = { securityId: 'wallai:security:example', issuerId: 'wallai:issuer:example', ticker: 'EX' }

describe('gatherOptionsSecEvidence', () => {
  it('maps a recent 8-K into both the sec feed and the catalysts feed, and drops a filing older than the lookback window', async () => {
    const secMaster = master({ EX: [{ issuerId: 'cik:0000320193' }] })
    const client = { request: vi.fn(async () => ({
      filings: { recent: {
        accessionNumber: ['0000320193-26-000010', '0000320193-25-000090'],
        form: ['8-K', '10-Q'],
        acceptanceDateTime: ['2026-09-22T11:00:00.000Z', '2026-01-15T11:00:00.000Z'],
        filingDate: ['2026-09-22', '2026-01-15'],
        reportDate: ['2026-09-22', '2025-12-31'],
        primaryDocument: ['ex1.htm', 'ex2.htm'],
        items: ['', ''],
      } },
    })) }
    const result = await gatherOptionsSecEvidence({ securityMaster: secMaster, securities: [security], freezeAt: '2026-09-22T13:20:00.000Z', client, deadline: Date.now() + 60000 })
    expect(result.secItems).toHaveLength(1)
    expect(result.secItems[0]).toMatchObject({ form: '8-K', issuerId: security.issuerId, ticker: 'EX' })
    expect(result.catalystItems).toHaveLength(1)
    expect(result.catalystItems[0]).toMatchObject({ kind: 'sec_8k', eventDate: '2026-09-22' })
    expect(result.completed).toEqual(['cik:0000320193'])
  })

  it('marks a ticker unresolved in the security master as unavailable without throwing', async () => {
    const secMaster = master({})
    const client = { request: vi.fn() }
    const result = await gatherOptionsSecEvidence({ securityMaster: secMaster, securities: [security], freezeAt: '2026-09-22T13:20:00.000Z', client, deadline: Date.now() + 60000 })
    expect(result.secItems).toHaveLength(0)
    expect(client.request).not.toHaveBeenCalled()
  })

  it('skips an issuer already completed by a prior checkpointed attempt', async () => {
    const secMaster = master({ EX: [{ issuerId: 'cik:0000320193' }] })
    const client = { request: vi.fn() }
    const result = await gatherOptionsSecEvidence({ securityMaster: secMaster, securities: [security], freezeAt: '2026-09-22T13:20:00.000Z', completed: ['cik:0000320193'], client, deadline: Date.now() + 60000 })
    expect(client.request).not.toHaveBeenCalled()
    expect(result.completed).toEqual(['cik:0000320193'])
  })
})
