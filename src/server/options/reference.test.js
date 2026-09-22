// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { archiveOptionsReference, createOptionsReferenceSnapshot, replayOptionsReference } from './reference.js'

describe('options reference replay', () => {
  it('archives an immutable identity/calendar bundle and replays the latest available snapshot', async () => {
    const records = []
    const archive = {
      async put(kind, id, record, index, availableAt) { records.push({ kind, id, record, index, availableAt }) },
      async latest(index, asOf) {
        return records.filter((item) => item.index === index && Date.parse(item.availableAt) <= new Date(asOf).getTime()).at(-1)?.record ?? null
      },
    }
    const snapshot = createOptionsReferenceSnapshot({ availableAt: '2026-09-22T13:00:00.000Z' })
    await archiveOptionsReference(archive, snapshot)
    expect(records[0]).toMatchObject({ kind: 'options-reference', id: snapshot.referenceId, index: 'options-references' })
    expect(await replayOptionsReference(archive, '2026-09-22T12:59:59.999Z')).toBeNull()
    expect(await replayOptionsReference(archive, '2026-09-22T13:00:00.000Z')).toEqual(snapshot)
  })
})
