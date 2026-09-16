// ─── Fundamentals discovery features (#107) ───────────────────────────────────
//
// Turns the comparable quarterly facts that ingestIssuer already archives into
// a small set of named, inspectable features, so a company can enter review
// because its economics changed rather than because someone posted about it.
//
// Three rules run through this file.
//
// 1. Every feature carries the facts it came from — concept, both period ends,
//    both accessions, and how the quarter was derived. A reviewer can check any
//    number against the filing without re-deriving it.
// 2. Nothing here is called a "beat". A beat requires an identifiable prior
//    expectation, and this pipeline has no consensus estimates. Every
//    comparison is against the company's own prior comparable period, and
//    `describeChange` is the only place allowed to phrase it.
// 3. Contamination is separated, never silently folded in. An acquisition, a
//    one-off gain, a tax swing or a weak year-ago quarter each get a flag with
//    their own supporting fact, so improvement that is not operating is visible
//    rather than scored.

const CONCEPT = {
  revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax',
    'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet'],
  operatingIncome: ['OperatingIncomeLoss'],
  grossProfit: ['GrossProfit'],
  netIncome: ['NetIncomeLoss'],
  operatingCashFlow: ['NetCashProvidedByUsedInOperatingActivities'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment'],
  dilutedShares: ['WeightedAverageNumberOfDilutedSharesOutstanding'],
  incomeTax: ['IncomeTaxExpenseBenefit'],
  pretaxIncome: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
    'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'],
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  debt: ['LongTermDebtNoncurrent', 'LongTermDebt', 'LongTermDebtCurrent', 'DebtCurrent'],
}

// Facts whose presence means a change in the headline numbers may not be
// operating. Each maps to the contamination it evidences.
const CONTAMINANT = {
  acquisition: ['BusinessCombinationConsiderationTransferred1', 'PaymentsToAcquireBusinessesNetOfCashAcquired',
    'BusinessCombinationRecognizedIdentifiableAssetsAcquiredAndLiabilitiesAssumedNet'],
  oneOff: ['GainLossOnSaleOfBusiness', 'GainLossOnDispositionOfAssets', 'GoodwillImpairmentLoss',
    'AssetImpairmentCharges', 'RestructuringCharges', 'GainLossOnExtinguishmentOfDebt'],
}

const day = 86400000
// Profit-to-cash conversion becomes unstable around break-even. Require both
// periods to earn at least a one-percent operating margin before dividing by
// operating income; otherwise compare operating cash flow against revenue.
const MIN_CASH_CONVERSION_OPERATING_MARGIN = 0.01
const bare = (concept) => String(concept || '').split(':')[1] || ''
const isUsGaap = (fact) => String(fact?.concept || '').startsWith('us-gaap:')
const finite = (value) => Number.isFinite(value)

/** Cite a fact the way every feature reports its inputs. */
function cite(fact) {
  if (!fact) return null
  return {
    concept: fact.concept,
    value: fact.value,
    units: fact.units,
    periodEnd: fact.periodEnd,
    ...(fact.periodStart ? { periodStart: fact.periodStart } : {}),
    accession: fact.accession,
    ...(fact.derivation ? { derivation: fact.derivation } : {}),
  }
}

/**
 * Pick one fact per role. A filer may tag revenue under several concepts in the
 * same quarter; preferring the earlier entry in CONCEPT keeps the choice
 * deterministic rather than dependent on archive ordering, and the chosen
 * concept is cited so the pick is auditable.
 */
function selectFact(facts, names, periodEnd) {
  for (const name of names) {
    const match = facts.find((f) => isUsGaap(f) && bare(f.concept) === name
      && (periodEnd == null || f.periodEnd === periodEnd))
    if (match) return match
  }
  return null
}

/**
 * Balance-sheet facts carry a single instant rather than a period, so
 * comparableQuarterlyFacts skips them by design. Debt and cash change need
 * them, so pair each instant fact with the closest earlier one about a year
 * back, under the same point-in-time rule: both must have been public by asOf.
 */
