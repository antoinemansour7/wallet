// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { EXTERNAL_RECORD_KINDS, IMMUTABLE_BATCH_KINDS, isExternalRecordKey } from './archiveKinds.js'

describe('external research archive kinds', () => {
  it('accepts every configured kind with a content-addressed object key', () => {
    for (const kind of EXTERNAL_RECORD_KINDS) {
      expect(isExternalRecordKey(`research/records/v1/${kind}/${'a'.repeat(64)}.json.gz`)).toBe(true)
    }
  })

  it('rejects unconfigured kinds, traversal and malformed digests', () => {
    expect(isExternalRecordKey(`research/records/v1/options-unknown/${'a'.repeat(64)}.json.gz`)).toBe(false)
    expect(isExternalRecordKey(`research/records/v1/options-chain/../${'a'.repeat(64)}.json.gz`)).toBe(false)
    expect(isExternalRecordKey('research/records/v1/options-chain/not-a-digest.json.gz')).toBe(false)
  })

  it('limits strict immutable-ID collisions to options batches', () => {
    expect(IMMUTABLE_BATCH_KINDS.has('options-chain')).toBe(true)
    expect(IMMUTABLE_BATCH_KINDS.has('evidence')).toBe(false)
  })
})
