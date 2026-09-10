// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createCronBudget, CronBudgetExceededError, withinCronBudget } from './runtimeBudget.js'

describe('research cron runtime budget', () => {
  it('reserves finishing time before Vercel hard-stops the invocation', () => {
    let now = 1_000
    const budget = createCronBudget({ startedAt: now, maxDurationMs: 300_000, finishReserveMs: 25_000, now: () => now })

    now += 230_000
    expect(budget.availableMs()).toBe(45_000)
    expect(budget.canStart(45_000)).toBe(true)
    expect(budget.canStart(45_001)).toBe(false)
  })

  it('aborts work at the work deadline instead of waiting for the platform 504', async () => {
    vi.useFakeTimers()
    let now = 0
    const budget = createCronBudget({ startedAt: 0, maxDurationMs: 100, finishReserveMs: 25, now: () => now })
    const running = withinCronBudget(budget, 'slow stage', (signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason))
    }))
    const rejected = expect(running).rejects.toBeInstanceOf(CronBudgetExceededError)

    now = 75
    await vi.advanceTimersByTimeAsync(75)
    await rejected
    vi.useRealTimers()
  })
})