export function comparableInstantFacts(facts, asOf) {
  const allowed = facts.filter((f) => !f.periodStart && finite(f.value) && f.periodEnd
    && Date.parse(f.publicAt) <= Date.parse(asOf))
  return allowed.map((fact) => {
    const matches = allowed
      .filter((prior) => prior.concept === fact.concept && prior.units === fact.units
        && prior.periodEnd < fact.periodEnd
        && Date.parse(prior.publicAt) <= Date.parse(fact.publicAt)
        && Math.abs((Date.parse(fact.periodEnd) - Date.parse(prior.periodEnd)) / day - 365) <= 21)
      .sort((a, b) => Date.parse(b.publicAt) - Date.parse(a.publicAt))
    return { ...fact, derivation: 'instant', priorComparable: matches[0] ? cite(matches[0]) : null }
  })
}

/** A ratio change reported as a feature, with both sides cited. */
function ratioFeature(name, current, prior, { units = 'ratio' } = {}) {
  if (!finite(current?.value) || !finite(prior?.value) || prior.value === 0) return null
  const change = (current.value - prior.value) / Math.abs(prior.value)
  return {
    name,
    value: Number(change.toFixed(6)),
    units,
    direction: change > 0 ? 'improved' : change < 0 ? 'declined' : 'unchanged',
    current: cite(current),
    prior: cite(prior),
  }
}

/** A margin is only comparable when both quarters supply both of its inputs. */
function marginFeature(name, numeratorNames, denominatorNames, current, prior) {
  const currentNumerator = selectFact(current, numeratorNames)
  const currentDenominator = selectFact(current, denominatorNames)
  const priorNumerator = selectFact(prior, numeratorNames)
  const priorDenominator = selectFact(prior, denominatorNames)
  if (![currentNumerator, currentDenominator, priorNumerator, priorDenominator].every((f) => finite(f?.value))) return null
  if (currentDenominator.value === 0 || priorDenominator.value === 0) return null
  const currentMargin = currentNumerator.value / currentDenominator.value
  const priorMargin = priorNumerator.value / priorDenominator.value
  return {
    name,
    // Margins are already ratios, so report the change in percentage points.
    value: Number((currentMargin - priorMargin).toFixed(6)),
    units: 'percentage_points',
    direction: currentMargin > priorMargin ? 'improved' : currentMargin < priorMargin ? 'declined' : 'unchanged',
    currentMargin: Number(currentMargin.toFixed(6)),
    priorMargin: Number(priorMargin.toFixed(6)),
    current: [cite(currentNumerator), cite(currentDenominator)],
    prior: [cite(priorNumerator), cite(priorDenominator)],
  }
}

/**
 * Use profit-to-cash conversion only when operating profit is a meaningful,
 * positive denominator in both periods. Losses and near-break-even periods use
 * operating cash-flow margin, so worsening cash burn always moves downward.
 */
function operatingCashFlowFeature(current, prior) {
  const currentRevenue = selectFact(current, CONCEPT.revenue)
  const priorRevenue = selectFact(prior, CONCEPT.revenue)
  const currentIncome = selectFact(current, CONCEPT.operatingIncome)
  const priorIncome = selectFact(prior, CONCEPT.operatingIncome)
  const revenuesArePositive = currentRevenue?.value > 0 && priorRevenue?.value > 0
  const profitsAreMeaningful = revenuesArePositive
    && currentIncome?.value / currentRevenue.value >= MIN_CASH_CONVERSION_OPERATING_MARGIN
    && priorIncome?.value / priorRevenue.value >= MIN_CASH_CONVERSION_OPERATING_MARGIN

  if (profitsAreMeaningful) {
    const conversion = marginFeature('cashConversionChange', CONCEPT.operatingCashFlow, CONCEPT.operatingIncome, current, prior)
    return conversion ? { ...conversion, metric: 'operating_cash_flow_to_operating_income' } : null
  }
  if (!revenuesArePositive) return null
  const cashFlowMargin = marginFeature('operatingCashFlowMarginChange', CONCEPT.operatingCashFlow, CONCEPT.revenue, current, prior)
  return cashFlowMargin ? { ...cashFlowMargin, metric: 'operating_cash_flow_margin' } : null
}

/**
 * Group facts by the quarter they describe, newest first, so features can talk
 * about "this quarter" and "the year-ago quarter" without re-deriving periods.
 */
