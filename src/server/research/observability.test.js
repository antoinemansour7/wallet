// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RESEARCH_RUNS_KEY, STAGES, candidateTraces, recordCandidates, recordResearchRun, researchLog, skipStage, stage, withResearchRun } from './observability.js'

let lines
beforeEach(() => {
  lines = []
  vi.spyOn(console, 'log').mockImplementation((line) => lines.push(['log', line]))
  vi.spyOn(console, 'error').mockImplementation((line) => lines.push(['error', line]))
})
afterEach(() => vi.restoreAllMocks())

const emitted = () => lines.map(([channel, line]) => ({ channel, ...JSON.parse(line) }))

describe('researchLog', () => {
  it('emits one structured JSON line carrying the run identity', () => {
    withResearchRun({ runId: 'run-1', job: 'nightly-research' }, () => {
      researchLog({ stage: 'x_discovery', event: 'stage_completed', metrics: { signals: 24 } })
    })

    expect(emitted()).toEqual([expect.objectContaining({
      service: 'research',
      runId: 'run-1',
      job: 'nightly-research',
      stage: 'x_discovery',
      event: 'stage_completed',
      level: 'info',
      metrics: { signals: 24 },
    })])
  })

  it('normalizes a thrown Error and reports it on the error channel', () => {
    const failure = new Error('exa timeout')
    withResearchRun({ runId: 'run-1', job: 'nightly-research' }, () => {
      researchLog({ stage: 'catalyst_verification', event: 'stage_failed', error: failure })
    })

    const [record] = emitted()
    expect(record.channel).toBe('error')
    expect(record.level).toBe('error')
    expect(record.error).toEqual({
      name: 'Error',
      message: 'exa timeout',
      stack: expect.stringContaining('observability.test.js'),
    })
  })

  it('caps error text, so a client that stuffs a response body into the message cannot bloat the record', () => {
    withResearchRun({ runId: 'run-1', job: 'nightly-research' }, () => {
      researchLog({ stage: 'claude_review', event: 'stage_failed', error: new Error('x'.repeat(9000)) })
    })

    const { message, stack } = emitted()[0].error
    expect(message.length).toBeLessThanOrEqual(600)
    expect(stack.length).toBeLessThanOrEqual(2000)
  })

  it('keeps metrics scalar, so a model response or source corpus cannot be serialized', () => {
    withResearchRun({ runId: 'run-1', job: 'nightly-research' }, () => {
      researchLog({
        stage: 'claude_review',
        event: 'stage_completed',
        metrics: {
          accepted: 9,
          verified: true,
          provider: 'anthropic',
          response: { content: 'the full model answer' },
          corpus: ['post', 'post'],
        },
      })
    })

    expect(emitted()[0].metrics).toEqual({ accepted: 9, verified: true, provider: 'anthropic' })
  })

  it.each(['apiKey', 'CRON_SECRET', 'bearerToken', 'password', 'authorization', 'credentials'])(
    'redacts %s, which passes the scalar filter as a plain string',
    (key) => {
      withResearchRun({ runId: 'run-1', job: 'nightly-research' }, () => {
        researchLog({ stage: 'x_discovery', event: 'stage_started', metrics: { [key]: 'sk-live-abcdef' } })
      })

      expect(JSON.stringify(emitted()[0])).not.toContain('sk-live-abcdef')
    },
  )
})

