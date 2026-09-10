export function evidenceAdjustment(stats) {
  if (!stats || stats.total < 20 || stats.distinctDates < 10
    || !Number.isFinite(stats.avgNetReturn) || !Number.isFinite(stats.avgExcessReturn)
    || !Number.isFinite(stats.lowerBound) || !Number.isFinite(stats.upperBound)) return 0
  const positiveEvidence = stats.lowerBound > 0 && stats.avgNetReturn > 0
  const negativeEvidence = stats.upperBound < 0
  if (!positiveEvidence && !negativeEvidence) return 0
  const shrunk = stats.avgExcessReturn * stats.total / (stats.total + 40)
  return Number(Math.max(-1, Math.min(1, shrunk)).toFixed(2))
}