function quartersByPeriod(quarterly) {
  const byPeriod = new Map()
  for (const fact of quarterly) {
    if (!byPeriod.has(fact.periodEnd)) byPeriod.set(fact.periodEnd, [])
    byPeriod.get(fact.periodEnd).push(fact)
  }
  return [...byPeriod.entries()]
    .sort((a, b) => Date.parse(b[0]) - Date.parse(a[0]))
    .map(([periodEnd, facts]) => ({ periodEnd, facts }))
}

/** The quarter roughly a year before `periodEnd`, if it is in the set. */
function yearAgo(quarters, periodEnd) {
  return quarters.find((q) => Math.abs((Date.parse(periodEnd) - Date.parse(q.periodEnd)) / day - 365) <= 21) || null
}

/**
 * Contamination checks. Each returns a flag with the fact that evidences it, so
 * a reviewer sees why growth was called possibly inorganic instead of trusting
 * the label. These never subtract from a feature; separation is the point.
 */
function contaminationFlags(currentFacts, currentQuarter, priorQuarter, quarters) {
  const flags = []

  for (const [kind, names] of Object.entries(CONTAMINANT)) {
    for (const name of names) {
      const fact = currentFacts.find((f) => isUsGaap(f) && bare(f.concept) === name && finite(f.value) && f.value !== 0)
      if (fact) {
        flags.push({
          kind,
          reason: kind === 'acquisition'
            ? 'The period includes business-combination activity, so revenue growth may be inorganic.'
            : 'The period includes a non-recurring gain, impairment or restructuring charge.',
          fact: cite(fact),
        })
        break
      }
    }
  }

  // A tax swing moves net income without any operating change. Compare the
  // effective rate, not the tax line, so a bigger company does not look worse.
  const effectiveRate = (facts) => {
    const tax = selectFact(facts, CONCEPT.incomeTax)
    const pretax = selectFact(facts, CONCEPT.pretaxIncome)
    if (!finite(tax?.value) || !finite(pretax?.value) || pretax.value === 0) return null
    return { rate: tax.value / pretax.value, tax, pretax }
  }
  const currentRate = effectiveRate(currentFacts)
  const priorRate = priorQuarter ? effectiveRate(priorQuarter.facts) : null
  if (currentRate && priorRate && Math.abs(currentRate.rate - priorRate.rate) >= 0.05) {
    flags.push({
      kind: 'tax',
      reason: 'The effective tax rate moved by at least five percentage points, so net income is not comparable on operations alone.',
      fact: cite(currentRate.tax),
      currentRate: Number(currentRate.rate.toFixed(4)),
      priorRate: Number(priorRate.rate.toFixed(4)),
    })
  }

  // An easy comparison: the year-ago quarter was itself well below the median
  // of the quarters preceding it, so growth measures the old weakness.
  if (priorQuarter) {
    const priorRevenue = selectFact(priorQuarter.facts, CONCEPT.revenue)
    const older = quarters
      .filter((q) => Date.parse(q.periodEnd) < Date.parse(priorQuarter.periodEnd))
      .map((q) => selectFact(q.facts, CONCEPT.revenue)?.value)
      .filter(finite)
    if (finite(priorRevenue?.value) && older.length >= 2) {
      const sorted = [...older].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      if (median > 0 && priorRevenue.value < median * 0.9) {
        flags.push({
          kind: 'easy_comparison',
          reason: 'The year-ago quarter was more than ten percent below the median of the quarters before it, so the comparison base is weak.',
          fact: cite(priorRevenue),
          medianOfEarlierQuarters: Number(median.toFixed(2)),
        })
      }
    }
  }

  return flags
}

/**
 * Compute the named features for the most recent quarter present in `quarterly`.
 *
 * `quarterly` is the output of comparableQuarterlyFacts and `instant` the
 * output of comparableInstantFacts. Both are already point-in-time filtered by
 * their producers; nothing here reaches for a later restatement.
 */