describe('stage', () => {
  const run = (fn) => withResearchRun({ runId: 'run-1', job: 'nightly-research' }, fn)

  it('brackets the work with started and completed events and returns its result', async () => {
    const result = await run(() => stage('x_discovery', async () => 'signals'))

    expect(result).toBe('signals')
    expect(emitted().map(({ stage: name, event }) => [name, event])).toEqual([
      ['x_discovery', 'stage_started'],
      ['x_discovery', 'stage_completed'],
    ])
    expect(emitted()[1]).toMatchObject({ status: 'success', durationMs: expect.any(Number) })
  })

  it('derives completion metrics from the result, so counts describe what the stage produced', async () => {
    await run(() => stage('x_discovery', async () => ['AAPL', 'RKLB'], {
      metrics: (signals) => ({ signals: signals.length }),
    }))

    expect(emitted()[1].metrics).toEqual({ signals: 2 })
  })

  it('records a failed stage and rethrows, so a fatal stage still stops the run', async () => {
    await expect(run(() => stage('foundation_load', async () => {
      throw new Error('archive unavailable')
    }))).rejects.toThrow('archive unavailable')

    expect(emitted()[1]).toMatchObject({
      stage: 'foundation_load',
      event: 'stage_failed',
      status: 'failed',
      level: 'error',
      durationMs: expect.any(Number),
      error: { message: 'archive unavailable' },
    })
  })

  it('records optional work deferred by the cron budget as skipped', () => {
    run(() => skipStage('report_generation', 'time_budget', { availableMs: 1200 }))

    expect(emitted()[0]).toMatchObject({
      stage: 'report_generation', event: 'stage_skipped', status: 'skipped',
      metrics: { reason: 'time_budget', availableMs: 1200 },
    })
  })

})

describe('STAGES', () => {
  it('is frozen and self-naming, so the vocabulary cannot drift or be mutated', () => {
    expect(Object.isFrozen(STAGES)).toBe(true)
    expect(Object.entries(STAGES).filter(([name, value]) => name !== value)).toEqual([])
  })

  it('names the discovery, review and publication stages the pipeline actually runs', () => {
    expect(Object.keys(STAGES)).toEqual(expect.arrayContaining([
      'foundation_load', 'x_discovery', 'news_discovery', 'screener_discovery', 'exa_discovery',
      'day_trade_signals', 'market_regime', 'claude_review', 'contrarian_review',
      'catalyst_verification', 'final_ranking', 'publication', 'persistence',
      'report_generation', 'evaluation_snapshot', 'premarket_check',
      'foundation_sync', 'foundation_followup', 'performance_tracking', 'performance_evaluation',
    ]))
  })

  it('names the evaluation hand-off stages the cron split introduces', () => {
    expect(STAGES.evaluation_input_freeze).toBe('evaluation_input_freeze')
    expect(STAGES.evaluation_job).toBe('evaluation_job')
    expect(STAGES.evaluation_snapshot).toBe('evaluation_snapshot')
    expect(STAGES).not.toHaveProperty('slack_alerts')
  })
})

