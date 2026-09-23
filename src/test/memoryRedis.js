// In-memory stand-ins for the Upstash client and R2 object store, covering the
// commands the options archive, scheduler and forward capture use.
export function memoryRedis(clock = () => Date.now()) {
  const values = new Map(), expirations = new Map(), hashes = new Map(), indexes = new Map()
  const calls = {}
  const count = (name) => { calls[name] = (calls[name] || 0) + 1 }
  const live = (key) => {
    if (expirations.has(key) && expirations.get(key) <= clock()) { values.delete(key); hashes.delete(key); expirations.delete(key) }
    return values.has(key) || hashes.has(key)
  }
  return {
    values, hashes, indexes, calls,
    async get(key) { count('get'); return live(key) ? structuredClone(values.get(key) ?? null) : null },
    async mget(...keys) { count('mget'); return keys.flat().map((key) => (live(key) ? structuredClone(values.get(key) ?? null) : null)) },
    async set(key, value, options = {}) {
      count('set')
      if (options.nx && live(key)) return null
      values.set(key, structuredClone(value))
      if (options.ex) expirations.set(key, clock() + Number(options.ex) * 1000)
      else expirations.delete(key)
      return 'OK'
    },
    async del(...keys) { count('del'); let removed = 0; for (const key of keys.flat()) { if (values.delete(key) || hashes.delete(key)) removed++; expirations.delete(key) } return removed },
    async expire(key, ttl) { count('expire'); if (!live(key)) return 0; expirations.set(key, clock() + Number(ttl) * 1000); return 1 },
    async incr(key) { count('incr'); const value = Number(values.get(key) || 0) + 1; values.set(key, value); return value },
    async hset(key, fields) {
      count('hset')
      if (!live(key)) hashes.set(key, new Map())
      const hash = hashes.get(key)
      let added = 0
      for (const [field, value] of Object.entries(fields)) { if (!hash.has(field)) added++; hash.set(field, structuredClone(value)) }
      return added
    },
    async hget(key, field) { count('hget'); return live(key) ? structuredClone(hashes.get(key)?.get(String(field)) ?? null) : null },
    async zadd(key, { score, member }) { count('zadd'); if (!indexes.has(key)) indexes.set(key, new Map()); indexes.get(key).set(member, score); return 1 },
    async zrange(key, min, max, { offset = 0, count: size = Infinity } = {}) {
      count('zrange')
      const low = min === '-inf' ? -Infinity : Number(min), high = max === '+inf' ? Infinity : Number(max)
      return [...(indexes.get(key) || new Map())].filter(([, score]) => score >= low && score <= high)
        .sort((a, b) => a[1] - b[1] || String(a[0]).localeCompare(String(b[0]))).slice(offset, offset + size).map(([member]) => member)
    },
  }
}

export function memoryObjectStore() {
  const objects = new Map()
  return {
    objects,
    async putIfAbsent(key, bytes) { if (!objects.has(key)) objects.set(key, Buffer.from(bytes)) },
    async get(key) { const value = objects.get(key); if (!value) throw new Error('missing object'); return value },
  }
}
