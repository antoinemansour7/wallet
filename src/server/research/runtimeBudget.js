const DEFAULT_MAX_DURATION_MS = 300_000
const DEFAULT_FINISH_RESERVE_MS = 25_000

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

export class CronBudgetExceededError extends Error {
  constructor(label, availableMs) {
    super(`${label} exceeded the cron time budget (${Math.max(0, availableMs)}ms available)`)
    this.name = 'CronBudgetExceededError'
    this.code = 'CRON_TIME_BUDGET_EXCEEDED'
  }
}

/**
 * Keeps work inside Vercel's hard function timeout while reserving enough time
 * to persist a result, write the run summary and release distributed locks.
 */
export function createCronBudget({
  startedAt = Date.now(),
  maxDurationMs = positiveInteger(process.env.RESEARCH_CRON_MAX_DURATION_MS, DEFAULT_MAX_DURATION_MS),
  finishReserveMs = positiveInteger(process.env.RESEARCH_CRON_FINISH_RESERVE_MS, DEFAULT_FINISH_RESERVE_MS),
  now = Date.now,
} = {}) {
  const hardDeadlineAt = startedAt + maxDurationMs
  const workDeadlineAt = hardDeadlineAt - Math.min(finishReserveMs, Math.floor(maxDurationMs / 2))
  const availableMs = () => Math.max(0, workDeadlineAt - now())

  return Object.freeze({
    startedAt,
    hardDeadlineAt,
    workDeadlineAt,
    availableMs,
    elapsedMs: () => Math.max(0, now() - startedAt),
    canStart: (minimumMs = 0) => availableMs() >= minimumMs,
  })
}

/** Run a promise only until the budget's work deadline. */
export async function withinCronBudget(budget, label, work) {
  const available = budget.availableMs()
  if (available <= 0) throw new CronBudgetExceededError(label, available)

  const controller = new AbortController()
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new CronBudgetExceededError(label, 0)
      controller.abort(error)
      reject(error)
    }, available)
    timer.unref?.()
  })

  try {
    return await Promise.race([Promise.resolve().then(() => work(controller.signal, available)), timeout])
  } finally {
    clearTimeout(timer)
  }
}
