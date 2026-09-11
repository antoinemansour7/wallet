import { realHandler as getResearchHandler } from '../../../api/get-research.js'
import { runCatalystAgent } from '../agents/catalystAgent.js'
import { buildSignalBoard, extractTickers, finalizePicks, prepareResearchSignals } from '../researchEngine.js'
import { admitCandidates } from './admission.js'
import { freezePublication, storeProjection } from './publication.js'

const STAGE_NAMES = [
  'Discovery', 'Candidate board', 'Admission / ranking', 'Claude review',
  'Exa catalyst check', 'Verified date', 'Final ranking', 'Persisted', 'API payload',
]

function option(args, name) {
  const equals = args.find((arg) => arg.startsWith(`${name}=`))
  if (equals) return equals.slice(name.length + 1)
  const index = args.indexOf(name)
  const value = index >= 0 ? args[index + 1] : undefined
  return value?.startsWith('--') ? undefined : value
}

export function parseCatalystSmokeArgs(args = []) {
  if (args.includes('--help') || args.includes('-h')) return { help: true }
  const ticker = String(option(args, '--ticker') || '').trim().toUpperCase()
  const event = String(option(args, '--event') || '').trim()
  const eventDate = String(option(args, '--date') || '').trim() || null
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker)) throw new Error('Pass a valid ticker with --ticker TICKER')
  if (!event) throw new Error('Describe the known upcoming event with --event "..."')
  const parsedDate = eventDate ? Date.parse(`${eventDate}T00:00:00Z`) : NaN
  if (eventDate && (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || !Number.isFinite(parsedDate)
    || new Date(parsedDate).toISOString().slice(0, 10) !== eventDate)) throw new Error('--date must use a real YYYY-MM-DD date')
  return { ticker, event, eventDate, help: false }
}

function memoryProjection() {
  const values = new Map()
  const archive = { put: async (_kind, _id, record) => structuredClone(record) }
  const redis = {
    get: async (key) => structuredClone(values.get(key)),
    set: async (key, value) => { values.set(key, structuredClone(value)); return 'OK' },
    lrem: async () => 0,
    lpush: async () => 1,
    ltrim: async () => 'OK',
  }
  return { archive, redis }
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
    setHeader() {},
  }
}

function admissionFixture(ticker, asOf) {
  const security = {
    ticker, name: `${ticker} live smoke candidate`, securityId: `figi:live-smoke:${ticker}`,
    issuerId: 'cik:0000000001', exchange: 'XNAS', currency: 'USD',
  }
  const evidence = {
    id: `live-smoke:${ticker}:${asOf}`, ...security, strategyFamily: 'attention', horizon: 5, horizons: [5],
    publicAt: asOf, firstSeenAt: asOf, extractionCompletedAt: asOf, availableAt: asOf,
    priority: 100, source: { type: 'manual-live-smoke', url: 'https://x.com/', form: null },
    interpretation: { adverse: false }, decision: { status: 'eligible', reason: 'Operator-supplied live smoke fixture' },
  }
  return { ...security, evidence: [evidence] }
}

