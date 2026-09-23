import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { optionsShadowFixture } from '../test/optionsShadowFixture'
import { buildOptionsShadowView } from '../server/options/shadowView'
import { buildOptionsResearchView } from '../server/options/researchView'
import OptionsShadow from './OptionsShadow'

const auth = vi.hoisted(() => ({ user: null }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))
let seeded, open, expired, detail
beforeAll(async () => {
  seeded = await optionsShadowFixture()
  open = await buildOptionsShadowView({ archive: seeded.archive, now: () => Date.parse('2026-09-28T15:00:00Z') })
  expired = await buildOptionsShadowView({ archive: seeded.archive, now: () => Date.parse('2026-10-23T15:00:00Z') })
  const { fixture } = seeded
  detail = await buildOptionsResearchView({ ...fixture, contractId: fixture.contracts[0].contractId, now: () => Date.parse('2026-09-28T15:00:00Z') })
})
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
const serve = (shadow) => fetch.mockImplementation(async (url, init) => {
  if (url.includes('owner=1')) return response({ owner: true })
  if (init?.method === 'POST') return response({ error: 'unexpected' }, 500)
  if (url.includes('view=research')) return response({ research: detail })
  return response({ shadow })
})
const mount = () => render(<MemoryRouter initialEntries={['/options/testing']}><Routes>
  <Route path="/options/testing" element={<OptionsShadow />} /><Route path="/portfolio" element={<p>Portfolio destination</p>} />
</Routes></MemoryRouter>)
const card = (name) => screen.findByRole('article', { name })

beforeEach(() => {
  auth.user = { uid: 'owner', getIdToken: vi.fn(async () => 'owner-token') }
  vi.stubGlobal('fetch', vi.fn())
  serve(open)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('owner-only shadow-test dashboard', () => {
  it('denies a direct link before reading any options data', async () => {
    fetch.mockResolvedValue(response({ error: 'Owner access required' }, 403))
    mount()
    await screen.findByText('Portfolio destination')
    expect(screen.queryByText('Shadow test')).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toContain('owner=1')
  })

  it('labels the experiment and shows progress with every scan day, including empty, degraded and missing ones', async () => {
    mount()
    await screen.findByText('Session 5 of 20')
    expect(screen.getByText(/Private research · Options · Shadow test · Experimental/)).toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent('not live recommendations, fills or proof of profitability')
    expect(screen.getByText('1 with picks · 1 empty · 1 degraded · 1 missing')).toBeInTheDocument()
    const days = screen.getByRole('list', { name: 'Sessions in the window' })
    expect(days).toHaveTextContent('2026-09-23 Valid empty')
    expect(days).toHaveTextContent('2026-09-24 Degraded')
    expect(days).toHaveTextContent('2026-09-25 No scan recorded')
  })

  it('keeps frozen selection values apart from tracked outcomes for the winning call and losing put', async () => {
    mount()
    const call = await card('EX call from 2026-09-22')
    const put = screen.getByRole('article', { name: 'EX put from 2026-09-22' })
    for (const row of [call, put]) {
      expect(within(row).getByText(/Frozen at selection/)).toBeInTheDocument()
      expect(row).toHaveTextContent('$5.55 ask')
      expect(row).toHaveTextContent('Mid $5.50 · Bid $5.45')
      expect(row).toHaveTextContent('30 DTE at selection')
    }
    const winning = open.rows.find((row) => row.direction === 'call')
    expect(call).toHaveTextContent(`Latest · +1 session: ${winning.latest.returnPct > 0 ? '+' : ''}${winning.latest.returnPct.toFixed(1)}%`)
    expect(call).toHaveTextContent('+25% target 25.5 h after entry while OTM')
    expect(call).toHaveTextContent('while OTM')
    expect(call).toHaveTextContent('Gained while still OTM')
    const losing = open.rows.find((row) => row.direction === 'put')
    expect(put).toHaveTextContent(`Latest · Same-day close: ${losing.latest.returnPct.toFixed(1)}%`)
    expect(put).toHaveTextContent('No observed gain while OTM')
    expect(put).toHaveTextContent(`largest observed drawdown ${losing.path.maximumAdverseExcursionPct.toFixed(1)}%`)
  })

  it('shows unknown checkpoints as unknown, never as zero, both per pick and in the summary denominators', async () => {
    mount()
    const call = await card('EX call from 2026-09-22')
    fireEvent.click(within(call).getByText('Checkpoints'))
    const table = within(call).getByRole('region', { name: 'EX checkpoints' })
    expect(table).toHaveTextContent('+3 sessions')
    expect(table).toHaveTextContent('Not captured · unknown')
    expect(table).toHaveTextContent('Not yet due · unknown')
    expect(fetch.mock.calls.some(([url]) => url.includes('view=research'))).toBe(false)

    const summary = screen.getByRole('region', { name: 'Outcomes by checkpoint' })
    const row = (label) => within(summary).getByRole('rowheader', { name: label }).closest('tr')
    expect(row('Same-day close')).toHaveTextContent('2 of 2')
    expect(row('Same-day close')).toHaveTextContent('1 · 1')
    expect(row('+1 session')).toHaveTextContent('1 of 21 unknown')
    expect(row('+3 sessions')).toHaveTextContent('0 of 22 unknown')
    expect(row('+3 sessions')).not.toHaveTextContent(/%|Unavailable/)
    expect(screen.getByText(/\+25% premium target: 1 of 2 picks with observed paths \(1 while OTM\)/)).toBeInTheDocument()
    expect(screen.getByText('Gained while still OTM: 1 of 2 picks where it can be determined.')).toBeInTheDocument()
  })

  it('filters rows and recomputes the summary without hiding the losing pick', async () => {
    mount()
    await card('EX call from 2026-09-22')
    const user = userEvent.setup()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Direction' }), 'put')
    expect(screen.queryByRole('article', { name: 'EX call from 2026-09-22' })).not.toBeInTheDocument()
    expect(screen.getByRole('article', { name: 'EX put from 2026-09-22' })).toBeInTheDocument()
    expect(screen.getByText('Cohort summary · 1 pick in view')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Direction' }), 'all')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Outcome horizon' }), '1')
    expect(screen.getByRole('article', { name: 'EX put from 2026-09-22' })).toHaveTextContent('+1 session: Provider omitted the quote · unknown')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Trading date' }), '2026-09-23')
    expect(screen.getByText('No picks match these filters')).toBeInTheDocument()
  })

  it('opens archived morning detail for a past pick without requesting a live refresh', async () => {
    mount()
    const call = await card('EX call from 2026-09-22')
    fireEvent.click(within(call).getByText('Contract details'))
    await within(call).findByText('Delta')
    expect(fetch.mock.calls.find(([url]) => url.includes('view=research'))[0]).toContain(`manifestId=${seeded.fixture.manifest.manifestId}`)
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    expect(within(call).queryByText('Later observation')).not.toBeInTheDocument()
  })

  it('is read-only: its only control is reloading the record', async () => {
    mount()
    await card('EX call from 2026-09-22')
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Reload'])
  })

  it('marks picks expired once their contract has expired', async () => {
    serve(expired)
    mount()
    const call = await card('EX call from 2026-09-22')
    expect(call).toHaveTextContent('Tracked outcome · Expired')
    const user = userEvent.setup()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'open')
    expect(screen.getByText('No picks match these filters')).toBeInTheDocument()
  })

  it('says the experiment has not started when nothing is published', async () => {
    serve({ ...open, window: null, days: [], rows: [] })
    mount()
    await screen.findByText('The shadow test has not started')
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
  })
})
