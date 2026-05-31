import crypto from 'crypto'
import { Redis } from '@upstash/redis'
import { handleSlackMessage } from '../src/server/agents/slackAgent.js'

function getRedis() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return Redis.fromEnv()
  }
  return null
}

function verifySlackRequest(req) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET
  if (!signingSecret) return false

  const timestamp = req.headers['x-slack-request-timestamp']
  const slackSig = req.headers['x-slack-signature']
  if (!timestamp || !slackSig) return false

  // Reject requests older than 5 minutes
  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - Number(timestamp)) > 300) return false

  const rawBody = JSON.stringify(req.body)
  const sigBase = `v0:${timestamp}:${rawBody}`
  const mySignature = 'v0=' + crypto.createHmac('sha256', signingSecret).update(sigBase).digest('hex')

  return crypto.timingSafeEqual(Buffer.from(mySignature), Buffer.from(slackSig))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Slack URL verification challenge
  if (req.body?.type === 'url_verification') {
    return res.status(200).json({ challenge: req.body.challenge })
  }

  // Verify request signature
  if (!verifySlackRequest(req)) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  const event = req.body?.event
  if (!event || event.type !== 'app_mention' && event.type !== 'message') {
    return res.status(200).json({ ok: true })
  }

  // Ignore bot messages to prevent loops
  if (event.bot_id || event.subtype === 'bot_message') {
    return res.status(200).json({ ok: true })
  }

  // Only respond to DMs or @mentions
  const isDM = event.channel_type === 'im'
  const isMention = event.type === 'app_mention'
  if (!isDM && !isMention) {
    return res.status(200).json({ ok: true })
  }

  const userText = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim()
  if (!userText) {
    return res.status(200).json({ ok: true })
  }

  // Deduplicate: Slack retries if we don't respond in 3s.
  // Use Redis to track processed event IDs.
  const redis = getRedis()
  const eventId = event.client_msg_id || event.event_ts || `${event.channel}:${event.ts}`
  if (redis) {
    const dedupKey = `slack:dedup:${eventId}`
    const already = await redis.get(dedupKey)
    if (already) {
      return res.status(200).json({ ok: true, dedup: true })
    }
    await redis.set(dedupKey, '1', { ex: 60 }) // expire after 60s
  }

  // Load context for the agent
  let picks = []
  let history = []

  if (redis) {
    try {
      const research = await redis.get('research:latest')
      if (research) picks = research.picks || []
    } catch (err) {
      console.error('[slack-events] failed to load picks:', err.message)
    }

    try {
      const historyIndex = await redis.lrange('research:history-index', 0, 4)
      if (historyIndex?.length > 0) {
        const entries = await Promise.all(
          historyIndex.map((key) => redis.get(`research:history:${key}`))
        )
        history = entries.filter(Boolean)
      }
    } catch (err) {
      console.error('[slack-events] failed to load history:', err.message)
    }
  }

  // Run the conversational agent
  const reply = await handleSlackMessage(userText, { picks, history })

  // Post reply back to Slack
  const token = process.env.SLACK_BOT_TOKEN
  if (token) {
    const { WebClient } = await import('@slack/web-api')
    const slack = new WebClient(token)
    await slack.chat.postMessage({
      channel: event.channel,
      text: reply,
      thread_ts: event.thread_ts || event.ts,
    })
  }

  return res.status(200).json({ ok: true })
}
