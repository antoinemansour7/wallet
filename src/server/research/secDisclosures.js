import { digest } from './archive.js'
import { issuerId } from './securityMaster.js'
import { createEvidence, archiveEvidence } from './evidence.js'
import { comparableInstantFacts, computeFundamentalFeatures, improvementPriority, summarizeImprovement } from './fundamentals.js'

const FORMS = new Set(['10-Q', '10-Q/A', '10-K', '10-K/A', '8-K', '8-K/A', '4', '4/A'])
const day = 86400000
// Only additive monetary flows can be differenced. EPS, ratios and weighted
// average shares cannot be reconstructed by subtracting cumulative values.
const ADDITIVE = new Set(['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax',
  'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'NetIncomeLoss',
  'OperatingIncomeLoss', 'GrossProfit', 'CostOfRevenue', 'CostOfGoodsAndServicesSold',
  'ResearchAndDevelopmentExpense', 'SellingGeneralAndAdministrativeExpense',
  'NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInInvestingActivities',
  'NetCashProvidedByUsedInFinancingActivities', 'PaymentsToAcquirePropertyPlantAndEquipment'])
export function createSecClient({ deadline = Infinity, fetchImpl = fetch, userAgent = process.env.SEC_USER_AGENT, pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (!userAgent?.trim()) throw new Error('Set SEC_USER_AGENT to an application name and monitored contact address before disclosure ingestion')
  let lastRequest = 0
  let queue = Promise.resolve()
  const request = (url, json = true) => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !['www.sec.gov', 'data.sec.gov'].includes(parsed.hostname)) throw new Error('Untrusted SEC document URL')
    const run = async () => {
      await pause(Math.max(0, 250 - (Date.now() - lastRequest)))
      if (Date.now() + 1000 >= deadline) throw new Error('Disclosure ingestion time budget reached; pending jobs will resume')
      lastRequest = Date.now()
      const response = await fetchImpl(parsed.href, { headers: { 'User-Agent': userAgent, Accept: json ? 'application/json' : '*/*' }, signal: AbortSignal.timeout(Math.min(20000, Math.max(1, deadline - Date.now()))), redirect: 'error' })
      if (!response.ok) throw new Error(`SEC disclosure request failed (${response.status})`)
      return json ? response.json() : Buffer.from(await response.arrayBuffer())
    }
    const result = queue.then(run)
    queue = result.catch(() => {})
    return result
  }
  return { request }
}

export function filingRows(submissions) {
  const rows = submissions.filings?.recent || submissions
  return (rows.accessionNumber || []).map((accession, i) => ({ accession, form: rows.form?.[i],
    publicAt: rows.acceptanceDateTime?.[i], filingDate: rows.filingDate?.[i], reportDate: rows.reportDate?.[i], primaryDocument: rows.primaryDocument?.[i] }))
    .filter((row) => FORMS.has(row.form) && /^\d{10}-\d{2}-\d{6}$/.test(row.accession) && Number.isFinite(Date.parse(row.publicAt)))
}

function factEntries(companyFacts, filing) {
  const entries = []
  for (const [taxonomy, concepts] of Object.entries(companyFacts.facts || {})) for (const [concept, spec] of Object.entries(concepts)) {
    for (const [units, values] of Object.entries(spec.units || {})) for (const fact of values) {
      if (fact.accn !== filing.accession || !Number.isFinite(fact.val) || !fact.end) continue
      entries.push({ concept: `${taxonomy}:${concept}`, units, value: fact.val, periodStart: fact.start || null, periodEnd: fact.end,
        accession: filing.accession, publicAt: filing.publicAt, fiscalYear: fact.fy, fiscalPeriod: fact.fp, form: filing.form })
    }
  }
  return entries
}

// Never subtract a restatement from a later accession. Both the current and
// preceding YTD amounts must be known by this filing's public timestamp.
export function comparableQuarterlyFacts(facts, asOf) {
  const allowed = facts.filter((f) => Date.parse(f.publicAt) <= Date.parse(asOf) && Number.isFinite(f.value))
  const quarter = []
  for (const fact of allowed) {
    if (!fact.periodStart) continue // instant balance-sheet facts are separate
    const duration = (Date.parse(fact.periodEnd) - Date.parse(fact.periodStart)) / day + 1
    if (duration >= 70 && duration <= 110) quarter.push({ ...fact, derivation: 'reported_quarter', inputs: [fact.accession], inputSnapshotIds: [fact.snapshotId].filter(Boolean) })
    else if (duration > 110 && duration <= 380 && fact.concept.startsWith('us-gaap:') && ADDITIVE.has(fact.concept.split(':')[1])) {
      const prior = allowed.filter((f) => f.concept === fact.concept && f.units === fact.units && f.periodStart === fact.periodStart && Date.parse(f.publicAt) <= Date.parse(fact.publicAt)
        && f.periodEnd < fact.periodEnd && (Date.parse(fact.periodEnd) - Date.parse(f.periodEnd)) / day >= 70
        && (Date.parse(fact.periodEnd) - Date.parse(f.periodEnd)) / day <= 110)
        .sort((a, b) => Date.parse(b.publicAt) - Date.parse(a.publicAt))
      if (prior.length) {
        const preceding = prior[0]
        // Conflicting values within the same accession/context are ambiguous.
        if (prior.some((f) => f.accession === preceding.accession && f.periodEnd === preceding.periodEnd && f.value !== preceding.value)) continue
        quarter.push({ ...fact, value: fact.value - preceding.value,
          periodStart: new Date(Date.parse(preceding.periodEnd) + day).toISOString().slice(0, 10),
          derivation: 'ytd_difference', inputs: [fact.accession, preceding.accession], inputSnapshotIds: [fact.snapshotId, preceding.snapshotId].filter(Boolean) })
      }
    }
  }
  return quarter.map((fact) => {
    const matches = quarter.filter((prior) => prior.concept === fact.concept && prior.units === fact.units && prior.periodEnd < fact.periodEnd && Date.parse(prior.publicAt) <= Date.parse(fact.publicAt)
      && Math.abs((Date.parse(fact.periodEnd) - Date.parse(prior.periodEnd)) / day - 365) <= 14)
      .sort((a, b) => Date.parse(b.publicAt) - Date.parse(a.publicAt))
    return { ...fact, priorComparable: matches[0] ? { value: matches[0].value, periodEnd: matches[0].periodEnd, accession: matches[0].accession, inputSnapshotIds: matches[0].inputSnapshotIds } : null }
  })
}

