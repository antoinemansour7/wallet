import { AwsClient } from 'aws4fetch'

// Private R2 Standard bucket. Store gzip as an object format, not HTTP content
// encoding: fetch must return the exact compressed bytes for checksum validation.
export function createObjectStore({
  endpoint = process.env.RESEARCH_R2_ENDPOINT,
  bucket = process.env.RESEARCH_R2_BUCKET,
  accessKeyId = process.env.RESEARCH_R2_ACCESS_KEY_ID,
  secretAccessKey = process.env.RESEARCH_R2_SECRET_ACCESS_KEY,
  fetchImpl = fetch,
} = {}) {
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error('Configure RESEARCH_R2_ENDPOINT, RESEARCH_R2_BUCKET and R2 access credentials for the disclosure archive')
  const base = new URL(endpoint)
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('R2 endpoint must be an HTTPS origin')
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error('Invalid R2 bucket name')
  const signer = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' })
  async function request(key, options = {}) {
    const document = /^research\/documents\/v1\/[a-f0-9]{64}\.gz$/.test(key)
    const record = /^research\/records\/v1\/(facts|evidence)\/[a-f0-9]{64}\.json\.gz$/.test(key)
    if (!document && !record) throw new Error('Invalid archive object key')
    const signed = await signer.sign(`${base.origin}/${bucket}/${key}`, { ...options, signal: AbortSignal.timeout(20000), redirect: 'error' })
    return fetchImpl(signed)
  }
  return {
    async putIfAbsent(key, bytes) {
      const response = await request(key, { method: 'PUT', headers: { 'Content-Type': 'application/gzip', 'If-None-Match': '*' }, body: bytes })
      if (!response.ok && response.status !== 412) throw new Error(`Archive object PUT failed (${response.status})`)
    },
    async get(key) {
      const response = await request(key)
      if (!response.ok) throw new Error(`Archive object GET failed (${response.status})`)
      return Buffer.from(await response.arrayBuffer())
    },
  }
}