describe('candidateTraces', () => {
  const admission = {
    audit: {
      rejected: [{ securityId: 'figi:XYZ', ticker: 'XYZ', reason: 'unresolved_identity' }],
      notReviewed: [{ securityId: 'figi:LATE', ticker: 'LATE', reason: 'review_budget_exhausted' }],
    },
  }

  it('says why a candidate never reached the model', () => {
    const traces = candidateTraces({ admission })

    expect(traces).toEqual(expect.arrayContaining([
      expect.objectContaining({ ticker: 'XYZ', outcome: 'discovered', reason: 'unresolved_identity', reviewed: false, sentToClaude: false }),
      expect.objectContaining({ ticker: 'LATE', outcome: 'not_reviewed', reason: 'review_budget_exhausted', reviewed: false, sentToClaude: false }),
    ]))
  })

  it('keeps the versioned production priority explanation and legacy comparison in the candidate trace', () => {
    const priorityModel = { version: 'attention-review-priority-v2', usedForAdmission: true, score: 72,
      streamScores: { attention: 72 }, components: { evidenceQuality: 20, sourceIndependence: 16 } }
    const [trace] = candidateTraces({ admission: { audit: { selected: [{ securityId: 'figi:ABC', ticker: 'ABC', streams: ['attention'],
      priority: 72, legacyPriority: 100, priorityModel, legacyOverallRank: 4, legacyStreamRanks: { attention: 3 } }] } } })

    expect(trace).toMatchObject({ ticker: 'ABC', priority: 72, legacyPriority: 100, priorityModel, legacyOverallRank: 4, legacyStreamRanks: { attention: 3 } })
  })

  it('ranks a published pick and carries what the agents decided about it', () => {
    const rocket = { ticker: 'RKLB', securityId: 'figi:RKLB', finalScore: 84, catalystVerified: true,
      catalystDetail: 'Earnings after market close', catalystDate: '2026-09-12', catalystTimeline: 'in 3 days',
      catalystPricedIn: false, catalystConfidence: 9, catalystInWindow: true,
      catalystSources: ['https://example.com/earnings'], }

    const [trace] = candidateTraces({ admission, accepted: [rocket], published: [rocket] })

    expect(trace).toMatchObject({
      ticker: 'RKLB',
      outcome: 'published',
      reviewed: true,
      rank: 1,
      finalScore: 84,
      catalystVerified: true,
      catalystDetail: 'Earnings after market close',
      catalystDate: '2026-09-12',
      catalystTimeline: 'in 3 days',
      catalystPricedIn: false,
      catalystConfidence: 9,
      catalystInWindow: true,
      catalystSources: ['https://example.com/earnings'],
      outcomesByHorizon: { 5: { score: 84, scoreKind: 'composite', rank: 1, published: true, catalystVerified: true } },
    })
  })

  it('keeps each holding-period score separate and ranks new picks against the full carried board', () => {
    const attention = { ticker: 'PANW', securityId: 'figi:PANW', horizon: 5, finalScore: 32, catalystVerified: false }
    const fundamentals = { ticker: 'PANW', securityId: 'figi:PANW', horizon: 20, finalScore: 82 }
    const immr = { ticker: 'IMMR', securityId: 'figi:IMMR', horizon: 20, finalScore: 74 }
    const traces = candidateTraces({
      accepted: [attention],
      primaryReview: { picksByHorizon: { 20: [fundamentals, immr] } },
      published: [attention, fundamentals, immr],
      publishedBoard: [
        { ticker: 'CARRIED5', horizon: 5, finalScore: 40 }, attention,
        { ticker: 'CARRIED20', horizon: 20, finalScore: 90 }, fundamentals, immr,
      ],
    })

    expect(traces.find((trace) => trace.ticker === 'PANW').outcomesByHorizon).toMatchObject({
      5: { score: 32, scoreKind: 'composite', rank: 2, published: true, catalystVerified: false },
      20: { score: 82, scoreKind: 'model', rank: 2, published: true },
    })
    expect(traces.find((trace) => trace.ticker === 'PANW').outcomesByHorizon[20]).not.toHaveProperty('catalystVerified')
    expect(traces.find((trace) => trace.ticker === 'IMMR').outcomesByHorizon[20]).toMatchObject({
      score: 74, scoreKind: 'model', rank: 3, published: true,
    })
    expect(traces).toHaveLength(2)
  })

  it('keeps a reviewed candidate that lost its slot distinct from one that was published', () => {
    const traces = candidateTraces({
      admission,
      accepted: [{ ticker: 'RKLB', securityId: 'figi:RKLB' }, { ticker: 'NEAR', securityId: 'figi:NEAR' }],
      published: [{ ticker: 'RKLB', securityId: 'figi:RKLB' }],
    })

    const near = traces.find((t) => t.ticker === 'NEAR')
    expect(near).toMatchObject({ outcome: 'accepted', reviewed: true })
    expect(near.rank).toBeUndefined()
  })

  it('records a board candidate that never became a pick exactly once', () => {
    const traces = candidateTraces({
      admission,
      board: [{ ticker: 'QUIET', securityId: 'figi:QUIET' }, { ticker: 'XYZ', securityId: 'figi:XYZ' }],
    })

    expect(traces.filter((t) => t.ticker === 'XYZ')).toHaveLength(1)
    expect(traces.find((t) => t.ticker === 'QUIET')).toMatchObject({ outcome: 'reviewed_rejected', reviewed: true, sentToClaude: true })
  })

  it('joins a published pick that omitted its ID to the admitted security instead of emitting a contradictory duplicate', () => {
    const traced = candidateTraces({
      admission: { audit: { selected: [{ ticker: 'RKLB', securityId: 'figi:RKLB', name: 'Rocket Lab USA', streams: ['attention'], sources: ['X / attention'] }] } },
      board: [{ ticker: 'RKLB', securityId: 'figi:RKLB' }],
      published: [{ ticker: 'RKLB', finalScore: 84 }],
    })

    expect(traced).toHaveLength(1)
    expect(traced[0]).toMatchObject({ ticker: 'RKLB', securityId: 'figi:RKLB', name: 'Rocket Lab USA', outcome: 'published', sentToClaude: true })
  })

  it('distinguishes primary candidates sent to Claude from quote failures that never reached it', () => {
    const traced = candidateTraces({
      admission: { audit: { selected: [
        { ticker: 'SENT', securityId: 'figi:SENT', streams: ['fundamentals'] },
        { ticker: 'NOQUOTE', securityId: 'figi:NOQUOTE', streams: ['fundamentals'] },
      ] } },
      primaryReview: {
        reviewedSecurityIds: ['figi:SENT'],
        decisions: [
          { securityId: 'figi:SENT', status: 'rejected', reason: 'Thesis too weak' },
          { securityId: 'figi:NOQUOTE', status: 'rejected', reason: 'Fresh matching-currency quote unavailable' },
        ],
      },
    })

    expect(traced.find((item) => item.ticker === 'SENT')).toMatchObject({ outcome: 'reviewed_rejected', sentToClaude: true })
    expect(traced.find((item) => item.ticker === 'NOQUOTE')).toMatchObject({ outcome: 'discovered', sentToClaude: false })
  })
})

