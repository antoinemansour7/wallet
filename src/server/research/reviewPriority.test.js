// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { attentionReviewPriority, compareAttentionPriorities, reviewPriorityProposal, REVIEW_PRIORITY_PROPOSAL_VERSION } from './reviewPriority.js'

const asOf = '2026-09-11T08:00:00.000Z'

function evidence(id, { publisher = 'desk', text = '$ABC momentum', priority = 100, hoursAgo = 1,
  type = 'account', labels = [`@${publisher}`], role = 'conviction', strategyFamily = 'attention' } = {}) {
  return {
    id, strategyFamily, priority, publicAt: new Date(Date.parse(asOf) - hoursAgo * 3600000).toISOString(),
    source: { documentId: `doc-${id}`, type, labels, url: type === 'news' ? `https://${publisher}.example/${id}` : `https://x.com/${publisher}/status/${id}`, excerpt: text },
    measurements: { attention: { publisher, sourceLabels: labels } }, interpretation: { role },
  }
}

const candidate = (ticker, items, priority = Math.max(...items.map((item) => item.priority))) => ({
  securityId: `figi:${ticker}`, ticker, name: `${ticker} Corp`, streams: ['attention'], priority, evidence: items,
})

describe('attention review priority proposal', () => {
  it('ranks independent, specific evidence above a single maximum-strength mention', () => {
    const loud = attentionReviewPriority([evidence('loud')], { asOf, ticker: 'ABC' })
    const specific = attentionReviewPriority([
      evidence('one', { publisher: 'wire', type: 'news', labels: ['exa-discovery'], priority: 72, text: '$ABC earnings are scheduled for September 18, 2026 with guidance of $2.4 billion.' }),
      evidence('two', { publisher: 'analyst', priority: 68, text: '$ABC will report earnings on September 18; revenue guidance is $2.4B.' }),
      evidence('three', { publisher: 'screen', type: 'screener', labels: ['finviz'], priority: 60, text: '$ABC breakout volume confirmed.' }),
    ], { asOf, ticker: 'ABC' })

    expect(loud.score).toBeLessThan(40)
    expect(specific.score).toBeGreaterThan(loud.score)
    expect(specific.features).toMatchObject({ independentPublishers: 3, hasDatedCatalyst: true, hasConcreteFact: true, technicalEvidenceCount: 1 })
  })

  it('caps attention volume and penalizes repetition, context-only hype, routine insider events, and negative evidence', () => {
    const repeated = Array.from({ length: 10 }, (_, index) => evidence(`repeat-${index}`, { publisher: 'onlydesk', text: '$ABC to the moon guaranteed 100x', role: 'context' }))
    const result = attentionReviewPriority(repeated, { asOf, ticker: 'ABC' })
    const routine = attentionReviewPriority([evidence('routine', { text: '$ABC director exercised options under a Rule 10b5-1 plan.' })], { asOf, ticker: 'ABC' })
    const adverse = attentionReviewPriority([evidence('bad', { text: '$ABC disclosed a going concern and material weakness.' })], { asOf, ticker: 'ABC' })

    expect(result.score).toBeLessThan(50)
    expect(result.components).toMatchObject({ repetitionPenalty: -8, contextOnlyPenalty: -8, hypePenalty: -6 })
    expect(routine.components.routineInsiderPenalty).toBe(-6)
    expect(adverse.components.negativeEvidencePenalty).toBe(-4)
  })

  it('uses only ticker-local text in long multi-company roundups', () => {
    const roundup = `Company XYZ has earnings on September 18 with $4B guidance. ${'unrelated market recap '.repeat(40)} $ABC was also mentioned among optical suppliers.`
    const result = attentionReviewPriority([evidence('roundup', { text: roundup })], { asOf, ticker: 'ABC' })
    expect(result.features).toMatchObject({ hasCatalyst: false, hasDatedCatalyst: false, hasConcreteFact: false })
  })

  it('is deterministic across evidence ordering and preserves non-attention stream scores', () => {
    const items = [
      evidence('one', { publisher: 'wire', type: 'news', labels: ['exa-discovery'], text: '$ABC earnings on September 18, 2026.' }),
      evidence('two', { publisher: 'desk', text: '$ABC earnings on September 18, 2026.' }),
    ]
    expect(attentionReviewPriority(items, { asOf, ticker: 'ABC' })).toEqual(attentionReviewPriority([...items].reverse(), { asOf, ticker: 'ABC' }))
    const fundamentals = evidence('sec', { strategyFamily: 'fundamentals', priority: 77, type: 'filing', labels: [], publisher: '' })
    const proposal = reviewPriorityProposal({ ticker: 'ABC', evidence: [...items, fundamentals] }, { asOf })
    expect(proposal).toMatchObject({ version: REVIEW_PRIORITY_PROPOSAL_VERSION, usedForAdmission: false, score: 77, streamScores: { fundamentals: 77 } })
  })

  it('reports saturation and cutoff changes without applying them', () => {
    const rows = [
      candidate('LOUD', [evidence('loud')]),
      candidate('DATED', [evidence('dated-news', { publisher: 'wire', type: 'news', labels: ['exa-discovery'], priority: 70, text: '$DATED earnings on September 18, 2026 with $4B guidance.' }), evidence('dated-social', { publisher: 'desk', priority: 65, text: '$DATED earnings on September 18, 2026 with $4B guidance.' })], 70),
    ]
    const comparison = compareAttentionPriorities(rows, { asOf, budget: 1 })
    expect(comparison).toMatchObject({ usedForAdmission: false, saturation: { currentAt95: 1, proposedAt95: 0 }, currentCutoff: { ticker: 'LOUD', score: 100 }, proposedCutoff: { ticker: 'DATED' } })
    expect(comparison.entering[0].ticker).toBe('DATED')
  })
})
