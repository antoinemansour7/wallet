// Small in-memory implementation of the archive's Redis contract for integration tests.
export function evaluationTestStore() {
  const values = new Map(), indexes = new Map(), writes = []
  return { values, writes,
    async get(key) { return structuredClone(values.get(key) ?? null) },
    async set(key, value, options = {}) {
      writes.push(key)
      if (options.nx && values.has(key)) return null
      values.set(key, structuredClone(value)); return 'OK'
    },
    async zadd(key, { score, member }) {
      if (!indexes.has(key)) indexes.set(key, new Map())
      indexes.get(key).set(member, score)
    },
    async zrange(key, start, end, options = {}) {
      const bound = (v) => v === '-inf' ? -Infinity : v === '+inf' ? Infinity : Number(v)
      const rows = [...(indexes.get(key) || [])].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
      const [min, max] = options.rev ? [bound(end), bound(start)] : [bound(start), bound(end)]
      const selected = options.byScore ? rows.filter(([, score]) => min <= score && score <= max) : rows.slice(start, end + 1)
      if (options.rev) selected.reverse()
      return selected.slice(options.offset || 0, (options.offset || 0) + (options.count ?? selected.length)).map(([key]) => key)
    },
  }
}