const plain = (bytes) => bytes.toString('utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

export async function ingestIssuer(archive, master, cik, { client = createSecClient(), since = new Date(Date.now() - 7 * day).toISOString(), limit = 20, afterAccession = null, deadline = Infinity, now = () => new Date().toISOString() } = {}) {
  const issuer = issuerId(cik)
  if (!issuer) throw new Error('Invalid SEC issuer ID')
  const securities = master.resolve({ issuer, asOf: now() })
  if (!securities.length) return { documents: [], evidence: [], skipped: 'issuer_outside_universe' }
  const padded = issuer.slice(4)
  const submissions = await client.request(`https://data.sec.gov/submissions/CIK${padded}.json`)
  const rows = filingRows(submissions)
  for (const file of submissions.filings?.files || []) {
    if (file.filingTo >= since.slice(0, 10) && /^[A-Za-z0-9.-]+\.json$/.test(file.name)) {
      rows.push(...filingRows(await client.request(`https://data.sec.gov/submissions/${file.name}`)))
    }
  }
  const lookback = Date.parse(since) - 450 * day
  const matching = [...new Map(rows.filter((f) => Date.parse(f.publicAt) <= Date.parse(now()) &&
    (Date.parse(f.publicAt) >= Date.parse(since) || (/^10-[QK]/.test(f.form) && Date.parse(f.publicAt) >= lookback))).map((f) => [f.accession, f])).values()]
    .sort((a, b) => Date.parse(a.publicAt) - Date.parse(b.publicAt))
  const start = afterAccession ? matching.findIndex((f) => f.accession === afterAccession) + 1 : 0
  const filings = matching.slice(start, start + limit)
  const result = { documents: [], evidence: [], truncated: matching.length > start + limit, nextAccession: filings.at(-1)?.accession || null }
  if (!filings.length) return result
  let facts = { facts: {} }
  if (filings.some((f) => !f.form.startsWith('4'))) {
    try { facts = await client.request(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`) }
    catch (error) { if (!error.message.includes('(404)')) throw error }
  }
  const factsObservedAt = now()
  for (const filing of filings) {
    if (Date.now() + 30000 >= deadline) {
      result.truncated = true
      result.nextAccession = result.lastCompletedAccession || afterAccession
      return result
    }
    const prefix = `https://www.sec.gov/Archives/edgar/data/${Number(padded)}/${filing.accession.replaceAll('-', '')}/`
    if (!/^[A-Za-z0-9_./-]+$/.test(filing.primaryDocument || '') || filing.primaryDocument.includes('..')) continue
    const primaryUrl = `${prefix}${filing.primaryDocument.replace(/^xsl[^/]+\//, '')}`
    const bytes = await client.request(primaryUrl, false)
    const firstSeenAt = now()
    const document = await archive.putDocument({ issuerId: issuer, accession: filing.accession, form: filing.form,
      publicAt: new Date(filing.publicAt).toISOString(), firstSeenAt, url: primaryUrl,
      mediaType: /\.xml$/i.test(filing.primaryDocument) ? 'application/xml' : 'text/html',
      reportDate: filing.reportDate, amendment: filing.form.endsWith('/A'), bytes })
    result.documents.push(document)
    // Archive the complete original submission as well. Exhibit TYPE, not a
    // filename guess, identifies furnished earnings releases (including arbitrary
    // vendor filenames). The SGML bytes preserve all exhibits and custom XBRL.
    const submissionUrl = `${prefix}${filing.accession}.txt`
    const submissionBytes = await client.request(submissionUrl, false)
    const complete = await archive.putDocument({ issuerId: issuer, accession: filing.accession, form: 'complete-submission',
      publicAt: document.publicAt, firstSeenAt: now(), url: submissionUrl, mediaType: 'text/plain', amendment: document.amendment, bytes: submissionBytes })
    result.documents.push(complete)
    for (const match of submissionBytes.toString('utf8').matchAll(/<DOCUMENT>([\s\S]*?)<\/DOCUMENT>/gi)) {
      const type = match[1].match(/<TYPE>([^\r\n<]+)/i)?.[1]?.trim()
      const filename = match[1].match(/<FILENAME>([^\r\n<]+)/i)?.[1]?.trim()
      if (!/^EX-99(?:\.|$)/i.test(type || '') || !/^[A-Za-z0-9_.-]+$/.test(filename || '')) continue
      const url = `${prefix}${filename}`
      const releaseBytes = await client.request(url, false)
      result.documents.push(await archive.putDocument({ issuerId: issuer, accession: filing.accession, form: type,
        publicAt: document.publicAt, firstSeenAt: now(), url, mediaType: 'text/html', amendment: document.amendment, bytes: releaseBytes }))
    }
    // Save the complete Company Facts response, then extract only this accession.
    const factsDocument = await archive.putDocument({ issuerId: issuer, accession: filing.accession, form: 'company-facts-snapshot',
      publicAt: factsObservedAt, firstSeenAt: factsObservedAt, url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`, mediaType: 'application/json', bytes: JSON.stringify(facts) })
    const currentFacts = factEntries(facts, filing).map((fact) => ({ ...fact, snapshotId: factsDocument.id }))
    const extractionCompletedAt = now()
    const factRecord = { issuerId: issuer, accession: filing.accession, documentId: document.id, snapshotId: factsDocument.id,
      publicAt: document.publicAt, firstSeenAt: document.firstSeenAt, extractionCompletedAt, availableAt: extractionCompletedAt, facts: currentFacts }
    await archive.put('facts', digest([filing.accession, factsDocument.sha256]), factRecord, `facts:${issuer}`, extractionCompletedAt)
    const priorRecords = await archive.list(`facts:${issuer}`, extractionCompletedAt)
    const historicFacts = priorRecords.flatMap((r) => r.facts)
    // Features need the surrounding quarters to compute growth and
    // acceleration; observedFacts stays scoped to what this filing reported.
    const allQuarters = comparableQuarterlyFacts(historicFacts, filing.publicAt)
    const quarters = allQuarters.filter((f) => f.accession === filing.accession)
    // A filing that reported no quarterly facts of its own must not be
    // described using an older quarter's numbers.
    const fundamentals = quarters.length
      ? computeFundamentalFeatures({ quarterly: allQuarters, instant: comparableInstantFacts(historicFacts, filing.publicAt) })
      : { features: [], contamination: [], periodEnd: null, priorPeriodEnd: null }
    const improvement = summarizeImprovement(fundamentals)
    const excerpt = plain(bytes).slice(0, 1500) || `SEC ${filing.form} disclosure ${filing.accession}`
    const families = filing.form.startsWith('4') ? ['insider'] : filing.form.startsWith('8-K') ? ['fundamentals'] : ['filing_changes', ...(quarters.length ? ['fundamentals'] : [])]
    for (const security of securities) for (const family of families) {
      const evidence = createEvidence({ security, strategyFamily: family,
        source: { documentId: document.id, accession: filing.accession, url: primaryUrl, excerpt, factSnapshotId: factsDocument.id, completeSubmissionId: complete.id, exhibitIds: result.documents.filter((d) => d.accession === filing.accession && /^EX-99/.test(d.form)).map((d) => d.id) },
        publicAt: document.publicAt, firstSeenAt: document.firstSeenAt, extractionCompletedAt,
        observedFacts: family === 'fundamentals' ? quarters.slice(0, 60) : [],
        interpretation: family === 'fundamentals' && improvement
          // Derived from the observed facts, so it lives in interpretation and
          // never in observedFacts. Every feature cites the filings behind it.
          ? { thesis: improvement, adverse: false, needsReview: true,
            features: fundamentals.features, contamination: fundamentals.contamination,
            periodEnd: fundamentals.periodEnd, priorPeriodEnd: fundamentals.priorPeriodEnd }
          : { thesis: 'New primary disclosure available for detailed review; investment implications have not been determined.', adverse: false, needsReview: true },
        measurements: { attention: null },
        priority: family === 'fundamentals' && improvement ? improvementPriority(fundamentals)
          : family === 'fundamentals' && quarters.some((f) => f.priorComparable) ? 40 : 30 })
      result.evidence.push(await archiveEvidence(archive, evidence))
    }
    result.lastCompletedAccession = filing.accession
  }
  return result
}

// The daily filing index supplies issuers without any dependency on mentions.
export function parseDailyIndex(text, master, asOf = Date.now()) {
  const issuers = new Set(master.securities(asOf).map((s) => s.issuerId))
  return text.split(/\r?\n/).flatMap((line) => {
    const [cik, , form, date, path] = line.split('|')
    const issuer = issuerId(cik)
    return issuers.has(issuer) && FORMS.has(form) && /^edgar\/data\/\d+\/[\d-]+\.txt$/.test(path || '') ? [{ issuerId: issuer, form, date, path }] : []
  })
}
