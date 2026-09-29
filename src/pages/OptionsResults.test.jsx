import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { optionsShadowFixture } from '../test/optionsShadowFixture'
import { buildOptionsShadowView } from '../server/options/shadowView'
import { optionsResultsView } from '../server/options/resultsView'
import OptionsResults from './OptionsResults'

const auth = vi.hoisted(() => ({ user: null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))

let early
beforeAll(async () => {
  const { archive } = await optionsShadowFixture()
  // After the +1 close of the 2026-09-22 morning: the call is up, the put is down.
  early = optionsResultsView(await buildOptionsShadowView({ archive, now: () => Date.parse('2026-09-23T21:00:00Z') }))
})

const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
const serve = (results) => fetch.mockImplementation(async (url) => (url.includes('owner=1') ? response({ owner: true }) : response({ results })))
const mount = (path = '/options/results') => render(<MemoryRouter initialEntries={[path]}><Routes>
  <Route path="/options/results" element={<OptionsResults />} />
  <Route path="/options/results/:date" element={<OptionsResults />} />
  <Route path="/portfolio" element={<p>Portfolio destination</p>} />
</Routes></MemoryRouter>)

beforeEach(() => {
  auth.user = { uid: 'owner', getIdToken: vi.fn(async () => 'owner-token') }
  vi.stubGlobal('fetch', vi.fn())
  serve(early)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('options results · list of days', () => {
  it('denies a direct link before reading any options data', async () => {
    fetch.mockResolvedValue(response({ error: 'Owner access required' }, 403))
    mount()
    await screen.findByText('Portfolio destination')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('shows one line per morning: how many picks, how they are doing now, and when day 3 lands', async () => {
    mount()
    const day = await screen.findByRole('link', { name: /Tue Sep 22/ })
    expect(day).toHaveTextContent('2 picks')
    expect(day).toHaveTextContent('Right now 1 up · 1 down')
    expect(day).toHaveTextContent('Day 3 result on Fri Sep 25')
    expect(screen.getByText('Wed Sep 23').closest('li')).toHaveTextContent('No picks that morning')
  })

  it('opens the page for one morning', async () => {
    mount()
    await userEvent.click(await screen.findByRole('link', { name: /Tue Sep 22/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Tue Sep 22 · 2 picks' })).toBeInTheDocument()
  })
})

describe('options results · one morning', () => {
  it('says in one sentence how the morning is doing', async () => {
    mount('/options/results/2026-09-22')
    const summary = await screen.findByRole('region', { name: 'How this morning is doing' })
    expect(summary).toHaveTextContent('Right now 1 is up and 1 is down.')
    expect(summary).toHaveTextContent('Day 3 result on Fri Sep 25.')
  })

  it('shows each pick as what it cost, what it would sell for now, and its day 1, 3 and 5 results', async () => {
    mount('/options/results/2026-09-22')
    const call = await screen.findByRole('article', { name: 'EX call' })
    expect(call).toHaveTextContent('Bet the stock goes up')
    expect(call).toHaveTextContent('$200 by Oct 22')
    expect(within(call).getByText('Paid').nextSibling).toHaveTextContent('$557')
    expect(within(call).getByText('Worth now').nextSibling).toHaveTextContent('$698')
    expect(call).toHaveTextContent('+25.4%')
    expect(call).toHaveTextContent('Price as of Wed Sep 23, 3:59 PM ET')
    expect(within(call).getByRole('list', { name: 'Results by day' })).toHaveTextContent('Day 1+25.4%Day 3on Fri Sep 25Day 5on Tue Sep 29')
    const put = screen.getByRole('article', { name: 'EX put' })
    expect(put).toHaveTextContent('Bet the stock goes down')
    expect(within(put).getByRole('list', { name: 'Results by day' })).toHaveTextContent('Day 1not recorded')
  })

  it('marks a pick won or lost once day 3 is in, and keeps an untracked pick on the page', async () => {
    const pick = (id, direction, overrides) => ({
      id, contractId: id, tradingDate: '2026-09-22', rank: id === 'a' ? 1 : id === 'b' ? 2 : 3, ticker: id.toUpperCase(), direction, strikePrice: 10,
      expirationDate: '2026-10-22', tracked: true, untrackedReason: null, expired: false, paidUsd: 100,
      now: { at: '2026-09-25T19:55:00Z', returnPct: 10, valueUsd: 110 },
      days: { 1: { state: 'observed', returnPct: 5 }, 3: { state: 'observed', returnPct: 10 }, 5: { state: 'pending', date: '2026-09-29' } },
      result: 'won', ...overrides,
    })
    serve({ checkedAt: '2026-09-26T15:00:00Z', winDay: 3, days: [{ tradingDate: '2026-09-22', status: 'candidates', day3Date: '2026-09-25',
      counts: { picks: 3, up: 1, down: 1, won: 1, lost: 1, notTracked: 1 },
      picks: [pick('a', 'call'), pick('b', 'put', { result: 'lost', now: { at: '2026-09-25T19:55:00Z', returnPct: -40, valueUsd: 60 }, days: { 1: { state: 'observed', returnPct: -20 }, 3: { state: 'observed', returnPct: -40 }, 5: { state: 'pending', date: '2026-09-29' } } }),
        pick('c', 'call', { tracked: false, untrackedReason: 'outcome_plan_unavailable', now: null, result: null, days: { 1: { state: 'not_tracked' }, 3: { state: 'not_tracked' }, 5: { state: 'not_tracked' } } })] }] })
    mount('/options/results/2026-09-22')
    expect(await screen.findByRole('article', { name: 'A call' })).toHaveTextContent('✓ Won')
    expect(screen.getByRole('article', { name: 'B put' })).toHaveTextContent('✗ Lost')
    expect(screen.getByRole('article', { name: 'C call' })).toHaveTextContent('Not tracked')
    expect(screen.getByRole('region', { name: 'How this morning is doing' })).toHaveTextContent('Day 3: 1 won, 1 lost. 1 pick is not tracked.')
  })

  it('says so when the morning has no picks', async () => {
    mount('/options/results/2026-09-23')
    expect(await screen.findByText('No picks that morning.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← All days' })).toHaveAttribute('href', '/options/results')
  })
})