describe('recordResearchRun', () => {
  const redis = () => ({ lpush: vi.fn().mockResolvedValue(1), ltrim: vi.fn().mockResolvedValue('OK') })
  const stored = (fake) => JSON.parse(fake.lpush.mock.calls[0][1])

  it('persists one summary per run, listing each stage with its duration', async () => {
    const fake = redis()

    await recordResearchRun(fake, { job: 'nightly-research' }, async () => {
      await stage('x_discovery', async () => ['AAPL'], { metrics: (s) => ({ signals: s.length }) })
      await stage('claude_review', async () => 'reviewed')
    })

    expect(fake.lpush).toHaveBeenCalledWith(RESEARCH_RUNS_KEY, expect.any(String))
    expect(stored(fake)).toMatchObject({
      job: 'nightly-research',
      status: 'success',
      runId: expect.any(String),
      durationMs: expect.any(Number),
      stages: [
        { stage: 'x_discovery', status: 'success', metrics: { signals: 1 } },
        { stage: 'claude_review', status: 'success' },
      ],
    })
  })

  it('does not share the request-level run log, which polling evicts', () => {
    expect(RESEARCH_RUNS_KEY).not.toBe('logs:runs')
  })

  it('marks a run partial when the caller absorbed a stage failure and carried on', async () => {
    const fake = redis()

    await recordResearchRun(fake, { job: 'nightly-research' }, async () => {
      try {
        await stage('exa_discovery', async () => { throw new Error('exa timeout') })
      } catch { /* the pipeline records this leg and continues, as it does today */ }
    })

    expect(stored(fake)).toMatchObject({
      status: 'partial',
      stages: [{ stage: 'exa_discovery', status: 'failed', error: { message: 'exa timeout' } }],
    })
  })

  it('records a failed run and rethrows, so the caller still sees the failure', async () => {
    const fake = redis()

    await expect(recordResearchRun(fake, { job: 'nightly-research' }, async () => {
      await stage('foundation_load', async () => { throw new Error('archive unavailable') })
    })).rejects.toThrow('archive unavailable')

    expect(stored(fake)).toMatchObject({ status: 'failed' })
  })

  it('persists the candidate traces the run recorded, so a ticker can be searched later', async () => {
    const fake = redis()

    await recordResearchRun(fake, { job: 'nightly-research' }, async () => {
      recordCandidates([{ ticker: 'RKLB', outcome: 'published', rank: 1 }])
    })

    expect(stored(fake).candidates).toEqual([{ ticker: 'RKLB', outcome: 'published', rank: 1 }])
  })

  it('persists an exact admission-to-publication funnel with the stream diagnostic', async () => {
    const fake = redis()
    const admission = { audit: {
      funnel: { discovered: 82, eligible: 82, admitted: 15, notReviewed: 67, rejected: 0 },
      streams: [{ strategy: 'attention', configured: 12, reservedUsed: 12, selected: 12, waiting: 14 }],
      reallocations: [],
    } }
    const traces = [
      { ticker: 'RKLB', outcome: 'published', sentToClaude: true, claudeStatus: 'accepted' },
      { ticker: 'LATE', outcome: 'not_reviewed', sentToClaude: false, claudeStatus: 'not_sent' },
    ]

    await recordResearchRun(fake, { job: 'nightly-research' }, async () => recordCandidates(traces, admission))

    expect(stored(fake).admission).toMatchObject({
      funnel: { discovered: 82, eligible: 82, admitted: 15, sentToClaude: 1, claudeAccepted: 1, published: 1, notReviewed: 67 },
      streams: [{ strategy: 'attention', configured: 12, reservedUsed: 12, waiting: 14 }],
    })
  })

  it('bounds retention so the run history cannot grow without limit', async () => {
    const fake = redis()

    await recordResearchRun(fake, { job: 'nightly-research' }, async () => 'done')

    expect(fake.ltrim).toHaveBeenCalledWith(RESEARCH_RUNS_KEY, 0, expect.any(Number))
  })

  it('never lets a logging failure take down the pipeline', async () => {
    const fake = redis()
    fake.lpush.mockRejectedValue(new Error('redis unreachable'))

    await expect(recordResearchRun(fake, { job: 'nightly-research' }, async () => 'picks'))
      .resolves.toBe('picks')
  })

  // Vercel may freeze a function once its response is sent, so a summary
  // written after the response can silently never land (nightly runs of
  // 2026-09-26/28/29 published picks but left no record).
  it('holds the response until the run summary is stored', async () => {
    const fake = redis()
    const order = []
    fake.lpush.mockImplementation(async () => { order.push('stored') })
    const res = { status: vi.fn(() => res), json: vi.fn(() => { order.push('responded'); return res }) }

    await recordResearchRun(fake, { job: 'nightly-research', res }, async (held) => {
      held.status(200).json({ picks: 3 })
      order.push('work done')
    })

    expect(order).toEqual(['work done', 'stored', 'responded'])
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ picks: 3 })
  })

  it('still responds when the summary cannot be stored', async () => {
    const fake = redis()
    fake.lpush.mockRejectedValue(new Error('redis unreachable'))
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) }

    await recordResearchRun(fake, { job: 'nightly-research', res }, async (held) => held.status(503).json({ error: 'x' }))

    expect(res.status).toHaveBeenCalledWith(503)
    expect(res.json).toHaveBeenCalledWith({ error: 'x' })
  })

  it('stores a slim summary carrying the error when the full one is rejected', async () => {
    const fake = redis()
    fake.lpush.mockRejectedValueOnce(new Error('ERR max request size exceeded'))

    await recordResearchRun(fake, { job: 'nightly-research' }, async () => {
      await stage('claude_review', async () => 'reviewed')
      recordCandidates([{ ticker: 'RKLB', outcome: 'published' }])
    })

    expect(fake.lpush).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fake.lpush.mock.calls[1][1])).toMatchObject({
      job: 'nightly-research',
      status: 'success',
      stages: [{ stage: 'claude_review', status: 'success' }],
      candidates: [],
      candidateCount: 1,
      persistError: 'ERR max request size exceeded',
    })
  })

  it('stores a slim summary when the candidate traces cannot be serialized', async () => {
    const fake = redis()
    const circular = { ticker: 'LOOP' }
    circular.self = circular

    await recordResearchRun(fake, { job: 'nightly-research' }, async () => recordCandidates([circular]))

    expect(fake.lpush).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fake.lpush.mock.calls[0][1])).toMatchObject({
      candidates: [], candidateCount: 1, persistError: expect.stringMatching(/circular/i),
    })
  })
})
