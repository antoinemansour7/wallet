export async function evaluationOutcomeRecords(archive, now, { acceptedOnly = false } = {}) {
  const indexed = acceptedOnly && await archive.get('evaluation-index', 'accepted-outcomes-v1')
  return archive.list(indexed ? 'evaluation-accepted-outcomes' : 'evaluation-outcomes', now)
}
