export const EXTERNAL_RECORD_KINDS = new Set([
  'evaluation-job-input',
  'evaluation-input',
  'evaluation-run',
  'admission',
  'facts',
  'evidence',
  'options-reference',
  'options-scan',
  'options-evidence',
  'options-chain',
  'options-decision',
  'options-score',
  'options-scenario',
  'options-outcome',
  'options-observation',
  'options-coverage',
  'options-policy',
  'options-diagnostic',
])

export const IMMUTABLE_BATCH_KINDS = new Set(
  [...EXTERNAL_RECORD_KINDS].filter((kind) => kind.startsWith('options-')),
)

const escapedKinds = [...EXTERNAL_RECORD_KINDS].map((kind) => kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
const externalRecordPattern = new RegExp(`^research/records/v1/(${escapedKinds})/[a-f0-9]{64}\\.json\\.gz$`)

export function isExternalRecordKey(key) {
  return externalRecordPattern.test(key)
}