export function computeFundamentalFeatures({ quarterly = [], instant = [] } = {}) {
  const quarters = quartersByPeriod(quarterly)
  const current = quarters[0]
  if (!current) return { features: [], contamination: [], periodEnd: null, priorPeriodEnd: null }

  const prior = yearAgo(quarters.slice(1), current.periodEnd)
  const features = []

  // Revenue growth, and whether that growth is accelerating. Acceleration needs
  // the prior quarter's own year-over-year rate, so it stays absent rather than
  // guessed when four comparable quarters are not on file.
  const currentRevenue = selectFact(current.facts, CONCEPT.revenue)
  const priorRevenue = prior ? selectFact(prior.facts, CONCEPT.revenue) : null
  const revenueGrowth = ratioFeature('revenueGrowth', currentRevenue, priorRevenue)
  if (revenueGrowth) {
    features.push(revenueGrowth)
    const previousQuarter = quarters[1]
    const previousYearAgo = previousQuarter ? yearAgo(quarters.slice(2), previousQuarter.periodEnd) : null
    const previousGrowth = previousQuarter && previousYearAgo
      ? ratioFeature('revenueGrowth', selectFact(previousQuarter.facts, CONCEPT.revenue), selectFact(previousYearAgo.facts, CONCEPT.revenue))
      : null
    if (previousGrowth) {
      features.push({
        name: 'revenueGrowthAcceleration',
        value: Number((revenueGrowth.value - previousGrowth.value).toFixed(6)),
        units: 'ratio_change',
        direction: revenueGrowth.value > previousGrowth.value ? 'improved'
          : revenueGrowth.value < previousGrowth.value ? 'declined' : 'unchanged',
        currentGrowth: revenueGrowth.value,
        priorGrowth: previousGrowth.value,
        current: revenueGrowth.current,
        prior: previousGrowth.current,
      })
    }
  }

  const operatingMargin = prior && marginFeature('operatingMarginChange', CONCEPT.operatingIncome, CONCEPT.revenue, current.facts, prior.facts)
  if (operatingMargin) features.push(operatingMargin)

  // Profit-to-cash conversion is valid only with meaningful positive profit.
  // Loss-making and near-break-even periods use cash flow divided by revenue.
  const operatingCashFlow = prior && operatingCashFlowFeature(current.facts, prior.facts)
  if (operatingCashFlow) features.push(operatingCashFlow)

  // Dilution. Shares are not additive, so only quarters the filer reported
  // directly can appear here; a year-to-date share count is never differenced.
  const currentShares = selectFact(current.facts.filter((f) => f.derivation === 'reported_quarter'), CONCEPT.dilutedShares)
  const priorShares = prior ? selectFact(prior.facts.filter((f) => f.derivation === 'reported_quarter'), CONCEPT.dilutedShares) : null
  const dilution = ratioFeature('dilutedShareGrowth', currentShares, priorShares)
  // Fewer shares is the shareholder-friendly direction, so invert the label.
  if (dilution) features.push({ ...dilution, direction: dilution.value < 0 ? 'improved' : dilution.value > 0 ? 'declined' : 'unchanged' })

  // Net debt, from the balance sheet rather than the income statement.
  const instantAt = (names) => {
    const fact = selectFact(instant, names)
    return fact?.priorComparable ? { current: fact, prior: fact.priorComparable } : null
  }
  const cashPair = instantAt(CONCEPT.cash)
  const debtPair = instantAt(CONCEPT.debt)
  if (cashPair || debtPair) {
    const currentNet = (debtPair?.current.value ?? 0) - (cashPair?.current.value ?? 0)
    const priorNet = (debtPair?.prior.value ?? 0) - (cashPair?.prior.value ?? 0)
    if (finite(currentNet) && finite(priorNet) && priorNet !== 0) {
      const change = (currentNet - priorNet) / Math.abs(priorNet)
      features.push({
        name: 'netDebtChange',
        value: Number(change.toFixed(6)),
        units: 'ratio',
        // Less net debt is the improvement.
        direction: change < 0 ? 'improved' : change > 0 ? 'declined' : 'unchanged',
        currentNetDebt: Number(currentNet.toFixed(2)),
        priorNetDebt: Number(priorNet.toFixed(2)),
        current: [cashPair?.current, debtPair?.current].filter(Boolean).map(cite),
        prior: [cashPair?.prior, debtPair?.prior].filter(Boolean),
      })
    }
  }

  return {
    periodEnd: current.periodEnd,
    priorPeriodEnd: prior?.periodEnd || null,
    features,
    contamination: contaminationFlags(current.facts, current, prior, quarters.slice(1)),
  }
}

