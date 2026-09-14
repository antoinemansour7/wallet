// Report aggregate Redis memory by key family without printing keys or values.
// Run with: node --env-file=.env scripts/audit-upstash-storage.mjs
import { Redis } from '@upstash/redis'

const redis = Redis.fromEnv()
const endpoint = process.env.UPSTASH_REDIS_REST_URL.replace(/\/$/, '')
const headers = {
  Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
  'Content-Type': 'application/json',
}

function familyFor(key) {
  if (/^research:archive:v1:blob:[a-f0-9]{64}$/.test(key)) return 'research:archive:v1:blob:<sha>'
  if (/^research:archive:v1:blob:[a-f0-9]{64}:\d+$/.test(key)) return 'research:archive:v1:blob:<sha>:chunk'
  const parts = key.split(':')
  // Only emit a short namespace, never user-controlled cache-key payloads.
  return `${parts.slice(0, 2).join(':')}${parts.length > 2 ? ':<id>' : ''}`
}

async function memoryUsage(keys) {
  const response = await fetch(`${endpoint}/pipeline`, {
    method: 'POST',
    headers,
    body: JSON.stringify(keys.map((key) => ['MEMORY', 'USAGE', key])),
  })
  if (!response.ok) throw new Error(`Upstash pipeline failed (${response.status})`)
  const results = await response.json()
  return results.map(({ result, error }, index) => {
    if (error) throw new Error(`MEMORY USAGE failed at batch item ${index}: ${error}`)
    return Number(result || 0)
  })
}

let cursor = '0'
const totals = new Map()
do {
  const [nextCursor, keys] = await redis.scan(cursor, { count: 500 })
  cursor = String(nextCursor)
  const sizes = await memoryUsage(keys)
  keys.forEach((key, index) => {
    const family = familyFor(key)
    const current = totals.get(family) || { keys: 0, bytes: 0 }
    current.keys += 1
    current.bytes += sizes[index]
    totals.set(family, current)
  })
} while (cursor !== '0')

const families = [...totals]
  .map(([family, values]) => ({ family, ...values }))
  .sort((a, b) => b.bytes - a.bytes)
const bytes = families.reduce((sum, family) => sum + family.bytes, 0)

console.log(JSON.stringify({ keys: families.reduce((sum, family) => sum + family.keys, 0), bytes, mebibytes: Number((bytes / 1024 / 1024).toFixed(2)), families }, null, 2))
