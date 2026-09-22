import { digest } from '../research/archive.js'
import { OPTIONS_CALENDAR_2026, OPTIONS_ELIGIBILITY_2026_09_22 } from './calendar.js'
import { OPTIONS_WATCHLIST_SNAPSHOT } from './watchlist.js'

export function createOptionsReferenceSnapshot({
  watchlist = OPTIONS_WATCHLIST_SNAPSHOT,
  eligibility = OPTIONS_ELIGIBILITY_2026_09_22,
  calendar = OPTIONS_CALENDAR_2026,
  enumerations = [],
  availableAt = new Date().toISOString(),
} = {}) {
  const record = {
    schemaVersion: 'options-reference-snapshot-v1',
    availableAt,
    watchlist,
    eligibility,
    calendar,
    enumerations,
  }
  return { ...record, referenceId: digest(record) }
}
export async function archiveOptionsReference(archive, input) {
  const snapshot = input?.referenceId ? input : createOptionsReferenceSnapshot(input)
  await archive.put('options-reference', snapshot.referenceId, snapshot, 'options-references', snapshot.availableAt)
  return snapshot
}

export async function replayOptionsReference(archive, asOf = Date.now()) {
  return archive.latest('options-references', asOf)
}