/**
 * The only place allowed to phrase a comparison.
 *
 * The issue is explicit: a "beat" means performance exceeded an identifiable
 * prior expectation, and this pipeline has no consensus estimates. So every
 * sentence here names the prior comparable period instead. `expectation` exists
 * so that a future point-in-time consensus source can unlock beat language by
 * supplying one — it is not a switch to flip without that data.
 */
export function describeChange(feature, { expectation = null } = {}) {
  if (!feature) return ''
  const pct = (value) => `${(value * 100).toFixed(1)}%`
  const points = (value) => `${(value * 100).toFixed(1)} percentage points`
  const measure = {
    revenueGrowth: 'Revenue',
    revenueGrowthAcceleration: 'Revenue growth',
    operatingMarginChange: 'Operating margin',
    cashConversionChange: 'Operating cash flow to operating income',
    operatingCashFlowMarginChange: 'Operating cash-flow margin',
    dilutedShareGrowth: 'Diluted share count',
    netDebtChange: 'Net debt',
  }[feature.name] || feature.name

  if (expectation) {
    const verb = feature.value > 0 ? 'exceeded' : 'fell short of'
    return `${measure} ${verb} the ${expectation.source} expectation of ${expectation.value} for the period ending ${feature.current?.periodEnd || ''}.`.trim()
  }

  const amount = feature.units === 'percentage_points' ? points(Math.abs(feature.value))
    : feature.units === 'ratio_change' ? `${points(Math.abs(feature.value))} of growth`
      : pct(Math.abs(feature.value))
  const verb = feature.direction === 'improved' ? 'improved by' : feature.direction === 'declined' ? 'declined by' : 'was unchanged at'
  const periodEnd = Array.isArray(feature.current) ? feature.current[0]?.periodEnd : feature.current?.periodEnd
  const priorEnd = Array.isArray(feature.prior) ? feature.prior[0]?.periodEnd : feature.prior?.periodEnd
  return `${measure} ${verb} ${amount} versus the previous comparable period`
    + `${priorEnd ? ` ending ${priorEnd}` : ''}${periodEnd ? `, for the quarter ending ${periodEnd}` : ''}.`
}

/**
 * Rank a candidate for the fundamentals review budget.
 *
 * This orders which improvements get a review slot. It is not a probability of
 * profit and must not be read as one. Contamination lowers priority rather than
 * excluding the candidate, because a contaminated improvement is still worth a
 * reviewer's attention — it just should not outrank a clean one.
 */
export function improvementPriority({ features = [], contamination = [] } = {}) {
  if (features.length === 0) return 0
  const weight = {
    revenueGrowth: 14,
    revenueGrowthAcceleration: 20,
    operatingMarginChange: 18,
    cashConversionChange: 16,
    operatingCashFlowMarginChange: 16,
    dilutedShareGrowth: 8,
    netDebtChange: 10,
  }
  let score = 20 // a comparable quarter exists at all
  for (const feature of features) {
    if (feature.direction === 'improved') score += weight[feature.name] ?? 0
    else if (feature.direction === 'declined') score -= (weight[feature.name] ?? 0) / 2
  }
  score -= contamination.length * 8
  return Math.max(0, Math.min(100, Math.round(score)))
}

/**
 * The thesis written onto the evidence record. Deliberately descriptive: it
 * states what changed against what, lists what could explain it away, and makes
 * no claim about what the stock will do. The reviewer decides that.
 */
export function summarizeImprovement(result) {
  const improved = result.features.filter((f) => f.direction === 'improved')
  if (improved.length === 0) return null
  const sentences = improved.slice(0, 4).map((feature) => describeChange(feature))
  const caveats = result.contamination.map((flag) => flag.reason)
  return [
    sentences.join(' '),
    caveats.length ? `Separated from operating improvement: ${caveats.join(' ')}` : '',
    'Comparisons are against the company\'s own prior comparable period, not an analyst expectation.',
  ].filter(Boolean).join(' ')
}