export async function runLiveCatalystSmoke({ ticker, event, eventDate = null, log = console.log } = {}) {
  const results = []
  let blockedBy = null
  const stage = async (name, work) => {
    if (blockedBy) {
      const result = { name, status: 'SKIP', detail: `blocked by ${blockedBy}` }
      results.push(result); log(`${name.padEnd(20)} SKIP  ${result.detail}`); return null
    }
    try {
      const value = await work()
      results.push({ name, status: 'PASS' }); log(`${name.padEnd(20)} PASS`); return value
    } catch (error) {
      blockedBy = name
      const detail = error?.message || String(error)
      results.push({ name, status: 'FAIL', detail }); log(`${name.padEnd(20)} FAIL  ${detail}`); return null
    }
  }

  if (!process.env.ANTHROPIC_API_KEY || !process.env.EXA_API_KEY) {
    const missing = [!process.env.ANTHROPIC_API_KEY && 'ANTHROPIC_API_KEY', !process.env.EXA_API_KEY && 'EXA_API_KEY'].filter(Boolean)
    const detail = `missing ${missing.join(' and ')}`
    results.push({ name: 'Configuration', status: 'FAIL', detail }); log(`${'Configuration'.padEnd(20)} FAIL  ${detail}`)
    for (const name of STAGE_NAMES) {
      const skipped = { name, status: 'SKIP', detail: 'blocked by Configuration' }
      results.push(skipped); log(`${name.padEnd(20)} SKIP  ${skipped.detail}`)
    }
    return { ok: false, stages: results }
  }

  const now = new Date().toISOString()
  const signal = {
    id: `live-smoke:${ticker}:${Date.now()}`, tickers: [ticker], text: `$${ticker} ${event}`,
    createdAt: now, sourceType: 'account', sourceRole: 'conviction', sourceLabels: ['live-smoke'],
    username: 'live-smoke', url: 'https://x.com/', score: 10,
  }
  const discovered = await stage('Discovery', async () => {
    const prepared = prepareResearchSignals([signal])
    if (prepared.length !== 1 || !prepared[0].tickers.includes(ticker)) throw new Error(`${ticker} was removed by discovery validation`)
    return prepared
  })
  await stage('Candidate board', async () => {
    const board = buildSignalBoard(discovered, [])
    if (!board.some((candidate) => candidate.ticker === ticker)) throw new Error(`${ticker} did not reach the candidate board`)
    return board
  })
  await stage('Admission / ranking', async () => {
    const admitted = admitCandidates([admissionFixture(ticker, now)], { asOf: now })
    if (!admitted.candidates.some((candidate) => candidate.ticker === ticker)) throw new Error(`${ticker} was not admitted: ${admitted.audit.rejected[0]?.reason || 'review budget exhausted'}`)
    return admitted
  })
  let reviewed = await stage('Claude review', async () => {
    let board = []
    const picks = await extractTickers([signal], [], { onBoard: (value) => { board = value } })
    if (!board.some((candidate) => candidate.ticker === ticker)) throw new Error(`${ticker} lacked a fresh market quote or failed board gates`)
    const pick = picks.find((candidate) => candidate.ticker === ticker)
    if (!pick) throw new Error(`Claude did not accept ${ticker}`)
    return [pick]
  })
  reviewed = await stage('Exa catalyst check', async () => {
    const enriched = await runCatalystAgent(reviewed)
    const pick = enriched.find((candidate) => candidate.ticker === ticker)
    if (!pick?.catalystVerified) {
      const reason = !pick?.catalystSources?.length ? 'no supplied source URL survived verification' : !pick.catalystDate ? 'no event date survived verification' : 'Claude did not verify the catalyst'
      throw new Error(reason)
    }
    return enriched
  })
  await stage('Verified date', async () => {
    const actual = reviewed[0].catalystDate
    if (!actual) throw new Error('verified catalyst has no event date')
    if (eventDate && actual !== eventDate) throw new Error(`expected ${eventDate}, received ${actual}`)
    return actual
  })
  const ranked = await stage('Final ranking', async () => {
    const value = finalizePicks(reviewed)
    if (!value.some((candidate) => candidate.ticker === ticker)) throw new Error(`${ticker} was removed during final ranking`)
    return value
  })
  const storage = memoryProjection()
  const persisted = await stage('Persisted', async () => {
    const payload = await freezePublication(storage.archive, {
      generatedAt: now, picks: ranked, picksByHorizon: { 5: ranked, 20: [], 60: [] },
      articles: [], signalCount: 1, tweetCount: 1, queryCount: 1, errors: [], reportsPending: false,
    })
    await storeProjection(storage.redis, payload)
    const stored = await storage.redis.get('research:latest')
    if (!stored?.picks?.find((candidate) => candidate.ticker === ticker)?.catalystVerified) throw new Error('verified catalyst was lost from the stored projection')
    return stored
  })
  const apiPayload = await stage('API payload', async () => {
    const res = response()
    await getResearchHandler({ method: 'GET', query: {} }, res, { redis: storage.redis })
    const pick = res.body?.picks?.find((candidate) => candidate.ticker === ticker)
    if (res.statusCode !== 200 || !pick?.catalystVerified) throw new Error('verified catalyst was lost from the API payload')
    for (const field of ['catalystDetail', 'catalystDate', 'catalystTimeline', 'catalystPricedIn', 'catalystConfidence', 'catalystSources']) {
      if (pick[field] === undefined) throw new Error(`${field} is missing from the API payload`)
    }
    return res.body
  })

  for (const name of STAGE_NAMES) if (!results.some((result) => result.name === name)) await stage(name, async () => null)
  return { ok: !blockedBy, stages: results, payload: apiPayload || persisted || null }
}
